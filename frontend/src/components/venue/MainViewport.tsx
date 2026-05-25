import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Hand, Move3D, RotateCcw, Save, Download, Layers, Eye, EyeOff, Move, RotateCw } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useLidar } from '../../context/LidarContext'
import { useTrackingActions, useTracksRef } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'
import { useReplayInsight } from '../../context/ReplayInsightContext'
import { useProfitRadar } from '../../context/ProfitRadarContext'
import { usePlanogram } from '../../context/PlanogramContext'
import SkuDebugOverlay from './SkuDebugOverlay'
import { BarChart3, X } from 'lucide-react'
import { useXRay } from '../neuralDashboard/NeuralDashboard'


const COLORS = {
  grid: 0x333344,
  gridCenter: 0x444466,
  floor: 0x1a1a24,
  selected: 0x3b82f6,
  shelf: 0x6366f1,
  wall: 0x64748b,
  checkout: 0x22c55e,
  entrance: 0xf59e0b,
  pillar: 0x78716c,
  digital_display: 0x8b5cf6,
  fridge: 0x26c6da,
  radio: 0x455a64,
  custom: 0x78909c,
  lidarOnline: 0x22c55e,
  lidarOffline: 0x6b7280,
  lidarConnecting: 0xf59e0b,
  fovCone: 0x3b82f6,
  trackPerson: 0x3b82f6,
  trackCart: 0xf59e0b,
  trackUnknown: 0x8b5cf6,
  sezInfluenced: 0xff3333, // Red for people influenced by digital displays
}

const MAX_RENDER_TRACKS_CAP = 120
const RENDER_EMERGENCY_THRESHOLD = 150

function capTracksForRender<T extends { timestamp?: number }>(
  source: Map<string, T>,
  existingMeshKeys: Iterable<string>,
  max = MAX_RENDER_TRACKS_CAP,
): Map<string, T> {
  if (source.size <= RENDER_EMERGENCY_THRESHOLD) return source
  if (source.size <= max) return source
  const result = new Map<string, T>()
  for (const key of existingMeshKeys) {
    const track = source.get(key)
    if (track) result.set(key, track)
  }
  if (result.size < max) {
    const rest = [...source.entries()]
      .filter(([k]) => !result.has(k))
      .sort((a, b) => (b[1].timestamp ?? 0) - (a[1].timestamp ?? 0))
    for (const [k, t] of rest) {
      if (result.size >= max) break
      result.set(k, t)
    }
  }
  return result
}

const getObjectColorHex = (obj: { type: string; color?: string | null }, fallback = COLORS.custom) => {
  if (obj.color && /^#[0-9a-fA-F]{6}$/.test(obj.color)) {
    return parseInt(obj.color.slice(1), 16)
  }
  return (COLORS as Record<string, number>)[obj.type] || fallback
}

function applyRoiGizmoTransform(
  initialVertices: { x: number; z: number }[],
  centroid: { x: number; z: number },
  dx: number,
  dz: number,
  dRotY: number,
) {
  const cos = Math.cos(dRotY)
  const sin = Math.sin(dRotY)
  return initialVertices.map(v => {
    const rx = v.x - centroid.x
    const rz = v.z - centroid.z
    return {
      x: centroid.x + rx * cos - rz * sin + dx,
      z: centroid.z + rx * sin + rz * cos + dz,
    }
  })
}

function configureTransformControlsMode(tc: TransformControls, mode: 'translate' | 'rotate') {
  tc.setMode(mode)
  if (mode === 'translate') {
    tc.showX = true
    tc.showY = false
    tc.showZ = true
    tc.setSize(0.5)
  } else {
    tc.showX = false
    tc.showY = true
    tc.showZ = false
    tc.setSize(1.0)
  }
}

// Point-in-polygon test using ray casting algorithm
const pointInPolygon = (point: { x: number; z: number }, polygon: { x: number; z: number }[]): boolean => {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z
    const xj = polygon[j].x, zj = polygon[j].z
    if (((zi > point.z) !== (zj > point.z)) && (point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

// Generate random 3D points distributed within a capsule volume (human-like shape)
function generateCapsulePoints(radius: number, height: number, count: number): Float32Array {
  const positions = new Float32Array(count * 3)
  const halfH = height / 2

  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    const t = Math.random()

    let x: number, y: number, z: number

    if (t < 0.15) {
      // Bottom hemisphere cap
      const phi = Math.acos(Math.random()) // 0..PI/2 range via acos
      const theta = Math.random() * Math.PI * 2
      const r = radius * Math.cbrt(Math.random())
      x = r * Math.sin(phi) * Math.cos(theta)
      z = r * Math.sin(phi) * Math.sin(theta)
      y = -halfH - r * Math.cos(phi)
    } else if (t > 0.85) {
      // Top hemisphere cap
      const phi = Math.acos(Math.random())
      const theta = Math.random() * Math.PI * 2
      const r = radius * Math.cbrt(Math.random())
      x = r * Math.sin(phi) * Math.cos(theta)
      z = r * Math.sin(phi) * Math.sin(theta)
      y = halfH + r * Math.cos(phi)
    } else {
      // Cylinder body — slight taper for human-like silhouette
      const bodyT = (Math.random() - 0.5) // -0.5 to 0.5
      y = bodyT * height
      // Narrow at top (head) and bottom (feet), wider at torso
      const taper = 1.0 - 0.3 * Math.abs(bodyT * 2) // 0.7..1.0
      const angle = Math.random() * Math.PI * 2
      const r = radius * taper * Math.sqrt(Math.random())
      x = r * Math.cos(angle)
      z = r * Math.sin(angle)
    }

    positions[i3] = x
    positions[i3 + 1] = y
    positions[i3 + 2] = z
  }

  return positions
}

// Apply jitter relative to stored base positions so points never drift outside the volume
function jitterPointCloud(points: THREE.Points, jitterAmount: number = 0.035) {
  const basePositions = points.userData.basePositions as Float32Array
  if (!basePositions) return
  const pos = points.geometry.attributes.position as THREE.BufferAttribute
  const count = pos.count
  for (let i = 0; i < count; i++) {
    const i3 = i * 3
    pos.setX(i, basePositions[i3]     + (Math.random() - 0.5) * jitterAmount)
    pos.setY(i, basePositions[i3 + 1] + (Math.random() - 0.5) * jitterAmount)
    pos.setZ(i, basePositions[i3 + 2] + (Math.random() - 0.5) * jitterAmount)
  }
  pos.needsUpdate = true
}

interface CustomModel {
  object_type: string
  file_path: string
  original_name?: string
}

import type { CameraView, LightingSettings, TrackingSettings } from '../layout/AppShell'
import { API_BASE } from '../../config/api'

export type CaptureZone = {
  vertices: Array<{ x: number; z: number }>;
  color: string;
};

export type CaptureTrackSnapshot = {
  x: number;
  z: number;
  color?: number;
};

export type CaptureScreenshotFn = (options: {
  targetX?: number;
  targetZ?: number;
  height?: number;
  fov?: number;
  width?: number;
  imageHeight?: number;
  zones?: CaptureZone[];
  angleOffset?: number;
  trackPositions?: CaptureTrackSnapshot[];
}) => string | null;

interface MainViewportProps {
  cameraView?: CameraView
  lighting?: LightingSettings
  tracking?: TrackingSettings
  isReplayMode?: boolean
  replayTimestamp?: number | null
  onCaptureReady?: (captureFn: CaptureScreenshotFn) => void
}

const defaultLighting: LightingSettings = {
  ambientIntensity: 0.6,
  directionalIntensity: 0.8,
  directionalX: 5,
  directionalY: 10,
  directionalZ: 5,
  shadowsEnabled: true,
}

const defaultTracking: TrackingSettings = {
  trailSeconds: 10,
  cylinderOpacity: 0.5,
  showSkuDebug: false,
  autoShowSlotHighlight: false,
  trackDisplayMode: 'cylinder',
}

export default function MainViewport({ 
  cameraView = 'perspective', 
  lighting = defaultLighting, 
  tracking = defaultTracking,
  isReplayMode = false,
  replayTimestamp = null,
  onCaptureReady,
}: MainViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const labelRendererRef = useRef<CSS2DRenderer | null>(null)
  const axisContainerRef = useRef<HTMLDivElement | null>(null)
  const axisRendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const axisSceneRef = useRef<THREE.Scene | null>(null)
  const axisCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const objectMeshesRef = useRef<Map<string, THREE.Mesh | THREE.Group>>(new Map())
  const lidarMeshesRef = useRef<Map<string, THREE.Group>>(new Map())
  const trackMeshesRef = useRef<Map<string, THREE.Group>>(new Map())
  const trailLinesRef = useRef<Map<string, THREE.Line>>(new Map())
  // Grace period: tracks hidden but not disposed, keyed by trackKey -> hide timestamp
  const trackGraceRef = useRef<Map<string, number>>(new Map())
  const emptyTracksSinceRef = useRef<number | null>(null)
  const TRACK_GRACE_MS = 2000
  const TRACK_HIDE_DELAY_MS = 350 // hide quickly when gone — no frozen ghosts
  const EMPTY_TRACKS_CLEAR_MS = 500 // Avoid nuking all meshes on a single empty frame
  // Instanced rendering for tracks - single draw call for all 200+ tracks
  const trackInstancedMeshRef = useRef<THREE.InstancedMesh | null>(null)
  const trackInstanceMapRef = useRef<Map<string, number>>(new Map()) // trackKey -> instanceIndex
  const trackInstanceColorsRef = useRef<THREE.InstancedBufferAttribute | null>(null)
  const MAX_TRACK_INSTANCES = 500
  const roiMeshesRef = useRef<Map<string, THREE.Group>>(new Map())
  const roiVertexHandlesRef = useRef<Map<string, THREE.Mesh[]>>(new Map())
  const drawingLinesRef = useRef<THREE.Line | null>(null)
  const drawingMarkersRef = useRef<THREE.Group | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const floorRef = useRef<THREE.Mesh | null>(null)
  const floorplanOverlayRef = useRef<THREE.Mesh | null>(null)
  const ghostOverlayRef = useRef<THREE.Mesh | null>(null)
  const logoBillboardRef = useRef<THREE.Mesh | null>(null)
  const textureLoaderRef = useRef(new THREE.TextureLoader())
  const ambientLightRef = useRef<THREE.AmbientLight | null>(null)
  const directionalLightRef = useRef<THREE.DirectionalLight | null>(null)
  const raycasterRef = useRef(new THREE.Raycaster())
  const objLoaderRef = useRef(new OBJLoader())
  const gltfLoaderRef = useRef(new GLTFLoader())
  const loadedModelsRef = useRef<Map<string, THREE.Group>>(new Map())
  
  // Custom models state
  const [customModels, setCustomModels] = useState<Map<string, CustomModel>>(new Map())
  
  // Camera controls state
  const [panMode, setPanMode] = useState(false)
  const [hasSavedView, setHasSavedView] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  
  // Transform controls state (translate/rotate gizmo)
  const transformControlsRef = useRef<TransformControls | null>(null)
  const roiTransformPivotRef = useRef<THREE.Object3D | null>(null)
  const roiGizmoSnapshotRef = useRef<{
    roiId: string
    vertices: { x: number; z: number }[]
    centroid: { x: number; z: number }
    startPos: THREE.Vector3
    startRotY: number
  } | null>(null)
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate')
  
  // Layers panel state
  const [showLayersPanel, setShowLayersPanel] = useState(false)
  const [showObjectsLayer, setShowObjectsLayer] = useState(true)
  const [showLidarLayer, setShowLidarLayer] = useState(true)
  const [showGridLayer, setShowGridLayer] = useState(true)
  const [showFloorplanOverlayLayer, setShowFloorplanOverlayLayer] = useState(false)
  const [showRoiLayer, setShowRoiLayer] = useState(true)
  const [showTracksLayer, setShowTracksLayer] = useState(true)
  const showTracksRef = useRef(true)
  showTracksRef.current = showTracksLayer
  const [showTrackIdsLayer, setShowTrackIdsLayer] = useState(false)
  const showTrackIdsRef = useRef(false)
  showTrackIdsRef.current = showTrackIdsLayer
  const [areaSelectMode, setAreaSelectMode] = useState(false)
  const [areaSelectRect, setAreaSelectRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const areaSelectStartRef = useRef<{ x: number; y: number } | null>(null)
  const [showDoohLayer, setShowDoohLayer] = useState(true)
  const [showPlanogramLayer, setShowPlanogramLayer] = useState(false)
  const [show3DModels, setShow3DModels] = useState(false) // OFF by default for performance
  const [planogramSelectedShelfId, setPlanogramSelectedShelfId] = useState<string | null>(null)
  const [planogramHoveredSlotIndex, setPlanogramHoveredSlotIndex] = useState<number | null>(null)
  const [showAxisHelper, setShowAxisHelper] = useState(false)
  const axisHelperRef = useRef<THREE.AxesHelper | null>(null)
  const [showSlotArrows, setShowSlotArrows] = useState(false)
  const slotArrowsRef = useRef<THREE.Group | null>(null)
  
  // X-Ray mode
  const { xrayMode, xrayData, xrayFilters, setXrayFilters } = useXRay()
  const xrayHalosRef = useRef<Map<string, CSS2DObject>>(new Map())
  const xrayHaloTiersRef = useRef<Map<string, number>>(new Map())
  const xrayPrevMaterialsRef = useRef<Map<string, { color: number; opacity: number; transparent: boolean; wireframe: boolean; emissiveHex: number; emissiveIntensity: number }>>(new Map())
  const preXrayTracksRef = useRef<boolean>(true)
  
  // Object hover tooltip
  const [hoveredObjectTooltip, setHoveredObjectTooltip] = useState<{
    name: string
    type: string
    category?: string | null
    width: number
    height: number
    depth: number
    posX: number
    posZ: number
    id: string
    mouseX: number
    mouseY: number
  } | null>(null)
  const hoveredObjectIdRef = useRef<string | null>(null)

  // SKU Debug hover highlight
  const [hoveredSkuShelf, setHoveredSkuShelf] = useState<{
    shelfId: string
    shelfName: string
    position: { x: number; z: number }
    slotPosition?: { x: number; z: number }
    shelfRotation?: number
    levelIndex: number
    slotIndex: number
  } | null>(null)
  const skuHighlightMeshRef = useRef<THREE.Mesh | null>(null)
  
  // Auto slot highlight positions (for debug mode)
  const [autoSlotPositions, setAutoSlotPositions] = useState<Array<{ x: number; z: number; rotation?: number }>>([])
  const autoSlotMeshesRef = useRef<THREE.Mesh[]>([])
  
  // DOOH screens state
  const [doohScreens, setDoohScreens] = useState<Array<{
    id: string
    name: string
    position: { x: number; y: number; z: number }
    yawDeg: number
    mountHeightM: number
    sezPolygon: { x: number; z: number }[]
    azPolygon?: { x: number; z: number }[] | null
    doubleSided?: boolean
    enabled: boolean
  }>>([])
  const doohMeshesRef = useRef<Map<string, THREE.Group>>(new Map())
  const doohVideoMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const doohVideoStatesRef = useRef<Map<string, {
    video: HTMLVideoElement
    texture: THREE.VideoTexture
    playlist: Array<{ videoId: string; filePath: string; durationMs: number; name: string }>
    currentIndex: number
    loopCount: number
    startTs: number
  }>>(new Map())
  const [videoPlaylistRefresh, setVideoPlaylistRefresh] = useState(0)
  
  // Cluster highlight state (which object types should glow)
  const [highlightedTypes, setHighlightedTypes] = useState<string[]>([])
  const clusterHighlightMeshesRef = useRef<Map<string, THREE.LineSegments>>(new Map())
  
  // Listen for playlist updates from other components
  useEffect(() => {
    const handlePlaylistUpdate = () => {
      // Clear existing video states to force re-initialization
      doohVideoStatesRef.current.forEach((state) => {
        state.video.pause()
        state.video.src = ''
        state.texture.dispose()
      })
      doohVideoStatesRef.current.clear()
      setVideoPlaylistRefresh(prev => prev + 1)
    }
    
    const handleScreensUpdate = () => {
      // Re-fetch DOOH screens when they're created/updated in DoohAnalyticsPage
      if (venueRef.current?.id) {
        fetchDoohScreensRef.current(venueRef.current.id)
      }
    }
    
    window.addEventListener('dooh-playlist-updated', handlePlaylistUpdate)
    window.addEventListener('dooh-screens-updated', handleScreensUpdate)
    return () => {
      window.removeEventListener('dooh-playlist-updated', handlePlaylistUpdate)
      window.removeEventListener('dooh-screens-updated', handleScreensUpdate)
    }
  }, [])
  
  // Listen for cluster highlight changes from ObjectLibrary
  useEffect(() => {
    const handleHighlightChange = (e: CustomEvent<{ highlightedTypes: string[] }>) => {
      setHighlightedTypes(e.detail.highlightedTypes)
    }
    
    window.addEventListener('cluster-highlight-change', handleHighlightChange as EventListener)
    return () => window.removeEventListener('cluster-highlight-change', handleHighlightChange as EventListener)
  }, [])
  
  // Track when each person entered an SEZ zone (for 1-minute label visibility)
  const sezEntryTimesRef = useRef<Map<string, number>>(new Map())
  
  // Drag state
  const isDraggingRef = useRef(false)
  const hasDragMovedRef = useRef(false)
  const draggedObjectRef = useRef<{ type: 'object' | 'lidar' | 'roi-vertex' | 'roi', id: string, vertexIndex?: number } | null>(null)
  const dragPlaneRef = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const dragOffsetRef = useRef(new THREE.Vector3())
  
  // Drag threshold to prevent accidental selection when navigating
  const DRAG_THRESHOLD_PX = 5 // Pixels of movement before drag starts
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null)
  const pendingDragRef = useRef<{ type: 'object' | 'lidar' | 'roi-vertex' | 'roi', id: string, vertexIndex?: number, hit: any, requiresShift?: boolean } | null>(null)
  
  // Magnetic snap threshold (meters)
  const SNAP_THRESHOLD = 0.2
  
  // Track if initial camera position has been set (to avoid resetting during object drag)
  const cameraInitializedRef = useRef(false)
  
  // Track if transform gizmo is being used (to prevent any camera resets)
  const isGizmoActiveRef = useRef(false)
  
  // Hovered ROI for tooltip
  const hoveredRoiIdRef = useRef<string | null>(null)
  
  // ROI context
  const { 
    regions, 
    selectedRoiId, 
    isDrawing, 
    drawingVertices, 
    loadRegions,
    addDrawingVertex, 
    selectRegion,
    updateRegion,
    updateRegionVerticesLocal,
    deleteRegion,
    updateVertexPosition,
    openKPIPopup,
    setHoveredRoiId,
  } = useRoi()
  
  // Replay Insight context for zone highlighting
  const { isInsightMode, selectedEpisode } = useReplayInsight()
  
  // Profit Radar — Intent Field 3D layers
  const { intentFieldEnabled, zoneField, clusters } = useProfitRadar()
  const intentGlowsRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const intentClusterGroupRef = useRef<THREE.Group | null>(null)
  // tracksRef is provided by useTracksRef() — stable ref, never triggers re-renders
  
  // Planogram layer - shelf planogram data
  const { activePlanogram, loadShelfPlanogram, activeShelfPlanogram, activeCatalog, allShelfPlanograms } = usePlanogram()
  
  // Fetch custom models
  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/models`)
      if (res.ok) {
        const models: CustomModel[] = await res.json()
        const modelMap = new Map<string, CustomModel>()
        models.forEach(m => modelMap.set(m.object_type, m))
        setCustomModels(modelMap)
      }
    } catch (err) {
      console.error('Failed to fetch custom models:', err)
    }
  }, [])
  
  // Fetch DOOH screens for venue
  const fetchDoohScreens = useCallback(async (venueId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/dooh/screens?venueId=${venueId}`)
      if (res.ok) {
        const data = await res.json()
        setDoohScreens(data.screens || [])
      }
    } catch (err) {
      // DOOH feature may not be enabled, silently ignore
      console.log('DOOH screens not available')
    }
  }, [])
  
  // Helper to create SEZ zone mesh from polygon
  // offsetX/offsetZ: offset to apply to make coordinates relative to group origin
  const createSezZoneMesh = (
    polygon: { x: number; z: number }[],
    height: number,
    color: number,
    opacity: number = 0.15,
    offsetX: number = 0,
    offsetZ: number = 0
  ): THREE.Group => {
    const zoneGroup = new THREE.Group()
    
    // Apply offset to make polygon relative to group origin
    const relPolygon = polygon.map(p => ({ x: p.x - offsetX, z: p.z - offsetZ }))
    
    // Calculate center of relative polygon
    const centerX = relPolygon.reduce((sum, p) => sum + p.x, 0) / relPolygon.length
    const centerZ = relPolygon.reduce((sum, p) => sum + p.z, 0) / relPolygon.length
    
    // Create shape relative to center - use X and -Z to match world coordinates after rotation
    // This ensures the solid matches the wireframe orientation
    const shape = new THREE.Shape()
    shape.moveTo(relPolygon[0].x - centerX, -(relPolygon[0].z - centerZ))
    for (let i = 1; i < relPolygon.length; i++) {
      shape.lineTo(relPolygon[i].x - centerX, -(relPolygon[i].z - centerZ))
    }
    shape.closePath()
    
    // Extruded volume
    const extrudeGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: false,
    })
    const zoneMesh = new THREE.Mesh(
      extrudeGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    )
    zoneMesh.rotation.x = -Math.PI / 2
    zoneMesh.position.set(centerX, 0.02, centerZ)
    zoneGroup.add(zoneMesh)
    
    // Edge lines (relative to group origin)
    const edgePoints: THREE.Vector3[] = []
    for (let i = 0; i < relPolygon.length; i++) {
      const p1 = relPolygon[i]
      const p2 = relPolygon[(i + 1) % relPolygon.length]
      edgePoints.push(new THREE.Vector3(p1.x, 0.03, p1.z))
      edgePoints.push(new THREE.Vector3(p2.x, 0.03, p2.z))
      edgePoints.push(new THREE.Vector3(p1.x, height, p1.z))
      edgePoints.push(new THREE.Vector3(p2.x, height, p2.z))
      edgePoints.push(new THREE.Vector3(p1.x, 0.03, p1.z))
      edgePoints.push(new THREE.Vector3(p1.x, height, p1.z))
    }
    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(edgePoints)
    const edgeLines = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 })
    )
    zoneGroup.add(edgeLines)
    
    return zoneGroup
  }

  // Generate back-facing SEZ polygon (rotated 180 degrees from screen position)
  // Returns polygon in ABSOLUTE coordinates (caller should apply offset)
  const generateBackSezPolygon = (
    frontPolygon: { x: number; z: number }[],
    screenPos: { x: number; z: number }
  ): { x: number; z: number }[] => {
    // Rotate each point 180 degrees around the screen position
    // Also reverse the order to maintain correct polygon winding
    return frontPolygon.map(p => ({
      x: 2 * screenPos.x - p.x,
      z: 2 * screenPos.z - p.z,
    })).reverse()
  }

  // Create DOOH zone mesh for a screen
  // Group is positioned at screen.position so children use RELATIVE coordinates
  // This allows the entire group to be moved/rotated and children follow naturally
  const createDoohZoneMesh = useCallback((screen: typeof doohScreens[0]): THREE.Group => {
    const group = new THREE.Group()
    group.name = `dooh-screen-${screen.id}`
    
    // Position group at screen location - all children will be relative to this
    group.position.set(screen.position.x, 0, screen.position.z)
    group.rotation.y = (screen.yawDeg || 0) * Math.PI / 180
    
    // Store original screen position for reference
    group.userData.screenId = screen.id
    group.userData.originalPosition = { x: screen.position.x, z: screen.position.z }
    group.userData.originalYawRad = (screen.yawDeg || 0) * Math.PI / 180
    
    const sezColor = 0x9333ea // Purple
    const sezColorBack = 0x7c3aed // Slightly different purple for back
    const height = screen.mountHeightM + 0.5
    
    // Create front SEZ zone (relative to screen position, no rotation - group handles rotation)
    if (screen.sezPolygon && screen.sezPolygon.length >= 3) {
      // Create SEZ relative to screen position, then undo group rotation so it renders correctly
      const frontZone = createSezZoneMesh(screen.sezPolygon, height, sezColor, 0.15, screen.position.x, screen.position.z)
      // Undo group rotation for the zone (SEZ polygon is already in world orientation from backend)
      frontZone.rotation.y = -group.rotation.y
      group.add(frontZone)
      
      // Create back SEZ zone if double-sided
      if (screen.doubleSided) {
        const backPolygon = generateBackSezPolygon(screen.sezPolygon, screen.position)
        const backZone = createSezZoneMesh(backPolygon, height, sezColorBack, 0.12, screen.position.x, screen.position.z)
        backZone.rotation.y = -group.rotation.y
        group.add(backZone)
      }
    }
    
    // Direction arrow (relative to group origin, pointing in local +Z direction)
    const arrowLength = 1.5
    const arrowPoints = [
      new THREE.Vector3(0, screen.mountHeightM, 0),
      new THREE.Vector3(0, screen.mountHeightM, arrowLength),
    ]
    const arrowGeometry = new THREE.BufferGeometry().setFromPoints(arrowPoints)
    const arrowLine = new THREE.Line(
      arrowGeometry,
      new THREE.LineBasicMaterial({ color: sezColor, linewidth: 2 })
    )
    group.add(arrowLine)
    
    // Vertical pole (at group origin)
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, screen.mountHeightM, 8),
      new THREE.MeshStandardMaterial({ color: 0x666666 })
    )
    pole.position.set(0, screen.mountHeightM / 2, 0)
    group.add(pole)
    
    return group
  }, [])
  
  // Load 3D model (OBJ, GLB, or GLTF with textures)
  const loadModel = useCallback(async (type: string, url: string): Promise<THREE.Group | null> => {
    // Check cache first
    if (loadedModelsRef.current.has(type)) {
      return loadedModelsRef.current.get(type)!.clone()
    }
    
    // First fetch to check the content type
    try {
      const response = await fetch(url, { method: 'HEAD' })
      const contentType = response.headers.get('content-type') || ''
      const isGltf = contentType.includes('gltf')
      const isObj = contentType.includes('text/plain')
      
      console.log(`Loading model ${type}: contentType=${contentType}, isGltf=${isGltf}, isObj=${isObj}`)
      
      return new Promise((resolve) => {
        if (isGltf || !isObj) {
          // Load as GLTF/GLB - set resource path for textures using static serving
          const basePath = `${API_BASE}/api/models-static/${type}/`
          gltfLoaderRef.current.setResourcePath(basePath)
          
          gltfLoaderRef.current.load(
            url,
            (gltf) => {
              const obj = gltf.scene
              // Normalize the model
              const box = new THREE.Box3().setFromObject(obj)
              const size = box.getSize(new THREE.Vector3())
              const center = box.getCenter(new THREE.Vector3())
              
              // Center the model at origin, bottom at y=0
              obj.position.set(-center.x, -box.min.y, -center.z)
              
              // Wrap in a group for consistent handling
              const group = new THREE.Group()
              group.add(obj)
              group.userData.originalSize = size
              
              // Cache the model
              loadedModelsRef.current.set(type, group)
              resolve(group.clone())
            },
            undefined,
            (err) => {
              console.error(`Failed to load GLTF for ${type}:`, err)
              resolve(null)
            }
          )
        } else {
          // Load as OBJ
          objLoaderRef.current.load(
            url,
            (obj) => {
              // Normalize the model
              const box = new THREE.Box3().setFromObject(obj)
              const size = box.getSize(new THREE.Vector3())
              const center = box.getCenter(new THREE.Vector3())
              
              // Center and scale to unit size
              obj.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.geometry.translate(-center.x, -box.min.y, -center.z)
                }
              })
              
              // Store original size for scaling
              obj.userData.originalSize = size
              
              // Cache the model
              loadedModelsRef.current.set(type, obj)
              resolve(obj.clone())
            },
            undefined,
            (err) => {
              console.error(`Failed to load OBJ for ${type}:`, err)
              resolve(null)
            }
          )
        }
      })
    } catch (err) {
      console.error(`Failed to fetch model info for ${type}:`, err)
      return null
    }
  }, [])

  const { venue, objects, selectedObjectId, selectedObjectIds, hoveredObjectId, selectObject, selectObjects, hoverObject, updateObject, removeObject, removeObjects, snapToGrid, copySelectedObjects, pasteObjects } = useVenue()
  const { placements, selectedPlacementId, selectPlacement, updatePlacement, removePlacement, getDeviceById } = useLidar()
  const tracksRef = useTracksRef()

  // Ghost overlay — listens for events from MatchingTunerPanel and renders a
  // textured plane on the venue floor. Stale loads (when slider drags fire
  // multiple requests) are discarded by tracking the latest URL.
  const latestGhostUrlRef = useRef<string | null>(null)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ url: string | null; opacity: number }>
      const { url, opacity } = ce.detail || { url: null, opacity: 0.65 }
      const scene = sceneRef.current
      if (!scene || !venue) return

      latestGhostUrlRef.current = url

      // Update opacity in place if the URL is unchanged (or we already have one)
      if (!url) {
        if (ghostOverlayRef.current) {
          scene.remove(ghostOverlayRef.current)
          const m = ghostOverlayRef.current.material as THREE.MeshBasicMaterial
          m.map?.dispose()
          m.dispose()
          ghostOverlayRef.current.geometry.dispose()
          ghostOverlayRef.current = null
        }
        return
      }

      const loader = new THREE.TextureLoader()
      loader.load(url, (texture) => {
        // Out-of-order resolution check: discard if a newer URL has been requested
        if (latestGhostUrlRef.current !== url) {
          texture.dispose()
          return
        }
        texture.minFilter = THREE.LinearFilter
        texture.magFilter = THREE.LinearFilter
        const w = venue.width || 80
        const d = venue.depth || 80

        // Reuse the existing mesh if dimensions match — only swap the texture.
        // Avoids creating a new PlaneGeometry every slider tick.
        if (ghostOverlayRef.current
            && ghostOverlayRef.current.userData.width === w
            && ghostOverlayRef.current.userData.depth === d) {
          const mat = ghostOverlayRef.current.material as THREE.MeshBasicMaterial
          mat.map?.dispose()
          mat.map = texture
          mat.opacity = opacity
          mat.needsUpdate = true
          return
        }

        if (ghostOverlayRef.current) {
          scene.remove(ghostOverlayRef.current)
          const m = ghostOverlayRef.current.material as THREE.MeshBasicMaterial
          m.map?.dispose()
          m.dispose()
          ghostOverlayRef.current.geometry.dispose()
        }

        const geo = new THREE.PlaneGeometry(w, d)
        const mat = new THREE.MeshBasicMaterial({
          map: texture, transparent: true, opacity,
          depthWrite: false, side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.rotation.x = -Math.PI / 2
        mesh.position.set(w / 2, 0.05, d / 2)
        mesh.userData = { isGhostOverlay: true, width: w, depth: d }
        mesh.renderOrder = 1
        scene.add(mesh)
        ghostOverlayRef.current = mesh
      })
    }
    window.addEventListener('ghost-overlay-changed', handler as EventListener)
    return () => window.removeEventListener('ghost-overlay-changed', handler as EventListener)
  }, [venue])
  
  // Stable references for callbacks
  const venueRef = useRef(venue)
  const objectsRef = useRef(objects)
  const placementsRef = useRef(placements)
  const regionsRef = useRef(regions)
  const isDrawingRef = useRef(isDrawing)
  const drawingVerticesDataRef = useRef(drawingVertices)
  const updateObjectRef = useRef(updateObject)
  const updatePlacementRef = useRef(updatePlacement)
  const removeObjectRef = useRef(removeObject)
  const removeObjectsRef = useRef(removeObjects)
  const copySelectedObjectsRef = useRef(copySelectedObjects)
  const pasteObjectsRef = useRef(pasteObjects)
  const removePlacementRef = useRef(removePlacement)
  const snapToGridRef = useRef(snapToGrid)
  const selectObjectRef = useRef(selectObject)
  const selectObjectsRef = useRef(selectObjects)
  const hoverObjectRef = useRef(hoverObject)
  const selectPlacementRef = useRef(selectPlacement)
  const selectRegionRef = useRef(selectRegion)
  const addDrawingVertexRef = useRef(addDrawingVertex)
  const updateRegionRef = useRef(updateRegion)
  const updateRegionVerticesLocalRef = useRef(updateRegionVerticesLocal)
  const deleteRegionRef = useRef(deleteRegion)
  const updateVertexPositionRef = useRef(updateVertexPosition)
  const openKPIPopupRef = useRef(openKPIPopup)
  const setHoveredRoiIdRef = useRef(setHoveredRoiId)
  const selectedObjectIdRef = useRef(selectedObjectId)
  const selectedObjectIdsRef = useRef(selectedObjectIds)
  const selectedPlacementIdRef = useRef(selectedPlacementId)
  const selectedRoiIdRef = useRef(selectedRoiId)
  const showPlanogramLayerRef = useRef(showPlanogramLayer)
  const setPlanogramSelectedShelfIdRef = useRef(setPlanogramSelectedShelfId)
  const planogramSelectedShelfIdRef = useRef(planogramSelectedShelfId)
  const activeShelfPlanogramRef = useRef(activeShelfPlanogram)
  const setPlanogramHoveredSlotIndexRef = useRef(setPlanogramHoveredSlotIndex)
  const doohScreensRef = useRef(doohScreens)
  const fetchDoohScreensRef = useRef(fetchDoohScreens)
  
  useEffect(() => {
    venueRef.current = venue
    objectsRef.current = objects
    placementsRef.current = placements
    regionsRef.current = regions
    isDrawingRef.current = isDrawing
    drawingVerticesDataRef.current = drawingVertices
    updateObjectRef.current = updateObject
    updatePlacementRef.current = updatePlacement
    removeObjectRef.current = removeObject
    removeObjectsRef.current = removeObjects
    copySelectedObjectsRef.current = copySelectedObjects
    pasteObjectsRef.current = pasteObjects
    removePlacementRef.current = removePlacement
    snapToGridRef.current = snapToGrid
    selectObjectRef.current = selectObject
    selectObjectsRef.current = selectObjects
    hoverObjectRef.current = hoverObject
    selectPlacementRef.current = selectPlacement
    selectRegionRef.current = selectRegion
    addDrawingVertexRef.current = addDrawingVertex
    updateRegionRef.current = updateRegion
    updateRegionVerticesLocalRef.current = updateRegionVerticesLocal
    deleteRegionRef.current = deleteRegion
    updateVertexPositionRef.current = updateVertexPosition
    openKPIPopupRef.current = openKPIPopup
    setHoveredRoiIdRef.current = setHoveredRoiId
    selectedObjectIdRef.current = selectedObjectId
    selectedObjectIdsRef.current = selectedObjectIds
    selectedPlacementIdRef.current = selectedPlacementId
    selectedRoiIdRef.current = selectedRoiId
    showPlanogramLayerRef.current = showPlanogramLayer
    setPlanogramSelectedShelfIdRef.current = setPlanogramSelectedShelfId
    planogramSelectedShelfIdRef.current = planogramSelectedShelfId
    activeShelfPlanogramRef.current = activeShelfPlanogram
    setPlanogramHoveredSlotIndexRef.current = setPlanogramHoveredSlotIndex
    doohScreensRef.current = doohScreens
    fetchDoohScreensRef.current = fetchDoohScreens
  }, [venue, objects, placements, regions, isDrawing, drawingVertices, updateObject, updatePlacement, removeObject, removeObjects, copySelectedObjects, pasteObjects, removePlacement, snapToGrid, selectObject, selectObjects, selectPlacement, selectRegion, addDrawingVertex, updateRegion, deleteRegion, updateVertexPosition, openKPIPopup, setHoveredRoiId, selectedObjectId, selectedObjectIds, selectedPlacementId, selectedRoiId, showPlanogramLayer, setPlanogramSelectedShelfId, planogramSelectedShelfId, activeShelfPlanogram, setPlanogramHoveredSlotIndex, doohScreens, fetchDoohScreens])
  
  // Load ROIs when venue changes
  useEffect(() => {
    if (venue?.id) {
      // Pass dwg_layout_version_id for DWG venues to load correct ROIs
      loadRegions(venue.id, venue.dwg_layout_version_id)
    }
  }, [venue?.id, venue?.dwg_layout_version_id, loadRegions])

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0f0f14)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000)
    camera.position.set(15, 15, 15)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      logarithmicDepthBuffer: true, // Better depth precision for large scenes
      alpha: true,
      preserveDrawingBuffer: true, // Required for screenshot capture
    })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.sortObjects = true // Ensure proper transparent object sorting
    // Ensure canvas is positioned at origin of container for accurate mouse tracking
    renderer.domElement.style.position = 'absolute'
    renderer.domElement.style.top = '0'
    renderer.domElement.style.left = '0'
    renderer.domElement.style.zIndex = '1'
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Label renderer for tooltips
    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(width, height)
    labelRenderer.domElement.style.position = 'absolute'
    labelRenderer.domElement.style.top = '0'
    labelRenderer.domElement.style.left = '0'
    labelRenderer.domElement.style.zIndex = '2'
    labelRenderer.domElement.style.pointerEvents = 'none'
    container.appendChild(labelRenderer.domElement)
    labelRendererRef.current = labelRenderer

    // Top-left axis gizmo, matching DWG Importer 3D Preview.
    const axisScene = new THREE.Scene()
    axisSceneRef.current = axisScene
    const axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    axisCamera.position.set(3, 3, 3)
    axisCamera.lookAt(0, 0, 0)
    axisCameraRef.current = axisCamera

    const origin = new THREE.Vector3(0, 0, 0)
    axisScene.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), origin, 1, 0xff4444, 0.3, 0.15))
    axisScene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), origin, 1, 0x44ff44, 0.3, 0.15))
    axisScene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), origin, 1, 0x4444ff, 0.3, 0.15))

    const createAxisLabel = (text: string, color: number, position: THREE.Vector3) => {
      const canvas = document.createElement('canvas')
      canvas.width = 64
      canvas.height = 64
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
      ctx.font = 'bold 48px Arial'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(text, 32, 32)
      const texture = new THREE.CanvasTexture(canvas)
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }))
      sprite.position.copy(position)
      sprite.scale.set(0.4, 0.4, 1)
      return sprite
    }
    axisScene.add(createAxisLabel('X', 0xff4444, new THREE.Vector3(1.3, 0, 0)))
    axisScene.add(createAxisLabel('Y', 0x44ff44, new THREE.Vector3(0, 0, 1.3)))
    axisScene.add(createAxisLabel('Z', 0x4444ff, new THREE.Vector3(0, 1.3, 0)))

    if (axisContainerRef.current) {
      const axisRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      axisRenderer.setSize(124, 124)
      axisRenderer.setClearColor(0x1a1a2e, 1)
      axisContainerRef.current.innerHTML = ''
      axisContainerRef.current.appendChild(axisRenderer.domElement)
      axisRendererRef.current = axisRenderer
    }

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.maxPolarAngle = Math.PI / 2.1
    controls.minDistance = 0.1
    controls.maxDistance = Infinity
    controlsRef.current = controls

    // Transform controls (gizmo for translate/rotate)
    const transformControls = new TransformControls(camera, renderer.domElement)
    transformControls.setSpace('world') // World space for consistent XZ movement
    transformControls.setSize(0.5)      // Smaller, less intrusive
    transformControls.visible = false
    // Constrain to X-Z plane (floor movement) - hide Y axis for translate
    transformControls.showY = false
    scene.add(transformControls)
    transformControlsRef.current = transformControls

    const roiPivot = new THREE.Object3D()
    roiPivot.userData.isRoiPivot = true
    scene.add(roiPivot)
    roiTransformPivotRef.current = roiPivot
    
    // Disable orbit controls while interacting with transform gizmo
    transformControls.addEventListener('mouseDown', () => {
      isGizmoActiveRef.current = true
      controls.enabled = false
    })
    
    transformControls.addEventListener('dragging-changed', (event) => {
      if (event.value) {
        // Started dragging - keep orbit disabled and mark gizmo as active
        isGizmoActiveRef.current = true
        controls.enabled = false
      } else {
        // Finished dragging - delay re-enable to prevent camera jump
        setTimeout(() => {
          isGizmoActiveRef.current = false
          controls.enabled = true
        }, 100)
      }
    })
    
    transformControls.addEventListener('mouseUp', () => {
      // Delay re-enable to prevent camera jump when releasing gizmo
      setTimeout(() => {
        isGizmoActiveRef.current = false
        controls.enabled = true
      }, 100)
      
      // Persist ROI / sync object when transform gizmo drag ends
      const obj3d = transformControls.object
      if (obj3d?.userData?.isRoiPivot) {
        const snap = roiGizmoSnapshotRef.current
        if (snap) {
          const roi = regionsRef.current.find(r => r.id === snap.roiId)
          if (roi) {
            updateRegionRef.current(snap.roiId, { vertices: roi.vertices })
            const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
            const cz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
            obj3d.position.set(cx, 0, cz)
            obj3d.rotation.set(0, 0, 0)
            roiGizmoSnapshotRef.current = {
              roiId: snap.roiId,
              vertices: roi.vertices.map(v => ({ ...v })),
              centroid: { x: cx, z: cz },
              startPos: new THREE.Vector3(cx, 0, cz),
              startRotY: 0,
            }
          }
        }
      } else if (obj3d?.userData?.objectId) {
        const objId = obj3d.userData.objectId
        const venueObj = objectsRef.current.find(o => o.id === objId)
        if (venueObj?.type === 'digital_display' && venueRef.current?.id) {
          const linkedScreen = doohScreensRef.current.find((s: { id: string; objectId?: string }) => s.objectId === objId)
          if (linkedScreen) {
            const position = { x: obj3d.position.x, y: 0, z: obj3d.position.z }
            fetch(`${API_BASE}/api/dooh/screens/${linkedScreen.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                position,
                yawDeg: obj3d.rotation.y * (180 / Math.PI)
              })
            }).then(() => {
              if (venueRef.current?.id) {
                fetchDoohScreensRef.current(venueRef.current.id)
              }
            }).catch(err => console.warn('Failed to sync DOOH screen from gizmo:', err))
          }
        }
      }
    })
    
    // Update object/ROI position when transform gizmo changes
    transformControls.addEventListener('objectChange', () => {
      const obj3d = transformControls.object
      if (!obj3d) return

      if (obj3d.userData.isRoiPivot) {
        const snap = roiGizmoSnapshotRef.current
        if (!snap) return
        const dx = obj3d.position.x - snap.startPos.x
        const dz = obj3d.position.z - snap.startPos.z
        const dRotY = obj3d.rotation.y - snap.startRotY
        const newVertices = applyRoiGizmoTransform(snap.vertices, snap.centroid, dx, dz, dRotY)
        updateRegionVerticesLocalRef.current(snap.roiId, newVertices)
        return
      }

      if (!obj3d.userData.objectId) return
      
      const objId = obj3d.userData.objectId
      // Keep Y at 0 for floor objects
      const position = { x: obj3d.position.x, y: 0, z: obj3d.position.z }
      const rotation = { x: 0, y: obj3d.rotation.y, z: 0 } // Only Y rotation matters for floor objects
      
      // Update via context (will trigger re-render)
      updateObjectRef.current(objId, { position, rotation })
      
      // Real-time DOOH FOV sync: update linked DOOH screen mesh when transform gizmo moves digital_display
      const venueObj = objectsRef.current.find(o => o.id === objId)
      if (venueObj?.type === 'digital_display') {
        const linkedScreen = doohScreensRef.current.find((s: { id: string; objectId?: string }) => s.objectId === objId)
        if (linkedScreen) {
          const doohGroup = doohMeshesRef.current.get(linkedScreen.id)
          if (doohGroup) {
            // Update DOOH group to match the new position and rotation (group is at screen position)
            doohGroup.position.set(obj3d.position.x, 0, obj3d.position.z)
            doohGroup.rotation.y = obj3d.rotation.y
          }
        }
      }
    })

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)
    ambientLightRef.current = ambientLight

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(5, 10, 5)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 50
    directionalLight.shadow.camera.left = -25
    directionalLight.shadow.camera.right = 25
    directionalLight.shadow.camera.top = 25
    directionalLight.shadow.camera.bottom = -25
    scene.add(directionalLight)
    directionalLightRef.current = directionalLight

    // Animation loop with visibility-based throttling to prevent memory leaks
    let animationFrameId: number | null = null
    let isTabVisible = true
    let lastJitterTime = 0
    const JITTER_INTERVAL = 100 // Throttle jitter to 10fps to reduce CPU usage
    
    const animate = () => {
      if (!isTabVisible) {
        // When tab is hidden, render at 1fps to save resources
        animationFrameId = window.setTimeout(() => {
          animationFrameId = requestAnimationFrame(animate)
        }, 1000) as unknown as number
        return
      }
      animationFrameId = requestAnimationFrame(animate)
      controls.update()

      // Animate point clouds at throttled rate for living shimmer (10fps instead of 60fps)
      const now = performance.now()
      if (now - lastJitterTime > JITTER_INTERVAL) {
        lastJitterTime = now
        trackMeshesRef.current.forEach((group) => {
          const pc = group.children[4]
          if (pc && pc.visible && pc instanceof THREE.Points) {
            jitterPointCloud(pc)
          }
        })
      }

      renderer.render(scene, camera)
      labelRenderer.render(scene, camera)

      if (axisSceneRef.current && axisCameraRef.current && axisRendererRef.current) {
        const dir = new THREE.Vector3()
        camera.getWorldDirection(dir)
        axisCameraRef.current.position.copy(dir).negate().multiplyScalar(4)
        axisCameraRef.current.lookAt(0, 0, 0)
        axisCameraRef.current.up.copy(camera.up)
        axisRendererRef.current.render(axisSceneRef.current, axisCameraRef.current)
      }
    }
    
    // Visibility change handler - pause rendering when tab is hidden
    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden
      if (isTabVisible && animationFrameId === null) {
        animate() // Resume animation when tab becomes visible
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    
    animate()

    // Expose screenshot capture function
    if (onCaptureReady) {
      const captureFn: CaptureScreenshotFn = ({
        targetX = 0,
        targetZ = 0,
        height = 25,
        fov = 50,
        width: capW = 800,
        imageHeight: capH = 450,
        zones,
        angleOffset = 0,
      }) => {
        try {
          // Save current state
          const savedPos = camera.position.clone()
          const savedTarget = controls.target.clone()
          const savedFov = camera.fov
          const savedAspect = camera.aspect

          // Temporarily add zone highlight meshes
          const tempMeshes: THREE.Object3D[] = []
          if (zones && zones.length > 0) {
            // Compute tight bounding box from zone vertices
            let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
            for (const zone of zones) {
              for (const v of zone.vertices) {
                if (v.x < minX) minX = v.x
                if (v.x > maxX) maxX = v.x
                if (v.z < minZ) minZ = v.z
                if (v.z > maxZ) maxZ = v.z
              }
            }
            if (isFinite(minX)) {
              // Override target to zone centroid
              targetX = (minX + maxX) / 2
              targetZ = (minZ + maxZ) / 2
              // Compute camera height to frame the zone with padding
              const spanX = maxX - minX
              const spanZ = maxZ - minZ
              const span = Math.max(spanX, spanZ, 3) * 1.6
              height = span / (2 * Math.tan((fov * Math.PI) / 360))
              height = Math.max(height, 5)
              height = Math.min(height, 40)
            }

            // Create colored overlay polygons for each zone
            for (const zone of zones) {
              if (zone.vertices.length < 3) continue
              const verts: number[] = []
              const idx: number[] = []
              for (const v of zone.vertices) verts.push(v.x, 0.15, v.z)
              for (let i = 1; i < zone.vertices.length - 1; i++) idx.push(0, i, i + 1)
              const geo = new THREE.BufferGeometry()
              geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
              geo.setIndex(idx)
              const c = new THREE.Color(zone.color)
              const mat = new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
              const mesh = new THREE.Mesh(geo, mat)
              mesh.renderOrder = 10
              scene.add(mesh)
              tempMeshes.push(mesh)

              // Bright outline
              const pts = zone.vertices.map(v => new THREE.Vector3(v.x, 0.16, v.z))
              pts.push(pts[0].clone())
              const lineGeo = new THREE.BufferGeometry().setFromPoints(pts)
              const lineMat = new THREE.LineBasicMaterial({ color: c, linewidth: 2 })
              const line = new THREE.Line(lineGeo, lineMat)
              line.renderOrder = 11
              scene.add(line)
              tempMeshes.push(line)
            }
          }

          // Temporarily add track position cylinders (frozen moment people)
          if (zones && zones.length > 0) {
            // Hide live tracks during capture to avoid overlap
            trackMeshesRef.current.forEach(g => { g.visible = false })
          }
          const trackOpts = (zones && zones.length > 0) ? options.trackPositions : undefined
          if (trackOpts && trackOpts.length > 0) {
            for (const tp of trackOpts) {
              const cylGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.7, 8)
              const cylMat = new THREE.MeshBasicMaterial({ color: tp.color ?? 0x3b82f6, transparent: true, opacity: 0.85 })
              const cyl = new THREE.Mesh(cylGeo, cylMat)
              cyl.position.set(tp.x, 0.85, tp.z)
              cyl.renderOrder = 12
              scene.add(cyl)
              tempMeshes.push(cyl)
            }
          }

          // Set up camera — slight angle offset for variety
          const offsetX = Math.sin(angleOffset) * height * 0.25
          const offsetZ = Math.cos(angleOffset) * height * 0.25
          camera.position.set(targetX + offsetX, height, targetZ + offsetZ)
          camera.fov = fov
          camera.aspect = capW / capH
          camera.updateProjectionMatrix()
          camera.lookAt(targetX, 0, targetZ)
          controls.target.set(targetX, 0, targetZ)

          // Render one frame at capture resolution
          const savedSize = new THREE.Vector2()
          renderer.getSize(savedSize)
          renderer.setSize(capW, capH, false)
          renderer.render(scene, camera)

          // Capture
          const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.75)

          // Clean up temp meshes
          for (const m of tempMeshes) {
            scene.remove(m)
            if (m instanceof THREE.Mesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
            if (m instanceof THREE.Line) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
          }

          // Restore live tracks visibility
          trackMeshesRef.current.forEach(g => { g.visible = true })

          // Restore everything
          renderer.setSize(savedSize.x, savedSize.y, false)
          camera.position.copy(savedPos)
          camera.fov = savedFov
          camera.aspect = savedAspect
          camera.updateProjectionMatrix()
          controls.target.copy(savedTarget)
          camera.lookAt(savedTarget)

          return dataUrl
        } catch (err) {
          console.warn('[MainViewport] Screenshot capture failed:', err)
          return null
        }
      }
      onCaptureReady(captureFn)
    }

    // Resize handler - triggered by both window resize and container size changes
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      labelRenderer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)
    
    // ResizeObserver to detect when container changes size (e.g., right panel opens)
    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(container)

    // Get mouse position in normalized device coordinates
    const getMouseNDC = (event: MouseEvent) => {
      // Use renderer's canvas rect for accurate coordinates
      const canvas = renderer.domElement
      const rect = canvas.getBoundingClientRect()
      return new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
    }

    // Get intersection point on the floor plane
    const getFloorIntersection = (mouse: THREE.Vector2): THREE.Vector3 | null => {
      raycasterRef.current.setFromCamera(mouse, camera)
      const target = new THREE.Vector3()
      const hit = raycasterRef.current.ray.intersectPlane(dragPlaneRef.current, target)
      return hit ? target : null
    }

    // Find hit object, lidar, or ROI
    type HitResult = 
      | { type: 'object', id: string, point: THREE.Vector3 }
      | { type: 'lidar', id: string, point: THREE.Vector3 }
      | { type: 'roi', id: string, point: THREE.Vector3 }
      | { type: 'roi-vertex', id: string, vertexIndex: number, point: THREE.Vector3 }
    const findHitObject = (mouse: THREE.Vector2): HitResult | null => {
      raycasterRef.current.setFromCamera(mouse, camera)

      // Check objects first - need to traverse into Groups for custom models
      const objectMeshes = Array.from(objectMeshesRef.current.values())
      const allObjectMeshes: THREE.Object3D[] = []
      objectMeshes.forEach(obj => {
        if (obj instanceof THREE.Group) {
          obj.traverse(child => {
            if (child instanceof THREE.Mesh) allObjectMeshes.push(child)
          })
        } else {
          allObjectMeshes.push(obj)
        }
      })
      const objectHits = raycasterRef.current.intersectObjects(allObjectMeshes)
      if (objectHits.length > 0) {
        // Find the objectId by traversing up the parent chain
        let current: THREE.Object3D | null = objectHits[0].object
        while (current) {
          if (current.userData.objectId) {
            return { type: 'object', id: current.userData.objectId, point: objectHits[0].point }
          }
          current = current.parent
        }
      }

      // Check LiDARs
      const lidarGroups = Array.from(lidarMeshesRef.current.values())
      const lidarMeshes = lidarGroups.flatMap(g => g.children.filter(c => c.userData.isLidar))
      const lidarHits = raycasterRef.current.intersectObjects(lidarMeshes)
      if (lidarHits.length > 0) {
        const hitMesh = lidarHits[0].object
        const id = hitMesh.userData.placementId
        if (id) return { type: 'lidar', id, point: lidarHits[0].point }
      }

      // Check ROI vertex handles (for dragging)
      const roiGroups = Array.from(roiMeshesRef.current.values())
      const vertexHandles = roiGroups.flatMap(g => g.children.filter(c => c.userData.isRoiVertex && c.visible))
      if (vertexHandles.length > 0) {
        const vertexHits = raycasterRef.current.intersectObjects(vertexHandles, true)
        if (vertexHits.length > 0) {
          const hitMesh = vertexHits[0].object
          return { 
            type: 'roi-vertex' as const, 
            id: hitMesh.userData.roiId, 
            vertexIndex: hitMesh.userData.vertexIndex,
            point: vertexHits[0].point 
          }
        }
      }

      // Check ROI polygons (for selection)
      const roiMeshes = roiGroups.flatMap(g => g.children.filter(c => c instanceof THREE.Mesh && c.userData.roiId && !c.userData.isRoiVertex))
      if (roiMeshes.length > 0) {
        const roiHits = raycasterRef.current.intersectObjects(roiMeshes, true)
        if (roiHits.length > 0) {
          const hitMesh = roiHits[0].object
          return { type: 'roi' as const, id: hitMesh.userData.roiId, point: roiHits[0].point }
        }
      }

      return null
    }

    // Mouse down - record position for drag threshold
    // Click to select objects, SHIFT+drag to move (or use transform gizmo)
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return // Only left click
      
      const mouse = getMouseNDC(event)
      
      // ROI drawing mode - add vertex on floor click
      if (isDrawingRef.current) {
        const floorPoint = getFloorIntersection(mouse)
        if (floorPoint) {
          addDrawingVertexRef.current({ x: floorPoint.x, z: floorPoint.z })
        }
        return // Don't process other click actions while drawing
      }
      
      // Check if clicking on an object
      const hit = findHitObject(mouse)
      
      if (hit) {
        // Store mouse down position for potential drag
        mouseDownPosRef.current = { x: event.clientX, y: event.clientY }
        
        // Store pending drag info - actual drag only starts with SHIFT or after using gizmo
        const vertexIndex = hit.type === 'roi-vertex' ? hit.vertexIndex : undefined
        pendingDragRef.current = { type: hit.type, id: hit.id, vertexIndex, hit, requiresShift: !event.shiftKey }
      } else {
        // Clicked on empty space
        mouseDownPosRef.current = { x: event.clientX, y: event.clientY }
        pendingDragRef.current = null
      }
    }
    
    // Start actual drag after threshold is crossed
    const startDrag = (mouse: THREE.Vector2) => {
      const pending = pendingDragRef.current
      if (!pending) return
      
      const hit = pending.hit
      
      // Handle ROI polygon - select and start dragging
      if (hit.type === 'roi') {
        selectRegionRef.current(hit.id)
        selectObjectRef.current(null)
        selectPlacementRef.current(null)
        
        isDraggingRef.current = true
        hasDragMovedRef.current = false
        draggedObjectRef.current = { type: 'roi', id: hit.id }
        controls.enabled = false
        
        // Calculate drag offset from centroid
        const floorPoint = getFloorIntersection(mouse)
        if (floorPoint) {
          const roi = regionsRef.current.find(r => r.id === hit.id)
          if (roi) {
            const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
            const cz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
            dragOffsetRef.current.set(cx - floorPoint.x, 0, cz - floorPoint.z)
          }
        }
        return
      }
      
      // Handle ROI vertex dragging
      if (hit.type === 'roi-vertex') {
        isDraggingRef.current = true
        hasDragMovedRef.current = false
        draggedObjectRef.current = { type: 'roi-vertex', id: hit.id, vertexIndex: hit.vertexIndex }
        controls.enabled = false
        return
      }
      
      // Select the object
      if (hit.type === 'object') {
        selectObjectRef.current(hit.id)
        selectPlacementRef.current(null)
        
        // If planogram layer is active and this is a shelf, select it for planogram display
        if (showPlanogramLayerRef.current) {
          const obj = objectsRef.current.find(o => o.id === hit.id)
          if (obj?.type === 'shelf') {
            setPlanogramSelectedShelfIdRef.current(hit.id)
          }
        }
      } else if (hit.type === 'lidar') {
        selectPlacementRef.current(hit.id)
        selectObjectRef.current(null)
      }
      selectRegionRef.current(null)

      // Start dragging
      isDraggingRef.current = true
      hasDragMovedRef.current = false
      draggedObjectRef.current = { type: hit.type, id: hit.id }
      controls.enabled = false // Disable orbit controls while dragging

      // Calculate drag offset
      const floorPoint = getFloorIntersection(mouse)
      if (floorPoint) {
        if (hit.type === 'object') {
          const obj = objectsRef.current.find(o => o.id === hit.id)
          if (obj) {
            dragOffsetRef.current.set(
              obj.position.x - floorPoint.x,
              0,
              obj.position.z - floorPoint.z
            )
          }
        } else if (hit.type === 'lidar') {
          const placement = placementsRef.current.find(p => p.id === hit.id)
          if (placement) {
            dragOffsetRef.current.set(
              placement.position.x - floorPoint.x,
              0,
              placement.position.z - floorPoint.z
            )
          }
        }
      }
    }

    // Track hovered LiDAR for tooltip
    let hoveredLidarId: string | null = null

    // Mouse move - drag object or show tooltip on hover
    const handleMouseMove = (event: MouseEvent) => {
      const mouse = getMouseNDC(event)

      // Check if we should start dragging (threshold crossed)
      if (mouseDownPosRef.current && pendingDragRef.current && !isDraggingRef.current) {
        const dx = event.clientX - mouseDownPosRef.current.x
        const dy = event.clientY - mouseDownPosRef.current.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        
        if (distance > DRAG_THRESHOLD_PX) {
          // ROI vertices can be dragged freely (precise intentional edit);
          // ROI polygons and objects/lidars require SHIFT to avoid hijacking orbit rotation
          const isVertex = pendingDragRef.current.type === 'roi-vertex'
          if (isVertex || !pendingDragRef.current.requiresShift) {
            startDrag(mouse)
          }
          pendingDragRef.current = null
        }
      }

      // Handle hover tooltip when not dragging
      if (!isDraggingRef.current) {
        // Check if hovering over a LiDAR
        const lidarGroups = Array.from(lidarMeshesRef.current.values())
        const lidarMeshes = lidarGroups.flatMap(g => g.children.filter(c => c.userData.isLidar))
        raycasterRef.current.setFromCamera(mouse, camera)
        const lidarHits = raycasterRef.current.intersectObjects(lidarMeshes)
        
        let newHoveredId: string | null = null
        if (lidarHits.length > 0) {
          newHoveredId = lidarHits[0].object.userData.placementId || null
        }

        // Update tooltip visibility if hover state changed
        if (newHoveredId !== hoveredLidarId) {
          // Hide previous tooltip (index 5 is label)
          if (hoveredLidarId) {
            const prevGroup = lidarMeshesRef.current.get(hoveredLidarId)
            if (prevGroup && prevGroup.children[5]) {
              prevGroup.children[5].visible = false
            }
          }
          // Show new tooltip
          if (newHoveredId) {
            const newGroup = lidarMeshesRef.current.get(newHoveredId)
            if (newGroup && newGroup.children[5]) {
              newGroup.children[5].visible = true
            }
          }
          hoveredLidarId = newHoveredId
        }
        
        // Check if hovering over an object (for debug tooltip)
        const objectMeshes = Array.from(objectMeshesRef.current.values())
        const allObjMeshes: THREE.Object3D[] = []
        objectMeshes.forEach(obj => {
          if (obj instanceof THREE.Group) {
            obj.traverse(child => { if (child instanceof THREE.Mesh) allObjMeshes.push(child) })
          } else {
            allObjMeshes.push(obj)
          }
        })
        const objHits = raycasterRef.current.intersectObjects(allObjMeshes)
        let hovObjId: string | null = null
        if (objHits.length > 0) {
          let cur: THREE.Object3D | null = objHits[0].object
          while (cur) {
            if (cur.userData.objectId) { hovObjId = cur.userData.objectId; break }
            cur = cur.parent
          }
        }
        if (hovObjId !== hoveredObjectIdRef.current) {
          hoveredObjectIdRef.current = hovObjId
          hoverObjectRef.current(hovObjId)
          if (hovObjId) {
            const obj = objectsRef.current.find(o => o.id === hovObjId)
            if (obj) {
              setHoveredObjectTooltip({
                name: obj.name || '(unnamed)',
                type: obj.type || 'custom',
                category: obj.metadata?.business_category_label || obj.metadata?.business_category || null,
                width: obj.scale?.x ?? 0,
                height: obj.scale?.y ?? 0,
                depth: obj.scale?.z ?? 0,
                posX: obj.position?.x ?? 0,
                posZ: obj.position?.z ?? 0,
                id: obj.id,
                mouseX: event.clientX,
                mouseY: event.clientY,
              })
            }
          } else {
            setHoveredObjectTooltip(null)
          }
        } else if (hovObjId && hoveredObjectIdRef.current) {
          // Update mouse position for existing tooltip
          setHoveredObjectTooltip(prev => prev ? { ...prev, mouseX: event.clientX, mouseY: event.clientY } : null)
        }
        
        // Planogram layer: check if hovering over the selected shelf to sync slot highlight
        if (showPlanogramLayerRef.current && planogramSelectedShelfIdRef.current && objHits.length > 0) {
          const hitObj = objHits[0]
          let hitObjId: string | null = null
          let cur: THREE.Object3D | null = hitObj.object
          while (cur) {
            if (cur.userData.objectId) { hitObjId = cur.userData.objectId; break }
            cur = cur.parent
          }
          
          if (hitObjId === planogramSelectedShelfIdRef.current) {
            // Calculate which slot column is being hovered (scanner laser effect)
            const shelf = objectsRef.current.find(o => o.id === hitObjId)
            if (shelf && activeShelfPlanogramRef.current) {
              const shelfWidth = shelf.scale?.x || 2.0
              const slotWidthM = activeShelfPlanogramRef.current.slotWidthM || 0.1
              const slotsPerLevel = Math.floor(shelfWidth / slotWidthM)
              
              // Calculate slot index based on world position relative to shelf center
              // Use shelf rotation to determine which axis to use
              const shelfRotY = shelf.rotation?.y || 0
              const shelfCenterX = shelf.position.x
              const shelfCenterZ = shelf.position.z
              const hitX = hitObj.point.x - shelfCenterX
              const hitZ = hitObj.point.z - shelfCenterZ
              
              // Rotate hit point by negative shelf rotation to get shelf-local X
              const cosR = Math.cos(-shelfRotY)
              const sinR = Math.sin(-shelfRotY)
              const localX = hitX * cosR - hitZ * sinR
              
              // Calculate normalized position (0 = left edge, 1 = right edge)
              const normalizedX = (localX + shelfWidth / 2) / shelfWidth
              const slotIndex = Math.min(Math.max(0, Math.floor(normalizedX * slotsPerLevel)), slotsPerLevel - 1)
              
              setPlanogramHoveredSlotIndexRef.current(slotIndex)
            }
          } else {
            // Not hovering over the selected shelf
            setPlanogramHoveredSlotIndexRef.current(null)
          }
        } else if (showPlanogramLayerRef.current && planogramSelectedShelfIdRef.current) {
          // Not hovering over any object
          setPlanogramHoveredSlotIndexRef.current(null)
        }

        // Check if hovering over an ROI zone
        const roiGroups = Array.from(roiMeshesRef.current.values())
        const roiMeshes = roiGroups.flatMap(g => g.children.filter(c => c instanceof THREE.Mesh && c.userData.roiId && !c.userData.isRoiVertex))
        const roiHits = raycasterRef.current.intersectObjects(roiMeshes, true)
        
        let newHoveredRoiId: string | null = null
        if (roiHits.length > 0) {
          newHoveredRoiId = roiHits[0].object.userData.roiId || null
        }
        
        // Update ROI label visibility if hover state changed
        if (newHoveredRoiId !== hoveredRoiIdRef.current) {
          // Hide previous ROI label
          if (hoveredRoiIdRef.current) {
            const prevGroup = roiMeshesRef.current.get(hoveredRoiIdRef.current)
            if (prevGroup) {
              for (const child of prevGroup.children) {
                if (child instanceof CSS2DObject && child.userData.roiId) {
                  (child.element as HTMLDivElement).style.opacity = '0'
                  break
                }
              }
            }
          }
          // Show new ROI label
          if (newHoveredRoiId) {
            const newGroup = roiMeshesRef.current.get(newHoveredRoiId)
            if (newGroup) {
              for (const child of newGroup.children) {
                if (child instanceof CSS2DObject && child.userData.roiId) {
                  (child.element as HTMLDivElement).style.opacity = '1'
                  break
                }
              }
            }
          }
          hoveredRoiIdRef.current = newHoveredRoiId
          // Notify context of hovered ROI change for KPI panel highlighting
          setHoveredRoiIdRef.current(newHoveredRoiId)
        }
        return
      }

      // Handle dragging
      if (!draggedObjectRef.current) return

      hasDragMovedRef.current = true

      const floorPoint = getFloorIntersection(mouse)
      if (!floorPoint) return

      const newX = floorPoint.x + dragOffsetRef.current.x
      const newZ = floorPoint.z + dragOffsetRef.current.z

      // Clamp to venue bounds
      const v = venueRef.current
      if (!v) return
      const clampedX = Math.max(0, Math.min(v.width, newX))
      const clampedZ = Math.max(0, Math.min(v.depth, newZ))

      // Update position (live preview without snapping)
      if (draggedObjectRef.current.type === 'object') {
        const mesh = objectMeshesRef.current.get(draggedObjectRef.current.id)
        if (mesh) {
          mesh.position.x = clampedX
          mesh.position.z = clampedZ
          
          // Real-time DOOH FOV sync: move linked DOOH screen mesh with the digital_display
          const obj = objectsRef.current.find(o => o.id === draggedObjectRef.current!.id)
          if (obj?.type === 'digital_display') {
            const linkedScreen = doohScreensRef.current.find((s: { id: string; objectId?: string }) => s.objectId === obj.id)
            if (linkedScreen) {
              const doohGroup = doohMeshesRef.current.get(linkedScreen.id)
              if (doohGroup) {
                // Set DOOH group position to match the screen (group is positioned at screen location)
                doohGroup.position.x = clampedX
                doohGroup.position.z = clampedZ
              }
            }
          }
        }
      } else if (draggedObjectRef.current.type === 'lidar') {
        const group = lidarMeshesRef.current.get(draggedObjectRef.current.id)
        if (group) {
          group.position.x = clampedX
          group.position.z = clampedZ
        }
      } else if (draggedObjectRef.current.type === 'roi-vertex') {
        // Update vertex handle position in real-time
        const roiId = draggedObjectRef.current.id
        const vertexIndex = draggedObjectRef.current.vertexIndex
        const handles = roiVertexHandlesRef.current.get(roiId)
        
        if (handles && vertexIndex !== undefined && handles[vertexIndex]) {
          handles[vertexIndex].position.set(clampedX, 0.15, clampedZ)
          
          // Also update the polygon shape and outline in real-time
          const group = roiMeshesRef.current.get(roiId)
          const roi = regionsRef.current.find(r => r.id === roiId)
          if (group && roi) {
            // Create updated vertices array
            const updatedVertices = roi.vertices.map((v, i) => 
              i === vertexIndex ? { x: clampedX, z: clampedZ } : v
            )
            
            // Update filled polygon (child 0) using BufferGeometry
            const mesh = group.children[0] as THREE.Mesh
            if (mesh && mesh.geometry) {
              mesh.geometry.dispose()
              
              const verts: number[] = []
              const inds: number[] = []
              for (const v of updatedVertices) {
                verts.push(v.x, 0.02, v.z)
              }
              for (let j = 1; j < updatedVertices.length - 1; j++) {
                inds.push(0, j, j + 1)
              }
              
              const newGeom = new THREE.BufferGeometry()
              newGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
              newGeom.setIndex(inds)
              newGeom.computeVertexNormals()
              mesh.geometry = newGeom
            }
            
            // Update outline (child 1)
            const outline = group.children[1] as THREE.Line
            if (outline && outline.geometry) {
              outline.geometry.dispose()
              const outlinePoints = updatedVertices.map(v => new THREE.Vector3(v.x, 0.03, v.z))
              outlinePoints.push(outlinePoints[0].clone())
              outline.geometry = new THREE.BufferGeometry().setFromPoints(outlinePoints)
            }
          }
        }
      } else if (draggedObjectRef.current.type === 'roi') {
        // Full polygon dragging - move entire zone
        const roiId = draggedObjectRef.current.id
        const group = roiMeshesRef.current.get(roiId)
        const roi = regionsRef.current.find(r => r.id === roiId)
        const handles = roiVertexHandlesRef.current.get(roiId)
        
        if (group && roi) {
          // Calculate new centroid
          const oldCx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
          const oldCz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
          const newCx = clampedX + dragOffsetRef.current.x
          const newCz = clampedZ + dragOffsetRef.current.z
          const dx = newCx - oldCx
          const dz = newCz - oldCz
          
          // Create updated vertices by shifting all by delta
          const updatedVertices = roi.vertices.map(v => ({
            x: v.x + dx,
            z: v.z + dz
          }))
          
          // Update filled polygon
          const mesh = group.children[0] as THREE.Mesh
          if (mesh && mesh.geometry) {
            mesh.geometry.dispose()
            const verts: number[] = []
            const inds: number[] = []
            for (const v of updatedVertices) {
              verts.push(v.x, 0.02, v.z)
            }
            for (let j = 1; j < updatedVertices.length - 1; j++) {
              inds.push(0, j, j + 1)
            }
            const newGeom = new THREE.BufferGeometry()
            newGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
            newGeom.setIndex(inds)
            newGeom.computeVertexNormals()
            mesh.geometry = newGeom
          }
          
          // Update outline
          const outline = group.children[1] as THREE.Line
          if (outline && outline.geometry) {
            outline.geometry.dispose()
            const outlinePoints = updatedVertices.map(v => new THREE.Vector3(v.x, 0.03, v.z))
            outlinePoints.push(outlinePoints[0].clone())
            outline.geometry = new THREE.BufferGeometry().setFromPoints(outlinePoints)
          }
          
          // Update vertex handles
          if (handles) {
            updatedVertices.forEach((v, i) => {
              if (handles[i]) {
                handles[i].position.set(v.x, 0.15, v.z)
              }
            })
          }
          
          // Update label position (last child)
          const label = group.children[group.children.length - 1]
          if (label) {
            label.position.set(newCx, 0.5, newCz)
          }
        }
      }
    }

    // Mouse up - end drag and snap to grid
    const handleMouseUp = (event: MouseEvent) => {
      // Clear object hover tooltip
      hoveredObjectIdRef.current = null
      hoverObjectRef.current(null)
      setHoveredObjectTooltip(null)
      // Handle click selection (no drag occurred - threshold not crossed)
      if (pendingDragRef.current && !isDraggingRef.current) {
        const pending = pendingDragRef.current
        // Select the object on click
        if (pending.type === 'object') {
          selectObjectRef.current(pending.id)
          selectPlacementRef.current(null)
          selectRegionRef.current(null)
          
          // If planogram layer is active and this is a shelf, select it for planogram display
          if (showPlanogramLayerRef.current) {
            const obj = objectsRef.current.find(o => o.id === pending.id)
            if (obj?.type === 'shelf') {
              setPlanogramSelectedShelfIdRef.current(pending.id)
            }
          }
        } else if (pending.type === 'lidar') {
          selectPlacementRef.current(pending.id)
          selectObjectRef.current(null)
          selectRegionRef.current(null)
        } else if (pending.type === 'roi' || pending.type === 'roi-vertex') {
          selectRegionRef.current(pending.id)
          selectObjectRef.current(null)
          selectPlacementRef.current(null)
        }
      } else if (!pendingDragRef.current && !isDraggingRef.current && mouseDownPosRef.current) {
        // Clicked on empty space - deselect all
        selectObjectRef.current(null)
        selectPlacementRef.current(null)
        selectRegionRef.current(null)
      }
      
      // Clear pending drag state
      mouseDownPosRef.current = null
      pendingDragRef.current = null
      
      if (!isDraggingRef.current || !draggedObjectRef.current) {
        isDraggingRef.current = false
        draggedObjectRef.current = null
        return
      }

      controls.enabled = true // Re-enable orbit controls

      // Only update position if the mouse actually moved (not just a click)
      if (hasDragMovedRef.current) {
        const mouse = getMouseNDC(event)
        const floorPoint = getFloorIntersection(mouse)
        
        if (floorPoint) {
          let newX = floorPoint.x + dragOffsetRef.current.x
          let newZ = floorPoint.z + dragOffsetRef.current.z

          // Clamp to venue bounds
          const v = venueRef.current
          if (v) {
            newX = Math.max(0, Math.min(v.width, newX))
            newZ = Math.max(0, Math.min(v.depth, newZ))

            // Magnetic snap to same-type neighbors (objects only)
            if (draggedObjectRef.current.type === 'object') {
              const draggedObj = objectsRef.current.find(o => o.id === draggedObjectRef.current!.id)
              if (draggedObj) {
                const sameTypeObjects = objectsRef.current.filter(
                  o => o.id !== draggedObj.id && o.type === draggedObj.type
                )
                
                // Get dragged object dimensions (half-sizes for edge calculation)
                const draggedHalfW = draggedObj.scale.x / 2
                const draggedHalfD = draggedObj.scale.z / 2
                
                let snappedX = newX
                let snappedZ = newZ
                let minDistX = SNAP_THRESHOLD
                let minDistZ = SNAP_THRESHOLD
                
                for (const neighbor of sameTypeObjects) {
                  const neighborHalfW = neighbor.scale.x / 2
                  const neighborHalfD = neighbor.scale.z / 2
                  
                  // Check X-axis alignment (snap left/right edges)
                  // Dragged right edge to neighbor left edge
                  const rightToLeft = Math.abs((newX + draggedHalfW) - (neighbor.position.x - neighborHalfW))
                  if (rightToLeft < minDistX && Math.abs(newZ - neighbor.position.z) < (draggedHalfD + neighborHalfD + SNAP_THRESHOLD)) {
                    snappedX = neighbor.position.x - neighborHalfW - draggedHalfW
                    minDistX = rightToLeft
                  }
                  // Dragged left edge to neighbor right edge
                  const leftToRight = Math.abs((newX - draggedHalfW) - (neighbor.position.x + neighborHalfW))
                  if (leftToRight < minDistX && Math.abs(newZ - neighbor.position.z) < (draggedHalfD + neighborHalfD + SNAP_THRESHOLD)) {
                    snappedX = neighbor.position.x + neighborHalfW + draggedHalfW
                    minDistX = leftToRight
                  }
                  
                  // Check Z-axis alignment (snap front/back edges)
                  // Dragged back edge to neighbor front edge
                  const backToFront = Math.abs((newZ + draggedHalfD) - (neighbor.position.z - neighborHalfD))
                  if (backToFront < minDistZ && Math.abs(newX - neighbor.position.x) < (draggedHalfW + neighborHalfW + SNAP_THRESHOLD)) {
                    snappedZ = neighbor.position.z - neighborHalfD - draggedHalfD
                    minDistZ = backToFront
                  }
                  // Dragged front edge to neighbor back edge
                  const frontToBack = Math.abs((newZ - draggedHalfD) - (neighbor.position.z + neighborHalfD))
                  if (frontToBack < minDistZ && Math.abs(newX - neighbor.position.x) < (draggedHalfW + neighborHalfW + SNAP_THRESHOLD)) {
                    snappedZ = neighbor.position.z + neighborHalfD + draggedHalfD
                    minDistZ = frontToBack
                  }
                  
                  // Also snap to align centers when edges are touching
                  if (minDistX < SNAP_THRESHOLD || minDistZ < SNAP_THRESHOLD) {
                    // If X is snapped, also align Z if close
                    if (minDistX < SNAP_THRESHOLD && Math.abs(newZ - neighbor.position.z) < SNAP_THRESHOLD) {
                      snappedZ = neighbor.position.z
                    }
                    // If Z is snapped, also align X if close
                    if (minDistZ < SNAP_THRESHOLD && Math.abs(newX - neighbor.position.x) < SNAP_THRESHOLD) {
                      snappedX = neighbor.position.x
                    }
                  }
                }
                
                newX = snappedX
                newZ = snappedZ
                
                // Collision prevention - push objects apart if overlapping
                for (const neighbor of sameTypeObjects) {
                  const neighborHalfW = neighbor.scale.x / 2
                  const neighborHalfD = neighbor.scale.z / 2
                  
                  // Check if objects would overlap
                  const overlapX = (draggedHalfW + neighborHalfW) - Math.abs(newX - neighbor.position.x)
                  const overlapZ = (draggedHalfD + neighborHalfD) - Math.abs(newZ - neighbor.position.z)
                  
                  if (overlapX > 0 && overlapZ > 0) {
                    // Objects overlap - push apart along the axis with smaller overlap
                    if (overlapX < overlapZ) {
                      // Push along X
                      if (newX < neighbor.position.x) {
                        newX = neighbor.position.x - neighborHalfW - draggedHalfW
                      } else {
                        newX = neighbor.position.x + neighborHalfW + draggedHalfW
                      }
                    } else {
                      // Push along Z
                      if (newZ < neighbor.position.z) {
                        newZ = neighbor.position.z - neighborHalfD - draggedHalfD
                      } else {
                        newZ = neighbor.position.z + neighborHalfD + draggedHalfD
                      }
                    }
                  }
                }
              }
            }

            // Snap to grid and update state
            const snapped = snapToGridRef.current({ x: newX, y: 0, z: newZ })

            if (draggedObjectRef.current.type === 'object') {
              const objId = draggedObjectRef.current.id
              updateObjectRef.current(objId, {
                position: snapped
              })
              
              // If it's a digital_display, sync DOOH screen position
              const obj = objectsRef.current.find(o => o.id === objId)
              if (obj?.type === 'digital_display' && venueRef.current?.id) {
                // Find linked DOOH screen and update its position
                const linkedScreen = doohScreensRef.current.find((s: { id: string; objectId?: string }) => s.objectId === objId)
                if (linkedScreen) {
                  fetch(`${API_BASE}/api/dooh/screens/${linkedScreen.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      position: snapped,
                      yawDeg: (obj.rotation?.y || 0) * (180 / Math.PI)
                    })
                  }).then(() => {
                    // Re-fetch DOOH screens to update SEZ polygons
                    if (venueRef.current?.id) {
                      fetchDoohScreensRef.current(venueRef.current.id)
                    }
                  }).catch(err => console.warn('Failed to sync DOOH screen position:', err))
                }
              }
            } else if (draggedObjectRef.current.type === 'lidar') {
              updatePlacementRef.current(draggedObjectRef.current.id, {
                position: snapped
              })
            } else if (draggedObjectRef.current.type === 'roi-vertex') {
              // Save ROI vertex position
              const vertexIndex = draggedObjectRef.current.vertexIndex
              if (vertexIndex !== undefined) {
                updateVertexPositionRef.current(
                  draggedObjectRef.current.id,
                  vertexIndex,
                  { x: newX, z: newZ }
                )
              }
            } else if (draggedObjectRef.current.type === 'roi') {
              // Save all ROI vertices after full polygon drag
              const roiId = draggedObjectRef.current.id
              const roi = regionsRef.current.find(r => r.id === roiId)
              if (roi) {
                const oldCx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
                const oldCz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
                const newCx = newX + dragOffsetRef.current.x
                const newCz = newZ + dragOffsetRef.current.z
                const dx = newCx - oldCx
                const dz = newCz - oldCz
                
                const newVertices = roi.vertices.map(v => ({
                  x: v.x + dx,
                  z: v.z + dz
                }))
                
                updateRegionRef.current(roiId, { vertices: newVertices })
              }
            }
          }
        }
      }

      isDraggingRef.current = false
      hasDragMovedRef.current = false
      draggedObjectRef.current = null
    }

    // Right click - rotate 45 degrees
    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      
      const mouse = getMouseNDC(event)
      const hit = findHitObject(mouse)

      if (hit) {
        const rotationStep = Math.PI / 4 // 45 degrees

        if (hit.type === 'object') {
          const obj = objectsRef.current.find(o => o.id === hit.id)
          if (obj) {
            selectObjectRef.current(hit.id)
            selectPlacementRef.current(null)
            const newRotationY = obj.rotation.y + rotationStep
            updateObjectRef.current(hit.id, {
              rotation: { ...obj.rotation, y: newRotationY }
            })
            
            // If it's a digital_display, sync DOOH screen rotation
            if (obj.type === 'digital_display' && venueRef.current?.id) {
              const linkedScreen = doohScreensRef.current.find((s: { id: string; objectId?: string }) => s.objectId === hit.id)
              if (linkedScreen) {
                // Real-time visual rotation of DOOH FOV mesh (group is at screen position, just rotate it)
                const doohGroup = doohMeshesRef.current.get(linkedScreen.id)
                if (doohGroup) {
                  doohGroup.rotation.y = newRotationY
                }
                
                // Also sync to backend (will trigger full refresh with correct SEZ polygon)
                fetch(`${API_BASE}/api/dooh/screens/${linkedScreen.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    yawDeg: newRotationY * (180 / Math.PI)
                  })
                }).then(() => {
                  if (venueRef.current?.id) {
                    fetchDoohScreensRef.current(venueRef.current.id)
                  }
                }).catch(err => console.warn('Failed to sync DOOH screen rotation:', err))
              }
            }
          }
        } else if (hit.type === 'lidar') {
          const placement = placementsRef.current.find(p => p.id === hit.id)
          if (placement) {
            selectPlacementRef.current(hit.id)
            selectObjectRef.current(null)
            updatePlacementRef.current(hit.id, {
              rotation: { ...placement.rotation, y: placement.rotation.y + rotationStep }
            })
          }
        } else if (hit.type === 'roi') {
          // Rotate ROI polygon around its centroid
          const roi = regionsRef.current.find(r => r.id === hit.id)
          if (roi && roi.vertices.length >= 3) {
            selectRegionRef.current(hit.id)
            
            // Calculate centroid
            const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
            const cz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
            
            // Rotate all vertices around centroid
            const cos = Math.cos(rotationStep)
            const sin = Math.sin(rotationStep)
            const newVertices = roi.vertices.map(v => {
              const dx = v.x - cx
              const dz = v.z - cz
              return {
                x: cx + dx * cos - dz * sin,
                z: cz + dx * sin + dz * cos
              }
            })
            
            // Update ROI with rotated vertices
            updateRegionRef.current(hit.id, { vertices: newVertices })
          }
        }
      }
    }

    // Keyboard handler - Delete key removes selected object/lidar/roi, Escape cancels drawing
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if typing in input field
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return
      }
      
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Prevent browser back navigation on Backspace
        event.preventDefault()
        const selectedIds = Array.from(selectedObjectIdsRef.current)
        if (selectedIds.length > 1) {
          removeObjectsRef.current(selectedIds)
        } else if (selectedObjectIdRef.current) {
          removeObjectRef.current(selectedObjectIdRef.current)
          selectObjectRef.current(null)
        } else if (selectedPlacementIdRef.current) {
          removePlacementRef.current(selectedPlacementIdRef.current)
          selectPlacementRef.current(null)
        } else if (selectedRoiIdRef.current) {
          deleteRegionRef.current(selectedRoiIdRef.current)
          selectRegionRef.current(null)
        }
      }
      
      // Transform mode shortcuts (when object or ROI is selected)
      if ((selectedObjectIdRef.current || selectedRoiIdRef.current) && transformControlsRef.current) {
        if (event.key === 'g' || event.key === 'G') {
          event.preventDefault()
          event.stopPropagation()
          setTransformMode('translate')
          configureTransformControlsMode(transformControlsRef.current, 'translate')
        } else if (event.key === 'r') {
          event.preventDefault()
          event.stopPropagation()
          if (controlsRef.current) {
            controlsRef.current.enabled = false
            setTimeout(() => {
              if (controlsRef.current) controlsRef.current.enabled = true
            }, 100)
          }
          setTransformMode('rotate')
          configureTransformControlsMode(transformControlsRef.current, 'rotate')
        }
      }
      
      // Escape to deselect
      if (event.key === 'Escape') {
        selectObjectRef.current(null)
        selectPlacementRef.current(null)
        selectRegionRef.current(null)
      }
      
      // Copy (Cmd+C / Ctrl+C)
      if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
        if (selectedObjectIdRef.current) {
          event.preventDefault()
          copySelectedObjectsRef.current()
        }
      }
      
      // Paste (Cmd+V / Ctrl+V)
      if ((event.metaKey || event.ctrlKey) && event.key === 'v') {
        event.preventDefault()
        pasteObjectsRef.current()
      }
    }

    // Double-click handler - Open KPI popup for zones
    const handleDoubleClick = (event: MouseEvent) => {
      if (event.button !== 0) return // Only left click
      if (isDrawingRef.current) return // Don't process while drawing
      
      const mouse = getMouseNDC(event)
      const hit = findHitObject(mouse)
      
      if (hit && hit.type === 'roi') {
        // Open KPI popup for the zone
        openKPIPopupRef.current(hit.id)
      }
    }

    container.addEventListener('mousedown', handleMouseDown)
    container.addEventListener('dblclick', handleDoubleClick)
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseup', handleMouseUp)
    container.addEventListener('mouseleave', handleMouseUp)
    container.addEventListener('contextmenu', handleContextMenu)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      // Cancel animation frame to stop rendering loop
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }
      if (axisRendererRef.current) {
        axisRendererRef.current.dispose()
        axisRendererRef.current = null
      }
      
      // Remove event listeners
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('mousedown', handleMouseDown)
      container.removeEventListener('dblclick', handleDoubleClick)
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseup', handleMouseUp)
      container.removeEventListener('mouseleave', handleMouseUp)
      container.removeEventListener('contextmenu', handleContextMenu)
      resizeObserver.disconnect()
      
      // Dispose all track meshes and their textures
      trackMeshesRef.current.forEach((group, key) => {
        scene.remove(group)
        group.traverse(child => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => {
                if (m.map) m.map.dispose()
                m.dispose()
              })
            } else {
              if ((child.material as any).map) (child.material as any).map.dispose()
              child.material.dispose()
            }
          }
          if (child instanceof THREE.Sprite) {
            const mat = child.material as THREE.SpriteMaterial
            if (mat.map) mat.map.dispose()
            mat.dispose()
          }
        })
        // Remove trail via ref (no scene search)
        const trail = trailLinesRef.current.get(key)
        if (trail) {
          scene.remove(trail)
          trail.geometry.dispose()
          ;(trail.material as THREE.Material).dispose()
        }
      })
      trackMeshesRef.current.clear()
      trailLinesRef.current.clear()
      sezEntryTimesRef.current.clear()
      
      // Dispose loaded models cache
      loadedModelsRef.current.forEach(model => {
        model.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
      })
      loadedModelsRef.current.clear()
      
      // Dispose transform controls
      if (transformControlsRef.current) {
        transformControlsRef.current.detach()
        scene.remove(transformControlsRef.current)
        transformControlsRef.current.dispose()
        transformControlsRef.current = null
      }
      
      // Dispose renderer and remove DOM elements
      renderer.dispose()
      renderer.forceContextLoss()
      container.removeChild(renderer.domElement)
      container.removeChild(labelRenderer.domElement)
    }
  }, [])

  // Attach/detach transform controls when selected object or ROI changes
  useEffect(() => {
    const tc = transformControlsRef.current
    const pivot = roiTransformPivotRef.current
    if (!tc || !pivot) return
    
    if (selectedObjectId) {
      const mesh = objectMeshesRef.current.get(selectedObjectId)
      if (mesh) {
        tc.attach(mesh)
        tc.visible = true
        configureTransformControlsMode(tc, transformMode)
      } else {
        tc.detach()
        tc.visible = false
      }
      roiGizmoSnapshotRef.current = null
    } else if (selectedRoiId) {
      const roi = regionsRef.current.find(r => r.id === selectedRoiId)
      if (roi && roi.vertices.length >= 3) {
        const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
        const cz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
        pivot.position.set(cx, 0, cz)
        pivot.rotation.set(0, 0, 0)
        roiGizmoSnapshotRef.current = {
          roiId: selectedRoiId,
          vertices: roi.vertices.map(v => ({ ...v })),
          centroid: { x: cx, z: cz },
          startPos: new THREE.Vector3(cx, 0, cz),
          startRotY: 0,
        }
        tc.attach(pivot)
        tc.visible = true
        configureTransformControlsMode(tc, transformMode)
      } else {
        tc.detach()
        tc.visible = false
        roiGizmoSnapshotRef.current = null
      }
    } else {
      tc.detach()
      tc.visible = false
      roiGizmoSnapshotRef.current = null
    }
  }, [selectedObjectId, selectedRoiId, transformMode])
  
  // Update transform mode when it changes
  useEffect(() => {
    const tc = transformControlsRef.current
    if (tc && tc.object) {
      configureTransformControlsMode(tc, transformMode)
    }
  }, [transformMode])
  
  // Auto-zoom and highlight newly added objects
  useEffect(() => {
    const handleObjectAdded = (event: CustomEvent<{ objectId: string; position: { x: number; z: number }; scale: { x: number; y: number; z: number } }>) => {
      const { position, scale } = event.detail
      const camera = cameraRef.current
      const controls = controlsRef.current
      const scene = sceneRef.current
      
      if (!camera || !controls || !scene) return
      
      // Calculate optimal camera distance based on object size
      const objectSize = Math.max(scale.x, scale.z, 2)
      const cameraDistance = objectSize * 4
      const cameraHeight = objectSize * 3
      
      // Smoothly animate camera to focus on the new object
      const targetX = position.x
      const targetZ = position.z
      
      // Animate camera position
      const startPos = camera.position.clone()
      const startTarget = controls.target.clone()
      const endPos = new THREE.Vector3(targetX + cameraDistance * 0.7, cameraHeight, targetZ + cameraDistance * 0.7)
      const endTarget = new THREE.Vector3(targetX, scale.y / 2, targetZ)
      
      let progress = 0
      const duration = 600 // ms
      const startTime = performance.now()
      
      const animateCamera = () => {
        progress = Math.min(1, (performance.now() - startTime) / duration)
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3)
        
        camera.position.lerpVectors(startPos, endPos, eased)
        controls.target.lerpVectors(startTarget, endTarget, eased)
        controls.update()
        
        if (progress < 1) {
          requestAnimationFrame(animateCamera)
        }
      }
      animateCamera()
      
      // Add pulsing highlight ring around the new object
      const highlightRing = new THREE.Mesh(
        new THREE.RingGeometry(objectSize * 0.8, objectSize * 1.2, 32),
        new THREE.MeshBasicMaterial({ 
          color: 0x22c55e, 
          transparent: true, 
          opacity: 0.8,
          side: THREE.DoubleSide,
          depthWrite: false
        })
      )
      highlightRing.rotation.x = -Math.PI / 2
      highlightRing.position.set(position.x, 0.05, position.z)
      highlightRing.userData.isHighlight = true
      scene.add(highlightRing)
      
      // Animate the highlight ring (pulse and fade out)
      let ringProgress = 0
      const ringDuration = 2000 // 2 seconds
      const ringStartTime = performance.now()
      
      const animateRing = () => {
        ringProgress = (performance.now() - ringStartTime) / ringDuration
        
        if (ringProgress >= 1) {
          scene.remove(highlightRing)
          highlightRing.geometry.dispose()
          ;(highlightRing.material as THREE.Material).dispose()
          return
        }
        
        // Pulse scale
        const pulse = 1 + Math.sin(ringProgress * Math.PI * 4) * 0.2
        highlightRing.scale.set(pulse, pulse, pulse)
        
        // Fade out in last 30%
        if (ringProgress > 0.7) {
          const fadeProgress = (ringProgress - 0.7) / 0.3
          ;(highlightRing.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - fadeProgress)
        }
        
        requestAnimationFrame(animateRing)
      }
      animateRing()
    }
    
    window.addEventListener('venue-object-added', handleObjectAdded as EventListener)
    return () => window.removeEventListener('venue-object-added', handleObjectAdded as EventListener)
  }, [])

  // Compute effective scene bounds for DWG venues (shared by grid/floor + camera presets)
  const dwgSceneBounds = useMemo(() => {
    if (!venue) return null
    const isDwg = venue.scene_source === 'dwg' || !!venue.dwg_layout_version_id
    if (!isDwg) return null

    const vw = venue.width || 50
    const vd = venue.depth || 50
    // Sanity limit: no coordinate should exceed 2× venue dimensions
    const saneLimit = Math.max(vw, vd) * 2

    // Priority 1: Percentile-based object bounds (most reliable — direct from bootstrap)
    if (objects.length > 5) {
      const inBounds = objects.filter(o =>
        o.position.x >= -saneLimit && o.position.x <= saneLimit &&
        o.position.z >= -saneLimit && o.position.z <= saneLimit
      )
      if (inBounds.length > 5) {
        const sortedX = inBounds.map(o => o.position.x).sort((a, b) => a - b)
        const sortedZ = inBounds.map(o => o.position.z).sort((a, b) => a - b)
        const p10 = Math.floor(inBounds.length * 0.10)
        const p90 = Math.floor(inBounds.length * 0.90)
        const oMinX = sortedX[p10], oMaxX = sortedX[p90]
        const oMinZ = sortedZ[p10], oMaxZ = sortedZ[p90]
        const objW = oMaxX - oMinX
        const objD = oMaxZ - oMinZ
        return {
          centerX: (oMinX + oMaxX) / 2,
          centerZ: (oMinZ + oMaxZ) / 2,
          floorW: Math.max(objW, 5),
          floorD: Math.max(objD, 5),
          source: 'objects-p10-p90',
        }
      }
    }

    // Priority 2: ROI bounds with sanity filter (ROIs can have corrupted coordinates)
    if (regions.length > 0) {
      const saneVertices: { x: number; z: number }[] = []
      regions.forEach(roi => {
        roi.vertices.forEach(v => {
          if (Math.abs(v.x) <= saneLimit && Math.abs(v.z) <= saneLimit) {
            saneVertices.push(v)
          }
        })
      })
      if (saneVertices.length > 2) {
        const roiMinX = Math.min(...saneVertices.map(v => v.x))
        const roiMaxX = Math.max(...saneVertices.map(v => v.x))
        const roiMinZ = Math.min(...saneVertices.map(v => v.z))
        const roiMaxZ = Math.max(...saneVertices.map(v => v.z))
        const roiW = roiMaxX - roiMinX
        const roiD = roiMaxZ - roiMinZ
        return {
          centerX: (roiMinX + roiMaxX) / 2,
          centerZ: (roiMinZ + roiMaxZ) / 2,
          floorW: Math.max(roiW, 5),
          floorD: Math.max(roiD, 5),
          source: 'roi-sane',
        }
      }
    }

    // Fallback: use venue dimensions (capped at 200m)
    return {
      centerX: Math.min(vw, 200) / 2,
      centerZ: Math.min(vd, 200) / 2,
      floorW: Math.min(vw, 200),
      floorD: Math.min(vd, 200),
      source: 'capped',
    }
  }, [venue, regions, objects])

  // Update grid and floor when venue changes
  useEffect(() => {
    if (!sceneRef.current || !venue) return
    const scene = sceneRef.current

    // Remove old grid and floor
    if (gridRef.current) scene.remove(gridRef.current)
    if (floorRef.current) scene.remove(floorRef.current)

    // For DWG venues, use content-based bounds; for manual venues, use full dimensions
    let floorW = venue.width
    let floorD = venue.depth
    let centerX = venue.width / 2
    let centerZ = venue.depth / 2

    if (dwgSceneBounds) {
      floorW = dwgSceneBounds.floorW
      floorD = dwgSceneBounds.floorD
      centerX = dwgSceneBounds.centerX
      centerZ = dwgSceneBounds.centerZ
      console.log(`[MainViewport] DWG venue — ${dwgSceneBounds.source}: floor ${floorW.toFixed(1)}×${floorD.toFixed(1)}m, center (${centerX.toFixed(1)}, ${centerZ.toFixed(1)})`)
    }

    const extentMultiplier = venue.gridExtentMultiplier ?? 1.2
    floorW *= extentMultiplier
    floorD *= extentMultiplier

    // Create grid. Use readable meter-based cells and make the grid/floor at
    // least the configured amount larger than the DWG/ROI footprint.
    const gridSize = Math.max(floorW, floorD)
    const cellSize = gridSize > 120 ? 5 : gridSize > 60 ? 2 : 1
    const divisions = Math.max(1, Math.ceil(gridSize / cellSize))
    const grid = new THREE.GridHelper(gridSize, divisions, COLORS.gridCenter, COLORS.grid)
    const gridOpacity = venue.gridOpacity ?? 0.35
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material]
    gridMaterials.forEach(mat => {
      mat.transparent = true
      mat.opacity = gridOpacity
      mat.depthWrite = false
    })
    grid.position.set(centerX, 0.01, centerZ)
    scene.add(grid)
    gridRef.current = grid

    // Create floor matching the padded grid area.
    const floorGeometry = new THREE.PlaneGeometry(floorW, floorD)
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: COLORS.floor,
      roughness: 0.9,
      metalness: 0.1,
      transparent: true,
      opacity: Math.min(0.9, Math.max(0.15, gridOpacity + 0.15)),
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(centerX, 0, centerZ)
    floor.receiveShadow = true
    scene.add(floor)
    floorRef.current = floor

    // Camera — only set on first render, NOT on object changes
    // (dwgSceneBounds depends on objects, so this would reset camera during drag)
  }, [venue?.width, venue?.depth, venue?.tileSize, venue?.scene_source, venue?.dwg_layout_version_id, venue?.gridExtentMultiplier, venue?.gridOpacity, dwgSceneBounds])

  // Reset camera initialized flag when venue changes
  useEffect(() => {
    cameraInitializedRef.current = false
  }, [venue?.id])
  
  // Listen for camera reset event (e.g., when LaunchPad closes)
  useEffect(() => {
    const handleCameraReset = () => {
      console.log('[MainViewport] Camera reset event received')
      cameraInitializedRef.current = false
      // Trigger re-initialization by forcing a re-render
      if (controlsRef.current && cameraRef.current && venue && dwgSceneBounds) {
        const { floorW, floorD, centerX, centerZ } = dwgSceneBounds
        const viewSize = Math.max(floorW, floorD)
        cameraRef.current.position.set(
          centerX + viewSize * 0.8,
          viewSize * 0.7,
          centerZ + viewSize * 0.8
        )
        controlsRef.current.target.set(centerX, 0, centerZ)
        controlsRef.current.update()
        cameraInitializedRef.current = true
      } else if (controlsRef.current && cameraRef.current && venue) {
        const viewSize = Math.max(venue.width, venue.depth)
        const centerX = venue.width / 2
        const centerZ = venue.depth / 2
        cameraRef.current.position.set(
          centerX + viewSize * 0.8,
          viewSize * 0.7,
          centerZ + viewSize * 0.8
        )
        controlsRef.current.target.set(centerX, 0, centerZ)
        controlsRef.current.update()
        cameraInitializedRef.current = true
      }
    }
    window.addEventListener('mainviewport-reset-camera', handleCameraReset)
    return () => window.removeEventListener('mainviewport-reset-camera', handleCameraReset)
  }, [venue, dwgSceneBounds])
  
  // Initial camera positioning - only runs ONCE per venue.
  // If a saved view exists in localStorage, restore it instead of the default.
  useEffect(() => {
    if (!controlsRef.current || !cameraRef.current || !venue) return
    if (cameraInitializedRef.current) return
    if (isGizmoActiveRef.current) return

    const storageKey = `venue-camera-view-${venue.id || 'default'}`
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try {
        const v = JSON.parse(saved)
        cameraRef.current.position.fromArray(v.position)
        controlsRef.current.target.fromArray(v.target)
        if (v.zoom) cameraRef.current.zoom = v.zoom
        cameraRef.current.updateProjectionMatrix()
        controlsRef.current.update()
        cameraInitializedRef.current = true
        console.log('[MainViewport] Restored saved camera view')
        return
      } catch { /* fall through to default */ }
    }

    let floorW = venue.width
    let floorD = venue.depth
    let centerX = venue.width / 2
    let centerZ = venue.depth / 2

    if (dwgSceneBounds) {
      floorW = dwgSceneBounds.floorW
      floorD = dwgSceneBounds.floorD
      centerX = dwgSceneBounds.centerX
      centerZ = dwgSceneBounds.centerZ
    }
    
    const viewSize = Math.max(floorW, floorD)
    cameraRef.current.position.set(
      centerX + viewSize * 0.8,
      viewSize * 0.7,
      centerZ + viewSize * 0.8
    )
    controlsRef.current.target.set(centerX, 0, centerZ)
    controlsRef.current.update()
    
    cameraInitializedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id])

  // 3D Logo Billboard on back wall
  useEffect(() => {
    if (!sceneRef.current || !venue) return
    const scene = sceneRef.current
    
    // Remove old logo billboard
    if (logoBillboardRef.current) {
      scene.remove(logoBillboardRef.current)
      logoBillboardRef.current.geometry.dispose()
      ;(logoBillboardRef.current.material as THREE.Material).dispose()
      logoBillboardRef.current = null
    }
    
    // Fetch white label settings and create logo above entrance
    const createLogoBillboard = async () => {
      try {
        // Find entrance object
        const entranceObject = objects.find(obj => obj.type === 'entrance')
        if (!entranceObject) {
          // No entrance, don't show logo
          return
        }
        
        const res = await fetch(`${API_BASE}/api/venues/${venue.id}/white-label`)
        if (!res.ok) return
        
        const settings = await res.json()
        if (!settings.logoUrl) return
        
        // Load logo texture
        const texture = await new Promise<THREE.Texture>((resolve, reject) => {
          textureLoaderRef.current.load(
            `${API_BASE}${settings.logoUrl}`,
            resolve,
            undefined,
            reject
          )
        })
        
        // Calculate billboard dimensions (width from settings, height proportional)
        const logoWidth = (settings.logoWidth || 200) / 50 // Convert px to meters (200px = 4m)
        const aspectRatio = texture.image.width / texture.image.height
        const logoHeight = logoWidth / aspectRatio
        
        // Create billboard mesh
        const geometry = new THREE.PlaneGeometry(logoWidth, logoHeight)
        const material = new THREE.MeshBasicMaterial({
          map: texture,
          transparent: true,
          opacity: settings.logoOpacity || 1,
          side: THREE.DoubleSide,
        })
        
        const billboard = new THREE.Mesh(geometry, material)
        
        // Position above the entrance object
        billboard.position.set(
          entranceObject.position.x,   // X position of entrance
          venue.height + logoHeight / 2 + 0.5, // Same height as before (above venue height)
          entranceObject.position.z    // Z position of entrance
        )
        
        scene.add(billboard)
        logoBillboardRef.current = billboard
      } catch (err) {
        console.error('Failed to create logo billboard:', err)
      }
    }
    
    createLogoBillboard()
    
    // Listen for white label updates
    const handleUpdate = () => createLogoBillboard()
    window.addEventListener('whiteLabelUpdated', handleUpdate)
    
    return () => {
      window.removeEventListener('whiteLabelUpdated', handleUpdate)
    }
  }, [venue?.id, venue?.width, venue?.depth, venue?.height, objects])

  // Camera view presets
  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current || !venue) return
    if (isGizmoActiveRef.current) return // Don't change camera while using gizmo
    
    const camera = cameraRef.current
    const controls = controlsRef.current
    
    // For DWG venues, center on content bounds instead of full venue dimensions
    const centerX = dwgSceneBounds ? dwgSceneBounds.centerX : venue.width / 2
    const centerZ = dwgSceneBounds ? dwgSceneBounds.centerZ : venue.depth / 2
    const maxDim = dwgSceneBounds ? Math.max(dwgSceneBounds.floorW, dwgSceneBounds.floorD) : Math.max(venue.width, venue.depth)
    
    // Set target to center
    controls.target.set(centerX, 0, centerZ)
    
    switch (cameraView) {
      case 'top':
        // Top-down view (bird's eye)
        camera.position.set(centerX, maxDim * 1.5, centerZ)
        camera.up.set(0, 0, -1) // Z points "down" in screen
        break
      case 'isometric':
        // Isometric view (45° angle from corner)
        const isoDist = maxDim * 0.8
        camera.position.set(centerX + isoDist, isoDist, centerZ + isoDist)
        camera.up.set(0, 1, 0)
        break
      case 'front':
        // Front view (looking from +Z towards -Z)
        camera.position.set(centerX, venue.height / 2, centerZ + maxDim * 1.2)
        camera.up.set(0, 1, 0)
        break
      case 'perspective':
      default:
        // Default perspective — offset from center (matches Digital Twin camera)
        camera.position.set(centerX + maxDim * 0.6, maxDim * 0.45, centerZ + maxDim * 0.6)
        camera.up.set(0, 1, 0)
        break
    }
    
    camera.lookAt(centerX, 0, centerZ)
    controls.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraView]) // Only trigger on explicit view changes, NOT dwgSceneBounds changes

  // Update lighting when settings change
  useEffect(() => {
    if (ambientLightRef.current) {
      ambientLightRef.current.intensity = lighting.ambientIntensity
    }
    if (directionalLightRef.current) {
      directionalLightRef.current.intensity = lighting.directionalIntensity
      directionalLightRef.current.position.set(
        lighting.directionalX,
        lighting.directionalY,
        lighting.directionalZ
      )
      directionalLightRef.current.castShadow = lighting.shadowsEnabled
    }
    if (rendererRef.current) {
      rendererRef.current.shadowMap.enabled = lighting.shadowsEnabled
    }
  }, [lighting])

  // Fetch custom models on mount and listen for updates
  useEffect(() => {
    fetchCustomModels()
    
    const handleModelsUpdated = () => {
      // Clear cached models so they reload
      loadedModelsRef.current.clear()
      // Also clear object meshes so they get recreated with new models
      if (sceneRef.current) {
        objectMeshesRef.current.forEach((obj3d) => {
          sceneRef.current!.remove(obj3d)
          obj3d.traverse(child => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose()
              if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose())
              } else {
                child.material.dispose()
              }
            }
          })
        })
        objectMeshesRef.current.clear()
      }
      fetchCustomModels()
    }
    
    window.addEventListener('customModelsUpdated', handleModelsUpdated)
    return () => window.removeEventListener('customModelsUpdated', handleModelsUpdated)
  }, [fetchCustomModels])

  // Fetch DOOH screens when venue changes
  useEffect(() => {
    if (venue?.id) {
      fetchDoohScreens(venue.id)
    }
  }, [venue?.id, fetchDoohScreens])

  // Render DOOH screen zones
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current
    const existingIds = new Set(doohScreens.filter(s => s.enabled).map(s => s.id))

    // Remove deleted/disabled screens
    doohMeshesRef.current.forEach((group, id) => {
      if (!existingIds.has(id)) {
        scene.remove(group)
        group.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material.dispose()
            }
          }
          if (child instanceof THREE.Line || child instanceof THREE.LineSegments) {
            child.geometry.dispose()
            ;(child.material as THREE.Material).dispose()
          }
        })
        doohMeshesRef.current.delete(id)
      }
    })

    // Add/update DOOH screens
    doohScreens.filter(s => s.enabled).forEach(screen => {
      let group = doohMeshesRef.current.get(screen.id)
      
      if (!group) {
        group = createDoohZoneMesh(screen)
        scene.add(group)
        doohMeshesRef.current.set(screen.id, group)
      }
      
      // Update visibility based on layer toggle
      group.visible = showDoohLayer
    })
  }, [doohScreens, showDoohLayer, createDoohZoneMesh])

  // Update DOOH layer visibility
  useEffect(() => {
    doohMeshesRef.current.forEach(group => {
      group.visible = showDoohLayer
    })
  }, [showDoohLayer])

  // Initialize video playback for DOOH screens with playlists
  useEffect(() => {
    if (!sceneRef.current || !venue?.id) return
    const scene = sceneRef.current

    console.log('[DOOH Video] Initializing videos for screens:', doohScreens.length, 'enabled:', doohScreens.filter(s => s.enabled).length)

    // Fetch and initialize video for each enabled screen
    const initScreenVideos = async () => {
      for (const screen of doohScreens.filter(s => s.enabled)) {
        // Skip if already initialized
        if (doohVideoStatesRef.current.has(screen.id)) {
          console.log('[DOOH Video] Screen already initialized:', screen.id)
          continue
        }

        try {
          // Fetch playlist
          console.log('[DOOH Video] Fetching playlist for screen:', screen.id)
          const res = await fetch(`${API_BASE}/api/dooh/screens/${screen.id}/playlist`)
          if (!res.ok) {
            console.log('[DOOH Video] Playlist fetch failed:', res.status)
            continue
          }
          const data = await res.json()
          console.log('[DOOH Video] Playlist data:', data)
          const playlist = (data.playlist || []).map((item: any) => ({
            videoId: item.videoId,
            filePath: item.video.filePath,
            durationMs: item.video.durationMs,
            name: item.video.name,
          }))

          if (playlist.length === 0) {
            console.log('[DOOH Video] No videos in playlist for screen:', screen.id)
            continue
          }
          console.log('[DOOH Video] Playlist has', playlist.length, 'videos')

          // Create video element
          const video = document.createElement('video')
          video.crossOrigin = 'anonymous'
          video.loop = false
          video.muted = true
          video.playsInline = true
          video.preload = 'auto'

          // Create video texture
          const texture = new THREE.VideoTexture(video)
          texture.minFilter = THREE.LinearFilter
          texture.magFilter = THREE.LinearFilter
          texture.colorSpace = THREE.SRGBColorSpace

          const state = {
            video,
            texture,
            playlist,
            currentIndex: 0,
            loopCount: 0,
            startTs: 0,
          }

          // Log proof of play and advance to next video
          const playNextVideo = () => {
            const currentItem = state.playlist[state.currentIndex]
            if (currentItem && state.startTs > 0) {
              // Log proof of play
              fetch(`${API_BASE}/api/dooh/proof-of-play`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  venueId: venue.id,
                  screenId: screen.id,
                  videoId: currentItem.videoId,
                  startTs: state.startTs,
                  endTs: Date.now(),
                  loopIndex: state.loopCount,
                  playbackStatus: 'completed',
                }),
              }).catch(console.error)
            }

            // Advance to next video
            state.currentIndex = (state.currentIndex + 1) % state.playlist.length
            if (state.currentIndex === 0) state.loopCount++

            // Play next
            const nextItem = state.playlist[state.currentIndex]
            if (nextItem) {
              state.video.src = `${API_BASE}${nextItem.filePath}`
              state.startTs = Date.now()
              state.video.play().catch(console.error)
            }
          }

          video.onended = playNextVideo
          video.onerror = () => {
            console.error('Video error, skipping to next')
            playNextVideo()
          }

          // Store state
          doohVideoStatesRef.current.set(screen.id, state)

          // Create video screen mesh (plane at mount height)
          const screenWidth = 1.5 // 1.5m wide
          const screenHeight = 0.85 // 16:9 aspect ratio
          const yawRad = (screen.yawDeg || 0) * Math.PI / 180
          
          // Create a group to hold the screen(s)
          const screenGroup = new THREE.Group()
          screenGroup.position.set(screen.position.x, screen.mountHeightM, screen.position.z)
          screenGroup.rotation.y = yawRad
          screenGroup.userData.isVideoScreen = true
          screenGroup.userData.screenId = screen.id
          
          // Front face
          const frontGeometry = new THREE.PlaneGeometry(screenWidth, screenHeight)
          const frontMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.FrontSide,
          })
          const frontMesh = new THREE.Mesh(frontGeometry, frontMaterial)
          screenGroup.add(frontMesh)
          
          // Back face (if double-sided) - rotated 180° so video displays correctly
          if (screen.doubleSided) {
            const backGeometry = new THREE.PlaneGeometry(screenWidth, screenHeight)
            const backMaterial = new THREE.MeshBasicMaterial({
              map: texture,
              side: THREE.FrontSide,
            })
            const backMesh = new THREE.Mesh(backGeometry, backMaterial)
            backMesh.rotation.y = Math.PI // Face opposite direction
            screenGroup.add(backMesh)
          }

          scene.add(screenGroup)
          doohVideoMeshesRef.current.set(screen.id, screenGroup as unknown as THREE.Mesh)

          // Start playback
          const firstItem = state.playlist[0]
          if (firstItem) {
            const videoUrl = `${API_BASE}${firstItem.filePath}`
            console.log('[DOOH Video] Starting playback:', videoUrl)
            state.video.src = videoUrl
            state.startTs = Date.now()
            state.video.play().then(() => {
              console.log('[DOOH Video] Video playing successfully')
            }).catch((err) => {
              console.error('[DOOH Video] Play failed:', err)
            })
          }
          console.log('[DOOH Video] Screen mesh created at:', screen.position.x, screen.mountHeightM, screen.position.z)
        } catch (err) {
          console.error('[DOOH Video] Failed to init screen video:', err)
        }
      }
    }

    initScreenVideos()

    // Cleanup on unmount
    return () => {
      doohVideoStatesRef.current.forEach((state, screenId) => {
        state.video.pause()
        state.video.src = ''
        state.video.load()
        state.texture.dispose()
        
        const screenObj = doohVideoMeshesRef.current.get(screenId)
        if (screenObj) {
          scene.remove(screenObj)
          // Dispose all children (front and back meshes)
          screenObj.traverse((child) => {
            if (child instanceof THREE.Mesh) {
              child.geometry.dispose()
              ;(child.material as THREE.Material).dispose()
            }
          })
        }
      })
      doohVideoStatesRef.current.clear()
      doohVideoMeshesRef.current.clear()
    }
  }, [doohScreens, venue?.id, videoPlaylistRefresh])

  // Update objects
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current
    
    // For DWG venues, hide noise types AND filter to ROI area only
    const isDwgVenue = venue?.scene_source === 'dwg' || !!venue?.dwg_layout_version_id
    const isAbsurdVenue = venue ? Math.max(venue.width, venue.depth) > 500 : false
    const HIDDEN_DWG_TYPES = new Set(['pillar', 'entrance'])
    let visibleObjects = objects
    if (isDwgVenue) {
      visibleObjects = objects.filter(o => !(HIDDEN_DWG_TYPES.has(o.type) && o.metadata?.source === 'dwg'))
      // For absurd venues, also filter to objects within/near the ROI
      if (isAbsurdVenue && regions.length > 0) {
        let roiMinX = Infinity, roiMaxX = -Infinity, roiMinZ = Infinity, roiMaxZ = -Infinity
        regions.forEach(roi => {
          roi.vertices.forEach(v => {
            roiMinX = Math.min(roiMinX, v.x)
            roiMaxX = Math.max(roiMaxX, v.x)
            roiMinZ = Math.min(roiMinZ, v.z)
            roiMaxZ = Math.max(roiMaxZ, v.z)
          })
        })
        if (isFinite(roiMinX)) {
          const margin = Math.max(roiMaxX - roiMinX, roiMaxZ - roiMinZ) * 0.3
          const before = visibleObjects.length
          visibleObjects = visibleObjects.filter(o => 
            o.position.x >= roiMinX - margin && o.position.x <= roiMaxX + margin &&
            o.position.z >= roiMinZ - margin && o.position.z <= roiMaxZ + margin
          )
          if (visibleObjects.length < before) {
            console.log(`[MainViewport] ROI filter: ${before} → ${visibleObjects.length} objects (within ROI + ${margin.toFixed(0)}m margin)`)
          }
        }
      }
    }
    const existingIds = new Set(visibleObjects.map(o => o.id))

    // Remove deleted objects (and newly-hidden noise types)
    // Collect IDs to remove first, then remove them (avoids modifying Map during iteration)
    const idsToRemove: string[] = []
    objectMeshesRef.current.forEach((_, id) => {
      if (!existingIds.has(id)) {
        idsToRemove.push(id)
      }
    })
    idsToRemove.forEach(id => {
      const obj3d = objectMeshesRef.current.get(id)
      if (!obj3d) return
      // Also remove associated wireframe line for DWG polygon objects
      if (obj3d.userData.wireLineRef) {
        scene.remove(obj3d.userData.wireLineRef)
        obj3d.userData.wireLineRef.geometry?.dispose()
        obj3d.userData.wireLineRef.material?.dispose()
      }
      scene.remove(obj3d)
      obj3d.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      })
      objectMeshesRef.current.delete(id)
    })

    // ── DWG TYPE COLORS (matches Layout3DPreview exactly) ──
    const DWG_TYPE_COLORS: Record<string, number> = {
      shelf: 0x6366f1,
      wall: 0x64748b,
      checkout: 0x22c55e,
      entrance: 0xf59e0b,
      pillar: 0x78716c,
      digital_display: 0x8b5cf6,
      fridge: 0x26c6da,
      custom: 0x4b5563, // Gray (NOT purple!) — matches Layout3DPreview 'default'
      default: 0x4b5563,
    }

    // ── DIAGNOSTIC: dump checkout dimensions from DB (compare with Layout3DPreview) ──
    if (isDwgVenue && visibleObjects.length > 0) {
      const checkouts = visibleObjects.filter(o => o.type === 'checkout')
      if (checkouts.length > 0) {
        console.log(`%c[MainViewport] ═══ CHECKOUT FIXTURES FROM DB (${checkouts.length} total) ═══`, 'color:#ff6b6b;font-size:14px;font-weight:bold')
        checkouts.forEach((c, i) => {
          console.log(`%c  CHECKOUT #${i}: ${c.id}  →  scale.x=${c.scale.x.toFixed(3)}  scale.y=${c.scale.y.toFixed(3)}  scale.z=${c.scale.z.toFixed(3)}  pos=(${c.position.x.toFixed(2)}, ${c.position.z.toFixed(2)})  rot=${(c.rotation.y * 180 / Math.PI).toFixed(1)}°`, 'color:#ff6b6b;font-size:12px')
        })
        console.log(`%c  Venue dimensions: ${venue?.width}m × ${venue?.depth}m`, 'color:#ff6b6b;font-size:12px;font-weight:bold')
      }
    }
    // Diagnostic: log type breakdown for DWG venues
    if (isDwgVenue && visibleObjects.length > 0) {
      const typeCounts: Record<string, { count: number; withPolygon: number; withoutPolygon: number }> = {}
      visibleObjects.forEach(o => {
        const t = o.type || 'unknown'
        if (!typeCounts[t]) typeCounts[t] = { count: 0, withPolygon: 0, withoutPolygon: 0 }
        typeCounts[t].count++
        if (o.metadata?.dwg_footprint_points?.length) typeCounts[t].withPolygon++
        else typeCounts[t].withoutPolygon++
      })
      console.table(typeCounts)
      console.log(`[MainViewport] DWG venue: ${visibleObjects.length} visible objects`)
    }

    // Add/update objects
    const createOrUpdateObject = async (obj: typeof objects[0]) => {
      let obj3d = objectMeshesRef.current.get(obj.id)
      const customModel = customModels.get(obj.type)
      const isDwg = isDwgVenue && obj.metadata?.source === 'dwg'
      const polyPts = obj.metadata?.dwg_footprint_points

      if (!obj3d) {
        // Color: for DWG venues use Layout3DPreview colors; for manual use existing COLORS
        const targetColor = getObjectColorHex(obj, isDwg ? (DWG_TYPE_COLORS[obj.type] || DWG_TYPE_COLORS.default) : COLORS.custom)

        // ── DWG POLYGON EXTRUSION (matches Layout3DPreview exactly) ──
        if (isDwg && polyPts && polyPts.length >= 3) {
          const cx = obj.position.x  // centroid X (already in venue coords)
          const cz = obj.position.z  // centroid Z
          const h = obj.scale.y      // height from bootstrap

          // Build THREE.Shape from polygon (relative to centroid, negated Z for rotateX)
          const shape = new THREE.Shape()
          const rel = polyPts.map(pt => ({
            sx: pt.x - cx,
            sy: -(pt.z - cz)
          }))
          shape.moveTo(rel[0].sx, rel[0].sy)
          for (let i = 1; i < rel.length; i++) shape.lineTo(rel[i].sx, rel[i].sy)
          shape.closePath()

          const extrudeGeom = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
          extrudeGeom.rotateX(-Math.PI / 2) // Extrude upward (Y axis)
          const mat = new THREE.MeshStandardMaterial({ color: targetColor, roughness: 0.7, metalness: 0.1 })
          const mesh = new THREE.Mesh(extrudeGeom, mat)
          mesh.position.set(cx, 0, cz)
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.userData.objectId = obj.id
          mesh.userData.isDwgPolygon = true

          // Add ground-plane wireframe outline (cyan, like Layout3DPreview)
          const wirePoints = polyPts.map(pt => new THREE.Vector3(pt.x, 0.02, pt.z))
          wirePoints.push(wirePoints[0].clone()) // close loop
          const wireGeom = new THREE.BufferGeometry().setFromPoints(wirePoints)
          const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2 })
          const wireLine = new THREE.Line(wireGeom, wireMat)
          wireLine.userData.isEdgeLines = true
          // wireframe in world coords — don't parent to mesh (mesh has offset)
          scene.add(wireLine)
          // Store reference so we can remove it later
          mesh.userData.wireLineRef = wireLine

          scene.add(mesh)
          objectMeshesRef.current.set(obj.id, mesh)
          obj3d = mesh

        } else if (customModel && show3DModels) {
          // Load custom 3D model (GLTF/GLB/OBJ) - only when toggle is ON
          const cacheBuster = `?t=${Date.now()}`
          const loaded = await loadModel(obj.type, `${API_BASE}${customModel.file_path}${cacheBuster}`)
          if (loaded) {
            const isTranslucentType = obj.type === 'wall' || obj.type === 'shelf'
            const isObjFile = customModel.original_name?.toLowerCase().endsWith('.obj')
            
            loaded.traverse(child => {
              if (child instanceof THREE.Mesh) {
                if (isObjFile || isTranslucentType) {
                  child.material = new THREE.MeshStandardMaterial({
                    color: isTranslucentType ? 0x88aabb : targetColor,
                    roughness: isTranslucentType ? 0.3 : 0.7,
                    metalness: 0.1,
                    transparent: isTranslucentType,
                    opacity: isTranslucentType ? 0.25 : 1.0,
                    side: isTranslucentType ? THREE.DoubleSide : THREE.FrontSide,
                    depthWrite: !isTranslucentType,
                  })
                  
                  if (isTranslucentType && child.geometry) {
                    const edges = new THREE.EdgesGeometry(child.geometry)
                    const lineMaterial = new THREE.LineBasicMaterial({ 
                      color: 0x99ccdd, transparent: true, opacity: 0.6,
                    })
                    const edgeLines = new THREE.LineSegments(edges, lineMaterial)
                    edgeLines.userData.isEdgeLines = true
                    child.add(edgeLines)
                  }
                }
                child.castShadow = !isTranslucentType
                child.receiveShadow = true
              }
            })
            loaded.userData.objectId = obj.id
            loaded.userData.isCustomModel = true
            loaded.userData.isTranslucent = isTranslucentType
            if (isTranslucentType) loaded.renderOrder = 1
            scene.add(loaded)
            objectMeshesRef.current.set(obj.id, loaded)
            obj3d = loaded
          }
        }
        
        // Fallback to box geometry
        if (!obj3d) {
          const geometry = new THREE.BoxGeometry(1, 1, 1)
          const isTranslucentType = isDwg || obj.type === 'wall' || obj.type === 'shelf'
          
          const material = new THREE.MeshStandardMaterial({
            color: targetColor,
            roughness: 0.7,
            metalness: 0.1,
            transparent: isTranslucentType,
            opacity: isTranslucentType ? 0.25 : 1.0,
            side: isTranslucentType ? THREE.DoubleSide : THREE.FrontSide,
            depthWrite: !isTranslucentType,
          })
          
          const mesh = new THREE.Mesh(geometry, material)
          mesh.castShadow = !isTranslucentType
          mesh.receiveShadow = true
          mesh.userData.objectId = obj.id
          mesh.userData.isTranslucent = isTranslucentType
          if (isTranslucentType) mesh.renderOrder = 1
          
          // Add wireframe edges for all DWG objects (or wall/shelf in manual mode)
          if (isTranslucentType || isDwg) {
            const edges = new THREE.EdgesGeometry(geometry)
            const lineMaterial = new THREE.LineBasicMaterial({ 
              color: isDwg ? 0x00ffff : 0x99ccdd, transparent: true, opacity: 0.6,
            })
            const edgeLines = new THREE.LineSegments(edges, lineMaterial)
            edgeLines.userData.isEdgeLines = true
            mesh.add(edgeLines)
          }
          
          scene.add(mesh)
          objectMeshesRef.current.set(obj.id, mesh)
          obj3d = mesh
        }
      }

      // Update transform
      if (obj3d.userData.isDwgPolygon) {
        // DWG polygon meshes: position is centroid, no rotation needed (shape is in world coords)
        // For DWG polygons, scaling requires rebuilding geometry - apply Y scale (height) by scaling mesh
        obj3d.position.set(obj.position.x, 0, obj.position.z)
        // Allow height scaling for DWG polygons (X/Z scaling would distort the shape)
        const originalHeight = obj3d.userData.originalHeight || obj.scale.y
        if (!obj3d.userData.originalHeight) obj3d.userData.originalHeight = obj.scale.y
        obj3d.scale.set(1, obj.scale.y / originalHeight, 1)
      } else {
        obj3d.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z)
        
        let yOffset = obj.scale.y / 2
        const isDwgVenueCheck = venueRef.current?.scene_source === 'dwg'
        
        if (obj3d.userData.isCustomModel && obj3d.userData.originalSize && isDwgVenueCheck) {
          const originalSize = obj3d.userData.originalSize as THREE.Vector3
          const scaleX = obj.scale.x / originalSize.x
          const scaleZ = obj.scale.z / originalSize.z
          const scaleY = obj.scale.y / originalSize.y
          obj3d.scale.set(scaleX, scaleY, scaleZ)
          const box = new THREE.Box3().setFromObject(obj3d)
          yOffset = -box.min.y
        } else if (obj3d.userData.isCustomModel) {
          obj3d.scale.set(obj.scale.x, obj.scale.y, obj.scale.z)
          const box = new THREE.Box3().setFromObject(obj3d)
          yOffset = -box.min.y
        } else {
          obj3d.scale.set(obj.scale.x, obj.scale.y, obj.scale.z)
        }
        
        obj3d.position.set(obj.position.x, yOffset, obj.position.z)
      }
      
      // Force Three.js to update the object's world matrix
      obj3d.updateMatrixWorld(true)

      // Update material color and selection state
      const isTranslucentType = isDwg || obj.type === 'wall' || obj.type === 'shelf'
      const targetColor = getObjectColorHex(
        obj,
        isDwg ? (DWG_TYPE_COLORS[obj.type] || DWG_TYPE_COLORS.default) : (isTranslucentType ? 0x88aabb : COLORS.custom)
      )
      obj3d.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial
          if (!child.userData.isEdgeLines) {
            mat.color.setHex(targetColor)
          }
          if (obj.id === selectedObjectId) {
            mat.emissive.setHex(COLORS.selected)
            mat.emissiveIntensity = 0.3
          } else if (obj.id === hoveredObjectId) {
            mat.emissive.setHex(0x22d3ee)
            mat.emissiveIntensity = 0.25
          } else {
            mat.emissive.setHex(0x000000)
            mat.emissiveIntensity = 0
          }
        }
      })
    }

    visibleObjects.forEach(obj => createOrUpdateObject(obj))
  }, [objects, selectedObjectId, hoveredObjectId, customModels, loadModel, venue?.scene_source, venue?.dwg_layout_version_id, venue?.width, venue?.depth, regions, show3DModels])

  // Update LiDAR placements
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current
    const existingIds = new Set(placements.map(p => p.id))
    
    // FLOW-DEBUG: Log what placements MainViewport is receiving from LidarContext
    console.log('%c[FLOW-DEBUG] MainViewport LiDAR placements update', 'color:#3b82f6;font-weight:bold', {
      source: 'LidarContext.placements (lidar_placements table)',
      count: placements.length,
      ids: placements.map(p => p.id.slice(0, 8)),
      positions: placements.map(p => ({ x: p.position.x.toFixed(2), z: p.position.z.toFixed(2) })),
    })

    // Remove deleted placements
    lidarMeshesRef.current.forEach((group, id) => {
      if (!existingIds.has(id)) {
        scene.remove(group)
        group.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            ;(child.material as THREE.Material).dispose()
          }
        })
        lidarMeshesRef.current.delete(id)
      }
    })

    // Add/update placements
    placements.forEach(placement => {
      let group = lidarMeshesRef.current.get(placement.id)
      const device = getDeviceById(placement.deviceId)
      const statusColor = device?.status === 'online' ? COLORS.lidarOnline 
        : device?.status === 'connecting' ? COLORS.lidarConnecting 
        : COLORS.lidarOffline

      const isOnline = device?.status === 'online'

      if (!group) {
        group = new THREE.Group()

        // Ceiling-mounted LiDAR dome sensor - visible size for 3D scene
        const DOME_RADIUS = 0.25 // 25cm radius = 50cm diameter (visible in scene)
        const CYLINDER_RADIUS = 0.2
        const CYLINDER_HEIGHT = 0.15

        // Invisible hit sphere for easier clicking (larger hit area)
        const hitSphereGeometry = new THREE.SphereGeometry(0.6, 16, 8) // 60cm radius hit area
        const hitSphereMaterial = new THREE.MeshBasicMaterial({ 
          visible: false,
          transparent: true,
          opacity: 0
        })
        const hitSphere = new THREE.Mesh(hitSphereGeometry, hitSphereMaterial)
        hitSphere.position.y = -0.2 // Center around the LiDAR
        hitSphere.userData.isLidar = true
        hitSphere.userData.placementId = placement.id
        group.add(hitSphere) // index 0 - hit detection sphere

        // Mounting cylinder (attaches to ceiling, pointing down)
        const cylinderGeometry = new THREE.CylinderGeometry(CYLINDER_RADIUS, CYLINDER_RADIUS * 1.1, CYLINDER_HEIGHT, 16)
        const cylinderMaterial = new THREE.MeshStandardMaterial({ 
          color: 0x333333, 
          roughness: 0.4, 
          metalness: 0.6 
        })
        const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial)
        cylinder.position.y = -CYLINDER_HEIGHT / 2
        cylinder.castShadow = true
        cylinder.userData.isLidar = true
        cylinder.userData.placementId = placement.id
        group.add(cylinder) // index 1

        // Dome (semisphere attached to bottom of cylinder)
        const domeGeometry = new THREE.SphereGeometry(DOME_RADIUS, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)
        const domeMaterial = new THREE.MeshStandardMaterial({ 
          color: statusColor, 
          roughness: 0.3, 
          metalness: 0.5,
          emissive: statusColor,
          emissiveIntensity: 0.2
        })
        const dome = new THREE.Mesh(domeGeometry, domeMaterial)
        dome.rotation.x = Math.PI // Flip dome to point downward
        dome.position.y = -CYLINDER_HEIGHT
        dome.castShadow = true
        dome.userData.isLidar = true
        dome.userData.placementId = placement.id
        group.add(dome) // index 2

        // Coverage circle on floor (shows coverage radius)
        const coverageGeometry = new THREE.RingGeometry(0.1, placement.range, 64)
        const coverageMaterial = new THREE.MeshBasicMaterial({
          color: isOnline ? COLORS.fovCone : 0x555555,
          transparent: true,
          opacity: isOnline ? 0.2 : 0.08, // Faded for offline
          side: THREE.DoubleSide,
          depthWrite: false, // Prevents z-fighting when overlapping
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
        const coverage = new THREE.Mesh(coverageGeometry, coverageMaterial)
        coverage.rotation.x = -Math.PI / 2
        coverage.position.y = -placement.mountHeight + 0.01 // At floor level
        coverage.renderOrder = 1 // Render after floor
        group.add(coverage) // index 3

        // Status indicator (green sphere above lidar when online)
        const indicatorGeometry = new THREE.SphereGeometry(0.08, 16, 8)
        const indicatorMaterial = new THREE.MeshBasicMaterial({ 
          color: 0x22c55e,
          visible: isOnline
        })
        const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial)
        indicator.position.y = 0.15 // Above the mount
        group.add(indicator) // index 4

        // Tooltip label (hidden by default, shown on hover)
        const labelDiv = document.createElement('div')
        labelDiv.className = 'lidar-label'
        labelDiv.style.cssText = `
          background: rgba(0,0,0,0.8);
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-family: system-ui, sans-serif;
          white-space: nowrap;
          border: 1px solid ${isOnline ? '#22c55e' : '#6b7280'};
          pointer-events: none;
        `
        labelDiv.innerHTML = `
          <div style="font-weight:600">${device?.hostname || 'Unknown'}</div>
          <div style="opacity:0.7;font-size:10px">${device?.tailscaleIp || 'No IP'}</div>
        `
        const label = new CSS2DObject(labelDiv)
        label.position.y = 0.4 // Above the indicator
        label.visible = false // Hidden by default, shown on hover
        group.add(label) // index 5

        // Red laser dot projection on floor
        const laserDotGeometry = new THREE.CircleGeometry(0.15, 32)
        const laserDotMaterial = new THREE.MeshBasicMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 0.9,
        })
        const laserDot = new THREE.Mesh(laserDotGeometry, laserDotMaterial)
        laserDot.rotation.x = -Math.PI / 2
        laserDot.position.y = -placement.mountHeight + 0.02 // Slightly above floor
        group.add(laserDot) // index 6

        // Laser beam line from LiDAR to floor
        const laserLineGeometry = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, -0.3, 0), // From bottom of dome
          new THREE.Vector3(0, -placement.mountHeight + 0.02, 0) // To floor
        ])
        const laserLineMaterial = new THREE.LineBasicMaterial({
          color: 0xff0000,
          transparent: true,
          opacity: 0.6,
        })
        const laserLine = new THREE.Line(laserLineGeometry, laserLineMaterial)
        group.add(laserLine) // index 7

        scene.add(group)
        lidarMeshesRef.current.set(placement.id, group)
      }

      // Update transforms - position at ceiling height
      group.position.set(placement.position.x, placement.mountHeight, placement.position.z)
      group.rotation.set(placement.rotation.x, placement.rotation.y, placement.rotation.z)

      // Update dome color (index 2 is the dome)
      const dome = group.children[2] as THREE.Mesh
      const domeMaterial = dome.material as THREE.MeshStandardMaterial
      domeMaterial.color.setHex(statusColor)

      // Highlight if selected
      if (placement.id === selectedPlacementId) {
        domeMaterial.emissive.setHex(COLORS.selected)
        domeMaterial.emissiveIntensity = 0.5
      } else {
        domeMaterial.emissive.setHex(0x000000)
        domeMaterial.emissiveIntensity = 0
      }

      // Update coverage circle (index 3) - color and opacity based on status
      const coverage = group.children[3] as THREE.Mesh
      const coverageMaterial = coverage.material as THREE.MeshBasicMaterial
      coverageMaterial.color.setHex(isOnline ? COLORS.fovCone : 0x555555)
      coverageMaterial.opacity = isOnline ? 0.2 : 0.08
      coverage.geometry.dispose()
      coverage.geometry = new THREE.RingGeometry(0.1, placement.range, 64)
      coverage.position.y = -placement.mountHeight + 0.01

      // Update status indicator visibility (index 4)
      const indicator = group.children[4] as THREE.Mesh
      indicator.visible = isOnline

      // Update label (index 5) - keep hidden, only show on hover
      if (group.children[5] instanceof CSS2DObject) {
        const labelObj = group.children[5] as CSS2DObject
        const labelDiv = labelObj.element as HTMLDivElement
        labelDiv.style.borderColor = isOnline ? '#22c55e' : '#6b7280'
        labelObj.visible = false // Ensure stays hidden until hover
        // Update content in case device info changed
        labelDiv.innerHTML = `
          <div style="font-weight:600">${device?.hostname || 'Unknown'}</div>
          <div style="opacity:0.7;font-size:10px">${device?.tailscaleIp || 'No IP'}</div>
        `
      }

      // Update laser dot position (index 6)
      if (group.children[6]) {
        const laserDot = group.children[6] as THREE.Mesh
        laserDot.position.y = -placement.mountHeight + 0.02
      }

      // Update laser beam line (index 7)
      if (group.children[7]) {
        const laserLine = group.children[7] as THREE.Line
        const positions = new Float32Array([
          0, -0.3, 0,
          0, -placement.mountHeight + 0.02, 0
        ])
        laserLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        laserLine.geometry.attributes.position.needsUpdate = true
      }
    })
  }, [placements, selectedPlacementId, getDeviceById])

  // Sync Three.js track meshes imperatively via interval (decoupled from React render cycle).
  // Reads tracksRef.current instead of depending on [tracks], avoiding 30fps useEffect reruns.
  // Implements a 3s grace period: disappeared tracks are hidden, not immediately disposed.
  const trackingRef = useRef(tracking)
  trackingRef.current = tracking

  useEffect(() => {
    const MESH_DIAG = import.meta.env.DEV || localStorage.getItem('hyperspace-diag') === '1'
    let syncIntervalMs = 33
    let timer: ReturnType<typeof setTimeout> | null = null

    let diagLastMeshCount = 0
    let diagSyncCount = 0

    const syncTrackMeshes = () => {
      if (!sceneRef.current) return
      const scene = sceneRef.current
      const allTracks = tracksRef.current
      const refCount = allTracks.size
      syncIntervalMs = refCount > 200 ? 200 : refCount > RENDER_EMERGENCY_THRESHOLD ? 66 : 33

      // Sticky cap: prefer tracks that already have meshes so IDs don't swap every frame
      let tracksToRender = allTracks
      if (refCount > RENDER_EMERGENCY_THRESHOLD) {
        tracksToRender = capTracksForRender(allTracks, trackMeshesRef.current.keys())
      }
      const allTrackKeys = new Set(allTracks.keys())
      const currentDoohScreens = doohScreensRef.current
      const currentTracking = trackingRef.current
      const now = Date.now()
      const SEZ_LABEL_DURATION_MS = 60 * 1000

      diagSyncCount++
      const meshCount = trackMeshesRef.current.size
      const renderCount = tracksToRender.size
      if (MESH_DIAG && (Math.abs(meshCount - diagLastMeshCount) > 3 || (diagSyncCount % 300 === 0))) {
        console.log(`[DIAG] meshSync  meshes=${meshCount}  refTracks=${refCount}  render=${renderCount}  grace=${trackGraceRef.current.size}  sync#=${diagSyncCount}  t=${now}`)
        diagLastMeshCount = meshCount
      }
      // Bulk clear: when all tracks vanish at once (simulator stopped), skip grace period
      if (refCount === 0 && meshCount > 0) {
        if (emptyTracksSinceRef.current == null) {
          emptyTracksSinceRef.current = now
        }
        if (now - emptyTracksSinceRef.current < EMPTY_TRACKS_CLEAR_MS) {
          return
        }
        emptyTracksSinceRef.current = null
        trackMeshesRef.current.forEach((group, key) => {
          scene.remove(group)
          group.traverse(child => {
            if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points || child instanceof THREE.LineSegments) {
              child.geometry.dispose()
              if (Array.isArray(child.material)) {
                child.material.forEach(m => { if (m.map) m.map.dispose(); m.dispose() })
              } else {
                if ((child.material as any).map) (child.material as any).map.dispose()
                child.material.dispose()
              }
            }
            if (child instanceof THREE.Sprite) {
              const mat = child.material as THREE.SpriteMaterial
              if (mat.map) mat.map.dispose()
              mat.dispose()
            }
          })
          const trail = trailLinesRef.current.get(key)
          if (trail) {
            scene.remove(trail)
            trail.geometry.dispose()
            ;(trail.material as THREE.Material).dispose()
            trailLinesRef.current.delete(key)
          }
        })
        trackMeshesRef.current.clear()
        trackGraceRef.current.clear()
        sezEntryTimesRef.current.clear()
        return
      }
      emptyTracksSinceRef.current = null

      // Phase 1: hide only when track is truly gone from server snapshot (not just render-capped)
      trackMeshesRef.current.forEach((group, key) => {
        if (!allTrackKeys.has(key)) {
          if (!trackGraceRef.current.has(key)) {
            trackGraceRef.current.set(key, now)
          }
          const graceAge = now - (trackGraceRef.current.get(key) ?? now)
          if (graceAge > TRACK_HIDE_DELAY_MS) {
            group.visible = false
            const trail = trailLinesRef.current.get(key)
            if (trail) trail.visible = false
          }
          if (graceAge > TRACK_GRACE_MS) {
            // Grace period expired — dispose
            trackGraceRef.current.delete(key)
            scene.remove(group)
            group.traverse(child => {
              if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Points || child instanceof THREE.LineSegments) {
                child.geometry.dispose()
                if (Array.isArray(child.material)) {
                  child.material.forEach(m => {
                    if (m.map) m.map.dispose()
                    m.dispose()
                  })
                } else {
                  if ((child.material as any).map) (child.material as any).map.dispose()
                  child.material.dispose()
                }
              }
              if (child instanceof THREE.Sprite) {
                const mat = child.material as THREE.SpriteMaterial
                if (mat.map) mat.map.dispose()
                mat.dispose()
              }
            })
            const trail = trailLinesRef.current.get(key)
            if (trail) {
              scene.remove(trail)
              trail.geometry.dispose()
              ;(trail.material as THREE.Material).dispose()
              trailLinesRef.current.delete(key)
            }
            sezEntryTimesRef.current.delete(key)
            trackMeshesRef.current.delete(key)
          }
        } else {
          // Track present — keep visible (fade-in if returning from grace)
          if (trackGraceRef.current.has(key)) {
            trackGraceRef.current.delete(key)
          }
          group.visible = showTracksRef.current
          const trail = trailLinesRef.current.get(key)
          if (trail) trail.visible = showTracksRef.current
        }
      })

      // Phase 2: Add/update tracks (create new meshes only within render cap)
      tracksToRender.forEach((track, key) => {
        let group = trackMeshesRef.current.get(key)

        const personPos = { x: track.venuePosition.x, z: track.venuePosition.z }
        let isInSez = false
        for (const screen of currentDoohScreens) {
          if (screen.enabled && screen.sezPolygon && screen.sezPolygon.length >= 3) {
            if (pointInPolygon(personPos, screen.sezPolygon)) {
              isInSez = true
              break
            }
            if (screen.doubleSided) {
              const backPolygon = screen.sezPolygon.map(p => ({
                x: 2 * screen.position.x - p.x,
                z: 2 * screen.position.z - p.z,
              }))
              if (pointInPolygon(personPos, backPolygon)) {
                isInSez = true
                break
              }
            }
          }
        }

        if (isInSez && !sezEntryTimesRef.current.has(key)) {
          sezEntryTimesRef.current.set(key, now)
        }

        const entryTime = sezEntryTimesRef.current.get(key)
        const showSezLabel = entryTime && (now - entryTime) < SEZ_LABEL_DURATION_MS

        let color: number | string = isInSez ? COLORS.sezInfluenced : (
          track.color || (
            track.objectType === 'person' ? COLORS.trackPerson
            : track.objectType === 'cart' ? COLORS.trackCart
            : COLORS.trackUnknown
          )
        )

        // Fixed dimensions for all person cylinders — ignore perception bounding box
        // so every track looks identical regardless of LiDAR detection size.
        const cylinderRadius = 0.25
        const cylinderHeight = 1.7

        if (!group) {
          group = new THREE.Group()

          const cylinderGeometry = new THREE.CylinderGeometry(
            cylinderRadius, cylinderRadius, cylinderHeight, 8
          )
          const cylinderMaterial = new THREE.MeshStandardMaterial({
            color,
            emissive: color,
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: currentTracking.cylinderOpacity,
          })
          const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial)
          cylinder.userData.isCylinder = true
          group.add(cylinder)

          // Flat top cap (no sphere) — just a thin disc
          const topCapGeometry = new THREE.CircleGeometry(cylinderRadius, 8)
          const topCapMaterial = new THREE.MeshStandardMaterial({
            color, emissive: color, emissiveIntensity: 0.5,
            transparent: true, opacity: currentTracking.cylinderOpacity,
          })
          const topCap = new THREE.Mesh(topCapGeometry, topCapMaterial)
          topCap.rotation.x = -Math.PI / 2
          topCap.position.y = cylinderHeight / 2
          group.add(topCap)

          // Flat bottom cap
          const bottomCapGeometry = new THREE.CircleGeometry(cylinderRadius, 8)
          const bottomCapMaterial = new THREE.MeshStandardMaterial({
            color, emissive: color, emissiveIntensity: 0.5,
            transparent: true, opacity: currentTracking.cylinderOpacity,
          })
          const bottomCap = new THREE.Mesh(bottomCapGeometry, bottomCapMaterial)
          bottomCap.rotation.x = Math.PI / 2
          bottomCap.position.y = -cylinderHeight / 2
          group.add(bottomCap)

          const labelCanvas = document.createElement('canvas')
          const labelCtx = labelCanvas.getContext('2d')!
          labelCanvas.width = 512
          labelCanvas.height = 128
          labelCtx.fillStyle = 'rgba(220, 38, 38, 0.95)'
          labelCtx.beginPath()
          labelCtx.roundRect(8, 8, 496, 112, 56)
          labelCtx.fill()
          labelCtx.strokeStyle = 'rgba(255, 150, 150, 0.9)'
          labelCtx.lineWidth = 6
          labelCtx.stroke()
          labelCtx.fillStyle = 'white'
          labelCtx.font = 'bold 64px system-ui, sans-serif'
          labelCtx.textAlign = 'center'
          labelCtx.textBaseline = 'middle'
          const displayId = key.length > 8 ? key.slice(-6) : key
          labelCtx.fillText(displayId, 256, 68)

          const labelTexture = new THREE.CanvasTexture(labelCanvas)
          labelTexture.needsUpdate = true
          const labelMaterial = new THREE.SpriteMaterial({
            map: labelTexture, transparent: true, depthTest: false,
          })
          const labelSprite = new THREE.Sprite(labelMaterial)
          labelSprite.scale.set(1.5, 0.375, 1)
          labelSprite.position.y = cylinderHeight / 2 + 0.5
          labelSprite.visible = false
          labelSprite.userData.isSezLabel = true
          group.add(labelSprite)

          const pcPositions = generateCapsulePoints(cylinderRadius, cylinderHeight, 150)
          const pcGeometry = new THREE.BufferGeometry()
          pcGeometry.setAttribute('position', new THREE.BufferAttribute(pcPositions, 3))
          const pcMaterial = new THREE.PointsMaterial({
            color, size: 0.04, transparent: true, opacity: 0.9,
            sizeAttenuation: true, depthWrite: false,
          })
          const pointCloud = new THREE.Points(pcGeometry, pcMaterial)
          pointCloud.userData.isPointCloud = true
          pointCloud.userData.basePositions = new Float32Array(pcPositions)
          pointCloud.visible = currentTracking.trackDisplayMode === 'pointcloud'
          group.add(pointCloud)

          const wfBoxGeo = new THREE.BoxGeometry(cylinderRadius * 2, cylinderHeight, cylinderRadius * 2)
          const wfEdgesGeo = new THREE.EdgesGeometry(wfBoxGeo)
          wfBoxGeo.dispose()
          const wfMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 })
          const wireframe = new THREE.LineSegments(wfEdgesGeo, wfMaterial)
          wireframe.userData.isWireframe = true
          wireframe.visible = currentTracking.trackDisplayMode === 'pointcloud'
          group.add(wireframe)

          if (currentTracking.trackDisplayMode === 'pointcloud') {
            (group.children[0] as THREE.Mesh).visible = false;
            (group.children[1] as THREE.Mesh).visible = false;
            (group.children[2] as THREE.Mesh).visible = false
          }

          // Track-ID sprite — same approach as the SEZ label. WebGL handles
          // billboarding and reprojection every frame, so zoom/rotate stays
          // perfectly glued without any JS-side projection work.
          const idCanvas = document.createElement('canvas')
          idCanvas.width = 256
          idCanvas.height = 96
          const idCtx = idCanvas.getContext('2d')!
          const repaintIdCanvas = (text: string) => {
            idCtx.clearRect(0, 0, idCanvas.width, idCanvas.height)
            idCtx.fillStyle = 'rgba(15,15,20,0.9)'
            idCtx.beginPath()
            idCtx.roundRect(4, 4, idCanvas.width - 8, idCanvas.height - 8, 16)
            idCtx.fill()
            idCtx.strokeStyle = 'rgba(255,255,255,0.25)'
            idCtx.lineWidth = 3
            idCtx.stroke()
            idCtx.fillStyle = '#ffffff'
            idCtx.font = 'bold 56px ui-monospace, monospace'
            idCtx.textAlign = 'center'
            idCtx.textBaseline = 'middle'
            idCtx.fillText(text || '?', idCanvas.width / 2, idCanvas.height / 2 + 2)
          }
          repaintIdCanvas('')
          const idTexture = new THREE.CanvasTexture(idCanvas)
          idTexture.needsUpdate = true
          const idMaterial = new THREE.SpriteMaterial({
            map: idTexture, transparent: true, depthTest: false,
          })
          const idSprite = new THREE.Sprite(idMaterial)
          idSprite.scale.set(1.0, 0.375, 1)
          idSprite.position.y = cylinderHeight / 2 + 0.95 // slightly higher than the SEZ pill
          idSprite.visible = false
          idSprite.userData.isTrackIdSprite = true
          idSprite.userData.lastText = ''
          idSprite.userData.repaint = (text: string) => {
            if (idSprite.userData.lastText === text) return
            idSprite.userData.lastText = text
            repaintIdCanvas(text)
            idTexture.needsUpdate = true
          }
          group.add(idSprite)

          group.visible = showTracksRef.current
          scene.add(group)
          trackMeshesRef.current.set(key, group)
        }

        const targetY = cylinderHeight / 2
        group.position.set(track.venuePosition.x, targetY, track.venuePosition.z)

        // Track-ID label — update text (when re-ID flips the perception id) and visibility.
        const perceptionId = (track as unknown as { originalPerceptionId?: string }).originalPerceptionId || track.id || ''
        const digits = String(perceptionId).replace(/\D/g, '')
        const idText = digits.slice(-4) || '?'
        const idSpriteFound = group.children.find(c => c.userData?.isTrackIdSprite) as THREE.Sprite | undefined
        if (idSpriteFound) {
          idSpriteFound.visible = showTrackIdsRef.current && showTracksRef.current
          ;(idSpriteFound.userData.repaint as (t: string) => void)(idText)
        }

        const cylinder = group.children[0] as THREE.Mesh
        const topCap = group.children[1] as THREE.Mesh
        const bottomCap = group.children[2] as THREE.Mesh

        const sezLabel = group.children[3] as THREE.Sprite | undefined
        if (sezLabel && sezLabel.userData.isSezLabel) {
          sezLabel.visible = !!showSezLabel
          sezLabel.scale.set(1.5, 0.375, 1)
          sezLabel.position.y = cylinderHeight / 2 + 0.5
        }

        if (track.trail && track.trail.length > 1) {
          let trailLine = trailLinesRef.current.get(key)

          if (!trailLine) {
            const MAX_TRAIL = 256
            const posArray = new Float32Array(MAX_TRAIL * 3)
            const geom = new THREE.BufferGeometry()
            geom.setAttribute('position', new THREE.BufferAttribute(posArray, 3))
            geom.setDrawRange(0, 0)

            const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 })

            trailLine = new THREE.Line(geom, mat)
            trailLine.frustumCulled = false
            trailLine.userData.isTrail = true
            trailLine.userData.trackKey = key
            trailLine.visible = showTracksRef.current
            scene.add(trailLine)
            trailLinesRef.current.set(key, trailLine)
          }

          const posAttr = trailLine.geometry.getAttribute('position') as THREE.BufferAttribute
          const buf = posAttr.array as Float32Array
          const maxPts = buf.length / 3
          const count = Math.min(track.trail.length, maxPts)

          for (let i = 0; i < count; i++) {
            buf[i * 3]     = track.trail[i].x
            buf[i * 3 + 1] = 0.02
            buf[i * 3 + 2] = track.trail[i].z
          }

          posAttr.needsUpdate = true
          trailLine.geometry.setDrawRange(0, count)
          ;(trailLine.material as THREE.LineBasicMaterial).color.set(color as any)
        }

        const isCylinderMode = currentTracking.trackDisplayMode === 'cylinder'
        cylinder.visible = isCylinderMode
        topCap.visible = isCylinderMode
        bottomCap.visible = isCylinderMode

        const pointCloud = group.children[4] as THREE.Points | undefined
        const wireframe = group.children[5] as THREE.LineSegments | undefined
        if (pointCloud) pointCloud.visible = !isCylinderMode
        if (wireframe) wireframe.visible = !isCylinderMode

        const cylinderMat = cylinder.material as THREE.MeshStandardMaterial
        const topCapMat = topCap.material as THREE.MeshStandardMaterial
        const bottomCapMat = bottomCap.material as THREE.MeshStandardMaterial

        const effectiveOpacity = isInSez ? Math.min(currentTracking.cylinderOpacity, 0.4) : currentTracking.cylinderOpacity
        cylinderMat.opacity = effectiveOpacity
        topCapMat.opacity = effectiveOpacity
        bottomCapMat.opacity = effectiveOpacity

        if (typeof color === 'string') {
          cylinderMat.color.set(color); cylinderMat.emissive.set(color)
          topCapMat.color.set(color); topCapMat.emissive.set(color)
          bottomCapMat.color.set(color); bottomCapMat.emissive.set(color)
          if (pointCloud) (pointCloud.material as THREE.PointsMaterial).color.set(color)
          if (wireframe) (wireframe.material as THREE.LineBasicMaterial).color.set(color)
        } else {
          cylinderMat.color.setHex(color); cylinderMat.emissive.setHex(color)
          topCapMat.color.setHex(color); topCapMat.emissive.setHex(color)
          bottomCapMat.color.setHex(color); bottomCapMat.emissive.setHex(color)
          if (pointCloud) (pointCloud.material as THREE.PointsMaterial).color.setHex(color)
          if (wireframe) (wireframe.material as THREE.LineBasicMaterial).color.setHex(color)
        }

        const emissiveIntensity = isInSez ? 0.8 : 0.5
        cylinderMat.emissiveIntensity = emissiveIntensity
        topCapMat.emissiveIntensity = emissiveIntensity
        bottomCapMat.emissiveIntensity = emissiveIntensity
      })

      // Clean up stale SEZ entry times
      sezEntryTimesRef.current.forEach((_, key) => {
        if (!allTrackKeys.has(key)) {
          sezEntryTimesRef.current.delete(key)
        }
      })
    }

    const scheduleSync = () => {
      syncTrackMeshes()
      timer = setTimeout(scheduleSync, syncIntervalMs)
    }
    scheduleSync()
    return () => { if (timer) clearTimeout(timer) }
  }, []) // Stable — reads everything via refs

  // Render ROIs (regions of interest) as polygons
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current
    
    // Filter ROIs for 3D display:
    // - HIDE: LaunchPad auto-coverage ROI named "LiDAR Coverage" or "Zone 1" (no metadata)
    // - SHOW: Everything else (Smart KPI ROIs, user-created custom ROIs named Zone 2/3/etc.)
    const isLaunchPadCoverageRoi = (roi: typeof regions[0]) => {
      const hasNoMetadata = !roi.metadata || Object.keys(roi.metadata).length === 0
      // Hide exactly "LiDAR Coverage" or "Zone 1" (the LaunchPad default names)
      const isAutoGenName = roi.name === 'LiDAR Coverage' || roi.name === 'Zone 1'
      return hasNoMetadata && isAutoGenName
    }
    
    const visibleIds = new Set(
      regions.filter(r => !isLaunchPadCoverageRoi(r)).map(r => r.id)
    )

    // Remove deleted ROIs and non-smart-kpi ROIs
    roiMeshesRef.current.forEach((group, id) => {
      if (!visibleIds.has(id)) {
        scene.remove(group)
        group.traverse(child => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
        roiMeshesRef.current.delete(id)
        roiVertexHandlesRef.current.delete(id)
      }
    })

    // Add/update ROIs (only Smart KPI ROIs - LaunchPad coverage zones filtered by visibleIds)
    const visibleRegions = regions.filter(r => visibleIds.has(r.id))
    
    visibleRegions.forEach((roi, idx) => {
      if (roi.vertices.length < 3) return
      
      if (idx === 0) {
        console.log(`[MainViewport] First visible ROI: "${roi.name}" vertices:`, roi.vertices.slice(0, 2))
      }
      
      let group = roiMeshesRef.current.get(roi.id)
      const isSelected = roi.id === selectedRoiId
      const color = new THREE.Color(roi.color)

      if (!group) {
        group = new THREE.Group()
        group.userData.roiId = roi.id
        scene.add(group)
        roiMeshesRef.current.set(roi.id, group)
      }

      // Clear existing children
      while (group.children.length > 0) {
        const child = group.children[0]
        group.remove(child)
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          child.geometry.dispose()
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose())
          } else {
            child.material.dispose()
          }
        }
      }

      // Create polygon directly in X-Z plane using BufferGeometry (no rotation needed)
      // This avoids hit detection issues with rotated ShapeGeometry
      const vertices: number[] = []
      const indices: number[] = []
      
      // Create vertices at Y = 0.02 (just above floor)
      for (const v of roi.vertices) {
        vertices.push(v.x, 0.02, v.z)
      }
      
      // Triangulate the polygon (simple fan triangulation from first vertex)
      for (let i = 1; i < roi.vertices.length - 1; i++) {
        indices.push(0, i, i + 1)
      }
      
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
      geometry.setIndex(indices)
      geometry.computeVertexNormals()
      
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: roi.opacity * (isSelected ? 1.2 : 1),
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.renderOrder = 2
      mesh.userData.roiId = roi.id
      group.add(mesh)

      // Outline
      const outlinePoints = roi.vertices.map(v => new THREE.Vector3(v.x, 0.03, v.z))
      outlinePoints.push(outlinePoints[0].clone()) // Close the loop
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints)
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: isSelected ? 0xffffff : color,
        linewidth: 2,
      })
      const outline = new THREE.Line(outlineGeometry, outlineMaterial)
      group.add(outline)

      // Vertex handles (spheres at each vertex) — use ORIGINAL vertices for data consistency
      const handles: THREE.Mesh[] = []
      const handleSize = 0.15
      roi.vertices.forEach((v, i) => {
        const handleGeometry = new THREE.SphereGeometry(handleSize, 16, 8)
        const handleMaterial = new THREE.MeshBasicMaterial({
          color: isSelected ? 0x3b82f6 : 0xffffff,
        })
        const handle = new THREE.Mesh(handleGeometry, handleMaterial)
        // Position handles at display coordinates
        handle.position.set(roi.vertices[i].x, handleSize, roi.vertices[i].z)
        handle.userData.roiId = roi.id
        handle.userData.vertexIndex = i
        handle.userData.isRoiVertex = true
        handle.visible = isSelected
        group.add(handle)
        handles.push(handle)
      })
      roiVertexHandlesRef.current.set(roi.id, handles)

      // Label (hidden by default, shown on hover)
      const labelDiv = document.createElement('div')
      labelDiv.className = 'roi-label'
      labelDiv.style.cssText = `
        background: rgba(0,0,0,0.85);
        color: white;
        padding: 6px 12px;
        border-radius: 16px;
        font-size: 12px;
        font-family: system-ui, sans-serif;
        white-space: nowrap;
        border: 2px solid ${roi.color};
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
      `
      labelDiv.textContent = roi.name
      labelDiv.dataset.roiId = roi.id
      const label = new CSS2DObject(labelDiv)
      // Position at display centroid
      const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
      const cz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
      label.position.set(cx, 0.5, cz)
      label.userData.roiId = roi.id
      group.add(label)
    })
  }, [regions, selectedRoiId, venue?.scene_source, venue?.dwg_layout_version_id, objects])

  // Render drawing preview
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current

    // Clean up previous drawing visuals
    if (drawingLinesRef.current) {
      scene.remove(drawingLinesRef.current)
      drawingLinesRef.current.geometry.dispose()
      ;(drawingLinesRef.current.material as THREE.Material).dispose()
      drawingLinesRef.current = null
    }
    if (drawingMarkersRef.current) {
      scene.remove(drawingMarkersRef.current)
      drawingMarkersRef.current.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          ;(child.material as THREE.Material).dispose()
        }
      })
      drawingMarkersRef.current = null
    }

    if (!isDrawing || drawingVertices.length === 0) return

    // Draw vertices
    const vertexGroup = new THREE.Group()
    drawingVertices.forEach((v) => {
      const sphereGeometry = new THREE.SphereGeometry(0.2, 16, 8)
      const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b })
      const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial)
      sphere.position.set(v.x, 0.2, v.z)
      vertexGroup.add(sphere)
    })
    scene.add(vertexGroup)
    drawingMarkersRef.current = vertexGroup

    // Draw lines between vertices
    if (drawingVertices.length > 1) {
      const points = drawingVertices.map(v => new THREE.Vector3(v.x, 0.05, v.z))
      // Add closing line to first vertex if we have 3+ vertices
      if (drawingVertices.length >= 3) {
        points.push(points[0].clone())
      }
      const lineGeometry = new THREE.BufferGeometry().setFromPoints(points)
      const lineMaterial = new THREE.LineDashedMaterial({
        color: 0xf59e0b,
        dashSize: 0.3,
        gapSize: 0.15,
      })
      const line = new THREE.Line(lineGeometry, lineMaterial)
      line.computeLineDistances()
      scene.add(line)
      drawingLinesRef.current = line
    }
  }, [isDrawing, drawingVertices])

  // Camera view storage key
  const cameraStorageKey = `venue-camera-view-${venue?.id || 'default'}`
  
  // Check if saved camera view exists
  useEffect(() => {
    const savedView = localStorage.getItem(cameraStorageKey)
    setHasSavedView(!!savedView)
  }, [cameraStorageKey])
  
  // Toggle layer visibility - Objects
  useEffect(() => {
    objectMeshesRef.current.forEach(obj3d => {
      obj3d.visible = showObjectsLayer
    })
  }, [showObjectsLayer, objects])

  // Cluster highlight effect - apply translucent fill + wireframe to highlighted object types
  // Same style as the hovered object tooltip effect (25% opacity fill + cyan edges)
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current

    // Remove existing highlight groups for types no longer highlighted
    clusterHighlightMeshesRef.current.forEach((group, objectId) => {
      const obj = objects.find(o => o.id === objectId)
      if (!obj || !highlightedTypes.includes(obj.type)) {
        scene.remove(group)
        group.traverse(child => {
          if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              ;(child.material as THREE.Material).dispose()
            }
          }
        })
        clusterHighlightMeshesRef.current.delete(objectId)
      }
    })
    
    // Add highlight groups for newly highlighted types
    objects.forEach(obj => {
      if (!highlightedTypes.includes(obj.type)) return
      if (clusterHighlightMeshesRef.current.has(obj.id)) return // Already highlighted
      
      const objectMesh = objectMeshesRef.current.get(obj.id)
      if (!objectMesh) return
      
      const highlightColor = getObjectColorHex(obj, 0x00FFFF)
      
      // Create a group to hold both fill and wireframe
      const highlightGroup = new THREE.Group()
      highlightGroup.name = `cluster-highlight-${obj.id}`
      
      // Create translucent fill box - slightly larger to avoid z-fighting
      const boxGeo = new THREE.BoxGeometry(obj.scale.x * 1.01, obj.scale.y * 1.01, obj.scale.z * 1.01)
      const fillMaterial = new THREE.MeshBasicMaterial({
        color: highlightColor,
        transparent: true,
        opacity: 0.30,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
      const fillMesh = new THREE.Mesh(boxGeo, fillMaterial)
      fillMesh.renderOrder = 999
      highlightGroup.add(fillMesh)
      
      // Create wireframe edges - slightly larger
      const edgesGeo = new THREE.EdgesGeometry(boxGeo)
      const lineMaterial = new THREE.LineBasicMaterial({
        color: highlightColor,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      })
      const edgeLines = new THREE.LineSegments(edgesGeo, lineMaterial)
      edgeLines.renderOrder = 1000
      highlightGroup.add(edgeLines)
      
      // Position at object's position (accounting for y offset - objects sit on floor)
      highlightGroup.position.set(obj.position.x, obj.scale.y / 2, obj.position.z)
      highlightGroup.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z)
      
      scene.add(highlightGroup)
      clusterHighlightMeshesRef.current.set(obj.id, highlightGroup as any)
    })
    
    // Update positions of existing highlights (in case objects moved)
    clusterHighlightMeshesRef.current.forEach((group, objectId) => {
      const obj = objects.find(o => o.id === objectId)
      if (obj) {
        group.position.set(obj.position.x, obj.scale.y / 2, obj.position.z)
        group.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z)
      }
    })
  }, [highlightedTypes, objects])
  
  // Toggle layer visibility - LiDAR
  useEffect(() => {
    lidarMeshesRef.current.forEach(group => {
      group.visible = showLidarLayer
    })
  }, [showLidarLayer, placements])
  
  // Toggle layer visibility - Grid & Floor
  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGridLayer
    if (floorRef.current) floorRef.current.visible = showGridLayer
  }, [showGridLayer])

  // Render/toggle DWG floorplan image overlay in the main 3D Venue.
  // Off by default; uses the same floor-plane orientation as DWG Importer 3D Preview.
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    if (floorplanOverlayRef.current) {
      scene.remove(floorplanOverlayRef.current)
      floorplanOverlayRef.current.geometry.dispose()
      if (floorplanOverlayRef.current.material instanceof THREE.Material) {
        floorplanOverlayRef.current.material.dispose()
      }
      floorplanOverlayRef.current = null
    }

    if (!showFloorplanOverlayLayer || !venue?.dwg_layout_version_id) return

    let cancelled = false
    const loadOverlay = async () => {
      try {
        const layoutRes = await fetch(`${API_BASE}/api/dwg/layout/${venue.dwg_layout_version_id}`)
        if (!layoutRes.ok) return
        const layoutData = await layoutRes.json()
        const importId = layoutData.import_id
        const layout = layoutData.layout
        if (!importId || !layout?.bounds) return

        const scaleCorrection = (() => {
          try {
            const parsed = JSON.parse(venue.dwg_transform_json || '{}')
            return parsed.scaleCorrection || 1
          } catch { return 1 }
        })()
        const bootstrapRes = await fetch(`${API_BASE}/api/dwg/layout/${venue.dwg_layout_version_id}/as-venue-bootstrap?scaleCorrection=${scaleCorrection}`)
        if (!bootstrapRes.ok) return
        const bootstrap = await bootstrapRes.json()
        const bootstrapTransform = bootstrap.transform || {}

        const metaRes = await fetch(`${API_BASE}/api/dwg/import/${importId}/floorplan`)
        if (!metaRes.ok) return
        const metaData = await metaRes.json()
        if (!metaData.floorplan) return

        const fp = metaData.floorplan
        const transform = fp.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 }
        const effectiveScale = bootstrapTransform.effectiveScale || ((layout.unit_scale_to_m || 0.001) * scaleCorrection)
        const centerX = bootstrapTransform.centerOffset?.x ?? ((layout.bounds.minX + layout.bounds.maxX) / 2 * effectiveScale)
        const centerZ = bootstrapTransform.centerOffset?.z ?? ((layout.bounds.minY + layout.bounds.maxY) / 2 * effectiveScale)
        const venueSize = bootstrapTransform.venueSize || { width: venue.width || 0, depth: venue.depth || 0 }
        const shift = bootstrapTransform.shift || { x: 0, z: 0 }
        const venueFloorCenterX = venueSize.width / 2
        const venueFloorCenterZ = venueSize.depth / 2
        const contentCenterX = venueFloorCenterX - shift.x
        const contentCenterZ = venueFloorCenterZ - shift.z
        const dxfToVenueWorld = (xDxf: number, yDxf: number) => ({
          x: venueFloorCenterX + ((xDxf * effectiveScale - centerX) - contentCenterX),
          z: venueFloorCenterZ - ((yDxf * effectiveScale - centerZ) - contentCenterZ),
        })

        textureLoaderRef.current.load(`${API_BASE}/api/dwg/import/${importId}/floorplan/image`, texture => {
          if (cancelled || !sceneRef.current) return
          texture.wrapS = THREE.ClampToEdgeWrapping
          texture.wrapT = THREE.ClampToEdgeWrapping
          const imgW = texture.image.width
          const imgH = texture.image.height
          const dxfW = imgW * transform.scaleX
          const dxfH = imgH * transform.scaleY
          const planeW = dxfW * effectiveScale
          const planeD = dxfH * effectiveScale
          const imgCenterDxfX = transform.x + dxfW / 2
          const imgCenterDxfY = transform.y + dxfH / 2
          const worldCenter = dxfToVenueWorld(imgCenterDxfX, imgCenterDxfY)

          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(planeW, planeD),
            new THREE.MeshBasicMaterial({
              map: texture,
              transparent: true,
              opacity: transform.opacity ?? 0.5,
              side: THREE.DoubleSide,
              depthWrite: false,
            })
          )
          mesh.name = 'VenueFloorplanOverlay'
          mesh.position.set(worldCenter.x, 0.015, worldCenter.z)
          // Keep the overlay aligned with the map axes while testing the requested 180-degree flips.
          mesh.rotation.x = Math.PI / 2
          mesh.rotation.y = Math.PI
          if (transform.rotation) mesh.rotation.z = -transform.rotation * Math.PI / 180
          mesh.renderOrder = 1
          sceneRef.current.add(mesh)
          floorplanOverlayRef.current = mesh
        })
      } catch (err) {
        console.warn('[MainViewport] Failed to load DWG floorplan overlay:', err)
      }
    }
    loadOverlay()

    return () => {
      cancelled = true
    }
  }, [showFloorplanOverlayLayer, venue?.dwg_layout_version_id, venue?.dwg_transform_json])
  
  // Toggle layer visibility - ROI Zones
  useEffect(() => {
    roiMeshesRef.current.forEach((group, roiId) => {
      group.visible = showRoiLayer
    })
    // Vertex handles only visible when ROI is selected AND layer is visible
    roiVertexHandlesRef.current.forEach((handles, roiId) => {
      const isSelected = roiId === selectedRoiId
      handles.forEach(h => { h.visible = showRoiLayer && isSelected })
    })
  }, [showRoiLayer, regions, selectedRoiId])
  
  // Pulse animation for highlighted zones during Insight Mode
  useEffect(() => {
    if (!isInsightMode || !selectedEpisode?.highlight_zones) {
      // Reset any previously highlighted zones to normal
      roiMeshesRef.current.forEach((group) => {
        group.children.forEach(child => {
          if (child instanceof THREE.Mesh && child.userData.roiId && !child.userData.isRoiVertex) {
            const material = child.material as THREE.MeshBasicMaterial
            if (material.userData?.originalOpacity !== undefined) {
              material.opacity = material.userData.originalOpacity
              delete material.userData.originalOpacity
            }
          }
        })
      })
      return
    }

    const highlightedIds = new Set(selectedEpisode.highlight_zones.map((z: { id: string }) => z.id))
    let animationId: number
    let startTime = Date.now()

    const animate = () => {
      const elapsed = Date.now() - startTime
      // Pulse: oscillate between 0.3 and 0.8 opacity over 1.2 seconds
      const pulse = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(elapsed / 190))

      roiMeshesRef.current.forEach((group, roiId) => {
        group.children.forEach(child => {
          if (child instanceof THREE.Mesh && child.userData.roiId && !child.userData.isRoiVertex) {
            const material = child.material as THREE.MeshBasicMaterial
            if (highlightedIds.has(roiId)) {
              // Store original opacity if not stored
              if (material.userData?.originalOpacity === undefined) {
                material.userData = material.userData || {}
                material.userData.originalOpacity = material.opacity
              }
              material.opacity = pulse
            }
          }
        })
      })

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      cancelAnimationFrame(animationId)
      // Reset opacities on cleanup
      roiMeshesRef.current.forEach((group) => {
        group.children.forEach(child => {
          if (child instanceof THREE.Mesh && child.userData.roiId && !child.userData.isRoiVertex) {
            const material = child.material as THREE.MeshBasicMaterial
            if (material.userData?.originalOpacity !== undefined) {
              material.opacity = material.userData.originalOpacity
              delete material.userData.originalOpacity
            }
          }
        })
      })
    }
  }, [isInsightMode, selectedEpisode])
  
  // Toggle layer visibility - Tracks (bounding boxes + trail lines)
  const { setTrackVisibility } = useTrackingActions()
  useEffect(() => {
    trackMeshesRef.current.forEach(group => {
      group.visible = showTracksLayer
    })
    trailLinesRef.current.forEach(trail => {
      trail.visible = showTracksLayer
    })
  }, [showTracksLayer])
  // Notify backend to throttle KPI processing when tracks are visible (demo mode)
  // Separate effect so it only fires on toggle, not every track update
  useEffect(() => {
    setTrackVisibility(showTracksLayer)
  }, [showTracksLayer])

  // ═══════════ NEURAL X-RAY MODE ═══════════
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    if (xrayMode) {
      // --- Transition to X-Ray ---
      scene.background = new THREE.Color(0x050510)

      // Dim lights
      if (ambientLightRef.current) ambientLightRef.current.intensity = 0.15
      if (directionalLightRef.current) directionalLightRef.current.intensity = 0.1

      // Save track state and hide by default (user can re-enable via layer toggle)
      preXrayTracksRef.current = showTracksLayer
      setShowTracksLayer(false)
      // Immediately force-hide all existing tracks + trails (state is async)
      trackMeshesRef.current.forEach(g => { g.visible = false })
      trailLinesRef.current.forEach(t => { t.visible = false })

      // Hide ROI fill meshes (keep edges only via reduced opacity)
      roiMeshesRef.current.forEach(g => { g.visible = false })

      // Switch fixture materials to wireframe glow
      objectMeshesRef.current.forEach((obj3d, objId) => {
        obj3d.traverse(child => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeLines) {
            const mat = child.material as THREE.MeshStandardMaterial
            if (!xrayPrevMaterialsRef.current.has(child.uuid)) {
              xrayPrevMaterialsRef.current.set(child.uuid, {
                color: mat.color.getHex(),
                opacity: mat.opacity,
                transparent: mat.transparent,
                wireframe: mat.wireframe,
                emissiveHex: mat.emissive.getHex(),
                emissiveIntensity: mat.emissiveIntensity,
              })
            }
            mat.transparent = true
            mat.opacity = 0.06
            mat.wireframe = false
            mat.depthWrite = false
            mat.emissive.setHex(mat.color.getHex())
            mat.emissiveIntensity = 0.15
            mat.needsUpdate = true
          }
          // Brighten edge lines
          if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
            const lm = child.material as THREE.LineBasicMaterial
            if (lm.color) {
              lm.color.setHex(0x00ffff)
              lm.opacity = 0.7
              lm.transparent = true
              lm.needsUpdate = true
            }
          }
        })
      })

      // Hide grid, keep floor dark
      if (gridRef.current) gridRef.current.visible = false
    } else {
      // --- Restore from X-Ray ---
      scene.background = new THREE.Color(0x0f0f14)

      if (ambientLightRef.current) ambientLightRef.current.intensity = lighting.ambientIntensity
      if (directionalLightRef.current) directionalLightRef.current.intensity = lighting.directionalIntensity

      // Restore tracks to pre-xray state (default visible if unset)
      setShowTracksLayer(preXrayTracksRef.current ?? true)
      roiMeshesRef.current.forEach(g => { g.visible = showRoiLayer })

      // Restore fixture materials
      objectMeshesRef.current.forEach((obj3d) => {
        obj3d.traverse(child => {
          if (child instanceof THREE.Mesh && !child.userData.isEdgeLines) {
            const prev = xrayPrevMaterialsRef.current.get(child.uuid)
            if (prev) {
              const mat = child.material as THREE.MeshStandardMaterial
              mat.color.setHex(prev.color)
              mat.opacity = prev.opacity
              mat.transparent = prev.transparent
              mat.wireframe = prev.wireframe
              mat.depthWrite = prev.opacity >= 1.0
              mat.emissive.setHex(prev.emissiveHex)
              mat.emissiveIntensity = prev.emissiveIntensity
              mat.needsUpdate = true
            }
          }
          if (child instanceof THREE.LineSegments || child instanceof THREE.Line) {
            const lm = child.material as THREE.LineBasicMaterial
            if (lm.color) {
              lm.color.setHex(0x00ffff)
              lm.opacity = 0.6
              lm.transparent = true
              lm.needsUpdate = true
            }
          }
        })
      })
      xrayPrevMaterialsRef.current.clear()

      if (gridRef.current) gridRef.current.visible = showGridLayer
    }
  }, [xrayMode])

  // ═══════════ X-RAY KPI HALOS (A: category consolidation, B: filter, D: threshold) ═══════════
  const XRAY_MIN_VISITS = 2        // Strategy D: minimum activity to show a halo
  const XRAY_MAX_CATEGORIES = 12   // Strategy A: cap total category halos

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    // Remove old halos
    xrayHalosRef.current.forEach(halo => {
      scene.remove(halo)
      halo.element.remove()
    })
    xrayHalosRef.current.clear()
    xrayHaloTiersRef.current.clear()

    if (!xrayMode || !xrayData) return

    // ─── Shelf halos: category consolidation + per-shelf for categorized shelves ───
    if (xrayFilters.shelves) {
      // Step 1: Category-level summary halos (one per product category)
      const categoryMap = new Map<string, { visits: number; dwells: number; engagements: number; avgDwellWeighted: number; peakOccupancy: number; cx: number; cz: number; count: number }>()
      // Step 2: Per-shelf halos for shelves WITH categories (merged L/R)
      const shelfMap = new Map<string, { name: string; cat: string; visits: number; dwells: number; engagements: number; avgDwellW: number; peakOcc: number; cx: number; cz: number; count: number }>()

      for (const zone of xrayData.zones) {
        if (zone.template !== 'shelf-engagement' || !zone.position) continue
        const hasCat = zone.categories && zone.categories.length > 0
        const cat = hasCat ? zone.categories![0] : null

        // Only aggregate into category map if zone has a real category
        if (cat) {
          const existing = categoryMap.get(cat)
          if (existing) {
            existing.visits += zone.visits; existing.dwells += zone.dwells; existing.engagements += zone.engagements
            existing.avgDwellWeighted += zone.avgDwellSec * zone.visits
            existing.peakOccupancy = Math.max(existing.peakOccupancy, zone.peakOccupancy)
            existing.cx += zone.position.x; existing.cz += zone.position.z; existing.count += 1
          } else {
            categoryMap.set(cat, { visits: zone.visits, dwells: zone.dwells, engagements: zone.engagements, avgDwellWeighted: zone.avgDwellSec * zone.visits, peakOccupancy: zone.peakOccupancy, cx: zone.position.x, cz: zone.position.z, count: 1 })
          }
        }

        // Per-shelf merged L/R (only for categorized shelves)
        if (cat && zone.shelfId) {
          const existing = shelfMap.get(zone.shelfId)
          if (existing) {
            existing.visits += zone.visits; existing.dwells += zone.dwells; existing.engagements += zone.engagements
            existing.avgDwellW += zone.avgDwellSec * zone.visits; existing.peakOcc = Math.max(existing.peakOcc, zone.peakOccupancy)
            existing.cx += zone.position.x; existing.cz += zone.position.z; existing.count += 1
          } else {
            const shelfLabel = zone.name.replace(/\s*-\s*Engagement.*$/i, '')
            shelfMap.set(zone.shelfId, { name: shelfLabel, cat, visits: zone.visits, dwells: zone.dwells, engagements: zone.engagements, avgDwellW: zone.avgDwellSec * zone.visits, peakOcc: zone.peakOccupancy, cx: zone.position.x, cz: zone.position.z, count: 1 })
          }
        }
      }

      // Create category summary halos (tier 2 — visible at medium+ zoom)
      for (const [catName, agg] of categoryMap) {
        const avgDwell = agg.visits > 0 ? agg.avgDwellWeighted / agg.visits : 0
        const convRate = agg.engagements > 0 && agg.visits > 0 ? ((agg.engagements / agg.visits) * 100).toFixed(0) : '0'
        const cx = agg.cx / agg.count, cz = agg.cz / agg.count

        const el = document.createElement('div')
        el.className = 'xray-halo'
        el.dataset.tier = '2'
        el.innerHTML = `
          <div class="xray-halo-tag">${catName}</div>
          <div class="xray-halo-body">
            <div class="xray-halo-row"><span class="xray-halo-val">${agg.visits}</span> <span class="xray-halo-lbl">visits</span> <span class="xray-halo-val">${avgDwell.toFixed(1)}s</span> <span class="xray-halo-lbl">dwell</span></div>
            <div class="xray-halo-row"><span class="xray-halo-val">${convRate}%</span> <span class="xray-halo-lbl">engage</span> <span class="xray-halo-val">${agg.peakOccupancy}</span> <span class="xray-halo-lbl">peak</span></div>
          </div>
        `
        const haloId = `cat:${catName}`
        const label = new CSS2DObject(el)
        label.position.set(cx, 3.5, cz)
        scene.add(label)
        xrayHalosRef.current.set(haloId, label)
        xrayHaloTiersRef.current.set(haloId, 2)
      }

      // Create per-shelf halos (tier 3 — close zoom only)
      for (const [shelfId, s] of shelfMap) {
        const avgDwell = s.visits > 0 ? s.avgDwellW / s.visits : 0
        const cx = s.cx / s.count, cz = s.cz / s.count

        const el = document.createElement('div')
        el.className = 'xray-halo'
        el.dataset.tier = '3'
        el.innerHTML = `
          <div class="xray-halo-tag">${s.name} <span style="opacity:.5;font-size:8px">${s.cat}</span></div>
          <div class="xray-halo-body">
            <div class="xray-halo-row"><span class="xray-halo-val">${s.visits}</span> <span class="xray-halo-lbl">visits</span> <span class="xray-halo-val">${avgDwell.toFixed(1)}s</span> <span class="xray-halo-lbl">dwell</span></div>
          </div>
        `
        const haloId = `shelf:${shelfId}`
        const label = new CSS2DObject(el)
        label.position.set(cx, 2.8, cz)
        scene.add(label)
        xrayHalosRef.current.set(haloId, label)
        xrayHaloTiersRef.current.set(haloId, 3)
      }
    }

    // ─── Queue / checkout zones: individual halos with Y-stagger to avoid overlap ───
    if (xrayFilters.queues) {
      const queueZones = xrayData.zones.filter(z =>
        z.template === 'cashier-queue' && z.position
      )
      // Merge Service+Queue per checkout name
      const checkoutMap = new Map<string, { visits: number; avgWaitMs: number; queueDepth: number; cx: number; cz: number; count: number }>()
      for (const z of queueZones) {
        const cName = z.name.replace(/\s*-\s*(Queue|Service)\s*/i, '')
        const existing = checkoutMap.get(cName)
        const wait = (z as any).avgWaitMs || 0
        const depth = (z as any).queueDepth || z.peakOccupancy
        if (existing) {
          existing.visits += z.visits; existing.avgWaitMs = Math.max(existing.avgWaitMs, wait)
          existing.queueDepth = Math.max(existing.queueDepth, depth)
          existing.cx += z.position.x; existing.cz += z.position.z; existing.count += 1
        } else {
          checkoutMap.set(cName, { visits: z.visits, avgWaitMs: wait, queueDepth: depth, cx: z.position.x, cz: z.position.z, count: 1 })
        }
      }

      // Sort by position (x then z) for consistent stagger order
      const checkouts = [...checkoutMap.entries()]
        .map(([name, d]) => ({ name, ...d, cx: d.cx / d.count, cz: d.cz / d.count }))
        .sort((a, b) => a.cx - b.cx || a.cz - b.cz)

      // Y-stagger: cycle through 3 heights so adjacent checkouts don't overlap
      const Y_LEVELS = [2.5, 4.5, 6.5]

      for (let i = 0; i < checkouts.length; i++) {
        const c = checkouts[i]
        const avgWaitSec = c.avgWaitMs > 0 ? (c.avgWaitMs / 1000).toFixed(0) : '—'
        const status = c.queueDepth > 6 ? 'BUSY' : c.queueDepth > 3 ? 'MODERATE' : 'OK'
        const statusClass = c.queueDepth > 6 ? 'xray-status-red' : c.queueDepth > 3 ? 'xray-status-amber' : 'xray-status-green'
        const shortName = c.name.replace('Checkout ', '#')

        const el = document.createElement('div')
        el.className = 'xray-halo xray-halo-compact'
        el.innerHTML = `
          <div class="xray-halo-tag xray-tag-queue">${shortName}</div>
          <div class="xray-halo-body">
            <div class="xray-halo-row"><span class="xray-halo-val">${avgWaitSec}s</span> <span class="xray-halo-lbl">w</span> <span class="xray-halo-val">${c.queueDepth}</span> <span class="xray-halo-lbl">q</span> <span class="xray-halo-badge ${statusClass}">${status}</span></div>
          </div>
        `

        const haloId = `checkout:${c.name}`
        const label = new CSS2DObject(el)
        const yLevel = Y_LEVELS[i % Y_LEVELS.length]
        label.position.set(c.cx, yLevel, c.cz)
        scene.add(label)
        xrayHalosRef.current.set(haloId, label)
      }
    }

    // ─── Other non-shelf, non-queue zones (tier 3) ───
    const miscZones = xrayData.zones.filter(z =>
      z.template !== 'shelf-engagement' && z.template !== 'cashier-queue' &&
      z.position && z.visits >= XRAY_MIN_VISITS
    )
    for (const zone of miscZones) {
      const el = document.createElement('div')
      el.className = 'xray-halo'
      el.dataset.tier = '3'
      el.innerHTML = `
        <div class="xray-halo-tag xray-tag-zone">${zone.name}</div>
        <div class="xray-halo-body">
          <div class="xray-halo-row"><span class="xray-halo-val">${zone.visits}</span> <span class="xray-halo-lbl">visits</span> <span class="xray-halo-val">${zone.avgDwellSec.toFixed(1)}s</span> <span class="xray-halo-lbl">dwell</span></div>
        </div>
      `

      const label = new CSS2DObject(el)
      label.position.set(zone.position.x, 3.5, zone.position.z)
      scene.add(label)
      xrayHalosRef.current.set(zone.roiId, label)
      xrayHaloTiersRef.current.set(zone.roiId, 3)
    }

    // ─── DOOH Screen halos (tier 1 — always visible) ───
    if (xrayFilters.screens) {
      for (const screen of xrayData.doohScreens) {
        if (!screen.position) continue

        const el = document.createElement('div')
        el.className = 'xray-halo xray-halo-dooh'
        el.dataset.tier = '1'

        const liftStr = screen.liftRel !== null && screen.liftRel !== undefined
          ? `${screen.liftRel >= 0 ? '▲' : '▼'} ${(Math.abs(screen.liftRel) * 100).toFixed(0)}%`
          : '—'
        const liftClass = screen.liftRel >= 0 ? 'xray-lift-pos' : 'xray-lift-neg'

        el.innerHTML = `
          <div class="xray-halo-tag xray-tag-dooh">📺 ${screen.name.replace('Digital_display ', 'DS-')}</div>
          <div class="xray-halo-body">
            <div class="xray-halo-row"><span class="xray-halo-val">${screen.exposures}</span> <span class="xray-halo-lbl">exp</span> <span class="xray-halo-val">${screen.avgAqs.toFixed(0)}</span> <span class="xray-halo-lbl">AQS</span></div>
            <div class="xray-halo-row"><span class="xray-halo-val">${screen.conversionRate.toFixed(1)}%</span> <span class="xray-halo-lbl">conv</span> <span class="${liftClass}">${liftStr}</span> <span class="xray-halo-lbl">lift</span></div>
            ${screen.campaignName ? `<div class="xray-halo-campaign">${screen.campaignName}</div>` : ''}
          </div>
        `

        const label = new CSS2DObject(el)
        label.position.set(screen.position.x, 4.5, screen.position.z)
        scene.add(label)
        xrayHalosRef.current.set(screen.screenId, label)
        xrayHaloTiersRef.current.set(screen.screenId, 1)
      }
    }

    // ─── Hover-to-explode: spiral fan-out of overlapping halos ───
    const OVERLAP_PX = 60
    let collapseTimer: ReturnType<typeof setTimeout> | null = null
    let activeGroupInners: HTMLElement[] = []

    // Wrap each halo's DOM children in an inner div for independent translation
    const allHaloEls: HTMLElement[] = []
    xrayHalosRef.current.forEach(cssObj => {
      const el = cssObj.element as HTMLElement
      const inner = document.createElement('div')
      inner.className = 'xray-halo-inner'
      while (el.firstChild) inner.appendChild(el.firstChild)
      el.appendChild(inner)
      allHaloEls.push(el)
    })

    // Archimedean spiral positions: r = a + b*θ
    const spiralPositions = (count: number, cardW: number, cardH: number): { x: number; y: number }[] => {
      if (count <= 1) return [{ x: 0, y: 0 }]
      const positions: { x: number; y: number }[] = [{ x: 0, y: 0 }] // center stays
      const minGap = Math.max(cardW, cardH) + 8 // minimum distance between card centers
      const angleStep = 0.85 // radians per step — controls tightness
      const radiusGrowth = minGap / (2 * Math.PI) * angleStep // grow enough each revolution to not overlap
      let angle = 0
      let radius = minGap * 0.7 // start first ring at ~card-width away
      for (let i = 1; i < count; i++) {
        angle += angleStep
        radius += radiusGrowth
        positions.push({
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
        })
      }
      return positions
    }

    const collapseGroup = () => {
      for (const inner of activeGroupInners) {
        inner.style.transform = ''
        inner.style.zIndex = ''
      }
      activeGroupInners = []
    }

    const handleEnter = (e: Event) => {
      if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null }
      const target = e.currentTarget as HTMLElement
      const inner = target.querySelector('.xray-halo-inner') as HTMLElement | null
      if (!inner) return

      if (activeGroupInners.includes(inner) && activeGroupInners.length > 1) return

      collapseGroup()

      const tRect = target.getBoundingClientRect()
      const tCx = tRect.left + tRect.width / 2
      const tCy = tRect.top + tRect.height / 2

      const group: { el: HTMLElement; inner: HTMLElement; cx: number; cy: number }[] = []
      for (const el of allHaloEls) {
        if (el.offsetParent === null) continue
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        if (Math.hypot(cx - tCx, cy - tCy) < OVERLAP_PX) {
          const inn = el.querySelector('.xray-halo-inner') as HTMLElement
          if (inn) group.push({ el, inner: inn, cx, cy })
        }
      }

      if (group.length <= 1) return

      activeGroupInners = group.map(g => g.inner)

      // Measure a representative card to size the spiral
      const sampleRect = group[0].inner.getBoundingClientRect()
      const cardW = sampleRect.width || 90
      const cardH = sampleRect.height || 40
      const positions = spiralPositions(group.length, cardW, cardH)

      // Stagger animation delay for a blossoming effect
      group.forEach((g, i) => {
        const p = positions[i]
        const delay = i * 30 // ms stagger
        g.inner.style.transition = `transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay}ms`
        g.inner.style.transform = `translate(${p.x.toFixed(0)}px, ${p.y.toFixed(0)}px)`
        g.inner.style.zIndex = `${200 + i}`
      })
    }

    const handleLeave = () => {
      if (collapseTimer) clearTimeout(collapseTimer)
      collapseTimer = setTimeout(() => {
        activeGroupInners.forEach((inner, i) => {
          inner.style.transition = `transform 0.25s cubic-bezier(0.5, 0, 0.75, 0) ${i * 15}ms`
        })
        requestAnimationFrame(collapseGroup)
      }, 300)
    }

    for (const el of allHaloEls) {
      el.addEventListener('mouseenter', handleEnter)
      el.addEventListener('mouseleave', handleLeave)
    }

  }, [xrayMode, xrayData, xrayFilters])

  
  // Load shelf planogram when planogramSelectedShelfId changes
  useEffect(() => {
    if (planogramSelectedShelfId && activePlanogram) {
      loadShelfPlanogram(planogramSelectedShelfId)
    }
  }, [planogramSelectedShelfId, activePlanogram, loadShelfPlanogram])
  
  // Close layers panel when planogram strip is shown
  useEffect(() => {
    if (showPlanogramLayer && planogramSelectedShelfId) {
      setShowLayersPanel(false)
    }
  }, [showPlanogramLayer, planogramSelectedShelfId])
  
  // Highlight shelves with planogram data when layer is enabled
  useEffect(() => {
    if (!sceneRef.current) return
    
    // Get set of shelf IDs that have filled planograms
    const shelvesWithPlanograms = new Set<string>()
    
    // Check activePlanogram.shelves for shelf data
    if (activePlanogram?.shelves) {
      activePlanogram.shelves.forEach(sp => {
        // Check if shelf has any SKUs placed
        const hasSkus = sp.slots?.levels?.some(level => 
          level.slots?.some(slot => slot.skuItemId)
        )
        if (hasSkus) {
          shelvesWithPlanograms.add(sp.shelfId)
        }
      })
    }
    
    // Also check allShelfPlanograms cache
    allShelfPlanograms.forEach((sp, shelfId) => {
      const hasSkus = sp.slots?.levels?.some(level => 
        level.slots?.some(slot => slot.skuItemId)
      )
      if (hasSkus) {
        shelvesWithPlanograms.add(shelfId)
      }
    })
    
    // Apply/remove highlight to shelf meshes
    objectMeshesRef.current.forEach((mesh, objectId) => {
      const obj = objects.find(o => o.id === objectId)
      if (!obj || obj.type !== 'shelf') return
      
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh && child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          materials.forEach(mat => {
            if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshPhongMaterial) {
              if (showPlanogramLayer && shelvesWithPlanograms.has(objectId)) {
                // Store original emissive if not already stored
                if (!mat.userData.originalEmissive) {
                  mat.userData.originalEmissive = mat.emissive.clone()
                  mat.userData.originalEmissiveIntensity = mat.emissiveIntensity
                }
                // Apply subtle green glow
                mat.emissive.setHex(0x22c55e)
                mat.emissiveIntensity = 0.3
              } else if (mat.userData.originalEmissive) {
                // Restore original
                mat.emissive.copy(mat.userData.originalEmissive)
                mat.emissiveIntensity = mat.userData.originalEmissiveIntensity || 0
              }
            }
          })
        }
      })
    })
  }, [showPlanogramLayer, activePlanogram, allShelfPlanograms, objects])
  
  // Get selected shelf object for planogram strip
  const planogramSelectedShelf = useMemo(() => {
    if (!planogramSelectedShelfId) return null
    return objects.find(o => o.id === planogramSelectedShelfId) || null
  }, [planogramSelectedShelfId, objects])
  
  // Calculate slot mapping for 3D hover → 2D highlight
  const getSlotFromShelfPosition = useCallback((
    localX: number, 
    localZ: number, 
    shelf: typeof planogramSelectedShelf
  ): { levelIndex: number; slotIndex: number } | null => {
    if (!shelf || !activeShelfPlanogram) return null
    
    const shelfWidth = shelf.scale?.x || 2.0
    const shelfHeight = shelf.scale?.y || 2.0
    const numLevels = activeShelfPlanogram.numLevels || 4
    const slotWidthM = activeShelfPlanogram.slotWidthM || 0.1
    const slotsPerLevel = Math.floor(shelfWidth / slotWidthM)
    
    // localX is along shelf width (-shelfWidth/2 to +shelfWidth/2)
    // localZ is depth (ignored for slot calculation on front face)
    const normalizedX = (localX + shelfWidth / 2) / shelfWidth
    const slotIndex = Math.min(Math.floor(normalizedX * slotsPerLevel), slotsPerLevel - 1)
    
    // Y position determines level (assuming levels are evenly distributed)
    // This would need the actual Y coordinate from the raycast hit
    // For now, use level 0 as placeholder - will be enhanced with raycast Y
    const levelIndex = 0
    
    return { levelIndex: Math.max(0, levelIndex), slotIndex: Math.max(0, slotIndex) }
  }, [activeShelfPlanogram])
  
  // Toggle pan mode
  const togglePanMode = useCallback(() => {
    if (!controlsRef.current) return
    
    const newPanMode = !panMode
    setPanMode(newPanMode)
    
    if (newPanMode) {
      controlsRef.current.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
      }
    } else {
      controlsRef.current.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      }
    }
  }, [panMode])
  
  // Save current camera view
  const saveCameraView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return
    
    const viewData = {
      position: cameraRef.current.position.toArray(),
      target: controlsRef.current.target.toArray(),
      zoom: cameraRef.current.zoom,
      fov: cameraRef.current.fov
    }
    localStorage.setItem(cameraStorageKey, JSON.stringify(viewData))
    setHasSavedView(true)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1500)
  }, [cameraStorageKey])
  
  // Restore saved camera view
  const restoreCameraView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return
    
    const saved = localStorage.getItem(cameraStorageKey)
    if (!saved) return
    
    try {
      const viewData = JSON.parse(saved)
      cameraRef.current.position.fromArray(viewData.position)
      controlsRef.current.target.fromArray(viewData.target)
      if (viewData.zoom) cameraRef.current.zoom = viewData.zoom
      if (viewData.fov) cameraRef.current.fov = viewData.fov
      cameraRef.current.updateProjectionMatrix()
      controlsRef.current.update()
    } catch (err) {
      console.error('Failed to restore camera view:', err)
    }
  }, [cameraStorageKey])
  
  // Set preset camera views
  const setCameraPreset = useCallback((preset: 'top' | 'front' | 'side' | 'reset') => {
    if (!cameraRef.current || !controlsRef.current || !venue) return
    
    const distance = Math.max(venue.width, venue.depth) * 1.2
    
    switch (preset) {
      case 'top':
        cameraRef.current.position.set(0, distance, 0.01)
        controlsRef.current.target.set(0, 0, 0)
        break
      case 'front':
        cameraRef.current.position.set(0, venue.height / 2, distance)
        controlsRef.current.target.set(0, venue.height / 2, 0)
        break
      case 'side':
        cameraRef.current.position.set(distance, venue.height / 2, 0)
        controlsRef.current.target.set(0, venue.height / 2, 0)
        break
      case 'reset': {
        const cx = venue.width / 2, cz = venue.depth / 2
        const md = Math.max(venue.width, venue.depth)
        cameraRef.current.position.set(cx + md * 0.6, md * 0.45, cz + md * 0.6)
        controlsRef.current.target.set(cx, 0, cz)
        break
      }
    }
    
    cameraRef.current.updateProjectionMatrix()
    controlsRef.current.update()
  }, [venue])

  // SKU Debug: Highlight exact slot position on hover (1m x 1m rectangle)
  useEffect(() => {
    if (!sceneRef.current) return
    
    // Remove existing highlight
    if (skuHighlightMeshRef.current) {
      sceneRef.current.remove(skuHighlightMeshRef.current)
      skuHighlightMeshRef.current.geometry.dispose()
      ;(skuHighlightMeshRef.current.material as THREE.Material).dispose()
      skuHighlightMeshRef.current = null
    }
    
    // Create new highlight at exact slot position
    if (hoveredSkuShelf) {
      // Use slot position if available, otherwise fall back to shelf position
      const slotPos = hoveredSkuShelf.slotPosition || hoveredSkuShelf.position
      const shelfRotation = hoveredSkuShelf.shelfRotation || 0
      
      // Create a 1m x 1m highlight box at the slot position
      const SLOT_HIGHLIGHT_SIZE = 1.0 // 1 meter
      const geometry = new THREE.BoxGeometry(SLOT_HIGHLIGHT_SIZE, 2.0, SLOT_HIGHLIGHT_SIZE)
      const material = new THREE.MeshBasicMaterial({
        color: 0x00ff88,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      })
      
      const highlightMesh = new THREE.Mesh(geometry, material)
      highlightMesh.position.set(
        slotPos.x,
        1.0, // Center at 1m height (eye level)
        slotPos.z
      )
      highlightMesh.rotation.y = shelfRotation
      highlightMesh.name = 'sku-slot-highlight'
      
      // Add wireframe for better visibility
      const wireframe = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x00ff88, linewidth: 2 })
      )
      highlightMesh.add(wireframe)
      
      // Add a vertical line/pole to make it more visible from above
      const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, 3, 8)
      const poleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff88 })
      const pole = new THREE.Mesh(poleGeometry, poleMaterial)
      pole.position.set(0, 0.5, 0)
      highlightMesh.add(pole)
      
      sceneRef.current.add(highlightMesh)
      skuHighlightMeshRef.current = highlightMesh
    }
  }, [hoveredSkuShelf])

  const handleAreaSelectMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const start = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    areaSelectStartRef.current = start
    setAreaSelectRect({ x: start.x, y: start.y, w: 0, h: 0 })
  }, [])

  const handleAreaSelectMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!areaSelectStartRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    const current = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    const start = areaSelectStartRef.current
    setAreaSelectRect({
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      w: Math.abs(current.x - start.x),
      h: Math.abs(current.y - start.y),
    })
  }, [])

  const handleAreaSelectMouseUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const selection = areaSelectRect
    areaSelectStartRef.current = null
    setAreaSelectRect(null)
    if (!selection || selection.w < 8 || selection.h < 8 || !cameraRef.current || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const selectedIds: string[] = []
    const projected = new THREE.Vector3()
    for (const obj of objectsRef.current) {
      projected.set(obj.position.x, obj.position.y || 0, obj.position.z).project(cameraRef.current)
      if (projected.z > 1) continue
      const sx = (projected.x * 0.5 + 0.5) * rect.width
      const sy = (-projected.y * 0.5 + 0.5) * rect.height
      if (sx >= selection.x && sx <= selection.x + selection.w && sy >= selection.y && sy <= selection.y + selection.h) {
        selectedIds.push(obj.id)
      }
    }
    selectObjectsRef.current(selectedIds)
  }, [areaSelectRect])

  // Auto slot highlights (multiple rectangles when autoShowSlotHighlight is enabled)
  useEffect(() => {
    if (!sceneRef.current) return
    
    // Remove existing auto highlights
    autoSlotMeshesRef.current.forEach(mesh => {
      sceneRef.current?.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    })
    autoSlotMeshesRef.current = []
    
    // Create new highlights for each auto slot position
    if (tracking.autoShowSlotHighlight && autoSlotPositions.length > 0) {
      const SLOT_SIZE = 1.0
      
      autoSlotPositions.forEach((slotPos, index) => {
        const geometry = new THREE.BoxGeometry(SLOT_SIZE, 2.0, SLOT_SIZE)
        const material = new THREE.MeshBasicMaterial({
          color: 0xff6600, // Orange for auto highlights
          transparent: true,
          opacity: 0.4,
          side: THREE.DoubleSide,
        })
        
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(slotPos.x, 1.0, slotPos.z)
        mesh.rotation.y = slotPos.rotation || 0
        mesh.name = `auto-slot-highlight-${index}`
        
        // Add wireframe
        const wireframe = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 })
        )
        mesh.add(wireframe)
        
        sceneRef.current?.add(mesh)
        autoSlotMeshesRef.current.push(mesh)
      })
    }
  }, [tracking.autoShowSlotHighlight, autoSlotPositions])

  // XYZ Axis helper
  useEffect(() => {
    if (!sceneRef.current) return
    
    // Remove existing axis helper
    if (axisHelperRef.current) {
      sceneRef.current.remove(axisHelperRef.current)
      axisHelperRef.current = null
    }
    
    if (showAxisHelper) {
      // Create axis helper at origin (0,0,0) with 10m length
      const axesHelper = new THREE.AxesHelper(10)
      axesHelper.position.set(0, 0.01, 0) // Slightly above floor
      sceneRef.current.add(axesHelper)
      axisHelperRef.current = axesHelper
      
      // Add axis labels using sprites
      const createLabel = (text: string, color: number, position: THREE.Vector3) => {
        const canvas = document.createElement('canvas')
        canvas.width = 64
        canvas.height = 64
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
        ctx.font = 'bold 48px Arial'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, 32, 32)
        
        const texture = new THREE.CanvasTexture(canvas)
        const material = new THREE.SpriteMaterial({ map: texture })
        const sprite = new THREE.Sprite(material)
        sprite.position.copy(position)
        sprite.scale.set(2, 2, 1)
        axesHelper.add(sprite)
      }
      
      createLabel('X', 0xff0000, new THREE.Vector3(11, 0, 0))
      createLabel('Y', 0x00ff00, new THREE.Vector3(0, 11, 0))
      createLabel('Z', 0x0000ff, new THREE.Vector3(0, 0, 11))
    }
  }, [showAxisHelper])

  // Slot arrows visualization - shows arrows perpendicular to shelves at occupied slot positions
  useEffect(() => {
    if (!sceneRef.current || !venue) return
    
    // Remove existing arrows
    if (slotArrowsRef.current) {
      sceneRef.current.remove(slotArrowsRef.current)
      slotArrowsRef.current = null
    }
    
    if (!showSlotArrows) return
    
    // Fetch all shelf planograms and create arrows
    const loadAndRenderArrows = async () => {
      const arrowsGroup = new THREE.Group()
      arrowsGroup.name = 'slotArrows'
      
      // Get all shelves/gondolas from venue objects
      const shelves = venue.objects.filter((o: any) => 
        o.type?.toLowerCase().includes('shelf') || 
        o.type?.toLowerCase().includes('gondola')
      )
      
      for (const shelf of shelves) {
        try {
          // Fetch planogram data for this shelf
          const res = await fetch(`${API_BASE}/api/planogram/shelves/${shelf.id}`)
          if (!res.ok) continue
          const planogramData = await res.json()
          
          if (!planogramData?.slots?.levels) continue
          
          const shelfWidth = shelf.scale?.x || 2
          const shelfDepth = shelf.scale?.z || 1
          const slotWidthM = planogramData.slotWidthM || 0.1
          
          // Auto-detect facing (same as backend)
          const storedFacings = planogramData.slotFacings || []
          const autoFacing = shelfWidth >= shelfDepth ? 'front' : 'left'
          const effectiveFacing = storedFacings.length > 0 ? storedFacings[0] : autoFacing
          const slotsAlongZ = effectiveFacing === 'left' || effectiveFacing === 'right'
          
          // Calculate slot start position
          let slotStartX: number, slotStartZ: number, arrowDirX: number, arrowDirZ: number
          
          if (slotsAlongZ) {
            slotStartZ = shelf.position.z - shelfDepth / 2
            slotStartX = shelf.position.x + (effectiveFacing === 'left' ? -shelfWidth / 2 : shelfWidth / 2)
            arrowDirX = effectiveFacing === 'left' ? -1 : 1
            arrowDirZ = 0
          } else {
            slotStartX = shelf.position.x - shelfWidth / 2
            slotStartZ = shelf.position.z + (effectiveFacing === 'front' ? shelfDepth / 2 : -shelfDepth / 2)
            arrowDirX = 0
            arrowDirZ = effectiveFacing === 'front' ? 1 : -1
          }
          
          // Collect occupied slot indices
          const occupiedSlots = new Set<number>()
          for (const level of planogramData.slots.levels) {
            for (const slot of (level.slots || [])) {
              if (slot.skuItemId) {
                occupiedSlots.add(slot.slotIndex)
              }
            }
          }
          
          // Create arrow for each occupied slot
          for (const slotIndex of occupiedSlots) {
            let slotX: number, slotZ: number
            
            if (slotsAlongZ) {
              slotX = slotStartX
              slotZ = slotStartZ + (slotIndex + 0.5) * slotWidthM
            } else {
              slotX = slotStartX + (slotIndex + 0.5) * slotWidthM
              slotZ = slotStartZ
            }
            
            // Create simple arrow (cone + line)
            const arrowLength = 0.8
            const arrowY = 0.5
            
            // Arrow shaft (line)
            const shaftGeom = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(0, 0, 0),
              new THREE.Vector3(arrowDirX * arrowLength * 0.7, 0, arrowDirZ * arrowLength * 0.7)
            ])
            const shaftMat = new THREE.LineBasicMaterial({ color: 0xff6600, linewidth: 2 })
            const shaft = new THREE.Line(shaftGeom, shaftMat)
            shaft.position.set(slotX, arrowY, slotZ)
            arrowsGroup.add(shaft)
            
            // Arrow head (cone)
            const coneGeom = new THREE.ConeGeometry(0.1, 0.2, 8)
            const coneMat = new THREE.MeshBasicMaterial({ color: 0xff6600 })
            const cone = new THREE.Mesh(coneGeom, coneMat)
            cone.position.set(
              slotX + arrowDirX * arrowLength,
              arrowY,
              slotZ + arrowDirZ * arrowLength
            )
            // Rotate cone to point in arrow direction
            if (arrowDirX !== 0) {
              cone.rotation.z = arrowDirX > 0 ? -Math.PI / 2 : Math.PI / 2
            } else {
              cone.rotation.x = arrowDirZ > 0 ? Math.PI / 2 : -Math.PI / 2
            }
            arrowsGroup.add(cone)
          }
        } catch (err) {
          // Shelf has no planogram data
        }
      }
      
      if (sceneRef.current && arrowsGroup.children.length > 0) {
        sceneRef.current.add(arrowsGroup)
        slotArrowsRef.current = arrowsGroup
      }
    }
    
    loadAndRenderArrows()
  }, [showSlotArrows, venue])

  // ─── Intent Field: 3D Layers (Profit Radar) ───
  // Axis color map matching IntentFieldOverlay.tsx
  const INTENT_AXIS_COLORS: Record<string, number> = {
    exploration: 0x3b82f6, goal_directedness: 0x22c55e, urgency: 0xef4444,
    commitment: 0x10b981, hesitation: 0xf59e0b, confusion: 0xf97316,
    social_groupness: 0x8b5cf6, avoidance: 0x6b7280, waiting_queueing: 0x06b6d4,
    engagement_with_POI: 0x14b8a6, churn_exit_intent: 0xdc2626, friction: 0xe11d48,
  }
  const INTENT_AXIS_LABELS: Record<string, string> = {
    exploration: 'Exploring', goal_directedness: 'Goal-directed', urgency: 'Urgent',
    commitment: 'Committed', hesitation: 'Hesitating', confusion: 'Confused',
    social_groupness: 'Group', avoidance: 'Avoiding', waiting_queueing: 'Queueing',
    engagement_with_POI: 'Engaged', churn_exit_intent: 'Leaving', friction: 'Friction',
  }

  // Layer 1 — Zone Glows: colored translucent polygon overlays on ROI zones
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current

    // Remove old glows
    intentGlowsRef.current.forEach((mesh, id) => {
      scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    })
    intentGlowsRef.current.clear()

    if (!intentFieldEnabled || zoneField.length === 0) return

    for (const zf of zoneField) {
      // Find the matching ROI to get its vertices
      const roi = regions.find(r => r.id === zf.roiId)
      if (!roi || roi.vertices.length < 3) continue

      const color = INTENT_AXIS_COLORS[zf.dominant] ?? 0x888888

      // Build polygon at Y=0.04 (above normal ROI at 0.02)
      const verts: number[] = []
      const indices: number[] = []
      for (const v of roi.vertices) verts.push(v.x, 0.04, v.z)
      for (let i = 1; i < roi.vertices.length - 1; i++) indices.push(0, i, i + 1)

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      geo.setIndex(indices)
      geo.computeVertexNormals()

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25 + zf.dominantScore * 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.renderOrder = 3
      mesh.name = `intent-glow-${zf.roiId}`
      scene.add(mesh)
      intentGlowsRef.current.set(zf.roiId, mesh)
    }
  }, [intentFieldEnabled, zoneField, regions])

  // Layer 2 — (cluster card hover effects removed — cards only)

  // Layer 3 — Sparse Cluster Billboards: one per cluster, anchored at most-active zone
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current

    // Remove old cluster billboard group
    if (intentClusterGroupRef.current) {
      scene.remove(intentClusterGroupRef.current)
      intentClusterGroupRef.current.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Sprite) {
          ;(child.material as THREE.SpriteMaterial).map?.dispose()
          child.material.dispose()
        }
        if (child instanceof THREE.Line) {
          child.geometry.dispose()
          ;(child.material as THREE.Material).dispose()
        }
      })
      intentClusterGroupRef.current = null
    }

    if (!intentFieldEnabled || clusters.length === 0) return

    const group = new THREE.Group()
    group.name = 'intent-cluster-billboards'

    for (const c of clusters) {
      // Only show billboard for substantial clusters with a known anchor zone
      if (c.memberCount < 3 || !c.anchorZoneId) continue

      const color = INTENT_AXIS_COLORS[c.dominant] ?? 0x888888
      const label = INTENT_AXIS_LABELS[c.dominant] ?? c.dominant
      const hex = '#' + new THREE.Color(color).getHexString()
      const traj = c.trajectory
      const anchor = c.anchorPosition

      // Canvas billboard
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 128
      const ctx = canvas.getContext('2d')!
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.8)'
      ctx.beginPath()
      ctx.roundRect(0, 0, 256, 128, 14)
      ctx.fill()
      // Left color bar
      ctx.fillStyle = hex
      ctx.fillRect(0, 0, 6, 128)
      // Count badge
      ctx.fillStyle = hex
      ctx.beginPath()
      ctx.arc(34, 36, 16, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 18px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(c.memberCount), 34, 36)
      // Behavior label
      ctx.fillStyle = hex
      ctx.font = 'bold 15px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(label, 60, 32)
      // Journey context
      ctx.fillStyle = '#aaa'
      ctx.font = '11px sans-serif'
      ctx.fillText(`${traj.journeyType} · ${traj.avgStops} stops · ${traj.avgDwellSec}s`, 60, 54)
      // Zone path
      if (traj.zonesVisited.length > 0) {
        ctx.fillStyle = '#777'
        ctx.font = '10px sans-serif'
        ctx.fillText(traj.zonesVisited.slice(0, 3).join(' → '), 14, 96)
      }

      const texture = new THREE.CanvasTexture(canvas)
      texture.minFilter = THREE.LinearFilter
      const spriteMat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
      const sprite = new THREE.Sprite(spriteMat)
      sprite.position.set(anchor.x, 2.8, anchor.z)
      sprite.scale.set(3.0, 1.5, 1)
      sprite.renderOrder = 20
      group.add(sprite)

      // Vertical connector line
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(anchor.x, 0.05, anchor.z),
        new THREE.Vector3(anchor.x, 2.2, anchor.z),
      ])
      const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 })
      const line = new THREE.Line(lineGeo, lineMat)
      line.renderOrder = 19
      group.add(line)
    }

    scene.add(group)
    intentClusterGroupRef.current = group
  }, [intentFieldEnabled, clusters])

  return (
    <div className="w-full h-full flex flex-col">
      {/* Camera Controls Toolbar */}
      <div className="h-10 border-b border-border-dark flex items-center px-3 gap-2 bg-panel-bg flex-shrink-0">
        <span className="text-sm font-medium text-white">3D Venue</span>
        {xrayMode && (
          <div className="flex gap-1 ml-3">
            {(['shelves', 'queues', 'screens'] as const).map(key => (
              <button
                key={key}
                onClick={() => setXrayFilters(f => ({ ...f, [key]: !f[key] }))}
                className={`px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] border rounded transition-colors ${
                  xrayFilters[key]
                    ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                    : 'border-white/10 text-white/30 hover:text-white/50'
                }`}
              >
                {key === 'shelves' ? '🛒' : key === 'queues' ? '🚶' : '📺'} {key}
              </button>
            ))}
          </div>
        )}
        <div className="flex-1" />
        
        {/* Pan/Rotate Mode */}
        <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-2">
          <button
            onClick={togglePanMode}
            className={`p-1.5 rounded transition-colors ${panMode ? 'bg-blue-900/50 text-blue-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
            title={panMode ? 'Pan Mode ON (left-click to pan)' : 'Click to enable Pan Mode'}
          >
            <Hand className="w-4 h-4" />
          </button>
          <button
            onClick={() => { if (panMode) togglePanMode() }}
            className={`p-1.5 rounded transition-colors ${!panMode ? 'bg-blue-900/50 text-blue-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
            title={!panMode ? 'Rotate Mode ON (left-click to rotate)' : 'Click to enable Rotate Mode'}
          >
            <Move3D className="w-4 h-4" />
          </button>
        </div>

        {/* Area selection */}
        <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-2">
          <button
            onClick={() => setAreaSelectMode(v => !v)}
            className={`px-2 py-1 text-xs rounded transition-colors ${areaSelectMode ? 'bg-cyan-900/50 text-cyan-300' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
            title="Drag a rectangle on the viewport to select multiple objects"
          >
            Area Select
          </button>
          {selectedObjectIds.size > 1 && (
            <button
              onClick={() => removeObjects(Array.from(selectedObjectIds))}
              className="px-2 py-1 text-xs rounded bg-red-900/60 text-red-200 hover:bg-red-800"
              title="Delete selected objects"
            >
              Delete {selectedObjectIds.size}
            </button>
          )}
        </div>
        
        {/* Transform Controls (when object or ROI selected) */}
        {(selectedObjectId || selectedRoiId) && (
          <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-2">
            <span className="text-[10px] text-gray-500 mr-1">
              {selectedRoiId && !selectedObjectId ? 'Zone gizmo:' : 'Gizmo:'}
            </span>
            <button
              onClick={() => setTransformMode('translate')}
              className={`p-1.5 rounded transition-colors ${transformMode === 'translate' ? 'bg-green-900/50 text-green-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
              title="Move object (G)"
            >
              <Move className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTransformMode('rotate')}
              className={`p-1.5 rounded transition-colors ${transformMode === 'rotate' ? 'bg-orange-900/50 text-orange-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
              title="Rotate object (R)"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            {/* Helper hint for current mode */}
            <span className="text-[10px] text-gray-500 ml-2">
              {transformMode === 'translate' ? '↔ Drag arrows' : '↻ Drag green ring'}
            </span>
          </div>
        )}
        
        {/* View Presets */}
        <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-2">
          <button
            onClick={() => setCameraPreset('top')}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Top View (T or 7)"
          >
            Top
          </button>
          <button
            onClick={() => setCameraPreset('front')}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Front View (F)"
          >
            Front
          </button>
          <button
            onClick={() => setCameraPreset('side')}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Side View (S or 3)"
          >
            Side
          </button>
          <button
            onClick={() => setCameraPreset('reset')}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Reset View (R or 1)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        
        {/* Save/Restore View */}
        <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-2">
          <button
            onClick={saveCameraView}
            className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
              hasSavedView 
                ? 'bg-green-900/50 text-green-400 hover:bg-green-600 hover:text-white' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            title={hasSavedView ? 'Save current view as default - click again to update' : 'Save current view as default'}
          >
            <Save className="w-3 h-3" />
            {justSaved ? 'Saved!' : hasSavedView ? 'Update View' : 'Save View'}
          </button>
          {hasSavedView && (
            <button
              onClick={restoreCameraView}
              className="px-2 py-1 text-xs text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors flex items-center gap-1"
              title="Restore saved view"
            >
              <Download className="w-3 h-3" />
              Restore
            </button>
          )}
        </div>
      </div>
      
      {/* 3D Canvas */}
      <div ref={containerRef} className="flex-1 relative">
        <div
          ref={axisContainerRef}
          className="hidden"
        />
        {areaSelectMode && (
          <div
            className="absolute inset-0 z-30 cursor-crosshair"
            onMouseDown={handleAreaSelectMouseDown}
            onMouseMove={handleAreaSelectMouseMove}
            onMouseUp={handleAreaSelectMouseUp}
            onMouseLeave={() => {
              areaSelectStartRef.current = null
              setAreaSelectRect(null)
            }}
          >
            {areaSelectRect && (
              <div
                className="absolute border border-cyan-300 bg-cyan-400/10"
                style={{
                  left: areaSelectRect.x,
                  top: areaSelectRect.y,
                  width: areaSelectRect.w,
                  height: areaSelectRect.h,
                }}
              />
            )}
          </div>
        )}
        {/* Planogram Layer Strip - Full Width at Top */}
        {showPlanogramLayer && planogramSelectedShelfId && planogramSelectedShelf && (
          <div className="absolute top-0 left-0 right-0 z-20 bg-gray-900/95 border-b border-gray-700 backdrop-blur">
            <div className="flex items-center gap-3 px-3 py-2">
              {/* Header */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <BarChart3 className="w-4 h-4 text-amber-500" />
                <div>
                  <div className="text-sm font-medium text-white">{planogramSelectedShelf.name || 'Shelf'}</div>
                  <div className="text-[10px] text-gray-500">
                    {activeShelfPlanogram ? `${activeShelfPlanogram.numLevels} levels × ${Math.floor((planogramSelectedShelf.scale?.x || 2) / (activeShelfPlanogram.slotWidthM || 0.1))} slots` : 'Loading...'}
                  </div>
                </div>
              </div>
              
              {/* Planogram Grid - Horizontal */}
              <div className="flex-1 overflow-x-auto">
                {activeShelfPlanogram ? (
                  <div className="flex flex-col gap-0.5 min-w-fit">
                    {Array.from({ length: activeShelfPlanogram.numLevels }, (_, i) => activeShelfPlanogram.numLevels - 1 - i).map(levelIndex => {
                      const level = activeShelfPlanogram.slots?.levels?.find(l => l.levelIndex === levelIndex)
                      const shelfWidth = planogramSelectedShelf.scale?.x || 2.0
                      const slotsPerLevel = Math.floor(shelfWidth / (activeShelfPlanogram.slotWidthM || 0.1))
                      
                      return (
                        <div key={levelIndex} className="flex items-center gap-1">
                          <span className="text-[9px] text-gray-600 w-4 text-right">L{levelIndex + 1}</span>
                          <div className="flex gap-px">
                            {Array.from({ length: slotsPerLevel }, (_, slotIndex) => {
                              const slot = level?.slots?.find(s => s.slotIndex === slotIndex)
                              const sku = slot?.skuItemId && activeCatalog?.items.find(i => i.id === slot.skuItemId)
                              const isHovered = planogramHoveredSlotIndex === slotIndex
                              
                              // Build detailed tooltip
                              let tooltip = `L${levelIndex + 1} / Slot ${slotIndex + 1}`
                              if (sku) {
                                tooltip = `${sku.name}\nSKU: ${sku.skuCode}\nCategory: ${sku.category || 'N/A'}\nBrand: ${sku.brand || 'N/A'}\nL${levelIndex + 1} / Slot ${slotIndex + 1}`
                              } else {
                                tooltip = `Empty Slot\nL${levelIndex + 1} / Slot ${slotIndex + 1}`
                              }
                              
                              return (
                                <div
                                  key={slotIndex}
                                  className={`w-6 h-5 rounded-sm text-[7px] flex items-center justify-center transition-all cursor-pointer ${
                                    isHovered
                                      ? 'bg-amber-500 text-white ring-2 ring-amber-400 scale-110 z-10'
                                      : sku
                                        ? 'bg-amber-600/40 border border-amber-600/60 text-amber-200'
                                        : 'bg-gray-700/40 border border-gray-700 text-gray-600'
                                  }`}
                                  title={tooltip}
                                  onMouseEnter={() => setPlanogramHoveredSlotIndex(slotIndex)}
                                  onMouseLeave={() => setPlanogramHoveredSlotIndex(null)}
                                >
                                  {sku ? sku.name.substring(0, 2) : ''}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 py-2">No planogram data</div>
                )}
              </div>
              
              {/* Close button */}
              <button
                onClick={() => setPlanogramSelectedShelfId(null)}
                className="p-1 text-gray-500 hover:text-white hover:bg-gray-700 rounded transition-colors flex-shrink-0"
                title="Close planogram view"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        
        {/* SKU Detection Debug Overlay */}
        <SkuDebugOverlay
          enabled={tracking.showSkuDebug}
          containerRef={containerRef}
          cameraRef={cameraRef}
          onHoverShelf={setHoveredSkuShelf}
          autoShowSlotHighlight={tracking.autoShowSlotHighlight}
          onAutoSlotPositions={setAutoSlotPositions}
        />
        
        {/* Object Hover Tooltip */}
        {hoveredObjectTooltip && (
          <div
            className="fixed z-50 pointer-events-none bg-gray-900/95 border border-gray-600 rounded-lg shadow-xl px-3 py-2 text-xs text-gray-200 max-w-[300px]"
            style={{
              left: hoveredObjectTooltip.mouseX + 16,
              top: hoveredObjectTooltip.mouseY - 10,
            }}
          >
            <div className="font-semibold text-white truncate">{hoveredObjectTooltip.name}</div>
            <div className="flex gap-3 mt-1">
              <span className="text-gray-400">Type:</span>
              <span className="font-medium" style={{ color: {
                shelf: '#818cf8', wall: '#94a3b8', checkout: '#4ade80', entrance: '#fbbf24',
                pillar: '#a8a29e', digital_display: '#a78bfa', custom: '#94a3b8'
              }[hoveredObjectTooltip.type] || '#94a3b8' }}>{hoveredObjectTooltip.type}</span>
            </div>
            {hoveredObjectTooltip.category && (
              <div className="flex gap-3">
                <span className="text-gray-400">Category:</span>
                <span className="font-medium text-amber-300">{hoveredObjectTooltip.category}</span>
              </div>
            )}
            <div className="flex gap-3">
              <span className="text-gray-400">Size:</span>
              <span>{hoveredObjectTooltip.width.toFixed(1)} × {hoveredObjectTooltip.depth.toFixed(1)} × {hoveredObjectTooltip.height.toFixed(1)}m</span>
            </div>
            <div className="flex gap-3">
              <span className="text-gray-400">Pos:</span>
              <span>({hoveredObjectTooltip.posX.toFixed(1)}, {hoveredObjectTooltip.posZ.toFixed(1)})</span>
            </div>
            <div className="text-gray-500 text-[10px] mt-1 truncate">ID: {hoveredObjectTooltip.id.slice(0, 8)}</div>
          </div>
        )}

        {/* Floating Layers Panel - Top Left */}
        <div className="absolute top-14 left-3 z-10">
          <button
            onClick={() => {
              // Don't allow opening layers panel while planogram strip is visible
              if (showPlanogramLayer && planogramSelectedShelfId && !showLayersPanel) return
              setShowLayersPanel(!showLayersPanel)
            }}
            className={`p-2 rounded-lg shadow-lg transition-colors ${
              showLayersPanel
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800/90 text-gray-300 hover:text-white hover:bg-gray-700'
            }`}
            title="Toggle Layers Panel"
          >
            <Layers className="w-5 h-5" />
          </button>
          {showLayersPanel && (
            <div className="absolute top-full left-0 mt-2 bg-gray-800/95 backdrop-blur border border-gray-700 rounded-lg shadow-xl p-3 min-w-[180px]">
              <div className="text-xs font-medium text-gray-300 mb-2">Layers</div>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showObjectsLayer}
                  onChange={(e) => setShowObjectsLayer(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-green-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showObjectsLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Objects
                </span>
              </label>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showLidarLayer}
                  onChange={(e) => setShowLidarLayer(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-blue-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showLidarLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  LiDAR Devices
                </span>
              </label>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGridLayer}
                  onChange={(e) => setShowGridLayer(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-cyan-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showGridLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Grid & Floor
                </span>
              </label>
              {(venue?.scene_source === 'dwg' || !!venue?.dwg_layout_version_id) && (
                <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showFloorplanOverlayLayer}
                    onChange={(e) => setShowFloorplanOverlayLayer(e.target.checked)}
                    className="rounded border-gray-600 bg-gray-700 text-orange-500"
                  />
                  <span className="text-sm text-gray-300 flex items-center gap-1.5">
                    {showFloorplanOverlayLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                    Floorplan Overlay
                  </span>
                </label>
              )}
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRoiLayer}
                  onChange={(e) => setShowRoiLayer(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-yellow-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showRoiLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  ROI Zones
                </span>
              </label>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showTracksLayer}
                  onChange={(e) => setShowTracksLayer(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-purple-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showTracksLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Tracks
                </span>
              </label>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer pl-6">
                <input
                  type="checkbox"
                  checked={showTrackIdsLayer}
                  onChange={(e) => setShowTrackIdsLayer(e.target.checked)}
                  disabled={!showTracksLayer}
                  className="rounded border-gray-600 bg-gray-700 text-purple-500"
                />
                <span className="text-xs text-gray-400 flex items-center gap-1.5">
                  {showTrackIdsLayer && showTracksLayer ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-gray-500" />}
                  Track IDs (stable · perception)
                </span>
              </label>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showDoohLayer}
                  onChange={(e) => setShowDoohLayer(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-purple-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showDoohLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  DOOH Screens
                </span>
              </label>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPlanogramLayer}
                  onChange={(e) => {
                    setShowPlanogramLayer(e.target.checked)
                    if (!e.target.checked) setPlanogramSelectedShelfId(null)
                  }}
                  className="rounded border-gray-600 bg-gray-700 text-amber-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showPlanogramLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Planogram
                </span>
              </label>
              <div className="border-t border-gray-700 my-1" />
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={show3DModels}
                  onChange={(e) => setShow3DModels(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-purple-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {show3DModels ? <Eye className="w-3.5 h-3.5 text-purple-400" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  3D Models
                </span>
                <span className="text-[9px] text-gray-500 ml-auto">{show3DModels ? 'ON' : 'OFF'}</span>
              </label>
              <div className="border-t border-gray-700 my-1" />
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showAxisHelper}
                  onChange={(e) => setShowAxisHelper(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-red-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showAxisHelper ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  XYZ Axes
                </span>
              </label>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showSlotArrows}
                  onChange={(e) => setShowSlotArrows(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-orange-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showSlotArrows ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Slot Arrows
                </span>
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
