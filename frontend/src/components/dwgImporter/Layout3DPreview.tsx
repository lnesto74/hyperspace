import { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RotateCcw, Box, Grid3X3, Save, Download, Hand, Move3D, Layers, Eye, EyeOff } from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

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

interface Layout3DPreviewProps {
  layoutVersionId: string
  onClose?: () => void
  lidarInstances?: LidarInstance[]
  lidarModels?: LidarModel[]
  scaleCorrection?: number
  simulationResult?: SimulationResult | null
}

interface CustomModel {
  object_type: string
  file_path: string
}

const TYPE_COLORS: Record<string, number> = {
  shelf: 0x6366f1,
  wall: 0x64748b,
  checkout: 0x22c55e,
  entrance: 0xf59e0b,
  pillar: 0x78716c,
  digital_display: 0x8b5cf6,
  default: 0x4b5563
}

export default function Layout3DPreview({ layoutVersionId, lidarInstances = [], lidarModels = [], scaleCorrection = 1.0, simulationResult = null }: Layout3DPreviewProps) {
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
  const [showLayersPanel, setShowLayersPanel] = useState(false)

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
      controlsRef.current.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      }
    }
  }, [panMode])

  // Check if saved camera view exists
  useEffect(() => {
    const savedView = localStorage.getItem(`dwg-camera-view-${layoutVersionId}`)
    setHasSavedView(!!savedView)
  }, [layoutVersionId])

  // Save current camera view
  const saveCameraView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return
    
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
    localStorage.setItem(`dwg-camera-view-${layoutVersionId}`, JSON.stringify(viewData))
    setHasSavedView(true)
    setJustSaved(true)
    console.log('Camera view saved')
    // Reset justSaved after 1.5 seconds
    setTimeout(() => setJustSaved(false), 1500)
  }, [layoutVersionId])

  // Load saved camera view
  const loadSavedCameraView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return false
    
    const saved = localStorage.getItem(`dwg-camera-view-${layoutVersionId}`)
    if (!saved) return false
    
    try {
      const viewData = JSON.parse(saved)
      cameraRef.current.position.set(viewData.position.x, viewData.position.y, viewData.position.z)
      controlsRef.current.target.set(viewData.target.x, viewData.target.y, viewData.target.z)
      controlsRef.current.update()
      console.log('Camera view restored from saved')
      return true
    } catch (e) {
      console.error('Failed to load saved camera view:', e)
      return false
    }
  }, [layoutVersionId])

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
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    renderer.autoClear = false // Required for multi-viewport rendering
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
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

    // Handle resize
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
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
        setLayoutData(data.layout)
        
        if (!data.layout?.fixtures?.length) {
          setError('No mapped fixtures in this layout. Map fixtures to catalog assets and regenerate.')
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
  }, [layoutVersionId])

  // Render fixtures in 3D
  useEffect(() => {
    if (!layoutData || !fixturesGroupRef.current || !sceneRef.current) return
    console.log('Rendering fixtures with', customModels.length, 'custom models available')

    const group = fixturesGroupRef.current
    
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

    const { fixtures, unit_scale_to_m, bounds } = layoutData
    const scene = sceneRef.current
    
    // Center offset - use scaleCorrection to match LiDAR coordinate system
    const effectiveScale = unit_scale_to_m * scaleCorrection
    const centerX = (bounds.minX + bounds.maxX) / 2 * effectiveScale
    const centerZ = (bounds.minY + bounds.maxY) / 2 * effectiveScale
    
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
        
        // Calculate bounding box in local coordinates to get proper w/d
        const minX = Math.min(...footprint.points.map(p => p.x))
        const maxX = Math.max(...footprint.points.map(p => p.x))
        const minY = Math.min(...footprint.points.map(p => p.y))
        const maxY = Math.max(...footprint.points.map(p => p.y))
        w = (maxX - minX) * effectiveScale
        d = (maxY - minY) * effectiveScale
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
      
      // Color based on type
      const type = mapping?.type || 'default'
      const catalogAssetId = mapping?.catalog_asset_id || type
      const color = TYPE_COLORS[type] || TYPE_COLORS.default
      
      // Try to load GLTF model, fallback to box
      const addFixtureMesh = async () => {
        // Try loading by catalog_asset_id first, then by type
        let model = await loadModel(catalogAssetId)
        if (!model && catalogAssetId !== type) {
          model = await loadModel(type)
        }
        
        if (idx < 3) {
          console.log(`Fixture ${fixture.id}: catalogAssetId=${catalogAssetId}, type=${type}, modelLoaded=${!!model}`)
        }
        
        if (model) {
          // Scale model to fit the footprint
          const originalSize = model.userData.originalSize as THREE.Vector3
          if (originalSize) {
            const scaleX = w / originalSize.x
            const scaleZ = d / originalSize.z
            const scaleY = Math.min(scaleX, scaleZ) // Preserve aspect ratio for height
            model.scale.set(scaleX, scaleY, scaleZ)
          }
          
          model.position.set(x, 0, z)
          model.rotation.y = rotationRad
          model.userData.fixtureId = fixture.id
          group.add(model)
        } else {
          // Fallback: Create box mesh
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

    // Update camera to fit scene - try loading saved view first
    if (cameraRef.current && controlsRef.current) {
      // Try to load saved camera view
      if (!loadSavedCameraView()) {
        // No saved view, use default based on bounds (use effectiveScale)
        const boundsWidth = (bounds.maxX - bounds.minX) * effectiveScale
        const boundsDepth = (bounds.maxY - bounds.minY) * effectiveScale
        const maxSize = Math.max(boundsWidth, boundsDepth)
        
        cameraRef.current.position.set(maxSize * 0.8, maxSize * 0.6, maxSize * 0.8)
        controlsRef.current.target.set(0, 0, 0)
        controlsRef.current.update()
      }
    }

  }, [layoutData, showWireframe, loadModel, customModels, loadSavedCameraView, scaleCorrection])

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
    
    if (!lidarGroupRef.current || !layoutData) return
    
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
      console.log('No LiDAR instances to render')
      // Add a test marker at origin to verify rendering works
      const testGeometry = new THREE.SphereGeometry(1, 16, 16)
      const testMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 })
      const testSphere = new THREE.Mesh(testGeometry, testMaterial)
      testSphere.position.set(0, 3, 0)
      group.add(testSphere)
      console.log('Added test sphere at origin')
      return
    }
    
    const { bounds, unit_scale_to_m } = layoutData
    // Apply scaleCorrection to match LiDAR coordinate system
    const effectiveScale = unit_scale_to_m * scaleCorrection
    const centerX = (bounds.minX + bounds.maxX) / 2 * effectiveScale
    const centerZ = (bounds.minY + bounds.maxY) / 2 * effectiveScale
    
    console.log('Layout bounds:', bounds)
    console.log('unit_scale_to_m:', unit_scale_to_m, 'scaleCorrection:', scaleCorrection, 'effectiveScale:', effectiveScale)
    console.log('Center offset:', centerX, centerZ)
    
    // Create reusable geometries for performance
    const deviceGeometry = new THREE.SphereGeometry(0.3, 16, 16)
    const domeGeometry = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)
    
    lidarInstances.forEach((inst, idx) => {
      const model = lidarModels.find(m => m.id === inst.model_id)
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
        color: inst.source === 'auto' ? 0x22c55e : 0x3b82f6,
        roughness: 0.3,
        metalness: 0.7
      })
      const device = new THREE.Mesh(deviceGeometry.clone(), deviceMaterial)
      device.position.set(x, mountHeight, z)
      device.castShadow = true
      group.add(device)
      
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
          color: inst.source === 'auto' ? 0x22c55e : 0x3b82f6,
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
          color: inst.source === 'auto' ? 0x22c55e : 0x3b82f6,
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
          color: inst.source === 'auto' ? 0x22c55e : 0x3b82f6,
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
          color: inst.source === 'auto' ? 0x22c55e : 0x3b82f6,
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
    
  }, [lidarInstances, lidarModels, layoutData, scaleCorrection, simulationResult])

  // Toggle LiDAR layer visibility
  useEffect(() => {
    if (lidarGroupRef.current) {
      lidarGroupRef.current.visible = showLidarLayer
    }
  }, [showLidarLayer])

  const resetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !layoutData) return
    
    const { bounds, unit_scale_to_m } = layoutData
    const effectiveScale = unit_scale_to_m * scaleCorrection
    const boundsWidth = (bounds.maxX - bounds.minX) * effectiveScale
    const boundsDepth = (bounds.maxY - bounds.minY) * effectiveScale
    const maxSize = Math.max(boundsWidth, boundsDepth)
    
    cameraRef.current.position.set(maxSize * 0.8, maxSize * 0.6, maxSize * 0.8)
    controlsRef.current.target.set(0, 0, 0)
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
                  checked={showWireframe}
                  onChange={(e) => setShowWireframe(e.target.checked)}
                  className="rounded border-gray-600 bg-gray-700 text-blue-500"
                />
                <span className="text-sm text-gray-300 flex items-center gap-1.5">
                  {showWireframe ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-gray-500" />}
                  Wireframes
                </span>
              </label>
            </div>
          )}
        </div>
        
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
