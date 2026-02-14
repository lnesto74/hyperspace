import { useRef, useEffect, useCallback, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useVenue } from '../../context/VenueContext'
import { usePlanogram, ShelfPlanogram, SkuItem, SlotFacing } from '../../context/PlanogramContext'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

// Tooltip component for 3D viewport
function Slot3DTooltip({ sku, position }: { sku: SkuItem; position: { x: number; y: number } }) {
  return (
    <div 
      className="absolute z-50 bg-gray-900/95 border border-gray-600 rounded-lg shadow-xl p-3 pointer-events-none"
      style={{ left: position.x + 15, top: position.y - 10, maxWidth: 280 }}
    >
      <div className="text-amber-400 font-mono text-xs mb-1">{sku.skuCode}</div>
      <div className="text-white font-medium text-sm mb-2">{sku.name}</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {sku.brand && (
          <>
            <span className="text-gray-500">Brand:</span>
            <span className="text-gray-300">{sku.brand}</span>
          </>
        )}
        {sku.category && (
          <>
            <span className="text-gray-500">Category:</span>
            <span className="text-gray-300">{sku.category}</span>
          </>
        )}
        {sku.subcategory && (
          <>
            <span className="text-gray-500">Subcategory:</span>
            <span className="text-gray-300">{sku.subcategory}</span>
          </>
        )}
        {sku.size && (
          <>
            <span className="text-gray-500">Size:</span>
            <span className="text-gray-300">{sku.size}</span>
          </>
        )}
        {sku.price && (
          <>
            <span className="text-gray-500">Price:</span>
            <span className="text-green-400">${sku.price.toFixed(2)}</span>
          </>
        )}
        {sku.margin && (
          <>
            <span className="text-gray-500">Margin:</span>
            <span className="text-blue-400">{sku.margin.toFixed(1)}%</span>
          </>
        )}
      </div>
    </div>
  )
}

const COLORS = {
  floor: 0x1a1a24,
  grid: 0x333344,
  shelfDefault: 0x4b5563,
  shelfActive: 0xf59e0b,
  shelfHover: 0x3b82f6,
  shelfHasItems: 0x22c55e, // Green for shelves with items
  slotGrid: 0xf59e0b,
  slotFilled: 0x22c55e, // Green for filled slots
  faceHighlight: 0x3b82f6, // Blue for clickable faces
  faceSelected: 0x22c55e, // Green for selected face
}

// Helper to determine which faces to use for slots
function getSlotFacings(width: number, depth: number, storedFacings: SlotFacing[]): SlotFacing[] {
  // If user has explicitly set facings, use them
  if (storedFacings && storedFacings.length > 0) return storedFacings
  
  // Auto-detect: use the longer side
  // front/back faces are along the X axis (width)
  // left/right faces are along the Z axis (depth)
  return width >= depth ? ['front'] : ['left']
}

// Get face parameters for slot positioning
function getFaceParams(facing: SlotFacing, width: number, _height: number, depth: number) {
  switch (facing) {
    case 'front':
      return {
        slotSpan: width, // slots distributed along width
        slotOffset: { x: -width / 2, y: 0, z: depth / 2 + 0.02 },
        slotDirection: 'x' as const,
        gridEndX: width / 2,
        gridEndZ: depth / 2 + 0.02,
      }
    case 'back':
      return {
        slotSpan: width,
        slotOffset: { x: -width / 2, y: 0, z: -depth / 2 - 0.02 },
        slotDirection: 'x' as const,
        gridEndX: width / 2,
        gridEndZ: -depth / 2 - 0.02,
      }
    case 'left':
      return {
        slotSpan: depth, // slots distributed along depth
        slotOffset: { x: -width / 2 - 0.02, y: 0, z: -depth / 2 },
        slotDirection: 'z' as const,
        gridEndX: -width / 2 - 0.02,
        gridEndZ: depth / 2,
      }
    case 'right':
      return {
        slotSpan: depth,
        slotOffset: { x: width / 2 + 0.02, y: 0, z: -depth / 2 },
        slotDirection: 'z' as const,
        gridEndX: width / 2 + 0.02,
        gridEndZ: depth / 2,
      }
    default:
      // Default to front
      return {
        slotSpan: width,
        slotOffset: { x: -width / 2, y: 0, z: depth / 2 + 0.02 },
        slotDirection: 'x' as const,
        gridEndX: width / 2,
        gridEndZ: depth / 2 + 0.02,
      }
  }
}

export default function PlanogramViewport() {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const shelfMeshesRef = useRef<Map<string, THREE.Group>>(new Map())
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster())
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2())
  
  const { venue, objects } = useVenue()
  const { 
    activeShelfId, 
    setActiveShelfId,
    activeShelfPlanogram,
    activePlanogram,
    activeCatalog,
    placeSkusOnShelf,
    saveShelfPlanogram,
    hoveredSkuId,
  } = usePlanogram()
  
  // State for face selection mode
  const [faceSelectMode, setFaceSelectMode] = useState(false)
  const [hoveredFace, setHoveredFace] = useState<SlotFacing | null>(null)
  const faceMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  
  // Track all shelf planograms to show filled slots
  const [allShelfPlanograms, setAllShelfPlanograms] = useState<Map<string, ShelfPlanogram>>(new Map())
  
  // Tooltip state for 3D hover
  const [tooltipSku, setTooltipSku] = useState<SkuItem | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{x: number, y: number}>({ x: 0, y: 0 })
  const slotMeshesRef = useRef<Map<string, { mesh: THREE.Mesh, skuItemId: string }>>(new Map())
  
  // Get shelf objects
  const shelves = objects.filter(o => 
    o.type.toLowerCase().includes('shelf') || 
    o.type.toLowerCase().includes('rack') ||
    o.type.toLowerCase().includes('gondola')
  )
  
  // Load all shelf planograms when planogram changes
  useEffect(() => {
    if (!activePlanogram?.id) {
      setAllShelfPlanograms(new Map())
      return
    }
    
    const loadAllShelfPlanograms = async () => {
      const planograms = new Map<string, ShelfPlanogram>()
      
      for (const shelf of shelves) {
        try {
          const res = await fetch(`${API_BASE}/api/planogram/planograms/${activePlanogram.id}/shelves/${shelf.id}`)
          const data = await res.json()
          if (data && data.slots?.levels?.length > 0) {
            planograms.set(shelf.id, data)
          }
        } catch (err) {
          // Shelf has no planogram data yet
        }
      }
      
      setAllShelfPlanograms(planograms)
    }
    
    loadAllShelfPlanograms()
  }, [activePlanogram?.id, shelves.length])
  
  // Update shelf planogram in cache when active one changes
  useEffect(() => {
    if (activeShelfId && activeShelfPlanogram) {
      setAllShelfPlanograms(prev => {
        const next = new Map(prev)
        next.set(activeShelfId, activeShelfPlanogram)
        return next
      })
    }
  }, [activeShelfId, activeShelfPlanogram])
  
  // Check if shelf has any filled slots
  const shelfHasFilledSlots = useCallback((shelfId: string) => {
    const planogram = allShelfPlanograms.get(shelfId)
    if (!planogram?.slots?.levels) return false
    
    return planogram.slots.levels.some(level => 
      level.slots?.some(slot => slot.skuItemId)
    )
  }, [allShelfPlanograms])
  
  // Create shelf mesh with slot grid
  const createShelfMesh = useCallback((shelf: any, isActive: boolean) => {
    const group = new THREE.Group()
    group.userData.shelfId = shelf.id
    
    const width = shelf.scale?.x || 2.0
    const height = shelf.scale?.y || 1.5
    const depth = shelf.scale?.z || 0.5
    
    // Check if this shelf has items
    const hasItems = shelfHasFilledSlots(shelf.id)
    const shelfPlanogram = allShelfPlanograms.get(shelf.id)
    
    // Determine shelf color
    let shelfColor = COLORS.shelfDefault
    if (isActive) {
      shelfColor = COLORS.shelfActive
    } else if (hasItems) {
      shelfColor = COLORS.shelfHasItems
    }
    
    // Shelf box
    const geometry = new THREE.BoxGeometry(width, height, depth)
    const material = new THREE.MeshStandardMaterial({
      color: shelfColor,
      transparent: true,
      opacity: isActive ? 0.4 : (hasItems ? 0.5 : 0.6),
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = height / 2
    mesh.userData.isShelf = true
    mesh.userData.shelfId = shelf.id
    group.add(mesh)
    
    // Get planogram data (use active if selected, otherwise from cache)
    const planogramData = isActive ? activeShelfPlanogram : shelfPlanogram
    
    // Determine slot facing directions (auto-detect longest side or use stored preference)
    const storedFacings = planogramData?.slotFacings || []
    const facings = getSlotFacings(width, depth, storedFacings)
    
    // Show filled slots for ALL shelves with planogram data - render for each facing
    if (planogramData) {
      const numLevels = planogramData.numLevels || 4
      const slotWidthM = planogramData.slotWidthM || 0.1
      const levelHeight = height / numLevels
      
      // Render slots for each selected facing
      facings.forEach(facing => {
        const faceParams = getFaceParams(facing, width, height, depth)
        const slotsPerLevel = Math.floor(faceParams.slotSpan / slotWidthM)
        
        // Draw slot grid only when active
        if (isActive) {
          const points: THREE.Vector3[] = []
          
          if (faceParams.slotDirection === 'x') {
            // Front/back face - slots along X axis
            const zPos = faceParams.slotOffset.z
            // Vertical lines (slot dividers)
            for (let i = 0; i <= slotsPerLevel; i++) {
              const x = faceParams.slotOffset.x + i * slotWidthM
              points.push(new THREE.Vector3(x, 0, zPos))
              points.push(new THREE.Vector3(x, height, zPos))
            }
            // Horizontal lines (level dividers)
            for (let i = 0; i <= numLevels; i++) {
              const y = i * levelHeight
              points.push(new THREE.Vector3(faceParams.slotOffset.x, y, zPos))
              points.push(new THREE.Vector3(faceParams.gridEndX, y, zPos))
            }
          } else {
            // Left/right face - slots along Z axis
            const xPos = faceParams.slotOffset.x
            // Vertical lines (slot dividers)
            for (let i = 0; i <= slotsPerLevel; i++) {
              const z = faceParams.slotOffset.z + i * slotWidthM
              points.push(new THREE.Vector3(xPos, 0, z))
              points.push(new THREE.Vector3(xPos, height, z))
            }
            // Horizontal lines (level dividers)
            for (let i = 0; i <= numLevels; i++) {
              const y = i * levelHeight
              points.push(new THREE.Vector3(xPos, y, faceParams.slotOffset.z))
              points.push(new THREE.Vector3(xPos, y, faceParams.gridEndZ))
            }
          }
          
          const gridGeometry = new THREE.BufferGeometry().setFromPoints(points)
          const gridMaterial = new THREE.LineBasicMaterial({ color: COLORS.slotGrid, transparent: true, opacity: 0.8 })
          const gridLines = new THREE.LineSegments(gridGeometry, gridMaterial)
          group.add(gridLines)
        }
        
        // Draw filled slot indicators (for all shelves)
        if (planogramData.slots?.levels) {
          planogramData.slots.levels.forEach((level, levelIdx) => {
            const y = levelIdx * levelHeight + levelHeight / 2
            
            level.slots?.forEach(slot => {
              if (slot.skuItemId) {
                const slotWidth = slotWidthM * (slot.facingSpan || 1) * 0.9
                const slotHeight = levelHeight * 0.8
                
                let slotX: number, slotZ: number
                if (faceParams.slotDirection === 'x') {
                  slotX = faceParams.slotOffset.x + slot.slotIndex * slotWidthM + (slotWidthM * (slot.facingSpan || 1)) / 2
                  slotZ = faceParams.slotOffset.z + 0.01
                } else {
                  slotX = faceParams.slotOffset.x + (facing === 'left' ? -0.01 : 0.01)
                  slotZ = faceParams.slotOffset.z + slot.slotIndex * slotWidthM + (slotWidthM * (slot.facingSpan || 1)) / 2
                }
                
                // Filled slot box - rotate for left/right faces
                const slotGeometry = faceParams.slotDirection === 'x' 
                  ? new THREE.BoxGeometry(slotWidth, slotHeight, 0.05)
                  : new THREE.BoxGeometry(0.05, slotHeight, slotWidth)
                // Check if this slot's SKU is being hovered in the library
                const isHoveredSku = slot.skuItemId === hoveredSkuId
                const slotMaterial = new THREE.MeshStandardMaterial({
                  color: isHoveredSku ? 0xff6600 : (isActive ? COLORS.slotFilled : COLORS.shelfHasItems),
                  transparent: true,
                  opacity: isHoveredSku ? 0.95 : (isActive ? 0.7 : 0.6),
                  emissive: isHoveredSku ? 0xff6600 : 0x000000,
                  emissiveIntensity: isHoveredSku ? 0.5 : 0,
                })
                const slotMesh = new THREE.Mesh(slotGeometry, slotMaterial)
                slotMesh.position.set(slotX, y, slotZ)
                slotMesh.userData.isSlot = true
                slotMesh.userData.skuItemId = slot.skuItemId
                group.add(slotMesh)
                
                // Store slot mesh reference for hover detection
                slotMeshesRef.current.set(`${shelf.id}-${facing}-${levelIdx}-${slot.slotIndex}`, { 
                  mesh: slotMesh, 
                  skuItemId: slot.skuItemId 
                })
                
                // Border for filled slot - orange for hovered, white for active, green otherwise
                const edgesGeometry = new THREE.EdgesGeometry(slotGeometry)
                const edgesMaterial = new THREE.LineBasicMaterial({ 
                  color: isHoveredSku ? 0xff6600 : (isActive ? 0xffffff : 0x16a34a), 
                  transparent: true, 
                  opacity: isHoveredSku ? 1.0 : 0.8 
                })
                const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial)
                edges.position.copy(slotMesh.position)
                group.add(edges)
                
                // Add extra highlight ring for hovered SKU
                if (isHoveredSku) {
                  const ringGeometry = faceParams.slotDirection === 'x' 
                    ? new THREE.BoxGeometry(slotWidth * 1.15, slotHeight * 1.1, 0.08)
                    : new THREE.BoxGeometry(0.08, slotHeight * 1.1, slotWidth * 1.15)
                  const ringMaterial = new THREE.MeshBasicMaterial({
                    color: 0xff6600,
                    transparent: true,
                    opacity: 0.4,
                    side: THREE.DoubleSide,
                  })
                  const ringMesh = new THREE.Mesh(ringGeometry, ringMaterial)
                  ringMesh.position.copy(slotMesh.position)
                  group.add(ringMesh)
                }
              }
            })
          })
        }
      })
    }
    
    // Add clickable face indicators when active (for changing slot facing direction)
    if (isActive && faceSelectMode) {
      const faceConfigs: { face: SlotFacing, pos: [number, number, number], size: [number, number], rot?: number }[] = [
        { face: 'front', pos: [0, height/2, depth/2 + 0.03], size: [width * 0.8, height * 0.8] },
        { face: 'back', pos: [0, height/2, -depth/2 - 0.03], size: [width * 0.8, height * 0.8] },
        { face: 'left', pos: [-width/2 - 0.03, height/2, 0], size: [depth * 0.8, height * 0.8], rot: Math.PI/2 },
        { face: 'right', pos: [width/2 + 0.03, height/2, 0], size: [depth * 0.8, height * 0.8], rot: Math.PI/2 },
      ]
      
      faceConfigs.forEach(({ face, pos, size, rot }) => {
        const isCurrentFace = facings.includes(face)
        const isHovered = face === hoveredFace
        const faceGeom = new THREE.PlaneGeometry(size[0], size[1])
        const faceMat = new THREE.MeshBasicMaterial({
          color: isCurrentFace ? COLORS.faceSelected : (isHovered ? COLORS.faceHighlight : 0x666666),
          transparent: true,
          opacity: isCurrentFace ? 0.4 : (isHovered ? 0.3 : 0.15),
          side: THREE.DoubleSide,
        })
        const faceMesh = new THREE.Mesh(faceGeom, faceMat)
        faceMesh.position.set(...pos)
        if (rot) faceMesh.rotation.y = rot
        faceMesh.userData.isFaceSelector = true
        faceMesh.userData.faceDirection = face
        faceMesh.userData.shelfId = shelf.id
        group.add(faceMesh)
        faceMeshesRef.current.set(`${shelf.id}-${face}`, faceMesh)
      })
    }
    
    // Position and rotation
    group.position.set(shelf.position.x, shelf.position.y, shelf.position.z)
    group.rotation.set(shelf.rotation?.x || 0, shelf.rotation?.y || 0, shelf.rotation?.z || 0)
    
    return group
  }, [activeShelfPlanogram, allShelfPlanograms, shelfHasFilledSlots, faceSelectMode, hoveredFace, hoveredSkuId])
  
  // Initialize scene
  useEffect(() => {
    if (!containerRef.current || !venue) return
    
    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111827)
    sceneRef.current = scene
    
    // Camera
    const camera = new THREE.PerspectiveCamera(
      50,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    )
    camera.position.set(venue.width / 2, venue.height * 2, venue.depth * 1.5)
    camera.lookAt(venue.width / 2, 0, venue.depth / 2)
    cameraRef.current = camera
    
    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer
    
    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(venue.width / 2, 0, venue.depth / 2)
    controls.maxPolarAngle = Math.PI / 2
    controls.minDistance = 3
    controls.maxDistance = 100
    controls.update()
    controlsRef.current = controls
    
    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 20, 10)
    directionalLight.castShadow = true
    scene.add(directionalLight)
    
    // Floor
    const floorGeometry = new THREE.PlaneGeometry(venue.width, venue.depth)
    const floorMaterial = new THREE.MeshStandardMaterial({ color: COLORS.floor })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(venue.width / 2, 0, venue.depth / 2)
    floor.receiveShadow = true
    scene.add(floor)
    
    // Grid
    const gridHelper = new THREE.GridHelper(Math.max(venue.width, venue.depth), Math.max(venue.width, venue.depth))
    gridHelper.position.set(venue.width / 2, 0.01, venue.depth / 2)
    scene.add(gridHelper)
    
    // XYZ Axis helper at origin for debugging
    const axesHelper = new THREE.AxesHelper(10)
    axesHelper.position.set(0, 0.02, 0)
    scene.add(axesHelper)
    
    // Add axis labels
    const createAxisLabel = (text: string, color: number, pos: THREE.Vector3) => {
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
      sprite.position.copy(pos)
      sprite.scale.set(2, 2, 1)
      scene.add(sprite)
    }
    createAxisLabel('X', 0xff0000, new THREE.Vector3(11, 0, 0))
    createAxisLabel('Y', 0x00ff00, new THREE.Vector3(0, 11, 0))
    createAxisLabel('Z', 0x0000ff, new THREE.Vector3(0, 0, 11))
    
    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()
    
    // Resize handler
    const handleResize = () => {
      if (!containerRef.current) return
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
      containerRef.current?.removeChild(renderer.domElement)
    }
  }, [venue])
  
  // Update shelves when objects, active shelf, or planogram data changes
  useEffect(() => {
    if (!sceneRef.current) return
    
    // Remove old shelf meshes
    shelfMeshesRef.current.forEach(mesh => {
      sceneRef.current?.remove(mesh)
    })
    shelfMeshesRef.current.clear()
    
    // Add shelf meshes
    shelves.forEach(shelf => {
      const isActive = shelf.id === activeShelfId
      const mesh = createShelfMesh(shelf, isActive)
      sceneRef.current?.add(mesh)
      shelfMeshesRef.current.set(shelf.id, mesh)
    })
  }, [shelves, activeShelfId, createShelfMesh, allShelfPlanograms, hoveredSkuId])
  
  // Click handler for shelf selection and face selection
  const handleClick = useCallback(async (event: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !sceneRef.current) return
    
    const rect = containerRef.current.getBoundingClientRect()
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current)
    
    // First check for face selector clicks (if in face select mode)
    if (faceSelectMode && activeShelfId) {
      const faceMeshes: THREE.Mesh[] = []
      sceneRef.current.traverse(obj => {
        if (obj instanceof THREE.Mesh && obj.userData.isFaceSelector) {
          faceMeshes.push(obj)
        }
      })
      
      const faceIntersects = raycasterRef.current.intersectObjects(faceMeshes)
      if (faceIntersects.length > 0) {
        const faceDirection = faceIntersects[0].object.userData.faceDirection as SlotFacing
        if (faceDirection && activeShelfPlanogram) {
          // Toggle face in the array
          const currentFacings = activeShelfPlanogram.slotFacings || []
          let newFacings: SlotFacing[]
          if (currentFacings.includes(faceDirection)) {
            // Remove face (but keep at least one)
            newFacings = currentFacings.filter(f => f !== faceDirection)
            if (newFacings.length === 0) {
              // Can't remove the last one - keep it
              return
            }
          } else {
            // Add face
            newFacings = [...currentFacings, faceDirection]
          }
          await saveShelfPlanogram(activeShelfId, {
            ...activeShelfPlanogram,
            slotFacings: newFacings,
          })
          return
        }
      }
    }
    
    // Then check for shelf clicks
    const meshes: THREE.Mesh[] = []
    shelfMeshesRef.current.forEach(group => {
      group.traverse(obj => {
        if (obj instanceof THREE.Mesh && obj.userData.isShelf) {
          meshes.push(obj)
        }
      })
    })
    
    const intersects = raycasterRef.current.intersectObjects(meshes)
    
    if (intersects.length > 0) {
      const shelfId = intersects[0].object.userData.shelfId
      if (shelfId === activeShelfId) {
        // Clicking same shelf - don't deselect, maybe toggle face mode
      } else {
        setActiveShelfId(shelfId)
        setFaceSelectMode(false)
      }
    } else {
      setActiveShelfId(null)
      setFaceSelectMode(false)
    }
  }, [activeShelfId, setActiveShelfId, faceSelectMode, activeShelfPlanogram, saveShelfPlanogram])
  
  // Handle drag over
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  
  // Handle drop
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      
      if (data.type === 'sku-items' && activeShelfId) {
        const shelf = objects.find(o => o.id === activeShelfId)
        if (shelf) {
          // Use random distribution when dropping multiple items
          const fillOrder = data.skuItemIds.length > 1 ? 'random' : 'sequential'
          await placeSkusOnShelf(
            activeShelfId,
            data.skuItemIds,
            { type: 'shelf' },
            shelf.scale?.x || 2.0,
            { fillOrder }
          )
          
          // Force reload shelf planograms after placement
          if (activePlanogram?.id) {
            const res = await fetch(`${API_BASE}/api/planogram/planograms/${activePlanogram.id}/shelves/${activeShelfId}`)
            const updatedData = await res.json()
            if (updatedData) {
              setAllShelfPlanograms(prev => {
                const next = new Map(prev)
                next.set(activeShelfId, updatedData)
                return next
              })
            }
          }
        }
      }
    } catch (err) {
      console.error('Drop failed:', err)
    }
  }
  
  // Handle mouse move for slot hover tooltip and face hover
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !cameraRef.current || !sceneRef.current) {
      setTooltipSku(null)
      setHoveredFace(null)
      return
    }
    
    const rect = containerRef.current.getBoundingClientRect()
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current)
    
    // Check for face selector hover (if in face select mode)
    if (faceSelectMode) {
      const faceMeshes: THREE.Mesh[] = []
      sceneRef.current.traverse(obj => {
        if (obj instanceof THREE.Mesh && obj.userData.isFaceSelector) {
          faceMeshes.push(obj)
        }
      })
      
      const faceIntersects = raycasterRef.current.intersectObjects(faceMeshes)
      if (faceIntersects.length > 0) {
        const faceDirection = faceIntersects[0].object.userData.faceDirection as SlotFacing
        setHoveredFace(faceDirection)
      } else {
        setHoveredFace(null)
      }
    } else {
      setHoveredFace(null)
    }
    
    // Check for slot hover (for tooltip)
    if (!activeCatalog) {
      setTooltipSku(null)
      return
    }
    
    // Get all slot meshes
    const slotMeshes: THREE.Mesh[] = []
    sceneRef.current.traverse(obj => {
      if (obj instanceof THREE.Mesh && obj.userData.isSlot) {
        slotMeshes.push(obj)
      }
    })
    
    const intersects = raycasterRef.current.intersectObjects(slotMeshes)
    
    if (intersects.length > 0) {
      const skuItemId = intersects[0].object.userData.skuItemId
      if (skuItemId) {
        const sku = activeCatalog.items.find(i => i.id === skuItemId)
        if (sku) {
          setTooltipSku(sku)
          setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
          return
        }
      }
    }
    
    setTooltipSku(null)
  }, [activeCatalog, faceSelectMode])
  
  return (
    <div 
      ref={containerRef}
      className="w-full h-full bg-gray-900 relative"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setTooltipSku(null)}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Instructions */}
      {!activeShelfId && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-gray-800/90 rounded-lg text-gray-300 text-sm pointer-events-none">
          Click a shelf to select it for planogram editing
        </div>
      )}
      
      {/* Active shelf controls */}
      {activeShelfId && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
          <div className="px-4 py-2 bg-amber-600/90 rounded-lg text-white text-sm pointer-events-none">
            Drag SKUs from the library onto the shelf grid
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setFaceSelectMode(!faceSelectMode)
            }}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              faceSelectMode 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
            title="Click a shelf face to set slot direction"
          >
            {faceSelectMode ? 'Click a face...' : 'Change Slot Side'}
          </button>
        </div>
      )}
      
      {/* Face select mode instructions */}
      {faceSelectMode && activeShelfId && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-blue-600/90 rounded-lg text-white text-sm pointer-events-none">
          Click a shelf face to set the slot direction (green = current)
        </div>
      )}
      
      {/* Slot tooltip */}
      {tooltipSku && <Slot3DTooltip sku={tooltipSku} position={tooltipPos} />}
    </div>
  )
}
