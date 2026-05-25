import * as THREE from 'three'
import type { VenueObject } from '../types'
import { getDrawableFixtureOutline, venueObjectsToFixtures } from './venueFloorPlanMap'

const CYAN = 0x00e5ff
const CYAN_FILL = 0x00bcd4

/** Parallel XZ planes — heatmap bars float on the pedestal plane (Y ≈ 0.5). */
export type DwgWireframePlane = 'floor' | 'pedestal'

export const DWG_WIREFRAME_PLANE_Y: Record<DwgWireframePlane, number> = {
  floor: 0.035,
  pedestal: 0.47,
}

export interface DwgWireframe3DOptions {
  plane?: DwgWireframePlane
  /** High-contrast white strokes + dark halo (recommended). */
  highContrast?: boolean
  showFill?: boolean
}

function addEdgeBar(
  group: THREE.Group,
  a: { x: number; z: number },
  b: { x: number; z: number },
  y: number,
  width: number,
  color: number,
  tag: string,
) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len = Math.hypot(dx, dz)
  if (len < 0.02) return

  const geom = new THREE.BoxGeometry(len, 0.028, width)
  const mat = new THREE.MeshBasicMaterial({
    color,
    depthWrite: true,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geom, mat)
  mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2)
  mesh.rotation.y = Math.atan2(dz, dx)
  mesh.userData.isDwgWireframe = true
  mesh.userData.dwgPart = tag
  mesh.renderOrder = tag === 'halo' ? 1 : 2
  group.add(mesh)
}

function addPolygonEdges(
  group: THREE.Group,
  outline: { x: number; z: number }[],
  y: number,
  lineWidth: number,
  color: number,
  tag: string,
) {
  for (let i = 0; i < outline.length; i++) {
    addEdgeBar(group, outline[i], outline[(i + 1) % outline.length], y, lineWidth, color, tag)
  }
}

/**
 * Build a 3D DWG fixture wireframe group in venue coordinates (X/Z floor, Y up).
 * Uses solid extruded edges (not 1px GL lines) for readability in the 3D heatmap.
 */
export function buildDwgWireframeGroup(
  objects: VenueObject[],
  options: DwgWireframe3DOptions = {},
): THREE.Group {
  const {
    plane = 'floor',
    highContrast = true,
    showFill = true,
  } = options

  const y = DWG_WIREFRAME_PLANE_Y[plane]
  const strokeColor = highContrast ? 0xf0fdff : CYAN
  const haloColor = highContrast ? 0x061018 : 0x003344
  const lineWidth = highContrast ? 0.14 : 0.1
  const haloWidth = lineWidth * 1.75
  const fillColor = highContrast ? 0x1a3a4a : CYAN_FILL
  const fillOpacity = highContrast ? 0.35 : 0.22

  const group = new THREE.Group()
  group.name = 'DwgWireframeOverlay'
  group.userData.plane = plane

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
      fillGeom.translate(0, y - 0.012, 0)

      const fillMat = new THREE.MeshBasicMaterial({
        color: fillColor,
        transparent: true,
        opacity: fillOpacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
      const fillMesh = new THREE.Mesh(fillGeom, fillMat)
      fillMesh.renderOrder = 0
      fillMesh.userData.isDwgWireframe = true
      fillMesh.userData.dwgPart = 'fill'
      group.add(fillMesh)
    }

    addPolygonEdges(group, outline, y - 0.006, haloWidth, haloColor, 'halo')
    addPolygonEdges(group, outline, y, lineWidth, strokeColor, 'stroke')
  }

  return group
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
