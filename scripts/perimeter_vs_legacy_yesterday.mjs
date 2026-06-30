#!/usr/bin/env node
import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH || '/data/db/hyperspace.db';
const vid = process.argv[2] || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const roiId = 'e95db8c1-a077-4e3c-962d-a4e08ed96272';

const db = new Database(dbPath, { readonly: true });

const firstPerim = db.prepare('SELECT MIN(crossed_at) AS t FROM ingress_perimeter_crossings WHERE venue_id=?').get(vid)?.t;
const lastPerim = db.prepare('SELECT MAX(crossed_at) AS t FROM ingress_perimeter_crossings WHERE venue_id=?').get(vid)?.t;

if (!firstPerim) {
  console.log('No perimeter crossings recorded yet.');
  process.exit(0);
}

const hoursLive = (lastPerim - firstPerim) / 3600000;

const pWindow = db.prepare(`
  SELECT COUNT(*) AS c, COUNT(DISTINCT track_key) AS u
  FROM ingress_perimeter_crossings
  WHERE venue_id=? AND crossed_at >= ? AND crossed_at <= ?
`).get(vid, firstPerim, lastPerim);

const lWindow = db.prepare(`
  SELECT COUNT(*) AS c, COUNT(DISTINCT track_key) AS u
  FROM zone_visits
  WHERE venue_id=? AND roi_id=? AND start_time >= ? AND start_time <= ?
    AND track_key NOT LIKE '%cashier%'
`).get(vid, roiId, firstPerim, lastPerim);

console.log('=== Since perimeter method went live (apples-to-apples window) ===');
console.log(`from: ${new Date(firstPerim).toISOString()}`);
console.log(`to:   ${new Date(lastPerim).toISOString()}`);
console.log(`hours live: ${hoursLive.toFixed(2)}h`);
console.log(`perimeter crossings: ${pWindow.c}  (unique trails: ${pWindow.u})`);
console.log(`legacy zone_visits:  ${lWindow.c}  (unique trails: ${lWindow.u})`);
console.log(`ratio perimeter/legacy: ${(pWindow.c / lWindow.c).toFixed(2)}x`);
console.log(`rate/hour — perimeter: ${(pWindow.c / hoursLive).toFixed(1)}  legacy: ${(lWindow.c / hoursLive).toFixed(1)}`);

// Jun 28 full calendar day (local) — legacy only
const j28 = db.prepare(`
  SELECT COUNT(*) AS c, COUNT(DISTINCT track_key) AS u
  FROM zone_visits
  WHERE venue_id=? AND roi_id=?
    AND date(start_time/1000,'unixepoch','localtime') = '2026-06-28'
    AND track_key NOT LIKE '%cashier%'
`).get(vid, roiId);

console.log('\n=== Jun 28 full day (legacy only — perimeter not deployed) ===');
console.log(`legacy zone_visits: ${j28.c}  (unique: ${j28.u})`);

// Extrapolate perimeter rate to full 12h store day for comparison
const storeHours = 12;
const extrapolatedPerimDay = (pWindow.c / hoursLive) * storeHours;
console.log(`\n=== Extrapolation (if perimeter ran full 12h store day at current rate) ===`);
console.log(`~${Math.round(extrapolatedPerimDay)} perimeter crossings vs Jun28 legacy ${j28.c}`);
console.log(`vs Jun28 ratio: ${(extrapolatedPerimDay / j28.c).toFixed(2)}x`);

// Jun 29 hourly where both exist
const hourlyP = db.prepare(`
  SELECT CAST(strftime('%H', crossed_at/1000.0,'unixepoch','localtime') AS INT) AS h, COUNT(*) AS p
  FROM ingress_perimeter_crossings WHERE venue_id=? GROUP BY h ORDER BY h
`).all(vid);
const hourlyL = db.prepare(`
  SELECT CAST(strftime('%H', start_time/1000.0,'unixepoch','localtime') AS INT) AS h, COUNT(*) AS l
  FROM zone_visits WHERE venue_id=? AND roi_id=? AND track_key NOT LIKE '%cashier%'
    AND date(start_time/1000,'unixepoch','localtime') = '2026-06-29'
  GROUP BY h ORDER BY h
`).all(vid, roiId);
const mapL = Object.fromEntries(hourlyL.map(r => [r.h, r.l]));

console.log('\n=== Jun 29 hourly (local) — hours with perimeter live ===');
for (const r of hourlyP) {
  const legacy = mapL[r.h] || 0;
  const ratio = legacy ? (r.p / legacy).toFixed(2) : 'n/a';
  console.log(`  ${String(r.h).padStart(2, '0')}:00  perimeter=${String(r.p).padStart(4)}  legacy=${String(legacy).padStart(4)}  ratio=${ratio}x`);
}

db.close();
