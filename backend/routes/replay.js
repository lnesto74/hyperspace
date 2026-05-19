import { Router } from 'express';

export default function replayRoutes({ replayService }) {
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

  return router;
}
