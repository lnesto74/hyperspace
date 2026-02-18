/**
 * E7 — BROWSE_NO_CONVERT_PROXY (Hesitation)
 * 
 * Trigger: avg_browse_time high AND category_conversion low
 *          Proxy: engagement without subsequent queue entry
 * 
 * KPIs: Avg Browse Time, Category Conversion (proxy), AAR
 */

import { computeConfidence, MIN_POPULATION } from '../BaselineTracker.js';

const EPISODE_TYPE = 'BROWSE_NO_CONVERT_PROXY';
const WINDOW_MS = 30 * 60 * 1000;

export class BrowseNoConvertDetector {
  constructor(mainDb, baselineTracker) {
    this.mainDb = mainDb;
    this.baselineTracker = baselineTracker;
  }

  detect(venueId, startTs, endTs) {
    const episodes = [];

    const zones = this._getShelfZones(venueId);
    if (zones.length === 0) return episodes;

    // Get queue zone IDs for conversion proxy
    const queueZoneIds = this._getQueueZoneIds(venueId);

    for (const zone of zones) {
      const zoneEpisodes = this._detectForZone(venueId, zone, queueZoneIds, startTs, endTs);
      episodes.push(...zoneEpisodes);
    }

    return episodes;
  }

  _detectForZone(venueId, zone, queueZoneIds, startTs, endTs) {
    const episodes = [];

    for (let windowStart = startTs; windowStart < endTs - WINDOW_MS; windowStart += WINDOW_MS / 2) {
      const windowEnd = windowStart + WINDOW_MS;

      // Get engaged visits (is_engagement=1) for this zone
      const engagedVisits = this.mainDb.prepare(`
        SELECT track_key, duration_ms, start_time, end_time
        FROM zone_visits
        WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND start_time < ?
          AND is_engagement = 1
      `).all(venueId, zone.id, windowStart, windowEnd);

      if (engagedVisits.length < MIN_POPULATION.zone) continue;

      // For each engaged track, check if they subsequently entered a queue zone
      // (proxy for conversion: engagement → checkout)
      const engagedTracks = [...new Set(engagedVisits.map(v => v.track_key))];
      let convertedCount = 0;
      let notConvertedCount = 0;

      for (const trackKey of engagedTracks) {
        const latestEngagement = engagedVisits
          .filter(v => v.track_key === trackKey)
          .sort((a, b) => b.end_time - a.end_time)[0];

        if (!latestEngagement) continue;

        // Check if this track entered any queue zone after engagement
        // Look within 30 minutes after the engagement ended
        const lookAheadMs = 30 * 60 * 1000;
        const hasConversion = this._trackEnteredQueue(
          venueId, trackKey, queueZoneIds,
          latestEngagement.end_time,
          latestEngagement.end_time + lookAheadMs
        );

        if (hasConversion) {
          convertedCount++;
        } else {
          notConvertedCount++;
        }
      }

      const totalEngaged = engagedTracks.length;
      const conversionProxy = totalEngaged > 0 ? convertedCount / totalEngaged : 0;
      const nonConversionRate = totalEngaged > 0 ? notConvertedCount / totalEngaged : 0;

      // Average browse time for engaged visits
      const avgBrowseTime = engagedVisits.reduce((sum, v) => sum + v.duration_ms, 0) / engagedVisits.length;

      let conditionsMet = 0;
      const conditionsTotal = 3;

      // High browse time (long engagement without action)
      if (avgBrowseTime > 180000) conditionsMet++; // >3 min average
      // Low conversion proxy
      if (conversionProxy < 0.2) conditionsMet++; // <20% go to checkout after
      // Significant engaged population
      if (totalEngaged >= MIN_POPULATION.zone) conditionsMet++;

      if (conditionsMet < 2) continue;

      const confidence = computeConfidence({
        conditionsSatisfied: conditionsMet,
        conditionsTotal,
        deviationZscore: 0,
        tracksAffected: totalEngaged,
        minPopulation: MIN_POPULATION.zone,
      });

      const repTracks = engagedVisits
        .filter(v => {
          // Prefer tracks that did NOT convert
          const trackKey = v.track_key;
          return !this._trackEnteredQueue(venueId, trackKey, queueZoneIds, v.end_time, v.end_time + 30 * 60 * 1000);
        })
        .sort((a, b) => b.duration_ms - a.duration_ms)
        .slice(0, 5)
        .map(v => v.track_key);

      const zoneName = zone.name || zone.id.substring(0, 8);

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
          engaged_visitors: totalEngaged,
          converted_count: convertedCount,
          not_converted_count: notConvertedCount,
          conversion_proxy: Math.round(conversionProxy * 1000) / 1000,
          avg_browse_time_ms: Math.round(avgBrowseTime),
        },
        kpi_deltas: {
          avgBrowseTime: {
            value: Math.round(avgBrowseTime / 1000),
            unit: 'seconds',
            direction: 'up',
          },
          categoryConversion: {
            value: Math.round(conversionProxy * 100),
            unit: 'percent',
            direction: 'down',
          },
        },
        confidence,
        title: `Shoppers browsed ${zoneName} but did not follow through`,
        business_summary: `${totalEngaged} shoppers engaged with ${zoneName} for an average of ${Math.round(avgBrowseTime / 60000)}min, but only ${convertedCount} (${Math.round(conversionProxy * 100)}%) proceeded to checkout. This signals product interest without purchase commitment.`,
        recommended_actions: [
          'Review pricing or promotional clarity in this category',
          'Consider in-aisle conversion triggers (samples, demos)',
          'Evaluate product availability and stock levels',
        ],
        representative_tracks: repTracks,
      });
    }

    return episodes;
  }

  _trackEnteredQueue(venueId, trackKey, queueZoneIds, afterTs, beforeTs) {
    if (queueZoneIds.length === 0) return false;
    try {
      const placeholders = queueZoneIds.map(() => '?').join(',');
      const result = this.mainDb.prepare(`
        SELECT COUNT(*) as count FROM queue_sessions
        WHERE venue_id = ? AND track_key = ? AND queue_zone_id IN (${placeholders})
          AND queue_entry_time >= ? AND queue_entry_time <= ?
      `).get(venueId, trackKey, ...queueZoneIds, afterTs, beforeTs);
      return result && result.count > 0;
    } catch {
      return false;
    }
  }

  _getQueueZoneIds(venueId) {
    try {
      const rows = this.mainDb.prepare(`
        SELECT roi_id FROM zone_settings
        WHERE venue_id = ? AND linked_service_zone_id IS NOT NULL
      `).all(venueId);
      return rows.map(r => r.roi_id);
    } catch {
      return [];
    }
  }

  _getShelfZones(venueId) {
    try {
      return this.mainDb.prepare(`
        SELECT r.id, r.name, r.color
        FROM regions_of_interest r
        LEFT JOIN zone_settings zs ON r.id = zs.roi_id
        WHERE r.venue_id = ?
          AND (zs.linked_service_zone_id IS NULL OR zs.linked_service_zone_id = '')
          AND (zs.zone_type IS NULL OR zs.zone_type NOT IN ('queue', 'service'))
      `).all(venueId);
    } catch {
      try {
        return this.mainDb.prepare(`
          SELECT id, name, color FROM regions_of_interest WHERE venue_id = ?
        `).all(venueId);
      } catch {
        return [];
      }
    }
  }
}

export default BrowseNoConvertDetector;
