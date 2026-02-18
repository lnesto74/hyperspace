/**
 * BaselineTracker
 * 
 * Computes and maintains rolling baselines for episode detection thresholding.
 * Uses percentile + IQR approach to avoid fixed-value tuning.
 * 
 * Reads from main Hyperspace DB (read-only), writes baselines to EpisodeStore.
 */

/**
 * Compute median of a sorted array
 */
function median(sorted) {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Compute IQR (interquartile range) of a sorted array
 */
function iqr(sorted) {
  if (sorted.length < 4) return 0;
  const mid = Math.floor(sorted.length / 2);
  const q1 = median(sorted.slice(0, mid));
  const q3 = median(sorted.slice(mid + (sorted.length % 2 !== 0 ? 1 : 0)));
  return q3 - q1;
}

/**
 * Compute mean and standard deviation
 */
function meanAndStd(values) {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) };
}

/**
 * Compute z-score relative to baseline
 */
export function zScore(value, baselineMean, baselineStd) {
  if (baselineStd === 0 || baselineStd == null) return 0;
  return (value - baselineMean) / baselineStd;
}

/**
 * Check if a value is a spike relative to baseline (median + 2*IQR)
 */
export function isSpike(value, baselineMedian, baselineIqr, multiplier = 2) {
  if (baselineIqr === 0 || baselineIqr == null) {
    // Fallback: use 50% above median as spike threshold
    return value > baselineMedian * 1.5;
  }
  return value > baselineMedian + multiplier * baselineIqr;
}

/**
 * Check if a value is a dip relative to baseline (median - 2*IQR)
 */
export function isDip(value, baselineMedian, baselineIqr, multiplier = 2) {
  if (baselineIqr === 0 || baselineIqr == null) {
    return value < baselineMedian * 0.5;
  }
  return value < baselineMedian - multiplier * baselineIqr;
}

/**
 * Compute confidence score for an episode detection
 * @param {Object} params
 * @param {number} params.conditionsSatisfied - How many evidence conditions were met
 * @param {number} params.conditionsTotal - Total possible evidence conditions
 * @param {number} params.deviationZscore - Z-score of the main metric deviation
 * @param {number} params.tracksAffected - Number of unique tracks involved
 * @param {number} params.minPopulation - Minimum population threshold
 * @returns {number} 0-1 confidence score
 */
export function computeConfidence({ conditionsSatisfied, conditionsTotal, deviationZscore, tracksAffected, minPopulation }) {
  const conditionScore = conditionsTotal > 0 ? conditionsSatisfied / conditionsTotal : 0;
  const deviationScore = Math.min(1, Math.abs(deviationZscore || 0) / 4);
  const populationScore = Math.min(1, (tracksAffected || 0) / (minPopulation * 3));
  return conditionScore * 0.4 + deviationScore * 0.35 + populationScore * 0.25;
}

/**
 * Minimum population thresholds
 */
export const MIN_POPULATION = {
  global: 20,
  zone: 8,
  display: 5,
};

export class BaselineTracker {
  /**
   * @param {import('better-sqlite3').Database} mainDb - Main Hyperspace DB (read-only)
   * @param {import('./EpisodeStore.js').EpisodeStore} episodeStore - Episode store for baseline persistence
   */
  constructor(mainDb, episodeStore) {
    this.mainDb = mainDb;
    this.episodeStore = episodeStore;
  }

  /**
   * Update baselines for a venue using historical data from the main DB.
   * Computes rolling statistics from zone_kpi_hourly and queue_sessions.
   * @param {string} venueId
   */
  updateBaselines(venueId) {
    const now = Date.now();
    const lookbackDays = 7;
    const startDate = new Date(now - lookbackDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    this._updateQueueBaselines(venueId, startDate, now);
    this._updateZoneBaselines(venueId, startDate, now);
    this._updateStoreBaselines(venueId, startDate, now);
  }

  /**
   * Get baseline for a specific metric, with optional time-of-day awareness
   */
  getBaseline(venueId, scope, scopeId, metric, hourOfDay = null) {
    const baseline = this.episodeStore.getBaseline(venueId, scope, scopeId, metric, hourOfDay);
    if (baseline) return baseline;
    // Fallback to non-hour-specific baseline
    if (hourOfDay !== null) {
      return this.episodeStore.getBaseline(venueId, scope, scopeId, metric, null);
    }
    return null;
  }

  /**
   * Evaluate a metric value against its baseline
   * @returns {{ isSpike: boolean, isDip: boolean, zscore: number, baseline: Object|null }}
   */
  evaluate(venueId, scope, scopeId, metric, value, hourOfDay = null) {
    const baseline = this.getBaseline(venueId, scope, scopeId, metric, hourOfDay);
    if (!baseline || baseline.sample_count < 3) {
      return { isSpike: false, isDip: false, zscore: 0, baseline: null, insufficientData: true };
    }

    const z = zScore(value, baseline.rolling_mean, baseline.rolling_std);
    return {
      isSpike: isSpike(value, baseline.rolling_median, baseline.rolling_iqr),
      isDip: isDip(value, baseline.rolling_median, baseline.rolling_iqr),
      zscore: z,
      baseline,
      insufficientData: false,
    };
  }

  // ─── Queue Baselines ───

  _updateQueueBaselines(venueId, startDate, now) {
    try {
      // Avg wait time per hour from queue_sessions
      const sessions = this.mainDb.prepare(`
        SELECT 
          queue_zone_id,
          CAST(strftime('%H', datetime(queue_entry_time / 1000, 'unixepoch')) AS INTEGER) as hour,
          waiting_time_ms
        FROM queue_sessions
        WHERE venue_id = ? AND queue_entry_time >= ? AND is_abandoned = 0
        ORDER BY queue_entry_time
      `).all(venueId, new Date(startDate).getTime());

      if (sessions.length === 0) return;

      // Group by queue zone
      const byZone = new Map();
      const globalWaits = [];

      for (const s of sessions) {
        if (s.waiting_time_ms == null) continue;
        globalWaits.push(s.waiting_time_ms);

        if (!byZone.has(s.queue_zone_id)) {
          byZone.set(s.queue_zone_id, []);
        }
        byZone.get(s.queue_zone_id).push(s.waiting_time_ms);
      }

      // Global queue wait baseline
      this._computeAndStoreBaseline(venueId, 'global', null, 'queue_wait_time_ms', globalWaits, now);

      // Per-zone queue wait baseline
      for (const [zoneId, waits] of byZone) {
        this._computeAndStoreBaseline(venueId, 'zone', zoneId, 'queue_wait_time_ms', waits, now);
      }

      // Queue arrival rate (sessions per hour)
      const hourlyArrivals = new Map();
      for (const s of sessions) {
        const hourKey = `${s.queue_zone_id}:${s.hour}`;
        hourlyArrivals.set(hourKey, (hourlyArrivals.get(hourKey) || 0) + 1);
      }
      const arrivalCounts = [...hourlyArrivals.values()];
      this._computeAndStoreBaseline(venueId, 'global', null, 'queue_arrival_rate', arrivalCounts, now);

      // Abandonment rate baseline
      const allSessions = this.mainDb.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN is_abandoned = 1 THEN 1 ELSE 0 END) as abandoned
        FROM queue_sessions
        WHERE venue_id = ? AND queue_entry_time >= ?
      `).get(venueId, new Date(startDate).getTime());

      if (allSessions && allSessions.total > 0) {
        const rate = allSessions.abandoned / allSessions.total;
        this._computeAndStoreBaseline(venueId, 'global', null, 'queue_abandonment_rate', [rate], now);
      }

    } catch (err) {
      console.warn('[BaselineTracker] Queue baseline error:', err.message);
    }
  }

  // ─── Zone / Shelf Baselines ───

  _updateZoneBaselines(venueId, startDate, now) {
    try {
      const hourlyData = this.mainDb.prepare(`
        SELECT roi_id, hour, visits, dwells, engagements, peak_occupancy, avg_occupancy
        FROM zone_kpi_hourly
        WHERE venue_id = ? AND date >= ?
        ORDER BY date, hour
      `).all(venueId, startDate);

      if (hourlyData.length === 0) return;

      const byZone = new Map();
      for (const row of hourlyData) {
        if (!byZone.has(row.roi_id)) {
          byZone.set(row.roi_id, { visits: [], dwells: [], engagements: [], occupancy: [] });
        }
        const z = byZone.get(row.roi_id);
        z.visits.push(row.visits || 0);
        z.dwells.push(row.dwells || 0);
        z.engagements.push(row.engagements || 0);
        z.occupancy.push(row.peak_occupancy || 0);
      }

      for (const [zoneId, data] of byZone) {
        this._computeAndStoreBaseline(venueId, 'zone', zoneId, 'hourly_visits', data.visits, now);
        this._computeAndStoreBaseline(venueId, 'zone', zoneId, 'hourly_dwells', data.dwells, now);
        this._computeAndStoreBaseline(venueId, 'zone', zoneId, 'hourly_engagements', data.engagements, now);
        this._computeAndStoreBaseline(venueId, 'zone', zoneId, 'peak_occupancy', data.occupancy, now);
      }

      // Pass-by rate per zone (visits where is_dwell=0 / total visits)
      const visitData = this.mainDb.prepare(`
        SELECT 
          roi_id,
          COUNT(*) as total_visits,
          SUM(CASE WHEN is_dwell = 0 THEN 1 ELSE 0 END) as passby_count,
          SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END) as dwell_count,
          SUM(CASE WHEN is_engagement = 1 THEN 1 ELSE 0 END) as engagement_count
        FROM zone_visits
        WHERE venue_id = ? AND start_time >= ?
        GROUP BY roi_id
      `).all(venueId, new Date(startDate).getTime());

      for (const row of visitData) {
        if (row.total_visits > 0) {
          const passbyRate = row.passby_count / row.total_visits;
          const browseRate = row.dwell_count / row.total_visits;
          this._computeAndStoreBaseline(venueId, 'zone', row.roi_id, 'passby_rate', [passbyRate], now);
          this._computeAndStoreBaseline(venueId, 'zone', row.roi_id, 'browse_rate', [browseRate], now);
        }
      }

    } catch (err) {
      console.warn('[BaselineTracker] Zone baseline error:', err.message);
    }
  }

  // ─── Store-level Baselines ───

  _updateStoreBaselines(venueId, startDate, now) {
    try {
      // Average visit duration across all zones per track (proxy for store visit time)
      const dailyData = this.mainDb.prepare(`
        SELECT date, SUM(visits) as total_visits, SUM(time_spent_ms) as total_time
        FROM zone_kpi_daily
        WHERE venue_id = ? AND date >= ?
        GROUP BY date
      `).all(venueId, startDate);

      const dailyAvgVisitTimes = dailyData
        .filter(d => d.total_visits > 0)
        .map(d => d.total_time / d.total_visits);

      if (dailyAvgVisitTimes.length > 0) {
        this._computeAndStoreBaseline(venueId, 'global', null, 'avg_visit_duration_ms', dailyAvgVisitTimes, now);
      }

      // Total venue occupancy baseline
      const occupancyData = this.mainDb.prepare(`
        SELECT timestamp, occupancy_count
        FROM zone_occupancy
        WHERE venue_id = ? AND timestamp >= ?
        ORDER BY timestamp
      `).all(venueId, new Date(startDate).getTime());

      if (occupancyData.length > 0) {
        const counts = occupancyData.map(o => o.occupancy_count);
        this._computeAndStoreBaseline(venueId, 'global', null, 'venue_occupancy', counts, now);
      }

    } catch (err) {
      console.warn('[BaselineTracker] Store baseline error:', err.message);
    }
  }

  // ─── Helpers ───

  _computeAndStoreBaseline(venueId, scope, scopeId, metric, values, now) {
    if (values.length === 0) return;

    const sorted = [...values].sort((a, b) => a - b);
    const med = median(sorted);
    const interquartile = iqr(sorted);
    const { mean: m, std: s } = meanAndStd(values);

    this.episodeStore.upsertBaseline({
      venue_id: venueId,
      scope,
      scope_id: scopeId,
      metric,
      hour_of_day: null,
      day_of_week: null,
      rolling_median: med,
      rolling_iqr: interquartile,
      rolling_mean: m,
      rolling_std: s,
      sample_count: values.length,
      last_updated: now,
    });
  }
}

export default BaselineTracker;
