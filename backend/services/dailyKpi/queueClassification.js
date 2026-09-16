/**
 * Port of analysis/journey_lab/150_queue_wait.py visit classification.
 * FIXED before TRANSIT before WAITING. Thresholds from checkout_fixed_object.
 */

export const DEFAULT_CHECKOUT_FIXED = {
  fixed_s: 600,
  near_m: 1.2,
  near_s: 60,
  speed_walk_mps: 0.5,
};

export function nearFixedSpot(visit, spots, nearM = DEFAULT_CHECKOUT_FIXED.near_m) {
  const mx = Number(visit.mx);
  const mz = Number(visit.mz);
  return (spots || []).some((s) => {
    const dx = mx - Number(s.mx);
    const dz = mz - Number(s.mz);
    return Math.sqrt(dx * dx + dz * dz) < nearM;
  });
}

/** Ids with a visit >= fixed_s become spots; fragments >= near_s within near_m are also FIXED. */
export function collectFixedSpots(visits, params = DEFAULT_CHECKOUT_FIXED) {
  return (visits || [])
    .filter((v) => Number(v.dur_s) >= params.fixed_s)
    .map((v) => ({ id: v.id, mx: v.mx, mz: v.mz, dur_s: v.dur_s, src: 'long_visit' }));
}

export function classifyQueueVisit(visit, spots, params = DEFAULT_CHECKOUT_FIXED) {
  const dur = Number(visit.dur_s) || 0;
  const spd = Number(visit.mean_spd) || 0;
  if (dur >= params.fixed_s || (dur >= params.near_s && nearFixedSpot(visit, spots, params.near_m))) {
    return 'FIXED';
  }
  if (spd >= params.speed_walk_mps) return 'TRANSIT';
  return 'WAITING';
}

/** Upstream exclusion: the id itself, plus any visit that classifies as FIXED. */
export function excludedCheckoutFixedIds(visits, params = DEFAULT_CHECKOUT_FIXED) {
  const spots = collectFixedSpots(visits, params);
  const ids = new Set(spots.map((s) => s.id));
  for (const v of visits || []) {
    if (classifyQueueVisit(v, spots, params) === 'FIXED' && v.id) ids.add(v.id);
  }
  return ids;
}
