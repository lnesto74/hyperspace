#!/usr/bin/env node
/**
 * Track ID persistence & dwell forensics (zone_visits + track_positions).
 * Usage: node scripts/track_id_forensics.mjs [venueId] [days]
 */
import Database from 'better-sqlite3';

const venueId = process.argv[2] || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const days = Number(process.argv[3] || 3);
const dbPath = process.env.DB_PATH || '/data/db/hyperspace.db';

const endTs = Date.now();
const startTs = endTs - days * 24 * 3600 * 1000;

const db = new Database(dbPath, { readonly: true });

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

function quantile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[Math.max(0, idx)];
}

function histBuckets(values, edges) {
  const counts = new Array(edges.length - 1).fill(0);
  for (const v of values) {
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i] && v < edges[i + 1]) {
        counts[i]++;
        break;
      }
      if (i === edges.length - 2 && v >= edges[i]) counts[i]++;
    }
  }
  return counts;
}

function fmtSec(s) {
  if (s < 60) return `${s.toFixed(1)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

console.log(`\n=== Track ID forensics ===`);
console.log(`venue: ${venueId}`);
console.log(`window: last ${days}d (${new Date(startTs).toISOString()} → ${new Date(endTs).toISOString()})`);
console.log(`db: ${dbPath}\n`);

// ── 1. Track lifetime from track_positions ──
const trackLifetimes = db.prepare(`
  SELECT track_key,
    MIN(timestamp) AS first_ts,
    MAX(timestamp) AS last_ts,
    COUNT(*) AS n_pos,
    (MAX(timestamp) - MIN(timestamp)) / 1000.0 AS lifetime_sec
  FROM track_positions
  WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
  GROUP BY track_key
`).all(venueId, startTs, endTs);

const lifetimes = trackLifetimes.map(r => r.lifetime_sec).sort((a, b) => a - b);
const posCounts = trackLifetimes.map(r => r.n_pos).sort((a, b) => a - b);

console.log('── Track ID lifetime (first→last position in window) ──');
console.log(`  distinct track_keys: ${trackLifetimes.length.toLocaleString()}`);
console.log(`  positions total:     ${trackLifetimes.reduce((s, r) => s + r.n_pos, 0).toLocaleString()}`);
console.log(`  lifetime p25: ${fmtSec(quantile(lifetimes, 0.25))}`);
console.log(`  lifetime p50: ${fmtSec(quantile(lifetimes, 0.5))}`);
console.log(`  lifetime p75: ${fmtSec(quantile(lifetimes, 0.75))}`);
console.log(`  lifetime p90: ${fmtSec(quantile(lifetimes, 0.9))}`);
console.log(`  lifetime p95: ${fmtSec(quantile(lifetimes, 0.95))}`);
console.log(`  lifetime max: ${fmtSec(lifetimes[lifetimes.length - 1] || 0)}`);
console.log(`  positions/track p50: ${quantile(posCounts, 0.5)}`);
console.log(`  positions/track p90: ${quantile(posCounts, 0.9)}`);

const lifeEdges = [0, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1800, Infinity];
const lifeLabels = ['<1s', '1-2s', '2-5s', '5-10s', '10-20s', '20-30s', '30-60s', '1-2m', '2-5m', '5-10m', '10-30m', '30m+'];
const lifeHist = histBuckets(lifetimes, lifeEdges);
console.log('  lifetime histogram:');
for (let i = 0; i < lifeLabels.length; i++) {
  const c = lifeHist[i];
  if (c > 0) console.log(`    ${lifeLabels[i].padEnd(8)} ${String(c).padStart(8)}  (${pct(c, lifetimes.length)}%)`);
}

const shortLived = lifetimes.filter(t => t < 10).length;
const under30 = lifetimes.filter(t => t < 30).length;
console.log(`  IDs dead within 10s:  ${pct(shortLived, lifetimes.length)}%`);
console.log(`  IDs dead within 30s:  ${pct(under30, lifetimes.length)}%`);

// ── 2. Zone visit duration distribution ──
const visitDurations = db.prepare(`
  SELECT duration_ms / 1000.0 AS dur_sec
  FROM zone_visits
  WHERE venue_id = ? AND start_time >= ? AND start_time < ?
    AND track_key NOT LIKE '%cashier%'
    AND duration_ms >= 300
`).all(venueId, startTs, endTs).map(r => r.dur_sec).sort((a, b) => a - b);

console.log('\n── Zone visit duration (all ROIs, visits ≥300ms) ──');
console.log(`  visits: ${visitDurations.length.toLocaleString()}`);
console.log(`  p25: ${fmtSec(quantile(visitDurations, 0.25))}`);
console.log(`  p50: ${fmtSec(quantile(visitDurations, 0.5))}`);
console.log(`  p75: ${fmtSec(quantile(visitDurations, 0.75))}`);
console.log(`  p90: ${fmtSec(quantile(visitDurations, 0.9))}`);
console.log(`  p95: ${fmtSec(quantile(visitDurations, 0.95))}`);

const durEdges = [0.3, 1, 2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300, Infinity];
const durLabels = ['0.3-1s', '1-2s', '2-5s', '5-10s', '10-15s', '15-20s', '20-30s', '30-45s', '45-60s', '60-90s', '90-120s', '2-3m', '3-5m', '5m+'];
const durHist = histBuckets(visitDurations, durEdges);
console.log('  duration histogram:');
for (let i = 0; i < durLabels.length; i++) {
  const c = durHist[i];
  if (c > 0) console.log(`    ${durLabels[i].padEnd(8)} ${String(c).padStart(8)}  (${pct(c, visitDurations.length)}%)`);
}

// Spike at common durations suggests cap/refresh
const near10 = visitDurations.filter(d => d >= 9 && d <= 11).length;
const near20 = visitDurations.filter(d => d >= 19 && d <= 21).length;
const near30 = visitDurations.filter(d => d >= 29 && d <= 31).length;
const near60 = visitDurations.filter(d => d >= 58 && d <= 62).length;
console.log(`  spike check ±1s around 10s: ${pct(near10, visitDurations.length)}%`);
console.log(`  spike check ±1s around 20s: ${pct(near20, visitDurations.length)}%`);
console.log(`  spike check ±1s around 30s: ${pct(near30, visitDurations.length)}%`);
console.log(`  spike check ±1s around 60s: ${pct(near60, visitDurations.length)}%`);

// ── 3. Per-category dwell similarity ──
const catRows = db.prepare(`
  SELECT
    COALESCE(json_extract(r.metadata_json, '$.categoryLabel'),
             json_extract(r.metadata_json, '$.category'),
             r.name) AS cat,
    COUNT(*) AS visits,
    AVG(zv.duration_ms) / 1000.0 AS avg_sec,
    AVG(CASE WHEN zv.duration_ms >= 10000 THEN zv.duration_ms END) / 1000.0 AS avg_dwell_sec,
    COUNT(CASE WHEN zv.duration_ms >= 10000 THEN 1 END) AS stops
  FROM zone_visits zv
  JOIN regions_of_interest r ON r.id = zv.roi_id
  WHERE zv.venue_id = ? AND zv.start_time >= ? AND zv.start_time < ?
    AND zv.track_key NOT LIKE '%cashier%'
    AND zv.duration_ms >= 300
    AND r.name NOT LIKE '%Queue%'
    AND r.name NOT LIKE '%Traffic%'
    AND r.name NOT LIKE '%Entrance%'
  GROUP BY cat
  HAVING visits >= 100
  ORDER BY visits DESC
  LIMIT 15
`).all(venueId, startTs, endTs);

console.log('\n── Avg visit duration by category (top zones) ──');
console.log('  category                          visits    avg_all   avg_stop≥10s  stop%');
for (const r of catRows) {
  const stopPct = pct(r.stops, r.visits);
  console.log(`  ${String(r.cat).slice(0, 32).padEnd(32)} ${String(r.visits).padStart(7)} ${fmtSec(r.avg_sec).padStart(9)} ${fmtSec(r.avg_dwell_sec || 0).padStart(13)} ${String(stopPct).padStart(5)}%`);
}

const avgs = catRows.map(r => r.avg_sec).filter(Boolean);
const avgMean = avgs.reduce((s, v) => s + v, 0) / (avgs.length || 1);
const avgStd = Math.sqrt(avgs.reduce((s, v) => s + (v - avgMean) ** 2, 0) / (avgs.length || 1));
const cv = avgMean ? avgStd / avgMean : 0;
console.log(`  cross-category CV of mean duration: ${(cv * 100).toFixed(1)}% (low = suspiciously uniform)`);

// ── 4. ID fragmentation: new track near prior track end ──
console.log('\n── ID fragmentation (spatial re-birth proxy) ──');
console.log('  sampling track end→start pairs (max 50k ends)...');

const trackEnds = db.prepare(`
  SELECT tp.track_key, tp.timestamp AS end_ts, tp.position_x AS x, tp.position_z AS z
  FROM track_positions tp
  JOIN (
    SELECT track_key, MAX(timestamp) AS max_ts
    FROM track_positions
    WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
    GROUP BY track_key
  ) last ON last.track_key = tp.track_key AND last.max_ts = tp.timestamp
  WHERE tp.venue_id = ?
  ORDER BY tp.timestamp
  LIMIT 50000
`).all(venueId, startTs, endTs, venueId);

const trackStarts = db.prepare(`
  SELECT tp.track_key, tp.timestamp AS start_ts, tp.position_x AS x, tp.position_z AS z
  FROM track_positions tp
  JOIN (
    SELECT track_key, MIN(timestamp) AS min_ts
    FROM track_positions
    WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
    GROUP BY track_key
  ) first ON first.track_key = tp.track_key AND first.min_ts = tp.timestamp
  WHERE tp.venue_id = ?
`).all(venueId, startTs, endTs, venueId);

// Index starts by time buckets (1s) for faster lookup
const startsBySec = new Map();
for (const s of trackStarts) {
  const bucket = Math.floor(s.start_ts / 1000);
  if (!startsBySec.has(bucket)) startsBySec.set(bucket, []);
  startsBySec.get(bucket).push(s);
}

const gapEdges = [0, 1, 2, 5, 10, 20, 30, 60, 120, 300];
const distEdges = [0, 1, 2, 3, 5, 8, 12, 20];
const gapHist = new Array(gapEdges.length - 1).fill(0);
const distHist = new Array(distEdges.length - 1).fill(0);
let rebirthCandidates = 0;
let checked = 0;

for (const end of trackEnds) {
  checked++;
  let best = null;
  for (let dt = 0; dt <= 30; dt++) {
    const bucket = Math.floor(end.end_ts / 1000) + dt;
    const candidates = startsBySec.get(bucket) || [];
    for (const s of candidates) {
      if (s.track_key === end.track_key) continue;
      const gapSec = (s.start_ts - end.end_ts) / 1000;
      if (gapSec < 0 || gapSec > 30) continue;
      const dx = s.x - end.x;
      const dz = s.z - end.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > 8) continue;
      if (!best || dist < best.dist) best = { gapSec, dist, end, start: s };
    }
  }
  if (best) {
    rebirthCandidates++;
    for (let i = 0; i < gapEdges.length - 1; i++) {
      if (best.gapSec >= gapEdges[i] && best.gapSec < gapEdges[i + 1]) { gapHist[i]++; break; }
    }
    for (let i = 0; i < distEdges.length - 1; i++) {
      if (best.dist >= distEdges[i] && best.dist < distEdges[i + 1]) { distHist[i]++; break; }
    }
  }
}

console.log(`  sampled track ends: ${checked.toLocaleString()}`);
console.log(`  nearby rebirth (new ID within 8m & 30s of prior ID death): ${rebirthCandidates.toLocaleString()} (${pct(rebirthCandidates, checked)}%)`);
console.log('  gap (end→new start):');
const gapLabels = ['0-1s', '1-2s', '2-5s', '5-10s', '10-20s', '20-30s'];
for (let i = 0; i < gapLabels.length; i++) {
  if (gapHist[i]) console.log(`    ${gapLabels[i].padEnd(8)} ${gapHist[i]} (${pct(gapHist[i], rebirthCandidates)}%)`);
}
console.log('  distance at handoff:');
const distLabels = ['0-1m', '1-2m', '2-3m', '3-5m', '5-8m', '8-12m', '12-20m'];
for (let i = 0; i < distLabels.length; i++) {
  if (distHist[i]) console.log(`    ${distLabels[i].padEnd(8)} ${distHist[i]} (${pct(distHist[i], rebirthCandidates)}%)`);
}

// ── 5. Visits per track_key (fragmentation in zones) ──
const visitsPerTrack = db.prepare(`
  SELECT track_key, COUNT(*) AS n, SUM(duration_ms)/1000.0 AS total_sec
  FROM zone_visits
  WHERE venue_id = ? AND start_time >= ? AND start_time < ?
    AND track_key NOT LIKE '%cashier%'
  GROUP BY track_key
`).all(venueId, startTs, endTs);

const vpt = visitsPerTrack.map(r => r.n).sort((a, b) => a - b);
const totalSecPerTrack = visitsPerTrack.map(r => r.total_sec).sort((a, b) => a - b);

console.log('\n── Zone visits per track_key ──');
console.log(`  tracks with ≥1 visit: ${visitsPerTrack.length.toLocaleString()}`);
console.log(`  visits/track p50: ${quantile(vpt, 0.5)}`);
console.log(`  visits/track p90: ${quantile(vpt, 0.9)}`);
console.log(`  visits/track p99: ${quantile(vpt, 0.99)}`);
console.log(`  summed zone time/track p50: ${fmtSec(quantile(totalSecPerTrack, 0.5))}`);
console.log(`  summed zone time/track p90: ${fmtSec(quantile(totalSecPerTrack, 0.9))}`);

// Compare track lifetime vs summed zone time
const trackLifeMap = new Map(trackLifetimes.map(r => [r.track_key, r.lifetime_sec]));
let ratioSample = [];
for (const v of visitsPerTrack) {
  const life = trackLifeMap.get(v.track_key);
  if (life && life > 1) ratioSample.push(v.total_sec / life);
}
ratioSample.sort((a, b) => a - b);
console.log(`  (sum zone dwell / track lifetime) p50: ${quantile(ratioSample, 0.5).toFixed(2)}`);
console.log(`  (sum zone dwell / track lifetime) p90: ${quantile(ratioSample, 0.9).toFixed(2)}`);
console.log('    → values near 1.0 with short lifetimes = ID dies right after zone time ends');

console.log('\n=== Done ===\n');
db.close();
