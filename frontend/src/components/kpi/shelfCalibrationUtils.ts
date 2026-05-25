import {
  FixtureInfo,
  PreviewRoiLike,
  ZoneCalibration,
  extractZoneCalibration,
  getShelfAxesAndExtents,
  sortFixtures,
} from './checkoutCalibrationUtils'

export type { FixtureInfo, PreviewRoiLike, ZoneCalibration }

export type ShelfEngagementZoneType = 'left' | 'right' | 'front'

export interface ShelfCalibration {
  left: ZoneCalibration
  right: ZoneCalibration
}

export const DEFAULT_SHELF_ENGAGEMENT_DEPTH = 1.5

export const DEFAULT_SHELF_CALIBRATION: ShelfCalibration = {
  left: { width: 4, depth: DEFAULT_SHELF_ENGAGEMENT_DEPTH, alongCounter: 0, fromCounter: -1.25, rotationOffset: 0 },
  right: { width: 4, depth: DEFAULT_SHELF_ENGAGEMENT_DEPTH, alongCounter: 0, fromCounter: 1.25, rotationOffset: 0 },
}

export function isSingleFrontEngagementFixture(fixture: FixtureInfo): boolean {
  const type = (fixture.type || '').toLowerCase()
  const name = (fixture.name || '').toLowerCase()
  if (type === 'fridge' || type === 'freezer') return true
  return ['frigo', 'fridge', 'freezer', 'refriger', 'congel'].some(
    hint => name.includes(hint) || type.includes(hint),
  )
}

export function getFixtureEngagementZoneTypes(fixture: FixtureInfo): ShelfEngagementZoneType[] {
  if (isSingleFrontEngagementFixture(fixture)) return ['front']
  return ['left', 'right']
}

export function getAutoZoneCalibrationForType(
  ext: ReturnType<typeof getShelfAxesAndExtents>['ext'],
  zoneType: ShelfEngagementZoneType,
  engagementDepth = DEFAULT_SHELF_ENGAGEMENT_DEPTH,
): ZoneCalibration {
  if (zoneType === 'front') {
    return {
      width: ext.alongLen,
      depth: engagementDepth,
      alongCounter: ext.centerAlong,
      fromCounter: ext.maxFrom + engagementDepth / 2,
      rotationOffset: 0,
    }
  }
  const fromCounter = zoneType === 'left'
    ? ext.minFrom - engagementDepth / 2
    : ext.maxFrom + engagementDepth / 2
  return {
    width: ext.alongLen,
    depth: engagementDepth,
    alongCounter: ext.centerAlong,
    fromCounter,
    rotationOffset: 0,
  }
}

export function computeAutoShelfCalibration(
  fixture: FixtureInfo,
  fixtures: FixtureInfo[],
  engagementDepth = DEFAULT_SHELF_ENGAGEMENT_DEPTH,
): ShelfCalibration {
  const { ext } = getShelfAxesAndExtents(fixture, fixtures)
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

export function getShelfEngagementLabel(zoneType: ShelfEngagementZoneType): string {
  if (zoneType === 'front') return 'Front'
  return zoneType === 'left' ? 'Left' : 'Right'
}

export function findRoiForShelf(
  previewRois: PreviewRoiLike[],
  fixtures: FixtureInfo[],
  fixtureId: string,
  zoneType: ShelfEngagementZoneType,
): PreviewRoiLike | undefined {
  const byId = previewRois.find(r => r.id === `${fixtureId}::${zoneType}`)
  if (byId) return byId

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
  return / - Engagement \((Left|Right|Front)\)$/.test(name)
}

export { regionsToPreviewShelfRois } from './shelfZoneEditorUtils'
