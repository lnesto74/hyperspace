import { useEffect, useRef, useCallback, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export interface LayoutFixture {
  id: string
  group_id: string
  source: {
    layer: string
    block: string | null
    entity_type: string
  }
  pose2d: {
    x: number
    y: number
    rot_deg: number
  }
  footprint: {
    kind: 'rect' | 'poly'
    w: number
    d: number
    points: { x: number; y: number }[]
  }
  mapping: {
    catalog_asset_id: string
    type: string
    anchor: string
    offset_m: { x: number; y: number; z: number }
    rotation_offset_deg: number
  } | null
}

export interface LayoutData {
  units: string
  unit_scale_to_m: number
  bounds: {
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
  fixtures: LayoutFixture[]
  groups: {
    group_id: string
    count: number
    layer: string
    block: string | null
    size: { w: number; d: number }
    members: string[]
    mapping: LayoutFixture['mapping']
  }[]
}

interface ImportedLayoutLayerProps {
  scene: THREE.Scene
  layoutVersionId: string | null
  visible?: boolean
  onLoaded?: (fixtureCount: number) => void
  onError?: (error: string) => void
}

// Default colors for different object types
const TYPE_COLORS: Record<string, number> = {
  shelf: 0x6366f1,
  wall: 0x64748b,
  checkout: 0x22c55e,
  entrance: 0xf59e0b,
  pillar: 0x78716c,
  digital_display: 0x8b5cf6,
  radio: 0x06b6d4,
  custom: 0x8b5cf6,
  default: 0x4b5563
}

export default function ImportedLayoutLayer({
  scene,
  layoutVersionId,
  visible = true,
  onLoaded,
  onError
}: ImportedLayoutLayerProps) {
  const layerGroupRef = useRef<THREE.Group | null>(null)
  const loadedAssetsRef = useRef<Map<string, THREE.Group>>(new Map())
  const instanceMeshesRef = useRef<Map<string, THREE.InstancedMesh>>(new Map())
  const gltfLoaderRef = useRef(new GLTFLoader())
  const [isLoading, setIsLoading] = useState(false)

  // Create or get the layer group
  const getLayerGroup = useCallback(() => {
    if (!layerGroupRef.current) {
      const group = new THREE.Group()
      group.name = 'ImportedLayoutLayer'
      group.userData.source = 'dwg'
      scene.add(group)
      layerGroupRef.current = group
    }
    return layerGroupRef.current
  }, [scene])

  // Clear all objects from the layer
  const clearLayer = useCallback(() => {
    const group = layerGroupRef.current
    if (!group) return

    // Dispose all children
    while (group.children.length > 0) {
      const child = group.children[0]
      group.remove(child)
      
      if (child instanceof THREE.Mesh || child instanceof THREE.InstancedMesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    }

    instanceMeshesRef.current.clear()
  }, [])

  // Load a GLB asset
  const loadAsset = useCallback(async (assetId: string): Promise<THREE.Group | null> => {
    // Check cache
    if (loadedAssetsRef.current.has(assetId)) {
      return loadedAssetsRef.current.get(assetId)!.clone()
    }

    // Try to load custom model
    try {
      const res = await fetch(`${API_BASE}/api/models`)
      if (res.ok) {
        const models = await res.json()
        const model = models.find((m: any) => m.object_type === assetId)
        
        if (model) {
          return new Promise((resolve) => {
            const url = `${API_BASE}${model.file_path}`
            gltfLoaderRef.current.load(
              url,
              (gltf) => {
                const obj = gltf.scene
                
                // Normalize - center and put base at y=0
                const box = new THREE.Box3().setFromObject(obj)
                const center = box.getCenter(new THREE.Vector3())
                obj.position.set(-center.x, -box.min.y, -center.z)
                
                const group = new THREE.Group()
                group.add(obj)
                group.userData.originalSize = box.getSize(new THREE.Vector3())
                
                loadedAssetsRef.current.set(assetId, group)
                resolve(group.clone())
              },
              undefined,
              () => resolve(null)
            )
          })
        }
      }
    } catch {
      // Fall through to null
    }

    return null
  }, [])

  // Create a fallback box mesh for unmapped or missing assets
  const createFallbackMesh = useCallback((
    width: number,
    depth: number,
    height: number,
    color: number
  ): THREE.Mesh => {
    const geometry = new THREE.BoxGeometry(width, height, depth)
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.7,
      metalness: 0.1,
      transparent: true,
      opacity: 0.8
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }, [])

  // Load and render a layout
  const loadLayout = useCallback(async (versionId: string) => {
    setIsLoading(true)
    
    try {
      const res = await fetch(`${API_BASE}/api/dwg/layout/${versionId}`)
      if (!res.ok) {
        throw new Error('Failed to load layout')
      }
      
      const data = await res.json()
      const layout: LayoutData = data.layout
      
      // Clear existing
      clearLayer()
      const group = getLayerGroup()
      
      // Group fixtures by their mapping for efficient instancing
      const fixturesByMapping = new Map<string, LayoutFixture[]>()
      
      for (const fixture of layout.fixtures) {
        const mappingKey = fixture.mapping?.catalog_asset_id || `unmapped_${fixture.group_id}`
        if (!fixturesByMapping.has(mappingKey)) {
          fixturesByMapping.set(mappingKey, [])
        }
        fixturesByMapping.get(mappingKey)!.push(fixture)
      }
      
      // Process each group of fixtures
      for (const [mappingKey, fixtures] of fixturesByMapping) {
        const firstFixture = fixtures[0]
        const mapping = firstFixture.mapping
        
        let baseMesh: THREE.Mesh | THREE.Group | null = null
        
        if (mapping) {
          // Try to load the mapped asset
          baseMesh = await loadAsset(mapping.catalog_asset_id)
        }
        
        // Fallback to box geometry
        if (!baseMesh) {
          const fixtureGroup = layout.groups.find(g => g.group_id === firstFixture.group_id)
          const width = (fixtureGroup?.size.w || 1) * layout.unit_scale_to_m
          const depth = (fixtureGroup?.size.d || 1) * layout.unit_scale_to_m
          const height = Math.max(width, depth) * 0.5 // Reasonable height
          const color = TYPE_COLORS[mapping?.type || 'default'] || TYPE_COLORS.default
          
          baseMesh = createFallbackMesh(width, depth, height, color)
        }
        
        // Create instances for each fixture
        for (const fixture of fixtures) {
          const instance = baseMesh instanceof THREE.Mesh 
            ? baseMesh.clone() 
            : baseMesh.clone()
          
          // Convert DXF coordinates to Three.js
          // DXF: x,y on floor plane
          // Three.js: x,z on floor plane, y is up
          const x = fixture.pose2d.x * layout.unit_scale_to_m
          const z = fixture.pose2d.y * layout.unit_scale_to_m
          let y = 0
          
          // Apply mapping offsets
          if (mapping) {
            x + mapping.offset_m.x
            y += mapping.offset_m.y
            z + mapping.offset_m.z
          }
          
          // Calculate Y position for box (centered origin)
          if (instance instanceof THREE.Mesh) {
            const box = new THREE.Box3().setFromObject(instance)
            const size = box.getSize(new THREE.Vector3())
            y = size.y / 2
          }
          
          instance.position.set(x, y, z)
          
          // Rotation: DXF rotation around Z becomes Three.js rotation around Y
          // Negate because of coordinate system handedness
          let rotY = -fixture.pose2d.rot_deg * (Math.PI / 180)
          if (mapping) {
            rotY += mapping.rotation_offset_deg * (Math.PI / 180)
          }
          instance.rotation.set(0, rotY, 0)
          
          // Add metadata
          instance.userData = {
            source: 'dwg',
            layout_version_id: versionId,
            group_id: fixture.group_id,
            fixture_id: fixture.id,
            layer: fixture.source.layer,
            block: fixture.source.block
          }
          
          group.add(instance)
        }
      }
      
      onLoaded?.(layout.fixtures.length)
      
    } catch (err: any) {
      console.error('Failed to load layout:', err)
      onError?.(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [clearLayer, getLayerGroup, loadAsset, createFallbackMesh, onLoaded, onError])

  // Load layout when version ID changes
  useEffect(() => {
    if (layoutVersionId) {
      loadLayout(layoutVersionId)
    } else {
      clearLayer()
    }
  }, [layoutVersionId, loadLayout, clearLayer])

  // Update visibility
  useEffect(() => {
    if (layerGroupRef.current) {
      layerGroupRef.current.visible = visible
    }
  }, [visible])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearLayer()
      if (layerGroupRef.current) {
        scene.remove(layerGroupRef.current)
        layerGroupRef.current = null
      }
    }
  }, [scene, clearLayer])

  // This component doesn't render anything to DOM
  return null
}

// Utility function to remove imported layout from a scene
export function removeImportedLayout(scene: THREE.Scene) {
  const layerGroup = scene.getObjectByName('ImportedLayoutLayer')
  if (layerGroup) {
    scene.remove(layerGroup)
    layerGroup.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
    })
  }
}

// Utility function to get all imported fixtures from a scene
export function getImportedFixtures(scene: THREE.Scene): THREE.Object3D[] {
  const fixtures: THREE.Object3D[] = []
  const layerGroup = scene.getObjectByName('ImportedLayoutLayer')
  
  if (layerGroup) {
    layerGroup.traverse((child) => {
      if (child.userData.source === 'dwg') {
        fixtures.push(child)
      }
    })
  }
  
  return fixtures
}
