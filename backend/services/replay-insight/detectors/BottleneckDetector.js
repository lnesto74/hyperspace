/**
 * E11 — BOTTLENECK_CORRIDOR (Congestion point)
 * 
 * Trigger: occupancy or dwell spikes in a corridor/transition zone,
 *          speed drops + high density
 * 
 * KPIs: Occupancy Rate, Avg Dwell Time (zone), impacts Browsing Rate elsewhere
 */

import { computeConfidence, MIN_POPULATION } from '../BaselineTracker.js';

const EPISODE_TYPE = 'BOTTLENECK_CORRIDOR';
const WINDOW_MS = 15 * 60 * 1000;

export class BottleneckDetector {
  constructor(mainDb, baselineTracker) {
    this.mainDb = mainDb;
    this.baselineTracker = baselineTracker;
  }

  detect(venueId, startTs, endTs) {
    const episodes = [];

    // Get all zones
    const zones = this._getAllZones(venueId);
    if (zones.length === 0) return episodes;

    for (const zone of zones) {
      const zoneEpisodes = this._detectForZone(venueId, zone, startTs, endTs);
      episodes.push(...zoneEpisodes);
    }

    return episodes;
  }

  _detectForZone(venueId, zone, startTs, endTs) {
    const episodes = [];

    for (let windowStart = startTs; windowStart < endTs - WINDOW_MS; windowStart += WINDOW_MS / 2) {
      const windowEnd = windowStart + WINDOW_MS;

      // Get occupancy snapshots for this zone in this window
      const occupancy = this.mainDb.prepare(`
        SELECT timestamp, occupancy_count
        FROM zone_occupancy
        WHERE venue_id = ? AND roi_id = ? AND timestamp >= ? AND timestamp < ?
        ORDER BY timestamp
      `).all(venueId, zone.id, windowStart, windowEnd);

      // Get visits for dwell analysis
      const visits = this.mainDb.prepare(`
        SELECT track_key, duration_ms, is_dwell, start_time
        FROM zone_visits
        WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND start_time < ?
      `).all(venueId, zone.id, windowStart, windowEnd);

      if (visits.length < MIN_POPULATION.zone) continue;

      // Peak and average occupancy in window
      const occupancyCounts = occupancy.map(o => o.occupancy_count);
      const peakOcc = occupancyCounts.length > 0 ? Math.max(...occupancyCounts) : 0;
      const avgOcc = occupancyCounts.length > 0
        ? occupancyCounts.reduce((a, b) => a + b, 0) / occupancyCounts.length
        : 0;

      // Average dwell time (all visits, not just dwells)
      const avgDwell = visits.reduce((sum, v) => sum + v.duration_ms, 0) / visits.length;

      // Short visits ratio (people passing through quickly = not a bottleneck)
      // High dwell + high occupancy = bottleneck
      const longVisits = visits.filter(v => v.duration_ms > 30000); // >30s
      const longVisitRatio = longVisits.length / visits.length;

      const uniqueTracks = new Set(visits.map(v => v.track_key)).size;

      // HARD GATES for congestion:
      // 1. Meaningful peak occupancy (not just 1-2 people)
      // 2. People actually dwelling (not just passing through quickly)
      const MIN_PEAK_OCCUPANCY = 3;
      const MIN_AVG_DWELL_MS = 20000; // 20 seconds minimum avg dwell
      const MIN_LONG_VISIT_RATIO = 0.15; // At least 15% staying >30s

      if (peakOcc < MIN_PEAK_OCCUPANCY) continue;
      if (avgDwell < MIN_AVG_DWELL_MS && longVisitRatio < MIN_LONG_VISIT_RATIO) continue;

      // Evaluate against baselines
      const occEval = this.baselineTracker.evaluate(venueId, 'zone', zone.id, 'peak_occupancy', peakOcc);

      let conditionsMet = 0;
      const conditionsTotal = 3;

      // Occupancy spike (required for congestion)
      const hasOccupancySpike = occEval.isSpike || peakOcc >= 5;
      if (hasOccupancySpike) conditionsMet++;
      // Elevated dwell (people stuck, not just passing)
      if (longVisitRatio > 0.3 && avgDwell > 30000) conditionsMet++; // >30% staying >30s, avg >30s
      // High density relative to zone traffic
      if (uniqueTracks >= MIN_POPULATION.zone * 2) conditionsMet++;

      // Must have occupancy spike + elevated dwell (both required for true congestion)
      if (!hasOccupancySpike || conditionsMet < 2) continue;

      const confidence = computeConfidence({
        conditionsSatisfied: conditionsMet,
        conditionsTotal,
        deviationZscore: occEval.zscore,
        tracksAffected: uniqueTracks,
        minPopulation: MIN_POPULATION.zone,
      });

      const zoneName = zone.name || zone.id.substring(0, 8);

      const repTracks = longVisits
        .sort((a, b) => b.duration_ms - a.duration_ms)
        .slice(0, 5)
        .map(v => v.track_key);

      episodes.push({
        id: `ep-${EPISODE_TYPE}-${windowStart}-${zone.id.substring(0, 8)}`,
        venue_id: venueId,
        episode_type: EPISODE_TYPE,
        start_ts: windowStart,
        end_ts: windowEnd,
        scope: 'zone',
        entities: {
          zone_ids: [zone.id],
          queue_zone_ids: [],
          display_ids: [],
        },
        features: {
          zone_name: zoneName,
          peak_occupancy: peakOcc,
          avg_occupancy: Math.round(avgOcc * 10) / 10,
          avg_dwell_ms: Math.round(avgDwell),
          long_visit_ratio: Math.round(longVisitRatio * 1000) / 1000,
          total_visits: visits.length,
          unique_tracks: uniqueTracks,
        },
        kpi_deltas: {
          peakOccupancy: {
            value: peakOcc,
            unit: 'people',
            baseline: occEval.baseline ? Math.round(occEval.baseline.rolling_median) : null,
            direction: 'up',
          },
          avgDwellTime: {
            value: Math.round(avgDwell / 1000),
            unit: 'seconds',
            direction: 'up',
          },
        },
        confidence,
        title: `Congestion detected in ${zoneName}`,
        business_summary: `Peak occupancy reached ${peakOcc} people in ${zoneName} with average dwell of ${Math.round(avgDwell / 1000)}s. ${Math.round(longVisitRatio * 100)}% of visitors stayed longer than 30s, indicating a movement bottleneck that may reduce browsing in adjacent areas.`,
        recommended_actions: [
          `Review layout and flow paths through ${zoneName}`,
          'Consider widening aisles or repositioning displays to reduce congestion',
          'Monitor impact on adjacent zone engagement',
        ],
        representative_tracks: repTracks,
      });
    }

    return episodes;
  }

  _getAllZones(venueId) {
    try {
      return this.mainDb.prepare(`
        SELECT id, name, color FROM regions_of_interest WHERE venue_id = ?
      `).all(venueId);
    } catch {
      return [];
    }
  }
}

export default BottleneckDetector;
