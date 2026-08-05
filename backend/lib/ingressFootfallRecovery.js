/**
 * Gate-proximity footfall recovery for fragmented perception tracks.
 *
 * Counts shoppers who crossed Entrance 1121 directly, plus "recovered" entrants:
 * track fragments whose first in-store appearance is near the gate without a gate crossing.
 */

import { isHourWithinStoreHours, venueLocalHour } from './storeHours.js';

export const DEFAULT_RECOVERY_CONFIG = {
  gateDedupWindowMs: 3000,
  gateDedupRadiusM: 1.2,
  recoveryRadiusM: 3.0,
  recoveryClusterWindowMs: 8000,
  recoveryClusterRadiusM: 3.0,
  /** Orphan must appear within this window after a gate crossing at the same location */
  recoveryAfterGateMs: 10000,
};

export function hourInVenueLocal(ts, openingHour, closingHour, timeZone = 'Europe/Rome') {
  return isHourWithinStoreHours(venueLocalHour(ts, timeZone), openingHour, closingHour);
}

export function roiCentroid(verticesJson) {
  let verts = verticesJson;
  if (typeof verts === 'string') {
    try { verts = JSON.parse(verts); } catch { return null; }
  }
  if (!Array.isArray(verts) || verts.length === 0) return null;
  const xs = verts.map(p => p.x);
  const zs = verts.map(p => p.z);
  return {
    x: xs.reduce((a, b) => a + b, 0) / xs.length,
    z: zs.reduce((a, b) => a + b, 0) / zs.length,
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    z0: Math.min(...zs),
    z1: Math.max(...zs),
  };
}

export function distM(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

/**
 * Cluster events in time+space → estimated unique people.
 * @param {Array<{ t: number, x: number, z: number }>} events
 */
export function clusterFootfallEvents(events, windowMs, radiusM) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const clusters = [];
  for (const e of sorted) {
    let merged = false;
    for (let c = clusters.length - 1; c >= 0; c--) {
      const cl = clusters[c];
      if (e.t - cl.t > windowMs) break;
      if (distM(e.x, e.z, cl.x, cl.z) <= radiusM) {
        cl.t = e.t;
        cl.x = e.x;
        cl.z = e.z;
        cl.events = (cl.events || 1) + 1;
        merged = true;
        break;
      }
    }
    if (!merged) clusters.push({ t: e.t, x: e.x, z: e.z, events: 1 });
  }
  return clusters;
}

function safeQueryAll(db, sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return [];
  }
}

/**
 * @returns {{
 *   directCrossings: number,
 *   directUnique: number,
 *   directEstimated: number,
 *   recoveredFragments: number,
 *   recoveredEstimated: number,
 *   totalVisitors: number,
 *   recoveryPct: number,
 *   method: string,
 * }}
 */
export function computeIngressFootfallWithRecovery(
  db,
  {
    venueId,
    trafficRoiIds,
    shoppingRoiIds,
    startTs,
    endTs,
    openingHour = 8,
    closingHour = 21,
    timeZone = 'Europe/Rome',
    config = DEFAULT_RECOVERY_CONFIG,
  },
) {
  const cfg = { ...DEFAULT_RECOVERY_CONFIG, ...config };

  if (!trafficRoiIds?.length) {
    return {
      directCrossings: 0,
      directUnique: 0,
      directEstimated: 0,
      recoveredFragments: 0,
      recoveredEstimated: 0,
      recoveredTrackKeys: [],
      totalVisitors: 0,
      recoveryPct: 0,
      method: 'none',
    };
  }

  const gateRoi = safeQueryAll(db, `
    SELECT id, vertices FROM regions_of_interest WHERE id = ? LIMIT 1
  `, [trafficRoiIds[0]])[0];
  const gate = gateRoi ? roiCentroid(gateRoi.vertices) : null;

  const phTraffic = trafficRoiIds.map(() => '?').join(',');
  const entranceRows = safeQueryAll(db, `
    SELECT track_key, start_time, entry_position_x, entry_position_z
    FROM zone_visits
    WHERE venue_id = ? AND roi_id IN (${phTraffic})
      AND start_time >= ? AND start_time < ?
      AND track_key NOT LIKE '%cashier%'
  `, [venueId, ...trafficRoiIds, startTs, endTs]);

  const openEntrance = entranceRows.filter(r =>
    hourInVenueLocal(r.start_time, openingHour, closingHour, timeZone),
  );

  const directEvents = openEntrance.map(r => ({
    t: r.start_time,
    x: r.entry_position_x ?? gate?.x ?? 0,
    z: r.entry_position_z ?? gate?.z ?? 0,
  }));
  const directClusters = clusterFootfallEvents(
    directEvents,
    cfg.gateDedupWindowMs,
    cfg.gateDedupRadiusM,
  );
  const directUnique = new Set(openEntrance.map(r => r.track_key)).size;

  if (!gate || !shoppingRoiIds?.length) {
    const total = directClusters.length;
    return {
      directCrossings: openEntrance.length,
      directUnique,
      directEstimated: directClusters.length,
      recoveredFragments: 0,
      recoveredEstimated: 0,
      recoveredTrackKeys: [],
      totalVisitors: total,
      recoveryPct: 0,
      method: 'gate_direct',
    };
  }

  const entranceTracks = new Set(openEntrance.map(r => r.track_key));
  const phShop = shoppingRoiIds.map(() => '?').join(',');

  const gateX = gate.x;
  const gateZ = gate.z;
  const radiusSq = cfg.recoveryRadiusM * cfg.recoveryRadiusM;

  // First in-store appearance per track, ranked in a single pass. The previous
  // self-join left its outer scan unbounded in time, so a 1h request cost the
  // same as scanning every shopping-zone visit ever recorded.
  const orphanFirst = safeQueryAll(db, `
    SELECT track_key, start_time, entry_position_x, entry_position_z
    FROM (
      SELECT track_key, start_time, entry_position_x, entry_position_z,
             ROW_NUMBER() OVER (PARTITION BY track_key ORDER BY start_time) AS rn
      FROM zone_visits
      WHERE venue_id = ? AND roi_id IN (${phShop})
        AND start_time >= ? AND start_time < ?
        AND track_key NOT LIKE '%cashier%'
    )
    WHERE rn = 1
      AND ((entry_position_x - ?) * (entry_position_x - ?)
         + (entry_position_z - ?) * (entry_position_z - ?)) <= ?
  `, [
    venueId, ...shoppingRoiIds, startTs, endTs,
    gateX, gateX, gateZ, gateZ, radiusSq,
  ]);

  // Time-ordered gate events so each orphan only compares against the handful
  // of crossings inside its window, not every crossing in the range.
  const gateEvents = [...directEvents].sort((a, b) => a.t - b.t);
  const gateTimes = new Float64Array(gateEvents.length);
  for (let i = 0; i < gateEvents.length; i++) gateTimes[i] = gateEvents[i].t;

  function hasNearbyGateEvent(ts, x, z) {
    const from = ts - cfg.recoveryAfterGateMs;
    const until = ts + cfg.recoveryAfterGateMs;
    let lo = 0;
    let hi = gateTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (gateTimes[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < gateEvents.length; i++) {
      const e = gateEvents[i];
      if (e.t > until) break;
      if (distM(x, z, e.x, e.z) <= cfg.recoveryRadiusM) return true;
    }
    return false;
  }

  const recoveredCandidates = [];
  for (const row of orphanFirst) {
    if (entranceTracks.has(row.track_key)) continue;
    if (!hourInVenueLocal(row.start_time, openingHour, closingHour, timeZone)) continue;
    const x = row.entry_position_x ?? gateX;
    const z = row.entry_position_z ?? gateZ;
    if (!hasNearbyGateEvent(row.start_time, x, z)) continue;
    recoveredCandidates.push({ t: row.start_time, x, z, track: row.track_key });
  }

  const recoveredClusters = clusterFootfallEvents(
    recoveredCandidates,
    cfg.recoveryClusterWindowMs,
    cfg.recoveryClusterRadiusM,
  );

  const directEstimated = directClusters.length;
  const recoveredEstimated = recoveredClusters.length;
  const totalVisitors = directEstimated + recoveredEstimated;
  const recoveryPct = totalVisitors > 0
    ? Math.round((recoveredEstimated / totalVisitors) * 1000) / 10
    : 0;

  return {
    directCrossings: openEntrance.length,
    directUnique,
    directEstimated,
    recoveredFragments: recoveredCandidates.length,
    recoveredEstimated,
    recoveredTrackKeys: [...new Set(recoveredCandidates.map(c => c.track))],
    totalVisitors,
    recoveryPct,
    method: 'gate_direct_plus_proximity',
    gateCenter: gate ? { x: gate.x, z: gate.z } : null,
  };
}
