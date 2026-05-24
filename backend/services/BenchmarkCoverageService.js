import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { venueQueries } from '../database/schema.js';

export default class BenchmarkCoverageService {
  constructor({ benchmarkRunService, replayService, db } = {}) {
    this.benchmarkRunService = benchmarkRunService;
    this.replayService = replayService;
    this.db = db;
  }

  /** Pre-rendered perception-frame heatmap from stage 02 (fast, aligns with coverage_spatial). */
  async getSpatialHeatmapPng(runId) {
    const heatmapOnly = this.resolveUnderlayImage(runId, '02_heatmap.png');
    if (heatmapOnly) return fs.readFileSync(heatmapOnly);

    const composite = this.resolveUnderlayImage(runId, '02_spatial_motion.png');
    if (!composite) return null;

    // Legacy 2×2 figure: top-left panel is the detection density heatmap.
    const meta = await sharp(composite).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) return null;
    return sharp(composite)
      .extract({
        left: 0,
        top: Math.round(h * 0.06),
        width: Math.round(w * 0.5),
        height: Math.round(h * 0.5),
      })
      .png()
      .toBuffer();
  }

  getSpatial(runId) {
    const { runDir } = this.benchmarkRunService.resolveRunId(runId);
    const spatialPath = path.join(runDir, 'artifacts', 'coverage_spatial.json');
    if (!fs.existsSync(spatialPath)) {
      return {
        available: false,
        reason: 'coverage_spatial.json not found — re-run benchmark (stage 05_forensic)',
      };
    }
    const data = JSON.parse(fs.readFileSync(spatialPath, 'utf8'));
    return { available: true, ...data };
  }

  resolveUnderlayImage(runId, name = '02_spatial_motion.png') {
    try {
      return this.benchmarkRunService.resolveArtifact(runId, name);
    } catch {
      return null;
    }
  }

  async renderVenueHeatmap(runId, { pixelsPerMeter = 10 } = {}) {
    if (!this.replayService) throw new Error('Replay service unavailable');
    const run = this.benchmarkRunService.getRun(runId, { includeReport: false });
    const sourceFile = run.meta?.source_file || run.scorecard?.source_file;
    const venueId = run.meta?.venue_id || run.scorecard?.venue_id;
    if (!sourceFile) throw new Error('No source_file in run metadata');

    let venueWidth = 80;
    let venueDepth = 80;
    let transform = null;
    if (venueId && this.db) {
      const venue = venueQueries.getById(this.db, venueId);
      if (venue) {
        venueWidth = Number(venue.width) || 80;
        venueDepth = Number(venue.depth) || 80;
        try {
          const parsed = JSON.parse(venue.dwg_transform_json || '{}');
          transform = parsed.perceptionTransform || null;
        } catch { /* ignore */ }
      }
    }

    const { png, stats } = await this.replayService.renderPreviewImage({
      file: sourceFile,
      transform,
      venueWidth,
      venueDepth,
      pixelsPerMeter,
    });
    return { png, stats, venueWidth, venueDepth, sourceFile };
  }
}
