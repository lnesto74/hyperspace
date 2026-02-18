/**
 * E2 — LANE_UNDERSUPPLY (Demand > capacity)
 * E3 — LANE_OVERSUPPLY (Capacity wasted)
 * 
 * E2 Trigger: arrival_rate high AND throughput flat/low, avgOpenLanes low
 * E3 Trigger: avgOpenLanes high but in_queue_avg near zero, throughput per lane low
 * 
 * KPIs: avgOpenLanes, peakOpenLanes, queueWaitTime, maxWaitTime, queueThroughput
 */

import { computeConfidence, MIN_POPULATION } from '../BaselineTracker.js';

const WINDOW_MS = 15 * 60 * 1000;

export class LaneSupplyDetector {
  constructor(mainDb, baselineTracker) {
    this.mainDb = mainDb;
    this.baselineTracker = baselineTracker;
  }

  detect(venueId, startTs, endTs) {
    const episodes = [];

    // Get queue sessions
    const sessions = this.mainDb.prepare(`
      SELECT 
        id, track_key, queue_zone_id, service_zone_id,
        queue_entry_time, queue_exit_time, waiting_time_ms,
        service_entry_time, service_exit_time, service_time_ms,
        is_complete, is_abandoned
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
      ORDER BY queue_entry_time
    `).all(venueId, startTs, endTs);

    if (sessions.length < MIN_POPULATION.zone) return episodes;

    // Get lane configuration
    const laneInfo = this._getLaneInfo(venueId);
    const totalLanes = laneInfo.total;
    const openLanes = laneInfo.open;

    if (totalLanes === 0) return episodes;

    // Slide detection windows
    for (let windowStart = startTs; windowStart < endTs - WINDOW_MS; windowStart += WINDOW_MS / 2) {
      const windowEnd = windowStart + WINDOW_MS;

      const windowSessions = sessions.filter(
        s => s.queue_entry_time >= windowStart && s.queue_entry_time < windowEnd
      );

      if (windowSessions.length < MIN_POPULATION.zone) continue;

      // Arrival rate (sessions entering queue per minute)
      const arrivalRate = windowSessions.length / (WINDOW_MS / 60000);

      // Throughput (completed sessions per minute)
      const completed = windowSessions.filter(s => s.is_complete || s.queue_exit_time).length;
      const throughput = completed / (WINDOW_MS / 60000);

      // Wait times
      const waitTimes = windowSessions
        .filter(s => s.waiting_time_ms != null && s.waiting_time_ms > 0)
        .map(s => s.waiting_time_ms);
      const avgWait = waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;
      const maxWait = waitTimes.length > 0 ? Math.max(...waitTimes) : 0;

      // Peak simultaneous occupancy
      const peakOccupancy = this._estimatePeakOccupancy(windowSessions);

      const uniqueTracks = new Set(windowSessions.map(s => s.track_key)).size;

      // Throughput per lane
      const throughputPerLane = openLanes > 0 ? throughput / openLanes : 0;

      // ─── E2: LANE_UNDERSUPPLY ───
      {
        let conditionsMet = 0;
        const conditionsTotal = 3;

        // High arrival rate relative to throughput
        if (arrivalRate > throughput * 1.3) conditionsMet++;
        // Open lanes not scaling with demand
        if (openLanes < totalLanes * 0.7 && peakOccupancy > openLanes * 2) conditionsMet++;
        // Wait time elevated
        const waitEval = this.baselineTracker.evaluate(venueId, 'global', null, 'queue_wait_time_ms', avgWait);
        if (waitEval.isSpike || avgWait > 90000) conditionsMet++; // 90s threshold

        if (conditionsMet >= 2) {
          const confidence = computeConfidence({
            conditionsSatisfied: conditionsMet,
            conditionsTotal,
            deviationZscore: waitEval.zscore,
            tracksAffected: uniqueTracks,
            minPopulation: MIN_POPULATION.global,
          });

          const repTracks = windowSessions
            .filter(s => s.waiting_time_ms != null)
            .sort((a, b) => b.waiting_time_ms - a.waiting_time_ms)
            .slice(0, 5)
            .map(s => s.track_key);

          episodes.push({
            id: `ep-LANE_UNDERSUPPLY-${windowStart}-${venueId.substring(0, 8)}`,
            venue_id: venueId,
            episode_type: 'LANE_UNDERSUPPLY',
            start_ts: windowStart,
            end_ts: windowEnd,
            scope: 'global',
            entities: {
              zone_ids: [],
              queue_zone_ids: [...new Set(windowSessions.map(s => s.queue_zone_id))],
              display_ids: [],
            },
            features: {
              arrival_rate_per_min: Math.round(arrivalRate * 100) / 100,
              throughput_per_min: Math.round(throughput * 100) / 100,
              open_lanes: openLanes,
              total_lanes: totalLanes,
              avg_wait_ms: Math.round(avgWait),
              max_wait_ms: Math.round(maxWait),
              peak_occupancy: peakOccupancy,
              unique_tracks: uniqueTracks,
            },
            kpi_deltas: {
              avgOpenLanes: { value: openLanes, unit: 'lanes', direction: 'flat' },
              queueWaitTime: { value: Math.round(avgWait / 1000), unit: 'seconds', direction: 'up' },
              maxWaitTime: { value: Math.round(maxWait / 1000), unit: 'seconds', direction: 'up' },
              queueThroughput: { value: Math.round(throughput * 100) / 100, unit: 'per_minute', direction: 'down' },
            },
            confidence,
            title: 'Lane availability did not scale with traffic',
            business_summary: `${openLanes} of ${totalLanes} lanes open while ${uniqueTracks} shoppers queued. Arrival rate (${Math.round(arrivalRate * 10) / 10}/min) outpaced throughput (${Math.round(throughput * 10) / 10}/min). Average wait: ${Math.round(avgWait / 1000)}s.`,
            recommended_actions: [
              'Increase open lane count during peak demand periods',
              'Consider dynamic lane management based on queue depth',
            ],
            representative_tracks: repTracks,
          });
        }
      }

      // ─── E3: LANE_OVERSUPPLY ───
      {
        let conditionsMet = 0;
        const conditionsTotal = 3;

        // Many lanes open but low occupancy
        if (openLanes > totalLanes * 0.7 && peakOccupancy < openLanes * 0.3) conditionsMet++;
        // Low throughput per lane
        if (throughputPerLane < 0.5) conditionsMet++; // Less than 1 person per 2 minutes per lane
        // Low arrival rate
        if (arrivalRate < openLanes * 0.3) conditionsMet++;

        if (conditionsMet >= 2) {
          const confidence = computeConfidence({
            conditionsSatisfied: conditionsMet,
            conditionsTotal,
            deviationZscore: 0,
            tracksAffected: uniqueTracks,
            minPopulation: MIN_POPULATION.zone,
          });

          episodes.push({
            id: `ep-LANE_OVERSUPPLY-${windowStart}-${venueId.substring(0, 8)}`,
            venue_id: venueId,
            episode_type: 'LANE_OVERSUPPLY',
            start_ts: windowStart,
            end_ts: windowEnd,
            scope: 'global',
            entities: {
              zone_ids: [],
              queue_zone_ids: [...new Set(windowSessions.map(s => s.queue_zone_id))],
              display_ids: [],
            },
            features: {
              open_lanes: openLanes,
              total_lanes: totalLanes,
              throughput_per_lane: Math.round(throughputPerLane * 100) / 100,
              peak_occupancy: peakOccupancy,
              arrival_rate_per_min: Math.round(arrivalRate * 100) / 100,
              unique_tracks: uniqueTracks,
            },
            kpi_deltas: {
              avgOpenLanes: { value: openLanes, unit: 'lanes', direction: 'up' },
              laneUtilization: { value: Math.round(throughputPerLane * 100), unit: 'percent', direction: 'down' },
              queueThroughput: { value: Math.round(throughput * 100) / 100, unit: 'per_minute', direction: 'down' },
            },
            confidence,
            title: 'Checkout capacity exceeded demand — staffing opportunity',
            business_summary: `${openLanes} lanes open serving only ${uniqueTracks} shoppers (${Math.round(throughputPerLane * 10) / 10} per lane/min). Consider reallocating staff to floor operations.`,
            recommended_actions: [
              'Reduce open lanes during low-traffic periods',
              'Redeploy checkout staff to floor assistance or restocking',
            ],
            representative_tracks: [],
          });
        }
      }
    }

    return episodes;
  }

  _estimatePeakOccupancy(sessions) {
    const events = [];
    for (const s of sessions) {
      events.push({ ts: s.queue_entry_time, delta: 1 });
      if (s.queue_exit_time) {
        events.push({ ts: s.queue_exit_time, delta: -1 });
      }
    }
    events.sort((a, b) => a.ts - b.ts);
    let current = 0, peak = 0;
    for (const e of events) {
      current += e.delta;
      if (current > peak) peak = current;
    }
    return peak;
  }

  _getLaneInfo(venueId) {
    try {
      const result = this.mainDb.prepare(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN is_open = 1 THEN 1 ELSE 0 END) as open_count
        FROM zone_settings
        WHERE venue_id = ? AND linked_service_zone_id IS NOT NULL
      `).get(venueId);
      return { total: result?.total || 0, open: result?.open_count || 0 };
    } catch {
      return { total: 0, open: 0 };
    }
  }
}

export default LaneSupplyDetector;
