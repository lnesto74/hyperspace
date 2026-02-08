import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { 
  Layers, Radio, Play, Wand2, Trash2, Plus, Settings, 
  ZoomIn, ZoomOut, Maximize2, Move, MousePointer2, Download
} from 'lucide-react'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001'

interface LidarModel {
  id: string
  name: string
  hfov_deg: number
  vfov_deg: number
  range_m: number
  dome_mode: boolean
  notes?: any
}

interface LidarInstance {
  id: string
  layout_version_id: string
  source: 'manual' | 'auto'
  model_id?: string
  model_name?: string
  x_m: number
  z_m: number
  mount_y_m: number
  yaw_deg: number
  hfov_deg: number
  vfov_deg: number
  range_m: number
  dome_mode: boolean
}

interface HeatmapCell {
  x: number
  z: number
  count: number
  overlap: boolean
}

interface SimulationResult {
  coverage_pct: number
  overlap_pct: number
  total_target_cells: number
  covered_cells: number
  overlap_cells: number
  heatmap: HeatmapCell[]
  grid: {
    width: number
    height: number
    cell_size: number
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  }
  stats: { sensor_count: number }
}

interface LayoutVersion {
  id: string
  name: string
  import_id: string
  layout_json: string
  created_at: string
}

interface LayerVisibility {
  base: boolean
  candidateGrid: boolean
  lidarDevices: boolean
  autoLidarDevices: boolean
  coverageHeatmap: boolean
  overlapCells: boolean
}

type Tool = 'select' | 'place' | 'pan'

export default function LidarPlannerPage() {
  // Layout selection
  const [layouts, setLayouts] = useState<LayoutVersion[]>([])
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null)
  const [layoutData, setLayoutData] = useState<any>(null)
  const [importData, setImportData] = useState<any>(null)
  
  // LiDAR data
  const [models, setModels] = useState<LidarModel[]>([])
  const [instances, setInstances] = useState<LidarInstance[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  
  // Simulation
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null)
  const [isSimulating, setIsSimulating] = useState(false)
  const [isAutoPlacing, setIsAutoPlacing] = useState(false)
  
  // Settings
  const [settings, setSettings] = useState({
    floor_cell_size_m: 0.5,
    overlap_required_n: 2,
    coverage_target_pct: 0.95,
    mount_y_m: 3,
    include_occlusion: true
  })
  
  // UI state
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [layers, setLayers] = useState<LayerVisibility>({
    base: true,
    candidateGrid: false,
    lidarDevices: true,
    autoLidarDevices: true,
    coverageHeatmap: true,
    overlapCells: false
  })
  const [showLayersPanel, setShowLayersPanel] = useState(false)
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  
  // Canvas state
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragStartOffset, setDragStartOffset] = useState({ x: 0, y: 0 })
  
  // Fetch layouts on mount
  useEffect(() => {
    fetchLayouts()
    fetchModels()
  }, [])
  
  // Fetch layout data when selection changes
  useEffect(() => {
    if (selectedLayoutId) {
      fetchLayoutData(selectedLayoutId)
      fetchInstances(selectedLayoutId)
    }
  }, [selectedLayoutId])
  
  // Storage key for saved view - same format as PreviewPanel
  const storageKey = importData?.filename ? `dwg-2d-view-${importData.filename}` : null

  // Load saved view - use visibleBounds for resolution-independent loading
  useEffect(() => {
    if (storageKey && importData?.bounds && dimensions.width > 100) {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        try {
          const viewData = JSON.parse(saved)
          const b = importData.bounds
          const u = importData.unit_scale_to_m || 1
          
          // If we have visibleBounds, calculate zoom and pan to show the same world area
          if (viewData.visibleBounds) {
            const vb = viewData.visibleBounds
            const visibleWorldWidth = Math.abs(vb.maxX - vb.minX) * u
            const visibleWorldHeight = Math.abs(vb.maxY - vb.minY) * u
            
            // Safety check - if visible bounds are too small, use defaults
            if (visibleWorldWidth < 1 || visibleWorldHeight < 1) {
              console.log('LiDAR Planner: visibleBounds too small, using default view')
              return
            }
            
            const padding = 40
            const availableWidth = dimensions.width - padding * 2
            const availableHeight = dimensions.height - padding * 2
            
            const drawingWidth = (b.maxX - b.minX) * u
            const drawingHeight = (b.maxY - b.minY) * u
            const baseScale = Math.min(availableWidth / drawingWidth, availableHeight / drawingHeight, 100)
            
            // Calculate zoom - cap at 5 to prevent extreme zoom
            const zoomForWidth = availableWidth / visibleWorldWidth / baseScale
            const zoomForHeight = availableHeight / visibleWorldHeight / baseScale
            const newZoom = Math.min(Math.min(zoomForWidth, zoomForHeight), 5)
            const scale = baseScale * newZoom
            
            const visibleCenterX = (vb.minX + vb.maxX) / 2
            const visibleCenterY = (vb.minY + vb.maxY) / 2
            
            const baseOffsetX = (dimensions.width - drawingWidth * baseScale) / 2
            const baseOffsetY = (dimensions.height - drawingHeight * baseScale) / 2
            const centerScreenX = ((visibleCenterX - b.minX) * u) * scale + baseOffsetX
            const centerScreenY = dimensions.height - (((visibleCenterY - b.minY) * u) * scale) - baseOffsetY
            
            const newPanX = dimensions.width / 2 - centerScreenX
            const newPanY = -(dimensions.height / 2 - centerScreenY)
            
            setZoom(newZoom)
            setPanOffset({ x: newPanX, y: newPanY })
            console.log('LiDAR Planner: View restored, zoom:', newZoom.toFixed(2))
          } else {
            // Fallback to direct zoom/panOffset with safety cap
            const safeZoom = Math.min(viewData.zoom || 1, 5)
            setZoom(safeZoom)
            if (viewData.panOffset) setPanOffset(viewData.panOffset)
            console.log('LiDAR Planner: View loaded (legacy), zoom:', safeZoom)
          }
        } catch (e) {
          console.error('Failed to load saved view:', e)
        }
      }
    }
  }, [storageKey, importData?.bounds, importData?.unit_scale_to_m, dimensions.width, dimensions.height])

  // Function to manually sync view from DWG Importer
  const syncViewFromDwgImporter = useCallback(() => {
    if (!storageKey || !importData?.bounds) return
    const saved = localStorage.getItem(storageKey)
    if (saved) {
      try {
        const viewData = JSON.parse(saved)
        const b = importData.bounds
        const u = importData.unit_scale_to_m || 1
        
        if (viewData.visibleBounds) {
          const vb = viewData.visibleBounds
          const visibleWorldWidth = (vb.maxX - vb.minX) * u
          const visibleWorldHeight = (vb.maxY - vb.minY) * u
          
          const padding = 40
          const availableWidth = dimensions.width - padding * 2
          const availableHeight = dimensions.height - padding * 2
          const drawingWidth = (b.maxX - b.minX) * u
          const drawingHeight = (b.maxY - b.minY) * u
          const baseScale = Math.min(availableWidth / drawingWidth, availableHeight / drawingHeight, 100)
          
          const newZoom = Math.min(availableWidth / visibleWorldWidth / baseScale, availableHeight / visibleWorldHeight / baseScale)
          const scale = baseScale * newZoom
          
          const visibleCenterX = (vb.minX + vb.maxX) / 2
          const visibleCenterY = (vb.minY + vb.maxY) / 2
          const baseOffsetX = (dimensions.width - drawingWidth * baseScale) / 2
          const baseOffsetY = (dimensions.height - drawingHeight * baseScale) / 2
          const centerScreenX = ((visibleCenterX - b.minX) * u) * scale + baseOffsetX
          const centerScreenY = dimensions.height - (((visibleCenterY - b.minY) * u) * scale) - baseOffsetY
          
          setZoom(newZoom)
          setPanOffset({ x: dimensions.width / 2 - centerScreenX, y: -(dimensions.height / 2 - centerScreenY) })
          console.log('View synced from visibleBounds')
        } else {
          setZoom(viewData.zoom)
          setPanOffset(viewData.panOffset)
        }
      } catch (e) {
        console.error('Failed to sync view:', e)
      }
    }
  }, [storageKey, importData?.bounds, importData?.unit_scale_to_m, dimensions])
  
  const fetchLayouts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dwg/layouts`)
      if (res.ok) {
        const data = await res.json()
        setLayouts(data)
        if (data.length > 0 && !selectedLayoutId) {
          setSelectedLayoutId(data[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch layouts:', err)
    }
  }
  
  const fetchLayoutData = async (layoutId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/dwg/layout/${layoutId}`)
      if (res.ok) {
        const data = await res.json()
        setLayoutData(data.layout)
        console.log('Layout data loaded:', data.layout)
        
        // Also fetch the raw import data to get exact fixtures
        if (data.import_id) {
          const importRes = await fetch(`${API_BASE}/api/dwg/import/${data.import_id}`)
          if (importRes.ok) {
            const importJson = await importRes.json()
            setImportData(importJson)
            console.log('Import data loaded:', importJson)
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch layout data:', err)
    }
  }
  
  const fetchModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/lidar/models`)
      if (res.ok) {
        const data = await res.json()
        setModels(data)
        if (data.length > 0 && !selectedModelId) {
          setSelectedModelId(data[0].id)
        }
      }
    } catch (err) {
      console.error('Failed to fetch LiDAR models:', err)
    }
  }
  
  const fetchInstances = async (layoutId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/lidar/instances?layout_version_id=${layoutId}`)
      if (res.ok) {
        const data = await res.json()
        setInstances(data)
      }
    } catch (err) {
      console.error('Failed to fetch LiDAR instances:', err)
    }
  }
  
  // Use importData for coordinate transform (same as PreviewPanel) - fallback to layoutData
  const bounds = importData?.bounds || layoutData?.bounds || { minX: 0, maxX: 20, minY: 0, maxY: 15 }
  const unit_scale_to_m = importData?.unit_scale_to_m || layoutData?.unit_scale_to_m || 1
  
  const viewTransform = useMemo(() => {
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
  }, [bounds, unit_scale_to_m, dimensions, zoom, panOffset])
  
  // Convert DXF coordinates to screen - matches PreviewPanel exactly
  const toScreen = useCallback((x: number, y: number) => {
    const { scale, offsetX, offsetY, bounds: b, unit_scale_to_m: u } = viewTransform
    const screenX = ((x - b.minX) * u) * scale + offsetX
    // Y is inverted (DXF Y+ is up, screen Y+ is down)
    const screenY = dimensions.height - (((y - b.minY) * u) * scale) - offsetY
    return { x: screenX, y: screenY }
  }, [viewTransform, dimensions.height])
  
  // Convert size from DXF units to screen pixels (always positive)
  const toScreenSize = useCallback((size: number) => {
    return Math.abs(size * unit_scale_to_m * viewTransform.scale)
  }, [unit_scale_to_m, viewTransform.scale])
  
  const fromScreen = useCallback((screenX: number, screenY: number) => {
    const { scale, offsetX, offsetY, bounds: b, unit_scale_to_m: u } = viewTransform
    const x = ((screenX - offsetX) / scale / u) + b.minX
    // Must match PreviewPanel: use + offsetY
    const y = ((dimensions.height - screenY + offsetY) / scale / u) + b.minY
    return { x, y }
  }, [viewTransform, dimensions.height])
  
  // Track container size
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    
    const observer = new ResizeObserver(entries => {
      const entry = entries[0]
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        })
      }
    })
    
    observer.observe(container)
    return () => observer.disconnect()
  }, [])
  
  // Mouse handlers - matches PreviewPanel exactly
  const getMousePos = useCallback((e: React.MouseEvent) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])
  
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getMousePos(e)
    setDragStart(pos)
    setDragStartOffset(panOffset)
    
    if (activeTool === 'pan') {
      setIsDragging(true)
    } else if (activeTool === 'place' && selectedLayoutId && selectedModelId) {
      // Place new LiDAR - worldPos.y is the Z coordinate in world space
      const worldPos = fromScreen(pos.x, pos.y)
      placeLidar(worldPos.x, worldPos.y)
    } else if (activeTool === 'select') {
      // Check if clicking on a LiDAR
      const worldPos = fromScreen(pos.x, pos.y)
      const clicked = instances.find(inst => {
        const dx = inst.x_m - worldPos.x
        const dz = inst.z_m - worldPos.y  // worldPos.y is Z in world coords
        return Math.sqrt(dx * dx + dz * dz) < 0.5
      })
      setSelectedInstanceId(clicked?.id || null)
    }
  }, [activeTool, getMousePos, panOffset, fromScreen, selectedLayoutId, selectedModelId, instances])
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return
    
    const pos = getMousePos(e)
    const dx = pos.x - dragStart.x
    const dy = pos.y - dragStart.y
    
    if (activeTool === 'pan') {
      setPanOffset({
        x: dragStartOffset.x + dx,
        y: dragStartOffset.y - dy
      })
    }
  }, [isDragging, getMousePos, dragStart, dragStartOffset, activeTool])
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.9 : 1.1
    setZoom(prev => Math.max(0.1, Math.min(20, prev * delta)))
  }, [])
  
  // LiDAR operations
  const placeLidar = async (x: number, z: number) => {
    if (!selectedLayoutId || !selectedModelId) return
    
    try {
      const res = await fetch(`${API_BASE}/api/lidar/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout_version_id: selectedLayoutId,
          model_id: selectedModelId,
          source: 'manual',
          x_m: x,
          z_m: z,
          mount_y_m: settings.mount_y_m
        })
      })
      
      if (res.ok) {
        fetchInstances(selectedLayoutId)
      }
    } catch (err) {
      console.error('Failed to place LiDAR:', err)
    }
  }
  
  const deleteInstance = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/lidar/instances/${id}`, { method: 'DELETE' })
      if (res.ok && selectedLayoutId) {
        fetchInstances(selectedLayoutId)
        if (selectedInstanceId === id) {
          setSelectedInstanceId(null)
        }
      }
    } catch (err) {
      console.error('Failed to delete LiDAR:', err)
    }
  }
  
  const runSimulation = async () => {
    if (!selectedLayoutId) return
    
    setIsSimulating(true)
    try {
      const res = await fetch(`${API_BASE}/api/lidar/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout_version_id: selectedLayoutId,
          floor_cell_size_m: settings.floor_cell_size_m,
          overlap_required_n: settings.overlap_required_n,
          include_occlusion: settings.include_occlusion
        })
      })
      
      if (res.ok) {
        const result = await res.json()
        setSimulationResult(result)
      }
    } catch (err) {
      console.error('Failed to run simulation:', err)
    } finally {
      setIsSimulating(false)
    }
  }
  
  const runAutoPlace = async () => {
    if (!selectedLayoutId) return
    
    setIsAutoPlacing(true)
    try {
      const res = await fetch(`${API_BASE}/api/lidar/autoplace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layout_version_id: selectedLayoutId,
          model_id: selectedModelId,
          coverage_target_pct: settings.coverage_target_pct,
          overlap_required_n: settings.overlap_required_n,
          mount_y_m: settings.mount_y_m,
          floor_cell_size_m: settings.floor_cell_size_m
        })
      })
      
      if (res.ok) {
        const result = await res.json()
        setSimulationResult({
          coverage_pct: result.coverage_pct,
          overlap_pct: result.overlap_pct,
          total_target_cells: result.total_target_cells,
          covered_cells: result.covered_cells,
          overlap_cells: result.overlap_cells,
          heatmap: [],
          grid: { width: 0, height: 0, cell_size: settings.floor_cell_size_m, bounds },
          stats: { sensor_count: result.instances.length }
        })
        fetchInstances(selectedLayoutId)
      }
    } catch (err) {
      console.error('Failed to run auto-placement:', err)
    } finally {
      setIsAutoPlacing(false)
    }
  }
  
  const resetView = useCallback(() => {
    setZoom(1)
    setPanOffset({ x: 0, y: 0 })
  }, [])
  
  const selectedInstance = instances.find(i => i.id === selectedInstanceId)
  const manualInstances = instances.filter(i => i.source === 'manual')
  const autoInstances = instances.filter(i => i.source === 'auto')
  
  return (
    <div className="h-full flex bg-gray-900 text-white">
      {/* Left Panel - Models & Instances */}
      <div className="w-64 border-r border-gray-700 flex flex-col">
        {/* Layout Selector */}
        <div className="p-3 border-b border-gray-700">
          <label className="text-xs text-gray-400 mb-1 block">Layout</label>
          <select 
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
            value={selectedLayoutId || ''}
            onChange={(e) => setSelectedLayoutId(e.target.value)}
          >
            <option value="">Select layout...</option>
            {layouts.map(l => (
              <option key={l.id} value={l.id}>{l.name || `Layout ${l.id.slice(0, 8)}`}</option>
            ))}
          </select>
        </div>
        
        {/* Model Selector */}
        <div className="p-3 border-b border-gray-700">
          <label className="text-xs text-gray-400 mb-1 block">LiDAR Model</label>
          <select 
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm"
            value={selectedModelId || ''}
            onChange={(e) => setSelectedModelId(e.target.value)}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {selectedModelId && (
            <div className="mt-2 text-xs text-gray-500">
              {models.find(m => m.id === selectedModelId)?.range_m}m range, 
              {models.find(m => m.id === selectedModelId)?.hfov_deg}° HFOV
            </div>
          )}
        </div>
        
        {/* Instance List */}
        <div className="flex-1 overflow-auto">
          {/* Manual LiDARs */}
          <div className="p-2">
            <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
              <Radio className="w-3 h-3" />
              <span>Manual ({manualInstances.length})</span>
            </div>
            {manualInstances.map(inst => (
              <div 
                key={inst.id}
                onClick={() => setSelectedInstanceId(inst.id)}
                className={`p-2 rounded text-sm cursor-pointer flex items-center justify-between ${
                  selectedInstanceId === inst.id ? 'bg-blue-900/50 border border-blue-500' : 'hover:bg-gray-800'
                }`}
              >
                <div>
                  <div className="font-medium">{inst.model_name || 'Custom'}</div>
                  <div className="text-xs text-gray-500">
                    ({inst.x_m.toFixed(1)}, {inst.z_m.toFixed(1)})
                  </div>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); deleteInstance(inst.id); }}
                  className="p-1 hover:bg-red-900/50 rounded"
                >
                  <Trash2 className="w-3 h-3 text-red-400" />
                </button>
              </div>
            ))}
          </div>
          
          {/* Auto LiDARs */}
          <div className="p-2 border-t border-gray-700">
            <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
              <Wand2 className="w-3 h-3" />
              <span>Auto-placed ({autoInstances.length})</span>
            </div>
            {autoInstances.map(inst => (
              <div 
                key={inst.id}
                onClick={() => setSelectedInstanceId(inst.id)}
                className={`p-2 rounded text-sm cursor-pointer ${
                  selectedInstanceId === inst.id ? 'bg-green-900/50 border border-green-500' : 'hover:bg-gray-800'
                }`}
              >
                <div className="font-medium">{inst.model_name || 'Auto'}</div>
                <div className="text-xs text-gray-500">
                  ({inst.x_m.toFixed(1)}, {inst.z_m.toFixed(1)})
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* Action Buttons */}
        <div className="p-3 border-t border-gray-700 space-y-2">
          <button
            onClick={runSimulation}
            disabled={isSimulating || !selectedLayoutId || instances.length === 0}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
          >
            <Play className="w-4 h-4" />
            {isSimulating ? 'Simulating...' : 'Simulate Coverage'}
          </button>
          <button
            onClick={runAutoPlace}
            disabled={isAutoPlacing || !selectedLayoutId}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium"
          >
            <Wand2 className="w-4 h-4" />
            {isAutoPlacing ? 'Placing...' : 'Auto-Place LiDARs'}
          </button>
        </div>
      </div>
      
      {/* Center - Canvas */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-10 border-b border-gray-700 flex items-center px-3 gap-2 bg-gray-800">
          {/* Tool selection */}
          <div className="flex items-center gap-1 border-r border-gray-600 pr-2">
            <button
              onClick={() => setActiveTool('select')}
              className={`p-1.5 rounded ${activeTool === 'select' ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
              title="Select (V)"
            >
              <MousePointer2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setActiveTool('place')}
              className={`p-1.5 rounded ${activeTool === 'place' ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
              title="Place LiDAR (P)"
            >
              <Plus className="w-4 h-4" />
            </button>
            <button
              onClick={() => setActiveTool('pan')}
              className={`p-1.5 rounded ${activeTool === 'pan' ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
              title="Pan (Space)"
            >
              <Move className="w-4 h-4" />
            </button>
          </div>
          
          {/* Zoom controls */}
          <div className="flex items-center gap-1">
            <button onClick={() => setZoom(z => Math.min(20, z * 1.2))} className="p-1.5 hover:bg-gray-700 rounded" title="Zoom In">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button onClick={() => setZoom(z => Math.max(0.1, z * 0.8))} className="p-1.5 hover:bg-gray-700 rounded" title="Zoom Out">
              <ZoomOut className="w-4 h-4" />
            </button>
            <button onClick={resetView} className="p-1.5 hover:bg-gray-700 rounded" title="Reset View">
              <Maximize2 className="w-4 h-4" />
            </button>
            <button 
              onClick={syncViewFromDwgImporter} 
              className="p-1.5 hover:bg-gray-700 rounded text-green-400 hover:text-green-300" 
              title="Sync View from DWG Importer"
            >
              <Download className="w-4 h-4" />
            </button>
            <span className="text-xs text-gray-500 ml-1">{Math.round(zoom * 100)}%</span>
          </div>
          
          <div className="flex-1" />
          
          {/* Layers toggle */}
          <div className="relative">
            <button
              onClick={() => setShowLayersPanel(!showLayersPanel)}
              className={`p-1.5 rounded flex items-center gap-1 ${showLayersPanel ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
            >
              <Layers className="w-4 h-4" />
              <span className="text-xs">Layers</span>
            </button>
            
            {showLayersPanel && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-gray-800 border border-gray-600 rounded shadow-lg z-10">
                {Object.entries({
                  base: 'Base (Fixtures)',
                  candidateGrid: 'Candidate Grid',
                  lidarDevices: 'Manual LiDARs',
                  autoLidarDevices: 'Auto LiDARs',
                  coverageHeatmap: 'Coverage Heatmap',
                  overlapCells: 'Overlap Cells'
                }).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={layers[key as keyof LayerVisibility]}
                      onChange={(e) => setLayers(prev => ({ ...prev, [key]: e.target.checked }))}
                      className="rounded"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          
          {/* Settings */}
          <button
            onClick={() => setShowSettingsPanel(!showSettingsPanel)}
            className={`p-1.5 rounded ${showSettingsPanel ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
        
        {/* Canvas - IDENTICAL to PreviewPanel */}
        <div
          ref={containerRef}
          className={`flex-1 overflow-hidden ${activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : activeTool === 'place' ? 'cursor-crosshair' : 'cursor-default'}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
        >
          <svg
            width={dimensions.width}
            height={dimensions.height}
            className="bg-gray-950"
          >
            {/* Grid pattern - use safe positive scale */}
            {(() => {
              const gridSize = Math.max(Math.abs(viewTransform.scale), 10)
              return (
                <>
                  <defs>
                    <pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                      <path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#1f2937" strokeWidth="0.5" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#grid)" />
                </>
              )
            })()}
            
            
            {/* Coverage Heatmap */}
            {layers.coverageHeatmap && simulationResult && simulationResult.heatmap.map((cell, i) => {
              const pos = toScreen(cell.x, cell.z)
              const size = Math.abs(settings.floor_cell_size_m * viewTransform.scale) || 1
              const intensity = Math.min(cell.count / 3, 1)
              return (
                <rect
                  key={i}
                  x={pos.x - size / 2}
                  y={pos.y - size / 2}
                  width={size}
                  height={size}
                  fill={layers.overlapCells && cell.overlap ? `rgba(0, 255, 100, ${intensity * 0.6})` : `rgba(0, 150, 255, ${intensity * 0.5})`}
                />
              )
            })}
            
            {/* Base fixtures - use importData.fixtures (SAME as PreviewPanel) */}
            {layers.base && importData?.fixtures && [...importData.fixtures]
              .sort((a: any, b: any) => (Math.abs(b.footprint.w * b.footprint.d)) - (Math.abs(a.footprint.w * a.footprint.d)))
              .map((fixture: any) => {
              if (!fixture.pose2d) return null
              const pos = toScreen(fixture.pose2d.x, fixture.pose2d.y)
              // Use Math.abs to handle negative values
              const w = Math.abs(toScreenSize(fixture.footprint.w)) || 1
              const d = Math.abs(toScreenSize(fixture.footprint.d)) || 1
              const rotation = -fixture.pose2d.rot_deg
              
              // Colors exactly matching PreviewPanel
              const fillColor = '#1e293b'
              const strokeColor = '#475569'
              
              // Handle polygon fixtures
              if (fixture.footprint.kind === 'poly' && fixture.footprint.points?.length > 2) {
                const points = fixture.footprint.points
                  .map((p: { x: number; y: number }) => {
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
                    strokeWidth={1}
                  />
                )
              }
              
              // Rectangle fixtures
              return (
                <g key={fixture.id} transform={`translate(${pos.x}, ${pos.y}) rotate(${rotation})`}>
                  <rect
                    x={-w / 2}
                    y={-d / 2}
                    width={w}
                    height={d}
                    fill={fillColor}
                    stroke={strokeColor}
                    strokeWidth={1}
                    rx={2}
                  />
                </g>
              )
            })}
            
            {/* LiDAR instances */}
            {layers.lidarDevices && manualInstances.map(inst => {
              const pos = toScreen(inst.x_m, inst.z_m)
              const rangeRadius = inst.range_m * viewTransform.scale
              const isSelected = selectedInstanceId === inst.id
              
              return (
                <g key={inst.id}>
                  {/* Range circle */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={rangeRadius}
                    fill="rgba(59, 130, 246, 0.1)"
                    stroke="rgba(59, 130, 246, 0.5)"
                    strokeWidth="1"
                    strokeDasharray="4 2"
                  />
                  {/* Device marker */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={8}
                    fill={isSelected ? '#3b82f6' : '#1e40af'}
                    stroke={isSelected ? '#60a5fa' : '#3b82f6'}
                    strokeWidth="2"
                  />
                  <Radio className="w-3 h-3" style={{ transform: `translate(${pos.x - 6}px, ${pos.y - 6}px)` }} />
                </g>
              )
            })}
            
            {layers.autoLidarDevices && autoInstances.map(inst => {
              const pos = toScreen(inst.x_m, inst.z_m)
              const rangeRadius = inst.range_m * viewTransform.scale
              const isSelected = selectedInstanceId === inst.id
              
              return (
                <g key={inst.id}>
                  {/* Range circle */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={rangeRadius}
                    fill="rgba(34, 197, 94, 0.1)"
                    stroke="rgba(34, 197, 94, 0.5)"
                    strokeWidth="1"
                    strokeDasharray="4 2"
                  />
                  {/* Device marker */}
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={8}
                    fill={isSelected ? '#22c55e' : '#166534'}
                    stroke={isSelected ? '#4ade80' : '#22c55e'}
                    strokeWidth="2"
                  />
                </g>
              )
            })}
          </svg>
          
          {/* Stats overlay */}
          {simulationResult && (
            <div className="absolute top-3 left-3 bg-gray-800/90 border border-gray-600 rounded p-3 text-sm">
              <div className="font-medium mb-2">Coverage Results</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <span className="text-gray-400">Coverage:</span>
                <span className={simulationResult.coverage_pct >= 0.95 ? 'text-green-400' : 'text-yellow-400'}>
                  {(simulationResult.coverage_pct * 100).toFixed(1)}%
                </span>
                <span className="text-gray-400">Overlap:</span>
                <span>{(simulationResult.overlap_pct * 100).toFixed(1)}%</span>
                <span className="text-gray-400">Sensors:</span>
                <span>{simulationResult.stats.sensor_count}</span>
                <span className="text-gray-400">Covered cells:</span>
                <span>{simulationResult.covered_cells} / {simulationResult.total_target_cells}</span>
              </div>
            </div>
          )}
        </div>
        
        {/* Info bar */}
        <div className="h-6 border-t border-gray-700 flex items-center px-3 text-xs text-gray-500 bg-gray-800">
          <span>
            {activeTool === 'place' && 'Click to place LiDAR • '}
            {activeTool === 'select' && 'Click to select LiDAR • '}
            Scroll: zoom • Right-click: pan
          </span>
        </div>
      </div>
      
      {/* Right Panel - Properties */}
      <div className="w-64 border-l border-gray-700 flex flex-col">
        <div className="p-3 border-b border-gray-700 font-medium text-sm">
          {selectedInstance ? 'LiDAR Properties' : 'Simulation Settings'}
        </div>
        
        {selectedInstance ? (
          <div className="p-3 space-y-3">
            <div>
              <label className="text-xs text-gray-400">Position X (m)</label>
              <input
                type="number"
                value={selectedInstance.x_m.toFixed(2)}
                readOnly
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Position Z (m)</label>
              <input
                type="number"
                value={selectedInstance.z_m.toFixed(2)}
                readOnly
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Mount Height (m)</label>
              <input
                type="number"
                value={selectedInstance.mount_y_m}
                readOnly
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Range (m)</label>
              <input
                type="number"
                value={selectedInstance.range_m}
                readOnly
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">HFOV (°)</label>
              <input
                type="number"
                value={selectedInstance.hfov_deg}
                readOnly
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">VFOV (°)</label>
              <input
                type="number"
                value={selectedInstance.vfov_deg}
                readOnly
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <button
              onClick={() => deleteInstance(selectedInstance.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-red-600 hover:bg-red-700 rounded text-sm"
            >
              <Trash2 className="w-4 h-4" />
              Delete LiDAR
            </button>
          </div>
        ) : (
          <div className="p-3 space-y-3">
            <div>
              <label className="text-xs text-gray-400">Cell Size (m)</label>
              <input
                type="number"
                step="0.1"
                value={settings.floor_cell_size_m}
                onChange={(e) => setSettings(s => ({ ...s, floor_cell_size_m: parseFloat(e.target.value) || 0.5 }))}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Overlap Required (N sensors)</label>
              <input
                type="number"
                min="1"
                value={settings.overlap_required_n}
                onChange={(e) => setSettings(s => ({ ...s, overlap_required_n: parseInt(e.target.value) || 2 }))}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Coverage Target (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={settings.coverage_target_pct * 100}
                onChange={(e) => setSettings(s => ({ ...s, coverage_target_pct: (parseFloat(e.target.value) || 95) / 100 }))}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400">Mount Height (m)</label>
              <input
                type="number"
                step="0.5"
                value={settings.mount_y_m}
                onChange={(e) => setSettings(s => ({ ...s, mount_y_m: parseFloat(e.target.value) || 3 }))}
                className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="occlusion"
                checked={settings.include_occlusion}
                onChange={(e) => setSettings(s => ({ ...s, include_occlusion: e.target.checked }))}
                className="rounded"
              />
              <label htmlFor="occlusion" className="text-sm">Include occlusion</label>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
