/**
 * JourneyFlowGraph — Canvas-based Sankey visualization of zone-to-zone transitions
 * 
 * Nodes = zones (sized by visitor count)
 * Edges = transitions (thickness by flow volume)
 * Checkout zones highlighted. Top 30 transitions shown.
 * Neural style: monospace, dark bg, minimal accent colors.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'

interface SankeyNode {
  id: string
  name: string
  count: number
  isCheckout: boolean
  // Layout (computed)
  x?: number
  y?: number
  w?: number
  h?: number
}

interface SankeyEdge {
  from: string
  to: string
  count: number
}

interface TransitionData {
  nodes: SankeyNode[]
  edges: SankeyEdge[]
  totalTracks: number
  convertedTracks: number
}

const NODE_COLORS = {
  default: 'rgba(100, 180, 255, 0.6)',
  checkout: 'rgba(0, 255, 136, 0.7)',
  highlight: 'rgba(255, 200, 50, 0.8)',
}

// Reusable layout computation
function computeSankeyLayout(data: TransitionData, W: number, H: number) {
  if (data.nodes.length === 0) return null
  const nodes = [...data.nodes]
  const edges = [...data.edges]
  const PAD = 40
  const NODE_W = 10
  const usableW = W - PAD * 2
  const usableH = H - PAD * 2

  const inDegree = new Map<string, number>()
  const outDegree = new Map<string, number>()
  nodes.forEach(n => { inDegree.set(n.id, 0); outDegree.set(n.id, 0) })
  edges.forEach(e => {
    inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1)
    outDegree.set(e.from, (outDegree.get(e.from) || 0) + 1)
  })

  const columns: string[][] = [[], [], []]
  nodes.forEach(n => {
    if (n.isCheckout) {
      columns[2].push(n.id)
    } else if ((inDegree.get(n.id) || 0) <= 1 && (outDegree.get(n.id) || 0) > 0) {
      columns[0].push(n.id)
    } else {
      columns[1].push(n.id)
    }
  })
  if (columns[1].length > 8) {
    const half = Math.ceil(columns[1].length / 2)
    const overflow = columns[1].splice(half)
    columns.splice(2, 0, overflow)
  }
  const filteredColumns = columns.filter(c => c.length > 0)
  const numCols = filteredColumns.length
  const nodeMap = new Map<string, SankeyNode>()
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const maxCount = Math.max(...nodes.map(n => n.count), 1)

  filteredColumns.forEach((col, colIdx) => {
    const x = PAD + (numCols > 1 ? colIdx * (usableW / (numCols - 1)) : usableW / 2)
    const colNodes = col.map(id => nodeById.get(id)!).filter(Boolean)
    colNodes.sort((a, b) => b.count - a.count)
    const maxNodeH = H > 400 ? 60 : 40
    const totalH = colNodes.reduce((s, n) => s + Math.max(14, (n.count / maxCount) * maxNodeH), 0)
    const gap = colNodes.length > 1 ? Math.min(10, (usableH - totalH) / (colNodes.length - 1)) : 0
    let yOffset = PAD + Math.max(0, (usableH - totalH - gap * (colNodes.length - 1)) / 2)
    colNodes.forEach(n => {
      const h = Math.max(14, (n.count / maxCount) * maxNodeH)
      nodeMap.set(n.id, { ...n, x: x - NODE_W / 2, y: yOffset, w: NODE_W, h })
      yOffset += h + gap
    })
  })
  return { nodes: nodeMap, edges }
}

// Reusable draw function
function drawSankey(
  ctx: CanvasRenderingContext2D,
  layout: { nodes: Map<string, SankeyNode>; edges: SankeyEdge[] },
  W: number, H: number, hoveredNode: string | null, large: boolean
) {
  const dpr = window.devicePixelRatio || 1
  ctx.canvas.width = W * dpr
  ctx.canvas.height = H * dpr
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, W, H)

  const maxEdgeCount = Math.max(...layout.edges.map(e => e.count), 1)
  const maxThickness = large ? 10 : 6

  layout.edges.forEach(edge => {
    const from = layout.nodes.get(edge.from)
    const to = layout.nodes.get(edge.to)
    if (!from || !to) return
    const isHighlighted = hoveredNode === edge.from || hoveredNode === edge.to
    const thickness = Math.max(1, (edge.count / maxEdgeCount) * maxThickness)
    const alpha = isHighlighted ? 0.5 : 0.15
    const x1 = (from.x || 0) + (from.w || 0)
    const y1 = (from.y || 0) + (from.h || 0) / 2
    const x2 = to.x || 0
    const y2 = (to.y || 0) + (to.h || 0) / 2
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.bezierCurveTo(x1 + (x2 - x1) * 0.4, y1, x1 + (x2 - x1) * 0.6, y2, x2, y2)
    ctx.strokeStyle = isHighlighted ? `rgba(100, 200, 255, ${alpha})` : `rgba(150, 180, 255, ${alpha})`
    ctx.lineWidth = thickness
    ctx.stroke()
  })

  const fontSize = large ? 12 : 9
  const countFontSize = large ? 10 : 8
  layout.nodes.forEach((node, id) => {
    const isHovered = hoveredNode === id
    const x = node.x || 0, y = node.y || 0, w = node.w || 10, h = node.h || 14
    const color = node.isCheckout ? NODE_COLORS.checkout : isHovered ? NODE_COLORS.highlight : NODE_COLORS.default
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 2)
    ctx.fill()
    if (isHovered || node.isCheckout) {
      ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0
    }
    ctx.font = `${fontSize}px monospace`
    ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)'
    const labelX = x + w + 6
    const labelY = y + h / 2 + fontSize / 3
    ctx.fillText(truncate(node.name, large ? 24 : 14), labelX, labelY)
    if (node.count > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.font = `${countFontSize}px monospace`
      ctx.fillText(`${node.count}`, labelX, labelY + fontSize + 2)
    }
  })
}

export default function JourneyFlowGraph() {
  const { venue } = useVenue()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modalCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [data, setData] = useState<TransitionData | null>(null)
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('1h')
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [dims, setDims] = useState({ w: 300, h: 200 })
  const [modalOpen, setModalOpen] = useState(false)

  const fetchTransitions = useCallback(async () => {
    if (!venue?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/neural/transitions?venueId=${venue.id}&range=${range}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (e) {
      // silent
    }
  }, [venue?.id, range])

  useEffect(() => {
    fetchTransitions()
    const interval = setInterval(fetchTransitions, 15000)
    return () => clearInterval(interval)
  }, [fetchTransitions])

  // Observe container size
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect
      setDims({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Inline panel layout
  const layout = useMemo(() => {
    if (!data) return null
    return computeSankeyLayout(data, dims.w, dims.h)
  }, [data, dims])

  // Draw inline canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !layout) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawSankey(ctx, layout, dims.w, dims.h, hoveredNode, false)
  }, [layout, dims, hoveredNode])

  // Draw modal canvas when open
  const MODAL_W = Math.min(900, Math.floor(window.innerWidth * 0.75))
  const MODAL_H = Math.min(600, Math.floor(window.innerHeight * 0.65))

  const modalLayout = useMemo(() => {
    if (!data || !modalOpen) return null
    return computeSankeyLayout(data, MODAL_W, MODAL_H)
  }, [data, modalOpen, MODAL_W, MODAL_H])

  useEffect(() => {
    const canvas = modalCanvasRef.current
    if (!canvas || !modalLayout || !modalOpen) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawSankey(ctx, modalLayout, MODAL_W, MODAL_H, hoveredNode, true)
  }, [modalLayout, modalOpen, MODAL_W, MODAL_H, hoveredNode])

  // Mouse hover (works on both inline and modal canvas)
  const handleMouseMove = useCallback((e: React.MouseEvent, targetLayout: typeof layout) => {
    if (!targetLayout) return
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let found: string | null = null
    targetLayout.nodes.forEach((node, id) => {
      const x = node.x || 0, y = node.y || 0
      const w = (node.w || 10) + 80, h = node.h || 14
      if (mx >= x && mx <= x + w && my >= y && my <= y + h) found = id
    })
    setHoveredNode(found)
  }, [])

  return (
    <>
      <div className="h-full flex flex-col font-mono text-[10px]">
        {/* Header */}
        <div className="px-3 pt-3 pb-1 flex items-center justify-between">
          <div className="text-[11px] text-white/60 tracking-wider uppercase">
            Journey Flow
          </div>
          <div className="flex items-center gap-2">
            {data && data.nodes.length > 0 && (
              <button
                onClick={() => setModalOpen(true)}
                className="text-[8px] text-white/25 hover:text-white/50 transition-colors px-1 py-0.5 rounded hover:bg-white/[0.05]"
                title="Expand"
              >
                ⤢
              </button>
            )}
            <div className="flex gap-1">
              {(['1h', '24h', '7d'] as const).map(r => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                    range === r 
                      ? 'bg-white/10 text-white' 
                      : 'text-white/30 hover:text-white/50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Inline canvas */}
        <div
          ref={containerRef}
          className="flex-1 relative cursor-pointer"
          onClick={() => data && data.nodes.length > 0 && setModalOpen(true)}
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0"
            style={{ width: dims.w, height: dims.h }}
            onMouseMove={(e) => handleMouseMove(e, layout)}
            onMouseLeave={() => setHoveredNode(null)}
          />
          {(!data || data.nodes.length === 0) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20">
              <div className="text-[20px] mb-2 opacity-30">⬡</div>
              <div className="text-[10px]">No journey data</div>
              <div className="text-[8px] mt-1">Transitions appear as visitors move between zones</div>
            </div>
          )}
        </div>
      </div>

      {/* ===== EXPANDED MODAL ===== */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          onClick={() => setModalOpen(false)}
          style={{ background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)' }}
        >
          <div
            className="relative rounded-lg border border-white/[0.08] font-mono"
            style={{ width: MODAL_W, height: MODAL_H, background: 'rgba(13, 13, 20, 0.95)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-5 pt-4 pb-2 z-10">
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-white/60 tracking-wider uppercase">Journey Flow Graph</span>
                {data && (
                  <span className="text-white/25 text-[10px]">
                    {data.totalTracks} tracks · {data.convertedTracks} converted
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {(['1h', '24h', '7d'] as const).map(r => (
                    <button
                      key={r}
                      onClick={() => setRange(r)}
                      className={`px-2 py-1 rounded text-[10px] transition-colors ${
                        range === r ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-white/30 hover:text-white/60 text-[16px] transition-colors w-7 h-7 flex items-center justify-center rounded hover:bg-white/[0.06]"
                >
                  ×
                </button>
              </div>
            </div>

            {/* Modal canvas */}
            <canvas
              ref={modalCanvasRef}
              style={{ width: MODAL_W, height: MODAL_H }}
              onMouseMove={(e) => handleMouseMove(e, modalLayout)}
              onMouseLeave={() => setHoveredNode(null)}
            />
          </div>
        </div>
      )}
    </>
  )
}

function truncate(s: string, max: number) {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
