/**
 * Ingress footfall from live perimeter-edge crossings (ingress_perimeter_crossings).
 * One row per crossing event — no dwell, no dedup.
 */

export function countPerimeterEntrants(db, { venueId, trafficRoiIds, startTs, endTs }) {
  if (!trafficRoiIds?.length) {
    return { count: 0, uniqueTracks: 0, method: 'perimeter_crossing' };
  }
  try {
    const ph = trafficRoiIds.map(() => '?').join(',');
    const row = db.prepare(`
      SELECT COUNT(*) AS count, COUNT(DISTINCT track_key) AS uniqueTracks
      FROM ingress_perimeter_crossings
      WHERE venue_id = ?
        AND roi_id IN (${ph})
        AND crossed_at >= ?
        AND crossed_at < ?
    `).get(venueId, ...trafficRoiIds, startTs, endTs);
    return {
      count: row?.count ?? 0,
      uniqueTracks: row?.uniqueTracks ?? 0,
      method: 'perimeter_crossing',
    };
  } catch {
    return { count: 0, uniqueTracks: 0, method: 'perimeter_crossing' };
  }
}

export function fetchPerimeterEntrantsByHour(db, trafficRoiIds, startTs, endTs) {
  if (!trafficRoiIds?.length) return [];
  try {
    const ph = trafficRoiIds.map(() => '?').join(',');
    return db.prepare(`
      SELECT CAST(strftime('%H', crossed_at / 1000.0, 'unixepoch', 'localtime') AS INTEGER) AS hour,
             COUNT(*) AS value
      FROM ingress_perimeter_crossings
      WHERE roi_id IN (${ph})
        AND crossed_at >= ?
        AND crossed_at < ?
      GROUP BY hour
      ORDER BY hour
    `).all(...trafficRoiIds, startTs, endTs);
  } catch {
    return [];
  }
}
