/**
 * Perception → venue coordinate transform.
 *
 * Coordinate conventions:
 *   Perception software: X,Y = floor plane, Z = height (up).
 *   Hyperspace (Three.js): X,Z = floor plane, Y = height (up).
 *
 * The Y↔Z swap is handled in MqttTrajectoryService before this transform
 * runs. The `origin_m` stores venue floor-plane coords (Three.js X,Z), but
 * the Matching UI labels them X,Y to match the perception developer's frame.
 *
 * The `axis_map` uses perception language: `px` = perception +X axis,
 * `py` = perception +Y axis. Values ('x' or 'z') indicate which Three.js
 * floor axis each maps to.
 */
export interface PerceptionTransform {
  /** Where perception (0,0) sits in venue meters (Three.js X,Z floor plane). */
  origin_m: { x: number; z: number };
  /** Rotation about vertical axis (degrees, perception +X → venue +X). */
  rotation_deg: number;
  /** Axis remap: px = where perception X lands, py = where perception Y lands. */
  axis_map: { px: 'x' | 'z'; py: 'x' | 'z' };
  /** Axis sign (handles mirrored axes). */
  axis_sign: { x: 1 | -1; z: 1 | -1 };
  /** Uniform scale; usually 1.0 since perception already publishes meters. */
  scale: number;
  /** Set by the server on save. */
  updated_at?: string;
}

export const IDENTITY_PERCEPTION_TRANSFORM: PerceptionTransform = {
  origin_m: { x: 0, z: 0 },
  rotation_deg: 0,
  axis_map: { px: 'x', py: 'z' },
  axis_sign: { x: 1, z: 1 },
  scale: 1.0,
};

/** Read perceptionTransform from a venue.dwg_transform_json string (returns null if absent). */
export function readPerceptionTransform(dwgTransformJson?: string | null): PerceptionTransform | null {
  if (!dwgTransformJson) return null;
  try {
    const parsed = typeof dwgTransformJson === 'string' ? JSON.parse(dwgTransformJson) : dwgTransformJson;
    return parsed?.perceptionTransform || null;
  } catch {
    return null;
  }
}

/**
 * Map a perception-frame point (already Y↔Z swapped) to venue meters in the browser.
 * Order: remap → scale → rotation → mirror (in venue frame, after rotation) → translate.
 */
export function applyTransformToPoint(
  transform: PerceptionTransform | null | undefined,
  point: { x: number; y?: number; z: number }
): { x: number; y: number; z: number } {
  const t = transform || IDENTITY_PERCEPTION_TRANSFORM;
  const ax = t.axis_map.px === 'z' ? point.z : point.x;
  const az = t.axis_map.py === 'x' ? point.x : point.z;
  const sx = ax * t.scale;
  const sz = az * t.scale;
  const rad = (t.rotation_deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const rx = (sx * c - sz * s) * t.axis_sign.x;
  const rz = (sx * s + sz * c) * t.axis_sign.z;
  return {
    x: rx + t.origin_m.x,
    y: point.y ?? 0,
    z: rz + t.origin_m.z,
  };
}

/** Solve translation + rotation + uniform scale from two perception↔venue correspondences. */
export function solveTwoPointCalibration(
  A_perc: { x: number; z: number },
  A_venue: { x: number; z: number },
  B_perc: { x: number; z: number },
  B_venue: { x: number; z: number }
): { origin_m: { x: number; z: number }; rotation_deg: number; scale: number } | null {
  const dxp = B_perc.x - A_perc.x;
  const dzp = B_perc.z - A_perc.z;
  const dxv = B_venue.x - A_venue.x;
  const dzv = B_venue.z - A_venue.z;
  const lenP = Math.hypot(dxp, dzp);
  if (lenP < 1e-6) return null;
  const scale = Math.hypot(dxv, dzv) / lenP;
  const rotRad = Math.atan2(dzv, dxv) - Math.atan2(dzp, dxp);
  const c = Math.cos(rotRad);
  const s = Math.sin(rotRad);
  const rotatedA_x = (A_perc.x * c - A_perc.z * s) * scale;
  const rotatedA_z = (A_perc.x * s + A_perc.z * c) * scale;
  return {
    origin_m: { x: A_venue.x - rotatedA_x, z: A_venue.z - rotatedA_z },
    rotation_deg: ((rotRad * 180) / Math.PI + 360) % 360,
    scale,
  };
}
