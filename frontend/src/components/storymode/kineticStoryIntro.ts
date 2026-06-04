/**
 * Kinetic Story intro — smooth camera orbit through a dark store (MainViewport).
 */

import * as THREE from 'three'

export type EaseKind = 'easeInOutCubic'

export interface CameraPreset {
  id: string
  position: THREE.Vector3
  target: THREE.Vector3
  fov?: number
  durationMs: number
  ease: EaseKind
}

export interface SceneFocus {
  centerX: number
  centerZ: number
  viewSize: number
  floorW: number
  floorD: number
  entrance?: { x: number; z: number } | null
}

export function easeByKind(t: number, _kind: EaseKind = 'easeInOutCubic'): number {
  const x = Math.max(0, Math.min(1, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Six continuous moves — no hard cuts, ~5.2s of camera travel. */
export const KINETIC_CUT_DURATIONS_MS = [820, 900, 880, 920, 860, 980]

const KINETIC_FOV = 44

export function buildKineticCameraPresets(f: SceneFocus): CameraPreset[] {
  const { centerX, centerZ, viewSize, floorW, floorD, entrance } = f
  const vs = viewSize
  const ent = entrance || { x: centerX + floorW * 0.2, z: centerZ - floorD * 0.25 }

  const presets: Omit<CameraPreset, 'durationMs' | 'ease'>[] = [
    {
      id: 'wide-aerial',
      position: new THREE.Vector3(centerX + vs * 0.05, vs * 1.42, centerZ + vs * 1.08),
      target: new THREE.Vector3(centerX, 0, centerZ),
    },
    {
      id: 'iso',
      position: new THREE.Vector3(centerX + vs * 0.78, vs * 0.7, centerZ + vs * 0.78),
      target: new THREE.Vector3(centerX, 0, centerZ),
    },
    {
      id: 'aisle',
      position: new THREE.Vector3(centerX - vs * 0.42, vs * 0.38, centerZ + vs * 0.12),
      target: new THREE.Vector3(centerX + vs * 0.15, 0, centerZ),
    },
    {
      id: 'entrance',
      position: new THREE.Vector3(ent.x - vs * 0.28, vs * 0.36, ent.z + vs * 0.48),
      target: new THREE.Vector3(ent.x, 0, ent.z),
    },
    {
      id: 'mid-orbit',
      position: new THREE.Vector3(centerX - vs * 0.62, vs * 0.48, centerZ - vs * 0.52),
      target: new THREE.Vector3(centerX, 0, centerZ),
    },
    {
      id: 'hero',
      position: new THREE.Vector3(centerX + vs * 0.8, vs * 0.66, centerZ + vs * 0.8),
      target: new THREE.Vector3(centerX, 0, centerZ),
    },
  ]

  return presets.map((p, i) => ({
    ...p,
    fov: KINETIC_FOV,
    durationMs: KINETIC_CUT_DURATIONS_MS[i] ?? 880,
    ease: 'easeInOutCubic',
  }))
}

/** Timeline markers (ms from intro start). */
export const KINETIC_TIMELINE = {
  BLACK_END: 280,
  SWEEP_START: 900,
  SWEEP_END: 3200,
  REPLAY_AT: 3000,
  CUTS_START: 3600,
  HOLD_END: 9800,
  TOTAL: 9800,
} as const
