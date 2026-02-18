/**
 * E4 — ABANDONMENT_WAVE
 * 
 * Trigger: queueAbandonmentRate spikes OR count(abandon) > baseline + X
 * 
 * KPIs: queueAbandonmentRate, conversion loss proxy (exit soon after abandon)
 * 
 * Note: The main DB marks sessions >=5s that leave without service as "served" (is_abandoned=0).
 * We re-derive true abandonment: waiting_time_ms > 0 AND service_entry_time IS NULL AND is_complete = 0.
 */

import { computeConfidence, MIN_POPULATION } from '../BaselineTracker.js';

const EPISODE_TYPE = 'ABANDONMENT_WAVE';
const WINDOW_MS = 15 * 60 * 1000;

export class AbandonmentDetector {
  constructor(mainDb, baselineTracker) {
    this.mainDb = mainDb;
    this.baselineTracker = baselineTracker;
  }

  detect(venueId, startTs, endTs) {
    const episodes = [];

    // Get all queue sessions — re-derive abandonment
    const sessions = this.mainDb.prepare(`
      SELECT 
        id, track_key, queue_zone_id,
        queue_entry_time, queue_exit_time, waiting_time_ms,
        service_entry_time, is_complete, is_abandoned
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
      ORDER BY queue_entry_time
    `).all(venueId, startTs, endTs);

    if (sessions.length < MIN_POPULATION.global) return episodes;

    // Re-derive abandonment: queued for >5s, no service entry, not complete
    const enriched = sessions.map(s => ({
      ...s,
      truly_abandoned: (
        s.waiting_time_ms > 5000 &&
        s.service_entry_time == null &&
        s.is_complete === 0
      ),
    }));

    for (let windowStart = startTs; windowStart < endTs - WINDOW_MS; windowStart += WINDOW_MS / 2) {
      const windowEnd = windowStart + WINDOW_MS;

      const windowSessions = enriched.filter(
        s => s.queue_entry_time >= windowStart && s.queue_entry_time < windowEnd
      );

      if (windowSessions.length < MIN_POPULATION.zone) continue;

      const abandonedSessions = windowSessions.filter(s => s.truly_abandoned);
      const abandonCount = abandonedSessions.length;
      const abandonRate = abandonCount / windowSessions.length;

      if (abandonCount < 3) continue; // Need at least 3 abandoned sessions

      // Evaluate against baseline
      const eval_ = this.baselineTracker.evaluate(
        venueId, 'global', null, 'queue_abandonment_rate', abandonRate
      );

      let conditionsMet = 0;
      const conditionsTotal = 3;

      // Abandonment rate is a spike
      if (eval_.isSpike || abandonRate > 0.15) conditionsMet++;
      // Multiple abandonments in window
      if (abandonCount >= 5) conditionsMet++;
      // Clustering: abandonments happen close together (within 3 min of each other)
      if (this._isClustered(abandonedSessions, 3 * 60 * 1000)) conditionsMet++;

      if (conditionsMet < 2) continue;

      const uniqueTracks = new Set(abandonedSessions.map(s => s.track_key)).size;
      const avgWaitBeforeAbandon = abandonedSessions.reduce((sum, s) => sum + (s.waiting_time_ms || 0), 0) / abandonCount;

      const confidence = computeConfidence({
        conditionsSatisfied: conditionsMet,
        conditionsTotal,
        deviationZscore: eval_.zscore,
        tracksAffected: uniqueTracks,
        minPopulation: MIN_POPULATION.global,
      });

      const repTracks = abandonedSessions
        .sort((a, b) => (b.waiting_time_ms || 0) - (a.waiting_time_ms || 0))
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
          queue_zone_ids: [...new Set(abandonedSessions.map(s => s.queue_zone_id))],
          display_ids: [],
        },
        features: {
          abandon_count: abandonCount,
          abandon_rate: Math.round(abandonRate * 1000) / 1000,
          total_sessions: windowSessions.length,
          avg_wait_before_abandon_ms: Math.round(avgWaitBeforeAbandon),
          unique_tracks: uniqueTracks,
          is_clustered: this._isClustered(abandonedSessions, 3 * 60 * 1000),
        },
        kpi_deltas: {
          queueAbandonmentRate: {
            value: Math.round(abandonRate * 100),
            unit: 'percent',
            baseline: eval_.baseline ? Math.round(eval_.baseline.rolling_median * 100) : null,
            direction: 'up',
          },
        },
        confidence,
        title: 'Shoppers left the queue before being served',
        business_summary: `${abandonCount} shoppers (${Math.round(abandonRate * 100)}%) abandoned checkout after waiting an average of ${Math.round(avgWaitBeforeAbandon / 1000)}s. This represents potential lost revenue.`,
        recommended_actions: [
          'Investigate queue experience during this period',
          'Consider express lane or mobile checkout options',
        ],
        representative_tracks: repTracks,
      });
    }

    return episodes;
  }

  /**
   * Check if abandonments are clustered (happen within maxGap of each other)
   */
  _isClustered(sessions, maxGapMs) {
    if (sessions.length < 3) return false;
    const sorted = [...sessions].sort((a, b) => a.queue_entry_time - b.queue_entry_time);
    let clusterCount = 1;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].queue_entry_time - sorted[i - 1].queue_entry_time;
      if (gap <= maxGapMs) {
        clusterCount++;
        if (clusterCount >= 3) return true;
      } else {
        clusterCount = 1;
      }
    }
    return false;
  }
}

export default AbandonmentDetector;
