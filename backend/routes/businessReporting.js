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

export default function createBusinessReportingRoutes(db, trajectoryStorage, trackAggregator) {
const router = Router();
const kpiCalculator = new KPICalculator(db);
const shelfKPIEnricher = new ShelfKPIEnricher(db);

// Simple in-memory cache with TTL
const cache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds

function getCacheKey(personaId, venueId, startTs, endTs) {
  return `${personaId}:${venueId}:${startTs}:${endTs}`;
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

    // Get categories from SKU items (real product categories)
    const categories = db.prepare(`
      SELECT DISTINCT category, COUNT(*) as sku_count
      FROM sku_items
      WHERE category IS NOT NULL AND category != ''
      GROUP BY category
      ORDER BY sku_count DESC
    `).all();

    res.json({ 
      categories: [
        { id: 'all', name: 'All Categories', skuCount: categories.reduce((sum, c) => sum + c.sku_count, 0) },
        ...categories.map(c => ({ id: c.category, name: c.category, skuCount: c.sku_count }))
      ]
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
    const { personaId, venueId, startTs, endTs, categoryId, shelfId, campaignId } = req.query;
    
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

    // Check cache
    const cacheKey = getCacheKey(personaId, venueId, start, end);
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let kpis = {};
    let supporting = {};

    // Compute KPIs based on persona
    switch (personaId) {
      case 'store-manager':
        ({ kpis, supporting } = await computeStoreManagerKpis(db, kpiCalculator, trajectoryStorage, trackAggregator, venueId, start, end));
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

/**
 * Store Manager KPIs: Operations Pulse
 * Computes queue KPIs from zone_visits and zone_occupancy for Queue ROIs
 */
async function computeStoreManagerKpis(db, kpiCalculator, trajectoryStorage, trackAggregator, venueId, startTs, endTs) {
  const kpis = {};
  const supporting = { deadZones: [] };

  // Get CURRENT queue length from zone_occupancy (latest snapshot for Queue zones)
  const currentQueueStats = safeQuery(db, `
    SELECT SUM(zo.occupancy_count) as total_queue
    FROM zone_occupancy zo
    JOIN regions_of_interest r ON r.id = zo.roi_id
    WHERE r.venue_id = ? AND r.name LIKE '%Queue%'
      AND zo.timestamp = (SELECT MAX(timestamp) FROM zone_occupancy WHERE venue_id = ?)
  `, [venueId, venueId]);

  // Get AVG wait time from zone_visits dwell time in Queue zones (time range)
  const queueVisitStats = safeQuery(db, `
    SELECT COUNT(*) as total_visits, AVG(zv.duration_ms) as avg_wait_ms
    FROM zone_visits zv
    JOIN regions_of_interest r ON r.id = zv.roi_id
    WHERE r.venue_id = ? AND r.name LIKE '%Queue%'
      AND zv.start_time >= ? AND zv.start_time < ?
  `, [venueId, startTs, endTs]);

  // Calculate abandon rate from short dwell time (<2 sec) in Queue zones
  // Short visits indicate people who entered queue but left quickly (abandoned)
  const ABANDON_THRESHOLD_MS = 1000; // 1 second
  const abandonStats = safeQuery(db, `
    SELECT 
      COUNT(*) as total_visits,
      COUNT(CASE WHEN duration_ms < ? THEN 1 END) as short_visits
    FROM zone_visits zv
    JOIN regions_of_interest r ON r.id = zv.roi_id
    WHERE r.venue_id = ? AND r.name LIKE '%Queue%'
      AND zv.start_time >= ? AND zv.start_time < ?
  `, [ABANDON_THRESHOLD_MS, venueId, startTs, endTs]);

  const totalQueueVisits = abandonStats?.total_visits || 0;
  const shortVisits = abandonStats?.short_visits || 0;
  const abandonRate = totalQueueVisits > 0 ? (shortVisits / totalQueueVisits) * 100 : 0;

  kpis.currentQueueLength = currentQueueStats?.total_queue || 0;
  kpis.avgWaitingTimeMin = queueVisitStats?.avg_wait_ms 
    ? Math.round(queueVisitStats.avg_wait_ms / 60000 * 10) / 10 
    : 0;
  kpis.abandonRate = Math.round(abandonRate * 10) / 10;

  // Occupancy - SUM across all zones at each timestamp for store-wide totals
  const occupancyStats = safeQuery(db, `
    SELECT 
      MAX(store_total) as peak_occupancy,
      AVG(store_total) as avg_occupancy
    FROM (
      SELECT timestamp, SUM(occupancy_count) as store_total
      FROM zone_occupancy
      WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
      GROUP BY timestamp
    )
  `, [venueId, startTs, endTs]);

  kpis.peakOccupancy = occupancyStats?.peak_occupancy || 0;
  kpis.avgOccupancy = Math.round((occupancyStats?.avg_occupancy || 0) * 10) / 10;

  // Utilization rate from zone_visits
  const totalTimeRange = endTs - startTs;
  const utilStats = safeQuery(db, `
    SELECT SUM(duration_ms) as total_occupied_ms
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
  `, [venueId, startTs, endTs]);

  // Get zone count for normalization
  const zoneCountResult = safeQuery(db, `
    SELECT COUNT(*) as cnt FROM regions_of_interest WHERE venue_id = ?
  `, [venueId]);
  const zoneCount = zoneCountResult?.cnt || 1;

  const utilizationMs = utilStats?.total_occupied_ms || 0;
  kpis.utilizationRate = Math.round((utilizationMs / (totalTimeRange * zoneCount)) * 100 * 10) / 10;
  kpis.utilizationRate = Math.min(100, kpis.utilizationRate); // Cap at 100%

  // Dead zones: zones with <1% utilization (very low activity)
  // Exclude Queue and Service zones (closed lanes are expected to be empty)
  const DEAD_ZONE_THRESHOLD = 1; // 1% threshold
  const zoneUtils = safeQueryAll(db, `
    SELECT 
      r.id, r.name,
      COALESCE(SUM(zv.duration_ms), 0) as total_ms
    FROM regions_of_interest r
    LEFT JOIN zone_visits zv ON zv.roi_id = r.id AND zv.start_time >= ? AND zv.start_time < ?
    WHERE r.venue_id = ?
      AND r.name NOT LIKE '%Queue%'
      AND r.name NOT LIKE '%Service%'
    GROUP BY r.id, r.name
  `, [startTs, endTs, venueId]);

  for (const z of zoneUtils) {
    const zoneUtilRate = (z.total_ms / totalTimeRange) * 100;
    if (zoneUtilRate < DEAD_ZONE_THRESHOLD) {
      supporting.deadZones.push({ id: z.id, name: z.name, utilization: Math.round(zoneUtilRate * 10) / 10 });
    }
  }
  kpis.deadZonesCount = supporting.deadZones.length;

  return { kpis, supporting };
}

/**
 * Merchandising KPIs: Shelf & Category Performance
 * Optimized with single aggregated query to prevent timeout
 */
async function computeMerchandisingKpis(db, kpiCalculator, shelfKPIEnricher, venueId, startTs, endTs, categoryId, shelfId) {
  const kpis = {};
  const supporting = { topCategories: [], topBrands: [], selectedCategory: categoryId || 'all' };

  // Build category filter - match ROI name prefix before " - "
  let categoryFilter = '';
  const params = [venueId, startTs, endTs];
  
  if (categoryId && categoryId !== 'all') {
    categoryFilter = ` AND (r.name LIKE ? OR r.name = ?)`;
    params.push(`${categoryId} - %`, categoryId);
  }

  // Single aggregated query with optional category filter
  const aggregatedStats = safeQuery(db, `
    SELECT 
      COUNT(DISTINCT track_key) as unique_visitors,
      COUNT(*) as total_visits,
      COUNT(CASE WHEN is_dwell = 1 THEN 1 END) as dwell_count,
      COUNT(CASE WHEN is_engagement = 1 THEN 1 END) as engagement_count,
      AVG(CASE WHEN is_dwell = 1 THEN duration_ms END) as avg_dwell_ms,
      SUM(duration_ms) as total_duration_ms
    FROM zone_visits zv
    JOIN regions_of_interest r ON zv.roi_id = r.id
    WHERE r.venue_id = ? AND zv.start_time >= ? AND zv.start_time < ?${categoryFilter}
  `, params);

  const totalVisits = aggregatedStats?.total_visits || 0;
  const dwellCount = aggregatedStats?.dwell_count || 0;
  const engagementCount = aggregatedStats?.engagement_count || 0;
  const avgDwellMs = aggregatedStats?.avg_dwell_ms || 0;

  // Calculate browsing metrics
  kpis.browsingRate = totalVisits > 0
    ? Math.round((dwellCount / totalVisits) * 100 * 10) / 10
    : 0;
  kpis.avgBrowseTime = Math.round(avgDwellMs / 1000);
  kpis.passbyCount = Math.max(0, totalVisits - dwellCount);

  // Category engagement
  kpis.categoryEngagementRate = totalVisits > 0
    ? Math.round((engagementCount / totalVisits) * 100 * 10) / 10
    : 0;

  // Category conversion (estimated from engagement)
  kpis.categoryConversionRate = Math.round(kpis.categoryEngagementRate * 0.4 * 10) / 10;

  // Brand efficiency index (from shelf planograms if available)
  const brandStats = safeQuery(db, `
    SELECT AVG(position_score) as avg_score
    FROM shelf_planogram_items
    WHERE planogram_id IN (
      SELECT id FROM planograms WHERE venue_id = ?
    )
  `, [venueId]);

  kpis.brandEfficiencyIndex = brandStats?.avg_score 
    ? Math.round((brandStats.avg_score / 50) * 100) / 100
    : 1.0;

  // SKU position score average
  kpis.skuPositionScoreAvg = Math.round((brandStats?.avg_score || 50) * 10) / 10;

  return { kpis, supporting };
}

/**
 * Retail Media KPIs: PEBLE™ Effectiveness
 */
async function computeRetailMediaKpis(db, venueId, startTs, endTs, campaignId) {
  const kpis = {};
  const supporting = { activeCampaigns: [] };

  // Get campaign KPIs from dooh_campaign_kpis
  let campaignFilter = '';
  const params = [venueId, startTs, endTs];
  
  if (campaignId) {
    campaignFilter = ' AND campaign_id = ?';
    params.push(campaignId);
  }

  const campaignStats = safeQuery(db, `
    SELECT 
      AVG(lift_rel) * 100 as avg_eal,
      AVG(ces_score) as avg_ces,
      AVG(mean_aqs_exposed) as avg_aqs,
      AVG(aar_score) as avg_aar,
      AVG(median_tta_exposed) as avg_tta,
      AVG(mean_dci_exposed) as avg_dci,
      AVG(confidence_mean) * 100 as avg_confidence,
      COUNT(DISTINCT campaign_id) as campaign_count
    FROM dooh_campaign_kpis
    WHERE venue_id = ? AND bucket_start_ts >= ? AND bucket_start_ts <= ?${campaignFilter}
  `, params);

  kpis.eal = Math.round((campaignStats?.avg_eal || 0) * 10) / 10;
  kpis.ces = Math.round((campaignStats?.avg_ces || 0) * 10) / 10;
  kpis.aqs = Math.round((campaignStats?.avg_aqs || 0) * 10) / 10;
  kpis.aar = Math.round((campaignStats?.avg_aar || 0) * 10) / 10;
  kpis.ttaSec = Math.round(campaignStats?.avg_tta || 0);
  kpis.dci = Math.round((campaignStats?.avg_dci || 0) * 100) / 100;
  kpis.confidencePct = Math.round((campaignStats?.avg_confidence || 0) * 10) / 10;

  // Get active campaigns list
  const campaigns = safeQueryAll(db, `
    SELECT DISTINCT c.id, c.name
    FROM dooh_campaigns c
    JOIN dooh_campaign_kpis k ON k.campaign_id = c.id
    WHERE k.venue_id = ? AND k.bucket_start_ts >= ? AND k.bucket_start_ts <= ?
  `, [venueId, startTs, endTs]);

  supporting.activeCampaigns = campaigns;

  return { kpis, supporting };
}

/**
 * Executive KPIs: Executive Summary
 * Uses real data from zone_visits (same approach as store-manager)
 */
async function computeExecutiveKpis(db, kpiCalculator, trajectoryStorage, venueId, startTs, endTs, campaignId) {
  const kpis = {};
  const supporting = {};

  // Single aggregated query for engagement and visitor metrics
  const engagementStats = safeQuery(db, `
    SELECT 
      COUNT(DISTINCT track_key) as unique_visitors,
      COUNT(DISTINCT CASE WHEN is_engagement = 1 THEN track_key END) as visitors_engaged,
      COUNT(DISTINCT CASE WHEN is_conversion = 1 THEN track_key END) as visitors_converted
    FROM zone_visits zv
    JOIN regions_of_interest r ON zv.roi_id = r.id
    WHERE r.venue_id = ? AND zv.start_time >= ? AND zv.start_time < ?
  `, [venueId, startTs, endTs]);

  const uniqueVisitors = engagementStats?.unique_visitors || 0;
  const visitorsEngaged = engagementStats?.visitors_engaged || 0;
  const visitorsConverted = engagementStats?.visitors_converted || 0;

  // Real metrics based on actual data
  kpis.totalVisitors = uniqueVisitors;
  kpis.engagementRate = uniqueVisitors > 0 
    ? Math.round((visitorsEngaged / uniqueVisitors) * 100 * 10) / 10 
    : 0;
  kpis.conversionRate = visitorsEngaged > 0 
    ? Math.round((visitorsConverted / visitorsEngaged) * 100 * 10) / 10 
    : 0;

  // Queue metrics from zone_visits (same as store-manager)
  const queueVisitStats = safeQuery(db, `
    SELECT COUNT(*) as total_visits, AVG(zv.duration_ms) as avg_wait_ms
    FROM zone_visits zv
    JOIN regions_of_interest r ON r.id = zv.roi_id
    WHERE r.venue_id = ? AND r.name LIKE '%Queue%'
      AND zv.start_time >= ? AND zv.start_time < ?
  `, [venueId, startTs, endTs]);

  // Abandon rate from short dwell time (<1 sec)
  const ABANDON_THRESHOLD_MS = 1000;
  const abandonStats = safeQuery(db, `
    SELECT 
      COUNT(*) as total_visits,
      COUNT(CASE WHEN duration_ms < ? THEN 1 END) as short_visits
    FROM zone_visits zv
    JOIN regions_of_interest r ON r.id = zv.roi_id
    WHERE r.venue_id = ? AND r.name LIKE '%Queue%'
      AND zv.start_time >= ? AND zv.start_time < ?
  `, [ABANDON_THRESHOLD_MS, venueId, startTs, endTs]);

  const totalQueueVisits = abandonStats?.total_visits || 0;
  const shortVisits = abandonStats?.short_visits || 0;
  const abandonRate = totalQueueVisits > 0 ? (shortVisits / totalQueueVisits) * 100 : 0;

  kpis.avgWaitingTimeMin = queueVisitStats?.avg_wait_ms 
    ? Math.round(queueVisitStats.avg_wait_ms / 60000 * 10) / 10 
    : 0;
  kpis.abandonRate = Math.round(abandonRate * 10) / 10;

  // Campaign metrics
  let campaignFilter = '';
  const params = [venueId, startTs, endTs];
  
  if (campaignId) {
    campaignFilter = ' AND campaign_id = ?';
    params.push(campaignId);
  }

  const campaignStats = safeQuery(db, `
    SELECT 
      AVG(ces_score) as avg_ces,
      AVG(lift_rel) * 100 as avg_eal
    FROM dooh_campaign_kpis
    WHERE venue_id = ? AND bucket_start_ts >= ? AND bucket_start_ts <= ?${campaignFilter}
  `, params);

  kpis.ces = Math.round((campaignStats?.avg_ces || 0) * 10) / 10;
  kpis.eal = Math.round((campaignStats?.avg_eal || 0) * 10) / 10;

  // Utilization
  const totalTimeRange = endTs - startTs;
  const utilStats = safeQuery(db, `
    SELECT SUM(duration_ms) as total_occupied_ms
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
  `, [venueId, startTs, endTs]);

  const zoneCountResult = safeQuery(db, `
    SELECT COUNT(*) as cnt FROM regions_of_interest WHERE venue_id = ?
  `, [venueId]);
  const zoneCount = zoneCountResult?.cnt || 1;

  const utilizationMs = utilStats?.total_occupied_ms || 0;
  kpis.utilizationRate = Math.round((utilizationMs / (totalTimeRange * zoneCount)) * 100 * 10) / 10;
  kpis.utilizationRate = Math.min(100, kpis.utilizationRate);

  return { kpis, supporting };
}

return router;
}
