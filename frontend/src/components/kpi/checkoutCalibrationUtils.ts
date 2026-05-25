export interface ZoneCalibration {
  width: number
  depth: number
  alongCounter: number
  fromCounter: number
  rotationOffset: number
}

export interface CheckoutCalibration {
  service: ZoneCalibration
  queue: ZoneCalibration
}

export interface FixtureInfo {
  id: string
  name: string
  position: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
}

export interface PreviewRoiLike {
  id: string
  name: string
  vertices: { x: number; z: number }[]
  color: string
  opacity?: number
}

export const DEFAULT_ZONE_CALIBRATION: ZoneCalibration = {
  width: 1.5,
  depth: 2.5,
  alongCounter: 0,
  fromCounter: 2,
  rotationOffset: 0,
}

export const DEFAULT_CHECKOUT_CALIBRATION: CheckoutCalibration = {
  service: { ...DEFAULT_ZONE_CALIBRATION, depth: 2.5, fromCounter: 1.5 },
  queue: { ...DEFAULT_ZONE_CALIBRATION, depth: 3.0, fromCounter: 4.5 },
}

export function sortFixtures(fixtures: FixtureInfo[]): FixtureInfo[] {
  return [...fixtures].sort((a, b) => {
    if (Math.abs(a.position.x - b.position.x) < 0.5) {
      return a.position.z - b.position.z
    }
    return a.position.x - b.position.x
  })
}

export function getCheckoutNumber(fixtureId: string, fixtures: FixtureInfo[]): number {
  const sorted = sortFixtures(fixtures)
  const idx = sorted.findIndex(f => f.id === fixtureId)
  return idx >= 0 ? idx + 1 : 1
}

export function getFixtureAxes(fixture: FixtureInfo, allFixtures?: FixtureInfo[]) {
  const rotY = fixture.rotation?.y ?? 0
  const hasExplicitRotation = Math.abs(rotY) > 0.01
  const isDwgFixture = hasExplicitRotation

  let facingX: number
  let facingZ: number

  if (allFixtures && allFixtures.length > 1) {
    const sorted = sortFixtures(allFixtures)
    const xSpread = Math.max(...sorted.map(c => c.position.x)) - Math.min(...sorted.map(c => c.position.x))
    const zSpread = Math.max(...sorted.map(c => c.position.z)) - Math.min(...sorted.map(c => c.position.z))
    const isHorizontalRow = xSpread > zSpread * 2
    const isVerticalRow = zSpread > xSpread * 2

    if (isDwgFixture && hasExplicitRotation) {
      const perpendicularRotY = rotY + Math.PI / 2
      facingZ = Math.cos(perpendicularRotY)
      facingX = Math.sin(perpendicularRotY)
      if (facingZ < 0) {
        facingZ = -facingZ
        facingX = -facingX
      }
    } else if (isHorizontalRow || isVerticalRow) {
      facingX = isVerticalRow ? 1 : 0
      facingZ = isVerticalRow ? 0 : 1
    } else {
      facingZ = Math.cos(rotY)
      facingX = Math.sin(rotY)
    }
  } else if (isDwgFixture && hasExplicitRotation) {
    const perpendicularRotY = rotY + Math.PI / 2
    facingZ = Math.cos(perpendicularRotY)
    facingX = Math.sin(perpendicularRotY)
    if (facingZ < 0) {
      facingZ = -facingZ
      facingX = -facingX
    }
  } else {
    facingZ = Math.cos(rotY)
    facingX = Math.sin(rotY)
  }

  const alongX = facingZ
  const alongZ = -facingX
  const fromX = facingX
  const fromZ = facingZ
  const baseRotation = Math.atan2(fromX, fromZ)
  return { rotY, alongX, alongZ, fromX, fromZ, baseRotation }
}

export function worldToLocal(x: number, z: number, fixture: FixtureInfo, allFixtures?: FixtureInfo[]) {
  const { alongX, alongZ, fromX, fromZ } = getFixtureAxes(fixture, allFixtures)
  const dx = x - fixture.position.x
  const dz = z - fixture.position.z
  return {
    along: dx * alongX + dz * alongZ,
    from: dx * fromX + dz * fromZ,
  }
}

export function localToWorld(along: number, from: number, fixture: FixtureInfo, allFixtures?: FixtureInfo[]) {
  const { alongX, alongZ, fromX, fromZ } = getFixtureAxes(fixture, allFixtures)
  return {
    x: fixture.position.x + alongX * along + fromX * from,
    z: fixture.position.z + alongZ * along + fromZ * from,
  }
}

export function getRoiCenter(vertices: { x: number; z: number }[]) {
  return {
    x: vertices.reduce((s, v) => s + v.x, 0) / vertices.length,
    z: vertices.reduce((s, v) => s + v.z, 0) / vertices.length,
  }
}

function normalizeDegrees(deg: number) {
  let d = deg % 360
  if (d > 180) d -= 360
  if (d < -180) d += 360
  return d
}

export function extractZoneCalibration(
  roi: PreviewRoiLike,
  fixture: FixtureInfo,
  allFixtures?: FixtureInfo[],
): ZoneCalibration {
  const locals = roi.vertices.map(v => worldToLocal(v.x, v.z, fixture, allFixtures))
  const alongs = locals.map(l => l.along)
  const froms = locals.map(l => l.from)
  const width = Math.max(...alongs) - Math.min(...alongs)
  const depth = Math.max(...froms) - Math.min(...froms)
  const center = getRoiCenter(roi.vertices)
  const centerLocal = worldToLocal(center.x, center.z, fixture, allFixtures)

  const { fromX, fromZ, baseRotation } = getFixtureAxes(fixture, allFixtures)
  const v0 = roi.vertices[0]
  const v1 = roi.vertices[1]
  const edgeX = v1.x - v0.x
  const edgeZ = v1.z - v0.z
  const edgeAngle = Math.atan2(edgeX, edgeZ)
  const rotationOffset = normalizeDegrees((edgeAngle - baseRotation) * (180 / Math.PI))

  return {
    width: Math.max(0.5, width),
    depth: Math.max(0.5, depth),
    alongCounter: centerLocal.along,
    fromCounter: centerLocal.from,
    rotationOffset,
  }
}

export function extractCheckoutCalibration(
  previewRois: PreviewRoiLike[],
  fixtures: FixtureInfo[],
  referenceFixtureId: string,
): CheckoutCalibration {
  const checkoutNumber = getCheckoutNumber(referenceFixtureId, fixtures)
  const fixture = fixtures.find(f => f.id === referenceFixtureId)
  if (!fixture) return { ...DEFAULT_CHECKOUT_CALIBRATION }

  const serviceRoi = previewRois.find(r => r.name === `Checkout ${checkoutNumber} - Service`)
  const queueRoi = previewRois.find(r => r.name === `Checkout ${checkoutNumber} - Queue`)

  return {
    service: serviceRoi
      ? extractZoneCalibration(serviceRoi, fixture, fixtures)
      : { ...DEFAULT_CHECKOUT_CALIBRATION.service },
    queue: queueRoi
      ? extractZoneCalibration(queueRoi, fixture, fixtures)
      : { ...DEFAULT_CHECKOUT_CALIBRATION.queue },
  }
}

export function findRoiForFixture(
  previewRois: PreviewRoiLike[],
  fixtures: FixtureInfo[],
  fixtureId: string,
  zoneType: 'service' | 'queue',
): PreviewRoiLike | undefined {
  const checkoutNumber = getCheckoutNumber(fixtureId, fixtures)
  const label = zoneType.charAt(0).toUpperCase() + zoneType.slice(1)
  return previewRois.find(r => r.name === `Checkout ${checkoutNumber} - ${label}`)
}

export function computeMapBounds(
  points: { x: number; z: number }[],
  paddingRatio = 0.12,
) {
  if (points.length === 0) {
    return { minX: -5, maxX: 5, minZ: -5, maxZ: 5 }
  }
  let minX = Math.min(...points.map(p => p.x))
  let maxX = Math.max(...points.map(p => p.x))
  let minZ = Math.min(...points.map(p => p.z))
  let maxZ = Math.max(...points.map(p => p.z))
  const padX = (maxX - minX) * paddingRatio || 1
  const padZ = (maxZ - minZ) * paddingRatio || 1
  return {
    minX: minX - padX,
    maxX: maxX + padX,
    minZ: minZ - padZ,
    maxZ: maxZ + padZ,
  }
}

export function focusBoundsAroundFixture(
  fixture: FixtureInfo,
  radius = 6,
) {
  return {
    minX: fixture.position.x - radius,
    maxX: fixture.position.x + radius,
    minZ: fixture.position.z - radius,
    maxZ: fixture.position.z + radius,
  }
}
