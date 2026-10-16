import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { TREVIGLIO } from '../services/windflow/WindflowDayService.js';
import { categoryPackDir, CATEGORY_FILE } from '../services/windflow/categoryPack.js';

/**
 * Windflow day packs (raw 10 Hz). Contract for the spatial workspace:
 *   POST /api/windflow/ensure {venueId, days[]}  -> queue what is missing, returns status per day
 *   GET  /api/windflow/status?venueId&days=a,b   -> status per day (ready parts, job: queued/running/error, position, eta_s)
 *   GET  /api/windflow/dates?venueId              -> days whose movement field is ready
 *   GET  /api/windflow/field?venueId&day&slice    -> flow pack (404 until ready)
 *   GET  /api/windflow/kinetic?venueId&day        -> movement states (404 until ready)
 *   GET  /api/windflow/checkouts?venueId&day      -> checkouts minute by minute (404 until ready)
 *   GET  /api/windflow/categories/<file>?venueId  -> Categories lens (index.json, sections.json, <day>.json), read only
 */
export default function createWindflowRoutes(service) {
  const router = Router();
  const venueOf = (req) => String(req.query.venueId || req.body?.venueId || req.query.venue || TREVIGLIO);
  const daysOf = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((d) => String(d).trim()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 62);

  router.post('/ensure', (req, res) => {
    try { res.json({ days: service.ensure(venueOf(req), daysOf(req.body?.days)) }); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });
  router.get('/status', (req, res) => {
    const v = venueOf(req);
    res.set('Cache-Control', 'no-store');
    res.json({ days: daysOf(req.query.days).map((d) => service.status(v, d)), running: service.running?.day || null, queued: service.queue.length });
  });
  router.get('/dates', (req, res) => {
    const v = venueOf(req);
    const days = service.readyDays(v);
    res.json({ venue_id: v, latest: days[0] || null, dates: days.map((date) => ({ date, source: 'raw10hz' })) });
  });
  const send = (kind) => (req, res) => {
    const v = venueOf(req), day = String(req.query.day || req.query.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD' });
    const slice = kind === 'flow' ? String(req.query.slice || 'trading') : null;
    if (slice && !/^[a-z0-9_]+$/.test(slice)) return res.status(400).json({ error: 'bad slice' });
    const p = service.file(v, day, kind, slice);
    if (!fs.existsSync(p)) return res.status(404).json({ status: 'not_ready', ...service.status(v, day) });
    res.set('Cache-Control', 'public, max-age=600');
    res.type('application/json');
    fs.createReadStream(p).pipe(res);
  };
  router.get('/field', send('flow'));
  router.get('/kinetic', send('kinetic'));
  router.get('/checkouts', send('checkouts'));
  router.get('/categories/:file', (req, res) => {
    const file = String(req.params.file);
    const v = venueOf(req);
    if (!CATEGORY_FILE.test(file) || !/^[A-Za-z0-9-]{1,64}$/.test(v)) return res.status(400).json({ error: 'unknown file' });
    const p = path.join(categoryPackDir(v), file);
    if (!fs.existsSync(p)) return res.status(404).json({ status: 'not_ready' });
    res.set('Cache-Control', file === 'index.json' ? 'no-store' : 'public, max-age=600');
    res.type('application/json');
    fs.createReadStream(p).pipe(res);
  });
  return router;
}
