/** Index + size inventory for the tables the executive report touches. */

import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || '/data/db/hyperspace.db');
db.pragma('busy_timeout = 20000');

const TABLES = [
  'zone_visits', 'zone_occupancy', 'ingress_perimeter_crossings',
  'queue_sessions', 'dooh_campaign_kpis', 'zone_kpi_hourly',
];

for (const t of TABLES) {
  let count = 'n/a';
  try {
    count = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c.toLocaleString();
  } catch (e) {
    count = `ERR ${e.message}`;
  }
  console.log(`\n== ${t}  rows=${count}`);
  for (const i of db.prepare(
    `SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?`,
  ).all(t)) {
    console.log(`   ${i.sql || `(auto) ${i.name}`}`);
  }
}

const venueId = db.prepare(`
  SELECT venue_id id, COUNT(*) n FROM zone_visits
  WHERE start_time >= ? GROUP BY venue_id ORDER BY n DESC LIMIT 1
`).get(Date.now() - 30 * 86400000)?.id;

console.log(`\n== plans (venue=${venueId}) ==`);
const plans = [
  ['occupancy max (current)', 'SELECT MAX(timestamp) ts FROM zone_occupancy WHERE venue_id = ?', [venueId]],
  ['occupancy max (bounded)', 'SELECT MAX(timestamp) ts FROM zone_occupancy WHERE venue_id = ? AND timestamp >= ?', [venueId, Date.now() - 600000]],
];
for (const [label, sql, params] of plans) {
  for (const r of db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params)) {
    console.log(`   ${label}: ${r.detail}`);
  }
  const t0 = Date.now();
  const v = db.prepare(sql).get(...params);
  console.log(`   ${label}: -> ${JSON.stringify(v)} in ${Date.now() - t0}ms`);
}

console.log('\n== zone_visits range counts ==');
for (const [label, span] of [['1h', 3600000], ['24h', 86400000], ['7d', 7 * 86400000], ['30d', 30 * 86400000]]) {
  const t0 = Date.now();
  const c = db.prepare(
    'SELECT COUNT(*) c FROM zone_visits WHERE venue_id = ? AND start_time >= ?',
  ).get(venueId, Date.now() - span).c;
  console.log(`   ${label.padEnd(4)} ${String(c).padStart(9)} rows  (${Date.now() - t0}ms)`);
}

db.close();
