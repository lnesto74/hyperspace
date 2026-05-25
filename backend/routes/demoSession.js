import { Router } from 'express';

export default function createDemoSessionRoutes(demoSessionService) {
  const router = Router();

  router.post('/sessions/start', (req, res) => {
    try {
      const { venueId } = req.body || {};
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const session = demoSessionService.startSession(venueId);
      res.json(session);
    } catch (err) {
      console.error('[DemoSession] start error:', err.message);
      res.status(500).json({ error: 'Failed to start demo session' });
    }
  });

  router.post('/sessions/stop', (req, res) => {
    try {
      const { sessionId, venueId } = req.body || {};
      let stopped = false;

      if (sessionId) {
        stopped = demoSessionService.stopSession(sessionId);
      } else if (venueId) {
        stopped = demoSessionService.stopSessionForVenue(venueId);
      } else {
        return res.status(400).json({ error: 'sessionId or venueId required' });
      }

      res.json({ stopped });
    } catch (err) {
      console.error('[DemoSession] stop error:', err.message);
      res.status(500).json({ error: 'Failed to stop demo session' });
    }
  });

  router.get('/sessions/active', (req, res) => {
    try {
      const { venueId } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const session = demoSessionService.getActiveSessionForVenue(venueId);
      if (!session) {
        return res.json({ active: false });
      }

      res.json({
        active: true,
        sessionId: session.sessionId,
        venueId: session.venueId,
        startedAt: session.startedAt,
      });
    } catch (err) {
      console.error('[DemoSession] active error:', err.message);
      res.status(500).json({ error: 'Failed to get demo session status' });
    }
  });

  return router;
}
