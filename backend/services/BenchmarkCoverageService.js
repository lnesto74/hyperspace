import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { venueQueries, objectQueries } from '../database/schema.js';

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

  getProblemZones(runId) {
    const { runDir } = this.benchmarkRunService.resolveRunId(runId);
    const zonesPath = path.join(runDir, 'artifacts', 'problem_zones.json');
    if (!fs.existsSync(zonesPath)) {
      return {
        available: false,
        reason: 'problem_zones.json not found — re-run stage 05_forensic on this capture',
      };
    }
    const data = JSON.parse(fs.readFileSync(zonesPath, 'utf8'));
    return { available: true, ...data };
  }

  getFloorplanContext(runId) {
    if (!this.db) {
      return { available: false, reason: 'Database unavailable' };
    }
    const run = this.benchmarkRunService.getRun(runId, { includeReport: false });
    const venueId = run.meta?.venue_id || run.scorecard?.venue_id;
    if (!venueId) {
      return { available: false, reason: 'No venue_id on this benchmark run' };
    }
    const venue = venueQueries.getById(this.db, venueId);
    if (!venue) {
      return { available: false, reason: `Venue not found: ${venueId}` };
    }

    let perceptionTransform = null;
    let scaleCorrection = 1;
    try {
      const parsed = JSON.parse(venue.dwg_transform_json || '{}');
      perceptionTransform = parsed.perceptionTransform || null;
      scaleCorrection = Number(parsed.scaleCorrection) || 1;
    } catch { /* ignore */ }

    const objects = objectQueries.getByVenueId(this.db, venueId).map((o) => ({
      id: o.id,
      type: o.type,
      name: o.name,
      x: o.position.x,
      z: o.position.z,
      w: Math.max(0.2, Math.abs(o.scale?.x ?? 1)),
      d: Math.max(0.2, Math.abs(o.scale?.z ?? 1)),
      rotation_y: o.rotation?.y ?? 0,
      color: o.color || '#64748b',
    }));

    let floorplanImageUrl = null;
    let floorplanImportId = null;
    let floorplanTransform = null;
    if (venue.dwg_layout_version_id) {
      const layout = this.db.prepare(
        'SELECT import_id FROM dwg_layout_versions WHERE id = ?',
      ).get(venue.dwg_layout_version_id);
      if (layout?.import_id) {
        floorplanImportId = layout.import_id;
        floorplanImageUrl = `/api/dwg/import/${layout.import_id}/floorplan/image`;
        try {
          const fpRow = this.db.prepare(
            'SELECT transform_json FROM dwg_floorplan_images WHERE import_id = ? ORDER BY created_at DESC LIMIT 1',
          ).get(layout.import_id);
          if (fpRow?.transform_json) {
            const parsed = JSON.parse(fpRow.transform_json);
            const { cropRect: _crop, ...transform } = parsed;
            floorplanTransform = transform;
          }
        } catch { /* ignore */ }
      }
    }

    const width = Number(venue.width) || 80;
    const depth = Number(venue.depth) || 80;
    return {
      available: true,
      venue_id: venueId,
      venue_name: venue.name,
      venue_width: width,
      venue_depth: depth,
      perceptionTransform,
      scaleCorrection,
      dwg_layout_version_id: venue.dwg_layout_version_id || null,
      objects,
      floorplan_image_url: floorplanImageUrl,
      floorplan_import_id: floorplanImportId,
      floorplan_transform: floorplanTransform,
      bbox_venue: { x0: 0, z0: 0, x1: width, z1: depth },
      has_transform: !!perceptionTransform,
    };
  }

  getReconciledSpatial(runId, configName) {
    const { runDir } = this.benchmarkRunService.resolveRunId(runId);
    const safe = String(configName || '').replace(/[^a-zA-Z0-9_]+/g, '');
    const spatialPath = path.join(runDir, 'artifacts', `reconciler_spatial_${safe}.json`);
    if (!fs.existsSync(spatialPath)) {
      return {
        available: false,
        reason: `reconciler_spatial_${safe}.json not found — re-run stage 06_verify`,
        config: safe,
      };
    }
    const data = JSON.parse(fs.readFileSync(spatialPath, 'utf8'));
    const rawSpatial = this.getSpatial(runId);
    const bbox = rawSpatial.bbox || null;
    return { ...data, available: true, bbox };
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
