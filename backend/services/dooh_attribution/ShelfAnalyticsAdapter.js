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
    
    // Query zone visits (engagements) from TrajectoryStorageService tables
    const visits = this.db.prepare(`
      SELECT 
        zv.id,
        zv.roi_id,
        zv.start_time,
        zv.end_time,
        zv.duration_ms,
        zv.is_dwell,
        zv.is_engagement,
        r.name as roi_name,
        r.metadata_json
      FROM zone_visits zv
      JOIN regions_of_interest r ON zv.roi_id = r.id
      WHERE zv.venue_id = ? 
        AND zv.track_key = ?
        AND zv.start_time >= ?
        AND zv.start_time <= ?
        AND (zv.is_dwell = 1 OR zv.is_engagement = 1)
      ORDER BY zv.start_time ASC
    `).all(venueId, trackKey, startTs, endTs);

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

      case 'category':
        const categoryMatch = this.getShelfCategories(venueId, shelfId, planogramId);
        for (const cat of categoryMatch) {
          if (ids.includes(cat.categoryId || cat.category)) {
            return { 
              matchType: 'category', 
              matchedId: cat.categoryId || cat.category,
              categoryId: cat.categoryId || cat.category,
              shelfId 
            };
          }
        }
        break;

      case 'brand':
        const brandMatch = this.getShelfBrands(venueId, shelfId, planogramId);
        for (const brand of brandMatch) {
          if (ids.includes(brand.brandId || brand.brand)) {
            return { 
              matchType: 'brand', 
              matchedId: brand.brandId || brand.brand,
              brandId: brand.brandId || brand.brand,
              shelfId 
            };
          }
        }
        break;

      case 'sku':
        const skuMatch = this.getShelfSkus(venueId, shelfId, planogramId);
        for (const sku of skuMatch) {
          if (ids.includes(sku.skuId || sku.id)) {
            return { 
              matchType: 'sku', 
              matchedId: sku.skuId || sku.id,
              skuId: sku.skuId || sku.id,
              shelfId 
            };
          }
        }
        break;

      case 'slot':
        // Slot matching requires position-based detection
        // Check if the slot position matches
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
   * Get categories present on a shelf
   */
  getShelfCategories(venueId, shelfId, planogramId) {
    if (!planogramId) {
      // Try to find active planogram for venue
      const planogram = this.db.prepare(`
        SELECT id FROM planograms WHERE venue_id = ? AND status = 'active' LIMIT 1
      `).get(venueId);
      planogramId = planogram?.id;
    }

    if (!planogramId) return [];

    const shelfPlanogram = shelfPlanogramQueries.getByShelfId(this.db, planogramId, shelfId);
    if (!shelfPlanogram) return [];

    const categories = new Set();
    const slots = shelfPlanogram.slots;

    slots.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (slot.skuItemId) {
          const sku = skuItemQueries.getById(this.db, slot.skuItemId);
          if (sku?.category) {
            categories.add(sku.category);
          }
        }
      });
    });

    return Array.from(categories).map(cat => ({ category: cat, categoryId: cat }));
  }

  /**
   * Get brands present on a shelf
   */
  getShelfBrands(venueId, shelfId, planogramId) {
    if (!planogramId) {
      const planogram = this.db.prepare(`
        SELECT id FROM planograms WHERE venue_id = ? AND status = 'active' LIMIT 1
      `).get(venueId);
      planogramId = planogram?.id;
    }

    if (!planogramId) return [];

    const shelfPlanogram = shelfPlanogramQueries.getByShelfId(this.db, planogramId, shelfId);
    if (!shelfPlanogram) return [];

    const brands = new Set();
    const slots = shelfPlanogram.slots;

    slots.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (slot.skuItemId) {
          const sku = skuItemQueries.getById(this.db, slot.skuItemId);
          if (sku?.brand) {
            brands.add(sku.brand);
          }
        }
      });
    });

    return Array.from(brands).map(brand => ({ brand, brandId: brand }));
  }

  /**
   * Get SKUs present on a shelf
   */
  getShelfSkus(venueId, shelfId, planogramId) {
    if (!planogramId) {
      const planogram = this.db.prepare(`
        SELECT id FROM planograms WHERE venue_id = ? AND status = 'active' LIMIT 1
      `).get(venueId);
      planogramId = planogram?.id;
    }

    if (!planogramId) return [];

    const shelfPlanogram = shelfPlanogramQueries.getByShelfId(this.db, planogramId, shelfId);
    if (!shelfPlanogram) return [];

    const skus = [];
    const slots = shelfPlanogram.slots;

    slots.levels?.forEach(level => {
      level.slots?.forEach(slot => {
        if (slot.skuItemId) {
          const sku = skuItemQueries.getById(this.db, slot.skuItemId);
          if (sku) {
            skus.push({
              id: sku.id,
              skuId: sku.id,
              skuCode: sku.skuCode,
              name: sku.name,
              brand: sku.brand,
              category: sku.category
            });
          }
        }
      });
    });

    return skus;
  }

  /**
   * Fallback: Query position-based engagement using track_positions
   */
  queryPositionBasedEngagement(venueId, trackKey, startTs, endTs, targetJson) {
    const { type, ids } = targetJson;

    // Get shelf positions for target shelves
    let targetShelfIds = [];
    
    if (type === 'shelf') {
      targetShelfIds = ids;
    } else {
      // Find shelves containing target category/brand/sku
      targetShelfIds = this.findShelvesForTarget(venueId, type, ids);
    }

    if (targetShelfIds.length === 0) return null;

    // Get shelf objects with positions
    const shelves = this.db.prepare(`
      SELECT id, position_x, position_z, scale_x, scale_z
      FROM venue_objects
      WHERE venue_id = ? AND id IN (${targetShelfIds.map(() => '?').join(',')})
    `).all(venueId, ...targetShelfIds);

    if (shelves.length === 0) return null;

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
    const shelfIds = new Set();

    // Get active planogram
    const planogram = this.db.prepare(`
      SELECT id FROM planograms WHERE venue_id = ? ORDER BY version DESC LIMIT 1
    `).get(venueId);

    if (!planogram) return [];

    const shelfPlanograms = shelfPlanogramQueries.getByPlanogramId(this.db, planogram.id);

    for (const sp of shelfPlanograms) {
      const slots = sp.slots;
      
      slots.levels?.forEach(level => {
        level.slots?.forEach(slot => {
          if (slot.skuItemId) {
            const sku = skuItemQueries.getById(this.db, slot.skuItemId);
            if (sku) {
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

    // Get ROI visits before and after exposure
    const preVisits = this.db.prepare(`
      SELECT r.name, r.metadata_json
      FROM zone_visits zv
      JOIN regions_of_interest r ON zv.roi_id = r.id
      WHERE zv.venue_id = ? AND zv.track_key = ?
        AND zv.end_time >= ? AND zv.end_time <= ?
      ORDER BY zv.end_time DESC
      LIMIT 1
    `).get(venueId, trackKey, preWindowStart, exposureEndTs);

    const postVisits = this.db.prepare(`
      SELECT r.name, r.metadata_json
      FROM zone_visits zv
      JOIN regions_of_interest r ON zv.roi_id = r.id
      WHERE zv.venue_id = ? AND zv.track_key = ?
        AND zv.start_time >= ? AND zv.start_time <= ?
      ORDER BY zv.start_time ASC
      LIMIT 1
    `).get(venueId, trackKey, exposureEndTs, postWindowEnd);

    // Determine journey phase
    let phase = 'browsing';
    const preZone = preVisits?.name?.toLowerCase() || '';
    const postZone = postVisits?.name?.toLowerCase() || '';

    if (preZone.includes('entrance')) phase = 'arrival';
    else if (preZone.includes('queue') || preZone.includes('checkout')) phase = 'checkout';
    else if (postZone.includes('exit')) phase = 'departure';
    else if (postZone.includes('queue') || postZone.includes('checkout')) phase = 'pre-checkout';

    return {
      preZone: preVisits?.name || null,
      postZone: postVisits?.name || null,
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
