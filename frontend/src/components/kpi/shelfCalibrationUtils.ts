import {
  FixtureInfo,
  PreviewRoiLike,
  ZoneCalibration,
  extractZoneCalibration,
  getFixtureAxes,
  getFootprintExtents,
  sortFixtures,
} from './checkoutCalibrationUtils'

export type { FixtureInfo, PreviewRoiLike, ZoneCalibration }

export interface ShelfCalibration {
  left: ZoneCalibration
  right: ZoneCalibration
}

export const DEFAULT_SHELF_ENGAGEMENT_DEPTH = 1.5

export const DEFAULT_SHELF_CALIBRATION: ShelfCalibration = {
  left: { width: 4, depth: DEFAULT_SHELF_ENGAGEMENT_DEPTH, alongCounter: 0, fromCounter: -1.25, rotationOffset: 0 },
  right: { width: 4, depth: DEFAULT_SHELF_ENGAGEMENT_DEPTH, alongCounter: 0, fromCounter: 1.25, rotationOffset: 0 },
}

export function computeAutoShelfCalibration(
  fixture: FixtureInfo,
  fixtures: FixtureInfo[],
  engagementDepth = DEFAULT_SHELF_ENGAGEMENT_DEPTH,
): ShelfCalibration {
  const axes = getFixtureAxes(fixture, fixtures)
  const ext = getFootprintExtents(fixture, axes)
  const leftFrom = ext.minFrom - engagementDepth / 2
  const rightFrom = ext.maxFrom + engagementDepth / 2
  const base = {
    width: ext.alongLen,
    depth: engagementDepth,
    alongCounter: ext.centerAlong,
    rotationOffset: 0,
  }
  return {
    left: { ...base, fromCounter: leftFrom },
    right: { ...base, fromCounter: rightFrom },
  }
}

export { sortFixtures } from './checkoutCalibrationUtils'

export function getShelfNumber(fixtureId: string, fixtures: FixtureInfo[]): number {
  const sorted = sortFixtures(fixtures)
  const idx = sorted.findIndex(f => f.id === fixtureId)
  return idx >= 0 ? idx + 1 : 1
}

export function getShelfEngagementLabel(zoneType: 'left' | 'right'): string {
  return zoneType === 'left' ? 'Left' : 'Right'
}

export function findRoiForShelf(
  previewRois: PreviewRoiLike[],
  fixtures: FixtureInfo[],
  fixtureId: string,
  zoneType: 'left' | 'right',
): PreviewRoiLike | undefined {
  const shelfNumber = getShelfNumber(fixtureId, fixtures)
  const label = getShelfEngagementLabel(zoneType)
  const byNum = previewRois.find(r => r.name === `Shelf ${shelfNumber} - Engagement (${label})`)
  if (byNum) return byNum

  const fixture = fixtures.find(f => f.id === fixtureId)
  if (fixture) {
    return previewRois.find(r => r.name === `${fixture.name} - Engagement (${label})`)
  }
  return undefined
}

export function extractShelfCalibration(
  previewRois: PreviewRoiLike[],
  fixtures: FixtureInfo[],
  referenceFixtureId: string,
): ShelfCalibration {
  const fixture = fixtures.find(f => f.id === referenceFixtureId)
  if (!fixture) return { ...DEFAULT_SHELF_CALIBRATION }

  const leftRoi = findRoiForShelf(previewRois, fixtures, referenceFixtureId, 'left')
  const rightRoi = findRoiForShelf(previewRois, fixtures, referenceFixtureId, 'right')

  return {
    left: leftRoi
      ? extractZoneCalibration(leftRoi, fixture, fixtures, { shelfMode: true })
      : { ...DEFAULT_SHELF_CALIBRATION.left },
    right: rightRoi
      ? extractZoneCalibration(rightRoi, fixture, fixtures, { shelfMode: true })
      : { ...DEFAULT_SHELF_CALIBRATION.right },
  }
}

export function isShelfZoneRoiName(name: string): boolean {
  return / - Engagement \((Left|Right)\)$/.test(name)
}

export function regionsToPreviewShelfRois(
  regions: { id: string; name: string; vertices: { x: number; z: number }[]; color: string; opacity?: number }[],
): PreviewRoiLike[] {
  return regions
    .filter(r => isShelfZoneRoiName(r.name))
    .map(r => ({
      id: r.id,
      name: r.name,
      vertices: r.vertices,
      color: r.color,
      opacity: r.opacity ?? 0.3,
    }))
}
