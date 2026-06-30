/**
 * Ingress footfall from live perimeter-edge crossings (ingress_perimeter_crossings).
 * One row per crossing event — no dwell, no dedup.
 */

import { aggregateByVenueLocalHour, DEFAULT_VENUE_TIMEZONE } from './storeHours.js';

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

export function fetchPerimeterEntrantsByHour(
  db,
  trafficRoiIds,
  startTs,
  endTs,
  openingHour = 8,
  closingHour = 20,
  timeZone = DEFAULT_VENUE_TIMEZONE,
  onlyDateKey = null,
) {
  if (!trafficRoiIds?.length) return [];
  try {
    const ph = trafficRoiIds.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT crossed_at
      FROM ingress_perimeter_crossings
      WHERE roi_id IN (${ph})
        AND crossed_at >= ?
        AND crossed_at < ?
    `).all(...trafficRoiIds, startTs, endTs);
    const map = aggregateByVenueLocalHour(
      rows,
      r => r.crossed_at,
      null,
      openingHour,
      closingHour,
      timeZone,
      onlyDateKey,
    );
    return [...map.entries()]
      .map(([hour, value]) => ({ hour, value }))
      .sort((a, b) => a.hour - b.hour);
  } catch {
    return [];
  }
}
