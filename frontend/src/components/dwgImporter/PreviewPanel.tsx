import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Grid, MousePointer2, Square, Move, Focus, Save, Download } from 'lucide-react'
import type { ImportData, GroupMapping } from './DwgImporterPage'

interface PreviewPanelProps {
  importData: ImportData
  selectedGroupId: string | null
  mappings: Record<string, GroupMapping>
  selectedFixtureIds: Set<string>
  onSelectFixtures: (fixtureIds: string[], addToSelection?: boolean) => void
  onDeleteFixtures?: (fixtureIds: string[]) => void
  onHoverFixture?: (fixtureId: string | null) => void
  hoveredFixtureId?: string | null
}

type Tool = 'pan' | 'select' | 'rectangle'

export default function PreviewPanel({ 
  importData, 
  selectedGroupId, 
  mappings,
  selectedFixtureIds,
  onSelectFixtures,
  onDeleteFixtures,
  onHoverFixture,
  hoveredFixtureId
}: PreviewPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [zoom, setZoom] = useState(1)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [dragStartOffset, setDragStartOffset] = useState({ x: 0, y: 0 })
  const [showGrid, setShowGrid] = useState(false)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [hasSavedView, setHasSavedView] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  // Generate storage key from import data filename
  const storageKey = `dwg-2d-view-${importData.filename || 'default'}`

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

  // Save current view
  const saveView = useCallback(() => {
    const viewData = { zoom, panOffset }
    localStorage.setItem(storageKey, JSON.stringify(viewData))
    setHasSavedView(true)
    setJustSaved(true)
    console.log('2D view saved')
    // Reset justSaved after 1.5 seconds
    setTimeout(() => setJustSaved(false), 1500)
  }, [zoom, panOffset, storageKey])

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
    const y = ((dimensions.height - screenY + offsetY) / scale / unit_scale_to_m) + bounds.minY
    return { x, y }
  }, [viewTransform, dimensions.height])

  // Convert size from DXF units to screen pixels
  const toScreenSize = useCallback((size: number) => {
    return size * importData.unit_scale_to_m * viewTransform.scale
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
    } else if (activeTool === 'select') {
      // Check if clicking on a fixture
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
    }
  }, [activeTool, getMousePos, panOffset, findFixtureAt, selectedFixtureIds, onSelectFixtures])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = getMousePos(e)
    
    // Track hover when not dragging
    if (!isDragging && onHoverFixture) {
      const fixture = findFixtureAt(pos.x, pos.y)
      onHoverFixture(fixture?.id || null)
    }
    
    if (!isDragging) return
    
    const dx = pos.x - dragStart.x
    const dy = pos.y - dragStart.y

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
    }
  }, [isDragging, getMousePos, dragStart, dragStartOffset, activeTool, selectionRect, onHoverFixture, findFixtureAt])

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
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
  }, [activeTool, selectionRect, findFixturesInRect, selectedFixtureIds, onSelectFixtures])

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
      {/* Toolbar */}
      <div className="h-10 border-b border-border-dark flex items-center px-3 gap-1 bg-panel-bg">
        <span className="text-xs text-gray-400 mr-2">Tools:</span>
        <button
          onClick={() => setActiveTool('select')}
          className={`p-1.5 rounded transition-colors ${activeTool === 'select' ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
          title="Select (click or Shift+click for multi)"
        >
          <MousePointer2 className="w-4 h-4" />
        </button>
        <button
          onClick={() => setActiveTool('rectangle')}
          className={`p-1.5 rounded transition-colors ${activeTool === 'rectangle' ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
          title="Rectangle Select"
        >
          <Square className="w-4 h-4" />
        </button>
        <button
          onClick={() => setActiveTool('pan')}
          className={`p-1.5 rounded transition-colors ${activeTool === 'pan' ? 'bg-highlight text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
          title="Pan"
        >
          <Move className="w-4 h-4" />
        </button>
        <div className="w-px h-5 bg-gray-700 mx-2" />
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`p-1.5 rounded transition-colors ${showGrid ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}
          title="Toggle Grid"
        >
          <Grid className="w-4 h-4" />
        </button>
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
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className={`flex-1 overflow-hidden ${activeTool === 'pan' ? 'cursor-grab active:cursor-grabbing' : activeTool === 'rectangle' ? 'cursor-crosshair' : 'cursor-default'}`}
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

          {/* Fixtures - sorted by area (largest first = behind, smallest last = on top) */}
          {[...importData.fixtures]
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
      <div className="h-8 border-t border-border-dark flex items-center px-3 text-xs text-gray-500 bg-panel-bg">
        <span>
          {importData.units} • 
          {((importData.bounds.maxX - importData.bounds.minX) * importData.unit_scale_to_m).toFixed(1)}m × 
          {((importData.bounds.maxY - importData.bounds.minY) * importData.unit_scale_to_m).toFixed(1)}m
        </span>
        <div className="flex-1" />
        <span className="text-gray-400">
          {selectedFixtureIds.size > 0 ? (
            <span className="text-highlight">{selectedFixtureIds.size} selected</span>
          ) : (
            'Click to select, Shift+click for multi, or use rectangle tool'
          )}
        </span>
      </div>
    </div>
  )
}
