/**
 * Shape stored under venues.dwg_transform_json.perceptionTransform.
 * Maps perception sensor frame → venue meters (Hyperspace world).
 *
 *   [xv]   [ cosθ  -sinθ ] [ sx · sign_x · (axis_map.px === 'z' ? p.z : p.x) ]   [ origin.x ]
 *   [zv] = [ sinθ   cosθ ] [ sz · sign_z · (axis_map.pz === 'x' ? p.x : p.z) ] + [ origin.z ]
 *
 * Identity transform = behavior unchanged (perception X → venue X, perception Z → venue Z).
 */
export interface PerceptionTransform {
  /** Where perception (0,0) sits in venue meters. */
  origin_m: { x: number; z: number };
  /** Rotation about Y axis (degrees, perception +X → venue +X). */
  rotation_deg: number;
  /** Axis remap (handles X↔Z swap). */
  axis_map: { px: 'x' | 'z'; pz: 'x' | 'z' };
  /** Axis sign (handles mirrored / Y-up vs Z-up). */
  axis_sign: { x: 1 | -1; z: 1 | -1 };
  /** Uniform scale; usually 1.0 since perception already publishes meters. */
  scale: number;
  /** Set by the server on save. */
  updated_at?: string;
}

export const IDENTITY_PERCEPTION_TRANSFORM: PerceptionTransform = {
  origin_m: { x: 0, z: 0 },
  rotation_deg: 0,
  axis_map: { px: 'x', pz: 'z' },
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

/** Map a perception-frame point to venue meters in the browser (for live overlays). */
export function applyTransformToPoint(
  transform: PerceptionTransform | null | undefined,
  point: { x: number; y?: number; z: number }
): { x: number; y: number; z: number } {
  const t = transform || IDENTITY_PERCEPTION_TRANSFORM;
  const ax = t.axis_map.px === 'z' ? point.z : point.x;
  const az = t.axis_map.pz === 'x' ? point.x : point.z;
  const sx = t.axis_sign.x * ax * t.scale;
  const sz = t.axis_sign.z * az * t.scale;
  const rad = (t.rotation_deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: sx * c - sz * s + t.origin_m.x,
    y: point.y ?? 0,
    z: sx * s + sz * c + t.origin_m.z,
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
