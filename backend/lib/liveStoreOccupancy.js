/**
 * Live in-store shopper count — same source as Neural dashboard / Operations Pulse.
 * Prefers MQTT frame occupancy (perception frame IDs), then latest track_positions frame.
 */

function safeQuery(db, sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch {
    return null;
  }
}

/**
 * @returns {{ count: number, source: 'live_frame' | 'track_positions' | 'recent_visits' }}
 */
export function resolveLiveShoppersInStore(db, venueId, liveFrameOccupancy) {
  if (liveFrameOccupancy != null && liveFrameOccupancy > 0) {
    return { count: liveFrameOccupancy, source: 'live_frame' };
  }

  const latest = safeQuery(db, `
    SELECT timestamp as ts FROM track_positions
    WHERE venue_id = ? ORDER BY timestamp DESC LIMIT 1
  `, [venueId]);
  if (latest?.ts) {
    const frame = safeQuery(db, `
      SELECT COUNT(DISTINCT track_key) as c
      FROM track_positions
      WHERE venue_id = ? AND timestamp = ? AND track_key NOT LIKE '%cashier%'
    `, [venueId, latest.ts]);
    if ((frame?.c || 0) > 0) {
      return { count: frame.c, source: 'track_positions' };
    }
  }

  const row = safeQuery(db, `
    SELECT COUNT(DISTINCT track_key) as c
    FROM zone_visits
    WHERE venue_id = ?
      AND start_time >= ?
      AND track_key NOT LIKE '%cashier%'
  `, [venueId, Date.now() - 300000]);
  return { count: row?.c || 0, source: 'recent_visits' };
}

/** @deprecated use resolveLiveShoppersInStore */
export function fetchLiveShoppersInStore(db, venueId, liveFrameOccupancy) {
  return resolveLiveShoppersInStore(db, venueId, liveFrameOccupancy).count;
}
