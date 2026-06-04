import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, Thermometer, Calendar, BarChart3, Eye, EyeOff, ChevronDown, Check, Layers, Map } from 'lucide-react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { useHeatmap } from '../../context/HeatmapContext'
import { useRoi } from '../../context/RoiContext'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'
import { getHeatColor, getZoneBounds, isPointInPolygon } from './heatmapUtils'
import {
  buildDwgWireframeGroup,
  disposeObject3D,
  type DwgWireframePlane,
} from '../../utils/dwgWireframe3d'
import { getCategoryVisual } from '../../features/businessReporting/operationsConsole/categoryVisuals'
import type { CategoryRankingRow } from '../../features/businessReporting/components/CategoryRankingPanel'
import type { RegionOfInterest } from '../../types'
import { useStoryRailInsetPx } from '../storymode/StoryNarrativeLayout'

const KPI_OPTIONS = [
  { value: 'visits', label: 'Visits' },
  { value: 'dwellSec', label: 'Dwell Time' },
]

function formatDwell(min: number): string {
  if (min >= 60) return `${(min / 60).toFixed(1)}h`
  return `${Math.round(min)}m`
}

const TIMEFRAME_OPTIONS = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
]

interface HeatmapViewerModalProps {
  isOpen: boolean
  onClose: () => void
}

interface TileTooltip {
  x: number
  y: number
  visits: number
  dwellSec: number
  tileX: number
  tileZ: number
}

export default function HeatmapViewerModal({ isOpen, onClose }: HeatmapViewerModalProps) {
  const { venue, objects, loadVenue } = useVenue()
  const { regions } = useRoi()
  const {
    isLoading,
    heatmapData,
    timeframe,
    heightKpi,
    colorKpi,
    opacity,
    focusRequest,
    setTimeframe,
    setHeightKpi,
    setColorKpi,
    setOpacity,
    loadHeatmap,
  } = useHeatmap()
  const storyRailInset = useStoryRailInsetPx()

  const [selectedZoneIds, setSelectedZoneIds] = useState<Set<string>>(new Set())
  const [modalRegions, setModalRegions] = useState<RegionOfInterest[]>([])
  const [showZoneDropdown, setShowZoneDropdown] = useState(false)
  const [showDwgWireframe, setShowDwgWireframe] = useState(true)
  const [dwgWireframePlane, setDwgWireframePlane] = useState<DwgWireframePlane>('pedestal')
  const [tileTooltip, setTileTooltip] = useState<TileTooltip | null>(null)
  const [topCategories, setTopCategories] = useState<CategoryRankingRow[]>([])
  const [catLoading, setCatLoading] = useState(false)
  const [catMetric, setCatMetric] = useState<'visits' | 'dwell'>('visits')

  const canvasRef = useRef<HTMLDivElement>(null)
  const tileMeshesRef = useRef<THREE.Mesh[]>([])
  const raycasterRef = useRef(new THREE.Raycaster())
  const mouseRef = useRef(new THREE.Vector2())
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const heatmapGroupRef = useRef<THREE.Group | null>(null)
  const zoneGroupRef = useRef<THREE.Group | null>(null)
  const dwgWireframeGroupRef = useRef<THREE.Group | null>(null)
  const floorRef = useRef<THREE.Mesh | null>(null)
  const gridHelperRef = useRef<THREE.GridHelper | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  const activeVenueId = focusRequest?.venueId || venue?.id
  const activeRegions = modalRegions.length > 0 ? modalRegions : regions

  // Load all shelf ROIs for modal — RoiContext may only hold DWG-tagged zones from MainViewport
  useEffect(() => {
    if (!isOpen || !activeVenueId) {
      setModalRegions([])
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/api/venues/${activeVenueId}/roi?all=true`)
      .then(res => (res.ok ? res.json() : []))
      .then((data: RegionOfInterest[]) => {
        if (!cancelled) setModalRegions(data)
      })
      .catch(() => {
        if (!cancelled) setModalRegions([])
      })
    return () => { cancelled = true }
  }, [isOpen, activeVenueId])

  useEffect(() => {
    if (!isOpen || !activeVenueId) return
    if (venue?.id !== activeVenueId) {
      void loadVenue(activeVenueId)
    }
  }, [isOpen, activeVenueId, venue?.id, loadVenue])

  // Apply focus from Business Reporting category click
  useEffect(() => {
    if (!isOpen) return
    if (focusRequest?.zoneIds?.length) {
      setSelectedZoneIds(new Set(focusRequest.zoneIds))
    } else {
      setSelectedZoneIds(new Set())
    }
  }, [isOpen, focusRequest])

  // Load heatmap when modal opens
  useEffect(() => {
    const venueId = focusRequest?.venueId || venue?.id
    if (isOpen && venueId) {
      loadHeatmap(venueId)
    }
  }, [isOpen, venue?.id, focusRequest?.venueId, timeframe, loadHeatmap])

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
    gridHelperRef.current = gridHelper

    // Groups for dynamic content
    const heatmapGroup = new THREE.Group()
    scene.add(heatmapGroup)
    heatmapGroupRef.current = heatmapGroup

    const zoneGroup = new THREE.Group()
    scene.add(zoneGroup)
    zoneGroupRef.current = zoneGroup

    const dwgWireframeGroup = new THREE.Group()
    scene.add(dwgWireframeGroup)
    dwgWireframeGroupRef.current = dwgWireframeGroup

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

  // DWG wireframe overlay (same footprints as Business Reporting floor plan)
  useEffect(() => {
    if (!isOpen || !dwgWireframeGroupRef.current) return
    const host = dwgWireframeGroupRef.current

    while (host.children.length > 0) {
      const child = host.children[0]
      disposeObject3D(child)
      host.remove(child)
    }

    if (objects.length === 0) return

    const overlay = buildDwgWireframeGroup(objects, {
      plane: dwgWireframePlane,
      highContrast: true,
      showFill: true,
    })
    host.add(overlay)
  }, [isOpen, objects, dwgWireframePlane])

  // Dim base floor/grid when DWG underlay is on so strokes pop
  useEffect(() => {
    const floor = floorRef.current
    const grid = gridHelperRef.current
    if (!floor) return

    if (showDwgWireframe && objects.length > 0) {
      const mat = floor.material as THREE.MeshStandardMaterial
      mat.opacity = dwgWireframePlane === 'floor' ? 0.35 : 0.55
      mat.transparent = true
      if (grid) {
        grid.visible = dwgWireframePlane !== 'floor'
      }
    } else {
      const mat = floor.material as THREE.MeshStandardMaterial
      mat.opacity = 0.8
      if (grid) grid.visible = true
    }

    if (dwgWireframeGroupRef.current) {
      dwgWireframeGroupRef.current.visible = showDwgWireframe
    }
  }, [showDwgWireframe, dwgWireframePlane, objects.length])

  // Filter tiles by selected zones
  const filteredTiles = useMemo(() => {
    if (!heatmapData?.tiles) return []
    if (selectedZoneIds.size === 0) return heatmapData.tiles

    const selectedZones = activeRegions.filter(r => selectedZoneIds.has(r.id))
    return heatmapData.tiles.filter(tile => {
      return selectedZones.some(zone => isPointInPolygon({ x: tile.x, z: tile.z }, zone.vertices))
    })
  }, [heatmapData?.tiles, selectedZoneIds, activeRegions])

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
      ? activeRegions.filter(r => selectedZoneIds.has(r.id))
      : activeRegions

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
  }, [activeRegions, selectedZoneIds])

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

    tileMeshesRef.current = []
    const { tileSize } = heatmapData
    const ELEVATION = 0.5 // Elevated plane for heatmap

    // Use 95th percentile for normalization to handle outliers
    // This prevents a single hot tile from flattening all other colors
    const getPercentile = (arr: number[], p: number) => {
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = Math.ceil((p / 100) * sorted.length) - 1
      return sorted[Math.max(0, idx)] || 1
    }
    
    const visitValues = filteredTiles.map(t => t.visits).filter(v => v > 0)
    const dwellValues = filteredTiles.map(t => t.dwellSec).filter(v => v > 0)
    
    // Use 95th percentile for color (spreads colors better) but keep some headroom
    const p95Visits = visitValues.length > 0 ? getPercentile(visitValues, 95) : 1
    const p95Dwell = dwellValues.length > 0 ? getPercentile(dwellValues, 95) : 1
    
    // For max, use actual max but cap at 2x the 95th percentile to avoid extreme outliers
    const maxVisitsNorm = Math.min(heatmapData.maxVisits, p95Visits * 2) || 1
    const maxDwellNorm = Math.min(heatmapData.maxDwell, p95Dwell * 2) || 1

    filteredTiles.forEach(tile => {
      const heightValue = tile[heightKpi]
      const colorValue = tile[colorKpi]
      const maxH = heightKpi === 'visits' ? maxVisitsNorm : maxDwellNorm
      const maxC = colorKpi === 'visits' ? maxVisitsNorm : maxDwellNorm
      const normHeight = maxH > 0 ? Math.min(heightValue / maxH, 1.5) : 0 // Allow slight overflow for outliers
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
      mesh.userData = {
        visits: tile.visits,
        dwellSec: tile.dwellSec,
        tileX: tile.tileX,
        tileZ: tile.tileZ,
      }
      tileMeshesRef.current.push(mesh)
      group.add(mesh)
    })
  }, [filteredTiles, heatmapData, heightKpi, colorKpi, opacity])

  // Tile hover tooltip via raycasting
  useEffect(() => {
    if (!isOpen) return
    const container = canvasRef.current
    const camera = cameraRef.current
    if (!container || !camera) return

    const onMove = (event: MouseEvent) => {
      if (!tileMeshesRef.current.length) {
        setTileTooltip(null)
        return
      }
      const rect = container.getBoundingClientRect()
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycasterRef.current.setFromCamera(mouseRef.current, camera)
      const hits = raycasterRef.current.intersectObjects(tileMeshesRef.current, false)
      if (hits.length > 0) {
        const data = hits[0].object.userData as { visits: number; dwellSec: number; tileX: number; tileZ: number }
        setTileTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          visits: data.visits,
          dwellSec: data.dwellSec,
          tileX: data.tileX,
          tileZ: data.tileZ,
        })
      } else {
        setTileTooltip(null)
      }
    }

    const onLeave = () => setTileTooltip(null)
    container.addEventListener('mousemove', onMove)
    container.addEventListener('mouseleave', onLeave)
    return () => {
      container.removeEventListener('mousemove', onMove)
      container.removeEventListener('mouseleave', onLeave)
    }
  }, [isOpen, filteredTiles.length])

  // Auto-focus camera on selected zones
  const focusOnSelectedZones = useCallback(() => {
    if (!cameraRef.current || !controlsRef.current || !venue) return

    let bounds: { minX: number; maxX: number; minZ: number; maxZ: number }

    if (selectedZoneIds.size > 0) {
      const selectedZones = activeRegions.filter(r => selectedZoneIds.has(r.id))
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
  }, [selectedZoneIds, activeRegions, venue])

  // Focus when selection changes
  useEffect(() => {
    if (isOpen) {
      focusOnSelectedZones()
    }
  }, [selectedZoneIds, isOpen, focusOnSelectedZones, modalRegions.length])

  // Category traffic — most visited & dwelled zones grouped by product category.
  // Same source as the Business Reporting "Category Traffic" panel, so the numbers
  // reflect the active recording (last MQTT playback) the heatmap is showing.
  useEffect(() => {
    if (!isOpen || !activeVenueId) { setTopCategories([]); return }
    let cancelled = false
    setCatLoading(true)
    const endTs = Date.now()
    const startTs = endTs - 24 * 60 * 60 * 1000
    const params = new URLSearchParams({
      personaId: 'merchandising',
      venueId: activeVenueId,
      startTs: String(startTs),
      endTs: String(endTs),
    })
    fetch(`${API_BASE}/api/reporting/summary?${params}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled) return
        setTopCategories((data?.supporting?.topCategories as CategoryRankingRow[]) || [])
      })
      .catch(() => { if (!cancelled) setTopCategories([]) })
      .finally(() => { if (!cancelled) setCatLoading(false) })
    return () => { cancelled = true }
  }, [isOpen, activeVenueId])

  const sortedCats = useMemo(() => {
    const rows = topCategories.filter(c => c.totalVisits > 0 || (c.totalDwellMin ?? 0) > 0)
    return rows.sort((a, b) =>
      catMetric === 'dwell'
        ? (b.totalDwellMin ?? 0) - (a.totalDwellMin ?? 0) || b.totalVisits - a.totalVisits
        : b.totalVisits - a.totalVisits || (b.totalDwellMin ?? 0) - (a.totalDwellMin ?? 0),
    )
  }, [topCategories, catMetric])

  const maxCatVal = useMemo(
    () => Math.max(1, ...sortedCats.map(c => (catMetric === 'dwell' ? (c.totalDwellMin ?? 0) : c.totalVisits))),
    [sortedCats, catMetric],
  )

  // Real "cold zone" backing for the story beat: lowest-traffic named category vs the average.
  const coldest = useMemo(() => {
    const named = sortedCats.filter(c => c.category !== 'Uncategorized' && c.totalVisits > 0)
    if (named.length < 2) return null
    const avg = named.reduce((s, c) => s + c.totalVisits, 0) / named.length
    if (avg <= 0) return null
    const min = named.reduce((m, c) => (c.totalVisits < m.totalVisits ? c : m), named[0])
    return { name: min.category, pct: Math.round((min.totalVisits / avg) * 100) }
  }, [sortedCats])

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
    setSelectedZoneIds(new Set(activeRegions.map(r => r.id)))
  }

  const clearZoneSelection = () => {
    setSelectedZoneIds(new Set())
  }

  if (!isOpen) return null

  return (
    <div
      className={`fixed bg-black/70 backdrop-blur-sm flex items-center justify-center z-[70] ${storyRailInset ? '' : 'inset-0'}`}
      style={storyRailInset ? { top: 0, left: 0, bottom: 0, right: storyRailInset } : undefined}
      onClick={onClose}
    >
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[1320px] h-[700px] max-w-[95vw] max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700 bg-gray-900/95">
          <div className="flex items-center gap-3">
            <Thermometer className="w-5 h-5 text-orange-400" />
            <div>
              <h2 className="text-lg font-semibold text-white">
                {focusRequest?.categoryLabel ? `${focusRequest.categoryLabel} Heatmap` : 'Heatmap Viewer'}
              </h2>
              <p className="text-xs text-gray-400">
                {focusRequest?.categoryLabel
                  ? 'Category zones · hover tiles for visits & dwell'
                  : 'Focused zone analysis · hover tiles for detail'}
              </p>
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
                  {activeRegions.length === 0 ? (
                    <div className="p-3 text-xs text-gray-500 text-center">No zones defined</div>
                  ) : (
                    activeRegions.map(zone => (
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

        {/* Body: category sidebar + 3D canvas */}
        <div className="flex flex-1 min-h-0">
          {/* Category Traffic sidebar — most visited & dwelled by category */}
          <aside className="w-[300px] shrink-0 border-r border-gray-700 bg-gray-900/60 flex flex-col">
            <div className="px-4 py-3 border-b border-gray-700/60 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-white">Category Traffic</h3>
                <p className="text-[10px] text-gray-500 truncate">Most visited &amp; dwelled zones</p>
              </div>
              <div className="flex bg-gray-800 rounded-md p-0.5 border border-gray-700/60 shrink-0">
                <button
                  type="button"
                  onClick={() => setCatMetric('visits')}
                  className={`px-2 py-0.5 text-[10px] rounded ${catMetric === 'visits' ? 'bg-white/10 text-white' : 'text-gray-500'}`}
                >
                  Visits
                </button>
                <button
                  type="button"
                  onClick={() => setCatMetric('dwell')}
                  className={`px-2 py-0.5 text-[10px] rounded ${catMetric === 'dwell' ? 'bg-white/10 text-white' : 'text-gray-500'}`}
                >
                  Dwell
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
              {catLoading ? (
                <div className="flex items-center justify-center py-10">
                  <div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : sortedCats.length === 0 ? (
                <div className="text-[11px] text-gray-500 py-8 px-1 text-center leading-relaxed">
                  No category traffic in the active recording yet. Map shelves to categories in DWG import or Smart KPI.
                </div>
              ) : (
                sortedCats.map(row => {
                  const { Icon, color } = getCategoryVisual(row.category)
                  const val = catMetric === 'dwell' ? (row.totalDwellMin ?? 0) : row.totalVisits
                  const w = Math.max(Math.round((val / maxCatVal) * 100), val > 0 ? 4 : 0)
                  const label = catMetric === 'dwell'
                    ? formatDwell(row.totalDwellMin ?? 0)
                    : row.totalVisits.toLocaleString()
                  return (
                    <div key={row.category} className="rounded-md px-2 py-2 hover:bg-gray-800/40 transition-colors">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs text-white truncate inline-flex items-center gap-1.5">
                          <Icon className="w-3.5 h-3.5 shrink-0" style={{ color }} strokeWidth={2.25} />
                          {row.category}
                        </span>
                        <span className="text-[10px] tabular-nums text-white shrink-0">
                          {label}
                          <span className="text-gray-500 ml-1">{catMetric === 'dwell' ? 'dwell' : 'visits'}</span>
                        </span>
                      </div>
                      <div className="relative h-1.5 rounded-sm bg-gray-900/80 overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-sm"
                          style={{ width: `${w}%`, backgroundColor: color, opacity: 0.72 }}
                        />
                      </div>
                      <div className="flex justify-between mt-0.5 text-[9px] text-gray-600">
                        <span>{row.zoneCount} zone{row.zoneCount !== 1 ? 's' : ''}</span>
                        <span>{(row.avgBrowseTimeMin ?? 0).toFixed(1)}m avg browse</span>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            {coldest && (
              <div className="px-4 py-2.5 border-t border-gray-700/60 bg-amber-500/5">
                <div className="text-[9px] uppercase tracking-wide text-amber-300/80 mb-0.5">Coldest category</div>
                <div className="text-xs text-white">
                  <b>{coldest.name}</b> · <span className="text-amber-300">{coldest.pct}% of avg traffic</span>
                </div>
              </div>
            )}
          </aside>

          {/* Right column: canvas + controls */}
          <div className="flex-1 flex flex-col min-w-0">
        {/* 3D Canvas */}
        <div className="flex-1 relative">
          <div ref={canvasRef} className="w-full h-full" />

          {tileTooltip && (
            <div
              className="absolute z-20 pointer-events-none bg-gray-950/95 border border-gray-600 rounded px-2.5 py-1.5 text-[10px] text-white shadow-lg"
              style={{ left: tileTooltip.x + 12, top: tileTooltip.y - 8 }}
            >
              <div className="text-gray-400 mb-0.5">Tile {tileTooltip.tileX}, {tileTooltip.tileZ}</div>
              <div><span className="text-gray-500">Visits</span> <b>{tileTooltip.visits}</b></div>
              <div><span className="text-gray-500">Dwell</span> <b>{Math.round(tileTooltip.dwellSec / 60)}m {tileTooltip.dwellSec % 60}s</b></div>
            </div>
          )}
          
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
              <div className="flex-1 h-2 rounded-full" style={{ background: 'linear-gradient(to right, #1e3a5f, #00bcd4, #4caf50, #ffeb3b, #ff9800, #f44336)' }} />
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

          {/* Heatmap tile opacity */}
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">Tiles:</span>
            <input
              type="range"
              min="0.2"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(parseFloat(e.target.value))}
              className="w-20 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-orange-500"
            />
            <span className="text-xs text-white w-7">{Math.round(opacity * 100)}%</span>
          </div>

          {/* DWG wireframe — solid strokes on a parallel plane (no opacity slider) */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setShowDwgWireframe(v => !v)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                showDwgWireframe
                  ? 'bg-cyan-900/40 text-cyan-300 border border-cyan-700/50'
                  : 'text-gray-500 border border-gray-700 hover:text-gray-300'
              }`}
              title="Toggle DWG floor plan wireframe"
            >
              <Map className="w-3.5 h-3.5" />
              {showDwgWireframe ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              DWG
            </button>
            <select
              value={dwgWireframePlane}
              onChange={(e) => setDwgWireframePlane(e.target.value as DwgWireframePlane)}
              disabled={!showDwgWireframe || objects.length === 0}
              className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white disabled:opacity-40"
              title="Ground = floor plane; Pedestal = base of heatmap bars (recommended)"
            >
              <option value="pedestal">Pedestal plane</option>
              <option value="floor">Ground plane</option>
            </select>
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
      </div>
    </div>
  )
}
