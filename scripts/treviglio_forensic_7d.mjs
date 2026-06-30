/**
 * Treviglio 7-day forensic dwell & fragmentation report (read-only).
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const VID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const DB = process.env.DB_PATH || '/data/db/hyperspace.db';
const DAYS = Number(process.env.DAYS || 7);

const db = new Database(DB, { readonly: true });
const NOW = Date.now();
const START = NOW - DAYS * 86400000;

const q = (sql, p = []) => db.prepare(sql).all(...p);
const q1 = (sql, p = []) => db.prepare(sql).get(...p);

const venue = q1(
  'SELECT name, default_dwell_threshold_sec, default_engagement_threshold_sec, footfall_roi_id FROM venues WHERE id = ?',
  [VID],
);
const dwellSec = venue?.default_dwell_threshold_sec ?? 60;
const engageSec = venue?.default_engagement_threshold_sec ?? 120;
const dwellMs = dwellSec * 1000;
const engageMs = engageSec * 1000;

const trafficRois = q(
  `SELECT id, name FROM regions_of_interest WHERE venue_id = ?
   AND (name LIKE '%1121%' OR name LIKE '%Antenna%Ingresso%' OR name LIKE '%Traffic%'
        OR name LIKE '%Entrance%' OR name LIKE '%Ingress%')`,
  [VID],
);
const gateIds = trafficRois.filter(r => /1121|Antenna.*Ingresso/i.test(r.name)).map(r => r.id);
const gatePh = gateIds.map(() => '?').join(',');

const aisleRois = q(
  `SELECT id, name,
    COALESCE(json_extract(metadata_json,'$.business_category_label'),
             json_extract(metadata_json,'$.business_category'), 'Uncategorized') cat
   FROM regions_of_interest WHERE venue_id = ?
   AND (name LIKE '%Engagement%' OR name LIKE '%Shelf%' OR name LIKE '%Scaffale%')
   AND name NOT LIKE '%Queue%' AND name NOT LIKE '%Checkout%'`,
  [VID],
);
const aisleIds = aisleRois.map(r => r.id);
const aislePh = aisleIds.map(() => '?').join(',');

function pct(a, b) {
  return b > 0 ? Math.round((a / b) * 1000) / 10 : 0;
}

console.log(JSON.stringify({
  meta: {
    venue: venue?.name,
    venueId: VID,
    windowStart: new Date(START).toISOString(),
    windowEnd: new Date(NOW).toISOString(),
    days: DAYS,
    dwellThresholdSec: dwellSec,
    engagementThresholdSec: engageSec,
  },
}, null, 2));

// --- INGRESS ---
let ingress = {};
if (gateIds.length) {
  ingress = q1(
    `SELECT COUNT(*) crossings, COUNT(DISTINCT track_key) uniqueTracks,
            ROUND(AVG(duration_ms)/1000.0, 2) avgEpisodeSec
     FROM zone_visits WHERE venue_id = ? AND roi_id IN (${gatePh})
       AND start_time >= ? AND start_time < ? AND track_key NOT LIKE '%cashier%'`,
    [VID, ...gateIds, START, NOW],
  );
  ingress.daily = q(
    `SELECT date(start_time/1000, 'unixepoch', 'localtime') d,
            COUNT(*) crossings, COUNT(DISTINCT track_key) uniq
     FROM zone_visits WHERE venue_id = ? AND roi_id IN (${gatePh})
       AND start_time >= ? AND start_time < ? AND track_key NOT LIKE '%cashier%'
     GROUP BY d ORDER BY d`,
    [VID, ...gateIds, START, NOW],
  );
}

// --- FRAGMENTATION ---
const frag = q1(
  `SELECT COUNT(DISTINCT track_key) totalTracks,
          COUNT(*) totalEpisodes,
          ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT track_key), 2) episodesPerTrack
   FROM zone_visits WHERE venue_id = ? AND start_time >= ? AND start_time < ?
     AND track_key NOT LIKE '%cashier%'`,
  [VID, START, NOW],
);

const fragDist = q(
  `SELECT bucket, COUNT(*) tracks FROM (
     SELECT track_key,
       CASE
         WHEN cnt = 1 THEN '1'
         WHEN cnt BETWEEN 2 AND 5 THEN '2-5'
         WHEN cnt BETWEEN 6 AND 20 THEN '6-20'
         WHEN cnt BETWEEN 21 AND 50 THEN '21-50'
         ELSE '50+'
       END bucket
     FROM (
       SELECT track_key, COUNT(*) cnt FROM zone_visits
       WHERE venue_id = ? AND start_time >= ? AND start_time < ?
         AND track_key NOT LIKE '%cashier%'
       GROUP BY track_key
     )
   ) GROUP BY bucket ORDER BY
     CASE bucket WHEN '1' THEN 1 WHEN '2-5' THEN 2 WHEN '6-20' THEN 3 WHEN '21-50' THEN 4 ELSE 5 END`,
  [VID, START, NOW],
);

const sessionStitch = q1(
  `SELECT COUNT(DISTINCT visitor_session_id) sessions,
          COUNT(DISTINCT track_key) tracks,
          COUNT(*) episodes
   FROM zone_visits WHERE venue_id = ? AND start_time >= ? AND start_time < ?
     AND visitor_session_id IS NOT NULL AND visitor_session_id != ''
     AND track_key NOT LIKE '%cashier%'`,
  [VID, START, NOW],
);

// --- STORE DWELL (executive method) ---
let storeDwell = { executive: null, corrected: null };
if (aisleIds.length) {
  const execRows = q(
    `SELECT track_key, SUM(duration_ms) totalMs
     FROM zone_visits WHERE venue_id = ? AND roi_id IN (${aislePh})
       AND start_time >= ? AND start_time < ? AND track_key NOT LIKE '%cashier%'
       AND is_dwell = 1
     GROUP BY track_key HAVING totalMs >= 30000`,
    [VID, ...aisleIds, START, NOW],
  );
  if (execRows.length) {
    const avgMs = execRows.reduce((s, r) => s + r.totalMs, 0) / execRows.length;
    storeDwell.executive = {
      method: 'sum is_dwell shopping zones, tracks with >=30s total',
      sessionCount: execRows.length,
      avgMin: Math.round((avgMs / 60000) * 10) / 10,
      p50Min: Math.round((execRows.map(r => r.totalMs).sort((a, b) => a - b)[Math.floor(execRows.length / 2)] / 60000) * 10) / 10,
    };
  }

  // Corrected: use duration_ms >= dwellMs per episode, sum per track, min 30s
  const corrRows = q(
    `SELECT track_key, SUM(duration_ms) totalMs
     FROM zone_visits WHERE venue_id = ? AND roi_id IN (${aislePh})
       AND start_time >= ? AND start_time < ? AND track_key NOT LIKE '%cashier%'
       AND duration_ms >= ?
     GROUP BY track_key HAVING totalMs >= 30000`,
    [VID, ...aisleIds, START, NOW, dwellMs],
  );
  if (corrRows.length) {
    const avgMs = corrRows.reduce((s, r) => s + r.totalMs, 0) / corrRows.length;
    storeDwell.corrected = {
      method: `sum episodes duration>=${dwellSec}s, tracks with >=30s total`,
      sessionCount: corrRows.length,
      avgMin: Math.round((avgMs / 60000) * 10) / 10,
    };
  }
}

// --- CATEGORY DWELL (naive vs robust) ---
const categoryNaive = aisleIds.length ? q(
  `SELECT cat, COUNT(*) visits,
          COUNT(CASE WHEN duration_ms >= ? THEN 1 END) dwellVisits,
          ROUND(AVG(duration_ms)/1000.0, 1) avgEpisodeSec,
          ROUND(AVG(CASE WHEN duration_ms >= ? THEN duration_ms END)/1000.0, 1) avgDwellEpisodeSec
   FROM (
     SELECT zv.*, COALESCE(json_extract(r.metadata_json,'$.business_category_label'),
              json_extract(r.metadata_json,'$.business_category'), 'Uncategorized') cat
     FROM zone_visits zv JOIN regions_of_interest r ON r.id = zv.roi_id
     WHERE zv.venue_id = ? AND zv.roi_id IN (${aislePh})
       AND zv.start_time >= ? AND zv.start_time < ? AND zv.track_key NOT LIKE '%cashier%'
   ) GROUP BY cat ORDER BY visits DESC`,
  [dwellMs, dwellMs, VID, ...aisleIds, START, NOW],
) : [];

// Per-track per-category max dwell (robust: one shopper, fragmented re-entries)
const categoryRobust = aisleIds.length ? q(
  `SELECT cat,
          COUNT(*) trackCategoryPairs,
          ROUND(AVG(maxDwellMs)/1000.0, 1) avgMaxDwellSecPerTrack,
          ROUND(AVG(totalMs)/60000.0, 2) avgTotalMinPerTrack,
          COUNT(CASE WHEN maxDwellMs >= ? THEN 1 END) tracksWithStop
   FROM (
     SELECT track_key, cat, MAX(duration_ms) maxDwellMs, SUM(duration_ms) totalMs
     FROM (
       SELECT zv.track_key, zv.duration_ms,
         COALESCE(json_extract(r.metadata_json,'$.business_category_label'),
                  json_extract(r.metadata_json,'$.business_category'), 'Uncategorized') cat
       FROM zone_visits zv JOIN regions_of_interest r ON r.id = zv.roi_id
       WHERE zv.venue_id = ? AND zv.roi_id IN (${aislePh})
         AND zv.start_time >= ? AND zv.start_time < ? AND zv.track_key NOT LIKE '%cashier%'
     ) GROUP BY track_key, cat
   ) GROUP BY cat ORDER BY trackCategoryPairs DESC`,
  [dwellMs, VID, ...aisleIds, START, NOW],
) : [];

// --- GATE MISS (shopping without gate crossing) ---
let gateMiss = null;
if (gateIds.length && aisleIds.length) {
  gateMiss = q1(
    `WITH gate_tracks AS (
       SELECT DISTINCT track_key FROM zone_visits
       WHERE venue_id = ? AND roi_id IN (${gatePh}) AND start_time >= ? AND start_time < ?
     ),
     shop_tracks AS (
       SELECT DISTINCT track_key FROM zone_visits
       WHERE venue_id = ? AND roi_id IN (${aislePh}) AND start_time >= ? AND start_time < ?
     )
     SELECT
       (SELECT COUNT(*) FROM shop_tracks) shopTracks,
       (SELECT COUNT(*) FROM gate_tracks) gateTracks,
       (SELECT COUNT(*) FROM shop_tracks s LEFT JOIN gate_tracks g ON s.track_key = g.track_key WHERE g.track_key IS NULL) shopNoGate`,
    [VID, ...gateIds, START, NOW, VID, ...aisleIds, START, NOW],
  );
  gateMiss.missPct = gateMiss.shopTracks > 0
    ? Math.round((gateMiss.shopNoGate / gateMiss.shopTracks) * 1000) / 10
    : 0;
}

// --- STOPPING RATE by threshold sweep ---
const thresholdSweep = [];
if (aisleIds.length) {
  for (const thresh of [5000, 10000, 20000, 30000, 60000]) {
    const row = q1(
      `SELECT COUNT(*) visits,
              COUNT(CASE WHEN duration_ms >= ? THEN 1 END) dwellVisits
       FROM zone_visits WHERE venue_id = ? AND roi_id IN (${aislePh})
         AND start_time >= ? AND start_time < ? AND track_key NOT LIKE '%cashier%'`,
      [thresh, VID, ...aisleIds, START, NOW],
    );
    thresholdSweep.push({
      thresh,
      visits: row.visits,
      dwellVisits: row.dwellVisits,
      stopPct: pct(row.dwellVisits, row.visits),
    });
  }
}

// --- CHECKOUT ---
const checkout = q1(
  `SELECT COUNT(*) sessions,
          COUNT(CASE WHEN is_abandoned = 0 THEN 1 END) completed,
          ROUND(AVG(CASE WHEN is_abandoned = 0 THEN waiting_time_ms END)/60000.0, 2) avgWaitMin
   FROM queue_sessions qs JOIN regions_of_interest r ON r.id = qs.queue_zone_id
   WHERE r.venue_id = ? AND qs.queue_entry_time >= ? AND qs.queue_entry_time < ?
     AND qs.waiting_time_ms >= 5000`,
  [VID, START, NOW],
);

console.log('\n=== INGRESS (Entrance 1121) ===');
console.log(JSON.stringify(ingress, null, 2));

console.log('\n=== FRAGMENTATION ===');
console.log(JSON.stringify({ frag, fragDist, sessionStitch, gateMiss }, null, 2));

console.log('\n=== STORE DWELL ===');
console.log(JSON.stringify(storeDwell, null, 2));

console.log('\n=== CATEGORY: NAIVE (episode-level) ===');
categoryNaive.slice(0, 15).forEach(c => {
  console.log(`  ${c.cat}: ${c.visits} visits, stop@${dwellSec}s=${pct(c.dwellVisits, c.visits)}%, avgEp=${c.avgEpisodeSec}s, avgDwellEp=${c.avgDwellEpisodeSec || 0}s`);
});

console.log('\n=== CATEGORY: ROBUST (per-track max dwell in category) ===');
categoryRobust.slice(0, 15).forEach(c => {
  console.log(`  ${c.cat}: ${c.trackCategoryPairs} track×cat pairs, tracksWithStop=${c.tracksWithStop}, avgMaxDwell=${c.avgMaxDwellSecPerTrack}s, avgTotal=${c.avgTotalMinPerTrack}min`);
});

console.log('\n=== THRESHOLD SWEEP (aisle episodes) ===');
thresholdSweep.forEach(t => console.log(`  >=${t.thresh / 1000}s: stop ${t.stopPct}% (${t.dwellVisits}/${t.visits})`));

console.log('\n=== CHECKOUT ===');
console.log(JSON.stringify(checkout, null, 2));

// Consistency check
const ingUniq = ingress.uniqueTracks || 0;
console.log('\n=== GROCERY SANITY ===');
console.log(`  Entrants (unique tracks at gate): ${ingUniq}`);
console.log(`  Entrant crossings (total): ${ingress.crossings || 0}`);
console.log(`  Re-entries per entrant: ${ingUniq ? ((ingress.crossings || 0) / ingUniq).toFixed(2) : '—'}`);
console.log(`  Aisle visits / entrant: ${ingUniq && aisleIds.length ? (q1(`SELECT COUNT(*) c FROM zone_visits WHERE venue_id=? AND roi_id IN (${aislePh}) AND start_time>=? AND start_time<?`, [VID, ...aisleIds, START, NOW]).c / ingUniq).toFixed(0) : '—'}`);
console.log(`  Checkout / entrant: ${ingUniq ? pct(checkout.completed, ingUniq) : '—'}%`);
console.log(`  Shop tracks missing gate: ${gateMiss?.shopNoGate ?? '—'} (${gateMiss?.missPct ?? '—'}%)`);

// --- ZONE-LEVEL TOP AISLES ---
if (aisleIds.length) {
  console.log('\n=== TOP ZONES (by visits, 7d) ===');
  const topZones = q(
    `SELECT substr(r.name, 1, 55) name, COUNT(*) v,
            COUNT(CASE WHEN zv.duration_ms >= ? THEN 1 END) d20,
            ROUND(AVG(zv.duration_ms) / 1000.0, 1) avg_s,
            ROUND(AVG(CASE WHEN zv.duration_ms >= ? THEN zv.duration_ms END) / 1000.0, 1) avg_dwell_s
     FROM zone_visits zv JOIN regions_of_interest r ON r.id = zv.roi_id
     WHERE zv.venue_id = ? AND zv.start_time >= ? AND zv.roi_id IN (${aislePh})
     GROUP BY r.id ORDER BY v DESC LIMIT 12`,
    [dwellMs, dwellMs, VID, START],
  );
  topZones.forEach(r => {
    console.log(`  ${r.name}: ${r.v} visits, stop@${dwellSec}s=${pct(r.d20, r.v)}%, avgEp=${r.avg_s}s, avgDwellEp=${r.avg_dwell_s || 0}s`);
  });
}

// --- GATE-AISLE track_key linkage ---
if (gateIds.length && aisleIds.length) {
  const linked = q1(
    `WITH g AS (
       SELECT DISTINCT track_key FROM zone_visits
       WHERE venue_id = ? AND roi_id IN (${gatePh}) AND start_time >= ? AND start_time < ?
     ),
     shop AS (
       SELECT track_key, SUM(duration_ms) ms FROM zone_visits
       WHERE venue_id = ? AND roi_id IN (${aislePh}) AND start_time >= ? AND start_time < ?
       GROUP BY track_key
     )
     SELECT (SELECT COUNT(*) FROM g) gateTracks,
            (SELECT COUNT(*) FROM shop s JOIN g ON s.track_key = g.track_key) linkedTracks,
            (SELECT ROUND(AVG(s.ms) / 60000.0, 2) FROM shop s JOIN g ON s.track_key = g.track_key) avgShopMinLinked,
            (SELECT ROUND(AVG(s.ms) / 60000.0, 2) FROM shop) avgShopMinAll`,
    [VID, ...gateIds, START, NOW, VID, ...aisleIds, START, NOW],
  );
  console.log('\n=== GATE ↔ AISLE track_key linkage ===');
  console.log(JSON.stringify(linked, null, 2));
}

// --- Duration percentiles ---
if (aisleIds.length) {
  const durs = q(
    `SELECT duration_ms FROM zone_visits WHERE venue_id = ? AND roi_id IN (${aislePh})
       AND start_time >= ? AND start_time < ? ORDER BY duration_ms`,
    [VID, ...aisleIds, START, NOW],
  );
  const n = durs.length;
  const at = (p) => durs[Math.floor(n * p / 100)]?.duration_ms;
  console.log('\n=== AISLE EPISODE DURATION PERCENTILES (ms) ===');
  console.log({ n, p10: at(10), p25: at(25), p50: at(50), p75: at(75), p90: at(90), p99: at(99) });
}

// --- venue_objects category coverage ---
const roiMeta = q1(
  `SELECT COUNT(*) total,
          SUM(CASE WHEN json_extract(metadata_json, '$.business_category_label') IS NOT NULL THEN 1 ELSE 0 END) tagged
   FROM regions_of_interest WHERE venue_id = ? AND name LIKE '%Engagement%'`,
  [VID],
);
const voCats = q(
  `SELECT json_extract(metadata_json, '$.business_category_label') cat, COUNT(*) n
   FROM venue_objects WHERE venue_id = ? AND json_extract(metadata_json, '$.business_category_label') IS NOT NULL
   GROUP BY cat ORDER BY n DESC LIMIT 12`,
  [VID],
);
console.log('\n=== CATEGORY TAGGING GAP ===');
console.log(JSON.stringify({ roiEngagementZones: roiMeta, venueObjectCategories: voCats }, null, 2));

db.close();
