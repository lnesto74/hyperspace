import { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { RotateCcw, Box, Grid3X3, Save, Download, Hand, Move3D } from 'lucide-react'

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

interface Layout3DPreviewProps {
  layoutVersionId: string
  onClose?: () => void
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

export default function Layout3DPreview({ layoutVersionId }: Layout3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const animationIdRef = useRef<number>(0)
  const fixturesGroupRef = useRef<THREE.Group | null>(null)
  const gltfLoaderRef = useRef<GLTFLoader>(new GLTFLoader())
  const loadedModelsRef = useRef<Map<string, THREE.Group>>(new Map())
  
  const [isLoading, setIsLoading] = useState(true)
  const [layoutData, setLayoutData] = useState<LayoutData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showWireframe, setShowWireframe] = useState(true)
  const [customModels, setCustomModels] = useState<CustomModel[]>([])
  const [hasSavedView, setHasSavedView] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [panMode, setPanMode] = useState(false)

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

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(20, 20, 20)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
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

    // Main directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0)
    directionalLight.position.set(20, 40, 20)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 500
    scene.add(directionalLight)

    // Secondary fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5)
    fillLight.position.set(-20, 30, -20)
    scene.add(fillLight)

    // Grid
    const gridHelper = new THREE.GridHelper(50, 50, 0x444466, 0x333344)
    scene.add(gridHelper)

    // Floor
    const floorGeometry = new THREE.PlaneGeometry(100, 100)
    const floorMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x1a1a24, 
      roughness: 0.9 
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    // Fixtures group
    const fixturesGroup = new THREE.Group()
    fixturesGroup.name = 'DWGFixtures'
    scene.add(fixturesGroup)
    fixturesGroupRef.current = fixturesGroup

    // Animation loop
    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
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

    const { fixtures, unit_scale_to_m, bounds } = layoutData
    
    // Center offset
    const centerX = (bounds.minX + bounds.maxX) / 2 * unit_scale_to_m
    const centerZ = (bounds.minY + bounds.maxY) / 2 * unit_scale_to_m

    console.log(`Rendering ${fixtures.length} fixtures, center: (${centerX.toFixed(2)}, ${centerZ.toFixed(2)})`)

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
        x = centroidX * unit_scale_to_m - centerX
        z = centroidY * unit_scale_to_m - centerZ
        
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
        w = (maxX - minX) * unit_scale_to_m
        d = (maxY - minY) * unit_scale_to_m
      } else {
        // Fallback to pose2d and footprint dimensions
        x = pose2d.x * unit_scale_to_m - centerX
        z = pose2d.y * unit_scale_to_m - centerZ
        rotationRad = -pose2d.rot_deg * Math.PI / 180
        w = footprint.w * unit_scale_to_m
        d = footprint.d * unit_scale_to_m
      }
      
      // If size is 0, use a default visible size based on bounds
      if (w < 0.1 || d < 0.1) {
        const defaultSize = Math.max(1, (bounds.maxX - bounds.minX) * unit_scale_to_m * 0.01)
        w = w < 0.1 ? defaultSize : w
        d = d < 0.1 ? defaultSize : d
      }
      
      const h = Math.max(0.5, Math.min(w, d) * 0.5) // Height based on size
      
      if (idx < 3) {
        console.log(`Fixture ${fixture.id}: pos(${x.toFixed(2)}, ${z.toFixed(2)}) size(${w.toFixed(2)}x${d.toFixed(2)}) rot(${(rotationRad * 180 / Math.PI).toFixed(1)}°)`)
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
      if (showWireframe) {
        let outlinePoints: THREE.Vector3[]
        
        // Check if we have polygon points from the DWG
        if (footprint.points && footprint.points.length >= 3) {
          // Use actual DWG polygon geometry - render in world coordinates
          outlinePoints = footprint.points.map((pt: {x: number, y: number}) => 
            new THREE.Vector3(
              pt.x * unit_scale_to_m - centerX,
              0.02,
              pt.y * unit_scale_to_m - centerZ
            )
          )
          // Close the polygon
          outlinePoints.push(outlinePoints[0].clone())
          
          const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints)
          const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 2 }) // Cyan for actual DWG
          const outline = new THREE.Line(outlineGeometry, outlineMaterial)
          // No position offset or rotation needed - points are in world coords
          group.add(outline)
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
          group.add(outline)
        }

        // Add center marker and direction indicator for 3D box position
        const markerGeometry = new THREE.RingGeometry(0.1, 0.15, 8)
        const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide })
        const marker = new THREE.Mesh(markerGeometry, markerMaterial)
        marker.position.set(x, 0.03, z)
        marker.rotation.x = -Math.PI / 2
        group.add(marker)

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
        group.add(arrow)
      }
    })

    // Update camera to fit scene - try loading saved view first
    if (cameraRef.current && controlsRef.current) {
      // Try to load saved camera view
      if (!loadSavedCameraView()) {
        // No saved view, use default based on bounds
        const boundsWidth = (bounds.maxX - bounds.minX) * unit_scale_to_m
        const boundsDepth = (bounds.maxY - bounds.minY) * unit_scale_to_m
        const maxSize = Math.max(boundsWidth, boundsDepth)
        
        cameraRef.current.position.set(maxSize * 0.8, maxSize * 0.6, maxSize * 0.8)
        controlsRef.current.target.set(0, 0, 0)
        controlsRef.current.update()
      }
    }

  }, [layoutData, showWireframe, loadModel, customModels, loadSavedCameraView])

  const resetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !layoutData) return
    
    const { bounds, unit_scale_to_m } = layoutData
    const boundsWidth = (bounds.maxX - bounds.minX) * unit_scale_to_m
    const boundsDepth = (bounds.maxY - bounds.minY) * unit_scale_to_m
    const maxSize = Math.max(boundsWidth, boundsDepth)
    
    cameraRef.current.position.set(maxSize * 0.8, maxSize * 0.6, maxSize * 0.8)
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.update()
  }, [layoutData])

  const setTopView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !layoutData) return
    const { bounds, unit_scale_to_m } = layoutData
    const maxSize = Math.max(
      (bounds.maxX - bounds.minX) * unit_scale_to_m,
      (bounds.maxY - bounds.minY) * unit_scale_to_m
    )
    cameraRef.current.position.set(0, maxSize * 1.2, 0.001)
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.update()
  }, [layoutData])

  const setFrontView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !layoutData) return
    const { bounds, unit_scale_to_m } = layoutData
    const maxSize = Math.max(
      (bounds.maxX - bounds.minX) * unit_scale_to_m,
      (bounds.maxY - bounds.minY) * unit_scale_to_m
    )
    cameraRef.current.position.set(0, maxSize * 0.3, maxSize * 1.2)
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.update()
  }, [layoutData])

  const setSideView = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !layoutData) return
    const { bounds, unit_scale_to_m } = layoutData
    const maxSize = Math.max(
      (bounds.maxX - bounds.minX) * unit_scale_to_m,
      (bounds.maxY - bounds.minY) * unit_scale_to_m
    )
    cameraRef.current.position.set(maxSize * 1.2, maxSize * 0.3, 0)
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.update()
  }, [layoutData])

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
