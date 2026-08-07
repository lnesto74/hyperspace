#!/usr/bin/env node
/**
 * A dwell estimator that survives a tracker whose median ID lives ~13 seconds.
 *
 * The counter cards currently report per-fragment durations, so every
 * department reads ~14s — the track half-life, not the shopper. This rebuilds
 * dwell from *episodes*: fragments in the same zone belonging to the same
 * shopper are merged across the gaps where the tracker lost them, and the
 * episode is measured as first-entry to last-exit.
 *
 * Three groupings are scored side by side so the gain can be attributed:
 *   track   — merge only within one track_key (fixes splits, not ID death)
 *   session — merge within a stitched visitor_session_id (needs backfill)
 *   spatial — merge across track deaths using the re-ID gate the stitcher
 *             already uses: gap <= reidMaxGapMs and exit->entry <= reidMaxDistanceM
 *
 * Little's Law (W = L / lambda) is computed from zone_occupancy as an
 * independent cross-check, because occupancy counts a fragmented shopper once
 * per instant regardless of how many IDs they burned through.
 *
 * Usage (on the droplet):
 *   docker cp analysis/12_fresco_episode_estimator.mjs hyperspace-backend-1:/app/scripts/
 *   docker exec -w /app hyperspace-backend-1 node scripts/12_fresco_episode_estimator.mjs
 *
 * Read-only. Writes nothing to the database.
 */
import Database from 'better-sqlite3';
import { loadClassifiedRois, FRESCO_DEPT_LABELS } from '/app/services/executive/ExecutiveZoneTaxonomy.js';

const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const VENUE_ID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const HOURS = Number(process.env.HOURS || 24);
const DWELL_SEC = Number(process.env.DWELL_SEC || 5);
const GAP_GRID_S = (process.env.GAP_GRID || '0,3,5,10,15,30').split(',').map(Number);
const REID_GAP_MS = Number(process.env.REID_GAP_MS || 10_000);
const REID_DIST_M = Number(process.env.REID_DIST_M || 4.5);
const EPISODE_CAP_MS = Number(process.env.EPISODE_CAP_MS || 30 * 60 * 1000);

const db = new Database(DB_PATH, { readonly: true });
const now = Date.now();
const startTs = now - HOURS * 3600_000;
const dwellMs = DWELL_SEC * 1000;

const q = (sorted, p) => (sorted.length
  ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const s1 = (ms) => Math.round(ms / 100) / 10;

const venue = db.prepare(`
  SELECT name, opening_hour, closing_hour, default_dwell_threshold_sec FROM venues WHERE id = ?
`).get(VENUE_ID) || {};

const classified = loadClassifiedRois(db, VENUE_ID);
const byDept = new Map();
for (const roi of classified.filter(r => r.classification.group === 'fresco')) {
  const dept = roi.classification.subGroup || 'fresco';
  const label = roi.classification.categoryLabel || roi.linkedCategory
    || FRESCO_DEPT_LABELS[dept] || dept;
  if (!byDept.has(dept)) byDept.set(dept, { label, ids: [] });
  byDept.get(dept).ids.push(roi.id);
}

console.log(`venue        ${venue.name} (${VENUE_ID})`);
console.log(`window       ${HOURS}h  ${new Date(startTs).toISOString()} -> ${new Date(now).toISOString()}`);
console.log(`stop bar     ${DWELL_SEC}s`);
console.log(`re-id gate   gap<=${REID_GAP_MS}ms  dist<=${REID_DIST_M}m`);
console.log(`departments  ${byDept.size}\n`);

// ── Is the stitched session id actually there to group on? ──────────────────
const sess = db.prepare(`
  SELECT COUNT(*) AS n,
         SUM(CASE WHEN visitor_session_id IS NOT NULL AND visitor_session_id != '' THEN 1 ELSE 0 END) AS withSession,
         COUNT(DISTINCT visitor_session_id) AS distinctSessions,
         COUNT(DISTINCT track_key) AS distinctTracks
  FROM zone_visits WHERE venue_id = ? AND start_time >= ?
`).get(VENUE_ID, startTs);
console.log('visitor_session_id coverage:',
  `${sess.withSession}/${sess.n} rows (${((sess.withSession / Math.max(sess.n, 1)) * 100).toFixed(1)}%)`,
  ` distinct sessions ${sess.distinctSessions}  distinct tracks ${sess.distinctTracks}`);
const sessionUsable = sess.withSession / Math.max(sess.n, 1) > 0.5;
console.log(sessionUsable
  ? '  -> session grouping usable\n'
  : '  -> session grouping NOT usable, spatial gate carries the de-fragmentation\n');

const dist = (ax, az, bx, bz) => {
  if ([ax, az, bx, bz].some(v => v == null)) return Infinity;
  return Math.hypot(ax - bx, az - bz);
};

/**
 * Merge time-ordered fragments into episodes.
 * `sameShopper(prev, next)` decides whether a gap is the tracker blinking or a
 * genuinely different person; the episode is measured span-wise so the blind
 * interval counts as time in the zone, which is the whole point.
 */
function toEpisodes(fragments, gapMs, sameShopper) {
  const eps = [];
  let cur = null;
  for (const f of fragments) {
    const fEnd = f.end_time ?? (f.start_time + (f.duration_ms || 0));
    if (cur && f.start_time - cur.end <= gapMs && sameShopper(cur.last, f)) {
      cur.end = Math.max(cur.end, fEnd);
      cur.parts++;
      cur.last = f;
    } else {
      if (cur) eps.push(cur);
      cur = { start: f.start_time, end: fEnd, parts: 1, last: f };
    }
  }
  if (cur) eps.push(cur);
  return eps;
}

const SAME = {
  track: (a, b) => a.track_key === b.track_key,
  session: (a, b) => a.visitor_session_id && a.visitor_session_id === b.visitor_session_id,
  spatial: (a, b) => (a.track_key === b.track_key)
    || (b.start_time - (a.end_time ?? a.start_time) <= REID_GAP_MS
      && dist(a.exit_position_x, a.exit_position_z, b.entry_position_x, b.entry_position_z) <= REID_DIST_M),
};

const summarise = (eps) => {
  const durs = eps.map(e => Math.min(e.end - e.start, EPISODE_CAP_MS));
  const stops = durs.filter(d => d >= dwellMs).sort((a, b) => a - b);
  return {
    episodes: eps.length,
    fragPerEpisode: eps.length
      ? Math.round((eps.reduce((s, e) => s + e.parts, 0) / eps.length) * 100) / 100 : 0,
    stoppingPct: eps.length ? Math.round((stops.length / eps.length) * 1000) / 10 : 0,
    medianStopSec: s1(q(stops, 0.5)),
    meanStopSec: stops.length ? s1(stops.reduce((s, d) => s + d, 0) / stops.length) : 0,
    p75StopSec: s1(q(stops, 0.75)),
    p90StopSec: s1(q(stops, 0.9)),
    cappedEpisodes: eps.filter(e => e.end - e.start > EPISODE_CAP_MS).length,
  };
};

// ── Per department ──────────────────────────────────────────────────────────
const modes = sessionUsable ? ['track', 'session', 'spatial'] : ['track', 'spatial'];
const headline = [];

for (const [, { label, ids }] of byDept) {
  const ph = ids.map(() => '?').join(',');
  const frags = db.prepare(`
    SELECT track_key, visitor_session_id, roi_id, start_time, end_time, duration_ms,
           entry_position_x, entry_position_z, exit_position_x, exit_position_z
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
    ORDER BY roi_id, start_time ASC
  `).all(VENUE_ID, ...ids, startTs, now);

  if (frags.length < 20) {
    console.log(`\n### ${label} — only ${frags.length} fragments, not reportable`);
    headline.push({ dept: label, fragments: frags.length, note: 'insufficient data' });
    continue;
  }

  const byRoi = new Map();
  for (const f of frags) {
    if (!byRoi.has(f.roi_id)) byRoi.set(f.roi_id, []);
    byRoi.get(f.roi_id).push(f);
  }

  console.log(`\n### ${label} — ${frags.length} fragments across ${ids.length} zones`);
  const rows = [];
  for (const mode of modes) {
    for (const gapS of GAP_GRID_S) {
      const eps = [];
      for (const list of byRoi.values()) eps.push(...toEpisodes(list, gapS * 1000, SAME[mode]));
      rows.push({ grouping: mode, gapS, ...summarise(eps) });
    }
  }
  console.table(rows);

  const chosen = rows.find(r => r.grouping === (sessionUsable ? 'session' : 'spatial') && r.gapS === 10)
    || rows.find(r => r.grouping === 'spatial' && r.gapS === 10);
  const raw = rows.find(r => r.grouping === 'track' && r.gapS === 0);
  headline.push({
    dept: label,
    fragments: frags.length,
    rawMedianStopSec: raw?.medianStopSec,
    episodeMedianStopSec: chosen?.medianStopSec,
    episodeP75StopSec: chosen?.p75StopSec,
    upliftX: raw?.medianStopSec ? Math.round((chosen.medianStopSec / raw.medianStopSec) * 100) / 100 : null,
    episodes: chosen?.episodes,
    fragPerEpisode: chosen?.fragPerEpisode,
    episodeStoppingPct: chosen?.stoppingPct,
  });
}

// ── Independent cross-check: Little's Law from occupancy ────────────────────
// Occupancy counts a shopper once per instant no matter how many IDs they burn,
// so W = L / lambda is not vulnerable to fragmentation the way a mean duration is.
console.log(`\n${'='.repeat(78)}\nLITTLE'S LAW CROSS-CHECK (trading hours only)\n${'='.repeat(78)}`);
const openH = venue.opening_hour ?? 8;
const closeH = venue.closing_hour ?? 20;
const tradingClause = `CAST(strftime('%H', timestamp/1000, 'unixepoch', '+2 hours') AS INTEGER) >= ${openH}
  AND CAST(strftime('%H', timestamp/1000, 'unixepoch', '+2 hours') AS INTEGER) < ${closeH}`;

const ll = [];
for (const [, { label, ids }] of byDept) {
  const ph = ids.map(() => '?').join(',');
  const occ = db.prepare(`
    SELECT AVG(total) AS meanOcc, COUNT(*) AS samples FROM (
      SELECT timestamp, SUM(occupancy_count) AS total
      FROM zone_occupancy
      WHERE venue_id = ? AND roi_id IN (${ph})
        AND timestamp >= ? AND timestamp < ? AND ${tradingClause}
      GROUP BY timestamp
    )
  `).get(VENUE_ID, ...ids, startTs, now);
  if (!occ?.samples) { ll.push({ dept: label, note: 'no occupancy samples' }); continue; }

  const frags = db.prepare(`
    SELECT track_key, visitor_session_id, roi_id, start_time, end_time, duration_ms,
           entry_position_x, entry_position_z, exit_position_x, exit_position_z
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
      AND CAST(strftime('%H', start_time/1000, 'unixepoch', '+2 hours') AS INTEGER) >= ${openH}
      AND CAST(strftime('%H', start_time/1000, 'unixepoch', '+2 hours') AS INTEGER) < ${closeH}
    ORDER BY roi_id, start_time ASC
  `).all(VENUE_ID, ...ids, startTs, now);

  const byRoi = new Map();
  for (const f of frags) {
    if (!byRoi.has(f.roi_id)) byRoi.set(f.roi_id, []);
    byRoi.get(f.roi_id).push(f);
  }
  const eps = [];
  for (const list of byRoi.values()) {
    eps.push(...toEpisodes(list, REID_GAP_MS, SAME[sessionUsable ? 'session' : 'spatial']));
  }

  const tradingSec = (HOURS / 24) * (closeH - openH) * 3600;
  const lambda = eps.length / tradingSec;
  ll.push({
    dept: label,
    meanOccupancy: Math.round(occ.meanOcc * 1000) / 1000,
    occSamples: occ.samples,
    episodes: eps.length,
    arrivalsPerMin: Math.round(lambda * 60 * 100) / 100,
    littlesLawDwellSec: lambda > 0 ? Math.round((occ.meanOcc / lambda) * 10) / 10 : null,
  });
}
console.table(ll);

console.log(`\n${'='.repeat(78)}\nHEADLINE — per-fragment vs de-fragmented episode\n${'='.repeat(78)}`);
console.table(headline);
