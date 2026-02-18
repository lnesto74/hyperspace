/**
 * E14 — EXPOSURE_TO_ACTION_WIN (Successful influence)
 * E15 — EXPOSURE_NO_FOLLOWTHROUGH (Creative mismatch)
 * 
 * E14 Trigger: exposed cohort shows improved EAL/AAR, shorter TTA, positive SEQ
 * E15 Trigger: exposures high but EAL flat/negative, TTA increases, AAR drops
 * 
 * KPIs: EAL, TTA, AAR, SEQ, AQS, CES
 * 
 * Reads from dooh_attribution tables (read-only).
 */

import { computeConfidence, MIN_POPULATION } from '../BaselineTracker.js';

export class DoohEpisodeDetector {
  constructor(mainDb, baselineTracker) {
    this.mainDb = mainDb;
    this.baselineTracker = baselineTracker;
  }

  detect(venueId, startTs, endTs) {
    const episodes = [];

    // Check if DOOH attribution tables exist
    if (!this._hasDoohTables()) return episodes;

    // Get attribution buckets in the time range
    const buckets = this._getAttributionBuckets(venueId, startTs, endTs);
    if (buckets.length === 0) return episodes;

    // Group by display
    const byDisplay = new Map();
    for (const bucket of buckets) {
      const displayId = bucket.display_id || bucket.screen_id || 'unknown';
      if (!byDisplay.has(displayId)) {
        byDisplay.set(displayId, []);
      }
      byDisplay.get(displayId).push(bucket);
    }

    for (const [displayId, displayBuckets] of byDisplay) {
      const displayEpisodes = this._detectForDisplay(venueId, displayId, displayBuckets, startTs, endTs);
      episodes.push(...displayEpisodes);
    }

    return episodes;
  }

  _detectForDisplay(venueId, displayId, buckets, startTs, endTs) {
    const episodes = [];

    // Aggregate metrics across buckets
    const totals = {
      exposedCount: 0,
      controlsCount: 0,
      ealSum: 0,
      aarSum: 0,
      ttaAccelSum: 0,
      aqsSum: 0,
      cesSum: 0,
      cesCount: 0,
      dciSum: 0,
      impressions: 0,
      count: 0,
    };

    for (const b of buckets) {
      totals.exposedCount += b.exposed_count || 0;
      totals.controlsCount += b.controls_count || 0;
      totals.ealSum += b.lift_rel || 0;
      totals.aarSum += b.aar_score || 0;
      totals.ttaAccelSum += b.tta_accel || 0;
      totals.aqsSum += b.mean_aqs_exposed || 0;
      totals.dciSum += b.engagement_lift_s || 0;
      totals.impressions += b.impressions || b.exposed_count || 0;
      totals.count++;
      if (b.ces_score && b.controls_count > 0) {
        totals.cesSum += b.ces_score;
        totals.cesCount++;
      }
    }

    if (totals.count === 0 || totals.exposedCount < MIN_POPULATION.display) return episodes;

    const n = totals.count;
    const avgEal = totals.ealSum / n;
    const avgAar = totals.aarSum / n;
    const avgTtaAccel = totals.ttaAccelSum / n;
    const avgAqs = totals.aqsSum / n;
    const avgCes = totals.cesCount > 0 ? totals.cesSum / totals.cesCount : 0;
    const avgDci = totals.dciSum / n;

    const totalPopulation = totals.exposedCount + totals.controlsCount;

    // Determine the time window from bucket data
    const episodeStart = startTs;
    const episodeEnd = endTs;

    // ─── E14: EXPOSURE_TO_ACTION_WIN ───
    {
      let conditionsMet = 0;
      const conditionsTotal = 4;

      // Positive EAL (behavioral lift)
      if (avgEal > 0.05) conditionsMet++; // >5% lift
      // Positive TTA acceleration (faster time-to-action)
      if (avgTtaAccel > 0) conditionsMet++;
      // Good attention quality
      if (avgAqs > 50) conditionsMet++; // Above median AQS
      // Meaningful AAR
      if (avgAar > 0.3) conditionsMet++;

      if (conditionsMet >= 3) {
        const confidence = computeConfidence({
          conditionsSatisfied: conditionsMet,
          conditionsTotal,
          deviationZscore: avgEal * 10, // Scale EAL for z-score analog
          tracksAffected: totals.exposedCount,
          minPopulation: MIN_POPULATION.display,
        });

        episodes.push({
          id: `ep-EXPOSURE_TO_ACTION_WIN-${episodeStart}-${displayId.substring(0, 8)}`,
          venue_id: venueId,
          episode_type: 'EXPOSURE_TO_ACTION_WIN',
          start_ts: episodeStart,
          end_ts: episodeEnd,
          scope: 'display',
          entities: {
            zone_ids: [],
            queue_zone_ids: [],
            display_ids: [displayId],
          },
          features: {
            display_id: displayId,
            exposed_count: totals.exposedCount,
            controls_count: totals.controlsCount,
            avg_eal: Math.round(avgEal * 1000) / 1000,
            avg_aar: Math.round(avgAar * 1000) / 1000,
            avg_tta_accel: Math.round(avgTtaAccel * 1000) / 1000,
            avg_aqs: Math.round(avgAqs * 10) / 10,
            avg_ces: Math.round(avgCes * 10) / 10,
            avg_dci: Math.round(avgDci * 10) / 10,
            impressions: totals.impressions,
          },
          kpi_deltas: {
            eal: { value: Math.round(avgEal * 100), unit: 'percent', direction: 'up' },
            tta: { value: Math.round(avgTtaAccel * 100), unit: 'percent', direction: 'up' },
            aar: { value: Math.round(avgAar * 100), unit: 'percent', direction: 'up' },
            aqs: { value: Math.round(avgAqs), unit: 'score', direction: 'up' },
          },
          confidence,
          title: 'Display exposure drove measurable shopper action',
          business_summary: `${totals.exposedCount} exposed shoppers showed ${Math.round(avgEal * 100)}% behavioral lift (EAL) with ${Math.round(avgAqs)} attention quality score. Time-to-action accelerated by ${Math.round(avgTtaAccel * 100)}%, confirming creative effectiveness.`,
          recommended_actions: [
            'Continue current creative rotation',
            'Consider expanding to additional displays',
            'Document this campaign pattern as a benchmark',
          ],
          representative_tracks: [],
        });
      }
    }

    // ─── E15: EXPOSURE_NO_FOLLOWTHROUGH ───
    {
      let conditionsMet = 0;
      const conditionsTotal = 4;

      // High impressions but flat/negative EAL
      if (totals.impressions > 50 && avgEal <= 0.02) conditionsMet++;
      // TTA not accelerating (or slowing)
      if (avgTtaAccel <= 0) conditionsMet++;
      // AAR low
      if (avgAar < 0.15) conditionsMet++;
      // Significant exposure volume
      if (totals.exposedCount >= MIN_POPULATION.display * 2) conditionsMet++;

      if (conditionsMet >= 3) {
        const confidence = computeConfidence({
          conditionsSatisfied: conditionsMet,
          conditionsTotal,
          deviationZscore: -avgEal * 10,
          tracksAffected: totals.exposedCount,
          minPopulation: MIN_POPULATION.display,
        });

        episodes.push({
          id: `ep-EXPOSURE_NO_FOLLOWTHROUGH-${episodeStart}-${displayId.substring(0, 8)}`,
          venue_id: venueId,
          episode_type: 'EXPOSURE_NO_FOLLOWTHROUGH',
          start_ts: episodeStart,
          end_ts: episodeEnd,
          scope: 'display',
          entities: {
            zone_ids: [],
            queue_zone_ids: [],
            display_ids: [displayId],
          },
          features: {
            display_id: displayId,
            exposed_count: totals.exposedCount,
            controls_count: totals.controlsCount,
            avg_eal: Math.round(avgEal * 1000) / 1000,
            avg_aar: Math.round(avgAar * 1000) / 1000,
            avg_tta_accel: Math.round(avgTtaAccel * 1000) / 1000,
            avg_aqs: Math.round(avgAqs * 10) / 10,
            impressions: totals.impressions,
          },
          kpi_deltas: {
            impressions: { value: totals.impressions, unit: 'count', direction: 'flat' },
            eal: { value: Math.round(avgEal * 100), unit: 'percent', direction: 'down' },
            tta: { value: Math.round(avgTtaAccel * 100), unit: 'percent', direction: 'down' },
            aar: { value: Math.round(avgAar * 100), unit: 'percent', direction: 'down' },
          },
          confidence,
          title: 'Display exposure did not translate to shopper action',
          business_summary: `${totals.impressions} impressions across ${totals.exposedCount} shoppers produced only ${Math.round(avgEal * 100)}% behavioral lift. Attention-to-action rate: ${Math.round(avgAar * 100)}%. Creative or placement may need revision.`,
          recommended_actions: [
            'Review creative content for relevance and call-to-action clarity',
            'Evaluate display placement relative to target category',
            'Consider A/B testing alternative creative',
          ],
          representative_tracks: [],
        });
      }
    }

    return episodes;
  }

  _hasDoohTables() {
    try {
      this.mainDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dooh_attribution_buckets'").get();
      return true;
    } catch {
      return false;
    }
  }

  _getAttributionBuckets(venueId, startTs, endTs) {
    try {
      // Try the attribution buckets table
      return this.mainDb.prepare(`
        SELECT * FROM dooh_attribution_buckets
        WHERE venue_id = ? AND start_ts >= ? AND end_ts <= ?
        ORDER BY start_ts
      `).all(venueId, startTs, endTs);
    } catch {
      try {
        // Fallback: try dooh_kpi_buckets
        return this.mainDb.prepare(`
          SELECT * FROM dooh_kpi_buckets
          WHERE venue_id = ? AND start_ts >= ? AND end_ts <= ?
          ORDER BY start_ts
        `).all(venueId, startTs, endTs);
      } catch {
        return [];
      }
    }
  }
}

export default DoohEpisodeDetector;
