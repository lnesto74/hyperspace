import { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RotateCcw, Box, Grid3X3, Save, Download, Hand, Move3D, Layers, Eye, EyeOff } from 'lucide-react'
import { API_BASE } from '../../config/api'


interface LayoutFixture {
  id: string
  group_id: string
  pose2d: { x: number; y: number; rot_deg: number }
  footprint: { 
    w: number
    d: number
    kind?: string
    points?: Array<{ x: number; y: number }>
  }
  mapping: {
    catalog_asset_id: string
    type: string
  } | null
}

interface LayoutData {
  units: string
  unit_scale_to_m: number
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  fixtures: LayoutFixture[]
  paired_count: number
  total_count: number
}

interface LidarInstance {
  id: string
  x_m: number
  z_m: number
  y_m?: number
  mount_y_m?: number
  yaw_deg?: number
  model_id?: string
  source?: string
  range_m?: number
}

interface LidarModel {
  id: string
  name: string
  hfov_deg: number
  vfov_deg: number
  range_m: number
  dome_mode?: boolean
}

interface SimulationResult {
  coverage_percent: number
  heatmap: { x: number; z: number; count: number; overlap?: boolean }[]
  uncovered_cells: number
  total_cells: number
}

interface FocusBounds {
  minX: number; minY: number; maxX: number; maxY: number
}

interface FixtureClassification {
  groupId: string
  suggestedType: string
  confidence: number
}

interface Layout3DPreviewProps {
  layoutVersionId: string
  importId?: string
  onClose?: () => void
  lidarInstances?: LidarInstance[]
  lidarModels?: LidarModel[]
  scaleCorrection?: number
  simulationResult?: SimulationResult | null
  /** Optional focus area in DXF coordinates — camera will center+zoom here */
  focusBounds?: FocusBounds
  /** Optional classifications to apply types to raw import fixtures */
  classifications?: FixtureClassification[]
  lidarPairings?: Array<{ placementId: string; lidarIp?: string; lidarId: string; reachable?: boolean }>
}

interface CustomModel {
  object_type: string
  file_path: string
}

const TYPE_COLORS: Record<string, number> = {
  shelf: 0x6366f1,
  fridge: 0x22d3ee,
  wall: 0x64748b,
  checkout: 0x22c55e,
  entrance: 0xf59e0b,
  pillar: 0x78716c,
  digital_display: 0x8b5cf6,
  radio: 0x06b6d4,
  custom: 0x8b5cf6,
  default: 0x4b5563
}

export default function Layout3DPreview({ layoutVersionId, importId, lidarInstances = [], lidarModels = [], scaleCorrection = 1.0, simulationResult = null, focusBounds, classifications, lidarPairings = [] }: Layout3DPreviewProps) {
  console.log('Layout3DPreview render - lidarInstances:', lidarInstances.length, 'lidarModels:', lidarModels.length)
  
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const animationIdRef = useRef<number>(0)
  const fixturesGroupRef = useRef<THREE.Group | null>(null)
  const wireframesGroupRef = useRef<THREE.Group | null>(null)
  const lidarGroupRef = useRef<THREE.Group | null>(null)
  const gltfLoaderRef = useRef<GLTFLoader>(new GLTFLoader())
  const loadedModelsRef = useRef<Map<string, THREE.Group>>(new Map())
  
  // Axis helper refs
  const axisSceneRef = useRef<THREE.Scene | null>(null)
  const axisCameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const axisRendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const axisContainerRef = useRef<HTMLDivElement>(null)
  
  const [isLoading, setIsLoading] = useState(true)
  const [layoutData, setLayoutData] = useState<LayoutData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showWireframe, setShowWireframe] = useState(true)
  const [customModels, setCustomModels] = useState<CustomModel[]>([])
  const [hasSavedView, setHasSavedView] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [panMode, setPanMode] = useState(false)
  const [showLidarLayer, setShowLidarLayer] = useState(true)
  const [showFixturesLayer, setShowFixturesLayer] = useState(true)
  const [showFloorplanLayer, setShowFloorplanLayer] = useState(true)
  const [showLayersPanel, setShowLayersPanel] = useState(false)
  const [show3DModels, setShow3DModels] = useState(false) // OFF by default for performance
  const floorplanMeshRef = useRef<THREE.Mesh | null>(null)

  // Hover tooltip state
  const [tooltip, setTooltip] = useState<{ x: number; y: number; data: any } | null>(null)
  const tooltipWorldPosRef = useRef<THREE.Vector3 | null>(null)
  const tooltipDivRef = useRef<HTMLDivElement>(null)
  const fixturePositionsRef = useRef<Array<{ pos: THREE.Vector3; info: any }>>([])
  const sceneCenterRef = useRef(new THREE.Vector3(0, 0, 0))

  // Toggle pan mode - swap left mouse button behavior
  const togglePanMode = useCallback(() => {
    if (!controlsRef.current) return
    
    const newPanMode = !panMode
    setPanMode(newPanMode)
    
    if (newPanMode) {
      // Pan mode: left click = pan, right click = rotate
      controlsRef.current.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
      }
    } else {
      // Normal mode: left click = rotate, right click = pan
      controlsRef.current.target.copy(sceneCenterRef.current)
      controlsRef.current.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      }
      controlsRef.current.update()
    }
  }, [panMode])

  // DB-persisted camera view ref (loaded from API)
  const dbCameraViewRef = useRef<{ position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } } | null>(null)
  const sceneBuiltRef = useRef(false)

  // Helper: apply a camera view object to the current camera+controls
  const applyCameraView = useCallback((viewData: { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }) => {
    if (!cameraRef.current || !controlsRef.current) return false
    try {
      cameraRef.current.position.set(viewData.position.x, viewData.position.y, viewData.position.z)
      controlsRef.current.target.set(viewData.target.x, viewData.target.y, viewData.target.z)
      controlsRef.current.update()
      return true
    } catch { return false }
  }, [])

  // Check if saved camera view exists (from DB first, then localStorage fallback)
  // If scene is already built, apply it immediately (fixes race condition in production)
  useEffect(() => {
    const checkSavedView = async () => {
      // Try localStorage first (instant)
      const savedView = localStorage.getItem(`dwg-camera-view-${layoutVersionId}`)
      if (savedView) {
        try {
          dbCameraViewRef.current = JSON.parse(savedView)
          setHasSavedView(true)
          // If scene already built, apply now
          if (sceneBuiltRef.current) {
            applyCameraView(dbCameraViewRef.current!)
            console.log('Camera view applied from localStorage (post-build)')
          }
        } catch { /* ignore */ }
      }
      // Then try DB (may overwrite localStorage version if newer)
      try {
        const res = await fetch(`${API_BASE}/api/dwg/layout/${layoutVersionId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.camera_view) {
            dbCameraViewRef.current = data.camera_view
            setHasSavedView(true)
            // If scene already built, apply the DB view now (race condition fix)
            if (sceneBuiltRef.current) {
              applyCameraView(data.camera_view)
              console.log('Camera view applied from DB (post-build)')
            }
            return
          }
        }
      } catch (e) {
        // API unavailable, localStorage version already loaded above
      }
    }
    checkSavedView()
  }, [layoutVersionId, applyCameraView])

  // Auto-save camera position (debounced) on orbit/pan/zoom
  const cameraAutoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startCameraAutoSaveRef = useRef<(() => void) | null>(null)
  const startCameraAutoSave = useCallback(() => {
    if (cameraAutoSaveRef.current) clearTimeout(cameraAutoSaveRef.current)
    cameraAutoSaveRef.current = setTimeout(() => {
      if (!cameraRef.current || !controlsRef.current) return
      const viewData = {
        position: { x: cameraRef.current.position.x, y: cameraRef.current.position.y, z: cameraRef.current.position.z },
        target: { x: controlsRef.current.target.x, y: controlsRef.current.target.y, z: controlsRef.current.target.z }
      }
      localStorage.setItem(`dwg-camera-view-${layoutVersionId}`, JSON.stringify(viewData))
      dbCameraViewRef.current = viewData
      setHasSavedView(true)
    }, 2000)
  }, [layoutVersionId])
  startCameraAutoSaveRef.current = startCameraAutoSave

  // Save current camera view (to DB + localStorage)
  const saveCameraView = useCallback(async () => {
    if (!cameraRef.current || !controlsRef.current) {
      console.error('Cannot save view: camera or controls not initialized')
      return
    }
    
    const viewData = {
      position: {
        x: cameraRef.current.position.x,
        y: cameraRef.current.position.y,
        z: cameraRef.current.position.z
      },
      target: {
        x: controlsRef.current.target.x,
        y: controlsRef.current.target.y,
        z: controlsRef.current.target.z
      }
    }
    
    // Save to localStorage as immediate fallback
    localStorage.setItem(`dwg-camera-view-${layoutVersionId}`, JSON.stringify(viewData))
    dbCameraViewRef.current = viewData
    
    // Save to DB for persistence across cache clears
    try {
      await fetch(`${API_BASE}/api/dwg/layout/${layoutVersionId}/view`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_view: viewData })
      })
      console.log('Camera view saved to DB')
    } catch (e) {
      console.warn('Failed to save camera view to DB:', e)
    }
    
    setHasSavedView(true)
    setJustSaved(true)
    setTimeout(() => setJustSaved(false), 1500)
  }, [layoutVersionId])

  // Load saved camera view (from DB ref first, then localStorage)
  const loadSavedCameraView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) {
      console.log('Cannot load view: camera or controls not initialized')
      return false
    }
    
    // Try DB-loaded view first
    let viewData = dbCameraViewRef.current
    if (!viewData) {
      const saved = localStorage.getItem(`dwg-camera-view-${layoutVersionId}`)
      if (!saved) return false
      try { viewData = JSON.parse(saved) } catch { return false }
    }
    if (!viewData) return false
    
    const ok = applyCameraView(viewData)
    if (ok) console.log('Camera view restored from saved')
    return ok
  }, [layoutVersionId, applyCameraView])

  // Fetch custom models list
  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/models`)
        if (res.ok) {
          const data = await res.json()
          console.log('Available 3D models:', data.map((m: CustomModel) => m.object_type))
          setCustomModels(data)
        }
      } catch (err) {
        console.error('Failed to fetch custom models:', err)
      }
    }
    fetchModels()
  }, [])

  // Load 3D model helper
  const loadModel = useCallback(async (type: string): Promise<THREE.Group | null> => {
    // Check cache first
    if (loadedModelsRef.current.has(type)) {
      console.log(`Using cached model for ${type}`)
      return loadedModelsRef.current.get(type)!.clone()
    }
    
    // Find model for this type
    const modelInfo = customModels.find(m => m.object_type === type)
    if (!modelInfo) {
      console.log(`No model found for type: ${type}`)
      return null
    }
    
    const url = `${API_BASE}${modelInfo.file_path}`
    console.log(`Loading model for ${type} from: ${url}`)
    
    return new Promise((resolve) => {
      const basePath = `${API_BASE}/api/models-static/${type}/`
      gltfLoaderRef.current.setResourcePath(basePath)
      
      gltfLoaderRef.current.load(
        url,
        (gltf) => {
          console.log(`Successfully loaded model for ${type}`)
          const obj = gltf.scene
          const box = new THREE.Box3().setFromObject(obj)
          const size = box.getSize(new THREE.Vector3())
          const center = box.getCenter(new THREE.Vector3())
          
          // Center at origin, bottom at y=0
          obj.position.set(-center.x, -box.min.y, -center.z)
          
          const group = new THREE.Group()
          group.add(obj)
          group.userData.originalSize = size
          
          loadedModelsRef.current.set(type, group)
          resolve(group.clone())
        },
        undefined,
        (err) => {
          console.error(`Failed to load GLTF for ${type}:`, err)
          resolve(null)
        }
      )
    })
  }, [customModels])

  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a24)
    sceneRef.current = scene

    // Camera - use large far plane to support scaled scenes
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 10000)
    camera.position.set(20, 20, 20)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(width, height, false) // false = don't set CSS styles
    renderer.shadowMap.enabled = true
    renderer.autoClear = false // Required for multi-viewport rendering
    // Force canvas to always fill container via absolute positioning
    const canvasEl = renderer.domElement
    canvasEl.style.position = 'absolute'
    canvasEl.style.inset = '0'
    canvasEl.style.width = '100%'
    canvasEl.style.height = '100%'
    container.appendChild(canvasEl)
    rendererRef.current = renderer

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.addEventListener('change', () => startCameraAutoSaveRef.current?.())
    controlsRef.current = controls

    // Lights - match main venue scene lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8)
    scene.add(ambientLight)

    // Hemisphere light for better ambient illumination
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6)
    hemiLight.position.set(0, 50, 0)
    scene.add(hemiLight)

    // Main directional light - positioned for larger scenes
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0)
    directionalLight.position.set(500, 1000, 500)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 5000
    scene.add(directionalLight)

    // Secondary fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5)
    fillLight.position.set(-500, 800, -500)
    scene.add(fillLight)

    // Grid and floor will be created dynamically when layout data is loaded
    // (see the layoutData useEffect below)

    // Fixtures group (3D models/boxes)
    const fixturesGroup = new THREE.Group()
    fixturesGroup.name = 'DWGFixtures'
    scene.add(fixturesGroup)
    fixturesGroupRef.current = fixturesGroup

    // Wireframes group (2D outlines on ground)
    const wireframesGroup = new THREE.Group()
    wireframesGroup.name = 'Wireframes'
    scene.add(wireframesGroup)
    wireframesGroupRef.current = wireframesGroup

    // LiDAR group
    const lidarGroup = new THREE.Group()
    lidarGroup.name = 'LiDARDevices'
    scene.add(lidarGroup)
    lidarGroupRef.current = lidarGroup

    // Axis helper scene (top-left corner gizmo)
    const axisScene = new THREE.Scene()
    axisSceneRef.current = axisScene
    
    const axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
    axisCamera.position.set(3, 3, 3)
    axisCamera.lookAt(0, 0, 0)
    axisCameraRef.current = axisCamera
    
    // Create axis arrows using ArrowHelper (RGB colors)
    const origin = new THREE.Vector3(0, 0, 0)
    const arrowLength = 1
    const headLength = 0.3
    const headWidth = 0.15
    
    // X axis - Red (horizontal)
    const xArrow = new THREE.ArrowHelper(
      new THREE.Vector3(1, 0, 0), origin, arrowLength, 0xff4444, headLength, headWidth
    )
    axisScene.add(xArrow)
    
    // Y axis - Green (horizontal, depth)
    const yArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), origin, arrowLength, 0x44ff44, headLength, headWidth
    )
    axisScene.add(yArrow)
    
    // Z axis - Blue (vertical, up from ground to ceiling)
    const zArrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0), origin, arrowLength, 0x4444ff, headLength, headWidth
    )
    axisScene.add(zArrow)
    
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
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture })
      const sprite = new THREE.Sprite(spriteMaterial)
      sprite.position.copy(position)
      sprite.scale.set(0.4, 0.4, 1)
      return sprite
    }
    
    axisScene.add(createLabel('X', 0xff4444, new THREE.Vector3(1.3, 0, 0)))
    axisScene.add(createLabel('Y', 0x44ff44, new THREE.Vector3(0, 0, 1.3)))
    axisScene.add(createLabel('Z', 0x4444ff, new THREE.Vector3(0, 1.3, 0)))
    
    // Initialize axis renderer (separate canvas)
    if (axisContainerRef.current) {
      const axisRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      axisRenderer.setSize(100, 100)
      axisRenderer.setClearColor(0x1a1a2e, 1)
      axisContainerRef.current.appendChild(axisRenderer.domElement)
      axisRendererRef.current = axisRenderer
    }

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      controls.update()
      
      // Update tooltip position by projecting 3D world pos to screen
      if (tooltipWorldPosRef.current && tooltipDivRef.current) {
        const projected = tooltipWorldPosRef.current.clone().project(camera)
        const w = container.clientWidth
        const h = container.clientHeight
        const sx = (projected.x * 0.5 + 0.5) * w
        const sy = (-projected.y * 0.5 + 0.5) * h
        tooltipDivRef.current.style.left = `${sx + 12}px`
        tooltipDivRef.current.style.top = `${sy - 10}px`
      }
      
      // Clear and render main scene
      renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height)
      renderer.setScissorTest(false)
      renderer.clear()
      renderer.render(scene, camera)
      
      // Render axis helper in separate canvas
      if (axisSceneRef.current && axisCameraRef.current && axisRendererRef.current) {
        // Sync axis camera orientation with main camera
        const dir = new THREE.Vector3()
        camera.getWorldDirection(dir)
        axisCameraRef.current.position.copy(dir).negate().multiplyScalar(4)
        axisCameraRef.current.lookAt(0, 0, 0)
        axisCameraRef.current.up.copy(camera.up)
        
        axisRendererRef.current.render(axisSceneRef.current, axisCameraRef.current)
      }
    }
    animate()

    // Handle resize — use ResizeObserver for reliable tracking
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      if (w === 0 || h === 0) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false) // false = preserve our CSS sizing
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)

    // Hover tooltip — screen-space proximity: project each fixture to screen, find closest to mouse
    let rafPending = false
    let lastMouseScreenX = 0, lastMouseScreenY = 0
    const TOOLTIP_PIXEL_THRESHOLD = 30 // max pixel distance from fixture center to trigger tooltip
    const _projVec = new THREE.Vector3()

    const doHoverCheck = () => {
      rafPending = false
      const cam = cameraRef.current
      if (!cam) return

      const positions = fixturePositionsRef.current
      if (positions.length === 0) { tooltipWorldPosRef.current = null; setTooltip(null); return }

      const cw = container.clientWidth
      const ch = container.clientHeight
      if (cw === 0 || ch === 0) return

      let bestDist = Infinity
      let bestInfo: any = null
      let bestPos: THREE.Vector3 | null = null
      let bestSx = 0, bestSy = 0

      for (const fp of positions) {
        // Project fixture's 3D position to screen pixels
        _projVec.copy(fp.pos).project(cam)
        // Skip if behind camera
        if (_projVec.z > 1) continue
        const sx = (_projVec.x * 0.5 + 0.5) * cw
        const sy = (-_projVec.y * 0.5 + 0.5) * ch
        const dx = sx - lastMouseScreenX
        const dy = sy - lastMouseScreenY
        const dist = dx * dx + dy * dy
        if (dist < bestDist) {
          bestDist = dist
          bestInfo = fp.info
          bestPos = fp.pos
          bestSx = sx
          bestSy = sy
        }
      }

      const pixelDist = Math.sqrt(bestDist)
      if (pixelDist < TOOLTIP_PIXEL_THRESHOLD && bestInfo && bestPos) {
        tooltipWorldPosRef.current = bestPos.clone()
        setTooltip({ x: bestSx, y: bestSy, data: bestInfo })
      } else {
        tooltipWorldPosRef.current = null
        setTooltip(null)
      }
    }
    const handleMouseMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      lastMouseScreenX = e.clientX - rect.left
      lastMouseScreenY = e.clientY - rect.top
      if (!rafPending) {
        rafPending = true
        requestAnimationFrame(doHoverCheck)
      }
    }
    const handleMouseLeave = () => {
      tooltipWorldPosRef.current = null
      setTooltip(null)
    }
    container.addEventListener('mousemove', handleMouseMove)
    container.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      resizeObserver.disconnect()
      container.removeEventListener('mousemove', handleMouseMove)
      container.removeEventListener('mouseleave', handleMouseLeave)
      cancelAnimationFrame(animationIdRef.current)
      renderer.dispose()
      container.removeChild(renderer.domElement)
      if (axisRendererRef.current && axisContainerRef.current) {
        axisRendererRef.current.dispose()
        axisContainerRef.current.innerHTML = ''
      }
    }
  }, [])

  // Load layout data
  useEffect(() => {
    const loadLayout = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        const res = await fetch(`${API_BASE}/api/dwg/layout/${layoutVersionId}`)
        if (!res.ok) {
          throw new Error('Failed to load layout')
        }
        const data = await res.json()
        console.log('Layout data loaded:', data.layout)
        console.log('Fixtures count:', data.layout?.fixtures?.length || 0)
        
        // If layout has no mapped fixtures, fall back to raw import fixtures
        if (!data.layout?.fixtures?.length && importId) {
          console.log('[Layout3DPreview] No mapped fixtures, falling back to import fixtures...')
          try {
            const impRes = await fetch(`${API_BASE}/api/dwg/import/${importId}`)
            if (impRes.ok) {
              const impData = await impRes.json()
              const rawFixtures = impData.fixtures || []
              console.log(`[Layout3DPreview] Loaded ${rawFixtures.length} raw fixtures from import`)
              if (rawFixtures.length > 0) {
                // Build classification lookup: groupId → type
                const classMap = new Map<string, string>()
                if (classifications?.length) {
                  classifications.forEach(c => classMap.set(c.groupId, c.suggestedType))
                }
                // Convert raw import fixtures to layout fixture format
                const layoutFixtures: LayoutFixture[] = rawFixtures.map((fx: any) => {
                  const classType = classMap.get(fx.group_id) || null
                  return {
                    id: fx.id,
                    group_id: fx.group_id || fx.id,
                    pose2d: fx.pose2d,
                    footprint: fx.footprint,
                    mapping: classType ? { catalog_asset_id: classType, type: classType } : null,
                    source: fx.source,
                  }
                })
                data.layout.fixtures = layoutFixtures
                data.layout.total_count = layoutFixtures.length
                console.log(`[Layout3DPreview] Applied ${classMap.size} classifications to ${layoutFixtures.length} fixtures`)
              }
            }
          } catch (fallbackErr) {
            console.warn('[Layout3DPreview] Failed to load import fixtures:', fallbackErr)
          }
        }
        
        setLayoutData(data.layout)
        
        if (!data.layout?.fixtures?.length) {
          setError('No fixtures available. Upload a DWG and generate a layout first.')
        }
      } catch (err: any) {
        setError(err.message)
      } finally {
        setIsLoading(false)
      }
    }
    
    if (layoutVersionId) {
      loadLayout()
    }
  }, [layoutVersionId, importId])

  // Render fixtures in 3D
  useEffect(() => {
    if (!layoutData || !fixturesGroupRef.current || !sceneRef.current) return
    console.log('Rendering fixtures with', customModels.length, 'custom models available')

    const group = fixturesGroupRef.current
    
    // Clear fixture positions for tooltip proximity fallback
    fixturePositionsRef.current = []

    // Clear existing fixtures
    while (group.children.length > 0) {
      const child = group.children[0]
      group.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    }
    
    // Clear existing wireframes
    if (wireframesGroupRef.current) {
      const wireGroup = wireframesGroupRef.current
      while (wireGroup.children.length > 0) {
        const child = wireGroup.children[0]
        wireGroup.remove(child)
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          (child as THREE.Mesh).geometry?.dispose()
        }
      }
    }

    const { fixtures: allFixtures, unit_scale_to_m, bounds } = layoutData
    const scene = sceneRef.current
    
    // Start with all fixtures - DON'T filter by ROI (use ROI for camera positioning only)
    // The layout already contains only the filtered fixtures from the import
    let fixtures = allFixtures
    
    // Filter out noise types (pillar/entrance) unless it would hide everything
    const HIDDEN_TYPES = new Set(['pillar', 'entrance'])
    const HIDDEN_GROUPS = new Set(['grp_8c6e7b', 'grp_1867a6', 'grp_915c41', 'grp_aba5ea'])
    const typeFiltered = fixtures.filter(f => {
      const type = f.mapping?.type
      if (type && HIDDEN_TYPES.has(type)) return false
      if (f.group_id && HIDDEN_GROUPS.has(f.group_id)) return false
      return true
    })
    
    // Use type-filtered if it has results, otherwise keep ROI-filtered
    if (typeFiltered.length > 0) {
      if (typeFiltered.length < fixtures.length) {
        console.log(`[3D] Type filter: removed ${fixtures.length - typeFiltered.length} noise fixtures`)
      }
      fixtures = typeFiltered
    } else if (fixtures.length > 0) {
      console.warn(`[3D] Type filter would hide all ${fixtures.length} fixtures - keeping them`)
    }
    
    // Center offset - PRIORITY: ROI > fixtures > layout bounds
    // When ROI exists, center on it (user explicitly defined the area of interest)
    const effectiveScale = unit_scale_to_m * scaleCorrection
    
    let centerX: number, centerZ: number, centerSource: string
    
    if (focusBounds) {
      // Use ROI center - this is the user's defined area of interest
      centerX = (focusBounds.minX + focusBounds.maxX) / 2 * effectiveScale
      centerZ = (focusBounds.minY + focusBounds.maxY) / 2 * effectiveScale
      centerSource = 'ROI'
    } else {
      // Fall back to fixture bounds
      let fxMinX = Infinity, fxMaxX = -Infinity, fxMinY = Infinity, fxMaxY = -Infinity
      for (const f of fixtures) {
        const x = f.pose2d?.x || 0
        const y = f.pose2d?.y || 0
        fxMinX = Math.min(fxMinX, x)
        fxMaxX = Math.max(fxMaxX, x)
        fxMinY = Math.min(fxMinY, y)
        fxMaxY = Math.max(fxMaxY, y)
      }
      if (fxMinX !== Infinity) {
        centerX = (fxMinX + fxMaxX) / 2 * effectiveScale
        centerZ = (fxMinY + fxMaxY) / 2 * effectiveScale
        centerSource = 'fixtures'
      } else {
        centerX = (bounds.minX + bounds.maxX) / 2 * effectiveScale
        centerZ = (bounds.minY + bounds.maxY) / 2 * effectiveScale
        centerSource = 'bounds'
      }
    }
    
    console.log(`[3D] Center calculated from ${centerSource}: (${centerX.toFixed(2)}, ${centerZ.toFixed(2)})`)
    
    // Calculate ACTUAL content bounds from fixtures (not raw DWG bounds which can be huge)
    let contentMinX = Infinity, contentMaxX = -Infinity
    let contentMinZ = Infinity, contentMaxZ = -Infinity
    
    fixtures.forEach(fixture => {
      if (fixture.footprint.points && fixture.footprint.points.length > 0) {
        fixture.footprint.points.forEach(pt => {
          const x = pt.x * effectiveScale - centerX
          const z = pt.y * effectiveScale - centerZ
          contentMinX = Math.min(contentMinX, x)
          contentMaxX = Math.max(contentMaxX, x)
          contentMinZ = Math.min(contentMinZ, z)
          contentMaxZ = Math.max(contentMaxZ, z)
        })
      } else {
        const x = fixture.pose2d.x * effectiveScale - centerX
        const z = fixture.pose2d.y * effectiveScale - centerZ
        const halfW = (fixture.footprint.w * effectiveScale) / 2
        const halfD = (fixture.footprint.d * effectiveScale) / 2
        contentMinX = Math.min(contentMinX, x - halfW)
        contentMaxX = Math.max(contentMaxX, x + halfW)
        contentMinZ = Math.min(contentMinZ, z - halfD)
        contentMaxZ = Math.max(contentMaxZ, z + halfD)
      }
    })
    
    // Also include LiDAR positions in content bounds
    lidarInstances.forEach(inst => {
      const x = inst.x_m - centerX
      const z = inst.z_m - centerZ
      contentMinX = Math.min(contentMinX, x - 10)
      contentMaxX = Math.max(contentMaxX, x + 10)
      contentMinZ = Math.min(contentMinZ, z - 10)
      contentMaxZ = Math.max(contentMaxZ, z + 10)
    })
    
    // Calculate content size (actual fixtures + LiDARs, not raw DWG bounds)
    const contentWidth = contentMaxX - contentMinX
    const contentDepth = contentMaxZ - contentMinZ
    const maxContentSize = Math.max(contentWidth, contentDepth)
    
    // Fallback to DWG bounds only if no content found
    const rawBoundsWidth = (bounds.maxX - bounds.minX) * effectiveScale
    const rawBoundsDepth = (bounds.maxY - bounds.minY) * effectiveScale
    
    // Use content bounds if valid, otherwise cap at reasonable size
    const useContentBounds = isFinite(maxContentSize) && maxContentSize > 0
    const sceneSize = useContentBounds 
      ? Math.max(maxContentSize * 1.5, 50) // 1.5x content, min 50m
      : Math.min(Math.max(rawBoundsWidth, rawBoundsDepth) * 1.5, 500) // Cap at 500m for raw bounds
    
    const gridDivisions = Math.min(Math.ceil(sceneSize), 200) // 1m per division, max 200

    // Calculate center of actual content (to position grid there)
    const contentCenterX = useContentBounds ? (contentMinX + contentMaxX) / 2 : 0
    const contentCenterZ = useContentBounds ? (contentMinZ + contentMaxZ) / 2 : 0
    sceneCenterRef.current.set(contentCenterX, 0, contentCenterZ)
    
    console.log(`Raw DWG bounds: ${rawBoundsWidth.toFixed(1)}m x ${rawBoundsDepth.toFixed(1)}m`)
    console.log(`Content bounds: ${contentWidth.toFixed(1)}m x ${contentDepth.toFixed(1)}m, using: ${useContentBounds ? 'content' : 'raw'}, grid size: ${sceneSize.toFixed(1)}m`)
    console.log(`Content center: (${contentCenterX.toFixed(1)}, ${contentCenterZ.toFixed(1)})`)
    console.log(`Rendering ${fixtures.length} fixtures, scaleCorrection: ${scaleCorrection}, effectiveScale: ${effectiveScale}, center: (${centerX.toFixed(2)}, ${centerZ.toFixed(2)})`)
    
    // Remove old grid and floor if they exist
    const oldGrid = scene.getObjectByName('DynamicGrid')
    const oldFloor = scene.getObjectByName('DynamicFloor')
    if (oldGrid) scene.remove(oldGrid)
    if (oldFloor) scene.remove(oldFloor)
    
    // Create grid sized to actual scene bounds, positioned at content center
    const gridHelper = new THREE.GridHelper(sceneSize, gridDivisions, 0x444466, 0x333344)
    gridHelper.name = 'DynamicGrid'
    gridHelper.position.set(contentCenterX, 0, contentCenterZ)
    scene.add(gridHelper)
    
    // Create floor sized to actual scene bounds, positioned at content center
    const floorGeometry = new THREE.PlaneGeometry(sceneSize * 1.2, sceneSize * 1.2)
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x1a1a24, 
      roughness: 0.9 
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.name = 'DynamicFloor'
    floor.position.set(contentCenterX, 0, contentCenterZ)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    // Add fixtures
    fixtures.forEach((fixture, idx) => {
      const { pose2d, footprint, mapping } = fixture
      
      // Calculate position, rotation, and size from polygon if available
      let x: number, z: number, rotationRad: number, w: number, d: number
      
      if (footprint.points && footprint.points.length >= 3) {
        // Calculate actual centroid from polygon points
        const sumX = footprint.points.reduce((sum, pt) => sum + pt.x, 0)
        const sumY = footprint.points.reduce((sum, pt) => sum + pt.y, 0)
        const centroidX = sumX / footprint.points.length
        const centroidY = sumY / footprint.points.length
        x = centroidX * effectiveScale - centerX
        z = centroidY * effectiveScale - centerZ
        
        // Calculate rotation from first edge direction
        const p0 = footprint.points[0]
        const p1 = footprint.points[1]
        const edgeDx = p1.x - p0.x
        const edgeDy = p1.y - p0.y
        // Angle of first edge - negate for Three.js Y-up coordinate system
        rotationRad = -Math.atan2(edgeDy, edgeDx)
        
        // Compute oriented bounding box (OBB) aligned to first edge
        // This gives correct w/d that match the polygon's actual orientation
        const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy)
        const ux = edgeLen > 0 ? edgeDx / edgeLen : 1  // unit vector along edge
        const uy = edgeLen > 0 ? edgeDy / edgeLen : 0
        let minProj = Infinity, maxProj = -Infinity
        let minPerp = Infinity, maxPerp = -Infinity
        for (const pt of footprint.points) {
          const dx = pt.x - centroidX
          const dy = pt.y - centroidY
          const proj = dx * ux + dy * uy      // along edge
          const perp = -dx * uy + dy * ux     // perpendicular to edge
          minProj = Math.min(minProj, proj)
          maxProj = Math.max(maxProj, proj)
          minPerp = Math.min(minPerp, perp)
          maxPerp = Math.max(maxPerp, perp)
        }
        w = (maxProj - minProj) * effectiveScale  // extent along first edge
        d = (maxPerp - minPerp) * effectiveScale  // extent perpendicular to first edge
      } else {
        // Fallback to pose2d and footprint dimensions
        x = pose2d.x * effectiveScale - centerX
        z = pose2d.y * effectiveScale - centerZ
        rotationRad = -pose2d.rot_deg * Math.PI / 180
        w = footprint.w * effectiveScale
        d = footprint.d * effectiveScale
      }
      
      // If size is 0, use a default visible size based on bounds
      if (w < 0.1 || d < 0.1) {
        const defaultSize = Math.max(1, (bounds.maxX - bounds.minX) * unit_scale_to_m * 0.01)
        w = w < 0.1 ? defaultSize : w
        d = d < 0.1 ? defaultSize : d
      }
      
      const h = Math.max(0.5, Math.min(w, d) * 0.5) // Height based on size
      
      if (idx < 5) {
        console.log(`[Layout3DPreview] Fixture #${idx}: "${fixture.id}" type=${mapping?.type || 'default'}`)
        console.log(`    position: x=${x.toFixed(3)}, z=${z.toFixed(3)}`)
        console.log(`    scale: x=${w.toFixed(3)}, y=${h.toFixed(3)}, z=${d.toFixed(3)}`)
        console.log(`    rotation: y=${(rotationRad * 180 / Math.PI).toFixed(1)}°`)
      }
      
      // Register fixture position for proximity-based tooltip fallback
      const fixtureInfo = {
        id: fixture.id,
        groupId: fixture.group_id,
        type: mapping?.type || 'unmapped',
        catalogAsset: mapping?.catalog_asset_id || 'none',
        w: +w.toFixed(2),
        d: +d.toFixed(2),
        h: +h.toFixed(2),
        vol: +(w * d * h).toFixed(2),
        kind: footprint.kind || 'rect',
        nPts: footprint.points?.length || 0,
        posX: +x.toFixed(2),
        posZ: +z.toFixed(2),
        rotDeg: +(rotationRad * 180 / Math.PI).toFixed(1),
      }
      fixturePositionsRef.current.push({ pos: new THREE.Vector3(x, h / 2, z), info: fixtureInfo })

      // Dump to console for debug
      if (mapping?.type === 'checkout') {
        console.log(`%c CHECKOUT #${idx}: ${fixture.id}  →  W=${w.toFixed(3)}m  D=${d.toFixed(3)}m  H=${h.toFixed(3)}m  pos=(${x.toFixed(2)}, ${z.toFixed(2)})`, 'color:#22c55e;font-size:14px;font-weight:bold')
      }

      // Color based on type
      const type = mapping?.type || 'default'
      const catalogAssetId = mapping?.catalog_asset_id || type
      const color = TYPE_COLORS[type] || TYPE_COLORS.default
      
      // Try to load GLTF model, fallback to box
      const addFixtureMesh = async () => {
        // Only load 3D models if toggle is ON (default OFF for performance)
        let model: THREE.Group | null = null
        if (show3DModels) {
          // Try loading by catalog_asset_id first, then by type
          model = await loadModel(catalogAssetId)
          if (!model && catalogAssetId !== type) {
            model = await loadModel(type)
          }
        }
        
        if (idx < 3) {
          console.log(`Fixture ${fixture.id}: catalogAssetId=${catalogAssetId}, type=${type}, modelLoaded=${!!model}`)
        }
        
        if (model) {
          // Scale model to fit the footprint, auto-rotate 90° if aspect ratios disagree
          const originalSize = model.userData.originalSize as THREE.Vector3
          let extraRot = 0
          if (originalSize) {
            const modelAspect = originalSize.x / originalSize.z
            const wireAspect = w / d
            // If model is long along X but wireframe is long along Z (or vice versa), rotate 90°
            const needsSwap = (modelAspect > 1.2) !== (wireAspect > 1.2) &&
                              Math.abs(modelAspect - 1) > 0.15 && Math.abs(wireAspect - 1) > 0.15
            if (needsSwap) {
              extraRot = Math.PI / 2
              const scaleX = d / originalSize.x  // swap: wireframe depth → model X
              const scaleZ = w / originalSize.z  // swap: wireframe width → model Z
              const scaleY = Math.min(scaleX, scaleZ)
              model.scale.set(scaleX, scaleY, scaleZ)
            } else {
              const scaleX = w / originalSize.x
              const scaleZ = d / originalSize.z
              const scaleY = Math.min(scaleX, scaleZ)
              model.scale.set(scaleX, scaleY, scaleZ)
            }
          }
          
          model.position.set(x, 0, z)
          model.rotation.y = rotationRad + extraRot
          model.userData.fixtureId = fixture.id
          model.userData.fixtureInfo = fixtureInfo
          group.add(model)
        } else if (footprint.points && footprint.points.length >= 3) {
          // Polygon fixture: extrude actual polygon shape so 3D mesh matches wireframe
          const shape = new THREE.Shape()
          const pts = footprint.points.map((pt: {x: number, y: number}) => ({
            sx: pt.x * effectiveScale - centerX - x,   // relative to centroid X
            sy: -(pt.y * effectiveScale - centerZ - z)  // relative to centroid Z, negated for rotateX
          }))
          shape.moveTo(pts[0].sx, pts[0].sy)
          for (let i = 1; i < pts.length; i++) {
            shape.lineTo(pts[i].sx, pts[i].sy)
          }
          shape.closePath()

          const geometry = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
          geometry.rotateX(-Math.PI / 2) // Rotate so extrusion goes upward (Y axis)
          const material = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1 })
          const mesh = new THREE.Mesh(geometry, material)
          mesh.position.set(x, 0, z)
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.userData.fixtureId = fixture.id
          mesh.userData.fixtureInfo = fixtureInfo
          group.add(mesh)
        } else {
          // Rect fixture: simple box
          const geometry = new THREE.BoxGeometry(w, h, d)
          const material = new THREE.MeshStandardMaterial({ 
            color, 
            roughness: 0.7,
            metalness: 0.1
          })
          const mesh = new THREE.Mesh(geometry, material)
          
          mesh.position.set(x, h / 2, z)
          mesh.rotation.y = rotationRad
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.userData.fixtureId = fixture.id
          mesh.userData.fixtureInfo = fixtureInfo
          
          group.add(mesh)
        }
      }
      
      addFixtureMesh()

      // Add 2D wireframe outline on ground plane - use actual DWG polygon if available
      // Wireframes go to separate group so they can be toggled independently
      if (showWireframe && wireframesGroupRef.current) {
        const wireGroup = wireframesGroupRef.current
        let outlinePoints: THREE.Vector3[]
        
        // Check if we have polygon points from the DWG
        if (footprint.points && footprint.points.length >= 3) {
          // Use actual DWG polygon geometry - render in world coordinates
          outlinePoints = footprint.points.map((pt: {x: number, y: number}) => 
            new THREE.Vector3(
              pt.x * effectiveScale - centerX,
              0.02,
              pt.y * effectiveScale - centerZ
            )
          )
          // Close the polygon
          outlinePoints.push(outlinePoints[0].clone())
          
          const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints)
          const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2 }) // Cyan for actual DWG
          const outline = new THREE.Line(outlineGeometry, outlineMaterial)
          // No position offset or rotation needed - points are in world coords
          wireGroup.add(outline)
        } else {
          // Fallback: simple rectangle based on footprint w/d
          outlinePoints = [
            new THREE.Vector3(-w/2, 0.01, -d/2),
            new THREE.Vector3(w/2, 0.01, -d/2),
            new THREE.Vector3(w/2, 0.01, d/2),
            new THREE.Vector3(-w/2, 0.01, d/2),
            new THREE.Vector3(-w/2, 0.01, -d/2),
          ]
          const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints)
          const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 }) // Green for computed
          const outline = new THREE.Line(outlineGeometry, outlineMaterial)
          outline.position.set(x, 0, z)
          outline.rotation.y = rotationRad
          wireGroup.add(outline)
        }

        // Add center marker and direction indicator for 3D box position
        const markerGeometry = new THREE.RingGeometry(0.1, 0.15, 8)
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide })
        const marker = new THREE.Mesh(markerGeometry, markerMaterial)
        marker.position.set(x, 0.03, z)
        marker.rotation.x = -Math.PI / 2
        wireGroup.add(marker)

        // Direction arrow from center
        const arrowPoints = [
          new THREE.Vector3(0, 0.02, 0),
          new THREE.Vector3(w * 0.4, 0.02, 0),
        ]
        const arrowGeometry = new THREE.BufferGeometry().setFromPoints(arrowPoints)
        const arrowMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 })
        const arrow = new THREE.Line(arrowGeometry, arrowMaterial)
        arrow.position.set(x, 0, z)
        arrow.rotation.y = rotationRad
        wireGroup.add(arrow)
      }
    })

    // Mark scene as built so async camera view fetch can apply when it arrives
    sceneBuiltRef.current = true

    // Update camera to fit scene
    if (cameraRef.current && controlsRef.current) {
      // Priority: (1) focusBounds from ROI (skip saved view since ROI changes center), (2) saved camera view, (3) default content bounds
      // When ROI exists, always use ROI-based camera - saved view would be pointing at wrong location
      if (focusBounds) {
          const fbCenterX = (focusBounds.minX + focusBounds.maxX) / 2 * effectiveScale - centerX
          const fbCenterZ = (focusBounds.minY + focusBounds.maxY) / 2 * effectiveScale - centerZ
          const fbWidth = (focusBounds.maxX - focusBounds.minX) * effectiveScale
          const fbDepth = (focusBounds.maxY - focusBounds.minY) * effectiveScale
          const fbSize = Math.max(fbWidth, fbDepth, 10) // min 10m to avoid too-close zoom

          // Elevated angled view — far enough to see entire ROI
          cameraRef.current.position.set(
            fbCenterX + fbSize * 0.8,
            fbSize * 0.7,
            fbCenterZ + fbSize * 0.8
          )
          controlsRef.current.target.set(fbCenterX, 0, fbCenterZ)
          controlsRef.current.update()
          console.log(`[3D] Camera focused on ROI bounds: center=(${fbCenterX.toFixed(1)}, ${fbCenterZ.toFixed(1)}), size=${fbSize.toFixed(1)}m`)
      } else if (!loadSavedCameraView()) {
        // No ROI and no saved view, use default based on content bounds
        const maxSize = useContentBounds ? maxContentSize : Math.max(rawBoundsWidth, rawBoundsDepth)
        
        // Position camera relative to content center for proper rotation
        cameraRef.current.position.set(
          contentCenterX + maxSize * 0.8, 
          maxSize * 0.6, 
          contentCenterZ + maxSize * 0.8
        )
        // Set rotation target to content center (not origin) for intuitive rotation
        controlsRef.current.target.set(contentCenterX, 0, contentCenterZ)
        controlsRef.current.update()
        console.log(`[3D] Camera target set to content center: (${contentCenterX.toFixed(1)}, 0, ${contentCenterZ.toFixed(1)})`)
      }
    }

  }, [layoutData, showWireframe, loadModel, customModels, loadSavedCameraView, scaleCorrection, focusBounds, show3DModels])

  // Toggle fixtures layer visibility
  useEffect(() => {
    if (fixturesGroupRef.current) {
      fixturesGroupRef.current.visible = showFixturesLayer
    }
  }, [showFixturesLayer])

  // Toggle wireframes layer visibility
  useEffect(() => {
    if (wireframesGroupRef.current) {
      wireframesGroupRef.current.visible = showWireframe
    }
  }, [showWireframe])

  // Render LiDAR devices in 3D
  useEffect(() => {
    console.log('=== 3D LiDAR Render Effect ===')
    console.log('lidarGroupRef.current:', !!lidarGroupRef.current)
    console.log('layoutData:', !!layoutData)
    console.log('lidarInstances:', lidarInstances.length)
    
    if (!lidarGroupRef.current) return
    
    const group = lidarGroupRef.current
    
    // Clear existing LiDAR meshes
    while (group.children.length > 0) {
      const child = group.children[0]
      group.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (child.material instanceof THREE.Material) {
          child.material.dispose()
        }
      }
    }
    
    if (lidarInstances.length === 0) {
      return
    }
    
    // Calculate center - MUST match fixture center calculation (ROI > bounds)
    let centerX = 0, centerZ = 0
    if (focusBounds) {
      // Use ROI center - same as fixtures
      const effectiveScale = layoutData ? layoutData.unit_scale_to_m * scaleCorrection : 1
      centerX = (focusBounds.minX + focusBounds.maxX) / 2 * effectiveScale
      centerZ = (focusBounds.minY + focusBounds.maxY) / 2 * effectiveScale
      console.log('LiDAR using ROI center:', centerX.toFixed(2), centerZ.toFixed(2))
    } else if (layoutData) {
      const { bounds, unit_scale_to_m } = layoutData
      const effectiveScale = unit_scale_to_m * scaleCorrection
      centerX = (bounds.minX + bounds.maxX) / 2 * effectiveScale
      centerZ = (bounds.minY + bounds.maxY) / 2 * effectiveScale
      console.log('LiDAR using bounds center:', centerX.toFixed(2), centerZ.toFixed(2))
    } else {
      // Fallback: calculate center from LiDAR positions
      const lidarXs = lidarInstances.map(i => i.x_m)
      const lidarZs = lidarInstances.map(i => i.z_m)
      centerX = (Math.min(...lidarXs) + Math.max(...lidarXs)) / 2
      centerZ = (Math.min(...lidarZs) + Math.max(...lidarZs)) / 2
      console.log('LiDAR using LiDAR-based center:', centerX.toFixed(2), centerZ.toFixed(2))
    }
    
    // Create reusable geometries for performance
    const deviceGeometry = new THREE.SphereGeometry(0.3, 16, 16)
    const domeGeometry = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    
    lidarInstances.forEach((inst, idx) => {
      const model = lidarModels.find(m => m.id === inst.model_id)
      const pairing = lidarPairings.find(p => p.placementId === inst.id)
      const pairedOnline = pairing?.reachable === true
      const pairedOffline = !!pairing && pairing.reachable === false
      const lidarColor = pairedOnline ? 0x22c55e : pairedOffline ? 0xef4444 : 0x3b82f6
      const range = inst.range_m || model?.range_m || 10
      const mountHeight = inst.mount_y_m ?? inst.y_m ?? 3
      const isDome = model?.dome_mode || (model?.hfov_deg ?? 360) >= 360
      
      // Position in world coordinates (inst.x_m and inst.z_m are already in meters)
      const x = inst.x_m - centerX
      const z = inst.z_m - centerZ
      
      console.log(`LiDAR ${idx}: mount_y_m=${inst.mount_y_m}, y_m=${inst.y_m}, mountHeight=${mountHeight}, position=(${x.toFixed(1)}, ${mountHeight}, ${z.toFixed(1)})`)
      
      if (idx === 0) {
        console.log('First LiDAR:', {
          'inst.x_m': inst.x_m,
          'inst.z_m': inst.z_m,
          'inst.y_m': inst.y_m,
          'centerX': centerX,
          'centerZ': centerZ,
          'final x': x,
          'final z': z,
          'mountHeight': mountHeight,
          'range': range
        })
      }
      
      // LiDAR device sphere at mount height
      const deviceMaterial = new THREE.MeshStandardMaterial({
        color: lidarColor,
        roughness: 0.3,
        metalness: 0.7
      })
      const device = new THREE.Mesh(deviceGeometry.clone(), deviceMaterial)
      device.position.set(x, mountHeight, z)
      device.castShadow = true
      group.add(device)
      fixturePositionsRef.current.push({
        pos: new THREE.Vector3(x, mountHeight, z),
        info: {
          kind: 'lidar',
          type: 'LiDAR',
          ip: pairing?.lidarIp || 'Unpaired',
          model: model?.name || inst.model_id || 'Unknown',
          status: pairedOnline ? 'Online' : pairedOffline ? 'Offline' : pairing ? 'Unknown' : 'Unpaired',
          placementId: inst.id,
          posX: +x.toFixed(2),
          posZ: +z.toFixed(2),
        }
      })
      
      // Mount pole
      const poleGeometry = new THREE.CylinderGeometry(0.05, 0.05, mountHeight, 8)
      const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x666666 })
      const pole = new THREE.Mesh(poleGeometry, poleMaterial)
      pole.position.set(x, mountHeight / 2, z)
      group.add(pole)
      
      // FOV dome/hemisphere (translucent coverage visualization)
      if (isDome) {
        // Full dome coverage
        const coverageMaterial = new THREE.MeshBasicMaterial({
          color: lidarColor,
          transparent: true,
          opacity: 0.08,
          side: THREE.DoubleSide,
          depthWrite: false
        })
        const coverage = new THREE.Mesh(domeGeometry.clone(), coverageMaterial)
        coverage.scale.set(range, range * 0.3, range) // Flatten the dome
        coverage.position.set(x, mountHeight, z)
        coverage.rotation.x = Math.PI // Flip to point downward
        group.add(coverage)
        
        // Coverage circle on floor
        const circleGeometry = new THREE.RingGeometry(range - 0.1, range, 64)
        const circleMaterial = new THREE.MeshBasicMaterial({
          color: lidarColor,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide
        })
        const circle = new THREE.Mesh(circleGeometry, circleMaterial)
        circle.position.set(x, 0.05, z)
        circle.rotation.x = -Math.PI / 2
        group.add(circle)
      } else {
        // Non-dome: FOV cone visualization
        const hfov = model?.hfov_deg || 90
        const vfov = model?.vfov_deg || 30
        const yaw = (inst.yaw_deg || 0) * Math.PI / 180
        
        // Create cone geometry for FOV
        const coneAngle = (hfov / 2) * Math.PI / 180
        const coneHeight = Math.min(range, mountHeight) // Don't go below floor
        const coneRadius = Math.tan(coneAngle) * coneHeight
        const coneGeometry = new THREE.ConeGeometry(coneRadius, coneHeight, 32, 1, true)
        const coneMaterial = new THREE.MeshBasicMaterial({
          color: lidarColor,
          transparent: true,
          opacity: 0.12,
          side: THREE.DoubleSide,
          depthWrite: false
        })
        const cone = new THREE.Mesh(coneGeometry, coneMaterial)
        cone.position.set(x, mountHeight - coneHeight / 2, z)
        cone.rotation.x = Math.PI // Point downward
        cone.rotation.y = yaw
        group.add(cone)
        
        // FOV arc on floor
        const arcGeometry = new THREE.RingGeometry(range * 0.9, range, 32, 1, -coneAngle + yaw + Math.PI / 2, hfov * Math.PI / 180)
        const arcMaterial = new THREE.MeshBasicMaterial({
          color: lidarColor,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide
        })
        const arc = new THREE.Mesh(arcGeometry, arcMaterial)
        arc.position.set(x, 0.05, z)
        arc.rotation.x = -Math.PI / 2
        group.add(arc)
      }
    })
    
    // Add simulation heatmap on floor (coverage visualization)
    if (simulationResult && simulationResult.heatmap && simulationResult.heatmap.length > 0) {
      const cellSize = 0.5 // meters
      const heatmapGroup = new THREE.Group()
      heatmapGroup.name = 'heatmap'
      
      simulationResult.heatmap.forEach((cell) => {
        const cellX = cell.x - centerX
        const cellZ = cell.z - centerZ
        const intensity = Math.min(cell.count / 3, 1)
        
        // Coverage cell
        const cellGeometry = new THREE.PlaneGeometry(cellSize * 0.9, cellSize * 0.9)
        const cellMaterial = new THREE.MeshBasicMaterial({
          color: cell.overlap ? 0x00ff64 : 0x0096ff,
          transparent: true,
          opacity: intensity * 0.4,
          side: THREE.DoubleSide,
          depthWrite: false
        })
        const cellMesh = new THREE.Mesh(cellGeometry, cellMaterial)
        cellMesh.position.set(cellX, 0.02, cellZ)
        cellMesh.rotation.x = -Math.PI / 2
        heatmapGroup.add(cellMesh)
      })
      
      group.add(heatmapGroup)
      console.log('Added heatmap with', simulationResult.heatmap.length, 'cells, coverage:', simulationResult.coverage_percent.toFixed(1) + '%')
    }
    
    console.log('Added', group.children.length, 'objects to LiDAR group')
    
    // Auto-position camera to view LiDARs if no layoutData
    if (!layoutData && cameraRef.current && controlsRef.current && lidarInstances.length > 0) {
      const lidarXs = lidarInstances.map(i => i.x_m - centerX)
      const lidarZs = lidarInstances.map(i => i.z_m - centerZ)
      const minX = Math.min(...lidarXs)
      const maxX = Math.max(...lidarXs)
      const minZ = Math.min(...lidarZs)
      const maxZ = Math.max(...lidarZs)
      const contentWidth = maxX - minX
      const contentDepth = maxZ - minZ
      const maxSize = Math.max(contentWidth, contentDepth, 20)
      
      cameraRef.current.position.set(maxSize * 0.8, maxSize * 0.6, maxSize * 0.8)
      controlsRef.current.target.set(0, 0, 0)
      controlsRef.current.update()
      console.log('Repositioned camera for LiDAR view, content size:', maxSize.toFixed(1), 'm')
    }
    
  }, [lidarInstances, lidarModels, layoutData, scaleCorrection, simulationResult, lidarPairings])

  // Toggle LiDAR layer visibility
  useEffect(() => {
    if (lidarGroupRef.current) {
      lidarGroupRef.current.visible = showLidarLayer
    }
  }, [showLidarLayer])

  // Toggle floorplan layer visibility
  useEffect(() => {
    if (floorplanMeshRef.current) {
      floorplanMeshRef.current.visible = showFloorplanLayer
    }
  }, [showFloorplanLayer])

  // Load and render floor plan image as textured plane on the floor
  useEffect(() => {
    if (!sceneRef.current || !layoutData || !importId) return
    const scene = sceneRef.current

    // Remove existing floorplan mesh
    if (floorplanMeshRef.current) {
      scene.remove(floorplanMeshRef.current)
      floorplanMeshRef.current.geometry.dispose()
      if (floorplanMeshRef.current.material instanceof THREE.Material) {
        floorplanMeshRef.current.material.dispose()
      }
      floorplanMeshRef.current = null
    }

    const loadFloorplanTexture = async () => {
      try {
        // Fetch floorplan metadata
        const metaRes = await fetch(`${API_BASE}/api/dwg/import/${importId}/floorplan`)
        if (!metaRes.ok) return
        const metaData = await metaRes.json()
        if (!metaData.floorplan) return

        const fp = metaData.floorplan
        const transform = fp.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 }

        // Load the image as a texture
        const textureLoader = new THREE.TextureLoader()
        const imageUrl = `${API_BASE}/api/dwg/import/${importId}/floorplan/image`
        
        textureLoader.load(imageUrl, (texture) => {
          const imgW = texture.image.width
          const imgH = texture.image.height

          // Calculate plane size in DXF units, then convert to scene meters
          const { bounds, unit_scale_to_m } = layoutData
          const effectiveScale = unit_scale_to_m * scaleCorrection
          const centerX = (bounds.minX + bounds.maxX) / 2 * effectiveScale
          const centerZ = (bounds.minY + bounds.maxY) / 2 * effectiveScale

          // Image dimensions in DXF units
          const dxfW = imgW * transform.scaleX
          const dxfH = imgH * transform.scaleY

          // Convert to meters (scene units)
          const planeW = dxfW * effectiveScale
          const planeD = dxfH * effectiveScale

          // Image position: transform.x, transform.y are DXF coords of the image origin (bottom-left)
          // Center of the image in DXF coords
          const imgCenterDxfX = transform.x + dxfW / 2
          const imgCenterDxfY = transform.y + dxfH / 2

          // Convert to scene coords (centered like fixtures)
          const sceneX = imgCenterDxfX * effectiveScale - centerX
          const sceneZ = imgCenterDxfY * effectiveScale - centerZ

          const geometry = new THREE.PlaneGeometry(planeW, planeD)
          const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: transform.opacity,
            side: THREE.DoubleSide,
            depthWrite: false
          })

          const mesh = new THREE.Mesh(geometry, material)
          mesh.name = 'FloorplanOverlay'
          mesh.position.set(sceneX, 0.01, sceneZ)
          // Rotate so image +Y maps to world +Z, matching the 2-D preview.
          mesh.rotation.x = Math.PI / 2
          if (transform.rotation) {
            mesh.rotation.z = -transform.rotation * Math.PI / 180
          }
          mesh.renderOrder = 1
          mesh.visible = showFloorplanLayer

          scene.add(mesh)
          floorplanMeshRef.current = mesh
          console.log('[3D] Floor plan overlay loaded:', planeW.toFixed(1), 'x', planeD.toFixed(1), 'm at', sceneX.toFixed(1), sceneZ.toFixed(1))
        })
      } catch (err) {
        console.error('[3D] Failed to load floor plan texture:', err)
      }
    }

    loadFloorplanTexture()
  }, [importId, layoutData, scaleCorrection, showFloorplanLayer])

  const resetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !layoutData) return
    
    const { fixtures, bounds, unit_scale_to_m } = layoutData
    const effectiveScale = unit_scale_to_m * scaleCorrection
    const centerX = (bounds.minX + bounds.maxX) / 2 * effectiveScale
    const centerZ = (bounds.minY + bounds.maxY) / 2 * effectiveScale
    
    // Calculate content bounds from fixtures
    let contentMinX = Infinity, contentMaxX = -Infinity
    let contentMinZ = Infinity, contentMaxZ = -Infinity
    fixtures.forEach(fixture => {
      const x = fixture.pose2d.x * effectiveScale - centerX
      const z = fixture.pose2d.y * effectiveScale - centerZ
      const halfW = (fixture.footprint.w * effectiveScale) / 2
      const halfD = (fixture.footprint.d * effectiveScale) / 2
      contentMinX = Math.min(contentMinX, x - halfW)
      contentMaxX = Math.max(contentMaxX, x + halfW)
      contentMinZ = Math.min(contentMinZ, z - halfD)
      contentMaxZ = Math.max(contentMaxZ, z + halfD)
    })
    
    const contentCenterX = isFinite(contentMinX) ? (contentMinX + contentMaxX) / 2 : 0
    const contentCenterZ = isFinite(contentMinZ) ? (contentMinZ + contentMaxZ) / 2 : 0
    const maxSize = isFinite(contentMinX) 
      ? Math.max(contentMaxX - contentMinX, contentMaxZ - contentMinZ)
      : Math.max((bounds.maxX - bounds.minX) * effectiveScale, (bounds.maxY - bounds.minY) * effectiveScale)
    
    cameraRef.current.position.set(contentCenterX + maxSize * 0.8, maxSize * 0.6, contentCenterZ + maxSize * 0.8)
    controlsRef.current.target.set(contentCenterX, 0, contentCenterZ)
    controlsRef.current.update()
  }, [layoutData, scaleCorrection])

  const setTopView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return
    // Preserve current target (pan) and distance (zoom)
    const target = controlsRef.current.target.clone()
    const distance = cameraRef.current.position.distanceTo(target)
    // Position camera directly above target, looking down
    cameraRef.current.position.set(target.x, target.y + distance, target.z + 0.001)
    controlsRef.current.update()
  }, [])

  const setFrontView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return
    // Preserve current target (pan) and distance (zoom)
    const target = controlsRef.current.target.clone()
    const distance = cameraRef.current.position.distanceTo(target)
    // Position camera in front of target (along +Z axis)
    cameraRef.current.position.set(target.x, target.y + distance * 0.2, target.z + distance)
    controlsRef.current.update()
  }, [])

  const setSideView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return
    // Preserve current target (pan) and distance (zoom)
    const target = controlsRef.current.target.clone()
    const distance = cameraRef.current.position.distanceTo(target)
    // Position camera to the side of target (along +X axis)
    cameraRef.current.position.set(target.x + distance, target.y + distance * 0.2, target.z)
    controlsRef.current.update()
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      
      switch (e.key.toLowerCase()) {
        case 'r': resetCamera(); break
        case 't': setTopView(); break
        case 'f': setFrontView(); break
        case 's': if (!e.ctrlKey && !e.metaKey) setSideView(); break
        case '1': resetCamera(); break
        case '7': setTopView(); break
        case '3': setSideView(); break
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [resetCamera, setTopView, setFrontView, setSideView])

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Toolbar */}
      <div className="h-10 border-b border-border-dark flex items-center px-3 gap-2 bg-panel-bg">
        <Box className="w-4 h-4 text-highlight" />
        <span className="text-sm font-medium text-white">3D Preview</span>
        <div className="flex-1" />
        {layoutData && (
          <span className="text-xs text-gray-400 mr-2">
            {layoutData.paired_count} / {layoutData.total_count} fixtures
          </span>
        )}
        <button
          onClick={() => setShowWireframe(!showWireframe)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            showWireframe ? 'bg-green-900/50 text-green-400' : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
          title="Toggle 2D Wireframe Overlay"
        >
          <Grid3X3 className="w-4 h-4 inline mr-1" />
          2D
        </button>
        <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-2">
          <button
            onClick={togglePanMode}
            className={`p-1.5 rounded transition-colors ${
              panMode 
                ? 'bg-blue-900/50 text-blue-400' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            title={panMode ? "Pan Mode ON (left-click to pan)" : "Click to enable Pan Mode"}
          >
            <Hand className="w-4 h-4" />
          </button>
          <button
            onClick={togglePanMode}
            className={`p-1.5 rounded transition-colors ${
              !panMode 
                ? 'bg-blue-900/50 text-blue-400' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            title={!panMode ? "Rotate Mode ON (left-click to rotate)" : "Click to enable Rotate Mode"}
          >
            <Move3D className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-2">
          <button
            onClick={setTopView}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Top View (T or 7)"
          >
            Top
          </button>
          <button
            onClick={setFrontView}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Front View (F)"
          >
            Front
          </button>
          <button
            onClick={setSideView}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Side View (S or 3)"
          >
            Side
          </button>
          <button
            onClick={resetCamera}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Reset View (R or 1)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1 border-l border-gray-700 pl-2 ml-2">
          <button
            onClick={saveCameraView}
            className={`px-2 py-1 text-xs rounded transition-colors flex items-center gap-1 ${
              justSaved 
                ? 'bg-green-600 text-white' 
                : hasSavedView 
                  ? 'bg-green-900/50 text-green-400 hover:bg-green-600 hover:text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
            title="Save current view as default - click again to update"
          >
            <Save className="w-3 h-3" />
            {justSaved ? 'Saved!' : hasSavedView ? 'Update View' : 'Save View'}
          </button>
          {hasSavedView && (
            <button
              onClick={loadSavedCameraView}
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
      <div ref={containerRef} className="flex-1 relative" tabIndex={0}>
        {/* Axis Gizmo - Top Left */}
        <div 
          ref={axisContainerRef} 
          className="absolute top-3 left-3 z-10 rounded-lg overflow-hidden border border-gray-600/50 shadow-lg"
          style={{ width: 100, height: 100 }}
        />
        
        {/* Floating Layers Panel - Top Right */}
        <div className="absolute top-3 right-3 z-10">
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
            <div className="absolute top-full right-0 mt-2 bg-gray-800/95 backdrop-blur border border-gray-700 rounded-lg shadow-xl p-3 min-w-[180px]">
              <div className="text-xs font-medium text-gray-300 mb-2">Layers</div>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showFixturesLayer}
                  onChange={(e) => setShowFixturesLayer(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-green-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showFixturesLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Fixtures
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
                  checked={showFloorplanLayer}
                  onChange={(e) => setShowFloorplanLayer(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-orange-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showFloorplanLayer ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Floor Plan
                </span>
              </label>
              <label className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showWireframe}
                  onChange={(e) => setShowWireframe(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-blue-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showWireframe ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Wireframes
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
                  {show3DModels ? <Box className="w-3.5 h-3.5 text-purple-400" /> : <Grid3X3 className="w-3.5 h-3.5 text-gray-500" />}
                  3D Models
                </span>
                <span className="text-[9px] text-gray-500 ml-auto">{show3DModels ? 'ON' : 'OFF'}</span>
              </label>
            </div>
          )}
        </div>
        
        {/* Hover Tooltip — anchored to fixture's projected 3D position */}
        {tooltip && (
          <div
            ref={tooltipDivRef}
            className="absolute z-20 pointer-events-none bg-gray-900/95 border border-gray-600 rounded-lg shadow-xl px-3 py-2 text-xs font-mono"
            style={{ left: tooltip.x + 12, top: tooltip.y - 10, maxWidth: 320 }}
          >
            {tooltip.data.kind === 'lidar' ? (
              <>
                <div className="font-bold text-white text-sm mb-1">LiDAR {tooltip.data.ip}</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-300">
                  <span className="text-gray-500">Status:</span>
                  <span className={tooltip.data.status === 'Online' ? 'text-green-400' : tooltip.data.status === 'Offline' ? 'text-red-400' : 'text-blue-300'}>{tooltip.data.status}</span>
                  <span className="text-gray-500">Type:</span>
                  <span>{tooltip.data.model}</span>
                  <span className="text-gray-500">Position:</span>
                  <span>({tooltip.data.posX}, {tooltip.data.posZ})</span>
                  <span className="text-gray-500">Placement:</span>
                  <span className="text-gray-400 truncate">{tooltip.data.placementId?.slice(0, 8)}</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-bold text-white text-sm">{tooltip.data.type}</span>
                  <span className="text-gray-400">({tooltip.data.kind}{tooltip.data.nPts > 0 ? `, ${tooltip.data.nPts}pts` : ''})</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-300">
                  <span className="text-gray-500">Size:</span>
                  <span>{tooltip.data.w}m × {tooltip.data.d}m × {tooltip.data.h}m</span>
                  <span className="text-gray-500">Volume:</span>
                  <span className={tooltip.data.vol > 100 ? 'text-red-400 font-bold' : ''}>{tooltip.data.vol} m³</span>
                  <span className="text-gray-500">Position:</span>
                  <span>({tooltip.data.posX}, {tooltip.data.posZ})</span>
                  <span className="text-gray-500">Rotation:</span>
                  <span>{tooltip.data.rotDeg}°</span>
                  <span className="text-gray-500">Group:</span>
                  <span className="text-blue-400">{tooltip.data.groupId}</span>
                  <span className="text-gray-500">Asset:</span>
                  <span>{tooltip.data.catalogAsset}</span>
                  <span className="text-gray-500">ID:</span>
                  <span className="text-gray-400 truncate">{tooltip.data.id}</span>
                </div>
                {tooltip.data.vol > 100 && (
                  <div className="mt-1 text-red-400 text-[10px]">⚠ Oversized — likely noise/annotation</div>
                )}
              </>
            )}
          </div>
        )}

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
            <div className="text-white">Loading 3D layout...</div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
            <div className="text-red-400 text-center px-4">{error}</div>
          </div>
        )}
      </div>

      {/* Info Bar */}
      <div className="h-8 border-t border-border-dark flex items-center px-3 text-xs text-gray-500 bg-panel-bg">
        <span>Drag: rotate • Scroll: zoom • Right-click: pan • Keys: R=reset, T=top, F=front, S=side</span>
      </div>
    </div>
  )
}
