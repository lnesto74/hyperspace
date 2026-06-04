/**
 * Kinetic Story intro — camera preset timeline for the real MainViewport scene.
 * Dark store → reveal → rapid cuts behind a fixed logo (orchestrated in MainViewport).
 */

import * as THREE from 'three'

export type EaseKind = 'cut' | 'easeInOutCubic' | 'easeOutExpo'

export interface CameraPreset {
  id: string
  position: THREE.Vector3
  target: THREE.Vector3
  fov?: number
  durationMs: number
  ease: EaseKind
  /** Optional light-sweep pulse on this cut (ms). */
  lightPulseMs?: number
}

export interface SceneFocus {
  centerX: number
  centerZ: number
  viewSize: number
  floorW: number
  floorD: number
  entrance?: { x: number; z: number } | null
}

export function easeByKind(t: number, kind: EaseKind): number {
  const x = Math.max(0, Math.min(1, t))
  if (kind === 'cut') return x < 1 ? 0 : 1
  if (kind === 'easeOutExpo') return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** Variable rhythm table (premium reel pacing). */
export const KINETIC_CUT_DURATIONS_MS = [250, 180, 450, 120, 700, 300, 150, 900, 220, 1100]

export function buildKineticCameraPresets(f: SceneFocus): CameraPreset[] {
  const { centerX, centerZ, viewSize, floorW, floorD, entrance } = f
  const vs = viewSize
  const ent = entrance || { x: centerX + floorW * 0.2, z: centerZ - floorD * 0.25 }

  const presets: Omit<CameraPreset, 'durationMs' | 'ease'>[] = [
    { id: 'top', position: new THREE.Vector3(centerX, vs * 1.55, centerZ), target: new THREE.Vector3(centerX, 0, centerZ), fov: 48 },
    { id: 'iso', position: new THREE.Vector3(centerX + vs * 0.85, vs * 0.72, centerZ + vs * 0.85), target: new THREE.Vector3(centerX, 0, centerZ), fov: 42 },
    { id: 'low', position: new THREE.Vector3(centerX + vs * 0.35, vs * 0.22, centerZ + vs * 1.05), target: new THREE.Vector3(centerX, 0, centerZ), fov: 50 },
    { id: 'entrance', position: new THREE.Vector3(ent.x - vs * 0.35, vs * 0.38, ent.z + vs * 0.55), target: new THREE.Vector3(ent.x, 0, ent.z), fov: 44, lightPulseMs: 160 },
    { id: 'corridor', position: new THREE.Vector3(centerX - vs * 0.5, vs * 0.45, centerZ), target: new THREE.Vector3(centerX + vs * 0.2, 0, centerZ), fov: 46 },
    { id: 'wide', position: new THREE.Vector3(centerX, vs * 1.2, centerZ + vs * 1.35), target: new THREE.Vector3(centerX, 0, centerZ), fov: 52 },
    { id: 'tilt', position: new THREE.Vector3(centerX + vs * 1.1, vs * 0.55, centerZ - vs * 0.25), target: new THREE.Vector3(centerX, 0, centerZ + vs * 0.1), fov: 48 },
    { id: 'orbit', position: new THREE.Vector3(centerX - vs * 0.75, vs * 0.5, centerZ - vs * 0.65), target: new THREE.Vector3(centerX, 0, centerZ), fov: 45 },
    { id: 'macro', position: new THREE.Vector3(centerX + vs * 0.15, vs * 0.18, centerZ + vs * 0.2), target: new THREE.Vector3(centerX + vs * 0.05, 0, centerZ + vs * 0.05), fov: 58, lightPulseMs: 140 },
    { id: 'bird', position: new THREE.Vector3(centerX, vs * 1.35, centerZ), target: new THREE.Vector3(centerX, 0, centerZ), fov: 50 },
    { id: 'hero', position: new THREE.Vector3(centerX + vs * 0.82, vs * 0.68, centerZ + vs * 0.82), target: new THREE.Vector3(centerX, 0, centerZ), fov: 42 },
  ]

  return presets.map((p, i) => ({
    ...p,
    durationMs: KINETIC_CUT_DURATIONS_MS[i] ?? 400,
    ease: p.id === 'orbit' ? 'easeInOutCubic' : (i % 3 === 0 ? 'easeOutExpo' : 'cut'),
    lightPulseMs: p.lightPulseMs ?? (i % 4 === 1 ? 120 : undefined),
  }))
}

/** Timeline markers (ms from intro start). */
export const KINETIC_TIMELINE = {
  BLACK_END: 280,
  MAP_EMERGE: 400,
  SWEEP_START: 900,
  SWEEP_END: 3200,
  REVEAL_START: 2400,
  REVEAL_END: 5200,
  REPLAY_AT: 3000,
  CUTS_START: 3600,
  CUTS_END: 8600,
  HOLD_END: 9600,
  TOTAL: 9600,
} as const
