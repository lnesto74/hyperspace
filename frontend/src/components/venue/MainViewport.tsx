import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { Hand, Move3D, RotateCcw, Save, Download, Layers, Eye, EyeOff } from 'lucide-react'
import { useVenue } from '../../context/VenueContext'
import { useLidar } from '../../context/LidarContext'
import { useTracking } from '../../context/TrackingContext'
import { useRoi } from '../../context/RoiContext'
import { useReplayInsight } from '../../context/ReplayInsightContext'
import SkuDebugOverlay from './SkuDebugOverlay'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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
  custom: 0x8b5cf6,
  lidarOnline: 0x22c55e,
  lidarOffline: 0x6b7280,
  lidarConnecting: 0xf59e0b,
  fovCone: 0x3b82f6,
  trackPerson: 0x3b82f6,
  trackCart: 0xf59e0b,
  trackUnknown: 0x8b5cf6,
  sezInfluenced: 0xff3333, // Red for people influenced by digital displays
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

interface CustomModel {
  object_type: string
  file_path: string
  original_name?: string
}

import type { CameraView, LightingSettings, TrackingSettings } from '../layout/AppShell'

interface MainViewportProps {
  cameraView?: CameraView
  lighting?: LightingSettings
  tracking?: TrackingSettings
  isReplayMode?: boolean
  replayTimestamp?: number | null
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
}

export default function MainViewport({ 
  cameraView = 'perspective', 
  lighting = defaultLighting, 
  tracking = defaultTracking,
  isReplayMode = false,
  replayTimestamp = null
}: MainViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const labelRendererRef = useRef<CSS2DRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const objectMeshesRef = useRef<Map<string, THREE.Mesh | THREE.Group>>(new Map())
  const lidarMeshesRef = useRef<Map<string, THREE.Group>>(new Map())
  const trackMeshesRef = useRef<Map<string, THREE.Group>>(new Map())
  const roiMeshesRef = useRef<Map<string, THREE.Group>>(new Map())
  const roiVertexHandlesRef = useRef<Map<string, THREE.Mesh[]>>(new Map())
  const drawingLinesRef = useRef<THREE.Line | null>(null)
  const drawingMarkersRef = useRef<THREE.Group | null>(null)
  const gridRef = useRef<THREE.GridHelper | null>(null)
  const floorRef = useRef<THREE.Mesh | null>(null)
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
  
  // Layers panel state
  const [showLayersPanel, setShowLayersPanel] = useState(false)
  const [showObjectsLayer, setShowObjectsLayer] = useState(true)
  const [showLidarLayer, setShowLidarLayer] = useState(true)
  const [showGridLayer, setShowGridLayer] = useState(true)
  const [showRoiLayer, setShowRoiLayer] = useState(true)
  const [showTracksLayer, setShowTracksLayer] = useState(true)
  const [showDoohLayer, setShowDoohLayer] = useState(true)
  const [showAxisHelper, setShowAxisHelper] = useState(false)
  const axisHelperRef = useRef<THREE.AxesHelper | null>(null)
  const [showSlotArrows, setShowSlotArrows] = useState(false)
  const slotArrowsRef = useRef<THREE.Group | null>(null)
  
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
    window.addEventListener('dooh-playlist-updated', handlePlaylistUpdate)
    return () => window.removeEventListener('dooh-playlist-updated', handlePlaylistUpdate)
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
  const pendingDragRef = useRef<{ type: 'object' | 'lidar' | 'roi-vertex' | 'roi', id: string, vertexIndex?: number, hit: any } | null>(null)
  
  // Magnetic snap threshold (meters)
  const SNAP_THRESHOLD = 0.2
  
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
    deleteRegion,
    updateVertexPosition,
    openKPIPopup,
    setHoveredRoiId,
  } = useRoi()
  
  // Replay Insight context for zone highlighting
  const { isInsightMode, selectedEpisode } = useReplayInsight()
  
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
  const createSezZoneMesh = (
    polygon: { x: number; z: number }[],
    height: number,
    color: number,
    opacity: number = 0.15
  ): THREE.Group => {
    const zoneGroup = new THREE.Group()
    
    // Calculate center of polygon
    const centerX = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length
    const centerZ = polygon.reduce((sum, p) => sum + p.z, 0) / polygon.length
    
    // Create shape relative to center
    const shape = new THREE.Shape()
    shape.moveTo(polygon[0].x - centerX, polygon[0].z - centerZ)
    for (let i = 1; i < polygon.length; i++) {
      shape.lineTo(polygon[i].x - centerX, polygon[i].z - centerZ)
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
    zoneMesh.rotation.z = Math.PI
    zoneMesh.position.set(centerX, 0.02, centerZ)
    zoneGroup.add(zoneMesh)
    
    // Edge lines
    const edgePoints: THREE.Vector3[] = []
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i]
      const p2 = polygon[(i + 1) % polygon.length]
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
  const createDoohZoneMesh = useCallback((screen: typeof doohScreens[0]): THREE.Group => {
    const group = new THREE.Group()
    group.name = `dooh-screen-${screen.id}`
    
    const sezColor = 0x9333ea // Purple
    const sezColorBack = 0x7c3aed // Slightly different purple for back
    const height = screen.mountHeightM + 0.5
    
    // Create front SEZ zone
    if (screen.sezPolygon && screen.sezPolygon.length >= 3) {
      const frontZone = createSezZoneMesh(screen.sezPolygon, height, sezColor)
      group.add(frontZone)
      
      // Create back SEZ zone if double-sided
      if (screen.doubleSided) {
        const backPolygon = generateBackSezPolygon(screen.sezPolygon, screen.position)
        const backZone = createSezZoneMesh(backPolygon, height, sezColorBack, 0.12)
        group.add(backZone)
      }
    }
    
    // Direction arrow (screen marker removed - video screen replaces it)
    const yawRad = (screen.yawDeg || 0) * Math.PI / 180
    const arrowLength = 1.5
    const dirX = Math.sin(yawRad)
    const dirZ = Math.cos(yawRad)
    const arrowPoints = [
      new THREE.Vector3(screen.position.x, screen.mountHeightM, screen.position.z),
      new THREE.Vector3(screen.position.x + dirX * arrowLength, screen.mountHeightM, screen.position.z + dirZ * arrowLength),
    ]
    const arrowGeometry = new THREE.BufferGeometry().setFromPoints(arrowPoints)
    const arrowLine = new THREE.Line(
      arrowGeometry,
      new THREE.LineBasicMaterial({ color: sezColor, linewidth: 2 })
    )
    group.add(arrowLine)
    
    // Vertical pole
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, screen.mountHeightM, 8),
      new THREE.MeshStandardMaterial({ color: 0x666666 })
    )
    pole.position.set(screen.position.x, screen.mountHeightM / 2, screen.position.z)
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

  const { venue, objects, selectedObjectId, selectObject, updateObject, removeObject, snapToGrid } = useVenue()
  const { placements, selectedPlacementId, selectPlacement, updatePlacement, removePlacement, getDeviceById } = useLidar()
  const { tracks } = useTracking()
  
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
  const removePlacementRef = useRef(removePlacement)
  const snapToGridRef = useRef(snapToGrid)
  const selectObjectRef = useRef(selectObject)
  const selectPlacementRef = useRef(selectPlacement)
  const selectRegionRef = useRef(selectRegion)
  const addDrawingVertexRef = useRef(addDrawingVertex)
  const updateRegionRef = useRef(updateRegion)
  const deleteRegionRef = useRef(deleteRegion)
  const updateVertexPositionRef = useRef(updateVertexPosition)
  const openKPIPopupRef = useRef(openKPIPopup)
  const setHoveredRoiIdRef = useRef(setHoveredRoiId)
  const selectedObjectIdRef = useRef(selectedObjectId)
  const selectedPlacementIdRef = useRef(selectedPlacementId)
  const selectedRoiIdRef = useRef(selectedRoiId)
  
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
    removePlacementRef.current = removePlacement
    snapToGridRef.current = snapToGrid
    selectObjectRef.current = selectObject
    selectPlacementRef.current = selectPlacement
    selectRegionRef.current = selectRegion
    addDrawingVertexRef.current = addDrawingVertex
    updateRegionRef.current = updateRegion
    deleteRegionRef.current = deleteRegion
    updateVertexPositionRef.current = updateVertexPosition
    openKPIPopupRef.current = openKPIPopup
    setHoveredRoiIdRef.current = setHoveredRoiId
    selectedObjectIdRef.current = selectedObjectId
    selectedPlacementIdRef.current = selectedPlacementId
    selectedRoiIdRef.current = selectedRoiId
  }, [venue, objects, placements, regions, isDrawing, drawingVertices, updateObject, updatePlacement, removeObject, removePlacement, snapToGrid, selectObject, selectPlacement, selectRegion, addDrawingVertex, updateRegion, deleteRegion, updateVertexPosition, openKPIPopup, setHoveredRoiId, selectedObjectId, selectedPlacementId, selectedRoiId])
  
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
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(15, 15, 15)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      logarithmicDepthBuffer: true, // Better depth precision for large scenes
      alpha: true,
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
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Label renderer for tooltips
    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(width, height)
    labelRenderer.domElement.style.position = 'absolute'
    labelRenderer.domElement.style.top = '0'
    labelRenderer.domElement.style.left = '0'
    labelRenderer.domElement.style.pointerEvents = 'none'
    container.appendChild(labelRenderer.domElement)
    labelRendererRef.current = labelRenderer

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.maxPolarAngle = Math.PI / 2.1
    controls.minDistance = 5
    controls.maxDistance = 100
    controlsRef.current = controls

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
      renderer.render(scene, camera)
      labelRenderer.render(scene, camera)
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
    // SHIFT+Click required to select/drag objects (prevents accidental selection during navigation)
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
      
      // Require Shift key for selection/dragging (prevents accidental selection during pan/rotate/zoom)
      if (!event.shiftKey) {
        mouseDownPosRef.current = null
        pendingDragRef.current = null
        return // Allow OrbitControls to handle navigation
      }
      
      // Store mouse down position for drag threshold check
      mouseDownPosRef.current = { x: event.clientX, y: event.clientY }
      
      const hit = findHitObject(mouse)

      if (hit) {
        // Store pending drag info - actual drag starts after threshold
        const vertexIndex = hit.type === 'roi-vertex' ? hit.vertexIndex : undefined
        pendingDragRef.current = { type: hit.type, id: hit.id, vertexIndex, hit }
      } else {
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
          // Threshold crossed - start the actual drag
          startDrag(mouse)
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
      // Handle click selection (no drag occurred - threshold not crossed)
      if (pendingDragRef.current && !isDraggingRef.current) {
        const pending = pendingDragRef.current
        // Select the object on click
        if (pending.type === 'object') {
          selectObjectRef.current(pending.id)
          selectPlacementRef.current(null)
          selectRegionRef.current(null)
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
              updateObjectRef.current(draggedObjectRef.current.id, {
                position: snapped
              })
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
            updateObjectRef.current(hit.id, {
              rotation: { ...obj.rotation, y: obj.rotation.y + rotationStep }
            })
          }
        } else {
          const placement = placementsRef.current.find(p => p.id === hit.id)
          if (placement) {
            selectPlacementRef.current(hit.id)
            selectObjectRef.current(null)
            updatePlacementRef.current(hit.id, {
              rotation: { ...placement.rotation, y: placement.rotation.y + rotationStep }
            })
          }
        }
      }
    }

    // Keyboard handler - Delete key removes selected object/lidar/roi, Escape cancels drawing
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        // Prevent browser back navigation on Backspace
        if (event.key === 'Backspace' && document.activeElement?.tagName !== 'INPUT') {
          event.preventDefault()
        }
        if (selectedObjectIdRef.current) {
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
        // Remove trail
        const trail = scene.getObjectByName(`trail-${key}`)
        if (trail) {
          scene.remove(trail)
          ;(trail as THREE.Line).geometry.dispose()
          ;((trail as THREE.Line).material as THREE.Material).dispose()
        }
      })
      trackMeshesRef.current.clear()
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
      
      // Dispose renderer and remove DOM elements
      renderer.dispose()
      renderer.forceContextLoss()
      container.removeChild(renderer.domElement)
      container.removeChild(labelRenderer.domElement)
    }
  }, [])

  // Update grid and floor when venue changes
  useEffect(() => {
    if (!sceneRef.current || !venue) return
    const scene = sceneRef.current

    // Remove old grid and floor
    if (gridRef.current) scene.remove(gridRef.current)
    if (floorRef.current) scene.remove(floorRef.current)

    // Create grid
    const gridSize = Math.max(venue.width, venue.depth)
    const divisions = Math.ceil(gridSize / venue.tileSize)
    const grid = new THREE.GridHelper(gridSize, divisions, COLORS.gridCenter, COLORS.grid)
    grid.position.set(venue.width / 2, 0.01, venue.depth / 2)
    scene.add(grid)
    gridRef.current = grid

    // Create floor
    const floorGeometry = new THREE.PlaneGeometry(venue.width, venue.depth)
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: COLORS.floor,
      roughness: 0.9,
      metalness: 0.1,
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(venue.width / 2, 0, venue.depth / 2)
    floor.receiveShadow = true
    scene.add(floor)
    floorRef.current = floor

    // Update camera target
    if (controlsRef.current) {
      controlsRef.current.target.set(venue.width / 2, 0, venue.depth / 2)
    }
  }, [venue?.width, venue?.depth, venue?.tileSize])

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
    
    const camera = cameraRef.current
    const controls = controlsRef.current
    const centerX = venue.width / 2
    const centerZ = venue.depth / 2
    const maxDim = Math.max(venue.width, venue.depth)
    
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
        // Default perspective view
        camera.position.set(maxDim * 0.8, maxDim * 0.6, maxDim * 0.8)
        camera.up.set(0, 1, 0)
        break
    }
    
    camera.lookAt(centerX, 0, centerZ)
    controls.update()
  }, [cameraView, venue?.width, venue?.depth, venue?.height])

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
    const existingIds = new Set(objects.map(o => o.id))

    // Remove deleted objects
    objectMeshesRef.current.forEach((obj3d, id) => {
      if (!existingIds.has(id)) {
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
      }
    })

    // Add/update objects
    const createOrUpdateObject = async (obj: typeof objects[0]) => {
      let obj3d = objectMeshesRef.current.get(obj.id)
      const customModel = customModels.get(obj.type)

      if (!obj3d) {
        const targetColor = obj.color ? parseInt(obj.color.replace('#', ''), 16) : COLORS[obj.type as keyof typeof COLORS] || COLORS.custom

        if (customModel) {
          // Load custom 3D model (GLTF/GLB/OBJ) - add cache buster
          const cacheBuster = `?t=${Date.now()}`
          const loaded = await loadModel(obj.type, `${API_BASE}${customModel.file_path}${cacheBuster}`)
          if (loaded) {
            // Check if this object type should be translucent (walls, shelves)
            const isTranslucentType = obj.type === 'wall' || obj.type === 'shelf'
            const isObjFile = customModel.original_name?.toLowerCase().endsWith('.obj')
            
            loaded.traverse(child => {
              if (child instanceof THREE.Mesh) {
                if (isObjFile || isTranslucentType) {
                  // Apply translucent material for walls/shelves, or solid for OBJ files
                  child.material = new THREE.MeshStandardMaterial({
                    color: isTranslucentType ? 0x88aabb : targetColor,
                    roughness: isTranslucentType ? 0.3 : 0.7,
                    metalness: 0.1,
                    transparent: isTranslucentType,
                    opacity: isTranslucentType ? 0.25 : 1.0,
                    side: isTranslucentType ? THREE.DoubleSide : THREE.FrontSide,
                    depthWrite: !isTranslucentType, // Prevent z-fighting flickering
                  })
                  
                  // Add edge lines for translucent objects
                  if (isTranslucentType && child.geometry) {
                    const edges = new THREE.EdgesGeometry(child.geometry)
                    const lineMaterial = new THREE.LineBasicMaterial({ 
                      color: 0x99ccdd,
                      transparent: true,
                      opacity: 0.6,
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
            // Set render order for transparent objects to render after opaque
            if (isTranslucentType) {
              loaded.renderOrder = 1
            }
            scene.add(loaded)
            objectMeshesRef.current.set(obj.id, loaded)
            obj3d = loaded
          }
        }
        
        // Fallback to box geometry if no custom model or loading failed
        if (!obj3d) {
          const geometry = new THREE.BoxGeometry(1, 1, 1)
          
          // Check if this object type should be translucent (walls, shelves)
          const isTranslucentType = obj.type === 'wall' || obj.type === 'shelf'
          
          const material = new THREE.MeshStandardMaterial({
            color: isTranslucentType ? 0x88aabb : targetColor, // Light blue-grey for translucent
            roughness: isTranslucentType ? 0.3 : 0.7,
            metalness: isTranslucentType ? 0.1 : 0.1,
            transparent: isTranslucentType,
            opacity: isTranslucentType ? 0.25 : 1.0,
            side: isTranslucentType ? THREE.DoubleSide : THREE.FrontSide,
            depthWrite: !isTranslucentType, // Prevent z-fighting flickering
          })
          
          const mesh = new THREE.Mesh(geometry, material)
          mesh.castShadow = !isTranslucentType
          mesh.receiveShadow = true
          mesh.userData.objectId = obj.id
          mesh.userData.isTranslucent = isTranslucentType
          // Set render order for transparent objects to render after opaque
          if (isTranslucentType) {
            mesh.renderOrder = 1
          }
          
          // Add edge lines for translucent objects (glass-like effect)
          if (isTranslucentType) {
            const edges = new THREE.EdgesGeometry(geometry)
            const lineMaterial = new THREE.LineBasicMaterial({ 
              color: 0x99ccdd,
              transparent: true,
              opacity: 0.6,
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
      obj3d.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z)
      
      // Calculate Y position to place object base on floor
      let yOffset = obj.scale.y / 2 // Default for box geometry (centered origin)
      
      // Check if this is a DWG-sourced venue (needs special GLTF scaling)
      const isDwgVenue = venueRef.current?.scene_source === 'dwg'
      
      if (obj3d.userData.isCustomModel && obj3d.userData.originalSize && isDwgVenue) {
        // For DWG venues with GLTF models, scale relative to original size (same as Layout3DPreview)
        const originalSize = obj3d.userData.originalSize as THREE.Vector3
        const scaleX = obj.scale.x / originalSize.x
        const scaleZ = obj.scale.z / originalSize.z
        const scaleY = obj.scale.y / originalSize.y
        obj3d.scale.set(scaleX, scaleY, scaleZ)
        
        // Compute bounding box after scaling to find the bottom
        const box = new THREE.Box3().setFromObject(obj3d)
        yOffset = -box.min.y
      } else if (obj3d.userData.isCustomModel) {
        // For manual mode with GLTF models, apply scale and compute bounding box for yOffset
        obj3d.scale.set(obj.scale.x, obj.scale.y, obj.scale.z)
        const box = new THREE.Box3().setFromObject(obj3d)
        yOffset = -box.min.y
      } else {
        // For box geometry, scale is the actual size
        obj3d.scale.set(obj.scale.x, obj.scale.y, obj.scale.z)
      }
      
      obj3d.position.set(obj.position.x, yOffset, obj.position.z)

      // Update material color and selection state
      const isTranslucentType = obj.type === 'wall' || obj.type === 'shelf'
      const targetColor = isTranslucentType ? 0x88aabb : (obj.color ? parseInt(obj.color.replace('#', ''), 16) : COLORS[obj.type as keyof typeof COLORS])
      obj3d.traverse(child => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as THREE.MeshStandardMaterial
          // Only update color if not edge lines
          if (!child.userData.isEdgeLines) {
            mat.color.setHex(targetColor)
          }
          if (obj.id === selectedObjectId) {
            mat.emissive.setHex(COLORS.selected)
            mat.emissiveIntensity = 0.3
          } else {
            mat.emissive.setHex(0x000000)
            mat.emissiveIntensity = 0
          }
        }
      })
    }

    objects.forEach(obj => createOrUpdateObject(obj))
  }, [objects, selectedObjectId, customModels, loadModel])

  // Update LiDAR placements
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current
    const existingIds = new Set(placements.map(p => p.id))

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

  // Update tracks
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current
    const currentTrackKeys = new Set(tracks.keys())

    // Remove old tracks and their trails
    trackMeshesRef.current.forEach((group, key) => {
      if (!currentTrackKeys.has(key)) {
        scene.remove(group)
        group.traverse(child => {
          if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => {
                // Dispose textures (canvas textures for labels)
                if (m.map) m.map.dispose()
                m.dispose()
              })
            } else {
              // Dispose textures (canvas textures for labels)
              if ((child.material as any).map) (child.material as any).map.dispose()
              child.material.dispose()
            }
          }
          // Dispose sprite textures (SEZ labels)
          if (child instanceof THREE.Sprite) {
            const mat = child.material as THREE.SpriteMaterial
            if (mat.map) mat.map.dispose()
            mat.dispose()
          }
        })
        // Also remove trail from scene
        const trail = scene.getObjectByName(`trail-${key}`)
        if (trail) {
          scene.remove(trail)
          ;(trail as THREE.Line).geometry.dispose()
          ;((trail as THREE.Line).material as THREE.Material).dispose()
        }
        // Clean up SEZ entry time tracking to prevent memory leak
        sezEntryTimesRef.current.delete(key)
        trackMeshesRef.current.delete(key)
      }
    })

    const now = Date.now()
    const SEZ_LABEL_DURATION_MS = 60 * 1000 // 1 minute label visibility

    // Add/update tracks
    tracks.forEach((track, key) => {
      let group = trackMeshesRef.current.get(key)
      
      // Check if person is inside any DOOH SEZ zone
      const personPos = { x: track.venuePosition.x, z: track.venuePosition.z }
      let isInSez = false
      for (const screen of doohScreens) {
        if (screen.enabled && screen.sezPolygon && screen.sezPolygon.length >= 3) {
          if (pointInPolygon(personPos, screen.sezPolygon)) {
            isInSez = true
            break
          }
          // Also check back-facing SEZ for double-sided screens
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
      
      // Track SEZ entry time for label visibility
      if (isInSez && !sezEntryTimesRef.current.has(key)) {
        sezEntryTimesRef.current.set(key, now)
      }
      
      // Check if label should be visible (entered SEZ within last minute)
      const entryTime = sezEntryTimesRef.current.get(key)
      const showSezLabel = entryTime && (now - entryTime) < SEZ_LABEL_DURATION_MS
      
      // Use SEZ influence color (red) if in zone, otherwise normal color
      let color: number | string = isInSez ? COLORS.sezInfluenced : (
        track.color || (
          track.objectType === 'person' ? COLORS.trackPerson 
          : track.objectType === 'cart' ? COLORS.trackCart 
          : COLORS.trackUnknown
        )
      )
      
      // Get bounding box dimensions (default person size)
      const bbox = track.boundingBox || { width: 0.5, height: 1.7, depth: 0.5 }
      const cylinderRadius = Math.max(bbox.width, bbox.depth) / 2
      const cylinderHeight = bbox.height

      if (!group) {
        group = new THREE.Group()

        // Person cylinder (capsule-like shape)
        const cylinderGeometry = new THREE.CylinderGeometry(
          cylinderRadius, cylinderRadius, cylinderHeight, 16
        )
        const cylinderMaterial = new THREE.MeshStandardMaterial({ 
          color, 
          emissive: color, 
          emissiveIntensity: 0.5,
          transparent: true,
          opacity: tracking.cylinderOpacity,
        })
        const cylinder = new THREE.Mesh(cylinderGeometry, cylinderMaterial)
        cylinder.userData.isCylinder = true
        group.add(cylinder) // index 0

        // Top cap (hemisphere)
        const topCapGeometry = new THREE.SphereGeometry(cylinderRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
        const topCapMaterial = new THREE.MeshStandardMaterial({ 
          color, 
          emissive: color, 
          emissiveIntensity: 0.5,
          transparent: true,
          opacity: tracking.cylinderOpacity,
        })
        const topCap = new THREE.Mesh(topCapGeometry, topCapMaterial)
        topCap.position.y = cylinderHeight / 2
        group.add(topCap) // index 1

        // Bottom cap (hemisphere, flipped)
        const bottomCapGeometry = new THREE.SphereGeometry(cylinderRadius, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)
        const bottomCapMaterial = new THREE.MeshStandardMaterial({ 
          color, 
          emissive: color, 
          emissiveIntensity: 0.5,
          transparent: true,
          opacity: tracking.cylinderOpacity,
        })
        const bottomCap = new THREE.Mesh(bottomCapGeometry, bottomCapMaterial)
        bottomCap.rotation.x = Math.PI
        bottomCap.position.y = -cylinderHeight / 2
        group.add(bottomCap) // index 2
        
        // SEZ influence label - 3D sprite, large and readable
        const labelCanvas = document.createElement('canvas')
        const labelCtx = labelCanvas.getContext('2d')!
        labelCanvas.width = 512
        labelCanvas.height = 128
        // Red pill-shaped background
        labelCtx.fillStyle = 'rgba(220, 38, 38, 0.95)'
        labelCtx.beginPath()
        labelCtx.roundRect(8, 8, 496, 112, 56)
        labelCtx.fill()
        // Light border
        labelCtx.strokeStyle = 'rgba(255, 150, 150, 0.9)'
        labelCtx.lineWidth = 6
        labelCtx.stroke()
        // White text - person ID
        labelCtx.fillStyle = 'white'
        labelCtx.font = 'bold 64px system-ui, sans-serif'
        labelCtx.textAlign = 'center'
        labelCtx.textBaseline = 'middle'
        const displayId = key.length > 8 ? key.slice(-6) : key
        labelCtx.fillText(displayId, 256, 68)
        
        const labelTexture = new THREE.CanvasTexture(labelCanvas)
        labelTexture.needsUpdate = true
        const labelMaterial = new THREE.SpriteMaterial({ 
          map: labelTexture, 
          transparent: true,
          depthTest: false,
        })
        const labelSprite = new THREE.Sprite(labelMaterial)
        // Large readable size - 1.5m wide, positioned above head
        labelSprite.scale.set(1.5, 0.375, 1)
        labelSprite.position.y = cylinderHeight / 2 + 0.5
        labelSprite.visible = false
        labelSprite.userData.isSezLabel = true
        group.add(labelSprite) // index 3

        scene.add(group)
        trackMeshesRef.current.set(key, group)
      }

      // Update position - center cylinder at person's position, bottom at floor
      group.position.set(track.venuePosition.x, cylinderHeight / 2, track.venuePosition.z)

      // Update cylinder size if bounding box changed
      const cylinder = group.children[0] as THREE.Mesh
      const topCap = group.children[1] as THREE.Mesh
      const bottomCap = group.children[2] as THREE.Mesh
      
      // Update SEZ label visibility (3D sprite)
      const sezLabel = group.children[3] as THREE.Sprite | undefined
      if (sezLabel && sezLabel.userData.isSezLabel) {
        sezLabel.visible = !!showSezLabel
        // Large readable size - 1.5m wide, positioned above head
        sezLabel.scale.set(1.5, 0.375, 1)
        sezLabel.position.y = cylinderHeight / 2 + 0.5
      }

      // Update/create trail - use absolute world coordinates
      if (track.trail.length > 1) {
        // Trail points are in world coordinates, starting from cylinder base center
        const trailGeometry = new THREE.BufferGeometry()
        const points = track.trail.map(p => new THREE.Vector3(p.x, 0.02, p.z)) // Just above floor
        trailGeometry.setFromPoints(points)
        
        // Trail color matches person color (red if influenced)
        const trailMaterial = new THREE.LineBasicMaterial({ 
          color, 
          transparent: true, 
          opacity: 0.8,
        })
        
        // Remove old trail from scene (not from group - trail is in world space)
        const oldTrailKey = `trail-${key}`
        const existingTrail = scene.getObjectByName(oldTrailKey)
        if (existingTrail) {
          scene.remove(existingTrail)
          ;(existingTrail as THREE.Line).geometry.dispose()
          ;((existingTrail as THREE.Line).material as THREE.Material).dispose()
        }
        
        const trail = new THREE.Line(trailGeometry, trailMaterial)
        trail.name = oldTrailKey
        trail.userData.isTrail = true
        trail.userData.trackKey = key
        scene.add(trail)
      }

      // Update colors - red translucent if in SEZ, otherwise normal
      const cylinderMat = cylinder.material as THREE.MeshStandardMaterial
      const topCapMat = topCap.material as THREE.MeshStandardMaterial
      const bottomCapMat = bottomCap.material as THREE.MeshStandardMaterial
      
      // Adjust opacity - more translucent when influenced
      const effectiveOpacity = isInSez ? Math.min(tracking.cylinderOpacity, 0.4) : tracking.cylinderOpacity
      cylinderMat.opacity = effectiveOpacity
      topCapMat.opacity = effectiveOpacity
      bottomCapMat.opacity = effectiveOpacity
      
      if (typeof color === 'string') {
        cylinderMat.color.set(color)
        cylinderMat.emissive.set(color)
        topCapMat.color.set(color)
        topCapMat.emissive.set(color)
        bottomCapMat.color.set(color)
        bottomCapMat.emissive.set(color)
      } else {
        cylinderMat.color.setHex(color)
        cylinderMat.emissive.setHex(color)
        topCapMat.color.setHex(color)
        topCapMat.emissive.setHex(color)
        bottomCapMat.color.setHex(color)
        bottomCapMat.emissive.setHex(color)
      }
      
      // Increase emissive intensity when influenced for "shocked" effect
      const emissiveIntensity = isInSez ? 0.8 : 0.5
      cylinderMat.emissiveIntensity = emissiveIntensity
      topCapMat.emissiveIntensity = emissiveIntensity
      bottomCapMat.emissiveIntensity = emissiveIntensity
    })
    
    // Clean up stale SEZ entry times for tracks that no longer exist
    sezEntryTimesRef.current.forEach((_, key) => {
      if (!currentTrackKeys.has(key)) {
        sezEntryTimesRef.current.delete(key)
      }
    })
  }, [tracks, doohScreens])

  // Render ROIs (regions of interest) as polygons
  useEffect(() => {
    if (!sceneRef.current) return
    const scene = sceneRef.current
    const existingIds = new Set(regions.map(r => r.id))

    // Remove deleted ROIs
    roiMeshesRef.current.forEach((group, id) => {
      if (!existingIds.has(id)) {
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

    // Add/update ROIs
    console.log(`[MainViewport] Rendering ${regions.length} ROIs`)
    regions.forEach((roi, idx) => {
      if (roi.vertices.length < 3) return
      
      if (idx === 0) {
        console.log(`[MainViewport] First ROI: "${roi.name}" vertices:`, roi.vertices.slice(0, 2))
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

      // Vertex handles (spheres at each vertex)
      const handles: THREE.Mesh[] = []
      roi.vertices.forEach((v, i) => {
        const handleGeometry = new THREE.SphereGeometry(0.15, 16, 8)
        const handleMaterial = new THREE.MeshBasicMaterial({
          color: isSelected ? 0x3b82f6 : 0xffffff,
        })
        const handle = new THREE.Mesh(handleGeometry, handleMaterial)
        handle.position.set(v.x, 0.15, v.z)
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
      // Position label at centroid
      const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
      const cz = roi.vertices.reduce((s, v) => s + v.z, 0) / roi.vertices.length
      label.position.set(cx, 0.5, cz)
      label.userData.roiId = roi.id
      group.add(label)
    })
  }, [regions, selectedRoiId])

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
  
  // Toggle layer visibility - Tracks
  useEffect(() => {
    trackMeshesRef.current.forEach(group => {
      group.visible = showTracksLayer
    })
  }, [showTracksLayer, tracks])
  
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
      zoom: cameraRef.current.zoom
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
      case 'reset':
        cameraRef.current.position.set(venue.width * 0.8, venue.height * 2, venue.depth * 0.8)
        controlsRef.current.target.set(0, 0, 0)
        break
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

  return (
    <div className="w-full h-full flex flex-col">
      {/* Camera Controls Toolbar */}
      <div className="h-10 border-b border-border-dark flex items-center px-3 gap-2 bg-panel-bg flex-shrink-0">
        <span className="text-sm font-medium text-white">3D Venue</span>
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
        {/* SKU Detection Debug Overlay */}
        <SkuDebugOverlay
          enabled={tracking.showSkuDebug}
          containerRef={containerRef}
          cameraRef={cameraRef}
          onHoverShelf={setHoveredSkuShelf}
          autoShowSlotHighlight={tracking.autoShowSlotHighlight}
          onAutoSlotPositions={setAutoSlotPositions}
        />
        
        {/* Floating Layers Panel - Top Left */}
        <div className="absolute top-14 left-3 z-10">
          <button
            onClick={() => setShowLayersPanel(!showLayersPanel)}
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
