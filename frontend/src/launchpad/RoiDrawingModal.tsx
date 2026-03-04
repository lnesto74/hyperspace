/**
 * RoiDrawingModal — Full-screen modal for drawing polygonal ROIs on the 2D floor plan.
 * 
 * Similar to the draw_roi tool in PreviewPanel but embedded in a modal popup
 * so the user can draw ROIs directly from the LaunchPad without navigating away.
 * 
 * Features:
 * - Click to add polygon vertices on the DWG floor plan
 * - Visual feedback: line preview, vertex dots, filled polygon
 * - Name input, color picker, undo last vertex
 * - Save via existing ROI API
 * - Delete existing ROIs
 * - Zoom + pan (scroll wheel + drag)
 */

import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import {
  X, ZoomIn, ZoomOut, RotateCcw, Pencil, Check, Undo2, Trash2, Plus, MousePointer2,
} from 'lucide-react'
import { API_BASE } from '../config/api'
import type { MiniFixture, MiniClassification, MiniRoi } from './MiniDwgViewport'

// ─── Types ──────────────────────────────────────────────────────

interface RoiDrawingModalProps {
  onClose: () => void
  fixtures: MiniFixture[]
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  classifications?: MiniClassification[]
  existingRois: MiniRoi[]
  venueId: string
  dwgLayoutId?: string
  /** Called after a ROI is saved or deleted so parent can refresh */
  onRoiChanged: () => void
  /** DXF unit → meters conversion factor */
  unitScaleToM?: number
}

interface SavedRoi {
  id: string
  name: string
  color: string
  vertices: Array<{ x: number; y: number }>
}

// ─── Constants ──────────────────────────────────────────────────

const ROI_COLORS = [
  '#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316',
]

const TYPE_COLORS: Record<string, string> = {
  shelf: '#60a5fa', fridge: '#22d3ee', wall: '#9ca3af', checkout: '#c084fc',
  entrance: '#34d399', pillar: '#94a3b8', digital_display: '#a78bfa',
  radio: '#f472b6', custom: '#fbbf24', unknown: '#4b5563',
}

// ─── Component ──────────────────────────────────────────────────

export default function RoiDrawingModal({
  onClose, fixtures, bounds: propBounds, classifications, existingRois,
  venueId, dwgLayoutId, onRoiChanged, unitScaleToM = 0.001,
}: RoiDrawingModalProps) {
  // Drawing state: isDrawing = adding vertices, isClosed = polygon closed (editing/reshaping)
  const [isDrawing, setIsDrawing] = useState(false)
  const [isClosed, setIsClosed] = useState(false)
  const [vertices, setVertices] = useState<Array<{ x: number; y: number }>>([])
  const [roiName, setRoiName] = useState('')
  const [roiColor, setRoiColor] = useState(ROI_COLORS[0])
  const [editingRoiId, setEditingRoiId] = useState<string | null>(null) // ID of saved ROI being edited
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [snapIdx, setSnapIdx] = useState<number | null>(null) // index of vertex cursor is snapping to
  const [dragVertexIdx, setDragVertexIdx] = useState<number | null>(null) // vertex being dragged
  const wasVertexInteraction = useRef(false) // suppress click after vertex mouseUp

  // Saved ROIs (loaded from API for delete support)
  const [savedRois, setSavedRois] = useState<SavedRoi[]>([])

  // Zoom / pan
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Build group type map
  const groupTypeMap = useMemo(() => {
    const map = new Map<string, { type: string; confidence: number }>()
    if (classifications) {
      for (const c of classifications) map.set(c.groupId, { type: c.suggestedType, confidence: c.confidence })
    }
    return map
  }, [classifications])

  // Compute bounds (MAD-based for outlier resistance — same as MiniDwgViewport)
  const bounds = useMemo(() => {
    if (fixtures.length === 0) return propBounds || { minX: 0, minY: 0, maxX: 100, maxY: 100 }

    let minX: number, minY: number, maxX: number, maxY: number

    if (fixtures.length < 20) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity
      for (const f of fixtures) {
        minX = Math.min(minX, f.x); minY = Math.min(minY, f.y)
        maxX = Math.max(maxX, f.x); maxY = Math.max(maxY, f.y)
      }
    } else {
      const xs = fixtures.map(f => f.x).sort((a, b) => a - b)
      const ys = fixtures.map(f => f.y).sort((a, b) => a - b)
      const n = xs.length
      const medX = xs[Math.floor(n / 2)], medY = ys[Math.floor(n / 2)]
      const madX = fixtures.map(f => Math.abs(f.x - medX)).sort((a, b) => a - b)[Math.floor(n / 2)]
      const madY = fixtures.map(f => Math.abs(f.y - medY)).sort((a, b) => a - b)[Math.floor(n / 2)]
      const spread = 6
      minX = medX - spread * Math.max(madX, 1); maxX = medX + spread * Math.max(madX, 1)
      minY = medY - spread * Math.max(madY, 1); maxY = medY + spread * Math.max(madY, 1)
    }

    // Also include ROI vertices so they're never clipped
    const allRois = [...existingRois, ...savedRois]
    for (const roi of allRois) {
      for (const v of roi.vertices) {
        minX = Math.min(minX, v.x); minY = Math.min(minY, v.y)
        maxX = Math.max(maxX, v.x); maxY = Math.max(maxY, v.y)
      }
    }

    return { minX, minY, maxX, maxY }
  }, [fixtures, propBounds, existingRois, savedRois])

  // Viewport geometry
  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.06
  const baseVbX = bounds.minX - pad
  const baseVbY = bounds.minY - pad
  const baseVbW = (bounds.maxX - bounds.minX) + pad * 2
  const baseVbH = (bounds.maxY - bounds.minY) + pad * 2
  const sw = Math.max(baseVbW, baseVbH) * 0.003

  // Zoomed viewBox
  const vb = useMemo(() => {
    const w = baseVbW / zoom, h = baseVbH / zoom
    const cx = baseVbX + baseVbW / 2 + pan.x
    const cy = baseVbY + baseVbH / 2 + pan.y
    return { x: cx - w / 2, y: cy - h / 2, w, h }
  }, [baseVbX, baseVbY, baseVbW, baseVbH, zoom, pan])

  // Load saved ROIs from API on mount (for delete support)
  useEffect(() => {
    const url = dwgLayoutId
      ? `${API_BASE}/api/venues/${venueId}/dwg/${dwgLayoutId}/roi`
      : `${API_BASE}/api/venues/${venueId}/roi`
    fetch(url).then(r => r.ok ? r.json() : []).then(data => {
      const rois: SavedRoi[] = (data || []).map((r: any) => {
        let verts: Array<{ x: number; y: number }> = []
        try {
          const parsed = typeof r.vertices === 'string' ? JSON.parse(r.vertices) : r.vertices
          verts = Array.isArray(parsed) ? parsed.map((v: any) => ({ x: v.x ?? v[0], y: v.y ?? v.z ?? v[1] })) : []
        } catch { /* bad JSON */ }
        return { id: r.id, name: r.name, color: r.color || '#818cf8', vertices: verts }
      })
      setSavedRois(rois)
    }).catch(() => {})
  }, [venueId, dwgLayoutId])

  // Screen → SVG coordinate conversion
  const screenToSvg = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const svgPt = pt.matrixTransform(ctm.inverse())
    return { x: svgPt.x, y: svgPt.y }
  }, [])

  // Snap radius in SVG units (scales with zoom so it feels consistent)
  const snapRadius = useMemo(() => Math.max(baseVbW, baseVbH) * 0.012 / zoom, [baseVbW, baseVbH, zoom])

  // Click handler — add vertex or snap-close to editing mode
  const handleSvgClick = useCallback((e: React.MouseEvent) => {
    // Suppress click that fires after a vertex drag mouseUp
    if (wasVertexInteraction.current) { wasVertexInteraction.current = false; return }
    if (!isDrawing || isClosed || dragging || dragVertexIdx !== null) return
    const pt = screenToSvg(e.clientX, e.clientY)
    if (!pt) return

    // Magnetic snap: if near first vertex and we have 3+, close the polygon → editing mode
    if (vertices.length >= 3) {
      const dx = pt.x - vertices[0].x, dy = pt.y - vertices[0].y
      if (Math.hypot(dx, dy) < snapRadius) {
        setIsClosed(true)
        setCursorPos(null)
        setSnapIdx(null)
        return
      }
    }

    // Snap to any existing vertex (avoid near-duplicates)
    for (let i = 0; i < vertices.length; i++) {
      const dx = pt.x - vertices[i].x, dy = pt.y - vertices[i].y
      if (Math.hypot(dx, dy) < snapRadius) {
        return // too close to existing vertex, skip
      }
    }

    setVertices(prev => [...prev, pt])
  }, [isDrawing, isClosed, dragging, dragVertexIdx, screenToSvg, vertices, snapRadius])

  // Mouse move — track cursor, snap detection, vertex drag
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Pan drag
    if (dragging && dragVertexIdx === null) {
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const scaleX = baseVbW / zoom / rect.width
      const scaleY = baseVbH / zoom / rect.height
      const dx = (e.clientX - dragStart.current.x) * scaleX
      const dy = (e.clientY - dragStart.current.y) * scaleY
      setPan({ x: dragStart.current.panX - dx, y: dragStart.current.panY - dy })
      return
    }

    // Vertex drag in progress (works in both drawing and closed/editing mode)
    if (dragVertexIdx !== null) {
      const pt = screenToSvg(e.clientX, e.clientY)
      if (pt) {
        setVertices(prev => prev.map((v, i) => i === dragVertexIdx ? pt : v))
      }
      return
    }

    // Only show cursor preview line in drawing mode (not closed)
    if (isDrawing && !isClosed) {
      const pt = screenToSvg(e.clientX, e.clientY)
      setCursorPos(pt)

      // Detect snap target
      if (pt && vertices.length >= 3) {
        const dx = pt.x - vertices[0].x, dy = pt.y - vertices[0].y
        if (Math.hypot(dx, dy) < snapRadius) {
          setSnapIdx(0)
          return
        }
      }
      setSnapIdx(null)
    }
  }, [isDrawing, isClosed, dragging, dragVertexIdx, screenToSvg, zoom, baseVbW, baseVbH, vertices, snapRadius])

  // Pan start (middle mouse or when not in active drawing) + vertex drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canPan = !isDrawing || isClosed // can pan when not drawing, or when polygon is closed (editing)
    if (e.button === 1 || (e.button === 0 && canPan)) {
      setDragging(true)
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
      e.preventDefault()
    }
  }, [isDrawing, isClosed, pan])

  // Start dragging a vertex (called from vertex circle onMouseDown)
  // Special case: clicking vertex 0 with 3+ vertices during drawing → close polygon
  const handleVertexDragStart = useCallback((e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    e.preventDefault()
    if (idx === 0 && isDrawing && !isClosed && vertices.length >= 3) {
      wasVertexInteraction.current = true
      setIsClosed(true)
      setCursorPos(null)
      setSnapIdx(null)
      return
    }
    wasVertexInteraction.current = true
    setDragVertexIdx(idx)
  }, [isDrawing, isClosed, vertices.length])

  const handleMouseUp = useCallback(() => {
    if (dragVertexIdx !== null) wasVertexInteraction.current = true
    setDragging(false)
    setDragVertexIdx(null)
  }, [dragVertexIdx])

  // Wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setZoom(z => Math.max(0.5, Math.min(50, z * factor)))
  }, [])

  // Close drag on window mouseup (panning + vertex drag)
  useEffect(() => {
    const up = () => { setDragging(false); setDragVertexIdx(null) }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // Escape to close or cancel drawing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isDrawing || isClosed) { setIsDrawing(false); setIsClosed(false); setVertices([]); setCursorPos(null); setEditingRoiId(null) }
        else onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isDrawing, isClosed, onClose])

  // Start drawing
  const startDrawing = useCallback(() => {
    setIsDrawing(true)
    setIsClosed(false)
    setVertices([])
    setCursorPos(null)
    const nextIdx = savedRois.length + existingRois.length
    setRoiName(`Zone ${nextIdx + 1}`)
    setRoiColor(ROI_COLORS[nextIdx % ROI_COLORS.length])
  }, [savedRois.length, existingRois.length])

  // Undo last vertex
  const undoVertex = useCallback(() => {
    setVertices(prev => prev.slice(0, -1))
  }, [])

  // Cancel drawing
  const cancelDrawing = useCallback(() => {
    setIsDrawing(false)
    setIsClosed(false)
    setVertices([])
    setCursorPos(null)
    setEditingRoiId(null)
  }, [])

  // Edit an existing saved ROI — load its vertices into editing mode
  const editSavedRoi = useCallback((roi: SavedRoi) => {
    setVertices([...roi.vertices])
    setRoiName(roi.name)
    setRoiColor(roi.color || ROI_COLORS[0])
    setEditingRoiId(roi.id)
    setIsDrawing(true)
    setIsClosed(true)
    setCursorPos(null)
  }, [])

  // Save ROI — replaces all existing ROIs for this DWG layout
  const saveAndClose = useCallback(async () => {
    if (vertices.length < 3 || !venueId) return
    setIsDrawing(false)
    setIsClosed(false)
    setCursorPos(null)
    setEditingRoiId(null)
    setSaving(true)
    try {
      // If editing an existing ROI, delete only that one; otherwise delete all
      if (editingRoiId) {
        try { await fetch(`${API_BASE}/api/roi/${editingRoiId}`, { method: 'DELETE' }) } catch { /* ignore */ }
      } else {
        for (const old of savedRois) {
          if (old.id) {
            try { await fetch(`${API_BASE}/api/roi/${old.id}`, { method: 'DELETE' }) } catch { /* ignore */ }
          }
        }
      }

      const name = roiName.trim() || 'LiDAR Coverage'
      // Convert vertices to {x, z} format as expected by the ROI system
      const apiVertices = vertices.map(v => ({ x: v.x, z: v.y }))
      const url = dwgLayoutId
        ? `${API_BASE}/api/venues/${venueId}/dwg/${dwgLayoutId}/roi`
        : `${API_BASE}/api/venues/${venueId}/roi`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, vertices: apiVertices, color: roiColor, opacity: 0.5 }),
      })
      if (!res.ok) throw new Error('Failed to save ROI')
      const saved = await res.json()
      // Update local list: replace edited ROI or replace all
      const newRoi = {
        id: saved.id,
        name: saved.name,
        color: saved.color || roiColor,
        vertices: vertices,
      }
      if (editingRoiId) {
        setSavedRois(prev => prev.map(r => r.id === editingRoiId ? newRoi : r))
      } else {
        setSavedRois([newRoi])
      }
      setIsDrawing(false)
      setVertices([])
      setCursorPos(null)
      onRoiChanged()
      // Auto-close modal after successful save
      onClose()
    } catch (err) {
      console.error('[RoiDrawingModal] Save failed:', err)
      alert('Failed to save ROI. Check console for details.')
    } finally {
      setSaving(false)
    }
  }, [vertices, venueId, dwgLayoutId, roiName, roiColor, savedRois, editingRoiId, onRoiChanged, onClose])

  // Delete ROI
  const deleteRoi = useCallback(async (roiId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/roi/${roiId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      setSavedRois(prev => prev.filter(r => r.id !== roiId))
      onRoiChanged()
    } catch (err) {
      console.error('[RoiDrawingModal] Delete failed:', err)
    }
  }, [onRoiChanged])

  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }) }, [])

  // All ROIs to display (saved from API + any existing from geometry that aren't in savedRois)
  // Hide the ROI currently being edited (it's shown via the vertices state)
  const displayRois = useMemo(() => {
    const savedIds = new Set(savedRois.map(r => r.name))
    const fromGeometry = existingRois
      .filter(r => !savedIds.has(r.name))
      .map(r => ({ id: '', name: r.name, color: r.color, vertices: r.vertices }))
    const all = [...savedRois, ...fromGeometry]
    return editingRoiId ? all.filter(r => r.id !== editingRoiId) : all
  }, [savedRois, existingRois, editingRoiId])

  // ROI dimensions in meters
  const roiInfo = useMemo(() => {
    const roiVerts = (isClosed && vertices.length >= 3) ? vertices : (displayRois[0]?.vertices || [])
    if (roiVerts.length < 3) return null
    const xs = roiVerts.map(v => v.x)
    const ys = roiVerts.map(v => v.y)
    const widthM = (Math.max(...xs) - Math.min(...xs)) * unitScaleToM
    const heightM = (Math.max(...ys) - Math.min(...ys)) * unitScaleToM
    return { widthM, heightM, areaM2: widthM * heightM }
  }, [displayRois, vertices, isClosed, unitScaleToM])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-[90vw] h-[85vh] max-w-[1400px] bg-gray-950 border border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-950 border-b border-gray-800 shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 font-medium">Draw ROI Zones</span>
            <span className="text-[10px] text-gray-600">{Math.round(zoom * 100)}%</span>
            {isDrawing && !isClosed && (
              <span className="text-[10px] text-amber-400 flex items-center gap-1">
                <MousePointer2 className="w-3 h-3 animate-pulse" />
                Click to add points · {vertices.length} vertex{vertices.length !== 1 ? 'es' : ''}
              </span>
            )}
            {isClosed && (
              <span className="text-[10px] text-green-400 flex items-center gap-1">
                <Check className="w-3 h-3" />
                Polygon closed · Drag vertices to adjust · Then Save & Close
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setZoom(z => Math.min(50, z * 1.5))} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Zoom In"><ZoomIn className="w-3.5 h-3.5" /></button>
            <button onClick={() => setZoom(z => Math.max(0.5, z / 1.5))} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Zoom Out"><ZoomOut className="w-3.5 h-3.5" /></button>
            <button onClick={resetView} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors" title="Reset View"><RotateCcw className="w-3.5 h-3.5" /></button>
            <div className="w-px h-5 bg-gray-800 mx-1" />
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-white rounded-md hover:bg-gray-800 transition-colors"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Main content: SVG + sidebar */}
        <div className="flex-1 flex overflow-hidden">
          {/* SVG viewport */}
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden"
            style={{ cursor: (isDrawing && !isClosed) ? 'crosshair' : (dragging ? 'grabbing' : 'grab') }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            <svg
              ref={svgRef}
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              preserveAspectRatio="xMidYMid meet"
              className="w-full h-full"
              style={{ background: '#0a0a0f' }}
              onClick={handleSvgClick}
            >
              {/* Fixtures */}
              {fixtures.map(f => {
                const info = f.group_id ? groupTypeMap.get(f.group_id) : null
                const color = info && info.confidence >= 0.5
                  ? (TYPE_COLORS[info.type] || '#374151')
                  : '#374151'
                const opacity = 0.5

                if (f.points && f.points.length >= 3) {
                  const pts = f.points.map(p => `${p.x},${p.y}`).join(' ')
                  return <polygon key={f.id} points={pts} fill={color} fillOpacity={opacity * 0.6} stroke={color} strokeWidth={sw / zoom} strokeOpacity={opacity} />
                }
                const absW = Math.abs(f.w) || 1, absD = Math.abs(f.d) || 1
                return (
                  <rect key={f.id} x={-absW / 2} y={-absD / 2} width={absW} height={absD}
                    fill={color} fillOpacity={opacity * 0.6} stroke={color} strokeWidth={sw / zoom} strokeOpacity={opacity}
                    transform={`translate(${f.x}, ${f.y}) rotate(${f.rot_deg || 0})`}
                  />
                )
              })}

              {/* Existing ROIs */}
              {displayRois.map((roi, i) => {
                if (roi.vertices.length < 3) return null
                const pts = roi.vertices.map(v => `${v.x},${v.y}`).join(' ')
                const c = roi.color || '#818cf8'
                const cx = roi.vertices.reduce((s, v) => s + v.x, 0) / roi.vertices.length
                const cy = roi.vertices.reduce((s, v) => s + v.y, 0) / roi.vertices.length
                return (
                  <g key={`roi-${i}`}>
                    <polygon points={pts} fill={c} fillOpacity={0.15} stroke={c} strokeWidth={sw * 3 / zoom} strokeOpacity={0.8} strokeLinejoin="round" />
                    <text x={cx} y={cy} fill={c} fontSize={Math.max(vb.w, vb.h) * 0.022} textAnchor="middle" dominantBaseline="middle" fontWeight="600" opacity={0.9}>{roi.name}</text>
                    {/* Vertex dots — click to edit */}
                    {roi.vertices.map((v, vi) => (
                      <circle key={vi} cx={v.x} cy={v.y} r={sw * 4 / zoom} fill={c} fillOpacity={0.9} stroke="#000" strokeWidth={sw / zoom}
                        style={{ cursor: (!isDrawing && !isClosed && roi.id) ? 'pointer' : 'default' }}
                        onMouseDown={e => {
                          if (!isDrawing && !isClosed && roi.id) {
                            e.stopPropagation()
                            e.preventDefault()
                            editSavedRoi(roi)
                          }
                        }}
                      />
                    ))}
                  </g>
                )
              })}

              {/* Drawing-in-progress polygon (both drawing and closed/editing phases) */}
              {(isDrawing || isClosed) && vertices.length > 0 && (
                <g>
                  {/* Filled polygon preview (if 3+ vertices) */}
                  {vertices.length >= 3 && (
                    <polygon
                      points={vertices.map(v => `${v.x},${v.y}`).join(' ')}
                      fill={roiColor} fillOpacity={isClosed ? 0.2 : 0.15}
                      stroke={isClosed ? roiColor : 'none'}
                      strokeWidth={isClosed ? sw * 3 / zoom : 0}
                      strokeOpacity={0.8}
                      strokeLinejoin="round"
                    />
                  )}
                  {/* Edge lines (only in drawing mode, closed mode uses polygon stroke) */}
                  {!isClosed && vertices.map((v, i) => {
                    if (i === 0) return null
                    const prev = vertices[i - 1]
                    return <line key={`edge-${i}`} x1={prev.x} y1={prev.y} x2={v.x} y2={v.y} stroke={roiColor} strokeWidth={sw * 2.5 / zoom} strokeOpacity={0.9} />
                  })}
                  {/* Closing line to first vertex (dashed, only in drawing mode) */}
                  {!isClosed && vertices.length >= 3 && (
                    <line
                      x1={vertices[vertices.length - 1].x} y1={vertices[vertices.length - 1].y}
                      x2={vertices[0].x} y2={vertices[0].y}
                      stroke={roiColor} strokeWidth={sw * 1.5 / zoom} strokeOpacity={0.4}
                      strokeDasharray={`${sw * 4 / zoom} ${sw * 2 / zoom}`}
                    />
                  )}
                  {/* Cursor preview line (only in drawing mode, not closed) */}
                  {!isClosed && cursorPos && vertices.length > 0 && (
                    <line
                      x1={vertices[vertices.length - 1].x} y1={vertices[vertices.length - 1].y}
                      x2={cursorPos.x} y2={cursorPos.y}
                      stroke={roiColor} strokeWidth={sw * 2 / zoom} strokeOpacity={0.5}
                      strokeDasharray={`${sw * 3 / zoom} ${sw * 2 / zoom}`}
                    />
                  )}
                  {/* Snap indicator ring on first vertex (only in drawing mode) */}
                  {!isClosed && vertices.length >= 3 && snapIdx === 0 && (
                    <circle cx={vertices[0].x} cy={vertices[0].y} r={snapRadius}
                      fill="none" stroke="#fff" strokeWidth={sw * 2 / zoom}
                      strokeDasharray={`${sw * 3 / zoom} ${sw * 2 / zoom}`}
                      opacity={0.7}
                    />
                  )}
                  {/* Vertex dots — draggable */}
                  {vertices.map((v, i) => (
                    <circle key={`vx-${i}`} cx={v.x} cy={v.y} r={sw * 4 / zoom}
                      fill={i === 0 ? (snapIdx === 0 ? '#4ade80' : '#fff') : roiColor} fillOpacity={0.9}
                      stroke={roiColor} strokeWidth={sw * 1.5 / zoom}
                      style={{ cursor: 'grab' }}
                      onMouseDown={e => handleVertexDragStart(e, i)}
                    />
                  ))}
                </g>
              )}
            </svg>
          </div>

          {/* Right sidebar — ROI list + drawing controls */}
          <div className="w-64 border-l border-gray-800 bg-gray-900 flex flex-col shrink-0">
            {/* Drawing controls */}
            <div className="p-3 border-b border-gray-800 space-y-2.5">
              {(isDrawing || isClosed) ? (
                <>
                  <div className="flex items-center gap-2 text-xs font-medium" style={{ color: isClosed ? '#4ade80' : '#fbbf24' }}>
                    {isClosed ? <Check className="w-3.5 h-3.5" /> : <Pencil className="w-3.5 h-3.5" />}
                    {isClosed ? 'Editing Mode' : 'Drawing Mode'}
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    {isClosed
                      ? 'Drag vertices to adjust the shape. Then Save & Close.'
                      : 'Click on the floor plan to add vertices. Click near first vertex to close.'}
                  </p>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">Zone Name</label>
                    <input
                      type="text"
                      value={roiName}
                      onChange={e => setRoiName(e.target.value)}
                      placeholder="Enter zone name"
                      className="w-full px-2 py-1.5 text-xs bg-gray-800 border border-gray-700 rounded text-white focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 mb-1 block">Color</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {ROI_COLORS.map(c => (
                        <button
                          key={c}
                          onClick={() => setRoiColor(c)}
                          className={`w-5 h-5 rounded-full border-2 transition-all ${roiColor === c ? 'border-white scale-110' : 'border-transparent hover:border-gray-500'}`}
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-600">
                    Vertices: {vertices.length}
                  </div>
                  <div className="flex gap-1.5">
                    {!isClosed && (
                      <button
                        onClick={undoVertex}
                        disabled={vertices.length === 0}
                        className="flex-1 h-7 flex items-center justify-center gap-1 text-[11px] border border-gray-700 rounded-md text-gray-400 hover:text-white hover:border-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Undo2 className="w-3 h-3" /> Undo
                      </button>
                    )}
                    <button
                      onClick={cancelDrawing}
                      className="flex-1 h-7 flex items-center justify-center gap-1 text-[11px] border border-red-500/40 rounded-md text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <X className="w-3 h-3" /> Cancel
                    </button>
                  </div>
                  <button
                    onClick={saveAndClose}
                    disabled={!isClosed || vertices.length < 3 || saving}
                    className="w-full h-8 flex items-center justify-center gap-1.5 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs font-medium rounded-md transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {saving ? 'Saving...' : isClosed ? `Save & Close (${vertices.length} pts)` : 'Close polygon first'}
                  </button>
                </>
              ) : (
                <button
                  onClick={startDrawing}
                  className="w-full h-9 flex items-center justify-center gap-2 bg-amber-500/15 border border-amber-500/30 rounded-lg text-amber-400 hover:bg-amber-500/25 transition-colors text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Draw New Zone
                </button>
              )}
            </div>

            {/* ROI list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 scrollbar-thin scrollbar-thumb-gray-700">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1">
                Zones ({displayRois.length})
              </div>
              {displayRois.length === 0 && (
                <p className="text-[10px] text-gray-600 italic">No zones defined yet. Click "Draw New Zone" to start.</p>
              )}
              {displayRois.map((roi, i) => (
                <div
                  key={roi.id || `geo-${i}`}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.05] group"
                >
                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: roi.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-gray-300 truncate">{roi.name}</div>
                    <div className="text-[9px] text-gray-600">{roi.vertices.length} vertices</div>
                  </div>
                  {roi.id && (
                    <button
                      onClick={() => deleteRoi(roi.id)}
                      className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      title="Delete zone"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* ROI Dimensions */}
            {roiInfo && !isDrawing && (
              <div className="border-t border-gray-800 p-3 shrink-0">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider font-medium mb-1.5">ROI Dimensions (meters)</div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="bg-gray-800/60 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-gray-500">Width</div>
                    <div className="text-[11px] text-white font-mono font-medium">{roiInfo.widthM.toFixed(1)}m</div>
                  </div>
                  <div className="bg-gray-800/60 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-gray-500">Height</div>
                    <div className="text-[11px] text-white font-mono font-medium">{roiInfo.heightM.toFixed(1)}m</div>
                  </div>
                  <div className="bg-gray-800/60 rounded px-2 py-1.5 text-center">
                    <div className="text-[9px] text-gray-500">Area</div>
                    <div className="text-[11px] text-white font-mono font-medium">{roiInfo.areaM2.toFixed(0)}m²</div>
                  </div>
                </div>
              </div>
            )}

            {/* Footer hint */}
            <div className="px-3 py-2 border-t border-gray-800 text-[9px] text-gray-600">
              {isDrawing || isClosed ? 'Click to place vertices · Esc to cancel' : 'Click vertex to edit · Scroll to zoom · Drag to pan'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
