import { getFixtureAxes, getShelfZoneRotation, sortFixtures, FixtureInfo, PreviewRoiLike, ZoneCalibration } from './checkoutCalibrationUtils'
import { ShelfCalibration, getShelfEngagementLabel } from './shelfCalibrationUtils'

export function createRectangularRoiVertices(
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  rotation: number,
): { x: number; z: number }[] {
  const halfW = width / 2
  const halfD = depth / 2
  const corners = [
    { x: -halfW, z: -halfD },
    { x: halfW, z: -halfD },
    { x: halfW, z: halfD },
    { x: -halfW, z: halfD },
  ]
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return corners.map(c => ({
    x: centerX + c.x * cos - c.z * sin,
    z: centerZ + c.x * sin + c.z * cos,
  }))
}

function isNameUnique(name: string, fixtures: FixtureInfo[]): boolean {
  return fixtures.filter(f => f.name === name).length <= 1
}

function zoneCenterAndRotation(
  fixture: FixtureInfo,
  fixtures: FixtureInfo[],
  zoneCal: ZoneCalibration,
) {
  const axes = getFixtureAxes(fixture, fixtures)
  const centerX = fixture.position.x + axes.alongX * zoneCal.alongCounter + axes.fromX * zoneCal.fromCounter
  const centerZ = fixture.position.z + axes.alongZ * zoneCal.alongCounter + axes.fromZ * zoneCal.fromCounter
  const rotation = getShelfZoneRotation(axes, zoneCal.rotationOffset)
  return { centerX, centerZ, rotation, axes }
}

export function generateShelfZoneRoi(
  fixture: FixtureInfo,
  fixtures: FixtureInfo[],
  shelfNumber: number,
  zoneType: 'left' | 'right',
  zoneCal: ZoneCalibration,
  color: string,
): PreviewRoiLike {
  const uniqueName = isNameUnique(fixture.name, fixtures) ? fixture.name : `Shelf ${shelfNumber}`
  const label = getShelfEngagementLabel(zoneType)
  const { centerX, centerZ, rotation } = zoneCenterAndRotation(fixture, fixtures, zoneCal)
  return {
    id: `${fixture.id}::${zoneType}`,
    name: `${uniqueName} - Engagement (${label})`,
    vertices: createRectangularRoiVertices(centerX, centerZ, zoneCal.width, zoneCal.depth, rotation),
    color,
    opacity: 0.3,
  }
}

export function generateCalibratedShelfPreviewRois(
  fixtures: FixtureInfo[],
  calibration: ShelfCalibration,
  colors: { left: string; right: string },
): PreviewRoiLike[] {
  const sorted = sortFixtures(fixtures)
  const rois: PreviewRoiLike[] = []
  sorted.forEach((fixture, index) => {
    rois.push(generateShelfZoneRoi(fixture, sorted, index + 1, 'left', calibration.left, colors.left))
    rois.push(generateShelfZoneRoi(fixture, sorted, index + 1, 'right', calibration.right, colors.right))
  })
  return rois
}

export type ResizeHandle = 'along-min' | 'along-max' | 'from-min' | 'from-max'

export function getZoneHandlePositions(
  fixture: FixtureInfo,
  fixtures: FixtureInfo[],
  zoneCal: ZoneCalibration,
): Record<ResizeHandle, { x: number; z: number }> {
  const { centerX, centerZ, rotation } = zoneCenterAndRotation(fixture, fixtures, zoneCal)
  const halfW = zoneCal.width / 2
  const halfD = zoneCal.depth / 2
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const toWorld = (lx: number, lz: number) => ({
    x: centerX + lx * cos - lz * sin,
    z: centerZ + lx * sin + lz * cos,
  })
  return {
    'along-min': toWorld(-halfW, 0),
    'along-max': toWorld(halfW, 0),
    'from-min': toWorld(0, -halfD),
    'from-max': toWorld(0, halfD),
  }
}

export function applyResizeDelta(
  zoneCal: ZoneCalibration,
  handle: ResizeHandle,
  deltaAlong: number,
  deltaFrom: number,
  startCal: ZoneCalibration,
): ZoneCalibration {
  const minSize = 0.5
  let { width, depth, alongCounter, fromCounter } = { ...startCal }

  switch (handle) {
    case 'along-max':
      width = Math.max(minSize, startCal.width + deltaAlong)
      alongCounter = startCal.alongCounter + deltaAlong / 2
      break
    case 'along-min':
      width = Math.max(minSize, startCal.width - deltaAlong)
      alongCounter = startCal.alongCounter + deltaAlong / 2
      break
    case 'from-max':
      depth = Math.max(minSize, startCal.depth + deltaFrom)
      fromCounter = startCal.fromCounter + deltaFrom / 2
      break
    case 'from-min':
      depth = Math.max(minSize, startCal.depth - deltaFrom)
      fromCounter = startCal.fromCounter + deltaFrom / 2
      break
  }

  return { ...zoneCal, width, depth, alongCounter, fromCounter }
}

export function getFixtureAtPoint(
  fixtures: FixtureInfo[],
  x: number,
  z: number,
): FixtureInfo | undefined {
  for (const fixture of fixtures) {
    const { minX, maxX, minZ, maxZ } = getFixtureBounds(fixture)
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      return fixture
    }
  }
  return undefined
}

function getFixtureBounds(fixture: FixtureInfo) {
  if (fixture.footprintPoints && fixture.footprintPoints.length >= 3) {
    const xs = fixture.footprintPoints.map(p => p.x)
    const zs = fixture.footprintPoints.map(p => p.z)
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minZ: Math.min(...zs),
      maxZ: Math.max(...zs),
    }
  }
  const hw = (fixture.scale?.x ?? 1.5) / 2
  const hd = (fixture.scale?.z ?? 0.8) / 2
  return {
    minX: fixture.position.x - hw,
    maxX: fixture.position.x + hw,
    minZ: fixture.position.z - hd,
    maxZ: fixture.position.z + hd,
  }
}
