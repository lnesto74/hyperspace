/**
 * E6 — HIGH_PASSBY_LOW_BROWSE (Attention failure)
 * 
 * Trigger: pass_by_traffic high AND browsing_rate low for shelf/category zone
 * 
 * KPIs: Pass-by Traffic, Browsing Rate, Category Engagement
 * 
 * Uses zone_visits: is_dwell=0 → pass-by, is_dwell=1 → browse
 */

import { computeConfidence, MIN_POPULATION } from '../BaselineTracker.js';

const EPISODE_TYPE = 'HIGH_PASSBY_LOW_BROWSE';
const WINDOW_MS = 30 * 60 * 1000; // 30-minute windows for shelf analysis

export class PassbyBrowseDetector {
  constructor(mainDb, baselineTracker) {
    this.mainDb = mainDb;
    this.baselineTracker = baselineTracker;
  }

  detect(venueId, startTs, endTs) {
    const episodes = [];

    // Get all non-queue zones (shelf/category zones)
    const zones = this._getShelfZones(venueId);
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

      // Get visits for this zone in this window
      const visits = this.mainDb.prepare(`
        SELECT 
          track_key, duration_ms, is_dwell, is_engagement,
          start_time, end_time
        FROM zone_visits
        WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND start_time < ?
      `).all(venueId, zone.id, windowStart, windowEnd);

      if (visits.length < MIN_POPULATION.zone) continue;

      const totalVisits = visits.length;
      const passByCount = visits.filter(v => !v.is_dwell).length;
      const browseCount = visits.filter(v => v.is_dwell).length;
      const engagementCount = visits.filter(v => v.is_engagement).length;

      const passByRate = passByCount / totalVisits;
      const browseRate = browseCount / totalVisits;
      const engagementRate = totalVisits > 0 ? engagementCount / totalVisits : 0;

      const uniqueTracks = new Set(visits.map(v => v.track_key)).size;

      // Evaluate against baselines
      const passByEval = this.baselineTracker.evaluate(venueId, 'zone', zone.id, 'passby_rate', passByRate);
      const browseEval = this.baselineTracker.evaluate(venueId, 'zone', zone.id, 'browse_rate', browseRate);

      let conditionsMet = 0;
      const conditionsTotal = 3;

      // High pass-by rate (above baseline or >70%)
      if (passByEval.isSpike || passByRate > 0.7) conditionsMet++;
      // Low browse rate (below baseline or <25%)
      if (browseEval.isDip || browseRate < 0.25) conditionsMet++;
      // Significant traffic volume (not just a quiet zone)
      if (uniqueTracks >= MIN_POPULATION.zone * 2) conditionsMet++;

      if (conditionsMet < 2) continue;

      const confidence = computeConfidence({
        conditionsSatisfied: conditionsMet,
        conditionsTotal,
        deviationZscore: passByEval.zscore || browseEval.zscore || 0,
        tracksAffected: uniqueTracks,
        minPopulation: MIN_POPULATION.zone,
      });

      // Representative tracks: those who passed by (short visits)
      const repTracks = visits
        .filter(v => !v.is_dwell)
        .sort((a, b) => a.duration_ms - b.duration_ms)
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
          total_visits: totalVisits,
          passby_count: passByCount,
          browse_count: browseCount,
          engagement_count: engagementCount,
          passby_rate: Math.round(passByRate * 1000) / 1000,
          browse_rate: Math.round(browseRate * 1000) / 1000,
          engagement_rate: Math.round(engagementRate * 1000) / 1000,
          unique_tracks: uniqueTracks,
        },
        kpi_deltas: {
          passbyTraffic: {
            value: passByCount,
            unit: 'visitors',
            direction: 'up',
          },
          browsingRate: {
            value: Math.round(browseRate * 100),
            unit: 'percent',
            baseline: browseEval.baseline ? Math.round(browseEval.baseline.rolling_median * 100) : null,
            direction: 'down',
          },
          categoryEngagement: {
            value: Math.round(engagementRate * 100),
            unit: 'percent',
            direction: engagementRate < 0.1 ? 'down' : 'flat',
          },
        },
        confidence,
        title: `Shoppers passed ${zoneName} without engagement`,
        business_summary: `${passByCount} of ${totalVisits} visitors (${Math.round(passByRate * 100)}%) walked past ${zoneName} without stopping. Browse rate: ${Math.round(browseRate * 100)}%. This suggests the category display is not capturing attention.`,
        recommended_actions: [
          `Review visual merchandising and signage for ${zoneName}`,
          'Consider promotional displays or end-cap repositioning',
          'Evaluate product placement relative to traffic flow',
        ],
        representative_tracks: repTracks,
      });
    }

    return episodes;
  }

  _getShelfZones(venueId) {
    try {
      // Get zones that are NOT queue/service zones
      // Exclude by zone_type, linked_service_zone_id, AND name patterns
      const allZones = this.mainDb.prepare(`
        SELECT r.id, r.name, r.color
        FROM regions_of_interest r
        LEFT JOIN zone_settings zs ON r.id = zs.roi_id
        WHERE r.venue_id = ?
          AND (zs.linked_service_zone_id IS NULL OR zs.linked_service_zone_id = '')
          AND (zs.zone_type IS NULL OR zs.zone_type NOT IN ('queue', 'service'))
      `).all(venueId);

      // Also filter out zones with queue/service/checkout in the name
      const excludePatterns = /checkout|service|queue|lane|register|cash/i;
      return allZones.filter(z => !excludePatterns.test(z.name || ''));
    } catch {
      try {
        const zones = this.mainDb.prepare(`
          SELECT id, name, color FROM regions_of_interest WHERE venue_id = ?
        `).all(venueId);
        const excludePatterns = /checkout|service|queue|lane|register|cash/i;
        return zones.filter(z => !excludePatterns.test(z.name || ''));
      } catch {
        return [];
      }
    }
  }
}

export default PassbyBrowseDetector;
