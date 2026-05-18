/**
 * PerceptionTransform
 * --------------------
 * Maps a position published by the perception software (in its own sensor
 * reference frame) to the venue reference frame used by Hyperspace.
 *
 * IMPORTANT — coordinate convention:
 *   Perception: X,Y = floor plane, Z = height (up).
 *   Three.js:   X,Z = floor plane, Y = height (up).
 * The Y↔Z swap is done in MqttTrajectoryService BEFORE this transform runs,
 * so by the time a point reaches these functions it's already in Three.js
 * coords (floor = X,Z).
 *
 * The axis_map keys use perception language: `px` = perception +X, `py` =
 * perception +Y, so the UI can label them naturally for the perception
 * developer. Internally they remap to Three.js X,Z on the floor plane.
 *
 * Pipeline (per track): axis remap → axis sign → uniform scale → rotation Y → translation
 *
 *   [xv]   [ cosθ  -sinθ ] [ sx · sign_x · remapped_x ]   [ origin.x ]
 *   [zv] = [ sinθ   cosθ ] [ sz · sign_z · remapped_z ] + [ origin.z ]
 *
 * Default transform = identity (no rotation, no translation).
 */

export const IDENTITY_TRANSFORM = Object.freeze({
  origin_m: { x: 0, z: 0 },
  rotation_deg: 0,
  axis_map: { px: 'x', py: 'z' }, // perception X → venue X, perception Y → venue Z
  axis_sign: { x: 1, z: 1 },
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
    py: raw.axis_map?.py === 'x' ? 'x' : 'z',
  };
  t.axis_sign = {
    x: raw.axis_sign?.x === -1 ? -1 : 1,
    z: raw.axis_sign?.z === -1 ? -1 : 1,
  };
  t.scale = Number(raw.scale ?? 1) || 1;
  return t;
}

/**
 * Apply transform to a {x, y, z} point (already in Three.js coords after Y↔Z swap).
 * Returns venue-frame position.
 *
 * Order: axis remap → uniform scale → rotation around vertical → mirror (in venue
 * frame, AFTER rotation, so "Flip ↕" intuitively swaps top↔bottom regardless of
 * the current rotation) → translation.
 */
export function applyTransformToPoint(transform, point) {
  if (!point) return point;
  const t = transform || IDENTITY_TRANSFORM;
  const px = Number(point.x ?? 0);
  const pz = Number(point.z ?? 0);
  const py = Number(point.y ?? 0); // height pass-through

  // 1. axis remap (px = perception X destination, py = perception Y destination)
  const ax = t.axis_map.px === 'z' ? pz : px;
  const az = t.axis_map.py === 'x' ? px : pz;

  // 2. uniform scale
  const sx = ax * t.scale;
  const sz = az * t.scale;

  // 3. rotation around vertical axis
  const rad = (t.rotation_deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let rx = sx * c - sz * s;
  let rz = sx * s + sz * c;

  // 4. mirror in venue frame (after rotation) — UX-friendly: a Flip ↕ always
  // flips visible top↔bottom even when rotation is at an arbitrary angle.
  rx *= t.axis_sign.x;
  rz *= t.axis_sign.z;

  // 5. translation
  return {
    x: rx + t.origin_m.x,
    y: py,
    z: rz + t.origin_m.z,
  };
}

/** Apply transform to a velocity vector (rotation + scale + mirror only — no translation). */
export function applyTransformToVelocity(transform, velocity) {
  if (!velocity) return velocity;
  const t = transform || IDENTITY_TRANSFORM;
  const vx = Number(velocity.x ?? 0);
  const vz = Number(velocity.z ?? 0);
  const vy = Number(velocity.y ?? 0);

  const ax = t.axis_map.px === 'z' ? vz : vx;
  const az = t.axis_map.py === 'x' ? vx : vz;
  const sx = ax * t.scale;
  const sz = az * t.scale;

  const rad = (t.rotation_deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rx = (sx * c - sz * s) * t.axis_sign.x;
  const rz = (sx * s + sz * c) * t.axis_sign.z;
  return { x: rx, y: vy, z: rz };
}

/**
 * Solve a 2D similarity transform (rotation + translation + uniform scale)
 * from two correspondences. Used by the "two-point calibration" helper.
 *
 *   perception:  A_p = (x, z),  B_p = (x, z)   (Three.js floor coords after swap)
 *   venue:       A_v = (x, z),  B_v = (x, z)
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
  const angle_p = Math.atan2(dzp, dxp);
  const angle_v = Math.atan2(dzv, dxv);
  const rotation_rad = angle_v - angle_p;
  const rotation_deg = (rotation_rad * 180) / Math.PI;

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
