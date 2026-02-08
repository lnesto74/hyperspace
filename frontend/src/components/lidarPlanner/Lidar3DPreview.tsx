import { useEffect, useRef, useState, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Box, RotateCcw, Eye, EyeOff } from 'lucide-react'

interface LidarInstance {
  id: string
  x_m: number
  z_m: number
  mount_y_m: number
  yaw_deg: number
  hfov_deg: number
  vfov_deg: number
  range_m: number
  dome_mode: boolean
  source: 'manual' | 'auto'
}

interface Lidar3DPreviewProps {
  layoutData: any
  instances: LidarInstance[]
  selectedInstanceId: string | null
  onSelectInstance?: (id: string | null) => void
}

export default function Lidar3DPreview({ 
  layoutData, 
  instances, 
  selectedInstanceId,
  onSelectInstance 
}: Lidar3DPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const lidarGroupRef = useRef<THREE.Group | null>(null)
  const fixturesGroupRef = useRef<THREE.Group | null>(null)
  
  const [showFOV, setShowFOV] = useState(true)
  const [showFixtures, setShowFixtures] = useState(true)
  
  // Initialize Three.js scene
  useEffect(() => {
    if (!containerRef.current) return
    
    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight
    
    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene
    
    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(15, 20, 15)
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
    
    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(ambientLight)
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 20, 10)
    directionalLight.castShadow = true
    scene.add(directionalLight)
    
    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(100, 100)
    const groundMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x222222,
      roughness: 0.8 
    })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    
    // Grid helper
    const gridHelper = new THREE.GridHelper(50, 50, 0x444444, 0x333333)
    scene.add(gridHelper)
    
    // Groups for organization
    const lidarGroup = new THREE.Group()
    lidarGroup.name = 'lidars'
    scene.add(lidarGroup)
    lidarGroupRef.current = lidarGroup
    
    const fixturesGroup = new THREE.Group()
    fixturesGroup.name = 'fixtures'
    scene.add(fixturesGroup)
    fixturesGroupRef.current = fixturesGroup
    
    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
    
    // Resize handler
    const handleResize = () => {
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(container)
    
    return () => {
      resizeObserver.disconnect()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [])
  
  // Update fixtures when layout data changes
  useEffect(() => {
    if (!fixturesGroupRef.current || !layoutData) return
    
    const group = fixturesGroupRef.current
    
    // Clear existing fixtures
    while (group.children.length > 0) {
      const child = group.children[0]
      group.remove(child)
      if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
      if ((child as THREE.Mesh).material) {
        const mat = (child as THREE.Mesh).material
        if (Array.isArray(mat)) mat.forEach(m => m.dispose())
        else mat.dispose()
      }
    }
    
    group.visible = showFixtures
    
    // Add fixtures from layout
    const fixtures = layoutData.fixtures || []
    const bounds = layoutData.bounds || { minX: 0, maxX: 20, minZ: 0, maxZ: 15 }
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerZ = (bounds.minZ + bounds.maxZ) / 2
    
    for (const fixture of fixtures) {
      if (!fixture.pose2d) continue
      
      const w = fixture.mapping?.dimensions?.width || 1
      const h = fixture.mapping?.dimensions?.height || 2
      const d = fixture.mapping?.dimensions?.depth || 1
      
      const geometry = new THREE.BoxGeometry(w, h, d)
      const material = new THREE.MeshStandardMaterial({ 
        color: 0x555555,
        transparent: true,
        opacity: 0.7
      })
      
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(
        fixture.pose2d.x - centerX,
        h / 2,
        fixture.pose2d.y - centerZ
      )
      mesh.rotation.y = -(fixture.pose2d.angle || 0)
      mesh.castShadow = true
      mesh.receiveShadow = true
      
      group.add(mesh)
    }
    
    // Update camera target
    if (cameraRef.current && controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0)
      controlsRef.current.update()
    }
  }, [layoutData, showFixtures])
  
  // Update LiDAR instances
  useEffect(() => {
    if (!lidarGroupRef.current || !layoutData) return
    
    const group = lidarGroupRef.current
    
    // Clear existing LiDARs
    while (group.children.length > 0) {
      const child = group.children[0]
      group.remove(child)
      child.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose()
        if ((obj as THREE.Mesh).material) {
          const mat = (obj as THREE.Mesh).material
          if (Array.isArray(mat)) mat.forEach(m => m.dispose())
          else mat.dispose()
        }
      })
    }
    
    const bounds = layoutData.bounds || { minX: 0, maxX: 20, minZ: 0, maxZ: 15 }
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerZ = (bounds.minZ + bounds.maxZ) / 2
    
    for (const inst of instances) {
      const lidarObj = new THREE.Group()
      lidarObj.name = inst.id
      lidarObj.userData = { instanceId: inst.id }
      
      const isSelected = inst.id === selectedInstanceId
      const isAuto = inst.source === 'auto'
      const color = isAuto ? 0x22c55e : 0x3b82f6
      const selectedColor = isAuto ? 0x4ade80 : 0x60a5fa
      
      // LiDAR body (small cylinder)
      const bodyGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.2, 16)
      const bodyMaterial = new THREE.MeshStandardMaterial({ 
        color: isSelected ? selectedColor : color,
        metalness: 0.5,
        roughness: 0.3
      })
      const body = new THREE.Mesh(bodyGeometry, bodyMaterial)
      body.position.y = 0.1
      lidarObj.add(body)
      
      // FOV dome visualization
      if (showFOV) {
        const fovMesh = createFOVMesh(inst, isSelected, isAuto)
        lidarObj.add(fovMesh)
      }
      
      // Position
      lidarObj.position.set(
        inst.x_m - centerX,
        inst.mount_y_m,
        inst.z_m - centerZ
      )
      
      group.add(lidarObj)
    }
  }, [instances, selectedInstanceId, showFOV, layoutData])
  
  const createFOVMesh = (inst: LidarInstance, isSelected: boolean, isAuto: boolean) => {
    const group = new THREE.Group()
    
    const range = inst.range_m
    const hfov = inst.hfov_deg * Math.PI / 180
    const vfov = inst.vfov_deg * Math.PI / 180
    const yaw = inst.yaw_deg * Math.PI / 180
    
    const color = isAuto ? 0x22c55e : 0x3b82f6
    const opacity = isSelected ? 0.3 : 0.15
    
    if (inst.dome_mode || inst.hfov_deg >= 360) {
      // Full dome (hemisphere based on VFOV)
      const phiLength = vfov // Vertical extent
      const geometry = new THREE.SphereGeometry(
        range,
        32,
        16,
        0,
        Math.PI * 2,
        0,
        phiLength
      )
      
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      
      const dome = new THREE.Mesh(geometry, material)
      dome.rotation.x = Math.PI // Point downward
      group.add(dome)
      
      // Add wireframe outline
      const wireframeMaterial = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: opacity * 2
      })
      const wireframe = new THREE.Mesh(geometry, wireframeMaterial)
      wireframe.rotation.x = Math.PI
      group.add(wireframe)
    } else {
      // Wedge shape for limited HFOV
      const segments = 32
      const shape = new THREE.Shape()
      
      // Create 2D wedge shape
      shape.moveTo(0, 0)
      for (let i = 0; i <= segments; i++) {
        const angle = -hfov / 2 + (hfov * i / segments)
        shape.lineTo(Math.sin(angle) * range, Math.cos(angle) * range)
      }
      shape.lineTo(0, 0)
      
      // Extrude for 3D
      const extrudeSettings = {
        steps: 1,
        depth: 0.1,
        bevelEnabled: false
      }
      
      const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings)
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      
      const wedge = new THREE.Mesh(geometry, material)
      wedge.rotation.x = -Math.PI / 2
      wedge.rotation.z = yaw
      group.add(wedge)
    }
    
    return group
  }
  
  const resetCamera = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current) return
    
    cameraRef.current.position.set(15, 20, 15)
    controlsRef.current.target.set(0, 0, 0)
    controlsRef.current.update()
  }, [])
  
  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Toolbar */}
      <div className="h-10 border-b border-gray-700 flex items-center px-3 gap-2 bg-gray-800">
        <button
          onClick={() => setShowFOV(!showFOV)}
          className={`p-1.5 rounded flex items-center gap-1 text-xs ${showFOV ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
          title="Toggle FOV visualization"
        >
          {showFOV ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          FOV
        </button>
        <button
          onClick={() => setShowFixtures(!showFixtures)}
          className={`p-1.5 rounded flex items-center gap-1 text-xs ${showFixtures ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
          title="Toggle fixtures"
        >
          <Box className="w-4 h-4" />
          Fixtures
        </button>
        <div className="flex-1" />
        <button
          onClick={resetCamera}
          className="p-1.5 hover:bg-gray-700 rounded"
          title="Reset camera"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
      
      {/* 3D Canvas */}
      <div ref={containerRef} className="flex-1" />
      
      {/* Legend */}
      <div className="h-8 border-t border-gray-700 flex items-center px-3 gap-4 text-xs text-gray-400 bg-gray-800">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-blue-500" />
          Manual
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-green-500" />
          Auto
        </span>
        <span className="flex-1" />
        <span>Drag: rotate • Scroll: zoom • Right-click: pan</span>
      </div>
    </div>
  )
}
