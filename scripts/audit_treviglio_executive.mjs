#!/usr/bin/env node
/**
 * Forensic audit: Treviglio executive KPIs vs zone_visits DB.
 * Run on prod: docker exec hyperspace-backend-1 node /app/scripts/audit_treviglio_executive.mjs
 */
import Database from 'better-sqlite3';

const VENUE_ID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const HOURS = Number(process.env.HOURS || 1);
const DWELL_SEC = Number(process.env.DWELL_SEC || 20);

const db = new Database(process.env.DB_PATH || '/data/db/hyperspace.db');
const now = Date.now();
const startTs = now - HOURS * 3600000;
const dwellMs = DWELL_SEC * 1000;

const venue = db.prepare(`
  SELECT name, default_dwell_threshold_sec, footfall_roi_id FROM venues WHERE id = ?
`).get(VENUE_ID);

console.log('=== VENUE ===', venue);
console.log('Window:', new Date(startTs).toISOString(), '→', new Date(now).toISOString());
console.log('Dwell threshold:', DWELL_SEC, 's\n');

// Track key format — reconciled should be device:stableId (stableId often s_* or uuid)
const keyFmt = db.prepare(`
  SELECT
    CASE
      WHEN track_key LIKE '%:%' THEN 'device:stable'
      ELSE 'other'
    END AS fmt,
    COUNT(*) AS c,
    AVG(duration_ms) AS avg_ms
  FROM zone_visits
  WHERE venue_id = ? AND start_time >= ?
  GROUP BY fmt
`).all(VENUE_ID, startTs);
console.log('=== TRACK_KEY FORMAT (zone_visits) ===');
console.table(keyFmt);

const samples = db.prepare(`
  SELECT track_key, duration_ms, start_time FROM zone_visits
  WHERE venue_id = ? AND start_time >= ?
  ORDER BY start_time DESC LIMIT 8
`).all(VENUE_ID, startTs);
console.log('Recent track_key samples:', samples);

// Ingress
const ingress = db.prepare(`
  SELECT COUNT(*) c, COUNT(DISTINCT track_key) u
  FROM ingress_perimeter_crossings WHERE venue_id = ? AND crossed_at >= ?
`).get(VENUE_ID, startTs);
console.log('\n=== INGRESS (perimeter crossings) ===', ingress);

// All zone visits summary
const all = db.prepare(`
  SELECT COUNT(*) visits,
    AVG(duration_ms) avg_ms,
    SUM(CASE WHEN duration_ms >= ? THEN 1 ELSE 0 END) dwells,
    COUNT(DISTINCT track_key) unique_tracks
  FROM zone_visits WHERE venue_id = ? AND start_time >= ?
`).get(dwellMs, VENUE_ID, startTs);
console.log('\n=== ALL ZONE_VISITS ===', all);

  // By zone type
  const byZone = db.prepare(`
    SELECT
      CASE
        WHEN r.name LIKE '%Traffic%' OR r.name LIKE '%Entrance%' THEN 'traffic'
        WHEN r.name LIKE '%Engagement%' OR r.name LIKE '%Shelf%' THEN 'shelf'
        WHEN r.name LIKE '%Fresco%' OR r.name LIKE '%Carne%' OR r.name LIKE '%Pesce%' THEN 'fresco'
        ELSE 'other'
      END AS kind,
      COUNT(*) visits,
      AVG(zv.duration_ms) avg_ms,
      SUM(CASE WHEN zv.duration_ms >= ? THEN 1 ELSE 0 END) dwells,
      COUNT(DISTINCT zv.track_key) tracks
    FROM zone_visits zv
    JOIN regions_of_interest r ON r.id = zv.roi_id
    WHERE zv.venue_id = ? AND zv.start_time >= ?
    GROUP BY kind
  `).all(dwellMs, VENUE_ID, startTs);
console.log('\n=== BY ZONE KIND ===');
console.table(byZone);

// Aisle/shelf detail
const shelves = db.prepare(`
  SELECT r.name, COUNT(*) v,
    ROUND(AVG(zv.duration_ms)) avg_ms,
    SUM(CASE WHEN zv.duration_ms >= ? THEN 1 ELSE 0 END) dwells
  FROM zone_visits zv
  JOIN regions_of_interest r ON r.id = zv.roi_id
  WHERE zv.venue_id = ? AND zv.start_time >= ?
    AND (r.name LIKE '%Shelf%' OR r.name LIKE '%Engagement%')
  GROUP BY r.name ORDER BY v DESC LIMIT 15
`).all(dwellMs, VENUE_ID, startTs);
console.log('\n=== TOP SHELF ZONES ===');
console.table(shelves);

// Session stitching: same stableId prefix across visits
const stableKeys = db.prepare(`
  SELECT track_key, COUNT(*) c, SUM(duration_ms) total_ms, MAX(duration_ms) max_ms
  FROM zone_visits
  WHERE venue_id = ? AND start_time >= ? AND track_key LIKE '%:%'
  GROUP BY track_key
  ORDER BY total_ms DESC LIMIT 10
`).all(VENUE_ID, startTs);
console.log('\n=== TOP RECONCILED TRACKS (by total zone time) ===');
console.table(stableKeys);

// visitor_session_id coverage
const sessCol = db.prepare(`PRAGMA table_info(zone_visits)`).all().map(c => c.name);
if (sessCol.includes('visitor_session_id')) {
  const sess = db.prepare(`
    SELECT
      SUM(CASE WHEN visitor_session_id IS NOT NULL AND visitor_session_id != '' THEN 1 ELSE 0 END) with_sess,
      COUNT(*) total
    FROM zone_visits WHERE venue_id = ? AND start_time >= ?
  `).get(VENUE_ID, startTs);
  console.log('\n=== visitor_session_id coverage ===', sess);
}

// Hourly chart sanity: entrants vs dwell episodes (Rome TZ)
function romeHour(ts) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome', hour: 'numeric', hour12: false,
  }).format(new Date(ts)));
}

const crossings = db.prepare(`
  SELECT crossed_at FROM ingress_perimeter_crossings
  WHERE venue_id = ? AND crossed_at >= ?
`).all(VENUE_ID, now - 24 * 3600000);

const dwellRows = db.prepare(`
  SELECT zv.start_time, zv.duration_ms, zv.track_key
  FROM zone_visits zv
  JOIN regions_of_interest r ON r.id = zv.roi_id
  WHERE zv.venue_id = ? AND zv.start_time >= ?
    AND (r.name LIKE '%Shelf%' OR r.name LIKE '%Engagement%')
    AND zv.duration_ms >= ?
`).all(VENUE_ID, now - 24 * 3600000, dwellMs);

const entByHour = new Map();
for (const { crossed_at } of crossings) {
  const h = romeHour(crossed_at);
  entByHour.set(h, (entByHour.get(h) || 0) + 1);
}
const dwellTracksByHour = new Map();
const dwellEpsByHour = new Map();
for (const { start_time, track_key } of dwellRows) {
  const h = romeHour(start_time);
  dwellEpsByHour.set(h, (dwellEpsByHour.get(h) || 0) + 1);
  if (!dwellTracksByHour.has(h)) dwellTracksByHour.set(h, new Set());
  dwellTracksByHour.get(h).add(track_key);
}

console.log('\n=== HOURLY CHART (last 24h Rome) — entrants vs dwell ===');
console.log('WRONG: episode count / entrants → can exceed 100%');
console.log('RIGHT: unique reconciled tracks with dwell / entrants');
for (const h of [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]) {
  const e = entByHour.get(h) || 0;
  const dEp = dwellEpsByHour.get(h) || 0;
  const dTr = dwellTracksByHour.get(h)?.size || 0;
  if (e || dEp || dTr) {
    const wrong = e > 0 ? ((dEp / e) * 100).toFixed(1) : '—';
    const right = e > 0 ? ((dTr / e) * 100).toFixed(1) : '—';
    console.log(`  ${String(h).padStart(2, '0')}:00  entrants=${e}  dwell_eps=${dEp}  dwell_tracks=${dTr}  wrong%=${wrong}  right%=${right}`);
  }
}

// Stitched session simulation: group by track_key stable part, max dwell per aisle category
console.log('\n=== SESSION-STYLE: tracks with any shelf dwell >= threshold ===');
const tracksWithDwell = db.prepare(`
  SELECT COUNT(DISTINCT zv.track_key) c
  FROM zone_visits zv
  JOIN regions_of_interest r ON r.id = zv.roi_id
  WHERE zv.venue_id = ? AND zv.start_time >= ?
    AND (r.name LIKE '%Shelf%' OR r.name LIKE '%Engagement%')
    AND zv.duration_ms >= ?
`).get(VENUE_ID, startTs, dwellMs);
const tracksCrossed = db.prepare(`
  SELECT COUNT(DISTINCT zv.track_key) c
  FROM zone_visits zv
  JOIN regions_of_interest r ON r.id = zv.roi_id
  WHERE zv.venue_id = ? AND zv.start_time >= ?
    AND (r.name LIKE '%Shelf%' OR r.name LIKE '%Engagement%')
`).get(VENUE_ID, startTs);
console.log({
  uniqueTracksCrossedAisle: tracksCrossed?.c,
  uniqueTracksWithDwell: tracksWithDwell?.c,
  sessionStoppingPct: tracksCrossed?.c > 0
    ? Math.round((tracksWithDwell.c / tracksCrossed.c) * 1000) / 10
    : 0,
});

db.close();
