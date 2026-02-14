import { Router } from 'express';
import { ShelfKPIEnricher } from '../services/ShelfKPIEnricher.js';
import { shelfPlanogramQueries, planogramQueries } from '../database/schema.js';

export default function createKpiRoutes(db, kpiCalculator, trajectoryStorage) {
  // Initialize shelf KPI enricher
  const shelfKPIEnricher = new ShelfKPIEnricher(db);
  const router = Router();

  /**
   * Get current KPI settings
   */
  router.get('/kpi/settings', (req, res) => {
    try {
      const settings = {
        dwellThresholdSec: trajectoryStorage.DWELL_THRESHOLD_MS / 1000,
        engagementThresholdSec: trajectoryStorage.ENGAGEMENT_THRESHOLD_MS / 1000,
        visitEndGraceSec: trajectoryStorage.VISIT_END_GRACE_MS / 1000,
        minVisitDurationSec: trajectoryStorage.MIN_VISIT_DURATION_MS / 1000,
        positionSampleMs: trajectoryStorage.POSITION_SAMPLE_MS,
      };
      res.json(settings);
    } catch (err) {
      console.error('Failed to get KPI settings:', err);
      res.status(500).json({ error: 'Failed to get KPI settings' });
    }
  });

  /**
   * Update KPI settings
   */
  router.put('/kpi/settings', (req, res) => {
    try {
      const { 
        dwellThresholdSec, 
        engagementThresholdSec, 
        visitEndGraceSec, 
        minVisitDurationSec,
        positionSampleMs 
      } = req.body;

      // Update trajectory storage settings
      if (dwellThresholdSec !== undefined) {
        trajectoryStorage.DWELL_THRESHOLD_MS = dwellThresholdSec * 1000;
        kpiCalculator.DWELL_THRESHOLD_MS = dwellThresholdSec * 1000;
      }
      if (engagementThresholdSec !== undefined) {
        trajectoryStorage.ENGAGEMENT_THRESHOLD_MS = engagementThresholdSec * 1000;
        kpiCalculator.ENGAGEMENT_THRESHOLD_MS = engagementThresholdSec * 1000;
      }
      if (visitEndGraceSec !== undefined) {
        trajectoryStorage.VISIT_END_GRACE_MS = visitEndGraceSec * 1000;
      }
      if (minVisitDurationSec !== undefined) {
        trajectoryStorage.MIN_VISIT_DURATION_MS = minVisitDurationSec * 1000;
      }
      if (positionSampleMs !== undefined) {
        trajectoryStorage.POSITION_SAMPLE_MS = positionSampleMs;
      }

      console.log('📊 KPI settings updated:', req.body);

      res.json({ 
        success: true, 
        settings: {
          dwellThresholdSec: trajectoryStorage.DWELL_THRESHOLD_MS / 1000,
          engagementThresholdSec: trajectoryStorage.ENGAGEMENT_THRESHOLD_MS / 1000,
          visitEndGraceSec: trajectoryStorage.VISIT_END_GRACE_MS / 1000,
          minVisitDurationSec: trajectoryStorage.MIN_VISIT_DURATION_MS / 1000,
          positionSampleMs: trajectoryStorage.POSITION_SAMPLE_MS,
        }
      });
    } catch (err) {
      console.error('Failed to update KPI settings:', err);
      res.status(500).json({ error: 'Failed to update KPI settings' });
    }
  });

  /**
   * Get KPIs for a specific zone/ROI
   * Query params: startTime, endTime (unix timestamps in ms)
   */
  router.get('/roi/:roiId/kpis', (req, res) => {
    try {
      const { roiId } = req.params;
      const { startTime, endTime, period } = req.query;
      
      // Default to last 24 hours if not specified
      const now = Date.now();
      let start = startTime ? parseInt(startTime) : now - 24 * 60 * 60 * 1000;
      let end = endTime ? parseInt(endTime) : now;
      
      // Handle period shortcuts
      if (period) {
        switch (period) {
          case 'hour':
            start = now - 60 * 60 * 1000;
            break;
          case 'day':
            start = now - 24 * 60 * 60 * 1000;
            break;
          case 'week':
            start = now - 7 * 24 * 60 * 60 * 1000;
            break;
          case 'month':
            start = now - 30 * 24 * 60 * 60 * 1000;
            break;
        }
        end = now;
      }
      
      const kpis = kpiCalculator.getZoneKPIs(roiId, start, end);
      
      res.json({
        roiId,
        startTime: start,
        endTime: end,
        kpis,
      });
    } catch (err) {
      console.error('Failed to get zone KPIs:', err);
      res.status(500).json({ error: 'Failed to get zone KPIs' });
    }
  });

  /**
   * Get KPIs for all zones in a venue
   */
  router.get('/venues/:venueId/kpis', (req, res) => {
    try {
      const { venueId } = req.params;
      const { startTime, endTime, period } = req.query;
      
      const now = Date.now();
      let start = startTime ? parseInt(startTime) : now - 24 * 60 * 60 * 1000;
      let end = endTime ? parseInt(endTime) : now;
      
      if (period) {
        switch (period) {
          case 'hour':
            start = now - 60 * 60 * 1000;
            break;
          case 'day':
            start = now - 24 * 60 * 60 * 1000;
            break;
          case 'week':
            start = now - 7 * 24 * 60 * 60 * 1000;
            break;
          case 'month':
            start = now - 30 * 24 * 60 * 60 * 1000;
            break;
        }
        end = now;
      }
      
      // Get all ROIs for venue
      const rois = db.prepare(`SELECT id, name, color FROM regions_of_interest WHERE venue_id = ?`).all(venueId);
      
      const results = rois.map(roi => ({
        roiId: roi.id,
        roiName: roi.name,
        roiColor: roi.color,
        kpis: kpiCalculator.getZoneKPIs(roi.id, start, end),
      }));
      
      res.json({
        venueId,
        startTime: start,
        endTime: end,
        zones: results,
      });
    } catch (err) {
      console.error('Failed to get venue KPIs:', err);
      res.status(500).json({ error: 'Failed to get venue KPIs' });
    }
  });

  /**
   * Get zone comparison data
   */
  router.post('/kpis/compare', (req, res) => {
    try {
      const { roiIds, startTime, endTime } = req.body;
      
      if (!roiIds || !Array.isArray(roiIds) || roiIds.length === 0) {
        return res.status(400).json({ error: 'roiIds array required' });
      }
      
      const now = Date.now();
      const start = startTime || now - 24 * 60 * 60 * 1000;
      const end = endTime || now;
      
      const comparison = kpiCalculator.getZoneComparison(roiIds, start, end);
      
      res.json({
        startTime: start,
        endTime: end,
        comparison,
      });
    } catch (err) {
      console.error('Failed to compare zones:', err);
      res.status(500).json({ error: 'Failed to compare zones' });
    }
  });

  /**
   * Get real-time KPIs for live dashboard
   */
  router.get('/venues/:venueId/kpis/realtime', (req, res) => {
    try {
      const { venueId } = req.params;
      const realTimeData = kpiCalculator.getRealTimeKPIs(venueId);
      
      res.json({
        venueId,
        timestamp: Date.now(),
        zones: realTimeData,
      });
    } catch (err) {
      console.error('Failed to get real-time KPIs:', err);
      res.status(500).json({ error: 'Failed to get real-time KPIs' });
    }
  });

  /**
   * Get current live occupancy for a specific zone
   */
  router.get('/roi/:roiId/occupancy/live', (req, res) => {
    try {
      const { roiId } = req.params;
      const now = Date.now();
      
      // Get most recent occupancy (last 10 seconds to ensure we catch data)
      const result = db.prepare(`
        SELECT occupancy_count, timestamp
        FROM zone_occupancy
        WHERE roi_id = ? AND timestamp > ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(roiId, now - 10000);
      
      res.json({
        roiId,
        timestamp: now,
        currentOccupancy: result?.occupancy_count ?? 0,
        lastUpdate: result?.timestamp || null,
        dataAge: result?.timestamp ? now - result.timestamp : null,
      });
    } catch (err) {
      console.error('Failed to get live occupancy:', err);
      res.status(500).json({ error: 'Failed to get live occupancy' });
    }
  });

  /**
   * Get daily summary for a venue
   */
  router.get('/venues/:venueId/kpis/daily', (req, res) => {
    try {
      const { venueId } = req.params;
      const { date } = req.query;
      
      const targetDate = date || new Date().toISOString().split('T')[0];
      const summary = kpiCalculator.getDailySummary(venueId, targetDate);
      
      res.json({
        venueId,
        date: targetDate,
        zones: summary,
      });
    } catch (err) {
      console.error('Failed to get daily summary:', err);
      res.status(500).json({ error: 'Failed to get daily summary' });
    }
  });

  /**
   * Get time series data for charts
   */
  router.get('/roi/:roiId/kpis/timeseries', (req, res) => {
    try {
      const { roiId } = req.params;
      const { metric, startTime, endTime, interval } = req.query;
      
      const now = Date.now();
      const start = startTime ? parseInt(startTime) : now - 24 * 60 * 60 * 1000;
      const end = endTime ? parseInt(endTime) : now;
      
      let data;
      switch (metric) {
        case 'visits':
          data = kpiCalculator.getVisitsByHour(roiId, start, end);
          break;
        case 'occupancy':
          data = kpiCalculator.getOccupancyOverTime(roiId, start, end);
          break;
        case 'dwell':
          data = kpiCalculator.getDwellDistribution(roiId, start, end);
          break;
        default:
          // Return all time series data
          data = {
            visitsByHour: kpiCalculator.getVisitsByHour(roiId, start, end),
            occupancyOverTime: kpiCalculator.getOccupancyOverTime(roiId, start, end),
            dwellDistribution: kpiCalculator.getDwellDistribution(roiId, start, end),
          };
      }
      
      res.json({
        roiId,
        startTime: start,
        endTime: end,
        metric: metric || 'all',
        data,
      });
    } catch (err) {
      console.error('Failed to get time series data:', err);
      res.status(500).json({ error: 'Failed to get time series data' });
    }
  });

  /**
   * Get timeline data for replay with KPI values per time slot
   */
  router.get('/venues/:venueId/timeline', (req, res) => {
    try {
      const { venueId } = req.params;
      const { start, end, interval = 15, roiId } = req.query;
      
      const startTime = parseInt(start) || Date.now() - 24 * 60 * 60 * 1000;
      const endTime = parseInt(end) || Date.now();
      const intervalMins = parseInt(interval);
      
      // Generate time slots
      const slots = [];
      const slotDuration = intervalMins * 60 * 1000;
      
      for (let ts = startTime; ts < endTime; ts += slotDuration) {
        const slotEnd = ts + slotDuration;
        const date = new Date(ts);
        
        // Get occupancy for this slot (filter by zone if specified)
        let occupancy;
        if (roiId) {
          occupancy = db.prepare(`
            SELECT AVG(occupancy_count) as avg_occupancy, MAX(occupancy_count) as peak
            FROM zone_occupancy
            WHERE venue_id = ? AND roi_id = ? AND timestamp >= ? AND timestamp < ?
          `).get(venueId, roiId, ts, slotEnd);
        } else {
          occupancy = db.prepare(`
            SELECT AVG(occupancy_count) as avg_occupancy, MAX(occupancy_count) as peak
            FROM zone_occupancy
            WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
          `).get(venueId, ts, slotEnd);
        }
        
        // Get visits for this slot
        let visits;
        if (roiId) {
          visits = db.prepare(`
            SELECT COUNT(*) as count
            FROM zone_visits
            WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND start_time < ?
          `).get(venueId, roiId, ts, slotEnd);
        } else {
          visits = db.prepare(`
            SELECT COUNT(*) as count
            FROM zone_visits
            WHERE venue_id = ? AND start_time >= ? AND start_time < ?
          `).get(venueId, ts, slotEnd);
        }
        
        // Get dwells for this slot
        let dwells;
        if (roiId) {
          dwells = db.prepare(`
            SELECT COUNT(*) as count
            FROM zone_visits
            WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND start_time < ? AND is_dwell = 1
          `).get(venueId, roiId, ts, slotEnd);
        } else {
          dwells = db.prepare(`
            SELECT COUNT(*) as count
            FROM zone_visits
            WHERE venue_id = ? AND start_time >= ? AND start_time < ? AND is_dwell = 1
          `).get(venueId, ts, slotEnd);
        }
        
        // Get engagements for this slot
        let engagements;
        if (roiId) {
          engagements = db.prepare(`
            SELECT COUNT(*) as count
            FROM zone_visits
            WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND start_time < ? AND is_engagement = 1
          `).get(venueId, roiId, ts, slotEnd);
        } else {
          engagements = db.prepare(`
            SELECT COUNT(*) as count
            FROM zone_visits
            WHERE venue_id = ? AND start_time >= ? AND start_time < ? AND is_engagement = 1
          `).get(venueId, ts, slotEnd);
        }
        
        slots.push({
          timestamp: ts,
          time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          date: date.toLocaleDateString(),
          occupancy: Math.round(occupancy?.avg_occupancy || 0),
          peakOccupancy: occupancy?.peak || 0,
          visits: visits?.count || 0,
          dwells: dwells?.count || 0,
          engagements: engagements?.count || 0,
          // For the frontend, map to kpi1Value and kpi2Value
          kpi1Value: Math.round(occupancy?.avg_occupancy || 0),
          kpi2Value: visits?.count || 0,
        });
      }
      
      res.json({ slots, startTime, endTime, interval: intervalMins });
    } catch (err) {
      console.error('Failed to get timeline data:', err);
      res.status(500).json({ error: 'Failed to get timeline data' });
    }
  });

  /**
   * Get heatmap data aggregated by tile for a venue
   * Query params:
   * - timeframe: 'day' | 'week' | 'month' (default: 'day')
   * - tileSize: size of each tile in meters (default: venue's tile_size)
   */
  router.get('/venues/:venueId/heatmap', (req, res) => {
    try {
      const { venueId } = req.params;
      const { timeframe = 'day', tileSize: tileSizeParam } = req.query;
      
      // Get venue info for dimensions and tile size
      const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(venueId);
      if (!venue) {
        return res.status(404).json({ error: 'Venue not found' });
      }
      
      const tileSize = parseFloat(tileSizeParam) || venue.tile_size || 1;
      
      // Calculate time range based on timeframe
      const now = Date.now();
      let startTime;
      switch (timeframe) {
        case 'week':
          startTime = now - 7 * 24 * 60 * 60 * 1000;
          break;
        case 'month':
          startTime = now - 30 * 24 * 60 * 60 * 1000;
          break;
        case 'day':
        default:
          startTime = now - 24 * 60 * 60 * 1000;
          break;
      }
      
      // Get all track positions within the timeframe
      const positions = db.prepare(`
        SELECT track_key, timestamp, position_x, position_z
        FROM track_positions
        WHERE venue_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY track_key, timestamp ASC
      `).all(venueId, startTime, now);
      
      // Aggregate by tile
      // Tile coordinates are calculated as floor(position / tileSize)
      const tileData = new Map(); // key: "tileX,tileZ" -> { visits: Set<trackKey>, dwellMs: number }
      
      // Track last position per track for dwell calculation
      const trackLastPos = new Map(); // trackKey -> { tileKey, timestamp }
      
      for (const pos of positions) {
        const tileX = Math.floor(pos.position_x / tileSize);
        const tileZ = Math.floor(pos.position_z / tileSize);
        const tileKey = `${tileX},${tileZ}`;
        
        if (!tileData.has(tileKey)) {
          tileData.set(tileKey, { visits: new Set(), dwellMs: 0 });
        }
        
        const tile = tileData.get(tileKey);
        tile.visits.add(pos.track_key);
        
        // Calculate dwell time
        const lastPos = trackLastPos.get(pos.track_key);
        if (lastPos && lastPos.tileKey === tileKey) {
          // Same tile - add time difference to dwell
          const timeDiff = pos.timestamp - lastPos.timestamp;
          if (timeDiff > 0 && timeDiff < 60000) { // Cap at 1 minute to avoid gaps
            tile.dwellMs += timeDiff;
          }
        }
        
        trackLastPos.set(pos.track_key, { tileKey, timestamp: pos.timestamp });
      }
      
      // Convert to array format
      const tiles = [];
      let maxVisits = 0;
      let maxDwell = 0;
      
      tileData.forEach((data, key) => {
        const [tileX, tileZ] = key.split(',').map(Number);
        const visits = data.visits.size;
        const dwellSec = Math.round(data.dwellMs / 1000);
        
        maxVisits = Math.max(maxVisits, visits);
        maxDwell = Math.max(maxDwell, dwellSec);
        
        tiles.push({
          tileX,
          tileZ,
          x: tileX * tileSize + tileSize / 2, // Center of tile
          z: tileZ * tileSize + tileSize / 2,
          visits,
          dwellSec,
        });
      });
      
      res.json({
        tiles,
        tileSize,
        timeframe,
        startTime,
        endTime: now,
        maxVisits,
        maxDwell,
        venueWidth: venue.width,
        venueDepth: venue.depth,
      });
    } catch (err) {
      console.error('Failed to get heatmap data:', err);
      res.status(500).json({ error: 'Failed to get heatmap data' });
    }
  });

  /**
   * Get trajectory positions for a specific time range (for replay)
   */
  router.get('/venues/:venueId/trajectories', (req, res) => {
    try {
      const { venueId } = req.params;
      const { start, end } = req.query;
      
      const startTime = parseInt(start);
      const endTime = parseInt(end);
      
      if (!startTime || !endTime) {
        return res.status(400).json({ error: 'start and end timestamps required' });
      }
      
      // Get track positions for the time range
      const positions = db.prepare(`
        SELECT track_key, timestamp, position_x, position_z, velocity_x, velocity_z, roi_id
        FROM track_positions
        WHERE venue_id = ? AND timestamp >= ? AND timestamp <= ?
        ORDER BY timestamp ASC
      `).all(venueId, startTime, endTime);
      
      // Group by track_key for easier processing
      const tracks = {};
      for (const pos of positions) {
        if (!tracks[pos.track_key]) {
          tracks[pos.track_key] = [];
        }
        tracks[pos.track_key].push({
          timestamp: pos.timestamp,
          x: pos.position_x,
          z: pos.position_z,
          vx: pos.velocity_x,
          vz: pos.velocity_z,
          roiIds: pos.roi_id ? [pos.roi_id] : [],
        });
      }
      
      res.json({ tracks, startTime, endTime, count: positions.length });
    } catch (err) {
      console.error('Failed to get trajectory data:', err);
      res.status(500).json({ error: 'Failed to get trajectory data' });
    }
  });

  /**
   * Get LIVE waiting time for a zone from in-memory sessions (instant, no DB)
   */
  router.get('/roi/:roiId/live-stats', (req, res) => {
    try {
      const { roiId } = req.params;
      const liveStats = trajectoryStorage.getLiveZoneStats(roiId);
      
      res.json({
        roiId,
        timestamp: Date.now(),
        ...liveStats,
      });
    } catch (err) {
      console.error('Failed to get live zone stats:', err);
      res.status(500).json({ error: 'Failed to get live zone stats' });
    }
  });

  /**
   * Get queue KPIs for a specific queue zone (queue theory metrics)
   * Returns: waiting time, service time, throughput, abandon rate, etc.
   */
  router.get('/roi/:roiId/queue-kpis', (req, res) => {
    try {
      const { roiId } = req.params;
      const { startTime, endTime, period } = req.query;
      
      const now = Date.now();
      let start = startTime ? parseInt(startTime) : now - 60 * 60 * 1000; // Default last hour
      let end = endTime ? parseInt(endTime) : now;
      
      if (period) {
        switch (period) {
          case 'hour':
            start = now - 60 * 60 * 1000;
            break;
          case 'day':
            start = now - 24 * 60 * 60 * 1000;
            break;
          case 'week':
            start = now - 7 * 24 * 60 * 60 * 1000;
            break;
        }
        end = now;
      }
      
      const queueKpis = trajectoryStorage.getQueueKPIs(roiId, start, end);
      
      // Get current queue length (live occupancy)
      const liveOccupancy = db.prepare(`
        SELECT occupancy_count FROM zone_occupancy
        WHERE roi_id = ? AND timestamp > ?
        ORDER BY timestamp DESC LIMIT 1
      `).get(roiId, now - 10000);
      
      res.json({
        roiId,
        startTime: start,
        endTime: end,
        queueKpis: {
          ...queueKpis,
          currentQueueLength: liveOccupancy?.occupancy_count || 0,
        },
      });
    } catch (err) {
      console.error('Failed to get queue KPIs:', err);
      res.status(500).json({ error: 'Failed to get queue KPIs' });
    }
  });

  /**
   * Get queue KPIs for all checkout lanes in a venue
   */
  router.get('/venues/:venueId/queue-kpis', (req, res) => {
    try {
      const { venueId } = req.params;
      const { period } = req.query;
      
      const now = Date.now();
      let start = now - 60 * 60 * 1000; // Default last hour
      
      if (period === 'day') start = now - 24 * 60 * 60 * 1000;
      if (period === 'week') start = now - 7 * 24 * 60 * 60 * 1000;
      
      // Find all queue zones (zones with linked service zones)
      const queueZones = db.prepare(`
        SELECT zs.roi_id, zs.linked_service_zone_id, r.name, r.color
        FROM zone_settings zs
        JOIN regions_of_interest r ON zs.roi_id = r.id
        WHERE zs.venue_id = ? AND zs.linked_service_zone_id IS NOT NULL
      `).all(venueId);
      
      const results = queueZones.map(zone => {
        const queueKpis = trajectoryStorage.getQueueKPIs(zone.roi_id, start, now);
        
        // Get current queue length
        const liveOccupancy = db.prepare(`
          SELECT occupancy_count FROM zone_occupancy
          WHERE roi_id = ? AND timestamp > ?
          ORDER BY timestamp DESC LIMIT 1
        `).get(zone.roi_id, now - 10000);
        
        return {
          queueZoneId: zone.roi_id,
          serviceZoneId: zone.linked_service_zone_id,
          name: zone.name,
          color: zone.color,
          currentQueueLength: liveOccupancy?.occupancy_count || 0,
          ...queueKpis,
        };
      });
      
      // Calculate venue-wide averages
      const totalSessions = results.reduce((sum, r) => sum + r.totalSessions, 0);
      const avgWaitingTime = totalSessions > 0
        ? results.reduce((sum, r) => sum + (r.avgWaitingTimeMs * r.totalSessions), 0) / totalSessions
        : 0;
      
      res.json({
        venueId,
        startTime: start,
        endTime: now,
        period: period || 'hour',
        summary: {
          totalQueueZones: queueZones.length,
          totalSessions,
          avgWaitingTimeMs: avgWaitingTime,
          avgWaitingTimeSec: Math.round(avgWaitingTime / 1000),
          avgWaitingTimeMin: Math.round(avgWaitingTime / 60000 * 10) / 10,
        },
        queueZones: results,
      });
    } catch (err) {
      console.error('Failed to get venue queue KPIs:', err);
      res.status(500).json({ error: 'Failed to get venue queue KPIs' });
    }
  });

  /**
   * Link a queue zone to a service zone (for queue theory tracking)
   */
  router.post('/roi/:roiId/link-service-zone', (req, res) => {
    try {
      const { roiId } = req.params;
      const { serviceZoneId, venueId } = req.body;
      
      if (!serviceZoneId || !venueId) {
        return res.status(400).json({ error: 'serviceZoneId and venueId required' });
      }
      
      // Upsert zone settings with linked service zone
      db.prepare(`
        INSERT INTO zone_settings (roi_id, venue_id, linked_service_zone_id, zone_type)
        VALUES (?, ?, ?, 'queue')
        ON CONFLICT(roi_id) DO UPDATE SET
          linked_service_zone_id = excluded.linked_service_zone_id,
          zone_type = 'queue',
          updated_at = datetime('now')
      `).run(roiId, venueId, serviceZoneId);
      
      // Reload zone links in trajectory storage
      trajectoryStorage.loadZoneLinks(venueId);
      
      res.json({ 
        success: true, 
        queueZoneId: roiId, 
        serviceZoneId,
        message: 'Queue zone linked to service zone for waiting time tracking'
      });
    } catch (err) {
      console.error('Failed to link service zone:', err);
      res.status(500).json({ error: 'Failed to link service zone' });
    }
  });

  /**
   * Manually trigger database sync (syncs pending visits to DB)
   */
  router.post('/sync', (req, res) => {
    try {
      console.log('📊 Manual sync triggered...');
      trajectoryStorage.syncToDatabase();
      res.json({ success: true, message: 'Database sync completed' });
    } catch (err) {
      console.error('Failed to sync database:', err);
      res.status(500).json({ error: 'Failed to sync database' });
    }
  });

  // Set up automatic sync interval (every 15 minutes)
  setInterval(() => {
    try {
      trajectoryStorage.syncToDatabase();
    } catch (err) {
      console.error('Auto-sync failed:', err);
    }
  }, 15 * 60 * 1000);

  // ==================== SKU DETECTION DEBUG ====================

  /**
   * Real-time SKU detection for a person at a given position
   * NEW LOGIC: Direct person→shelf distance matching (no ROI dependency)
   * 
   * Flow:
   * 1. Get all shelves with planograms in venue
   * 2. Calculate distance from person to each shelf
   * 3. Find closest shelf within engagement distance (1.5m)
   * 4. Calculate which slot person is facing based on their X position relative to shelf
   * 5. Return SKUs at that slot position
   */
  router.post('/kpi/sku-detection/detect', (req, res) => {
    try {
      const { venueId, position, velocity } = req.body;
      
      if (!venueId || !position) {
        return res.status(400).json({ error: 'venueId and position required' });
      }
      
      const { x, z } = position;
      const ENGAGEMENT_DISTANCE = 1.5; // meters - max distance to be "engaging" with shelf
      
      console.log(`[SKU Debug] ═══════════════════════════════════════════`);
      console.log(`[SKU Debug] Person position: (${x.toFixed(2)}, ${z.toFixed(2)})`);
      
      // Get all shelves that have planograms (only these have SKUs)
      const shelvesWithPlanograms = db.prepare(`
        SELECT 
          vo.id, vo.name, vo.position_x, vo.position_z, vo.rotation_y, vo.scale_x, vo.scale_y, vo.scale_z,
          sp.id as planogram_config_id, sp.planogram_id, sp.slot_width_m, sp.num_levels, sp.slots_json
        FROM venue_objects vo
        JOIN shelf_planograms sp ON vo.id = sp.shelf_id
        WHERE vo.venue_id = ? AND vo.type = 'shelf'
      `).all(venueId);
      
      console.log(`[SKU Debug] Found ${shelvesWithPlanograms.length} shelves with planograms`);
      
      // Calculate distance to nearest point on each shelf (not center!)
      // Shelves are long rectangles running along Z axis
      let closestShelf = null;
      let minDistance = Infinity;
      
      for (const shelf of shelvesWithPlanograms) {
        const shelfLength = shelf.scale_z || 1;
        const shelfWidth = shelf.scale_x || 1;
        const shelfZStart = shelf.position_z - shelfLength / 2;
        const shelfZEnd = shelf.position_z + shelfLength / 2;
        const shelfXStart = shelf.position_x - shelfWidth / 2;
        const shelfXEnd = shelf.position_x + shelfWidth / 2;
        
        // Clamp person position to shelf bounds to find nearest point
        const nearestX = Math.max(shelfXStart, Math.min(shelfXEnd, x));
        const nearestZ = Math.max(shelfZStart, Math.min(shelfZEnd, z));
        
        // Distance from person to nearest point on shelf
        const dx = x - nearestX;
        const dz = z - nearestZ;
        const distance = Math.sqrt(dx * dx + dz * dz);
        
        console.log(`[SKU Debug]   Shelf "${shelf.id.slice(0,8)}..." Z:[${shelfZStart.toFixed(1)}-${shelfZEnd.toFixed(1)}] → nearest:(${nearestX.toFixed(1)},${nearestZ.toFixed(1)}) dist:${distance.toFixed(2)}m`);
        
        if (distance < minDistance) {
          minDistance = distance;
          closestShelf = shelf;
        }
      }
      
      // Check if person is within engagement distance
      if (!closestShelf || minDistance > ENGAGEMENT_DISTANCE) {
        console.log(`[SKU Debug] No shelf within engagement distance (${ENGAGEMENT_DISTANCE}m). Closest: ${minDistance.toFixed(2)}m`);
        return res.json({
          position: { x, z },
          detectedSkus: [],
          timestamp: Date.now(),
          debug: { closestShelfDistance: minDistance, engagementThreshold: ENGAGEMENT_DISTANCE }
        });
      }
      
      console.log(`[SKU Debug] ✓ Closest shelf: "${closestShelf.id.slice(0,8)}..." at ${minDistance.toFixed(2)}m`);
      console.log(`[SKU Debug]   Position: (${closestShelf.position_x.toFixed(2)}, ${closestShelf.position_z.toFixed(2)})`);
      console.log(`[SKU Debug]   Rotation: ${closestShelf.rotation_y?.toFixed(2) || 0} rad`);
      console.log(`[SKU Debug]   Width (X): ${closestShelf.scale_x}m, Length (Z): ${closestShelf.scale_z}m`);
      
      // Calculate which slot person is facing
      const shelfPos = { x: closestShelf.position_x, z: closestShelf.position_z };
      const shelfRotY = closestShelf.rotation_y || 0;
      const shelfWidth = closestShelf.scale_x || 1;  // X dimension (narrow)
      const shelfDepth = closestShelf.scale_z || 1;  // Z dimension (long)
      
      // Auto-detect facing direction (same logic as frontend PlanogramViewport)
      // If width < depth, use 'left' facing (slots along Z), else 'front' (slots along X)
      const storedFacings = JSON.parse(closestShelf.slot_facings || '[]');
      const autoFacing = shelfWidth >= shelfDepth ? 'front' : 'left';
      const effectiveFacing = storedFacings.length > 0 ? storedFacings[0] : autoFacing;
      const slotsAlongZ = effectiveFacing === 'left' || effectiveFacing === 'right';
      
      console.log(`[SKU Debug]   Width: ${shelfWidth.toFixed(2)}m, Depth: ${shelfDepth.toFixed(2)}m`);
      console.log(`[SKU Debug]   Facing: ${effectiveFacing} (auto=${autoFacing}), slots along ${slotsAlongZ ? 'Z' : 'X'}`);
      
      // Calculate relative position to shelf center
      const dx = x - shelfPos.x;
      const dz = z - shelfPos.z;
      
      // Determine which side of shelf person is on
      const zoneType = dx > 0 ? 'right' : 'left';
      
      // Get slot configuration
      const slots = JSON.parse(closestShelf.slots_json || '{}');
      const slotWidth = closestShelf.slot_width_m || 0.1;
      const slotSpan = slotsAlongZ ? shelfDepth : shelfWidth;
      const numSlotsPerLevel = Math.max(1, Math.floor(slotSpan / slotWidth));
      
      // Calculate slot start position based on facing (matches frontend getFaceParams)
      // For 'left' facing: slots start at Z = center - depth/2, X = center - width/2
      // For 'right' facing: slots start at Z = center - depth/2, X = center + width/2
      // For 'front' facing: slots start at X = center - width/2, Z = center + depth/2
      // For 'back' facing: slots start at X = center - width/2, Z = center - depth/2
      let slotStartX, slotStartZ, slotOffsetX, slotOffsetZ;
      
      if (slotsAlongZ) {
        // Left/Right facing: slots distributed along Z
        slotStartZ = shelfPos.z - shelfDepth / 2;
        slotOffsetX = effectiveFacing === 'left' ? -shelfWidth / 2 : shelfWidth / 2;
        slotStartX = shelfPos.x + slotOffsetX;
      } else {
        // Front/Back facing: slots distributed along X
        slotStartX = shelfPos.x - shelfWidth / 2;
        slotOffsetZ = effectiveFacing === 'front' ? shelfDepth / 2 : -shelfDepth / 2;
        slotStartZ = shelfPos.z + slotOffsetZ;
      }
      
      console.log(`[SKU Debug]   Slot start: X=${slotStartX.toFixed(2)}, Z=${slotStartZ.toFixed(2)}`);
      console.log(`[SKU Debug]   slotSpan=${slotSpan.toFixed(2)}, slotWidth=${slotWidth}, numSlots=${numSlotsPerLevel}`);
      
      // Collect ALL slots with SKUs and their world positions
      const skuSlots = [];
      const levels = slots.levels || [];
      
      for (const level of levels) {
        for (const slot of (level.slots || [])) {
          if (slot.skuItemId) {
            let slotWorldX, slotWorldZ;
            
            if (slotsAlongZ) {
              // Slots along Z axis
              slotWorldX = slotStartX;
              slotWorldZ = slotStartZ + (slot.slotIndex + 0.5) * slotWidth;
            } else {
              // Slots along X axis
              slotWorldX = slotStartX + (slot.slotIndex + 0.5) * slotWidth;
              slotWorldZ = slotStartZ;
            }
            
            // Calculate 2D distance from person to slot
            const distX = x - slotWorldX;
            const distZ = z - slotWorldZ;
            const distanceToSlot = Math.sqrt(distX * distX + distZ * distZ);
            
            skuSlots.push({
              levelIndex: level.levelIndex,
              slot,
              slotWorldX,
              slotWorldZ,
              distanceToSlot,
            });
          }
        }
      }
      
      // Sort by 2D distance to slot position
      skuSlots.sort((a, b) => a.distanceToSlot - b.distanceToSlot);
      
      console.log(`[SKU Debug]   Found ${skuSlots.length} SKU slots total`);
      if (skuSlots.length > 0) {
        console.log(`[SKU Debug]   Nearest SKU at (${skuSlots[0].slotWorldX.toFixed(2)}, ${skuSlots[0].slotWorldZ.toFixed(2)}), dist=${skuSlots[0].distanceToSlot.toFixed(2)}m`);
      }
      
      // Only include SKUs within 2 meters of person's position (2D distance to slot)
      const MAX_SKU_DISTANCE = 2.0; // meters
      const detectedSkus = [];
      
      for (const skuSlot of skuSlots) {
        if (skuSlot.distanceToSlot > MAX_SKU_DISTANCE) continue;
        
        const sku = db.prepare('SELECT * FROM sku_items WHERE id = ?').get(skuSlot.slot.skuItemId);
        
        if (sku) {
          // Position score based on level (eye level = best)
          const levelIndex = skuSlot.levelIndex;
          let positionScore = 0.5;
          if (levelIndex === 1 || levelIndex === 2) positionScore = 1.0; // Eye/chest level
          else if (levelIndex === 0) positionScore = 0.6; // Waist level
          else positionScore = 0.4; // Top/bottom
          
          // Attention score based on proximity (closer = higher score)
          const attentionScore = Math.max(0, 1 - (skuSlot.distanceToSlot / MAX_SKU_DISTANCE));
          
          detectedSkus.push({
            skuId: sku.id,
            skuCode: sku.sku_code,
            name: sku.name,
            brand: sku.brand,
            category: sku.category,
            price: sku.price,
            shelfId: closestShelf.id,
            shelfName: closestShelf.name,
            shelfPosition: { x: closestShelf.position_x, z: closestShelf.position_z },
            shelfRotation: shelfRotY,
            slotWorldPosition: { x: skuSlot.slotWorldX, z: skuSlot.slotWorldZ },
            levelIndex,
            slotIndex: skuSlot.slot.slotIndex,
            positionScore,
            attentionScore,
            zoneType,
            distanceToShelf: minDistance,
          });
        }
      }
      
      // Sort by attention score (closest slot first)
      detectedSkus.sort((a, b) => b.attentionScore - a.attentionScore);
      
      console.log(`[SKU Debug] ✓ Found ${detectedSkus.length} SKUs, returning top 3`);
      if (detectedSkus.length > 0) {
        console.log(`[SKU Debug]   Top SKUs:`, detectedSkus.slice(0, 3).map(s => 
          `${s.name} (L${s.levelIndex} S${s.slotIndex}, att=${s.attentionScore.toFixed(2)})`
        ));
      }
      console.log(`[SKU Debug] ═══════════════════════════════════════════`);
      
      res.json({
        position: { x, z },
        detectedSkus: detectedSkus.slice(0, 3),
        timestamp: Date.now(),
        debug: {
          closestShelfId: closestShelf.id,
          closestShelfPosition: { x: closestShelf.position_x, z: closestShelf.position_z },
          distanceToShelf: minDistance,
          nearestSlotIndex: detectedSkus.length > 0 ? detectedSkus[0].slotIndex : null,
          totalSkusFound: detectedSkus.length,
        }
      });
    } catch (err) {
      console.error('SKU detection error:', err);
      res.status(500).json({ error: 'Failed to detect SKUs' });
    }
  });

  /**
   * Get real-time SKU detection for all tracked persons in a venue
   */
  router.get('/kpi/venues/:venueId/sku-detection/active', (req, res) => {
    try {
      const { venueId } = req.params;
      
      // Get all shelf engagement zones for this venue
      const zones = db.prepare(`
        SELECT r.id, r.name, r.vertices, r.metadata_json,
               vo.id as shelf_id, vo.name as shelf_name, vo.position_x, vo.position_z, vo.rotation_y,
               vo.scale_x, vo.scale_y
        FROM regions_of_interest r
        LEFT JOIN venue_objects vo ON (
          r.metadata_json LIKE '%"shelfId":"' || vo.id || '"%'
          OR r.name LIKE vo.name || ' - Engagement%'
        )
        WHERE r.venue_id = ? AND vo.type = 'shelf'
      `).all(venueId);
      
      // Get planograms for these shelves
      const shelfPlanograms = new Map();
      for (const zone of zones) {
        if (zone.shelf_id && !shelfPlanograms.has(zone.shelf_id)) {
          const sp = db.prepare('SELECT * FROM shelf_planograms WHERE shelf_id = ? LIMIT 1').get(zone.shelf_id);
          if (sp) {
            shelfPlanograms.set(zone.shelf_id, {
              ...sp,
              slots: JSON.parse(sp.slots_json),
            });
          }
        }
      }
      
      // Return zone info for frontend to use with tracked positions
      res.json({
        venueId,
        zones: zones.map(z => ({
          roiId: z.id,
          roiName: z.name,
          vertices: JSON.parse(z.vertices),
          shelfId: z.shelf_id,
          shelfName: z.shelf_name,
          shelfPosition: { x: z.position_x, z: z.position_z },
          shelfRotation: z.rotation_y || 0,
          shelfSize: { width: z.scale_x || 2, height: z.scale_y || 2 },
          planogram: shelfPlanograms.get(z.shelf_id) || null,
        })),
      });
    } catch (err) {
      console.error('Failed to get active SKU detection zones:', err);
      res.status(500).json({ error: 'Failed to get zones' });
    }
  });

  // ==================== ENRICHED SHELF KPI ROUTES ====================

  /**
   * Get shelf info associated with an ROI (engagement zone)
   * Infers shelfId from ROI metadata or name pattern
   */
  router.get('/roi/:roiId/shelf-info', (req, res) => {
    try {
      const { roiId } = req.params;
      
      // Get ROI details
      const roi = db.prepare('SELECT * FROM regions_of_interest WHERE id = ?').get(roiId);
      if (!roi) {
        return res.status(404).json({ error: 'ROI not found' });
      }
      
      let shelfId = null;
      let shelfName = null;
      
      // Method 1: Check metadata for shelfId
      if (roi.metadata_json) {
        const metadata = JSON.parse(roi.metadata_json);
        if (metadata.shelfId) {
          shelfId = metadata.shelfId;
          // Get shelf name
          const shelf = db.prepare('SELECT name FROM venue_objects WHERE id = ?').get(shelfId);
          shelfName = shelf?.name || shelfId;
        }
      }
      
      // Method 2: Parse zone name pattern "ShelfName - Engagement (Left/Right)"
      if (!shelfId && roi.name) {
        const match = roi.name.match(/^(.+?)\s*-\s*Engagement/i);
        if (match) {
          const extractedName = match[1].trim();
          // Look up shelf by name
          const shelf = db.prepare('SELECT id, name FROM venue_objects WHERE venue_id = ? AND name = ? AND type = ?')
            .get(roi.venue_id, extractedName, 'shelf');
          if (shelf) {
            shelfId = shelf.id;
            shelfName = shelf.name;
          }
        }
      }
      
      // Method 3: Find nearest shelf to ROI center
      if (!shelfId) {
        const vertices = JSON.parse(roi.vertices);
        if (vertices.length > 0) {
          // Calculate ROI center
          const centerX = vertices.reduce((sum, v) => sum + v.x, 0) / vertices.length;
          const centerZ = vertices.reduce((sum, v) => sum + v.z, 0) / vertices.length;
          
          // Find shelves in the venue
          const shelves = db.prepare('SELECT id, name, position_x, position_z FROM venue_objects WHERE venue_id = ? AND type = ?')
            .all(roi.venue_id, 'shelf');
          
          // Find closest shelf (within 3 meters)
          let minDist = 3;
          for (const shelf of shelves) {
            const dist = Math.sqrt(Math.pow(shelf.position_x - centerX, 2) + Math.pow(shelf.position_z - centerZ, 2));
            if (dist < minDist) {
              minDist = dist;
              shelfId = shelf.id;
              shelfName = shelf.name;
            }
          }
        }
      }
      
      if (!shelfId) {
        return res.json({ roiId, shelfId: null, shelfName: null, planogramId: null, message: 'No shelf found for this ROI' });
      }
      
      // Get active planogram for this shelf
      let planogramId = null;
      const shelfPlanogram = db.prepare(`
        SELECT sp.planogram_id FROM shelf_planograms sp
        JOIN planograms p ON sp.planogram_id = p.id
        WHERE sp.shelf_id = ? AND p.status = 'active'
        ORDER BY p.updated_at DESC LIMIT 1
      `).get(shelfId);
      
      if (shelfPlanogram) {
        planogramId = shelfPlanogram.planogram_id;
      } else {
        // Fallback: any planogram with this shelf
        const anyPlanogram = db.prepare(`
          SELECT planogram_id FROM shelf_planograms WHERE shelf_id = ? LIMIT 1
        `).get(shelfId);
        planogramId = anyPlanogram?.planogram_id || null;
      }
      
      res.json({
        roiId,
        shelfId,
        shelfName,
        planogramId,
      });
    } catch (err) {
      console.error('Failed to get shelf info for ROI:', err);
      res.status(500).json({ error: 'Failed to get shelf info' });
    }
  });

  /**
   * Get enriched shelf KPIs with SKU/category/brand breakdown
   * Requires: shelfId, planogramId, and optionally roiId for engagement zone
   */
  router.get('/shelf/:shelfId/enriched-kpis', (req, res) => {
    try {
      const { shelfId } = req.params;
      const { planogramId, roiId, startTime, endTime, period } = req.query;
      
      if (!planogramId) {
        return res.status(400).json({ error: 'planogramId query parameter required' });
      }
      
      // Calculate time range
      const now = Date.now();
      let start = startTime ? parseInt(startTime) : now - 24 * 60 * 60 * 1000;
      let end = endTime ? parseInt(endTime) : now;
      
      if (period) {
        switch (period) {
          case 'hour': start = now - 60 * 60 * 1000; break;
          case 'day': start = now - 24 * 60 * 60 * 1000; break;
          case 'week': start = now - 7 * 24 * 60 * 60 * 1000; break;
          case 'month': start = now - 30 * 24 * 60 * 60 * 1000; break;
        }
        end = now;
      }
      
      // Get zone KPIs if roiId provided
      let zoneKPIs = {};
      if (roiId) {
        zoneKPIs = kpiCalculator.getZoneKPIs(roiId, start, end);
      }
      
      // Get enriched shelf KPIs
      const enrichedKPIs = shelfKPIEnricher.getEnrichedShelfKPIs(shelfId, planogramId, zoneKPIs);
      
      res.json({
        shelfId,
        planogramId,
        roiId: roiId || null,
        startTime: start,
        endTime: end,
        ...enrichedKPIs,
      });
    } catch (err) {
      console.error('Failed to get enriched shelf KPIs:', err);
      res.status(500).json({ error: 'Failed to get enriched shelf KPIs' });
    }
  });

  /**
   * Get category breakdown for a shelf
   */
  router.get('/shelf/:shelfId/categories', (req, res) => {
    try {
      const { shelfId } = req.params;
      const { planogramId } = req.query;
      
      if (!planogramId) {
        return res.status(400).json({ error: 'planogramId query parameter required' });
      }
      
      const enrichedData = shelfKPIEnricher.getEnrichedShelfData(planogramId, shelfId);
      if (!enrichedData) {
        return res.status(404).json({ error: 'No planogram data found for shelf' });
      }
      
      const categoryBreakdown = shelfKPIEnricher.getCategoryBreakdown(enrichedData);
      
      res.json({
        shelfId,
        planogramId,
        totalSlots: enrichedData.totalSlots,
        occupiedSlots: enrichedData.occupiedSlots,
        categories: categoryBreakdown,
      });
    } catch (err) {
      console.error('Failed to get shelf categories:', err);
      res.status(500).json({ error: 'Failed to get shelf categories' });
    }
  });

  /**
   * Get brand breakdown for a shelf
   */
  router.get('/shelf/:shelfId/brands', (req, res) => {
    try {
      const { shelfId } = req.params;
      const { planogramId } = req.query;
      
      if (!planogramId) {
        return res.status(400).json({ error: 'planogramId query parameter required' });
      }
      
      const enrichedData = shelfKPIEnricher.getEnrichedShelfData(planogramId, shelfId);
      if (!enrichedData) {
        return res.status(404).json({ error: 'No planogram data found for shelf' });
      }
      
      const brandBreakdown = shelfKPIEnricher.getBrandBreakdown(enrichedData);
      
      res.json({
        shelfId,
        planogramId,
        totalSlots: enrichedData.totalSlots,
        brands: brandBreakdown,
      });
    } catch (err) {
      console.error('Failed to get shelf brands:', err);
      res.status(500).json({ error: 'Failed to get shelf brands' });
    }
  });

  /**
   * Get slot-level heatmap for a shelf
   */
  router.get('/shelf/:shelfId/heatmap', (req, res) => {
    try {
      const { shelfId } = req.params;
      const { planogramId } = req.query;
      
      if (!planogramId) {
        return res.status(400).json({ error: 'planogramId query parameter required' });
      }
      
      const enrichedData = shelfKPIEnricher.getEnrichedShelfData(planogramId, shelfId);
      if (!enrichedData) {
        return res.status(404).json({ error: 'No planogram data found for shelf' });
      }
      
      const heatmap = shelfKPIEnricher.getSlotHeatmap(enrichedData);
      
      res.json({
        shelfId,
        planogramId,
        numLevels: enrichedData.numLevels,
        slotsPerLevel: enrichedData.slotsPerLevel,
        heatmap,
      });
    } catch (err) {
      console.error('Failed to get shelf heatmap:', err);
      res.status(500).json({ error: 'Failed to get shelf heatmap' });
    }
  });

  /**
   * Get SKU-level analytics for a specific SKU on a shelf
   */
  router.get('/shelf/:shelfId/sku/:skuCode', (req, res) => {
    try {
      const { shelfId, skuCode } = req.params;
      const { planogramId } = req.query;
      
      if (!planogramId) {
        return res.status(400).json({ error: 'planogramId query parameter required' });
      }
      
      const enrichedData = shelfKPIEnricher.getEnrichedShelfData(planogramId, shelfId);
      if (!enrichedData) {
        return res.status(404).json({ error: 'No planogram data found for shelf' });
      }
      
      const skuAnalytics = shelfKPIEnricher.getSkuAnalytics(enrichedData, skuCode);
      if (!skuAnalytics) {
        return res.status(404).json({ error: 'SKU not found on this shelf' });
      }
      
      res.json({
        shelfId,
        planogramId,
        ...skuAnalytics,
      });
    } catch (err) {
      console.error('Failed to get SKU analytics:', err);
      res.status(500).json({ error: 'Failed to get SKU analytics' });
    }
  });

  /**
   * Compare a category across multiple shelves in a venue
   */
  router.get('/venues/:venueId/category-comparison', (req, res) => {
    try {
      const { venueId } = req.params;
      const { category, planogramId } = req.query;
      
      if (!category) {
        return res.status(400).json({ error: 'category query parameter required' });
      }
      
      // Get active planogram for venue if not specified
      let activePlanogramId = planogramId;
      if (!activePlanogramId) {
        const planograms = planogramQueries.getByVenueId(db, venueId);
        const activePlanogram = planograms.find(p => p.status === 'active') || planograms[0];
        if (!activePlanogram) {
          return res.status(404).json({ error: 'No planogram found for venue' });
        }
        activePlanogramId = activePlanogram.id;
      }
      
      const comparison = shelfKPIEnricher.compareCategoryAcrossShelves(venueId, activePlanogramId, category);
      
      res.json({
        venueId,
        planogramId: activePlanogramId,
        category,
        shelvesWithCategory: comparison.length,
        comparison,
      });
    } catch (err) {
      console.error('Failed to get category comparison:', err);
      res.status(500).json({ error: 'Failed to get category comparison' });
    }
  });

  /**
   * Get all shelves with enriched data for a planogram
   */
  router.get('/planograms/:planogramId/shelves-analytics', (req, res) => {
    try {
      const { planogramId } = req.params;
      const { startTime, endTime, period } = req.query;
      
      // Get all shelf planograms
      const shelfPlanograms = shelfPlanogramQueries.getByPlanogramId(db, planogramId);
      
      if (shelfPlanograms.length === 0) {
        return res.json({ planogramId, shelves: [] });
      }
      
      // Calculate time range
      const now = Date.now();
      let start = startTime ? parseInt(startTime) : now - 24 * 60 * 60 * 1000;
      let end = endTime ? parseInt(endTime) : now;
      
      if (period) {
        switch (period) {
          case 'hour': start = now - 60 * 60 * 1000; break;
          case 'day': start = now - 24 * 60 * 60 * 1000; break;
          case 'week': start = now - 7 * 24 * 60 * 60 * 1000; break;
          case 'month': start = now - 30 * 24 * 60 * 60 * 1000; break;
        }
        end = now;
      }
      
      const shelvesAnalytics = shelfPlanograms.map(sp => {
        const enrichedData = shelfKPIEnricher.getEnrichedShelfData(planogramId, sp.shelfId);
        const categoryBreakdown = enrichedData ? shelfKPIEnricher.getCategoryBreakdown(enrichedData) : [];
        const brandBreakdown = enrichedData ? shelfKPIEnricher.getBrandBreakdown(enrichedData) : [];
        
        // Try to find associated ROI for this shelf
        const roiResult = db.prepare(`
          SELECT id FROM regions_of_interest 
          WHERE metadata_json LIKE ? OR name LIKE ?
          LIMIT 1
        `).get(`%"shelfId":"${sp.shelfId}"%`, `%${sp.shelfId}%`);
        
        let zoneKPIs = {};
        if (roiResult) {
          zoneKPIs = kpiCalculator.getZoneKPIs(roiResult.id, start, end);
        }
        
        return {
          shelfId: sp.shelfId,
          numLevels: sp.numLevels,
          totalSlots: enrichedData?.totalSlots || 0,
          occupiedSlots: enrichedData?.occupiedSlots || 0,
          occupancyRate: enrichedData 
            ? (enrichedData.occupiedSlots / enrichedData.totalSlots) * 100 
            : 0,
          topCategories: categoryBreakdown.slice(0, 3),
          topBrands: brandBreakdown.slice(0, 3),
          zoneKPIs: roiResult ? {
            roiId: roiResult.id,
            visits: zoneKPIs.visits || 0,
            dwellRate: zoneKPIs.dwellRate || 0,
            engagementRate: zoneKPIs.engagementRate || 0,
            utilizationRate: zoneKPIs.utilizationRate || 0,
          } : null,
        };
      });
      
      res.json({
        planogramId,
        startTime: start,
        endTime: end,
        totalShelves: shelvesAnalytics.length,
        shelves: shelvesAnalytics,
      });
    } catch (err) {
      console.error('Failed to get shelves analytics:', err);
      res.status(500).json({ error: 'Failed to get shelves analytics' });
    }
  });

  return router;
}
