/**
 * Read-only production KPI audit — no ERP table writes.
 * Run: docker exec hyperspace-backend-1 node /tmp/esselunga_production_audit.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const VID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const DB = process.env.DB_PATH || '/data/db/hyperspace.db';
const DAYS = Number(process.env.DAYS || 7);
const OPEN_HOURS = Number(process.env.OPEN_HOURS || 13); // 08-21

const db = new Database(DB, { readonly: true });
const NOW = Date.now();
const START7 = NOW - DAYS * 86400000;
const START24 = NOW - 86400000;

const q = (sql, p = []) => db.prepare(sql).all(...p);
const q1 = (sql, p = []) => db.prepare(sql).get(...p);

console.log('='.repeat(72));
console.log('TREVIGLIO PRODUCTION KPI AUDIT');
console.log('='.repeat(72));
console.log(`Venue: ${VID}`);
console.log(`Window: ${new Date(START7).toISOString().slice(0, 10)} → ${new Date(NOW).toISOString().slice(0, 10)} (${DAYS}d)`);
console.log(`Benchmark: ~100 visitors/hr × ${OPEN_HOURS}h open = ~${100 * OPEN_HOURS}/day`);
console.log('');

const venue = q1('SELECT id, name, max_capacity FROM venues WHERE id = ?', [VID]);
console.log('Venue:', venue);

const zvRange = q1(
  'SELECT COUNT(*) c, MIN(start_time) mn, MAX(start_time) mx FROM zone_visits WHERE venue_id = ?',
  [VID],
);
console.log(`Data: ${zvRange.c} zone_visits, ${new Date(zvRange.mn).toISOString()} → ${new Date(zvRange.mx).toISOString()}`);

const traffic = q(
  `SELECT id, name FROM regions_of_interest WHERE venue_id = ?
   AND (name LIKE '%1121%' OR name LIKE '%Antenna%Ingresso%' OR name LIKE '%Traffic%'
        OR name LIKE '%Entrance%' OR name LIKE '%Ingress%' OR name LIKE '%ingress%')
   ORDER BY name`,
  [VID],
);
console.log('\n--- TRAFFIC / ENTRANCE ROIs ---');
traffic.forEach(r => console.log(`  • ${r.name} (${r.id.slice(0, 8)}…)`));

const e1121 = traffic.filter(r => /1121|Antenna.*Ingresso/i.test(r.name));
const e1121ids = e1121.map(r => r.id);
const allTrafficIds = traffic.map(r => r.id);

function ingressBlock(roiIds, label, start) {
  if (!roiIds.length) {
    console.log(`\n[${label}] — no ROIs`);
    return null;
  }
  const ph = roiIds.map(() => '?').join(',');
  const tot = q1(
    `SELECT COUNT(*) crossings, COUNT(DISTINCT track_key) uniq
     FROM zone_visits WHERE venue_id = ? AND roi_id IN (${ph})
       AND start_time >= ? AND start_time < ?
       AND track_key NOT LIKE '%cashier%'`,
    [VID, ...roiIds, start, NOW],
  );
  console.log(`\n[${label}] crossings=${tot.crossings} unique=${tot.uniq}`);
  if (start === START7) {
    const daily = q(
      `SELECT date(start_time/1000, 'unixepoch', 'localtime') d,
              COUNT(*) crossings, COUNT(DISTINCT track_key) uniq
       FROM zone_visits WHERE venue_id = ? AND roi_id IN (${ph})
         AND start_time >= ? AND start_time < ?
         AND track_key NOT LIKE '%cashier%'
       GROUP BY d ORDER BY d`,
      [VID, ...roiIds, START7, NOW],
    );
    for (const d of daily) {
      const perHr = (d.crossings / OPEN_HOURS).toFixed(1);
      const flag = d.crossings / OPEN_HOURS < 50 ? '⚠ LOW' : d.crossings / OPEN_HOURS > 200 ? '⚠ HIGH' : 'ok';
      console.log(`  ${d.d}: ${d.crossings} xing, ${d.uniq} uniq, ~${perHr}/hr ${flag}`);
    }
  }
  return tot;
}

ingressBlock(e1121ids, 'Entrance 1121 / Antenna (canonical)', START7);
ingressBlock(allTrafficIds, 'All traffic-pattern ROIs (current API)', START7);
ingressBlock(e1121ids, 'Entrance 1121 — last 24h', START24);

// Hourly profile (7d aggregate by hour-of-day)
if (e1121ids.length) {
  const ph = e1121ids.map(() => '?').join(',');
  const hourly = q(
    `SELECT CAST(strftime('%H', datetime(start_time/1000, 'unixepoch', 'localtime')) AS INT) hr,
            COUNT(*) c
     FROM zone_visits WHERE venue_id = ? AND roi_id IN (${ph})
       AND start_time >= ? AND start_time < ?
       AND track_key NOT LIKE '%cashier%'
     GROUP BY hr ORDER BY hr`,
    [VID, ...e1121ids, START7, NOW],
  );
  console.log('\n--- HOURLY PROFILE (7d sum by hour-of-day, Entrance 1121) ---');
  for (const h of hourly) {
    if (h.hr >= 8 && h.hr <= 20) {
      const avgPerDay = (h.c / DAYS).toFixed(0);
      console.log(`  ${String(h.hr).padStart(2, '0')}:00 → ${h.c} total (${avgPerDay}/day avg)`);
    }
  }
}

// Dwell
const dwell = q1(
  `SELECT COUNT(DISTINCT track_key) uniq, COUNT(*) eps, SUM(duration_ms) tot_ms, AVG(duration_ms) avg_ms
   FROM zone_visits WHERE venue_id = ? AND start_time >= ? AND start_time < ?
     AND track_key NOT LIKE '%cashier%'`,
  [VID, START7, NOW],
);
console.log('\n--- DWELL (all zones, 7d) ---');
console.log(`  unique tracks: ${dwell.uniq}`);
console.log(`  zone episodes: ${dwell.eps}`);
console.log(`  dashboard avgStoreDwellMin: ${(dwell.tot_ms / 60000 / dwell.uniq).toFixed(2)} min`);
console.log(`  avg episode duration: ${(dwell.avg_ms / 1000).toFixed(2)} sec`);
console.log(`  expected grocery visit: 15–30 min`);

if (e1121ids.length) {
  const ph = e1121ids.map(() => '?').join(',');
  const entDwell = q1(
    `SELECT COUNT(*) n, AVG(duration_ms) avg_ms, MAX(duration_ms) max_ms
     FROM zone_visits WHERE venue_id = ? AND roi_id IN (${ph})
       AND start_time >= ? AND start_time < ?`,
    [VID, ...e1121ids, START7, NOW],
  );
  console.log(`  entrance zone avg episode: ${(entDwell.avg_ms / 1000).toFixed(2)} sec (${entDwell.n} episodes)`);
}

// Aisle + checkout
const aisle = q1(
  `SELECT COUNT(*) visits, COUNT(DISTINCT track_key) uniq,
          SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END) dwell_eps
   FROM zone_visits zv JOIN regions_of_interest r ON r.id = zv.roi_id
   WHERE zv.venue_id = ? AND (r.name LIKE '%Engagement%' OR r.name LIKE '%Shelf%' OR r.name LIKE '%Scaffale%')
     AND zv.start_time >= ? AND zv.start_time < ? AND track_key NOT LIKE '%cashier%'`,
  [VID, START7, NOW],
);
const checkout = q1(
  `SELECT COUNT(*) sessions,
          ROUND(AVG(CASE WHEN is_abandoned = 0 THEN waiting_time_ms END) / 60000.0, 2) avg_wait
   FROM queue_sessions qs JOIN regions_of_interest r ON r.id = qs.queue_zone_id
   WHERE r.venue_id = ? AND qs.queue_entry_time >= ? AND qs.queue_entry_time < ?
     AND qs.waiting_time_ms >= 5000`,
  [VID, START7, NOW],
);
const ingUniq = e1121ids.length
  ? q1(
    `SELECT COUNT(DISTINCT track_key) u FROM zone_visits
     WHERE venue_id = ? AND roi_id IN (${e1121ids.map(() => '?').join(',')})
       AND start_time >= ? AND start_time < ? AND track_key NOT LIKE '%cashier%'`,
    [VID, ...e1121ids, START7, NOW],
  ).u
  : 0;

console.log('\n--- CONSISTENCY (7d, Entrance 1121 as denominator) ---');
console.log(`  ingress unique:        ${ingUniq}`);
console.log(`  aisle zone visits:     ${aisle.visits} (${ingUniq ? (aisle.visits / ingUniq).toFixed(0) : '?'}x per visitor)`);
console.log(`  aisle unique tracks:   ${aisle.uniq} → penetration ${ingUniq ? Math.min(100, (aisle.uniq / ingUniq) * 100).toFixed(1) : '?'}%`);
console.log(`  stopping power:        ${aisle.visits ? ((aisle.dwell_eps / aisle.visits) * 100).toFixed(1) : 0}%`);
console.log(`  checkout sessions:     ${checkout.sessions} (${ingUniq ? ((checkout.sessions / ingUniq) * 100).toFixed(0) : '?'}% of ingress)`);
console.log(`  avg checkout wait:     ${checkout.avg_wait} min`);
const avgDwellMin = dwell.tot_ms / 60000 / dwell.uniq;
const friction = checkout.avg_wait && avgDwellMin ? (checkout.avg_wait / avgDwellMin).toFixed(1) : '?';
console.log(`  friction (wait/dwell): ${friction} (inflated if dwell too low)`);

// Fresco / banco
console.log('\n--- FRESCO / BANCO ROIs ---');
const banco = q(
  `SELECT r.name,
          json_extract(r.metadata_json, '$.business_category_label') cat_label,
          json_extract(r.metadata_json, '$.business_category') cat,
          json_extract(r.metadata_json, '$.template') template,
          COUNT(zv.rowid) visits
   FROM regions_of_interest r
   LEFT JOIN zone_visits zv ON zv.roi_id = r.id AND zv.start_time >= ?
   WHERE r.venue_id = ?
     AND (r.name LIKE '%banco%' OR r.name LIKE '%Banco%' OR r.name LIKE '%muretto%'
          OR r.name LIKE '%Pesce%' OR r.name LIKE '%Pane%' OR r.name LIKE '%Salumi%')
   GROUP BY r.id ORDER BY visits DESC LIMIT 20`,
  [START7, VID],
);
if (!banco.length) console.log('  (none found by name pattern)');
banco.forEach(b => console.log(`  ${b.name} | cat=${b.cat_label || b.cat || '—'} | visits=${b.visits}`));

// Checkout lanes
console.log('\n--- CHECKOUT LANES (7d sessions) ---');
const lanes = q(
  `SELECT r.name, COUNT(*) sessions,
          ROUND(AVG(CASE WHEN qs.is_abandoned = 0 THEN qs.waiting_time_ms END) / 60000.0, 2) wait_min
   FROM queue_sessions qs JOIN regions_of_interest r ON r.id = qs.queue_zone_id
   WHERE r.venue_id = ? AND qs.queue_entry_time >= ? AND qs.queue_entry_time < ?
     AND qs.waiting_time_ms >= 5000
   GROUP BY r.id ORDER BY sessions DESC LIMIT 12`,
  [VID, START7, NOW],
);
lanes.forEach(l => console.log(`  ${l.name}: ${l.sessions} sessions, wait ${l.wait_min}m`));

// Categories
console.log('\n--- TOP CATEGORIES (7d) ---');
const cats = q(
  `SELECT COALESCE(json_extract(r.metadata_json, '$.business_category_label'),
                 json_extract(r.metadata_json, '$.business_category'), 'Uncategorized') cat,
          COUNT(*) v,
          ROUND(AVG(zv.duration_ms) / 1000.0, 2) avg_sec,
          ROUND(SUM(CASE WHEN zv.is_dwell = 1 THEN 1.0 ELSE 0 END) * 100.0 / COUNT(*), 1) stop_pct
   FROM zone_visits zv JOIN regions_of_interest r ON r.id = zv.roi_id
   WHERE zv.venue_id = ? AND (r.name LIKE '%Engagement%' OR r.name LIKE '%Shelf%')
     AND zv.start_time >= ? AND zv.start_time < ?
   GROUP BY cat ORDER BY v DESC LIMIT 12`,
  [VID, START7, NOW],
);
cats.forEach(c => console.log(`  ${c.cat}: ${c.v} visits, stop ${c.stop_pct}%, avg ${c.avg_sec}s/episode`));

// Live
const ts = q1('SELECT MAX(timestamp) ts FROM zone_occupancy WHERE venue_id = ?', [VID])?.ts;
const live = q1(
  `SELECT SUM(zo.occupancy_count) t FROM zone_occupancy zo
   JOIN regions_of_interest r ON r.id = zo.roi_id
   WHERE zo.venue_id = ? AND zo.timestamp = ?
     AND r.name NOT LIKE '%Queue%' AND r.name NOT LIKE '%Checkout%'`,
  [VID, ts],
);
console.log(`\n--- LIVE ---`);
console.log(`  shoppers in store (excl queue): ${live?.t ?? 0} at ${new Date(ts).toISOString()}`);

// Checks
console.log('\n--- FLAGS ---');
const flags = [];
if (!e1121ids.length) flags.push('CRITICAL: No Entrance 1121 ROI found');
if (allTrafficIds.length > e1121ids.length) {
  flags.push(`WARN: ${allTrafficIds.length - e1121ids.length} extra traffic ROIs included in current API beyond Entrance 1121`);
}
const lastDay = q1(
  e1121ids.length
    ? `SELECT COUNT(*) c FROM zone_visits WHERE venue_id=? AND roi_id IN (${e1121ids.map(() => '?').join(',')})
       AND start_time >= ? AND start_time < ? AND track_key NOT LIKE '%cashier%'`
    : 'SELECT 0 c',
  e1121ids.length ? [VID, ...e1121ids, START24, NOW] : [],
);
if (lastDay?.c && lastDay.c / OPEN_HOURS < 50) {
  flags.push(`WARN: 24h ingress ${lastDay.c} (~${(lastDay.c / OPEN_HOURS).toFixed(0)}/hr) — below 100/hr benchmark`);
}
if (avgDwellMin < 5) flags.push(`CRITICAL: avg dwell ${avgDwellMin.toFixed(2)}m — not credible for grocery (fix dwell aggregation)`);
if (aisle.visits > ingUniq * 30) flags.push(`INFO: aisle visits ${aisle.visits} >> ingress ${ingUniq} — funnel charts will break if using raw counts`);
if (!banco.filter(b => b.visits > 0).length) flags.push('WARN: no banco ROI visits — Piazza del Fresco empty/wrong mapping');
if (lanes.length === 1) flags.push(`INFO: single checkout lane type — channel chart meaningless`);
flags.forEach(f => console.log(`  [${f.split(':')[0]}] ${f}`));

// Extra: data gaps + category tagging + occupancy
console.log('\n--- DATA GAPS (days with zone_visits) ---');
const days = q(
  `SELECT date(start_time/1000, 'unixepoch', 'localtime') d, COUNT(*) n
   FROM zone_visits WHERE venue_id = ? AND start_time >= ?
   GROUP BY d ORDER BY d`,
  [VID, START7],
);
days.forEach(d => console.log(`  ${d.d}: ${d.n.toLocaleString()} episodes`));

const catCount = q1(
  `SELECT COUNT(*) total,
          SUM(CASE WHEN json_extract(metadata_json, '$.business_category_label') IS NOT NULL
                    OR json_extract(metadata_json, '$.business_category') IS NOT NULL THEN 1 ELSE 0 END) tagged
   FROM regions_of_interest WHERE venue_id = ? AND name LIKE '%Engagement%'`,
  [VID],
);
console.log(`\n--- CATEGORY TAGGING ---`);
console.log(`  Engagement ROIs: ${catCount.total} total, ${catCount.tagged} with category label (${catCount.total ? ((catCount.tagged / catCount.total) * 100).toFixed(0) : 0}%)`);

const occDaily = q(
  `SELECT date(ts/1000, 'unixepoch', 'localtime') d, MAX(store_total) peak, ROUND(AVG(store_total), 1) avg
   FROM (
     SELECT zo.timestamp ts, SUM(zo.occupancy_count) store_total
     FROM zone_occupancy zo JOIN regions_of_interest r ON r.id = zo.roi_id
     WHERE zo.venue_id = ? AND zo.timestamp >= ?
       AND r.name NOT LIKE '%Queue%' AND r.name NOT LIKE '%Checkout%'
     GROUP BY zo.timestamp
   ) GROUP BY d ORDER BY d`,
  [VID, START7],
);
console.log('\n--- DAILY PEAK IN-STORE (excl queue) ---');
occDaily.forEach(o => console.log(`  ${o.d}: peak ${o.peak}, avg ${o.avg}`));

db.close();
console.log('\nDone.');
