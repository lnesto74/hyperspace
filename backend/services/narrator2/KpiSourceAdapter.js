/**
 * KPI Source Adapter
 * 
 * Fetches KPI data directly from database to avoid internal loopback deadlocks.
 * Respects feature flags and provides graceful fallbacks.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize database connection
let db = null;
function getDb() {
  if (!db) {
    const dbPath = path.join(__dirname, '../../database/hyperspace.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
  }
  return db;
}

/**
 * Safe query helper
 */
function safeQuery(sql, params = []) {
  try {
    return getDb().prepare(sql).get(...params);
  } catch (err) {
    console.warn(`[KpiSourceAdapter] Query failed: ${err.message}`);
    return null;
  }
}

function safeQueryAll(sql, params = []) {
  try {
    return getDb().prepare(sql).all(...params);
  } catch (err) {
    console.warn(`[KpiSourceAdapter] Query failed: ${err.message}`);
    return [];
  }
}

/**
 * Get current feature flags state
 * @returns {Record<string, boolean>}
 */
export function getFeatureFlags() {
  return {
    FEATURE_BUSINESS_REPORTING: process.env.FEATURE_BUSINESS_REPORTING === 'true',
    FEATURE_DOOH_KPIS: process.env.FEATURE_DOOH_KPIS === 'true',
    FEATURE_DOOH_ATTRIBUTION: process.env.FEATURE_DOOH_ATTRIBUTION === 'true',
    FEATURE_LIDAR_PLANNER: process.env.FEATURE_LIDAR_PLANNER === 'true',
    FEATURE_NARRATOR2_OPENAI: process.env.FEATURE_NARRATOR2_OPENAI === 'true',
  };
}

/**
 * Check if required feature flags are enabled
 * @param {string[]} requiredFlags
 * @returns {boolean}
 */
export function checkFeatureFlags(requiredFlags) {
  const flags = getFeatureFlags();
  return requiredFlags.every(flag => flags[flag] === true);
}

/**
 * Get reporting summary for a persona - direct DB query
 * 
 * @param {string} venueId
 * @param {string} personaId
 * @param {number} startTs
 * @param {number} endTs
 * @returns {Promise<any|null>}
 */
export async function getReportingSummary(venueId, personaId, startTs, endTs) {
  if (!getFeatureFlags().FEATURE_BUSINESS_REPORTING) {
    console.log('[KpiSourceAdapter] FEATURE_BUSINESS_REPORTING not enabled');
    return null;
  }

  const start = Date.now();
  console.log(`[KpiSourceAdapter] Computing summary for ${personaId}, venue ${venueId}`);

  try {
    const kpis = {};
    const supporting = {};

    // Get zone KPIs aggregated for the venue - using correct column names from schema
    const zoneStats = safeQuery(`
      SELECT 
        SUM(visits) as totalVisitors,
        CASE WHEN SUM(total_occupancy_samples) > 0 
             THEN SUM(sum_occupancy) * 1.0 / SUM(total_occupancy_samples) 
             ELSE 0 END as avgOccupancy,
        MAX(peak_occupancy) as peakOccupancy,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(time_spent_ms) / SUM(visits) / 60000.0 
             ELSE 0 END as avgDwellTime,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(engagements_cumulative) * 100.0 / SUM(visits) 
             ELSE 0 END as engagementRate,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(bounces) * 100.0 / SUM(visits) 
             ELSE 0 END as bounceRate,
        SUM(dwells_cumulative) as totalDwells,
        SUM(engagements_cumulative) as totalEngagements
      FROM zone_kpi_daily
      WHERE venue_id = ? 
        AND date >= date(?, 'unixepoch')
        AND date <= date(?, 'unixepoch')
    `, [venueId, startTs / 1000, endTs / 1000]);

    if (zoneStats) {
      kpis.totalVisitors = zoneStats.totalVisitors || 0;
      kpis.avgOccupancy = zoneStats.avgOccupancy || 0;
      kpis.peakOccupancy = zoneStats.peakOccupancy || 0;
      kpis.avgDwellTime = zoneStats.avgDwellTime || 0;
      kpis.engagementRate = zoneStats.engagementRate || 0;
      kpis.bounceRate = zoneStats.bounceRate || 0;
      kpis.totalDwells = zoneStats.totalDwells || 0;
      kpis.totalEngagements = zoneStats.totalEngagements || 0;
      // Compute browsing rate (dwells / visits)
      kpis.browsingRate = zoneStats.totalVisitors > 0 
        ? (zoneStats.totalDwells * 100.0 / zoneStats.totalVisitors) 
        : 0;
    }
    
    // Get shelf/planogram KPIs - planograms.venue_id is direct FK
    const shelfStats = safeQuery(`
      SELECT 
        COUNT(DISTINCT sp.id) as totalShelves,
        SUM(sp.num_levels) as totalLevels
      FROM shelf_planograms sp
      JOIN planograms p ON p.id = sp.planogram_id
      WHERE p.venue_id = ?
    `, [venueId]);
    
    if (shelfStats && shelfStats.totalShelves > 0) {
      kpis.totalShelves = shelfStats.totalShelves;
      // Estimate slots: ~11 slots per level (from sample data), levels per shelf
      const avgSlotsPerLevel = 11;
      const estTotalSlots = (shelfStats.totalLevels || 0) * avgSlotsPerLevel;
      
      // Count filled slots by parsing slots_json
      const filledSlots = safeQuery(`
        SELECT COUNT(*) as filled
        FROM shelf_planograms sp
        JOIN planograms p ON p.id = sp.planogram_id,
        json_each(json_extract(sp.slots_json, '$.levels')) as level,
        json_each(json_extract(level.value, '$.slots')) as slot
        WHERE p.venue_id = ?
          AND json_extract(slot.value, '$.skuItemId') IS NOT NULL
          AND json_extract(slot.value, '$.skuItemId') != 'null'
      `, [venueId]);
      
      const filled = filledSlots?.filled || 0;
      kpis.slotUtilizationRate = estTotalSlots > 0 ? (filled * 100.0 / estTotalSlots) : 0;
      kpis.totalFilledSlots = filled;
      kpis.totalSlots = estTotalSlots;
    }

    // Get brand count for merchandising
    if (personaId === 'merchandising' || personaId === 'category_manager') {
      const brandStats = safeQuery(`
        SELECT COUNT(DISTINCT si.brand) as totalBrands
        FROM sku_items si
      `);

      if (brandStats) {
        kpis.totalBrands = brandStats.totalBrands || 0;
      }
    }

    // Get comprehensive Queue Lane KPIs for store_manager (Operations Grade)
    if (personaId === 'store-manager' || personaId === 'store_manager') {
      const queueKpis = await getQueueLaneKpis(venueId, startTs, endTs);
      Object.assign(kpis, queueKpis);
    }

    console.log(`[KpiSourceAdapter] Summary computed in ${Date.now() - start}ms`);
    return { kpis, supporting, personaId, venueId };
  } catch (err) {
    console.error(`[KpiSourceAdapter] getReportingSummary failed:`, err.message);
    return null;
  }
}

/**
 * Get venue-level KPIs - direct DB query
 * 
 * @param {string} venueId
 * @param {number} startTs
 * @param {number} endTs
 * @returns {Promise<any|null>}
 */
export async function getVenueKpis(venueId, startTs, endTs) {
  const start = Date.now();
  
  try {
    const stats = safeQuery(`
      SELECT 
        SUM(visits) as totalVisitors,
        CASE WHEN SUM(total_occupancy_samples) > 0 
             THEN SUM(sum_occupancy) * 1.0 / SUM(total_occupancy_samples) 
             ELSE 0 END as avgOccupancy,
        MAX(peak_occupancy) as peakOccupancy,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(time_spent_ms) / SUM(visits) / 60000.0 
             ELSE 0 END as avgDwellTime,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(engagements_cumulative) * 100.0 / SUM(visits) 
             ELSE 0 END as engagementRate,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(bounces) * 100.0 / SUM(visits) 
             ELSE 0 END as bounceRate,
        SUM(dwells_cumulative) as totalDwells,
        SUM(engagements_cumulative) as totalEngagements,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(dwells_cumulative) * 100.0 / SUM(visits) 
             ELSE 0 END as browsingRate
      FROM zone_kpi_daily
      WHERE venue_id = ? 
        AND date >= date(?, 'unixepoch')
        AND date <= date(?, 'unixepoch')
    `, [venueId, startTs / 1000, endTs / 1000]);

    console.log(`[KpiSourceAdapter] Venue KPIs fetched in ${Date.now() - start}ms`);
    return stats || {};
  } catch (err) {
    console.error(`[KpiSourceAdapter] getVenueKpis failed:`, err.message);
    return null;
  }
}

/**
 * Get KPIs for a specific ROI/zone - direct DB query
 * 
 * @param {string} roiId
 * @param {number} startTs
 * @param {number} endTs
 * @returns {Promise<any|null>}
 */
export async function getRoiKpis(roiId, startTs, endTs) {
  const start = Date.now();
  
  try {
    const stats = safeQuery(`
      SELECT 
        SUM(visits) as totalVisitors,
        CASE WHEN SUM(total_occupancy_samples) > 0 
             THEN SUM(sum_occupancy) * 1.0 / SUM(total_occupancy_samples) 
             ELSE 0 END as avgOccupancy,
        MAX(peak_occupancy) as peakOccupancy,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(time_spent_ms) / SUM(visits) / 60000.0 
             ELSE 0 END as avgDwellTime,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(engagements_cumulative) * 100.0 / SUM(visits) 
             ELSE 0 END as engagementRate,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(bounces) * 100.0 / SUM(visits) 
             ELSE 0 END as bounceRate
      FROM zone_kpi_daily
      WHERE roi_id = ? 
        AND date >= date(?, 'unixepoch')
        AND date <= date(?, 'unixepoch')
    `, [roiId, startTs / 1000, endTs / 1000]);

    console.log(`[KpiSourceAdapter] ROI KPIs fetched in ${Date.now() - start}ms`);
    return stats || {};
  } catch (err) {
    console.error(`[KpiSourceAdapter] getRoiKpis failed:`, err.message);
    return null;
  }
}

/**
 * Compare KPIs across multiple zones - direct DB query
 * 
 * @param {string[]} roiIds
 * @param {number} startTs
 * @param {number} endTs
 * @returns {Promise<any|null>}
 */
export async function compareKpis(roiIds, startTs, endTs) {
  const start = Date.now();
  
  try {
    if (!roiIds || roiIds.length === 0) return [];
    
    const placeholders = roiIds.map(() => '?').join(',');
    const results = safeQueryAll(`
      SELECT 
        roi_id,
        SUM(visits) as totalVisitors,
        AVG(avg_occupancy) as avgOccupancy,
        AVG(engagement_rate) as engagementRate
      FROM zone_kpi_daily
      WHERE roi_id IN (${placeholders})
        AND date >= date(?, 'unixepoch', 'start of day')
        AND date <= date(?, 'unixepoch')
      GROUP BY roi_id
    `, [...roiIds, startTs / 1000, endTs / 1000]);

    console.log(`[KpiSourceAdapter] Compare KPIs fetched in ${Date.now() - start}ms`);
    return results;
  } catch (err) {
    console.error(`[KpiSourceAdapter] compareKpis failed:`, err.message);
    return null;
  }
}

/**
 * Get DOOH KPI buckets - direct DB query
 * 
 * @param {string} venueId
 * @param {number} startTs
 * @param {number} endTs
 * @param {string} [screenId] - Optional screen filter
 * @returns {Promise<any|null>}
 */
export async function getDoohKpis(venueId, startTs, endTs, screenId) {
  if (!getFeatureFlags().FEATURE_DOOH_KPIS) {
    console.log('[KpiSourceAdapter] FEATURE_DOOH_KPIS not enabled');
    return null;
  }

  const start = Date.now();
  
  try {
    let sql = `
      SELECT 
        screen_id,
        bucket_start,
        impressions,
        qualified_impressions,
        premium_impressions,
        unique_visitors,
        total_attention_s,
        avg_aqs
      FROM dooh_screen_kpi_buckets
      WHERE venue_id = ? AND bucket_start >= ? AND bucket_start < ?
    `;
    const params = [venueId, startTs, endTs];
    
    if (screenId) {
      sql += ' AND screen_id = ?';
      params.push(screenId);
    }

    const buckets = safeQueryAll(sql, params);
    console.log(`[KpiSourceAdapter] DOOH KPIs fetched in ${Date.now() - start}ms`);
    return { buckets };
  } catch (err) {
    console.error(`[KpiSourceAdapter] getDoohKpis failed:`, err.message);
    return null;
  }
}

/**
 * Get DOOH Attribution KPIs - direct DB query
 * 
 * @param {string} venueId
 * @param {number} startTs
 * @param {number} endTs
 * @param {string} [campaignId] - Optional campaign filter
 * @returns {Promise<any|null>}
 */
export async function getDoohAttributionKpis(venueId, startTs, endTs, campaignId) {
  if (!getFeatureFlags().FEATURE_DOOH_ATTRIBUTION) {
    console.log('[KpiSourceAdapter] FEATURE_DOOH_ATTRIBUTION not enabled');
    return null;
  }

  const start = Date.now();
  
  try {
    let sql = `
      SELECT 
        campaign_id,
        bucket_start,
        exposed_conversions,
        control_conversions,
        exposed_sample_n,
        control_sample_n,
        lift_rel,
        lift_abs,
        confidence_score,
        eal,
        aqs,
        aar,
        tta_accel
      FROM dooh_campaign_kpis
      WHERE venue_id = ? AND bucket_start >= ? AND bucket_start < ?
    `;
    const params = [venueId, startTs, endTs];
    
    if (campaignId) {
      sql += ' AND campaign_id = ?';
      params.push(campaignId);
    }

    const buckets = safeQueryAll(sql, params);
    console.log(`[KpiSourceAdapter] Attribution KPIs fetched in ${Date.now() - start}ms`);
    return { buckets };
  } catch (err) {
    console.error(`[KpiSourceAdapter] getDoohAttributionKpis failed:`, err.message);
    return null;
  }
}

/**
 * Get list of ROIs for a venue - direct DB query
 * 
 * @param {string} venueId
 * @returns {Promise<any|null>}
 */
export async function getVenueRois(venueId) {
  try {
    return safeQueryAll(`
      SELECT id, name, type, color, metadata
      FROM regions_of_interest
      WHERE venue_id = ?
    `, [venueId]);
  } catch (err) {
    console.error(`[KpiSourceAdapter] getVenueRois failed:`, err.message);
    return null;
  }
}

/**
 * Get list of DOOH screens for a venue - direct DB query
 * 
 * @param {string} venueId
 * @returns {Promise<any|null>}
 */
export async function getDoohScreens(venueId) {
  if (!getFeatureFlags().FEATURE_DOOH_KPIS) {
    return null;
  }
  
  try {
    return safeQueryAll(`
      SELECT id, name, width, height, position_x, position_y, position_z
      FROM dooh_screens
      WHERE venue_id = ?
    `, [venueId]);
  } catch (err) {
    console.error(`[KpiSourceAdapter] getDoohScreens failed:`, err.message);
    return null;
  }
}

/**
 * Get list of DOOH campaigns for a venue - direct DB query
 * 
 * @param {string} venueId
 * @returns {Promise<any|null>}
 */
export async function getDoohCampaigns(venueId) {
  if (!getFeatureFlags().FEATURE_DOOH_ATTRIBUTION) {
    return null;
  }
  
  try {
    return safeQueryAll(`
      SELECT id, name, start_date, end_date, status, target_zones
      FROM dooh_campaigns
      WHERE venue_id = ?
    `, [venueId]);
  } catch (err) {
    console.error(`[KpiSourceAdapter] getDoohCampaigns failed:`, err.message);
    return null;
  }
}

export default {
  getFeatureFlags,
  checkFeatureFlags,
  getReportingSummary,
  getVenueKpis,
  getRoiKpis,
  compareKpis,
  getDoohKpis,
  getDoohAttributionKpis,
  getVenueRois,
  getDoohScreens,
  getDoohCampaigns,
  getZoneEngagementRanking,
  getHourlyTrafficBreakdown,
  getPeriodComparison,
};

/**
 * Get comprehensive Queue Lane KPIs for Operations Manager
 * Implements 8 operations-grade KPIs derived from queue_sessions
 * ONLY includes sessions from lanes marked as OPEN (is_open = 1 in zone_settings)
 * 
 * @param {string} venueId
 * @param {number} startTs - Start timestamp in ms
 * @param {number} endTs - End timestamp in ms
 * @returns {Promise<Object>} Queue lane KPIs
 */
export async function getQueueLaneKpis(venueId, startTs, endTs) {
  const start = Date.now();
  const kpis = {};
  
  try {
    // Basic queue stats - ONLY from OPEN lanes, EXCLUDE walk-throughs (< 5 sec)
    // Walk-throughs are people who pass through queue zone without stopping
    let basicStats = safeQuery(`
      SELECT 
        COUNT(*) as totalSessions,
        COUNT(DISTINCT qs.queue_zone_id) as lanesUsedCoverage,
        AVG(CASE WHEN qs.is_abandoned = 0 THEN qs.waiting_time_ms END) / 60000.0 as avgQueueWaitTime,
        AVG(CASE WHEN qs.is_abandoned = 0 THEN qs.waiting_time_ms END) / 60000.0 as avgServiceTime,
        SUM(CASE WHEN qs.is_abandoned = 1 THEN 1 ELSE 0 END) as abandonedSessions,
        SUM(CASE WHEN qs.is_abandoned = 0 THEN 1 ELSE 0 END) as completedSessions,
        MIN(qs.queue_entry_time) as firstEntry,
        MAX(COALESCE(qs.queue_exit_time, qs.queue_entry_time)) as lastExit
      FROM queue_sessions qs
      INNER JOIN zone_settings zs ON qs.queue_zone_id = zs.roi_id AND qs.venue_id = zs.venue_id
      WHERE qs.venue_id = ?
        AND qs.queue_entry_time >= ?
        AND qs.queue_entry_time <= ?
        AND zs.is_open = 1
        AND qs.waiting_time_ms >= 5000
    `, [venueId, startTs, endTs]);

    // Fallback: if no sessions in requested range, use ALL available queue data for venue (still filtered by open lanes)
    let usingAllData = false;
    if (!basicStats || basicStats.totalSessions === 0) {
      console.log(`[KpiSourceAdapter] No queue data in range for venue ${venueId}, trying all data from OPEN lanes`);
      basicStats = safeQuery(`
        SELECT 
          COUNT(*) as totalSessions,
          COUNT(DISTINCT qs.queue_zone_id) as lanesUsedCoverage,
          AVG(CASE WHEN qs.is_abandoned = 0 THEN qs.waiting_time_ms END) / 60000.0 as avgQueueWaitTime,
          AVG(CASE WHEN qs.is_abandoned = 0 THEN qs.waiting_time_ms END) / 60000.0 as avgServiceTime,
          SUM(CASE WHEN qs.is_abandoned = 1 THEN 1 ELSE 0 END) as abandonedSessions,
          SUM(CASE WHEN qs.is_abandoned = 0 THEN 1 ELSE 0 END) as completedSessions,
          MIN(qs.queue_entry_time) as firstEntry,
          MAX(COALESCE(qs.queue_exit_time, qs.queue_entry_time)) as lastExit
        FROM queue_sessions qs
        INNER JOIN zone_settings zs ON qs.queue_zone_id = zs.roi_id AND qs.venue_id = zs.venue_id
        WHERE qs.venue_id = ?
          AND zs.is_open = 1
          AND qs.waiting_time_ms >= 5000
      `, [venueId]);
      usingAllData = true;
      
      // Update time range for concurrency calculation
      if (basicStats && basicStats.totalSessions > 0) {
        startTs = basicStats.firstEntry;
        endTs = basicStats.lastExit;
      }
    }

    if (!basicStats || basicStats.totalSessions === 0) {
      console.log(`[KpiSourceAdapter] No queue data from OPEN lanes for venue ${venueId}`);
      return kpis; // Return empty - KPIs will show N/A
    }
    
    if (usingAllData) {
      console.log(`[KpiSourceAdapter] Using all queue data from OPEN lanes: ${basicStats.totalSessions} sessions`);
    }

    // A. Capacity & Staffing KPIs
    // lanesUsedCoverage - distinct OPEN queue zones used
    kpis.lanesUsedCoverage = basicStats.lanesUsedCoverage || 0;

    // B. Customer Experience KPIs
    // avgQueueWaitTime - average waiting time in minutes (OPEN lanes only)
    kpis.avgQueueWaitTime = basicStats.avgQueueWaitTime || 0;

    // p95QueueWaitTime - 95th percentile wait time (OPEN lanes, completed sessions only)
    const p95Result = safeQuery(`
      SELECT qs.waiting_time_ms / 60000.0 as p95WaitTime
      FROM queue_sessions qs
      INNER JOIN zone_settings zs ON qs.queue_zone_id = zs.roi_id AND qs.venue_id = zs.venue_id
      WHERE qs.venue_id = ?
        AND qs.queue_entry_time >= ?
        AND qs.queue_entry_time <= ?
        AND qs.waiting_time_ms IS NOT NULL
        AND qs.is_abandoned = 0
        AND zs.is_open = 1
      ORDER BY qs.waiting_time_ms ASC
      LIMIT 1
      OFFSET (
        SELECT CAST(COUNT(*) * 0.95 AS INTEGER)
        FROM queue_sessions qs2
        INNER JOIN zone_settings zs2 ON qs2.queue_zone_id = zs2.roi_id AND qs2.venue_id = zs2.venue_id
        WHERE qs2.venue_id = ?
          AND qs2.queue_entry_time >= ?
          AND qs2.queue_entry_time <= ?
          AND qs2.waiting_time_ms IS NOT NULL
          AND qs2.is_abandoned = 0
          AND zs2.is_open = 1
      )
    `, [venueId, startTs, endTs, venueId, startTs, endTs]);
    kpis.p95QueueWaitTime = p95Result?.p95WaitTime || kpis.avgQueueWaitTime;

    // C. Flow & Efficiency KPIs
    // avgServiceTime - average waiting time (since we don't track service zones separately)
    kpis.avgServiceTime = basicStats.avgServiceTime || 0;

    // queueThroughput - completed sessions per hour (OPEN lanes only)
    const periodHours = Math.max(1, (basicStats.lastExit - basicStats.firstEntry) / 3600000);
    kpis.queueThroughput = Math.round((basicStats.completedSessions || 0) / periodHours * 10) / 10;

    // D. Failure Signal
    // queueAbandonmentRate - percentage of abandoned sessions (OPEN lanes only)
    if (basicStats.totalSessions > 0) {
      kpis.queueAbandonmentRate = Math.round((basicStats.abandonedSessions * 100.0 / basicStats.totalSessions) * 10) / 10;
    } else {
      kpis.queueAbandonmentRate = 0;
    }

    // A. Concurrent Lane KPIs (from zone_settings.is_open)
    const concurrencyKpis = computeConcurrentLaneKpis(venueId, startTs, endTs);
    kpis.avgConcurrentOpenLanes = concurrencyKpis.avg;
    kpis.peakConcurrentOpenLanes = concurrencyKpis.peak;

    console.log(`[KpiSourceAdapter] Queue lane KPIs computed in ${Date.now() - start}ms (OPEN lanes only)`);
    return kpis;
  } catch (err) {
    console.error(`[KpiSourceAdapter] getQueueLaneKpis failed:`, err.message);
    return kpis;
  }
}

/**
 * Compute concurrent lane metrics using actual is_open state from zone_settings
 * Returns current open lane count (only QUEUE zones, not all ROIs)
 * 
 * @param {string} venueId
 * @param {number} startTs
 * @param {number} endTs
 * @returns {{avg: number, peak: number}}
 */
function computeConcurrentLaneKpis(venueId, startTs, endTs) {
  try {
    // Get QUEUE ZONES that are currently marked as OPEN in zone_settings
    // Filter by linked_service_zone_id IS NOT NULL (queue zones have linked service zones)
    // OR by name containing 'Queue'
    const openLanes = safeQuery(`
      SELECT COUNT(*) as openCount
      FROM zone_settings zs
      JOIN regions_of_interest r ON zs.roi_id = r.id
      WHERE zs.venue_id = ?
        AND zs.is_open = 1
        AND (zs.linked_service_zone_id IS NOT NULL OR r.name LIKE '%Queue%')
    `, [venueId]);

    const currentOpen = openLanes?.openCount || 0;

    // For historical avg/peak, we don't have time-series data of is_open changes
    // So we return current state as both avg and peak (best available)
    
    return { avg: currentOpen, peak: currentOpen };
  } catch (err) {
    console.error(`[KpiSourceAdapter] computeConcurrentLaneKpis failed:`, err.message);
    return { avg: 0, peak: 0 };
  }
}

/**
 * Get hourly traffic breakdown for a venue
 * @param {string} venueId
 * @returns {Promise<Array>}
 */
export async function getHourlyTrafficBreakdown(venueId) {
  const start = Date.now();
  
  try {
    const hourly = safeQueryAll(`
      SELECT 
        printf('%02d', hour) as hour,
        SUM(visits) as visitors,
        CASE WHEN SUM(visits) > 0 
             THEN SUM(time_spent_ms) / SUM(visits) / 60000.0 
             ELSE 0 END as avgDwellTime
      FROM zone_kpi_hourly
      WHERE venue_id = ?
      GROUP BY hour
      ORDER BY visitors DESC
    `, [venueId]);

    console.log(`[KpiSourceAdapter] Hourly breakdown fetched in ${Date.now() - start}ms: ${hourly?.length || 0} hours`);
    return hourly || [];
  } catch (err) {
    console.error(`[KpiSourceAdapter] getHourlyTrafficBreakdown failed:`, err.message);
    return [];
  }
}

/**
 * Get period comparison (today vs yesterday, this week vs last week)
 * @param {string} venueId
 * @param {string} compareType - 'day' or 'week'
 * @returns {Promise<Object>}
 */
export async function getPeriodComparison(venueId, compareType = 'day') {
  const start = Date.now();
  
  try {
    let currentPeriod, previousPeriod;
    
    if (compareType === 'day') {
      // Today vs Yesterday
      currentPeriod = safeQuery(`
        SELECT 
          SUM(visits) as visitors,
          CASE WHEN SUM(visits) > 0 THEN SUM(time_spent_ms) / SUM(visits) / 60000.0 ELSE 0 END as avgDwellTime,
          CASE WHEN SUM(visits) > 0 THEN SUM(engagements_cumulative) * 100.0 / SUM(visits) ELSE 0 END as engagementRate
        FROM zone_kpi_daily
        WHERE venue_id = ? AND date = date('now')
      `, [venueId]);
      
      previousPeriod = safeQuery(`
        SELECT 
          SUM(visits) as visitors,
          CASE WHEN SUM(visits) > 0 THEN SUM(time_spent_ms) / SUM(visits) / 60000.0 ELSE 0 END as avgDwellTime,
          CASE WHEN SUM(visits) > 0 THEN SUM(engagements_cumulative) * 100.0 / SUM(visits) ELSE 0 END as engagementRate
        FROM zone_kpi_daily
        WHERE venue_id = ? AND date = date('now', '-1 day')
      `, [venueId]);
    } else {
      // This week vs Last week
      currentPeriod = safeQuery(`
        SELECT 
          SUM(visits) as visitors,
          CASE WHEN SUM(visits) > 0 THEN SUM(time_spent_ms) / SUM(visits) / 60000.0 ELSE 0 END as avgDwellTime,
          CASE WHEN SUM(visits) > 0 THEN SUM(engagements_cumulative) * 100.0 / SUM(visits) ELSE 0 END as engagementRate
        FROM zone_kpi_daily
        WHERE venue_id = ? AND date >= date('now', '-7 days')
      `, [venueId]);
      
      previousPeriod = safeQuery(`
        SELECT 
          SUM(visits) as visitors,
          CASE WHEN SUM(visits) > 0 THEN SUM(time_spent_ms) / SUM(visits) / 60000.0 ELSE 0 END as avgDwellTime,
          CASE WHEN SUM(visits) > 0 THEN SUM(engagements_cumulative) * 100.0 / SUM(visits) ELSE 0 END as engagementRate
        FROM zone_kpi_daily
        WHERE venue_id = ? AND date >= date('now', '-14 days') AND date < date('now', '-7 days')
      `, [venueId]);
    }

    const current = currentPeriod || { visitors: 0, avgDwellTime: 0, engagementRate: 0 };
    const previous = previousPeriod || { visitors: 0, avgDwellTime: 0, engagementRate: 0 };
    
    // Calculate deltas
    const visitorsDelta = previous.visitors > 0 
      ? ((current.visitors - previous.visitors) / previous.visitors * 100) 
      : 0;
    const dwellDelta = previous.avgDwellTime > 0 
      ? ((current.avgDwellTime - previous.avgDwellTime) / previous.avgDwellTime * 100) 
      : 0;
    const engagementDelta = previous.engagementRate > 0 
      ? ((current.engagementRate - previous.engagementRate) / previous.engagementRate * 100) 
      : 0;

    console.log(`[KpiSourceAdapter] Period comparison fetched in ${Date.now() - start}ms`);
    return {
      current,
      previous,
      deltas: {
        visitors: visitorsDelta,
        avgDwellTime: dwellDelta,
        engagementRate: engagementDelta,
      },
      compareType,
    };
  } catch (err) {
    console.error(`[KpiSourceAdapter] getPeriodComparison failed:`, err.message);
    return null;
  }
}

/**
 * Get zone engagement ranking for a venue
 * Returns top zones by engagement rate
 * 
 * @param {string} venueId
 * @param {number} startTs
 * @param {number} endTs
 * @param {number} limit - Max zones to return
 * @returns {Promise<Array>}
 */
export async function getZoneEngagementRanking(venueId, startTs, endTs, limit = 5) {
  const start = Date.now();
  console.log(`[KpiSourceAdapter] getZoneEngagementRanking called for venue ${venueId}`);
  
  try {
    // Use recent data - aggregate by zone name to avoid duplicates
    const zones = safeQueryAll(`
      SELECT 
        r.name as zoneName,
        SUM(z.visits) as totalVisitors,
        CASE WHEN SUM(z.visits) > 0 
             THEN SUM(z.engagements_cumulative) * 100.0 / SUM(z.visits) 
             ELSE 0 END as engagementRate,
        CASE WHEN SUM(z.visits) > 0 
             THEN SUM(z.time_spent_ms) / SUM(z.visits) / 60000.0 
             ELSE 0 END as avgDwellTime
      FROM zone_kpi_daily z
      LEFT JOIN regions_of_interest r ON r.id = z.roi_id
      WHERE z.venue_id = ?
      GROUP BY r.name
      HAVING SUM(z.visits) > 10
      ORDER BY engagementRate DESC
      LIMIT ?
    `, [venueId, limit]);

    console.log(`[KpiSourceAdapter] Zone ranking fetched in ${Date.now() - start}ms: ${zones?.length || 0} zones`);
    return zones || [];
  } catch (err) {
    console.error(`[KpiSourceAdapter] getZoneEngagementRanking failed:`, err.message);
    return [];
  }
}
