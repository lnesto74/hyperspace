/**
 * Weekly track-continuity report for Treviglio.
 *
 * The reconciler sat disabled for weeks after the July outage and nobody
 * noticed, because the dashboards looked plausible either way — dwell just
 * quietly collapsed to roughly vendor-raw quality. The health check now catches
 * the flag being off; this catches the subtler case where it is on and the
 * numbers still drift.
 *
 * It is also the standing evidence record for the vendor dispute: the same
 * metrics, computed the same way, every week, rather than reconstructed under
 * argument.
 *
 * Usage: node weekly-continuity-report.cjs [--weeks 8] [--venue ID]
 */
const path = require('path');

function loadSqlite() {
  // The script runs inside the backend container, where the module lives next
  // to the app rather than on the default resolution path.
  for (const base of ['better-sqlite3', '/app/node_modules/better-sqlite3']) {
    try { return require(base); } catch { /* try next */ }
  }
  throw new Error('better-sqlite3 not found');
}

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const WEEKS = Number(argVal('--weeks', 8));
const VENUE = argVal('--venue', '55fdd53b-3298-4355-97c0-b4e789b11d06');
const DB_PATH = argVal('--db', '/data/db/hyperspace.db');
// Treviglio is CEST; the store's trading day must not be split by a UTC
// boundary or the per-day averages are wrong at both ends of the week.
const TZ_OFFSET_H = Number(argVal('--tz-offset', 2));
const DWELL_USABLE_MS = 60_000;

const Database = loadSqlite();
const db = new Database(DB_PATH, { readonly: true });

const localDayExpr = (col) => `date(${col}/1000 + ${TZ_OFFSET_H * 3600}, 'unixepoch')`;

const rows = db.prepare(`
  SELECT
    strftime('%Y-W%W', ${localDayExpr('start_time')})        AS week,
    MIN(${localDayExpr('start_time')})                        AS first_day,
    COUNT(DISTINCT ${localDayExpr('start_time')})             AS days,
    COUNT(DISTINCT track_key)                                 AS identities,
    COUNT(*)                                                  AS visits,
    AVG(duration_ms)                                          AS mean_ms,
    SUM(CASE WHEN duration_ms >= ? THEN 1 ELSE 0 END)         AS usable,
    SUM(CASE WHEN is_complete_track = 1 THEN 1 ELSE 0 END)    AS complete
  FROM zone_visits
  WHERE venue_id = ?
    AND start_time >= ?
  GROUP BY week
  ORDER BY week
`).all(DWELL_USABLE_MS, VENUE, Date.now() - WEEKS * 7 * 24 * 3600 * 1000);

// Median needs its own pass; SQLite has no percentile function.
const medianStmt = db.prepare(`
  SELECT duration_ms FROM zone_visits
  WHERE venue_id = ? AND strftime('%Y-W%W', ${localDayExpr('start_time')}) = ?
  ORDER BY duration_ms
  LIMIT 1 OFFSET (
    SELECT COUNT(*)/2 FROM zone_visits
    WHERE venue_id = ? AND strftime('%Y-W%W', ${localDayExpr('start_time')}) = ?
  )
`);

const out = [];
out.push(`Hyperspace weekly continuity — Treviglio`);
out.push(`generated ${new Date().toISOString()}  (last ${WEEKS} weeks, local day boundaries UTC+${TZ_OFFSET_H})`);
out.push('');
out.push('week      days  ids/day  visits/day  mean dwell  median  usable>60s  complete tracks');
out.push('───────── ────  ───────  ──────────  ──────────  ──────  ──────────  ───────────────');

for (const r of rows) {
  const med = medianStmt.get(VENUE, r.week, VENUE, r.week)?.duration_ms ?? 0;
  const idsPerDay = r.identities / Math.max(r.days, 1);
  const visitsPerDay = r.visits / Math.max(r.days, 1);
  const usablePct = (r.usable / Math.max(r.visits, 1)) * 100;
  const completePct = (r.complete / Math.max(r.visits, 1)) * 100;
  out.push(
    `${r.week.padEnd(9)} ${String(r.days).padStart(4)}  ` +
    `${Math.round(idsPerDay).toLocaleString().padStart(7)}  ` +
    `${Math.round(visitsPerDay).toLocaleString().padStart(10)}  ` +
    `${(r.mean_ms / 1000).toFixed(1).padStart(9)}s  ` +
    `${(med / 1000).toFixed(1).padStart(5)}s  ` +
    `${usablePct.toFixed(1).padStart(9)}%  ` +
    `${completePct.toFixed(1).padStart(14)}%`,
  );
}

// Reconciler state, read from the venue config the live service actually uses.
let reconLine = 'reconciler: unknown';
try {
  const venue = db.prepare('SELECT dwg_transform_json FROM venues WHERE id = ?').get(VENUE);
  const cfg = JSON.parse(venue?.dwg_transform_json || '{}').reconciler;
  reconLine = cfg
    ? `reconciler: ${cfg.enabled ? 'ENABLED' : '*** DISABLED ***'} (preset ${cfg.preset_id || 'custom'}, ` +
      `gap ${cfg.reid_max_gap_s}s, dist ${cfg.reid_max_distance_m}m, alpha ${cfg.smoothing_alpha})`
    : 'reconciler: no config saved — running factory defaults';
} catch (err) {
  reconLine = `reconciler: could not read config (${err.message})`;
}

out.push('');
out.push(reconLine);

if (rows.length >= 2) {
  const a = rows[rows.length - 2];
  const b = rows[rows.length - 1];
  const delta = (x, y) => (y === 0 ? '—' : `${(((x - y) / y) * 100).toFixed(1)}%`);
  out.push('');
  out.push(`week over week (${a.week} → ${b.week}):`);
  out.push(`  mean dwell   ${(a.mean_ms / 1000).toFixed(1)}s → ${(b.mean_ms / 1000).toFixed(1)}s  (${delta(b.mean_ms, a.mean_ms)})`);
  out.push(`  identities   ${Math.round(a.identities / Math.max(a.days, 1))}/day → ${Math.round(b.identities / Math.max(b.days, 1))}/day  (${delta(b.identities / Math.max(b.days, 1), a.identities / Math.max(a.days, 1))})`);
  out.push(`  usable>60s   ${((a.usable / Math.max(a.visits, 1)) * 100).toFixed(1)}% → ${((b.usable / Math.max(b.visits, 1)) * 100).toFixed(1)}%`);
}

out.push('');
out.push('A collapse in mean dwell alongside a jump in identities per day is the');
out.push('signature of the reconciler being off or mis-gated, not of a quiet week.');

console.log(out.join('\n'));
db.close();
