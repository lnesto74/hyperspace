import fs from 'fs';
import path from 'path';
import { venueQueries } from '../database/schema.js';

export default class BenchmarkCoverageService {
  constructor({ benchmarkRunService, replayService, db } = {}) {
    this.benchmarkRunService = benchmarkRunService;
    this.replayService = replayService;
    this.db = db;
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
