#!/usr/bin/env node
/**
 * Why does every Piazza del Fresco counter report the same avg dwell?
 *
 * The card shows `totalDurationMs / distinct tracks`, which is neither an
 * average dwell nor conditioned on the dwell visits printed beside it. This
 * probe recomputes that figure using the report's own ROI classifier, next to
 * the honest conditional mean, the median, and a fine histogram of the raw
 * durations — so a genuine reading can be told apart from a tracker ceiling.
 *
 * Usage (on the droplet):
 *   docker cp analysis/11_fresco_dwell_probe.mjs hyperspace-backend-1:/app/scripts/
 *   docker exec -w /app hyperspace-backend-1 node scripts/11_fresco_dwell_probe.mjs
 *
 * Read-only. Writes nothing to the database.
 */
import Database from 'better-sqlite3';
import { loadClassifiedRois, FRESCO_DEPT_LABELS } from '/app/services/executive/ExecutiveZoneTaxonomy.js';

const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const VENUE_ID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const DWELL_SEC = Number(process.env.DWELL_SEC || 5);
const dwellMs = DWELL_SEC * 1000;

const db = new Database(DB_PATH, { readonly: true });
const now = Date.now();

// The screenshot's window is unknown, so score several and let the crossing
// counts identify it (Verdura showed 1,193).
const WINDOWS = [
  ['24h', now - 86400_000],
  ['7d', now - 7 * 86400_000],
  ['30d', now - 30 * 86400_000],
];

const classified = loadClassifiedRois(db, VENUE_ID);
const fresco = classified.filter(r => r.classification.group === 'fresco');

const byDept = new Map();
for (const roi of fresco) {
  const dept = roi.classification.subGroup || 'fresco';
  const label = roi.classification.categoryLabel || roi.linkedCategory
    || FRESCO_DEPT_LABELS[dept] || dept;
  if (!byDept.has(dept)) byDept.set(dept, { label, ids: [] });
  byDept.get(dept).ids.push(roi.id);
}

console.log(`venue ${VENUE_ID}  fresco zones ${fresco.length}  departments ${byDept.size}`);
console.log(`stopping threshold ${DWELL_SEC}s\n`);

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
};

for (const [windowLabel, startTs] of WINDOWS) {
  console.log(`\n${'='.repeat(78)}\nWINDOW ${windowLabel}  ${new Date(startTs).toISOString()} -> ${new Date(now).toISOString()}\n${'='.repeat(78)}`);
  const rows = [];

  for (const [dept, { label, ids }] of byDept) {
    const ph = ids.map(() => '?').join(',');
    const durations = db.prepare(`
      SELECT duration_ms AS d FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${ph})
        AND start_time >= ? AND start_time < ?
        AND track_key NOT LIKE '%cashier%'
        AND duration_ms IS NOT NULL
    `).all(VENUE_ID, ...ids, startTs, now).map(r => r.d);

    if (!durations.length) { rows.push({ label, visits: 0 }); continue; }

    const unique = db.prepare(`
      SELECT COUNT(DISTINCT track_key) AS c FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${ph})
        AND start_time >= ? AND start_time < ?
        AND track_key NOT LIKE '%cashier%'
    `).get(VENUE_ID, ...ids, startTs, now).c;

    const total = durations.reduce((s, d) => s + d, 0);
    const stops = durations.filter(d => d >= dwellMs).sort((a, b) => a - b);
    const sorted = [...durations].sort((a, b) => a - b);

    rows.push({
      label,
      visits: durations.length,
      unique,
      // exactly what the card prints
      cardAvgSec: unique > 0 ? Math.round(total / unique / 1000) : 0,
      // what the card's label and tooltip claim it prints
      trueStopMeanSec: stops.length
        ? Math.round((stops.reduce((s, d) => s + d, 0) / stops.length / 1000) * 10) / 10 : 0,
      stopMedianSec: stops.length ? Math.round(quantile(stops, 0.5) / 100) / 10 : 0,
      stopP90Sec: stops.length ? Math.round(quantile(stops, 0.9) / 100) / 10 : 0,
      stopMaxSec: stops.length ? Math.round(stops[stops.length - 1] / 100) / 10 : 0,
      allMedianSec: Math.round(quantile(sorted, 0.5) / 100) / 10,
      stoppingPct: Math.round((stops.length / durations.length) * 1000) / 10,
      dwellVisits: stops.length,
    });
  }

  rows.sort((a, b) => b.visits - a.visits);
  console.table(rows);

  // A ceiling shows up as mass piling into one narrow band; real behaviour
  // spreads. Only the stopped visits matter here.
  console.log('\nduration histogram of stopped visits (5s bins, share of stops)');
  for (const [dept, { label, ids }] of byDept) {
    const ph = ids.map(() => '?').join(',');
    const hist = db.prepare(`
      SELECT CAST(duration_ms / 5000 AS INTEGER) * 5 AS bin, COUNT(*) AS c
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${ph})
        AND start_time >= ? AND start_time < ?
        AND track_key NOT LIKE '%cashier%'
        AND duration_ms >= ?
      GROUP BY bin ORDER BY bin
    `).all(VENUE_ID, ...ids, startTs, now, dwellMs);
    if (!hist.length) continue;
    const n = hist.reduce((s, r) => s + r.c, 0);
    const line = hist.map(r => `${r.bin}-${r.bin + 5}s:${((r.c / n) * 100).toFixed(0)}%`).join('  ');
    console.log(`  ${label.padEnd(12)} n=${String(n).padStart(6)}  ${line}`);
  }

  // If durations are quantised the raw values collapse onto a few ticks.
  const allIds = [...byDept.values()].flatMap(v => v.ids);
  const ph = allIds.map(() => '?').join(',');
  const modes = db.prepare(`
    SELECT duration_ms AS d, COUNT(*) AS c FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ? AND duration_ms >= ?
    GROUP BY d ORDER BY c DESC LIMIT 15
  `).all(VENUE_ID, ...allIds, startTs, now, dwellMs);
  const distinct = db.prepare(`
    SELECT COUNT(DISTINCT duration_ms) AS n, COUNT(*) AS total FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ? AND duration_ms >= ?
  `).get(VENUE_ID, ...allIds, startTs, now, dwellMs);
  console.log(`\nquantisation: ${distinct.n} distinct duration values across ${distinct.total} stopped visits`);
  console.log('  most common:', modes.map(m => `${(m.d / 1000).toFixed(2)}s x${m.c}`).join('  '));
}

// The ceiling itself: how long a track survives at all, regardless of zone.
const life = db.prepare(`
  SELECT CAST((MAX(COALESCE(end_time, start_time)) - MIN(start_time)) / 1000 AS INTEGER) AS span
  FROM zone_visits
  WHERE venue_id = ? AND start_time >= ?
  GROUP BY track_key
`).all(VENUE_ID, now - 86400_000).map(r => r.span).sort((a, b) => a - b);
if (life.length) {
  console.log(`\n${'='.repeat(78)}\ntrack lifespan across the whole venue, last 24h (n=${life.length})`);
  console.log('  p50', quantile(life, 0.5), 's   p75', quantile(life, 0.75),
    's   p90', quantile(life, 0.9), 's   p99', quantile(life, 0.99), 's');
}
