#!/usr/bin/env node
/**
 * Esselunga Executive KPI consistency audit (7-day window).
 * Usage (from backend/): node ../scripts/esselunga_kpi_audit.mjs [dbPath] [venueId] [days]
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', 'backend');
const Database = require(join(backendRoot, 'node_modules', 'better-sqlite3'));
import { computeExecutiveJourney } from '../backend/services/executive/ExecutiveJourneyService.js';
import { INGRESS_VISIT_COUNT_SQL } from '../backend/lib/ingressFootfall.js';
import { isTrafficZoneName } from '../backend/lib/storeHours.js';
import { loadClassifiedRois } from '../backend/services/executive/ExecutiveZoneTaxonomy.js';

const dbPath = process.argv[2] || process.env.DB_PATH || '/data/db/hyperspace.db';
const venueId = process.argv[3] || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const DAYS = Number(process.argv[4] || 7);

const now = Date.now();
const start7d = now - DAYS * 86400000;

function q(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (e) {
    return { error: e.message };
  }
}

function q1(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch (e) {
    return { error: e.message };
  }
}

function fmtTs(ms) {
  return ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '—';
}

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (e) {
  console.error(`Cannot open DB: ${dbPath}\n${e.message}`);
  process.exit(1);
}

const venue = q1(db, 'SELECT id, name, max_capacity FROM venues WHERE id = ?', [venueId]);
if (!venue?.id) {
  console.error(`Venue not found: ${venueId}`);
  process.exit(1);
}

console.log('='.repeat(72));
console.log('ESSELUNGA KPI CONSISTENCY AUDIT');
console.log('='.repeat(72));
console.log(`Venue:  ${venue.name} (${venue.id})`);
console.log(`DB:     ${dbPath}`);
console.log(`Window: ${fmtTs(start7d)} → ${fmtTs(now)} (${DAYS}d)`);
console.log(`Expect: ~100 visitors/hour open hours → ~1,200/day for 12h store`);
console.log('');

// Data coverage
const zvRange = q1(db, `
  SELECT MIN(start_time) mn, MAX(start_time) mx, COUNT(*) rows
  FROM zone_visits WHERE venue_id = ?
`, [venueId]);
const zoRange = q1(db, `
  SELECT MIN(timestamp) mn, MAX(timestamp) mx, COUNT(*) rows
  FROM zone_occupancy WHERE venue_id = ?
`, [venueId]);

console.log('--- DATA COVERAGE ---');
console.log(`zone_visits:    ${zvRange?.rows ?? 0} rows, ${fmtTs(zvRange?.mn)} → ${fmtTs(zvRange?.mx)}`);
console.log(`zone_occupancy: ${zoRange?.rows ?? 0} rows, ${fmtTs(zoRange?.mn)} → ${fmtTs(zoRange?.mx)}`);

// Traffic / ingress ROIs
const allRois = q(db, 'SELECT id, name FROM regions_of_interest WHERE venue_id = ? ORDER BY name', [venueId]);
const trafficRois = allRois.filter(r => isTrafficZoneName(r.name));
let footfallRoiId = null;
try {
  footfallRoiId = q1(db, 'SELECT footfall_roi_id FROM venues WHERE id = ?', [venueId])?.footfall_roi_id;
} catch {
  // column may not exist on older DBs
}

console.log('');
console.log('--- INGRESS / ENTRANCE ZONES ---');
console.log(`Total ROIs: ${allRois.length}`);
console.log(`Traffic-pattern ROIs (entrance|traffic|ingress…): ${trafficRois.length}`);
if (footfallRoiId) console.log(`venues.footfall_roi_id: ${footfallRoiId}`);
for (const r of trafficRois) {
  const stats = q1(db, `
    SELECT ${INGRESS_VISIT_COUNT_SQL} as crossings,
           COUNT(DISTINCT track_key) as unique_tracks,
           ROUND(SUM(duration_ms)/60000.0, 2) as total_dwell_min
    FROM zone_visits
    WHERE roi_id = ? AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
  `, [r.id, start7d, now]);
  console.log(`  • ${r.name}`);
  console.log(`      7d crossings: ${stats?.crossings ?? 0}, unique tracks: ${stats?.unique_tracks ?? 0}, dwell min: ${stats?.total_dwell_min ?? 0}`);
}

const trafficIds = [...new Set([
  ...(footfallRoiId ? [footfallRoiId] : []),
  ...trafficRois.map(r => r.id),
])];

// Daily ingress
console.log('');
console.log('--- DAILY INGRESS (crossings vs unique) ---');
if (trafficIds.length === 0) {
  console.log('  ⚠ NO ingress/traffic ROIs detected — visitor count will be wrong');
} else {
  const ph = trafficIds.map(() => '?').join(',');
  const daily = q(db, `
    SELECT date(start_time/1000, 'unixepoch', 'localtime') as day,
           ${INGRESS_VISIT_COUNT_SQL} as crossings,
           COUNT(DISTINCT track_key) as unique_tracks
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
    GROUP BY day ORDER BY day
  `, [venueId, ...trafficIds, start7d, now]);
  let totalCross = 0;
  let totalUnique = 0;
  for (const d of daily) {
    const hrs = 12; // assume open hours
    const perHr = Math.round((d.crossings / hrs) * 10) / 10;
    const flag = perHr < 50 ? '⚠ LOW' : perHr > 200 ? '⚠ HIGH' : 'ok';
    console.log(`  ${d.day}: ${d.crossings} crossings, ${d.unique_tracks} unique (~${perHr}/hr ${flag})`);
    totalCross += d.crossings;
    totalUnique += d.unique_tracks;
  }
  const openDays = daily.length || 1;
  console.log(`  TOTAL: ${totalCross} crossings, ${totalUnique} unique-sum (days=${openDays})`);
  console.log(`  Avg/day: ${Math.round(totalCross / openDays)} crossings, target ~1200/day @100/hr`);
}

// Hourly ingress (last 3 days with data)
console.log('');
console.log('--- HOURLY INGRESS (open hours 8-19, last 3 days with data) ---');
if (trafficIds.length > 0) {
  const ph = trafficIds.map(() => '?').join(',');
  const hourly = q(db, `
    SELECT date(start_time/1000, 'unixepoch', 'localtime') as day,
           CAST(strftime('%H', datetime(start_time/1000, 'unixepoch', 'localtime')) AS INT) as hr,
           ${INGRESS_VISIT_COUNT_SQL} as crossings
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
    GROUP BY day, hr
    HAVING hr BETWEEN 8 AND 19
    ORDER BY day DESC, hr
    LIMIT 48
  `, [venueId, ...trafficIds, start7d, now]);
  for (const h of hourly.reverse()) {
    const flag = h.crossings < 30 ? '⚠' : h.crossings > 250 ? '⚠' : ' ';
    console.log(`  ${flag} ${h.day} ${String(h.hr).padStart(2, '0')}:00 → ${h.crossings} crossings`);
  }
}

// Executive journey snapshot (7d + 24h)
console.log('');
console.log('--- EXECUTIVE JOURNEY KPIs (7d) ---');
const journey7d = computeExecutiveJourney(db, venueId, start7d, now, 'live');
const start24h = now - 86400000;
const journey24h = computeExecutiveJourney(db, venueId, start24h, now, 'live');

function printJourney(j, label) {
  const o = j.overview;
  const a = j.aisles;
  const c = j.checkout;
  console.log(`\n[${label}]`);
  console.log(`  Visitors (unique ingress): ${o.totalVisitors}  | crossings: ${o.ingressEpisodes}  | unique: ${o.ingressUnique}`);
  console.log(`  Avg store dwell: ${o.avgStoreDwellMin}m  | live occupancy: ${o.currentOccupancy}`);
  console.log(`  Aisle visits: ${a.totalAisleVisits}  | penetration: ${a.penetrationPct}%  | stopping: ${a.stoppingPowerPct}%`);
  console.log(`  Checkout sessions: ${c.channels.reduce((s, ch) => s + ch.sessions, 0)}  | avg wait: ${c.avgWaitMin}m  | friction: ${c.frictionScore}`);
  console.log(`  Taxonomy: ${j.taxonomy.fresco} fresco, ${j.taxonomy.aisles} aisles, ${j.taxonomy.checkout} checkout, ${j.taxonomy.ingress} ingress`);
  console.log(`  ERP: ${j.erp.hasData ? 'yes' : 'no'}  | SPI: ${o.spi ?? '—'}  | Avg ticket: ${o.avgTicket ?? '—'}`);
}

printJourney(journey7d, '7 days');
printJourney(journey24h, '24 hours');

// Consistency checks
console.log('');
console.log('--- CONSISTENCY CHECKS ---');
const checks = [];

const visitors7d = journey7d.overview.totalVisitors;
const visitors24h = journey24h.overview.totalVisitors;
const aisleVisits7d = journey7d.aisles.totalAisleVisits;
const checkout7d = journey7d.checkout.channels.reduce((s, c) => s + c.sessions, 0);
const dwell7d = journey7d.overview.avgStoreDwellMin;

if (trafficIds.length === 0) {
  checks.push({ severity: 'CRITICAL', msg: 'No ingress/traffic ROI configured — Store Visitors KPI unreliable' });
}
if (visitors24h < 200) {
  checks.push({ severity: 'WARN', msg: `24h visitors=${visitors24h} — far below ~1200/day expected @100/hr` });
}
if (dwell7d < 5) {
  checks.push({ severity: 'CRITICAL', msg: `Avg store dwell=${dwell7d}m — grocery should be 15-30m; likely summing per-zone fragments not full visit` });
}
if (journey7d.aisles.penetrationPct >= 99 && visitors7d > 0) {
  checks.push({ severity: 'WARN', msg: `Penetration=${journey7d.aisles.penetrationPct}% — suspiciously perfect; aisle unique visitors may equal ingress unique due to track fragmentation` });
}
if (aisleVisits7d > visitors7d * 50) {
  checks.push({ severity: 'INFO', msg: `Aisle visits (${aisleVisits7d}) >> visitors (${visitors7d}) — ratio ${Math.round(aisleVisits7d / visitors7d)}x; expected for zone visits but breaks funnel charts` });
}
if (checkout7d > visitors7d * 1.1) {
  checks.push({ severity: 'WARN', msg: `Checkout sessions (${checkout7d}) > visitors (${visitors7d}) — queue sessions may count re-queues or multi-lane duplicates` });
}
if (journey7d.taxonomy.fresco === 0) {
  checks.push({ severity: 'WARN', msg: '0 fresco/banco zones — Piazza del Fresco tab will be empty' });
}
if (!journey7d.erp.hasData) {
  checks.push({ severity: 'INFO', msg: 'No ERP CSV — SPI and Avg Ticket will show —' });
}
if (journey7d.checkout.channels.length === 1) {
  checks.push({ severity: 'INFO', msg: `Single checkout channel (${journey7d.checkout.channels[0]?.label}) — channel comparison chart meaningless` });
}

// Dwell calculation deep dive
const dwellBreakdown = q1(db, `
  SELECT COUNT(DISTINCT track_key) as visitors,
         COUNT(*) as episodes,
         ROUND(SUM(duration_ms)/60000.0, 1) as total_dwell_min,
         ROUND(AVG(duration_ms)/60000.0, 3) as avg_episode_min
  FROM zone_visits
  WHERE venue_id = ? AND start_time >= ? AND start_time < ?
    AND track_key NOT LIKE '%cashier%'
`, [venueId, start7d, now]);

console.log('Dwell math (all zones, 7d):');
console.log(`  distinct tracks: ${dwellBreakdown?.visitors}`);
console.log(`  zone episodes: ${dwellBreakdown?.episodes}`);
console.log(`  total dwell min (sum all episodes): ${dwellBreakdown?.total_dwell_min}`);
console.log(`  avg episode min: ${dwellBreakdown?.avg_episode_min}`);
console.log(`  dashboard avgStoreDwellMin: ${dwell7d} (= total_dwell / distinct_tracks)`);

const ingressDwell = trafficIds.length ? q1(db, `
  SELECT ROUND(AVG(duration_ms)/1000.0, 1) as avg_sec, COUNT(*) as n
  FROM zone_visits WHERE roi_id IN (${trafficIds.map(() => '?').join(',')})
    AND start_time >= ? AND start_time < ?
`, [...trafficIds, start7d, now]) : null;
if (ingressDwell) {
  console.log(`  avg dwell IN entrance zone only: ${ingressDwell.avg_sec}s (${ingressDwell.n} episodes)`);
}

for (const c of checks) {
  console.log(`  [${c.severity}] ${c.msg}`);
}

// Classified ROI summary
const classified = loadClassifiedRois(db, venueId);
const byGroup = {};
for (const r of classified) {
  const g = r.classification?.group || 'unknown';
  byGroup[g] = (byGroup[g] || 0) + 1;
}
console.log('');
console.log('--- ROI CLASSIFICATION ---');
console.log(byGroup);

console.log('');
console.log('--- TOP CATEGORIES (7d) ---');
for (const g of (journey7d.aisles.categoryGroups || []).slice(0, 8)) {
  console.log(`  ${g.category}: ${g.visits} visits, ${g.stoppingPowerPct}% stop, ${g.avgDwellMin}m dwell`);
}

db.close();
console.log('');
console.log('Done.');
