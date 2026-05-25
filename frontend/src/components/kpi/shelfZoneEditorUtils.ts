import { extractZoneCalibration, FixtureInfo, PreviewRoiLike } from './checkoutCalibrationUtils'
import { generateShelfZoneRoi } from './calibrationPreviewUtils'
import {
  getFixtureEngagementZoneTypes,
  getShelfNumber,
  isShelfZoneRoiName,
  ShelfEngagementZoneType,
} from './shelfCalibrationUtils'

export type ShelfRoiSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isPersistedShelfRoiId(id: string): boolean {
  return UUID_RE.test(id)
}

export function parseShelfRoiZoneType(roi: PreviewRoiLike): ShelfEngagementZoneType {
  const metaType = roi.metadata?.zoneType
  if (typeof metaType === 'string' && (metaType === 'front' || metaType === 'left' || metaType === 'right')) {
    return metaType
  }
  if (roi.id.endsWith('::front') || roi.name.includes('(Front)')) return 'front'
  if (roi.id.endsWith('::left') || roi.name.includes('(Left)')) return 'left'
  return 'right'
}

export function parseShelfRoiFixtureId(roi: PreviewRoiLike, fixtures: FixtureInfo[]): string | null {
  if (typeof roi.metadata?.shelfId === 'string') return roi.metadata.shelfId
  const synthetic = roi.id.match(/^(.+)::(left|right|front)$/)
  if (synthetic) return synthetic[1]
  const fixture = fixtures.find(f => roi.name.startsWith(`${f.name} - Engagement`))
  if (fixture) return fixture.id
  const shelfMatch = roi.name.match(/^Shelf (\d+) - Engagement/)
  if (shelfMatch) {
    const num = parseInt(shelfMatch[1], 10)
    const sorted = [...fixtures].sort((a, b) => {
      if (Math.abs(a.position.x - b.position.x) < 0.5) return a.position.z - b.position.z
      return a.position.x - b.position.x
    })
    return sorted[num - 1]?.id ?? null
  }
  return null
}

export function resolveFixtureForShelfRoi(
  roi: PreviewRoiLike,
  fixtures: FixtureInfo[],
): FixtureInfo | undefined {
  const fixtureId = parseShelfRoiFixtureId(roi, fixtures)
  return fixtureId ? fixtures.find(f => f.id === fixtureId) : undefined
}

export function buildShelfRoiMetadata(
  fixture: FixtureInfo,
  fixtures: FixtureInfo[],
  zoneType: ShelfEngagementZoneType,
): Record<string, unknown> {
  return {
    type: 'smart-kpi',
    template: 'shelf-engagement',
    zoneType,
    shelfId: fixture.id,
    shelfIndex: getShelfNumber(fixture.id, fixtures) - 1,
    fixtureType: fixture.type || 'shelf',
    calibrated: true,
  }
}

export interface ShelfRegionLike {
  id: string
  name: string
  vertices: { x: number; z: number }[]
  color: string
  opacity?: number
  metadata?: Record<string, unknown> | null
}

export function regionsToPreviewShelfRois(regions: ShelfRegionLike[]): PreviewRoiLike[] {
  return regions
    .filter(r => isShelfZoneRoiName(r.name) || r.metadata?.template === 'shelf-engagement')
    .filter(r => r.metadata?.zoneType !== 'custom')
    .map(r => ({
      id: r.id,
      name: r.name,
      vertices: r.vertices,
      color: r.color,
      opacity: r.opacity ?? 0.3,
      metadata: r.metadata ?? undefined,
    }))
}

export function countUnsavedShelfRois(rois: PreviewRoiLike[]): number {
  return rois.filter(r => !isPersistedShelfRoiId(r.id)).length
}

export function applyZoneCalibrationToRoi(
  roi: PreviewRoiLike,
  fixtures: FixtureInfo[],
  zoneCal: ReturnType<typeof extractZoneCalibration>,
): PreviewRoiLike {
  const fixture = resolveFixtureForShelfRoi(roi, fixtures)
  if (!fixture) return roi
  const zoneType = parseShelfRoiZoneType(roi)
  const shelfNumber = getShelfNumber(fixture.id, fixtures)
  const generated = generateShelfZoneRoi(fixture, fixtures, shelfNumber, zoneType, zoneCal, roi.color)
  return { ...roi, vertices: generated.vertices }
}

export function copyZoneCalibrationToSimilarRois(
  sourceRoi: PreviewRoiLike,
  rois: PreviewRoiLike[],
  fixtures: FixtureInfo[],
): PreviewRoiLike[] {
  const sourceFixture = resolveFixtureForShelfRoi(sourceRoi, fixtures)
  if (!sourceFixture) return rois
  const zoneType = parseShelfRoiZoneType(sourceRoi)
  const zoneCal = extractZoneCalibration(sourceRoi, sourceFixture, fixtures, { shelfMode: true })

  return rois.map(roi => {
    if (parseShelfRoiZoneType(roi) !== zoneType) return roi
    const fixture = resolveFixtureForShelfRoi(roi, fixtures)
    if (!fixture) return roi
    const shelfNumber = getShelfNumber(fixture.id, fixtures)
    const generated = generateShelfZoneRoi(fixture, fixtures, shelfNumber, zoneType, zoneCal, roi.color)
    return { ...roi, vertices: generated.vertices }
  })
}

export function zonesForFixture(
  rois: PreviewRoiLike[],
  fixtures: FixtureInfo[],
  fixtureId: string,
): PreviewRoiLike[] {
  const fixture = fixtures.find(f => f.id === fixtureId)
  if (!fixture) return []
  const zoneTypes = getFixtureEngagementZoneTypes(fixture)
  return zoneTypes
    .map(zt => rois.find(r => parseShelfRoiFixtureId(r, fixtures) === fixtureId && parseShelfRoiZoneType(r) === zt))
    .filter((r): r is PreviewRoiLike => !!r)
}
