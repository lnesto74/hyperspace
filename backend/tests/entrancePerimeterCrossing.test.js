import { describe, it, expect } from 'vitest';
import {
  perimeterEdges,
  segmentsIntersect,
  movementCrossesPerimeter,
  parseRoiVertices,
} from '../lib/entrancePerimeterCrossing.js';

describe('entrancePerimeterCrossing', () => {
  const verts = parseRoiVertices([
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ]);
  const edges = perimeterEdges(verts);

  it('detects crossing through bottom edge', () => {
    const prev = { x: 5, z: -2 };
    const cur = { x: 5, z: 2 };
    expect(movementCrossesPerimeter(prev, cur, edges)).toBe(true);
  });

  it('ignores movement parallel to edge outside', () => {
    const prev = { x: -5, z: -5 };
    const cur = { x: 20, z: -5 };
    expect(movementCrossesPerimeter(prev, cur, edges)).toBe(false);
  });

  it('detects born-inside then exit across side', () => {
    const prev = { x: 5, z: 5 };
    const cur = { x: 5, z: 12 };
    expect(movementCrossesPerimeter(prev, cur, edges)).toBe(true);
  });

  it('segmentsIntersect rejects shared endpoint touch', () => {
    expect(segmentsIntersect(0, 0, 5, 0, 0, 0, 10, 0)).toBe(false);
  });
});
