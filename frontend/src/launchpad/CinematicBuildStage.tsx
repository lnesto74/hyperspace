/**
 * CinematicBuildStage — LiDAR Hologram Build animation
 *
 * Plays a ~8-second cinematic that visually constructs the digital twin
 * from the DWG geometry. Uses vanilla Three.js (matching Layout3DPreview).
 *
 * Animation phases:
 *  1. Laser wireframe draw       (0–2 s)
 *  2. Wall extrusion             (2–3.5 s)
 *  3. Fixtures appear in groups  (3.5–6 s)
 *  4. ROIs + LiDAR sensors       (6–7.5 s)
 *  5. Camera hero move           (7.5–9 s)
 *
 * After completion calls `onDone()` so the Stage can transition
 * to the normal 3D preview.
 */

import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import type { DwgGeometry } from './LaunchPadStepper'
import { API_BASE } from '../config/api'

/* ─── constants ─── */
const TOTAL_DURATION = 14 // seconds (including 2s hold at end)
const PHASE = {
  WIREFRAME_START: 0,
  WIREFRAME_END: 3,
  EXTRUDE_START: 2,
  EXTRUDE_END: 5,
  FIXTURES_START: 4,
  FIXTURES_END: 8,
  ROI_LIDAR_START: 7,
  ROI_LIDAR_END: 10,
  FADE_START: 10,
  // 12–14s: hold at final state
}

// Match Layout3DPreview TYPE_COLORS exactly
const CYAN = 0x00e5ff // wireframe accent only
const TYPE_COLORS: Record<string, number> = {
  shelf: 0x6366f1,
  wall: 0x64748b,
  checkout: 0x22c55e,
  entrance: 0xf59e0b,
  pillar: 0x78716c,
  digital_display: 0x8b5cf6,
  custom: 0x78909c,
  fridge: 0x26c6da,
  radio: 0x455a64,
  default: 0x4b5563,
}
const LIDAR_GREEN = 0x22c55e
const LIDAR_HALO = 0xb0bec5 // subtle light grey for coverage halos

interface CinematicBuildStageProps {
  geometry: DwgGeometry
  layoutVersionId: string
  importId?: string
}

/* ─── helpers ─── */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}


/**
 * Convert DXF x,y → scene x,z using the SAME transform as Layout3DPreview:
 *   sceneX = dxfX * effectiveScale - centerX
 *   sceneZ = dxfY * effectiveScale - centerZ
 */
function toScene(dxfX: number, dxfY: number, centerX: number, centerZ: number, effectiveScale: number): [number, number] {
  return [dxfX * effectiveScale - centerX, dxfY * effectiveScale - centerZ]
}

interface ResolvedFixture {
  sx: number; sz: number; w: number; d: number; h: number; rotRad: number; oversized: boolean
}

/**
 * Resolve a fixture's scene position, size, and rotation — matches Layout3DPreview exactly.
 * Handles polygon fixtures (centroid + bounding box) and simple box fixtures.
 */
function resolveFixture(
  f: { x: number; y: number; w: number; d: number; rot_deg?: number; points?: Array<{ x: number; y: number }> },
  centerX: number, centerZ: number, effectiveScale: number, boundsExtent: number,
): ResolvedFixture {
  let sx: number, sz: number, w: number, d: number, rotRad: number

  if (f.points && f.points.length >= 3) {
    // Polygon fixture — EXACT same logic as Layout3DPreview lines 758-781
    const sumX = f.points.reduce((s, p) => s + p.x, 0)
    const sumY = f.points.reduce((s, p) => s + p.y, 0)
    sx = (sumX / f.points.length) * effectiveScale - centerX
    sz = (sumY / f.points.length) * effectiveScale - centerZ
    // Rotation from LONGEST edge (most representative of fixture orientation)
    let bestLen = 0, edgeAngle = 0
    for (let i = 0; i < f.points.length; i++) {
      const a = f.points[i], b = f.points[(i + 1) % f.points.length]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len > bestLen) { bestLen = len; edgeAngle = Math.atan2(b.y - a.y, b.x - a.x) }
    }
    rotRad = -edgeAngle
    // Oriented bounding box: rotate points into edge-local frame, then compute min/max
    // This ensures w/d match the polygon shape when combined with the rotation
    const cx = sumX / f.points.length, cy = sumY / f.points.length
    const cosE = Math.cos(-edgeAngle), sinE = Math.sin(-edgeAngle)
    let lMinX = Infinity, lMaxX = -Infinity, lMinY = Infinity, lMaxY = -Infinity
    f.points.forEach(p => {
      const dx = p.x - cx, dy = p.y - cy
      const lx = dx * cosE - dy * sinE
      const ly = dx * sinE + dy * cosE
      if (lx < lMinX) lMinX = lx; if (lx > lMaxX) lMaxX = lx
      if (ly < lMinY) lMinY = ly; if (ly > lMaxY) lMaxY = ly
    })
    w = (lMaxX - lMinX) * effectiveScale
    d = (lMaxY - lMinY) * effectiveScale
  } else {
    ;[sx, sz] = toScene(f.x, f.y, centerX, centerZ, effectiveScale)
    rotRad = -(f.rot_deg || 0) * Math.PI / 180
    w = f.w * effectiveScale
    d = f.d * effectiveScale
  }

  // Size fallback for tiny/zero-sized fixtures (same as Layout3DPreview lines 792-796)
  if (w < 0.1 || d < 0.1) {
    const defaultSize = Math.max(1, boundsExtent * 0.01)
    if (w < 0.1) w = defaultSize
    if (d < 0.1) d = defaultSize
  }

  const h = Math.max(0.5, Math.min(w, d) * 0.5)
  // Flag oversized fixtures (perimeter/enclosure polygons) — area > 5% of scene extent²
  const oversized = (w * d) > (boundsExtent * boundsExtent * 0.05)
  return { sx, sz, w, d, h, rotRad, oversized }
}

export default function CinematicBuildStage({ geometry, layoutVersionId }: CinematicBuildStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const layoutInfoRef = useRef<{
    unit_scale_to_m: number
    bounds: { minX: number; minY: number; maxX: number; maxY: number }
    camera_view: any | null
  } | null>(null)
  const [ready, setReady] = useState(false)
  const [animationDone, setAnimationDone] = useState(false)
  const animatingRef = useRef(false) // prevents effect from restarting animation

  // Tooltip state
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const fixtureMetaRef = useRef<Array<{ mesh: THREE.InstancedMesh; fixtures: any[] }>>([])
  const classMapRef = useRef<Map<string, string>>(new Map())

  // Layer visibility state + refs to scene groups
  const [layers, setLayers] = useState({ wireframes: true, fixtures: true, lidars: true, rois: true })
  const wireframeGroupRef = useRef<THREE.Group | null>(null)
  const fixtureGroupRef = useRef<THREE.Group | null>(null)
  const extrudeGroupRef = useRef<THREE.Group | null>(null)
  const lidarGroupRef = useRef<THREE.Group | null>(null)
  const roiGroupRef = useRef<THREE.Group | null>(null)

  // Fetch layout data — same endpoint as Layout3DPreview
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dwg/layout/${layoutVersionId}`)
        if (res.ok) {
          const data = await res.json()
          const layout = data.layout || {}
          layoutInfoRef.current = {
            unit_scale_to_m: layout.unit_scale_to_m || 0.001,
            bounds: layout.bounds || geometry.bounds || { minX: 0, minY: 0, maxX: 1, maxY: 1 },
            camera_view: data.camera_view || null,
          }
          console.log('[CinematicBuild] Layout fetched:', {
            unit_scale_to_m: layoutInfoRef.current.unit_scale_to_m,
            bounds: layoutInfoRef.current.bounds,
            hasCameraView: !!layoutInfoRef.current.camera_view,
          })
        } else {
          throw new Error('Layout fetch failed')
        }
      } catch {
        console.warn('[CinematicBuild] Using fallback from geometry.bounds')
        layoutInfoRef.current = {
          unit_scale_to_m: 0.001,
          bounds: geometry.bounds || { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          camera_view: null,
        }
      }
      setReady(true)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutVersionId])

  // Main animation effect — runs once layout data is fetched
  useEffect(() => {
    if (!ready || !layoutInfoRef.current) return
    if (animatingRef.current) return // already running — don't restart
    const container = containerRef.current
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight
    if (width === 0 || height === 0) return

    animatingRef.current = true
    console.log('[CinematicBuild] Starting animation setup...')

    const layoutInfo = layoutInfoRef.current

    // Get scaleCorrection from localStorage (same as Inline3DFlythrough)
    let scaleCorrection = 1.0
    try {
      const settings = JSON.parse(localStorage.getItem('launchpad-autoplace-settings') || '{}')
      if (settings.scaleMultiplier) scaleCorrection = settings.scaleMultiplier
    } catch { /* ignore */ }

    // EXACT same formula as Layout3DPreview line 660-662
    const effectiveScale = layoutInfo.unit_scale_to_m * scaleCorrection
    const bounds = layoutInfo.bounds
    const centerX = (bounds.minX + bounds.maxX) / 2 * effectiveScale
    const centerZ = (bounds.minY + bounds.maxY) / 2 * effectiveScale

    console.log(`[CinematicBuild] effectiveScale=${effectiveScale}, center=(${centerX.toFixed(3)}, ${centerZ.toFixed(3)})`)

    // ── Scene setup ────────────────────────────────────────────────
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a14)

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000)
    cameraRef.current = camera
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.2
    container.appendChild(renderer.domElement)

    // Bloom post-processing
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.15,  // very subtle — match clean look of 3D preview
      0.3,
      0.9,
    )
    composer.addPass(bloomPass)

    // Lights — match Layout3DPreview style (well-lit, not dark/emissive)
    const ambientLight = new THREE.AmbientLight(0x445566, 0.8)
    scene.add(ambientLight)
    const hemiLight = new THREE.HemisphereLight(0xb0c4de, 0x2a2a3a, 0.6)
    scene.add(hemiLight)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(100, 200, 100)
    dirLight.castShadow = true
    scene.add(dirLight)

    // ── Compute content bounds (SAME as Layout3DPreview lines 664-723) ──
    const fixtures = geometry.fixtures
    const classifications = geometry.classifications || []
    const classMap = new Map<string, string>()
    classifications.forEach(c => classMap.set(c.groupId, c.suggestedType))
    classMapRef.current = classMap
    const rois = geometry.rois || []
    const lidars = geometry.lidars || []

    // Content bounds from fixtures (same as Layout3DPreview)
    let contentMinX = Infinity, contentMaxX = -Infinity
    let contentMinZ = Infinity, contentMaxZ = -Infinity
    fixtures.forEach(f => {
      if (f.points && f.points.length >= 3) {
        f.points.forEach(pt => {
          const x = pt.x * effectiveScale - centerX
          const z = pt.y * effectiveScale - centerZ
          contentMinX = Math.min(contentMinX, x)
          contentMaxX = Math.max(contentMaxX, x)
          contentMinZ = Math.min(contentMinZ, z)
          contentMaxZ = Math.max(contentMaxZ, z)
        })
      } else {
        const x = f.x * effectiveScale - centerX
        const z = f.y * effectiveScale - centerZ
        const hw = (f.w * effectiveScale) / 2
        const hd = (f.d * effectiveScale) / 2
        contentMinX = Math.min(contentMinX, x - hw)
        contentMaxX = Math.max(contentMaxX, x + hw)
        contentMinZ = Math.min(contentMinZ, z - hd)
        contentMaxZ = Math.max(contentMaxZ, z + hd)
      }
    })

    const contentWidth = contentMaxX - contentMinX
    const contentDepth = contentMaxZ - contentMinZ
    const maxContentSize = Math.max(contentWidth, contentDepth, 10)
    const contentCenterX = isFinite(contentMinX) ? (contentMinX + contentMaxX) / 2 : 0
    const contentCenterZ = isFinite(contentMinZ) ? (contentMinZ + contentMaxZ) / 2 : 0

    // ── Compute focusBounds from ROIs (SAME as Inline3DFlythrough) ──
    let fbCenterX = contentCenterX
    let fbCenterZ = contentCenterZ
    let fbSize = maxContentSize
    let hasFocusBounds = false

    if (rois.length > 0) {
      let roiMinX = Infinity, roiMinY = Infinity, roiMaxX = -Infinity, roiMaxY = -Infinity
      rois.forEach(roi => {
        roi.vertices.forEach(v => {
          const vAny = v as { x: number; y?: number; z?: number }
          roiMinX = Math.min(roiMinX, vAny.x)
          roiMinY = Math.min(roiMinY, vAny.z ?? vAny.y ?? 0)  // ROI vertices may use {x, z} or {x, y}
          roiMaxX = Math.max(roiMaxX, vAny.x)
          roiMaxY = Math.max(roiMaxY, vAny.z ?? vAny.y ?? 0)
        })
      })
      if (isFinite(roiMinX)) {
        // Same transform as Layout3DPreview line 930-934
        fbCenterX = (roiMinX + roiMaxX) / 2 * effectiveScale - centerX
        fbCenterZ = (roiMinY + roiMaxY) / 2 * effectiveScale - centerZ
        const fbWidth = (roiMaxX - roiMinX) * effectiveScale
        const fbDepth = (roiMaxY - roiMinY) * effectiveScale
        fbSize = Math.max(fbWidth, fbDepth, 10)
        hasFocusBounds = true
        console.log(`[CinematicBuild] focusBounds from ${rois.length} ROIs: center=(${fbCenterX.toFixed(1)}, ${fbCenterZ.toFixed(1)}), size=${fbSize.toFixed(1)}m`)
      }
    }

    // boundsExtent used by resolveFixture for size fallback
    const boundsExtent = (bounds.maxX - bounds.minX) * layoutInfo.unit_scale_to_m

    const sceneSize = Math.max(maxContentSize * 1.5, 50)
    const gridDivisions = Math.min(Math.ceil(sceneSize), 200)

    console.log(`[CinematicBuild] content: ${contentWidth.toFixed(1)}m x ${contentDepth.toFixed(1)}m, maxSize=${maxContentSize.toFixed(1)}m, hasFocusBounds=${hasFocusBounds}`)

    // ── Ground grid ────────────────────────────────────────
    const gridHelper = new THREE.GridHelper(sceneSize, gridDivisions, 0x112233, 0x0a0f1a)
    gridHelper.position.set(contentCenterX, 0, contentCenterZ)
    scene.add(gridHelper)

    // ── Groups that we animate ─────────────────────────────────────
    const wireframeGroup = new THREE.Group()
    wireframeGroup.name = 'CinematicWireframes'
    scene.add(wireframeGroup)
    wireframeGroupRef.current = wireframeGroup

    const extrudeGroup = new THREE.Group()
    extrudeGroup.name = 'CinematicExtrusions'
    scene.add(extrudeGroup)
    extrudeGroupRef.current = extrudeGroup

    const fixtureGroup = new THREE.Group()
    fixtureGroup.name = 'CinematicFixtures'
    scene.add(fixtureGroup)
    fixtureGroupRef.current = fixtureGroup

    const roiGroup = new THREE.Group()
    roiGroup.name = 'CinematicROIs'
    scene.add(roiGroup)
    roiGroupRef.current = roiGroup

    const lidarGroup = new THREE.Group()
    lidarGroup.name = 'CinematicLiDARs'
    scene.add(lidarGroup)
    lidarGroupRef.current = lidarGroup

    // ════════════════════════════════════════════════════════════════
    // PHASE 1 — Wireframe lines (progressive draw via dash offset)
    // ════════════════════════════════════════════════════════════════

    const wireframeMaterials: THREE.LineDashedMaterial[] = []

    // Only animate fixtures NEAR the ROI area (camera only sees this region)
    const roiRadius = fbSize * 0.8 // generous margin around ROI
    const isNearROI = (sceneX: number, sceneZ: number) => {
      const dx = sceneX - fbCenterX, dz = sceneZ - fbCenterZ
      return Math.sqrt(dx * dx + dz * dz) < roiRadius
    }

    // Build line segments from fixture outlines — ONLY near ROI
    const lineSegments: Array<{ points: THREE.Vector3[]; totalLength: number }> = []

    fixtures.forEach(f => {
      // Check if fixture is near ROI
      const rf = resolveFixture(f, centerX, centerZ, effectiveScale, boundsExtent)
      if (!isNearROI(rf.sx, rf.sz)) return

      // Wireframes: match Layout3DPreview exactly
      const verts: THREE.Vector3[] = []
      if (f.points && f.points.length >= 3) {
        // Polygon: use raw DWG points in world coords (Layout3DPreview lines 867-877)
        f.points.forEach(p => {
          const [sx, sz] = toScene(p.x, p.y, centerX, centerZ, effectiveScale)
          verts.push(new THREE.Vector3(sx, 0.05, sz))
        })
        const [sx0, sz0] = toScene(f.points[0].x, f.points[0].y, centerX, centerZ, effectiveScale)
        verts.push(new THREE.Vector3(sx0, 0.05, sz0))
      } else {
        // Non-polygon: rotated box corners using Three.js Y-axis rotation formula
        // Y-axis rotation: newX = x*cos + z*sin, newZ = -x*sin + z*cos
        const hw = rf.w / 2, hd = rf.d / 2
        const cos = Math.cos(rf.rotRad), sin = Math.sin(rf.rotRad)
        const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]]
        corners.forEach(([lx, lz]) => {
          verts.push(new THREE.Vector3(
            rf.sx + lx * cos + lz * sin,
            0.05,
            rf.sz - lx * sin + lz * cos,
          ))
        })
      }
      if (verts.length >= 2) {
        let totalLength = 0
        for (let i = 1; i < verts.length; i++) {
          totalLength += verts[i].distanceTo(verts[i - 1])
        }
        lineSegments.push({ points: verts, totalLength })
      }
    })

    console.log(`[CinematicBuild] Phase 1: ${lineSegments.length} wireframe segments near ROI (from ${fixtures.length} total fixtures, roiRadius=${roiRadius.toFixed(0)}m)`)

    lineSegments.forEach(seg => {
      const geo = new THREE.BufferGeometry().setFromPoints(seg.points)
      const mat = new THREE.LineDashedMaterial({
        color: CYAN,
        dashSize: seg.totalLength,
        gapSize: seg.totalLength,
        transparent: true,
        opacity: 0.9,
        depthTest: false, // render on top — no z-fighting with surfaces
      })
      const line = new THREE.Line(geo, mat)
      line.computeLineDistances()
      line.renderOrder = 999 // draw after all opaque geometry
      line.visible = false
      wireframeGroup.add(line)
      wireframeMaterials.push(mat)
    })

    // ════════════════════════════════════════════════════════════════
    // PHASE 2 — Wall extrusions (walls + perimeter elements)
    // ════════════════════════════════════════════════════════════════

    // Wall fixtures near ROI as opaque extrusions (excluded from Phase 3 to avoid z-fighting)
    // Skip oversized perimeter/enclosure polygons and walls far from ROI
    const wallFixtures = fixtures.filter(f => {
      const type = (f.group_id && classMap.get(f.group_id)) || ''
      if (type !== 'wall') return false
      const rf = resolveFixture(f, centerX, centerZ, effectiveScale, boundsExtent)
      return !rf.oversized && isNearROI(rf.sx, rf.sz)
    })

    const extrudeFixtures = wallFixtures.length > 0 ? wallFixtures : fixtures
      .filter(f => { const rf = resolveFixture(f, centerX, centerZ, effectiveScale, boundsExtent); return isNearROI(rf.sx, rf.sz) })
      .slice(0, 20)

    console.log(`[CinematicBuild] Phase 2: ${extrudeFixtures.length} wall/extrude fixtures (${wallFixtures.length} classified walls)`)

    const extrudeMeshes: THREE.Mesh[] = []

    extrudeFixtures.forEach(f => {
      const rf = resolveFixture(f, centerX, centerZ, effectiveScale, boundsExtent)
      const wallColor = TYPE_COLORS.wall
      const mat = new THREE.MeshStandardMaterial({
        color: wallColor,
        roughness: 0.7,
        metalness: 0.1,
      })

      let mesh: THREE.Mesh
      if (f.points && f.points.length >= 3) {
        // Polygon wall: extrude the ACTUAL DWG polygon shape (matches wireframe exactly)
        // Shape is defined in XY plane; rotateX(-PI/2) maps Y→-Z, so negate sz to compensate
        const shape = new THREE.Shape()
        const pts = f.points.map(p => {
          const [sx, sz] = toScene(p.x, p.y, centerX, centerZ, effectiveScale)
          return { sx, sz }
        })
        shape.moveTo(pts[0].sx, -pts[0].sz)
        for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].sx, -pts[i].sz)
        shape.closePath()

        const extGeo = new THREE.ExtrudeGeometry(shape, {
          depth: rf.h,
          bevelEnabled: false,
        })
        // ExtrudeGeometry extrudes along Z; rotate to extrude along Y (upward)
        extGeo.rotateX(-Math.PI / 2)
        mesh = new THREE.Mesh(extGeo, mat)
        mesh.position.set(0, 0, 0) // geometry already in world coords
      } else {
        // Non-polygon wall: fallback to BoxGeometry
        const geo = new THREE.BoxGeometry(rf.w, rf.h, rf.d)
        mesh = new THREE.Mesh(geo, mat)
        mesh.position.set(rf.sx, rf.h / 2, rf.sz)
        mesh.rotation.y = rf.rotRad
      }

      mesh.scale.y = 0
      mesh.visible = false
      mesh.userData.fixture = f // for tooltip raycasting
      extrudeGroup.add(mesh)
      extrudeMeshes.push(mesh)
    })

    // ════════════════════════════════════════════════════════════════
    // PHASE 3 — Fixtures appear (InstancedMesh per type)
    // ════════════════════════════════════════════════════════════════

    // Separate polygon fixtures (need ExtrudeGeometry) from box fixtures (InstancedMesh)
    const boxFixturesByType = new Map<string, typeof fixtures>()
    const polyFixtures: Array<{ f: typeof fixtures[0]; type: string }> = []
    fixtures.forEach(f => {
      const type = (f.group_id && classMap.get(f.group_id)) || 'default'
      if (type === 'wall') return // walls rendered as opaque extrusions in Phase 2
      const rf = resolveFixture(f, centerX, centerZ, effectiveScale, boundsExtent)
      if (rf.oversized) return // skip perimeter/enclosure polygons
      if (f.points && f.points.length >= 3) {
        polyFixtures.push({ f, type })
      } else {
        if (!boxFixturesByType.has(type)) boxFixturesByType.set(type, [])
        boxFixturesByType.get(type)!.push(f)
      }
    })

    const instancedMeshes: Array<{ mesh: THREE.InstancedMesh; type: string }> = []
    // Store per-instance fixture metadata for tooltip raycasting
    const fixtureMetadata: Array<{ mesh: THREE.InstancedMesh; fixtures: typeof fixtures }> = []
    // Individual polygon fixture meshes (animated same as InstancedMesh)
    const polyFixtureMeshes: THREE.Mesh[] = []
    const tempMatrix = new THREE.Matrix4()
    const tempPosition = new THREE.Vector3()
    const tempQuaternion = new THREE.Quaternion()
    const tempScale = new THREE.Vector3()
    const yAxis = new THREE.Vector3(0, 1, 0)

    console.log(`[CinematicBuild] Phase 3: ${boxFixturesByType.size} box types + ${polyFixtures.length} polygon fixtures`)
    boxFixturesByType.forEach((fl, tp) => console.log(`  [CinematicBuild]   ${tp}: ${fl.length} box fixtures`))

    // 3a — Box fixtures: InstancedMesh (fast, same geometry)
    boxFixturesByType.forEach((fxList, type) => {
      const color = TYPE_COLORS[type] ?? TYPE_COLORS.default

      const boxGeo = new THREE.BoxGeometry(1, 1, 1)
      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0,
        roughness: 0.6,
        metalness: 0.2,
      })

      const instMesh = new THREE.InstancedMesh(boxGeo, mat, fxList.length)
      instMesh.visible = false

      fxList.forEach((f, i) => {
        const rf = resolveFixture(f, centerX, centerZ, effectiveScale, boundsExtent)

        tempPosition.set(rf.sx, rf.h / 2, rf.sz)
        tempQuaternion.setFromAxisAngle(yAxis, rf.rotRad)
        tempScale.set(rf.w, rf.h, rf.d)
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale)
        instMesh.setMatrixAt(i, tempMatrix)
        instMesh.setColorAt(i, new THREE.Color(color))
      })

      instMesh.instanceMatrix.needsUpdate = true
      if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true

      fixtureGroup.add(instMesh)
      instancedMeshes.push({ mesh: instMesh, type })
      fixtureMetadata.push({ mesh: instMesh, fixtures: fxList })
    })
    fixtureMetaRef.current = fixtureMetadata

    // 3b — Polygon fixtures: individual ExtrudeGeometry (matches wireframe exactly)
    polyFixtures.forEach(({ f, type }) => {
      const rf = resolveFixture(f, centerX, centerZ, effectiveScale, boundsExtent)
      const color = TYPE_COLORS[type] ?? TYPE_COLORS.default

      const shape = new THREE.Shape()
      const pts = f.points!.map(p => {
        const [sx, sz] = toScene(p.x, p.y, centerX, centerZ, effectiveScale)
        return { sx, sz }
      })
      shape.moveTo(pts[0].sx, -pts[0].sz)
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].sx, -pts[i].sz)
      shape.closePath()

      const extGeo = new THREE.ExtrudeGeometry(shape, { depth: rf.h, bevelEnabled: false })
      extGeo.rotateX(-Math.PI / 2)

      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0,
        roughness: 0.6,
        metalness: 0.2,
      })
      const mesh = new THREE.Mesh(extGeo, mat)
      mesh.position.set(0, 0, 0)
      mesh.visible = false
      mesh.userData.fixture = f
      fixtureGroup.add(mesh)
      polyFixtureMeshes.push(mesh)
    })

    // ════════════════════════════════════════════════════════════════
    // PHASE 4 — ROIs (floor polygons) + LiDAR sensors
    // ════════════════════════════════════════════════════════════════

    const roiMeshes: THREE.Mesh[] = []

    rois.forEach(roi => {
      if (roi.vertices.length < 3) return
      const roiColor = parseInt(roi.color.replace('#', ''), 16) || 0xf59e0b

      // Outline only (no filled shape — matches 3D preview)
      const outlinePoints = roi.vertices.map(v => {
        const vAny = v as { x: number; y?: number; z?: number }
        const [sx, sz] = toScene(vAny.x, vAny.z ?? vAny.y ?? 0, centerX, centerZ, effectiveScale)
        return new THREE.Vector3(sx, 0.1, sz)
      })
      outlinePoints.push(outlinePoints[0].clone())
      const outGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints)
      const outMat = new THREE.LineBasicMaterial({
        color: roiColor,
        transparent: true,
        opacity: 0,
      })
      const outline = new THREE.Line(outGeo, outMat)
      outline.visible = false
      roiGroup.add(outline)
      roiMeshes.push(outline as any)
    })

    // LiDAR sensors — match Layout3DPreview exactly
    const lidarMeshes: THREE.Group[] = []
    const coveragePulses: Array<{ ring: THREE.Mesh; startTime: number }> = []
    const deviceGeometry = new THREE.SphereGeometry(0.3, 16, 16)

    lidars.forEach(lidar => {
      const [sx, sz] = toScene(lidar.x, lidar.z, centerX, centerZ, effectiveScale)
      const mountHeight = 3.0
      const range = (lidar.range_m || 20) * effectiveScale
      const group = new THREE.Group()
      group.position.set(sx, 0, sz)
      group.visible = false

      // Device sphere at mount height (same as Layout3DPreview)
      const deviceMat = new THREE.MeshStandardMaterial({
        color: LIDAR_GREEN,
        roughness: 0.3,
        metalness: 0.7,
        transparent: true,
        opacity: 0,
      })
      const device = new THREE.Mesh(deviceGeometry.clone(), deviceMat)
      device.position.y = mountHeight
      group.add(device)

      // Mount pole (same as Layout3DPreview)
      const poleGeo = new THREE.CylinderGeometry(0.05, 0.05, mountHeight, 8)
      const poleMat = new THREE.MeshStandardMaterial({
        color: 0x666666,
        transparent: true,
        opacity: 0,
      })
      const pole = new THREE.Mesh(poleGeo, poleMat)
      pole.position.y = mountHeight / 2
      group.add(pole)

      // Coverage circle on floor — thin ring (same as Layout3DPreview)
      const circleGeo = new THREE.RingGeometry(range - 0.1, range, 64)
      const circleMat = new THREE.MeshBasicMaterial({
        color: LIDAR_HALO,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      })
      const circle = new THREE.Mesh(circleGeo, circleMat)
      circle.rotation.x = -Math.PI / 2
      circle.position.y = 0.05
      group.add(circle)

      // Coverage dome (subtle, same as Layout3DPreview)
      const domeGeo = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)
      const domeMat = new THREE.MeshBasicMaterial({
        color: LIDAR_HALO,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const dome = new THREE.Mesh(domeGeo, domeMat)
      dome.scale.set(range, range * 0.3, range)
      dome.position.y = mountHeight
      dome.rotation.x = Math.PI // Point downward
      group.add(dome)

      lidarGroup.add(group)
      lidarMeshes.push(group)

      // Coverage pulse ring (expands from device to coverage radius)
      const pulseGeo = new THREE.RingGeometry(0.2, 0.4, 64)
      const pulseMat = new THREE.MeshBasicMaterial({
        color: LIDAR_HALO,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
      })
      const pulse = new THREE.Mesh(pulseGeo, pulseMat)
      pulse.rotation.x = -Math.PI / 2
      pulse.position.set(sx, 0.04, sz)
      pulse.visible = false
      scene.add(pulse)
      coveragePulses.push({ ring: pulse, startTime: 0 })
    })

    // ════════════════════════════════════════════════════════════════
    // Camera — end at EXACT same position as Layout3DPreview
    // Priority: 1) saved camera_view  2) ROI focusBounds  3) content default
    // ════════════════════════════════════════════════════════════════

    // ── OrbitControls — create FIRST (same order as Layout3DPreview) ──
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.enabled = false // disabled during animation
    let animFinished = false

    // ── Camera position — ALWAYS computed from ROI when available ──
    // Matches Layout3DPreview lines 937-943 exactly (ignore saved view)
    if (hasFocusBounds) {
      camera.position.set(
        fbCenterX + fbSize * 0.6,
        fbSize * 0.45,
        fbCenterZ + fbSize * 0.6,
      )
      controls.target.set(fbCenterX, 0, fbCenterZ)
      controls.update()
      console.log(`[CinematicBuild] Camera from ROI: pos=(${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}), target=(${fbCenterX.toFixed(1)}, 0, ${fbCenterZ.toFixed(1)})`)
    } else {
      camera.position.set(
        contentCenterX + maxContentSize * 0.8,
        maxContentSize * 0.6,
        contentCenterZ + maxContentSize * 0.8,
      )
      controls.target.set(contentCenterX, 0, contentCenterZ)
      controls.update()
      console.log(`[CinematicBuild] Camera from content: pos=(${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}), target=(${contentCenterX.toFixed(1)}, 0, ${contentCenterZ.toFixed(1)})`)
    }

    // ── Animation clock ────────────────────────────────────────────
    const clock = new THREE.Clock()
    let animFrameId = 0
    let elapsed = 0

    const animate = () => {
      animFrameId = requestAnimationFrame(animate)
      const dt = clock.getDelta()
      elapsed += dt

      // ── Phase 1: Wireframe draw (simple progressive reveal, all at once) ──
      if (elapsed >= PHASE.WIREFRAME_START && elapsed <= PHASE.WIREFRAME_END + 0.5) {
        const t = Math.min(1, (elapsed - PHASE.WIREFRAME_START) / (PHASE.WIREFRAME_END - PHASE.WIREFRAME_START))

        wireframeGroup.children.forEach((child, i) => {
          child.visible = true
          const mat = wireframeMaterials[i]
          if (!mat) return
          const seg = lineSegments[i]
          if (!seg) return
          const reveal = easeInOutCubic(t) * seg.totalLength
          mat.dashSize = reveal
          mat.gapSize = seg.totalLength - reveal + seg.totalLength
          mat.opacity = 0.9
        })
      }

      // ── Phase 2: Wall extrusion ──────────────────────────────────
      if (elapsed >= PHASE.EXTRUDE_START && elapsed <= PHASE.EXTRUDE_END + 0.3) {
        const t = Math.min(1, (elapsed - PHASE.EXTRUDE_START) / (PHASE.EXTRUDE_END - PHASE.EXTRUDE_START))
        const eased = easeOutQuart(t)

        extrudeMeshes.forEach(mesh => {
          mesh.visible = true
          mesh.scale.y = eased
        })
      }

      // ── Phase 3: Fixtures appear ─────────────────────────────────
      if (elapsed >= PHASE.FIXTURES_START && elapsed <= PHASE.FIXTURES_END + 0.3) {
        const t = Math.min(1, (elapsed - PHASE.FIXTURES_START) / (PHASE.FIXTURES_END - PHASE.FIXTURES_START))

        instancedMeshes.forEach(({ mesh, type }) => {
          mesh.visible = true
          const mat = mesh.material as THREE.MeshStandardMaterial
          const isClassified = type !== 'default'

          if (isClassified) {
            const bt = Math.max(0, Math.min(1, (t - 0.3) / 0.7))
            mat.opacity = easeOutQuart(bt) * 0.9
          } else {
            const at = Math.min(1, t / 0.5)
            mat.opacity = easeOutQuart(at) * 0.7
          }
        })
        // Polygon fixture meshes fade in alongside InstancedMesh
        polyFixtureMeshes.forEach(mesh => {
          mesh.visible = true
          const mat = mesh.material as THREE.MeshStandardMaterial
          const bt = Math.max(0, Math.min(1, (t - 0.3) / 0.7))
          mat.opacity = easeOutQuart(bt) * 0.9
        })
      }

      // ── Phase 4: ROIs + LiDARs ──────────────────────────────────
      if (elapsed >= PHASE.ROI_LIDAR_START && elapsed <= PHASE.ROI_LIDAR_END + 0.5) {
        const t = Math.min(1, (elapsed - PHASE.ROI_LIDAR_START) / (PHASE.ROI_LIDAR_END - PHASE.ROI_LIDAR_START))
        const eased = easeOutQuart(t)

        // ROI outlines fade in
        roiMeshes.forEach(mesh => {
          mesh.visible = true
          const mat = mesh.material as THREE.LineBasicMaterial
          mat.opacity = eased * 0.8
        })

        // LiDAR elements fade in with Layout3DPreview-matching opacities
        lidarMeshes.forEach(group => {
          group.visible = true
          group.children.forEach(child => {
            if (child instanceof THREE.Mesh) {
              const mat = child.material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial
              // Device sphere + pole: fully visible
              // Coverage ring: 0.3 opacity
              // Coverage dome: 0.08 opacity
              if (mat instanceof THREE.MeshStandardMaterial) {
                mat.opacity = eased * 0.9 // device + pole
              } else {
                // MeshBasicMaterial = coverage ring or dome
                const isRing = (child.geometry as THREE.RingGeometry)?.parameters !== undefined
                mat.opacity = eased * (isRing ? 0.07 : 0.02)
              }
            }
          })
        })

        // Coverage pulse expands from center to coverage radius
        coveragePulses.forEach((pulse, i) => {
          if (pulse.startTime === 0) pulse.startTime = elapsed
          const pt = (elapsed - pulse.startTime) / 1.5
          if (pt < 1) {
            pulse.ring.visible = true
            const targetScale = (lidars[i]?.range_m || 20) * effectiveScale
            const pulseScale = easeOutQuart(pt) * targetScale
            pulse.ring.scale.set(pulseScale, pulseScale, 1)
            ;(pulse.ring.material as THREE.MeshBasicMaterial).opacity = (1 - pt) * 0.07
          } else {
            pulse.ring.visible = false
          }
        })
      }

      // ── Phase 5: Wireframes fade to subtle ────────────────────
      if (elapsed >= PHASE.FADE_START && !animFinished) {
        wireframeMaterials.forEach(mat => {
          mat.opacity = Math.max(0.25, mat.opacity - dt * 0.3)
        })
      }

      // ── Animation complete → freeze + enable orbit ─────────────
      if (elapsed >= TOTAL_DURATION && !animFinished) {
        animFinished = true
        controls.enabled = true
        controls.update()

        // Keep wireframes visible as subtle floor plan outlines
        wireframeMaterials.forEach(mat => { mat.opacity = 0.25 })

        // Walls are already opaque — just ensure full scale
        extrudeMeshes.forEach(mesh => {
          mesh.scale.y = 1
        })

        // Make all fixture InstancedMeshes fully solid
        instancedMeshes.forEach(({ mesh }) => {
          const mat = mesh.material as THREE.MeshStandardMaterial
          mat.opacity = 0.95
          mat.depthWrite = true
        })
        // Make polygon fixture meshes fully solid
        polyFixtureMeshes.forEach(mesh => {
          const mat = mesh.material as THREE.MeshStandardMaterial
          mat.opacity = 0.95
          mat.depthWrite = true
        })

        // Reduce bloom for clean final look
        bloomPass.strength = 0.05

        setAnimationDone(true)
      }

      // OrbitControls update (only effective when enabled)
      if (animFinished) {
        controls.update()
      }

      // ── Render (keep rendering forever) ─────────────────────
      composer.render()
    }

    animate()

    // ── Tooltip raycaster ──────────────────────────────────────────
    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    const handleMouseMove = (event: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect()
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(mouse, camera)

      let found = false
      for (const meta of fixtureMetadata) {
        if (!meta.mesh.visible) continue
        const hits = raycaster.intersectObject(meta.mesh)
        if (hits.length > 0 && hits[0].instanceId !== undefined) {
          const f = meta.fixtures[hits[0].instanceId]
          if (f) {
            const type = (f.group_id && classMap.get(f.group_id)) || 'default'
            const hasPolygon = f.points && f.points.length >= 3
            setTooltip({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              text: `${type} | group: ${f.group_id || 'none'}\nid: ${f.id || 'N/A'} | ${hasPolygon ? 'polygon' : 'box'}\npos: (${f.x?.toFixed(1)}, ${f.y?.toFixed(1)}) rot: ${f.rot_deg?.toFixed(1) || 0}°`,
            })
            found = true
            break
          }
        }
      }
      // Also check polygon fixture meshes (not in InstancedMesh)
      if (!found) {
        const polyHits = raycaster.intersectObjects(polyFixtureMeshes)
        if (polyHits.length > 0) {
          const f = polyHits[0].object.userData.fixture
          if (f) {
            const type = (f.group_id && classMap.get(f.group_id)) || 'default'
            const hasPolygon = f.points && f.points.length >= 3
            setTooltip({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              text: `${type} | group: ${f.group_id || 'none'}\nid: ${f.id || 'N/A'} | ${hasPolygon ? 'polygon' : 'box'}\npos: (${f.x?.toFixed(1)}, ${f.y?.toFixed(1)}) rot: ${f.rot_deg?.toFixed(1) || 0}°`,
            })
            found = true
          }
        }
      }
      // Also check wall extrusion meshes (not in InstancedMesh)
      if (!found) {
        const wallHits = raycaster.intersectObjects(extrudeMeshes)
        if (wallHits.length > 0) {
          const f = wallHits[0].object.userData.fixture
          if (f) {
            const type = (f.group_id && classMap.get(f.group_id)) || 'wall'
            const hasPolygon = f.points && f.points.length >= 3
            setTooltip({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              text: `${type} | group: ${f.group_id || 'none'}\nid: ${f.id || 'N/A'} | ${hasPolygon ? 'polygon' : 'box'}\npos: (${f.x?.toFixed(1)}, ${f.y?.toFixed(1)}) rot: ${f.rot_deg?.toFixed(1) || 0}°`,
            })
            found = true
          }
        }
      }
      if (!found) setTooltip(null)
    }

    renderer.domElement.addEventListener('mousemove', handleMouseMove)

    // ── Resize handler ─────────────────────────────────────────────
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      composer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)

    // ── Cleanup ────────────────────────────────────────────────
    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.domElement.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(animFrameId)
      controls.dispose()
      renderer.dispose()
      composer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
      animatingRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, layoutVersionId])

  // Layer toggle effect — sync state to Three.js groups
  useEffect(() => {
    if (wireframeGroupRef.current) wireframeGroupRef.current.visible = layers.wireframes
    if (extrudeGroupRef.current) extrudeGroupRef.current.visible = layers.wireframes // walls follow wireframe toggle
    if (fixtureGroupRef.current) fixtureGroupRef.current.visible = layers.fixtures
    if (lidarGroupRef.current) lidarGroupRef.current.visible = layers.lidars
    if (roiGroupRef.current) roiGroupRef.current.visible = layers.rois
  }, [layers])

  const toggleLayer = (key: keyof typeof layers) => {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />

      {/* Fixture tooltip on hover */}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none px-2 py-1.5 rounded bg-black/90 border border-cyan-500/40 text-[10px] font-mono text-cyan-200 whitespace-pre leading-relaxed shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y - 10 }}
        >
          {tooltip.text}
        </div>
      )}

      {/* Scan-line overlay — only during animation */}
      {!animationDone && (
        <div
          className="absolute inset-0 pointer-events-none z-10"
          style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.03) 2px, rgba(0,229,255,0.03) 4px)',
            mixBlendMode: 'screen',
          }}
        />
      )}

      {/* Phase label — during animation */}
      {!animationDone && (
        <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-[11px] text-cyan-300/80 font-mono tracking-wider uppercase">
            Building Digital Twin
          </span>
        </div>
      )}

      {/* After animation: orbit hint + layer toggles */}
      {animationDone && (
        <>
          <div className="absolute bottom-4 left-4 z-20 text-[11px] text-gray-400 font-mono">
            Drag to orbit · Scroll to zoom
          </div>

          {/* Layer toggles */}
          <div className="absolute bottom-4 right-4 z-30 flex flex-col gap-1 bg-gray-900/80 rounded-lg p-2 backdrop-blur-sm border border-gray-700/50">
            <span className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-1">Layers</span>
            {([
              ['wireframes', 'Wireframes', '#00e5ff'],
              ['fixtures', 'Fixtures', '#6366f1'],
              ['lidars', 'LiDARs', '#22c55e'],
              ['rois', 'ROIs', '#f59e0b'],
            ] as const).map(([key, label, color]) => (
              <button
                key={key}
                onClick={() => toggleLayer(key)}
                className={`flex items-center gap-2 px-2 py-1 rounded text-[11px] font-medium transition-all ${
                  layers[key]
                    ? 'text-white hover:bg-gray-700/50'
                    : 'text-gray-500 line-through hover:bg-gray-700/30'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-sm"
                  style={{ backgroundColor: layers[key] ? color : '#333' }}
                />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
