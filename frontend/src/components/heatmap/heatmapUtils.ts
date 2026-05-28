import * as THREE from 'three';
import type { Vector2 } from '../../types';

export function isPointInPolygon(point: { x: number; z: number }, vertices: Vector2[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const zi = vertices[i].z;
    const xj = vertices[j].x;
    const zj = vertices[j].z;
    if (((zi > point.z) !== (zj > point.z))
        && (point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

export function getZoneBounds(vertices: Vector2[]): {
  minX: number; maxX: number; minZ: number; maxZ: number;
} {
  const xs = vertices.map(v => v.x);
  const zs = vertices.map(v => v.z);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  };
}

export function getHeatColor(value: number, max: number): THREE.Color {
  if (max === 0) return new THREE.Color(0x1e3a5f);

  const linearT = Math.min(value / max, 1);
  const t = Math.pow(linearT, 0.6);

  let h: number; let s: number; let l: number;

  if (t < 0.25) {
    const ratio = t / 0.25;
    h = 240 - ratio * 60;
    s = 0.7 + ratio * 0.2;
    l = 0.35 + ratio * 0.15;
  } else if (t < 0.5) {
    const ratio = (t - 0.25) / 0.25;
    h = 180 - ratio * 60;
    s = 0.9;
    l = 0.5 + ratio * 0.05;
  } else if (t < 0.75) {
    const ratio = (t - 0.5) / 0.25;
    h = 120 - ratio * 80;
    s = 0.9 + ratio * 0.1;
    l = 0.55 - ratio * 0.05;
  } else {
    const ratio = (t - 0.75) / 0.25;
    h = 40 - ratio * 40;
    s = 1.0;
    l = 0.5 + ratio * 0.1;
  }

  return new THREE.Color().setHSL(h / 360, s, l);
}

export function hexToThreeColor(hex: string): THREE.Color {
  return new THREE.Color(hex);
}
