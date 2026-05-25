import { PreviewRoiLike } from './checkoutCalibrationUtils'
import { ResizeHandle } from './calibrationPreviewUtils'

export interface RetailCategoryOption {
  id: string
  name: string
  slug: string
  color?: string | null
}

export interface ShelfCustomZone {
  id: string
  name: string
  vertices: { x: number; z: number }[]
  color: string
  opacity: number
  business_category_id: string
  business_category: string
  business_category_label: string
}

export const CUSTOM_ZONE_COLOR = '#14b8a6'

export function rectVerticesFromDrag(
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  minSize = 0.35,
): { x: number; z: number }[] {
  let minX = Math.min(x1, x2)
  let maxX = Math.max(x1, x2)
  let minZ = Math.min(z1, z2)
  let maxZ = Math.max(z1, z2)
  if (maxX - minX < minSize) {
    const mid = (minX + maxX) / 2
    minX = mid - minSize / 2
    maxX = mid + minSize / 2
  }
  if (maxZ - minZ < minSize) {
    const mid = (minZ + maxZ) / 2
    minZ = mid - minSize / 2
    maxZ = mid + minSize / 2
  }
  return [
    { x: minX, z: minZ },
    { x: maxX, z: minZ },
    { x: maxX, z: maxZ },
    { x: minX, z: maxZ },
  ]
}

export function getRectBounds(vertices: { x: number; z: number }[]) {
  const xs = vertices.map(v => v.x)
  const zs = vertices.map(v => v.z)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  }
}

export function getRectHandlePositions(
  vertices: { x: number; z: number }[],
): Record<ResizeHandle, { x: number; z: number }> {
  const { minX, maxX, minZ, maxZ } = getRectBounds(vertices)
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  return {
    'along-min': { x: minX, z: cz },
    'along-max': { x: maxX, z: cz },
    'from-min': { x: cx, z: minZ },
    'from-max': { x: cx, z: maxZ },
  }
}

export function resizeRectVertices(
  startVertices: { x: number; z: number }[],
  handle: ResizeHandle,
  worldX: number,
  worldZ: number,
): { x: number; z: number }[] {
  const b = getRectBounds(startVertices)
  let { minX, maxX, minZ, maxZ } = b
  const minSize = 0.35

  switch (handle) {
    case 'along-min':
      minX = Math.min(worldX, maxX - minSize)
      break
    case 'along-max':
      maxX = Math.max(worldX, minX + minSize)
      break
    case 'from-min':
      minZ = Math.min(worldZ, maxZ - minSize)
      break
    case 'from-max':
      maxZ = Math.max(worldZ, minZ + minSize)
      break
  }

  return rectVerticesFromDrag(minX, minZ, maxX, maxZ, minSize)
}

export function translateRectVertices(
  vertices: { x: number; z: number }[],
  dx: number,
  dz: number,
): { x: number; z: number }[] {
  return vertices.map(v => ({ x: v.x + dx, z: v.z + dz }))
}

export function pointInRect(x: number, z: number, vertices: { x: number; z: number }[]): boolean {
  const { minX, maxX, minZ, maxZ } = getRectBounds(vertices)
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ
}

export function createShelfCustomZone(
  vertices: { x: number; z: number }[],
  category: RetailCategoryOption,
  index: number,
): ShelfCustomZone {
  return {
    id: `custom-shelf-${Date.now()}-${index}`,
    name: `${category.name} - Custom Engagement`,
    vertices,
    color: category.color || CUSTOM_ZONE_COLOR,
    opacity: 0.42,
    business_category_id: category.id,
    business_category: category.slug,
    business_category_label: category.name,
  }
}

export function shelfCustomZoneToPreviewRoi(zone: ShelfCustomZone): PreviewRoiLike {
  return {
    id: zone.id,
    name: zone.name,
    vertices: zone.vertices,
    color: zone.color,
    opacity: zone.opacity,
  }
}

export function isCustomShelfZoneRoi(region: {
  name: string
  metadata?: { zoneType?: string; template?: string } | null
}): boolean {
  if (region.metadata?.template === 'shelf-engagement' && region.metadata?.zoneType === 'custom') {
    return true
  }
  return / - Custom Engagement$/.test(region.name)
}

export function regionsToShelfCustomZones(
  regions: {
    id: string
    name: string
    vertices: { x: number; z: number }[]
    color: string
    opacity?: number
    metadata?: {
      zoneType?: string
      template?: string
      business_category_id?: string
      business_category?: string
      business_category_label?: string
    } | null
  }[],
): ShelfCustomZone[] {
  return regions
    .filter(isCustomShelfZoneRoi)
    .map(r => ({
      id: r.id,
      name: r.name,
      vertices: r.vertices,
      color: r.color,
      opacity: r.opacity ?? 0.42,
      business_category_id: r.metadata?.business_category_id || '',
      business_category: r.metadata?.business_category || '',
      business_category_label: r.metadata?.business_category_label || r.name.replace(/ - Custom Engagement$/, ''),
    }))
}

export function shelfCustomZoneToSavePayload(zone: ShelfCustomZone) {
  return {
    id: zone.id,
    name: zone.name,
    vertices: zone.vertices,
    color: zone.color,
    opacity: zone.opacity,
    metadata: {
      type: 'smart-kpi',
      template: 'shelf-engagement',
      zoneType: 'custom',
      business_category_id: zone.business_category_id,
      business_category: zone.business_category,
      business_category_label: zone.business_category_label,
    },
  }
}
