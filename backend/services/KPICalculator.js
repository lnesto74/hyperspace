/**
 * KPICalculator
 * 
 * Calculates all zone KPIs based on trajectory and visit data
 * Supports various time ranges and filters
 */
export class KPICalculator {
  constructor(db) {
    this.db = db;
    
    // Default thresholds (can be customized per zone)
    this.DWELL_THRESHOLD_MS = 10 * 1000;      // 10 seconds (for testing)
    this.ENGAGEMENT_THRESHOLD_MS = 30 * 1000; // 30 seconds (for testing)
  }

  /**
   * Prepare statements once for reuse (lazy init)
   */
  _prepareStatements() {
    if (this._stmts) return;
    this._stmts = {
      // Single combined zone_visits query (replaces getVisits + getTimeSpent + getDwellMetrics + getEngagementMetrics)
      visitsCombined: this.db.prepare(`
        SELECT
          COUNT(DISTINCT track_key)                                      AS unique_visitors,
          COUNT(*)                                                       AS total_entries,
          COALESCE(SUM(duration_ms), 0)                                  AS total_ms,
          SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END)                 AS dwells_cumulative,
          COUNT(DISTINCT CASE WHEN is_dwell = 1 THEN track_key END)      AS dwells_unique,
          AVG(CASE WHEN is_dwell = 1 THEN duration_ms END)               AS dwell_avg_ms,
          AVG(CASE WHEN is_dwell = 1 AND is_complete_track = 1 THEN duration_ms END) AS dwell_avg_ct_ms,
          SUM(CASE WHEN is_engagement = 1 THEN 1 ELSE 0 END)            AS engagements_cumulative,
          COUNT(DISTINCT CASE WHEN is_engagement = 1 THEN track_key END) AS engagements_unique,
          AVG(CASE WHEN is_engagement = 1 THEN duration_ms END)          AS engagement_avg_ms,
          AVG(CASE WHEN is_engagement = 1 AND is_complete_track = 1 THEN duration_ms END) AS engagement_avg_ct_ms
        FROM zone_visits
        WHERE roi_id = ? AND start_time >= ? AND start_time < ?
      `),
      roiVenueId: this.db.prepare(`SELECT venue_id FROM regions_of_interest WHERE id = ?`),
      flowDraws: this.db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT track_key, MIN(start_time) as first_dwell_time, roi_id
          FROM zone_visits
          WHERE venue_id = ? AND is_dwell = 1 AND start_time >= ? AND start_time < ?
          GROUP BY track_key
          HAVING roi_id = ?
        )
      `),
      flowExits: this.db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT track_key, MAX(end_time) as last_dwell_time, roi_id
          FROM zone_visits
          WHERE venue_id = ? AND is_dwell = 1 AND start_time >= ? AND start_time < ?
            AND is_conversion = 0
          GROUP BY track_key
          HAVING roi_id = ?
        )
      `),
      flowBounces: this.db.prepare(`
        SELECT COUNT(*) as count FROM (
          SELECT v1.track_key
          FROM zone_visits v1
          WHERE v1.venue_id = ? AND v1.roi_id = ? AND v1.is_dwell = 1
            AND v1.start_time >= ? AND v1.start_time < ?
            AND NOT EXISTS (
              SELECT 1 FROM zone_visits v2
              WHERE v2.track_key = v1.track_key
                AND v2.roi_id != v1.roi_id
                AND v2.is_dwell = 1
                AND v2.start_time >= ? AND v2.start_time < ?
            )
          GROUP BY v1.track_key
        )
      `),
      // Combined occupancy + utilization query (replaces getOccupancyMetrics + getUtilizationMetrics)
      occupancyCombined: this.db.prepare(`
        SELECT
          MAX(occupancy_count) AS peak,
          AVG(occupancy_count) AS avg_occ,
          COUNT(*) AS total_samples,
          SUM(CASE WHEN occupancy_count > 0 THEN 1 ELSE 0 END) AS occupied_samples
        FROM zone_occupancy
        WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
      `),
      hourlyOccupancy: this.db.prepare(`
        SELECT
          COUNT(*) AS samples,
          SUM(CASE WHEN occupancy_count > 0 THEN 1 ELSE 0 END) AS occupied_samples
        FROM zone_occupancy
        WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
      `),
      dailyVisitCheck: this.db.prepare(`SELECT COUNT(*) as count FROM zone_visits WHERE roi_id = ? AND start_time >= ?`),
      // Velocity via SQL aggregation (replaces fetching all rows into JS)
      velocityAgg: this.db.prepare(`
        SELECT
          COUNT(*) AS total_samples,
          AVG(velocity_x * velocity_x + velocity_z * velocity_z) AS avg_speed_sq,
          SUM(CASE WHEN (velocity_x * velocity_x + velocity_z * velocity_z) > 0.01 THEN 1 ELSE 0 END) AS in_motion_samples,
          SUM(CASE WHEN (velocity_x * velocity_x + velocity_z * velocity_z) <= 0.01 THEN 1 ELSE 0 END) AS at_rest_samples,
          AVG(CASE WHEN (velocity_x * velocity_x + velocity_z * velocity_z) > 0.01
              THEN velocity_x * velocity_x + velocity_z * velocity_z END) AS avg_motion_speed_sq
        FROM track_positions
        WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
      `),
      venueTotals: this.db.prepare(`
        SELECT
          SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END) as total_dwells,
          SUM(CASE WHEN is_engagement = 1 THEN 1 ELSE 0 END) as total_engagements
        FROM zone_visits
        WHERE venue_id = ? AND start_time >= ? AND start_time < ?
      `),
    };
  }

  /**
   * Get all KPIs for a specific ROI within a time range
   * Optimized: ~7 queries instead of ~17
   */
  getZoneKPIs(roiId, startTime, endTime, options = {}) {
    this._prepareStatements();
    const S = this._stmts;
    
    // 1) Single combined zone_visits query (replaces 4 separate queries)
    const v = S.visitsCombined.get(roiId, startTime, endTime) || {};
    const visits = v.unique_visitors || 0;
    const totalEntries = v.total_entries || 0;
    const timeSpent = v.total_ms ? v.total_ms / 60000 : 0;
    
    const kpis = {
      // Basic metrics
      visits,
      totalEntries,
      timeSpent,
      avgTimeSpent: visits > 0 ? timeSpent / visits : 0,
      avgTimeSpentCT: 0,
      
      // Dwell metrics (from same query)
      dwellAvgTime: v.dwell_avg_ms ? v.dwell_avg_ms / 60000 : 0,
      dwellAvgTimeCT: v.dwell_avg_ct_ms ? v.dwell_avg_ct_ms / 60000 : 0,
      dwellsCumulative: v.dwells_cumulative || 0,
      dwellsUnique: v.dwells_unique || 0,
      dwellsPerVisit: 0,
      dwellRate: 0,
      dwellShare: 0,
      
      // Engagement metrics (from same query)
      engagementAvgTime: v.engagement_avg_ms ? v.engagement_avg_ms / 60000 : 0,
      engagementAvgTimeCT: v.engagement_avg_ct_ms ? v.engagement_avg_ct_ms / 60000 : 0,
      engagementsCumulative: v.engagements_cumulative || 0,
      engagementsPerVisit: 0,
      engagementsUnique: v.engagements_unique || 0,
      engagementRate: 0,
      engagementShare: 0,
      
      // Flow metrics
      draws: 0, drawRate: 0, drawShare: 0,
      exits: 0, exitRate: 0, exitShare: 0,
      bounces: 0, bounceRate: 0, bounceShare: 0,
      
      // Occupancy metrics
      peakOccupancy: 0, avgOccupancy: 0,
      
      // Conversion metrics
      conversions: 0, conversionRate: 0,
      attributedConversions: 0, attributedConversionRate: 0,
      conversionDrivers: 0, conversionDriverRate: 0,
      
      // Velocity metrics
      avgVelocity: 0, avgVelocityInMotion: 0,
      atRestTotalTime: 0, inMotionTotalTime: 0,
      percentAtRest: 0, percentInMotion: 0,
      
      // Group metrics
      groupVisits: 0, groupTimeSpent: 0, groupAvgTimeSpent: 0,
      groupConversions: 0, groupConversionRate: 0,
      
      // Utilization metrics
      utilizationTimeMin: 0, utilizationRate: 0,
      hourlyUtilization: 0, hourlyUtilizationRate: 0,
      dailyUtilization: false, dailyUtilizationRate: 0,
      
      // Time series data for charts
      visitsByHour: [], occupancyOverTime: [], dwellDistribution: [],
    };
    
    // 2) Lookup venue_id once (reused by flow + venueTotals)
    const roiInfo = S.roiVenueId.get(roiId);
    const venueId = roiInfo?.venue_id;
    
    // 3) Flow metrics (3 queries, but only if venue found)
    if (venueId) {
      const draws = S.flowDraws.get(venueId, startTime, endTime, roiId);
      const exits = S.flowExits.get(venueId, startTime, endTime, roiId);
      const bounces = S.flowBounces.get(venueId, roiId, startTime, endTime, startTime, endTime);
      kpis.draws = draws?.count || 0;
      kpis.exits = exits?.count || 0;
      kpis.bounces = bounces?.count || 0;
    }
    
    // 4) Combined occupancy + utilization (1 query instead of 3+)
    const occ = S.occupancyCombined.get(roiId, startTime, endTime) || {};
    kpis.peakOccupancy = occ.peak || 0;
    kpis.avgOccupancy = occ.avg_occ ? Math.round(occ.avg_occ * 100) / 100 : 0;
    
    // Utilization from same data
    const totalRangeMin = (endTime - startTime) / 60000;
    const samplingInterval = 5000;
    if (occ.total_samples > 0) {
      const utilizationTimeMin = (occ.occupied_samples * samplingInterval) / 60000;
      kpis.utilizationTimeMin = Math.round(utilizationTimeMin * 10) / 10;
      kpis.utilizationRate = totalRangeMin > 0 ? Math.round((utilizationTimeMin / totalRangeMin) * 1000) / 10 : 0;
    }
    
    // Hourly utilization (last hour in range)
    const hourAgo = Math.max(startTime, endTime - 60 * 60 * 1000);
    const hourlyOcc = S.hourlyOccupancy.get(roiId, hourAgo, endTime) || {};
    if (hourlyOcc.samples > 0) {
      kpis.hourlyUtilization = Math.round((hourlyOcc.occupied_samples * samplingInterval / 60000) * 10) / 10;
      kpis.hourlyUtilizationRate = Math.round((hourlyOcc.occupied_samples / hourlyOcc.samples) * 1000) / 10;
    }
    
    // Daily utilization check
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const dailyCheck = S.dailyVisitCheck.get(roiId, todayStart.getTime());
    kpis.dailyUtilization = (dailyCheck?.count || 0) > 0;
    kpis.dailyUtilizationRate = kpis.utilizationRate;
    
    // 5) Velocity via SQL aggregation (1 query, no row-level JS)
    const vel = S.velocityAgg.get(roiId, startTime, endTime) || {};
    if (vel.total_samples > 0) {
      // avg_speed_sq is avg of speed², use sqrt for approximate avg speed
      kpis.avgVelocity = vel.avg_speed_sq ? Math.round(Math.sqrt(vel.avg_speed_sq) * 100) / 100 : 0;
      kpis.avgVelocityInMotion = vel.avg_motion_speed_sq ? Math.round(Math.sqrt(vel.avg_motion_speed_sq) * 100) / 100 : 0;
      kpis.atRestTotalTime = (vel.at_rest_samples || 0) / 60;
      kpis.inMotionTotalTime = (vel.in_motion_samples || 0) / 60;
      kpis.percentAtRest = Math.round(((vel.at_rest_samples || 0) / vel.total_samples) * 100);
      kpis.percentInMotion = Math.round(((vel.in_motion_samples || 0) / vel.total_samples) * 100);
    }
    
    // 6) Time series data for charts
    kpis.visitsByHour = this.getVisitsByHour(roiId, startTime, endTime);
    kpis.occupancyOverTime = this.getOccupancyOverTime(roiId, startTime, endTime);
    kpis.dwellDistribution = this.getDwellDistribution(roiId, startTime, endTime);
    
    // 7) Calculate rates
    if (visits > 0) {
      kpis.dwellRate = (kpis.dwellsUnique / visits) * 100;
      kpis.engagementRate = (kpis.engagementsUnique / visits) * 100;
      kpis.drawRate = (kpis.draws / visits) * 100;
      kpis.exitRate = (kpis.exits / visits) * 100;
      kpis.bounceRate = (kpis.bounces / visits) * 100;
      kpis.dwellsPerVisit = kpis.dwellsCumulative / visits;
      kpis.engagementsPerVisit = kpis.engagementsCumulative / visits;
    }
    
    // 8) Venue-wide shares (1 query, reuses cached venueId)
    if (venueId) {
      const vt = S.venueTotals.get(venueId, startTime, endTime) || {};
      if (vt.total_dwells > 0) {
        kpis.dwellShare = (kpis.dwellsCumulative / vt.total_dwells) * 100;
        kpis.drawShare = (kpis.draws / vt.total_dwells) * 100;
        kpis.exitShare = (kpis.exits / vt.total_dwells) * 100;
      }
      if (vt.total_engagements > 0) {
        kpis.engagementShare = (kpis.engagementsCumulative / vt.total_engagements) * 100;
      }
    }
    
    return kpis;
  }

  /**
   * Get visit count for a zone (returns both unique visitors and total entries)
   */
  getVisits(roiId, startTime, endTime) {
    const result = this.db.prepare(`
      SELECT 
        COUNT(DISTINCT track_key) as unique_visitors,
        COUNT(*) as total_entries
      FROM zone_visits
      WHERE roi_id = ? AND start_time >= ? AND start_time < ?
    `).get(roiId, startTime, endTime);
    
    return {
      uniqueVisitors: result?.unique_visitors || 0,
      totalEntries: result?.total_entries || 0,
    };
  }

  /**
   * Get total time spent in zone (in minutes)
   */
  getTimeSpent(roiId, startTime, endTime) {
    const result = this.db.prepare(`
      SELECT SUM(duration_ms) as total_ms
      FROM zone_visits
      WHERE roi_id = ? AND start_time >= ? AND start_time < ?
    `).get(roiId, startTime, endTime);
    
    return result?.total_ms ? result.total_ms / 60000 : 0; // Convert to minutes
  }

  /**
   * Get dwell-related metrics
   */
  getDwellMetrics(roiId, startTime, endTime) {
    const result = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END) as dwells_cumulative,
        COUNT(DISTINCT CASE WHEN is_dwell = 1 THEN track_key END) as dwells_unique,
        AVG(CASE WHEN is_dwell = 1 THEN duration_ms END) as dwell_avg_ms,
        AVG(CASE WHEN is_dwell = 1 AND is_complete_track = 1 THEN duration_ms END) as dwell_avg_ct_ms
      FROM zone_visits
      WHERE roi_id = ? AND start_time >= ? AND start_time < ?
    `).get(roiId, startTime, endTime);
    
    return {
      dwellsCumulative: result?.dwells_cumulative || 0,
      dwellsUnique: result?.dwells_unique || 0,
      dwellAvgTime: result?.dwell_avg_ms ? result.dwell_avg_ms / 60000 : 0, // minutes
      dwellAvgTimeCT: result?.dwell_avg_ct_ms ? result.dwell_avg_ct_ms / 60000 : 0, // minutes
    };
  }

  /**
   * Get engagement-related metrics
   */
  getEngagementMetrics(roiId, startTime, endTime) {
    const result = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN is_engagement = 1 THEN 1 ELSE 0 END) as engagements_cumulative,
        COUNT(DISTINCT CASE WHEN is_engagement = 1 THEN track_key END) as engagements_unique,
        AVG(CASE WHEN is_engagement = 1 THEN duration_ms END) as engagement_avg_ms,
        AVG(CASE WHEN is_engagement = 1 AND is_complete_track = 1 THEN duration_ms END) as engagement_avg_ct_ms
      FROM zone_visits
      WHERE roi_id = ? AND start_time >= ? AND start_time < ?
    `).get(roiId, startTime, endTime);
    
    return {
      engagementsCumulative: result?.engagements_cumulative || 0,
      engagementsUnique: result?.engagements_unique || 0,
      engagementAvgTime: result?.engagement_avg_ms ? result.engagement_avg_ms / 60000 : 0,
      engagementAvgTimeCT: result?.engagement_avg_ct_ms ? result.engagement_avg_ct_ms / 60000 : 0,
    };
  }

  /**
   * Get flow metrics (draws, exits, bounces)
   */
  getFlowMetrics(roiId, startTime, endTime) {
    // Get venue_id for this ROI
    const roiInfo = this.db.prepare(`SELECT venue_id FROM regions_of_interest WHERE id = ?`).get(roiId);
    if (!roiInfo) return { draws: 0, exits: 0, bounces: 0 };
    
    const venueId = roiInfo.venue_id;
    
    // Draws: first dwell location for a visit
    const draws = this.db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT track_key, MIN(start_time) as first_dwell_time, roi_id
        FROM zone_visits
        WHERE venue_id = ? AND is_dwell = 1 AND start_time >= ? AND start_time < ?
        GROUP BY track_key
        HAVING roi_id = ?
      )
    `).get(venueId, startTime, endTime, roiId);
    
    // Exits: last dwell location before leaving venue (without conversion)
    const exits = this.db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT track_key, MAX(end_time) as last_dwell_time, roi_id
        FROM zone_visits
        WHERE venue_id = ? AND is_dwell = 1 AND start_time >= ? AND start_time < ?
          AND is_conversion = 0
        GROUP BY track_key
        HAVING roi_id = ?
      )
    `).get(venueId, startTime, endTime, roiId);
    
    // Bounces: only dwell in this zone, no dwells in other zones
    const bounces = this.db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT v1.track_key
        FROM zone_visits v1
        WHERE v1.venue_id = ? AND v1.roi_id = ? AND v1.is_dwell = 1
          AND v1.start_time >= ? AND v1.start_time < ?
          AND NOT EXISTS (
            SELECT 1 FROM zone_visits v2
            WHERE v2.track_key = v1.track_key
              AND v2.roi_id != v1.roi_id
              AND v2.is_dwell = 1
              AND v2.start_time >= ? AND v2.start_time < ?
          )
        GROUP BY v1.track_key
      )
    `).get(venueId, roiId, startTime, endTime, startTime, endTime);
    
    return {
      draws: draws?.count || 0,
      exits: exits?.count || 0,
      bounces: bounces?.count || 0,
    };
  }

  /**
   * Get occupancy metrics
   */
  getOccupancyMetrics(roiId, startTime, endTime) {
    const result = this.db.prepare(`
      SELECT 
        MAX(occupancy_count) as peak,
        AVG(occupancy_count) as avg,
        COUNT(*) as samples
      FROM zone_occupancy
      WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
    `).get(roiId, startTime, endTime);
    
    return {
      peakOccupancy: result?.peak || 0,
      avgOccupancy: result?.avg ? Math.round(result.avg * 100) / 100 : 0,
    };
  }

  /**
   * Get velocity metrics
   */
  getVelocityMetrics(roiId, startTime, endTime) {
    // Fetch raw velocity components and compute speed in JS (avoids SQRT dependency in SQLite)
    const rows = this.db.prepare(`
      SELECT velocity_x, velocity_z
      FROM track_positions
      WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
    `).all(roiId, startTime, endTime);
    
    const totalSamples = rows.length;
    if (totalSamples === 0) {
      return { avgVelocity: 0, avgVelocityInMotion: 0, atRestTotalTime: 0, inMotionTotalTime: 0, percentAtRest: 0, percentInMotion: 0 };
    }

    let sumSpeed = 0, sumSpeedMotion = 0, atRestSamples = 0, inMotionSamples = 0;
    for (const row of rows) {
      const vx = row.velocity_x || 0;
      const vz = row.velocity_z || 0;
      const speed = Math.sqrt(vx * vx + vz * vz);
      sumSpeed += speed;
      if (speed > 0.1) {
        sumSpeedMotion += speed;
        inMotionSamples++;
      } else {
        atRestSamples++;
      }
    }
    
    return {
      avgVelocity: Math.round((sumSpeed / totalSamples) * 100) / 100,
      avgVelocityInMotion: inMotionSamples > 0 ? Math.round((sumSpeedMotion / inMotionSamples) * 100) / 100 : 0,
      atRestTotalTime: atRestSamples / 60,
      inMotionTotalTime: inMotionSamples / 60,
      percentAtRest: Math.round((atRestSamples / totalSamples) * 100),
      percentInMotion: Math.round((inMotionSamples / totalSamples) * 100),
    };
  }

  /**
   * Get venue-wide totals for share calculations
   */
  getVenueTotals(roiId, startTime, endTime) {
    const roiInfo = this.db.prepare(`SELECT venue_id FROM regions_of_interest WHERE id = ?`).get(roiId);
    if (!roiInfo) return { totalDwells: 0, totalEngagements: 0, totalDraws: 0, totalExits: 0, totalBounces: 0 };
    
    const result = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END) as total_dwells,
        SUM(CASE WHEN is_engagement = 1 THEN 1 ELSE 0 END) as total_engagements
      FROM zone_visits
      WHERE venue_id = ? AND start_time >= ? AND start_time < ?
    `).get(roiInfo.venue_id, startTime, endTime);
    
    return {
      totalDwells: result?.total_dwells || 0,
      totalEngagements: result?.total_engagements || 0,
      totalDraws: result?.total_dwells || 0, // Approximation
      totalExits: result?.total_dwells || 0, // Approximation
      totalBounces: 0, // Would need more complex calculation
    };
  }

  /**
   * Get visits grouped by hour for chart
   */
  getVisitsByHour(roiId, startTime, endTime) {
    const results = this.db.prepare(`
      SELECT 
        strftime('%H', datetime(start_time/1000, 'unixepoch', 'localtime')) as hour,
        COUNT(DISTINCT track_key) as visits
      FROM zone_visits
      WHERE roi_id = ? AND start_time >= ? AND start_time < ?
      GROUP BY hour
      ORDER BY hour
    `).all(roiId, startTime, endTime);
    
    // Fill in all 24 hours
    const hourlyData = Array.from({ length: 24 }, (_, i) => ({
      hour: i.toString().padStart(2, '0'),
      visits: 0,
    }));
    
    for (const row of results) {
      const hourIndex = parseInt(row.hour);
      if (hourIndex >= 0 && hourIndex < 24) {
        hourlyData[hourIndex].visits = row.visits;
      }
    }
    
    return hourlyData;
  }

  /**
   * Get occupancy over time for chart
   */
  getOccupancyOverTime(roiId, startTime, endTime) {
    // Aggregate by 15-minute intervals
    const interval = 15 * 60 * 1000; // 15 minutes in ms
    
    const results = this.db.prepare(`
      SELECT 
        (timestamp / ?) * ? as time_bucket,
        AVG(occupancy_count) as avg_occupancy,
        MAX(occupancy_count) as max_occupancy
      FROM zone_occupancy
      WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
      GROUP BY time_bucket
      ORDER BY time_bucket
    `).all(interval, interval, roiId, startTime, endTime);
    
    return results.map(row => ({
      timestamp: row.time_bucket,
      avgOccupancy: Math.round(row.avg_occupancy * 10) / 10,
      maxOccupancy: row.max_occupancy,
    }));
  }

  /**
   * Get dwell time distribution for chart
   */
  getDwellDistribution(roiId, startTime, endTime) {
    const results = this.db.prepare(`
      SELECT 
        CASE 
          WHEN duration_ms < 30000 THEN '0-30s'
          WHEN duration_ms < 60000 THEN '30-60s'
          WHEN duration_ms < 120000 THEN '1-2m'
          WHEN duration_ms < 300000 THEN '2-5m'
          WHEN duration_ms < 600000 THEN '5-10m'
          ELSE '10m+'
        END as duration_bucket,
        COUNT(*) as count
      FROM zone_visits
      WHERE roi_id = ? AND start_time >= ? AND start_time < ?
      GROUP BY duration_bucket
    `).all(roiId, startTime, endTime);
    
    // Ensure all buckets are present
    const buckets = ['0-30s', '30-60s', '1-2m', '2-5m', '5-10m', '10m+'];
    const distribution = buckets.map(bucket => ({
      bucket,
      count: 0,
    }));
    
    for (const row of results) {
      const idx = buckets.indexOf(row.duration_bucket);
      if (idx >= 0) {
        distribution[idx].count = row.count;
      }
    }
    
    return distribution;
  }

  /**
   * Get comparison data between multiple zones
   */
  getZoneComparison(roiIds, startTime, endTime) {
    const comparison = [];
    
    for (const roiId of roiIds) {
      const kpis = this.getZoneKPIs(roiId, startTime, endTime);
      const roiInfo = this.db.prepare(`SELECT name, color FROM regions_of_interest WHERE id = ?`).get(roiId);
      
      comparison.push({
        roiId,
        name: roiInfo?.name || roiId,
        color: roiInfo?.color || '#888888',
        visits: kpis.visits,
        avgTimeSpent: kpis.avgTimeSpent,
        dwellRate: kpis.dwellRate,
        engagementRate: kpis.engagementRate,
        peakOccupancy: kpis.peakOccupancy,
      });
    }
    
    return comparison;
  }

  /**
   * Get real-time KPIs for live dashboard
   */
  getRealTimeKPIs(venueId) {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    // Get all ROIs for this venue
    const rois = this.db.prepare(`SELECT id, name, color FROM regions_of_interest WHERE venue_id = ?`).all(venueId);
    
    const realTimeData = [];
    
    for (const roi of rois) {
      // Get current occupancy (last 5 seconds)
      const currentOccupancy = this.db.prepare(`
        SELECT occupancy_count FROM zone_occupancy
        WHERE roi_id = ? AND timestamp > ?
        ORDER BY timestamp DESC LIMIT 1
      `).get(roi.id, now - 5000);
      
      // Get last hour visits
      const lastHourVisits = this.getVisits(roi.id, oneHourAgo, now);
      
      realTimeData.push({
        roiId: roi.id,
        name: roi.name,
        color: roi.color,
        currentOccupancy: currentOccupancy?.occupancy_count || 0,
        visitsLastHour: lastHourVisits,
      });
    }
    
    return realTimeData;
  }

  /**
   * Get utilization metrics for a zone
   * Measures how efficiently the zone space is being used over time
   */
  getUtilizationMetrics(roiId, startTime, endTime) {
    // Calculate total time range in minutes
    const totalRangeMs = endTime - startTime;
    const totalRangeMin = totalRangeMs / 60000;
    
    // Get time intervals where zone had at least 1 person
    // Using occupancy data sampled every few seconds
    const occupancyData = this.db.prepare(`
      SELECT 
        timestamp,
        occupancy_count
      FROM zone_occupancy
      WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `).all(roiId, startTime, endTime);
    
    // Calculate utilization time (time with occupancy > 0)
    let utilizationTimeMs = 0;
    let lastTimestamp = null;
    let lastOccupied = false;
    const samplingInterval = 5000; // Assume 5-second sampling
    
    for (const sample of occupancyData) {
      const isOccupied = sample.occupancy_count > 0;
      
      if (lastTimestamp !== null && lastOccupied) {
        // Add time since last sample if it was occupied
        const timeDiff = Math.min(sample.timestamp - lastTimestamp, samplingInterval * 2);
        utilizationTimeMs += timeDiff;
      }
      
      lastTimestamp = sample.timestamp;
      lastOccupied = isOccupied;
    }
    
    // Add final interval if still occupied
    if (lastOccupied && lastTimestamp !== null) {
      utilizationTimeMs += samplingInterval;
    }
    
    const utilizationTimeMin = utilizationTimeMs / 60000;
    const utilizationRate = totalRangeMin > 0 ? (utilizationTimeMin / totalRangeMin) * 100 : 0;
    
    // Calculate hourly utilization (for the most recent hour in range)
    const hourAgo = Math.max(startTime, endTime - 60 * 60 * 1000);
    const hourlyOccupancy = this.db.prepare(`
      SELECT 
        COUNT(*) as samples,
        SUM(CASE WHEN occupancy_count > 0 THEN 1 ELSE 0 END) as occupied_samples
      FROM zone_occupancy
      WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
    `).get(roiId, hourAgo, endTime);
    
    const hourlyUtilizationMin = hourlyOccupancy?.occupied_samples 
      ? (hourlyOccupancy.occupied_samples * samplingInterval) / 60000 
      : 0;
    const hourlyUtilizationRate = hourlyOccupancy?.samples > 0 
      ? (hourlyOccupancy.occupied_samples / hourlyOccupancy.samples) * 100 
      : 0;
    
    // Daily utilization (was zone used at all today?)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    
    const dailyCheck = this.db.prepare(`
      SELECT COUNT(*) as count FROM zone_visits
      WHERE roi_id = ? AND start_time >= ?
    `).get(roiId, todayStartMs);
    
    const dailyUtilization = (dailyCheck?.count || 0) > 0;
    
    // Assuming 12-hour store operating day for daily rate calculation
    const operatingHours = 12;
    const dailyUtilizationRate = utilizationRate; // Same as overall for the selected range
    
    return {
      utilizationTimeMin: Math.round(utilizationTimeMin * 10) / 10,
      utilizationRate: Math.round(utilizationRate * 10) / 10,
      hourlyUtilization: Math.round(hourlyUtilizationMin * 10) / 10,
      hourlyUtilizationRate: Math.round(hourlyUtilizationRate * 10) / 10,
      dailyUtilization,
      dailyUtilizationRate: Math.round(dailyUtilizationRate * 10) / 10,
    };
  }

  /**
   * Get daily summary for all zones
   */
  getDailySummary(venueId, date) {
    const results = this.db.prepare(`
      SELECT 
        k.*,
        r.name as roi_name,
        r.color as roi_color
      FROM zone_kpi_daily k
      JOIN regions_of_interest r ON k.roi_id = r.id
      WHERE k.venue_id = ? AND k.date = ?
    `).all(venueId, date);
    
    return results.map(row => ({
      roiId: row.roi_id,
      roiName: row.roi_name,
      roiColor: row.roi_color,
      date: row.date,
      visits: row.visits,
      timeSpentMin: row.time_spent_ms / 60000,
      avgTimeSpentMin: row.visits > 0 ? (row.time_spent_ms / row.visits) / 60000 : 0,
      dwellsCumulative: row.dwells_cumulative,
      dwellsUnique: row.dwells_unique,
      dwellRate: row.visits > 0 ? (row.dwells_unique / row.visits) * 100 : 0,
      engagementsCumulative: row.engagements_cumulative,
      engagementsUnique: row.engagements_unique,
      engagementRate: row.visits > 0 ? (row.engagements_unique / row.visits) * 100 : 0,
      peakOccupancy: row.peak_occupancy,
      avgOccupancy: row.total_occupancy_samples > 0 ? row.sum_occupancy / row.total_occupancy_samples : 0,
    }));
  }
}

export default KPICalculator;
