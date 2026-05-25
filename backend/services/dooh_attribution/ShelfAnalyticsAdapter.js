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
import { resolveShelfCategories } from '../ShelfCategoryResolver.js';
import { getDefaultMatchingProfile } from './MatchingProfiles.js';
import { tracksLinkedByReidFromDb } from './TrackIdentityMatcher.js';

const SHELF_ENGAGEMENT_TYPES = ['shelf', 'fridge', 'service_counter'];
const SHELF_NAME_PATTERNS = [
  'shelf', 'display', 'gondola', 'rack', 'scaffale', 'regal', 'fridge', 'frigo',
  'banco', 'bancone', 'refriger', 'gastronomia', 'freezer', 'schematico',
];

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export class ShelfAnalyticsAdapter {
  constructor(db, options = {}) {
    this.db = db;
    this.matchingProfile = options.matchingProfile || getDefaultMatchingProfile();
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
    this._targetEngagementRoiIds = new Set();
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

    // Engagement ROI ids linked to shelf targets (from campaign target_json or DB lookup)
    this._targetEngagementRoiIds = new Set();
    if (type === 'shelf' && ids?.length) {
      if (Array.isArray(targetJson.engagementRoiIds) && targetJson.engagementRoiIds.length) {
        targetJson.engagementRoiIds.forEach(id => this._targetEngagementRoiIds.add(id));
      } else {
        const rows = this.db.prepare(`
          SELECT id, metadata_json FROM regions_of_interest WHERE venue_id = ?
        `).all(venueId);
        for (const row of rows) {
          const meta = parseJson(row.metadata_json) || {};
          if (meta.template === 'shelf-engagement' && meta.shelfId && ids.includes(meta.shelfId)) {
            this._targetEngagementRoiIds.add(row.id);
          }
        }
      }
    }

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
  /** Track keys may differ between exposure rows and zone_visits (reconciler vs raw id). */
  _trackKeySuffix(trackKey) {
    if (!trackKey) return '';
    const idx = trackKey.indexOf(':');
    return idx >= 0 ? trackKey.slice(idx + 1) : trackKey;
  }

  _visitEndTs(visit) {
    if (visit.end_time != null) return visit.end_time;
    return visit.start_time + (visit.duration_ms || 0);
  }

  _visitInWindow(visit, windowStart, windowEnd) {
    const vEnd = this._visitEndTs(visit);
    if (this.matchingProfile.windowMode === 'start_in') {
      return visit.start_time >= windowStart && visit.start_time <= windowEnd;
    }
    return visit.start_time <= windowEnd && vEnd >= windowStart;
  }

  _isQualifyingVisit(visit) {
    const minMs = this.matchingProfile.minVisitDurationMs;
    return (
      Number(visit.is_dwell) === 1
      || Number(visit.is_engagement) === 1
      || (visit.duration_ms || 0) >= minMs
    );
  }

  _trackKeysToTry(trackKey) {
    const keys = new Set([trackKey]);
    if (this.matchingProfile.trackKeyMode === 'suffix_alias' || this.matchingProfile.trackKeyMode === 'reid_chain') {
      const suffix = this._trackKeySuffix(trackKey);
      if (suffix) {
        keys.add(suffix);
        if (this._zoneVisitsIndex) {
          for (const key of this._zoneVisitsIndex.keys()) {
            if (key.endsWith(`:${suffix}`)) keys.add(key);
          }
        }
      }
    }
    return keys;
  }

  _getVisitsForTrack(venueId, trackKey, windowStart, windowEnd) {
    const matchesWindow = (v) => this._visitInWindow(v, windowStart, windowEnd);
    const keysToTry = this._trackKeysToTry(trackKey);

    if (this._zoneVisitsIndex) {
      const seen = new Set();
      const merged = [];
      for (const key of keysToTry) {
        for (const v of this._zoneVisitsIndex.get(key) || []) {
          if (seen.has(v.id)) continue;
          if (!matchesWindow(v)) continue;
          seen.add(v.id);
          merged.push(v);
        }
      }
      merged.sort((a, b) => a.start_time - b.start_time);
      return merged;
    }

    if (this.matchingProfile.trackKeyMode === 'suffix_alias' || this.matchingProfile.trackKeyMode === 'reid_chain') {
      const suffix = this._trackKeySuffix(trackKey);
      return this.db.prepare(`
        SELECT 
          zv.id, zv.roi_id, zv.track_key, zv.start_time, zv.end_time,
          zv.duration_ms, zv.is_dwell, zv.is_engagement,
          r.name as roi_name, r.metadata_json
        FROM zone_visits zv
        JOIN regions_of_interest r ON zv.roi_id = r.id
        WHERE zv.venue_id = ?
          AND (zv.track_key = ? OR zv.track_key LIKE ? OR zv.track_key = ?)
          AND zv.start_time <= ?
          AND COALESCE(zv.end_time, zv.start_time + COALESCE(zv.duration_ms, 0)) >= ?
        ORDER BY zv.start_time ASC
      `).all(venueId, trackKey, `%:${suffix}`, suffix, windowEnd, windowStart);
    }

    return this.db.prepare(`
      SELECT 
        zv.id, zv.roi_id, zv.track_key, zv.start_time, zv.end_time,
        zv.duration_ms, zv.is_dwell, zv.is_engagement,
        r.name as roi_name, r.metadata_json
      FROM zone_visits zv
      JOIN regions_of_interest r ON zv.roi_id = r.id
      WHERE zv.venue_id = ? AND zv.track_key = ?
        AND zv.start_time <= ?
        AND COALESCE(zv.end_time, zv.start_time + COALESCE(zv.duration_ms, 0)) >= ?
      ORDER BY zv.start_time ASC
    `).all(venueId, trackKey, windowEnd, windowStart);
  }

  _resolveTrackKeyMatch(exposureTrackKey, matchedVisitTrackKey) {
    if (!matchedVisitTrackKey) return 'none';
    if (matchedVisitTrackKey === exposureTrackKey) return 'exact';
    const suffix = this._trackKeySuffix(exposureTrackKey);
    if (suffix && (matchedVisitTrackKey === suffix || matchedVisitTrackKey.endsWith(`:${suffix}`))) {
      return 'alias';
    }
    return 'other';
  }

  _annotateMatch(result, meta) {
    if (!result || !meta) return result;
    return { ...result, _matchSource: meta.source, _trackKeyMatch: meta.trackKeyMatch };
  }

  queryEngagementsForTrack(venueId, trackKey, startTs, endTs, targetJson, options = {}) {
    const { type, ids } = targetJson;
    const { matchMeta = false } = options;
    const profile = this.matchingProfile;

    if (profile.useZoneVisits) {
      const visits = this._getVisitsForTrack(venueId, trackKey, startTs, endTs)
        .filter(v => this._isQualifyingVisit(v));

      for (const visit of visits) {
        const metadata = parseJson(visit.metadata_json) || {};

        if (type === 'shelf' && this._targetEngagementRoiIds?.has(visit.roi_id)) {
          return this._annotateMatch(this.buildEngagementResult(visit, {
            ...metadata,
            shelfId: metadata.shelfId || ids[0],
            template: metadata.template || 'shelf-engagement',
          }), matchMeta ? {
            source: 'roi_visit',
            trackKeyMatch: this._resolveTrackKeyMatch(trackKey, visit.track_key),
          } : null);
        }

        if (metadata.template === 'shelf-engagement' && metadata.shelfId) {
          const shelfMatch = this.checkTargetMatch(type, ids, metadata, venueId);
          if (shelfMatch) {
            return this._annotateMatch({
              visitId: visit.id,
              roiId: visit.roi_id,
              roiName: visit.roi_name,
              startTs: visit.start_time,
              endTs: visit.end_time,
              durationMs: visit.duration_ms,
              dwellS: visit.duration_ms / 1000,
              effectiveDwellS: (Number(visit.is_engagement) === 1 || visit.duration_ms >= 8000) ? visit.duration_ms / 1000 : (visit.duration_ms / 1000) * 0.7,
              isDwell: Number(visit.is_dwell) === 1 || visit.duration_ms >= 3000,
              isEngagement: Number(visit.is_engagement) === 1 || visit.duration_ms >= 8000,
              engagementStrength: (Number(visit.is_engagement) === 1 || visit.duration_ms >= 10000) ? 'strong' : ((Number(visit.is_dwell) === 1 || visit.duration_ms >= 5000) ? 'moderate' : 'weak'),
              shelfId: metadata.shelfId,
              ...shelfMatch
            }, matchMeta ? {
              source: 'roi_visit',
              trackKeyMatch: this._resolveTrackKeyMatch(trackKey, visit.track_key),
            } : null);
          }
        }

        if (type === 'shelf' && metadata.shelfId && ids.includes(metadata.shelfId)) {
          return this._annotateMatch(this.buildEngagementResult(visit, metadata), matchMeta ? {
            source: 'roi_visit',
            trackKeyMatch: this._resolveTrackKeyMatch(trackKey, visit.track_key),
          } : null);
        }
      }
    }

    if (!profile.usePositionFallback) {
      if (profile.trackKeyMode === 'reid_chain') {
        return this.queryEngagementsViaReidChain(
          venueId, trackKey, startTs, endTs, targetJson, { matchMeta },
        );
      }
      return null;
    }

    const reidMatch = profile.trackKeyMode === 'reid_chain'
      ? this.queryEngagementsViaReidChain(venueId, trackKey, startTs, endTs, targetJson, { matchMeta })
      : null;
    if (reidMatch) return reidMatch;

    return this.queryPositionBasedEngagement(venueId, trackKey, startTs, endTs, targetJson, { matchMeta });
  }

  /** Target shelf visits in window from ANY track — linked via re-ID chain to exposure track. */
  queryEngagementsViaReidChain(venueId, trackKey, startTs, endTs, targetJson, options = {}) {
    const { matchMeta = false } = options;
    const profile = this.matchingProfile;
    if (!this._targetEngagementRoiIds?.size) return null;

    const roiList = [...this._targetEngagementRoiIds];
    const placeholders = roiList.map(() => '?').join(',');

    const visits = this.db.prepare(`
      SELECT 
        zv.id, zv.roi_id, zv.track_key, zv.start_time, zv.end_time,
        zv.duration_ms, zv.is_dwell, zv.is_engagement,
        r.name as roi_name, r.metadata_json
      FROM zone_visits zv
      JOIN regions_of_interest r ON zv.roi_id = r.id
      WHERE zv.venue_id = ?
        AND zv.roi_id IN (${placeholders})
        AND zv.start_time <= ?
        AND COALESCE(zv.end_time, zv.start_time + COALESCE(zv.duration_ms, 0)) >= ?
      ORDER BY zv.start_time ASC
    `).all(venueId, ...roiList, endTs, startTs);

    for (const visit of visits) {
      if (!this._isQualifyingVisit(visit)) continue;
      if (!this._visitInWindow(visit, startTs, endTs)) continue;

      const sameTrack = this._resolveTrackKeyMatch(trackKey, visit.track_key);
      if (sameTrack === 'exact' || sameTrack === 'alias') {
        const metadata = parseJson(visit.metadata_json) || {};
        return this._annotateMatch(this.buildEngagementResult(visit, {
          ...metadata,
          shelfId: metadata.shelfId || targetJson.ids[0],
          template: metadata.template || 'shelf-engagement',
        }), matchMeta ? { source: 'roi_visit', trackKeyMatch: sameTrack } : null);
      }

      const visitEnd = visit.end_time ?? (visit.start_time + (visit.duration_ms || 0));
      if (!tracksLinkedByReidFromDb(
        this.db, venueId, trackKey, visit.track_key, startTs, visitEnd, profile,
      )) {
        continue;
      }

      const metadata = parseJson(visit.metadata_json) || {};
      return this._annotateMatch(this.buildEngagementResult(visit, {
        ...metadata,
        shelfId: metadata.shelfId || targetJson.ids[0],
        template: metadata.template || 'shelf-engagement',
      }), matchMeta ? { source: 'reid_chain', trackKeyMatch: 'relink' } : null);
    }

    return null;
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

    if (result.categories.length === 0) {
      const resolved = resolveShelfCategories(this.db, shelfId);
      result.categories = resolved.categories;
    }

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
  queryPositionBasedEngagement(venueId, trackKey, startTs, endTs, targetJson, options = {}) {
    const { matchMeta = false } = options;
    const { type, ids } = targetJson;
    const profile = this.matchingProfile;

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

    const suffix = this._trackKeySuffix(trackKey);
    const trackFilter = (profile.trackKeyMode === 'suffix_alias' || profile.trackKeyMode === 'reid_chain')
      ? `(track_key = ? OR track_key LIKE ? OR track_key = ?)`
      : `track_key = ?`;
    const trackParams = (profile.trackKeyMode === 'suffix_alias' || profile.trackKeyMode === 'reid_chain')
      ? [trackKey, `%:${suffix}`, suffix]
      : [trackKey];

    const positions = this.db.prepare(`
      SELECT timestamp, position_x, position_z, velocity_x, velocity_z, track_key
      FROM track_positions
      WHERE venue_id = ? AND ${trackFilter} AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(venueId, ...trackParams, startTs, endTs);

    const ENGAGEMENT_DISTANCE = profile.positionFallbackM;
    const MIN_DWELL_MS = profile.positionMinDwellMs;
    const posMeta = { source: 'position', trackKeyMatch: 'exact' };

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
            return this._annotateMatch({
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
            }, matchMeta ? posMeta : null);
          }
          dwellStart = null;
          totalDwell = 0;
        }
      }

      // Check final segment
      if (dwellStart && totalDwell >= MIN_DWELL_MS) {
        return this._annotateMatch({
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
        }, matchMeta ? posMeta : null);
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

    if (planogramId) {
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
    }

    if (type === 'category') {
      const objects = this.db.prepare(`
        SELECT id, metadata_json FROM venue_objects WHERE venue_id = ?
      `).all(venueId);
      for (const obj of objects) {
        const resolved = resolveShelfCategories(this.db, obj.id);
        if (resolved.categories.some((cat) => ids.includes(cat))) {
          shelfIds.add(obj.id);
        }
        const meta = parseJson(obj.metadata_json) || {};
        const label = meta.business_category_label || meta.business_category;
        if (label && ids.includes(label)) {
          shelfIds.add(obj.id);
        }
      }
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
   * Collect product categories from company taxonomy, object/ROI metadata, and planogram SKUs.
   */
  _collectVenueCategories(venueId) {
    const byLabel = new Map();

    const addCategory = (label, source) => {
      if (!label || typeof label !== 'string') return;
      const trimmed = label.trim();
      if (!trimmed) return;
      const existing = byLabel.get(trimmed);
      if (existing) {
        if (source && !existing.sources.includes(source)) existing.sources.push(source);
        return;
      }
      byLabel.set(trimmed, { id: trimmed, label: trimmed, sources: [source] });
    };

    const venue = this.db.prepare('SELECT company_id FROM venues WHERE id = ?').get(venueId);
    if (venue?.company_id) {
      const companyCats = this.db.prepare(`
        SELECT name FROM company_categories WHERE company_id = ? ORDER BY name
      `).all(venue.company_id);
      companyCats.forEach((row) => addCategory(row.name, 'company'));
    }

    const objects = this.db.prepare(`
      SELECT id, metadata_json FROM venue_objects WHERE venue_id = ?
    `).all(venueId);
    for (const obj of objects) {
      const meta = parseJson(obj.metadata_json) || {};
      addCategory(meta.business_category_label, 'object');
      addCategory(meta.business_category, 'object');
      const resolved = resolveShelfCategories(this.db, obj.id);
      resolved.categories.forEach((cat) => addCategory(cat, resolved.source));
    }

    const rois = this.db.prepare(`
      SELECT metadata_json FROM regions_of_interest WHERE venue_id = ?
    `).all(venueId);
    for (const roi of rois) {
      const meta = parseJson(roi.metadata_json) || {};
      addCategory(meta.business_category_label, 'roi');
    }

    const planogram = this.db.prepare(`
      SELECT p.id, sc.id as catalog_id
      FROM planograms p
      LEFT JOIN sku_catalogs sc ON 1=1
      WHERE p.venue_id = ?
      ORDER BY p.version DESC
      LIMIT 1
    `).get(venueId);

    if (planogram?.catalog_id) {
      const skuCategories = this.db.prepare(`
        SELECT DISTINCT category FROM sku_items
        WHERE catalog_id = ? AND category IS NOT NULL
      `).all(planogram.catalog_id);
      skuCategories.forEach((row) => addCategory(row.category, 'planogram'));
    }

    return byLabel;
  }

  _isSelectableShelfFixture(obj) {
    const typeMatch = SHELF_ENGAGEMENT_TYPES.includes(obj.type);
    const nameMatch = SHELF_NAME_PATTERNS.some((pattern) =>
      obj.name.toLowerCase().includes(pattern.toLowerCase())
    );
    return typeMatch || nameMatch;
  }

  /**
   * Get all target options for campaign builder
   * Returns available shelves, categories, brands, SKUs
   */
  getTargetOptions(venueId) {
    const categoryMap = this._collectVenueCategories(venueId);

    const shelfRows = this.db.prepare(`
      SELECT id, name, type, position_x, position_y, position_z,
             rotation_y, scale_x, scale_y, scale_z, metadata_json
      FROM venue_objects
      WHERE venue_id = ?
    `).all(venueId);

    const shelves = shelfRows
      .filter((obj) => this._isSelectableShelfFixture(obj))
      .map((obj) => {
        const meta = parseJson(obj.metadata_json) || {};
        const resolved = resolveShelfCategories(this.db, obj.id);
        const categoryLabel = resolved.categories[0]
          || meta.business_category_label
          || meta.business_category
          || null;
        return {
          id: obj.id,
          name: obj.name,
          type: obj.type,
          position: {
            x: obj.position_x,
            y: obj.position_y ?? 0,
            z: obj.position_z,
          },
          rotation: obj.rotation_y ? { y: obj.rotation_y } : undefined,
          scale: {
            x: obj.scale_x,
            y: obj.scale_y,
            z: obj.scale_z,
          },
          footprintPoints: meta.dwg_footprint_points || null,
          categoryLabel,
          categories: resolved.categories.length
            ? resolved.categories
            : (categoryLabel ? [categoryLabel] : []),
        };
      });

    // Get categories and brands from SKU catalog (legacy strings merged above)
    const planogram = this.db.prepare(`
      SELECT p.id, sc.id as catalog_id
      FROM planograms p
      LEFT JOIN sku_catalogs sc ON 1=1
      WHERE p.venue_id = ?
      ORDER BY p.version DESC
      LIMIT 1
    `).get(venueId);

    let brands = [];
    let skus = [];

    if (planogram?.catalog_id) {
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

    const categories = Array.from(categoryMap.values())
      .map(({ id, label, sources }) => ({ id, label, sources }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      shelves,
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
