/**
 * Neural Dashboard API Routes
 * 
 * Provides data for the Neural Dashboard panels:
 * - GET /api/neural/funnel          — Engagement funnel stages
 * - GET /api/neural/transitions     — Zone-to-zone transition matrix (Sankey)
 * - GET /api/neural/alerts          — Real-time behavioral alerts
 * - GET /api/neural/media-summary   — Compact DOOH campaign KPIs
 */

import { Router } from 'express';

// In-memory response cache — prevents heavy SQLite queries from blocking the event loop
// on every poll. Each key = "endpoint:venueId:range", value = { data, expiry }
const responseCache = new Map();

function cached(key, ttlMs, computeFn) {
  const entry = responseCache.get(key);
  if (entry && Date.now() < entry.expiry) {
    return entry.data;
  }
  const data = computeFn();
  responseCache.set(key, { data, expiry: Date.now() + ttlMs });
  // Prevent unbounded growth
  if (responseCache.size > 200) {
    const oldest = responseCache.keys().next().value;
    responseCache.delete(oldest);
  }
  return data;
}

export default function createNeuralRoutes(db) {
  const router = Router();

  // ============================================
  // ENGAGEMENT FUNNEL
  // ============================================

  /**
   * GET /api/neural/funnel?venueId=X&range=1h|24h|7d
   * 
   * Stages:
   *   ENTRY    — unique visitors (distinct track_key)
   *   SHOP     — visited ≥1 shelf zone (zone name contains 'shelf')
   *   ENGAGE   — dwelled at any shelf zone (is_dwell=1)
   *   BASKET   — engaged at 3+ different shelf zones
   *   CHECKOUT — entered a checkout zone
   */
  router.get('/funnel', (req, res) => {
    try {
      const { venueId, range } = req.query;
      if (!venueId) return res.status(400).json({ error: 'venueId required' });

      const result = cached(`funnel:${venueId}:${range}`, 5000, () => {
        const { startTime, endTime } = resolveRange(range);

        const rois = db.prepare(
          `SELECT id, name FROM regions_of_interest WHERE venue_id = ?`
        ).all(venueId);

        const shelfRoiIds = rois
          .filter(r => /shelf|gondola|aisle|product|display/i.test(r.name) && !/checkout|queue|entrance|exit/i.test(r.name))
          .map(r => r.id);
        const checkoutRoiIds = rois
          .filter(r => /checkout|register|cashier|queue/i.test(r.name))
          .map(r => r.id);

        const entryRow = db.prepare(`
          SELECT COUNT(DISTINCT track_key) AS cnt
          FROM zone_visits
          WHERE venue_id = ? AND start_time >= ? AND start_time < ?
        `).get(venueId, startTime, endTime);
        const entry = entryRow?.cnt || 0;

        let shop = 0, engage = 0, basket = 0, checkout = 0;

        if (shelfRoiIds.length > 0) {
          const shelfPlaceholders = shelfRoiIds.map(() => '?').join(',');

          const shopRow = db.prepare(`
            SELECT COUNT(DISTINCT track_key) AS cnt
            FROM zone_visits
            WHERE venue_id = ? AND roi_id IN (${shelfPlaceholders})
              AND start_time >= ? AND start_time < ?
          `).get(venueId, ...shelfRoiIds, startTime, endTime);
          shop = shopRow?.cnt || 0;

          const engageRow = db.prepare(`
            SELECT COUNT(DISTINCT track_key) AS cnt
            FROM zone_visits
            WHERE venue_id = ? AND roi_id IN (${shelfPlaceholders})
              AND is_dwell = 1
              AND start_time >= ? AND start_time < ?
          `).get(venueId, ...shelfRoiIds, startTime, endTime);
          engage = engageRow?.cnt || 0;

          const basketRows = db.prepare(`
            SELECT track_key, COUNT(DISTINCT roi_id) AS zone_count
            FROM zone_visits
            WHERE venue_id = ? AND roi_id IN (${shelfPlaceholders})
              AND is_dwell = 1
              AND start_time >= ? AND start_time < ?
            GROUP BY track_key
            HAVING zone_count >= 3
          `).all(venueId, ...shelfRoiIds, startTime, endTime);
          basket = basketRows.length;
        }

        if (checkoutRoiIds.length > 0) {
          const checkoutPlaceholders = checkoutRoiIds.map(() => '?').join(',');
          const checkoutRow = db.prepare(`
            SELECT COUNT(DISTINCT track_key) AS cnt
            FROM zone_visits
            WHERE venue_id = ? AND roi_id IN (${checkoutPlaceholders})
              AND start_time >= ? AND start_time < ?
          `).get(venueId, ...checkoutRoiIds, startTime, endTime);
          checkout = checkoutRow?.cnt || 0;
        }

        const stages = [
          { id: 'entry', label: 'ENTRY', count: entry },
          { id: 'shop', label: 'SHOP', count: shop },
          { id: 'engage', label: 'ENGAGE', count: engage },
          { id: 'basket', label: 'BASKET', count: basket },
          { id: 'checkout', label: 'CHECKOUT', count: checkout },
        ];

        for (let i = 1; i < stages.length; i++) {
          const prev = stages[i - 1].count;
          stages[i].dropPct = prev > 0 ? Math.round((1 - stages[i].count / prev) * 100) : 0;
          stages[i].pctOfEntry = entry > 0 ? Math.round((stages[i].count / entry) * 100) : 0;
        }
        stages[0].dropPct = 0;
        stages[0].pctOfEntry = 100;

        let biggestLeak = null;
        let maxDrop = 0;
        for (let i = 1; i < stages.length; i++) {
          if (stages[i].dropPct > maxDrop && stages[i - 1].count > 0) {
            maxDrop = stages[i].dropPct;
            biggestLeak = {
              from: stages[i - 1].label,
              to: stages[i].label,
              dropPct: stages[i].dropPct,
              lost: stages[i - 1].count - stages[i].count,
            };
          }
        }

        return { stages, biggestLeak, range, venueId };
      });

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

      const result = cached(`transitions:${venueId}:${range}`, 15000, () => {
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

      res.json(result);
    } catch (err) {
      console.error('[Neural] transitions error:', err.message);
      res.status(500).json({ error: 'Failed to compute transitions' });
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

      const maxAlerts = parseInt(limit) || 20;

      const result = cached(`alerts:${venueId}`, 5000, () => {
        const now = Date.now();
        const lookback = now - 60 * 60 * 1000;
        const alerts = [];

        // 1. Queue buildup
        try {
          const queueAlerts = db.prepare(`
            SELECT r.id, r.name, zo.occupancy_count
            FROM regions_of_interest r
            JOIN (
              SELECT roi_id, occupancy_count, MAX(timestamp) as max_ts
              FROM zone_occupancy
              WHERE timestamp > ?
              GROUP BY roi_id
            ) zo ON zo.roi_id = r.id
            WHERE r.venue_id = ? 
              AND (r.name LIKE '%checkout%' OR r.name LIKE '%queue%')
              AND zo.occupancy_count >= 2
            ORDER BY zo.occupancy_count DESC
            LIMIT 10
          `).all(now - 60000, venueId);

          for (const row of queueAlerts) {
            alerts.push({
              id: `queue-${row.id}`,
              type: 'queue_risk',
              severity: row.occupancy_count >= 5 ? 'high' : row.occupancy_count >= 3 ? 'medium' : 'low',
              title: 'QUEUE BUILDUP',
              message: `${simplifyZoneName(row.name)}: ${row.occupancy_count} people waiting`,
              action: 'Open additional register',
              timestamp: now,
              zoneId: row.id,
            });
          }
        } catch (e) { /* table may not exist */ }

        // 2. Low engagement zones
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
            HAVING visitors >= 2 AND (dwellers * 100.0 / visitors) < 30
            ORDER BY (dwellers * 100.0 / visitors) ASC
            LIMIT 10
          `).all(venueId, lookback, now);

          for (const row of lowEngAlerts) {
            const engRate = row.dwellers > 0 ? (row.dwellers / row.visitors) * 100 : 0;
            alerts.push({
              id: `low-eng-${row.id}`,
              type: 'low_engagement',
              severity: engRate < 10 ? 'high' : 'medium',
              title: 'LOW ENGAGEMENT',
              message: `${simplifyZoneName(row.name)}: ${Math.round(engRate)}% engagement (${row.dwellers}/${row.visitors})`,
              action: 'Review shelf positioning or signage',
              timestamp: now - 60000,
              zoneId: row.id,
            });
          }
        } catch (e) { /* table may not exist */ }

        // 3. Bottleneck
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
              HAVING avg_occ >= 2
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
        } catch (e) { /* table may not exist */ }

        // 4. Media ROI alerts
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
          } catch (e) { /* DOOH tables might not exist */ }
        }

        alerts.sort((a, b) => b.timestamp - a.timestamp);
        return { alerts, count: alerts.length };
      });

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

      if (process.env.FEATURE_DOOH_ATTRIBUTION !== 'true') {
        return res.json({ campaigns: [], totalUplift: 0, enabled: false });
      }

      const result = cached(`media-summary:${venueId}:${range}`, 30000, () => {
        const { startTime, endTime } = resolveRange(range);

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
            conversionRate: Math.round(convRate),
            avgDci: parseFloat((stats.avgDci || 0).toFixed(2)),
            avgConfidence: parseFloat((stats.avgConf || 0).toFixed(2)),
            liftRel: stats.liftRel != null ? parseFloat(stats.liftRel.toFixed(1)) : null,
            roi: convRate > 20 ? 'positive' : convRate > 5 ? 'neutral' : 'negative',
          });
        }

        const activeCampaigns = results.filter(r => r.isActive);
        const avgConvRate = activeCampaigns.length > 0
          ? Math.round(activeCampaigns.reduce((s, r) => s + r.conversionRate, 0) / activeCampaigns.length)
          : 0;

        return {
          campaigns: results,
          activeCampaigns: activeCampaigns.length,
          avgConversionRate: avgConvRate,
          totalExposures: results.reduce((s, r) => s + r.exposures, 0),
          enabled: true,
        };
      });

      res.json(result);
    } catch (err) {
      console.error('[Neural] media-summary error:', err.message);
      res.status(500).json({ error: 'Failed to compute media summary' });
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

      const result = cached(`venue-kpis:${venueId}`, 5000, () => {
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

      const batchResult = cached(`batch:${venueId}:${range}`, 5000, () => {
        // Reuse individual cached computations — each has its own TTL
        // so sub-queries only run when their specific cache expires
        const venueKpisKey = `venue-kpis:${venueId}`;
        const funnelKey = `funnel:${venueId}:${range}`;
        const alertsKey = `alerts:${venueId}`;
        const mediaKey = `media-summary:${venueId}:${range}`;

        return {
          venueKpis: cached(venueKpisKey, 5000, () => computeVenueKpis(db, venueId)),
          funnel: cached(funnelKey, 5000, () => computeFunnel(db, venueId, range)),
          alerts: cached(alertsKey, 5000, () => computeAlerts(db, venueId)),
          mediaSummary: cached(mediaKey, 30000, () => computeMediaSummary(db, venueId, range)),
        };
      });

      res.json(batchResult);
    } catch (err) {
      console.error('[Neural] batch error:', err.message);
      res.status(500).json({ error: 'Failed to compute batch' });
    }
  });

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

function computeFunnel(db, venueId, range) {
  const { startTime, endTime } = resolveRange(range);

  const rois = db.prepare(
    `SELECT id, name FROM regions_of_interest WHERE venue_id = ?`
  ).all(venueId);

  const shelfRoiIds = rois
    .filter(r => /shelf|gondola|aisle|product|display/i.test(r.name) && !/checkout|queue|entrance|exit/i.test(r.name))
    .map(r => r.id);
  const checkoutRoiIds = rois
    .filter(r => /checkout|register|cashier|queue/i.test(r.name))
    .map(r => r.id);

  const entryRow = db.prepare(`
    SELECT COUNT(DISTINCT track_key) AS cnt
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
  `).get(venueId, startTime, endTime);
  const entry = entryRow?.cnt || 0;

  let shop = 0, engage = 0, basket = 0, checkout = 0;

  if (shelfRoiIds.length > 0) {
    const shelfPlaceholders = shelfRoiIds.map(() => '?').join(',');
    const shopRow = db.prepare(`
      SELECT COUNT(DISTINCT track_key) AS cnt
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${shelfPlaceholders})
        AND start_time >= ? AND start_time < ?
    `).get(venueId, ...shelfRoiIds, startTime, endTime);
    shop = shopRow?.cnt || 0;

    const engageRow = db.prepare(`
      SELECT COUNT(DISTINCT track_key) AS cnt
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${shelfPlaceholders})
        AND is_dwell = 1
        AND start_time >= ? AND start_time < ?
    `).get(venueId, ...shelfRoiIds, startTime, endTime);
    engage = engageRow?.cnt || 0;

    const basketRows = db.prepare(`
      SELECT track_key, COUNT(DISTINCT roi_id) AS zone_count
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${shelfPlaceholders})
        AND is_dwell = 1
        AND start_time >= ? AND start_time < ?
      GROUP BY track_key
      HAVING zone_count >= 3
    `).all(venueId, ...shelfRoiIds, startTime, endTime);
    basket = basketRows.length;
  }

  if (checkoutRoiIds.length > 0) {
    const checkoutPlaceholders = checkoutRoiIds.map(() => '?').join(',');
    const checkoutRow = db.prepare(`
      SELECT COUNT(DISTINCT track_key) AS cnt
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${checkoutPlaceholders})
        AND start_time >= ? AND start_time < ?
    `).get(venueId, ...checkoutRoiIds, startTime, endTime);
    checkout = checkoutRow?.cnt || 0;
  }

  const stages = [
    { id: 'entry', label: 'ENTRY', count: entry },
    { id: 'shop', label: 'SHOP', count: shop },
    { id: 'engage', label: 'ENGAGE', count: engage },
    { id: 'basket', label: 'BASKET', count: basket },
    { id: 'checkout', label: 'CHECKOUT', count: checkout },
  ];

  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].count;
    stages[i].dropPct = prev > 0 ? Math.round((1 - stages[i].count / prev) * 100) : 0;
    stages[i].pctOfEntry = entry > 0 ? Math.round((stages[i].count / entry) * 100) : 0;
  }
  stages[0].dropPct = 0;
  stages[0].pctOfEntry = 100;

  let biggestLeak = null;
  let maxDrop = 0;
  for (let i = 1; i < stages.length; i++) {
    if (stages[i].dropPct > maxDrop && stages[i - 1].count > 0) {
      maxDrop = stages[i].dropPct;
      biggestLeak = {
        from: stages[i - 1].label,
        to: stages[i].label,
        dropPct: stages[i].dropPct,
        lost: stages[i - 1].count - stages[i].count,
      };
    }
  }

  return { stages, biggestLeak, range, venueId };
}

function computeAlerts(db, venueId) {
  const now = Date.now();
  const lookback = now - 60 * 60 * 1000;
  const alerts = [];

  try {
    const queueAlerts = db.prepare(`
      SELECT r.id, r.name, zo.occupancy_count
      FROM regions_of_interest r
      JOIN (
        SELECT roi_id, occupancy_count, MAX(timestamp) as max_ts
        FROM zone_occupancy
        WHERE timestamp > ?
        GROUP BY roi_id
      ) zo ON zo.roi_id = r.id
      WHERE r.venue_id = ? 
        AND (r.name LIKE '%checkout%' OR r.name LIKE '%queue%')
        AND zo.occupancy_count >= 2
      ORDER BY zo.occupancy_count DESC
      LIMIT 10
    `).all(now - 60000, venueId);

    for (const row of queueAlerts) {
      alerts.push({
        id: `queue-${row.id}`,
        type: 'queue_risk',
        severity: row.occupancy_count >= 5 ? 'high' : row.occupancy_count >= 3 ? 'medium' : 'low',
        title: 'QUEUE BUILDUP',
        message: `${simplifyZoneName(row.name)}: ${row.occupancy_count} people waiting`,
        action: 'Open additional register',
        timestamp: now,
        zoneId: row.id,
      });
    }
  } catch (e) {}

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
      HAVING visitors >= 2 AND (dwellers * 100.0 / visitors) < 30
      ORDER BY (dwellers * 100.0 / visitors) ASC
      LIMIT 10
    `).all(venueId, lookback, now);

    for (const row of lowEngAlerts) {
      const engRate = row.dwellers > 0 ? (row.dwellers / row.visitors) * 100 : 0;
      alerts.push({
        id: `low-eng-${row.id}`,
        type: 'low_engagement',
        severity: engRate < 10 ? 'high' : 'medium',
        title: 'LOW ENGAGEMENT',
        message: `${simplifyZoneName(row.name)}: ${Math.round(engRate)}% engagement (${row.dwellers}/${row.visitors})`,
        action: 'Review shelf positioning or signage',
        timestamp: now - 60000,
        zoneId: row.id,
      });
    }
  } catch (e) {}

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
        HAVING avg_occ >= 2
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

  alerts.sort((a, b) => b.timestamp - a.timestamp);
  return { alerts, count: alerts.length };
}

function computeMediaSummary(db, venueId, range) {
  if (process.env.FEATURE_DOOH_ATTRIBUTION !== 'true') {
    return { campaigns: [], totalUplift: 0, enabled: false };
  }

  const { startTime, endTime } = resolveRange(range);

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
      conversionRate: Math.round(convRate),
      avgDci: parseFloat((stats.avgDci || 0).toFixed(2)),
      avgConfidence: parseFloat((stats.avgConf || 0).toFixed(2)),
      liftRel: stats.liftRel != null ? parseFloat(stats.liftRel.toFixed(1)) : null,
      roi: convRate > 20 ? 'positive' : convRate > 5 ? 'neutral' : 'negative',
    });
  }

  const activeCampaigns = results.filter(r => r.isActive);
  const avgConvRate = activeCampaigns.length > 0
    ? Math.round(activeCampaigns.reduce((s, r) => s + r.conversionRate, 0) / activeCampaigns.length)
    : 0;

  return {
    campaigns: results,
    activeCampaigns: activeCampaigns.length,
    avgConversionRate: avgConvRate,
    totalExposures: results.reduce((s, r) => s + r.exposures, 0),
    enabled: true,
  };
}

// ============================================
// HELPERS
// ============================================

function resolveRange(range) {
  const now = Date.now();
  let startTime;
  switch (range) {
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
