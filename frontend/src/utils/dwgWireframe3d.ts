import * as THREE from 'three'
import type { VenueObject } from '../types'
import { getDrawableFixtureOutline, venueObjectsToFixtures } from './venueFloorPlanMap'

const DEFAULT_WIRE_COLOR = 0x00d2ff

export interface DwgWireframe3DOptions {
  /** Ground-plane height (world Y). Keep below elevated heatmap tiles. */
  y?: number
  color?: number
  opacity?: number
  /** Subtle ground fill like FloorPlanMiniMap */
  showFill?: boolean
}

/**
 * Build a 3D DWG fixture wireframe group in venue coordinates (X/Z floor, Y up).
 * Uses the same footprint logic as FloorPlanMiniMap / Business Reporting.
 */
export function buildDwgWireframeGroup(
  objects: VenueObject[],
  options: DwgWireframe3DOptions = {},
): THREE.Group {
  const {
    y = 0.02,
    color = DEFAULT_WIRE_COLOR,
    opacity = 0.55,
    showFill = true,
  } = options

  const group = new THREE.Group()
  group.name = 'DwgWireframeOverlay'

  const fixtures = venueObjectsToFixtures(objects)

  for (const fixture of fixtures) {
    const outline = getDrawableFixtureOutline(fixture)
    if (outline.length < 3) continue

    if (showFill) {
      const shape = new THREE.Shape()
      shape.moveTo(outline[0].x, outline[0].z)
      for (let i = 1; i < outline.length; i++) {
        shape.lineTo(outline[i].x, outline[i].z)
      }
      shape.closePath()

      const fillGeom = new THREE.ShapeGeometry(shape)
      fillGeom.rotateX(Math.PI / 2)
      fillGeom.translate(0, y - 0.004, 0)

      const fillMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: opacity * 0.15,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
      const fillMesh = new THREE.Mesh(fillGeom, fillMat)
      fillMesh.renderOrder = -2
      fillMesh.userData.isDwgWireframe = true
      group.add(fillMesh)
    }

    const points = outline.map(p => new THREE.Vector3(p.x, y, p.z))
    points.push(points[0].clone())
    const lineGeom = new THREE.BufferGeometry().setFromPoints(points)
    const lineMat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    })
    const line = new THREE.Line(lineGeom, lineMat)
    line.renderOrder = -1
    line.userData.isDwgWireframe = true
    group.add(line)
  }

  return group
}

export function setDwgWireframeOpacity(group: THREE.Group, opacity: number) {
  group.traverse(obj => {
    if (!obj.userData.isDwgWireframe) return
    const mat = (obj as THREE.Mesh | THREE.Line).material
    if (mat && 'opacity' in mat) {
      const m = mat as THREE.Material & { opacity: number }
      m.opacity = obj instanceof THREE.Mesh ? opacity * 0.15 : opacity
      m.transparent = true
    }
  })
}

export function disposeObject3D(root: THREE.Object3D) {
  root.traverse(obj => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry?.dispose()
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose())
      else obj.material?.dispose()
    }
  })
}
