import { Router } from 'express';
import path from 'path';

export default function benchmarkRoutes(benchmarkRunService, benchmarkCoverageService) {
  const router = Router();

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

  router.get('/runs/:id/coverage/heatmap', async (req, res) => {
    try {
      const px = Number(req.query.px) || 10;
      const { png, stats } = await benchmarkCoverageService.renderVenueHeatmap(req.params.id, { pixelsPerMeter: px });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
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
