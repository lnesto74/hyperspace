import type { ShelfPlanogram, SlotFacing } from '../../context/PlanogramContext'

export function getSlotFacings(width: number, depth: number, storedFacings: SlotFacing[]): SlotFacing[] {
  if (storedFacings?.length > 0) return storedFacings
  return width >= depth ? ['front'] : ['left']
}

export function getFaceParams(facing: SlotFacing, width: number, _height: number, depth: number) {
  switch (facing) {
    case 'front':
      return {
        slotSpan: width,
        slotOffset: { x: -width / 2, y: 0, z: depth / 2 + 0.02 },
        slotDirection: 'x' as const,
      }
    case 'back':
      return {
        slotSpan: width,
        slotOffset: { x: -width / 2, y: 0, z: -depth / 2 - 0.02 },
        slotDirection: 'x' as const,
      }
    case 'left':
      return {
        slotSpan: depth,
        slotOffset: { x: -width / 2 - 0.02, y: 0, z: -depth / 2 },
        slotDirection: 'z' as const,
      }
    case 'right':
      return {
        slotSpan: depth,
        slotOffset: { x: width / 2 + 0.02, y: 0, z: -depth / 2 },
        slotDirection: 'z' as const,
      }
    default:
      return {
        slotSpan: width,
        slotOffset: { x: -width / 2, y: 0, z: depth / 2 + 0.02 },
        slotDirection: 'x' as const,
      }
  }
}

/** Local position inside shelf group (same math as PlanogramViewport slot meshes). */
export function getSlotLocalPosition(
  shelfWidth: number,
  shelfHeight: number,
  shelfDepth: number,
  planogramData: Pick<ShelfPlanogram, 'numLevels' | 'slotWidthM' | 'slotFacings'> | null | undefined,
  levelIndex: number,
  slotIndex: number,
): { x: number; y: number; z: number } | null {
  const numLevels = planogramData?.numLevels || 4
  const slotWidthM = planogramData?.slotWidthM || 0.1
  const levelHeight = shelfHeight / numLevels
  const facings = getSlotFacings(shelfWidth, shelfDepth, planogramData?.slotFacings || [])
  const facing = facings[0]
  const faceParams = getFaceParams(facing, shelfWidth, shelfHeight, shelfDepth)

  if (levelIndex < 0 || levelIndex >= numLevels) return null

  const y = levelIndex * levelHeight + levelHeight / 2

  if (faceParams.slotDirection === 'x') {
    return {
      x: faceParams.slotOffset.x + slotIndex * slotWidthM + slotWidthM / 2,
      y,
      z: faceParams.slotOffset.z + 0.01,
    }
  }

  return {
    x: faceParams.slotOffset.x + (facing === 'left' ? -0.01 : 0.01),
    y,
    z: faceParams.slotOffset.z + slotIndex * slotWidthM + slotWidthM / 2,
  }
}
