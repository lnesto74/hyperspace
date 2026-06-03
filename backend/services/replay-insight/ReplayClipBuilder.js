/**
 * ReplayClipBuilder
 * 
 * Computes replay windows and extracts representative track data
 * for each episode. Read-only access to main DB.
 */

const PADDING_MS = 30 * 1000; // 30s padding before/after episode

export class ReplayClipBuilder {
  /**
   * @param {import('better-sqlite3').Database} mainDb - Main Hyperspace DB (read-only)
   */
  constructor(mainDb) {
    this.mainDb = mainDb;
  }

  /**
   * Build replay clip data for an episode
   * @param {Object} episode
   * @returns {Object} Episode enriched with replay_window and representative_tracks data
   */
  buildClip(episode) {
    const replayWindow = {
      start: episode.start_ts - PADDING_MS,
      end: episode.end_ts + PADDING_MS,
      zones: this._getRelevantZoneIds(episode),
    };

    // Get representative track positions for the replay window
    const trackPositions = this._getTrackPositions(
      episode.venue_id,
      episode.representative_tracks || [],
      replayWindow.start,
      replayWindow.end,
      replayWindow.zones
    );

    // Get highlight zones with metadata
    const highlightZones = this._getHighlightZones(episode);

    return {
      ...episode,
      replay_window: replayWindow,
      track_positions: trackPositions,
      highlight_zones: highlightZones,
    };
  }

  /**
   * Build clips for multiple episodes (batch)
   */
  buildClips(episodes) {
    return episodes.map(ep => this.buildClip(ep));
  }

  /**
   * Build the set of moving tracks for the replay window.
   *
   * Track IDs in the main DB are heavily fragmented (most track_keys carry only
   * 1–2 points), so the episode's handful of `representative_tracks` produce a
   * frozen, unrealistic clip. Instead we gather the people who were actually in
   * the episode's zones during the window, keep the ones with enough points to
   * show real movement, and fall back to the window's busiest movers when the
   * zone set is too sparse. This yields a populated, lifelike replay.
   */
  _getTrackPositions(venueId, repTracks = [], startTs, endTs, zoneIds = []) {
    const MIN_POINTS = 4;     // points needed to count as a "mover"
    const MAX_TRACKS = 40;    // cap on tracks rendered in a clip
    try {
      // 1. Candidates: representative tracks + everyone seen in the episode zones.
      const candidates = new Set((repTracks || []).filter(Boolean));
      if (Array.isArray(zoneIds) && zoneIds.length > 0) {
        const ph = zoneIds.map(() => '?').join(',');
        const rows = this.mainDb.prepare(`
          SELECT DISTINCT track_key FROM track_positions
          WHERE venue_id = ? AND roi_id IN (${ph}) AND timestamp >= ? AND timestamp <= ?
        `).all(venueId, ...zoneIds, startTs, endTs);
        for (const r of rows) candidates.add(r.track_key);
      }

      let byKey = this._fetchPositionsForKeys(venueId, [...candidates], startTs, endTs);
      let movers = [...byKey.entries()].filter(([, arr]) => arr.length >= MIN_POINTS);

      // 2. Fallback: too few movers near the zones → use the busiest movers in the window.
      if (movers.length < 3) {
        const busy = this.mainDb.prepare(`
          SELECT track_key FROM track_positions
          WHERE venue_id = ? AND timestamp >= ? AND timestamp <= ?
          GROUP BY track_key HAVING COUNT(*) >= ?
          ORDER BY COUNT(*) DESC LIMIT ?
        `).all(venueId, startTs, endTs, MIN_POINTS, MAX_TRACKS).map(r => r.track_key);
        if (busy.length > 0) {
          byKey = this._fetchPositionsForKeys(venueId, busy, startTs, endTs);
          movers = [...byKey.entries()].filter(([, arr]) => arr.length >= 2);
        }
      }

      // 3. Keep the densest tracks (most lifelike), capped.
      movers.sort((a, b) => b[1].length - a[1].length);
      const positions = {};
      for (const [key, arr] of movers.slice(0, MAX_TRACKS)) positions[key] = arr;
      return positions;
    } catch (err) {
      console.warn('[ReplayClipBuilder] Failed to get track positions:', err.message);
      return {};
    }
  }

  /** Fetch and group full position arrays for a set of track keys within a window. */
  _fetchPositionsForKeys(venueId, keys, startTs, endTs) {
    const out = new Map();
    if (!keys || keys.length === 0) return out;
    const CHUNK = 200;
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK);
      const ph = chunk.map(() => '?').join(',');
      const rows = this.mainDb.prepare(`
        SELECT track_key, timestamp, position_x, position_z, velocity_x, velocity_z, roi_id
        FROM track_positions
        WHERE venue_id = ? AND track_key IN (${ph}) AND timestamp >= ? AND timestamp <= ?
        ORDER BY track_key, timestamp
      `).all(venueId, ...chunk, startTs, endTs);
      for (const row of rows) {
        if (!out.has(row.track_key)) out.set(row.track_key, []);
        out.get(row.track_key).push({
          timestamp: row.timestamp,
          x: row.position_x,
          z: row.position_z,
          vx: row.velocity_x,
          vz: row.velocity_z,
          roiId: row.roi_id,
        });
      }
    }
    return out;
  }

  /**
   * Get all relevant zone IDs from episode entities
   */
  _getRelevantZoneIds(episode) {
    const zoneIds = new Set();
    const entities = episode.entities || {};

    for (const id of (entities.zone_ids || [])) zoneIds.add(id);
    for (const id of (entities.queue_zone_ids || [])) zoneIds.add(id);
    for (const id of (entities.roi_ids || [])) zoneIds.add(id);

    return [...zoneIds].filter(Boolean);
  }

  /**
   * Get highlight zone metadata for the episode
   */
  _getHighlightZones(episode) {
    const zoneIds = this._getRelevantZoneIds(episode);
    if (zoneIds.length === 0) return [];

    try {
      const placeholders = zoneIds.map(() => '?').join(',');
      const zones = this.mainDb.prepare(`
        SELECT id, name, color, vertices
        FROM regions_of_interest
        WHERE id IN (${placeholders})
      `).all(...zoneIds);

      return zones.map(z => ({
        id: z.id,
        name: z.name,
        color: z.color,
        vertices: JSON.parse(z.vertices || '[]'),
      }));
    } catch {
      return [];
    }
  }
}

export default ReplayClipBuilder;
