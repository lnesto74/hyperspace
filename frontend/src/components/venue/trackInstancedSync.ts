import * as THREE from 'three'
import type { TrackWithTrail } from '../../types'

/** Default ON. Set localStorage hyperspace-instanced-tracks=0 to revert to per-track groups. */
export function isInstancedTrackMeshesEnabled(): boolean {
  try {
    return localStorage.getItem('hyperspace-instanced-tracks') !== '0'
  } catch {
    return true
  }
}

export const TRACK_CYLINDER_RADIUS = 0.25
export const TRACK_CYLINDER_HEIGHT = 1.7

const _dummy = new THREE.Object3D()
const _hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0)
const _color = new THREE.Color()

export type TrackInstancedSyncParams = {
  scene: THREE.Scene
  allTracks: Map<string, TrackWithTrail>
  tracksToRender: Map<string, TrackWithTrail>
  allTrackKeys: Set<string>
  showTracks: boolean
  cylinderOpacity: number
  trackGrace: Map<string, number>
  now: number
  trackHideDelayMs: number
  trackGraceMs: number
  resolveColor: (track: TrackWithTrail, key: string) => number | string
}

export class TrackInstancedRenderer {
  private mesh: THREE.InstancedMesh | null = null
  private instanceByKey = new Map<string, number>()
  private keyByInstance = new Map<number, string>()
  private freeIndices: number[] = []
  private nextIndex = 0
  private highWaterMark = 0

  ensureMesh(scene: THREE.Scene, maxInstances: number, opacity: number): THREE.InstancedMesh {
    if (this.mesh) return this.mesh

    const geometry = new THREE.CylinderGeometry(
      TRACK_CYLINDER_RADIUS,
      TRACK_CYLINDER_RADIUS,
      TRACK_CYLINDER_HEIGHT,
      8,
    )
    const material = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      emissive: 0x3b82f6,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity,
    })

    const mesh = new THREE.InstancedMesh(geometry, material, maxInstances)
    mesh.frustumCulled = false
    mesh.userData.isTrackInstanced = true
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    scene.add(mesh)
    this.mesh = mesh
    return mesh
  }

  setVisible(visible: boolean) {
    if (this.mesh) this.mesh.visible = visible
  }

  dispose(scene: THREE.Scene) {
    if (!this.mesh) return
    scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh = null
    this.instanceByKey.clear()
    this.keyByInstance.clear()
    this.freeIndices = []
    this.nextIndex = 0
    this.highWaterMark = 0
  }

  clearAll(scene: THREE.Scene) {
    for (const key of [...this.instanceByKey.keys()]) {
      this.hideAndFree(key)
    }
    this.dispose(scene)
  }

  private allocIndex(key: string): number {
    let index = this.freeIndices.pop()
    if (index == null) {
      index = this.nextIndex
      this.nextIndex++
    }
    this.instanceByKey.set(key, index)
    this.keyByInstance.set(index, key)
    if (index >= this.highWaterMark) this.highWaterMark = index + 1
    return index
  }

  private hideAndFree(key: string) {
    const mesh = this.mesh
    const index = this.instanceByKey.get(key)
    if (mesh == null || index == null) return
    mesh.setMatrixAt(index, _hiddenMatrix)
    this.instanceByKey.delete(key)
    this.keyByInstance.delete(index)
    this.freeIndices.push(index)
  }

  getInstanceCount() {
    return this.instanceByKey.size
  }

  getInstanceKeys(): Iterable<string> {
    return this.instanceByKey.keys()
  }

  sync(params: TrackInstancedSyncParams, maxInstances: number) {
    const mesh = this.ensureMesh(params.scene, maxInstances, params.cylinderOpacity)
    mesh.visible = params.showTracks
    ;(mesh.material as THREE.MeshStandardMaterial).opacity = params.cylinderOpacity

    // Grace + dispose for keys missing from live snapshot
    for (const key of [...this.instanceByKey.keys()]) {
      if (params.allTrackKeys.has(key)) {
        params.trackGrace.delete(key)
        continue
      }
      if (!params.trackGrace.has(key)) {
        params.trackGrace.set(key, params.now)
      }
      const graceAge = params.now - (params.trackGrace.get(key) ?? params.now)
      if (graceAge > params.trackGraceMs) {
        this.hideAndFree(key)
        params.trackGrace.delete(key)
      } else if (graceAge > params.trackHideDelayMs) {
        const index = this.instanceByKey.get(key)
        if (index != null) mesh.setMatrixAt(index, _hiddenMatrix)
      }
    }

    let activeCount = 0
    params.tracksToRender.forEach((track, key) => {
      let index = this.instanceByKey.get(key)
      if (index == null) index = this.allocIndex(key)

      const y = TRACK_CYLINDER_HEIGHT / 2
      _dummy.position.set(track.venuePosition.x, y, track.venuePosition.z)
      _dummy.rotation.set(0, 0, 0)
      _dummy.scale.set(1, 1, 1)
      _dummy.updateMatrix()
      mesh.setMatrixAt(index, _dummy.matrix)

      const colorVal = params.resolveColor(track, key)
      if (typeof colorVal === 'string') _color.set(colorVal)
      else _color.setHex(colorVal)
      mesh.setColorAt(index, _color)

      activeCount++
    })

    mesh.count = Math.max(this.highWaterMark, activeCount)
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

    return {
      instanceCount: this.instanceByKey.size,
      renderCount: params.tracksToRender.size,
    }
  }
}
