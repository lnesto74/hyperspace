import { Router } from 'express';
import { DEFAULT_VENUE_ID, SLICE_IDS } from '../services/FlowFieldDailyService.js';

export default function createFlowfieldRoutes(flowFieldDaily) {
  const router = Router();

  router.get('/dates', (req, res) => {
    try {
      const venueId = String(req.query.venue || flowFieldDaily.defaultVenueId || DEFAULT_VENUE_ID);
      const dates = flowFieldDaily.listDates(venueId);
      res.json({
        venue_id: venueId,
        latest: dates[0]?.date || null,
        today: flowFieldDaily.localToday(),
        tz_offset_h: flowFieldDaily.tzOffsetH,
        dates,
      });
    } catch (err) {
      console.error('[flowfield] dates failed:', err);
      res.status(500).json({ error: err.message || 'failed to list dates' });
    }
  });

  router.get('/field', async (req, res) => {
    try {
      const venueId = String(req.query.venue || flowFieldDaily.defaultVenueId || DEFAULT_VENUE_ID);
      const slice = String(req.query.slice || 'all');
      const dateStr = req.query.date ? String(req.query.date) : null;
      if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      if (!SLICE_IDS.has(slice)) {
        return res.status(400).json({ error: `unknown slice: ${slice}` });
      }
      const force = req.query.force === '1';
      const field = await flowFieldDaily.getField({ venueId, dateStr, slice, force });
      res.set('Cache-Control', field.meta.local_date === flowFieldDaily.localToday()
        ? 'no-store'
        : 'public, max-age=300');
      res.json(field);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[flowfield] field failed:', err);
      res.status(status).json({ error: err.message || 'failed to load field' });
    }
  });

  router.post('/rebuild', async (req, res) => {
    try {
      const venueId = String(req.body?.venue || req.query.venue || flowFieldDaily.defaultVenueId);
      const dateStr = String(req.body?.date || req.query.date || flowFieldDaily.latestDate(venueId) || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      }
      const index = await flowFieldDaily.rebuild(venueId, dateStr);
      res.json(index);
    } catch (err) {
      console.error('[flowfield] rebuild failed:', err);
      res.status(500).json({ error: err.message || 'rebuild failed' });
    }
  });

  return router;
}
