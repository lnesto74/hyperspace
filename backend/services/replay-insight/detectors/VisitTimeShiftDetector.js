/**
 * E13 — STORE_VISIT_TIME_SHIFT
 * 
 * Trigger: avg_store_visit_time increases/decreases significantly vs baseline
 * 
 * KPIs: Avg Store Visit, downstream: Browsing Rate, queue load patterns
 */

import { computeConfidence, MIN_POPULATION } from '../BaselineTracker.js';

const EPISODE_TYPE = 'STORE_VISIT_TIME_SHIFT';
const WINDOW_MS = 60 * 60 * 1000; // 1-hour windows for visit time analysis

export class VisitTimeShiftDetector {
  constructor(mainDb, baselineTracker) {
    this.mainDb = mainDb;
    this.baselineTracker = baselineTracker;
  }

  detect(venueId, startTs, endTs) {
    const episodes = [];

    for (let windowStart = startTs; windowStart < endTs - WINDOW_MS; windowStart += WINDOW_MS / 2) {
      const windowEnd = windowStart + WINDOW_MS;

      // Compute per-track total visit time in this window
      // A "store visit" = sum of all zone_visit durations for a track
      const trackVisits = this.mainDb.prepare(`
        SELECT 
          track_key,
          COUNT(*) as zone_visits,
          SUM(duration_ms) as total_duration_ms,
          MIN(start_time) as first_seen,
          MAX(end_time) as last_seen
        FROM zone_visits
        WHERE venue_id = ? AND start_time >= ? AND start_time < ?
        GROUP BY track_key
        HAVING zone_visits >= 2
      `).all(venueId, windowStart, windowEnd);

      if (trackVisits.length < MIN_POPULATION.global) continue;

      // Compute store visit time per track (last_seen - first_seen as proxy)
      const visitTimes = trackVisits.map(t => t.last_seen - t.first_seen).filter(t => t > 0);
      if (visitTimes.length < MIN_POPULATION.global) continue;

      const avgVisitTime = visitTimes.reduce((a, b) => a + b, 0) / visitTimes.length;
      const sorted = [...visitTimes].sort((a, b) => a - b);
      const medianVisitTime = sorted[Math.floor(sorted.length / 2)];

      // Evaluate against baseline
      const eval_ = this.baselineTracker.evaluate(
        venueId, 'global', null, 'avg_visit_duration_ms', avgVisitTime
      );

      if (eval_.insufficientData) continue;

      let conditionsMet = 0;
      const conditionsTotal = 3;
      let shiftDirection = 'flat';

      // Significant increase
      if (eval_.isSpike) {
        conditionsMet++;
        shiftDirection = 'up';
      }
      // Significant decrease
      if (eval_.isDip) {
        conditionsMet++;
        shiftDirection = 'down';
      }
      // Z-score > 2 in either direction
      if (Math.abs(eval_.zscore) > 2) conditionsMet++;
      // Sufficient population
      if (visitTimes.length >= MIN_POPULATION.global) conditionsMet++;

      if (conditionsMet < 2 || shiftDirection === 'flat') continue;

      const confidence = computeConfidence({
        conditionsSatisfied: conditionsMet,
        conditionsTotal,
        deviationZscore: eval_.zscore,
        tracksAffected: visitTimes.length,
        minPopulation: MIN_POPULATION.global,
      });

      // Representative tracks: most extreme visit times
      const repTracks = shiftDirection === 'up'
        ? trackVisits.sort((a, b) => (b.last_seen - b.first_seen) - (a.last_seen - a.first_seen)).slice(0, 5).map(t => t.track_key)
        : trackVisits.sort((a, b) => (a.last_seen - a.first_seen) - (b.last_seen - b.first_seen)).slice(0, 5).map(t => t.track_key);

      const baselineMin = eval_.baseline ? Math.round(eval_.baseline.rolling_median / 60000) : null;
      const currentMin = Math.round(avgVisitTime / 60000);

      const directionWord = shiftDirection === 'up' ? 'increased' : 'decreased';

      episodes.push({
        id: `ep-${EPISODE_TYPE}-${windowStart}-${venueId.substring(0, 8)}`,
        venue_id: venueId,
        episode_type: EPISODE_TYPE,
        start_ts: windowStart,
        end_ts: windowEnd,
        scope: 'global',
        entities: {
          zone_ids: [],
          queue_zone_ids: [],
          display_ids: [],
        },
        features: {
          avg_visit_time_ms: Math.round(avgVisitTime),
          median_visit_time_ms: Math.round(medianVisitTime),
          visitor_count: visitTimes.length,
          shift_direction: shiftDirection,
          zscore: Math.round(eval_.zscore * 100) / 100,
        },
        kpi_deltas: {
          avgStoreVisit: {
            value: currentMin,
            unit: 'minutes',
            baseline: baselineMin,
            direction: shiftDirection,
          },
        },
        confidence,
        title: `Average store visit time ${directionWord}`,
        business_summary: `Average visit duration ${directionWord} to ${currentMin} minutes${baselineMin ? ` (baseline: ${baselineMin} min)` : ''} across ${visitTimes.length} visitors. ${shiftDirection === 'up' ? 'Longer visits may indicate deeper engagement or congestion delays.' : 'Shorter visits may signal reduced browsing or faster mission-shopping.'}`,
        recommended_actions: shiftDirection === 'up'
          ? ['Check for congestion points that may be inflating visit duration', 'Evaluate if longer visits correlate with higher basket values']
          : ['Investigate if category engagement has dropped', 'Review if store layout changes are reducing exploration'],
        representative_tracks: repTracks,
      });
    }

    return episodes;
  }
}

export default VisitTimeShiftDetector;
