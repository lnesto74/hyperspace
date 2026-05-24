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

/** Raw capture coords: x = perception X, z = perception Y (floor). Matches ReplayService. */
export function perceptionToVenue(
  x: number,
  z: number,
  transform: PerceptionTransform | null | undefined,
) {
  const t = transform
  const ySign = t?.input_frame === 'ros_rep103' ? -1 : 1
  const v = applyTransformToPoint(transform, { x, y: 0, z: ySign * z })
  return { x: v.x, z: v.z }
}

export interface MapCalibration {
  offsetX: number
  offsetZ: number
  rotationDeg: number
  scale: number
}

export const DEFAULT_MAP_CALIBRATION: MapCalibration = {
  offsetX: 0,
  offsetZ: 0,
  rotationDeg: 0,
  scale: 1,
}

const CAL_STORAGE_PREFIX = 'hyperspace_benchmark_map_cal_'

export function loadMapCalibration(venueId: string | undefined): MapCalibration {
  if (!venueId) return { ...DEFAULT_MAP_CALIBRATION }
  try {
    const raw = localStorage.getItem(`${CAL_STORAGE_PREFIX}${venueId}`)
    if (!raw) return { ...DEFAULT_MAP_CALIBRATION }
    const parsed = JSON.parse(raw) as Partial<MapCalibration>
    return {
      offsetX: Number(parsed.offsetX) || 0,
      offsetZ: Number(parsed.offsetZ) || 0,
      rotationDeg: Number(parsed.rotationDeg) || 0,
      scale: Number(parsed.scale) || 1,
    }
  } catch {
    return { ...DEFAULT_MAP_CALIBRATION }
  }
}

export function saveMapCalibration(venueId: string, cal: MapCalibration) {
  localStorage.setItem(`${CAL_STORAGE_PREFIX}${venueId}`, JSON.stringify(cal))
}

export function applyMapCalibration(
  point: { x: number; z: number },
  cal: MapCalibration,
  pivot: { x: number; z: number },
): { x: number; z: number } {
  let x = point.x - pivot.x
  let z = point.z - pivot.z
  x *= cal.scale
  z *= cal.scale
  const rad = (cal.rotationDeg * Math.PI) / 180
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  const rx = x * c - z * s
  const rz = x * s + z * c
  return { x: rx + pivot.x + cal.offsetX, z: rz + pivot.z + cal.offsetZ }
}

export interface DwgBootstrap {
  effectiveScale: number
  centerOffset: { x: number; z: number }
  shift: { x: number; z: number }
  venueSize: { width: number; depth: number }
}

export interface FloorplanTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation?: number
  opacity?: number
}

export function dxfToVenueWorld(
  xDxf: number,
  yDxf: number,
  boot: DwgBootstrap,
): { x: number; z: number } {
  const venueFloorCenterX = boot.venueSize.width / 2
  const venueFloorCenterZ = boot.venueSize.depth / 2
  const centerX = boot.centerOffset.x
  const centerZ = boot.centerOffset.z
  const contentCenterX = venueFloorCenterX - boot.shift.x
  const contentCenterZ = venueFloorCenterZ - boot.shift.z
  return {
    x: venueFloorCenterX + ((xDxf * boot.effectiveScale - centerX) - contentCenterX),
    z: venueFloorCenterZ - ((yDxf * boot.effectiveScale - centerZ) - contentCenterZ),
  }
}

export function floorplanImageRect(
  imgW: number,
  imgH: number,
  fpTransform: FloorplanTransform,
  boot: DwgBootstrap,
) {
  const dxfW = imgW * fpTransform.scaleX
  const dxfH = imgH * fpTransform.scaleY
  const planeW = dxfW * boot.effectiveScale
  const planeD = dxfH * boot.effectiveScale
  const imgCenterDxfX = fpTransform.x + dxfW / 2
  const imgCenterDxfY = fpTransform.y + dxfH / 2
  const center = dxfToVenueWorld(imgCenterDxfX, imgCenterDxfY, boot)
  return {
    cx: center.x,
    cz: center.z,
    w: planeW,
    d: planeD,
    rotationDeg: fpTransform.rotation ?? 0,
    opacity: fpTransform.opacity ?? 0.35,
  }
}

function unionBbox(a: MapBbox, b: MapBbox): MapBbox {
  return {
    x0: Math.min(a.x0, b.x0),
    x1: Math.max(a.x1, b.x1),
    z0: Math.min(a.z0, b.z0),
    z1: Math.max(a.z1, b.z1),
  }
}

function bboxFromObjects(
  objects: Array<{ x: number; z: number; w: number; d: number }>,
): MapBbox | null {
  if (!objects.length) return null
  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const o of objects) {
    x0 = Math.min(x0, o.x - o.w / 2)
    x1 = Math.max(x1, o.x + o.w / 2)
    z0 = Math.min(z0, o.z - o.d / 2)
    z1 = Math.max(z1, o.z + o.d / 2)
  }
  return { x0, x1, z0, z1 }
}

export function transformZoneWithCalibration(
  zone: { x0: number; x1: number; z0: number; z1: number },
  transform: PerceptionTransform | null | undefined,
  calibration: MapCalibration,
  pivot: { x: number; z: number },
) {
  const corners = [
    { x: zone.x0, z: zone.z0 },
    { x: zone.x1, z: zone.z0 },
    { x: zone.x1, z: zone.z1 },
    { x: zone.x0, z: zone.z1 },
  ].map((c) => applyMapCalibration(perceptionToVenue(c.x, c.z, transform), calibration, pivot))
  return {
    x0: Math.min(...corners.map((c) => c.x)),
    x1: Math.max(...corners.map((c) => c.x)),
    z0: Math.min(...corners.map((c) => c.z)),
    z1: Math.max(...corners.map((c) => c.z)),
  }
}

export function computeDisplayBbox(opts: {
  spatialBbox: MapBbox
  useVenue: boolean
  transform: PerceptionTransform | null | undefined
  calibration: MapCalibration
  venueWidth: number
  venueDepth: number
  objects?: Array<{ x: number; z: number; w: number; d: number }>
  floorplanRect?: { cx: number; cz: number; w: number; d: number } | null
}): MapBbox {
  if (!opts.useVenue) return opts.spatialBbox

  const pivot = { x: opts.venueWidth / 2, z: opts.venueDepth / 2 }
  let bbox = venueBbox(opts.venueWidth, opts.venueDepth, 2)

  const sensorCorners = [
    { x: opts.spatialBbox.x0, z: opts.spatialBbox.z0 },
    { x: opts.spatialBbox.x1, z: opts.spatialBbox.z0 },
    { x: opts.spatialBbox.x1, z: opts.spatialBbox.z1 },
    { x: opts.spatialBbox.x0, z: opts.spatialBbox.z1 },
  ].map((c) => applyMapCalibration(perceptionToVenue(c.x, c.z, opts.transform), opts.calibration, pivot))
  const trackBbox: MapBbox = {
    x0: Math.min(...sensorCorners.map((c) => c.x)),
    x1: Math.max(...sensorCorners.map((c) => c.x)),
    z0: Math.min(...sensorCorners.map((c) => c.z)),
    z1: Math.max(...sensorCorners.map((c) => c.z)),
  }
  bbox = unionBbox(bbox, trackBbox)

  const objBbox = bboxFromObjects(opts.objects ?? [])
  if (objBbox) bbox = unionBbox(bbox, objBbox)

  if (opts.floorplanRect) {
    const fp = opts.floorplanRect
    bbox = unionBbox(bbox, {
      x0: fp.cx - fp.w / 2,
      x1: fp.cx + fp.w / 2,
      z0: fp.cz - fp.d / 2,
      z1: fp.cz + fp.d / 2,
    })
  }

  const pad = 2
  return {
    x0: bbox.x0 - pad,
    x1: bbox.x1 + pad,
    z0: bbox.z0 - pad,
    z1: bbox.z1 + pad,
  }
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
