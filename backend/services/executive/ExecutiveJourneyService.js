/**
 * Esselunga Executive Journey KPI aggregation (LiDAR + ERP CSV).
 */

import { INGRESS_VISIT_COUNT_SQL } from '../../lib/ingressFootfall.js';
import { computeIngressFootfallWithRecovery } from '../../lib/ingressFootfallRecovery.js';
import { countPerimeterEntrants, fetchPerimeterEntrantsByHour } from '../../lib/ingressPerimeterFootfall.js';
import {
  isTrafficZoneName,
  formatStoreHoursRange,
  storeHourBucketIndices,
  aggregateByVenueLocalHour,
  venueLocalDateKey,
  venueLocalHour,
  venueHourBucketsForToday,
  formatHourLabel,
  DEFAULT_VENUE_TIMEZONE,
} from '../../lib/storeHours.js';
import {
  loadClassifiedRois,
  CHECKOUT_CHANNEL_LABELS,
  FRESCO_DEPT_LABELS,
} from './ExecutiveZoneTaxonomy.js';
import { fetchErpForRange } from './VenueErpStore.js';
import { ensureRoiCategoryLabels } from './roiCategorySync.js';
import {
  computeExecutiveSessionAnalytics,
  buildSessionCategoryGroups,
} from './ExecutiveSessionAnalytics.js';

function safeQuery(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch {
    return null;
  }
}

function safeQueryAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

function resolveStoreHours(db, venueId) {
  const row = safeQuery(db, 'SELECT opening_hour, closing_hour FROM venues WHERE id = ?', [venueId]);
  return {
    openingHour: row?.opening_hour ?? 8,
    closingHour: row?.closing_hour ?? 21,
    timeZone: DEFAULT_VENUE_TIMEZONE,
  };
}

function resolveShoppingRoiIds(classifiedRois) {
  return classifiedRois
    .filter(r => r.classification.group === 'aisles' || r.classification.group === 'fresco')
    .map(r => r.id);
}

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

/**
 * The distribution as shares, which is the part a single mean cannot carry.
 * Two zones can average the same and be nothing alike: one holding a quarter of
 * its visitors past twenty seconds, the other holding almost none but losing
 * fewer to a two-second walk-past. Ranking tells you which is better; this tells
 * you whether the zone is failing to attract or failing to hold.
 */
function bandShares(stats) {
  if (!stats?.visits) return null;
  return stats.bands.map(n => pct(n, stats.visits));
}

/**
 * Stopping Power counts a visitor who paused longer than this. Esselunga's own
 * KPI specification fixes it at 5 seconds, so that is what this report answers.
 *
 * It deliberately does not read venues.default_dwell_threshold_sec. That column
 * is the operational zone-dwell threshold: it stamps is_dwell on every stored
 * visit and is consumed by KPICalculator, the neural funnels, DOOH attribution
 * and replay insight. Treviglio has it at 20s, which was calibrated when zone
 * durations were quantised to a 10-15s tick and could not represent a 5s pause
 * at all. Retuning it to satisfy this report would silently re-cut all those
 * other metrics, and would only re-stamp visits written after the change,
 * leaving a mixed population behind. The executive figures are computed from
 * duration_ms at query time, so they can hold the contractual definition
 * without disturbing any of that.
 */
const STOPPING_POWER_SPEC_SEC = 5;

/**
 * The bar for ranking one fixture against another, which is a different job
 * from Stopping Power and wants a different number.
 *
 * Stopping Power at 5s answers a contractual question and answers it weakly:
 * across the 48 shelf zones with comparable traffic on 7 Aug, the share of
 * visits clearing 5s varies between zones with a coefficient of variation of
 * 0.276. Raise the bar and it climbs — 0.470 at 10s, 0.593 at 15s, 0.635 at
 * 20s, 0.703 at 30s — because a longer hold is a rarer and more deliberate act.
 *
 * The cost is coverage, and it is why this sits at 15 rather than higher: 15s
 * keeps 44 of the 48 zones reportable on 14% of visits, where 30s leaves only
 * 31 zones on 4.8%. Ranking a fixture list that has quietly lost a third of its
 * fixtures is worse than ranking it slightly less sharply.
 */
const ENGAGEMENT_RANK_SPEC_SEC = 15;

/**
 * Four in five checkout-queue visits are under five seconds — shoppers walking
 * past the lane, not queueing at it. Averaging those in reports a 4.2s wait,
 * which is why no store manager has ever believed the queue figure. This floor
 * excludes the pass-by so the wait describes people who actually waited.
 */
const QUEUE_FLOOR_SPEC_SEC = 10;

/** Where a visit stops being a pass-by and starts being a decision. */
const BAND_EDGES_SPEC_SEC = [5, 10, 20, 60];

/**
 * A query string carries no types, so an override arrives as text and can be
 * junk. Falling back on anything unparseable keeps a malformed request reading
 * the venue's own definition rather than propagating NaN into every threshold
 * comparison, where it would silently match nothing.
 */
function overrideSec(raw, fallback) {
  if (raw == null || raw === '') return { value: fallback, has: false };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return { value: fallback, has: false };
  return { value: Math.max(1, parsed), has: true };
}

/** Executive metrics use duration_ms directly, not stale is_dwell flags. */
export function resolveExecutiveMetricThresholds(db, venueId, opts = {}) {
  const {
    dwellThresholdSec, engagementThresholdSec, engagementRankSec, queueFloorSec, bandEdgesSec,
  } = opts;
  const venue = safeQuery(db, `
    SELECT default_dwell_threshold_sec, default_engagement_threshold_sec FROM venues WHERE id = ?
  `, [venueId]);

  const dwell = overrideSec(dwellThresholdSec, STOPPING_POWER_SPEC_SEC);
  const engagement = overrideSec(engagementThresholdSec, venue?.default_engagement_threshold_sec ?? 30);
  const rank = overrideSec(engagementRankSec, ENGAGEMENT_RANK_SPEC_SEC);
  const queueFloor = overrideSec(queueFloorSec, QUEUE_FLOOR_SPEC_SEC);

  const edges = Array.isArray(bandEdgesSec) && bandEdgesSec.length === 4
    ? bandEdgesSec.map(Number).filter(Number.isFinite)
    : BAND_EDGES_SPEC_SEC;
  const bandEdges = edges.length === 4 ? [...edges].sort((a, b) => a - b) : BAND_EDGES_SPEC_SEC;

  const overridden = dwell.has || engagement.has || rank.has || queueFloor.has;
  return {
    dwellSec: dwell.value,
    engagementSec: engagement.value,
    engagementRankSec: rank.value,
    queueFloorSec: queueFloor.value,
    bandEdgesSec: bandEdges,
    dwellMs: dwell.value * 1000,
    engagementMs: engagement.value * 1000,
    engagementRankMs: rank.value * 1000,
    queueFloorMs: queueFloor.value * 1000,
    bandEdgesMs: bandEdges.map(s => s * 1000),
    minVisitMs: 300,
    source: overridden ? 'preview' : 'venue_default',
  };
}

function fetchAisleDwellUnique(db, aisleRoiIds, startTs, endTs, dwellMs) {
  if (!aisleRoiIds.length) return 0;
  const ph = aisleRoiIds.map(() => '?').join(',');
  const row = safeQuery(db, `
    SELECT COUNT(DISTINCT track_key) as c
    FROM zone_visits
    WHERE roi_id IN (${ph})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
      AND duration_ms >= ?
  `, [...aisleRoiIds, startTs, endTs, dwellMs]);
  return row?.c || 0;
}

function buildJourneySignals(totalVisitors, footfall, aisleMetrics, checkoutChannels, checkoutCompleted, avgWaitMin) {
  const totalSessions = checkoutChannels.reduce((s, c) => s + c.sessions, 0);
  const avgAbandon = checkoutChannels.length
    ? Math.round(checkoutChannels.reduce((s, c) => s + (c.abandonPct || 0), 0) / checkoutChannels.length * 10) / 10
    : 0;

  return {
    reconciliationRequired: true,
    ingress: {
      visitors: totalVisitors,
      gateEstimated: footfall.directEstimated ?? footfall.directUnique,
      recovered: footfall.recoveredEstimated ?? 0,
    },
    shopping: {
      aisleZoneVisits: aisleMetrics.totalAisleVisits,
      dwellVisits: aisleMetrics.dwellVisits ?? 0,
      stoppingPct: aisleMetrics.stoppingPowerPct,
      passThroughPct: aisleMetrics.passThroughPct,
      bypassPct: aisleMetrics.bypassPct,
    },
    checkout: {
      sessionsCompleted: checkoutCompleted,
      totalSessions,
      avgWaitMin,
      abandonPct: avgAbandon,
      laneCount: checkoutChannels.length,
    },
  };
}

function resolveTrafficRoiIds(db, venueId) {
  const venue = safeQuery(db, 'SELECT footfall_roi_id FROM venues WHERE id = ?', [venueId]);
  const ids = [];
  if (venue?.footfall_roi_id) ids.push(venue.footfall_roi_id);
  const rois = safeQueryAll(db, 'SELECT id, name FROM regions_of_interest WHERE venue_id = ?', [venueId]);
  for (const r of rois) {
    if (isTrafficZoneName(r.name) && !ids.includes(r.id)) ids.push(r.id);
  }
  return ids;
}

function fetchIngressCount(db, venueId, roiIds, startTs, endTs) {
  if (!roiIds.length) return 0;
  const ph = roiIds.map(() => '?').join(',');
  const row = safeQuery(db, `
    SELECT ${INGRESS_VISIT_COUNT_SQL} as c
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
  `, [venueId, ...roiIds, startTs, endTs]);
  return row?.c || 0;
}

function fetchIngressUniqueCount(db, venueId, roiIds, startTs, endTs) {
  if (!roiIds.length) return 0;
  const ph = roiIds.map(() => '?').join(',');
  const row = safeQuery(db, `
    SELECT COUNT(DISTINCT track_key) as c
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
  `, [venueId, ...roiIds, startTs, endTs]);
  return row?.c || 0;
}

const EMPTY_ROI_STATS = Object.freeze({
  visits: 0,
  dwellVisits: 0,
  engagementVisits: 0,
  uniqueVisitors: 0,
  totalDurationMs: 0,
  avgDwellMs: 0,
});

/**
 * Bucket the whole window by ROI in one pass so every zone group (fresco
 * departments, aisle categories, the aisle total) can be summed in memory.
 * Previously each group issued its own range scans, which on a 7d window meant
 * well over a hundred scans of a multi-million-row table per request.
 */
function buildRoiStatsIndex(db, venueId, startTs, endTs, metricThresholds) {
  const { dwellMs, engagementMs, engagementRankMs, bandEdgesMs } = metricThresholds;
  const [b1, b2, b3, b4] = bandEdgesMs;

  const byRoi = new Map();
  for (const r of safeQueryAll(db, `
    SELECT roi_id,
      COUNT(*) AS visits,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) AS dwellVisits,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) AS engagementVisits,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) AS rankVisits,
      COUNT(DISTINCT track_key) AS uniqueVisitors,
      SUM(duration_ms) AS totalDurationMs,
      SUM(CASE WHEN duration_ms >= ? THEN duration_ms ELSE 0 END) AS dwellDurationMs,
      COUNT(CASE WHEN duration_ms < ? THEN 1 END) AS band0,
      COUNT(CASE WHEN duration_ms >= ? AND duration_ms < ? THEN 1 END) AS band1,
      COUNT(CASE WHEN duration_ms >= ? AND duration_ms < ? THEN 1 END) AS band2,
      COUNT(CASE WHEN duration_ms >= ? AND duration_ms < ? THEN 1 END) AS band3,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) AS band4
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
    GROUP BY roi_id
  `, [dwellMs, engagementMs, engagementRankMs, dwellMs,
    b1, b1, b2, b2, b3, b3, b4, b4,
    venueId, startTs, endTs])) {
    byRoi.set(r.roi_id, {
      visits: r.visits || 0,
      dwellVisits: r.dwellVisits || 0,
      engagementVisits: r.engagementVisits || 0,
      rankVisits: r.rankVisits || 0,
      uniqueVisitors: r.uniqueVisitors || 0,
      totalDurationMs: r.totalDurationMs || 0,
      dwellDurationMs: r.dwellDurationMs || 0,
      bands: [r.band0 || 0, r.band1 || 0, r.band2 || 0, r.band3 || 0, r.band4 || 0],
    });
  }

  // Fragmented live tracks emit repeated short episodes in the same zone, so a
  // real 20s stop can be split across several rows. Counting track x ROI pairs
  // whose summed duration clears each threshold recovers those stops; both
  // thresholds come out of one grouping pass.
  const dwellStopPairs = new Map();
  const engagementStopPairs = new Map();
  for (const r of safeQueryAll(db, `
    SELECT roi_id,
      SUM(CASE WHEN total >= ? THEN 1 ELSE 0 END) AS dwellPairs,
      SUM(CASE WHEN total >= ? THEN 1 ELSE 0 END) AS engagementPairs
    FROM (
      SELECT roi_id, track_key, SUM(duration_ms) AS total
      FROM zone_visits
      WHERE venue_id = ? AND start_time >= ? AND start_time < ?
        AND track_key NOT LIKE '%cashier%'
      GROUP BY roi_id, track_key
    )
    GROUP BY roi_id
  `, [dwellMs, engagementMs, venueId, startTs, endTs])) {
    dwellStopPairs.set(r.roi_id, r.dwellPairs || 0);
    engagementStopPairs.set(r.roi_id, r.engagementPairs || 0);
  }

  return {
    statsFor(roiIds) {
      if (!roiIds?.length) return { ...EMPTY_ROI_STATS };
      let visits = 0;
      let dwellVisits = 0;
      let engagementVisits = 0;
      let rankVisits = 0;
      let uniqueVisitors = 0;
      let totalDurationMs = 0;
      let dwellDurationMs = 0;
      let dwellStops = 0;
      let engagementStops = 0;
      const bands = [0, 0, 0, 0, 0];
      for (const id of roiIds) {
        const s = byRoi.get(id);
        if (s) {
          visits += s.visits;
          dwellVisits += s.dwellVisits;
          engagementVisits += s.engagementVisits;
          rankVisits += s.rankVisits;
          uniqueVisitors += s.uniqueVisitors;
          totalDurationMs += s.totalDurationMs;
          dwellDurationMs += s.dwellDurationMs;
          for (let i = 0; i < bands.length; i += 1) bands[i] += s.bands[i];
        }
        dwellStops += dwellStopPairs.get(id) || 0;
        engagementStops += engagementStopPairs.get(id) || 0;
      }
      return {
        visits,
        dwellVisits: Math.max(dwellVisits, dwellStops),
        engagementVisits: Math.max(engagementVisits, engagementStops),
        rankVisits,
        uniqueVisitors,
        totalDurationMs,
        avgDwellMs: dwellVisits > 0 ? dwellDurationMs / dwellVisits : 0,
        /**
         * Unconditioned mean: every visit, no threshold. Measured across the 48
         * shelf zones on 7 Aug it separates zones better than any thresholded
         * mean (CV 0.332 against 0.202 at 5s and 0.121 at 20s), because
         * conditioning on "longer than T" truncates the distribution and pulls
         * every zone toward T. It is also the only one that answers the plain
         * question of how long a shopper spends here.
         */
        avgAllMs: visits > 0 ? totalDurationMs / visits : 0,
        bands,
      };
    },
  };
}

/**
 * Exact distinct-visitor counts for several ROI groups in a single scan.
 * Summing per-ROI distinct counts would double-count a shopper who visits two
 * zones of the same group, so the grouping is pushed into SQL.
 */
function fetchUniqueVisitorsByGroup(db, venueId, startTs, endTs, groups) {
  const usable = groups.filter(g => g.roiIds?.length);
  if (!usable.length) return new Map();

  const branches = [];
  const branchParams = [];
  const allIds = [];
  usable.forEach((group, i) => {
    branches.push(`WHEN roi_id IN (${group.roiIds.map(() => '?').join(',')}) THEN ?`);
    branchParams.push(...group.roiIds, String(i));
    allIds.push(...group.roiIds);
  });

  const rows = safeQueryAll(db, `
    SELECT CASE ${branches.join(' ')} END AS gkey,
           COUNT(DISTINCT track_key) AS uniqueVisitors
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
      AND roi_id IN (${allIds.map(() => '?').join(',')})
    GROUP BY gkey
  `, [...branchParams, venueId, startTs, endTs, ...allIds]);

  const out = new Map();
  for (const r of rows) {
    if (r.gkey == null) continue;
    const group = usable[Number(r.gkey)];
    if (group) out.set(group.key, r.uniqueVisitors || 0);
  }
  return out;
}

/**
 * Per-request analysis context: the shared indexes plus everything the zone
 * rollups need, so each aggregate is computed once no matter how many callers
 * ask for it.
 */
function createJourneyContext(db, venueId, startTs, endTs, metricThresholds) {
  const uniqueCache = new Map();
  return {
    db,
    venueId,
    startTs,
    endTs,
    metricThresholds,
    roiStats: buildRoiStatsIndex(db, venueId, startTs, endTs, metricThresholds),
    queueStats: buildQueueStatsIndex(db, venueId, startTs, endTs, metricThresholds.queueFloorMs),
    uniqueVisitorsFor(groups) {
      const signature = groups
        .map(g => `${g.key}=${[...(g.roiIds || [])].sort().join('.')}`)
        .join('|');
      let out = uniqueCache.get(signature);
      if (!out) {
        out = fetchUniqueVisitorsByGroup(db, venueId, startTs, endTs, groups);
        uniqueCache.set(signature, out);
      }
      return out;
    },
  };
}

/**
 * Queue stats for every queue zone in the venue, in one scan.
 *
 * The floor is the whole argument here. Four in five visits to a checkout queue
 * zone last under five seconds, because the zone sits in the walkway and most
 * people cross it on the way somewhere else. Counting those as waits is what
 * produced an average wait of four seconds, a number that is arithmetically
 * correct and operationally worthless.
 */
function buildQueueStatsIndex(db, venueId, startTs, endTs, queueFloorMs) {
  const floorMs = Number.isFinite(queueFloorMs) ? queueFloorMs : 10_000;
  const byZone = new Map();
  for (const r of safeQueryAll(db, `
    SELECT qs.queue_zone_id AS zone,
      COUNT(*) AS sessions,
      SUM(CASE WHEN qs.is_abandoned = 0 THEN qs.waiting_time_ms ELSE 0 END) AS waitMsSum,
      SUM(CASE WHEN qs.is_abandoned = 0 THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN qs.is_abandoned = 1 THEN 1 ELSE 0 END) AS abandoned
    FROM queue_sessions qs
    JOIN regions_of_interest r ON r.id = qs.queue_zone_id
    WHERE r.venue_id = ?
      AND qs.queue_entry_time >= ? AND qs.queue_entry_time < ?
      AND qs.waiting_time_ms >= ?
    GROUP BY qs.queue_zone_id
  `, [venueId, startTs, endTs, floorMs])) {
    byZone.set(r.zone, r);
  }

  return {
    statsFor(roiIds) {
      if (!roiIds?.length) {
        return { sessions: 0, avgWaitMin: 0, avgWaitSec: 0, abandonPct: 0, completed: 0 };
      }
      let sessions = 0;
      let waitMsSum = 0;
      let completed = 0;
      let abandoned = 0;
      for (const id of roiIds) {
        const r = byZone.get(id);
        if (!r) continue;
        sessions += r.sessions || 0;
        waitMsSum += r.waitMsSum || 0;
        completed += r.completed || 0;
        abandoned += r.abandoned || 0;
      }
      return {
        sessions,
        avgWaitMin: completed > 0 ? Math.round((waitMsSum / completed / 60000) * 100) / 100 : 0,
        // A wait rounded to a tenth of a minute buckets every lane into
        // six-second steps, which makes a 14-second queue and a 19-second one
        // read the same. Seconds are what the reader is shown.
        avgWaitSec: completed > 0 ? Math.round(waitMsSum / completed / 1000) : 0,
        abandonPct: sessions > 0 ? Math.round((abandoned / sessions) * 1000) / 10 : 0,
        completed,
      };
    },
  };
}

function fetchFrescoBrowsingSplit(roiStats, serviceRoiIds, queueRoiIds, browseRoiIds) {
  const serviceStats = roiStats.statsFor(serviceRoiIds);
  const queueStats = roiStats.statsFor(queueRoiIds);
  const browseStats = roiStats.statsFor(browseRoiIds);

  const queueVisits = queueStats.visits;
  const browsingVisits = serviceStats.visits + browseStats.visits;
  const total = browsingVisits + queueVisits;

  if (!total) return { browsingPct: 0, waitingPct: 0, serviceVisits: 0, queueVisits: 0 };

  // No queue/service counters — use dwell rate on engagement zones as browsing proxy
  if (queueVisits === 0 && serviceStats.visits === 0 && browseStats.visits > 0) {
    const engagedPct = pct(browseStats.dwellVisits, browseStats.visits);
    return {
      browsingPct: engagedPct,
      waitingPct: 0,
      serviceVisits: browseStats.dwellVisits,
      queueVisits: 0,
    };
  }

  const waitingPct = pct(queueVisits, total);
  return {
    browsingPct: Math.round((100 - waitingPct) * 10) / 10,
    waitingPct,
    serviceVisits: serviceStats.visits + browseStats.visits,
    queueVisits,
  };
}

function buildFrescoDepartments(classifiedRois, ctx) {
  const { roiStats, queueStats } = ctx;
  const frescoRois = classifiedRois.filter(r => r.classification.group === 'fresco');
  const byDept = new Map();

  for (const roi of frescoRois) {
    const dept = roi.classification.subGroup || 'fresco';
    const displayLabel = roi.classification.categoryLabel || roi.linkedCategory
      || FRESCO_DEPT_LABELS[dept] || dept;
    if (!byDept.has(dept)) {
      byDept.set(dept, { serviceIds: [], queueIds: [], browseIds: [], displayLabel });
    }
    const bucket = byDept.get(dept);
    if (!bucket.displayLabel && displayLabel) bucket.displayLabel = displayLabel;
    if (roi.classification.role === 'queue') bucket.queueIds.push(roi.id);
    else if (roi.classification.role === 'service') bucket.serviceIds.push(roi.id);
    else bucket.browseIds.push(roi.id);
  }

  const deptEntries = [...byDept.entries()];
  const uniqueByDept = ctx.uniqueVisitorsFor(deptEntries.map(([dept, ids]) => ({
    key: dept,
    roiIds: [...ids.serviceIds, ...ids.queueIds, ...ids.browseIds],
  })));

  return deptEntries.map(([dept, ids]) => {
    const allIds = [...ids.serviceIds, ...ids.queueIds, ...ids.browseIds];
    const stats = roiStats.statsFor(allIds);
    const split = fetchFrescoBrowsingSplit(roiStats, ids.serviceIds, ids.queueIds, ids.browseIds);
    const deptQueueStats = queueStats.statsFor(ids.queueIds);
    const hasQueueZones = ids.queueIds.length > 0;
    const stoppingPct = stats.visits > 0 ? pct(stats.dwellVisits, stats.visits) : 0;
    const passThroughPct = Math.max(0, Math.round((100 - stoppingPct) * 10) / 10);
    // Total time over distinct shoppers, matching how the aisles are measured:
    // it answers "how long does a shopper spend at this counter" and survives a
    // track being split into several episodes, which a per-episode mean does not.
    const deptUnique = uniqueByDept.get(dept) ?? stats.uniqueVisitors;
    const avgDwellSec = deptUnique > 0 ? Math.round(stats.totalDurationMs / deptUnique / 1000) : 0;
    const avgDwellMin = avgDwellSec > 0 ? Math.round((avgDwellSec / 60) * 10) / 10 : 0;

    return {
      id: dept,
      label: ids.displayLabel || FRESCO_DEPT_LABELS[dept] || dept.replace(/_/g, ' '),
      visits: stats.visits,
      dwellVisits: stats.dwellVisits,
      engagementVisits: stats.engagementVisits,
      uniqueVisitors: deptUnique,
      avgDwellMin,
      avgDwellSec,
      engagementRatePct: stats.visits > 0 ? pct(stats.rankVisits, stats.visits) : 0,
      bands: bandShares(stats),
      stoppingPct,
      passThroughPct,
      hasQueueZones,
      browsingPct: stoppingPct,
      waitingPct: split.waitingPct,
      abandonPct: deptQueueStats.abandonPct,
      serviceEfficiency: deptQueueStats.completed > 0
        ? Math.round((deptQueueStats.completed / Math.max(deptQueueStats.sessions, 1)) * 1000) / 10
        : null,
      roiIds: allIds,
    };
  }).sort((a, b) => b.visits - a.visits);
}

/**
 * "Checkout 5 - Queue" and "Checkout 5 - Service" are two zones of one till.
 * Grouping on the number keeps a lane a lane; anything unnumbered falls back to
 * its own name so an oddly-labelled zone is still reported rather than merged
 * into a stranger.
 */
function checkoutLaneKey(name) {
  const m = /(?:checkout|cassa)\s*0*(\d+)/i.exec(name || '');
  return m ? `#${m[1]}` : (name || '').trim() || 'unnamed';
}

function buildCheckoutChannels(classifiedRois, ctx) {
  const { db, endTs, queueStats } = ctx;
  const checkoutRois = classifiedRois.filter(r => r.classification.group === 'checkout');
  const byChannel = new Map();

  const push = (channel, roi) => {
    if (!byChannel.has(channel)) byChannel.set(channel, []);
    byChannel.get(channel).push(roi);
  };

  for (const roi of checkoutRois) {
    push(roi.classification.subGroup || 'traditional', roi);
  }

  if (byChannel.size === 0) {
    for (const roi of classifiedRois) {
      const n = roi.name.toLowerCase();
      if (n.includes('queue') && n.includes('checkout')) push('traditional', roi);
    }
  }

  // Loop-invariant, and scoped to the checkout ROIs so it rides
  // idx_zone_occupancy_roi_time. Filtering by venue_id instead has no index and
  // cost a full scan of millions of occupancy rows on every request.
  const allCheckoutRois = [...byChannel.values()].flat();
  const allCheckoutRoiIds = allCheckoutRois.map(r => r.id);
  const latestTs = allCheckoutRoiIds.length
    ? safeQuery(db, `
      SELECT MAX(timestamp) as ts FROM zone_occupancy
      WHERE roi_id IN (${allCheckoutRoiIds.map(() => '?').join(',')}) AND timestamp <= ?
    `, [...allCheckoutRoiIds, endTs])?.ts
    : null;

  // One grouped read for every checkout zone, so adding per-lane queue counts
  // costs nothing beyond the query already being made for the channel totals.
  const queueNow = new Map();
  if (latestTs && allCheckoutRoiIds.length) {
    const ph = allCheckoutRoiIds.map(() => '?').join(',');
    for (const r of safeQueryAll(db, `
      SELECT roi_id, SUM(occupancy_count) AS total FROM zone_occupancy
      WHERE roi_id IN (${ph}) AND timestamp = ?
      GROUP BY roi_id
    `, [...allCheckoutRoiIds, latestTs])) {
      queueNow.set(r.roi_id, r.total || 0);
    }
  }
  const queuedIn = (ids) => ids.reduce((a, id) => a + (queueNow.get(id) || 0), 0);

  return [...byChannel.entries()].map(([channel, rois]) => {
    const roiIds = rois.map(r => r.id);
    const q = queueStats.statsFor(roiIds);

    const byLane = new Map();
    for (const roi of rois) {
      const key = checkoutLaneKey(roi.name);
      if (!byLane.has(key)) byLane.set(key, { queueIds: [], allIds: [] });
      const lane = byLane.get(key);
      lane.allIds.push(roi.id);
      const isQueue = roi.classification.role === 'queue'
        || roi.name.toLowerCase().includes('queue');
      if (isQueue) lane.queueIds.push(roi.id);
    }

    const lanes = [...byLane.entries()]
      .map(([label, ids]) => {
        // Wait means time spent queuing, so it is read off the queue zone. A
        // lane with no queue zone mapped falls back to all of its zones rather
        // than reporting nothing.
        const waitIds = ids.queueIds.length ? ids.queueIds : ids.allIds;
        const s = queueStats.statsFor(waitIds);
        return {
          id: label,
          label,
          sessions: s.sessions,
          completed: s.completed,
          avgWaitMin: s.avgWaitMin,
          avgWaitSec: s.avgWaitSec,
          abandonPct: s.abandonPct,
          currentQueue: queuedIn(waitIds),
          roiIds: ids.allIds,
        };
      })
      .filter(l => l.sessions > 0 || l.currentQueue > 0)
      .sort((a, b) => b.sessions - a.sessions);

    return {
      id: channel,
      label: CHECKOUT_CHANNEL_LABELS[channel] || channel,
      sessions: q.sessions,
      completed: q.completed,
      avgWaitMin: q.avgWaitMin,
      avgWaitSec: q.avgWaitSec,
      abandonPct: q.abandonPct,
      currentQueue: queuedIn(roiIds),
      roiIds,
      lanes,
    };
  });
}

function categoryGroupToHeatmapRow(g) {
  return {
    category: g.category,
    zoneCount: g.roiCount || 0,
    roiIds: g.roiIds || [],
    totalVisits: g.visits || 0,
    totalDwellMin: g.avgDwellMin || 0,
    browsingRate: g.stoppingPowerPct || 0,
    engagementRate: g.engagementPct || 0,
    conversionRate: 0,
    avgBrowseTimeMin: g.avgDwellMin || 0,
    avgBrowseTimeSec: g.avgDwellSec || 0,
  };
}

function frescoDeptToHeatmapRow(d) {
  return {
    category: d.label,
    zoneCount: d.roiIds?.length || 0,
    roiIds: d.roiIds || [],
    totalVisits: d.visits || 0,
    totalDwellMin: d.avgDwellMin || 0,
    browsingRate: d.stoppingPct || 0,
    engagementRate: d.visits > 0 ? pct(d.engagementVisits || 0, d.visits) : 0,
    conversionRate: 0,
    avgBrowseTimeMin: d.avgDwellMin || 0,
    avgBrowseTimeSec: d.avgDwellSec || 0,
  };
}

/** Merge aisle + fresco categories for heatmap / top-categories (min 5 when data exists). */
function buildHeatmapCategories(categoryGroups, frescoDepartments = [], aisleFallbackGroups = []) {
  const merged = new Map();
  const add = (row) => {
    if (!row.category || /^(uncategorized|no content available)$/i.test(row.category)) return;
    if (!(row.roiIds?.length)) return;
    const prev = merged.get(row.category);
    if (!prev || row.totalVisits > prev.totalVisits) merged.set(row.category, row);
  };

  for (const g of categoryGroups || []) add(categoryGroupToHeatmapRow(g));
  for (const g of aisleFallbackGroups || []) {
    if (categoryGroups?.some(c => c.category === g.category)) continue;
    add(categoryGroupToHeatmapRow(g));
  }
  for (const d of frescoDepartments || []) add(frescoDeptToHeatmapRow(d));

  return [...merged.values()]
    .filter(r => r.totalVisits > 0)
    .sort((a, b) => b.totalVisits - a.totalVisits);
}

function formatDayLabel(isoDate) {
  try {
    const d = new Date(`${isoDate}T12:00:00`);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
  } catch {
    return isoDate?.slice(5) || isoDate;
  }
}

function emptyHourlyTimeline(openingHour = 8, closingHour = 20) {
  const hours = storeHourBucketIndices(openingHour, closingHour);
  const mk = () => hours.map(h => ({
    label: `${String(h).padStart(2, '0')}:00`,
    value: 0,
  }));
  return { grain: 'hour', visitors: mk(), dwells: mk() };
}

/**
 * Bucket a zone_visits range into UTC hours. Venue-local hour/day mapping then
 * runs over one row per hour instead of every episode — the offsets involved are
 * whole hours, so a UTC hour never straddles two local hours or dates.
 */
function fetchVisitCountsByUtcHour(db, venueId, roiIds, startTs, endTs, minDurationMs = null) {
  if (!roiIds.length) return [];
  const ph = roiIds.map(() => '?').join(',');
  const params = [venueId, ...roiIds, startTs, endTs];
  let durationClause = '';
  if (minDurationMs != null) {
    durationClause = ' AND duration_ms >= ?';
    params.push(minDurationMs);
  }
  return safeQueryAll(db, `
    SELECT CAST(start_time / 3600000 AS INTEGER) AS utcHour, COUNT(*) AS c
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${ph})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'${durationClause}
    GROUP BY utcHour
  `, params).map(r => ({ ts: r.utcHour * 3600000, count: r.c || 0 }));
}

function mapHourlyBuckets(hours, rowMap) {
  return hours.map(h => ({
    label: `${String(h).padStart(2, '0')}:00`,
    value: rowMap.get(h) || 0,
  }));
}

function fetchHourlyTimeline(
  db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs,
  openingHour, closingHour, timeZone = DEFAULT_VENUE_TIMEZONE,
) {
  const todayKey = venueLocalDateKey(endTs, timeZone);
  const hours = venueHourBucketsForToday(endTs, openingHour, closingHour, timeZone);
  if (!hours.length) {
    return {
      grain: 'hour',
      visitors: [],
      dwells: [],
      dateKey: todayKey,
      timeZone,
      throughHour: null,
    };
  }

  // Wide query window; only calendar-today rows in venue TZ are counted.
  const queryStart = Math.min(startTs, endTs - 36 * 3600000);

  const perimeterRows = trafficRoiIds.length
    ? fetchPerimeterEntrantsByHour(
      db, trafficRoiIds, queryStart, endTs, openingHour, closingHour, timeZone, todayKey,
    )
    : [];
  const vMap = new Map(perimeterRows.map(r => [Number(r.hour), Number(r.value) || 0]));

  const dMap = aggregateByVenueLocalHour(
    fetchVisitCountsByUtcHour(db, venueId, shoppingRoiIds, queryStart, endTs, dwellMs),
    r => r.ts,
    r => r.count,
    openingHour,
    closingHour,
    timeZone,
    todayKey,
  );

  const throughHour = hours[hours.length - 1] ?? null;
  return {
    grain: 'hour',
    visitors: mapHourlyBuckets(hours, vMap),
    dwells: mapHourlyBuckets(hours, dMap),
    dateKey: todayKey,
    timeZone,
    throughHour,
    throughHourLabel: throughHour != null ? formatHourLabel(throughHour) : null,
  };
}

function fetchDailyTimeline(
  db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs,
  timeZone = DEFAULT_VENUE_TIMEZONE,
) {
  const visitorMap = new Map();
  for (const bucket of fetchVisitCountsByUtcHour(db, venueId, trafficRoiIds, startTs, endTs)) {
    const key = venueLocalDateKey(bucket.ts, timeZone);
    visitorMap.set(key, (visitorMap.get(key) || 0) + bucket.count);
  }

  const dwellMap = new Map();
  for (const bucket of fetchVisitCountsByUtcHour(db, venueId, shoppingRoiIds, startTs, endTs, dwellMs)) {
    const key = venueLocalDateKey(bucket.ts, timeZone);
    dwellMap.set(key, (dwellMap.get(key) || 0) + bucket.count);
  }

  const daySet = new Set([
    ...visitorMap.keys(),
    ...dwellMap.keys(),
  ]);
  const days = [...daySet].sort();
  const vMap = Object.fromEntries(visitorMap);
  const dMap = Object.fromEntries(dwellMap);

  return {
    grain: 'day',
    visitors: days.map(d => ({
      label: formatDayLabel(d),
      value: vMap[d] || 0,
    })),
    dwells: days.map(d => ({
      label: formatDayLabel(d),
      value: dMap[d] || 0,
    })),
  };
}

/**
 * Every hour of the requested window, regardless of store hours. Used when the
 * store-hours view for "today" is empty — outside opening hours that produced a
 * blank chart even though the window itself held a full trading day.
 */
function fetchTrailingHourlyTimeline(
  db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs,
  timeZone = DEFAULT_VENUE_TIMEZONE,
) {
  const HOUR_MS = 3600000;
  const toHour = ts => Math.floor(ts / HOUR_MS);
  const vMap = new Map();
  for (const b of fetchVisitCountsByUtcHour(db, venueId, trafficRoiIds, startTs, endTs)) {
    vMap.set(toHour(b.ts), b.count);
  }
  const dMap = new Map();
  for (const b of fetchVisitCountsByUtcHour(db, venueId, shoppingRoiIds, startTs, endTs, dwellMs)) {
    dMap.set(toHour(b.ts), b.count);
  }

  const spansDays = venueLocalDateKey(startTs, timeZone) !== venueLocalDateKey(endTs, timeZone);
  const visitors = [];
  const dwells = [];
  for (let h = toHour(startTs); h <= toHour(endTs - 1); h++) {
    const ts = h * HOUR_MS;
    const hourLabel = `${String(venueLocalHour(ts, timeZone)).padStart(2, '0')}:00`;
    const label = spansDays
      ? `${formatDayLabel(venueLocalDateKey(ts, timeZone))} ${hourLabel}`
      : hourLabel;
    visitors.push({ label, value: vMap.get(h) || 0 });
    dwells.push({ label, value: dMap.get(h) || 0 });
  }

  return { grain: 'hour', visitors, dwells, timeZone, trailing: true };
}

function fetchActivityTimelines(
  db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs,
  openingHour, closingHour, timeZone = DEFAULT_VENUE_TIMEZONE,
) {
  const hourly = fetchHourlyTimeline(
    db, venueId, endTs - 24 * 3600000, endTs, trafficRoiIds, shoppingRoiIds, dwellMs,
    openingHour, closingHour, timeZone,
  );
  const daily = fetchDailyTimeline(
    db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs, timeZone,
  );

  const spanMs = endTs - startTs;
  let activityTimeline = spanMs <= 36 * 3600000 ? hourly : daily;
  let trailingHourly = null;
  if (activityTimeline === hourly && hourly.visitors.length === 0) {
    trailingHourly = fetchTrailingHourlyTimeline(
      db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs, timeZone,
    );
    activityTimeline = trailingHourly;
  }

  return { hourly, daily, trailingHourly, activityTimeline };
}

function buildAisleCategoryGroups(classifiedRois, ctx) {
  const { roiStats } = ctx;
  const aisleRois = classifiedRois.filter(r => r.classification.group === 'aisles');
  const byCat = new Map();

  for (const roi of aisleRois) {
    const cat = roi.classification.categoryLabel || roi.linkedCategory
      || roi.classification.subGroup || 'Uncategorized';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(roi.id);
  }

  const catEntries = [...byCat.entries()];
  const uniqueByCat = ctx.uniqueVisitorsFor(
    catEntries.map(([category, roiIds]) => ({ key: category, roiIds })),
  );

  return catEntries.map(([category, roiIds]) => {
    const stats = roiStats.statsFor(roiIds);
    const uniqueVisitors = uniqueByCat.get(category) ?? stats.uniqueVisitors;
    return {
      category,
      visits: stats.visits,
      uniqueVisitors,
      stoppingPowerPct: stats.visits > 0 ? pct(stats.dwellVisits, stats.visits) : 0,
      engagementPct: stats.visits > 0 ? pct(stats.engagementVisits, stats.visits) : 0,
      engagementRatePct: stats.visits > 0 ? pct(stats.rankVisits, stats.visits) : 0,
      bands: bandShares(stats),
      avgDwellMin: uniqueVisitors > 0
        ? Math.round((stats.totalDurationMs / uniqueVisitors) / 60000 * 10) / 10
        : 0,
      avgDwellSec: uniqueVisitors > 0
        ? Math.round((stats.totalDurationMs / uniqueVisitors) / 1000)
        : 0,
      roiCount: roiIds.length,
      roiIds,
    };
  }).sort((a, b) => b.visits - a.visits);
}

function buildAisleMetrics(classifiedRois, ctx, totalVisitors, sessionAnalytics) {
  const { db, startTs, endTs, metricThresholds, roiStats } = ctx;
  const aisleRois = classifiedRois.filter(r => r.classification.group === 'aisles');
  const roiIds = aisleRois.map(r => r.id);
  const stats = roiStats.statsFor(roiIds);

  const roiIdsByCategory = new Map();
  for (const roi of aisleRois) {
    const cat = roi.classification.categoryLabel || roi.linkedCategory
      || roi.classification.subGroup || 'Uncategorized';
    if (!roiIdsByCategory.has(cat)) roiIdsByCategory.set(cat, []);
    roiIdsByCategory.get(cat).push(roi.id);
  }

  const categoryGroups = (() => {
    const sessionGroups = sessionAnalytics?.categoryMetrics
      ? buildSessionCategoryGroups(
        sessionAnalytics.categoryMetrics,
        classifiedRois,
        db,
        startTs,
        endTs,
        metricThresholds,
        roiIdsByCategory,
      )
      : [];
    if (sessionGroups.length > 0) return sessionGroups;
    return buildAisleCategoryGroups(classifiedRois, ctx)
      .filter(g => g.category && !/^(uncategorized|no content available)$/i.test(g.category));
  })();

  const penetrationPct = sessionAnalytics?.aislePenetration?.reliable
    ? sessionAnalytics.aislePenetration.penetrationPct
    : null;
  const aisleDwellUnique = sessionAnalytics?.aislePenetration?.sessionsWithAisleStop
    ?? fetchAisleDwellUnique(db, roiIds, startTs, endTs, metricThresholds.dwellMs);
  const aisleReachReliable = sessionAnalytics?.aislePenetration?.reliable
    ?? (totalVisitors > 0 && aisleDwellUnique <= totalVisitors * 1.05);
  const stoppingPowerPct = stats.visits > 0 ? pct(stats.dwellVisits, stats.visits) : 0;

  // These are two different questions that used to share one field. Of the
  // crossings that happened, how many did not stop? That is pass-through, and it
  // is what the ring gauge has always been labelled.
  const passThroughPct = Math.max(0, Math.round((100 - stoppingPowerPct) * 10) / 10);

  // Bypass, as Esselunga define it, is 100 - penetration: the share of store
  // visitors who skipped the category entirely. Null rather than 100 when
  // penetration cannot be measured, so an unknown never reads as "everybody
  // walked past".
  const bypassPct = penetrationPct != null
    ? Math.max(0, Math.round((100 - penetrationPct) * 10) / 10)
    : null;

  // Reading from the shared index makes ranking every aisle as cheap as the
  // arbitrary first-20 slice this used to settle for.
  const topAisles = [];
  for (const roi of aisleRois) {
    const s = roiStats.statsFor([roi.id]);
    if (s.visits === 0) continue;
    topAisles.push({
      id: roi.id,
      name: roi.name,
      category: roi.classification.categoryLabel || roi.linkedCategory
        || roi.classification.subGroup || 'Uncategorized',
      visits: s.visits,
      stoppingPowerPct: pct(s.dwellVisits, s.visits),
      // The ranking metric. Across the shelf zones it spreads roughly five times
      // wider than Stopping Power does, which is what makes a fixture list
      // orderable rather than a column of near-identical percentages.
      engagementRatePct: pct(s.rankVisits, s.visits),
      bands: bandShares(s),
      avgDwellMin: s.uniqueVisitors > 0
        ? Math.round((s.totalDurationMs / s.uniqueVisitors) / 60000 * 10) / 10
        : 0,
      // Rounding to a tenth of a minute buckets every zone into multiples of
      // six seconds, which makes genuinely different zones look identical and
      // reads as sensor quantisation when it is only our arithmetic. Seconds
      // are what the reader is shown, so seconds are what we round to.
      avgDwellSec: s.uniqueVisitors > 0
        ? Math.round((s.totalDurationMs / s.uniqueVisitors) / 1000)
        : 0,
    });
  }
  // Surfaced so the tab can say how much of the floor is unaccounted for. A
  // reader who sees "Uncategorized" against the busiest shelf should be told
  // it is a gap in the shelf mapper, not a category the store actually sells.
  const untaggedZones = topAisles.filter(a => a.category === 'Uncategorized').length;
  const taggedZones = topAisles.length - untaggedZones;

  topAisles.sort((a, b) => b.visits - a.visits);
  topAisles.splice(20);

  return {
    untaggedZones,
    taggedZones,
    penetrationPct,
    aisleDwellUnique,
    aisleReachReliable,
    dwellVisits: stats.dwellVisits,
    engagementVisits: stats.engagementVisits,
    engagementRatePct: stats.visits > 0 ? pct(stats.rankVisits, stats.visits) : 0,
    bands: bandShares(stats),
    stoppingPowerPct,
    passThroughPct,
    bypassPct,
    totalAisleVisits: stats.visits,
    categoryGroups,
    topAisles: topAisles.slice(0, 8),
  };
}

function computeCrossKpis(erp, ingressCount, avgStoreDwellMin, avgWaitMin, mediaKpis) {
  const shoppingEfficiency = erp.avgTicket != null && avgStoreDwellMin > 0
    ? Math.round((erp.avgTicket / avgStoreDwellMin) * 100) / 100
    : null;

  const storeAreaSqm = erp.byCategory.reduce((s, c) => s + (c.areaSqm || 0), 0) || null;
  let spi = null;
  if (erp.totalRevenue > 0 && avgStoreDwellMin > 0 && storeAreaSqm) {
    const dwellHours = (avgStoreDwellMin * ingressCount) / 60;
    if (dwellHours > 0) {
      spi = Math.round((erp.totalRevenue / (storeAreaSqm * dwellHours)) * 100) / 100;
    }
  }
  if (spi == null && erp.totalRevenue > 0 && avgStoreDwellMin > 0) {
    spi = Math.round((erp.totalRevenue / avgStoreDwellMin) * 100) / 100;
  }

  const frictionScore = avgWaitMin > 0 && avgStoreDwellMin > 0
    ? Math.round((avgWaitMin / avgStoreDwellMin) * 100) / 100
    : null;

  return {
    spi,
    spiSource: erp.hasData ? 'erp' : 'unavailable',
    shoppingEfficiency,
    checkoutFrictionScore: frictionScore,
    avgTicket: erp.avgTicket,
    totalRevenue: erp.hasData ? erp.totalRevenue : null,
    mediaCes: mediaKpis.ces,
    mediaEal: mediaKpis.eal,
  };
}

function fetchMediaKpis(db, venueId, startTs, endTs) {
  const row = safeQuery(db, `
    SELECT
      AVG(CASE WHEN controls_count > 0 THEN ces_score END) as ces,
      AVG(lift_rel) * 100 as eal
    FROM dooh_campaign_kpis
    WHERE venue_id = ? AND bucket_start_ts >= ? AND bucket_start_ts <= ?
  `, [venueId, startTs, endTs]) || {};
  return {
    ces: Math.round((row.ces || 0) * 10) / 10,
    eal: Math.round((row.eal || 0) * 10) / 10,
  };
}

function buildInsights(payload) {
  const insights = [];

  const worstFresco = [...(payload.fresco.departments || [])]
    .filter(d => d.waitingPct > 15)
    .sort((a, b) => b.waitingPct - a.waitingPct)[0];
  if (worstFresco) {
    insights.push({
      id: 'fresco-wait',
      severity: 'warn',
      title: `${worstFresco.label}: elevated waiting`,
      message: `${worstFresco.waitingPct}% of time in queue vs browsing — review staffing at service counter.`,
      action: 'Review service counter staffing',
      section: 'fresco',
    });
  }

  const worstCheckout = [...(payload.checkout.channels || [])]
    .sort((a, b) => (b.abandonPct || 0) - (a.abandonPct || 0))[0];
  if (worstCheckout && worstCheckout.abandonPct > 10) {
    insights.push({
      id: 'checkout-abandon',
      severity: 'bad',
      title: `${worstCheckout.label} abandon rate high`,
      message: `${worstCheckout.abandonPct}% abandon · avg wait ${worstCheckout.avgWaitMin} min.`,
      action: 'Open additional lane or redirect to self-checkout',
      section: 'checkout',
    });
  }

  const topAisle = payload.aisles.topAisles?.[0];
  if (topAisle && payload.aisles.penetrationPct != null && payload.aisles.penetrationPct < 40) {
    insights.push({
      id: 'aisle-penetration',
      severity: 'info',
      title: 'Aisle penetration below target',
      message: `Only ${payload.aisles.penetrationPct}% of entrants reach aisles. Top aisle: ${topAisle.name}.`,
      action: 'Review layout and signage toward high-traffic aisles',
      section: 'aisles',
    });
  }

  if (payload.crossKpis.spi != null && payload.crossKpis.spi < 50) {
    insights.push({
      id: 'spi-low',
      severity: 'warn',
      title: 'SPI below benchmark',
      message: `Store productivity index is ${payload.crossKpis.spi} — dwell not converting to revenue efficiently.`,
      action: 'Cross-reference top dwell zones with ERP category sales',
      section: 'overview',
    });
  }

  if (payload.media.ces > 50) {
    insights.push({
      id: 'media-strong',
      severity: 'good',
      title: 'Retail media performing well',
      message: `Campaign effectiveness score ${payload.media.ces} with ${payload.media.eal}% exposure lift.`,
      action: 'Extend high-performing screen placements',
      section: 'media',
    });
  }

  return insights.slice(0, 3);
}

/**
 * The same window one week earlier, so every headline number can carry a
 * direction. Esselunga's own mock states its KPIs as "▲ 4% vs sett. scorsa",
 * and a number with no comparison is not a management report.
 *
 * A week back rather than the previous day, because supermarket traffic is
 * strongly weekday-shaped and Saturday against Friday would mostly measure the
 * calendar.
 *
 * Only for windows up to 36h. A 7d window takes around 12s to build at
 * Treviglio, and doubling that to decorate four tiles is not a trade worth
 * making.
 */
const COMPARISON_MAX_SPAN_MS = 36 * 60 * 60 * 1000;
const COMPARISON_SHIFT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The date the pipeline changed in two ways that both break comparison with
 * anything earlier.
 *
 * Zone dwell moved from one sample per storage tick to frame rate, so short
 * pauses stopped collapsing to zero: the share of aisle visits over 5s went
 * from roughly 21% to 49% on the day, with no matching change in the store.
 * Ingestion also stopped depending on a browser being subscribed, which had
 * been silently dropping traffic — 5 August recorded no entrants at all.
 *
 * So neither the durations nor the counts are like-for-like across it. Deltas
 * are withheld rather than estimated until a full week of history exists on
 * the far side, because reporting a measurement fix as a week of spectacular
 * trading is the one mistake this report cannot make while we are disputing
 * data quality with the perception vendor.
 */
const MEASUREMENT_EPOCH_MS = Date.parse(process.env.MEASUREMENT_EPOCH || '2026-08-06T00:00:00+02:00');

function buildComparison(db, venueId, startTs, endTs, variant, metricThresholdOpts) {
  if (endTs - startTs > COMPARISON_MAX_SPAN_MS) return null;

  let prev;
  try {
    prev = computeExecutiveJourney(
      db,
      venueId,
      startTs - COMPARISON_SHIFT_MS,
      endTs - COMPARISON_SHIFT_MS,
      variant,
      { ...metricThresholdOpts, skipComparison: true },
    );
  } catch (err) {
    console.warn('[ExecutiveJourney] comparison window failed:', err.message);
    return null;
  }

  const prevStart = startTs - COMPARISON_SHIFT_MS;

  return {
    label: 'same window, previous week',
    range: { startTs: prevStart, endTs: endTs - COMPARISON_SHIFT_MS },
    comparable: Number.isFinite(MEASUREMENT_EPOCH_MS) ? prevStart >= MEASUREMENT_EPOCH_MS : true,
    caveat: 'counting and dwell measurement both changed on 6 August, so a comparison back to before then would report the fix as a change in trade',
    entrants: prev.overview.perimeterEntrants ?? 0,
    totalVisitors: prev.overview.totalVisitors,
    shoppingDwellMin: prev.overview.avgStoreDwellMin,
    shoppingDwellReliable: prev.overview.avgStoreDwellReliable === true,
    stoppingPowerPct: prev.aisles.stoppingPowerPct,
    penetrationPct: prev.aisles.penetrationPct,
    checkoutCompleted: prev.checkout.completed ?? 0,
    avgWaitMin: prev.checkout.avgWaitMin,
    avgTicket: prev.overview.avgTicket,
    spi: prev.overview.spi,
  };
}

function relDelta(now, before) {
  if (!Number.isFinite(now) || !Number.isFinite(before) || before <= 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

function formatWait(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const total = Math.round(minutes * 60);
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

/**
 * The numbers the report leads with, resolved once on the server so the screen
 * and the PDF cannot drift apart. Ordered as the shopper moves: in, along the
 * shelf, out.
 */
function buildHeadlineKpis(payload) {
  const cmp = payload.comparison;
  const o = payload.overview;

  const items = [
    {
      id: 'entrants',
      label: 'Entrants',
      value: o.perimeterEntrants ?? 0,
      display: (o.perimeterEntrants ?? 0).toLocaleString(),
      hint: 'people crossing the entrance line',
      previous: cmp?.entrants ?? null,
      higherIsBetter: true,
    },
    {
      id: 'stopping',
      label: 'Stopping power',
      value: payload.aisles.stoppingPowerPct,
      display: `${payload.aisles.stoppingPowerPct}%`,
      hint: `aisle crossings with a pause over ${payload.metricThresholds.dwellSec}s`,
      previous: cmp?.stoppingPowerPct ?? null,
      higherIsBetter: true,
    },
    {
      id: 'dwell',
      // Deliberately not "store dwell": this is time inside tracked zones, not
      // the entrance-to-exit total, and the two differ by an order of magnitude.
      label: 'Shopping dwell',
      value: o.avgStoreDwellReliable ? o.avgStoreDwellMin : null,
      display: o.avgStoreDwellReliable ? `${o.avgStoreDwellMin}m` : '—',
      hint: 'median time in tracked zones per visit',
      previous: cmp?.shoppingDwellReliable ? cmp.shoppingDwellMin : null,
      higherIsBetter: true,
    },
    {
      id: 'wait',
      label: 'Checkout wait',
      value: payload.checkout.avgWaitMin,
      display: formatWait(payload.checkout.avgWaitMin),
      hint: 'average queue time across lanes',
      previous: cmp?.avgWaitMin ?? null,
      higherIsBetter: false,
    },
  ];

  if (payload.erp?.hasData) {
    if (o.avgTicket != null) {
      items.push({
        id: 'ticket',
        label: 'Average basket',
        value: o.avgTicket,
        display: `€${o.avgTicket.toFixed(2)}`,
        hint: 'from ERP receipts',
        previous: cmp?.avgTicket ?? null,
        higherIsBetter: true,
      });
    }
    if (o.spi != null) {
      items.push({
        id: 'spi',
        label: 'Space yield',
        value: o.spi,
        display: `€${o.spi}`,
        hint: 'revenue per m² per dwell hour',
        previous: cmp?.spi ?? null,
        higherIsBetter: true,
      });
    }
  }

  const blocked = cmp != null && cmp.comparable === false;

  return items.map((it) => {
    const deltaPct = blocked ? null : relDelta(it.value, it.previous);
    return {
      ...it,
      previous: blocked ? null : it.previous,
      noCompareReason: blocked ? cmp.caveat : null,
      deltaPct,
      direction: deltaPct == null ? 'flat' : deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat',
      // Whether the movement is good news, which is not the same as whether it
      // went up — a longer checkout queue is a bigger number and a worse store.
      good: deltaPct == null || deltaPct === 0
        ? null
        : (deltaPct > 0) === it.higherIsBetter,
    };
  });
}

/**
 * One sentence saying whether the period went well, in the terms a store
 * director would use. This is what an executive reads before anything else, and
 * for many of them it is the only thing they read.
 */
function buildHeadline(payload) {
  const cmp = payload.comparison;
  const entrants = payload.overview.perimeterEntrants ?? 0;
  const stopping = payload.aisles.stoppingPowerPct ?? 0;
  const waitMin = payload.checkout.avgWaitMin ?? 0;

  const usable = cmp != null && cmp.comparable !== false;
  const dEntrants = usable ? relDelta(entrants, cmp.entrants) : null;
  const dStopping = usable ? relDelta(stopping, cmp.stoppingPowerPct) : null;

  const sentences = [];
  sentences.push(
    dEntrants == null
      ? `${entrants.toLocaleString()} people came in.`
      : `${entrants.toLocaleString()} people came in, ${dEntrants >= 0 ? 'up' : 'down'} `
        + `${Math.abs(dEntrants)}% on the same window last week.`,
  );
  sentences.push(
    dStopping == null
      ? `${stopping}% of aisle crossings became a stop at the shelf.`
      : `${stopping}% of aisle crossings became a stop at the shelf, against `
        + `${cmp.stoppingPowerPct}% a week ago.`,
  );
  if (waitMin > 0) sentences.push(`Checkout queues averaged ${formatWait(waitMin)}.`);

  // A queue is bad news on its own evidence, with or without last week to
  // compare against, so it is judged before the deltas rather than inside them.
  let tone = dEntrants == null && dStopping == null ? 'info' : 'good';
  if ((dEntrants != null && dEntrants < -10)
    || (dStopping != null && dStopping < -15)
    || waitMin > 5) tone = 'warn';
  if ((dEntrants != null && dEntrants < -25) || waitMin > 10) tone = 'bad';

  if (!usable && cmp != null) {
    sentences.push(`Week-on-week change is not shown: ${cmp.caveat}.`);
  }

  return { tone, text: sentences.join(' ') };
}

/**
 * @param {'live'|'hq'} variant
 */
export function computeExecutiveJourney(db, venueId, startTs, endTs, variant = 'live', metricThresholdOpts = {}) {
  try {
    ensureRoiCategoryLabels(db, venueId);
  } catch (err) {
    console.warn('[ExecutiveJourney] ROI category sync skipped:', err.message);
  }

  const metricThresholds = resolveExecutiveMetricThresholds(db, venueId, metricThresholdOpts);
  const thresholdPreview = metricThresholdOpts.thresholdPreview === true;
  const classifiedRois = loadClassifiedRois(db, venueId).map(r => ({ ...r, venue_id: venueId }));
  const trafficRoiIds = resolveTrafficRoiIds(db, venueId);
  const shoppingRoiIds = resolveShoppingRoiIds(classifiedRois);
  const storeHours = resolveStoreHours(db, venueId);

  const footfall = computeIngressFootfallWithRecovery(db, {
    venueId,
    trafficRoiIds,
    shoppingRoiIds,
    startTs,
    endTs,
    openingHour: storeHours.openingHour,
    closingHour: storeHours.closingHour,
    timeZone: storeHours.timeZone,
  });

  const perimeterFootfall = countPerimeterEntrants(db, {
    venueId,
    trafficRoiIds,
    startTs,
    endTs,
  });

  const ingressEpisodes = footfall.directCrossings;
  const ingressUnique = footfall.directUnique;
  const totalVisitors = footfall.totalVisitors;

  const sessionAnalytics = thresholdPreview
    ? null
    : computeExecutiveSessionAnalytics(
      db,
      venueId,
      startTs,
      endTs,
      classifiedRois,
      shoppingRoiIds,
      classifiedRois.filter(r => r.classification.group === 'aisles').map(r => r.id),
      metricThresholds,
      footfall,
    );
  const dwellStats = sessionAnalytics?.storeDwell ?? {
    reliable: false,
    avgStoreDwellMin: 0,
    medianStoreDwellMin: 0,
    dwellP25Min: null,
    dwellP75Min: null,
    sessionCount: 0,
    method: 'preview_skip',
  };

  const erp = fetchErpForRange(db, venueId, startTs, endTs);
  const mediaKpis = fetchMediaKpis(db, venueId, startTs, endTs);

  // Shared indexes replace the per-zone-group range scans that used to dominate
  // this request.
  const ctx = createJourneyContext(db, venueId, startTs, endTs, metricThresholds);

  const frescoDepartments = buildFrescoDepartments(classifiedRois, ctx);
  const checkoutChannels = buildCheckoutChannels(classifiedRois, ctx);
  const aisleMetrics = buildAisleMetrics(classifiedRois, ctx, totalVisitors, sessionAnalytics);
  const rawAisleCategoryGroups = buildAisleCategoryGroups(classifiedRois, ctx)
    .filter(g => g.category && !/^(uncategorized|no content available)$/i.test(g.category));
  const {
    hourly: activityTimelineHourly,
    daily: activityTimelineDaily,
    trailingHourly: activityTimelineTrailing,
    activityTimeline,
  } = fetchActivityTimelines(
    db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, metricThresholds.dwellMs,
    storeHours.openingHour, storeHours.closingHour, storeHours.timeZone,
  );
  const heatmapCategories = buildHeatmapCategories(
    aisleMetrics.categoryGroups,
    frescoDepartments,
    rawAisleCategoryGroups,
  );

  const avgWaitMin = checkoutChannels.length
    ? checkoutChannels.reduce((s, c) => s + c.avgWaitMin, 0) / checkoutChannels.length
    : 0;
  const avgWaitSec = checkoutChannels.length
    ? Math.round(checkoutChannels.reduce((s, c) => s + (c.avgWaitSec || 0), 0) / checkoutChannels.length)
    : 0;

  const checkoutCompleted = checkoutChannels.reduce((s, c) => s + (c.completed || 0), 0);
  const journeySignals = buildJourneySignals(
    perimeterFootfall.count, footfall, aisleMetrics, checkoutChannels, checkoutCompleted, avgWaitMin,
  );

  const aisleConversion = erp.hasData && aisleMetrics.totalAisleVisits > 0
    ? Math.round((erp.totalTransactions / aisleMetrics.totalAisleVisits) * 1000) / 10
    : null;

  const avgStoreDwellMin = dwellStats.medianStoreDwellMin || dwellStats.avgStoreDwellMin;

  const crossKpis = computeCrossKpis(erp, totalVisitors, avgStoreDwellMin, avgWaitMin, mediaKpis);

  const taxonomySummary = {
    totalRois: classifiedRois.length,
    fresco: classifiedRois.filter(r => r.classification.group === 'fresco').length,
    aisles: classifiedRois.filter(r => r.classification.group === 'aisles').length,
    checkout: classifiedRois.filter(r => r.classification.group === 'checkout').length,
    ingress: classifiedRois.filter(r => r.classification.group === 'ingress').length,
  };

  const payload = {
    variant,
    venueId,
    range: { startTs, endTs },
    generatedAt: Date.now(),
    metricThresholds: {
      dwellSec: metricThresholds.dwellSec,
      engagementSec: metricThresholds.engagementSec,
      engagementRankSec: metricThresholds.engagementRankSec,
      queueFloorSec: metricThresholds.queueFloorSec,
      bandEdgesSec: metricThresholds.bandEdgesSec,
      minVisitMs: metricThresholds.minVisitMs,
      source: metricThresholds.source,
    },
    storeHours: {
      openingHour: storeHours.openingHour,
      closingHour: storeHours.closingHour,
      hoursLabel: formatStoreHoursRange(storeHours.openingHour, storeHours.closingHour),
      timeZone: storeHours.timeZone,
    },
    activityTimeline,
    activityTimelines: {
      hourly: activityTimelineHourly,
      daily: activityTimelineDaily,
      trailingHourly: activityTimelineTrailing,
    },
    heatmapCategories,
    taxonomy: taxonomySummary,
    overview: {
      totalVisitors,
      perimeterEntrants: perimeterFootfall.count,
      perimeterUniqueTracks: perimeterFootfall.uniqueTracks,
      perimeterMethod: perimeterFootfall.method,
      ingressEpisodes,
      ingressUnique,
      ingressRecovered: footfall.recoveredEstimated,
      ingressDirectEstimated: footfall.directEstimated,
      footfallRecoveryPct: footfall.recoveryPct,
      footfallMethod: footfall.method,
      avgStoreDwellMin,
      medianStoreDwellMin: dwellStats.medianStoreDwellMin,
      dwellP25Min: dwellStats.dwellP25Min,
      dwellP75Min: dwellStats.dwellP75Min,
      avgStoreDwellReliable: dwellStats.reliable,
      dwellSessionCount: dwellStats.sessionCount,
      sessionAnalyticsMethod: dwellStats.method,
      stitchedEntranceSessions: sessionAnalytics?.stats?.stitchedSessions,
      currentOccupancy: 0,
      currentOccupancySource: 'live_frame',
      avgTicket: erp.avgTicket,
      spi: crossKpis.spi,
      spiSource: crossKpis.spiSource,
    },
    fresco: { departments: frescoDepartments },
    aisles: { ...aisleMetrics, aisleConversionPct: aisleConversion },
    checkout: {
      channels: checkoutChannels,
      avgWaitMin,
      avgWaitSec,
      completed: checkoutCompleted,
      frictionScore: dwellStats.reliable ? crossKpis.checkoutFrictionScore : null,
    },
    journeySignals,
    crossKpis,
    media: mediaKpis,
    erp: {
      hasData: erp.hasData,
      lastUpload: erp.lastUpload,
      rowCount: erp.rowCount,
      byCategory: erp.byCategory,
    },
    insights: [],
  };

  payload.insights = buildInsights(payload);
  payload.comparison = metricThresholdOpts.skipComparison
    ? null
    : buildComparison(db, venueId, startTs, endTs, variant, metricThresholdOpts);
  payload.headlineKpis = buildHeadlineKpis(payload);
  payload.headline = buildHeadline(payload);

  if (variant === 'hq') {
    payload.hqSummary = {
      headline: `Weekly executive brief · ${new Date(startTs).toLocaleDateString()} – ${new Date(endTs).toLocaleDateString()}`,
      topInsights: payload.insights,
      kpis: {
        visitors: totalVisitors,
        avgDwellMin: avgStoreDwellMin,
        avgTicket: erp.avgTicket,
        spi: crossKpis.spi,
        shoppingEfficiency: crossKpis.shoppingEfficiency,
      },
    };
  }

  return payload;
}
