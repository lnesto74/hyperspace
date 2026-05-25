import type { VenueObject } from '../types'
import {
  computeMapBounds,
  getFixtureOutlinePoints,
  type FixtureInfo,
} from '../components/kpi/checkoutCalibrationUtils'

export interface MapRegion {
  id: string
  vertices: { x: number; z: number }[]
}

export interface MapBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface MapTransform {
  tx: (x: number) => number
  tz: (z: number) => number
  scale: number
  cw: number
  ch: number
}

/** Anything beyond grocery scale is almost certainly DXF-mm leakage or corrupt data. */
const MAX_ABS_COORD = 500
const MAX_FOOTPRINT_DRIFT_M = 25

export function normalizeFloorVertex(v: { x: number; z?: number; y?: number }): { x: number; z: number } {
  return { x: v.x, z: v.z ?? v.y ?? 0 }
}

export function venueObjectsToFixtures(objects: VenueObject[]): FixtureInfo[] {
  return objects.map(obj => ({
    id: obj.id,
    name: obj.name,
    type: obj.type,
    position: obj.position,
    rotation: obj.rotation,
    scale: obj.scale,
    source: obj.metadata?.source ?? null,
    footprintPoints: obj.metadata?.dwg_footprint_points ?? null,
  }))
}

export function isSaneMapPoint(
  p: { x: number; z: number },
  anchor?: { x: number; z: number },
): boolean {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return false
  if (Math.abs(p.x) > MAX_ABS_COORD || Math.abs(p.z) > MAX_ABS_COORD) return false
  if (anchor && Math.hypot(p.x - anchor.x, p.z - anchor.z) > MAX_FOOTPRINT_DRIFT_M) return false
  return true
}

/** Footprints from older bootstraps can be in wrong units — fall back to scale box at position. */
export function getDrawableFixtureOutline(fixture: FixtureInfo): { x: number; z: number }[] {
  const anchor = { x: fixture.position.x, z: fixture.position.z }
  const outline = getFixtureOutlinePoints(fixture)
  if (outline.length >= 3) {
    const sane = outline.filter(p => isSaneMapPoint(p, anchor))
    if (sane.length >= 3) {
      const mx = sane.reduce((s, p) => s + p.x, 0) / sane.length
      const mz = sane.reduce((s, p) => s + p.z, 0) / sane.length
      if (Math.hypot(mx - anchor.x, mz - anchor.z) < MAX_FOOTPRINT_DRIFT_M) return sane
    }
  }
  return getFixtureOutlinePoints({ ...fixture, footprintPoints: null })
}

export function normalizeMapRegions(regions: MapRegion[]): MapRegion[] {
  return regions
    .map(r => ({
      id: r.id,
      vertices: r.vertices.map(normalizeFloorVertex).filter(p => isSaneMapPoint(p)),
    }))
    .filter(r => r.vertices.length >= 3)
}

export function collectScenePoints(
  objects: VenueObject[],
  regions: MapRegion[],
  venueSize?: { width: number; depth: number },
): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = []

  for (const f of venueObjectsToFixtures(objects)) {
    pts.push({ x: f.position.x, z: f.position.z })
    for (const p of getDrawableFixtureOutline(f)) pts.push(p)
  }
  for (const r of normalizeMapRegions(regions)) {
    for (const v of r.vertices) pts.push(v)
  }

  const sane = pts.filter(p => isSaneMapPoint(p))
  if (sane.length === 0 && venueSize) {
    sane.push({ x: 0, z: 0 }, { x: venueSize.width, z: venueSize.depth })
  }

  return sane
}

export function computeFloorPlanBounds(
  objects: VenueObject[],
  regions: MapRegion[],
  venueSize?: { width: number; depth: number },
): MapBounds {
  const pts = collectScenePoints(objects, regions, venueSize)
  if (pts.length === 0) {
    return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }
  }
  return computeMapBounds(pts, 0.08)
}

export function boundsToViewBox(bounds: MapBounds): string {
  const w = bounds.maxX - bounds.minX || 1
  const h = bounds.maxZ - bounds.minZ || 1
  return `${bounds.minX} ${bounds.minZ} ${w} ${h}`
}

export function polygonPath(vertices: { x: number; z: number }[]): string {
  if (vertices.length < 3) return ''
  return `M ${vertices.map(v => `${v.x},${v.z}`).join(' L ')} Z`
}

export function buildMapTransform(
  bounds: MapBounds,
  cw: number,
  ch: number,
  pad = 20,
): MapTransform {
  const sceneW = bounds.maxX - bounds.minX || 1
  const sceneH = bounds.maxZ - bounds.minZ || 1
  const scale = Math.min((cw - pad * 2) / sceneW, (ch - pad * 2) / sceneH)
  const offX = (cw - sceneW * scale) / 2
  const offZ = (ch - sceneH * scale) / 2
  return {
    scale,
    cw,
    ch,
    tx: (x: number) => offX + (x - bounds.minX) * scale,
    tz: (z: number) => offZ + (z - bounds.minZ) * scale,
  }
}

function worldStrokePx(transform: MapTransform, meters: number): number {
  return Math.max(0.75, meters * transform.scale)
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  vertices: { x: number; z: number }[],
  tx: (x: number) => number,
  tz: (z: number) => number,
  style: { stroke: string; fill?: string; lineWidth: number },
) {
  if (vertices.length < 3) return
  ctx.beginPath()
  ctx.moveTo(tx(vertices[0].x), tz(vertices[0].z))
  for (let i = 1; i < vertices.length; i++) {
    ctx.lineTo(tx(vertices[i].x), tz(vertices[i].z))
  }
  ctx.closePath()
  if (style.fill) {
    ctx.fillStyle = style.fill
    ctx.fill()
  }
  ctx.strokeStyle = style.stroke
  ctx.lineWidth = style.lineWidth
  ctx.stroke()
}

function drawGrid(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
  ctx.fillStyle = 'rgba(5, 8, 16, 0.95)'
  ctx.fillRect(0, 0, cw, ch)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)'
  ctx.lineWidth = 1
  const step = 32
  for (let x = 0; x <= cw; x += step) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, ch)
    ctx.stroke()
  }
  for (let y = 0; y <= ch; y += step) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(cw, y)
    ctx.stroke()
  }
}

function drawFixtureLayer(
  ctx: CanvasRenderingContext2D,
  objects: VenueObject[],
  transform: MapTransform,
) {
  const { tx, tz } = transform
  const lw = worldStrokePx(transform, 0.06)
  for (const fixture of venueObjectsToFixtures(objects)) {
    const outline = getDrawableFixtureOutline(fixture)
    if (outline.length < 3) continue
    drawPolygon(ctx, outline, tx, tz, {
      stroke: 'rgba(0, 210, 255, 0.55)',
      fill: 'rgba(0, 210, 255, 0.06)',
      lineWidth: lw,
    })
  }
}

export function drawAlertZoneMap(
  ctx: CanvasRenderingContext2D,
  opts: {
    objects: VenueObject[]
    regions: MapRegion[]
    highlightIds: Set<string>
    pulse: number
    transform: MapTransform
  },
) {
  const { objects, regions, highlightIds, pulse, transform } = opts
  const { tx, tz, cw, ch } = transform
  const normalized = normalizeMapRegions(regions)

  drawGrid(ctx, cw, ch)
  drawFixtureLayer(ctx, objects, transform)

  for (const r of normalized) {
    if (highlightIds.has(r.id)) continue
    drawPolygon(ctx, r.vertices, tx, tz, {
      stroke: 'rgba(139, 92, 246, 0.22)',
      fill: 'rgba(139, 92, 246, 0.05)',
      lineWidth: worldStrokePx(transform, 0.04),
    })
  }

  const pulseWave = 0.5 + 0.5 * Math.sin(pulse * Math.PI * 2)
  for (const r of normalized) {
    if (!highlightIds.has(r.id)) continue
    drawPolygon(ctx, r.vertices, tx, tz, {
      stroke: `rgba(255, 50, 50, ${0.7 + pulseWave * 0.3})`,
      fill: `rgba(255, 40, 40, ${0.18 + pulseWave * 0.22})`,
      lineWidth: worldStrokePx(transform, 0.08 + pulseWave * 0.06),
    })
  }
}

export function drawDeadZonesMap(
  ctx: CanvasRenderingContext2D,
  opts: {
    objects: VenueObject[]
    regions: MapRegion[]
    deadZoneIds: Set<string>
    hoveredZoneId: string | null
    pulse: number
    transform: MapTransform
  },
) {
  const { objects, regions, deadZoneIds, hoveredZoneId, pulse, transform } = opts
  const { tx, tz, cw, ch } = transform
  const pulseWave = 0.5 + 0.5 * Math.sin(pulse * Math.PI * 2)
  const normalized = normalizeMapRegions(regions)

  drawGrid(ctx, cw, ch)
  drawFixtureLayer(ctx, objects, transform)

  for (const r of normalized) {
    if (deadZoneIds.has(r.id)) continue
    const hovered = hoveredZoneId === r.id
    drawPolygon(ctx, r.vertices, tx, tz, {
      stroke: hovered ? 'rgba(74, 222, 128, 0.7)' : 'rgba(55, 65, 81, 0.6)',
      fill: hovered ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.08)',
      lineWidth: worldStrokePx(transform, hovered ? 0.08 : 0.04),
    })
  }

  for (const r of normalized) {
    if (!deadZoneIds.has(r.id)) continue
    const hovered = hoveredZoneId === r.id
    drawPolygon(ctx, r.vertices, tx, tz, {
      stroke: hovered
        ? 'rgba(248, 113, 113, 0.95)'
        : `rgba(255, 50, 50, ${0.65 + pulseWave * 0.35})`,
      fill: hovered
        ? 'rgba(239, 68, 68, 0.45)'
        : `rgba(255, 40, 40, ${0.15 + pulseWave * 0.25})`,
      lineWidth: worldStrokePx(transform, hovered ? 0.12 : 0.07 + pulseWave * 0.05),
    })
  }
}
