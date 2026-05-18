/**
 * PerceptionTransform
 * --------------------
 * Maps a position published by the perception software (in its own sensor
 * reference frame) to the venue reference frame used by Hyperspace.
 *
 * Pipeline (per track): axis remap → axis sign → uniform scale → rotation Y → translation
 *
 *   [xv]   [ cosθ  -sinθ ] [ sx · sign_x · (axis_map.px ? p.z : p.x) ]   [ origin.x ]
 *   [zv] = [ sinθ   cosθ ] [ sz · sign_z · (axis_map.pz ? p.x : p.z) ] + [ origin.z ]
 *
 * Default transform = identity (perception X → venue X, perception Z → venue Z,
 * no rotation, no translation), so behavior is unchanged when no transform is set.
 */

export const IDENTITY_TRANSFORM = Object.freeze({
  origin_m: { x: 0, z: 0 },
  rotation_deg: 0,
  axis_map: { px: 'x', pz: 'z' }, // perception X → venue X, perception Z → venue Z
  axis_sign: { x: 1, z: 1 },      // no mirror
  scale: 1.0,
});

/** Sanitize an incoming transform object — fill defaults, clamp angles. */
export function normalizePerceptionTransform(raw) {
  if (!raw || typeof raw !== 'object') return { ...IDENTITY_TRANSFORM };
  const t = { ...IDENTITY_TRANSFORM, ...raw };
  t.origin_m = {
    x: Number(raw.origin_m?.x ?? 0),
    z: Number(raw.origin_m?.z ?? 0),
  };
  t.rotation_deg = Number(raw.rotation_deg ?? 0) % 360;
  t.axis_map = {
    px: raw.axis_map?.px === 'z' ? 'z' : 'x',
    pz: raw.axis_map?.pz === 'x' ? 'x' : 'z',
  };
  t.axis_sign = {
    x: raw.axis_sign?.x === -1 ? -1 : 1,
    z: raw.axis_sign?.z === -1 ? -1 : 1,
  };
  t.scale = Number(raw.scale ?? 1) || 1;
  return t;
}

/** Apply transform to a {x, y, z} point in perception frame; returns venue frame. */
export function applyTransformToPoint(transform, point) {
  if (!point) return point;
  const t = transform || IDENTITY_TRANSFORM;
  const px = Number(point.x ?? 0);
  const pz = Number(point.z ?? 0);
  const py = Number(point.y ?? 0); // pass-through (height)

  // 1. axis remap
  const ax = t.axis_map.px === 'z' ? pz : px;
  const az = t.axis_map.pz === 'x' ? px : pz;

  // 2. axis sign + uniform scale
  const sx = t.axis_sign.x * ax * t.scale;
  const sz = t.axis_sign.z * az * t.scale;

  // 3. rotation around Y axis
  const rad = (t.rotation_deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rx = sx * c - sz * s;
  const rz = sx * s + sz * c;

  // 4. translation
  return {
    x: rx + t.origin_m.x,
    y: py,
    z: rz + t.origin_m.z,
  };
}

/** Apply transform to a velocity vector (rotation + scale only — no translation). */
export function applyTransformToVelocity(transform, velocity) {
  if (!velocity) return velocity;
  const t = transform || IDENTITY_TRANSFORM;
  const vx = Number(velocity.x ?? 0);
  const vz = Number(velocity.z ?? 0);
  const vy = Number(velocity.y ?? 0);

  const ax = t.axis_map.px === 'z' ? vz : vx;
  const az = t.axis_map.pz === 'x' ? vx : vz;
  const sx = t.axis_sign.x * ax * t.scale;
  const sz = t.axis_sign.z * az * t.scale;

  const rad = (t.rotation_deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: sx * c - sz * s,
    y: vy,
    z: sx * s + sz * c,
  };
}

/**
 * Solve a 2D similarity transform (rotation + translation + uniform scale)
 * from two correspondences. Used by the "two-point calibration" helper.
 *
 *   perception:  A_p = (ax_p, az_p),  B_p = (bx_p, bz_p)
 *   venue:       A_v = (ax_v, az_v),  B_v = (bx_v, bz_v)
 *
 * Returns { origin_m, rotation_deg, scale } that maps perception → venue.
 * Returns null if the two perception points coincide (degenerate input).
 */
export function solveTwoPointCalibration(A_perc, A_venue, B_perc, B_venue) {
  const dxp = B_perc.x - A_perc.x;
  const dzp = B_perc.z - A_perc.z;
  const dxv = B_venue.x - A_venue.x;
  const dzv = B_venue.z - A_venue.z;

  const len_p = Math.hypot(dxp, dzp);
  const len_v = Math.hypot(dxv, dzv);
  if (len_p < 1e-6) return null;

  const scale = len_v / len_p;
  // Angle of perception vector and venue vector (about Y)
  const angle_p = Math.atan2(dzp, dxp);
  const angle_v = Math.atan2(dzv, dxv);
  const rotation_rad = angle_v - angle_p;
  const rotation_deg = (rotation_rad * 180) / Math.PI;

  // Solve translation by mapping A_perc → A_venue
  const c = Math.cos(rotation_rad);
  const s = Math.sin(rotation_rad);
  const rotatedA_x = (A_perc.x * c - A_perc.z * s) * scale;
  const rotatedA_z = (A_perc.x * s + A_perc.z * c) * scale;
  const origin_m = {
    x: A_venue.x - rotatedA_x,
    z: A_venue.z - rotatedA_z,
  };

  return {
    origin_m,
    rotation_deg: ((rotation_deg % 360) + 360) % 360,
    scale,
  };
}
