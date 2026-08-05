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

/** Venue defaults or API preview overrides — executive metrics use duration_ms, not stale is_dwell flags. */
export function resolveExecutiveMetricThresholds(db, venueId, dwellThresholdSec, engagementThresholdSec) {
  const venue = safeQuery(db, `
    SELECT default_dwell_threshold_sec, default_engagement_threshold_sec FROM venues WHERE id = ?
  `, [venueId]);
  const hasDwellOverride = dwellThresholdSec != null && dwellThresholdSec !== '';
  const hasEngageOverride = engagementThresholdSec != null && engagementThresholdSec !== '';
  const dwellSec = hasDwellOverride
    ? Math.max(1, Number(dwellThresholdSec))
    : (venue?.default_dwell_threshold_sec ?? 10);
  const engagementSec = hasEngageOverride
    ? Math.max(1, Number(engagementThresholdSec))
    : (venue?.default_engagement_threshold_sec ?? 30);
  return {
    dwellSec,
    engagementSec,
    dwellMs: dwellSec * 1000,
    engagementMs: engagementSec * 1000,
    minVisitMs: 300,
    source: hasDwellOverride || hasEngageOverride ? 'preview' : 'venue_default',
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
  const { dwellMs, engagementMs } = metricThresholds;

  const byRoi = new Map();
  for (const r of safeQueryAll(db, `
    SELECT roi_id,
      COUNT(*) AS visits,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) AS dwellVisits,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) AS engagementVisits,
      COUNT(DISTINCT track_key) AS uniqueVisitors,
      SUM(duration_ms) AS totalDurationMs,
      SUM(CASE WHEN duration_ms >= ? THEN duration_ms ELSE 0 END) AS dwellDurationMs
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
    GROUP BY roi_id
  `, [dwellMs, engagementMs, dwellMs, venueId, startTs, endTs])) {
    byRoi.set(r.roi_id, {
      visits: r.visits || 0,
      dwellVisits: r.dwellVisits || 0,
      engagementVisits: r.engagementVisits || 0,
      uniqueVisitors: r.uniqueVisitors || 0,
      totalDurationMs: r.totalDurationMs || 0,
      dwellDurationMs: r.dwellDurationMs || 0,
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
      let uniqueVisitors = 0;
      let totalDurationMs = 0;
      let dwellDurationMs = 0;
      let dwellStops = 0;
      let engagementStops = 0;
      for (const id of roiIds) {
        const s = byRoi.get(id);
        if (s) {
          visits += s.visits;
          dwellVisits += s.dwellVisits;
          engagementVisits += s.engagementVisits;
          uniqueVisitors += s.uniqueVisitors;
          totalDurationMs += s.totalDurationMs;
          dwellDurationMs += s.dwellDurationMs;
        }
        dwellStops += dwellStopPairs.get(id) || 0;
        engagementStops += engagementStopPairs.get(id) || 0;
      }
      return {
        visits,
        dwellVisits: Math.max(dwellVisits, dwellStops),
        engagementVisits: Math.max(engagementVisits, engagementStops),
        uniqueVisitors,
        totalDurationMs,
        avgDwellMs: dwellVisits > 0 ? dwellDurationMs / dwellVisits : 0,
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
    queueStats: buildQueueStatsIndex(db, venueId, startTs, endTs),
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

/** Queue stats for every queue zone in the venue, in one scan. */
function buildQueueStatsIndex(db, venueId, startTs, endTs) {
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
      AND qs.waiting_time_ms >= 5000
    GROUP BY qs.queue_zone_id
  `, [venueId, startTs, endTs])) {
    byZone.set(r.zone, r);
  }

  return {
    statsFor(roiIds) {
      if (!roiIds?.length) return { sessions: 0, avgWaitMin: 0, abandonPct: 0, completed: 0 };
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
    const avgDwellSec = stats.dwellVisits > 0 && stats.avgDwellMs > 0
      ? Math.round(stats.avgDwellMs / 1000)
      : 0;
    const avgDwellMin = avgDwellSec > 0 ? Math.round((avgDwellSec / 60) * 10) / 10 : 0;

    return {
      id: dept,
      label: ids.displayLabel || FRESCO_DEPT_LABELS[dept] || dept.replace(/_/g, ' '),
      visits: stats.visits,
      dwellVisits: stats.dwellVisits,
      engagementVisits: stats.engagementVisits,
      uniqueVisitors: uniqueByDept.get(dept) ?? stats.uniqueVisitors,
      avgDwellMin,
      avgDwellSec,
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

function buildCheckoutChannels(classifiedRois, ctx) {
  const { db, endTs, queueStats } = ctx;
  const checkoutRois = classifiedRois.filter(r => r.classification.group === 'checkout');
  const byChannel = new Map();

  for (const roi of checkoutRois) {
    const ch = roi.classification.subGroup || 'traditional';
    if (!byChannel.has(ch)) byChannel.set(ch, []);
    byChannel.get(ch).push(roi.id);
  }

  if (byChannel.size === 0) {
    const fallback = classifiedRois.filter(r =>
      r.name.toLowerCase().includes('queue') && r.name.toLowerCase().includes('checkout'),
    );
    if (fallback.length) byChannel.set('traditional', fallback.map(r => r.id));
  }

  // Loop-invariant, and scoped to the checkout ROIs so it rides
  // idx_zone_occupancy_roi_time. Filtering by venue_id instead has no index and
  // cost a full scan of millions of occupancy rows on every request.
  const allCheckoutRoiIds = [...byChannel.values()].flat();
  const latestTs = allCheckoutRoiIds.length
    ? safeQuery(db, `
      SELECT MAX(timestamp) as ts FROM zone_occupancy
      WHERE roi_id IN (${allCheckoutRoiIds.map(() => '?').join(',')}) AND timestamp <= ?
    `, [...allCheckoutRoiIds, endTs])?.ts
    : null;

  return [...byChannel.entries()].map(([channel, roiIds]) => {
    const q = queueStats.statsFor(roiIds);
    let currentQueue = 0;
    if (latestTs && roiIds.length) {
      const ph = roiIds.map(() => '?').join(',');
      const occ = safeQuery(db, `
        SELECT SUM(occupancy_count) as total FROM zone_occupancy
        WHERE roi_id IN (${ph}) AND timestamp = ?
      `, [...roiIds, latestTs]);
      currentQueue = occ?.total || 0;
    }
    return {
      id: channel,
      label: CHECKOUT_CHANNEL_LABELS[channel] || channel,
      sessions: q.sessions,
      completed: q.completed,
      avgWaitMin: q.avgWaitMin,
      abandonPct: q.abandonPct,
      currentQueue,
      roiIds,
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
      avgDwellMin: uniqueVisitors > 0
        ? Math.round((stats.totalDurationMs / uniqueVisitors) / 60000 * 10) / 10
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
  const bypassPct = Math.max(0, Math.round((100 - stoppingPowerPct) * 10) / 10);

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
      avgDwellMin: s.uniqueVisitors > 0
        ? Math.round((s.totalDurationMs / s.uniqueVisitors) / 60000 * 10) / 10
        : 0,
    });
  }
  topAisles.sort((a, b) => b.visits - a.visits);
  topAisles.splice(20);

  return {
    penetrationPct,
    aisleDwellUnique,
    aisleReachReliable,
    dwellVisits: stats.dwellVisits,
    engagementVisits: stats.engagementVisits,
    stoppingPowerPct,
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
 * @param {'live'|'hq'} variant
 */
export function computeExecutiveJourney(db, venueId, startTs, endTs, variant = 'live', metricThresholdOpts = {}) {
  try {
    ensureRoiCategoryLabels(db, venueId);
  } catch (err) {
    console.warn('[ExecutiveJourney] ROI category sync skipped:', err.message);
  }

  const metricThresholds = resolveExecutiveMetricThresholds(
    db,
    venueId,
    metricThresholdOpts.dwellThresholdSec,
    metricThresholdOpts.engagementThresholdSec,
  );
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
