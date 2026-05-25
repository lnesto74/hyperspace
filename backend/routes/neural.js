/**
 * Neural Dashboard API Routes
 * 
 * Provides data for the Neural Dashboard panels:
 * - GET /api/neural/funnel          — Engagement funnel stages
 * - GET /api/neural/transitions     — Zone-to-zone transition matrix (Sankey, legacy)
 * - GET /api/neural/journey-patterns — Clustered category-level journey archetypes
 * - GET /api/neural/alerts          — Real-time behavioral alerts
 * - GET /api/neural/media-summary   — Compact DOOH campaign KPIs
 * - GET /api/neural/xray-zones     — Per-zone KPI overlay for Neural X-Ray
 */

import { Router } from 'express';
import {
  getCheckoutAlertConfig,
  evaluateCheckoutLaneAlerts,
} from '../services/CheckoutAlertConfig.js';
import { getCheckoutLanes } from '../services/CheckoutLiveStatus.js';
import { resolveKpiContext, demoCacheSuffix } from '../utils/demoKpiContext.js';
import { resolveShelfCategories } from '../services/ShelfCategoryResolver.js';

// Stale-while-revalidate cache with staggered background recomputes.
// On cache HIT: return data instantly.
// On cache MISS with stale data: return stale data instantly, schedule recompute.
// On cold start (no data at all): compute synchronously (unavoidable).
// Recomputes are queued and executed one-at-a-time with event loop yields
// between each, preventing multiple heavy SQL queries from blocking back-to-back.
const responseCache = new Map();
const recomputingKeys = new Set();
const recomputeQueue = [];
let recomputeRunning = false;

function drainRecomputeQueue() {
  if (recomputeRunning || recomputeQueue.length === 0) return;
  recomputeRunning = true;
  const { key, ttlMs, computeFn } = recomputeQueue.shift();
  setImmediate(() => {
    try {
      const data = computeFn();
      responseCache.set(key, { data, expiry: Date.now() + ttlMs });
    } catch (e) {
      console.error(`[Cache] recompute error for ${key}:`, e.message);
    }
    recomputingKeys.delete(key);
    recomputeRunning = false;
    if (recomputeQueue.length > 0) {
      setTimeout(drainRecomputeQueue, 50);
    }
  });
}

function cached(key, ttlMs, computeFn) {
  const entry = responseCache.get(key);
  const now = Date.now();

  if (entry && now < entry.expiry) {
    return entry.data;
  }

  if (entry) {
    if (!recomputingKeys.has(key)) {
      recomputingKeys.add(key);
      recomputeQueue.push({ key, ttlMs, computeFn });
      drainRecomputeQueue();
    }
    return entry.data;
  }

  // Cold start — no cached data at all, must compute synchronously
  const data = computeFn();
  responseCache.set(key, { data, expiry: Date.now() + ttlMs });
  if (responseCache.size > 200) {
    const oldest = responseCache.keys().next().value;
    responseCache.delete(oldest);
  }
  return data;
}

export default function createNeuralRoutes(db, trackAggregator, demoSessionService = null) {
  const router = Router();

  // ============================================
  // ENGAGEMENT FUNNEL
  // ============================================

  /**
   * GET /api/neural/funnel?venueId=X&range=1h|24h|7d
   * 
   * Stages:
   *   ENTRY    — entrance/traffic zones (fallback: non-queue footfall)
   *   SHOP     — product/shelf zones
   *   ENGAGE   — dwelled at any shelf zone
   *   BASKET   — engaged at 3+ different shelf zones
   *   CHECKOUT — checkout service zones (excludes queue waiting)
   */
  router.get('/funnel', (req, res) => {
    try {
      const { venueId, range } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const result = cached(`funnel:${venueId}:${range}`, 55000, () =>
        computeFunnel(db, venueId, range)
      );

      res.json(result);
    } catch (err) {
      console.error('[Neural] funnel error:', err.message);
      res.status(500).json({ error: 'Failed to compute funnel' });
    }
  });

  // ============================================
  // ZONE TRANSITIONS (SANKEY)
  // ============================================

  /**
   * GET /api/neural/transitions?venueId=X&range=1h|24h|7d
   * 
   * Returns zone-to-zone flow data for Sankey visualization.
   * Each edge: { from, to, count, conversionPct }
   */
  router.get('/transitions', (req, res) => {
    try {
      const { venueId, range } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const t0 = Date.now();
      const cacheKey = `transitions:${venueId}:${range}`;
      const isCacheHit = responseCache.has(cacheKey) && Date.now() < (responseCache.get(cacheKey)?.expiry || 0);
      const result = cached(cacheKey, 60000, () => {
        const { startTime, endTime } = resolveRange(range);

        const visits = db.prepare(`
          SELECT zv.track_key, zv.roi_id, zv.start_time, zv.end_time, zv.is_dwell,
                 r.name AS zone_name
          FROM zone_visits zv
          JOIN regions_of_interest r ON zv.roi_id = r.id
          WHERE zv.venue_id = ? AND zv.start_time >= ? AND zv.start_time < ?
            AND zv.is_dwell = 1
          ORDER BY zv.track_key, zv.start_time
        `).all(venueId, startTime, endTime);

        const transitions = new Map();
        const zoneNames = new Map();
        const zoneCounts = new Map();
        const checkoutRois = new Set();
        const rois = db.prepare(
          `SELECT id, name FROM regions_of_interest WHERE venue_id = ?`
        ).all(venueId);
        rois.forEach(r => {
          zoneNames.set(r.id, simplifyZoneName(r.name));
          if (/checkout/i.test(r.name)) checkoutRois.add(r.id);
        });

        const convertedTracks = new Set();
        let prevTrack = null;
        let prevRoi = null;
        for (const v of visits) {
          if (!zoneCounts.has(v.roi_id)) zoneCounts.set(v.roi_id, 0);
          zoneCounts.set(v.roi_id, zoneCounts.get(v.roi_id) + 1);
          if (checkoutRois.has(v.roi_id)) convertedTracks.add(v.track_key);
          if (v.track_key === prevTrack && v.roi_id !== prevRoi) {
            const key = `${prevRoi}|${v.roi_id}`;
            transitions.set(key, (transitions.get(key) || 0) + 1);
          }
          prevTrack = v.track_key;
          prevRoi = v.roi_id;
        }

        const nodes = [];
        zoneCounts.forEach((count, roiId) => {
          nodes.push({ id: roiId, name: zoneNames.get(roiId) || roiId, count, isCheckout: checkoutRois.has(roiId) });
        });
        nodes.sort((a, b) => b.count - a.count);

        const edges = [];
        transitions.forEach((count, key) => {
          const [from, to] = key.split('|');
          edges.push({ from, to, count });
        });
        edges.sort((a, b) => b.count - a.count);

        return { nodes, edges: edges.slice(0, 30), totalTracks: new Set(visits.map(v => v.track_key)).size, convertedTracks: convertedTracks.size };
      });

      const elapsed = Date.now() - t0;
      if (!isCacheHit || elapsed > 50) {
        console.log(`[DIAG] /transitions  ${elapsed}ms  cache=${isCacheHit ? 'HIT' : 'MISS'}`);
      }

      res.json(result);
    } catch (err) {
      console.error('[Neural] transitions error:', err.message);
      res.status(500).json({ error: 'Failed to compute transitions' });
    }
  });

  // ============================================
  // JOURNEY PATTERNS (clustered category-level flow)
  // ============================================

  /**
   * GET /api/neural/journey-patterns?venueId=X&range=1h|24h|7d
   *
   * Returns journey archetypes with category-level flow.
   * Groups individual shelf zones into product categories,
   * classifies tracks into behavioral archetypes, and computes
   * per-archetype statistics.
   */
  router.get('/journey-patterns', (req, res) => {
    try {
      const { venueId, range } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const t0 = Date.now();
      const cacheKey = `journey-patterns:${venueId}:${range}`;
      const isCacheHit = responseCache.has(cacheKey) && Date.now() < (responseCache.get(cacheKey)?.expiry || 0);
      const result = cached(cacheKey, 60000, () => computeJourneyPatterns(db, venueId, range));

      const elapsed = Date.now() - t0;
      if (!isCacheHit || elapsed > 50) {
        console.log(`[DIAG] /journey-patterns  ${elapsed}ms  cache=${isCacheHit ? 'HIT' : 'MISS'}`);
      }

      res.json(result);
    } catch (err) {
      console.error('[Neural] journey-patterns error:', err.message);
      res.status(500).json({ error: 'Failed to compute journey patterns' });
    }
  });

  // ============================================
  // ALERTS (AI DECISION FEED)
  // ============================================

  /**
   * GET /api/neural/alerts?venueId=X&limit=20
   * 
   * Aggregates alerts from:
   * - Queue buildup detection
   * - Bottleneck detection
   * - Abandonment detection
   * - Lane supply suggestions
   * - Media ROI warnings
   * - High intent clusters
   */
  router.get('/alerts', (req, res) => {
    try {
      const { venueId, limit } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const maxAlerts = parseInt(limit) || 15;
      const result = cached(`alerts:${venueId}`, 35000, () => computeAlerts(db, venueId, trackAggregator));
      res.json({ alerts: result.alerts.slice(0, maxAlerts), count: result.count });
    } catch (err) {
      console.error('[Neural] alerts error:', err.message);
      res.status(500).json({ error: 'Failed to compute alerts' });
    }
  });

  // ============================================
  // MEDIA SUMMARY
  // ============================================

  /**
   * GET /api/neural/media-summary?venueId=X&range=1h|24h|7d
   * 
   * Compact DOOH campaign performance for the media panel.
   */
  router.get('/media-summary', (req, res) => {
    try {
      const { venueId, range } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const result = cached(`media-summary:${venueId}:${range}`, 70000, () => {
        return computeMediaSummary(db, venueId, range);
      });

      res.json(result);
    } catch (err) {
      console.error('[Neural] media-summary error:', err.message);
      res.status(500).json({ error: 'Failed to compute media summary' });
    }
  });

  // ============================================
  // X-RAY ZONES (NEURAL X-RAY OVERLAY)
  // ============================================

  /**
   * GET /api/neural/xray-zones?venueId=X
   *
   * Per-zone KPI data for the Neural X-Ray spatial overlay.
   * Returns zone polygons with visits, dwell, engagement, occupancy
   * plus enriched data for shelf-engagement and cashier-queue templates.
   */
  router.get('/xray-zones', (req, res) => {
    try {
      const { venueId } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const ctx = resolveKpiContext(req, db, null, null, demoSessionService);
      const cacheKey = `xray-zones:${venueId}${demoCacheSuffix(req, demoSessionService)}`;
      const result = cached(cacheKey, 30000, () => computeXRayZones(ctx.db, venueId));
      res.json(result);
    } catch (err) {
      console.error('[Neural] xray-zones error:', err.message);
      res.status(500).json({ error: 'Failed to compute X-Ray zones' });
    }
  });

  // ============================================
  // VENUE KPIs (METRICS TOWER)
  // ============================================

  /**
   * GET /api/neural/venue-kpis?venueId=X
   * 
   * Real-time aggregated KPIs for the Metrics Tower:
   * - avgVelocity, avgDwell, drawRate, bounceRate
   * - topZones (by occupancy)
   * - occupancy history (last 12 data points for sparkline)
   */
  router.get('/venue-kpis', (req, res) => {
    try {
      const { venueId } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const result = cached(`venue-kpis:${venueId}`, 45000, () => {
        const now = Date.now();
        const hour = now - 60 * 60 * 1000;
        const fiveMin = now - 5 * 60 * 1000;

        let avgVelocity = 0;
        try {
          const vel = db.prepare(`
            SELECT AVG(velocity_x * velocity_x + velocity_z * velocity_z) AS avg_sq
            FROM track_positions
            WHERE venue_id = ? AND timestamp >= ?
          `).get(venueId, fiveMin);
          avgVelocity = vel && vel.avg_sq ? parseFloat(Math.sqrt(vel.avg_sq).toFixed(2)) : 0;
        } catch (e) {}

        let avgDwellSec = 0;
        try {
          const dw = db.prepare(`
            SELECT AVG(duration_ms) AS avg_ms
            FROM zone_visits
            WHERE venue_id = ? AND start_time >= ? AND duration_ms > 0
          `).get(venueId, hour);
          avgDwellSec = dw && dw.avg_ms ? parseFloat((dw.avg_ms / 1000).toFixed(1)) : 0;
        } catch (e) {}

        let drawRate = 0, bounceRate = 0;
        try {
          const flow = db.prepare(`
            SELECT 
              COUNT(DISTINCT track_key) AS total,
              COUNT(DISTINCT CASE WHEN is_dwell = 1 THEN track_key END) AS dwelled,
              COUNT(DISTINCT CASE WHEN duration_ms < 5000 THEN track_key END) AS bounced
            FROM zone_visits
            WHERE venue_id = ? AND start_time >= ?
          `).get(venueId, hour);
          if (flow && flow.total > 0) {
            drawRate = parseFloat(((flow.dwelled / flow.total) * 100).toFixed(1));
            bounceRate = parseFloat(((flow.bounced / flow.total) * 100).toFixed(1));
          }
        } catch (e) {}

        let uniqueVisitors = 0;
        try {
          const uv = db.prepare(`
            SELECT COUNT(DISTINCT track_key) AS cnt
            FROM zone_visits
            WHERE venue_id = ? AND start_time >= ?
          `).get(venueId, hour);
          uniqueVisitors = uv?.cnt || 0;
        } catch (e) {}

        let topZones = [];
        try {
          topZones = db.prepare(`
            SELECT r.name, zo.roi_id, MAX(zo.occupancy_count) AS peak, AVG(zo.occupancy_count) AS avg_occ
            FROM zone_occupancy zo
            JOIN regions_of_interest r ON zo.roi_id = r.id
            WHERE zo.venue_id = ? AND zo.timestamp >= ?
            GROUP BY zo.roi_id
            ORDER BY avg_occ DESC
            LIMIT 5
          `).all(venueId, fiveMin).map(z => ({
            name: simplifyZoneName(z.name),
            peak: z.peak,
            avg: parseFloat((z.avg_occ || 0).toFixed(1)),
          }));
        } catch (e) {}

        let sparkline = new Array(12).fill(0);
        try {
          const bucketMs = 5 * 60 * 1000;
          const hourAgo = now - 12 * bucketMs;
          const rows = db.prepare(`
            SELECT 
              CAST((timestamp - ?) / ? AS INTEGER) AS bucket,
              AVG(occupancy_count) AS val
            FROM zone_occupancy
            WHERE venue_id = ? AND timestamp >= ?
            GROUP BY bucket
            ORDER BY bucket
          `).all(hourAgo, bucketMs, venueId, hourAgo);
          
          for (const row of rows) {
            if (row.bucket >= 0 && row.bucket < 12) {
              sparkline[row.bucket] = parseFloat((row.val || 0).toFixed(1));
            }
          }
        } catch (e) {}

        return { avgVelocity, avgDwellSec, drawRate, bounceRate, uniqueVisitors, topZones, sparkline };
      });

      res.json(result);
    } catch (err) {
      console.error('[Neural] venue-kpis error:', err.message);
      res.status(500).json({ error: 'Failed to compute venue KPIs' });
    }
  });

  // ============================================
  // BATCH ENDPOINT — single request replaces 4 concurrent polls
  // ============================================

  /**
   * GET /api/neural/batch?venueId=X&range=1h|24h|7d
   * 
   * Returns venue-kpis + funnel + alerts + media-summary in one response.
   * Prevents 4 concurrent SQLite query storms that block the event loop
   * and cause Socket.IO/edge-simulator heartbeat timeouts.
   */
  router.get('/batch', (req, res) => {
    try {
      const { venueId, range } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const ctx = resolveKpiContext(req, db, null, null, demoSessionService);
      const kpiDb = ctx.db;
      const demoSuffix = demoCacheSuffix(req, demoSessionService);

      // Cache TTLs MUST exceed the polling interval (8s) to guarantee cache hits
      // on most requests. Sub-caches are staggered so they never all expire at once.
      const venueKpisKey = `venue-kpis:${venueId}${demoSuffix}`;
      const funnelKey = `funnel:${venueId}:${range}${demoSuffix}`;
      const alertsKey = `alerts:${venueId}${demoSuffix}`;
      const mediaKey = `media-summary:${venueId}:${range}${demoSuffix}`;

      const t0 = Date.now();
      const hitsBefore = [venueKpisKey, funnelKey, alertsKey, mediaKey].map(k => {
        const e = responseCache.get(k);
        return e && Date.now() < e.expiry ? 'HIT' : 'MISS';
      });

      // TTLs are deliberately staggered (prime-ish intervals) so they never
      // all expire on the same poll cycle, preventing simultaneous recomputes.
      const batchResult = {
        venueKpis: cached(venueKpisKey, 45000, () => computeVenueKpis(kpiDb, venueId)),
        funnel: cached(funnelKey, 55000, () => computeFunnel(kpiDb, venueId, range)),
        alerts: cached(alertsKey, 35000, () => computeAlerts(ctx.isDemo ? kpiDb : db, venueId, trackAggregator)),
        mediaSummary: cached(mediaKey, 70000, () => computeMediaSummary(kpiDb, venueId, range)),
        demo: ctx.isDemo,
      };

      const elapsed = Date.now() - t0;
      if (elapsed > 50 || hitsBefore.includes('MISS')) {
        console.log(`[DIAG] /batch  ${elapsed}ms  kpis=${hitsBefore[0]} funnel=${hitsBefore[1]} alerts=${hitsBefore[2]} media=${hitsBefore[3]}`);
      }

      res.json(batchResult);
    } catch (err) {
      console.error('[Neural] batch error:', err.message);
      res.status(500).json({ error: 'Failed to compute batch' });
    }
  });

  // Pre-warm caches after startup — stagger each compute by 3s per metric,
  // 15s between venues, starting 10s after boot.
  const venues = db.prepare('SELECT id FROM venues LIMIT 3').all();
  for (let i = 0; i < venues.length; i++) {
    const vid = venues[i].id;
    const base = 10000 + i * 15000;
    setTimeout(() => {
      try { cached(`venue-kpis:${vid}`, 45000, () => computeVenueKpis(db, vid)); } catch {}
    }, base);
    setTimeout(() => {
      try { cached(`funnel:${vid}:1h`, 55000, () => computeFunnel(db, vid, '1h')); } catch {}
    }, base + 3000);
    setTimeout(() => {
      try { cached(`alerts:${vid}`, 35000, () => computeAlerts(db, vid, trackAggregator)); } catch {}
    }, base + 6000);
    setTimeout(() => {
      try { cached(`media-summary:${vid}:1h`, 70000, () => computeMediaSummary(db, vid, '1h')); } catch {}
    }, base + 9000);
  }
  console.log(`[Neural] Scheduled cache pre-warm for ${venues.length} venue(s)`);

  return router;
}

// ============================================
// EXTRACTED COMPUTE FUNCTIONS (for batch reuse)
// ============================================

function computeVenueKpis(db, venueId) {
  const now = Date.now();
  const hour = now - 60 * 60 * 1000;
  const fiveMin = now - 5 * 60 * 1000;

  let avgVelocity = 0;
  try {
    const vel = db.prepare(`
      SELECT AVG(velocity_x * velocity_x + velocity_z * velocity_z) AS avg_sq
      FROM track_positions
      WHERE venue_id = ? AND timestamp >= ?
    `).get(venueId, fiveMin);
    avgVelocity = vel && vel.avg_sq ? parseFloat(Math.sqrt(vel.avg_sq).toFixed(2)) : 0;
  } catch (e) {}

  let avgDwellSec = 0;
  try {
    const dw = db.prepare(`
      SELECT AVG(duration_ms) AS avg_ms
      FROM zone_visits
      WHERE venue_id = ? AND start_time >= ? AND duration_ms > 0
    `).get(venueId, hour);
    avgDwellSec = dw && dw.avg_ms ? parseFloat((dw.avg_ms / 1000).toFixed(1)) : 0;
  } catch (e) {}

  let drawRate = 0, bounceRate = 0;
  try {
    const flow = db.prepare(`
      SELECT 
        COUNT(DISTINCT track_key) AS total,
        COUNT(DISTINCT CASE WHEN is_dwell = 1 THEN track_key END) AS dwelled,
        COUNT(DISTINCT CASE WHEN duration_ms < 5000 THEN track_key END) AS bounced
      FROM zone_visits
      WHERE venue_id = ? AND start_time >= ?
    `).get(venueId, hour);
    if (flow && flow.total > 0) {
      drawRate = parseFloat(((flow.dwelled / flow.total) * 100).toFixed(1));
      bounceRate = parseFloat(((flow.bounced / flow.total) * 100).toFixed(1));
    }
  } catch (e) {}

  let uniqueVisitors = 0;
  try {
    const uv = db.prepare(`
      SELECT COUNT(DISTINCT track_key) AS cnt
      FROM zone_visits
      WHERE venue_id = ? AND start_time >= ?
    `).get(venueId, hour);
    uniqueVisitors = uv?.cnt || 0;
  } catch (e) {}

  let topZones = [];
  try {
    topZones = db.prepare(`
      SELECT r.name, zo.roi_id, MAX(zo.occupancy_count) AS peak, AVG(zo.occupancy_count) AS avg_occ
      FROM zone_occupancy zo
      JOIN regions_of_interest r ON zo.roi_id = r.id
      WHERE zo.venue_id = ? AND zo.timestamp >= ?
      GROUP BY zo.roi_id
      ORDER BY avg_occ DESC
      LIMIT 5
    `).all(venueId, fiveMin).map(z => ({
      name: simplifyZoneName(z.name),
      peak: z.peak,
      avg: parseFloat((z.avg_occ || 0).toFixed(1)),
    }));
  } catch (e) {}

  let sparkline = new Array(12).fill(0);
  try {
    const bucketMs = 5 * 60 * 1000;
    const hourAgo = now - 12 * bucketMs;
    const rows = db.prepare(`
      SELECT 
        CAST((timestamp - ?) / ? AS INTEGER) AS bucket,
        AVG(occupancy_count) AS val
      FROM zone_occupancy
      WHERE venue_id = ? AND timestamp >= ?
      GROUP BY bucket
      ORDER BY bucket
    `).all(hourAgo, bucketMs, venueId, hourAgo);
    for (const row of rows) {
      if (row.bucket >= 0 && row.bucket < 12) {
        sparkline[row.bucket] = parseFloat((row.val || 0).toFixed(1));
      }
    }
  } catch (e) {}

  return { avgVelocity, avgDwellSec, drawRate, bounceRate, uniqueVisitors, topZones, sparkline };
}

function classifyFunnelRoi(name) {
  const n = (name || '').toLowerCase();
  if (/\bqueue\b/.test(n) || n.includes('- queue')) return 'queue';
  if (/entrance|entry|exit|door|gate|traffic|ingress|ingresso|uscita/.test(n)) return 'entry';
  if (/checkout|register|cashier|\bservice\b/.test(n)) return 'checkout';
  if (/shelf|gondola|aisle|product|display|fridge|promo|engagement/.test(n)) return 'shelf';
  return 'other';
}

function countDistinctFunnelTracks(db, venueId, roiIds, startTime, endTime, extraWhere = '') {
  if (!roiIds.length) return 0;
  const placeholders = roiIds.map(() => '?').join(',');
  const row = db.prepare(`
    SELECT COUNT(DISTINCT track_key) AS cnt
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${placeholders})
      AND start_time >= ? AND start_time < ?
      ${extraWhere}
  `).get(venueId, ...roiIds, startTime, endTime);
  return row?.cnt || 0;
}

/** Dwell flag is sometimes stale; duration_ms is the reliable fallback. */
const FUNNEL_DWELL_WHERE = 'AND (is_dwell = 1 OR duration_ms >= 3000)';

function distinctFunnelTrackKeys(db, venueId, roiIds, startTime, endTime, extraWhere = '') {
  if (!roiIds.length) return new Set();
  const placeholders = roiIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT DISTINCT track_key
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${placeholders})
      AND start_time >= ? AND start_time < ?
      ${extraWhere}
  `).all(venueId, ...roiIds, startTime, endTime);
  return new Set(rows.map(r => r.track_key));
}

function intersectTrackSets(a, b) {
  if (!a.size || !b.size) return new Set();
  const out = new Set();
  for (const key of a) {
    if (b.has(key)) out.add(key);
  }
  return out;
}

function computeFunnel(db, venueId, range) {
  const { startTime, endTime } = resolveRange(range);

  const rois = db.prepare(
    `SELECT id, name FROM regions_of_interest WHERE venue_id = ?`
  ).all(venueId);

  const entryRoiIds = rois.filter(r => classifyFunnelRoi(r.name) === 'entry').map(r => r.id);
  const shelfRoiIds = rois.filter(r => classifyFunnelRoi(r.name) === 'shelf').map(r => r.id);
  const checkoutRoiIds = rois.filter(r => classifyFunnelRoi(r.name) === 'checkout').map(r => r.id);
  const footfallRoiIds = rois.filter(r => classifyFunnelRoi(r.name) !== 'queue').map(r => r.id);

  let entrySet = distinctFunnelTrackKeys(db, venueId, entryRoiIds, startTime, endTime);
  let entrySource = 'entrance';

  if (entrySet.size === 0 && footfallRoiIds.length > 0) {
    entrySet = distinctFunnelTrackKeys(db, venueId, footfallRoiIds, startTime, endTime);
    entrySource = entryRoiIds.length > 0 ? 'footfall_fallback' : 'footfall';
  }

  const shopAll = distinctFunnelTrackKeys(db, venueId, shelfRoiIds, startTime, endTime);
  const shopSet = entrySet.size > 0 ? intersectTrackSets(entrySet, shopAll) : shopAll;

  const engageAll = distinctFunnelTrackKeys(
    db, venueId, shelfRoiIds, startTime, endTime, FUNNEL_DWELL_WHERE
  );
  const engageSet = intersectTrackSets(shopSet, engageAll);

  let basketSet = new Set();
  if (shelfRoiIds.length > 0) {
    const basketRows = db.prepare(`
      SELECT track_key, COUNT(DISTINCT roi_id) AS zone_count
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${shelfRoiIds.map(() => '?').join(',')})
        ${FUNNEL_DWELL_WHERE}
        AND start_time >= ? AND start_time < ?
      GROUP BY track_key
      HAVING zone_count >= 3
    `).all(venueId, ...shelfRoiIds, startTime, endTime);
    basketSet = intersectTrackSets(engageSet, new Set(basketRows.map(r => r.track_key)));
  }

  const checkoutAll = distinctFunnelTrackKeys(db, venueId, checkoutRoiIds, startTime, endTime);
  const checkoutSet = entrySet.size > 0
    ? intersectTrackSets(entrySet, checkoutAll)
    : intersectTrackSets(shopSet, checkoutAll);

  if (entrySet.size === 0 && shopSet.size > 0) {
    entrySet = shopSet;
    entrySource = 'shop_anchor';
  }

  const entry = entrySet.size;
  const shop = shopSet.size;
  const engage = engageSet.size;
  const basket = basketSet.size;
  const checkout = checkoutSet.size;

  const stages = [
    { id: 'entry', label: 'ENTRY', count: entry },
    { id: 'shop', label: 'SHOP', count: shop },
    { id: 'engage', label: 'ENGAGE', count: engage },
    { id: 'basket', label: 'BASKET', count: basket },
    { id: 'checkout', label: 'CHECKOUT', count: checkout },
  ];

  for (let i = 0; i < stages.length; i++) {
    stages[i].pctOfEntry = entry > 0 ? Math.min(100, Math.round((stages[i].count / entry) * 100)) : 0;
  }
  if (entry > 0) stages[0].pctOfEntry = 100;

  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    const curr = stages[i].count;
    stages[i].dropPct = (prev > 0 && curr <= prev)
      ? Math.round((1 - curr / prev) * 100)
      : 0;
  }
  stages[0].dropPct = 0;

  let biggestLeak = null;
  let maxDrop = 0;
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    const curr = stages[i].count;
    if (prev > 0 && curr <= prev) {
      const dropPct = Math.round((1 - curr / prev) * 100);
      if (dropPct > maxDrop) {
        maxDrop = dropPct;
        biggestLeak = {
          from: stages[i - 1].label,
          to: stages[i].label,
          dropPct,
          lost: prev - curr,
        };
      }
    }
  }

  return { stages, biggestLeak, range, venueId, entrySource };
}

function computeAlerts(db, venueId, trackAggregator) {
  const now = Date.now();
  const lookback = now - 60 * 60 * 1000;
  const alerts = [];

  // 1. Queue alerts — same lanes + thresholds as Checkout Operations Center
  try {
    const alertConfig = getCheckoutAlertConfig(db, venueId);
    const { lanes } = getCheckoutLanes(db, trackAggregator, venueId);
    const checkoutAlerts = evaluateCheckoutLaneAlerts(lanes, alertConfig, now);
    alerts.push(...checkoutAlerts);
  } catch (e) {}

  // 2. Low engagement — only show with ≥5 visitors (enough traffic to be meaningful),
  //    group into a summary for zones with 0% and individual alerts for worst outliers.
  try {
    const lowEngAlerts = db.prepare(`
      SELECT 
        r.id, r.name,
        COUNT(DISTINCT zv.track_key) AS visitors,
        COUNT(DISTINCT CASE WHEN zv.is_dwell = 1 THEN zv.track_key END) AS dwellers
      FROM regions_of_interest r
      JOIN zone_visits zv ON zv.roi_id = r.id
      WHERE r.venue_id = ? 
        AND (r.name LIKE '%shelf%' OR r.name LIKE '%gondola%' OR r.name LIKE '%aisle%' OR r.name LIKE '%product%')
        AND r.name NOT LIKE '%checkout%' AND r.name NOT LIKE '%queue%'
        AND zv.start_time >= ? AND zv.start_time < ?
      GROUP BY r.id, r.name
      HAVING visitors >= 5 AND (dwellers * 100.0 / visitors) < 20
      ORDER BY visitors DESC, (dwellers * 100.0 / visitors) ASC
      LIMIT 20
    `).all(venueId, lookback, now);

    const zeroEng = lowEngAlerts.filter(r => r.dwellers === 0);
    const lowEng = lowEngAlerts.filter(r => r.dwellers > 0);

    if (zeroEng.length > 0) {
      const topNames = zeroEng.slice(0, 4).map(r => simplifyZoneName(r.name));
      const suffix = zeroEng.length > 4 ? ` +${zeroEng.length - 4} more` : '';
      const totalVisitors = zeroEng.reduce((s, r) => s + r.visitors, 0);
      alerts.push({
        id: `low-eng-zero-summary`,
        type: 'low_engagement',
        severity: 'high',
        title: 'ZERO ENGAGEMENT',
        message: `${zeroEng.length} zones with 0% engagement: ${topNames.join(', ')}${suffix} (${totalVisitors} visitors total)`,
        action: 'Review shelf positioning, signage, or product placement',
        timestamp: now - 60000,
        zoneIds: zeroEng.map(r => r.id),
      });
    }

    for (const row of lowEng.slice(0, 3)) {
      const engRate = (row.dwellers / row.visitors) * 100;
      alerts.push({
        id: `low-eng-${row.id}`,
        type: 'low_engagement',
        severity: 'medium',
        title: 'LOW ENGAGEMENT',
        message: `${simplifyZoneName(row.name)}: ${Math.round(engRate)}% engagement (${row.dwellers}/${row.visitors} visitors)`,
        action: 'Review shelf positioning or signage',
        timestamp: now - 60000,
        zoneId: row.id,
      });
    }
  } catch (e) {}

  // 3. Bottleneck / friction zones
  try {
    const bottleneckAlerts = db.prepare(`
      SELECT 
        r.id, r.name,
        tp.samples, tp.avg_speed_sq,
        zo.avg_occ
      FROM regions_of_interest r
      JOIN (
        SELECT roi_id, COUNT(*) AS samples, AVG(velocity_x * velocity_x + velocity_z * velocity_z) AS avg_speed_sq
        FROM track_positions
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY roi_id
        HAVING samples >= 3
      ) tp ON tp.roi_id = r.id
      JOIN (
        SELECT roi_id, AVG(occupancy_count) AS avg_occ
        FROM zone_occupancy
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY roi_id
        HAVING avg_occ >= 3
      ) zo ON zo.roi_id = r.id
      WHERE r.venue_id = ? AND tp.avg_speed_sq < 0.09
      ORDER BY tp.avg_speed_sq ASC
      LIMIT 5
    `).all(now - 300000, now, now - 300000, now, venueId);

    for (const row of bottleneckAlerts) {
      const avgSpeed = Math.sqrt(row.avg_speed_sq || 0);
      alerts.push({
        id: `bottleneck-${row.id}`,
        type: 'bottleneck',
        severity: avgSpeed < 0.1 ? 'high' : 'medium',
        title: 'FRICTION ZONE',
        message: `${simplifyZoneName(row.name)}: slow flow (${avgSpeed.toFixed(2)} m/s), ${Math.round(row.avg_occ)} avg occupancy`,
        action: 'Check for obstruction or layout issue',
        timestamp: now - 120000,
        zoneId: row.id,
      });
    }
  } catch (e) {}

  // 4. Media ROI
  if (process.env.FEATURE_DOOH_ATTRIBUTION === 'true') {
    try {
      const campaigns = db.prepare(`
        SELECT id, name, screen_ids_json, target_json
        FROM dooh_campaigns 
        WHERE venue_id = ? AND enabled = 1
      `).all(venueId);

      for (const camp of campaigns) {
        const events = db.prepare(`
          SELECT 
            COUNT(*) AS total,
            SUM(converted) AS conversions,
            AVG(dci_value) AS avg_dci,
            AVG(confidence) AS avg_conf
          FROM dooh_attribution_events
          WHERE campaign_id = ? AND exposure_end_ts >= ?
        `).get(camp.id, lookback);

        if (events && events.total >= 3) {
          const convRate = (events.conversions / events.total) * 100;
          if (convRate < 30 || events.avg_dci < 0.3) {
            alerts.push({
              id: `media-roi-${camp.id}`,
              type: 'media_roi',
              severity: convRate < 15 ? 'high' : 'medium',
              title: 'MEDIA ROI LOW',
              message: `${camp.name}: ${Math.round(convRate)}% conversion, DCI ${(events.avg_dci || 0).toFixed(2)}`,
              action: 'Review creative or placement',
              timestamp: now - 180000,
            });
          }
        }
      }
    } catch (e) {}
  }

  alerts.sort((a, b) => {
    const sev = { high: 3, medium: 2, low: 1 };
    const sevDiff = (sev[b.severity] || 0) - (sev[a.severity] || 0);
    if (sevDiff !== 0) return sevDiff;
    return b.timestamp - a.timestamp;
  });

  // Enrich alerts with product categories from planogram data
  try {
    const sliced = alerts.slice(0, 15);
    const allZoneIds = new Set();
    for (const a of sliced) {
      if (a.zoneId) allZoneIds.add(a.zoneId);
      if (a.zoneIds) a.zoneIds.forEach(id => allZoneIds.add(id));
    }

    if (allZoneIds.size > 0) {
      const zoneCategoryMap = resolveZoneCategories(db, Array.from(allZoneIds));

      for (const a of sliced) {
        const ids = a.zoneIds || (a.zoneId ? [a.zoneId] : []);
        const cats = new Map();
        for (const zid of ids) {
          const info = zoneCategoryMap.get(zid);
          if (info) {
            for (const c of info.categories) {
              cats.set(c, (cats.get(c) || 0) + 1);
            }
            if (!a.shelfName && info.shelfName) a.shelfName = info.shelfName;
          }
        }
        if (cats.size > 0) {
          a.categories = Array.from(cats.keys()).sort((x, y) => cats.get(y) - cats.get(x));
        }
      }
    }

    return { alerts: sliced, count: alerts.length };
  } catch (e) {
    return { alerts: alerts.slice(0, 15), count: alerts.length };
  }
}

function resolveZoneCategories(db, zoneIds) {
  const result = new Map();
  if (zoneIds.length === 0) return result;

  const ph = zoneIds.map(() => '?').join(',');
  const rois = db.prepare(`SELECT id, name, metadata_json FROM regions_of_interest WHERE id IN (${ph})`).all(...zoneIds);

  const shelfLookupByName = db.prepare(
    `SELECT id, name FROM venue_objects WHERE venue_id = (SELECT venue_id FROM regions_of_interest WHERE id = ? LIMIT 1) AND type = 'shelf' AND name = ?`
  );

  for (const roi of rois) {
    let shelfId = null;
    let shelfName = null;

    if (roi.metadata_json) {
      try {
        const meta = JSON.parse(roi.metadata_json);
        if (meta.shelfId) shelfId = meta.shelfId;
      } catch {}
    }

    if (!shelfId && roi.name) {
      const match = roi.name.match(/^(.+?)\s*[-–]\s*Engagement/i);
      if (match) {
        const shelf = shelfLookupByName.get(roi.id, match[1].trim());
        if (shelf) { shelfId = shelf.id; shelfName = shelf.name; }
      }
      if (!shelfId) {
        const nameMatch = roi.name.match(/^(Shelf\s+\d+)/i);
        if (nameMatch) {
          const shelf = shelfLookupByName.get(roi.id, nameMatch[1].trim());
          if (shelf) { shelfId = shelf.id; shelfName = shelf.name; }
        }
      }
    }

    if (!shelfId) {
      result.set(roi.id, { shelfId: null, shelfName: null, categories: [] });
      continue;
    }

    if (!shelfName) {
      const s = db.prepare('SELECT name FROM venue_objects WHERE id = ?').get(shelfId);
      shelfName = s?.name || null;
    }

    const resolved = resolveShelfCategories(db, shelfId);
    result.set(roi.id, {
      shelfId,
      shelfName,
      categories: resolved.categories,
      categorySource: resolved.source,
      objectType: resolved.objectType,
      business_category: resolved.business_category,
    });
  }

  return result;
}

function computeMediaSummaryForRange(db, venueId, startTime, endTime) {
  let campaigns = [];
  try {
    campaigns = db.prepare(`
      SELECT id, name, screen_ids_json, target_json, enabled
      FROM dooh_campaigns
      WHERE venue_id = ?
      ORDER BY enabled DESC, created_at DESC
    `).all(venueId);
  } catch (e) {
    return { campaigns: [], totalUplift: 0, enabled: true, error: 'No campaigns table' };
  }

  const results = [];
  for (const camp of campaigns) {
    const screenIds = JSON.parse(camp.screen_ids_json || '[]');
    const target = JSON.parse(camp.target_json || '{}');
    let stats = { exposures: 0, conversions: 0, avgDci: 0, avgConf: 0, liftRel: null };
    try {
      const evRow = db.prepare(`
        SELECT 
          COUNT(*) AS exposures,
          SUM(converted) AS conversions,
          AVG(dci_value) AS avg_dci,
          AVG(confidence) AS avg_conf
        FROM dooh_attribution_events
        WHERE campaign_id = ? AND exposure_end_ts >= ? AND exposure_end_ts < ?
      `).get(camp.id, startTime, endTime);
      if (evRow && evRow.exposures > 0) {
        stats.exposures = evRow.exposures;
        stats.conversions = evRow.conversions || 0;
        stats.avgDci = evRow.avg_dci || 0;
        stats.avgConf = evRow.avg_conf || 0;
      }

      const kpiRow = db.prepare(`
        SELECT lift_rel, engagement_lift_s, ces_score, aar_score
        FROM dooh_campaign_kpis
        WHERE campaign_id = ? AND bucket_start_ts >= ?
        ORDER BY bucket_start_ts DESC LIMIT 1
      `).get(camp.id, startTime);
      if (kpiRow) {
        stats.liftRel = kpiRow.lift_rel;
      }
    } catch (e) {}

    const convRate = stats.exposures > 0 ? (stats.conversions / stats.exposures) * 100 : 0;
    results.push({
      id: camp.id,
      name: camp.name,
      screens: screenIds.length,
      targetType: target.type || 'unknown',
      isActive: camp.enabled === 1,
      exposures: stats.exposures,
      conversions: stats.conversions,
      conversionRate: parseFloat(convRate.toFixed(1)),
      avgDci: parseFloat((stats.avgDci || 0).toFixed(2)),
      avgConfidence: parseFloat((stats.avgConf || 0).toFixed(2)),
      liftRel: stats.liftRel != null ? parseFloat(stats.liftRel.toFixed(1)) : null,
      roi: convRate > 20 ? 'positive' : convRate > 5 ? 'neutral' : 'negative',
    });
  }

  const activeCampaigns = results.filter(r => r.isActive);
  const avgConvRate = activeCampaigns.length > 0
    ? parseFloat((activeCampaigns.reduce((s, r) => s + r.conversionRate, 0) / activeCampaigns.length).toFixed(1))
    : 0;

  return {
    campaigns: results,
    activeCampaigns: activeCampaigns.length,
    avgConversionRate: avgConvRate,
    totalExposures: results.reduce((s, r) => s + r.exposures, 0),
    enabled: true,
  };
}

function computeMediaSummary(db, venueId, range) {
  if (process.env.FEATURE_DOOH_ATTRIBUTION !== 'true') {
    return { campaigns: [], totalUplift: 0, enabled: false };
  }

  const { startTime, endTime } = resolveRange(range);
  const result = computeMediaSummaryForRange(db, venueId, startTime, endTime);

  if (result.error) return result;

  // If the requested range returned no exposures but campaigns exist,
  // fall back to all-time data so the dashboard isn't empty
  if (result.campaigns.length > 0 && result.totalExposures === 0 && range !== 'all') {
    const allTimeResult = computeMediaSummaryForRange(db, venueId, 0, endTime);
    if (allTimeResult.totalExposures > 0) {
      allTimeResult.dataRange = 'all';
      return allTimeResult;
    }
  }

  result.dataRange = range;
  return result;
}

function computeXRayZones(db, venueId) {
  const now = Date.now();
  const hour = now - 60 * 60 * 1000;

  let rois = [];
  try {
    rois = db.prepare(
      `SELECT id, name, metadata_json, vertices FROM regions_of_interest WHERE venue_id = ?`
    ).all(venueId);
  } catch (e) {
    return { zones: [], doohScreens: [] };
  }

  // Check if there's any zone_visits in the last hour; fall back to all-time if empty
  let sinceTs = hour;
  try {
    const recent = db.prepare(
      `SELECT COUNT(*) AS cnt FROM zone_visits WHERE venue_id = ? AND start_time >= ?`
    ).get(venueId, hour);
    if (!recent || recent.cnt === 0) {
      sinceTs = 0; // all-time fallback
    }
  } catch (e) {}

  const zones = [];

  for (const roi of rois) {
    let meta = {};
    try { meta = JSON.parse(roi.metadata_json || '{}'); } catch {}
    const template = meta.template || null;

    const position = computeCentroid(roi.vertices);

    let visits = 0, avgDwellSec = 0, dwells = 0, engagements = 0;
    try {
      const row = db.prepare(`
        SELECT
          COUNT(DISTINCT track_key) AS visits,
          AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) AS avg_ms,
          SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END) AS dwells,
          SUM(CASE WHEN is_engagement = 1 THEN 1 ELSE 0 END) AS engagements
        FROM zone_visits
        WHERE venue_id = ? AND roi_id = ? AND start_time >= ?
      `).get(venueId, roi.id, sinceTs);
      if (row) {
        visits = row.visits || 0;
        avgDwellSec = row.avg_ms ? parseFloat((row.avg_ms / 1000).toFixed(1)) : 0;
        dwells = row.dwells || 0;
        engagements = row.engagements || 0;
      }
    } catch (e) {}

    let peakOccupancy = 0;
    try {
      const occ = db.prepare(`
        SELECT MAX(occupancy_count) AS peak
        FROM zone_occupancy
        WHERE venue_id = ? AND roi_id = ? AND timestamp >= ?
      `).get(venueId, roi.id, sinceTs);
      peakOccupancy = occ?.peak || 0;
    } catch (e) {}

    const zone = {
      roiId: roi.id,
      name: roi.name,
      template,
      position,
      visits,
      avgDwellSec,
      dwells,
      engagements,
      peakOccupancy,
    };

    if (template === 'shelf-engagement') {
      const shelfId = meta.shelfId || null;
      zone.shelfId = shelfId;
      zone.categories = [];
      if (shelfId) {
        const resolved = resolveShelfCategories(db, shelfId);
        zone.categories = resolved.categories;
        zone.categorySource = resolved.source;
        if (resolved.objectType) zone.objectType = resolved.objectType;
        if (resolved.business_category) {
          zone.businessCategory = resolved.business_category.business_category_label;
        }
      }
      // Custom category zones store business_category directly on ROI metadata
      if (zone.categories.length === 0 && meta.business_category_label) {
        zone.categories = [meta.business_category_label];
        zone.categorySource = 'roi';
        zone.businessCategory = meta.business_category_label;
      }
    }

    if (template === 'cashier-queue') {
      let avgWaitMs = 0, queueDepth = 0;
      try {
        const wait = db.prepare(`
          SELECT AVG(duration_ms) AS avg_ms
          FROM zone_visits
          WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND duration_ms > 0
        `).get(venueId, roi.id, sinceTs);
        avgWaitMs = wait?.avg_ms ? Math.round(wait.avg_ms) : 0;
      } catch (e) {}
      try {
        const depth = db.prepare(`
          SELECT occupancy_count
          FROM zone_occupancy
          WHERE venue_id = ? AND roi_id = ?
          ORDER BY timestamp DESC LIMIT 1
        `).get(venueId, roi.id);
        queueDepth = depth?.occupancy_count || 0;
      } catch (e) {}
      zone.avgWaitMs = avgWaitMs;
      zone.queueDepth = queueDepth;
    }

    zones.push(zone);
  }

  let doohScreens = [];
  try {
    const screens = db.prepare(
      `SELECT id, name, position_json FROM dooh_screens WHERE venue_id = ? AND enabled = 1`
    ).all(venueId);

    // Build screen→campaign lookup via screen_ids_json
    const campaigns = db.prepare(
      `SELECT id, name, screen_ids_json FROM dooh_campaigns WHERE venue_id = ? AND enabled = 1`
    ).all(venueId);
    const screenCampMap = new Map(); // screenId → campaign
    for (const camp of campaigns) {
      try {
        const screenIds = JSON.parse(camp.screen_ids_json || '[]');
        for (const sid of screenIds) {
          if (!screenCampMap.has(sid)) screenCampMap.set(sid, camp);
        }
      } catch {}
    }

    for (const screen of screens) {
      let screenPos = { x: 0, z: 0 };
      try { const p = JSON.parse(screen.position_json || '{}'); screenPos = { x: p.x || 0, z: p.z || 0 }; } catch {}

      // Per-screen exposure stats from dooh_exposure_events
      let exposures = 0, avgAqs = 0;
      try {
        const stats = db.prepare(`
          SELECT COUNT(DISTINCT track_key) AS exp_count, AVG(aqs) AS avg_aqs
          FROM dooh_exposure_events WHERE venue_id = ? AND screen_id = ?
        `).get(venueId, screen.id);
        exposures = stats?.exp_count || 0;
        avgAqs = stats?.avg_aqs ? parseFloat(stats.avg_aqs.toFixed(1)) : 0;
      } catch {}

      // Campaign-level lift/conversion for this screen's campaign
      let campaignName = null, conversionRate = 0, liftRel = null, cesScore = null;
      const camp = screenCampMap.get(screen.id);
      if (camp) {
        campaignName = camp.name;
        try {
          const kpi = db.prepare(`
            SELECT p_exposed, lift_rel, ces_score
            FROM dooh_campaign_kpis
            WHERE venue_id = ? AND campaign_id = ?
            ORDER BY rowid DESC LIMIT 1
          `).get(venueId, camp.id);
          if (kpi) {
            conversionRate = kpi.p_exposed ? parseFloat((kpi.p_exposed * 100).toFixed(1)) : 0;
            liftRel = kpi.lift_rel != null ? parseFloat(kpi.lift_rel.toFixed(2)) : null;
            cesScore = kpi.ces_score != null ? parseFloat(kpi.ces_score.toFixed(1)) : null;
          }
        } catch {}
      }

      doohScreens.push({
        screenId: screen.id,
        name: screen.name,
        position: screenPos,
        campaignName,
        exposures,
        avgAqs,
        conversionRate,
        liftRel,
        cesScore,
      });
    }
  } catch (e) {}

  return { zones, doohScreens };
}

function computeCentroid(verticesJson) {
  try {
    const verts = JSON.parse(verticesJson || '[]');
    if (!verts.length) return { x: 0, z: 0 };
    const sum = verts.reduce((acc, v) => ({ x: acc.x + (v.x || 0), z: acc.z + (v.z || 0) }), { x: 0, z: 0 });
    return {
      x: parseFloat((sum.x / verts.length).toFixed(1)),
      z: parseFloat((sum.z / verts.length).toFixed(1)),
    };
  } catch {
    return { x: 0, z: 0 };
  }
}

// ============================================
// JOURNEY PATTERNS COMPUTATION
// ============================================

function computeJourneyPatterns(db, venueId, range) {
  const { startTime, endTime } = resolveRange(range);

  const visits = db.prepare(`
    SELECT zv.track_key, zv.roi_id, zv.start_time, zv.end_time, zv.is_dwell,
           r.name AS zone_name
    FROM zone_visits zv
    JOIN regions_of_interest r ON zv.roi_id = r.id
    WHERE zv.venue_id = ? AND zv.start_time >= ? AND zv.start_time < ?
      AND zv.is_dwell = 1
    ORDER BY zv.track_key, zv.start_time
  `).all(venueId, startTime, endTime);

  if (visits.length === 0) {
    return { totalTracks: 0, convertedTracks: 0, patterns: [], categoryFlow: { nodes: [], edges: [] } };
  }

  const rois = db.prepare(
    `SELECT id, name FROM regions_of_interest WHERE venue_id = ?`
  ).all(venueId);

  const roiIdSet = rois.map(r => r.id);
  const categoryMap = resolveZoneCategories(db, roiIdSet);
  const checkoutRois = new Set();
  const roiToCategory = new Map();

  for (const r of rois) {
    const nameLower = (r.name || '').toLowerCase();
    if (/checkout/i.test(r.name)) {
      checkoutRois.add(r.id);
      roiToCategory.set(r.id, 'Checkout');
    } else {
      const info = categoryMap.get(r.id);
      if (info && info.categories && info.categories.length > 0) {
        roiToCategory.set(r.id, info.categories[0]);
      } else if (nameLower.includes('shelf')) {
        roiToCategory.set(r.id, 'Other');
      } else if (nameLower.includes('entrance') || nameLower.includes('entry')) {
        roiToCategory.set(r.id, 'Entrance');
      } else {
        roiToCategory.set(r.id, 'Other');
      }
    }
  }

  // Build per-track journey sequences at category level
  const trackJourneys = new Map(); // track_key -> { categories: string[], dwellPerCat: Map, startTime, endTime, converted }

  let prevTrack = null;
  let currentJourney = null;

  for (const v of visits) {
    if (v.track_key !== prevTrack) {
      if (currentJourney) trackJourneys.set(prevTrack, currentJourney);
      currentJourney = {
        categories: ['Entrance'],
        dwellPerCat: new Map(),
        startTime: v.start_time,
        endTime: v.end_time || v.start_time,
        converted: false,
        lastCategory: null,
      };
      prevTrack = v.track_key;
    }

    const cat = roiToCategory.get(v.roi_id) || 'Other';
    if (checkoutRois.has(v.roi_id)) currentJourney.converted = true;

    // Only add category if different from last (deduplicate consecutive same-category visits)
    if (cat !== currentJourney.lastCategory) {
      currentJourney.categories.push(cat);
      currentJourney.lastCategory = cat;
    }

    const dwellMs = (v.end_time || v.start_time) - v.start_time;
    currentJourney.dwellPerCat.set(cat, (currentJourney.dwellPerCat.get(cat) || 0) + dwellMs);
    currentJourney.endTime = Math.max(currentJourney.endTime, v.end_time || v.start_time);
  }
  if (currentJourney) trackJourneys.set(prevTrack, currentJourney);

  // Classify each journey into an archetype
  const archetypes = new Map(); // type -> { tracks: [], ... }
  const TYPES = ['full-shop', 'category-specialist', 'browse-and-bail', 'quick-run'];
  for (const t of TYPES) archetypes.set(t, { type: t, tracks: [] });

  let totalTracks = 0;
  let convertedTracks = 0;

  for (const [trackKey, journey] of trackJourneys) {
    totalTracks++;
    if (journey.converted) convertedTracks++;

    const uniqueCats = new Set(journey.categories.filter(c => c !== 'Entrance' && c !== 'Checkout'));
    const catCount = uniqueCats.size;
    const totalDwellSec = [...journey.dwellPerCat.values()].reduce((s, v) => s + v, 0) / 1000;
    const durationSec = (journey.endTime - journey.startTime) / 1000;

    let type;
    if (catCount >= 4) {
      type = 'full-shop';
    } else if (catCount <= 2 && totalDwellSec > 5 && journey.converted) {
      type = 'category-specialist';
    } else if (!journey.converted && catCount >= 1) {
      type = 'browse-and-bail';
    } else {
      type = 'quick-run';
    }

    archetypes.get(type).tracks.push({
      trackKey,
      categories: journey.categories,
      dwellPerCat: journey.dwellPerCat,
      converted: journey.converted,
      durationSec,
      startTime: journey.startTime,
    });
  }

  // Build patterns response
  const LABELS = {
    'full-shop': 'Full Shop',
    'category-specialist': 'Category Specialist',
    'browse-and-bail': 'Browse & Bail',
    'quick-run': 'Quick Run',
  };

  const patterns = [];
  for (const [type, data] of archetypes) {
    if (data.tracks.length === 0) continue;
    const n = data.tracks.length;

    const convertedCount = data.tracks.filter(t => t.converted).length;
    const avgDurationSec = Math.round(data.tracks.reduce((s, t) => s + t.durationSec, 0) / n);

    // Category dwell aggregation
    const catDwellTotals = new Map();
    const catDwellCounts = new Map();
    for (const t of data.tracks) {
      for (const [cat, ms] of t.dwellPerCat) {
        if (cat === 'Entrance' || cat === 'Checkout') continue;
        catDwellTotals.set(cat, (catDwellTotals.get(cat) || 0) + ms / 1000);
        catDwellCounts.set(cat, (catDwellCounts.get(cat) || 0) + 1);
      }
    }
    const categoryDwell = [];
    for (const [cat, total] of catDwellTotals) {
      categoryDwell.push({ category: cat, avgSec: Math.round(total / (catDwellCounts.get(cat) || 1)) });
    }
    categoryDwell.sort((a, b) => b.avgSec - a.avgSec);

    // Most common category sequence (mode of first 5 categories)
    const seqCounts = new Map();
    for (const t of data.tracks) {
      const key = t.categories.slice(0, 7).join(' → ');
      seqCounts.set(key, (seqCounts.get(key) || 0) + 1);
    }
    let topSeq = '';
    let topSeqCount = 0;
    for (const [seq, count] of seqCounts) {
      if (count > topSeqCount) { topSeq = seq; topSeqCount = count; }
    }

    // Temporal distribution (24 hourly buckets)
    const hourly = new Array(24).fill(0);
    for (const t of data.tracks) {
      const hour = new Date(t.startTime).getHours();
      hourly[hour]++;
    }

    patterns.push({
      type,
      label: LABELS[type] || type,
      trackCount: n,
      conversionRate: n > 0 ? +(convertedCount / n).toFixed(2) : 0,
      avgDurationSec,
      categorySequence: topSeq.split(' → '),
      categoryDwell: categoryDwell.slice(0, 8),
      temporalDistribution: hourly,
    });
  }
  patterns.sort((a, b) => b.trackCount - a.trackCount);

  // Build category-level flow graph (all tracks, and per-pattern)
  const categoryFlow = buildCategoryFlow(trackJourneys, null);
  const patternFlows = {};
  for (const [type, data] of archetypes) {
    if (data.tracks.length === 0) continue;
    const subMap = new Map();
    for (const t of data.tracks) {
      subMap.set(t.trackKey, trackJourneys.get(t.trackKey));
    }
    patternFlows[type] = buildCategoryFlow(subMap, type);
  }

  return { totalTracks, convertedTracks, patterns, categoryFlow, patternFlows };
}

function buildCategoryFlow(trackJourneys, patternType) {
  const nodeCounts = new Map(); // category -> visitor count
  const edgeCounts = new Map(); // "from|to" -> count

  for (const [, journey] of trackJourneys) {
    if (!journey) continue;
    const cats = journey.categories;
    const visited = new Set();
    for (let i = 0; i < cats.length; i++) {
      if (!visited.has(cats[i])) {
        nodeCounts.set(cats[i], (nodeCounts.get(cats[i]) || 0) + 1);
        visited.add(cats[i]);
      }
      if (i > 0) {
        const key = `${cats[i - 1]}|${cats[i]}`;
        edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      }
    }
  }

  const nodes = [];
  for (const [name, count] of nodeCounts) {
    nodes.push({
      id: name,
      name,
      count,
      isEntrance: name === 'Entrance',
      isCheckout: name === 'Checkout',
    });
  }
  nodes.sort((a, b) => b.count - a.count);

  const edges = [];
  for (const [key, count] of edgeCounts) {
    const [from, to] = key.split('|');
    edges.push({ from, to, count });
  }
  edges.sort((a, b) => b.count - a.count);

  return { nodes, edges: edges.slice(0, 30) };
}

// ============================================
// HELPERS
// ============================================

function resolveRange(range) {
  const now = Date.now();
  let startTime;
  switch (range) {
    case 'all': startTime = 0; break;
    case '30d': startTime = now - 30 * 24 * 60 * 60 * 1000; break;
    case '7d': startTime = now - 7 * 24 * 60 * 60 * 1000; break;
    case '24h': startTime = now - 24 * 60 * 60 * 1000; break;
    case '1h':
    default: startTime = now - 60 * 60 * 1000; break;
  }
  return { startTime, endTime: now };
}

function simplifyZoneName(name) {
  if (!name) return '';
  // "Shelf 3 – Engagement Zone" → "Shelf 3"
  // "Checkout 1 – Queue Zone" → "Checkout 1"
  return name.replace(/\s*[–—-]\s*(Engagement|Queue|Service|Dwell|Traffic)\s*(Zone|Area)?\s*/gi, '').trim();
}
