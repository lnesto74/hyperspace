/**
 * ShelfAnalyticsAdapter
 * 
 * PEBLE™ Attribution Engine - Shelf Analytics Adapter
 * 
 * Provides READ-ONLY access to existing shelf engagement data
 * for DOOH attribution analysis. Does NOT modify ShelfKPIEnricher
 * or KPICalculator - only queries their outputs.
 */

import { shelfPlanogramQueries, skuItemQueries } from '../../database/schema.js';

export class ShelfAnalyticsAdapter {
  constructor(db) {
    this.db = db;
    // === Performance caches (reset per run via clearCaches()) ===
    this._planogramIdCache = new Map();    // venueId -> planogramId
    this._skuCache = new Map();            // skuItemId -> sku object
    this._shelfTargetCache = new Map();    // cacheKey -> shelfIds[]
    this._targetShelfPositions = null;     // cached shelf venue_objects for position-based fallback
    this._zoneVisitsIndex = null;          // Map<trackKey, visits[]> — batch loaded per chunk
    this._shelfMatchCache = new Map();     // shelfId -> { categories, brands, skus }
  }

  /**
   * Clear all caches between runs
   */
  clearCaches() {
    this._planogramIdCache.clear();
    this._skuCache.clear();
    this._shelfTargetCache.clear();
    this._targetShelfPositions = null;
    this._zoneVisitsIndex = null;
    this._shelfMatchCache.clear();
  }

  /**
   * Pre-load all zone_visits for a chunk time window.
   * Call once per chunk before processing exposures.
   * Eliminates hundreds of individual per-track DB queries.
   */
  preloadChunk(venueId, startTs, endTs) {
    const visits = this.db.prepare(`
      SELECT 
        zv.id, zv.track_key, zv.roi_id, zv.start_time, zv.end_time,
        zv.duration_ms, zv.is_dwell, zv.is_engagement,
        r.name as roi_name, r.metadata_json
      FROM zone_visits zv
      JOIN regions_of_interest r ON zv.roi_id = r.id
      WHERE zv.venue_id = ? AND zv.end_time >= ? AND zv.start_time <= ?
      ORDER BY zv.track_key, zv.start_time ASC
    `).all(venueId, startTs, endTs);

    this._zoneVisitsIndex = new Map();
    for (const v of visits) {
      if (!this._zoneVisitsIndex.has(v.track_key)) {
        this._zoneVisitsIndex.set(v.track_key, []);
      }
      this._zoneVisitsIndex.get(v.track_key).push(v);
    }
    console.log(`📊 [PEBLE] Preloaded ${visits.length} zone_visits for ${this._zoneVisitsIndex.size} tracks`);
  }

  /**
   * Pre-compute and cache target shelf IDs + positions for a campaign target.
   * Call once at the start of a run.
   */
  initTargetCache(venueId, targetJson) {
    const { type, ids } = targetJson;
    const cacheKey = `${venueId}:${type}:${ids.join(',')}`;
    if (!this._shelfTargetCache.has(cacheKey)) {
      this._shelfTargetCache.set(cacheKey, this._findShelvesForTargetUncached(venueId, type, ids));
    }
    const targetShelfIds = this._shelfTargetCache.get(cacheKey);

    // Cache shelf positions for position-based fallback
    if (targetShelfIds.length > 0 && !this._targetShelfPositions) {
      const placeholders = targetShelfIds.map(() => '?').join(',');
      this._targetShelfPositions = this.db.prepare(`
        SELECT id, position_x, position_z, scale_x, scale_z
        FROM venue_objects
        WHERE venue_id = ? AND id IN (${placeholders})
      `).all(venueId, ...targetShelfIds);
    } else if (!this._targetShelfPositions) {
      this._targetShelfPositions = [];
    }
  }

  /**
   * Get cached SKU by ID (avoids repeated DB lookups)
   */
  _getSkuCached(skuItemId) {
    if (this._skuCache.has(skuItemId)) return this._skuCache.get(skuItemId);
    const sku = skuItemQueries.getById(this.db, skuItemId);
    this._skuCache.set(skuItemId, sku);
    return sku;
  }

  /**
   * Find the best planogram for a venue - prefers the one with actual shelf data (cached)
   */
  findBestPlanogram(venueId) {
    if (this._planogramIdCache.has(venueId)) return this._planogramIdCache.get(venueId);

    // Find planogram that actually has shelf_planograms data
    const withData = this.db.prepare(`
      SELECT p.id FROM planograms p
      JOIN shelf_planograms sp ON sp.planogram_id = p.id
      WHERE p.venue_id = ?
      GROUP BY p.id
      ORDER BY p.version DESC
      LIMIT 1
    `).get(venueId);
    if (withData) {
      this._planogramIdCache.set(venueId, withData.id);
      return withData.id;
    }

    // Fallback: latest planogram by version
    const latest = this.db.prepare(`
      SELECT id FROM planograms WHERE venue_id = ? ORDER BY version DESC LIMIT 1
    `).get(venueId);
    const result = latest?.id || null;
    this._planogramIdCache.set(venueId, result);
    return result;
  }

  /**
   * Query engagement events for a specific track within a time window
   * Returns first qualifying engagement that matches campaign target
   * 
   * @param {string} venueId 
   * @param {string} trackKey 
   * @param {number} startTs - Window start (ms timestamp)
   * @param {number} endTs - Window end (ms timestamp)
   * @param {Object} targetJson - {type:"shelf|category|brand|sku|slot", ids:[...]}
   * @returns {Object|null} First matching engagement or null
   */
  queryEngagementsForTrack(venueId, trackKey, startTs, endTs, targetJson) {
    const { type, ids } = targetJson;
    
    // Use pre-loaded zone visits if available (batch mode)
    let visits;
    if (this._zoneVisitsIndex) {
      const allVisits = this._zoneVisitsIndex.get(trackKey) || [];
      visits = allVisits.filter(v =>
        v.start_time >= startTs && v.start_time <= endTs &&
        (v.is_dwell === 1 || v.is_engagement === 1)
      );
    } else {
      // Fallback: individual query
      visits = this.db.prepare(`
        SELECT 
          zv.id, zv.roi_id, zv.start_time, zv.end_time,
          zv.duration_ms, zv.is_dwell, zv.is_engagement,
          r.name as roi_name, r.metadata_json
        FROM zone_visits zv
        JOIN regions_of_interest r ON zv.roi_id = r.id
        WHERE zv.venue_id = ? 
          AND zv.track_key = ?
          AND zv.start_time >= ?
          AND zv.start_time <= ?
          AND (zv.is_dwell = 1 OR zv.is_engagement = 1)
        ORDER BY zv.start_time ASC
      `).all(venueId, trackKey, startTs, endTs);
    }

    for (const visit of visits) {
      const metadata = visit.metadata_json ? JSON.parse(visit.metadata_json) : {};
      
      // Check if this visit is a shelf engagement
      if (metadata.template === 'shelf-engagement' && metadata.shelfId) {
        const shelfMatch = this.checkTargetMatch(type, ids, metadata, venueId);
        if (shelfMatch) {
          return {
            visitId: visit.id,
            roiId: visit.roi_id,
            roiName: visit.roi_name,
            startTs: visit.start_time,
            endTs: visit.end_time,
            durationMs: visit.duration_ms,
            dwellS: visit.duration_ms / 1000,
            effectiveDwellS: visit.is_engagement ? visit.duration_ms / 1000 : (visit.duration_ms / 1000) * 0.7,
            isDwell: visit.is_dwell === 1,
            isEngagement: visit.is_engagement === 1,
            engagementStrength: visit.is_engagement ? 'strong' : (visit.is_dwell ? 'moderate' : 'weak'),
            shelfId: metadata.shelfId,
            ...shelfMatch
          };
        }
      }
      
      // Also check non-shelf ROIs for category/brand visits
      if (type === 'shelf' && ids.includes(metadata.shelfId)) {
        return this.buildEngagementResult(visit, metadata);
      }
    }

    // Fallback: Check track positions that intersect with shelf ROIs
    return this.queryPositionBasedEngagement(venueId, trackKey, startTs, endTs, targetJson);
  }

  /**
   * Check if engagement matches campaign target
   */
  checkTargetMatch(type, ids, metadata, venueId) {
    const shelfId = metadata.shelfId;
    const planogramId = metadata.planogramId;

    switch (type) {
      case 'shelf':
        if (ids.includes(shelfId)) {
          return { matchType: 'shelf', matchedId: shelfId };
        }
        break;

      case 'category': {
        const shelfData = this._getShelfDataCached(venueId, shelfId, planogramId);
        for (const cat of shelfData.categories) {
          if (ids.includes(cat)) {
            return { matchType: 'category', matchedId: cat, categoryId: cat, shelfId };
          }
        }
        break;
      }

      case 'brand': {
        const shelfData = this._getShelfDataCached(venueId, shelfId, planogramId);
        for (const brand of shelfData.brands) {
          if (ids.includes(brand)) {
            return { matchType: 'brand', matchedId: brand, brandId: brand, shelfId };
          }
        }
        break;
      }

      case 'sku': {
        const shelfData = this._getShelfDataCached(venueId, shelfId, planogramId);
        for (const skuId of shelfData.skuIds) {
          if (ids.includes(skuId)) {
            return { matchType: 'sku', matchedId: skuId, skuId, shelfId };
          }
        }
        break;
      }

      case 'slot':
        // Slot matching requires position-based detection
        if (metadata.slotId && ids.includes(metadata.slotId)) {
          return { 
            matchType: 'slot', 
            matchedId: metadata.slotId,
            slotId: metadata.slotId,
            shelfId 
          };
        }
        break;
    }

    return null;
  }

  /**
   * Get cached shelf data (categories, brands, skuIds) for a shelf.
   * Consolidates getShelfCategories/Brands/Skus into one cached lookup.
   */
  _getShelfDataCached(venueId, shelfId, planogramId) {
    if (this._shelfMatchCache.has(shelfId)) return this._shelfMatchCache.get(shelfId);

    if (!planogramId) planogramId = this.findBestPlanogram(venueId);
    const result = { categories: [], brands: [], skuIds: [] };
    if (!planogramId) { this._shelfMatchCache.set(shelfId, result); return result; }

    const shelfPlanogram = shelfPlanogramQueries.getByShelfId(this.db, planogramId, shelfId);
    if (!shelfPlanogram) { this._shelfMatchCache.set(shelfId, result); return result; }

    const cats = new Set();
    const brands = new Set();
    const skuIds = [];
    const slots = shelfPlanogram.slots;

    slots.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (slot.skuItemId) {
          const sku = this._getSkuCached(slot.skuItemId);
          if (sku) {
            if (sku.category) cats.add(sku.category);
            if (sku.brand) brands.add(sku.brand);
            skuIds.push(sku.id);
          }
        }
      });
    });

    result.categories = Array.from(cats);
    result.brands = Array.from(brands);
    result.skuIds = skuIds;
    this._shelfMatchCache.set(shelfId, result);
    return result;
  }

  /**
   * Get categories present on a shelf
   */
  getShelfCategories(venueId, shelfId, planogramId) {
    const data = this._getShelfDataCached(venueId, shelfId, planogramId);
    return data.categories.map(cat => ({ category: cat, categoryId: cat }));
  }

  /**
   * Get brands present on a shelf
   */
  getShelfBrands(venueId, shelfId, planogramId) {
    const data = this._getShelfDataCached(venueId, shelfId, planogramId);
    return data.brands.map(brand => ({ brand, brandId: brand }));
  }

  /**
   * Get SKUs present on a shelf
   */
  getShelfSkus(venueId, shelfId, planogramId) {
    const data = this._getShelfDataCached(venueId, shelfId, planogramId);
    return data.skuIds.map(id => {
      const sku = this._getSkuCached(id);
      return sku ? { id: sku.id, skuId: sku.id, skuCode: sku.skuCode, name: sku.name, brand: sku.brand, category: sku.category } : null;
    }).filter(Boolean);
  }

  /**
   * Fallback: Query position-based engagement using track_positions
   */
  queryPositionBasedEngagement(venueId, trackKey, startTs, endTs, targetJson) {
    const { type, ids } = targetJson;

    // Use cached shelf positions if available
    let shelves;
    if (this._targetShelfPositions) {
      shelves = this._targetShelfPositions;
    } else {
      let targetShelfIds = [];
      if (type === 'shelf') {
        targetShelfIds = ids;
      } else {
        targetShelfIds = this.findShelvesForTarget(venueId, type, ids);
      }
      if (targetShelfIds.length === 0) return null;
      shelves = this.db.prepare(`
        SELECT id, position_x, position_z, scale_x, scale_z
        FROM venue_objects
        WHERE venue_id = ? AND id IN (${targetShelfIds.map(() => '?').join(',')})
      `).all(venueId, ...targetShelfIds);
    }

    if (!shelves || shelves.length === 0) return null;

    // Get track positions in time window
    const positions = this.db.prepare(`
      SELECT timestamp, position_x, position_z, velocity_x, velocity_z
      FROM track_positions
      WHERE venue_id = ? AND track_key = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(venueId, trackKey, startTs, endTs);

    const ENGAGEMENT_DISTANCE = 1.5; // meters
    const MIN_DWELL_MS = 2000; // 2 seconds minimum

    for (const shelf of shelves) {
      let dwellStart = null;
      let totalDwell = 0;

      for (const pos of positions) {
        const dist = this.distanceToShelf(pos.position_x, pos.position_z, shelf);
        
        if (dist <= ENGAGEMENT_DISTANCE) {
          if (!dwellStart) {
            dwellStart = pos.timestamp;
          }
          totalDwell = pos.timestamp - dwellStart;
        } else {
          if (dwellStart && totalDwell >= MIN_DWELL_MS) {
            return {
              visitId: `pos-${dwellStart}`,
              roiId: null,
              roiName: `Shelf ${shelf.id.slice(0, 8)}`,
              startTs: dwellStart,
              endTs: dwellStart + totalDwell,
              durationMs: totalDwell,
              dwellS: totalDwell / 1000,
              effectiveDwellS: totalDwell / 1000,
              isDwell: true,
              isEngagement: totalDwell >= 5000,
              engagementStrength: totalDwell >= 10000 ? 'strong' : (totalDwell >= 5000 ? 'moderate' : 'weak'),
              shelfId: shelf.id,
              matchType: type,
              matchedId: ids[0]
            };
          }
          dwellStart = null;
          totalDwell = 0;
        }
      }

      // Check final segment
      if (dwellStart && totalDwell >= MIN_DWELL_MS) {
        return {
          visitId: `pos-${dwellStart}`,
          roiId: null,
          roiName: `Shelf ${shelf.id.slice(0, 8)}`,
          startTs: dwellStart,
          endTs: dwellStart + totalDwell,
          durationMs: totalDwell,
          dwellS: totalDwell / 1000,
          effectiveDwellS: totalDwell / 1000,
          isDwell: true,
          isEngagement: totalDwell >= 5000,
          engagementStrength: totalDwell >= 10000 ? 'strong' : (totalDwell >= 5000 ? 'moderate' : 'weak'),
          shelfId: shelf.id,
          matchType: type,
          matchedId: ids[0]
        };
      }
    }

    return null;
  }

  /**
   * Find shelves containing target category/brand/sku
   */
  findShelvesForTarget(venueId, type, ids) {
    const cacheKey = `${venueId}:${type}:${ids.join(',')}`;
    if (this._shelfTargetCache.has(cacheKey)) return this._shelfTargetCache.get(cacheKey);
    const result = this._findShelvesForTargetUncached(venueId, type, ids);
    this._shelfTargetCache.set(cacheKey, result);
    return result;
  }

  _findShelvesForTargetUncached(venueId, type, ids) {
    const shelfIds = new Set();

    const planogramId = this.findBestPlanogram(venueId);
    if (!planogramId) return [];

    const shelfPlanograms = shelfPlanogramQueries.getByPlanogramId(this.db, planogramId);
    let totalSlots = 0;
    let totalSkus = 0;

    for (const sp of shelfPlanograms) {
      const slots = sp.slots;
      slots.levels?.forEach(level => {
        level.slots?.forEach(slot => {
          totalSlots++;
          if (slot.skuItemId) {
            const sku = this._getSkuCached(slot.skuItemId);
            if (sku) {
              totalSkus++;
              if (type === 'category' && ids.includes(sku.category)) {
                shelfIds.add(sp.shelfId);
              } else if (type === 'brand' && ids.includes(sku.brand)) {
                shelfIds.add(sp.shelfId);
              } else if (type === 'sku' && ids.includes(sku.id)) {
                shelfIds.add(sp.shelfId);
              }
            }
          }
        });
      });
    }

    console.log(`🔍 [PEBLE] findShelvesForTarget: ${shelfPlanograms.length} shelves, ${totalSlots} slots, ${totalSkus} SKUs → matched ${shelfIds.size}`);
    return Array.from(shelfIds);
  }

  /**
   * Calculate distance from point to shelf rectangle
   */
  distanceToShelf(px, pz, shelf) {
    const halfW = (shelf.scale_x || 1) / 2;
    const halfD = (shelf.scale_z || 1) / 2;
    
    const minX = shelf.position_x - halfW;
    const maxX = shelf.position_x + halfW;
    const minZ = shelf.position_z - halfD;
    const maxZ = shelf.position_z + halfD;

    const nearestX = Math.max(minX, Math.min(maxX, px));
    const nearestZ = Math.max(minZ, Math.min(maxZ, pz));

    const dx = px - nearestX;
    const dz = pz - nearestZ;

    return Math.sqrt(dx * dx + dz * dz);
  }

  /**
   * Build engagement result from visit data
   */
  buildEngagementResult(visit, metadata) {
    return {
      visitId: visit.id,
      roiId: visit.roi_id,
      roiName: visit.roi_name,
      startTs: visit.start_time,
      endTs: visit.end_time,
      durationMs: visit.duration_ms,
      dwellS: visit.duration_ms / 1000,
      effectiveDwellS: visit.is_engagement ? visit.duration_ms / 1000 : (visit.duration_ms / 1000) * 0.7,
      isDwell: visit.is_dwell === 1,
      isEngagement: visit.is_engagement === 1,
      engagementStrength: visit.is_engagement ? 'strong' : (visit.is_dwell ? 'moderate' : 'weak'),
      shelfId: metadata.shelfId,
      matchType: 'shelf',
      matchedId: metadata.shelfId
    };
  }

  /**
   * Query pre/post exposure context for a track
   * Uses ROIs to determine journey phase
   * 
   * @param {string} venueId 
   * @param {string} trackKey 
   * @param {number} exposureEndTs 
   * @param {number} windowS - pre/post window in seconds
   * @returns {Object} Context info
   */
  queryPrePostContextForTrack(venueId, trackKey, exposureEndTs, windowS = 30) {
    const preWindowStart = exposureEndTs - (windowS * 1000);
    const postWindowEnd = exposureEndTs + (windowS * 1000);

    let preVisit = null;
    let postVisit = null;

    if (this._zoneVisitsIndex) {
      // Use batch-loaded data
      const allVisits = this._zoneVisitsIndex.get(trackKey) || [];
      // Pre: latest visit ending before exposure
      for (let i = allVisits.length - 1; i >= 0; i--) {
        const v = allVisits[i];
        if (v.end_time >= preWindowStart && v.end_time <= exposureEndTs) {
          preVisit = v;
          break;
        }
      }
      // Post: earliest visit starting after exposure
      for (const v of allVisits) {
        if (v.start_time >= exposureEndTs && v.start_time <= postWindowEnd) {
          postVisit = v;
          break;
        }
      }
    } else {
      // Fallback: individual queries
      preVisit = this.db.prepare(`
        SELECT r.name, r.metadata_json
        FROM zone_visits zv
        JOIN regions_of_interest r ON zv.roi_id = r.id
        WHERE zv.venue_id = ? AND zv.track_key = ?
          AND zv.end_time >= ? AND zv.end_time <= ?
        ORDER BY zv.end_time DESC
        LIMIT 1
      `).get(venueId, trackKey, preWindowStart, exposureEndTs);

      postVisit = this.db.prepare(`
        SELECT r.name, r.metadata_json
        FROM zone_visits zv
        JOIN regions_of_interest r ON zv.roi_id = r.id
        WHERE zv.venue_id = ? AND zv.track_key = ?
          AND zv.start_time >= ? AND zv.start_time <= ?
        ORDER BY zv.start_time ASC
        LIMIT 1
      `).get(venueId, trackKey, exposureEndTs, postWindowEnd);
    }

    // Determine journey phase
    let phase = 'browsing';
    const preZoneName = preVisit?.roi_name || preVisit?.name || '';
    const postZoneName = postVisit?.roi_name || postVisit?.name || '';
    const preZone = preZoneName.toLowerCase();
    const postZone = postZoneName.toLowerCase();

    if (preZone.includes('entrance')) phase = 'arrival';
    else if (preZone.includes('queue') || preZone.includes('checkout')) phase = 'checkout';
    else if (postZone.includes('exit')) phase = 'departure';
    else if (postZone.includes('queue') || postZone.includes('checkout')) phase = 'pre-checkout';

    return {
      preZone: preZoneName || null,
      postZone: postZoneName || null,
      phase
    };
  }

  /**
   * Get all target options for campaign builder
   * Returns available shelves, categories, brands, SKUs
   */
  getTargetOptions(venueId) {
    // Get shelves
    const shelves = this.db.prepare(`
      SELECT id, name FROM venue_objects 
      WHERE venue_id = ? AND type = 'shelf'
    `).all(venueId);

    // Get categories and brands from SKU catalog
    const planogram = this.db.prepare(`
      SELECT p.id, sc.id as catalog_id
      FROM planograms p
      LEFT JOIN sku_catalogs sc ON 1=1
      WHERE p.venue_id = ?
      ORDER BY p.version DESC
      LIMIT 1
    `).get(venueId);

    let categories = [];
    let brands = [];
    let skus = [];

    if (planogram?.catalog_id) {
      categories = this.db.prepare(`
        SELECT DISTINCT category FROM sku_items 
        WHERE catalog_id = ? AND category IS NOT NULL
        ORDER BY category
      `).all(planogram.catalog_id).map(r => r.category);

      brands = this.db.prepare(`
        SELECT DISTINCT brand FROM sku_items 
        WHERE catalog_id = ? AND brand IS NOT NULL
        ORDER BY brand
      `).all(planogram.catalog_id).map(r => r.brand);

      skus = this.db.prepare(`
        SELECT id, sku_code, name, brand, category FROM sku_items 
        WHERE catalog_id = ?
        ORDER BY name
        LIMIT 500
      `).all(planogram.catalog_id);
    }

    return {
      shelves: shelves.map(s => ({ id: s.id, name: s.name })),
      categories,
      brands,
      skus: skus.map(s => ({ 
        id: s.id, 
        skuCode: s.sku_code, 
        name: s.name,
        brand: s.brand,
        category: s.category
      }))
    };
  }
}

export default ShelfAnalyticsAdapter;
