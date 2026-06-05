/**
 * Business Reporting API Routes
 * 
 * Provides persona-based KPI summaries for business dashboards.
 * All routes are behind FEATURE_BUSINESS_REPORTING feature flag.
 * 
 * Endpoints:
 * - GET /api/reporting/summary - Get KPI summary for a persona
 * - GET /api/reporting/personas - List available personas
 */

import { Router } from 'express';
import { KPICalculator } from '../services/KPICalculator.js';
import { ShelfKPIEnricher } from '../services/ShelfKPIEnricher.js';
import {
  getReportingSummary as getNarrator2Kpis,
  getQueueLaneKpis,
} from '../services/narrator2/KpiSourceAdapter.js';
import { resolveShelfCategories } from '../services/ShelfCategoryResolver.js';
import {
  computeStoreFootfallFromHourly,
  isHourWithinStoreHours,
  isTrafficZoneName,
} from '../lib/storeHours.js';
import { INGRESS_VISIT_COUNT_SQL } from '../lib/ingressFootfall.js';

export default function createBusinessReportingRoutes(db, trajectoryStorage, trackAggregator, mqttService) {
const router = Router();
const kpiCalculator = new KPICalculator(db);
const shelfKPIEnricher = new ShelfKPIEnricher(db);

// Simple in-memory cache with TTL
const cache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds

function getCacheKey(personaId, venueId, startTs, endTs, grain) {
  return `${personaId}:${venueId}:${startTs}:${endTs}:${grain || 'default'}`;
}

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// Feature flag check middleware
const checkFeatureFlag = (req, res, next) => {
  if (process.env.FEATURE_BUSINESS_REPORTING !== 'true') {
    return res.status(404).json({ error: 'Business Reporting feature not enabled' });
  }
  next();
};

router.use(checkFeatureFlag);

// Valid persona IDs
const VALID_PERSONAS = ['store-manager', 'merchandising', 'retail-media', 'executive'];

// Max time range: 30 days
const MAX_RANGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * GET /api/reporting/personas - List available personas
 */
router.get('/personas', (req, res) => {
  res.json({
    personas: [
      { id: 'store-manager', name: 'Operations Pulse', description: 'Real-time store operations' },
      { id: 'merchandising', name: 'Shelf & Category Performance', description: 'Product and category insights' },
      { id: 'retail-media', name: 'PEBLE™ Effectiveness', description: 'In-store media performance' },
      { id: 'executive', name: 'Executive Summary', description: 'High-level business metrics' },
    ]
  });
});

/**
 * GET /api/reporting/categories - List available categories from SKU catalog
 */
router.get('/categories', async (req, res) => {
  try {
    const { venueId } = req.query;
    if (!venueId) {
      return res.status(400).json({ error: 'venueId is required' });
    }

    // SKU catalog categories + object/ROI mapped categories for this venue
    const skuCategories = db.prepare(`
      SELECT DISTINCT category, COUNT(*) as sku_count
      FROM sku_items
      WHERE category IS NOT NULL AND category != ''
      GROUP BY category
    `).all();

    const byLabel = new Map();
    const addCategory = (label, skuCount = 0, source = 'catalog') => {
      if (!label || typeof label !== 'string') return;
      const trimmed = label.trim();
      if (!trimmed) return;
      const existing = byLabel.get(trimmed);
      if (existing) {
        existing.skuCount = Math.max(existing.skuCount, skuCount);
        if (!existing.sources.includes(source)) existing.sources.push(source);
        return;
      }
      byLabel.set(trimmed, { id: trimmed, name: trimmed, skuCount, sources: [source] });
    };

    skuCategories.forEach((c) => addCategory(c.category, c.sku_count, 'planogram'));

    const objects = db.prepare(`
      SELECT id, metadata_json FROM venue_objects WHERE venue_id = ?
    `).all(venueId);
    for (const obj of objects) {
      try {
        const meta = obj.metadata_json ? JSON.parse(obj.metadata_json) : {};
        addCategory(meta.business_category_label, 0, 'object');
        addCategory(meta.business_category, 0, 'object');
        const resolved = resolveShelfCategories(db, obj.id);
        resolved.categories.forEach((cat) => addCategory(cat, 0, resolved.source));
      } catch { /* ignore */ }
    }

    const rois = db.prepare(`
      SELECT metadata_json FROM regions_of_interest WHERE venue_id = ?
    `).all(venueId);
    for (const roi of rois) {
      try {
        const meta = roi.metadata_json ? JSON.parse(roi.metadata_json) : {};
        addCategory(meta.business_category_label, 0, 'roi');
      } catch { /* ignore */ }
    }

    const categories = Array.from(byLabel.values())
      .sort((a, b) => b.skuCount - a.skuCount || a.name.localeCompare(b.name));

    res.json({
      categories: [
        {
          id: 'all',
          name: 'All Categories',
          skuCount: categories.reduce((sum, c) => sum + (c.skuCount || 0), 0),
        },
        ...categories,
      ],
    });
  } catch (err) {
    console.error('[BusinessReporting] Categories error:', err);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/reporting/summary - Get KPI summary for a persona
 * 
 * Query params:
 * - personaId (required): one of store-manager, merchandising, retail-media, executive
 * - venueId (required): venue ID
 * - startTs (required): start timestamp in ms
 * - endTs (required): end timestamp in ms
 * - categoryId (optional): filter by category for merchandising
 * - shelfId (optional): filter by shelf for merchandising
 * - campaignId (optional): filter by campaign for retail-media
 */
router.get('/summary', async (req, res) => {
  try {
    const { personaId, venueId, startTs, endTs, categoryId, shelfId, campaignId, grain } = req.query;
    
    // Debug logging
    console.log(`[BusinessReporting] Request: persona=${personaId}, venue=${venueId}, startTs=${startTs}, endTs=${endTs}`);

    // Validation
    if (!personaId || !venueId || !startTs || !endTs) {
      return res.status(400).json({ error: 'personaId, venueId, startTs, and endTs are required' });
    }

    if (!VALID_PERSONAS.includes(personaId)) {
      return res.status(400).json({ error: `Invalid personaId. Must be one of: ${VALID_PERSONAS.join(', ')}` });
    }

    const start = parseInt(startTs);
    const end = parseInt(endTs);

    if (isNaN(start) || isNaN(end) || end <= start) {
      return res.status(400).json({ error: 'Invalid time range' });
    }

    if (end - start > MAX_RANGE_MS) {
      return res.status(400).json({ error: 'Time range exceeds maximum of 30 days' });
    }

    const validGrains = ['hour', 'day', 'week'];
    const resolvedGrain = validGrains.includes(grain) ? grain : 'hour';

    // Check cache
    const cacheKey = getCacheKey(personaId, venueId, start, end, personaId === 'store-manager' ? resolvedGrain : null);
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let kpis = {};
    let supporting = {};

    // Compute KPIs based on persona
    switch (personaId) {
      case 'store-manager':
        ({ kpis, supporting } = await computeStoreManagerKpis(
          db, kpiCalculator, trajectoryStorage, trackAggregator, venueId, start, end, resolvedGrain,
        ));
        break;
      case 'merchandising':
        ({ kpis, supporting } = await computeMerchandisingKpis(db, kpiCalculator, shelfKPIEnricher, venueId, start, end, categoryId, shelfId));
        break;
      case 'retail-media':
        ({ kpis, supporting } = await computeRetailMediaKpis(db, venueId, start, end, campaignId));
        break;
      case 'executive':
        ({ kpis, supporting } = await computeExecutiveKpis(db, kpiCalculator, trajectoryStorage, venueId, start, end, campaignId));
        break;
    }

    const response = {
      personaId,
      venueId,
      range: { startTs: start, endTs: end },
      kpis,
      supporting,
      generatedAt: Date.now(),
    };

    // Cache the response
    setCache(cacheKey, response);

    res.json(response);
  } catch (err) {
    console.error('❌ Failed to compute reporting summary:', err.message);
    res.status(500).json({ error: 'Failed to compute summary', message: err.message });
  }
});

/**
 * Safe query helper - returns null if table doesn't exist
 */
function safeQuery(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch (err) {
    console.warn(`[BusinessReporting] Query failed: ${err.message}`);
    return null;
  }
}

function safeQueryAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (err) {
    console.warn(`[BusinessReporting] Query failed: ${err.message}`);
    return [];
  }
}

function resolveRoiCategoryForReporting(db, metadataJson) {
  try {
    const meta = metadataJson ? JSON.parse(metadataJson) : {};
    if (meta.business_category_label) return meta.business_category_label;
    if (meta.business_category) return meta.business_category;
    if (meta.shelfId) {
      const resolved = resolveShelfCategories(db, meta.shelfId);
      if (resolved.categories[0]) return resolved.categories[0];
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Store Manager KPIs: Operations Pulse
 * Uses KpiSourceAdapter (AI Narrator 2) as single source of truth for queue KPIs.
 * Adds operations console payload for the redesigned dashboard.
 */
async function computeStoreManagerKpis(db, kpiCalculator, trajectoryStorage, trackAggregator, venueId, startTs, endTs, grain = 'hour') {
  const narrator2Data = await getNarrator2Kpis(venueId, 'store-manager', startTs, endTs);
  const queueKpis = await getQueueLaneKpis(venueId, startTs, endTs);

  const kpis = narrator2Data?.kpis ? { ...narrator2Data.kpis, ...queueKpis } : { ...queueKpis };
  const supporting = {
    deadZones: narrator2Data?.supporting?.deadZones || [],
    topZones: narrator2Data?.supporting?.topZones || [],
    topCategories: narrator2Data?.supporting?.topCategories || [],
    zoneUtilThresholdPct: narrator2Data?.supporting?.zoneUtilThresholdPct ?? 5,
  };

  kpis.avgWaitingTimeMin = kpis.avgQueueWaitTime || 0;
  kpis.abandonRate = kpis.queueAbandonmentRate || 0;

  const currentQueueStats = safeQuery(db, `
    SELECT SUM(zo.occupancy_count) as total_queue
    FROM zone_occupancy zo
    JOIN regions_of_interest r ON r.id = zo.roi_id
    WHERE r.venue_id = ? AND r.name LIKE '%Queue%'
      AND zo.timestamp = (SELECT MAX(timestamp) FROM zone_occupancy WHERE venue_id = ?)
  `, [venueId, venueId]);
  kpis.currentQueueLength = currentQueueStats?.total_queue || 0;

  const storeHours = resolveVenueStoreHours(db, venueId);
  const dataHealth = assessIngressHealth(db, venueId, startTs, endTs, storeHours);

  if (dataHealth.visitorSource === 'ingress') {
    kpis.uniqueVisitors = dataHealth.ingressVisitCount;
  } else {
    kpis.uniqueVisitors = null;
  }
  kpis.totalInStore = fetchLiveShoppersInStore(
    db, venueId, mqttService?.getFrameOccupancy?.(venueId),
  );

  const storeOccKpis = fetchStoreShopperKpis(
    db, venueId, startTs, endTs, storeHours.openingHour, storeHours.closingHour,
  );
  kpis.peakOccupancy = storeOccKpis.peakOccupancy;
  kpis.avgOccupancy = storeOccKpis.avgOccupancy;

  const periodDeltas = fetchPeriodDeltasForFootfall(db, venueId, startTs, endTs, storeHours, dataHealth);
  const queueLanes = fetchQueueLanesBreakdown(db, venueId, startTs, endTs);
  const timeline = fetchOperationsTimeline(
    db, venueId, startTs, endTs, grain, storeHours, dataHealth, storeOccKpis.source,
  );
  const footfall = buildFootfallSummary(db, venueId, startTs, endTs, storeHours, dataHealth);
  const storeActivityByHour = fetchStoreActivityByHour(
    db, venueId, startTs, endTs, storeHours.openingHour, storeHours.closingHour, storeOccKpis.source,
  );
  const alerts = buildOperationsAlerts(kpis, periodDeltas, queueLanes, dataHealth);

  supporting.periodDeltas = periodDeltas;
  supporting.operationsConsole = {
    grain,
    storeHours: {
      ...storeHours,
      savedFootfallRoiId: dataHealth.savedFootfallRoiId,
    },
    dataHealth,
    shopperMetricSource: storeOccKpis.source,
    timeline,
    footfall,
    storeActivityByHour,
    queueLanes,
    alerts,
    secondaryKpiIds: [
      'uniqueVisitors',
      'utilizationRate',
      'currentQueueLength',
      'abandonRate',
      'queueThroughput',
    ],
    heroKpiIds: ['totalInStore', 'peakOccupancy', 'avgOccupancy', 'avgWaitingTimeMin'],
    dataWindowStartTs: startTs,
    dataWindowEndTs: endTs,
  };

  return { kpis, supporting };
}

function resolveVenueStoreHours(db, venueId) {
  const venue = safeQuery(db, `
    SELECT opening_hour, closing_hour, footfall_roi_id
    FROM venues WHERE id = ?
  `, [venueId]) || {};

  let footfallRoiId = venue.footfall_roi_id || null;
  let footfallZoneName = null;

  if (footfallRoiId) {
    const roi = safeQuery(db, 'SELECT name FROM regions_of_interest WHERE id = ?', [footfallRoiId]);
    footfallZoneName = roi?.name || null;
  } else {
    const rois = safeQueryAll(db, 'SELECT id, name FROM regions_of_interest WHERE venue_id = ?', [venueId]);
    const traffic = rois.find(r => isTrafficZoneName(r.name));
    if (traffic) {
      footfallRoiId = traffic.id;
      footfallZoneName = traffic.name;
    }
  }

  return {
    openingHour: venue.opening_hour ?? 8,
    closingHour: venue.closing_hour ?? 20,
    footfallRoiId,
    footfallZoneName,
    savedFootfallRoiId: venue.footfall_roi_id || null,
    trafficRoiIds: resolveTrafficRoiIds(db, venueId, footfallRoiId),
  };
}

function assessIngressHealth(db, venueId, startTs, endTs, storeHours) {
  const roiIds = storeHours.trafficRoiIds || [];
  let ingressVisitCount = 0;

  if (roiIds.length) {
    const placeholders = roiIds.map(() => '?').join(',');
    const row = safeQuery(db, `
      SELECT ${INGRESS_VISIT_COUNT_SQL} as c
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${placeholders})
        AND start_time >= ? AND start_time < ?
        AND track_key NOT LIKE '%cashier%'
    `, [venueId, ...roiIds, startTs, endTs]);
    ingressVisitCount = row?.c || 0;
  }

  const queueRow = safeQuery(db, `
    SELECT COUNT(DISTINCT track_key) as c
    FROM queue_sessions
    WHERE venue_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
      AND waiting_time_ms >= 5000
  `, [venueId, startTs, endTs]);

  const ingressRecording = ingressVisitCount > 0;
  let visitorSource = 'none';
  if (ingressRecording) visitorSource = 'ingress';
  else if ((queueRow?.c || 0) > 0) visitorSource = 'queue_proxy';

  let message = null;
  if (!ingressRecording) {
    const zoneLabel = storeHours.footfallZoneName || 'ingress zone';
    message = storeHours.savedFootfallRoiId
      ? `${zoneLabel} is configured but recorded 0 visits in this period — check zone placement on the floorplan.`
      : `${zoneLabel} is not saved as footfall ROI in Venue Settings, and recorded 0 visits — save footfall zone and verify tracks cross it.`;
  }

  return {
    dbWritable: true,
    ingressRecording,
    ingressVisitCount,
    queueVisitorCount: queueRow?.c || 0,
    visitorSource,
    savedFootfallRoiId: storeHours.savedFootfallRoiId,
    message,
  };
}

function resolveTrafficRoiIds(db, venueId, footfallRoiId) {
  const ids = [];
  if (footfallRoiId) ids.push(footfallRoiId);
  const rois = safeQueryAll(db, 'SELECT id, name FROM regions_of_interest WHERE venue_id = ?', [venueId]);
  for (const r of rois) {
    if (isTrafficZoneName(r.name) && !ids.includes(r.id)) ids.push(r.id);
  }
  return ids;
}

function fetchLiveShoppersInStore(db, venueId, liveFrameOccupancy) {
  if (liveFrameOccupancy != null && liveFrameOccupancy > 0) {
    return liveFrameOccupancy;
  }

  const latest = safeQuery(db, `
    SELECT timestamp as ts FROM track_positions
    WHERE venue_id = ? ORDER BY timestamp DESC LIMIT 1
  `, [venueId]);
  if (latest?.ts) {
    const frame = safeQuery(db, `
      SELECT COUNT(DISTINCT track_key) as c
      FROM track_positions
      WHERE venue_id = ? AND timestamp = ? AND track_key NOT LIKE '%cashier%'
    `, [venueId, latest.ts]);
    if ((frame?.c || 0) > 0) return frame.c;
  }

  const row = safeQuery(db, `
    SELECT COUNT(DISTINCT track_key) as c
    FROM zone_visits
    WHERE venue_id = ?
      AND start_time >= ?
      AND track_key NOT LIKE '%cashier%'
  `, [venueId, Date.now() - 300000]);
  return row?.c || 0;
}

/** Ignore sparse/stale frames (single-ID heartbeats) when averaging. */
const MIN_ACTIVE_FRAME_COUNT = 15;

function storePerceptionFramesSql() {
  return `
    SELECT timestamp as ts, COUNT(DISTINCT track_key) as frame_count
    FROM track_positions
    WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
      AND track_key NOT LIKE '%cashier%'
    GROUP BY timestamp
  `;
}

function perceptionFramesAvailable(db, venueId, startTs, endTs) {
  const row = safeQuery(db, `
    SELECT MAX(frame_count) as peak FROM (${storePerceptionFramesSql()})
  `, [venueId, startTs, endTs]);
  return (row?.peak || 0) >= MIN_ACTIVE_FRAME_COUNT;
}

function storeOccupancySnapshotsSql() {
  return `
    SELECT zo.timestamp as ts, SUM(zo.occupancy_count) as store_total
    FROM zone_occupancy zo
    JOIN regions_of_interest r ON r.id = zo.roi_id
    WHERE zo.venue_id = ? AND zo.timestamp >= ? AND zo.timestamp < ?
      AND r.name NOT LIKE '%Queue%'
      AND r.name NOT LIKE '%Checkout%'
    GROUP BY zo.timestamp
  `;
}

function fetchStoreShopperKpis(db, venueId, startTs, endTs, openingHour, closingHour) {
  if (perceptionFramesAvailable(db, venueId, startTs, endTs)) {
    const row = safeQuery(db, `
      SELECT
        MAX(frame_count) as peakOccupancy,
        AVG(CASE WHEN open_hr AND frame_count >= ? THEN frame_count END) as avgOccupancy
      FROM (
        SELECT frame_count,
          CAST(strftime('%H', datetime(ts/1000,'unixepoch','localtime')) AS INT) >= ?
          AND CAST(strftime('%H', datetime(ts/1000,'unixepoch','localtime')) AS INT) < ? as open_hr
        FROM (${storePerceptionFramesSql()})
      )
    `, [MIN_ACTIVE_FRAME_COUNT, openingHour, closingHour, venueId, startTs, endTs]);
    return {
      source: 'perception_frames',
      peakOccupancy: Math.round(row?.peakOccupancy || 0),
      avgOccupancy: Math.round((row?.avgOccupancy || 0) * 10) / 10,
    };
  }

  const row = safeQuery(db, `
    SELECT
      MAX(store_total) as peakOccupancy,
      AVG(CASE WHEN open_hr AND store_total > 0 THEN store_total END) as avgOccupancy
    FROM (
      SELECT store_total,
        CAST(strftime('%H', datetime(ts/1000,'unixepoch','localtime')) AS INT) >= ?
        AND CAST(strftime('%H', datetime(ts/1000,'unixepoch','localtime')) AS INT) < ? as open_hr
      FROM (${storeOccupancySnapshotsSql()})
    )
  `, [openingHour, closingHour, venueId, startTs, endTs]);
  return {
    source: 'zone_snapshots',
    peakOccupancy: Math.round(row?.peakOccupancy || 0),
    avgOccupancy: Math.round((row?.avgOccupancy || 0) * 10) / 10,
  };
}

function fetchLiveStoreOccupancy(db, venueId) {
  const latestTs = safeQuery(db, `
    SELECT MAX(timestamp) as ts FROM zone_occupancy WHERE venue_id = ?
  `, [venueId])?.ts;
  if (!latestTs) return 0;

  const row = safeQuery(db, `
    SELECT SUM(zo.occupancy_count) as total
    FROM zone_occupancy zo
    JOIN regions_of_interest r ON r.id = zo.roi_id
    WHERE zo.venue_id = ? AND zo.timestamp = ?
      AND r.name NOT LIKE '%Queue%'
      AND r.name NOT LIKE '%Checkout%'
  `, [venueId, latestTs]);
  return row?.total || 0;
}

function fetchFootfallVisitorCount(db, venueId, startTs, endTs, storeHours) {
  const roiIds = storeHours.trafficRoiIds || [];
  if (!roiIds.length) return null;

  const placeholders = roiIds.map(() => '?').join(',');
  const fromVisits = safeQuery(db, `
    SELECT ${INGRESS_VISIT_COUNT_SQL} as c
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${placeholders})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
  `, [venueId, ...roiIds, startTs, endTs]);
  if (fromVisits?.c > 0) return fromVisits.c;

  const fromHourly = safeQuery(db, `
    SELECT SUM(visits) as c
    FROM zone_kpi_hourly
    WHERE venue_id = ? AND roi_id IN (${placeholders})
      AND ((date || ' ' || printf('%02d', hour)) >= strftime('%Y-%m-%d %H', ?, 'unixepoch', 'localtime'))
      AND ((date || ' ' || printf('%02d', hour)) <= strftime('%Y-%m-%d %H', ?, 'unixepoch', 'localtime'))
  `, [venueId, ...roiIds, Math.floor(startTs / 1000), Math.floor(endTs / 1000)]);
  if (fromHourly?.c > 0) return fromHourly.c;

  const fromDaily = safeQuery(db, `
    SELECT SUM(visits) as c
    FROM zone_kpi_daily
    WHERE venue_id = ? AND roi_id IN (${placeholders})
      AND date >= date(? / 1000, 'unixepoch', 'localtime')
      AND date <= date(? / 1000, 'unixepoch', 'localtime')
  `, [venueId, ...roiIds, startTs, endTs]);
  return fromDaily?.c || 0;
}

function fetchFootfallVisitsByHour(db, roiIds, startTs, endTs) {
  if (!roiIds?.length) return Array.from({ length: 24 }, (_, i) => ({ hour: String(i).padStart(2, '0'), visits: 0 }));

  const placeholders = roiIds.map(() => '?').join(',');
  const fromVisits = safeQueryAll(db, `
    SELECT
      strftime('%H', datetime(start_time/1000, 'unixepoch', 'localtime')) as hour,
      ${INGRESS_VISIT_COUNT_SQL} as visits
    FROM zone_visits
    WHERE roi_id IN (${placeholders})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
    GROUP BY hour
    ORDER BY hour
  `, [...roiIds, startTs, endTs]);

  if (fromVisits.length > 0) {
    const hourlyData = Array.from({ length: 24 }, (_, i) => ({
      hour: i.toString().padStart(2, '0'),
      visits: 0,
    }));
    for (const row of fromVisits) {
      const idx = parseInt(row.hour, 10);
      if (idx >= 0 && idx < 24) hourlyData[idx].visits = row.visits;
    }
    return hourlyData;
  }

  const fromKpiHourly = safeQueryAll(db, `
    SELECT printf('%02d', hour) as hour, SUM(visits) as visits
    FROM zone_kpi_hourly
    WHERE roi_id IN (${placeholders})
      AND ((date || ' ' || printf('%02d', hour)) >= strftime('%Y-%m-%d %H', ?, 'unixepoch', 'localtime'))
      AND ((date || ' ' || printf('%02d', hour)) <= strftime('%Y-%m-%d %H', ?, 'unixepoch', 'localtime'))
    GROUP BY hour
    ORDER BY hour
  `, [...roiIds, Math.floor(startTs / 1000), Math.floor(endTs / 1000)]);

  const hourlyData = Array.from({ length: 24 }, (_, i) => ({
    hour: i.toString().padStart(2, '0'),
    visits: 0,
  }));
  for (const row of fromKpiHourly) {
    const idx = parseInt(row.hour, 10);
    if (idx >= 0 && idx < 24) hourlyData[idx].visits = row.visits;
  }
  return hourlyData;
}

function fetchPeriodDeltasForFootfall(db, venueId, startTs, endTs, storeHours, dataHealth) {
  const duration = endTs - startTs;
  const prevStart = startTs - duration;
  const prevEnd = startTs;
  const pctDelta = (curr, prev) => (prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null);

  if (dataHealth?.ingressRecording && storeHours.trafficRoiIds?.length) {
    const placeholders = storeHours.trafficRoiIds.map(() => '?').join(',');
    const countVisitors = (start, end) => {
      const r = safeQuery(db, `
        SELECT ${INGRESS_VISIT_COUNT_SQL} as visitors
        FROM zone_visits
        WHERE venue_id = ? AND roi_id IN (${placeholders})
          AND start_time >= ? AND start_time < ?
          AND track_key NOT LIKE '%cashier%'
      `, [venueId, ...storeHours.trafficRoiIds, start, end]);
      return r?.visitors || 0;
    };
    const current = countVisitors(startTs, endTs);
    const previous = countVisitors(prevStart, prevEnd);
    return {
      visitorsDeltaPct: pctDelta(current, previous),
      visitsDeltaPct: pctDelta(current, previous),
      engagementDeltaPct: null,
      previousPeriodStartTs: prevStart,
      previousPeriodEndTs: prevEnd,
    };
  }

  const countQueue = (start, end) => {
    const r = safeQuery(db, `
      SELECT COUNT(DISTINCT track_key) as visitors
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
        AND waiting_time_ms >= 5000
    `, [venueId, start, end]);
    return r?.visitors || 0;
  };
  const current = countQueue(startTs, endTs);
  const previous = countQueue(prevStart, prevEnd);
  return {
    visitorsDeltaPct: pctDelta(current, previous),
    visitsDeltaPct: pctDelta(current, previous),
    engagementDeltaPct: null,
    previousPeriodStartTs: prevStart,
    previousPeriodEndTs: prevEnd,
  };
}

function fetchQueueVisitorTimeline(db, venueId, startTs, endTs, grain) {
  if (grain === 'hour') {
    return safeQueryAll(db, `
      SELECT (queue_entry_time / 3600000) * 3600000 as bucketStartTs,
        COUNT(DISTINCT track_key) as value
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
        AND waiting_time_ms >= 5000
      GROUP BY bucketStartTs ORDER BY bucketStartTs
    `, [venueId, startTs, endTs]);
  }
  if (grain === 'day') {
    return safeQueryAll(db, `
      SELECT date(queue_entry_time / 1000, 'unixepoch', 'localtime') as date,
        COUNT(DISTINCT track_key) as value
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
        AND waiting_time_ms >= 5000
      GROUP BY date ORDER BY date
    `, [venueId, startTs, endTs]).map(r => ({
      label: r.date,
      bucketStartTs: parseSqlDateMs(r.date),
      value: r.value || 0,
    }));
  }
  return safeQueryAll(db, `
    SELECT strftime('%Y-W%W', datetime(queue_entry_time/1000, 'unixepoch', 'localtime')) as weekKey,
      MIN(date(queue_entry_time/1000, 'unixepoch', 'localtime')) as weekStart,
      COUNT(DISTINCT track_key) as value
    FROM queue_sessions
    WHERE venue_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
      AND waiting_time_ms >= 5000
    GROUP BY weekKey ORDER BY weekStart
  `, [venueId, startTs, endTs]).map(r => ({
    label: formatWeekRangeLabel(r.weekStart),
    weekStart: r.weekStart,
    bucketStartTs: parseSqlDateMs(r.weekStart),
    value: r.value || 0,
  }));
}

function fetchStoreActivityByHour(db, venueId, startTs, endTs, openingHour, closingHour, metricSource) {
  const useFrames = metricSource === 'perception_frames';
  const snapshotSql = useFrames ? storePerceptionFramesSql() : storeOccupancySnapshotsSql();
  const valueCol = useFrames ? 'frame_count' : 'store_total';

  const rows = safeQueryAll(db, `
    SELECT printf('%02d', CAST(strftime('%H', datetime(ts/1000,'unixepoch','localtime')) AS INTEGER)) as hour,
      MAX(${valueCol}) as peakOcc
    FROM (${snapshotSql})
    GROUP BY hour ORDER BY hour
  `, [venueId, startTs, endTs]);

  const byHour = new Map(rows.map(r => [r.hour, Math.round(r.peakOcc || 0)]));
  const result = [];
  for (let h = 0; h < 24; h++) {
    const hour = String(h).padStart(2, '0');
    result.push({
      hour,
      avgOccupancy: byHour.get(hour) || 0,
      isOpen: isHourWithinStoreHours(h, openingHour, closingHour),
    });
  }
  return result;
}

function toLocalDateKey(ms) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SHELF_ROI_SQL = `
  r.name NOT LIKE '%Queue%'
  AND r.name NOT LIKE '%Service%'
  AND r.name NOT LIKE '%Checkout%'
  AND (r.name LIKE '%Engagement%' OR r.name LIKE '%Shelf%' OR r.name LIKE '%Category%')
`;

function fetchTimelineCategoryLeadersByBucket(db, venueId, startTs, endTs, grain) {
  const shelfRois = safeQueryAll(db, `
    SELECT r.id, r.metadata_json
    FROM regions_of_interest r
    WHERE r.venue_id = ? AND ${SHELF_ROI_SQL}
  `, [venueId]);

  const roiCategory = new Map();
  for (const r of shelfRois) {
    roiCategory.set(r.id, resolveRoiCategoryForReporting(db, r.metadata_json) || 'Uncategorized');
  }
  const roiIds = [...roiCategory.keys()];
  if (!roiIds.length) return new Map();

  const placeholders = roiIds.map(() => '?').join(',');
  let rows;

  if (grain === 'hour') {
    rows = safeQueryAll(db, `
      SELECT (zv.start_time / 3600000) * 3600000 as bucketKey,
        zv.roi_id as roiId,
        COUNT(*) as visits
      FROM zone_visits zv
      WHERE zv.venue_id = ? AND zv.roi_id IN (${placeholders})
        AND zv.start_time >= ? AND zv.start_time < ?
      GROUP BY bucketKey, zv.roi_id
    `, [venueId, ...roiIds, startTs, endTs]);
  } else if (grain === 'day') {
    rows = safeQueryAll(db, `
      SELECT date(zv.start_time / 1000, 'unixepoch', 'localtime') as bucketKey,
        zv.roi_id as roiId,
        COUNT(*) as visits
      FROM zone_visits zv
      WHERE zv.venue_id = ? AND zv.roi_id IN (${placeholders})
        AND zv.start_time >= ? AND zv.start_time < ?
      GROUP BY bucketKey, zv.roi_id
    `, [venueId, ...roiIds, startTs, endTs]);
  } else {
    rows = safeQueryAll(db, `
      SELECT MIN(date(zv.start_time / 1000, 'unixepoch', 'localtime')) as bucketKey,
        zv.roi_id as roiId,
        COUNT(*) as visits
      FROM zone_visits zv
      WHERE zv.venue_id = ? AND zv.roi_id IN (${placeholders})
        AND zv.start_time >= ? AND zv.start_time < ?
      GROUP BY strftime('%Y-W%W', datetime(zv.start_time/1000, 'unixepoch', 'localtime')), zv.roi_id
    `, [venueId, ...roiIds, startTs, endTs]);
  }

  const bucketMap = new Map();
  for (const row of rows) {
    const category = roiCategory.get(row.roiId) || 'Uncategorized';
    const key = grain === 'hour' ? Math.round(Number(row.bucketKey)) : row.bucketKey;
    if (!bucketMap.has(key)) bucketMap.set(key, new Map());
    const catMap = bucketMap.get(key);
    catMap.set(category, (catMap.get(category) || 0) + (row.visits || 0));
  }

  const result = new Map();
  for (const [bucketKey, catMap] of bucketMap) {
    let leaders = [...catMap.entries()]
      .map(([category, visits]) => ({ category, visits }))
      .sort((a, b) => b.visits - a.visits);
    const named = leaders.filter(c => c.category !== 'Uncategorized');
    if (named.length > 0) leaders = named;
    result.set(bucketKey, leaders.slice(0, 3));
  }
  return result;
}

function attachCategoryLeadersToPoints(points, grain, leadersByBucket) {
  if (!leadersByBucket?.size) return points;
  return points.map(p => {
    const key = grain === 'hour' ? Math.round(p.bucketStartTs) : toLocalDateKey(p.bucketStartTs);
    return { ...p, topCategories: leadersByBucket.get(key) || [] };
  });
}

function parseSqlDateMs(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return NaN;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

function formatWeekRangeLabel(weekStartStr) {
  const ms = parseSqlDateMs(weekStartStr);
  if (!Number.isFinite(ms)) return weekStartStr || '';
  const start = new Date(ms);
  const end = new Date(ms);
  end.setDate(end.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString([], opts)} – ${end.toLocaleDateString([], opts)}`;
}

function rowsToTimelinePoints(rows, grain, openingHour, closingHour) {
  return (rows || [])
    .map(r => {
      const bucketStartTs = Math.round(Number(r.bucketStartTs));
      if (!Number.isFinite(bucketStartTs)) return null;
      const hour = new Date(bucketStartTs).getHours();
      let label = r.label || r.date || r.weekKey || '';
      if (grain === 'week') {
        label = formatWeekRangeLabel(r.weekStart || r.date || label);
      } else if (!label || label.includes('-W')) {
        if (grain === 'hour') {
          label = new Date(bucketStartTs).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit',
          });
        } else if (grain === 'day') {
          label = new Date(bucketStartTs).toLocaleDateString([], { month: 'short', day: 'numeric' });
        } else {
          label = new Date(bucketStartTs).toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
      }
      return {
        label,
        bucketStartTs,
        value: Number(r.value) || 0,
        peak: Number(r.peak) || 0,
        avgVal: r.avgVal != null ? Number(r.avgVal) : undefined,
        isOpen: grain !== 'hour' || isHourWithinStoreHours(hour, openingHour, closingHour),
      };
    })
    .filter(Boolean);
}

function fetchQueueLanesBreakdown(db, venueId, startTs, endTs) {
  const lanes = safeQueryAll(db, `
    SELECT
      r.id,
      r.name,
      COUNT(*) as sessions,
      ROUND(AVG(CASE WHEN qs.is_abandoned = 0 THEN qs.waiting_time_ms END) / 60000.0, 2) as avgWaitMin,
      ROUND(SUM(CASE WHEN qs.is_abandoned = 1 THEN 1.0 ELSE 0 END) * 100.0 / COUNT(*), 1) as abandonPct,
      SUM(CASE WHEN qs.is_abandoned = 0 THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN qs.is_abandoned = 1 THEN 1 ELSE 0 END) as abandoned
    FROM queue_sessions qs
    JOIN regions_of_interest r ON r.id = qs.queue_zone_id
    WHERE qs.venue_id = ?
      AND qs.queue_entry_time >= ?
      AND qs.queue_entry_time <= ?
      AND qs.waiting_time_ms >= 5000
    GROUP BY r.id, r.name
    ORDER BY sessions DESC
  `, [venueId, startTs, endTs]);

  const latestTs = safeQuery(db, `
    SELECT MAX(timestamp) as ts FROM zone_occupancy WHERE venue_id = ?
  `, [venueId])?.ts;

  return lanes.map(lane => {
    let currentQueue = 0;
    if (latestTs) {
      const occ = safeQuery(db, `
        SELECT occupancy_count FROM zone_occupancy
        WHERE roi_id = ? AND timestamp = ?
      `, [lane.id, latestTs]);
      currentQueue = occ?.occupancy_count || 0;
    }
    return {
      id: lane.id,
      name: lane.name,
      sessions: lane.sessions || 0,
      avgWaitMin: lane.avgWaitMin || 0,
      abandonPct: lane.abandonPct || 0,
      completed: lane.completed || 0,
      abandoned: lane.abandoned || 0,
      currentQueue,
    };
  });
}

function fetchOperationsTimeline(db, venueId, startTs, endTs, grain, storeHours, dataHealth, metricSource) {
  const { openingHour, closingHour, trafficRoiIds } = storeHours;
  const roiPlaceholders = (trafficRoiIds || []).map(() => '?').join(',');
  const useFrames = metricSource === 'perception_frames';
  const snapshotSql = useFrames ? storePerceptionFramesSql() : storeOccupancySnapshotsSql();
  const valueCol = useFrames ? 'frame_count' : 'store_total';
  const activeFrameFilter = useFrames
    ? `${valueCol} >= ${MIN_ACTIVE_FRAME_COUNT}`
    : `${valueCol} > 0`;

  const fetchVisitorRows = () => {
    if (!dataHealth?.ingressRecording) {
      return [];
    }

    if (grain === 'hour') {
      return safeQueryAll(db, `
        SELECT (start_time / 3600000) * 3600000 as bucketStartTs,
          ${INGRESS_VISIT_COUNT_SQL} as value
        FROM zone_visits
        WHERE venue_id = ? AND roi_id IN (${roiPlaceholders})
          AND start_time >= ? AND start_time < ?
          AND track_key NOT LIKE '%cashier%'
        GROUP BY bucketStartTs ORDER BY bucketStartTs
      `, [venueId, ...trafficRoiIds, startTs, endTs]);
    }

    if (grain === 'day') {
      let rows = safeQueryAll(db, `
        SELECT date, SUM(visits) as value FROM zone_kpi_daily
        WHERE venue_id = ? AND roi_id IN (${roiPlaceholders})
          AND date >= date(? / 1000, 'unixepoch', 'localtime')
          AND date <= date(? / 1000, 'unixepoch', 'localtime')
        GROUP BY date ORDER BY date
      `, [venueId, ...trafficRoiIds, startTs, endTs]);
      if (!rows.length) {
        rows = safeQueryAll(db, `
          SELECT date(start_time / 1000, 'unixepoch', 'localtime') as date,
            ${INGRESS_VISIT_COUNT_SQL} as value
          FROM zone_visits
          WHERE venue_id = ? AND roi_id IN (${roiPlaceholders})
            AND start_time >= ? AND start_time < ?
            AND track_key NOT LIKE '%cashier%'
          GROUP BY date ORDER BY date
        `, [venueId, ...trafficRoiIds, startTs, endTs]);
      }
      return rows.map(r => ({
        label: r.date,
        bucketStartTs: parseSqlDateMs(r.date),
        value: r.value || 0,
      }));
    }

    let rows = safeQueryAll(db, `
      SELECT strftime('%Y-W%W', date) as weekKey,
        MIN(date) as weekStart, SUM(visits) as value
      FROM zone_kpi_daily
      WHERE venue_id = ? AND roi_id IN (${roiPlaceholders})
        AND date >= date(? / 1000, 'unixepoch', 'localtime')
        AND date <= date(? / 1000, 'unixepoch', 'localtime')
      GROUP BY weekKey ORDER BY weekStart
    `, [venueId, ...trafficRoiIds, startTs, endTs]);
    if (!rows.length) {
      rows = safeQueryAll(db, `
        SELECT strftime('%Y-W%W', datetime(start_time/1000, 'unixepoch', 'localtime')) as weekKey,
          MIN(date(start_time/1000, 'unixepoch', 'localtime')) as weekStart,
          ${INGRESS_VISIT_COUNT_SQL} as value
        FROM zone_visits
        WHERE venue_id = ? AND roi_id IN (${roiPlaceholders})
          AND start_time >= ? AND start_time < ?
          AND track_key NOT LIKE '%cashier%'
        GROUP BY weekKey ORDER BY weekStart
      `, [venueId, ...trafficRoiIds, startTs, endTs]);
    }
    return rows.map(r => ({
      label: formatWeekRangeLabel(r.weekStart),
      weekStart: r.weekStart,
      bucketStartTs: parseSqlDateMs(r.weekStart),
      value: r.value || 0,
    }));
  };

  const fetchOccRows = () => {
    if (grain === 'hour') {
      return safeQueryAll(db, `
        SELECT (ts / 3600000) * 3600000 as bucketStartTs,
          AVG(CASE WHEN ${activeFrameFilter} THEN ${valueCol} END) as avgVal,
          MAX(${valueCol}) as peak
        FROM (${snapshotSql})
        GROUP BY bucketStartTs ORDER BY bucketStartTs
      `, [venueId, startTs, endTs]);
    }
    if (grain === 'day') {
      return safeQueryAll(db, `
        SELECT date(ts / 1000, 'unixepoch', 'localtime') as date,
          AVG(CASE WHEN ${activeFrameFilter} THEN ${valueCol} END) as avgVal,
          MAX(${valueCol}) as peak
        FROM (${snapshotSql})
        GROUP BY date ORDER BY date
      `, [venueId, startTs, endTs]).map(r => ({
        label: r.date,
        bucketStartTs: parseSqlDateMs(r.date),
        value: r.peak || 0,
        avgVal: r.avgVal || 0,
        peak: r.peak || 0,
      }));
    }
    return safeQueryAll(db, `
      SELECT strftime('%Y-W%W', datetime(ts/1000, 'unixepoch', 'localtime')) as weekKey,
        MIN(date(ts/1000, 'unixepoch', 'localtime')) as weekStart,
        AVG(CASE WHEN ${activeFrameFilter} THEN ${valueCol} END) as avgVal,
        MAX(${valueCol}) as peak
      FROM (${snapshotSql})
      GROUP BY weekKey ORDER BY weekStart
    `, [venueId, startTs, endTs]).map(r => ({
      label: formatWeekRangeLabel(r.weekStart),
      weekStart: r.weekStart,
      bucketStartTs: parseSqlDateMs(r.weekStart),
      value: r.peak || 0,
      avgVal: r.avgVal || 0,
      peak: r.peak || 0,
    }));
  };

  const visitorRows = fetchVisitorRows();
  const occRows = fetchOccRows();
  const categoryLeaders = fetchTimelineCategoryLeadersByBucket(db, venueId, startTs, endTs, grain);

  const toPoints = (rows, isOcc) => attachCategoryLeadersToPoints(
    rowsToTimelinePoints(
      rows.map(r => ({
        ...r,
        bucketStartTs: Math.round(Number(r.bucketStartTs)),
        value: isOcc
          ? Math.round((r.peak ?? r.value ?? 0) * 10) / 10
          : (r.value || 0),
        peak: Math.round((r.peak ?? r.value ?? 0) * 10) / 10,
        avgVal: r.avgVal != null ? Math.round(r.avgVal * 10) / 10 : undefined,
      })),
      grain,
      openingHour,
      closingHour,
    ),
    grain,
    categoryLeaders,
  );

  return {
    grain,
    visitors: toPoints(visitorRows, false),
    occupancy: toPoints(occRows, true),
    visitorSource: dataHealth?.ingressRecording ? 'ingress' : 'none',
  };
}

function buildFootfallSummary(db, venueId, startTs, endTs, storeHours, dataHealth) {
  const { openingHour, closingHour, footfallRoiId, footfallZoneName, trafficRoiIds } = storeHours;
  const roiIds = trafficRoiIds?.length ? trafficRoiIds : (footfallRoiId ? [footfallRoiId] : []);

  if (!roiIds.length) {
    return {
      configured: false,
      footfallZoneName: null,
      dataSource: 'none',
      ingressRecording: false,
      warning: 'No ingress zone configured.',
      ...computeStoreFootfallFromHourly([], openingHour, closingHour),
    };
  }

  const visitsByHour = fetchFootfallVisitsByHour(db, roiIds, startTs, endTs);
  const footfall = computeStoreFootfallFromHourly(visitsByHour, openingHour, closingHour);
  const hasData = visitsByHour.some(h => h.visits > 0);

  return {
    configured: true,
    footfallRoiId: footfallRoiId || roiIds[0],
    footfallZoneName,
    dataSource: hasData ? 'zone_visits' : 'empty',
    ingressRecording: !!dataHealth?.ingressRecording,
    warning: dataHealth?.message || null,
    ...footfall,
  };
}

function buildOperationsAlerts(kpis, periodDeltas, queueLanes, dataHealth) {
  const alerts = [];

  if (dataHealth && !dataHealth.ingressRecording) {
    alerts.push({
      id: 'ingress-not-recording',
      severity: 'info',
      title: 'Footfall zone pending',
      message: dataHealth.message || 'Ingress zone recorded 0 visits — verify polygon placement when store is open.',
      metric: 'ingressVisitCount',
      value: 0,
    });
  }

  if ((kpis.avgWaitingTimeMin || 0) > 5) {
    alerts.push({
      id: 'high-wait',
      severity: 'warn',
      title: 'Elevated wait time',
      message: `Average checkout wait is ${(kpis.avgWaitingTimeMin || 0).toFixed(1)} min — consider opening another lane.`,
      metric: 'avgWaitingTimeMin',
      value: kpis.avgWaitingTimeMin,
    });
  }

  if ((kpis.abandonRate || 0) > 15) {
    alerts.push({
      id: 'high-abandon',
      severity: 'bad',
      title: 'High abandon rate',
      message: `${(kpis.abandonRate || 0).toFixed(1)}% of queue sessions ended without checkout.`,
      metric: 'abandonRate',
      value: kpis.abandonRate,
    });
  }

  if ((kpis.currentQueueLength || 0) > 8) {
    alerts.push({
      id: 'long-queue',
      severity: 'warn',
      title: 'Queue building',
      message: `${kpis.currentQueueLength} shoppers waiting right now.`,
      metric: 'currentQueueLength',
      value: kpis.currentQueueLength,
    });
  }

  if (periodDeltas.visitorsDeltaPct != null && periodDeltas.visitorsDeltaPct <= -20) {
    alerts.push({
      id: 'traffic-drop',
      severity: 'warn',
      title: 'Traffic down vs prior period',
      message: `Visitors ${periodDeltas.visitorsDeltaPct}% vs previous period.`,
      metric: 'visitorsDeltaPct',
      value: periodDeltas.visitorsDeltaPct,
    });
  }

  const worstLane = [...queueLanes].sort((a, b) => (b.abandonPct || 0) - (a.abandonPct || 0))[0];
  if (worstLane && worstLane.abandonPct > 20 && worstLane.sessions >= 5) {
    alerts.push({
      id: 'lane-abandon',
      severity: 'warn',
      title: `${worstLane.name} under pressure`,
      message: `${worstLane.abandonPct}% abandon rate on this lane (${worstLane.sessions} sessions).`,
      metric: 'laneAbandonPct',
      value: worstLane.abandonPct,
      laneId: worstLane.id,
    });
  }

  if ((kpis.deadZonesCount || 0) >= 3) {
    alerts.push({
      id: 'dead-zones',
      severity: 'info',
      title: 'Dead zones detected',
      message: `${kpis.deadZonesCount} areas below utilization threshold — review layout.`,
      metric: 'deadZonesCount',
      value: kpis.deadZonesCount,
    });
  }

  return alerts.slice(0, 6);
}

/**
 * Merchandising KPIs: Shelf & Category Performance
 * Uses KpiSourceAdapter (AI Narrator 2) as single source of truth for consistency.
 * Adds category-filtered metrics on top of base KPIs.
 */
async function computeMerchandisingKpis(db, kpiCalculator, shelfKPIEnricher, venueId, startTs, endTs, categoryId, shelfId) {
  const supporting = { topCategories: [], topBrands: [], selectedCategory: categoryId || 'all', deadZones: [], topZones: [] };

  // Get base KPIs from AI Narrator 2 (single source of truth)
  const narrator2Data = await getNarrator2Kpis(venueId, 'merchandising', startTs, endTs);
  
  // Start with Narrator2 KPIs as base
  const kpis = narrator2Data?.kpis ? { ...narrator2Data.kpis } : {};
  
  // Merge supporting data from Narrator2
  if (narrator2Data?.supporting?.deadZones) {
    supporting.deadZones = narrator2Data.supporting.deadZones;
  }
  if (narrator2Data?.supporting?.topZones) {
    supporting.topZones = narrator2Data.supporting.topZones;
  }
  if (narrator2Data?.supporting?.zoneUtilThresholdPct != null) {
    supporting.zoneUtilThresholdPct = narrator2Data.supporting.zoneUtilThresholdPct;
  }

  // Category filter: align zone map lists with filtered KPI scope
  if (categoryId && categoryId !== 'all') {
    const needle = String(categoryId).toLowerCase();
    supporting.deadZones = (supporting.deadZones || []).filter(
      z => (z.category || '').toLowerCase() === needle,
    );
    supporting.topZones = (supporting.topZones || []).filter(
      z => (z.category || '').toLowerCase() === needle,
    );
  }
  if (narrator2Data?.supporting?.topCategories?.length) {
    supporting.topCategories = narrator2Data.supporting.topCategories;
  }

  // If category filter is applied, compute category-specific metrics
  if (categoryId && categoryId !== 'all') {
    const venueRois = safeQueryAll(db, `
      SELECT id, metadata_json, name FROM regions_of_interest WHERE venue_id = ?
    `, [venueId]);

    const matchingRoiIds = venueRois
      .filter((r) => {
        const cat = resolveRoiCategoryForReporting(db, r.metadata_json);
        return cat === categoryId || r.name.includes(categoryId);
      })
      .map((r) => r.id);

    if (matchingRoiIds.length === 0) {
      return { kpis, supporting };
    }

    const placeholders = matchingRoiIds.map(() => '?').join(',');
    const categoryStats = safeQuery(db, `
      SELECT 
        COUNT(DISTINCT track_key) as unique_visitors,
        COUNT(*) as total_visits,
        COUNT(CASE WHEN is_dwell = 1 THEN 1 END) as dwell_count,
        COUNT(CASE WHEN is_engagement = 1 THEN 1 END) as engagement_count,
        SUM(duration_ms) as total_duration_ms
      FROM zone_visits zv
      JOIN regions_of_interest r ON zv.roi_id = r.id
      WHERE r.venue_id = ? AND zv.start_time >= ? AND zv.start_time < ?
        AND r.id IN (${placeholders})
    `, [venueId, startTs, endTs, ...matchingRoiIds]);

    if (categoryStats && categoryStats.total_visits > 0) {
      // Override with category-specific metrics
      kpis.browsingRate = Math.round((categoryStats.dwell_count / categoryStats.total_visits) * 100 * 10) / 10;
      kpis.categoryEngagementRate = Math.round((categoryStats.engagement_count / categoryStats.total_visits) * 100 * 10) / 10;
      kpis.passbyCount = Math.max(0, categoryStats.total_visits - categoryStats.dwell_count);
      
      // Avg browse time for category (total time / total visits, in minutes - same formula as Narrator2)
      kpis.avgBrowseTime = categoryStats.unique_visitors > 0
        ? Math.round((categoryStats.total_duration_ms / categoryStats.unique_visitors) / 60000 * 10) / 10
        : 0;
    }
  }

  // Category conversion (estimated from engagement)
  kpis.categoryConversionRate = Math.round((kpis.categoryEngagementRate || 0) * 0.4 * 10) / 10;

  return { kpis, supporting };
}

function resolveVenueUuid(db, venueId) {
  if (venueId && venueId.includes('-')) return venueId;
  const venue = safeQuery(db, 'SELECT id FROM venues LIMIT 1');
  return venue?.id || venueId || '1f6c779c-5f09-445f-ae4b-1ce6abc20e9f';
}

function fetchPeriodDeltas(db, venueId, startTs, endTs) {
  const duration = endTs - startTs;
  const prevStart = startTs - duration;
  const prevEnd = startTs;

  const current = safeQuery(db, `
    SELECT
      COUNT(DISTINCT track_key) as visitors,
      COUNT(*) as visits,
      COUNT(CASE WHEN is_engagement = 1 THEN 1 END) as engagements
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
  `, [venueId, startTs, endTs]) || { visitors: 0, visits: 0, engagements: 0 };

  const previous = safeQuery(db, `
    SELECT
      COUNT(DISTINCT track_key) as visitors,
      COUNT(*) as visits,
      COUNT(CASE WHEN is_engagement = 1 THEN 1 END) as engagements
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
  `, [venueId, prevStart, prevEnd]) || { visitors: 0, visits: 0, engagements: 0 };

  const pctDelta = (curr, prev) => (prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null);

  return {
    visitorsDeltaPct: pctDelta(current.visitors || 0, previous.visitors || 0),
    visitsDeltaPct: pctDelta(current.visits || 0, previous.visits || 0),
    engagementDeltaPct: pctDelta(current.engagements || 0, previous.engagements || 0),
    previousPeriodStartTs: prevStart,
    previousPeriodEndTs: prevEnd,
  };
}

function fetchCampaignRankingBrief(db, venueId, startTs, endTs) {
  let effectiveStart = startTs;
  const effectiveEnd = endTs;

  let rows = safeQueryAll(db, `
    SELECT c.id, c.name,
      AVG(CASE WHEN k.controls_count > 0 THEN k.ces_score END) as ces,
      AVG(k.lift_rel) * 100 as eal,
      AVG(k.aar_score) as aar,
      SUM(k.exposed_count) as exposures,
      AVG(CASE WHEN k.controls_count > 0 THEN k.confidence_mean END) * 100 as confidence
    FROM dooh_campaigns c
    JOIN dooh_campaign_kpis k ON k.campaign_id = c.id
    WHERE k.venue_id = ? AND k.bucket_start_ts >= ? AND k.bucket_start_ts <= ?
    GROUP BY c.id, c.name
    ORDER BY ces DESC, eal DESC
  `, [venueId, effectiveStart, effectiveEnd]);

  if (!rows.length) {
    effectiveStart = endTs - (30 * 24 * 60 * 60 * 1000);
    rows = safeQueryAll(db, `
      SELECT c.id, c.name,
        AVG(CASE WHEN k.controls_count > 0 THEN k.ces_score END) as ces,
        AVG(k.lift_rel) * 100 as eal,
        AVG(k.aar_score) as aar,
        SUM(k.exposed_count) as exposures,
        AVG(CASE WHEN k.controls_count > 0 THEN k.confidence_mean END) * 100 as confidence
      FROM dooh_campaigns c
      JOIN dooh_campaign_kpis k ON k.campaign_id = c.id
      WHERE k.venue_id = ? AND k.bucket_start_ts >= ? AND k.bucket_start_ts <= ?
      GROUP BY c.id, c.name
      ORDER BY ces DESC, eal DESC
    `, [venueId, effectiveStart, effectiveEnd]);
  }

  const campaignRanking = rows.map(row => ({
    id: row.id,
    name: row.name,
    ces: Math.round((row.ces || 0) * 10) / 10,
    eal: Math.round((row.eal || 0) * 10) / 10,
    aar: Math.round((row.aar || 0) * 10) / 10,
    exposures: row.exposures || 0,
    confidence: Math.round((row.confidence || 0) * 10) / 10,
  }));

  return {
    campaignRanking,
    topCampaigns: campaignRanking.slice(0, 5),
    dataWindowStartTs: effectiveStart,
    dataWindowEndTs: effectiveEnd,
  };
}

function rateStatus(value, { good, warn, direction = 'higher' }) {
  if (value == null) return 'neutral';
  if (direction === 'lower') {
    if (value <= good) return 'good';
    if (value <= warn) return 'warn';
    return 'bad';
  }
  if (value >= good) return 'good';
  if (value >= warn) return 'warn';
  return 'bad';
}

function buildExecutivePillars(kpis, deltas, topCategories, topCampaigns) {
  const topCategory = topCategories?.[0];
  const topCampaign = topCampaigns?.[0];
  return [
    {
      id: 'traffic',
      label: 'Traffic',
      metric: 'Total Visitors',
      value: kpis.totalVisitors ?? 0,
      format: 'int',
      status: rateStatus(kpis.totalVisitors, { good: 500, warn: 100, direction: 'higher' }),
      deltaPct: deltas.visitorsDeltaPct,
      detail: kpis.engagementRate != null
        ? `${Math.round(kpis.engagementRate * 10) / 10}% store engagement`
        : undefined,
    },
    {
      id: 'operations',
      label: 'Operations',
      metric: 'Avg Wait Time',
      value: kpis.avgWaitingTimeMin ?? kpis.avgQueueWaitTime ?? 0,
      format: 'minutes',
      status: rateStatus(kpis.avgWaitingTimeMin ?? kpis.avgQueueWaitTime, { good: 2, warn: 5, direction: 'lower' }),
      detail: kpis.abandonRate != null
        ? `${Math.round(kpis.abandonRate * 10) / 10}% abandon rate`
        : undefined,
    },
    {
      id: 'merchandising',
      label: 'Merchandising',
      metric: topCategory ? `Top: ${topCategory.category}` : 'Engagement',
      value: topCategory?.engagementRate ?? kpis.engagementRate ?? 0,
      format: 'percent',
      status: rateStatus(topCategory?.engagementRate ?? kpis.engagementRate, { good: 5, warn: 2, direction: 'higher' }),
      detail: topCategory
        ? `${topCategory.totalVisits?.toLocaleString?.() ?? topCategory.totalVisits} visits · ${topCategory.browsingRate}% browsing`
        : undefined,
    },
    {
      id: 'media',
      label: 'Retail Media',
      metric: topCampaign ? topCampaign.name : 'Campaign Score',
      value: topCampaign?.ces ?? kpis.ces ?? 0,
      format: topCampaign ? 'score' : 'score',
      status: rateStatus(topCampaign?.ces ?? kpis.ces, { good: 50, warn: 30, direction: 'higher' }),
      detail: kpis.eal != null
        ? `EAL ${Math.round(kpis.eal * 10) / 10}% · ${topCampaign?.exposures?.toLocaleString?.() ?? 0} exposures`
        : undefined,
    },
  ];
}

/**
 * Retail Media KPIs: PEBLE™ Effectiveness
 */
async function computeRetailMediaKpis(db, venueId, startTs, endTs, campaignId) {
  const kpis = {};
  const supporting = {
    activeCampaigns: [],
    campaignRanking: [],
    topCampaigns: [],
    underperformingCampaigns: [],
    doohScreens: [],
  };

  let resolvedVenueId = venueId;
  if (!venueId.includes('-')) {
    const venue = safeQuery(db, 'SELECT id FROM venues LIMIT 1');
    resolvedVenueId = venue?.id || '1f6c779c-5f09-445f-ae4b-1ce6abc20e9f';
  }

  let effectiveStart = startTs;
  const effectiveEnd = endTs;
  let campaignFilter = '';
  let params = [resolvedVenueId, effectiveStart, effectiveEnd];
  if (campaignId) {
    campaignFilter = ' AND campaign_id = ?';
    params.push(campaignId);
  }

  const aggregateSql = `
    SELECT 
      AVG(lift_rel) * 100 as avg_eal,
      AVG(CASE WHEN controls_count > 0 THEN ces_score END) as avg_ces,
      AVG(mean_aqs_exposed) as avg_aqs,
      AVG(aar_score) as avg_aar,
      AVG(tta_accel) * 100 as avg_tta,
      AVG(engagement_lift_s) as avg_dci,
      AVG(CASE WHEN controls_count > 0 THEN confidence_mean END) * 100 as avg_confidence,
      COUNT(DISTINCT campaign_id) as campaign_count
    FROM dooh_campaign_kpis
    WHERE venue_id = ? AND bucket_start_ts >= ? AND bucket_start_ts <= ?${campaignFilter}
  `;

  let campaignStats = safeQuery(db, aggregateSql, params);

  if (!campaignStats?.campaign_count) {
    effectiveStart = endTs - (30 * 24 * 60 * 60 * 1000);
    params = [resolvedVenueId, effectiveStart, effectiveEnd];
    if (campaignId) params.push(campaignId);
    campaignStats = safeQuery(db, aggregateSql, params);
  }

  kpis.eal = Math.round((campaignStats?.avg_eal || 0) * 10) / 10;
  kpis.ces = Math.round((campaignStats?.avg_ces || 0) * 10) / 10;
  kpis.aqs = Math.round((campaignStats?.avg_aqs || 0) * 10) / 10;
  kpis.aar = Math.round((campaignStats?.avg_aar || 0) * 10) / 10;
  kpis.ttaSec = Math.round(campaignStats?.avg_tta || 0);
  kpis.dci = Math.round((campaignStats?.avg_dci || 0) * 100) / 100;
  kpis.confidencePct = Math.round((campaignStats?.avg_confidence || 0) * 10) / 10;

  const rankingParams = [resolvedVenueId, effectiveStart, effectiveEnd];
  let rankingFilter = '';
  if (campaignId) {
    rankingFilter = ' AND c.id = ?';
    rankingParams.push(campaignId);
  }

  const campaignRows = safeQueryAll(db, `
    SELECT c.id, c.name, c.screen_ids_json,
      AVG(CASE WHEN k.controls_count > 0 THEN k.ces_score END) as ces,
      AVG(k.lift_rel) * 100 as eal,
      AVG(k.aar_score) as aar,
      SUM(k.exposed_count) as exposures,
      AVG(CASE WHEN k.controls_count > 0 THEN k.confidence_mean END) * 100 as confidence
    FROM dooh_campaigns c
    JOIN dooh_campaign_kpis k ON k.campaign_id = c.id
    WHERE k.venue_id = ? AND k.bucket_start_ts >= ? AND k.bucket_start_ts <= ?${rankingFilter}
    GROUP BY c.id, c.name, c.screen_ids_json
  `, rankingParams);

  const campaignRanking = campaignRows.map(row => {
    let screenIds = [];
    try { screenIds = JSON.parse(row.screen_ids_json || '[]'); } catch { /* ignore */ }
    return {
      id: row.id,
      name: row.name,
      screenIds,
      ces: Math.round((row.ces || 0) * 10) / 10,
      eal: Math.round((row.eal || 0) * 10) / 10,
      aar: Math.round((row.aar || 0) * 10) / 10,
      exposures: row.exposures || 0,
      confidence: Math.round((row.confidence || 0) * 10) / 10,
    };
  }).sort((a, b) => (b.ces || b.eal) - (a.ces || a.eal));

  const topCampaigns = campaignRanking
    .filter(c => c.exposures > 0 && (c.ces >= 50 || c.eal >= 10))
    .slice(0, 10);
  const underperformingCampaigns = campaignRanking
    .filter(c => c.exposures > 0 && (c.ces < 30 || c.eal <= 0))
    .sort((a, b) => (a.ces || 0) - (b.ces || 0))
    .slice(0, 10);

  supporting.campaignRanking = campaignRanking;
  supporting.topCampaigns = topCampaigns.length > 0
    ? topCampaigns
    : campaignRanking.slice(0, Math.min(10, campaignRanking.length));
  supporting.underperformingCampaigns = underperformingCampaigns.length > 0
    ? underperformingCampaigns
    : [...campaignRanking].reverse().slice(0, Math.min(10, campaignRanking.length));
  supporting.activeCampaigns = campaignRanking.map(c => ({ id: c.id, name: c.name }));

  const screenRows = safeQueryAll(db, `
    SELECT s.id, s.name, s.position_json, s.sez_polygon_json,
      AVG(b.avg_aqs) as aqs,
      SUM(b.impressions) as impressions,
      SUM(b.qualified_impressions) as qualified
    FROM dooh_screens s
    LEFT JOIN dooh_kpi_buckets b ON b.screen_id = s.id
      AND b.bucket_start_ts >= ? AND b.bucket_start_ts <= ?
    WHERE s.venue_id = ? AND s.enabled = 1
    GROUP BY s.id, s.name, s.position_json, s.sez_polygon_json
  `, [effectiveStart, effectiveEnd, resolvedVenueId]);

  supporting.doohScreens = screenRows.map(row => {
    let position = { x: 0, y: 0, z: 0 };
    let sezPolygon = [];
    try { position = JSON.parse(row.position_json || '{}'); } catch { /* ignore */ }
    try { sezPolygon = JSON.parse(row.sez_polygon_json || '[]'); } catch { /* ignore */ }
    return {
      id: row.id,
      name: row.name,
      x: position.x ?? 0,
      z: position.z ?? 0,
      sezPolygon: Array.isArray(sezPolygon) ? sezPolygon.map(p => ({ x: p.x, z: p.z ?? p.y ?? 0 })) : [],
      aqs: Math.round((row.aqs || 0) * 10) / 10,
      impressions: row.impressions || 0,
      qualified: row.qualified || 0,
    };
  });

  supporting.dataWindowStartTs = effectiveStart;
  supporting.dataWindowEndTs = effectiveEnd;

  return { kpis, supporting };
}

/**
 * Executive KPIs: Executive Summary
 * Uses KpiSourceAdapter (AI Narrator 2) as single source of truth.
 * Adds executive-specific campaign metrics on top.
 */
async function computeExecutiveKpis(db, kpiCalculator, trajectoryStorage, venueId, startTs, endTs, campaignId) {
  const resolvedVenueId = resolveVenueUuid(db, venueId);

  const narrator2Data = await getNarrator2Kpis(resolvedVenueId, 'executive', startTs, endTs);

  const kpis = narrator2Data?.kpis ? { ...narrator2Data.kpis } : {};
  const supporting = {
    deadZones: narrator2Data?.supporting?.deadZones || [],
    topZones: narrator2Data?.supporting?.topZones || [],
    topCategories: narrator2Data?.supporting?.topCategories || [],
    zoneUtilThresholdPct: narrator2Data?.supporting?.zoneUtilThresholdPct ?? 5,
    campaignRanking: [],
    topCampaigns: [],
    periodDeltas: {},
    executivePillars: [],
  };

  kpis.avgWaitingTimeMin = kpis.avgQueueWaitTime || 0;
  kpis.abandonRate = kpis.queueAbandonmentRate || 0;

  const campaignBrief = fetchCampaignRankingBrief(db, resolvedVenueId, startTs, endTs);
  supporting.campaignRanking = campaignBrief.campaignRanking;
  supporting.topCampaigns = campaignBrief.topCampaigns;
  supporting.dataWindowStartTs = campaignBrief.dataWindowStartTs;
  supporting.dataWindowEndTs = campaignBrief.dataWindowEndTs;

  if (campaignBrief.campaignRanking.length > 0) {
    const agg = campaignBrief.campaignRanking.reduce((acc, c) => {
      acc.ces += c.ces || 0;
      acc.eal += c.eal || 0;
      acc.count += 1;
      return acc;
    }, { ces: 0, eal: 0, count: 0 });
    kpis.ces = Math.round((agg.ces / agg.count) * 10) / 10;
    kpis.eal = Math.round((agg.eal / agg.count) * 10) / 10;
  } else {
    kpis.ces = kpis.ces ?? 0;
    kpis.eal = kpis.eal ?? 0;
  }

  supporting.periodDeltas = fetchPeriodDeltas(db, resolvedVenueId, startTs, endTs);
  supporting.executivePillars = buildExecutivePillars(
    kpis,
    supporting.periodDeltas,
    supporting.topCategories,
    supporting.topCampaigns,
  );

  supporting.highlights = {
    topZone: supporting.topZones?.[0] || null,
    worstZone: supporting.deadZones?.[0] || null,
    topCategory: supporting.topCategories?.[0] || null,
    topCampaign: supporting.topCampaigns?.[0] || null,
  };

  return { kpis, supporting };
}

return router;
}
