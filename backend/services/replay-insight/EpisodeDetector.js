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

const MAIN_DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../database/hyperspace.db');

// Detection intervals
const DETECTION_INTERVAL_MS = 15 * 60 * 1000;  // Run detection every 15 minutes (2h window → plenty of overlap)
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
      this.narrationBuilder.setMainDb(this.mainDb);
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

      // NOTE: Initial baseline computation removed — it was blocking for 47s
      // and freezing trajectories. Baselines update on the hourly schedule instead.
      // Detectors handle missing baselines gracefully until the first hourly update.

      // Start periodic detection / baseline / cleanup
      this.detectionInterval = setInterval(() => this._runDetection(), DETECTION_INTERVAL_MS);
      this.baselineInterval = setInterval(() => this._updateAllBaselines(), BASELINE_INTERVAL_MS);
      this.cleanupInterval = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);

      // Run first detection after 120s to avoid piling onto the startup event loop load
      setTimeout(() => this._runDetection(), 120000);

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
    // Run detectors one at a time with setImmediate between each,
    // so track emissions can fire between detector runs (~1-2s each).
    // Without this, all 8 detectors × 2 venues block for 25+ seconds straight.
    const startTime = Date.now();

    try {
      const venues = this._getVenues();
      if (venues.length === 0) return;

      // Build work queue: one item per (venue, detector) pair
      const workQueue = [];
      const now = Date.now();
      const startTs = now - 2 * 60 * 60 * 1000;
      const endTs = now;

      for (const venue of venues) {
        for (const detector of this.detectors) {
          workQueue.push({ venueId: venue.id, detector, startTs, endTs });
        }
      }

      // Collect all episodes across all detectors/venues
      const allEpisodesByVenue = new Map(); // venueId -> episodes[]

      let workIdx = 0;
      const processNext = () => {
        if (workIdx >= workQueue.length) {
          // All detectors done — rank, clip, and store per venue
          this._finalizeDetection(allEpisodesByVenue, venues.length, startTime);
          return;
        }

        const work = workQueue[workIdx++];
        const _dt0 = Date.now();
        try {
          const episodes = work.detector.detect(work.venueId, work.startTs, work.endTs);
          if (episodes && episodes.length > 0) {
            if (!allEpisodesByVenue.has(work.venueId)) allEpisodesByVenue.set(work.venueId, []);
            allEpisodesByVenue.get(work.venueId).push(...episodes);
          }
        } catch (err) {
          console.warn(`[ReplayInsight] Detector ${work.detector.constructor.name} error:`, err.message);
        }
        const _dt = Date.now() - _dt0;
        if (_dt > 500) console.warn(`⏱️ [ReplayInsight] ${work.detector.constructor.name} venue=${work.venueId} took ${_dt}ms`);

        // Yield event loop so tracks keep emitting
        setImmediate(processNext);
      };

      setImmediate(processNext);

    } catch (err) {
      console.error('[ReplayInsight] Detection error:', err.message);
    }
  }

  _finalizeDetection(allEpisodesByVenue, venueCount, startTime) {
    let totalEpisodes = 0;
    const now = Date.now();

    for (const [venueId, allEpisodes] of allEpisodesByVenue) {
      if (allEpisodes.length === 0) continue;

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
      totalEpisodes += enriched.length;
    }

    this.lastDetectionTs = Date.now();
    const duration = Date.now() - startTime;

    if (duration > 500 || totalEpisodes > 0) {
      console.log(`[ReplayInsight] Detection complete: ${totalEpisodes} episodes across ${venueCount} venues (${duration}ms, yielded)`);
    }
  }

  _updateAllBaselines() {
    const _t0 = Date.now();
    try {
      const venues = this._getVenues();
      for (const venue of venues) {
        this.baselineTracker.updateBaselines(venue.id);
      }
      console.log(`[ReplayInsight] Baselines updated for ${venues.length} venues in ${Date.now() - _t0}ms`);
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
