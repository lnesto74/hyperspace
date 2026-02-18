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
      replayWindow.end
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
   * Get track positions for representative tracks in the replay window
   */
  _getTrackPositions(venueId, trackKeys, startTs, endTs) {
    if (trackKeys.length === 0) return {};

    const positions = {};
    try {
      const placeholders = trackKeys.map(() => '?').join(',');
      const rows = this.mainDb.prepare(`
        SELECT track_key, timestamp, position_x, position_z, velocity_x, velocity_z, roi_id
        FROM track_positions
        WHERE venue_id = ? AND track_key IN (${placeholders})
          AND timestamp >= ? AND timestamp <= ?
        ORDER BY track_key, timestamp
      `).all(venueId, ...trackKeys, startTs, endTs);

      for (const row of rows) {
        if (!positions[row.track_key]) {
          positions[row.track_key] = [];
        }
        positions[row.track_key].push({
          timestamp: row.timestamp,
          x: row.position_x,
          z: row.position_z,
          vx: row.velocity_x,
          vz: row.velocity_z,
          roiId: row.roi_id,
        });
      }
    } catch (err) {
      console.warn('[ReplayClipBuilder] Failed to get track positions:', err.message);
    }

    return positions;
  }

  /**
   * Get all relevant zone IDs from episode entities
   */
  _getRelevantZoneIds(episode) {
    const zoneIds = new Set();
    const entities = episode.entities || {};

    for (const id of (entities.zone_ids || [])) zoneIds.add(id);
    for (const id of (entities.queue_zone_ids || [])) zoneIds.add(id);

    return [...zoneIds];
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
