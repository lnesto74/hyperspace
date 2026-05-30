import { describe, it, expect } from 'vitest';
import {
  shelfLocalToWorld,
  worldToShelfLocal,
  distanceToShelfFootprint,
  getSlotLocalPosition,
  detectSkusAtPosition,
} from '../services/planogramSlotGeometry.js';
import {
  computeSkuSlotMetrics,
  pickBestWorstSlots,
  DEFAULT_SKU_PROXIMITY,
} from '../services/SkuSlotMetricsEngine.js';

describe('planogramSlotGeometry', () => {
  const shelf = {
    id: 's1',
    name: 'Gondola A',
    positionX: 10,
    positionZ: 5,
    rotationY: 0,
    width: 2,
    depth: 4,
    height: 2,
    slotWidthM: 0.5,
    numLevels: 2,
    slotFacings: ['front'],
  };

  it('round-trips world ↔ shelf-local at zero rotation', () => {
    const local = { x: 0.5, z: 1 };
    const world = shelfLocalToWorld(local.x, local.z, shelf);
    const back = worldToShelfLocal(world.x, world.z, shelf);
    expect(back.x).toBeCloseTo(local.x, 5);
    expect(back.z).toBeCloseTo(local.z, 5);
  });

  it('applies rotation when converting slot to world', () => {
    const rotated = { ...shelf, rotationY: Math.PI / 2 };
    const world = shelfLocalToWorld(1, 0, rotated);
    expect(world.x).toBeCloseTo(10, 5);
    expect(world.z).toBeCloseTo(6, 5);
  });

  it('distanceToShelfFootprint is zero inside footprint', () => {
    expect(distanceToShelfFootprint(10, 5, shelf)).toBeCloseTo(0, 5);
  });

  it('detectSkusAtPosition returns nearest slot SKU', () => {
    const planogramData = { numLevels: 1, slotWidthM: 0.5, slotFacings: ['front'] };
    const local = getSlotLocalPosition(2, 2, 4, planogramData, 0, 0);
    const world = shelfLocalToWorld(local.x, local.z, shelf);

    const slots = [{
      shelfId: 's1',
      shelfName: 'Gondola A',
      levelIndex: 0,
      slotIndex: 0,
      skuItemId: 'sku-1',
      skuCode: '123456',
      name: 'Test Product',
      worldX: world.x,
      worldZ: world.z,
    }];

    const { detectedSkus } = detectSkusAtPosition(world.x, world.z + 0.3, {
      shelves: [shelf],
      slots,
      dAttract: 2,
      dSlot: 1.5,
    });

    expect(detectedSkus.length).toBeGreaterThan(0);
    expect(detectedSkus[0].skuCode).toBe('123456');
  });
});

describe('SkuSlotMetricsEngine', () => {
  const shelf = {
    id: 's1',
    name: 'Gondola',
    positionX: 0,
    positionZ: 0,
    rotationY: 0,
    width: 2,
    depth: 2,
    height: 2,
    slotWidthM: 1,
    numLevels: 1,
    slotFacings: ['front'],
  };

  const slots = [
    {
      shelfId: 's1',
      shelfName: 'Gondola',
      levelIndex: 0,
      slotIndex: 0,
      skuItemId: 'a',
      skuCode: '111',
      name: 'Hot SKU',
      worldX: -0.5,
      worldZ: 1.02,
    },
    {
      shelfId: 's1',
      shelfName: 'Gondola',
      levelIndex: 0,
      slotIndex: 1,
      skuItemId: 'b',
      skuCode: '222',
      name: 'Cold SKU',
      worldX: 0.5,
      worldZ: 1.02,
    },
  ];

  it('ranks slot with more dwell as best performer', () => {
    const t0 = 1_000_000;
    const positions = [];

    for (let i = 0; i < 8; i++) {
      positions.push({
        track_key: `hot-${i}`,
        timestamp: t0 + i * 1000,
        position_x: -0.5,
        position_z: 1.1,
        velocity_x: 0,
        velocity_z: 0,
      });
    }

    positions.push({
      track_key: 'cold-1',
      timestamp: t0,
      position_x: 0.5,
      position_z: 1.1,
      velocity_x: 0.5,
      velocity_z: 0,
    });

    const { slotMetrics } = computeSkuSlotMetrics({
      shelves: [shelf],
      slots,
      positions,
      windowStart: t0 - 1000,
      windowEnd: t0 + 20000,
      params: { ...DEFAULT_SKU_PROXIMITY, minAudience: 1, minViewers: 1 },
    });

    const { best, worst } = pickBestWorstSlots(slotMetrics, {
      ...DEFAULT_SKU_PROXIMITY,
      minAudience: 1,
      minViewers: 1,
    });

    expect(best?.skuItemId).toBe('a');
    expect(worst?.skuItemId).toBe('b');
    expect(best.compositeScore).toBeGreaterThan(worst.compositeScore);
  });
});
