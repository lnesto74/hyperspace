import { Router } from 'express';
import { venueQueries } from '../database/schema.js';

export default function replayRoutes({ replayService, mqttRecordService, mqttService, db }) {
  const router = Router();

  router.get('/files', (_req, res) => {
    try {
      res.json({ files: replayService.listFiles(), replayDir: replayService.replayDir });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/status', (_req, res) => {
    res.json(replayService.status());
  });

  router.post('/start', async (req, res) => {
    const { file, speed, rewriteTimestamps, devicePrefix } = req.body || {};
    try {
      if (!file) return res.status(400).json({ error: 'file is required' });
      // Fire-and-forget playback loop, but surface synchronous validation errors.
      replayService.start({ file, speed, rewriteTimestamps, devicePrefix })
        .catch((err) => { console.error('[Replay] playback failed:', err.message); });
      await new Promise(r => setTimeout(r, 150));
      const status = replayService.status();
      if (!status.running) {
        return res.status(400).json({ error: status.lastError || 'Replay failed to start' });
      }
      res.json({ success: true, status });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/stop', async (_req, res) => {
    try {
      await replayService.stop();
      res.json({ success: true, status: replayService.status() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Record MQTT on main server (edge already bridges here) ----

  router.get('/record/status', (_req, res) => {
    try {
      if (!mqttRecordService) return res.status(503).json({ error: 'Recording not available' });
      res.json({ success: true, status: mqttRecordService.getStatus(mqttService) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/record/start', (req, res) => {
    try {
      if (!mqttRecordService) return res.status(503).json({ error: 'Recording not available' });
      const { label } = req.body || {};
      const status = mqttRecordService.start({ label: label || 'capture' });
      res.json({ success: true, status: mqttRecordService.getStatus(mqttService) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/record/stop', (_req, res) => {
    try {
      if (!mqttRecordService) return res.status(503).json({ error: 'Recording not available' });
      const stopped = mqttRecordService.stop();
      res.json({
        success: true,
        stopped,
        file: stopped.file ? { name: stopped.file, size: stopped.bytesWritten } : null,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/preview-image', async (req, res) => {
    try {
      const { file, venueId, t } = req.query;
      const pixelsPerMeter = Math.max(2, Math.min(40, Number(req.query.px) || 12));
      if (!file) return res.status(400).json({ error: 'file query param required' });
      let venueWidth = 80, venueDepth = 80, transform = null;
      if (venueId && db) {
        const venue = venueQueries.getById(db, String(venueId));
        if (!venue) return res.status(404).json({ error: 'Venue not found' });
        venueWidth = Number(venue.width) || 80;
        venueDepth = Number(venue.depth) || 80;
        try {
          const parsed = JSON.parse(venue.dwg_transform_json || '{}');
          transform = parsed.perceptionTransform || null;
        } catch { /* ignore */ }
      }
      if (typeof t === 'string' && t.length) {
        try { transform = JSON.parse(t); } catch { /* ignore */ }
      }
      const { png, stats } = await replayService.renderPreviewImage({
        file: String(file),
        transform,
        venueWidth,
        venueDepth,
        pixelsPerMeter,
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Replay-Preview-Stats', JSON.stringify(stats));
      res.send(png);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
