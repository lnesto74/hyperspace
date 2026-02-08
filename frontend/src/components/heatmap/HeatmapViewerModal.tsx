import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, Thermometer, Calendar, BarChart3, Eye, ChevronDown, Check, Layers } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useHeatmap } from '../../context/HeatmapContext'
import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'
import { Vector2 } from '../../types'

const KPI_OPTIONS = [
  { value: 'visits', label: 'Visits' },
  { value: 'dwellSec', label: 'Dwell Time' },
]

const TIMEFRAME_OPTIONS = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
]

interface HeatmapViewerModalProps {
  isOpen: boolean
  onClose: () => void
}

function isPointInPolygon(point: { x: number; z: number }, vertices: Vector2[]): boolean {
  let inside = false
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, zi = vertices[i].z
    const xj = vertices[j].x, zj = vertices[j].z
    if (((zi > point.z) !== (zj > point.z)) &&
        (point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi)) {
      inside = !inside
    }
  }
  return inside
}

function getZoneBounds(vertices: Vector2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const xs = vertices.map(v => v.x)
  const zs = vertices.map(v => v.z)
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
  }
}

function getHeatColor(value: number, max: number): THREE.Color {
  if (max === 0) return new THREE.Color(0x4c1d95)
  const t = Math.min(value / max, 1)
  if (t < 0.33) {
    const ratio = t / 0.33
    return new THREE.Color().setRGB(0.3 - ratio * 0.1, 0.1 + ratio * 0.3, 0.6 + ratio * 0.3)
  } else if (t < 0.66) {
    const ratio = (t - 0.33) / 0.33
    return new THREE.Color().setRGB(0.2 + ratio * 0.6, 0.4 - ratio * 0.2, 0.9 - ratio * 0.3)
  }
  const ratio = (t - 0.66) / 0.34
  return new THREE.Color().setRGB(0.8 + ratio * 0.2, 0.2 - ratio * 0.1, 0.6 - ratio * 0.4)
}

export default function HeatmapViewerModal({ isOpen, onClose }: HeatmapViewerModalProps) {
  const { venue } = useVenue()
  const { regions } = useRoi()
  const {
    isLoading,
    heatmapData,
    timeframe,
    heightKpi,
    colorKpi,
    opacity,
    setTimeframe,
    setHeightKpi,
    setColorKpi,
    setOpacity,
    loadHeatmap,
  } = useHeatmap()

  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(new Set())
  const [showZoneDropdown, setShowZoneDropdown] = useState(false)
  
  const canvasRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const heatmapGroupRef = useRef<THREE.Group | null>(null)
  const zoneGroupRef = useRef<THREE.Group | null>(null)
  const floorRef = useRef<THREE.Mesh | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Load heatmap when modal opens
  useEffect(() => {
    if (isOpen && venue?.id) {
      loadHeatmap(venue.id)
    }
  }, [isOpen, venue?.id, timeframe, loadHeatmap])

  // Initialize Three.js scene
  useEffect(() => {
    if (!isOpen || !canvasRef.current || !venue) return

    const container = canvasRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a0f)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000)
    camera.position.set(venue.width / 2, Math.max(venue.width, venue.depth) * 0.8, venue.depth / 2 + venue.depth * 0.6)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(venue.width / 2, 0, venue.depth / 2)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.maxPolarAngle = Math.PI / 2.1
    controls.update()
    controlsRef.current = controls

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(venue.width, venue.height * 2, venue.depth)
    scene.add(directionalLight)

    // Floor
    const floorGeometry = new THREE.PlaneGeometry(venue.width, venue.depth)
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e,
      transparent: true,
      opacity: 0.8,
    })
    const floor = new THREE.Mesh(floorGeometry, floorMaterial)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(venue.width / 2, 0, venue.depth / 2)
    scene.add(floor)
    floorRef.current = floor

    // Grid helper
    const gridHelper = new THREE.GridHelper(Math.max(venue.width, venue.depth), Math.max(venue.width, venue.depth))
    gridHelper.position.set(venue.width / 2, 0.01, venue.depth / 2)
    ;(gridHelper.material as THREE.Material).opacity = 0.15
    ;(gridHelper.material as THREE.Material).transparent = true
    scene.add(gridHelper)

    // Groups for dynamic content
    const heatmapGroup = new THREE.Group()
    scene.add(heatmapGroup)
    heatmapGroupRef.current = heatmapGroup

    const zoneGroup = new THREE.Group()
    scene.add(zoneGroup)
    zoneGroupRef.current = zoneGroup

    // Animation loop
    const animate = () => {
      animationFrameRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Handle resize
    const handleResize = () => {
      if (!container || !renderer || !camera) return
      const w = container.clientWidth
      const h = container.clientHeight
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
      controls.dispose()
      renderer.dispose()
      container.removeChild(renderer.domElement)
    }
  }, [isOpen, venue])

  // Filter tiles by selected zones
  const filteredTiles = useMemo(() => {
    if (!heatmapData?.tiles) return []
    if (selectedZoneIds.size === 0) return heatmapData.tiles

    const selectedZones = regions.filter(r => selectedZoneIds.has(r.id))
    return heatmapData.tiles.filter(tile => {
      return selectedZones.some(zone => isPointInPolygon({ x: tile.x, z: tile.z }, zone.vertices))
    })
  }, [heatmapData?.tiles, selectedZoneIds, regions])

  // Render zone outlines
  useEffect(() => {
    if (!zoneGroupRef.current) return
    const group = zoneGroupRef.current

    // Clear existing
    while (group.children.length > 0) {
      const child = group.children[0]
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
      group.remove(child)
    }

    const zonesToRender = selectedZoneIds.size > 0 
      ? regions.filter(r => selectedZoneIds.has(r.id))
      : regions

    zonesToRender.forEach(zone => {
      // Zone outline only (no fill to avoid extending beyond floor)
      const outlinePoints = zone.vertices.map(v => new THREE.Vector3(v.x, 0.03, v.z))
      outlinePoints.push(outlinePoints[0].clone())
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints)
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: zone.color,
        linewidth: 2,
      })
      const outline = new THREE.Line(outlineGeometry, outlineMaterial)
      group.add(outline)
    })
  }, [regions, selectedZoneIds])

  // Render heatmap tiles (elevated)
  useEffect(() => {
    if (!heatmapGroupRef.current || !heatmapData) return
    const group = heatmapGroupRef.current

    // Clear existing
    while (group.children.length > 0) {
      const child = group.children[0]
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose())
        } else {
          child.material.dispose()
        }
      }
      group.remove(child)
    }

    if (filteredTiles.length === 0) return

    const { tileSize, maxVisits, maxDwell } = heatmapData
    const ELEVATION = 0.5 // Elevated plane for heatmap

    filteredTiles.forEach(tile => {
      const heightValue = tile[heightKpi]
      const colorValue = tile[colorKpi]
      const maxH = heightKpi === 'visits' ? maxVisits : maxDwell
      const maxC = colorKpi === 'visits' ? maxVisits : maxDwell
      const normHeight = maxH > 0 ? heightValue / maxH : 0
      const height = 0.05 + normHeight * 1.5
      const color = getHeatColor(colorValue, maxC)

      const geo = new THREE.BoxGeometry(tileSize * 0.85, height, tileSize * 0.85)
      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: opacity,
        emissive: color,
        emissiveIntensity: 0.2,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(tile.x, ELEVATION + height / 2, tile.z)
      group.add(mesh)
    })
  }, [filteredTiles, heatmapData, heightKpi, colorKpi, opacity])

  // Auto-focus camera on selected zones
  const focusOnSelectedZones = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !venue) return

    let bounds: { minX: number; maxX: number; minZ: number; maxZ: number }

    if (selectedZoneIds.size > 0) {
      const selectedZones = regions.filter(r => selectedZoneIds.has(r.id))
      const allVertices = selectedZones.flatMap(z => z.vertices)
      bounds = getZoneBounds(allVertices)
    } else {
      bounds = { minX: 0, maxX: venue.width, minZ: 0, maxZ: venue.depth }
    }

    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerZ = (bounds.minZ + bounds.maxZ) / 2
    const width = bounds.maxX - bounds.minX
    const depth = bounds.maxZ - bounds.minZ
    const maxDim = Math.max(width, depth, 4) // Min 4m for very small zones

    controlsRef.current.target.set(centerX, 0.5, centerZ)
    cameraRef.current.position.set(
      centerX,
      maxDim * 1.2,
      centerZ + maxDim * 0.8
    )
    controlsRef.current.update()
  }, [selectedZoneIds, regions, venue])

  // Focus when selection changes
  useEffect(() => {
    if (isOpen) {
      focusOnSelectedZones()
    }
  }, [selectedZoneIds, isOpen, focusOnSelectedZones])

  const toggleZone = (zoneId: string) => {
    setSelectedZoneIds(prev => {
      const next = new Set(prev)
      if (next.has(zoneId)) {
        next.delete(zoneId)
      } else {
        next.add(zoneId)
      }
      return next
    })
  }

  const selectAllZones = () => {
    setSelectedZoneIds(new Set(regions.map(r => r.id)))
  }

  const clearZoneSelection = () => {
    setSelectedZoneIds(new Set())
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[1000px] h-[700px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-900/95">
          <div className="flex items-center gap-3">
            <Thermometer className="w-5 h-5 text-orange-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">Heatmap Viewer</h2>
              <p className="text-xs text-gray-400">Focused zone analysis • Elevated visualization</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Zone Selector */}
            <div className="relative">
              <button
                onClick={() => setShowZoneDropdown(!showZoneDropdown)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-600 rounded-lg text-sm text-white hover:border-gray-500 transition-colors"
              >
                <Layers className="w-4 h-4 text-purple-400" />
                <span>
                  {selectedZoneIds.size === 0 
                    ? 'All Zones' 
                    : `${selectedZoneIds.size} Zone${selectedZoneIds.size > 1 ? 's' : ''}`}
                </span>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </button>

              {showZoneDropdown && (
                <div className="absolute top-full right-0 mt-1 w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-10 max-h-64 overflow-y-auto">
                  <div className="p-2 border-b border-gray-700 flex gap-2">
                    <button
                      onClick={selectAllZones}
                      className="flex-1 text-xs text-blue-400 hover:text-blue-300"
                    >
                      Select All
                    </button>
                    <button
                      onClick={clearZoneSelection}
                      className="flex-1 text-xs text-gray-400 hover:text-gray-300"
                    >
                      Clear
                    </button>
                  </div>
                  {regions.length === 0 ? (
                    <div className="p-3 text-xs text-gray-500 text-center">No zones defined</div>
                  ) : (
                    regions.map(zone => (
                      <button
                        key={zone.id}
                        onClick={() => toggleZone(zone.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-700 transition-colors"
                      >
                        <div
                          className="w-3 h-3 rounded border-2"
                          style={{
                            borderColor: zone.color,
                            backgroundColor: selectedZoneIds.has(zone.id) ? zone.color : 'transparent',
                          }}
                        >
                          {selectedZoneIds.has(zone.id) && (
                            <Check className="w-2 h-2 text-white" style={{ margin: '-1px' }} />
                          )}
                        </div>
                        <span className="text-sm text-white">{zone.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Timeframe */}
            <div className="relative">
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value as 'day' | 'week' | 'month')}
                className="appearance-none bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 pr-8 text-sm text-white cursor-pointer hover:border-gray-500 transition-colors"
              >
                {TIMEFRAME_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <Calendar className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 3D Canvas */}
        <div className="flex-1 relative">
          <div ref={canvasRef} className="w-full h-full" />
          
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Stats Overlay */}
          {heatmapData && (
            <div className="absolute bottom-4 left-4 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg px-3 py-2 text-xs">
              <div className="flex items-center gap-4 text-gray-400">
                <span>
                  <strong className="text-white">{filteredTiles.length}</strong> tiles
                </span>
                <span>
                  Max visits: <strong className="text-blue-400">{heatmapData.maxVisits}</strong>
                </span>
                <span>
                  Max dwell: <strong className="text-orange-400">{Math.round(heatmapData.maxDwell / 60)}m</strong>
                </span>
              </div>
            </div>
          )}

          {/* Color Legend */}
          <div className="absolute bottom-4 right-4 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 w-48">
            <div className="text-xs text-gray-400 mb-2">Intensity</div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">Low</span>
              <div className="flex-1 h-2 rounded-full bg-gradient-to-r from-purple-900 via-blue-600 via-fuchsia-600 to-red-600" />
              <span className="text-[10px] text-gray-500">High</span>
            </div>
          </div>
        </div>

        {/* Controls Footer */}
        <div className="px-5 py-3 border-t border-gray-700 bg-gray-900/95 flex items-center gap-6">
          {/* Height KPI */}
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">Height:</span>
            <select
              value={heightKpi}
              onChange={(e) => setHeightKpi(e.target.value as 'visits' | 'dwellSec')}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white"
            >
              {KPI_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Color KPI */}
          <div className="flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">Color:</span>
            <select
              value={colorKpi}
              onChange={(e) => setColorKpi(e.target.value as 'visits' | 'dwellSec')}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white"
            >
              {KPI_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Opacity */}
          <div className="flex items-center gap-2 flex-1">
            <Eye className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">Opacity:</span>
            <input
              type="range"
              min="0.2"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-24 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
            <span className="text-xs text-white w-8">{Math.round(opacity * 100)}%</span>
          </div>

          {/* Focus Button */}
          <button
            onClick={focusOnSelectedZones}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs rounded-lg transition-colors"
          >
            Reset View
          </button>
        </div>
      </div>
    </div>
  )
}
