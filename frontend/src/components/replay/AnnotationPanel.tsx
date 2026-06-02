import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tag, X, GripVertical, RefreshCw, Loader2, Trash2, Users, UserX, Zap, Eraser } from 'lucide-react'
import { API_BASE } from '../../config/api'
import { useVenue } from '../../context/VenueContext'
import { useDraggablePanel } from '../../hooks/useDraggablePanel'
import { useToast } from '../../context/ToastContext'

// ---- data shapes (from GET /api/replay/reconcile/graph?full=1) ----
type PathPt = [number, number, number] // x, z, t(ms)
interface GraphChain { stableId: string; path?: PathPt[]; entr?: number; t0?: number; t1?: number; disp?: number }
interface Graph {
  sourceFile: string
  venueId?: string | null
  extent: { minX: number; maxX: number; minZ: number; maxZ: number } | null
  entrance: { name: string; vertices: { x: number; z: number }[] } | null
  chains: GraphChain[]
  stats?: { chains?: number; tracklets?: number }
  firstTs?: number
}
interface Pick { stableId: string; x: number; z: number; t: number }
interface Annotation {
  id: string; kind: 'same' | 'different' | 'bad_jump'
  a: { track: string | null; ts: number | null; x: number | null; z: number | null }
  b: { track: string | null; ts: number | null; x: number | null; z: number | null }
  note?: string | null; createdAt: string
}

const CW = 560, CH = 480, PAD = 14
const REID_MAX_GAP_S = 12          // re-ID rule: don't merge across gaps longer than this
const WIN_LENGTHS = [10, 30, 60, 120] // time-window lengths (seconds)
const fmtClock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

export default function AnnotationPanel({ onClose }: { onClose: () => void }) {
  const { venue } = useVenue()
  const { addToast } = useToast()
  const { panelRef, panelStyle, dragging, headerProps } = useDraggablePanel({ storageKey: 'hyperspace.panel.annotate.position', defaultX: 80, defaultY: 24 })

  const [captures, setCaptures] = useState<string[]>([])
  const [capture, setCapture] = useState<string>(() => localStorage.getItem('hyperspace.annotate.capture') || '')
  const [graph, setGraph] = useState<Graph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [entranceOnly, setEntranceOnly] = useState(false)
  const [minDisp, setMinDisp] = useState(0)
  const [mode, setMode] = useState<'pair' | 'badjump'>('pair')

  // time-aware viewing: only show tracks active in a sliding window, coloured by time
  const [timeWindowOn, setTimeWindowOn] = useState(true)
  const [winStartMs, setWinStartMs] = useState(0) // offset from tMin
  const [winLenS, setWinLenS] = useState(30)

  const [selA, setSelA] = useState<Pick | null>(null)
  const [selB, setSelB] = useState<Pick | null>(null)
  const [badPoint, setBadPoint] = useState<Pick | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [saving, setSaving] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const tfRef = useRef<{ scale: number; ox: number; oz: number } | null>(null)
  const renderChainsRef = useRef<GraphChain[]>([])
  const hashRef = useRef<Map<string, number[]>>(new Map()) // cellKey -> chain indices (into renderChains)

  // ---- data loading ----
  const refreshCaptures = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/replay/files`)
      const j = await r.json()
      const files: string[] = (j.files || [])
        .map((f: string | { name?: string }) => (typeof f === 'string' ? f : f?.name || ''))
        .filter((name: string) => name && !name.endsWith('.reconciled.jsonl'))
      setCaptures(files)
      if (!capture && files.length) setCapture(files[0])
    } catch { /* ignore */ }
  }, [capture])

  const loadGraph = useCallback(async (cap: string) => {
    if (!cap) return
    setLoading(true); setError(null); setGraph(null)
    try {
      const r = await fetch(`${API_BASE}/api/replay/reconcile/graph?sourceFile=${encodeURIComponent(cap)}&full=1`)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || `No graph for this capture (HTTP ${r.status})`)
      }
      const j = await r.json()
      setGraph(j.graph as Graph)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshAnnotations = useCallback(async (cap: string) => {
    if (!cap) return
    try {
      const r = await fetch(`${API_BASE}/api/replay/reconcile/annotations?sourceFile=${encodeURIComponent(cap)}`)
      const j = await r.json()
      setAnnotations(j.annotations || [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { refreshCaptures() }, [refreshCaptures])
  useEffect(() => {
    if (!capture) return
    localStorage.setItem('hyperspace.annotate.capture', capture)
    setSelA(null); setSelB(null); setBadPoint(null); setWinStartMs(0)
    loadGraph(capture); refreshAnnotations(capture)
  }, [capture, loadGraph, refreshAnnotations])

  // ---- global time range of the capture (for the window scrubber + colour ramp) ----
  const timeRange = useMemo(() => {
    if (!graph) return null
    let lo = Infinity, hi = -Infinity
    for (const c of graph.chains) {
      if (!c.path || c.path.length < 2) continue
      const t0 = c.t0 ?? c.path[0][2]
      const t1 = c.t1 ?? c.path[c.path.length - 1][2]
      if (t0 < lo) lo = t0
      if (t1 > hi) hi = t1
    }
    if (!Number.isFinite(lo)) return null
    return { tMin: lo, tMax: hi, dur: Math.max(1, hi - lo) }
  }, [graph])

  const maxStartMs = timeRange ? Math.max(0, timeRange.dur - winLenS * 1000) : 0
  const startMs = Math.min(winStartMs, maxStartMs)
  const winT0 = timeRange ? timeRange.tMin + startMs : 0
  const winT1 = winT0 + winLenS * 1000
  const windowing = timeWindowOn && !!timeRange

  // ---- filtered render set ----
  const renderChains = useMemo(() => {
    if (!graph) return []
    return graph.chains.filter(c => {
      if (!c.path || c.path.length <= 1) return false
      if (entranceOnly && !c.entr) return false
      if (minDisp && (c.disp ?? 0) < minDisp) return false
      if (windowing) {
        const t0 = c.t0 ?? c.path[0][2]
        const t1 = c.t1 ?? c.path[c.path.length - 1][2]
        if (!(t0 <= winT1 && t1 >= winT0)) return false // no temporal overlap with window
      }
      return true
    })
  }, [graph, entranceOnly, minDisp, windowing, winT0, winT1])

  const stats = useMemo(() => {
    if (!graph) return null
    const total = graph.chains.filter(c => c.path).length
    const entr = graph.chains.filter(c => c.path && c.entr).length
    return { total, entr, shown: renderChains.length }
  }, [graph, renderChains])

  // ---- build transform + offscreen base layer + spatial hash ----
  useEffect(() => {
    renderChainsRef.current = renderChains
    const ext = graph?.extent
    if (!ext) { tfRef.current = null; return }
    const spanX = Math.max(0.1, ext.maxX - ext.minX), spanZ = Math.max(0.1, ext.maxZ - ext.minZ)
    const scale = Math.min((CW - 2 * PAD) / spanX, (CH - 2 * PAD) / spanZ)
    const ox = PAD + (CW - 2 * PAD - spanX * scale) / 2 - ext.minX * scale
    const oz = PAD + (CH - 2 * PAD - spanZ * scale) / 2 - ext.minZ * scale
    tfRef.current = { scale, ox, oz }

    // offscreen base
    let off = offscreenRef.current
    if (!off) { off = document.createElement('canvas'); off.width = CW; off.height = CH; offscreenRef.current = off }
    const ctx = off.getContext('2d')!
    ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, CW, CH)
    const toPx = (x: number, z: number): [number, number] => [x * scale + ox, CH - (z * scale + oz)]
    const within = (t: number) => !windowing || (t >= winT0 && t <= winT1)
    // colour ramp: blue (window start) → red (window end); when no window, by absolute time
    const tColor = (t: number) => {
      let u: number
      if (windowing) u = (t - winT0) / Math.max(1, winT1 - winT0)
      else if (timeRange) u = (t - timeRange.tMin) / timeRange.dur
      else u = 0.5
      u = Math.max(0, Math.min(1, u))
      return `hsl(${Math.round(220 - 220 * u)}, 80%, 62%)`
    }

    // chains: when windowing, draw per-segment coloured by time and clipped to window;
    // otherwise entrance brighter / others dim (single colour, whole path)
    for (const c of renderChains) {
      const p = c.path!
      if (windowing) {
        for (let i = 0; i < p.length - 1; i++) {
          if (!within(p[i][2]) && !within(p[i + 1][2])) continue
          const [x1, y1] = toPx(p[i][0], p[i][1]); const [x2, y2] = toPx(p[i + 1][0], p[i + 1][1])
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2)
          ctx.strokeStyle = tColor(p[i][2]); ctx.lineWidth = 1.4; ctx.stroke()
        }
      } else {
        ctx.beginPath()
        for (let i = 0; i < p.length; i++) { const [px, py] = toPx(p[i][0], p[i][1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) }
        ctx.strokeStyle = c.entr ? 'rgba(96,165,250,0.55)' : 'rgba(120,130,145,0.30)'
        ctx.lineWidth = 1; ctx.stroke()
      }
    }
    // entrance ROI
    if (graph?.entrance?.vertices?.length) {
      ctx.beginPath()
      graph.entrance.vertices.forEach((v, i) => { const [px, py] = toPx(v.x, v.z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) })
      ctx.closePath(); ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.fillStyle = 'rgba(34,211,238,0.08)'; ctx.fill()
    }

    // spatial hash (cell ~ 1.5m) for picking
    const hash = new Map<string, number[]>()
    const cell = 1.5
    renderChains.forEach((c, idx) => {
      for (const [x, z, t] of c.path!) {
        if (!within(t)) continue // only let the user pick visible (in-window) points
        const key = `${Math.floor(x / cell)},${Math.floor(z / cell)}`
        let arr = hash.get(key); if (!arr) { arr = []; hash.set(key, arr) }
        if (arr[arr.length - 1] !== idx) arr.push(idx)
      }
    })
    hashRef.current = hash
  }, [graph, renderChains, windowing, winT0, winT1, timeRange])

  // ---- composite draw (base + highlights) ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current, off = offscreenRef.current, tf = tfRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, CW, CH)
    if (off) ctx.drawImage(off, 0, 0); else { ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, CW, CH) }
    if (!tf) return
    const toPx = (x: number, z: number): [number, number] => [x * tf.scale + tf.ox, CH - (z * tf.scale + tf.oz)]
    const drawChain = (stableId: string | null, color: string, w: number) => {
      if (!stableId) return
      const c = renderChainsRef.current.find(cc => cc.stableId === stableId)
      if (!c?.path) return
      ctx.beginPath()
      c.path.forEach((pt, i) => { const [px, py] = toPx(pt[0], pt[1]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) })
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke()
    }
    drawChain(hoverId, 'rgba(255,255,255,0.9)', 2)
    drawChain(selA?.stableId ?? null, '#34d399', 2.5)
    drawChain(selB?.stableId ?? null, '#f59e0b', 2.5)
    const dot = (p: Pick | null, color: string) => {
      if (!p) return
      const [px, py] = toPx(p.x, p.z)
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
      ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 1.5; ctx.stroke()
    }
    dot(selA, '#34d399'); dot(selB, '#f59e0b'); dot(badPoint, '#ef4444')
  }, [hoverId, selA, selB, badPoint])

  useEffect(() => { draw() }, [draw, renderChains])

  // ---- picking ----
  const pickAt = useCallback((clientX: number, clientY: number): Pick | null => {
    const canvas = canvasRef.current, tf = tfRef.current
    if (!canvas || !tf) return null
    const rect = canvas.getBoundingClientRect()
    const cx = (clientX - rect.left) * (CW / rect.width)
    const cy = (clientY - rect.top) * (CH / rect.height)
    const wx = (cx - tf.ox) / tf.scale
    const wz = (CH - cy - tf.oz) / tf.scale
    const cell = 1.5
    const ci = Math.floor(wx / cell), cj = Math.floor(wz / cell)
    const seen = new Set<number>()
    let best: Pick | null = null, bestD = Infinity
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const arr = hashRef.current.get(`${ci + di},${cj + dj}`)
      if (!arr) continue
      for (const idx of arr) {
        if (seen.has(idx)) continue; seen.add(idx)
        const c = renderChainsRef.current[idx]; if (!c?.path) continue
        for (const [x, z, t] of c.path) {
          if (windowing && (t < winT0 || t > winT1)) continue
          const d = (x - wx) ** 2 + (z - wz) ** 2
          if (d < bestD) { bestD = d; best = { stableId: c.stableId, x, z, t } }
        }
      }
    }
    return bestD <= 0.8 * 0.8 ? best : null // ~0.8m pick radius (world)
  }, [windowing, winT0, winT1])

  const onMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pickAt(e.clientX, e.clientY)
    setHoverId(prev => (p?.stableId ?? null) === prev ? prev : (p?.stableId ?? null))
  }, [pickAt])

  const onClick = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pickAt(e.clientX, e.clientY)
    if (!p) return
    if (mode === 'badjump') { setBadPoint(p); return }
    if (!selA) { setSelA(p); return }
    if (selA.stableId === p.stableId && !selB) { setSelA(p); return } // re-pick A on same chain
    setSelB(p)
  }, [pickAt, mode, selA, selB])

  // ---- submit ----
  const submit = useCallback(async (kind: 'same' | 'different' | 'bad_jump') => {
    if (!capture) return
    const body: Record<string, unknown> = { sourceFile: capture, venueId: venue?.id || null, presetId: 'GROCERY_V2_MAP', kind }
    if (kind === 'bad_jump') {
      if (!badPoint) return
      Object.assign(body, { trackA: badPoint.stableId, tsA: badPoint.t, xA: badPoint.x, zA: badPoint.z })
    } else {
      if (!selA || !selB) return
      Object.assign(body, {
        trackA: selA.stableId, tsA: selA.t, xA: selA.x, zA: selA.z,
        trackB: selB.stableId, tsB: selB.t, xB: selB.x, zB: selB.z,
      })
    }
    setSaving(true)
    try {
      const r = await fetch(`${API_BASE}/api/replay/reconcile/annotations`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'save failed')
      addToast('success', `Saved ${kind === 'same' ? 'SAME-person' : kind === 'different' ? 'DIFFERENT-people' : 'bad-jump'} label`)
      setSelA(null); setSelB(null); setBadPoint(null)
      refreshAnnotations(capture)
    } catch (e) {
      addToast('error', e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(false)
    }
  }, [capture, venue?.id, selA, selB, badPoint, addToast, refreshAnnotations])

  const deleteAnnotation = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/api/replay/reconcile/annotations/${id}`, { method: 'DELETE' })
      refreshAnnotations(capture)
    } catch { /* ignore */ }
  }, [capture, refreshAnnotations])

  const counts = useMemo(() => {
    const c = { same: 0, different: 0, bad_jump: 0 }
    for (const a of annotations) c[a.kind]++
    return c
  }, [annotations])

  // temporal relationship of the selected pair (drives the SAME-gate + readout)
  const pairInfo = useMemo(() => {
    if (!selA || !selB || !graph) return null
    const find = (id: string) => graph.chains.find(c => c.stableId === id)
    const ca = find(selA.stableId), cb = find(selB.stableId)
    if (!ca || !cb) return null
    const a0 = ca.t0 ?? (ca.path ? ca.path[0][2] : selA.t)
    const a1 = ca.t1 ?? (ca.path ? ca.path[ca.path.length - 1][2] : selA.t)
    const b0 = cb.t0 ?? (cb.path ? cb.path[0][2] : selB.t)
    const b1 = cb.t1 ?? (cb.path ? cb.path[cb.path.length - 1][2] : selB.t)
    const overlap = a0 <= b1 && b0 <= a1
    let gapS = 0
    if (!overlap) gapS = (a1 <= b0 ? b0 - a1 : a0 - b1) / 1000
    return { overlap, gapS: Math.round(gapS), tooLong: gapS > REID_MAX_GAP_S }
  }, [selA, selB, graph])

  return (
    <div ref={panelRef} className="absolute z-30 w-[36rem] bg-gray-900/95 backdrop-blur border border-sky-700/60 rounded-xl shadow-2xl text-gray-200 text-xs" style={panelStyle}>
      <div {...headerProps} className={`flex items-center gap-2 px-3 py-2 border-b border-gray-700/80 select-none touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`} title="Drag to move">
        <GripVertical className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        <Tag className="w-4 h-4 text-sky-400" />
        <span className="font-semibold text-white">Merge Annotation</span>
        <span className="ml-1 text-[10px] uppercase tracking-wider text-sky-400/80">isolated · 2D</span>
        <div className="flex-1" />
        <button onClick={() => loadGraph(capture)} disabled={loading || !capture} className="p-1 rounded hover:bg-gray-700/60 disabled:opacity-50" title="Reload graph">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
        <button onClick={onClose} className="p-1 rounded hover:bg-gray-700/60" title="Close"><X className="w-4 h-4" /></button>
      </div>

      <div className="p-3 space-y-2">
        {/* capture selector */}
        <div className="flex items-center gap-2">
          <span className="text-gray-400 shrink-0">Capture</span>
          <select value={capture} onChange={e => setCapture(e.target.value)} className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 truncate">
            {!captures.length && <option value="">(no captures)</option>}
            {captures.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>

        {error && (
          <div className="text-amber-300 bg-amber-950/40 border border-amber-800/50 rounded px-2 py-1.5">
            {error}
            <div className="text-[10px] text-amber-400/70 mt-1">Generate it on the server: <code>reconcile_graph.mjs --file {capture}</code></div>
          </div>
        )}

        {graph && (
          <>
            {/* filters + mode */}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={entranceOnly} onChange={e => setEntranceOnly(e.target.checked)} className="accent-sky-500" />
                <span>Entrance only</span>
              </label>
              <label className="flex items-center gap-1.5">
                <span className="text-gray-400">min len</span>
                <input type="range" min={0} max={20} step={1} value={minDisp} onChange={e => setMinDisp(Number(e.target.value))} className="w-20 accent-sky-500" />
                <span className="text-gray-300 w-8">{minDisp}m</span>
              </label>
              {stats && <span className="text-gray-500 ml-auto">{stats.shown.toLocaleString()} shown · {stats.entr} entrance</span>}
            </div>

            {/* time-window scrubber: only show tracks active in this slice, coloured by time */}
            {timeRange && (
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                    <input type="checkbox" checked={timeWindowOn} onChange={e => setTimeWindowOn(e.target.checked)} className="accent-sky-500" />
                    <span>Time window</span>
                  </label>
                  <input
                    type="range" min={0} max={maxStartMs} step={1000} value={startMs}
                    onChange={e => setWinStartMs(Number(e.target.value))}
                    disabled={!timeWindowOn}
                    className="flex-1 accent-sky-500 disabled:opacity-40"
                  />
                  <select value={winLenS} onChange={e => setWinLenS(Number(e.target.value))} disabled={!timeWindowOn}
                    className="bg-gray-800 border border-gray-700 rounded px-1.5 py-1 disabled:opacity-40">
                    {WIN_LENGTHS.map(s => <option key={s} value={s}>{s}s</option>)}
                  </select>
                </div>
                {timeWindowOn && (
                  <div className="text-[10px] text-gray-500">
                    showing <span className="text-gray-300">{fmtClock(startMs)}–{fmtClock(startMs + winLenS * 1000)}</span> of {fmtClock(timeRange.dur)} · colour = time (blue→red)
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <span className="text-gray-400">Mode</span>
              <button onClick={() => setMode('pair')} className={`px-2 py-1 rounded ${mode === 'pair' ? 'bg-sky-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>Pair (A/B)</button>
              <button onClick={() => setMode('badjump')} className={`px-2 py-1 rounded ${mode === 'badjump' ? 'bg-red-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>Bad jump</button>
              <button onClick={() => { setSelA(null); setSelB(null); setBadPoint(null) }} className="ml-auto px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center gap-1"><Eraser className="w-3 h-3" /> Clear</button>
            </div>

            {/* canvas */}
            <canvas
              ref={canvasRef} width={CW} height={CH}
              className="w-full rounded border border-gray-700 bg-[#0b0e14] cursor-crosshair"
              onPointerMove={onMove} onPointerDown={onClick} onPointerLeave={() => setHoverId(null)}
            />

            {/* selection summary */}
            <div className="flex items-center gap-2 text-[11px]">
              {mode === 'pair' ? (
                <>
                  <span className="px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-300">A: {selA?.stableId ?? '—'}</span>
                  <span className="px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-300">B: {selB?.stableId ?? '—'}</span>
                  {pairInfo && (
                    <span className={`px-1.5 py-0.5 rounded ${pairInfo.tooLong ? 'bg-red-900/60 text-red-300' : pairInfo.overlap ? 'bg-yellow-900/50 text-yellow-300' : 'bg-gray-800 text-gray-300'}`}
                      title={pairInfo.tooLong ? `Gap exceeds the ${REID_MAX_GAP_S}s re-ID limit — these are almost certainly different people` : ''}>
                      {pairInfo.overlap ? 'concurrent' : `gap ${pairInfo.gapS}s`}{pairInfo.tooLong ? ' · too long' : ''}
                    </span>
                  )}
                  <div className="flex-1" />
                  <button disabled={!selA || !selB || saving || !!pairInfo?.tooLong} onClick={() => submit('same')} className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white flex items-center gap-1" title={pairInfo?.tooLong ? `Blocked: gap > ${REID_MAX_GAP_S}s` : 'Mark as the same person'}><Users className="w-3 h-3" /> SAME</button>
                  <button disabled={!selA || !selB || saving} onClick={() => submit('different')} className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white flex items-center gap-1"><UserX className="w-3 h-3" /> DIFFERENT</button>
                </>
              ) : (
                <>
                  <span className="px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">Point: {badPoint?.stableId ?? '—'}</span>
                  <div className="flex-1" />
                  <button disabled={!badPoint || saving} onClick={() => submit('bad_jump')} className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white flex items-center gap-1"><Zap className="w-3 h-3" /> Mark bad jump</button>
                </>
              )}
            </div>

            <div className="text-[10px] text-gray-500 leading-tight">
              {mode === 'pair'
                ? 'Use the time window so overlapping tracks are real candidates (not same-spot/different-time lookalikes). Click one track, then another. SAME = should be one person (false split); blocked when the gap exceeds the re-ID limit. DIFFERENT = wrongly merged into one chain.'
                : 'Click the point on a track where the trajectory makes an impossible jump.'}
            </div>

            {/* annotations list */}
            <div className="border-t border-gray-700/70 pt-2">
              <div className="flex items-center gap-2 text-gray-400 mb-1">
                <span className="font-medium text-gray-300">Labels ({annotations.length})</span>
                <span className="text-emerald-400">{counts.same} same</span>
                <span className="text-rose-400">{counts.different} diff</span>
                <span className="text-red-400">{counts.bad_jump} jump</span>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                {annotations.map(a => (
                  <div key={a.id} className="flex items-center gap-2 bg-gray-800/60 rounded px-2 py-1">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${a.kind === 'same' ? 'bg-emerald-900/60 text-emerald-300' : a.kind === 'different' ? 'bg-rose-900/60 text-rose-300' : 'bg-red-900/60 text-red-300'}`}>{a.kind}</span>
                    <span className="text-gray-400 truncate">{a.a.track ?? '?'}{a.kind !== 'bad_jump' ? ` ↔ ${a.b.track ?? '?'}` : ''}</span>
                    <div className="flex-1" />
                    <button onClick={() => deleteAnnotation(a.id)} className="p-1 rounded hover:bg-gray-700/60 text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
                {!annotations.length && <div className="text-gray-600 italic">No labels yet.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
