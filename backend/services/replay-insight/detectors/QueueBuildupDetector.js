/**
 * E1 — QUEUE_BUILDUP_SPIKE
 * 
 * Trigger: P95(queue_wait_time) > threshold OR avg_wait_time jumps vs baseline
 *          AND in_queue_peak > baseline + X
 * 
 * KPIs: queueWaitTime (avg, p95), queueThroughput, queueAbandonmentRate, openLanes/lanesUsed
 */

import { computeConfidence, MIN_POPULATION } from '../BaselineTracker.js';

const EPISODE_TYPE = 'QUEUE_BUILDUP_SPIKE';
const WINDOW_MS = 15 * 60 * 1000; // 15-minute detection windows

export class QueueBuildupDetector {
  /**
   * @param {import('better-sqlite3').Database} mainDb
   * @param {import('../BaselineTracker.js').BaselineTracker} baselineTracker
   */
  constructor(mainDb, baselineTracker) {
    this.mainDb = mainDb;
    this.baselineTracker = baselineTracker;
  }

  /**
   * Detect queue buildup spikes in the given time range
   * @param {string} venueId
   * @param {number} startTs
   * @param {number} endTs
   * @returns {Array} detected episodes
   */
  detect(venueId, startTs, endTs) {
    const episodes = [];

    // Get all queue sessions in the time range
    const sessions = this.mainDb.prepare(`
      SELECT 
        id, track_key, queue_zone_id, service_zone_id,
        queue_entry_time, queue_exit_time, waiting_time_ms,
        is_complete, is_abandoned
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
      ORDER BY queue_entry_time
    `).all(venueId, startTs, endTs);

    if (sessions.length < MIN_POPULATION.global) return episodes;

    // Get queue zone IDs
    const queueZoneIds = [...new Set(sessions.map(s => s.queue_zone_id))];

    // Slide windows across the time range
    for (let windowStart = startTs; windowStart < endTs - WINDOW_MS; windowStart += WINDOW_MS / 2) {
      const windowEnd = windowStart + WINDOW_MS;

      const windowSessions = sessions.filter(
        s => s.queue_entry_time >= windowStart && s.queue_entry_time < windowEnd
      );

      if (windowSessions.length < MIN_POPULATION.zone) continue;

      // Compute window metrics
      const waitTimes = windowSessions
        .filter(s => s.waiting_time_ms != null && s.waiting_time_ms > 0)
        .map(s => s.waiting_time_ms)
        .sort((a, b) => a - b);

      if (waitTimes.length < 3) continue;

      const avgWait = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
      const p95Wait = waitTimes[Math.floor(waitTimes.length * 0.95)];
      const uniqueTracks = new Set(windowSessions.map(s => s.track_key)).size;

      // Peak simultaneous queue occupancy (approximate from overlapping sessions)
      const peakOccupancy = this._estimatePeakOccupancy(windowSessions);

      // Evaluate against baseline
      const waitEval = this.baselineTracker.evaluate(venueId, 'global', null, 'queue_wait_time_ms', avgWait);
      const occEval = this.baselineTracker.evaluate(venueId, 'global', null, 'venue_occupancy', peakOccupancy);

      // Spike conditions
      let conditionsMet = 0;
      const conditionsTotal = 3;

      if (waitEval.isSpike) conditionsMet++;
      if (p95Wait > avgWait * 1.5) conditionsMet++; // P95 significantly above average
      if (occEval.isSpike || peakOccupancy > uniqueTracks * 0.6) conditionsMet++;

      if (conditionsMet < 2) continue;

      // Compute throughput (served sessions per minute)
      // A session is "served" if it is NOT abandoned (includes is_complete + normal queue exits)
      const served = windowSessions.filter(s => !s.is_abandoned).length;
      const throughput = served / (WINDOW_MS / 60000);

      // Abandonment rate in this window
      const abandoned = windowSessions.filter(s => s.is_abandoned).length;
      const abandonRate = windowSessions.length > 0 ? abandoned / windowSessions.length : 0;

      // Get open lanes count
      const openLanes = this._getOpenLanesCount(venueId, queueZoneIds);

      const confidence = computeConfidence({
        conditionsSatisfied: conditionsMet,
        conditionsTotal,
        deviationZscore: waitEval.zscore,
        tracksAffected: uniqueTracks,
        minPopulation: MIN_POPULATION.global,
      });

      // Get representative tracks (top 5 longest wait)
      const repTracks = windowSessions
        .filter(s => s.waiting_time_ms != null)
        .sort((a, b) => b.waiting_time_ms - a.waiting_time_ms)
        .slice(0, 5)
        .map(s => s.track_key);

      episodes.push({
        id: `ep-${EPISODE_TYPE}-${windowStart}-${venueId.substring(0, 8)}`,
        venue_id: venueId,
        episode_type: EPISODE_TYPE,
        start_ts: windowStart,
        end_ts: windowEnd,
        scope: 'global',
        entities: {
          zone_ids: [],
          queue_zone_ids: queueZoneIds,
          display_ids: [],
        },
        features: {
          avg_wait_ms: Math.round(avgWait),
          p95_wait_ms: Math.round(p95Wait),
          peak_occupancy: peakOccupancy,
          throughput_per_min: Math.round(throughput * 100) / 100,
          abandonment_rate: Math.round(abandonRate * 1000) / 1000,
          open_lanes: openLanes,
          unique_tracks: uniqueTracks,
          session_count: windowSessions.length,
        },
        kpi_deltas: {
          queueWaitTime: {
            value: Math.round(avgWait / 1000),
            unit: 'seconds',
            baseline: waitEval.baseline ? Math.round(waitEval.baseline.rolling_median / 1000) : null,
            direction: 'up',
          },
          queueThroughput: {
            value: Math.round(throughput * 100) / 100,
            unit: 'per_minute',
            baseline: null,
            direction: throughput < 1 ? 'down' : 'flat',
          },
          queueAbandonmentRate: {
            value: Math.round(abandonRate * 100),
            unit: 'percent',
            direction: abandonRate > 0.1 ? 'up' : 'flat',
          },
        },
        confidence,
        title: `Checkout demand exceeded service capacity`,
        business_summary: `Average wait time reached ${Math.round(avgWait / 1000)}s (P95: ${Math.round(p95Wait / 1000)}s) with ${uniqueTracks} shoppers in queue. ${openLanes} lanes were open.`,
        recommended_actions: [
          'Open additional checkout lanes during this time window',
          'Review staffing schedule for this period',
        ],
        representative_tracks: repTracks,
      });
    }

    return episodes;
  }

  _estimatePeakOccupancy(sessions) {
    // Build timeline of entries/exits
    const events = [];
    for (const s of sessions) {
      events.push({ ts: s.queue_entry_time, delta: 1 });
      if (s.queue_exit_time) {
        events.push({ ts: s.queue_exit_time, delta: -1 });
      }
    }
    events.sort((a, b) => a.ts - b.ts);

    let current = 0;
    let peak = 0;
    for (const e of events) {
      current += e.delta;
      if (current > peak) peak = current;
    }
    return peak;
  }

  _getOpenLanesCount(venueId, queueZoneIds) {
    try {
      if (queueZoneIds.length === 0) return 0;
      const placeholders = queueZoneIds.map(() => '?').join(',');
      const result = this.mainDb.prepare(`
        SELECT COUNT(*) as count FROM zone_settings
        WHERE roi_id IN (${placeholders}) AND is_open = 1
      `).get(...queueZoneIds);
      return result?.count || 0;
    } catch {
      return 0;
    }
  }
}

export default QueueBuildupDetector;
