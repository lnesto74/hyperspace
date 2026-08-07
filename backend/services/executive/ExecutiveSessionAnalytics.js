/**
 * Session-stitched executive KPIs — fragmentation-safe dwell & category metrics.
 */

import {
  buildVisitSessions,
  loadVisitSessionConfigForVenue,
  resolveVenueRoiContext,
} from '../VisitSessionStitcher.js';
import { normalizeVisitSessionConfig } from '../../config/visitSessionConfig.js';

const MIN_STORE_DWELL_MS = 30 * 1000;
const MAX_STORE_DWELL_MS = 90 * 60 * 1000;
const UNTAGGED = new Set(['uncategorized', 'no content available', '']);

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function median(sorted) {
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[Math.max(0, idx)];
}

function isUntagged(cat) {
  return UNTAGGED.has(String(cat || '').trim().toLowerCase());
}

/** Grocery-tuned stitching for executive reporting (brief gate crossings, wider re-ID). */
export function loadExecutiveVisitSessionConfig(db, venueId) {
  const base = loadVisitSessionConfigForVenue(db, venueId);
  return normalizeVisitSessionConfig({
    ...base,
    entranceMinDurationMs: Math.min(base.entranceMinDurationMs, 300),
    reidMaxDistanceM: Math.max(base.reidMaxDistanceM, 8),
    reidMaxGapMs: Math.max(base.reidMaxGapMs, 10_000),
  });
}

export function buildRoiToCategoryMap(classifiedRois) {
  const map = new Map();
  for (const roi of classifiedRois) {
    const cat = roi.classification?.categoryLabel
      || roi.linkedCategory
      || roi.classification?.subGroup
      || 'Uncategorized';
    map.set(roi.id, cat);
  }
  return map;
}

function loadSessionVisits(db, venueId, startTs, endTs) {
  return db.prepare(`
    SELECT zv.id, zv.track_key, zv.roi_id, zv.start_time, zv.end_time, zv.duration_ms,
           zv.is_dwell, zv.entry_position_x, zv.entry_position_z,
           zv.exit_position_x, zv.exit_position_z, zv.visitor_session_id
    FROM zone_visits zv
    WHERE zv.venue_id = ? AND zv.start_time >= ? AND zv.start_time < ?
      AND zv.track_key NOT LIKE '%cashier%'
    ORDER BY zv.start_time ASC
  `).all(venueId, startTs, endTs);
}

function shoppingDwellMsForSession(sessionVisits, shoppingRoiIds) {
  const shop = new Set(shoppingRoiIds);
  let total = 0;
  for (const v of sessionVisits) {
    if (!shop.has(v.roi_id)) continue;
    const dur = v.duration_ms ?? ((v.end_time || v.start_time) - v.start_time);
    if (dur > 0) total += dur;
  }
  return total;
}

/**
 * Windows are cut on UTC-day boundaries, which fall around 02:00 in the venue's
 * timezone — the store is shut, so no session straddles a cut and none is
 * counted twice.
 */
function seedWindows(startTs, endTs) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const windows = [];
  let wStart = startTs;
  while (wStart < endTs) {
    const wEnd = Math.min(Math.floor(wStart / DAY_MS) * DAY_MS + DAY_MS, endTs);
    windows.push([wStart, wEnd]);
    wStart = wEnd;
  }
  return windows;
}

/**
 * @returns {{
 *   sessionCount: number,
 *   storeDwell: object,
 *   categoryMetrics: Map<string, object>,
 *   aislePenetration: object,
 *   stats: object,
 * }}
 */
export function computeExecutiveSessionAnalytics(
  db,
  venueId,
  startTs,
  endTs,
  classifiedRois,
  shoppingRoiIds,
  aisleRoiIds,
  metricThresholds,
  footfall = {},
) {
  const config = loadExecutiveVisitSessionConfig(db, venueId);
  const roiContext = resolveVenueRoiContext(db, venueId);
  const roiToCategory = buildRoiToCategoryMap(classifiedRois);
  const recoveredTrackKeys = footfall.recoveredTrackKeys || [];

  const aisleSet = new Set(aisleRoiIds);
  const dwellMs = metricThresholds.dwellMs;
  const engageMs = metricThresholds.engagementMs;

  const storeDwellMinutes = [];
  let sessionsWithAisleStop = 0;
  let sessionsEnteredAisle = 0;
  let totalSessions = 0;

  /** @type {Map<string, { sessionsEntering: number, sessionsStopped: number, maxDwellsMs: number[], episodeVisits: number, episodeDwells: number }>} */
  const categoryMetrics = new Map();
  const mergedStats = {
    entranceSessions: 0,
    convertedSessions: 0,
    unattributedCheckoutFragments: 0,
    unattributedBrowseFragments: 0,
    rawTrackKeys: 0,
    stitchedTrackKeys: 0,
    sessionModel: 'entrance_anchored',
  };

  // A session cannot outlive maxVisitDurationMs, so seeding one window at a time
  // with a matching read-ahead produces the same sessions while holding only one
  // window of visits in memory. Loading a 30d range in one go exhausted the heap.
  for (const [wStart, wSeedEnd] of seedWindows(startTs, endTs)) {
    const loadEnd = Math.min(wSeedEnd + config.maxVisitDurationMs, endTs);
    const windowVisits = loadSessionVisits(db, venueId, wStart, loadEnd);
    if (!windowVisits.length) continue;

    const { sessions, stats } = buildVisitSessions(
      db,
      venueId,
      wStart,
      loadEnd,
      config,
      roiContext,
      roiToCategory,
      {
        recoveredTrackKeys,
        preloadedVisits: windowVisits,
        seedStart: wStart,
        seedEnd: wSeedEnd,
      },
    );

    for (const key of Object.keys(mergedStats)) {
      if (typeof mergedStats[key] === 'number') mergedStats[key] += stats[key] || 0;
    }

    const visitsByTrack = new Map();
    for (const v of windowVisits) {
      let bucket = visitsByTrack.get(v.track_key);
      if (!bucket) {
        bucket = [];
        visitsByTrack.set(v.track_key, bucket);
      }
      bucket.push(v);
    }

    totalSessions += sessions.length;

    for (const session of sessions) {
      const sessionVisits = [];
      for (const trackKey of session.trackKeys) {
        const bucket = visitsByTrack.get(trackKey);
        if (!bucket) continue;
        for (const v of bucket) {
          if (v.start_time < session.startTime - 2000) continue;
          if (v.start_time > session.endTime + 2000) continue;
          sessionVisits.push(v);
        }
      }

      const shopMs = shoppingDwellMsForSession(sessionVisits, shoppingRoiIds);
      if (shopMs >= MIN_STORE_DWELL_MS && shopMs <= MAX_STORE_DWELL_MS) {
        storeDwellMinutes.push(shopMs / 60000);
      }

      const perCatMax = new Map();
      let sessionHasAisleStop = false;
      let sessionEnteredAisle = false;

      for (const v of sessionVisits) {
        if (!aisleSet.has(v.roi_id)) continue;
        sessionEnteredAisle = true;
        const cat = roiToCategory.get(v.roi_id) || 'Uncategorized';
        const dur = v.duration_ms ?? ((v.end_time || v.start_time) - v.start_time);

        if (!categoryMetrics.has(cat)) {
          categoryMetrics.set(cat, {
            sessionsEntering: 0,
            sessionsStopped: 0,
            maxDwellsMs: [],
            episodeVisits: 0,
            episodeDwells: 0,
            engagementEpisodes: 0,
          });
        }
        const agg = categoryMetrics.get(cat);
        agg.episodeVisits++;
        if (dur >= dwellMs) agg.episodeDwells++;
        if (dur >= engageMs) agg.engagementEpisodes++;

        perCatMax.set(cat, Math.max(perCatMax.get(cat) || 0, dur));
        if (dur >= dwellMs) sessionHasAisleStop = true;
      }

      if (sessionHasAisleStop) sessionsWithAisleStop++;
      if (sessionEnteredAisle) sessionsEnteredAisle++;

      for (const [cat, maxMs] of perCatMax) {
        const agg = categoryMetrics.get(cat);
        agg.sessionsEntering++;
        if (maxMs >= dwellMs) {
          agg.sessionsStopped++;
          agg.maxDwellsMs.push(maxMs);
        }
      }
    }
  }

  storeDwellMinutes.sort((a, b) => a - b);
  const storeDwell = {
    method: 'session_stitched_shopping_dwell',
    sessionCount: storeDwellMinutes.length,
    avgStoreDwellMin: storeDwellMinutes.length
      ? Math.round((storeDwellMinutes.reduce((s, m) => s + m, 0) / storeDwellMinutes.length) * 10) / 10
      : 0,
    medianStoreDwellMin: storeDwellMinutes.length
      ? Math.round(median(storeDwellMinutes) * 10) / 10
      : 0,
    dwellP25Min: storeDwellMinutes.length
      ? Math.round(percentile(storeDwellMinutes, 0.25) * 10) / 10
      : 0,
    dwellP75Min: storeDwellMinutes.length
      ? Math.round(percentile(storeDwellMinutes, 0.75) * 10) / 10
      : 0,
    reliable: storeDwellMinutes.length >= 10,
    minSessionMin: MIN_STORE_DWELL_MS / 60,
    maxSessionMin: MAX_STORE_DWELL_MS / 60000,
  };

  const entranceSessions = totalSessions;
  const penetrationPct = entranceSessions > 0
    ? pct(sessionsEnteredAisle, entranceSessions)
    : null;

  return {
    sessionCount: totalSessions,
    storeDwell,
    categoryMetrics,
    aislePenetration: {
      sessionsWithAisleStop,
      sessionsEnteredAisle,
      entranceSessions,
      penetrationPct,
      reliable: entranceSessions > 0,
    },
    stats: {
      ...mergedStats,
      stitchedSessions: totalSessions,
      storeDwellSessions: storeDwellMinutes.length,
    },
  };
}

export function buildSessionCategoryGroups(
  categoryMetrics,
  classifiedRois,
  db,
  startTs,
  endTs,
  metricThresholds,
  roiIdsByCategory,
) {
  const dwellMs = metricThresholds.dwellMs;
  const groups = [];

  for (const [category, m] of categoryMetrics) {
    if (isUntagged(category)) continue;

    const roiIds = roiIdsByCategory.get(category) || [];
    const maxDwells = [...m.maxDwellsMs].sort((a, b) => a - b);
    const medianDwellSec = maxDwells.length ? median(maxDwells) / 1000 : 0;
    const stoppingPowerPct = m.sessionsEntering > 0
      ? pct(m.sessionsStopped, m.sessionsEntering)
      : 0;
    const engagementPct = m.episodeVisits > 0
      ? pct(m.engagementEpisodes, m.episodeVisits)
      : 0;

    groups.push({
      category,
      visits: m.episodeVisits,
      uniqueVisitors: m.sessionsEntering,
      stoppingPowerPct,
      engagementPct,
      avgDwellMin: Math.round((medianDwellSec / 60) * 10) / 10,
      avgDwellSec: Math.round(medianDwellSec),
      medianDwellSec: Math.round(medianDwellSec * 10) / 10,
      sessionStopPct: stoppingPowerPct,
      roiCount: roiIds.length,
      roiIds,
      analyticsMethod: 'session_max_dwell_per_category',
    });
  }

  groups.sort((a, b) => b.visits - a.visits);
  return groups;
}

export function buildUntaggedCategorySummary(categoryMetrics) {
  let visits = 0;
  let untaggedTotal = 0;
  for (const [cat, m] of categoryMetrics) {
    if (!isUntagged(cat)) continue;
    visits += m.episodeVisits;
    untaggedTotal += m.episodeVisits;
  }
  return { visits, untaggedTotal };
}
