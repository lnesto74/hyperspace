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

export interface MapTransform {
  tx: (x: number) => number
  tz: (z: number) => number
  scale: number
  cw: number
  ch: number
}

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

export function collectScenePoints(
  objects: VenueObject[],
  regions: MapRegion[],
  venueSize?: { width: number; depth: number },
): { x: number; z: number }[] {
  const pts: { x: number; z: number }[] = []

  for (const f of venueObjectsToFixtures(objects)) {
    for (const p of getFixtureOutlinePoints(f)) pts.push(p)
  }
  for (const r of regions) {
    for (const v of r.vertices) pts.push(v)
  }

  if (pts.length === 0 && venueSize) {
    pts.push({ x: 0, z: 0 }, { x: venueSize.width, z: venueSize.depth })
  }

  return pts
}

export function buildMapTransform(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
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
  for (const fixture of venueObjectsToFixtures(objects)) {
    const outline = getFixtureOutlinePoints(fixture)
    if (outline.length < 3) continue
    drawPolygon(ctx, outline, tx, tz, {
      stroke: 'rgba(0, 210, 255, 0.42)',
      fill: 'rgba(0, 210, 255, 0.04)',
      lineWidth: 0.6,
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

  drawGrid(ctx, cw, ch)
  drawFixtureLayer(ctx, objects, transform)

  for (const r of regions) {
    if (r.vertices.length < 3 || highlightIds.has(r.id)) continue
    drawPolygon(ctx, r.vertices, tx, tz, {
      stroke: 'rgba(139, 92, 246, 0.22)',
      fill: 'rgba(139, 92, 246, 0.05)',
      lineWidth: 0.5,
    })
  }

  const pulseWave = 0.5 + 0.5 * Math.sin(pulse * Math.PI * 2)
  for (const r of regions) {
    if (!highlightIds.has(r.id) || r.vertices.length < 3) continue
    drawPolygon(ctx, r.vertices, tx, tz, {
      stroke: `rgba(255, 50, 50, ${0.7 + pulseWave * 0.3})`,
      fill: `rgba(255, 40, 40, ${0.18 + pulseWave * 0.22})`,
      lineWidth: 1.5 + pulseWave * 1.2,
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

  drawGrid(ctx, cw, ch)
  drawFixtureLayer(ctx, objects, transform)

  for (const r of regions) {
    if (r.vertices.length < 3 || deadZoneIds.has(r.id)) continue
    const hovered = hoveredZoneId === r.id
    drawPolygon(ctx, r.vertices, tx, tz, {
      stroke: hovered ? 'rgba(74, 222, 128, 0.7)' : 'rgba(55, 65, 81, 0.6)',
      fill: hovered ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.08)',
      lineWidth: hovered ? 1.5 : 0.6,
    })
  }

  for (const r of regions) {
    if (!deadZoneIds.has(r.id) || r.vertices.length < 3) continue
    const hovered = hoveredZoneId === r.id
    drawPolygon(ctx, r.vertices, tx, tz, {
      stroke: hovered
        ? `rgba(248, 113, 113, ${0.95})`
        : `rgba(255, 50, 50, ${0.65 + pulseWave * 0.35})`,
      fill: hovered
        ? 'rgba(239, 68, 68, 0.45)'
        : `rgba(255, 40, 40, ${0.15 + pulseWave * 0.25})`,
      lineWidth: hovered ? 2.5 : 1.2 + pulseWave * 1.2,
    })
  }
}

export function computeFloorPlanBounds(
  objects: VenueObject[],
  regions: MapRegion[],
  venueSize?: { width: number; depth: number },
) {
  return computeMapBounds(collectScenePoints(objects, regions, venueSize), 0.08)
}
