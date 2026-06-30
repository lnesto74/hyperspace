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
  buildStoreHourSqlFilter,
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
    timeZone: 'Europe/Rome',
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

function fetchZoneVisitStats(db, roiIds, startTs, endTs, metricThresholds) {
  if (!roiIds.length) {
    return { visits: 0, dwellVisits: 0, engagementVisits: 0, uniqueVisitors: 0, totalDurationMs: 0, abandonCount: 0, avgDwellMs: 0 };
  }
  const ph = roiIds.map(() => '?').join(',');
  const dwellMs = metricThresholds.dwellMs;
  const engagementMs = metricThresholds.engagementMs;
  const row = safeQuery(db, `
    SELECT
      COUNT(*) as visits,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) as dwellVisits,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) as engagementVisits,
      COUNT(DISTINCT track_key) as uniqueVisitors,
      SUM(duration_ms) as totalDurationMs,
      AVG(CASE WHEN duration_ms >= ? THEN duration_ms END) as avgDwellMs
    FROM zone_visits
    WHERE roi_id IN (${ph}) AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
  `, [dwellMs, engagementMs, dwellMs, ...roiIds, startTs, endTs]) || {};

  return {
    visits: row.visits || 0,
    dwellVisits: row.dwellVisits || 0,
    engagementVisits: row.engagementVisits || 0,
    uniqueVisitors: row.uniqueVisitors || 0,
    totalDurationMs: row.totalDurationMs || 0,
    avgDwellMs: row.avgDwellMs || 0,
  };
}

function fetchQueueStats(db, roiIds, startTs, endTs) {
  if (!roiIds.length) return { sessions: 0, avgWaitMin: 0, abandonPct: 0, completed: 0 };
  const ph = roiIds.map(() => '?').join(',');
  const row = safeQuery(db, `
    SELECT
      COUNT(*) as sessions,
      ROUND(AVG(CASE WHEN is_abandoned = 0 THEN waiting_time_ms END) / 60000.0, 2) as avgWaitMin,
      ROUND(SUM(CASE WHEN is_abandoned = 1 THEN 1.0 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) as abandonPct,
      SUM(CASE WHEN is_abandoned = 0 THEN 1 ELSE 0 END) as completed
    FROM queue_sessions
    WHERE queue_zone_id IN (${ph})
      AND queue_entry_time >= ? AND queue_entry_time < ?
      AND waiting_time_ms >= 5000
  `, [...roiIds, startTs, endTs]) || {};
  return {
    sessions: row.sessions || 0,
    avgWaitMin: row.avgWaitMin || 0,
    abandonPct: row.abandonPct || 0,
    completed: row.completed || 0,
  };
}

function fetchFrescoBrowsingSplit(db, serviceRoiIds, queueRoiIds, browseRoiIds, startTs, endTs, metricThresholds) {
  const serviceStats = fetchZoneVisitStats(db, serviceRoiIds, startTs, endTs, metricThresholds);
  const queueStats = fetchZoneVisitStats(db, queueRoiIds, startTs, endTs, metricThresholds);
  const browseStats = fetchZoneVisitStats(db, browseRoiIds, startTs, endTs, metricThresholds);

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

function buildFrescoDepartments(classifiedRois, db, startTs, endTs, metricThresholds) {
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

  return [...byDept.entries()].map(([dept, ids]) => {
    const allIds = [...ids.serviceIds, ...ids.queueIds, ...ids.browseIds];
    const stats = fetchZoneVisitStats(db, allIds, startTs, endTs, metricThresholds);
    const split = fetchFrescoBrowsingSplit(
      db, ids.serviceIds, ids.queueIds, ids.browseIds, startTs, endTs, metricThresholds,
    );
    const queueStats = fetchQueueStats(db, ids.queueIds, startTs, endTs);
    const hasQueueZones = ids.queueIds.length > 0;
    const stoppingPct = split.browsingPct;
    const passThroughPct = Math.round((100 - stoppingPct) * 10) / 10;
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
      uniqueVisitors: stats.uniqueVisitors,
      avgDwellMin,
      avgDwellSec,
      stoppingPct,
      passThroughPct,
      hasQueueZones,
      browsingPct: stoppingPct,
      waitingPct: split.waitingPct,
      abandonPct: queueStats.abandonPct,
      serviceEfficiency: queueStats.completed > 0
        ? Math.round((queueStats.completed / Math.max(queueStats.sessions, 1)) * 1000) / 10
        : null,
      roiIds: allIds,
    };
  }).sort((a, b) => b.visits - a.visits);
}

function buildCheckoutChannels(classifiedRois, db, startTs, endTs) {
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

  return [...byChannel.entries()].map(([channel, roiIds]) => {
    const q = fetchQueueStats(db, roiIds, startTs, endTs);
    let currentQueue = 0;
    const latestTs = safeQuery(db, 'SELECT MAX(timestamp) as ts FROM zone_occupancy WHERE venue_id = ?', [
      classifiedRois[0]?.venue_id,
    ])?.ts;
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

function buildHeatmapCategories(categoryGroups) {
  return (categoryGroups || []).map(g => ({
    category: g.category,
    zoneCount: g.roiCount || 0,
    roiIds: g.roiIds || [],
    totalVisits: g.visits || 0,
    totalDwellMin: g.avgDwellMin || 0,
    browsingRate: g.stoppingPowerPct || 0,
    engagementRate: g.engagementPct || 0,
    conversionRate: 0,
    avgBrowseTimeMin: g.avgDwellMin || 0,
  })).filter(r => (r.roiIds?.length ?? 0) > 0);
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

function mapHourlyBuckets(hours, rowMap) {
  return hours.map(h => ({
    label: `${String(h).padStart(2, '0')}:00`,
    value: rowMap.get(h) || 0,
  }));
}

function fetchHourlyTimeline(
  db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs, openingHour, closingHour,
) {
  const hours = storeHourBucketIndices(openingHour, closingHour);
  if (!hours.length) return { grain: 'hour', visitors: [], dwells: [] };

  const perimeterRows = trafficRoiIds.length
    ? fetchPerimeterEntrantsByHour(db, trafficRoiIds, startTs, endTs)
    : [];
  const vMap = new Map(perimeterRows.map(r => [Number(r.hour), Number(r.value) || 0]));

  const hourFilter = buildStoreHourSqlFilter(
    "datetime(start_time/1000, 'unixepoch', 'localtime')",
    openingHour,
    closingHour,
  );
  let dwellRows = [];
  if (shoppingRoiIds.length) {
    const shopPh = shoppingRoiIds.map(() => '?').join(',');
    dwellRows = safeQueryAll(db, `
      SELECT strftime('%H', datetime(start_time/1000, 'unixepoch', 'localtime')) as bucket,
        COUNT(CASE WHEN duration_ms >= ? THEN 1 END) as c
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${shopPh})
        AND start_time >= ? AND start_time < ?
        AND track_key NOT LIKE '%cashier%'
        AND ${hourFilter}
      GROUP BY bucket ORDER BY bucket
    `, [dwellMs, venueId, ...shoppingRoiIds, startTs, endTs]);
  }
  const dMap = new Map(dwellRows.map(r => [parseInt(r.bucket, 10), r.c || 0]));

  return {
    grain: 'hour',
    visitors: mapHourlyBuckets(hours, vMap),
    dwells: mapHourlyBuckets(hours, dMap),
  };
}

function fetchDailyTimeline(db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs) {
  const visitorRows = trafficRoiIds.length ? safeQueryAll(db, `
    SELECT date(start_time/1000, 'unixepoch', 'localtime') as bucket,
      COUNT(*) as c
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${trafficRoiIds.map(() => '?').join(',')})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
    GROUP BY bucket ORDER BY bucket
  `, [venueId, ...trafficRoiIds, startTs, endTs]) : [];

  const dwellRows = shoppingRoiIds.length ? safeQueryAll(db, `
    SELECT date(start_time/1000, 'unixepoch', 'localtime') as bucket,
      COUNT(CASE WHEN duration_ms >= ? THEN 1 END) as c
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${shoppingRoiIds.map(() => '?').join(',')})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
    GROUP BY bucket ORDER BY bucket
  `, [dwellMs, venueId, ...shoppingRoiIds, startTs, endTs]) : [];

  const daySet = new Set([
    ...visitorRows.map(r => r.bucket),
    ...dwellRows.map(r => r.bucket),
  ]);
  const days = [...daySet].sort();
  const vMap = Object.fromEntries(visitorRows.map(r => [r.bucket, r.c]));
  const dMap = Object.fromEntries(dwellRows.map(r => [r.bucket, r.c]));

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

function fetchActivityTimelines(
  db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs, openingHour, closingHour,
) {
  const hourly = fetchHourlyTimeline(
    db, venueId, endTs - 24 * 3600000, endTs, trafficRoiIds, shoppingRoiIds, dwellMs,
    openingHour, closingHour,
  );
  const daily = fetchDailyTimeline(
    db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, dwellMs,
  );
  const spanMs = endTs - startTs;
  const activityTimeline = spanMs <= 36 * 3600000 ? hourly : daily;
  return { hourly, daily, activityTimeline };
}

function buildAisleCategoryGroups(classifiedRois, db, startTs, endTs, metricThresholds) {
  const aisleRois = classifiedRois.filter(r => r.classification.group === 'aisles');
  const byCat = new Map();

  for (const roi of aisleRois) {
    const cat = roi.classification.categoryLabel || roi.linkedCategory
      || roi.classification.subGroup || 'Uncategorized';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(roi.id);
  }

  return [...byCat.entries()].map(([category, roiIds]) => {
    const stats = fetchZoneVisitStats(db, roiIds, startTs, endTs, metricThresholds);
    return {
      category,
      visits: stats.visits,
      uniqueVisitors: stats.uniqueVisitors,
      stoppingPowerPct: stats.visits > 0 ? pct(stats.dwellVisits, stats.visits) : 0,
      engagementPct: stats.visits > 0 ? pct(stats.engagementVisits, stats.visits) : 0,
      avgDwellMin: stats.uniqueVisitors > 0
        ? Math.round((stats.totalDurationMs / stats.uniqueVisitors) / 60000 * 10) / 10
        : 0,
      roiCount: roiIds.length,
      roiIds,
    };
  }).sort((a, b) => b.visits - a.visits);
}

function buildAisleMetrics(classifiedRois, db, totalVisitors, startTs, endTs, metricThresholds, sessionAnalytics) {
  const aisleRois = classifiedRois.filter(r => r.classification.group === 'aisles');
  const roiIds = aisleRois.map(r => r.id);
  const stats = fetchZoneVisitStats(db, roiIds, startTs, endTs, metricThresholds);

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
    return buildAisleCategoryGroups(classifiedRois, db, startTs, endTs, metricThresholds)
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

  const topAisles = [];
  for (const roi of aisleRois.slice(0, 20)) {
    const s = fetchZoneVisitStats(db, [roi.id], startTs, endTs, metricThresholds);
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
  const frescoDepartments = buildFrescoDepartments(classifiedRois, db, startTs, endTs, metricThresholds);
  const checkoutChannels = buildCheckoutChannels(classifiedRois, db, startTs, endTs);
  const aisleMetrics = buildAisleMetrics(
    classifiedRois, db, totalVisitors, startTs, endTs, metricThresholds, sessionAnalytics,
  );
  const { hourly: activityTimelineHourly, daily: activityTimelineDaily, activityTimeline } = fetchActivityTimelines(
    db, venueId, startTs, endTs, trafficRoiIds, shoppingRoiIds, metricThresholds.dwellMs,
    storeHours.openingHour, storeHours.closingHour,
  );
  const heatmapCategories = buildHeatmapCategories(aisleMetrics.categoryGroups);

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
    },
    activityTimeline,
    activityTimelines: {
      hourly: activityTimelineHourly,
      daily: activityTimelineDaily,
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
