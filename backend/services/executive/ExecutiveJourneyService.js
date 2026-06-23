/**
 * Esselunga Executive Journey KPI aggregation (LiDAR + ERP CSV).
 */

import { INGRESS_VISIT_COUNT_SQL } from '../../lib/ingressFootfall.js';
import { isTrafficZoneName } from '../../lib/storeHours.js';
import {
  loadClassifiedRois,
  CHECKOUT_CHANNEL_LABELS,
  FRESCO_DEPT_LABELS,
} from './ExecutiveZoneTaxonomy.js';
import { fetchErpForRange } from './VenueErpStore.js';

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

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
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

function fetchZoneVisitStats(db, roiIds, startTs, endTs) {
  if (!roiIds.length) {
    return { visits: 0, dwellVisits: 0, engagementVisits: 0, uniqueVisitors: 0, totalDurationMs: 0, abandonCount: 0 };
  }
  const ph = roiIds.map(() => '?').join(',');
  const row = safeQuery(db, `
    SELECT
      COUNT(*) as visits,
      COUNT(CASE WHEN is_dwell = 1 THEN 1 END) as dwellVisits,
      COUNT(CASE WHEN is_engagement = 1 THEN 1 END) as engagementVisits,
      COUNT(DISTINCT track_key) as uniqueVisitors,
      SUM(duration_ms) as totalDurationMs
    FROM zone_visits
    WHERE roi_id IN (${ph}) AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
  `, [...roiIds, startTs, endTs]) || {};

  return {
    visits: row.visits || 0,
    dwellVisits: row.dwellVisits || 0,
    engagementVisits: row.engagementVisits || 0,
    uniqueVisitors: row.uniqueVisitors || 0,
    totalDurationMs: row.totalDurationMs || 0,
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

function fetchFrescoBrowsingSplit(db, serviceRoiIds, queueRoiIds, startTs, endTs) {
  const serviceStats = fetchZoneVisitStats(db, serviceRoiIds, startTs, endTs);
  const queueStats = fetchZoneVisitStats(db, queueRoiIds, startTs, endTs);
  const queueVisits = queueStats.visits;
  const serviceVisits = serviceStats.visits;
  const total = serviceVisits + queueVisits;
  if (!total) return { browsingPct: 0, waitingPct: 0, serviceVisits: 0, queueVisits: 0 };
  const waitingPct = pct(queueVisits, total);
  return {
    browsingPct: Math.round((100 - waitingPct) * 10) / 10,
    waitingPct,
    serviceVisits,
    queueVisits,
  };
}

function buildFrescoDepartments(classifiedRois, db, startTs, endTs) {
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
    const stats = fetchZoneVisitStats(db, allIds, startTs, endTs);
    const split = fetchFrescoBrowsingSplit(db, ids.serviceIds, ids.queueIds, startTs, endTs);
    const queueStats = fetchQueueStats(db, ids.queueIds, startTs, endTs);
    const avgDwellMin = stats.uniqueVisitors > 0
      ? Math.round((stats.totalDurationMs / stats.uniqueVisitors) / 60000 * 10) / 10
      : 0;

    return {
      id: dept,
      label: ids.displayLabel || FRESCO_DEPT_LABELS[dept] || dept.replace(/_/g, ' '),
      visits: stats.visits,
      uniqueVisitors: stats.uniqueVisitors,
      avgDwellMin,
      browsingPct: split.browsingPct,
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
      avgWaitMin: q.avgWaitMin,
      abandonPct: q.abandonPct,
      currentQueue,
      roiIds,
    };
  });
}

function buildAisleCategoryGroups(classifiedRois, db, startTs, endTs) {
  const aisleRois = classifiedRois.filter(r => r.classification.group === 'aisles');
  const byCat = new Map();

  for (const roi of aisleRois) {
    const cat = roi.classification.categoryLabel || roi.linkedCategory
      || roi.classification.subGroup || 'Uncategorized';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(roi.id);
  }

  return [...byCat.entries()].map(([category, roiIds]) => {
    const stats = fetchZoneVisitStats(db, roiIds, startTs, endTs);
    return {
      category,
      visits: stats.visits,
      uniqueVisitors: stats.uniqueVisitors,
      stoppingPowerPct: stats.visits > 0 ? pct(stats.dwellVisits, stats.visits) : 0,
      avgDwellMin: stats.uniqueVisitors > 0
        ? Math.round((stats.totalDurationMs / stats.uniqueVisitors) / 60000 * 10) / 10
        : 0,
      roiCount: roiIds.length,
    };
  }).sort((a, b) => b.visits - a.visits);
}

function buildAisleMetrics(classifiedRois, db, ingressUnique, startTs, endTs) {
  const aisleRois = classifiedRois.filter(r => r.classification.group === 'aisles');
  const roiIds = aisleRois.map(r => r.id);
  const stats = fetchZoneVisitStats(db, roiIds, startTs, endTs);
  const categoryGroups = buildAisleCategoryGroups(classifiedRois, db, startTs, endTs);

  const penetrationPct = ingressUnique > 0
    ? Math.min(100, pct(stats.uniqueVisitors, ingressUnique))
    : 0;
  const stoppingPowerPct = stats.visits > 0 ? pct(stats.dwellVisits, stats.visits) : 0;
  const bypassPct = Math.max(0, Math.round((100 - stoppingPowerPct) * 10) / 10);

  const topAisles = [];
  for (const roi of aisleRois.slice(0, 20)) {
    const s = fetchZoneVisitStats(db, [roi.id], startTs, endTs);
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
  if (topAisle && payload.aisles.penetrationPct < 40) {
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
export function computeExecutiveJourney(db, venueId, startTs, endTs, variant = 'live') {
  const classifiedRois = loadClassifiedRois(db, venueId).map(r => ({ ...r, venue_id: venueId }));
  const trafficRoiIds = resolveTrafficRoiIds(db, venueId);
  const ingressEpisodes = fetchIngressCount(db, venueId, trafficRoiIds, startTs, endTs);
  const ingressUnique = fetchIngressUniqueCount(db, venueId, trafficRoiIds, startTs, endTs);

  const storeVisitRow = safeQuery(db, `
    SELECT
      COUNT(DISTINCT track_key) as visitors,
      SUM(duration_ms) as totalDurationMs
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
  `, [venueId, startTs, endTs]) || {};

  const avgStoreDwellMin = storeVisitRow.visitors > 0
    ? Math.round((storeVisitRow.totalDurationMs / storeVisitRow.visitors) / 60000 * 10) / 10
    : 0;

  const liveOcc = safeQuery(db, `
    SELECT SUM(zo.occupancy_count) as total
    FROM zone_occupancy zo
    JOIN regions_of_interest r ON r.id = zo.roi_id
    WHERE zo.venue_id = ?
      AND zo.timestamp = (SELECT MAX(timestamp) FROM zone_occupancy WHERE venue_id = ?)
      AND r.name NOT LIKE '%Queue%'
  `, [venueId, venueId]);

  const erp = fetchErpForRange(db, venueId, startTs, endTs);
  const mediaKpis = fetchMediaKpis(db, venueId, startTs, endTs);
  const frescoDepartments = buildFrescoDepartments(classifiedRois, db, startTs, endTs);
  const checkoutChannels = buildCheckoutChannels(classifiedRois, db, startTs, endTs);
  const aisleMetrics = buildAisleMetrics(classifiedRois, db, ingressUnique, startTs, endTs);

  const avgWaitMin = checkoutChannels.length
    ? checkoutChannels.reduce((s, c) => s + c.avgWaitMin, 0) / checkoutChannels.length
    : 0;

  const aisleConversion = erp.hasData && aisleMetrics.totalAisleVisits > 0
    ? Math.round((erp.totalTransactions / aisleMetrics.totalAisleVisits) * 1000) / 10
    : null;

  const crossKpis = computeCrossKpis(erp, ingressUnique, avgStoreDwellMin, avgWaitMin, mediaKpis);

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
    taxonomy: taxonomySummary,
    overview: {
      totalVisitors: ingressUnique || ingressEpisodes,
      ingressEpisodes,
      ingressUnique,
      avgStoreDwellMin,
      currentOccupancy: liveOcc?.total || 0,
      avgTicket: erp.avgTicket,
      spi: crossKpis.spi,
      spiSource: crossKpis.spiSource,
    },
    fresco: { departments: frescoDepartments },
    aisles: { ...aisleMetrics, aisleConversionPct: aisleConversion },
    checkout: { channels: checkoutChannels, avgWaitMin, frictionScore: crossKpis.checkoutFrictionScore },
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
        visitors: ingressUnique || ingressEpisodes,
        avgDwellMin: avgStoreDwellMin,
        avgTicket: erp.avgTicket,
        spi: crossKpis.spi,
        shoppingEfficiency: crossKpis.shoppingEfficiency,
      },
    };
  }

  return payload;
}
