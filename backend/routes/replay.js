import { Router } from 'express';
import { venueQueries } from '../database/schema.js';

export default function replayRoutes({ replayService, db }) {
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
      // Kick off in the background — start() resolves only when playback ends
      replayService.start({ file, speed, rewriteTimestamps, devicePrefix })
        .catch((err) => { console.error('[Replay] start failed:', err.message); });
      // Give the service a moment to set state
      await new Promise(r => setTimeout(r, 100));
      res.json({ success: true, status: replayService.status() });
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

  /**
   * Static heatmap preview — render every detection in a JSONL through the
   * given venue's perceptionTransform, return a PNG sized to the venue floor
   * for overlay alignment.
   *
   *   GET /api/replay/preview-image?file=raw_tracks.jsonl&venueId=<uuid>&px=12
   */
  router.get('/preview-image', async (req, res) => {
    try {
      const { file, venueId } = req.query;
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
