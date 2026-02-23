import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Grid, MousePointer2, Square, Move, Focus, Save, Download, Radio, Play, Wand2, Trash2, Pencil, Check, X, Settings, Plus, Bug, Layers, Eye, ImagePlus, Ruler, FileDown, RotateCw, Scissors, Image as ImageIcon } from 'lucide-react'
import type { ImportData, GroupMapping, LidarModel, LidarInstance, SimulationResult, AutoplaceSettings } from './DwgImporterPage'
import LidarDebugPanel from './LidarDebugPanel'
import { API_BASE } from '../../config/api'

export interface RoiVertex {
  x: number  // in meters
  z: number  // in meters
}

interface PreviewPanelProps {
  importData: ImportData
  selectedGroupId: string | null
  mappings: Record<string, GroupMapping>
  selectedFixtureIds: Set<string>
  onSelectFixtures: (fixtureIds: string[], addToSelection?: boolean) => void
  onDeleteFixtures?: (fixtureIds: string[]) => void
  onHoverFixture?: (fixtureId: string | null) => void
  hoveredFixtureId?: string | null
  // LiDAR mode props
  lidarMode?: boolean
  onToggleLidarMode?: () => void
  lidarEnabled?: boolean
  lidarModels?: LidarModel[]
  lidarInstances?: LidarInstance[]
  selectedLidarModelId?: string | null
  selectedLidarInstanceId?: string | null
  onSelectLidarModel?: (modelId: string | null) => void
  onSelectLidarInstance?: (instanceId: string | null) => void
  onAddLidarInstance?: (x: number, z: number) => void
  onDeleteLidarInstance?: (instanceId: string) => void
  onUpdateLidarInstance?: (instanceId: string, updates: Partial<LidarInstance>) => void
  onDeleteAllLidarInstances?: () => void
  simulationResult?: SimulationResult | null
  isSimulating?: boolean
  onRunSimulation?: () => void
  onAutoPlace?: (roi: RoiVertex[], settings?: AutoplaceSettings) => void
  lidarRoi?: RoiVertex[] | null
  onSetLidarRoi?: (roi: RoiVertex[] | null) => void
  onRefreshModels?: () => Promise<void>
  layoutVersionId?: string | null  // For saving ROI by layout version ID
}

type Tool = 'pan' | 'select' | 'rectangle' | 'place_lidar' | 'draw_roi' | 'move_floorplan' | 'calibrate_floorplan' | 'crop_floorplan'

type ViewMode = 'dwg' | 'floorplan' | 'overlay'

interface FloorplanOverlay {
  id: string
  import_id: string
  original_filename: string
  mime_type: string
  imageUrl: string
  transform: {
    x: number      // DXF X offset
    y: number      // DXF Y offset
    scaleX: number  // pixels-to-DXF-units scale
    scaleY: number
    rotation: number // degrees
    opacity: number  // 0-1
  }
  calibration: {
    p1Screen: { x: number; y: number }
    p2Screen: { x: number; y: number }
    realWorldMeters: number
  } | null
  naturalWidth: number
  naturalHeight: number
  cropRect: { x: number; y: number; w: number; h: number } | null  // image-relative 0-1 coords
}

export default function PreviewPanel({ 
  importData, 
  selectedGroupId, 
  mappings,
  selectedFixtureIds,
  onSelectFixtures,
  onDeleteFixtures,
  onHoverFixture,
  hoveredFixtureId,
  // LiDAR props
  lidarMode = false,
  onToggleLidarMode,
  lidarEnabled = false,
  lidarModels = [],
  lidarInstances = [],
  selectedLidarModelId,
  selectedLidarInstanceId,
  onSelectLidarModel,
  onSelectLidarInstance,
  onAddLidarInstance,
  onDeleteLidarInstance,
  onUpdateLidarInstance,
  onDeleteAllLidarInstances,
  simulationResult,
  isSimulating = false,
  onRunSimulation,
  onAutoPlace,
  lidarRoi: lidarRoiProp,
  onSetLidarRoi,
  onRefreshModels,
  layoutVersionId
}: PreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  
  // Generate storage key from import data filename
  const storageKey = `dwg-2d-view-${importData.filename || 'default'}`
  
  // Initialize zoom and panOffset from localStorage to preserve view on remount
  const [zoom, setZoom] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try {
        return JSON.parse(saved).zoom || 1
      } catch { return 1 }
    }
    return 1
  })
  const [panOffset, setPanOffset] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try {
        return JSON.parse(saved).panOffset || { x: 0, y: 0 }
      } catch { return { x: 0, y: 0 } }
    }
    return { x: 0, y: 0 }
  })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragStartOffset, setDragStartOffset] = useState({ x: 0, y: 0 })
  const [showGrid, setShowGrid] = useState(false)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [viewMode, setViewMode] = useState<ViewMode>('dwg')
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [hasSavedView, setHasSavedView] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  
  // ROI (Region of Interest) drawing state for LiDAR
  const [roiVertices, setRoiVertices] = useState<RoiVertex[]>([])
  const [localLidarRoi, setLocalLidarRoi] = useState<RoiVertex[] | null>(() => {
    // Load ROI from localStorage on init
    const roiKey = `dwg-lidar-roi-${importData.filename || 'default'}`
    const saved = localStorage.getItem(roiKey)
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch { return null }
    }
    return null
  })
  
  // Use prop if provided, otherwise use local state
  const lidarRoi = lidarRoiProp !== undefined ? lidarRoiProp : localLidarRoi
  const setLidarRoi = onSetLidarRoi || ((roi: RoiVertex[] | null) => {
    setLocalLidarRoi(roi)
    // Persist to localStorage with both filename and layoutVersionId keys
    const roiKey = `dwg-lidar-roi-${importData.filename || 'default'}`
    if (roi) {
      localStorage.setItem(roiKey, JSON.stringify(roi))
      // Also save by layoutVersionId for MainViewport DWG mode access
      if (layoutVersionId) {
        localStorage.setItem(`dwg-lidar-roi-by-layout-${layoutVersionId}`, JSON.stringify(roi))
      }
    } else {
      localStorage.removeItem(roiKey)
      if (layoutVersionId) {
        localStorage.removeItem(`dwg-lidar-roi-by-layout-${layoutVersionId}`)
      }
    }
  })
  
  // LiDAR model settings panel state
  const [showModelSettings, setShowModelSettings] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null) // null = create new, string = edit existing
  const [newModelName, setNewModelName] = useState('New LiDAR')
  const [newModelHfov, setNewModelHfov] = useState(360)
  const [newModelVfov, setNewModelVfov] = useState(30)
  const [newModelRange, setNewModelRange] = useState(15)
  const [newModelOverlap, setNewModelOverlap] = useState(2) // Min overlap in meters for tracking continuity
  const [isCreatingModel, setIsCreatingModel] = useState(false)
  
  // Helper to open model settings modal for editing an existing model
  const openEditModel = (model: LidarModel) => {
    console.log('[Model Settings] Opening edit for model:', model)
    setEditingModelId(model.id)
    setNewModelName(model.name)
    setNewModelHfov(model.hfov_deg || 360)
    setNewModelVfov(model.vfov_deg || 30)
    setNewModelRange(model.range_m || 15)
    setNewModelOverlap((model.notes as { min_overlap_m?: number })?.min_overlap_m || 2)
    setShowModelSettings(true)
  }
  
  // Helper to reset form for creating new model
  const openCreateModel = () => {
    console.log('[Model Settings] Opening create new model dialog')
    setEditingModelId(null)
    setNewModelName('New LiDAR')
    setNewModelHfov(360)
    setNewModelVfov(30)
    setNewModelRange(15)
    setNewModelOverlap(2)
    setShowModelSettings(true)
  }
  
  // Autoplace solver settings state - persisted to localStorage
  const autoplaceStorageKey = `dwg-autoplace-settings-${importData.filename || 'default'}`
  const [showAutoplaceSettings, setShowAutoplaceSettings] = useState(false)
  const [autoplaceOverlapMode, setAutoplaceOverlapMode] = useState<'everywhere' | 'critical_only' | 'percent_target'>(() => {
    const saved = localStorage.getItem(autoplaceStorageKey)
    if (saved) try { return JSON.parse(saved).overlapMode || 'everywhere' } catch { }
    return 'everywhere'
  })
  const [autoplaceKRequired, setAutoplaceKRequired] = useState(() => {
    const saved = localStorage.getItem(autoplaceStorageKey)
    if (saved) try { return JSON.parse(saved).kRequired || 2 } catch { }
    return 2
  })
  const [autoplaceOverlapTargetPct, setAutoplaceOverlapTargetPct] = useState(() => {
    const saved = localStorage.getItem(autoplaceStorageKey)
    if (saved) try { return JSON.parse(saved).overlapTargetPct || 0.8 } catch { }
    return 0.8
  })
  const [autoplaceLosEnabled, setAutoplaceLosEnabled] = useState(() => {
    const saved = localStorage.getItem(autoplaceStorageKey)
    if (saved) try { return JSON.parse(saved).losEnabled || false } catch { }
    return false
  })
  const [autoplaceSampleSpacing, setAutoplaceSampleSpacing] = useState(() => {
    const saved = localStorage.getItem(autoplaceStorageKey)
    if (saved) try { return JSON.parse(saved).sampleSpacing || 0.75 } catch { }
    return 0.75
  })
  const [autoplaceMountHeight, setAutoplaceMountHeight] = useState(() => {
    const saved = localStorage.getItem(autoplaceStorageKey)
    if (saved) try { return JSON.parse(saved).mountHeight || 3.0 } catch { }
    return 3.0
  })
  const [showDebugPanel, setShowDebugPanel] = useState(false)
  // Scale correction: multiply unit_scale_to_m by this factor (e.g., 10 if DWG is cm not mm)
  const [scaleCorrection, setScaleCorrection] = useState(() => {
    const saved = localStorage.getItem(autoplaceStorageKey)
    if (saved) try { return JSON.parse(saved).scaleCorrection || 1.0 } catch { }
    return 1.0
  })
  
  // Layer visibility state
  const [showLayersPanel, setShowLayersPanel] = useState(false)
  const [layerVisibility, setLayerVisibility] = useState({
    base: true,           // Base fixtures from DWG
    floorplan: true,      // Floor plan image overlay
    lidarDevices: true,   // LiDAR device markers
    coverageCircles: true, // Coverage circles for LiDARs
    coverageHeatmap: true, // Coverage heatmap
    overlapCells: true,   // Overlap cells (>=k)
    roi: true,            // ROI polygon
    grid: false           // Grid overlay (debug)
  })

  // Floor plan overlay state
  const [floorplan, setFloorplan] = useState<FloorplanOverlay | null>(null)
  const [isUploadingFloorplan, setIsUploadingFloorplan] = useState(false)
  const floorplanInputRef = useRef<HTMLInputElement>(null)
  // Calibration line drawing state
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([])
  const [showCalibrationDialog, setShowCalibrationDialog] = useState(false)
  const [calibrationLength, setCalibrationLength] = useState('')
  // Floorplan drag state
  const [fpDragStart, setFpDragStart] = useState<{ x: number; y: number } | null>(null)
  const [fpDragStartTransform, setFpDragStartTransform] = useState<{ x: number; y: number } | null>(null)
  // Floorplan crop rectangle drawing state (screen coords while drawing)
  const [fpCropStart, setFpCropStart] = useState<{ x: number; y: number } | null>(null)
  const [fpCropCurrent, setFpCropCurrent] = useState<{ x: number; y: number } | null>(null)

  // Save autoplace settings whenever they change
  useEffect(() => {
    const settings = {
      overlapMode: autoplaceOverlapMode,
      kRequired: autoplaceKRequired,
      overlapTargetPct: autoplaceOverlapTargetPct,
      losEnabled: autoplaceLosEnabled,
      sampleSpacing: autoplaceSampleSpacing,
      mountHeight: autoplaceMountHeight,
      scaleCorrection: scaleCorrection
    }
    localStorage.setItem(autoplaceStorageKey, JSON.stringify(settings))
  }, [autoplaceStorageKey, autoplaceOverlapMode, autoplaceKRequired, autoplaceOverlapTargetPct, autoplaceLosEnabled, autoplaceSampleSpacing, autoplaceMountHeight, scaleCorrection])

  // Load floor plan overlay from backend on mount
  useEffect(() => {
    if (!importData?.import_id) return
    const loadFloorplan = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dwg/import/${importData.import_id}/floorplan`)
        if (!res.ok) return
        const data = await res.json()
        if (data.floorplan) {
          const imageUrl = `${API_BASE}/api/dwg/import/${importData.import_id}/floorplan/image`
          // Pre-load image to get natural dimensions
          const img = new Image()
          img.onload = () => {
            setFloorplan({
              ...data.floorplan,
              imageUrl,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
              cropRect: data.floorplan.cropRect || null
            })
          }
          img.src = imageUrl
        }
      } catch (err) {
        console.error('Failed to load floorplan:', err)
      }
    }
    loadFloorplan()
  }, [importData?.import_id])

  // Upload floor plan image
  const handleFloorplanUpload = useCallback(async (file: File) => {
    if (!importData?.import_id) return
    setIsUploadingFloorplan(true)
    try {
      const formData = new FormData()
      formData.append('image', file)
      const res = await fetch(`${API_BASE}/api/dwg/import/${importData.import_id}/floorplan`, {
        method: 'POST',
        body: formData
      })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      const imageUrl = `${API_BASE}/api/dwg/import/${importData.import_id}/floorplan/image?t=${Date.now()}`
      // Pre-load image
      const img = new Image()
      img.onload = () => {
        // Initialize transform: fit image within ~50% of DWG bounds, centered
        const { bounds } = importData
        const dwgW = bounds.maxX - bounds.minX
        const dwgH = bounds.maxY - bounds.minY
        const dwgCenterX = bounds.minX + dwgW / 2
        const dwgCenterY = bounds.minY + dwgH / 2
        // Scale to fit within half the DWG area (reasonable starting size)
        const imgScaleX = (dwgW * 0.5) / img.naturalWidth
        const imgScaleY = (dwgH * 0.5) / img.naturalHeight
        const uniformScale = Math.min(imgScaleX, imgScaleY)
        // Center the image on the DWG center
        const imgDxfW = img.naturalWidth * uniformScale
        const imgDxfH = img.naturalHeight * uniformScale
        const startX = dwgCenterX - imgDxfW / 2
        const startY = dwgCenterY - imgDxfH / 2
        setFloorplan({
          id: data.id,
          import_id: data.import_id,
          original_filename: data.original_filename,
          mime_type: data.mime_type,
          imageUrl,
          transform: {
            x: startX,
            y: startY,
            scaleX: uniformScale,
            scaleY: uniformScale,
            rotation: 0,
            opacity: 0.5
          },
          calibration: null,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          cropRect: null
        })
        // Save initial transform to backend
        saveFloorplanTransform({
          x: startX, y: startY,
          scaleX: uniformScale, scaleY: uniformScale,
          rotation: 0, opacity: 0.5
        })
        // Auto-switch to Floor Plan view for editing
        setViewMode('floorplan')
      }
      img.src = imageUrl
    } catch (err) {
      console.error('Floor plan upload failed:', err)
    } finally {
      setIsUploadingFloorplan(false)
    }
  }, [importData])

  // Save floorplan transform to backend (debounced)
  const saveFloorplanTransformTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveFloorplanTransform = useCallback((transform: FloorplanOverlay['transform'], calibration?: FloorplanOverlay['calibration'], cropRect?: FloorplanOverlay['cropRect']) => {
    if (!importData?.import_id) return
    if (saveFloorplanTransformTimeout.current) clearTimeout(saveFloorplanTransformTimeout.current)
    saveFloorplanTransformTimeout.current = setTimeout(async () => {
      try {
        const body: any = { transform }
        if (calibration !== undefined) body.calibration = calibration
        if (cropRect !== undefined) body.cropRect = cropRect
        await fetch(`${API_BASE}/api/dwg/import/${importData.import_id}/floorplan/transform`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      } catch (err) {
        console.error('Failed to save floorplan transform:', err)
      }
    }, 500)
  }, [importData?.import_id])

  // Delete floorplan
  const handleDeleteFloorplan = useCallback(async () => {
    if (!importData?.import_id) return
    try {
      await fetch(`${API_BASE}/api/dwg/import/${importData.import_id}/floorplan`, { method: 'DELETE' })
      setFloorplan(null)
    } catch (err) {
      console.error('Failed to delete floorplan:', err)
    }
  }, [importData?.import_id])

  // Check if saved view exists and load it on mount
  useEffect(() => {
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      setHasSavedView(true)
      try {
        const viewData = JSON.parse(saved)
        setZoom(viewData.zoom)
        setPanOffset(viewData.panOffset)
        console.log('2D view restored from saved')
      } catch (e) {
        console.error('Failed to load saved 2D view:', e)
      }
    }
  }, [storageKey])

  // Save current view - store visible world bounds for resolution independence
  const saveView = useCallback(() => {
    const { bounds: b, unit_scale_to_m: u } = importData
    const padding = 40
    const drawingWidth = (b.maxX - b.minX) * u
    const drawingHeight = (b.maxY - b.minY) * u
    const availableWidth = dimensions.width - padding * 2
    const availableHeight = dimensions.height - padding * 2
    const scaleX = availableWidth / drawingWidth
    const scaleY = availableHeight / drawingHeight
    const baseScale = Math.min(scaleX, scaleY, 100)
    const scale = baseScale * zoom
    const baseOffsetX = (dimensions.width - drawingWidth * baseScale) / 2
    const baseOffsetY = (dimensions.height - drawingHeight * baseScale) / 2
    const offsetX = baseOffsetX + panOffset.x
    const offsetY = baseOffsetY + panOffset.y
    
    // Calculate visible world bounds (the 4 corners in world coordinates)
    const topLeftWorld = {
      x: ((0 - offsetX) / scale / u) + b.minX,
      y: ((dimensions.height - 0 + offsetY) / scale / u) + b.minY
    }
    const bottomRightWorld = {
      x: ((dimensions.width - offsetX) / scale / u) + b.minX,
      y: ((dimensions.height - dimensions.height + offsetY) / scale / u) + b.minY
    }
    
    const viewData = { 
      zoom, 
      panOffset,
      // Store visible world bounds for resolution-independent loading
      visibleBounds: {
        minX: topLeftWorld.x,
        maxX: bottomRightWorld.x,
        minY: bottomRightWorld.y,
        maxY: topLeftWorld.y
      },
      dimensions: { width: dimensions.width, height: dimensions.height }
    }
    localStorage.setItem(storageKey, JSON.stringify(viewData))
    setHasSavedView(true)
    setJustSaved(true)
    console.log('2D view saved with visible bounds:', viewData.visibleBounds)
    // Reset justSaved after 1.5 seconds
    setTimeout(() => setJustSaved(false), 1500)
  }, [zoom, panOffset, storageKey, dimensions, importData])

  // Load saved view
  const loadSavedView = useCallback(() => {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return
    try {
      const viewData = JSON.parse(saved)
      setZoom(viewData.zoom)
      setPanOffset(viewData.panOffset)
    } catch (e) {
      console.error('Failed to load saved 2D view:', e)
    }
  }, [storageKey])

  // Track container size
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Handle Delete key to remove selected fixtures
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFixtureIds.size > 0 && onDeleteFixtures) {
        e.preventDefault()
        onDeleteFixtures(Array.from(selectedFixtureIds))
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFixtureIds, onDeleteFixtures])

  // Calculate view transform
  const viewTransform = useMemo(() => {
    const { bounds, unit_scale_to_m } = importData
    const padding = 40

    const drawingWidth = (bounds.maxX - bounds.minX) * unit_scale_to_m
    const drawingHeight = (bounds.maxY - bounds.minY) * unit_scale_to_m

    const availableWidth = dimensions.width - padding * 2
    const availableHeight = dimensions.height - padding * 2
    const scaleX = availableWidth / drawingWidth
    const scaleY = availableHeight / drawingHeight
    const baseScale = Math.min(scaleX, scaleY, 100)

    const offsetX = (dimensions.width - drawingWidth * baseScale) / 2
    const offsetY = (dimensions.height - drawingHeight * baseScale) / 2

    return {
      scale: baseScale * zoom,
      baseScale,
      offsetX: offsetX + panOffset.x,
      offsetY: offsetY + panOffset.y,
      bounds,
      unit_scale_to_m
    }
  }, [importData, dimensions, zoom, panOffset])

  // Convert DXF coordinates to screen coordinates
  // Note: Y is inverted (DXF Y+ is up, screen Y+ is down)
  const toScreen = useCallback((x: number, y: number) => {
    const { scale, offsetX, offsetY, bounds, unit_scale_to_m } = viewTransform
    const screenX = ((x - bounds.minX) * unit_scale_to_m) * scale + offsetX
    // For Y: we invert the coordinate system, and panOffset.y needs to be subtracted (not added) due to inversion
    const screenY = dimensions.height - (((y - bounds.minY) * unit_scale_to_m) * scale) - offsetY
    return { x: screenX, y: screenY }
  }, [viewTransform, dimensions.height])

  // Convert screen coordinates to DXF coordinates
  const fromScreen = useCallback((screenX: number, screenY: number) => {
    const { scale, offsetX, offsetY, bounds, unit_scale_to_m } = viewTransform
    const x = ((screenX - offsetX) / scale / unit_scale_to_m) + bounds.minX
    // Fixed: should be -offsetY to be inverse of toScreen
    const y = ((dimensions.height - screenY - offsetY) / scale / unit_scale_to_m) + bounds.minY
    return { x, y }
  }, [viewTransform, dimensions.height])

  // Convert size from DXF units to screen pixels (always positive)
  const toScreenSize = useCallback((size: number) => {
    return Math.abs(size * importData.unit_scale_to_m * viewTransform.scale)
  }, [importData.unit_scale_to_m, viewTransform.scale])

  // Get mouse position relative to container
  const getMousePos = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  // Point-in-polygon test using ray casting algorithm
  const pointInPolygon = useCallback((px: number, py: number, polygon: { x: number; y: number }[]) => {
    let inside = false
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x, yi = polygon[i].y
      const xj = polygon[j].x, yj = polygon[j].y
      
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
        inside = !inside
      }
    }
    return inside
  }, [])

  // Find fixture at screen position
  const findFixtureAt = useCallback((screenX: number, screenY: number) => {
    const hitRadius = 10 / viewTransform.scale
    const dxfPos = fromScreen(screenX, screenY)
    
    // Check smaller fixtures first (they should have priority over large background elements)
    const sortedFixtures = [...importData.fixtures].sort((a, b) => {
      const areaA = a.footprint.w * a.footprint.d
      const areaB = b.footprint.w * b.footprint.d
      return areaA - areaB // Smaller first
    })
    
    for (const fixture of sortedFixtures) {
      // For polygon fixtures, use point-in-polygon test
      if (fixture.footprint.kind === 'poly' && fixture.footprint.points && fixture.footprint.points.length > 2) {
        if (pointInPolygon(dxfPos.x, dxfPos.y, fixture.footprint.points)) {
          return fixture
        }
        continue
      }
      
      // For rectangular fixtures, use bounding box with rotation
      const dx = Math.abs(fixture.pose2d.x - dxfPos.x)
      const dy = Math.abs(fixture.pose2d.y - dxfPos.y)
      const halfW = fixture.footprint.w / 2 + hitRadius
      const halfD = fixture.footprint.d / 2 + hitRadius
      
      if (dx <= halfW && dy <= halfD) {
        return fixture
      }
    }
    return null
  }, [importData.fixtures, viewTransform.scale, fromScreen, pointInPolygon])

  // Check if two rectangles overlap
  const rectsOverlap = useCallback((
    ax1: number, ay1: number, ax2: number, ay2: number,
    bx1: number, by1: number, bx2: number, by2: number
  ) => {
    return ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1
  }, [])

  // Find fixtures in rectangle selection
  const findFixturesInRect = useCallback((x1: number, y1: number, x2: number, y2: number) => {
    const minX = Math.min(x1, x2)
    const maxX = Math.max(x1, x2)
    const minY = Math.min(y1, y2)
    const maxY = Math.max(y1, y2)
    
    const dxf1 = fromScreen(minX, minY)
    const dxf2 = fromScreen(maxX, maxY)
    
    const dxfMinX = Math.min(dxf1.x, dxf2.x)
    const dxfMaxX = Math.max(dxf1.x, dxf2.x)
    const dxfMinY = Math.min(dxf1.y, dxf2.y)
    const dxfMaxY = Math.max(dxf1.y, dxf2.y)
    
    return importData.fixtures.filter(fixture => {
      // For polygon fixtures, check if any point or the bounding box overlaps
      if (fixture.footprint.kind === 'poly' && fixture.footprint.points && fixture.footprint.points.length > 0) {
        // Get polygon bounding box
        const points = fixture.footprint.points
        const polyMinX = Math.min(...points.map(p => p.x))
        const polyMaxX = Math.max(...points.map(p => p.x))
        const polyMinY = Math.min(...points.map(p => p.y))
        const polyMaxY = Math.max(...points.map(p => p.y))
        
        // Check if bounding boxes overlap
        return rectsOverlap(dxfMinX, dxfMinY, dxfMaxX, dxfMaxY, polyMinX, polyMinY, polyMaxX, polyMaxY)
      }
      
      // For rectangular fixtures, check if bounding box overlaps
      const halfW = fixture.footprint.w / 2
      const halfD = fixture.footprint.d / 2
      const fxMinX = fixture.pose2d.x - halfW
      const fxMaxX = fixture.pose2d.x + halfW
      const fxMinY = fixture.pose2d.y - halfD
      const fxMaxY = fixture.pose2d.y + halfD
      
      return rectsOverlap(dxfMinX, dxfMinY, dxfMaxX, dxfMaxY, fxMinX, fxMinY, fxMaxX, fxMaxY)
    })
  }, [importData.fixtures, fromScreen, rectsOverlap])

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    
    const pos = getMousePos(e)
    setDragStart(pos)
    setDragStartOffset({ ...panOffset })
    setIsDragging(true)

    if (activeTool === 'pan') {
      // Pan mode - do nothing special on down
    } else if (activeTool === 'select' && viewMode !== 'floorplan') {
      // Check if clicking on a fixture (only in DWG/overlay modes)
      const fixture = findFixtureAt(pos.x, pos.y)
      if (fixture) {
        if (e.shiftKey) {
          // Add/remove from selection
          const newSelection = new Set(selectedFixtureIds)
          if (newSelection.has(fixture.id)) {
            newSelection.delete(fixture.id)
          } else {
            newSelection.add(fixture.id)
          }
          onSelectFixtures(Array.from(newSelection))
        } else {
          // Single select
          onSelectFixtures([fixture.id])
        }
        setIsDragging(false)
      } else if (!e.shiftKey) {
        // Clear selection if clicking empty space
        onSelectFixtures([])
      }
    } else if (activeTool === 'rectangle') {
      setSelectionRect({ x: pos.x, y: pos.y, w: 0, h: 0 })
    } else if (activeTool === 'place_lidar' && onAddLidarInstance) {
      // Place a LiDAR device at this position
      const worldPos = fromScreen(pos.x, pos.y)
      // Convert from DXF units to meters (apply scaleCorrection for accurate coordinates)
      const effectiveScale = importData.unit_scale_to_m * scaleCorrection
      const x_m = worldPos.x * effectiveScale
      const z_m = worldPos.y * effectiveScale
      console.log('Placing LiDAR at DXF:', worldPos.x, worldPos.y, '-> meters:', x_m, z_m, '(scaleCorrection:', scaleCorrection, ')')
      onAddLidarInstance(x_m, z_m)
      setIsDragging(false)
    } else if (activeTool === 'draw_roi') {
      // Add vertex to ROI polygon - store in DXF units for easy rendering
      const worldPos = fromScreen(pos.x, pos.y)
      // Store in DXF units (will convert to meters when passing to API)
      setRoiVertices(prev => [...prev, { x: worldPos.x, z: worldPos.y }])
      setIsDragging(false)
    } else if (activeTool === 'move_floorplan' && floorplan) {
      // Start dragging the floorplan image
      setFpDragStart(pos)
      setFpDragStartTransform({ x: floorplan.transform.x, y: floorplan.transform.y })
    } else if (activeTool === 'calibrate_floorplan' && floorplan) {
      // Add calibration point (in DXF coords)
      const worldPos = fromScreen(pos.x, pos.y)
      if (calibrationPoints.length === 0) {
        setCalibrationPoints([{ x: worldPos.x, y: worldPos.y }])
      } else if (calibrationPoints.length === 1) {
        setCalibrationPoints(prev => [...prev, { x: worldPos.x, y: worldPos.y }])
        setShowCalibrationDialog(true)
      }
      setIsDragging(false)
    } else if (activeTool === 'crop_floorplan' && floorplan) {
      // Start drawing crop rectangle
      setFpCropStart(pos)
      setFpCropCurrent(pos)
    }
  }, [activeTool, getMousePos, panOffset, findFixtureAt, selectedFixtureIds, onSelectFixtures, fromScreen, importData.unit_scale_to_m, scaleCorrection, onAddLidarInstance, floorplan, calibrationPoints, viewMode])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getMousePos(e)
    
    // Track hover when not dragging (skip during floor plan tools and floorplan view)
    if (!isDragging && onHoverFixture && viewMode !== 'floorplan' && activeTool !== 'move_floorplan' && activeTool !== 'calibrate_floorplan' && activeTool !== 'crop_floorplan') {
      const fixture = findFixtureAt(pos.x, pos.y)
      onHoverFixture(fixture?.id || null)
    }
    
    if (!isDragging) return
    
    const dx = pos.x - dragStart.x
    const dy = pos.y - dragStart.y

    if (activeTool === 'move_floorplan' && floorplan && fpDragStart && fpDragStartTransform) {
      // Move floorplan image in DXF coordinate space
      const worldStart = fromScreen(fpDragStart.x, fpDragStart.y)
      const worldNow = fromScreen(pos.x, pos.y)
      const newTransform = {
        ...floorplan.transform,
        x: fpDragStartTransform.x + (worldNow.x - worldStart.x),
        y: fpDragStartTransform.y + (worldNow.y - worldStart.y)
      }
      setFloorplan(prev => prev ? { ...prev, transform: newTransform } : null)
      return
    }
    
    if (activeTool === 'pan' || (activeTool === 'select' && !selectionRect && Math.abs(dx) + Math.abs(dy) > 5)) {
      // Pan the view (Y inverted because DXF Y+ is up, screen Y+ is down)
      setPanOffset({
        x: dragStartOffset.x + dx,
        y: dragStartOffset.y - dy
      })
    } else if (activeTool === 'rectangle' && selectionRect) {
      // Update selection rectangle
      setSelectionRect({
        x: Math.min(dragStart.x, pos.x),
        y: Math.min(dragStart.y, pos.y),
        w: Math.abs(pos.x - dragStart.x),
        h: Math.abs(pos.y - dragStart.y)
      })
    } else if (activeTool === 'crop_floorplan' && fpCropStart) {
      setFpCropCurrent(pos)
    }
  }, [isDragging, getMousePos, dragStart, dragStartOffset, activeTool, selectionRect, onHoverFixture, findFixtureAt, fpCropStart, viewMode, floorplan, fpDragStart, fpDragStartTransform, fromScreen])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // Save floorplan position on drag end
    if (activeTool === 'move_floorplan' && floorplan && fpDragStart) {
      saveFloorplanTransform(floorplan.transform)
      setFpDragStart(null)
      setFpDragStartTransform(null)
      setIsDragging(false)
      return
    }

    // Finish crop rectangle
    if (activeTool === 'crop_floorplan' && fpCropStart && fpCropCurrent && floorplan) {
      const minSx = Math.min(fpCropStart.x, fpCropCurrent.x)
      const maxSx = Math.max(fpCropStart.x, fpCropCurrent.x)
      const minSy = Math.min(fpCropStart.y, fpCropCurrent.y)
      const maxSy = Math.max(fpCropStart.y, fpCropCurrent.y)
      // Only apply if rectangle is big enough
      if (maxSx - minSx > 10 && maxSy - minSy > 10) {
        const topLeftDxf = fromScreen(minSx, minSy)
        const bottomRightDxf = fromScreen(maxSx, maxSy)
        const t = floorplan.transform
        const fpDxfW = floorplan.naturalWidth * t.scaleX
        const fpDxfH = floorplan.naturalHeight * t.scaleY
        // Store as image-relative 0-1 coords so crop stays aligned on resize/move
        const dxfX = Math.min(topLeftDxf.x, bottomRightDxf.x)
        const dxfY = Math.min(topLeftDxf.y, bottomRightDxf.y)
        const dxfW = Math.abs(bottomRightDxf.x - topLeftDxf.x)
        const dxfH = Math.abs(bottomRightDxf.y - topLeftDxf.y)
        const cropRect = {
          x: (dxfX - t.x) / fpDxfW,
          y: (dxfY - t.y) / fpDxfH,
          w: dxfW / fpDxfW,
          h: dxfH / fpDxfH
        }
        setFloorplan(prev => prev ? { ...prev, cropRect } : null)
        // Persist crop to backend
        saveFloorplanTransform(floorplan.transform, floorplan.calibration, cropRect)
      }
      setFpCropStart(null)
      setFpCropCurrent(null)
      setIsDragging(false)
      return
    }
    
    if (activeTool === 'rectangle' && selectionRect && selectionRect.w > 5 && selectionRect.h > 5) {
      // Select all fixtures in rectangle
      const fixtures = findFixturesInRect(
        selectionRect.x,
        selectionRect.y,
        selectionRect.x + selectionRect.w,
        selectionRect.y + selectionRect.h
      )
      if (e.shiftKey) {
        // Add to existing selection
        const newSelection = new Set(selectedFixtureIds)
        fixtures.forEach(f => newSelection.add(f.id))
        onSelectFixtures(Array.from(newSelection))
      } else {
        onSelectFixtures(fixtures.map(f => f.id))
      }
    }
    
    setIsDragging(false)
    setSelectionRect(null)
  }, [activeTool, selectionRect, findFixturesInRect, selectedFixtureIds, onSelectFixtures, floorplan, fpDragStart, saveFloorplanTransform, fpCropStart, fpCropCurrent, fromScreen])

  // Zoom with mouse wheel - zoom towards cursor
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const pos = getMousePos(e)
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1
    const newZoom = Math.max(0.1, Math.min(20, zoom * zoomFactor))
    
    // Zoom towards mouse cursor
    const zoomRatio = newZoom / zoom
    const newPanX = pos.x - (pos.x - panOffset.x) * zoomRatio
    const newPanY = pos.y - (pos.y - panOffset.y) * zoomRatio
    
    setZoom(newZoom)
    setPanOffset({ x: newPanX, y: newPanY })
  }, [getMousePos, zoom, panOffset])

  const resetView = useCallback(() => {
    setZoom(1)
    setPanOffset({ x: 0, y: 0 })
  }, [])

  const zoomToFit = useCallback(() => {
    if (selectedFixtureIds.size === 0) {
      resetView()
      return
    }
    
    // Calculate bounds of selected fixtures
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    importData.fixtures.forEach(f => {
      if (selectedFixtureIds.has(f.id)) {
        minX = Math.min(minX, f.pose2d.x - f.footprint.w / 2)
        maxX = Math.max(maxX, f.pose2d.x + f.footprint.w / 2)
        minY = Math.min(minY, f.pose2d.y - f.footprint.d / 2)
        maxY = Math.max(maxY, f.pose2d.y + f.footprint.d / 2)
      }
    })
    
    // Calculate center and zoom
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const width = (maxX - minX) * importData.unit_scale_to_m
    const height = (maxY - minY) * importData.unit_scale_to_m
    
    const targetZoom = Math.min(
      (dimensions.width - 100) / width / viewTransform.baseScale,
      (dimensions.height - 100) / height / viewTransform.baseScale,
      5
    )
    
    // Calculate pan to center selection
    const centerScreen = toScreen(centerX, centerY)
    const targetCenterX = dimensions.width / 2
    const targetCenterY = dimensions.height / 2
    
    setZoom(targetZoom)
    setPanOffset({
      x: panOffset.x + (targetCenterX - centerScreen.x),
      y: panOffset.y + (targetCenterY - centerScreen.y)
    })
  }, [selectedFixtureIds, importData, dimensions, viewTransform.baseScale, toScreen, panOffset, resetView])

  // Grid lines
  const gridLines = useMemo(() => {
    if (!showGrid) return []
    
    const { bounds, unit_scale_to_m } = importData
    const gridSpacing = 1
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
    
    const startX = Math.floor(bounds.minX * unit_scale_to_m)
    const endX = Math.ceil(bounds.maxX * unit_scale_to_m)
    for (let x = startX; x <= endX; x += gridSpacing) {
      const screenX = toScreen(x / unit_scale_to_m, bounds.minY).x
      lines.push({ x1: screenX, y1: 0, x2: screenX, y2: dimensions.height })
    }
    
    const startY = Math.floor(bounds.minY * unit_scale_to_m)
    const endY = Math.ceil(bounds.maxY * unit_scale_to_m)
    for (let y = startY; y <= endY; y += gridSpacing) {
      const screenY = toScreen(bounds.minX, y / unit_scale_to_m).y
      lines.push({ x1: 0, y1: screenY, x2: dimensions.width, y2: screenY })
    }
    
    return lines
  }, [showGrid, importData, dimensions, toScreen])

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* View Mode Tabs */}
      <div className="h-8 border-b border-gray-700 flex items-center px-3 gap-0.5 bg-gray-800/80">
        <input ref={floorplanInputRef} type="file" accept="image/png,image/jpeg,image/gif,image/bmp,image/webp,image/svg+xml" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleFloorplanUpload(file); e.target.value = '' }} />
        {(['dwg', 'floorplan', 'overlay'] as ViewMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => { setViewMode(mode); setActiveTool('select') }}
            className={`px-3 py-1 text-xs font-medium rounded-t transition-colors flex items-center gap-1 ${viewMode === mode ? 'bg-gray-900 text-white border-t border-x border-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
          >
            {mode === 'dwg' ? 'DWG' : mode === 'floorplan' ? 'Floor Plan' : 'Overlay'}
            {mode === 'floorplan' && floorplan && <span className="w-1.5 h-1.5 rounded-full bg-orange-400" />}
            {mode === 'floorplan' && floorplan?.cropRect && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
          </button>
        ))}
        <div className="flex-1" />
        {/* Floor plan upload button - available from any tab when no floor plan exists */}
        {!floorplan && (
          <button onClick={() => floorplanInputRef.current?.click()} disabled={isUploadingFloorplan} className="px-2 py-1 rounded text-xs flex items-center gap-1 bg-orange-600/80 hover:bg-orange-500 text-white transition-colors">
            <ImagePlus className="w-3 h-3" />
            {isUploadingFloorplan ? 'Uploading...' : 'Upload Floor Plan'}
          </button>
        )}
        {/* Floor plan info when loaded */}
        {floorplan && viewMode === 'dwg' && (
          <span className="text-[10px] text-gray-500">{floorplan.original_filename}</span>
        )}
        {floorplan?.cropRect && viewMode === 'overlay' && (
          <span className="text-[10px] text-purple-400 flex items-center gap-1"><Scissors className="w-3 h-3" />Cropped</span>
        )}
      </div>

      {/* Toolbar */}
      <div className="h-10 border-b border-border-dark flex items-center px-3 gap-1 bg-panel-bg">
        {(viewMode === 'dwg' || viewMode === 'overlay') && (<>
        <span className="text-xs text-gray-400 mr-2">Tools:</span>
        <button onClick={() => setActiveTool('select')} className={`p-1.5 rounded transition-colors ${activeTool === 'select' ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`} title="Select"><MousePointer2 className="w-4 h-4" /></button>
        <button onClick={() => setActiveTool('rectangle')} className={`p-1.5 rounded transition-colors ${activeTool === 'rectangle' ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`} title="Rectangle Select"><Square className="w-4 h-4" /></button>
        <button onClick={() => setActiveTool('pan')} className={`p-1.5 rounded transition-colors ${activeTool === 'pan' ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`} title="Pan"><Move className="w-4 h-4" /></button>
        <div className="w-px h-5 bg-gray-700 mx-2" />
        <button onClick={() => setShowGrid(!showGrid)} className={`p-1.5 rounded transition-colors ${showGrid ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`} title="Toggle Grid"><Grid className="w-4 h-4" /></button>
        </>)}
        {/* Floor Plan Controls - shown in floorplan and overlay modes */}
        {(viewMode === 'floorplan' || viewMode === 'overlay') && floorplan && (<>
            {viewMode === 'floorplan' && (<>
              <button onClick={() => setActiveTool('pan')} className={`p-1.5 rounded transition-colors ${activeTool === 'pan' ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`} title="Pan"><Move className="w-4 h-4" /></button>
              <div className="w-px h-5 bg-gray-700 mx-1" />
            </>)}
            {viewMode === 'overlay' && <div className="w-px h-5 bg-gray-700 mx-1" />}
            <button onClick={() => setActiveTool(activeTool === 'move_floorplan' ? 'select' : 'move_floorplan')} className={`p-1.5 rounded text-xs transition-colors ${activeTool === 'move_floorplan' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`} title="Move floor plan">
              <Move className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => { setCalibrationPoints([]); setActiveTool(activeTool === 'calibrate_floorplan' ? 'select' : 'calibrate_floorplan') }} className={`p-1.5 rounded text-xs transition-colors ${activeTool === 'calibrate_floorplan' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`} title="Calibrate scale">
              <Ruler className="w-3.5 h-3.5" />
            </button>
            {viewMode === 'floorplan' && (
              <button onClick={() => setActiveTool(activeTool === 'crop_floorplan' ? 'select' : 'crop_floorplan')} className={`p-1.5 rounded text-xs transition-colors ${activeTool === 'crop_floorplan' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`} title="Crop: draw rectangle to select portion for overlay">
                <Scissors className="w-3.5 h-3.5" />
              </button>
            )}
            {viewMode === 'floorplan' && floorplan.cropRect && (
              <button onClick={() => { setFloorplan(prev => prev ? { ...prev, cropRect: null } : null); saveFloorplanTransform(floorplan.transform, floorplan.calibration, null) }} className="p-1 rounded text-xs text-purple-400 hover:text-purple-300 hover:bg-gray-700" title="Clear crop">
                <X className="w-3 h-3" />
              </button>
            )}
            {/* Floor plan resize: scale around center so image stays in view */}
            <div className="flex items-center border border-gray-600 rounded overflow-hidden">
              <button
                onClick={() => {
                  const factor = 0.9
                  const t = floorplan.transform
                  const newScaleX = t.scaleX * factor
                  const newScaleY = t.scaleY * factor
                  // Adjust origin so the image center stays fixed
                  const newX = t.x + floorplan.naturalWidth * (t.scaleX - newScaleX) / 2
                  const newY = t.y + floorplan.naturalHeight * (t.scaleY - newScaleY) / 2
                  const newTransform = { ...t, scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY }
                  setFloorplan(prev => prev ? { ...prev, transform: newTransform } : null)
                  saveFloorplanTransform(newTransform)
                }}
                className="px-1.5 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border-r border-gray-600"
                title="Shrink floor plan (−10%)"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <span className="px-1.5 py-1 text-[10px] text-orange-400 font-mono min-w-[36px] text-center bg-gray-800" title="Floor plan scale">
                {(floorplan.transform.scaleX * 100).toFixed(0)}%
              </span>
              <button
                onClick={() => {
                  const factor = 1.1
                  const t = floorplan.transform
                  const newScaleX = t.scaleX * factor
                  const newScaleY = t.scaleY * factor
                  const newX = t.x + floorplan.naturalWidth * (t.scaleX - newScaleX) / 2
                  const newY = t.y + floorplan.naturalHeight * (t.scaleY - newScaleY) / 2
                  const newTransform = { ...t, scaleX: newScaleX, scaleY: newScaleY, x: newX, y: newY }
                  setFloorplan(prev => prev ? { ...prev, transform: newTransform } : null)
                  saveFloorplanTransform(newTransform)
                }}
                className="px-1.5 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors border-l border-gray-600"
                title="Enlarge floor plan (+10%)"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center gap-1" title="Floor plan opacity">
              <Eye className="w-3 h-3 text-gray-500" />
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={floorplan.transform.opacity}
                onChange={(e) => {
                  const opacity = Number(e.target.value)
                  setFloorplan(prev => prev ? { ...prev, transform: { ...prev.transform, opacity } } : null)
                  saveFloorplanTransform({ ...floorplan.transform, opacity })
                }}
                className="w-16 h-1 accent-orange-500"
              />
            </div>
            <button
              onClick={() => {
                const newRotation = (floorplan.transform.rotation + 90) % 360
                const newTransform = { ...floorplan.transform, rotation: newRotation }
                setFloorplan(prev => prev ? { ...prev, transform: newTransform } : null)
                saveFloorplanTransform(newTransform)
              }}
              className="p-1.5 rounded text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
              title="Rotate floor plan 90°"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => {
                if (window.confirm('Remove floor plan image?')) handleDeleteFloorplan()
              }}
              className="px-2 py-1 rounded text-xs flex items-center gap-1 bg-red-900/40 text-red-400 hover:bg-red-800/60 hover:text-red-300 transition-colors"
              title="Delete floor plan image"
            >
              <Trash2 className="w-3 h-3" />
              Delete
            </button>
        </>)}
        {viewMode === 'floorplan' && !floorplan && (
          <span className="text-xs text-gray-500 italic">No floor plan uploaded</span>
        )}
        
        {lidarMode && (
          <div className="relative">
            <button
              onClick={() => setShowLayersPanel(!showLayersPanel)}
              className={`p-1.5 rounded transition-colors ${showLayersPanel ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
              title="Toggle Layers"
            >
              <Layers className="w-4 h-4" />
            </button>
            {showLayersPanel && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-2 min-w-[180px] z-50">
                <div className="text-xs font-medium text-gray-400 mb-1 px-1">Layers</div>
                <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-700 cursor-pointer text-xs">
                  <input type="checkbox" checked={layerVisibility.base} onChange={(e) => setLayerVisibility(prev => ({ ...prev, base: e.target.checked }))} className="rounded border-gray-600 bg-gray-700 text-blue-500 w-3 h-3" />
                  <span className="text-gray-300">Base Fixtures</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-700 cursor-pointer text-xs">
                  <input type="checkbox" checked={layerVisibility.floorplan} onChange={(e) => setLayerVisibility(prev => ({ ...prev, floorplan: e.target.checked }))} className="rounded border-gray-600 bg-gray-700 text-orange-500 w-3 h-3" />
                  <span className="text-gray-300">Floor Plan Image</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-700 cursor-pointer text-xs">
                  <input type="checkbox" checked={layerVisibility.roi} onChange={(e) => setLayerVisibility(prev => ({ ...prev, roi: e.target.checked }))} className="rounded border-gray-600 bg-gray-700 text-amber-500 w-3 h-3" />
                  <span className="text-gray-300">ROI Polygon</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-700 cursor-pointer text-xs">
                  <input type="checkbox" checked={layerVisibility.lidarDevices} onChange={(e) => setLayerVisibility(prev => ({ ...prev, lidarDevices: e.target.checked }))} className="rounded border-gray-600 bg-gray-700 text-green-500 w-3 h-3" />
                  <span className="text-gray-300">LiDAR Devices</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-700 cursor-pointer text-xs">
                  <input type="checkbox" checked={layerVisibility.coverageCircles} onChange={(e) => setLayerVisibility(prev => ({ ...prev, coverageCircles: e.target.checked }))} className="rounded border-gray-600 bg-gray-700 text-green-500 w-3 h-3" />
                  <span className="text-gray-300">Coverage Circles</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-700 cursor-pointer text-xs">
                  <input type="checkbox" checked={layerVisibility.coverageHeatmap} onChange={(e) => setLayerVisibility(prev => ({ ...prev, coverageHeatmap: e.target.checked }))} className="rounded border-gray-600 bg-gray-700 text-cyan-500 w-3 h-3" />
                  <span className="text-gray-300">Coverage Heatmap</span>
                </label>
                <label className="flex items-center gap-2 py-1 px-1 rounded hover:bg-gray-700 cursor-pointer text-xs">
                  <input type="checkbox" checked={layerVisibility.overlapCells} onChange={(e) => setLayerVisibility(prev => ({ ...prev, overlapCells: e.target.checked }))} className="rounded border-gray-600 bg-gray-700 text-purple-500 w-3 h-3" />
                  <span className="text-gray-300">Overlap Cells</span>
                </label>
              </div>
            )}
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={zoomToFit}
          className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
          title="Zoom to Selection"
        >
          <Focus className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom(prev => Math.min(20, prev * 1.2))}
          className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom(prev => Math.max(0.1, prev * 0.8))}
          className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={resetView}
          className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
          title="Reset View"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-500 ml-2">
          {Math.round(zoom * 100)}%
        </span>
        <div className="w-px h-5 bg-gray-700 mx-2" />
        <button
          onClick={saveView}
          className={`p-1.5 rounded transition-colors flex items-center gap-1 ${
            justSaved 
              ? 'bg-green-600 text-white' 
              : hasSavedView 
                ? 'bg-green-900/50 text-green-400 hover:bg-green-600 hover:text-white' 
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
          title="Save current view (zoom & pan) - click again to update"
        >
          <Save className="w-4 h-4" />
          {justSaved && <span className="text-xs">Saved!</span>}
        </button>
        {hasSavedView && (
          <button
            onClick={loadSavedView}
            className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition-colors"
            title="Restore saved view"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
        
        {/* LiDAR Mode Toggle */}
        {onToggleLidarMode && (
          <>
            <div className="w-px h-5 bg-gray-700 mx-2" />
            <button
              onClick={onToggleLidarMode}
              disabled={!lidarEnabled}
              className={`px-2 py-1 rounded transition-colors flex items-center gap-1.5 text-xs ${
                lidarMode 
                  ? 'bg-blue-600 text-white' 
                  : lidarEnabled
                    ? 'text-gray-400 hover:text-white hover:bg-gray-700'
                    : 'text-gray-600 cursor-not-allowed'
              }`}
              title={lidarEnabled ? 'Toggle LiDAR Planning Mode' : 'Generate 3D layout first to enable LiDAR mode'}
            >
              <Radio className="w-4 h-4" />
              LiDAR
            </button>
          </>
        )}
      </div>
      
      {/* LiDAR Control Panel (shown when lidarMode is on, hidden in floorplan view) */}
      {lidarMode && viewMode !== 'floorplan' && (
        <div className="h-12 border-b border-border-dark flex items-center px-3 gap-3 bg-gray-800/50">
          {/* ROI Drawing Section */}
          <span className="text-xs text-gray-400">ROI:</span>
          {activeTool === 'draw_roi' ? (
            <>
              <span className="text-xs text-amber-400">{roiVertices.length} pts</span>
              <button
                onClick={() => {
                  if (roiVertices.length >= 3) {
                    setLidarRoi([...roiVertices])
                  }
                  setRoiVertices([])
                  setActiveTool('select')
                }}
                disabled={roiVertices.length < 3}
                className="px-2 py-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white text-xs rounded flex items-center gap-1"
                title="Finish drawing (need at least 3 points)"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  setRoiVertices([])
                  setActiveTool('select')
                }}
                className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded flex items-center gap-1"
                title="Cancel drawing"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setRoiVertices([])
                  setActiveTool('draw_roi')
                }}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
                  lidarRoi ? 'bg-amber-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
                title="Draw region of interest for LiDAR coverage"
              >
                <Pencil className="w-3 h-3" />
                {lidarRoi ? 'Redraw' : 'Draw'}
              </button>
              {lidarRoi && (
                <button
                  onClick={() => setLidarRoi(null)}
                  className="px-1.5 py-1 text-red-400 hover:text-red-300 text-xs"
                  title="Clear ROI"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </>
          )}
          
          <div className="w-px h-5 bg-gray-600" />
          
          {/* Model Selection */}
          <span className="text-xs text-gray-400">Model:</span>
          {lidarModels.length > 0 ? (
            <select
              value={selectedLidarModelId || ''}
              onChange={(e) => onSelectLidarModel?.(e.target.value || null)}
              className="bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600"
            >
              {lidarModels.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.range_m}m)</option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-gray-500 italic">No models</span>
          )}
          <button
            onClick={openCreateModel}
            className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-700"
            title="Add New LiDAR Model"
          >
            <Plus className="w-4 h-4" />
          </button>
          {selectedLidarModelId && lidarModels.find(m => m.id === selectedLidarModelId) && (
            <button
              onClick={() => {
                console.log('[Model Settings] Pencil clicked, selectedLidarModelId:', selectedLidarModelId)
                console.log('[Model Settings] Available models:', lidarModels)
                const model = lidarModels.find(m => m.id === selectedLidarModelId)
                console.log('[Model Settings] Found model:', model)
                if (model) openEditModel(model)
              }}
              className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-700"
              title="Edit Selected Model Settings"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          
          <button
            onClick={() => setActiveTool('place_lidar')}
            className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${
              activeTool === 'place_lidar' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            <Radio className="w-3 h-3" />
            Place
          </button>
          
          <div className="w-px h-5 bg-gray-600" />
          
          <button
            onClick={() => setShowAutoplaceSettings(true)}
            className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-700"
            title="Configure auto-placement settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => setShowDebugPanel(true)}
            disabled={!lidarRoi || lidarRoi.length < 3}
            className="p-1 text-gray-400 hover:text-yellow-400 disabled:text-gray-600 rounded hover:bg-gray-700"
            title="Debug LiDAR placement (view measurements)"
          >
            <Bug className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => {
              if (lidarRoi && onAutoPlace) {
                // Convert DXF units to meters for API (with scale correction)
                const effectiveScale = importData.unit_scale_to_m * scaleCorrection
                const roiInMeters = lidarRoi.map(v => ({
                  x: v.x * effectiveScale,
                  z: v.z * effectiveScale
                }))
                
                // Debug logging
                console.log('=== AUTO-PLACE DEBUG ===')
                console.log('unit_scale_to_m:', importData.unit_scale_to_m, 'x scaleCorrection:', scaleCorrection, '= effectiveScale:', effectiveScale)
                console.log('ROI in DXF units:', lidarRoi)
                console.log('ROI in meters:', roiInMeters)
                console.log('ROI bounds (m):', {
                  minX: Math.min(...roiInMeters.map(v => v.x)),
                  maxX: Math.max(...roiInMeters.map(v => v.x)),
                  minZ: Math.min(...roiInMeters.map(v => v.z)),
                  maxZ: Math.max(...roiInMeters.map(v => v.z)),
                  width: Math.max(...roiInMeters.map(v => v.x)) - Math.min(...roiInMeters.map(v => v.x)),
                  height: Math.max(...roiInMeters.map(v => v.z)) - Math.min(...roiInMeters.map(v => v.z))
                })
                console.log('Selected model:', lidarModels.find(m => m.id === selectedLidarModelId))
                
                onAutoPlace(roiInMeters, {
                  overlap_mode: autoplaceOverlapMode,
                  k_required: autoplaceKRequired,
                  overlap_target_pct: autoplaceOverlapTargetPct,
                  los_enabled: autoplaceLosEnabled,
                  sample_spacing_m: autoplaceSampleSpacing,
                  mount_y_m: autoplaceMountHeight
                })
              }
            }}
            disabled={isSimulating || !lidarRoi}
            className="px-2 py-1 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white text-xs rounded flex items-center gap-1"
            title={!lidarRoi ? 'Draw ROI first' : `Auto-place LiDARs (${autoplaceOverlapMode}, k=${autoplaceKRequired})`}
          >
            <Wand2 className="w-3 h-3" />
            Auto-Place
          </button>
          
          <button
            onClick={onRunSimulation}
            disabled={isSimulating || lidarInstances.length === 0}
            className="px-2 py-1 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 text-white text-xs rounded flex items-center gap-1"
          >
            <Play className="w-3 h-3" />
            {isSimulating ? 'Simulating...' : 'Simulate'}
          </button>
          
          {simulationResult && (
            <span className="text-xs text-green-400 ml-2">
              Coverage: {simulationResult.coverage_percent.toFixed(1)}%
            </span>
          )}
          
          <div className="w-px h-5 bg-gray-600" />
          
          {/* Export for Algorithm Provider */}
          <button
            onClick={() => {
              if (!lidarRoi || lidarRoi.length < 3 || lidarInstances.length === 0) return
              
              const effectiveScale = importData.unit_scale_to_m * scaleCorrection
              
              // Convert ROI to meters
              const roiMeters = lidarRoi.map(v => ({
                x: v.x * effectiveScale,
                z: v.z * effectiveScale
              }))
              
              // Calculate ROI SW corner (min X, min Z)
              const roiSwX = Math.min(...roiMeters.map(v => v.x))
              const roiSwZ = Math.min(...roiMeters.map(v => v.z))
              const roiNeX = Math.max(...roiMeters.map(v => v.x))
              const roiNeZ = Math.max(...roiMeters.map(v => v.z))
              const venueWidth = roiNeX - roiSwX
              const venueDepth = roiNeZ - roiSwZ
              
              // ROI-relative vertices
              const roiVerticesRelative = roiMeters.map(v => ({
                x: parseFloat((v.x - roiSwX).toFixed(3)),
                z: parseFloat((v.z - roiSwZ).toFixed(3))
              }))
              
              // Filter mapped fixtures inside ROI using point-in-polygon
              const roiPolygon = roiMeters.map(v => ({ x: v.x, y: v.z }))
              const fixturesInRoi = importData.fixtures
                .filter(f => !!mappings[f.group_id]) // Only mapped fixtures
                .filter(f => {
                  const fx = f.pose2d.x * effectiveScale
                  const fz = f.pose2d.y * effectiveScale
                  return pointInPolygon(fx, fz, roiPolygon)
                })
                .map((f, idx) => {
                  const mapping = mappings[f.group_id]
                  const fx = f.pose2d.x * effectiveScale - roiSwX
                  const fz = f.pose2d.y * effectiveScale - roiSwZ
                  const wM = f.footprint.w * effectiveScale
                  const dM = f.footprint.d * effectiveScale
                  return {
                    id: f.id,
                    type: mapping?.type || 'unknown',
                    name: `${mapping?.type || 'fixture'}-${String(idx + 1).padStart(3, '0')}`,
                    position: {
                      x: parseFloat(fx.toFixed(3)),
                      y: 0,
                      z: parseFloat(fz.toFixed(3))
                    },
                    rotation: { y_deg: parseFloat((f.pose2d.rot_deg || 0).toFixed(1)) },
                    dimensions: {
                      width_m: parseFloat(wM.toFixed(3)),
                      depth_m: parseFloat(dM.toFixed(3))
                    },
                    layer: f.source?.layer || '',
                    block: f.source?.block || ''
                  }
                })
              
              // LiDAR instances in ROI-relative coords
              const lidarsExport = lidarInstances.map((inst, idx) => {
                const model = lidarModels.find(m => m.id === inst.model_id)
                return {
                  lidarId: `lidar-${String(idx + 1).padStart(3, '0')}`,
                  model: {
                    name: model?.name || 'Unknown',
                    hfov_deg: model?.hfov_deg || 360,
                    vfov_deg: model?.vfov_deg || 30,
                    range_m: model?.range_m || inst.range_m || 10,
                    dome_mode: model?.dome_mode ?? true
                  },
                  extrinsics: {
                    x_m: parseFloat((inst.x_m - roiSwX).toFixed(3)),
                    y_m: parseFloat((inst.mount_y_m ?? inst.y_m ?? 3).toFixed(2)),
                    z_m: parseFloat((inst.z_m - roiSwZ).toFixed(3)),
                    yaw_deg: parseFloat((inst.yaw_deg || 0).toFixed(1)),
                    pitch_deg: 0,
                    roll_deg: 0
                  }
                }
              })
              
              const exportConfig = {
                exportedAt: new Date().toISOString(),
                venueId: importData.import_id,
                venueName: importData.filename?.replace(/\.[^.]+$/, '') || 'Unnamed Venue',
                layoutVersionId: layoutVersionId || '',
                coordinateFrame: {
                  origin: 'ROI SW corner at floor level',
                  roiOffset: { x: parseFloat(roiSwX.toFixed(3)), z: parseFloat(roiSwZ.toFixed(3)) },
                  axis: 'X-East, Y-Up, Z-North',
                  units: 'meters'
                },
                roiVertices: roiVerticesRelative,
                venueBounds: {
                  width: parseFloat(venueWidth.toFixed(3)),
                  depth: parseFloat(venueDepth.toFixed(3)),
                  minX: 0,
                  maxX: parseFloat(venueWidth.toFixed(3)),
                  minZ: 0,
                  maxZ: parseFloat(venueDepth.toFixed(3)),
                  floorY: 0,
                  ceilingY: 4.5
                },
                fixtures: fixturesInRoi,
                lidars: lidarsExport,
                operationalParams: {
                  groundPlaneY: 0,
                  ceilingY: 4.5,
                  minDetectionHeight: 0.3,
                  maxDetectionHeight: 2.2,
                  publishRateHz: 10
                },
                notes: {
                  coordinateTransform: 'All coordinates are relative to ROI SW corner. Original DWG coordinates can be recovered by adding roiOffset.',
                  fixtureFilter: 'Only mapped fixtures inside the ROI are included.',
                  lidarIds: 'Auto-generated sequential IDs (offline handoff). Replace with commissioned IDs after edge pairing.'
                }
              }
              
              // Download as JSON
              const blob = new Blob([JSON.stringify(exportConfig, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `algo-config-${importData.filename?.replace(/\.[^.]+$/, '') || 'venue'}-${new Date().toISOString().split('T')[0]}.json`
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              URL.revokeObjectURL(url)
            }}
            disabled={!lidarRoi || lidarRoi.length < 3 || lidarInstances.length === 0}
            className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-600 text-white text-xs rounded flex items-center gap-1"
            title={
              !lidarRoi ? 'Draw ROI first' : 
              lidarInstances.length === 0 ? 'Place LiDARs first' : 
              'Export JSON config for algorithm provider'
            }
          >
            <FileDown className="w-3 h-3" />
            Export Config
          </button>
          
          <div className="flex-1" />
          
          <span className="text-xs text-gray-400">
            {lidarInstances.length} LiDAR{lidarInstances.length !== 1 ? 's' : ''}
          </span>
          
          {selectedLidarInstanceId && (() => {
            const selectedInstance = lidarInstances.find(i => i.id === selectedLidarInstanceId)
            return (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Height:</span>
                <input
                  type="number"
                  min="1"
                  max="10"
                  step="0.5"
                  value={selectedInstance?.mount_y_m ?? selectedInstance?.y_m ?? 3}
                  onChange={(e) => onUpdateLidarInstance?.(selectedLidarInstanceId, { mount_y_m: Number(e.target.value) })}
                  className="w-16 bg-gray-700 text-white text-xs rounded px-2 py-1 border border-gray-600"
                />
                <span className="text-xs text-gray-500">m</span>
                <button
                  onClick={() => onDeleteLidarInstance?.(selectedLidarInstanceId)}
                  className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </button>
              </div>
            )
          })()}
          
          {lidarInstances.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm(`Delete all ${lidarInstances.length} LiDAR instances?`)) {
                  onDeleteAllLidarInstances?.()
                }
              }}
              className="px-2 py-1 bg-red-800 hover:bg-red-700 text-white text-xs rounded flex items-center gap-1"
              title="Delete all LiDAR instances"
            >
              <Trash2 className="w-3 h-3" />
              Clear All ({lidarInstances.length})
            </button>
          )}
        </div>
      )}

      
      {/* Autoplace Settings Modal */}
      {showAutoplaceSettings && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-96 shadow-xl border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-medium flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Auto-Place Settings
              </h3>
              <button
                onClick={() => setShowAutoplaceSettings(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="space-y-4">
              {/* Scale Correction */}
              <div className="bg-yellow-900/30 rounded p-2 border border-yellow-700/50">
                <label className="text-xs text-yellow-400 block mb-1 font-medium">⚠️ Scale Correction</label>
                <div className="flex items-center gap-2">
                  <select
                    value={scaleCorrection}
                    onChange={(e) => setScaleCorrection(Number(e.target.value))}
                    className="flex-1 bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                  >
                    <option value={1}>1x - mm (detected)</option>
                    <option value={10}>10x - cm (if DWG is in centimeters)</option>
                    <option value={1000}>1000x - m (if DWG is in meters)</option>
                    <option value={25.4}>25.4x - inches to mm</option>
                  </select>
                </div>
                <p className="text-xs text-yellow-600 mt-1">
                  Current: 1 DXF unit = {(importData.unit_scale_to_m * scaleCorrection * 1000).toFixed(1)}mm = {(importData.unit_scale_to_m * scaleCorrection).toFixed(4)}m
                </p>
              </div>
              
              {/* Overlap Mode */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Overlap Mode</label>
                <select
                  value={autoplaceOverlapMode}
                  onChange={(e) => setAutoplaceOverlapMode(e.target.value as 'everywhere' | 'critical_only' | 'percent_target')}
                  className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                >
                  <option value="everywhere">Everywhere (k-coverage for all points)</option>
                  <option value="critical_only">Critical Only (k-coverage for critical zones)</option>
                  <option value="percent_target">Percent Target (target % of points k-covered)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  {autoplaceOverlapMode === 'everywhere' && 'All floor points will have k-coverage overlap'}
                  {autoplaceOverlapMode === 'critical_only' && 'Only critical zones get k-coverage; rest gets 1-coverage'}
                  {autoplaceOverlapMode === 'percent_target' && 'Achieve target % of k-coverage across the area'}
                </p>
              </div>
              
              {/* K-Required */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">K-Coverage Required</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1"
                    max="4"
                    value={autoplaceKRequired}
                    onChange={(e) => setAutoplaceKRequired(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-white text-sm w-8 text-center">{autoplaceKRequired}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Each point must be seen by at least {autoplaceKRequired} LiDAR{autoplaceKRequired > 1 ? 's' : ''}
                </p>
              </div>
              
              {/* Overlap Target (only for percent_target mode) */}
              {autoplaceOverlapMode === 'percent_target' && (
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Overlap Target %</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="50"
                      max="100"
                      step="5"
                      value={autoplaceOverlapTargetPct * 100}
                      onChange={(e) => setAutoplaceOverlapTargetPct(Number(e.target.value) / 100)}
                      className="flex-1"
                    />
                    <span className="text-white text-sm w-12 text-center">{(autoplaceOverlapTargetPct * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}
              
              {/* Mount Height */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Mount Height (m)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="2.0"
                    max="6.0"
                    step="0.5"
                    value={autoplaceMountHeight}
                    onChange={(e) => setAutoplaceMountHeight(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-white text-sm w-12 text-center">{autoplaceMountHeight.toFixed(1)}m</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Affects effective floor coverage radius via VFOV
                </p>
              </div>
              
              {/* Sample Spacing */}
              <div>
                <label className="text-xs text-gray-400 block mb-1">Sample Spacing (m)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="0.25"
                    max="2.0"
                    step="0.25"
                    value={autoplaceSampleSpacing}
                    onChange={(e) => setAutoplaceSampleSpacing(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-white text-sm w-12 text-center">{autoplaceSampleSpacing.toFixed(2)}m</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Smaller = more accurate but slower ({(1 / (autoplaceSampleSpacing * autoplaceSampleSpacing)).toFixed(0)} pts/m²)
                </p>
              </div>
              
              {/* LOS Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs text-gray-400 block">Line-of-Sight Occlusion</label>
                  <p className="text-xs text-gray-500">Account for obstacles blocking LiDAR view</p>
                </div>
                <button
                  onClick={() => setAutoplaceLosEnabled(!autoplaceLosEnabled)}
                  className={`w-12 h-6 rounded-full transition-colors relative ${
                    autoplaceLosEnabled ? 'bg-blue-600' : 'bg-gray-600'
                  }`}
                >
                  <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform ${
                    autoplaceLosEnabled ? 'translate-x-6' : 'translate-x-0.5'
                  }`} />
                </button>
              </div>
              
              <div className="pt-2 border-t border-gray-700">
                <button
                  onClick={() => setShowAutoplaceSettings(false)}
                  className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LiDAR Model Settings Modal */}
      {showModelSettings && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-96 shadow-xl border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-medium flex items-center gap-2">
                <Settings className="w-4 h-4" />
                {editingModelId ? 'Edit LiDAR Model' : 'Add LiDAR Model'}
              </h3>
              <button
                onClick={() => setShowModelSettings(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            {/* Existing Models List (only in create mode) */}
            {!editingModelId && lidarModels.length > 0 && (
              <div className="mb-4 pb-3 border-b border-gray-700">
                <label className="text-xs text-gray-400 block mb-2">Existing Models (click to edit)</label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {lidarModels.map(m => (
                    <button
                      key={m.id}
                      onClick={() => openEditModel(m)}
                      className="w-full text-left px-2 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-sm flex justify-between items-center"
                    >
                      <span className="text-white">{m.name}</span>
                      <span className="text-gray-400 text-xs">
                        {m.range_m}m | {m.hfov_deg}°×{m.vfov_deg}°
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Model Name</label>
                <input
                  type="text"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                  placeholder="e.g. Ouster OS1-64"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">H-FOV (deg)</label>
                  <input
                    type="number"
                    value={newModelHfov}
                    onChange={(e) => setNewModelHfov(Number(e.target.value))}
                    className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    min="1"
                    max="360"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">V-FOV (deg)</label>
                  <input
                    type="number"
                    value={newModelVfov}
                    onChange={(e) => setNewModelVfov(Number(e.target.value))}
                    className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    min="1"
                    max="180"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Range (m)</label>
                  <input
                    type="number"
                    value={newModelRange}
                    onChange={(e) => setNewModelRange(Number(e.target.value))}
                    className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    min="1"
                    max="200"
                    step="0.5"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Min Overlap (m)</label>
                  <input
                    type="number"
                    value={newModelOverlap}
                    onChange={(e) => setNewModelOverlap(Number(e.target.value))}
                    className="w-full bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                    min="0.5"
                    max="10"
                    step="0.5"
                    title="Minimum overlap between LiDARs for tracking continuity"
                  />
                </div>
              </div>
              
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => {
                    if (editingModelId) {
                      // Go back to create mode
                      setEditingModelId(null)
                      setNewModelName('New LiDAR')
                      setNewModelHfov(360)
                      setNewModelVfov(30)
                      setNewModelRange(15)
                      setNewModelOverlap(2)
                    } else {
                      setShowModelSettings(false)
                    }
                  }}
                  className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded"
                >
                  {editingModelId ? 'Back' : 'Cancel'}
                </button>
                <button
                  onClick={async () => {
                    if (!newModelName.trim()) return
                    setIsCreatingModel(true)
                    try {
                                            
                      if (editingModelId) {
                        // UPDATE existing model
                        const res = await fetch(`${API_BASE}/api/lidar/models/${editingModelId}`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: newModelName,
                            hfov_deg: newModelHfov,
                            vfov_deg: newModelVfov,
                            range_m: newModelRange,
                            dome_mode: true,
                            notes: { min_overlap_m: newModelOverlap }
                          })
                        })
                        if (res.ok) {
                          console.log('[Model Settings] Model updated successfully')
                          setShowModelSettings(false)
                          // Refresh models list without full page reload
                          await onRefreshModels?.()
                        } else {
                          console.error('Failed to update model:', await res.text())
                        }
                      } else {
                        // CREATE new model
                        const res = await fetch(`${API_BASE}/api/lidar/models`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            name: newModelName,
                            hfov_deg: newModelHfov,
                            vfov_deg: newModelVfov,
                            range_m: newModelRange,
                            dome_mode: true,
                            notes: { min_overlap_m: newModelOverlap }
                          })
                        })
                        if (res.ok) {
                          const model = await res.json()
                          console.log('[Model Settings] Model created successfully:', model.id)
                          onSelectLidarModel?.(model.id)
                          setShowModelSettings(false)
                          // Refresh models list without full page reload
                          await onRefreshModels?.()
                        }
                      }
                    } catch (err) {
                      console.error('Failed to save model:', err)
                    } finally {
                      setIsCreatingModel(false)
                    }
                  }}
                  disabled={isCreatingModel || !newModelName.trim()}
                  className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm rounded"
                >
                  {isCreatingModel ? 'Saving...' : editingModelId ? 'Update Model' : 'Create Model'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden relative ${activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : (activeTool === 'rectangle' || activeTool === 'place_lidar' || activeTool === 'draw_roi' || activeTool === 'calibrate_floorplan' || activeTool === 'crop_floorplan') ? 'cursor-crosshair' : activeTool === 'move_floorplan' ? 'cursor-move' : 'cursor-default'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Empty state for Floor Plan / Overlay when no floor plan uploaded */}
        {(viewMode === 'floorplan' && !floorplan) && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="text-center pointer-events-auto">
              <ImageIcon className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm mb-2">No floor plan uploaded</p>
              <button onClick={() => floorplanInputRef.current?.click()} disabled={isUploadingFloorplan} className="px-4 py-2 rounded-lg text-sm bg-orange-600 hover:bg-orange-500 text-white transition-colors flex items-center gap-2 mx-auto">
                <ImagePlus className="w-4 h-4" />
                {isUploadingFloorplan ? 'Uploading...' : 'Upload Floor Plan Image'}
              </button>
              <p className="text-gray-600 text-xs mt-2">PNG, JPG, SVG, WebP supported</p>
            </div>
          </div>
        )}
        {(viewMode === 'overlay' && !floorplan) && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="text-center pointer-events-auto">
              <Layers className="w-12 h-12 text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm mb-2">Upload a floor plan to overlay on the DWG</p>
              <button onClick={() => floorplanInputRef.current?.click()} disabled={isUploadingFloorplan} className="px-4 py-2 rounded-lg text-sm bg-orange-600 hover:bg-orange-500 text-white transition-colors flex items-center gap-2 mx-auto">
                <ImagePlus className="w-4 h-4" />
                {isUploadingFloorplan ? 'Uploading...' : 'Upload Floor Plan'}
              </button>
            </div>
          </div>
        )}
        <svg
          width={dimensions.width}
          height={dimensions.height}
          className="bg-gray-950"
        >
          {/* Grid */}
          {gridLines.map((line, i) => (
            <line
              key={`grid-${i}`}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="#1f2937"
              strokeWidth={0.5}
            />
          ))}

          {/* Floor Plan Image - in floorplan mode, render BEFORE fixtures (no clipping needed) */}
          {viewMode === 'floorplan' && layerVisibility.floorplan && floorplan && (() => {
            const t = floorplan.transform
            const topLeft = toScreen(t.x, t.y + floorplan.naturalHeight * t.scaleY)
            const bottomRight = toScreen(t.x + floorplan.naturalWidth * t.scaleX, t.y)
            const imgW = Math.abs(bottomRight.x - topLeft.x)
            const imgH = Math.abs(bottomRight.y - topLeft.y)
            const cx = (topLeft.x + bottomRight.x) / 2
            const cy = (topLeft.y + bottomRight.y) / 2
            return (
              <g>
                <image
                  href={floorplan.imageUrl}
                  x={topLeft.x} y={topLeft.y} width={imgW} height={imgH}
                  opacity={t.opacity}
                  transform={t.rotation ? `rotate(${-t.rotation}, ${cx}, ${cy})` : undefined}
                  preserveAspectRatio="none"
                  style={{ pointerEvents: (activeTool === 'move_floorplan' || activeTool === 'calibrate_floorplan' || activeTool === 'crop_floorplan') ? 'auto' : 'none' }}
                />
                {/* Crop rectangle visualization in Floor Plan view (convert relative 0-1 to DXF) */}
                {viewMode === 'floorplan' && floorplan.cropRect && (() => {
                  const cr = floorplan.cropRect
                  const fpW = floorplan.naturalWidth * t.scaleX
                  const fpH = floorplan.naturalHeight * t.scaleY
                  const dxfX = t.x + cr.x * fpW
                  const dxfY = t.y + cr.y * fpH
                  const dxfW = cr.w * fpW
                  const dxfH = cr.h * fpH
                  const cTL = toScreen(dxfX, dxfY + dxfH)
                  const cBR = toScreen(dxfX + dxfW, dxfY)
                  return <rect x={Math.min(cTL.x, cBR.x)} y={Math.min(cTL.y, cBR.y)} width={Math.abs(cBR.x - cTL.x)} height={Math.abs(cBR.y - cTL.y)} fill="none" stroke="#a855f7" strokeWidth={2} strokeDasharray="8 4" />
                })()}
                {/* Crop rectangle being drawn */}
                {viewMode === 'floorplan' && activeTool === 'crop_floorplan' && fpCropStart && fpCropCurrent && (
                  <rect
                    x={Math.min(fpCropStart.x, fpCropCurrent.x)} y={Math.min(fpCropStart.y, fpCropCurrent.y)}
                    width={Math.abs(fpCropCurrent.x - fpCropStart.x)} height={Math.abs(fpCropCurrent.y - fpCropStart.y)}
                    fill="rgba(168, 85, 247, 0.15)" stroke="#a855f7" strokeWidth={2} strokeDasharray="6 3"
                  />
                )}
              </g>
            )
          })()}

          {/* Calibration line drawing */}
          {activeTool === 'calibrate_floorplan' && calibrationPoints.length >= 1 && (
            <>
              {calibrationPoints.map((pt, i) => {
                const sp = toScreen(pt.x, pt.y)
                return (
                  <circle key={`cal-${i}`} cx={sp.x} cy={sp.y} r={6} fill="#ef4444" stroke="white" strokeWidth={2} />
                )
              })}
              {calibrationPoints.length === 2 && (
                <line
                  x1={toScreen(calibrationPoints[0].x, calibrationPoints[0].y).x}
                  y1={toScreen(calibrationPoints[0].x, calibrationPoints[0].y).y}
                  x2={toScreen(calibrationPoints[1].x, calibrationPoints[1].y).x}
                  y2={toScreen(calibrationPoints[1].x, calibrationPoints[1].y).y}
                  stroke="#ef4444" strokeWidth={2} strokeDasharray="6 3"
                />
              )}
            </>
          )}

          {/* Fixtures - sorted by area (largest first = behind, smallest last = on top) */}
          <g opacity={viewMode === 'overlay' ? 0.4 : 1}>
          {(viewMode === 'dwg' || viewMode === 'overlay') && layerVisibility.base && [...importData.fixtures]
            .sort((a, b) => (b.footprint.w * b.footprint.d) - (a.footprint.w * a.footprint.d))
            .map(fixture => {
            const isSelected = selectedFixtureIds.has(fixture.id)
            const isHovered = hoveredFixtureId === fixture.id
            const isMapped = !!mappings[fixture.group_id]
            const pos = toScreen(fixture.pose2d.x, fixture.pose2d.y)
            const w = toScreenSize(fixture.footprint.w)
            const d = toScreenSize(fixture.footprint.d)
            const rotation = -fixture.pose2d.rot_deg

            // Determine color based on state
            let fillColor = '#1e293b' // Dark slate
            let strokeColor = '#475569'
            let strokeWidth = 1

            if (isSelected) {
              fillColor = '#1d4ed8' // Blue for selected
              strokeColor = '#3b82f6'
              strokeWidth = 2
            } else if (isHovered) {
              fillColor = '#7c3aed' // Purple for hovered
              strokeColor = '#a78bfa'
              strokeWidth = 2
            } else if (isMapped) {
              fillColor = '#047857' // Green for mapped
              strokeColor = '#10b981'
            }

            if (fixture.footprint.kind === 'poly' && fixture.footprint.points.length > 2) {
              const points = fixture.footprint.points
                .map(p => {
                  const sp = toScreen(p.x, p.y)
                  return `${sp.x},${sp.y}`
                })
                .join(' ')

              return (
                <polygon
                  key={fixture.id}
                  points={points}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  className="cursor-pointer hover:brightness-125"
                  onMouseEnter={() => onHoverFixture?.(fixture.id)}
                  onMouseLeave={() => onHoverFixture?.(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (e.shiftKey) {
                      const newSelection = new Set(selectedFixtureIds)
                      if (newSelection.has(fixture.id)) {
                        newSelection.delete(fixture.id)
                      } else {
                        newSelection.add(fixture.id)
                      }
                      onSelectFixtures(Array.from(newSelection))
                    } else {
                      onSelectFixtures([fixture.id])
                    }
                  }}
                />
              )
            }

            return (
              <g
                key={fixture.id}
                transform={`translate(${pos.x}, ${pos.y}) rotate(${rotation})`}
                className="cursor-pointer"
                onMouseEnter={() => onHoverFixture?.(fixture.id)}
                onMouseLeave={() => onHoverFixture?.(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  if (e.shiftKey) {
                    const newSelection = new Set(selectedFixtureIds)
                    if (newSelection.has(fixture.id)) {
                      newSelection.delete(fixture.id)
                    } else {
                      newSelection.add(fixture.id)
                    }
                    onSelectFixtures(Array.from(newSelection))
                  } else {
                    onSelectFixtures([fixture.id])
                  }
                }}
              >
                <rect
                  x={-w / 2}
                  y={-d / 2}
                  width={w}
                  height={d}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  rx={2}
                  className="hover:brightness-125"
                />
                {isSelected && (
                  <line
                    x1={0}
                    y1={0}
                    x2={w / 3}
                    y2={0}
                    stroke={strokeColor}
                    strokeWidth={1}
                    markerEnd="url(#arrow)"
                  />
                )}
              </g>
            )
          })}
          </g>

          {/* Floor Plan Image - in overlay mode, render AFTER fixtures so it's visible on top */}
          {viewMode === 'overlay' && layerVisibility.floorplan && floorplan && (() => {
            const t = floorplan.transform
            const topLeft = toScreen(t.x, t.y + floorplan.naturalHeight * t.scaleY)
            const bottomRight = toScreen(t.x + floorplan.naturalWidth * t.scaleX, t.y)
            const imgW = Math.abs(bottomRight.x - topLeft.x)
            const imgH = Math.abs(bottomRight.y - topLeft.y)
            const cx = (topLeft.x + bottomRight.x) / 2
            const cy = (topLeft.y + bottomRight.y) / 2
            const useCrop = floorplan.cropRect
            const cropClipId = `fp-crop-overlay-${floorplan.id}`
            return (
              <g>
                {useCrop && floorplan.cropRect && (
                  <defs>
                    <clipPath id={cropClipId}>
                      {(() => {
                        const cr = floorplan.cropRect
                        const fpW = floorplan.naturalWidth * t.scaleX
                        const fpH = floorplan.naturalHeight * t.scaleY
                        const dxfX = t.x + cr.x * fpW
                        const dxfY = t.y + cr.y * fpH
                        const dxfW = cr.w * fpW
                        const dxfH = cr.h * fpH
                        const cTL = toScreen(dxfX, dxfY + dxfH)
                        const cBR = toScreen(dxfX + dxfW, dxfY)
                        return <rect x={Math.min(cTL.x, cBR.x)} y={Math.min(cTL.y, cBR.y)} width={Math.abs(cBR.x - cTL.x)} height={Math.abs(cBR.y - cTL.y)} />
                      })()}
                    </clipPath>
                  </defs>
                )}
                <g clipPath={useCrop ? `url(#${cropClipId})` : undefined}>
                  <image
                    href={floorplan.imageUrl}
                    x={topLeft.x} y={topLeft.y} width={imgW} height={imgH}
                    opacity={t.opacity}
                    transform={t.rotation ? `rotate(${-t.rotation}, ${cx}, ${cy})` : undefined}
                    preserveAspectRatio="none"
                    style={{ pointerEvents: (activeTool === 'move_floorplan' || activeTool === 'calibrate_floorplan') ? 'auto' : 'none' }}
                  />
                </g>
              </g>
            )
          })()}

          {/* Selection Rectangle */}
          {selectionRect && (
            <rect
              x={selectionRect.x}
              y={selectionRect.y}
              width={selectionRect.w}
              height={selectionRect.h}
              fill="rgba(59, 130, 246, 0.2)"
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 2"
            />
          )}

          {/* LiDAR ROI Polygon - completed (stored in DXF units) */}
          {viewMode !== 'floorplan' && lidarMode && layerVisibility.roi && lidarRoi && lidarRoi.length >= 3 && (
            <polygon
              points={lidarRoi.map(v => {
                const pos = toScreen(v.x, v.z)
                return `${pos.x},${pos.y}`
              }).join(' ')}
              fill="rgba(245, 158, 11, 0.15)"
              stroke="#f59e0b"
              strokeWidth={2}
            />
          )}
          
          {/* LiDAR ROI Polygon - drawing in progress (stored in DXF units) */}
          {viewMode !== 'floorplan' && lidarMode && activeTool === 'draw_roi' && (
            <>
              {/* Vertex markers */}
              {roiVertices.map((v, i) => {
                const pos = toScreen(v.x, v.z)
                return (
                  <circle
                    key={`roi-vertex-${i}`}
                    cx={pos.x}
                    cy={pos.y}
                    r={8}
                    fill={i === 0 ? '#22c55e' : '#f59e0b'}
                    stroke="white"
                    strokeWidth={2}
                  />
                )
              })}
              
              {/* Lines connecting vertices */}
              {roiVertices.length > 1 && (
                <polyline
                  points={roiVertices.map(v => {
                    const pos = toScreen(v.x, v.z)
                    return `${pos.x},${pos.y}`
                  }).join(' ')}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                />
              )}
            </>
          )}

          {/* LiDAR Coverage Heatmap */}
          {viewMode !== 'floorplan' && lidarMode && simulationResult && simulationResult.heatmap.map((cell, i) => {
            // Skip based on layer visibility
            if (cell.overlap && !layerVisibility.overlapCells) return null
            if (!cell.overlap && !layerVisibility.coverageHeatmap) return null
            
            // Apply scale correction when converting meters back to DXF units
            const effectiveScale = importData.unit_scale_to_m * scaleCorrection
            const pos = toScreen(cell.x / effectiveScale, cell.z / effectiveScale)
            // Cell size is 0.5m, divide by scaleCorrection since viewTransform.scale uses uncorrected scale
            const size = Math.abs(0.5 * viewTransform.scale / scaleCorrection) || 5
            const intensity = Math.min(cell.count / 3, 1)
            return (
              <rect
                key={`heat-${i}`}
                x={pos.x - size / 2}
                y={pos.y - size / 2}
                width={size}
                height={size}
                fill={cell.overlap ? `rgba(0, 255, 100, ${intensity * 0.5})` : `rgba(0, 150, 255, ${intensity * 0.4})`}
              />
            )
          })}

          {/* LiDAR Instances */}
          {viewMode !== 'floorplan' && lidarMode && lidarInstances.map((inst) => {
            const model = lidarModels.find(m => m.id === inst.model_id)
            const range = inst.range_m || model?.range_m || 10
            // Apply scale correction when converting meters back to DXF units
            const effectiveScale = importData.unit_scale_to_m * scaleCorrection
            const pos = toScreen(inst.x_m / effectiveScale, inst.z_m / effectiveScale)
            // Range is in meters, viewTransform.scale uses uncorrected unit_scale, so divide by scaleCorrection
            const rangeRadius = Math.abs(range * viewTransform.scale / scaleCorrection)
            const isSelected = selectedLidarInstanceId === inst.id
            
            return (
              <g key={inst.id}>
                {/* Range circle - controlled by coverageCircles layer */}
                {layerVisibility.coverageCircles && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={rangeRadius}
                    fill={inst.source === 'auto' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(59, 130, 246, 0.1)'}
                    stroke={inst.source === 'auto' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(59, 130, 246, 0.5)'}
                    strokeWidth="1"
                    strokeDasharray="4 2"
                  />
                )}
                {/* Device marker - controlled by lidarDevices layer */}
                {layerVisibility.lidarDevices && (
                  <>
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={isSelected ? 10 : 8}
                      fill={isSelected ? '#3b82f6' : inst.source === 'auto' ? '#22c55e' : '#1e40af'}
                      stroke={isSelected ? '#60a5fa' : inst.source === 'auto' ? '#4ade80' : '#3b82f6'}
                      strokeWidth="2"
                      className="cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelectLidarInstance?.(isSelected ? null : inst.id)
                      }}
                    />
                    {/* Icon indicator */}
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={3}
                      fill="white"
                      pointerEvents="none"
                    />
                  </>
                )}
              </g>
            )
          })}

          {/* Arrow marker definition */}
          <defs>
            <marker
              id="arrow"
              markerWidth="6"
              markerHeight="6"
              refX="5"
              refY="3"
              orient="auto"
            >
              <path d="M0,0 L0,6 L6,3 z" fill="#6b7280" />
            </marker>
          </defs>
        </svg>
      </div>

      {/* Info Bar */}
      <div className="h-8 border-t border-border-dark flex items-center px-3 text-xs text-gray-500 bg-panel-bg gap-3">
        <span>
          {importData.units} • 
          {((importData.bounds.maxX - importData.bounds.minX) * importData.unit_scale_to_m).toFixed(1)}m × 
          {((importData.bounds.maxY - importData.bounds.minY) * importData.unit_scale_to_m).toFixed(1)}m
        </span>
        {viewMode === 'floorplan' && floorplan && (
          <span className="text-orange-400/70">
            {floorplan.naturalWidth}×{floorplan.naturalHeight}px
            {floorplan.cropRect && <span className="text-purple-400/70 ml-2">• Crop set</span>}
            {floorplan.calibration && <span className="text-red-400/70 ml-2">• Calibrated</span>}
          </span>
        )}
        <div className="flex-1" />
        <span className="text-gray-400">
          {viewMode === 'floorplan' && floorplan ? (
            activeTool === 'crop_floorplan' ? 'Draw rectangle to select crop area for overlay' :
            activeTool === 'move_floorplan' ? 'Drag to reposition floor plan' :
            activeTool === 'calibrate_floorplan' ? 'Click two points on a known dimension' :
            'Use tools to edit floor plan position, scale, and crop'
          ) : viewMode === 'overlay' ? (
            'Overlay: DWG fixtures + floor plan aligned together'
          ) : selectedFixtureIds.size > 0 ? (
            <span className="text-highlight">{selectedFixtureIds.size} selected</span>
          ) : (
            'Click to select, Shift+click for multi, or use rectangle tool'
          )}
        </span>
      </div>

      {/* Calibration Dialog */}
      {showCalibrationDialog && calibrationPoints.length === 2 && floorplan && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 w-80 shadow-xl border border-gray-700">
            <h3 className="text-white font-medium text-sm mb-3">Calibrate Floor Plan Scale</h3>
            <p className="text-gray-400 text-xs mb-3">
              Enter the real-world length of the line you drew (in meters).
              The floor plan will be rescaled so this distance matches.
            </p>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-gray-400 text-xs">Line length on DWG:</span>
              <span className="text-white text-xs font-mono">
                {(() => {
                  const dx = calibrationPoints[1].x - calibrationPoints[0].x
                  const dy = calibrationPoints[1].y - calibrationPoints[0].y
                  const dxfLen = Math.sqrt(dx * dx + dy * dy)
                  return `${(dxfLen * importData.unit_scale_to_m).toFixed(2)}m (${dxfLen.toFixed(0)} DXF)`
                })()}
              </span>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <label className="text-gray-400 text-xs">Real length (m):</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={calibrationLength}
                onChange={(e) => setCalibrationLength(e.target.value)}
                className="flex-1 bg-gray-700 text-white text-sm rounded px-2 py-1.5 border border-gray-600"
                placeholder="e.g. 5.0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // Apply calibration
                    const realMeters = parseFloat(calibrationLength)
                    if (realMeters > 0) {
                      const dx = calibrationPoints[1].x - calibrationPoints[0].x
                      const dy = calibrationPoints[1].y - calibrationPoints[0].y
                      const dxfLineLen = Math.sqrt(dx * dx + dy * dy)
                      const imageLineLen = dxfLineLen / floorplan.transform.scaleX
                      const newScale = (realMeters / importData.unit_scale_to_m) / imageLineLen
                      const newTransform = { ...floorplan.transform, scaleX: newScale, scaleY: newScale }
                      const newCalibration = {
                        p1Screen: calibrationPoints[0],
                        p2Screen: calibrationPoints[1],
                        realWorldMeters: realMeters
                      }
                      setFloorplan(prev => prev ? { ...prev, transform: newTransform, calibration: newCalibration } : null)
                      saveFloorplanTransform(newTransform, newCalibration)
                      setShowCalibrationDialog(false)
                      setCalibrationPoints([])
                      setActiveTool('select')
                    }
                  }
                }}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowCalibrationDialog(false)
                  setCalibrationPoints([])
                  setActiveTool('select')
                }}
                className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const realMeters = parseFloat(calibrationLength)
                  if (realMeters > 0) {
                    const dx = calibrationPoints[1].x - calibrationPoints[0].x
                    const dy = calibrationPoints[1].y - calibrationPoints[0].y
                    const dxfLineLen = Math.sqrt(dx * dx + dy * dy)
                    const imageLineLen = dxfLineLen / floorplan.transform.scaleX
                    const newScale = (realMeters / importData.unit_scale_to_m) / imageLineLen
                    const newTransform = { ...floorplan.transform, scaleX: newScale, scaleY: newScale }
                    const newCalibration = {
                      p1Screen: calibrationPoints[0],
                      p2Screen: calibrationPoints[1],
                      realWorldMeters: realMeters
                    }
                    setFloorplan(prev => prev ? { ...prev, transform: newTransform, calibration: newCalibration } : null)
                    saveFloorplanTransform(newTransform, newCalibration)
                    setShowCalibrationDialog(false)
                    setCalibrationPoints([])
                    setActiveTool('select')
                  }
                }}
                disabled={!calibrationLength || parseFloat(calibrationLength) <= 0}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 text-white text-sm rounded"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LiDAR Debug Panel */}
      {showDebugPanel && lidarRoi && lidarRoi.length >= 3 && (
        <LidarDebugPanel
          roiVertices={lidarRoi}
          unitScaleToM={importData.unit_scale_to_m * scaleCorrection}
          lidarModel={selectedLidarModelId ? lidarModels.find(m => m.id === selectedLidarModelId) || null : null}
          settings={{
            overlap_mode: autoplaceOverlapMode,
            k_required: autoplaceKRequired,
            overlap_target_pct: autoplaceOverlapTargetPct,
            los_enabled: autoplaceLosEnabled,
            sample_spacing_m: autoplaceSampleSpacing,
            mount_y_m: autoplaceMountHeight
          }}
          onClose={() => setShowDebugPanel(false)}
          lidarInstances={lidarInstances}
          lidarModels={lidarModels}
          projectName={importData.filename || 'Untitled Project'}
          layoutVersionId={importData.filename || ''}
        />
      )}
    </div>
  )
}
