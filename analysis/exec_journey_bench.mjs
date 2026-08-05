/**
 * Times computeExecutiveJourney across every dashboard range and prints the KPIs
 * that depend on session stitching, so a run tells us both "is it fast enough"
 * and "did the numbers come back".
 *
 * Usage (inside the backend container):
 *   node analysis/exec_journey_bench.mjs [venueId]
 */

import fs from 'node:fs';
import Database from 'better-sqlite3';
import { computeExecutiveJourney } from '../services/executive/ExecutiveJourneyService.js';

const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const db = new Database(DB_PATH);
db.pragma('busy_timeout = 15000');

function resolveVenueId(explicit) {
  if (explicit) return explicit;
  const row = db.prepare(`
    SELECT zv.venue_id AS id, COUNT(*) AS n
    FROM zone_visits zv
    WHERE zv.start_time >= ?
    GROUP BY zv.venue_id
    ORDER BY n DESC
    LIMIT 1
  `).get(Date.now() - 30 * 24 * 3600000);
  return row?.id;
}

const venueId = resolveVenueId(process.argv[2]);
if (!venueId) {
  console.error('No venue with recent zone_visits found.');
  process.exit(1);
}

const venueName = db.prepare('SELECT name FROM venues WHERE id = ?').get(venueId)?.name;
console.log(`DB      : ${DB_PATH}`);
console.log(`Venue   : ${venueName || '(unnamed)'} [${venueId}]`);

const walBytes = (() => {
  try {
    return fs.statSync(`${DB_PATH}-wal`).size;
  } catch {
    return null;
  }
})();
if (walBytes != null) console.log(`WAL     : ${(walBytes / 1024 / 1024).toFixed(1)} MB`);
console.log('');

const RANGES = [
  ['1h', 3600000],
  ['24h', 24 * 3600000],
  ['7d', 7 * 24 * 3600000],
  ['30d', 30 * 24 * 3600000],
];

const results = [];
for (const [label, spanMs] of RANGES) {
  const endTs = Date.now();
  const startTs = endTs - spanMs;
  const t0 = process.hrtime.bigint();
  let payload;
  let error = null;
  try {
    payload = computeExecutiveJourney(db, venueId, startTs, endTs, 'live');
  } catch (err) {
    error = err;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  if (error) {
    console.log(`${label.padEnd(4)} ${String(Math.round(ms)).padStart(7)}ms  THREW: ${error.message}`);
    results.push({ label, ms, error: error.message });
    continue;
  }

  const o = payload?.overview || {};
  const row = {
    label,
    ms: Math.round(ms),
    entrants: o.perimeterEntrants ?? null,
    sessions: o.dwellSessionCount ?? null,
    stitched: o.stitchedEntranceSessions ?? null,
    dwellMin: o.avgStoreDwellMin ?? null,
    dwellReliable: o.avgStoreDwellReliable ?? null,
    penetrationPct: payload?.aisles?.penetrationPct ?? null,
    stoppingPct: payload?.aisles?.stoppingPowerPct ?? null,
    friction: payload?.checkout?.frictionScore ?? null,
    frescoDepts: payload?.fresco?.departments?.length ?? null,
    heatmapRows: payload?.heatmapCategories?.length ?? null,
    timelinePoints: payload?.activityTimeline?.visitors?.length ?? null,
  };
  results.push(row);
  console.log(
    `${label.padEnd(4)} ${String(row.ms).padStart(7)}ms  `
    + `entrants=${String(row.entrants).padStart(6)}  `
    + `sessions=${String(row.sessions).padStart(6)}  `
    + `dwell=${String(row.dwellMin).padStart(5)}min(${row.dwellReliable ? 'ok' : 'unreliable'})  `
    + `penetration=${String(row.penetrationPct).padStart(5)}  `
    + `stopping=${String(row.stoppingPct).padStart(5)}  `
    + `friction=${String(row.friction).padStart(5)}  `
    + `fresco=${row.frescoDepts} heatmap=${row.heatmapRows} timeline=${row.timelinePoints}`,
  );
}

console.log('\nJSON:', JSON.stringify(results));
db.close();
