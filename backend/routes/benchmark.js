import { Router } from 'express';
import path from 'path';

export default function benchmarkRoutes({
  benchmarkRunService,
  benchmarkCoverageService,
  benchmarkJobService,
  replayService,
}) {
  const router = Router();

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
