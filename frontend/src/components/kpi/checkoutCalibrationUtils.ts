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
  type?: string
  position: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
  source?: string | null
  footprintPoints?: { x: number; z: number }[] | null
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

function computeAxesFromFootprint(
  points: { x: number; z: number }[],
  position: { x: number; z: number },
  defaultFacingX = 0,
  defaultFacingZ = 1,
) {
  const cx = position.x
  const cz = position.z
  const n = points.length

  let bestLen = 0
  let alongX = 1
  let alongZ = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const dx = points[j].x - points[i].x
    const dz = points[j].z - points[i].z
    const len = Math.hypot(dx, dz)
    if (len > bestLen) {
      bestLen = len
      alongX = dx / len
      alongZ = dz / len
    }
  }

  const candidates = [
    { fromX: alongZ, fromZ: -alongX },
    { fromX: -alongZ, fromZ: alongX },
  ]

  const scoreFrom = (fx: number, fz: number) => {
    let pos = 0
    let neg = 0
    for (const p of points) {
      const d = (p.x - cx) * fx + (p.z - cz) * fz
      if (d >= 0) pos += d
      else neg -= d
    }
    return neg - pos
  }

  let fromX = candidates[0].fromX
  let fromZ = candidates[0].fromZ
  let bestScore = scoreFrom(fromX, fromZ)
  for (let i = 1; i < candidates.length; i++) {
    const s = scoreFrom(candidates[i].fromX, candidates[i].fromZ)
    if (s > bestScore) {
      bestScore = s
      fromX = candidates[i].fromX
      fromZ = candidates[i].fromZ
    }
  }

  const rowLen = Math.hypot(defaultFacingX, defaultFacingZ)
  if (rowLen > 0.01) {
    const dot = fromX * defaultFacingX + fromZ * defaultFacingZ
    if (dot < 0) {
      fromX = -fromX
      fromZ = -fromZ
    }
  }

  const baseRotation = Math.atan2(fromX, fromZ)
  return {
    rotY: Math.atan2(alongX, alongZ),
    alongX,
    alongZ,
    fromX,
    fromZ,
    baseRotation,
  }
}

export function getFixtureFootprintPoints(fixture: FixtureInfo): { x: number; z: number }[] {
  if (fixture.footprintPoints && fixture.footprintPoints.length >= 3) {
    return fixture.footprintPoints
  }
  const cx = fixture.position.x
  const cz = fixture.position.z
  const hw = (fixture.scale?.x ?? 2) / 2
  const hd = (fixture.scale?.z ?? 0.5) / 2
  const rotY = fixture.rotation?.y ?? 0
  const cos = Math.cos(rotY)
  const sin = Math.sin(rotY)
  const local = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ]
  return local.map(c => ({
    x: cx + c.x * cos - c.z * sin,
    z: cz + c.x * sin + c.z * cos,
  }))
}

export function getFixtureFootprintBounds(fixture: FixtureInfo) {
  const points = getFixtureFootprintPoints(fixture)
  const xs = points.map(p => p.x)
  const zs = points.map(p => p.z)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  }
}

export function getFixtureOutlinePoints(fixture: FixtureInfo): { x: number; z: number }[] {
  return getFixtureFootprintPoints(fixture)
}

function getRowFacingDefaults(allFixtures?: FixtureInfo[]) {
  if (!allFixtures || allFixtures.length <= 1) {
    return { defaultFacingX: 0, defaultFacingZ: 1, isHorizontalRow: false, isVerticalRow: false }
  }
  const sorted = sortFixtures(allFixtures)
  const xSpread = Math.max(...sorted.map(c => c.position.x)) - Math.min(...sorted.map(c => c.position.x))
  const zSpread = Math.max(...sorted.map(c => c.position.z)) - Math.min(...sorted.map(c => c.position.z))
  const isHorizontalRow = xSpread > zSpread * 2
  const isVerticalRow = zSpread > xSpread * 2
  let defaultFacingX = 0
  let defaultFacingZ = 1
  if (isVerticalRow) {
    defaultFacingX = 1
    defaultFacingZ = 0
  }
  return { defaultFacingX, defaultFacingZ, isHorizontalRow, isVerticalRow }
}

export function getFixtureAxes(fixture: FixtureInfo, allFixtures?: FixtureInfo[]) {
  const { defaultFacingX, defaultFacingZ, isHorizontalRow, isVerticalRow } = getRowFacingDefaults(allFixtures)

  if (fixture.footprintPoints && fixture.footprintPoints.length >= 3) {
    return computeAxesFromFootprint(fixture.footprintPoints, fixture.position, defaultFacingX, defaultFacingZ)
  }

  const orientedPoints = getFixtureFootprintPoints(fixture)
  if (orientedPoints.length >= 3) {
    return computeAxesFromFootprint(orientedPoints, fixture.position, defaultFacingX, defaultFacingZ)
  }

  const rotY = fixture.rotation?.y ?? 0
  const hasExplicitRotation = Math.abs(rotY) > 0.01
  const isDwgFixture = fixture.source === 'dwg' || hasExplicitRotation

  let facingX: number
  let facingZ: number

  if (isDwgFixture && hasExplicitRotation) {
    const perpendicularRotY = rotY + Math.PI / 2
    facingZ = Math.cos(perpendicularRotY)
    facingX = Math.sin(perpendicularRotY)
    if (facingZ < 0) {
      facingZ = -facingZ
      facingX = -facingX
    }
  } else if (isHorizontalRow || isVerticalRow) {
    facingX = defaultFacingX
    facingZ = defaultFacingZ
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

export function getShelfZoneRotation(axes: { alongX: number; alongZ: number }, rotationOffsetDeg = 0) {
  return Math.atan2(axes.alongZ, axes.alongX) + (rotationOffsetDeg * Math.PI / 180)
}

function swapShelfAxes(axes: ReturnType<typeof getFixtureAxes>) {
  return {
    ...axes,
    alongX: axes.fromX,
    alongZ: axes.fromZ,
    fromX: -axes.alongX,
    fromZ: -axes.alongZ,
  }
}

function projectFootprintExtents(
  points: { x: number; z: number }[],
  origin: { x: number; z: number },
  axes: ReturnType<typeof getFixtureAxes>,
) {
  const cx = origin.x
  const cz = origin.z
  let minAlong = Infinity
  let maxAlong = -Infinity
  let minFrom = Infinity
  let maxFrom = -Infinity
  for (const p of points) {
    const along = (p.x - cx) * axes.alongX + (p.z - cz) * axes.alongZ
    const from = (p.x - cx) * axes.fromX + (p.z - cz) * axes.fromZ
    minAlong = Math.min(minAlong, along)
    maxAlong = Math.max(maxAlong, along)
    minFrom = Math.min(minFrom, from)
    maxFrom = Math.max(maxFrom, from)
  }
  return {
    alongLen: Math.max(0.5, maxAlong - minAlong),
    fromLen: Math.max(0.3, maxFrom - minFrom),
    minAlong,
    maxAlong,
    minFrom,
    maxFrom,
    centerAlong: (minAlong + maxAlong) / 2,
  }
}

export function getShelfAxesAndExtents(fixture: FixtureInfo, allFixtures?: FixtureInfo[]) {
  const points = getFixtureFootprintPoints(fixture)
  let axes = getFixtureAxes(fixture, allFixtures)
  let ext = projectFootprintExtents(points, fixture.position, axes)
  if (ext.fromLen > ext.alongLen + 0.05) {
    axes = swapShelfAxes(axes)
    ext = projectFootprintExtents(points, fixture.position, axes)
  }
  return { axes, ext }
}

export function getFootprintExtents(fixture: FixtureInfo, axes: ReturnType<typeof getFixtureAxes>) {
  const points = getFixtureFootprintPoints(fixture)
  return projectFootprintExtents(points, fixture.position, axes)
}

export function extractZoneCalibration(
  roi: PreviewRoiLike,
  fixture: FixtureInfo,
  allFixtures?: FixtureInfo[],
  options?: { shelfMode?: boolean },
): ZoneCalibration {
  const locals = roi.vertices.map(v => worldToLocal(v.x, v.z, fixture, allFixtures))
  const alongs = locals.map(l => l.along)
  const froms = locals.map(l => l.from)
  const width = Math.max(...alongs) - Math.min(...alongs)
  const depth = Math.max(...froms) - Math.min(...froms)
  const center = getRoiCenter(roi.vertices)
  const centerLocal = worldToLocal(center.x, center.z, fixture, allFixtures)

  const axes = getFixtureAxes(fixture, allFixtures)
  const baseRotation = options?.shelfMode
    ? getShelfZoneRotation(axes)
    : axes.baseRotation
  const v0 = roi.vertices[0]
  const v1 = roi.vertices[1]
  const edgeX = v1.x - v0.x
  const edgeZ = v1.z - v0.z
  // Shelf width runs along local +X → world (cos r, sin r); match getShelfZoneRotation convention.
  const edgeAngle = options?.shelfMode
    ? Math.atan2(edgeZ, edgeX)
    : Math.atan2(edgeX, edgeZ)
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
  const bounds = getFixtureFootprintBounds(fixture)
  const cx = (bounds.minX + bounds.maxX) / 2
  const cz = (bounds.minZ + bounds.maxZ) / 2
  const halfW = Math.max(radius, (bounds.maxX - bounds.minX) / 2 + 2)
  const halfD = Math.max(radius, (bounds.maxZ - bounds.minZ) / 2 + 2)
  return {
    minX: cx - halfW,
    maxX: cx + halfW,
    minZ: cz - halfD,
    maxZ: cz + halfD,
  }
}

export function isCheckoutZoneRoiName(name: string): boolean {
  return /^Checkout \d+ - (Service|Queue)$/.test(name)
}

export function regionsToPreviewRois(
  regions: { id: string; name: string; vertices: { x: number; z: number }[]; color: string; opacity?: number }[],
): PreviewRoiLike[] {
  return regions
    .filter(r => isCheckoutZoneRoiName(r.name))
    .map(r => ({
      id: r.id,
      name: r.name,
      vertices: r.vertices,
      color: r.color,
      opacity: r.opacity ?? 0.4,
    }))
}
