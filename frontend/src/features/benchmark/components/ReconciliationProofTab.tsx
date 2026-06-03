import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Play, Pause, SkipBack, Loader2, Film, Users, Eraser, Palette } from 'lucide-react'
import { API_BASE } from '../../../config/api'
import type { BenchmarkRunDetail } from '../types'

// ---- graph shapes (from /api/replay/reconcile/graph?full=1) ----
type PathPt = [number, number, number] // x, z, t(ms)
interface GraphChain { stableId: string; path?: PathPt[]; tracklets?: string[]; entr?: number; t0?: number; t1?: number; disp?: number }
interface GraphTracklet { id: string; src: string; t0: number; t1: number; n: number }
interface Graph {
  sourceFile: string
  venueId?: string | null
  firstTs?: number
  lastTs?: number
  extent: { minX: number; maxX: number; minZ: number; maxZ: number } | null
  entrance: { name: string; vertices: { x: number; z: number }[] } | null
  chains: GraphChain[]
  tracklets?: GraphTracklet[]
}

interface Seg { t: number; x1: number; z1: number; x2: number; z2: number; id: string; stable: string }
interface Beat { stable: string; t0: number; t1: number; gapS: number; frags: number; caption: string }

const CW = 470, CH = 430, PAD = 12
const WIN_LENGTHS = [10, 30, 60, 120]
const SPEEDS = [1, 4, 8, 16]
const CHURN_BUCKET_S = 30
const fmtClock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

function hue(str: string) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h }
const colorId = (str: string, a = 1) => `hsla(${hue(str)}, 72%, 60%, ${a})`

function fmt(n: number | undefined | null, d = 1) { if (n == null || Number.isNaN(n)) return '—'; return n.toFixed(d) }

export default function ReconciliationProofTab({ detail }: { detail: BenchmarkRunDetail }) {
  const sourceFile = detail.scorecard?.source_file || detail.summary?.source_file || ''
  const perception = detail.scorecard?.layers?.perception
  const recon = detail.scorecard?.layers?.reconciler?.GROCERY_V2_MAP
  const footfall = detail.scorecard?.layers?.footfall

  const [graph, setGraph] = useState<Graph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // transport
  const [playing, setPlaying] = useState(false)
  const [tNow, setTNow] = useState(0)              // ms since firstTs
  const [speed, setSpeed] = useState(4)
  const [winLenS, setWinLenS] = useState(30)
  const [colorMode, setColorMode] = useState<'id' | 'time'>('id')
  const [selected, setSelected] = useState<string | null>(null)
  const [storyOn, setStoryOn] = useState(false)
  const [storyIdx, setStoryIdx] = useState(0)

  const rawCanvas = useRef<HTMLCanvasElement>(null)
  const recCanvas = useRef<HTMLCanvasElement>(null)
  const churnCanvas = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number>(0)

  // ---- load graph ----
  useEffect(() => {
    if (!sourceFile) return
    setLoading(true); setError(null); setGraph(null); setSelected(null); setTNow(0); setPlaying(false)
    fetch(`${API_BASE}/api/replay/reconcile/graph?sourceFile=${encodeURIComponent(sourceFile)}&full=1`)
      .then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `No reconciliation graph for this capture (HTTP ${r.status})`) }
        return r.json()
      })
      .then((j) => setGraph(j.graph as Graph))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [sourceFile])

  // ---- precompute segments, buckets, lifetimes, churn, story beats ----
  const model = useMemo(() => {
    if (!graph?.extent || !graph.chains?.length) return null
    const t0Global = graph.firstTs ?? 0
    const trackletMap = new Map<string, GraphTracklet>((graph.tracklets || []).map((t) => [t.id, t]))

    const rawSegs: Seg[] = []
    const recSegs: Seg[] = []
    const rawLife = new Map<string, { t0: number; t1: number }>()   // perceptionId -> span
    const recLife = new Map<string, { t0: number; t1: number }>()   // stableId -> span
    const fragCount = new Map<string, number>()                      // stableId -> distinct raw ids
    let dur = 1

    for (const c of graph.chains) {
      const p = c.path
      if (!p || p.length < 2) continue
      const stable = c.stableId
      // reconciled span
      const rt0 = (c.t0 ?? p[0][2]) - t0Global, rt1 = (c.t1 ?? p[p.length - 1][2]) - t0Global
      recLife.set(stable, { t0: rt0, t1: rt1 }); dur = Math.max(dur, rt1)
      // reconciled segments
      for (let i = 0; i < p.length - 1; i++) recSegs.push({ t: p[i][2] - t0Global, x1: p[i][0], z1: p[i][1], x2: p[i + 1][0], z2: p[i + 1][1], id: stable, stable })
      // raw fragments: assign each path point to its tracklet window (by time); break at pid changes / bridge gaps
      const tks = (c.tracklets || []).map((id) => trackletMap.get(id)).filter(Boolean) as GraphTracklet[]
      tks.sort((a, b) => a.t0 - b.t0)
      const pidAt = (t: number): string | null => { for (const k of tks) if (t >= k.t0 - 200 && t <= k.t1 + 200) return k.src; return null }
      const pidsSeen = new Set<string>()
      let prev: PathPt | null = null, prevPid: string | null = null
      for (const pt of p) {
        const pid = pidAt(pt[2])
        if (pid) {
          pidsSeen.add(pid)
          if (!rawLife.has(pid)) rawLife.set(pid, { t0: pt[2] - t0Global, t1: pt[2] - t0Global })
          else { const L = rawLife.get(pid)!; L.t0 = Math.min(L.t0, pt[2] - t0Global); L.t1 = Math.max(L.t1, pt[2] - t0Global) }
        }
        if (prev && prevPid && pid === prevPid) rawSegs.push({ t: prev[2] - t0Global, x1: prev[0], z1: prev[1], x2: pt[0], z2: pt[1], id: prevPid, stable })
        prev = pt; prevPid = pid
      }
      fragCount.set(stable, pidsSeen.size || (c.tracklets?.length ?? 1))
    }

    // bucket segments by second for fast windowed draw
    const bucket = (segs: Seg[]) => { const m = new Map<number, number[]>(); segs.forEach((s, i) => { const k = Math.floor(s.t / 1000); let a = m.get(k); if (!a) { a = []; m.set(k, a) } a.push(i) }); return m }
    const rawBuckets = bucket(rawSegs)
    const recBuckets = bucket(recSegs)

    // churn (births/deaths per 30s)
    const nB = Math.ceil(dur / 1000 / CHURN_BUCKET_S) + 1
    const churn = { rawBirth: new Array(nB).fill(0), rawDeath: new Array(nB).fill(0), recBirth: new Array(nB).fill(0), recDeath: new Array(nB).fill(0) }
    const bi = (ms: number) => Math.min(nB - 1, Math.max(0, Math.floor(ms / 1000 / CHURN_BUCKET_S)))
    for (const L of rawLife.values()) { churn.rawBirth[bi(L.t0)]++; churn.rawDeath[bi(L.t1)]++ }
    for (const L of recLife.values()) { churn.recBirth[bi(L.t0)]++; churn.recDeath[bi(L.t1)]++ }

    // story beats: chains with the largest bridged internal gap
    const beats: Beat[] = []
    for (const c of graph.chains) {
      if (!c.path || (c.tracklets?.length ?? 0) < 2) continue
      const tks = (c.tracklets || []).map((id) => trackletMap.get(id)).filter(Boolean) as GraphTracklet[]
      tks.sort((a, b) => a.t0 - b.t0)
      let maxGap = 0
      for (let i = 1; i < tks.length; i++) maxGap = Math.max(maxGap, (tks[i].t0 - tks[i - 1].t1) / 1000)
      const frags = new Set(tks.map((t) => t.src)).size
      if (maxGap > 0 && frags >= 2) beats.push({ stable: c.stableId, t0: (c.t0 ?? 0) - t0Global, t1: (c.t1 ?? 0) - t0Global, gapS: maxGap, frags, caption: `1 shopper reconstructed from ${frags} raw IDs — LiDAR lost them for ${maxGap.toFixed(1)}s (behind a shelf); reconciliation bridged the gap.` })
    }
    beats.sort((a, b) => b.gapS - a.gapS)

    return { rawSegs, recSegs, rawBuckets, recBuckets, rawLife, recLife, fragCount, churn, nB, dur, beats: beats.slice(0, 6) }
  }, [graph])

  const totalDur = model?.dur ?? 1

  // ---- transform (shared by both panes) ----
  const tf = useMemo(() => {
    const e = graph?.extent
    if (!e) return null
    const spanX = Math.max(0.1, e.maxX - e.minX), spanZ = Math.max(0.1, e.maxZ - e.minZ)
    const scale = Math.min((CW - 2 * PAD) / spanX, (CH - 2 * PAD) / spanZ)
    const ox = PAD + (CW - 2 * PAD - spanX * scale) / 2 - e.minX * scale
    const oz = PAD + (CH - 2 * PAD - spanZ * scale) / 2 - e.minZ * scale
    return { scale, ox, oz }
  }, [graph])

  // ---- draw one pane ----
  const drawPane = useCallback((canvas: HTMLCanvasElement | null, segs: Seg[], buckets: Map<number, number[]>, mode: 'raw' | 'rec') => {
    if (!canvas || !tf || !model) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const win = winLenS * 1000
    const t1 = tNow, t0 = tNow - win
    const toPx = (x: number, z: number): [number, number] => [x * tf.scale + tf.ox, CH - (z * tf.scale + tf.oz)]
    ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, CW, CH)
    // entrance ROI
    if (graph?.entrance?.vertices?.length) {
      ctx.beginPath(); graph.entrance.vertices.forEach((v, i) => { const [px, py] = toPx(v.x, v.z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) })
      ctx.closePath(); ctx.strokeStyle = 'rgba(34,211,238,0.5)'; ctx.lineWidth = 1.2; ctx.stroke()
    }
    const sec0 = Math.floor(t0 / 1000), sec1 = Math.floor(t1 / 1000)
    ctx.lineWidth = mode === 'rec' ? 1.8 : 1.4
    for (let s = sec0; s <= sec1; s++) {
      const arr = buckets.get(s); if (!arr) continue
      for (const idx of arr) {
        const seg = segs[idx]
        if (seg.t < t0 || seg.t > t1) continue
        const dim = selected && seg.stable !== selected
        let color: string
        if (mode === 'rec' && colorMode === 'time') {
          const u = Math.max(0, Math.min(1, (seg.t - t0) / win)); color = `hsla(${Math.round(220 - 220 * u)}, 80%, 62%, ${dim ? 0.08 : 1})`
        } else {
          color = colorId(mode === 'rec' ? seg.stable : seg.id, dim ? 0.08 : 1)
        }
        const [x1, y1] = toPx(seg.x1, seg.z1), [x2, y2] = toPx(seg.x2, seg.z2)
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.stroke()
      }
    }
  }, [tf, model, graph, tNow, winLenS, colorMode, selected])

  // ---- active-id counts at playhead ----
  const liveCounts = useMemo(() => {
    if (!model) return { raw: 0, rec: 0 }
    const lo = tNow - 1000, hi = tNow
    let raw = 0, rec = 0
    for (const L of model.rawLife.values()) if (L.t1 >= lo && L.t0 <= hi) raw++
    for (const L of model.recLife.values()) if (L.t1 >= lo && L.t0 <= hi) rec++
    return { raw, rec }
  }, [model, tNow])

  // ---- render frame whenever inputs change ----
  useEffect(() => {
    if (!model) return
    drawPane(rawCanvas.current, model.rawSegs, model.rawBuckets, 'raw')
    drawPane(recCanvas.current, model.recSegs, model.recBuckets, 'rec')
  }, [model, drawPane])

  // ---- playback loop ----
  useEffect(() => {
    if (!playing || !model) return
    const step = (ts: number) => {
      const last = lastFrameRef.current || ts
      const dt = ts - last
      lastFrameRef.current = ts
      setTNow((prev) => {
        let next = prev + dt * speed
        if (storyOn && model.beats.length) {
          const beat = model.beats[storyIdx % model.beats.length]
          if (next >= beat.t1 + 1500) { const ni = (storyIdx + 1) % model.beats.length; setStoryIdx(ni); return Math.max(0, model.beats[ni].t0 - 1000) }
        } else if (next >= totalDur) { next = 0 }
        return next
      })
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); lastFrameRef.current = 0 }
  }, [playing, model, speed, storyOn, storyIdx, totalDur])

  // ---- churn sparkline ----
  useEffect(() => {
    const canvas = churnCanvas.current; if (!canvas || !model) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, W, H)
    const n = model.nB
    const rawTot = model.churn.rawBirth.map((b, i) => b + model.churn.rawDeath[i])
    const recTot = model.churn.recBirth.map((b, i) => b + model.churn.recDeath[i])
    const maxV = Math.max(1, ...rawTot, ...recTot)
    const xAt = (i: number) => (i / Math.max(1, n - 1)) * W
    const line = (vals: number[], color: string) => { ctx.beginPath(); vals.forEach((v, i) => { const x = xAt(i), y = H - (v / maxV) * (H - 4) - 2; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y) }); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke() }
    line(rawTot, 'rgba(248,113,113,0.9)')
    line(recTot, 'rgba(52,211,153,0.95)')
    // playhead
    const px = (tNow / 1000 / CHURN_BUCKET_S / Math.max(1, n - 1)) * W
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke()
  }, [model, tNow])

  // ---- click a reconciled chain to follow it ----
  const onRecClick = useCallback((ev: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!tf || !model) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const mx = (ev.clientX - rect.left) * (CW / rect.width), my = (ev.clientY - rect.top) * (CH / rect.height)
    const win = winLenS * 1000, t0 = tNow - win
    const toPx = (x: number, z: number): [number, number] => [x * tf.scale + tf.ox, CH - (z * tf.scale + tf.oz)]
    let best: string | null = null, bestD = 14 * 14
    for (const seg of model.recSegs) {
      if (seg.t < t0 || seg.t > tNow) continue
      const [px, py] = toPx(seg.x1, seg.z1); const d = (px - mx) ** 2 + (py - my) ** 2
      if (d < bestD) { bestD = d; best = seg.stable }
    }
    setSelected(best)
  }, [tf, model, tNow, winLenS])

  const selInfo = useMemo(() => {
    if (!selected || !model) return null
    const frags = model.fragCount.get(selected) ?? 0
    const life = model.recLife.get(selected)
    return { frags, durS: life ? (life.t1 - life.t0) / 1000 : 0 }
  }, [selected, model])

  const startStory = () => {
    if (!model?.beats.length) return
    setStoryOn(true); setSelected(model.beats[0].stable); setStoryIdx(0)
    setTNow(Math.max(0, model.beats[0].t0 - 1000)); setWinLenS(30); setSpeed(4); setPlaying(true)
  }
  useEffect(() => { if (storyOn && model?.beats.length) setSelected(model.beats[storyIdx % model.beats.length].stable) }, [storyIdx, storyOn, model])

  // ---- KPI helpers ----
  const churnCut = perception?.unique_perception_ids && recon?.stable_tracks
    ? (1 - recon.stable_tracks / perception.unique_perception_ids) * 100 : null

  if (!sourceFile) return <div className="text-sm text-gray-500 py-8 text-center">No source capture on this run.</div>
  if (loading) return <div className="flex items-center gap-2 text-gray-400 py-12 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading reconciliation graph…</div>
  if (error) return (
    <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-6 text-sm text-amber-200">
      {error}
      <p className="text-amber-300/70 mt-2 text-xs">This tab needs a v2 reconciliation graph sidecar for the capture. Run the map-aware v2 post-process (or graph-only generator) on <code>{sourceFile}</code>.</p>
    </div>
  )

  const KpiCard = ({ label, raw, rec, suffix = '' }: { label: string; raw: string; rec: string; suffix?: string }) => (
    <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">{label}</p>
      <div className="flex items-end gap-1.5">
        <span className="text-sm text-blue-300/80 font-mono">{raw}{suffix}</span>
        <span className="text-gray-600">→</span>
        <span className="text-xl font-semibold text-emerald-300 font-mono">{rec}{suffix}</span>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* headline cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Fragments / real shopper" raw={fmt(perception?.fragments_per_shopper, 1)} rec={fmt(recon?.fragments_per_shopper, 1)} suffix="×" />
        <KpiCard label="Track identities" raw={perception?.unique_perception_ids?.toLocaleString() ?? '—'} rec={recon?.stable_tracks?.toLocaleString() ?? '—'} />
        <KpiCard label="Mean track lifetime" raw={fmt(perception?.mean_lifetime_s)} rec={fmt(recon?.mean_lifetime_s)} suffix="s" />
        <KpiCard label="Teleports / 1k msgs" raw={fmt(perception?.teleports_per_1k, 1)} rec={fmt(recon?.teleports_per_1k, 1)} />
      </div>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={startStory} disabled={!model?.beats.length} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-purple-600/60 bg-purple-950/40 text-purple-200 hover:bg-purple-900/40 disabled:opacity-40">
          <Film className="w-4 h-4" /> Story mode
        </button>
        <button type="button" onClick={() => setColorMode((m) => (m === 'id' ? 'time' : 'id'))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-600 text-gray-300 hover:text-white">
          <Palette className="w-4 h-4" /> Colour: {colorMode === 'id' ? 'by identity' : 'by time'}
        </button>
        {(selected || storyOn) && (
          <button type="button" onClick={() => { setSelected(null); setStoryOn(false) }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-600 text-gray-400 hover:text-white">
            <Eraser className="w-4 h-4" /> Clear focus
          </button>
        )}
        {footfall?.entrance_footfall != null && (
          <span className="text-xs text-gray-500 ml-1">Denominator: {footfall.entrance_footfall} entrants @ gate</span>
        )}
      </div>

      {/* dual maps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-blue-900/40 bg-[#0b0e14] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <span className="text-xs font-medium text-blue-300">RAW perception <span className="text-gray-600">· colour = LiDAR ID</span></span>
            <span className="text-xs text-gray-400 flex items-center gap-1"><Users className="w-3 h-3" /> {liveCounts.raw} active</span>
          </div>
          <canvas ref={rawCanvas} width={CW} height={CH} className="w-full block" style={{ aspectRatio: `${CW}/${CH}` }} />
        </div>
        <div className="rounded-xl border border-emerald-900/40 bg-[#0b0e14] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <span className="text-xs font-medium text-emerald-300">RECONCILED v2 <span className="text-gray-600">· click a track to follow</span></span>
            <span className="text-xs text-gray-400 flex items-center gap-1"><Users className="w-3 h-3" /> {liveCounts.rec} active</span>
          </div>
          <canvas ref={recCanvas} width={CW} height={CH} onClick={onRecClick} className="w-full block cursor-pointer" style={{ aspectRatio: `${CW}/${CH}` }} />
        </div>
      </div>

      {/* follow-one-shopper badge */}
      {selInfo && (
        <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2.5 text-sm text-amber-100">
          <span className="font-semibold">1 shopper = {selInfo.frags} raw IDs</span> stitched into one {selInfo.durS.toFixed(0)}s journey.
          {storyOn && <span className="text-amber-300/80 ml-2">{model?.beats[storyIdx % (model?.beats.length || 1)]?.caption}</span>}
        </div>
      )}

      {/* transport */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3 space-y-2">
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => { setTNow(0); setStoryOn(false) }} className="text-gray-400 hover:text-white"><SkipBack className="w-4 h-4" /></button>
          <button type="button" onClick={() => setPlaying((v) => !v)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-sm">
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}{playing ? 'Pause' : 'Play'}
          </button>
          <input type="range" min={0} max={totalDur} value={Math.min(tNow, totalDur)} onChange={(e) => { setTNow(Number(e.target.value)); setStoryOn(false) }} className="flex-1 accent-emerald-500" />
          <span className="text-xs text-gray-400 font-mono w-24 text-right">{fmtClock(tNow)} / {fmtClock(totalDur)}</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-gray-500">Speed</span>
            {SPEEDS.map((s) => (
              <button key={s} type="button" onClick={() => setSpeed(s)} className={`px-2 py-0.5 rounded ${speed === s ? 'bg-emerald-700 text-white' : 'text-gray-400 hover:text-white'}`}>{s}×</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-gray-500">Window</span>
            {WIN_LENGTHS.map((w) => (
              <button key={w} type="button" onClick={() => setWinLenS(w)} className={`px-2 py-0.5 rounded ${winLenS === w ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}>{w}s</button>
            ))}
          </div>
        </div>
      </div>

      {/* churn sparkline */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">ID churn over time (births + deaths / {CHURN_BUCKET_S}s)</p>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="text-red-400">▬ raw</span>
            <span className="text-emerald-400">▬ reconciled</span>
          </div>
        </div>
        <canvas ref={churnCanvas} width={920} height={70} className="w-full block" style={{ aspectRatio: '920/70' }} />
      </div>

      {/* cumulative KPI strip */}
      <div className="overflow-x-auto rounded-xl border border-gray-700">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-800 text-gray-400 text-left">
            <th className="px-4 py-2 font-medium">Continuity & duration KPIs</th>
            <th className="px-4 py-2 font-medium text-right text-blue-300">Raw</th>
            <th className="px-4 py-2 font-medium text-right text-emerald-300">Reconciled</th>
          </tr></thead>
          <tbody className="text-gray-300">
            <tr className="border-t border-gray-700/70"><td className="px-4 py-2">Track identities (total)</td><td className="px-4 py-2 text-right">{perception?.unique_perception_ids?.toLocaleString() ?? '—'}</td><td className="px-4 py-2 text-right">{recon?.stable_tracks?.toLocaleString() ?? '—'}{churnCut != null && <span className="text-emerald-400 text-xs ml-1">(−{churnCut.toFixed(0)}%)</span>}</td></tr>
            <tr className="border-t border-gray-700/70"><td className="px-4 py-2">Fragments per real shopper</td><td className="px-4 py-2 text-right">{fmt(perception?.fragments_per_shopper, 1)}×</td><td className="px-4 py-2 text-right">{fmt(recon?.fragments_per_shopper, 1)}×</td></tr>
            <tr className="border-t border-gray-700/70"><td className="px-4 py-2">Mean track lifetime</td><td className="px-4 py-2 text-right">{fmt(perception?.mean_lifetime_s)}s</td><td className="px-4 py-2 text-right">{fmt(recon?.mean_lifetime_s)}s</td></tr>
            <tr className="border-t border-gray-700/70"><td className="px-4 py-2">Mean continuous path</td><td className="px-4 py-2 text-right">{fmt(perception?.mean_displacement_m)}m</td><td className="px-4 py-2 text-right">{fmt(recon?.mean_displacement_m)}m</td></tr>
            <tr className="border-t border-gray-700/70"><td className="px-4 py-2">Teleports / 1k msgs</td><td className="px-4 py-2 text-right">{fmt(perception?.teleports_per_1k, 1)}</td><td className="px-4 py-2 text-right">{fmt(recon?.teleports_per_1k, 1)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
