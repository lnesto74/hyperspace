/**
 * JourneyFlowGraph — Journey Patterns visualization
 *
 * Compact panel: shows journey archetypes as a scannable list
 * Modal: three-column layout — pattern selector, vertical category flow, detail panel
 *
 * Data comes from /api/neural/journey-patterns which groups zones by product category,
 * classifies tracks into behavioral archetypes, and computes per-archetype statistics.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'

// ─── Types ───────────────────────────────────────────────────

interface CategoryDwell {
  category: string
  avgSec: number
}

interface JourneyPattern {
  type: string
  label: string
  trackCount: number
  conversionRate: number
  avgDurationSec: number
  categorySequence: string[]
  categoryDwell: CategoryDwell[]
  temporalDistribution: number[]
}

interface FlowNode {
  id: string
  name: string
  count: number
  isEntrance: boolean
  isCheckout: boolean
}

interface FlowEdge {
  from: string
  to: string
  count: number
}

interface CategoryFlow {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface JourneyPatternsData {
  totalTracks: number
  convertedTracks: number
  patterns: JourneyPattern[]
  categoryFlow: CategoryFlow
  patternFlows: Record<string, CategoryFlow>
}

// ─── Constants ───────────────────────────────────────────────

const PATTERN_COLORS: Record<string, string> = {
  'full-shop': 'rgb(74, 222, 128)',
  'category-specialist': 'rgb(96, 165, 250)',
  'browse-and-bail': 'rgb(251, 191, 36)',
  'quick-run': 'rgb(167, 139, 250)',
}

const PATTERN_COLORS_DIM: Record<string, string> = {
  'full-shop': 'rgba(74, 222, 128, 0.15)',
  'category-specialist': 'rgba(96, 165, 250, 0.15)',
  'browse-and-bail': 'rgba(251, 191, 36, 0.15)',
  'quick-run': 'rgba(167, 139, 250, 0.15)',
}

// ─── Helpers ─────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function pct(n: number, total: number): string {
  if (total === 0) return '0%'
  return `${Math.round((n / total) * 100)}%`
}

// ─── Vertical Category Flow (Canvas) ────────────────────────

interface LayoutNode {
  id: string
  name: string
  count: number
  x: number
  y: number
  w: number
  h: number
  isEntrance: boolean
  isCheckout: boolean
}

interface FlowLayout {
  nodes: Map<string, LayoutNode>
  edges: FlowEdge[]
  width: number
  height: number
}

function computeFlowLayout(flow: CategoryFlow, W: number, H: number): FlowLayout | null {
  if (flow.nodes.length === 0) return null

  const PAD_X = 60
  const PAD_Y = 50
  const NODE_H = 8
  const usableW = W - PAD_X * 2
  const usableH = H - PAD_Y * 2

  // Assign stages: Entrance=0, Checkout=last, everything else in between
  // Sort shopping categories by visit count
  const shoppingNodes = flow.nodes
    .filter(n => !n.isEntrance && !n.isCheckout && n.name !== 'Other')
    .sort((a, b) => b.count - a.count)

  const otherNode = flow.nodes.find(n => n.name === 'Other')
  const entranceNode = flow.nodes.find(n => n.isEntrance)
  const checkoutNode = flow.nodes.find(n => n.isCheckout)

  // Build ordered list top-to-bottom: Entrance, shopping categories (by count), Other, Checkout
  const ordered: FlowNode[] = []
  if (entranceNode) ordered.push(entranceNode)
  ordered.push(...shoppingNodes)
  if (otherNode) ordered.push(otherNode)
  if (checkoutNode) ordered.push(checkoutNode)

  if (ordered.length === 0) return null

  const maxCount = Math.max(...ordered.map(n => n.count), 1)
  const nodeMap = new Map<string, LayoutNode>()

  const totalNodes = ordered.length
  const verticalGap = Math.min(16, usableH / totalNodes)
  const totalH = totalNodes * NODE_H + (totalNodes - 1) * verticalGap
  let yStart = PAD_Y + Math.max(0, (usableH - totalH) / 2)

  ordered.forEach((node, i) => {
    const nodeW = Math.max(40, (node.count / maxCount) * (usableW * 0.5))
    const x = PAD_X + (usableW - nodeW) / 2
    const y = yStart + i * (NODE_H + verticalGap)

    nodeMap.set(node.id, {
      id: node.id,
      name: node.name,
      count: node.count,
      x,
      y,
      w: nodeW,
      h: NODE_H,
      isEntrance: node.isEntrance,
      isCheckout: node.isCheckout,
    })
  })

  return { nodes: nodeMap, edges: flow.edges, width: W, height: H }
}

function drawFlow(
  ctx: CanvasRenderingContext2D,
  layout: FlowLayout,
  hoveredNode: string | null,
  selectedPattern: string | null,
) {
  const { width: W, height: H, nodes, edges } = layout
  const dpr = window.devicePixelRatio || 1
  ctx.canvas.width = W * dpr
  ctx.canvas.height = H * dpr
  ctx.scale(dpr, dpr)
  ctx.clearRect(0, 0, W, H)

  const maxEdgeCount = Math.max(...edges.map(e => e.count), 1)
  const patternColor = selectedPattern ? (PATTERN_COLORS[selectedPattern] || 'rgb(96, 165, 250)') : 'rgb(96, 165, 250)'

  // Draw edges
  edges.forEach(edge => {
    const from = nodes.get(edge.from)
    const to = nodes.get(edge.to)
    if (!from || !to) return

    const isHighlighted = hoveredNode === edge.from || hoveredNode === edge.to
    const thickness = Math.max(1.5, (edge.count / maxEdgeCount) * 8)
    const alpha = isHighlighted ? 0.45 : 0.12

    const x1 = from.x + from.w / 2
    const y1 = from.y + from.h
    const x2 = to.x + to.w / 2
    const y2 = to.y

    const midY = (y1 + y2) / 2

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2)

    ctx.strokeStyle = isHighlighted ? `rgba(150, 200, 255, ${alpha})` : `rgba(150, 180, 255, ${alpha})`
    ctx.lineWidth = thickness
    ctx.stroke()
  })

  // Draw nodes
  const fontSize = 11
  nodes.forEach((node, id) => {
    const isHovered = hoveredNode === id
    let color: string
    if (node.isEntrance) color = 'rgba(96, 165, 250, 0.7)'
    else if (node.isCheckout) color = 'rgba(0, 255, 136, 0.7)'
    else if (isHovered) color = 'rgba(255, 200, 50, 0.8)'
    else color = selectedPattern ? patternColor.replace('rgb(', 'rgba(').replace(')', ', 0.5)') : 'rgba(100, 180, 255, 0.5)'

    // Node bar
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(node.x, node.y, node.w, node.h, 3)
    ctx.fill()

    if (isHovered || node.isEntrance || node.isCheckout) {
      ctx.shadowColor = color
      ctx.shadowBlur = 12
      ctx.fill()
      ctx.shadowBlur = 0
    }

    // Label left of node
    ctx.font = `${fontSize}px monospace`
    ctx.textAlign = 'right'
    ctx.fillStyle = isHovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)'
    ctx.fillText(node.name, node.x - 10, node.y + node.h / 2 + fontSize / 3)

    // Count right of node
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255,255,255,0.3)'
    ctx.font = `10px monospace`
    ctx.fillText(`${node.count}`, node.x + node.w + 10, node.y + node.h / 2 + 4)

    ctx.textAlign = 'left'
  })
}

// ─── Main Component ──────────────────────────────────────────

export default function JourneyFlowGraph() {
  const { venue } = useVenue()
  const modalCanvasRef = useRef<HTMLCanvasElement>(null)
  const [data, setData] = useState<JourneyPatternsData | null>(null)
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('1h')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedPattern, setSelectedPattern] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!venue?.id) return
    try {
      const res = await fetch(`${API_BASE}/api/neural/journey-patterns?venueId=${venue.id}&range=${range}`)
      if (res.ok) setData(await res.json())
    } catch {
      // silent
    }
  }, [venue?.id, range])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 25000)
    return () => clearInterval(interval)
  }, [fetchData])

  // Active flow for modal (all or filtered by pattern)
  const activeFlow = useMemo(() => {
    if (!data) return null
    if (selectedPattern && data.patternFlows[selectedPattern]) {
      return data.patternFlows[selectedPattern]
    }
    return data.categoryFlow
  }, [data, selectedPattern])

  // Active pattern detail
  const activePatternDetail = useMemo(() => {
    if (!data || !selectedPattern) return null
    return data.patterns.find(p => p.type === selectedPattern) || null
  }, [data, selectedPattern])

  // Modal layout
  const MODAL_W = Math.min(960, Math.floor(window.innerWidth * 0.8))
  const MODAL_H = Math.min(640, Math.floor(window.innerHeight * 0.7))
  const FLOW_W = Math.floor(MODAL_W * 0.4)
  const FLOW_H = MODAL_H - 60

  const modalLayout = useMemo(() => {
    if (!activeFlow || !modalOpen) return null
    return computeFlowLayout(activeFlow, FLOW_W, FLOW_H)
  }, [activeFlow, modalOpen, FLOW_W, FLOW_H])

  useEffect(() => {
    const canvas = modalCanvasRef.current
    if (!canvas || !modalLayout || !modalOpen) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    drawFlow(ctx, modalLayout, hoveredNode, selectedPattern)
  }, [modalLayout, modalOpen, hoveredNode, selectedPattern])

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!modalLayout) return
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    let found: string | null = null
    modalLayout.nodes.forEach((node, id) => {
      const hitPad = 12
      if (
        mx >= node.x - 60 && mx <= node.x + node.w + 60 &&
        my >= node.y - hitPad && my <= node.y + node.h + hitPad
      ) {
        found = id
      }
    })
    setHoveredNode(found)
  }, [modalLayout])

  const hasData = data && data.patterns.length > 0

  return (
    <>
      {/* ─── COMPACT PANEL ─── */}
      <div className="h-full flex flex-col font-mono text-[10px]">
        <div className="px-3 pt-3 pb-1 flex items-center justify-between">
          <div className="text-[11px] text-white/60 tracking-wider uppercase">
            Journey Patterns
          </div>
          <div className="flex items-center gap-2">
            {hasData && (
              <button
                onClick={() => { setSelectedPattern(null); setModalOpen(true) }}
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
                    range === r ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/50'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pattern list */}
        <div className="flex-1 overflow-hidden px-3 pb-2">
          {!hasData ? (
            <div className="h-full flex flex-col items-center justify-center text-white/20">
              <div className="text-[20px] mb-2 opacity-30">⬡</div>
              <div className="text-[10px]">No journey data</div>
              <div className="text-[8px] mt-1 text-white/15">Patterns appear as visitors navigate the store</div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 mt-1">
              {data!.patterns.slice(0, 4).map(pattern => (
                <button
                  key={pattern.type}
                  onClick={() => { setSelectedPattern(pattern.type); setModalOpen(true) }}
                  className="text-left rounded px-2 py-1.5 transition-all hover:bg-white/[0.04] group"
                >
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-white/70 font-medium">{pattern.label}</span>
                    <span className="text-[9px] text-white/30 tabular-nums">
                      {pct(pattern.trackCount, data!.totalTracks)}
                    </span>
                  </div>

                  {/* Proportion bar */}
                  <div className="h-[3px] rounded-full bg-white/[0.06] mb-1">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${Math.max(4, (pattern.trackCount / data!.totalTracks) * 100)}%`,
                        background: PATTERN_COLORS[pattern.type] || '#888',
                        opacity: 0.5,
                      }}
                    />
                  </div>

                  {/* Sequence preview */}
                  <div className="text-[8px] text-white/25 truncate group-hover:text-white/35 transition-colors">
                    {pattern.categorySequence.join(' → ')}
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-2 mt-0.5 text-[8px] text-white/20">
                    <span className="tabular-nums">{pattern.trackCount} tracks</span>
                    <span>·</span>
                    <span className="tabular-nums">{formatDuration(pattern.avgDurationSec)}</span>
                    <span>·</span>
                    <span className="tabular-nums">{Math.round(pattern.conversionRate * 100)}% conv</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer summary */}
        {hasData && (
          <div className="px-3 py-1.5 border-t border-white/[0.04] text-[8px] text-white/25 flex items-center justify-between">
            <span>{data!.totalTracks} tracks · {data!.convertedTracks} converted</span>
            <span>{data!.patterns.length} patterns</span>
          </div>
        )}
      </div>

      {/* ─── EXPANDED MODAL ─── */}
      {modalOpen && data && createPortal(
        <div
          className="fixed inset-0 flex items-center justify-center"
          onClick={() => setModalOpen(false)}
          style={{ zIndex: 99999, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(6px)' }}
        >
          <div
            className="relative rounded-lg border border-white/[0.08] font-mono flex flex-col overflow-hidden"
            style={{ width: MODAL_W, height: MODAL_H, background: 'rgba(13, 13, 20, 0.97)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-white/60 tracking-wider uppercase">Journey Patterns</span>
                <span className="text-white/25 text-[10px] tabular-nums">
                  {data.totalTracks} tracks · {data.convertedTracks} converted ({pct(data.convertedTracks, data.totalTracks)})
                </span>
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

            {/* Three-column body */}
            <div className="flex flex-1 overflow-hidden">

              {/* LEFT: Pattern selector */}
              <div className="w-[200px] border-r border-white/[0.06] overflow-y-auto flex-shrink-0 py-2">
                {/* All patterns option */}
                <button
                  onClick={() => setSelectedPattern(null)}
                  className={`w-full text-left px-4 py-2.5 transition-colors text-[11px] ${
                    selectedPattern === null
                      ? 'bg-white/[0.06] text-white/80'
                      : 'text-white/40 hover:bg-white/[0.03] hover:text-white/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">All Journeys</span>
                    <span className="text-[10px] tabular-nums text-white/30">{data.totalTracks}</span>
                  </div>
                </button>

                <div className="mx-4 my-1 border-t border-white/[0.04]" />

                {data.patterns.map(pattern => {
                  const isActive = selectedPattern === pattern.type
                  const color = PATTERN_COLORS[pattern.type] || '#888'
                  return (
                    <button
                      key={pattern.type}
                      onClick={() => setSelectedPattern(pattern.type)}
                      className={`w-full text-left px-4 py-2.5 transition-all ${
                        isActive
                          ? 'text-white/90'
                          : 'text-white/40 hover:bg-white/[0.03] hover:text-white/60'
                      }`}
                      style={isActive ? { background: PATTERN_COLORS_DIM[pattern.type] || 'rgba(255,255,255,0.06)' } : undefined}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
                        <span className="text-[11px] font-medium truncate">{pattern.label}</span>
                      </div>
                      <div className="flex items-center justify-between ml-4">
                        <span className="text-[10px] tabular-nums text-white/30">
                          {pattern.trackCount} tracks
                        </span>
                        <span className="text-[10px] tabular-nums text-white/30">
                          {pct(pattern.trackCount, data.totalTracks)}
                        </span>
                      </div>
                      {/* Mini bar */}
                      <div className="ml-4 mt-1 h-[2px] rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(3, (pattern.trackCount / data.totalTracks) * 100)}%`,
                            background: color,
                            opacity: isActive ? 0.7 : 0.3,
                          }}
                        />
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* CENTER: Category flow canvas */}
              <div className="flex-1 relative">
                {modalLayout ? (
                  <canvas
                    ref={modalCanvasRef}
                    style={{ width: FLOW_W, height: FLOW_H }}
                    className="absolute inset-0"
                    onMouseMove={handleCanvasMouseMove}
                    onMouseLeave={() => setHoveredNode(null)}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-white/20 text-[11px]">
                    No flow data for this pattern
                  </div>
                )}
              </div>

              {/* RIGHT: Detail panel */}
              <div className="w-[240px] border-l border-white/[0.06] overflow-y-auto flex-shrink-0">
                {selectedPattern === null ? (
                  <OverviewPanel data={data} />
                ) : activePatternDetail ? (
                  <PatternDetailPanel pattern={activePatternDetail} totalTracks={data.totalTracks} />
                ) : (
                  <div className="p-4 text-white/20 text-[10px]">No data</div>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

// ─── Overview Panel (when "All" is selected) ─────────────────

function OverviewPanel({ data }: { data: JourneyPatternsData }) {
  const convRate = data.totalTracks > 0
    ? Math.round((data.convertedTracks / data.totalTracks) * 100)
    : 0

  const allCategories = new Map<string, number>()
  for (const p of data.patterns) {
    for (const cd of p.categoryDwell) {
      const existing = allCategories.get(cd.category) || 0
      allCategories.set(cd.category, Math.max(existing, cd.avgSec))
    }
  }
  const topCategories = [...allCategories.entries()]
    .filter(([c]) => c !== 'Other')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Overview</div>
        <div className="text-[22px] text-white/80 font-light tabular-nums">{data.totalTracks}</div>
        <div className="text-[10px] text-white/30">total journeys tracked</div>
      </div>

      <div>
        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Conversion</div>
        <div className="flex items-baseline gap-2">
          <span className="text-[18px] text-emerald-400/80 font-light tabular-nums">{convRate}%</span>
          <span className="text-[10px] text-white/25 tabular-nums">{data.convertedTracks} / {data.totalTracks}</span>
        </div>
        <div className="mt-1 h-[4px] rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full bg-emerald-400/60"
            style={{ width: `${convRate}%` }}
          />
        </div>
      </div>

      <div>
        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Pattern Breakdown</div>
        <div className="space-y-2">
          {data.patterns.map(p => (
            <div key={p.type} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: PATTERN_COLORS[p.type] }} />
              <span className="text-[10px] text-white/50 flex-1 truncate">{p.label}</span>
              <span className="text-[10px] text-white/30 tabular-nums">{pct(p.trackCount, data.totalTracks)}</span>
            </div>
          ))}
        </div>
      </div>

      {topCategories.length > 0 && (
        <div>
          <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Top Category Dwells</div>
          <div className="space-y-1.5">
            {topCategories.map(([cat, sec]) => (
              <div key={cat} className="flex items-center justify-between">
                <span className="text-[10px] text-white/45 truncate flex-1">{cat}</span>
                <span className="text-[10px] text-white/25 tabular-nums ml-2">{formatDuration(sec)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Pattern Detail Panel ────────────────────────────────────

function PatternDetailPanel({ pattern, totalTracks }: { pattern: JourneyPattern; totalTracks: number }) {
  const convPct = Math.round(pattern.conversionRate * 100)
  const hourlyMax = Math.max(...pattern.temporalDistribution, 1)

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: PATTERN_COLORS[pattern.type] }} />
          <span className="text-[13px] text-white/80 font-medium">{pattern.label}</span>
        </div>
        <div className="text-[10px] text-white/30">
          {pattern.trackCount} tracks ({pct(pattern.trackCount, totalTracks)} of total)
        </div>
      </div>

      {/* Duration */}
      <div>
        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Avg Duration</div>
        <div className="text-[18px] text-white/70 font-light tabular-nums">{formatDuration(pattern.avgDurationSec)}</div>
      </div>

      {/* Conversion */}
      <div>
        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1">Conversion</div>
        <div className="flex items-baseline gap-2">
          <span className={`text-[18px] font-light tabular-nums ${convPct > 50 ? 'text-emerald-400/80' : convPct > 0 ? 'text-amber-400/80' : 'text-red-400/60'}`}>
            {convPct}%
          </span>
        </div>
        <div className="mt-1 h-[4px] rounded-full bg-white/[0.06]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${convPct}%`,
              background: PATTERN_COLORS[pattern.type] || '#60a5fa',
              opacity: 0.6,
            }}
          />
        </div>
      </div>

      {/* Typical path */}
      <div>
        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Typical Path</div>
        <div className="flex flex-wrap gap-1 items-center">
          {pattern.categorySequence.map((cat, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                cat === 'Entrance' ? 'bg-blue-500/15 text-blue-400/70' :
                cat === 'Checkout' ? 'bg-emerald-500/15 text-emerald-400/70' :
                'bg-white/[0.05] text-white/50'
              }`}>
                {cat}
              </span>
              {i < pattern.categorySequence.length - 1 && (
                <span className="text-[8px] text-white/15">→</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Category dwell breakdown */}
      {pattern.categoryDwell.length > 0 && (
        <div>
          <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Category Dwell</div>
          <div className="space-y-1.5">
            {pattern.categoryDwell.slice(0, 6).map(cd => {
              const maxDwell = pattern.categoryDwell[0]?.avgSec || 1
              return (
                <div key={cd.category}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[10px] text-white/45 truncate">{cd.category}</span>
                    <span className="text-[10px] text-white/25 tabular-nums">{formatDuration(cd.avgSec)}</span>
                  </div>
                  <div className="h-[2px] rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(3, (cd.avgSec / maxDwell) * 100)}%`,
                        background: PATTERN_COLORS[pattern.type] || '#60a5fa',
                        opacity: 0.4,
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Temporal distribution */}
      <div>
        <div className="text-[10px] text-white/30 uppercase tracking-wider mb-2">Peak Hours</div>
        <div className="flex items-end gap-px h-[32px]">
          {pattern.temporalDistribution.map((count, hour) => (
            <div
              key={hour}
              className="flex-1 rounded-t-sm"
              style={{
                height: `${Math.max(2, (count / hourlyMax) * 100)}%`,
                background: PATTERN_COLORS[pattern.type] || '#60a5fa',
                opacity: count > 0 ? 0.3 + (count / hourlyMax) * 0.5 : 0.05,
              }}
              title={`${hour}:00 — ${count} tracks`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-0.5">
          <span className="text-[8px] text-white/15">0h</span>
          <span className="text-[8px] text-white/15">6h</span>
          <span className="text-[8px] text-white/15">12h</span>
          <span className="text-[8px] text-white/15">18h</span>
          <span className="text-[8px] text-white/15">24h</span>
        </div>
      </div>
    </div>
  )
}
