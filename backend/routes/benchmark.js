import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORY_STRIP_HTML = path.join(__dirname, '../public/benchmark-story-strip.html');
const PRESENTATION_DIR = path.join(__dirname, '../public/presentation');

export default function benchmarkRoutes({
  benchmarkRunService,
  benchmarkCoverageService,
  benchmarkJobService,
  replayService,
  liveTrackSampleService,
}) {
  const router = Router();

  /** Live DB samples: tracks that touched a category ROI, raw vs reconciled polylines. */
  router.get('/live-samples/categories', (req, res) => {
    try {
      if (!liveTrackSampleService) return res.status(503).json({ error: 'Live samples unavailable' });
      const venueId = String(req.query.venueId || '');
      if (!venueId) return res.status(400).json({ error: 'venueId required' });
      res.json({ venueId, categories: liveTrackSampleService.listCategories(venueId) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/live-samples', (req, res) => {
    try {
      if (!liveTrackSampleService) return res.status(503).json({ error: 'Live samples unavailable' });
      const venueId = String(req.query.venueId || '');
      const category = String(req.query.category || '');
      const start = Number(req.query.start);
      const end = Number(req.query.end);
      const limit = req.query.limit != null ? Number(req.query.limit) : 12;
      const sort = String(req.query.sort || 'longest');
      const mode = String(req.query.mode || 'reconciled');
      const lifeBucket = req.query.lifeBucket != null ? String(req.query.lifeBucket) : '';
      const payload = liveTrackSampleService.getSamples({
        venueId, category, start, end, limit, sort, mode, lifeBucket,
      });
      res.json(payload);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // Canva screenshot page — under /api/* so Caddy already proxies to backend (no Caddyfile change needed)
  router.get('/story-strip', (_req, res) => {
    if (!fs.existsSync(STORY_STRIP_HTML)) {
      return res.status(404).type('text/plain').send('Story strip page not deployed (missing backend/public/benchmark-story-strip.html)');
    }
    res.type('html');
    return res.sendFile(STORY_STRIP_HTML);
  });

  router.get('/presentation/:filename', (req, res) => {
    try {
      const base = path.basename(String(req.params.filename));
      if (!base || base.includes('..')) throw new Error('Invalid filename');
      const filePath = path.join(PRESENTATION_DIR, base);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return res.status(404).json({ error: `Not found: ${base}` });
      }
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.png') res.type('image/png');
      else if (ext === '.jpg' || ext === '.jpeg') res.type('image/jpeg');
      return res.sendFile(filePath);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  router.get('/capture-files', (_req, res) => {
    try {
      const files = replayService
        ? replayService.listFiles().filter((f) => f.name.endsWith('.jsonl'))
        : [];
      res.json({ files, replayDir: replayService?.replayDir ?? null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/job', (_req, res) => {
    try {
      const job = benchmarkJobService.getProgress();
      const logTail = job.captureId
        ? benchmarkJobService.getLogTail(job.captureId, 60)
        : '';
      res.json({ job, logTail });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/job/start', (req, res) => {
    try {
      const { captureId, file, after, before, skipSpatial, skipVerify, skipExplore } = req.body || {};
      const job = benchmarkJobService.start({
        captureId,
        file,
        after,
        before,
        skipSpatial: !!skipSpatial,
        skipVerify: !!skipVerify,
        skipExplore: !!skipExplore,
      });
      res.json({ job });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/runs/:id/log', (req, res) => {
    try {
      res.json({ log: benchmarkJobService.getLogTail(req.params.id, 120) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/runs', (_req, res) => {
    try {
      res.json({
        runs: benchmarkRunService.listRuns(),
        runsDir: benchmarkRunService.runsDir,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/runs/:id', (req, res) => {
    try {
      const includeReport = req.query.includeReport !== '0';
      res.json(benchmarkRunService.getRun(req.params.id, { includeReport }));
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  router.get('/runs/:id/coverage/spatial', (req, res) => {
    try {
      res.json(benchmarkCoverageService.getSpatial(req.params.id));
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  router.get('/runs/:id/coverage/zones', (req, res) => {
    try {
      res.json(benchmarkCoverageService.getProblemZones(req.params.id));
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  router.get('/runs/:id/coverage/floorplan', (req, res) => {
    try {
      res.json(benchmarkCoverageService.getFloorplanContext(req.params.id));
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  router.get('/runs/:id/coverage/reconciled/:config', (req, res) => {
    try {
      res.json(benchmarkCoverageService.getReconciledSpatial(req.params.id, req.params.config));
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  router.get('/runs/:id/coverage/heatmap', async (req, res) => {
    try {
      const live = req.query.live === '1' || req.query.live === 'true';
      const artifactPng = !live ? await benchmarkCoverageService.getSpatialHeatmapPng(req.params.id) : null;
      if (artifactPng) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-Heatmap-Source', '02_spatial_motion.png');
        return res.send(artifactPng);
      }

      const px = Number(req.query.px) || 10;
      const { png, stats } = await benchmarkCoverageService.renderVenueHeatmap(req.params.id, { pixelsPerMeter: px });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Heatmap-Source', 'venue-transform-live');
      res.setHeader('X-Replay-Preview-Stats', JSON.stringify(stats));
      res.send(png);
    } catch (err) {
      res.status(err.message.includes('not found') ? 404 : 500).json({ error: err.message });
    }
  });

  router.get('/runs/:id/artifacts/:filename', (req, res) => {
    try {
      const filePath = benchmarkRunService.resolveArtifact(req.params.id, req.params.filename);
      const ext = path.extname(filePath).toLowerCase();
      if (ext === '.json') res.type('application/json');
      else if (ext === '.png') res.type('image/png');
      return res.sendFile(filePath);
    } catch (err) {
      const status = err.message.includes('not found') ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  });

  return router;
}
