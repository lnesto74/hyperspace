/**
 * Attributes an Esselunga Executive request to individual SQL statements by
 * wrapping db.prepare, so we can see which queries dominate instead of guessing.
 *
 * Usage: node exec_journey_profile.mjs <rangeLabel> [venueId]
 */

import Database from 'better-sqlite3';
import { computeExecutiveJourney } from '../services/executive/ExecutiveJourneyService.js';

const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const RANGES = { '1h': 3600000, '24h': 24 * 3600000, '7d': 7 * 24 * 3600000, '30d': 30 * 24 * 3600000 };

const label = process.argv[2] || '1h';
const spanMs = RANGES[label];
if (!spanMs) {
  console.error(`Unknown range "${label}". Use one of: ${Object.keys(RANGES).join(', ')}`);
  process.exit(1);
}

const raw = new Database(DB_PATH);
raw.pragma('busy_timeout = 20000');

const stats = new Map();
function record(key, ms, rows) {
  const e = stats.get(key) || { calls: 0, ms: 0, rows: 0 };
  e.calls += 1;
  e.ms += ms;
  e.rows += rows;
  stats.set(key, e);
}

const nativePrepare = raw.prepare.bind(raw);
const db = new Proxy(raw, {
  get(target, prop) {
    if (prop !== 'prepare') {
      const v = target[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    }
    return (sql) => {
      const stmt = nativePrepare(sql);
      const key = sql.replace(/\s+/g, ' ').trim();
      const timed = (method) => (...args) => {
        const t0 = process.hrtime.bigint();
        let out;
        try {
          out = stmt[method](...args);
          return out;
        } finally {
          const ms = Number(process.hrtime.bigint() - t0) / 1e6;
          record(key, ms, Array.isArray(out) ? out.length : (out ? 1 : 0));
        }
      };
      return {
        all: timed('all'),
        get: timed('get'),
        run: timed('run'),
        iterate: (...a) => stmt.iterate(...a),
        pluck: (...a) => stmt.pluck(...a),
        raw: (...a) => stmt.raw(...a),
        columns: () => stmt.columns(),
      };
    };
  },
});

const venueId = process.argv[3] || raw.prepare(`
  SELECT venue_id AS id, COUNT(*) n FROM zone_visits
  WHERE start_time >= ? GROUP BY venue_id ORDER BY n DESC LIMIT 1
`).get(Date.now() - 30 * 24 * 3600000)?.id;

const endTs = Date.now();
const startTs = endTs - spanMs;

console.log(`range=${label}  venue=${venueId}`);
const t0 = process.hrtime.bigint();
let payload;
let threw = null;
try {
  payload = computeExecutiveJourney(db, venueId, startTs, endTs, 'live');
} catch (err) {
  threw = err;
}
const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;

const ranked = [...stats.entries()].sort((a, b) => b[1].ms - a[1].ms);
const sqlMs = ranked.reduce((s, [, e]) => s + e.ms, 0);

console.log(`\ntotal=${totalMs.toFixed(0)}ms  sql=${sqlMs.toFixed(0)}ms  js=${(totalMs - sqlMs).toFixed(0)}ms`);
if (threw) console.log(`THREW: ${threw.message}`);
console.log(`\n${'ms'.padStart(8)} ${'calls'.padStart(6)} ${'rows'.padStart(9)}  sql`);
for (const [sql, e] of ranked.slice(0, 22)) {
  console.log(`${e.ms.toFixed(0).padStart(8)} ${String(e.calls).padStart(6)} ${String(e.rows).padStart(9)}  ${sql.slice(0, 150)}`);
}

if (payload) {
  const o = payload.overview || {};
  console.log(`\nentrants=${o.perimeterEntrants} sessions=${o.dwellSessionCount} dwellMin=${o.avgStoreDwellMin} reliable=${o.avgStoreDwellReliable}`);
}
raw.close();
