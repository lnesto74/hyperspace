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
import { getReportingSummary as getNarrator2Kpis } from '../services/narrator2/KpiSourceAdapter.js';

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
 * Uses KpiSourceAdapter (AI Narrator 2) as single source of truth for queue KPIs.
 * Adds store-manager specific metrics on top.
 */
async function computeStoreManagerKpis(db, kpiCalculator, trajectoryStorage, trackAggregator, venueId, startTs, endTs) {
  // Get all KPIs from AI Narrator 2 (single source of truth)
  const narrator2Data = await getNarrator2Kpis(venueId, 'store-manager', startTs, endTs);
  
  // Start with Narrator2 KPIs as base
  const kpis = narrator2Data?.kpis ? { ...narrator2Data.kpis } : {};
  const supporting = { deadZones: narrator2Data?.supporting?.storeDeadZones || [] };

  // Map Narrator2 KPI names to Business Reporting expected names
  kpis.avgWaitingTimeMin = kpis.avgQueueWaitTime || 0;
  kpis.abandonRate = kpis.queueAbandonmentRate || 0;

  // Get CURRENT queue length from zone_occupancy (latest snapshot for Queue zones)
  const currentQueueStats = safeQuery(db, `
    SELECT SUM(zo.occupancy_count) as total_queue
    FROM zone_occupancy zo
    JOIN regions_of_interest r ON r.id = zo.roi_id
    WHERE r.venue_id = ? AND r.name LIKE '%Queue%'
      AND zo.timestamp = (SELECT MAX(timestamp) FROM zone_occupancy WHERE venue_id = ?)
  `, [venueId, venueId]);
  kpis.currentQueueLength = currentQueueStats?.total_queue || 0;

  return { kpis, supporting };
}

/**
 * Merchandising KPIs: Shelf & Category Performance
 * Uses KpiSourceAdapter (AI Narrator 2) as single source of truth for consistency.
 * Adds category-filtered metrics on top of base KPIs.
 */
async function computeMerchandisingKpis(db, kpiCalculator, shelfKPIEnricher, venueId, startTs, endTs, categoryId, shelfId) {
  const supporting = { topCategories: [], topBrands: [], selectedCategory: categoryId || 'all', deadZones: [] };

  // Get base KPIs from AI Narrator 2 (single source of truth)
  const narrator2Data = await getNarrator2Kpis(venueId, 'merchandising', startTs, endTs);
  
  // Start with Narrator2 KPIs as base
  const kpis = narrator2Data?.kpis ? { ...narrator2Data.kpis } : {};
  
  // Merge supporting data from Narrator2
  if (narrator2Data?.supporting?.deadZones) {
    supporting.deadZones = narrator2Data.supporting.deadZones;
  }

  // If category filter is applied, compute category-specific metrics
  if (categoryId && categoryId !== 'all') {
    const categoryFilter = ` AND (r.name LIKE ? OR r.name = ?)`;
    const params = [venueId, startTs, endTs, `${categoryId} - %`, categoryId];

    // Category-filtered stats from zone_visits
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
        AND r.name NOT LIKE '%Checkout%' AND r.name NOT LIKE '%Queue%' AND r.name NOT LIKE '%Service%'
        ${categoryFilter}
    `, params);

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

/**
 * Retail Media KPIs: PEBLE™ Effectiveness
 */
async function computeRetailMediaKpis(db, venueId, startTs, endTs, campaignId) {
  const kpis = {};
  const supporting = { activeCampaigns: [] };

  // Resolve venue ID to UUID if needed
  let resolvedVenueId = venueId;
  if (!venueId.includes('-')) {
    const venue = safeQuery(db, 'SELECT id FROM venues LIMIT 1');
    resolvedVenueId = venue?.id || '1f6c779c-5f09-445f-ae4b-1ce6abc20e9f';
  }

  // Get campaign KPIs from dooh_campaign_kpis
  let campaignFilter = '';
  let params = [resolvedVenueId, startTs, endTs];
  
  if (campaignId) {
    campaignFilter = ' AND campaign_id = ?';
    params.push(campaignId);
  }

  // First try with requested time range
  let campaignStats = safeQuery(db, `
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
  `, params);

  // If no data in period, expand to last 30 days
  if (!campaignStats?.campaign_count) {
    const expandedStart = endTs - (30 * 24 * 60 * 60 * 1000);
    params = [resolvedVenueId, expandedStart, endTs];
    if (campaignId) params.push(campaignId);
    
    campaignStats = safeQuery(db, `
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
    `, params);
  }

  kpis.eal = Math.round((campaignStats?.avg_eal || 0) * 10) / 10;
  kpis.ces = Math.round((campaignStats?.avg_ces || 0) * 10) / 10;
  kpis.aqs = Math.round((campaignStats?.avg_aqs || 0) * 10) / 10;
  kpis.aar = Math.round((campaignStats?.avg_aar || 0) * 10) / 10;
  kpis.ttaSec = Math.round(campaignStats?.avg_tta || 0);
  kpis.dci = Math.round((campaignStats?.avg_dci || 0) * 100) / 100;
  kpis.confidencePct = Math.round((campaignStats?.avg_confidence || 0) * 10) / 10;

  // Get active campaigns list (also with expanded range)
  const expandedStart = endTs - (30 * 24 * 60 * 60 * 1000);
  const campaigns = safeQueryAll(db, `
    SELECT DISTINCT c.id, c.name
    FROM dooh_campaigns c
    JOIN dooh_campaign_kpis k ON k.campaign_id = c.id
    WHERE k.venue_id = ? AND k.bucket_start_ts >= ? AND k.bucket_start_ts <= ?
  `, [resolvedVenueId, expandedStart, endTs]);

  supporting.activeCampaigns = campaigns;

  return { kpis, supporting };
}

/**
 * Executive KPIs: Executive Summary
 * Uses KpiSourceAdapter (AI Narrator 2) as single source of truth.
 * Adds executive-specific campaign metrics on top.
 */
async function computeExecutiveKpis(db, kpiCalculator, trajectoryStorage, venueId, startTs, endTs, campaignId) {
  const supporting = {};

  // Resolve venue ID to UUID if needed
  let resolvedVenueId = venueId;
  if (!venueId.includes('-')) {
    const venue = safeQuery(db, 'SELECT id FROM venues LIMIT 1');
    resolvedVenueId = venue?.id || '1f6c779c-5f09-445f-ae4b-1ce6abc20e9f';
  }

  // Get base KPIs from AI Narrator 2 (single source of truth)
  const narrator2Data = await getNarrator2Kpis(resolvedVenueId, 'executive', startTs, endTs);
  
  // Start with Narrator2 KPIs as base
  const kpis = narrator2Data?.kpis ? { ...narrator2Data.kpis } : {};

  // Map Narrator2 KPI names to Business Reporting expected names
  kpis.avgWaitingTimeMin = kpis.avgQueueWaitTime || 0;
  kpis.abandonRate = kpis.queueAbandonmentRate || 0;

  // Campaign metrics (specific to executive view)
  let campaignFilter = '';
  let params = [resolvedVenueId, startTs, endTs];
  
  if (campaignId) {
    campaignFilter = ' AND campaign_id = ?';
    params.push(campaignId);
  }

  // First try with requested time range
  let campaignStats = safeQuery(db, `
    SELECT 
      AVG(CASE WHEN controls_count > 0 THEN ces_score END) as avg_ces,
      AVG(lift_rel) * 100 as avg_eal
    FROM dooh_campaign_kpis
    WHERE venue_id = ? AND bucket_start_ts >= ? AND bucket_start_ts <= ?${campaignFilter}
  `, params);

  // If no data, expand to 30 days
  if (!campaignStats?.avg_ces && !campaignStats?.avg_eal) {
    const expandedStart = endTs - (30 * 24 * 60 * 60 * 1000);
    params = [resolvedVenueId, expandedStart, endTs];
    if (campaignId) params.push(campaignId);
    
    campaignStats = safeQuery(db, `
      SELECT 
        AVG(CASE WHEN controls_count > 0 THEN ces_score END) as avg_ces,
        AVG(lift_rel) * 100 as avg_eal
      FROM dooh_campaign_kpis
      WHERE venue_id = ? AND bucket_start_ts >= ? AND bucket_start_ts <= ?${campaignFilter}
    `, params);
  }

  kpis.ces = Math.round((campaignStats?.avg_ces || 0) * 10) / 10;
  kpis.eal = Math.round((campaignStats?.avg_eal || 0) * 10) / 10;

  return { kpis, supporting };
}

return router;
}
