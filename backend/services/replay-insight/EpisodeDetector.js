/**
 * EpisodeDetector — Main Orchestrator
 * 
 * Runs all Phase 1 detectors on a schedule, ranks results,
 * builds replay clips and narration packs, stores in EpisodeStore.
 * 
 * READ-ONLY access to main Hyperspace DB.
 * Writes only to its own replay_insight.db via EpisodeStore.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

import { EpisodeStore } from './EpisodeStore.js';
import { BaselineTracker } from './BaselineTracker.js';
import { EpisodeRanker } from './EpisodeRanker.js';
import { ReplayClipBuilder } from './ReplayClipBuilder.js';
import { NarrationPackBuilder } from './NarrationPackBuilder.js';
import { StoryRecipeEngine } from './StoryRecipeEngine.js';
import { getEpisodeTypesForKpi } from './KpiEpisodeIndex.js';

// Detectors
import { QueueBuildupDetector } from './detectors/QueueBuildupDetector.js';
import { LaneSupplyDetector } from './detectors/LaneSupplyDetector.js';
import { AbandonmentDetector } from './detectors/AbandonmentDetector.js';
import { PassbyBrowseDetector } from './detectors/PassbyBrowseDetector.js';
import { BrowseNoConvertDetector } from './detectors/BrowseNoConvertDetector.js';
import { BottleneckDetector } from './detectors/BottleneckDetector.js';
import { VisitTimeShiftDetector } from './detectors/VisitTimeShiftDetector.js';
import { DoohEpisodeDetector } from './detectors/DoohEpisodeDetector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAIN_DB_PATH = path.join(__dirname, '../../database/hyperspace.db');

// Detection intervals
const DETECTION_INTERVAL_MS = 5 * 60 * 1000;   // Run detection every 5 minutes
const BASELINE_INTERVAL_MS = 60 * 60 * 1000;    // Update baselines every hour
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // Archive old episodes daily

export class EpisodeDetectorOrchestrator {
  constructor() {
    // Open main DB in read-only mode
    this.mainDb = null;
    this.episodeStore = null;
    this.baselineTracker = null;
    this.ranker = new EpisodeRanker();
    this.clipBuilder = null;
    this.narrationBuilder = new NarrationPackBuilder();
    this.storyRecipeEngine = null;

    // Detectors
    this.detectors = [];

    // Intervals
    this.detectionInterval = null;
    this.baselineInterval = null;
    this.cleanupInterval = null;

    this.isRunning = false;
    this.lastDetectionTs = 0;
  }

  /**
   * Initialize and start the orchestrator
   */
  start() {
    try {
      // Open main DB read-only
      this.mainDb = new Database(MAIN_DB_PATH, { readonly: true });
      console.log('[ReplayInsight] Main DB opened (read-only)');

      // Initialize episode store (own DB)
      this.episodeStore = new EpisodeStore();

      // Initialize services
      this.baselineTracker = new BaselineTracker(this.mainDb, this.episodeStore);
      this.clipBuilder = new ReplayClipBuilder(this.mainDb);
      this.storyRecipeEngine = new StoryRecipeEngine(this.episodeStore);

      // Initialize detectors
      this.detectors = [
        new QueueBuildupDetector(this.mainDb, this.baselineTracker),
        new LaneSupplyDetector(this.mainDb, this.baselineTracker),
        new AbandonmentDetector(this.mainDb, this.baselineTracker),
        new PassbyBrowseDetector(this.mainDb, this.baselineTracker),
        new BrowseNoConvertDetector(this.mainDb, this.baselineTracker),
        new BottleneckDetector(this.mainDb, this.baselineTracker),
        new VisitTimeShiftDetector(this.mainDb, this.baselineTracker),
        new DoohEpisodeDetector(this.mainDb, this.baselineTracker),
      ];

      // Run initial baseline computation
      this._updateAllBaselines();

      // Start periodic detection
      this.detectionInterval = setInterval(() => this._runDetection(), DETECTION_INTERVAL_MS);
      this.baselineInterval = setInterval(() => this._updateAllBaselines(), BASELINE_INTERVAL_MS);
      this.cleanupInterval = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);

      // Run first detection after a short delay (let baselines settle)
      setTimeout(() => this._runDetection(), 10000);

      this.isRunning = true;
      console.log('[ReplayInsight] Episode detector started');
      console.log(`[ReplayInsight] ${this.detectors.length} detectors active`);
      console.log(`[ReplayInsight] Detection interval: ${DETECTION_INTERVAL_MS / 1000}s`);

    } catch (err) {
      console.error('[ReplayInsight] Failed to start:', err.message);
    }
  }

  /**
   * Stop the orchestrator
   */
  stop() {
    if (this.detectionInterval) clearInterval(this.detectionInterval);
    if (this.baselineInterval) clearInterval(this.baselineInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    if (this.mainDb) this.mainDb.close();
    if (this.episodeStore) this.episodeStore.close();

    this.isRunning = false;
    console.log('[ReplayInsight] Episode detector stopped');
  }

  // ─── Public API (called by routes) ───

  /**
   * Get episodes for a venue
   */
  getEpisodes(venueId, options = {}) {
    if (!this.episodeStore) return [];
    const episodes = this.episodeStore.getEpisodes(venueId, options);
    return this.narrationBuilder.buildPacks(episodes);
  }

  /**
   * Get a single episode with full replay data
   */
  getEpisode(episodeId) {
    if (!this.episodeStore) return null;
    const episode = this.episodeStore.getEpisode(episodeId);
    if (!episode) return null;

    // Enrich with replay clip data
    const enriched = this.clipBuilder.buildClip(episode);
    return this.narrationBuilder.buildPack(enriched);
  }

  /**
   * Get timeline markers for the timeline overlay
   */
  getTimelineMarkers(venueId, startTs, endTs) {
    if (!this.episodeStore) return [];
    return this.episodeStore.getTimelineMarkers(venueId, startTs, endTs);
  }

  /**
   * Get episodes that explain a KPI movement (reverse index)
   */
  getEpisodesForKpi(venueId, kpiId, options = {}) {
    if (!this.episodeStore) return [];
    const episodeTypes = getEpisodeTypesForKpi(kpiId);
    if (episodeTypes.length === 0) return [];

    const episodes = this.episodeStore.getEpisodesByKpi(venueId, kpiId, episodeTypes, options);
    return this.narrationBuilder.buildPacks(episodes);
  }

  /**
   * Get narrator v2 context for an episode
   */
  getNarrator2Context(episodeId) {
    if (!this.episodeStore) return null;
    const episode = this.episodeStore.getEpisode(episodeId);
    if (!episode) return null;
    return this.narrationBuilder.buildNarrator2Context(episode);
  }

  /**
   * Get story recipes
   */
  getRecipes() {
    if (!this.storyRecipeEngine) return [];
    return this.storyRecipeEngine.getRecipes();
  }

  /**
   * Execute a story recipe
   */
  executeRecipe(recipeId, venueId, options = {}) {
    if (!this.storyRecipeEngine) return { recipe: null, playlist: [] };
    const result = this.storyRecipeEngine.executeRecipe(recipeId, venueId, options);

    // Build narration packs for playlist episodes
    result.playlist = result.playlist.map(item => ({
      ...item,
      narration_pack: this.narrationBuilder.buildPack(item.episode),
    }));

    return result;
  }

  /**
   * Create a custom story recipe
   */
  createRecipe(recipe) {
    if (!this.storyRecipeEngine) return null;
    return this.storyRecipeEngine.createRecipe(recipe);
  }

  // ─── Internal Detection Pipeline ───

  _runDetection() {
    const startTime = Date.now();

    try {
      // Get all venues
      const venues = this._getVenues();
      if (venues.length === 0) return;

      let totalEpisodes = 0;

      for (const venue of venues) {
        const venueEpisodes = this._detectForVenue(venue.id);
        totalEpisodes += venueEpisodes;
      }

      this.lastDetectionTs = Date.now();
      const duration = Date.now() - startTime;

      if (totalEpisodes > 0) {
        console.log(`[ReplayInsight] Detection complete: ${totalEpisodes} episodes across ${venues.length} venues (${duration}ms)`);
      }

    } catch (err) {
      console.error('[ReplayInsight] Detection error:', err.message);
    }
  }

  _detectForVenue(venueId) {
    // Detection window: last 2 hours (overlaps with previous runs for continuity)
    const now = Date.now();
    const startTs = now - 2 * 60 * 60 * 1000;
    const endTs = now;

    let allEpisodes = [];

    // Run each detector
    for (const detector of this.detectors) {
      try {
        const episodes = detector.detect(venueId, startTs, endTs);
        allEpisodes.push(...episodes);
      } catch (err) {
        console.warn(`[ReplayInsight] Detector ${detector.constructor.name} error:`, err.message);
      }
    }

    if (allEpisodes.length === 0) return 0;

    // Rank and select top episodes
    const ranked = this.ranker.rankAndSelect(allEpisodes, 10);

    // Build replay clips for selected episodes
    const enriched = this.clipBuilder.buildClips(ranked);

    // Set detection metadata
    for (const ep of enriched) {
      ep.detection_run_ts = now;
      ep.period = 'day';
    }

    // Store episodes
    this.episodeStore.insertEpisodes(enriched);

    return enriched.length;
  }

  _updateAllBaselines() {
    try {
      const venues = this._getVenues();
      for (const venue of venues) {
        this.baselineTracker.updateBaselines(venue.id);
      }
      console.log(`[ReplayInsight] Baselines updated for ${venues.length} venues`);
    } catch (err) {
      console.warn('[ReplayInsight] Baseline update error:', err.message);
    }
  }

  _cleanup() {
    try {
      const archived = this.episodeStore.archiveOldEpisodes();
      if (archived > 0) {
        console.log(`[ReplayInsight] Archived ${archived} old episodes`);
      }
    } catch (err) {
      console.warn('[ReplayInsight] Cleanup error:', err.message);
    }
  }

  _getVenues() {
    try {
      return this.mainDb.prepare('SELECT id FROM venues').all();
    } catch {
      return [];
    }
  }
}

export default EpisodeDetectorOrchestrator;
