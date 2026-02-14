/**
 * Context Resolver for DOOH KPI Engine
 * 
 * Tags each exposure event with shopper journey phase using existing ROI polygons.
 * 
 * Feature flag: FEATURE_DOOH_KPIS
 */

import { pointInPolygon } from './DoohKpiEngine.js';

/**
 * Default context priority order
 */
const DEFAULT_PRIORITY = ['queue', 'checkout', 'promo', 'aisle', 'entrance', 'exit', 'other'];

/**
 * Parse ROI name to determine its phase/type
 */
function parseRoiPhase(roiName, priorityList) {
  const nameLower = roiName.toLowerCase();
  
  for (const phase of priorityList) {
    if (nameLower.includes(phase)) {
      return phase;
    }
  }
  
  // Special mappings
  if (nameLower.includes('queue') || nameLower.includes('cassa') || nameLower.includes('register')) {
    return 'queue';
  }
  if (nameLower.includes('check') || nameLower.includes('payment')) {
    return 'checkout';
  }
  if (nameLower.includes('promo') || nameLower.includes('display') || nameLower.includes('endcap')) {
    return 'promo';
  }
  if (nameLower.includes('aisle') || nameLower.includes('shelf') || nameLower.includes('category')) {
    return 'aisle';
  }
  if (nameLower.includes('entrance') || nameLower.includes('entry') || nameLower.includes('ingress')) {
    return 'entrance';
  }
  if (nameLower.includes('exit') || nameLower.includes('egress') || nameLower.includes('out')) {
    return 'exit';
  }
  
  return 'other';
}

export class ContextResolver {
  constructor(db) {
    this.db = db;
    this.roiCache = new Map();
  }

  /**
   * Load ROIs for a venue (cached)
   */
  loadRois(venueId) {
    if (this.roiCache.has(venueId)) {
      return this.roiCache.get(venueId);
    }

    const rows = this.db.prepare(`
      SELECT id, name, vertices FROM regions_of_interest WHERE venue_id = ?
    `).all(venueId);

    const rois = rows.map(row => {
      let vertices;
      try {
        vertices = JSON.parse(row.vertices);
        // Convert to xz format if needed
        if (vertices.length > 0 && vertices[0].y !== undefined && vertices[0].z === undefined) {
          // Vertices are in xy format, convert to xz
          vertices = vertices.map(v => ({ x: v.x, z: v.y }));
        }
      } catch {
        vertices = [];
      }
      return {
        id: row.id,
        name: row.name,
        vertices,
      };
    });

    this.roiCache.set(venueId, rois);
    return rois;
  }

  /**
   * Find dominant ROI for a set of samples
   */
  findDominantRoi(samples, rois, priorityList) {
    if (!samples || samples.length === 0 || !rois || rois.length === 0) {
      return null;
    }

    // Count samples in each ROI
    const roiCounts = new Map();
    
    for (const sample of samples) {
      for (const roi of rois) {
        if (pointInPolygon(sample.x, sample.z, roi.vertices)) {
          roiCounts.set(roi.id, (roiCounts.get(roi.id) || 0) + 1);
        }
      }
    }

    if (roiCounts.size === 0) {
      return null;
    }

    // Find ROI with highest count, using priority as tiebreaker
    let bestRoi = null;
    let bestCount = 0;
    let bestPriority = Infinity;

    for (const [roiId, count] of roiCounts) {
      const roi = rois.find(r => r.id === roiId);
      if (!roi) continue;

      const phase = parseRoiPhase(roi.name, priorityList);
      const priority = priorityList.indexOf(phase);
      const effectivePriority = priority >= 0 ? priority : priorityList.length;

      if (count > bestCount || (count === bestCount && effectivePriority < bestPriority)) {
        bestRoi = roi;
        bestCount = count;
        bestPriority = effectivePriority;
      }
    }

    return bestRoi;
  }

  /**
   * Get samples from trajectory storage for a time window
   */
  getSamplesForWindow(venueId, trackKey, startTs, endTs) {
    const rows = this.db.prepare(`
      SELECT timestamp, x, z, speed
      FROM trajectory_samples
      WHERE venue_id = ? AND track_key = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp
    `).all(venueId, trackKey, startTs, endTs);

    return rows.map(row => ({
      timestamp: row.timestamp,
      x: row.x,
      z: row.z,
      speed: row.speed || 0,
    }));
  }

  /**
   * Resolve context for a single exposure event
   */
  resolveContext(event, rois, params) {
    const priorityList = params.context_priority_json || DEFAULT_PRIORITY;
    const prePostWindowMs = (params.pre_post_window_s || 30) * 1000;

    // Determine phase at exposure time
    const dominantRoi = this.findDominantRoi(event.samples, rois, priorityList);
    const phase = dominantRoi 
      ? parseRoiPhase(dominantRoi.name, priorityList)
      : 'other';

    // Get pre-exposure samples
    const preSamples = this.getSamplesForWindow(
      event.venueId,
      event.trackKey,
      event.startTs - prePostWindowMs,
      event.startTs - 1
    );
    const preRoi = this.findDominantRoi(preSamples, rois, priorityList);
    const preZone = preRoi ? parseRoiPhase(preRoi.name, priorityList) : null;

    // Get post-exposure samples
    const postSamples = this.getSamplesForWindow(
      event.venueId,
      event.trackKey,
      event.endTs + 1,
      event.endTs + prePostWindowMs
    );
    const postRoi = this.findDominantRoi(postSamples, rois, priorityList);
    const postZone = postRoi ? parseRoiPhase(postRoi.name, priorityList) : null;

    // Calculate confidence based on sample coverage
    const totalSamples = event.samples.length;
    const samplesInRoi = dominantRoi 
      ? event.samples.filter(s => pointInPolygon(s.x, s.z, dominantRoi.vertices)).length
      : 0;
    const confidence = totalSamples > 0 ? samplesInRoi / totalSamples : 0;

    return {
      phase,
      preZone,
      postZone,
      dominantZone: dominantRoi?.name || null,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * Resolve context for multiple exposure events
   */
  resolveContextBatch(events, venueId, params) {
    const rois = this.loadRois(venueId);
    
    for (const event of events) {
      event.contextJson = this.resolveContext(event, rois, params);
    }

    return events;
  }

  /**
   * Update stored events with context
   */
  updateEventContext(eventId, contextJson) {
    this.db.prepare(`
      UPDATE dooh_exposure_events SET context_json = ? WHERE id = ?
    `).run(JSON.stringify(contextJson), eventId);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.roiCache.clear();
  }
}

export default ContextResolver;
