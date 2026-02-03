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
            WHERE venue_id = ? AND zone_id = ? AND timestamp >= ? AND timestamp < ?
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
            WHERE venue_id = ? AND zone_id = ? AND start_time >= ? AND start_time < ?
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
            WHERE venue_id = ? AND zone_id = ? AND start_time >= ? AND start_time < ? AND is_dwell = 1
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
            WHERE venue_id = ? AND zone_id = ? AND start_time >= ? AND start_time < ? AND is_engagement = 1
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
        SELECT track_key, timestamp, x, z, vx, vz, roi_ids
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
          x: pos.x,
          z: pos.z,
          vx: pos.vx,
          vz: pos.vz,
          roiIds: pos.roi_ids ? JSON.parse(pos.roi_ids) : [],
        });
      }
      
      res.json({ tracks, startTime, endTime, count: positions.length });
    } catch (err) {
      console.error('Failed to get trajectory data:', err);
      res.status(500).json({ error: 'Failed to get trajectory data' });
    }
  });

  return router;
}
