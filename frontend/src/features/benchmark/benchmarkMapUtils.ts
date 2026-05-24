import {
  applyTransformToPoint,
  type PerceptionTransform,
} from '../../types/perceptionTransform'

export interface MapBbox {
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface MapView {
  scale: number
  panX: number
  panY: number
}

export const DEFAULT_MAP_VIEW: MapView = { scale: 1, panX: 0, panY: 0 }

export function projectPoint(
  x: number,
  z: number,
  bbox: MapBbox,
  width: number,
  height: number,
  pad: number,
  view: MapView,
) {
  const bw = bbox.x1 - bbox.x0 || 1
  const bh = bbox.z1 - bbox.z0 || 1
  const sx = (width - pad * 2) / bw
  const sy = (height - pad * 2) / bh
  const baseScale = Math.min(sx, sy)
  const ox = pad + (width - pad * 2 - bw * baseScale) / 2
  const oz = pad + (height - pad * 2 - bh * baseScale) / 2
  const cx = ox + (x - bbox.x0) * baseScale
  const cy = height - (oz + (z - bbox.z0) * baseScale)
  return {
    cx: (cx - width / 2) * view.scale + width / 2 + view.panX,
    cy: (cy - height / 2) * view.scale + height / 2 + view.panY,
    scale: baseScale * view.scale,
  }
}

export function perceptionToVenue(
  x: number,
  z: number,
  transform: PerceptionTransform | null | undefined,
) {
  const v = applyTransformToPoint(transform, { x, y: 0, z })
  return { x: v.x, z: v.z }
}

export function transformZoneToVenue(
  zone: { x0: number; x1: number; z0: number; z1: number },
  transform: PerceptionTransform | null | undefined,
) {
  const corners = [
    perceptionToVenue(zone.x0, zone.z0, transform),
    perceptionToVenue(zone.x1, zone.z0, transform),
    perceptionToVenue(zone.x1, zone.z1, transform),
    perceptionToVenue(zone.x0, zone.z1, transform),
  ]
  return {
    x0: Math.min(...corners.map((c) => c.x)),
    x1: Math.max(...corners.map((c) => c.x)),
    z0: Math.min(...corners.map((c) => c.z)),
    z1: Math.max(...corners.map((c) => c.z)),
  }
}

export function venueBbox(
  width: number,
  depth: number,
  padding = 2,
): MapBbox {
  return {
    x0: -padding,
    x1: width + padding,
    z0: -padding,
    z1: depth + padding,
  }
}

export function severityColor(severity: number, alpha = 0.55): string {
  if (severity >= 0.75) return `rgba(239, 68, 68, ${alpha})`
  if (severity >= 0.5) return `rgba(249, 115, 22, ${alpha})`
  if (severity >= 0.3) return `rgba(234, 179, 8, ${alpha})`
  return `rgba(148, 163, 184, ${alpha})`
}

export function computeDataConfidenceScore(
  perception?: {
    fragmentation_factor?: number | null
    teleports_per_1k?: number | null
    shopper_grade_ge_30m?: number | null
    unique_perception_ids?: number | null
    estimated_real_shoppers?: number | null
  } | null,
  structural?: {
    significant_blindspot_m2?: number | null
    walkable_area_m2?: number | null
    fragmentation_cause_pct?: { occlusion?: number; blindspot?: number }
  } | null,
  reconcilerGb?: { fragmentation_x?: number | null; mean_lifetime_s?: number | null } | null,
): number {
  let score = 100
  const frag = perception?.fragmentation_factor ?? 0
  if (frag > 40) score -= 35
  else if (frag > 20) score -= 25
  else if (frag > 10) score -= 15
  else if (frag > 5) score -= 8

  const tp = perception?.teleports_per_1k ?? 0
  if (tp > 50) score -= 15
  else if (tp > 20) score -= 8

  const walkable = structural?.walkable_area_m2 ?? 1
  const blind = structural?.significant_blindspot_m2 ?? 0
  const blindPct = (blind / walkable) * 100
  if (blindPct > 40) score -= 20
  else if (blindPct > 25) score -= 12

  if (reconcilerGb?.fragmentation_x != null && frag > 0) {
    const improvement = 1 - reconcilerGb.fragmentation_x / frag
    score += Math.min(15, improvement * 20)
  }

  return Math.max(0, Math.min(100, Math.round(score)))
}
