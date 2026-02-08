import { Router } from 'express';

export default function createKpiRoutes(db, kpiCalculator, trajectoryStorage) {
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

  return router;
}
