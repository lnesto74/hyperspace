/**
 * MiniDwgViewport — 2D SVG preview of the DWG floor plan
 * 
 * Features:
 * - Intelligent outlier filtering: removes massive DWG elements (site boundaries,
 *   structural layers) that dwarf the actual floor plan
 * - Auto-refit: recalculates bounds from coherent geometry after filtering
 * - Click-to-expand modal for full-screen inspection
 * - Color-coded fixtures, ROI polygons, LiDAR coverage
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { Maximize2, X, ZoomIn, ZoomOut, RotateCcw, Plus, Trash2, MousePointer } from 'lucide-react'

// ─── Types ──────────────────────────────────────────────────────

export interface MiniFixture {
  id: string
  x: number
  y: number
  w: number
  d: number
  rot_deg: number
  group_id?: string
  points?: Array<{ x: number; y: number }>
}

export interface MiniClassification {
  groupId: string
  suggestedType: string
  confidence: number
}

export interface MiniRoi {
  name: string
  color: string
  vertices: Array<{ x: number; y: number }>
}

export interface MiniLidar {
  id?: string
  model_id?: string
  x: number
  z: number
  range_m: number
}

interface MiniDwgViewportProps {
  fixtures: MiniFixture[]
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  classifications?: MiniClassification[]
  rois?: MiniRoi[]
  lidars?: MiniLidar[]
  height?: number | string
  mode: 'fixtures' | 'classification' | 'rois' | 'lidars'
  onLidarUpdate?: (id: string, x: number, z: number) => void
  onLidarAdd?: (x: number, z: number) => void
  onLidarDelete?: (id: string) => void
}

// ─── Color Maps ─────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  shelf: '#60a5fa',           // blue-400
  fridge: '#22d3ee',          // cyan-400
  wall: '#9ca3af',            // gray-400
  checkout: '#c084fc',        // purple-400
  entrance: '#34d399',        // emerald-400
  pillar: '#94a3b8',          // slate-400
  digital_display: '#a78bfa', // violet-400
  radio: '#f472b6',           // pink-400
  custom: '#fbbf24',          // amber-400
  unknown: '#4b5563',         // gray-600
}

const DEFAULT_COLOR = '#374151' // gray-700

// ─── Outlier Detection ──────────────────────────────────────────

function computeFixtureBBox(f: MiniFixture): { minX: number; minY: number; maxX: number; maxY: number } {
  if (f.points && f.points.length >= 3) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of f.points) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
    return { minX, minY, maxX, maxY }
  }
  const hw = Math.abs(f.w) / 2, hd = Math.abs(f.d) / 2
  return { minX: f.x - hw, minY: f.y - hd, maxX: f.x + hw, maxY: f.y + hd }
}

// ─── Bounds calculation from all fixtures ────────────────────────

function calcBounds(
  fixtures: MiniFixture[],
  rois?: MiniRoi[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const f of fixtures) {
    const bb = computeFixtureBBox(f)
    minX = Math.min(minX, bb.minX)
    minY = Math.min(minY, bb.minY)
    maxX = Math.max(maxX, bb.maxX)
    maxY = Math.max(maxY, bb.maxY)
  }
  if (rois) {
    for (const roi of rois) {
      for (const v of roi.vertices) {
        minX = Math.min(minX, v.x)
        minY = Math.min(minY, v.y)
        maxX = Math.max(maxX, v.x)
        maxY = Math.max(maxY, v.y)
      }
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 100, maxY: 100 }
  return { minX, minY, maxX, maxY }
}

// ─── SVG Renderer (shared between inline + modal) ───────────────

interface DwgSvgProps {
  fixtures: MiniFixture[]
  rois?: MiniRoi[]
  lidars?: MiniLidar[]
  groupTypeMap: Map<string, { type: string; confidence: number }>
  mode: MiniDwgViewportProps['mode']
  vbX: number
  vbY: number
  vbW: number
  vbH: number
  sw: number
  className?: string
  onFixtureHover?: (fixture: MiniFixture | null, event?: React.MouseEvent) => void
}

function getFixtureColor(f: MiniFixture, mode: DwgSvgProps['mode'], groupTypeMap: DwgSvgProps['groupTypeMap']): string {
  if (mode === 'fixtures') return '#6366f1'
  if ((mode === 'classification' || mode === 'rois') && f.group_id) {
    const info = groupTypeMap.get(f.group_id)
    if (info && info.confidence >= 0.5) return TYPE_COLORS[info.type] || DEFAULT_COLOR
    return TYPE_COLORS.unknown
  }
  return DEFAULT_COLOR
}

function getFixtureOpacity(f: MiniFixture, mode: DwgSvgProps['mode'], groupTypeMap: DwgSvgProps['groupTypeMap']): number {
  if (mode === 'classification' && f.group_id) {
    const info = groupTypeMap.get(f.group_id)
    if (info) return Math.max(0.4, info.confidence)
  }
  return 0.7
}

function DwgSvg({ fixtures, rois, lidars, groupTypeMap, mode, vbX, vbY, vbW, vbH, sw, className, onFixtureHover }: DwgSvgProps) {
  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      preserveAspectRatio="xMidYMid meet"
      className={className || 'w-full h-full'}
      style={{ background: '#0a0a0f' }}
      onMouseLeave={() => onFixtureHover?.(null)}
    >
      {/* Fixtures */}
      {fixtures.map((f) => {
        const color = getFixtureColor(f, mode, groupTypeMap)
        const opacity = getFixtureOpacity(f, mode, groupTypeMap)
        const hoverHandlers = onFixtureHover ? {
          onMouseEnter: (e: React.MouseEvent) => onFixtureHover(f, e),
          onMouseMove: (e: React.MouseEvent) => onFixtureHover(f, e),
          style: { cursor: 'crosshair' as const },
        } : {}

        if (f.points && f.points.length >= 3) {
          const pts = f.points.map(p => `${p.x},${p.y}`).join(' ')
          return (
            <polygon
              key={f.id}
              points={pts}
              fill={color}
              fillOpacity={opacity * 0.6}
              stroke={color}
              strokeWidth={sw}
              strokeOpacity={opacity}
              {...hoverHandlers}
            />
          )
        }

        const absW = Math.abs(f.w) || 1
        const absD = Math.abs(f.d) || 1
        return (
          <rect
            key={f.id}
            x={-absW / 2}
            y={-absD / 2}
            width={absW}
            height={absD}
            fill={color}
            fillOpacity={opacity * 0.6}
            stroke={color}
            strokeWidth={sw}
            strokeOpacity={opacity}
            transform={`translate(${f.x}, ${f.y}) rotate(${f.rot_deg || 0})`}
            {...hoverHandlers}
          />
        )
      })}

      {/* ROI polygons — always visible when data exists */}
      {rois?.map((roi, i) => {
        const pts = roi.vertices.map(v => `${v.x},${v.y}`).join(' ')
        if (pts.length === 0) return null
        const color = roi.color || '#818cf8'
        return (
          <g key={`roi-${i}`}>
            <polygon
              points={pts}
              fill={color}
              fillOpacity={0.12}
              stroke={color}
              strokeWidth={sw * 3}
              strokeOpacity={0.8}
              strokeLinejoin="round"
            />
            {roi.vertices.length > 0 && (() => {
              const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
              const cy = roi.vertices.reduce((s, v) => s + v.y, 0) / roi.vertices.length
              return (
                <text
                  x={cx} y={cy}
                  fill={color}
                  fontSize={Math.max(vbW, vbH) * 0.022}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontWeight="600"
                  opacity={0.9}
                >
                  {roi.name}
                </text>
              )
            })()}
          </g>
        )
      })}

      {/* LiDAR coverage circles (dashed, low opacity — drawn first so dots are on top) */}
      {lidars?.map((l, i) => (
        <circle
          key={`lidar-range-${i}`}
          cx={l.x} cy={l.z} r={l.range_m}
          fill="rgba(34, 197, 94, 0.06)"
          stroke="rgba(34, 197, 94, 0.4)"
          strokeWidth={sw * 0.8}
          strokeDasharray={`${sw * 3} ${sw * 1.5}`}
        />
      ))}
      {/* LiDAR device markers (small dots with numbered labels) */}
      {lidars?.map((l, i) => {
        const dotR = sw * 3
        const innerR = sw * 1
        const fontSize = sw * 5
        return (
          <g key={`lidar-dot-${i}`}>
            {/* Outer colored dot */}
            <circle cx={l.x} cy={l.z} r={dotR}
              fill="#22c55e" stroke="#4ade80" strokeWidth={sw * 1.5}
            />
            {/* White inner dot */}
            <circle cx={l.x} cy={l.z} r={innerR}
              fill="white" pointerEvents="none"
            />
            {/* Number label */}
            <text
              x={l.x} y={l.z - dotR * 1.8}
              fill="#4ade80"
              fontSize={fontSize}
              textAnchor="middle"
              dominantBaseline="auto"
              fontWeight="700"
              pointerEvents="none"
            >
              {i + 1}
            </text>
            {/* Invisible hit area for hover tooltip */}
            <circle cx={l.x} cy={l.z} r={dotR * 2.5}
              fill="transparent" stroke="none"
              onMouseEnter={(e) => onFixtureHover?.(null, e)}
              onMouseLeave={() => onFixtureHover?.(null)}
            >
              <title>LiDAR #{i + 1}{'\n'}Position: ({l.x.toFixed(1)}, {l.z.toFixed(1)}){'\n'}Range: {l.range_m.toFixed(1)}</title>
            </circle>
          </g>
        )
      })}
    </svg>
  )
}

// ─── Modal Popup (interactive: zoom, pan, tooltip) ──────────────────

const TYPE_LABELS: Record<string, string> = {
  shelf: 'Shelf / Gondola',
  fridge: 'Fridge / Refrigeration',
  wall: 'Wall',
  checkout: 'Checkout / Cashier',
  entrance: 'Entrance',
  pillar: 'Pillar',
  digital_display: 'Digital Display',
  radio: 'Radio',
  custom: 'Custom',
  unknown: 'Unclassified',
}

interface ViewportModalProps extends DwgSvgProps {
  onClose: () => void
  onLidarUpdate?: (id: string, x: number, z: number) => void
  onLidarAdd?: (x: number, z: number) => void
  onLidarDelete?: (id: string) => void
}

function ViewportModal({ onClose, onLidarUpdate, onLidarAdd, onLidarDelete, ...svgProps }: ViewportModalProps) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const isLidarMode = svgProps.mode === 'lidars'

  // LiDAR interaction state
  const [activeTool, setActiveTool] = useState<'select' | 'add'>('select')
  const [draggingLidarIdx, setDraggingLidarIdx] = useState<number | null>(null)
  const [selectedLidarIdx, setSelectedLidarIdx] = useState<number | null>(null)
  const lidarDragStart = useRef<{ x: number; y: number; origX: number; origZ: number } | null>(null)
  const [localLidars, setLocalLidars] = useState<MiniLidar[]>(svgProps.lidars || [])
  const [hasChanges, setHasChanges] = useState(false)

  // Sync local lidars with props
  useEffect(() => { setLocalLidars(svgProps.lidars || []) }, [svgProps.lidars])

  // Tooltip state
  const [tooltip, setTooltip] = useState<{
    fixture: MiniFixture; type: string; confidence: number; mouseX: number; mouseY: number
  } | null>(null)
  const [lidarTooltip, setLidarTooltip] = useState<{
    lidar: MiniLidar; idx: number; mouseX: number; mouseY: number
  } | null>(null)

  // Compute zoomed viewBox
  const zoomedVb = useMemo(() => {
    const w = svgProps.vbW / zoom
    const h = svgProps.vbH / zoom
    const cx = svgProps.vbX + svgProps.vbW / 2 + pan.x
    const cy = svgProps.vbY + svgProps.vbH / 2 + pan.y
    return { x: cx - w / 2, y: cy - h / 2, w, h }
  }, [svgProps.vbX, svgProps.vbY, svgProps.vbW, svgProps.vbH, zoom, pan])

  // Convert screen coords → SVG world coords
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current
    if (!container) return { x: 0, y: 0 }
    const rect = container.getBoundingClientRect()
    const nx = (clientX - rect.left) / rect.width
    const ny = (clientY - rect.top) / rect.height
    return { x: zoomedVb.x + nx * zoomedVb.w, y: zoomedVb.y + ny * zoomedVb.h }
  }, [zoomedVb])

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setZoom(z => Math.max(0.5, Math.min(50, z * factor)))
  }, [])

  // Mouse handlers — pan OR lidar drag depending on state
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    if (isLidarMode && activeTool === 'add') {
      // Click-to-add LiDAR
      const world = screenToWorld(e.clientX, e.clientY)
      onLidarAdd?.(world.x, world.y)
      setHasChanges(true)
      return
    }
    // Check if clicking on a LiDAR dot (for drag)
    if (isLidarMode && activeTool === 'select' && localLidars.length > 0) {
      const world = screenToWorld(e.clientX, e.clientY)
      const sw = svgProps.sw / zoom
      const hitRadius = sw * 8
      for (let i = localLidars.length - 1; i >= 0; i--) {
        const l = localLidars[i]
        const dx = world.x - l.x, dy = world.y - l.z
        if (dx * dx + dy * dy < hitRadius * hitRadius) {
          e.stopPropagation()
          setDraggingLidarIdx(i)
          setSelectedLidarIdx(i)
          lidarDragStart.current = { x: e.clientX, y: e.clientY, origX: l.x, origZ: l.z }
          return
        }
      }
      setSelectedLidarIdx(null)
    }
    // Default: pan
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }, [pan, isLidarMode, activeTool, localLidars, screenToWorld, zoom, svgProps.sw, onLidarAdd])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // LiDAR drag
    if (draggingLidarIdx !== null && lidarDragStart.current) {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const scaleX = zoomedVb.w / rect.width
      const scaleY = zoomedVb.h / rect.height
      const dx = (e.clientX - lidarDragStart.current.x) * scaleX
      const dy = (e.clientY - lidarDragStart.current.y) * scaleY
      setLocalLidars(prev => prev.map((l, i) => i === draggingLidarIdx
        ? { ...l, x: lidarDragStart.current!.origX + dx, z: lidarDragStart.current!.origZ + dy }
        : l
      ))
      return
    }
    // LiDAR hover tooltip
    if (isLidarMode && !dragging) {
      const world = screenToWorld(e.clientX, e.clientY)
      const sw = svgProps.sw / zoom
      const hitRadius = sw * 8
      for (let i = localLidars.length - 1; i >= 0; i--) {
        const l = localLidars[i]
        const dx = world.x - l.x, dy = world.y - l.z
        if (dx * dx + dy * dy < hitRadius * hitRadius) {
          setLidarTooltip({ lidar: l, idx: i, mouseX: e.clientX, mouseY: e.clientY })
          return
        }
      }
      setLidarTooltip(null)
    }
    // Pan
    if (!dragging) return
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const scaleX = svgProps.vbW / zoom / rect.width
    const scaleY = svgProps.vbH / zoom / rect.height
    const dx = (e.clientX - dragStart.current.x) * scaleX
    const dy = (e.clientY - dragStart.current.y) * scaleY
    setPan({ x: dragStart.current.panX - dx, y: dragStart.current.panY - dy })
  }, [dragging, draggingLidarIdx, zoom, svgProps.vbW, svgProps.vbH, svgProps.sw, zoomedVb, isLidarMode, localLidars, screenToWorld])

  const handleMouseUp = useCallback(() => {
    if (draggingLidarIdx !== null) {
      const l = localLidars[draggingLidarIdx]
      if (l?.id) onLidarUpdate?.(l.id, l.x, l.z)
      setHasChanges(true)
      setDraggingLidarIdx(null)
      lidarDragStart.current = null
      return
    }
    setDragging(false)
  }, [draggingLidarIdx, localLidars, onLidarUpdate])

  // Close drag on window mouseup
  useEffect(() => {
    const up = () => { setDragging(false); setDraggingLidarIdx(null); lidarDragStart.current = null }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // Keyboard: Escape to close, Delete to remove selected LiDAR
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if ((e.key === 'Delete' || e.key === 'Backspace') && isLidarMode && selectedLidarIdx !== null) {
        const l = localLidars[selectedLidarIdx]
        if (l?.id) onLidarDelete?.(l.id)
        setSelectedLidarIdx(null)
        setHasChanges(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, isLidarMode, selectedLidarIdx, localLidars, onLidarDelete])

  // Fixture hover callback
  const handleFixtureHover = useCallback((fixture: MiniFixture | null, event?: React.MouseEvent) => {
    if (!fixture || !event) { setTooltip(null); return }
    const info = svgProps.groupTypeMap.get(fixture.group_id || '')
    setTooltip({ fixture, type: info?.type || 'unknown', confidence: info?.confidence || 0, mouseX: event.clientX, mouseY: event.clientY })
  }, [svgProps.groupTypeMap])

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  const handleDeleteSelected = useCallback(() => {
    if (selectedLidarIdx === null) return
    const l = localLidars[selectedLidarIdx]
    if (l?.id) onLidarDelete?.(l.id)
    setSelectedLidarIdx(null)
    setHasChanges(true)
  }, [selectedLidarIdx, localLidars, onLidarDelete])

  const modalTitle = svgProps.mode === 'fixtures' ? 'Floor Plan Preview'
    : svgProps.mode === 'classification' ? 'Fixture Classification'
    : svgProps.mode === 'rois' ? 'ROI Zones'
    : 'LiDAR Coverage'

  const cursorStyle = isLidarMode && activeTool === 'add' ? 'crosshair'
    : draggingLidarIdx !== null ? 'grabbing'
    : dragging ? 'grabbing' : 'grab'

  // Build lidars with selected highlight for the SVG
  const displayLidars = isLidarMode ? localLidars : svgProps.lidars

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[90vw] h-[85vh] max-w-[1400px] bg-gray-950 border border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 font-medium">{modalTitle}</span>
            <span className="text-[10px] text-gray-600">{Math.round(zoom * 100)}%</span>
            {isLidarMode && <span className="text-[10px] text-green-400">{localLidars.length} sensors</span>}
          </div>
          <div className="flex items-center gap-1">
            {/* LiDAR tools — only in lidars mode with callbacks */}
            {isLidarMode && onLidarAdd && (
              <>
                <button
                  onClick={() => setActiveTool('select')}
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${activeTool === 'select' ? 'bg-green-500/20 text-green-400' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                  title="Select / Move LiDAR"
                ><MousePointer className="w-3.5 h-3.5" /></button>
                <button
                  onClick={() => setActiveTool('add')}
                  className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${activeTool === 'add' ? 'bg-blue-500/20 text-blue-400' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                  title="Add LiDAR (click to place)"
                ><Plus className="w-3.5 h-3.5" /></button>
                {selectedLidarIdx !== null && onLidarDelete && (
                  <button
                    onClick={handleDeleteSelected}
                    className="w-7 h-7 flex items-center justify-center text-red-400 hover:text-red-300 rounded-md hover:bg-red-500/10 transition-colors"
                    title="Delete selected LiDAR"
                  ><Trash2 className="w-3.5 h-3.5" /></button>
                )}
                <div className="w-px h-5 bg-gray-800 mx-1" />
              </>
            )}
            <button onClick={() => setZoom(z => Math.min(50, z * 1.5))} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Zoom In"><ZoomIn className="w-3.5 h-3.5" /></button>
            <button onClick={() => setZoom(z => Math.max(0.5, z / 1.5))} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Zoom Out"><ZoomOut className="w-3.5 h-3.5" /></button>
            <button onClick={resetView} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Reset View"><RotateCcw className="w-3.5 h-3.5" /></button>
            <div className="w-px h-5 bg-gray-800 mx-1" />
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Interactive SVG area */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden"
          style={{ cursor: cursorStyle }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        >
          <DwgSvg
            {...svgProps}
            lidars={displayLidars}
            vbX={zoomedVb.x}
            vbY={zoomedVb.y}
            vbW={zoomedVb.w}
            vbH={zoomedVb.h}
            sw={svgProps.sw / zoom}
            className="w-full h-full"
            onFixtureHover={handleFixtureHover}
          />
          {/* Selected LiDAR highlight ring */}
          {isLidarMode && selectedLidarIdx !== null && localLidars[selectedLidarIdx] && (() => {
            const l = localLidars[selectedLidarIdx]
            const sw2 = svgProps.sw / zoom
            return (
              <svg
                viewBox={`${zoomedVb.x} ${zoomedVb.y} ${zoomedVb.w} ${zoomedVb.h}`}
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 w-full h-full pointer-events-none"
              >
                <circle cx={l.x} cy={l.z} r={sw2 * 5} fill="none" stroke="#3b82f6" strokeWidth={sw2 * 1.5} strokeDasharray={`${sw2 * 2} ${sw2}`} />
              </svg>
            )
          })()}
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-3 py-1.5 bg-gray-950 border-t border-gray-800 shrink-0">
          <div className="text-[9px] text-gray-600">
            {isLidarMode && activeTool === 'add' ? 'Click to place LiDAR · ESC to cancel' :
             isLidarMode ? 'Drag LiDAR to reposition · Del to remove · Scroll to zoom' :
             'Scroll to zoom · Drag to pan'}
          </div>
          {isLidarMode && hasChanges && (
            <div className="text-[9px] text-amber-400">Changes saved automatically</div>
          )}
        </div>
      </div>

      {/* Floating tooltip — fixture */}
      {tooltip && (
        <div className="fixed z-[110] pointer-events-none px-2.5 py-1.5 rounded-md bg-gray-900 border border-gray-700 shadow-lg text-[11px] leading-relaxed"
          style={{ left: tooltip.mouseX + 14, top: tooltip.mouseY - 10 }}>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: TYPE_COLORS[tooltip.type] || DEFAULT_COLOR }} />
            <span className="text-gray-200 font-medium">{TYPE_LABELS[tooltip.type] || tooltip.type}</span>
          </div>
          {tooltip.fixture.group_id && <div className="text-gray-500 mt-0.5">Group: {tooltip.fixture.group_id.slice(0, 12)}</div>}
          <div className="text-gray-500">Confidence: {(tooltip.confidence * 100).toFixed(0)}%</div>
        </div>
      )}
      {/* Floating tooltip — LiDAR */}
      {lidarTooltip && !draggingLidarIdx && (
        <div className="fixed z-[110] pointer-events-none px-2.5 py-1.5 rounded-md bg-gray-900 border border-gray-700 shadow-lg text-[11px] leading-relaxed"
          style={{ left: lidarTooltip.mouseX + 14, top: lidarTooltip.mouseY - 10 }}>
          <div className="text-green-400 font-medium">LiDAR #{lidarTooltip.idx + 1}</div>
          <div className="text-gray-500">Range: {lidarTooltip.lidar.range_m.toFixed(1)}m</div>
          <div className="text-gray-500">Pos: ({lidarTooltip.lidar.x.toFixed(0)}, {lidarTooltip.lidar.z.toFixed(0)})</div>
          {lidarTooltip.lidar.id && <div className="text-gray-600 text-[9px]">{lidarTooltip.lidar.id.slice(0, 8)}</div>}
        </div>
      )}
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────
const MODE_LABELS = {
  fixtures: 'Floor plan',
  classification: 'Fixture types',
  rois: 'ROI zones',
  lidars: 'LiDAR coverage',
}

export default function MiniDwgViewport({
  fixtures,
  bounds: _propBounds,
  classifications,
  rois,
  lidars,
  height = 200 as number | string,
  mode,
  onLidarUpdate,
  onLidarAdd,
  onLidarDelete,
}: MiniDwgViewportProps) {
  const [showModal, setShowModal] = useState(false)
  const openModal = useCallback(() => setShowModal(true), [])
  const closeModal = useCallback(() => setShowModal(false), [])

  // Build group → type map
  const groupTypeMap = useMemo(() => {
    const map = new Map<string, { type: string; confidence: number }>()
    if (classifications) {
      for (const c of classifications) map.set(c.groupId, { type: c.suggestedType, confidence: c.confidence })
    }
    return map
  }, [classifications])

  // Compute robust viewport bounds using median + MAD (Median Absolute Deviation).
  // MAD is immune to outliers — a few stranded fixtures can't blow up the viewport.
  const bounds = useMemo(() => {
    if (fixtures.length < 20) return calcBounds(fixtures, rois)

    const xs = fixtures.map(f => f.x).sort((a, b) => a - b)
    const ys = fixtures.map(f => f.y).sort((a, b) => a - b)
    const n = xs.length

    const medianX = xs[Math.floor(n / 2)]
    const medianY = ys[Math.floor(n / 2)]

    // MAD = median of |x - median(x)|
    const devX = fixtures.map(f => Math.abs(f.x - medianX)).sort((a, b) => a - b)
    const devY = fixtures.map(f => Math.abs(f.y - medianY)).sort((a, b) => a - b)
    const madX = devX[Math.floor(n / 2)]
    const madY = devY[Math.floor(n / 2)]

    // Use median ± 6*MAD — very generous, keeps all floor plan elements
    const spread = 6
    let minX = medianX - spread * Math.max(madX, 1)
    let maxX = medianX + spread * Math.max(madX, 1)
    let minY = medianY - spread * Math.max(madY, 1)
    let maxY = medianY + spread * Math.max(madY, 1)

    // Also include ROI vertices
    if (rois) {
      for (const roi of rois) {
        for (const v of roi.vertices) {
          minX = Math.min(minX, v.x)
          minY = Math.min(minY, v.y)
          maxX = Math.max(maxX, v.x)
          maxY = Math.max(maxY, v.y)
        }
      }
    }

    return { minX, minY, maxX, maxY }
  }, [fixtures, rois])

  // Viewport geometry
  const pad = Math.max((bounds.maxX - bounds.minX), (bounds.maxY - bounds.minY)) * 0.06
  const vbX = bounds.minX - pad
  const vbY = bounds.minY - pad
  const vbW = (bounds.maxX - bounds.minX) + pad * 2
  const vbH = (bounds.maxY - bounds.minY) + pad * 2
  const sw = Math.max(vbW, vbH) * 0.003

  if (fixtures.length === 0 && (!rois || rois.length === 0) && (!lidars || lidars.length === 0)) {
    return (
      <div
        className="flex items-center justify-center bg-gray-900 rounded-md border border-gray-800 text-[10px] text-gray-600"
        style={{ height }}
      >
        No geometry data
      </div>
    )
  }

  const svgProps: DwgSvgProps = {
    fixtures,
    rois,
    lidars,
    groupTypeMap,
    mode,
    vbX, vbY, vbW, vbH, sw,
  }

  return (
    <>
      <div
        className="relative rounded-md overflow-hidden border border-gray-800 bg-gray-950 cursor-pointer group"
        style={{ height }}
        onClick={openModal}
        title="Click to expand"
      >
        <DwgSvg {...svgProps} />

        {/* Expand hint */}
        <div className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded bg-gray-900/80 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
          <Maximize2 className="w-3.5 h-3.5" />
        </div>

        {/* Bottom bar */}
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-t from-gray-950 to-transparent">
          <span className="text-[9px] text-gray-500">{MODE_LABELS[mode]}</span>
        </div>
      </div>

      {/* Full-screen modal */}
      {showModal && <ViewportModal {...svgProps} onClose={closeModal} onLidarUpdate={onLidarUpdate} onLidarAdd={onLidarAdd} onLidarDelete={onLidarDelete} />}
    </>
  )
}
