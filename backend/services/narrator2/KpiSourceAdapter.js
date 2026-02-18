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
 * Resolve venue ID to UUID format
 * Handles both numeric IDs (legacy) and UUID strings
 * @param {string|number} venueId
 * @returns {string} UUID format venue ID
 */
export function resolveVenueId(venueId) {
  // Already a UUID
  if (typeof venueId === 'string' && venueId.includes('-')) {
    return venueId;
  }
  
  // Numeric or short ID - lookup in venues table
  const venue = safeQuery('SELECT id FROM venues LIMIT 1');
  if (venue) {
    return venue.id;
  }
  
  // Fallback to hardcoded default (single-venue setup)
  return '1f6c779c-5f09-445f-ae4b-1ce6abc20e9f';
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
      kpis.avgDwellTime = zoneStats.avgDwellTime || 0;
      
      // Get STORE-WIDE occupancy from zone_occupancy (not per-zone from zone_kpi_daily)
      // Peak = MAX of SUM(occupancy_count) at each timestamp
      // Avg = AVG of SUM(occupancy_count) at each timestamp
      const storeOccupancy = safeQuery(`
        SELECT 
          MAX(store_total) as peakOccupancy,
          AVG(store_total) as avgOccupancy
        FROM (
          SELECT timestamp, SUM(occupancy_count) as store_total
          FROM zone_occupancy
          WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
          GROUP BY timestamp
        )
      `, [venueId, startTs, endTs]);
      
      kpis.peakOccupancy = storeOccupancy?.peakOccupancy || 0;
      kpis.avgOccupancy = Math.round((storeOccupancy?.avgOccupancy || 0) * 100) / 100;
      kpis.engagementRate = zoneStats.engagementRate || 0;
      kpis.bounceRate = zoneStats.bounceRate || 0;
      kpis.totalDwells = zoneStats.totalDwells || 0;
      kpis.totalEngagements = zoneStats.totalEngagements || 0;
      // Compute browsing rate (dwells / visits)
      kpis.browsingRate = zoneStats.totalVisitors > 0 
        ? (zoneStats.totalDwells * 100.0 / zoneStats.totalVisitors) 
        : 0;
      
      // Compute occupancy rate using CURRENT store occupancy (last 60 seconds)
      // This gives a real-time view instead of averaging in "closed" periods
      const currentOccupancy = safeQuery(`
        SELECT SUM(occupancy_count) as currentPeople
        FROM zone_occupancy
        WHERE venue_id = ?
          AND timestamp >= ?
        GROUP BY timestamp
        ORDER BY timestamp DESC
        LIMIT 1
      `, [venueId, Date.now() - 60000]);
      
      // Use venue-level max_capacity (preferred) or fall back to zone_settings sum
      const venueCapacity = safeQuery(`
        SELECT max_capacity FROM venues WHERE id = ?
      `, [venueId]);
      
      let totalCapacity = venueCapacity?.max_capacity || 0;
      if (!totalCapacity) {
        // Fallback to zone_settings sum if venue capacity not set
        const zoneCapacity = safeQuery(`
          SELECT SUM(max_occupancy) as totalCapacity
          FROM zone_settings
          WHERE venue_id = ?
        `, [venueId]);
        totalCapacity = zoneCapacity?.totalCapacity || 300;  // Default 300 if nothing set
      }
      const currentPeople = currentOccupancy?.currentPeople || 0;
      
      // Use current occupancy for real-time rate, fall back to peak if no recent data
      const effectiveOccupancy = currentPeople > 0 
        ? currentPeople 
        : (zoneStats.peakOccupancy || zoneStats.avgOccupancy || 0);
      
      const rawRate = (effectiveOccupancy / totalCapacity) * 100;
      kpis.occupancyRate = Math.round(rawRate * 10) / 10;
      kpis.currentOccupancy = currentPeople;  // Also expose raw count
    }

    // Compute Total In Store - count unique active trajectories (recent activity, not exited)
    // Uses zone_visits where there's recent activity (last 5 minutes) to identify active shoppers
    const totalInStoreResult = safeQuery(`
      SELECT COUNT(DISTINCT track_key) as totalInStore
      FROM zone_visits
      WHERE venue_id = ?
        AND start_time >= ?
        AND track_key NOT LIKE '%cashier%'
    `, [venueId, Date.now() - 300000]);  // Last 5 minutes of activity
    
    kpis.totalInStore = totalInStoreResult?.totalInStore || 0;

    // Compute Avg Store Visit Duration (total time per unique visitor)
    const storeVisitStats = safeQuery(`
      SELECT 
        COUNT(DISTINCT track_key) as uniqueVisitors,
        SUM(duration_ms) as totalDurationMs
      FROM zone_visits
      WHERE venue_id = ?
        AND start_time >= ?
        AND start_time <= ?
        AND track_key NOT LIKE '%cashier%'
    `, [venueId, startTs, endTs]);
    
    if (storeVisitStats && storeVisitStats.uniqueVisitors > 0) {
      // Average store visit duration in minutes
      kpis.avgStoreVisit = Math.round(
        (storeVisitStats.totalDurationMs / storeVisitStats.uniqueVisitors) / 60000 * 10
      ) / 10;
      kpis.uniqueVisitors = storeVisitStats.uniqueVisitors;
    } else {
      kpis.avgStoreVisit = 0;
      kpis.uniqueVisitors = 0;
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
      
      // Count ACTUAL total slots from slots_json (not estimated)
      const totalSlotsResult = safeQuery(`
        SELECT COUNT(*) as total
        FROM shelf_planograms sp
        JOIN planograms p ON p.id = sp.planogram_id,
        json_each(json_extract(sp.slots_json, '$.levels')) as level,
        json_each(json_extract(level.value, '$.slots')) as slot
        WHERE p.venue_id = ?
      `, [venueId]);
      
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
      
      const actualTotalSlots = totalSlotsResult?.total || 0;
      const filled = filledSlots?.filled || 0;
      kpis.slotUtilizationRate = actualTotalSlots > 0 ? Math.round((filled * 100.0 / actualTotalSlots) * 10) / 10 : 0;
      kpis.totalFilledSlots = filled;
      kpis.totalSlots = actualTotalSlots;
    }

    // Get brand count and shelf quality KPIs for merchandising
    if (personaId === 'merchandising' || personaId === 'category_manager') {
      const brandStats = safeQuery(`
        SELECT COUNT(DISTINCT si.brand) as totalBrands
        FROM sku_items si
      `);

      if (brandStats) {
        kpis.totalBrands = brandStats.totalBrands || 0;
      }

      // Merchandising-specific KPIs from zone_visits (excludes checkout/queue/service)
      const merchStats = safeQuery(`
        SELECT 
          COUNT(*) as total_visits,
          COUNT(CASE WHEN is_dwell = 1 THEN 1 END) as dwell_count,
          COUNT(CASE WHEN is_engagement = 1 THEN 1 END) as engagement_count,
          SUM(duration_ms) as total_duration_ms,
          COUNT(DISTINCT track_key) as unique_visitors
        FROM zone_visits zv
        JOIN regions_of_interest r ON zv.roi_id = r.id
        WHERE r.venue_id = ? 
          AND zv.start_time >= ? AND zv.start_time < ?
          AND r.name NOT LIKE '%Checkout%' 
          AND r.name NOT LIKE '%Queue%' 
          AND r.name NOT LIKE '%Service%'
      `, [venueId, startTs, endTs]);

      if (merchStats && merchStats.total_visits > 0) {
        // Override browsingRate with merchandising-specific calculation
        kpis.browsingRate = Math.round((merchStats.dwell_count * 100.0 / merchStats.total_visits) * 10) / 10;
        kpis.passbyCount = Math.max(0, merchStats.total_visits - merchStats.dwell_count);
        kpis.categoryEngagementRate = Math.round((merchStats.engagement_count * 100.0 / merchStats.total_visits) * 10) / 10;
        // Avg browse time: total time / unique visitors (in SECONDS - frontend expects 'sec')
        kpis.avgBrowseTime = merchStats.unique_visitors > 0
          ? Math.round((merchStats.total_duration_ms / merchStats.unique_visitors) / 1000 * 10) / 10
          : 0;
      }

      // Position Score: Calculate dynamically from slot positions
      const positionStats = safeQuery(`
        WITH slot_positions AS (
          SELECT 
            sp.num_levels,
            json_extract(level.value, '$.levelIndex') as level_idx,
            json_extract(slot.value, '$.slotIndex') as slot_idx,
            (SELECT COUNT(*) FROM json_each(json_extract(level.value, '$.slots'))) as slots_per_level
          FROM shelf_planograms sp
          JOIN planograms p ON p.id = sp.planogram_id,
          json_each(json_extract(sp.slots_json, '$.levels')) as level,
          json_each(json_extract(level.value, '$.slots')) as slot
          WHERE p.venue_id = ?
            AND json_extract(slot.value, '$.skuItemId') IS NOT NULL
            AND json_extract(slot.value, '$.skuItemId') != 'null'
        )
        SELECT 
          COUNT(*) as filled_count,
          AVG(
            CASE 
              WHEN num_levels <= 2 AND level_idx = 1 THEN 50 * 1.5
              WHEN num_levels <= 2 THEN 50 * 1.0
              WHEN level_idx = 0 THEN 50 * 0.6
              WHEN level_idx = num_levels - 1 THEN 50 * 0.7
              WHEN level_idx = num_levels / 2 OR level_idx = num_levels / 2 + 1 THEN 50 * 1.5
              ELSE 50 * 1.0
            END *
            CASE
              WHEN slots_per_level <= 2 THEN 1.2
              WHEN slot_idx = 0 OR slot_idx = slots_per_level - 1 THEN 1.4
              WHEN slot_idx >= slots_per_level * 0.3 AND slot_idx < slots_per_level * 0.7 THEN 1.2
              ELSE 1.0
            END
          ) as avg_position_score
        FROM slot_positions
      `, [venueId]);

      if (positionStats?.avg_position_score) {
        kpis.avgPositionScore = Math.round(Math.min(100, positionStats.avg_position_score) * 10) / 10;
        kpis.brandEfficiency = Math.round((positionStats.avg_position_score / 50) * 100) / 100;
      }

      // Dead zones: shelf zones with <5% utilization
      const totalTimeRange = endTs - startTs;
      const DEAD_ZONE_THRESHOLD = 5;
      const shelfZoneUtils = safeQueryAll(`
        SELECT 
          r.id, r.name,
          COALESCE(SUM(zv.duration_ms), 0) as total_ms
        FROM regions_of_interest r
        LEFT JOIN zone_visits zv ON zv.roi_id = r.id AND zv.start_time >= ? AND zv.start_time < ?
        WHERE r.venue_id = ?
          AND (r.name LIKE '%Shelf%' OR r.name LIKE '%Category%' OR r.name LIKE '%Aisle%')
          AND r.name NOT LIKE '%Queue%'
          AND r.name NOT LIKE '%Service%'
          AND r.name NOT LIKE '%Checkout%'
        GROUP BY r.id, r.name
      `, [startTs, endTs, venueId]);

      let deadZoneCount = 0;
      const deadZonesList = [];
      for (const z of shelfZoneUtils) {
        const zoneUtilRate = (z.total_ms / totalTimeRange) * 100;
        if (zoneUtilRate < DEAD_ZONE_THRESHOLD) {
          deadZoneCount++;
          deadZonesList.push({ id: z.id, name: z.name, utilization: Math.round(zoneUtilRate * 10) / 10 });
        }
      }
      kpis.deadZones = deadZoneCount;
      supporting.deadZones = deadZonesList.slice(0, 10); // Top 10 for supporting data
    }

    // Get comprehensive Queue Lane KPIs for store_manager (Operations Grade)
    if (personaId === 'store-manager' || personaId === 'store_manager') {
      const queueKpis = await getQueueLaneKpis(venueId, startTs, endTs);
      Object.assign(kpis, queueKpis);

      // Space Utilization: total occupied time / (time range * zone count)
      const totalTimeRange = endTs - startTs;
      const utilStats = safeQuery(`
        SELECT SUM(duration_ms) as total_occupied_ms
        FROM zone_visits
        WHERE venue_id = ? AND start_time >= ? AND start_time < ?
      `, [venueId, startTs, endTs]);

      const zoneCountResult = safeQuery(`
        SELECT COUNT(*) as cnt FROM regions_of_interest WHERE venue_id = ?
      `, [venueId]);
      const zoneCount = zoneCountResult?.cnt || 1;

      const utilizationMs = utilStats?.total_occupied_ms || 0;
      kpis.utilizationRate = Math.min(100, Math.round((utilizationMs / (totalTimeRange * zoneCount)) * 100 * 10) / 10);

      // Dead zones for store-manager: zones with <1% utilization
      const DEAD_ZONE_THRESHOLD = 1;
      const zoneUtils = safeQueryAll(`
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

      let storeDeadZoneCount = 0;
      const storeDeadZonesList = [];
      for (const z of zoneUtils) {
        const zoneUtilRate = (z.total_ms / totalTimeRange) * 100;
        if (zoneUtilRate < DEAD_ZONE_THRESHOLD) {
          storeDeadZoneCount++;
          storeDeadZonesList.push({ id: z.id, name: z.name, utilization: Math.round(zoneUtilRate * 10) / 10 });
        }
      }
      kpis.deadZonesCount = storeDeadZoneCount;
      supporting.storeDeadZones = storeDeadZonesList.slice(0, 10);
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

    // Add occupancyRate using CURRENT store occupancy (real-time)
    if (stats) {
      const currentOccupancy = safeQuery(`
        SELECT SUM(occupancy_count) as currentPeople
        FROM zone_occupancy
        WHERE venue_id = ?
          AND timestamp >= ?
        GROUP BY timestamp
        ORDER BY timestamp DESC
        LIMIT 1
      `, [venueId, Date.now() - 60000]);
      
      // Use venue-level max_capacity (preferred) or fall back to zone_settings sum
      const venueCapacity = safeQuery(`
        SELECT max_capacity FROM venues WHERE id = ?
      `, [venueId]);
      
      let totalCapacity = venueCapacity?.max_capacity || 0;
      if (!totalCapacity) {
        const zoneCapacity = safeQuery(`
          SELECT SUM(max_occupancy) as totalCapacity
          FROM zone_settings
          WHERE venue_id = ?
        `, [venueId]);
        totalCapacity = zoneCapacity?.totalCapacity || 300;
      }
      
      const currentPeople = currentOccupancy?.currentPeople || 0;
      
      // Use current occupancy for real-time rate, fall back to peak if no recent data
      const effectiveOccupancy = currentPeople > 0 
        ? currentPeople 
        : (stats.peakOccupancy || stats.avgOccupancy || 0);
      
      const rawRate = (effectiveOccupancy / totalCapacity) * 100;
      stats.occupancyRate = Math.round(rawRate * 10) / 10;
      stats.currentOccupancy = currentPeople;
    }

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
        bucket_start_ts,
        bucket_minutes,
        exposed_count,
        controls_count,
        p_exposed,
        p_control,
        lift_rel,
        lift_abs,
        median_tta_exposed,
        median_tta_control,
        tta_accel,
        mean_engagement_dwell_exposed,
        mean_engagement_dwell_control,
        engagement_lift_s,
        mean_aqs_exposed,
        mean_dci_exposed,
        mean_dci_control,
        confidence_mean,
        ces_score,
        aar_score
      FROM dooh_campaign_kpis
      WHERE venue_id = ? AND bucket_start_ts >= ? AND bucket_start_ts < ?
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
  getQueueLaneKpis,
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
    // Basic queue stats - EXCLUDE walk-throughs (< 5 sec)
    // Sessions exist only if lane was open when recorded - no need to filter by current is_open state
    let basicStats = safeQuery(`
      SELECT 
        COUNT(*) as totalSessions,
        COUNT(DISTINCT queue_zone_id) as lanesUsedCoverage,
        AVG(CASE WHEN is_abandoned = 0 THEN waiting_time_ms END) / 60000.0 as avgQueueWaitTime,
        AVG(CASE WHEN is_abandoned = 0 THEN waiting_time_ms END) / 60000.0 as avgServiceTime,
        SUM(CASE WHEN is_abandoned = 1 THEN 1 ELSE 0 END) as abandonedSessions,
        SUM(CASE WHEN is_abandoned = 0 THEN 1 ELSE 0 END) as completedSessions,
        MIN(queue_entry_time) as firstEntry,
        MAX(COALESCE(queue_exit_time, queue_entry_time)) as lastExit
      FROM queue_sessions
      WHERE venue_id = ?
        AND queue_entry_time >= ?
        AND queue_entry_time <= ?
        AND waiting_time_ms >= 5000
    `, [venueId, startTs, endTs]);

    // NO FALLBACK: Return actual data for the requested period
    // If no sessions in range, return zeros (not stale data from other periods)
    if (!basicStats || basicStats.totalSessions === 0) {
      console.log(`[KpiSourceAdapter] No queue data in range ${new Date(startTs).toISOString()} - ${new Date(endTs).toISOString()} for venue ${venueId}`);
      // Return empty stats instead of falling back to all-time data
      basicStats = {
        totalSessions: 0,
        lanesUsedCoverage: 0,
        avgQueueWaitTime: null,
        avgServiceTime: null,
        abandonedSessions: 0,
        completedSessions: 0,
        firstEntry: startTs,
        lastExit: endTs
      };
    }
    
    // Log actual data range for debugging
    if (basicStats.totalSessions > 0) {
      console.log(`[KpiSourceAdapter] Found ${basicStats.totalSessions} queue sessions in range for venue ${venueId.substring(0,8)}`);
    }

    // A. Capacity & Staffing KPIs
    // lanesUsedCoverage - distinct queue zones used
    kpis.lanesUsedCoverage = basicStats.lanesUsedCoverage || 0;

    // B. Customer Experience KPIs
    // avgQueueWaitTime - average waiting time in minutes
    kpis.avgQueueWaitTime = basicStats.avgQueueWaitTime || 0;

    // p95QueueWaitTime - 95th percentile wait time (completed sessions only, ≥5s dwell)
    const p95Result = safeQuery(`
      SELECT waiting_time_ms / 60000.0 as p95WaitTime
      FROM queue_sessions
      WHERE venue_id = ?
        AND queue_entry_time >= ?
        AND queue_entry_time <= ?
        AND waiting_time_ms >= 5000
        AND is_abandoned = 0
      ORDER BY waiting_time_ms ASC
      LIMIT 1
      OFFSET (
        SELECT CAST(COUNT(*) * 0.95 AS INTEGER)
        FROM queue_sessions
        WHERE venue_id = ?
          AND queue_entry_time >= ?
          AND queue_entry_time <= ?
          AND waiting_time_ms >= 5000
          AND is_abandoned = 0
      )
    `, [venueId, startTs, endTs, venueId, startTs, endTs]);
    kpis.p95QueueWaitTime = p95Result?.p95WaitTime || kpis.avgQueueWaitTime;

    // C. Flow & Efficiency KPIs
    // avgServiceTime - average waiting time (since we don't track service zones separately)
    kpis.avgServiceTime = basicStats.avgServiceTime || 0;

    // queueThroughput - completed sessions per hour
    const periodHours = Math.max(1, (basicStats.lastExit - basicStats.firstEntry) / 3600000);
    kpis.queueThroughput = Math.round((basicStats.completedSessions || 0) / periodHours * 10) / 10;

    // D. Failure Signal
    // queueAbandonmentRate - percentage of abandoned sessions
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
 * IMPORTANT: Excludes checkout/queue/service zones (only category/shelf zones)
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
    // EXCLUDE checkout/queue/service zones - only show category/shelf zones
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
        AND r.name NOT LIKE '%Checkout%'
        AND r.name NOT LIKE '%Queue%'
        AND r.name NOT LIKE '%Service%'
      GROUP BY r.name
      HAVING SUM(z.visits) > 10
      ORDER BY engagementRate DESC
      LIMIT ?
    `, [venueId, limit]);

    // Enrich zone names with category info from linked shelves
    const enrichedZones = zones?.map(zone => {
      const enrichedName = enrichZoneNameWithCategory(venueId, zone.zoneName);
      return {
        ...zone,
        zoneName: enrichedName || zone.zoneName,
        originalName: zone.zoneName,
      };
    }) || [];

    console.log(`[KpiSourceAdapter] Zone ranking fetched in ${Date.now() - start}ms: ${enrichedZones.length} zones`);
    return enrichedZones;
  } catch (err) {
    console.error(`[KpiSourceAdapter] getZoneEngagementRanking failed:`, err.message);
    return [];
  }
}

/**
 * Enrich zone name with category info from linked shelf → planogram → SKUs
 * Uses ROI metadata.shelfId to find the linked shelf and its planogram categories
 * Pattern: "Shelf N - Engagement (Left/Right)" → "Shelf N (Category) - Left"
 */
function enrichZoneNameWithCategory(venueId, zoneName) {
  if (!zoneName) return zoneName;
  
  // Parse zone name pattern: "ShelfName - Engagement (Left/Right)"
  const match = zoneName.match(/^(.+?)\s*-\s*Engagement\s*\((Left|Right)\)$/i);
  if (!match) return zoneName;
  
  const shelfName = match[1].trim();
  const side = match[2];
  
  try {
    // First, find the ROI and get its shelfId from metadata
    const roi = safeQuery(`
      SELECT metadata_json FROM regions_of_interest 
      WHERE venue_id = ? AND name = ?
    `, [venueId, zoneName]);
    
    let shelfId = null;
    if (roi?.metadata_json) {
      try {
        const metadata = JSON.parse(roi.metadata_json);
        shelfId = metadata.shelfId;
      } catch {}
    }
    
    if (!shelfId) return zoneName;
    
    // Get top category from shelf's planogram using shelfId
    const categoryResult = safeQuery(`
      SELECT s.category, COUNT(*) as cnt
      FROM shelf_planograms sp
      JOIN json_each(sp.slots_json, '$.levels') as levels
      JOIN json_each(levels.value, '$.slots') as slots
      JOIN sku_items s ON s.id = json_extract(slots.value, '$.skuItemId')
      WHERE sp.shelf_id = ?
      GROUP BY s.category
      ORDER BY cnt DESC
      LIMIT 1
    `, [shelfId]);
    
    if (categoryResult?.category) {
      // Shorten long category names
      let shortCategory = categoryResult.category;
      if (shortCategory.length > 15) {
        shortCategory = shortCategory.split(/[&,]/)[0].trim();
      }
      return `${shelfName} (${shortCategory}) - ${side}`;
    }
  } catch (err) {
    console.error('[KpiSourceAdapter] enrichZoneNameWithCategory error:', err.message);
  }
  
  return zoneName;
}
