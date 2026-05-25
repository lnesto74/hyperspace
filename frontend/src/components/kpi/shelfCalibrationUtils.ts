import {
  FixtureInfo,
  PreviewRoiLike,
  ZoneCalibration,
  extractZoneCalibration,
  sortFixtures,
} from './checkoutCalibrationUtils'

export type { FixtureInfo, PreviewRoiLike, ZoneCalibration }

export interface ShelfCalibration {
  left: ZoneCalibration
  right: ZoneCalibration
}

export const DEFAULT_SHELF_CALIBRATION: ShelfCalibration = {
  left: { width: 1.5, depth: 4, alongCounter: 0, fromCounter: -2, rotationOffset: 0 },
  right: { width: 1.5, depth: 4, alongCounter: 0, fromCounter: 2, rotationOffset: 0 },
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
      ? extractZoneCalibration(leftRoi, fixture, fixtures)
      : { ...DEFAULT_SHELF_CALIBRATION.left },
    right: rightRoi
      ? extractZoneCalibration(rightRoi, fixture, fixtures)
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
