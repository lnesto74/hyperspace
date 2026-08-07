#!/usr/bin/env node
/**
 * Over a 7d or 30d window every fresco counter reports a median dwell of
 * exactly 15s, while over 24h they spread across 13-15s. A median landing on
 * the same round number for five independent departments is a property of the
 * measurement, not the shoppers, so this looks for when the measurement
 * changed.
 *
 * Per trading day: how many distinct duration values exist, what share sit on a
 * whole 5-second tick, and what that does to the median and the stopping rate.
 *
 * Usage (on the droplet):
 *   docker exec -w /app hyperspace-backend-1 node scripts/14_duration_regime_change.mjs
 *
 * Read-only.
 */
import Database from 'better-sqlite3';

const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const VENUE_ID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const DAYS = Number(process.env.DAYS || 45);
const TICK_MS = Number(process.env.TICK_MS || 5000);
const TOL_MS = Number(process.env.TOL_MS || 60);

const db = new Database(DB_PATH, { readonly: true });
const since = Date.now() - DAYS * 86400_000;

// A quantised feed puts almost every duration within a few ms of a 5s multiple.
// A free-running one scatters uniformly across the interval.
const rows = db.prepare(`
  SELECT date(start_time/1000, 'unixepoch') AS day,
         COUNT(*) AS visits,
         COUNT(DISTINCT duration_ms) AS distinctDurations,
         SUM(CASE WHEN duration_ms >= 1000
                   AND (duration_ms % ? <= ? OR duration_ms % ? >= ? - ?)
                  THEN 1 ELSE 0 END) AS onTick,
         SUM(CASE WHEN duration_ms >= 1000 THEN 1 ELSE 0 END) AS overOneSec,
         SUM(CASE WHEN duration_ms >= 5000 THEN 1 ELSE 0 END) AS stops,
         SUM(CASE WHEN is_complete_track = 0 THEN 1 ELSE 0 END) AS censored,
         MAX(duration_ms) AS maxMs
  FROM zone_visits
  WHERE venue_id = ? AND start_time >= ? AND duration_ms IS NOT NULL
  GROUP BY day ORDER BY day
`).all(TICK_MS, TOL_MS, TICK_MS, TICK_MS, TOL_MS, VENUE_ID, since);

const out = rows.map(r => ({
  day: r.day,
  visits: r.visits,
  distinctDurations: r.distinctDurations,
  valuesPerVisit: Math.round((r.distinctDurations / r.visits) * 1000) / 1000,
  onTickPct: r.overOneSec ? Math.round((r.onTick / r.overOneSec) * 1000) / 10 : null,
  stoppingPct: Math.round((r.stops / r.visits) * 1000) / 10,
  censoredPct: Math.round((r.censored / r.visits) * 1000) / 10,
  maxSec: Math.round(r.maxMs / 1000),
}));
console.log(`\nDaily duration regime — venue ${VENUE_ID}, tick ${TICK_MS}ms +/-${TOL_MS}ms\n`);
console.table(out);

// A single dip below a fixed threshold is noise; the regime change is the last
// day after which the feed never goes back to sitting on ticks.
const THRESH = 25;
const scored = out.filter(r => r.onTickPct != null);
let boundary = null;
for (let i = scored.length - 1; i >= 0; i -= 1) {
  if (scored[i].onTickPct > THRESH) { boundary = scored[i + 1]?.day ?? null; break; }
}
const quantised = scored.filter(r => !boundary || r.day < boundary);
const free = scored.filter(r => boundary && r.day >= boundary);
console.log(`days on the ${TICK_MS / 1000}s ruler (>${THRESH}% on tick): ${quantised.length}`
  + (quantised.length ? ` (${quantised[0].day} .. ${quantised[quantised.length - 1].day})` : ''));
console.log(`days free-running:                     ${free.length}`
  + (free.length ? ` (${free[0].day} .. ${free[free.length - 1].day})` : ''));
if (boundary) {
  console.log(`\napparent changeover: ${boundary}`);
  for (const [label, clause] of [
    ['before', `date(start_time/1000,'unixepoch') < '${boundary}'`],
    ['after', `date(start_time/1000,'unixepoch') >= '${boundary}'`],
  ]) {
    const modes = db.prepare(`
      SELECT duration_ms AS d, COUNT(*) AS c FROM zone_visits
      WHERE venue_id = ? AND start_time >= ? AND duration_ms >= 5000 AND ${clause}
      GROUP BY d ORDER BY c DESC LIMIT 8
    `).all(VENUE_ID, since);
    const tot = db.prepare(`
      SELECT COUNT(*) AS c FROM zone_visits
      WHERE venue_id = ? AND start_time >= ? AND duration_ms >= 5000 AND ${clause}
    `).get(VENUE_ID, since).c;
    console.log(`  ${label.padEnd(7)} n=${tot}  top values:`,
      modes.map(m => `${(m.d / 1000).toFixed(2)}s x${m.c}`).join('  '));
  }
}
