import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Play, Pause, SkipBack, Loader2, Film, Users, Eraser, Palette, LayoutGrid, ChevronLeft, ChevronRight } from 'lucide-react'
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

interface WireObj { x: number; z: number; w: number; d: number; rot: number }
interface Seg { t: number; x1: number; z1: number; x2: number; z2: number; id: string; stable: string }
interface Beat { stable: string; t0: number; t1: number; gapS: number; frags: number; caption: string }
interface RankEntry { stable: string; frags: number; durS: number; gapS: number; t0: number; t1: number; score: number }
type ViewMode = 'window' | 'trails' | 'cohort'

const CW = 470, CH = 430, PAD = 12
const WIN_LENGTHS = [10, 30, 60, 120]
const COHORT_LENGTHS = [300, 600, 900] // seconds (5/10/15 min)
const SPEEDS = [1, 4, 8, 16]
const CHURN_BUCKET_S = 30
const TRAIL_FADE_MS = 6000
const fmtClock = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const fmtSpan = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s}s`)

function hue(str: string) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h }
const colorId = (str: string, a = 1) => `hsla(${hue(str)}, 72%, 60%, ${a})`
function fmt(n: number | undefined | null, d = 1) { if (n == null || Number.isNaN(n)) return '—'; return n.toFixed(d) }

interface PresetOpt { presetId: string; presetLabel: string }

export default function ReconciliationProofTab({ detail }: { detail: BenchmarkRunDetail }) {
  const sourceFile = detail.scorecard?.source_file || detail.summary?.source_file || ''
  const perception = detail.scorecard?.layers?.perception
  const footfall = detail.scorecard?.layers?.footfall

  // which reconciled preset (engine) we compare raw against — user-selectable
  const [presets, setPresets] = useState<PresetOpt[]>([])
  const [presetId, setPresetId] = useState<string>('GROCERY_V2_MAP')
  const recon = detail.scorecard?.layers?.reconciler?.[presetId]
  const presetLabel = presets.find((p) => p.presetId === presetId)?.presetLabel || presetId

  const [graph, setGraph] = useState<Graph | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // transport + view
  const [viewMode, setViewMode] = useState<ViewMode>('trails')
  const [playing, setPlaying] = useState(false)
  const [tNow, setTNow] = useState(0)              // ms since firstTs
  const [speed, setSpeed] = useState(4)
  const [winLenS, setWinLenS] = useState(30)
  const [cohortLenS, setCohortLenS] = useState(600)
  const [colorMode, setColorMode] = useState<'id' | 'time'>('id')
  const [selected, setSelected] = useState<string | null>(null)
  const [storyOn, setStoryOn] = useState(false)
  const [storyIdx, setStoryIdx] = useState(0)
  const [wire, setWire] = useState<WireObj[]>([])
  const [showWire, setShowWire] = useState(true)

  const rawCanvas = useRef<HTMLCanvasElement>(null)
  const recCanvas = useRef<HTMLCanvasElement>(null)
  const churnCanvas = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef<number>(0)

  // ---- discover which reconciled presets exist for this capture (populate the select) ----
  useEffect(() => {
    if (!sourceFile) { setPresets([]); return }
    fetch(`${API_BASE}/api/replay/reconcile/jobs?sourceFile=${encodeURIComponent(sourceFile)}`)
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((j) => {
        const seen = new Set<string>()
        const list: PresetOpt[] = []
        for (const job of (j.jobs || []) as { status?: string; presetId?: string; presetLabel?: string }[]) {
          if (job.status !== 'complete' || !job.presetId || seen.has(job.presetId)) continue
          seen.add(job.presetId)
          list.push({ presetId: job.presetId, presetLabel: job.presetLabel || job.presetId })
        }
        setPresets(list)
        setPresetId((prev) => (
          list.some((p) => p.presetId === prev)
            ? prev
            : (list.find((p) => p.presetId === 'GROCERY_V2_MAP')?.presetId || list[0]?.presetId || 'GROCERY_V2_MAP')
        ))
      })
      .catch(() => setPresets([]))
  }, [sourceFile])

  // ---- load graph for the selected reconciled preset (raw vs that engine) ----
  useEffect(() => {
    if (!sourceFile || !presetId) return
    setLoading(true); setError(null); setGraph(null); setSelected(null); setTNow(0); setPlaying(false)
    fetch(`${API_BASE}/api/replay/reconcile/graph?sourceFile=${encodeURIComponent(sourceFile)}&presetId=${encodeURIComponent(presetId)}&full=1`)
      .then(async (r) => {
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `No reconciliation graph for this capture (HTTP ${r.status})`) }
        return r.json()
      })
      .then((j) => setGraph(j.graph as Graph))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [sourceFile, presetId])

  // ---- load store fixtures (venue frame — same frame as v2 graph paths) for the ghost wireframe ----
  useEffect(() => {
    if (!detail.id) return
    setWire([])
    fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(detail.id)}/coverage/floorplan`)
      .then((r) => (r.ok ? r.json() : null))
      .then((fp) => {
        const objs = (fp?.objects as { x: number; z: number; w: number; d: number; rotation_y?: number }[] | undefined) || []
        setWire(objs.filter((o) => o.w > 0 && o.d > 0).map((o) => ({ x: o.x, z: o.z, w: o.w, d: o.d, rot: o.rotation_y || 0 })))
      })
      .catch(() => setWire([]))
  }, [detail.id])

  // ---- precompute segments, per-track lists, buckets, lifetimes, churn, story beats ----
  const model = useMemo(() => {
    if (!graph?.extent || !graph.chains?.length) return null
    const t0Global = graph.firstTs ?? 0
    const trackletMap = new Map<string, GraphTracklet>((graph.tracklets || []).map((t) => [t.id, t]))

    const rawSegs: Seg[] = []
    const recSegs: Seg[] = []
    const rawByTrack = new Map<string, Seg[]>()
    const recByTrack = new Map<string, Seg[]>()
    const rawLife = new Map<string, { t0: number; t1: number }>()
    const recLife = new Map<string, { t0: number; t1: number }>()
    const fragCount = new Map<string, number>()
    let dur = 1

    const pushTrack = (m: Map<string, Seg[]>, k: string, s: Seg) => { let a = m.get(k); if (!a) { a = []; m.set(k, a) } a.push(s) }

    for (const c of graph.chains) {
      const p = c.path
      if (!p || p.length < 2) continue
      const stable = c.stableId
      const rt0 = (c.t0 ?? p[0][2]) - t0Global, rt1 = (c.t1 ?? p[p.length - 1][2]) - t0Global
      recLife.set(stable, { t0: rt0, t1: rt1 }); dur = Math.max(dur, rt1)
      for (let i = 0; i < p.length - 1; i++) {
        const s: Seg = { t: p[i][2] - t0Global, x1: p[i][0], z1: p[i][1], x2: p[i + 1][0], z2: p[i + 1][1], id: stable, stable }
        recSegs.push(s); pushTrack(recByTrack, stable, s)
      }
      const tks = (c.tracklets || []).map((id) => trackletMap.get(id)).filter(Boolean) as GraphTracklet[]
      tks.sort((a, b) => a.t0 - b.t0)
      const pidAt = (t: number): string | null => { for (const k of tks) if (t >= k.t0 - 200 && t <= k.t1 + 200) return k.src; return null }
      const pidsSeen = new Set<string>()
      let prev: PathPt | null = null, prevPid: string | null = null
      for (const pt of p) {
        const pid = pidAt(pt[2])
        if (pid) {
          pidsSeen.add(pid)
          const tt = pt[2] - t0Global
          if (!rawLife.has(pid)) rawLife.set(pid, { t0: tt, t1: tt })
          else { const L = rawLife.get(pid)!; L.t0 = Math.min(L.t0, tt); L.t1 = Math.max(L.t1, tt) }
        }
        if (prev && prevPid && pid === prevPid) {
          const s: Seg = { t: prev[2] - t0Global, x1: prev[0], z1: prev[1], x2: pt[0], z2: pt[1], id: prevPid, stable }
          rawSegs.push(s); pushTrack(rawByTrack, prevPid, s)
        }
        prev = pt; prevPid = pid
      }
      fragCount.set(stable, pidsSeen.size || (c.tracklets?.length ?? 1))
    }
    for (const a of rawByTrack.values()) a.sort((x, y) => x.t - y.t)
    for (const a of recByTrack.values()) a.sort((x, y) => x.t - y.t)

    const bucket = (segs: Seg[]) => { const m = new Map<number, number[]>(); segs.forEach((s, i) => { const k = Math.floor(s.t / 1000); let a = m.get(k); if (!a) { a = []; m.set(k, a) } a.push(i) }); return m }
    const rawBuckets = bucket(rawSegs)
    const recBuckets = bucket(recSegs)

    const nB = Math.ceil(dur / 1000 / CHURN_BUCKET_S) + 1
    const churn = { rawBirth: new Array(nB).fill(0), rawDeath: new Array(nB).fill(0), recBirth: new Array(nB).fill(0), recDeath: new Array(nB).fill(0) }
    const bi = (ms: number) => Math.min(nB - 1, Math.max(0, Math.floor(ms / 1000 / CHURN_BUCKET_S)))
    for (const L of rawLife.values()) { churn.rawBirth[bi(L.t0)]++; churn.rawDeath[bi(L.t1)]++ }
    for (const L of recLife.values()) { churn.recBirth[bi(L.t0)]++; churn.recDeath[bi(L.t1)]++ }

    const ranked: RankEntry[] = []
    for (const c of graph.chains) {
      const stable = c.stableId
      const frags = fragCount.get(stable) ?? 0
      if (!c.path || frags < 2) continue
      const tks = (c.tracklets || []).map((id) => trackletMap.get(id)).filter(Boolean) as GraphTracklet[]
      tks.sort((a, b) => a.t0 - b.t0)
      let maxGap = 0
      for (let i = 1; i < tks.length; i++) maxGap = Math.max(maxGap, (tks[i].t0 - tks[i - 1].t1) / 1000)
      const L = recLife.get(stable)
      const t0 = L ? L.t0 : 0, t1 = L ? L.t1 : 0
      ranked.push({ stable, frags, durS: (t1 - t0) / 1000, gapS: maxGap, t0, t1, score: frags * 100 + maxGap + (t1 - t0) / 2000 })
    }
    ranked.sort((a, b) => b.score - a.score)
    const beats: Beat[] = [...ranked].filter((r) => r.gapS > 0).sort((a, b) => b.gapS - a.gapS).slice(0, 6)
      .map((r) => ({ stable: r.stable, t0: r.t0, t1: r.t1, gapS: r.gapS, frags: r.frags, caption: `1 shopper reconstructed from ${r.frags} raw IDs — LiDAR lost them for ${r.gapS.toFixed(1)}s (behind a shelf); reconciliation bridged the gap.` }))

    return { rawSegs, recSegs, rawBuckets, recBuckets, rawByTrack, recByTrack, rawLife, recLife, fragCount, churn, nB, dur, beats, ranked: ranked.slice(0, 24) }
  }, [graph])

  const totalDur = model?.dur ?? 1

  // ---- span for the active view (drives counts + KPI overlay) ----
  const span = useMemo(() => {
    if (viewMode === 'cohort') return { s0: tNow, s1: tNow + cohortLenS * 1000 }
    if (viewMode === 'trails') return { s0: tNow - 1000, s1: tNow }
    return { s0: tNow - winLenS * 1000, s1: tNow }
  }, [viewMode, tNow, winLenS, cohortLenS])

  // ---- fixtures near the tracked area (drop far-away DWG outliers) + fitted extent ----
  const wireObjects = useMemo(() => {
    const e = graph?.extent
    if (!e || !wire.length) return [] as WireObj[]
    const m = 6
    return wire.filter((o) => o.x + o.w / 2 >= e.minX - m && o.x - o.w / 2 <= e.maxX + m && o.z + o.d / 2 >= e.minZ - m && o.z - o.d / 2 <= e.maxZ + m)
  }, [graph, wire])

  const fitExtent = useMemo(() => {
    const e = graph?.extent
    if (!e) return null
    let { minX, maxX, minZ, maxZ } = e
    for (const o of wireObjects) { minX = Math.min(minX, o.x - o.w / 2); maxX = Math.max(maxX, o.x + o.w / 2); minZ = Math.min(minZ, o.z - o.d / 2); maxZ = Math.max(maxZ, o.z + o.d / 2) }
    return { minX, maxX, minZ, maxZ }
  }, [graph, wireObjects])

  // ---- transform (shared by both panes) ----
  const tf = useMemo(() => {
    const e = fitExtent
    if (!e) return null
    const spanX = Math.max(0.1, e.maxX - e.minX), spanZ = Math.max(0.1, e.maxZ - e.minZ)
    const scale = Math.min((CW - 2 * PAD) / spanX, (CH - 2 * PAD) / spanZ)
    const ox = PAD + (CW - 2 * PAD - spanX * scale) / 2 - e.minX * scale
    const oz = PAD + (CH - 2 * PAD - spanZ * scale) / 2 - e.minZ * scale
    return { scale, ox, oz }
  }, [fitExtent])

  // ---- draw one pane ----
  const drawPane = useCallback((canvas: HTMLCanvasElement | null, pane: 'raw' | 'rec') => {
    if (!canvas || !tf || !model) return
    const ctx = canvas.getContext('2d'); if (!ctx) return
    const segs = pane === 'raw' ? model.rawSegs : model.recSegs
    const buckets = pane === 'raw' ? model.rawBuckets : model.recBuckets
    const byTrack = pane === 'raw' ? model.rawByTrack : model.recByTrack
    const lifeMap = pane === 'raw' ? model.rawLife : model.recLife
    const toPx = (x: number, z: number): [number, number] => [x * tf.scale + tf.ox, CH - (z * tf.scale + tf.oz)]
    ctx.fillStyle = '#0b0e14'; ctx.fillRect(0, 0, CW, CH)
    // ghost wireframe of store fixtures (shelves) — faint, behind everything
    if (showWire && wireObjects.length) {
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(125,145,175,0.22)'
      ctx.fillStyle = 'rgba(125,145,175,0.05)'
      for (const o of wireObjects) {
        const [cx, cy] = toPx(o.x, o.z)
        const hw = (o.w * tf.scale) / 2, hd = (o.d * tf.scale) / 2
        ctx.save(); ctx.translate(cx, cy); if (o.rot) ctx.rotate(-o.rot)
        ctx.beginPath(); ctx.rect(-hw, -hd, hw * 2, hd * 2); ctx.fill(); ctx.stroke(); ctx.restore()
      }
    }
    if (graph?.entrance?.vertices?.length) {
      ctx.beginPath(); graph.entrance.vertices.forEach((v, i) => { const [px, py] = toPx(v.x, v.z); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py) })
      ctx.closePath(); ctx.strokeStyle = 'rgba(34,211,238,0.5)'; ctx.lineWidth = 1.2; ctx.stroke()
    }
    ctx.lineWidth = pane === 'rec' ? 1.8 : 1.4
    const drawSeg = (seg: Seg, alpha: number) => {
      const dim = selected && seg.stable !== selected ? 0.06 : alpha
      let color: string
      if (pane === 'rec' && colorMode === 'time') { const u = Math.max(0, Math.min(1, (seg.t - span.s0) / Math.max(1, span.s1 - span.s0))); color = `hsla(${Math.round(220 - 220 * u)}, 80%, 62%, ${dim})` }
      else color = colorId(pane === 'rec' ? seg.stable : seg.id, dim)
      const [x1, y1] = toPx(seg.x1, seg.z1), [x2, y2] = toPx(seg.x2, seg.z2)
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.strokeStyle = color; ctx.stroke()
    }

    if (viewMode === 'window') {
      const t0 = tNow - winLenS * 1000
      for (let s = Math.floor(t0 / 1000); s <= Math.floor(tNow / 1000); s++) {
        const arr = buckets.get(s); if (!arr) continue
        for (const idx of arr) { const seg = segs[idx]; if (seg.t < t0 || seg.t > tNow) continue; drawSeg(seg, 1) }
      }
    } else if (viewMode === 'trails') {
      // each track's full path birth→playhead; fade out after death
      for (const [id, tsegs] of byTrack) {
        const L = lifeMap.get(id); if (!L) continue
        if (L.t0 > tNow || L.t1 < tNow - TRAIL_FADE_MS) continue
        const aliveAlpha = L.t1 >= tNow ? 1 : Math.max(0, 1 - (tNow - L.t1) / TRAIL_FADE_MS)
        for (const seg of tsegs) { if (seg.t > tNow) break; drawSeg(seg, aliveAlpha) }
      }
    } else { // cohort — full path of every track overlapping the window
      const { s0, s1 } = span
      for (const [id, tsegs] of byTrack) {
        const L = lifeMap.get(id); if (!L || L.t1 < s0 || L.t0 > s1) continue
        for (const seg of tsegs) drawSeg(seg, 0.92)
      }
    }
  }, [tf, model, graph, tNow, winLenS, colorMode, selected, viewMode, span, showWire, wireObjects])

  // ---- counts + KPIs over the active span ----
  const spanStats = useMemo(() => {
    if (!model) return null
    const { s0, s1 } = span
    let raw = 0, rec = 0, rawDur = 0, recDur = 0
    for (const L of model.rawLife.values()) if (L.t1 >= s0 && L.t0 <= s1) { raw++; rawDur += L.t1 - L.t0 }
    for (const L of model.recLife.values()) if (L.t1 >= s0 && L.t0 <= s1) { rec++; recDur += L.t1 - L.t0 }
    return { raw, rec, rawDurS: raw ? rawDur / raw / 1000 : 0, recDurS: rec ? recDur / rec / 1000 : 0, over: rec ? raw / rec : 0 }
  }, [model, span])

  // ---- render frame whenever inputs change ----
  useEffect(() => {
    if (!model) return
    drawPane(rawCanvas.current, 'raw')
    drawPane(recCanvas.current, 'rec')
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
    const px = (tNow / 1000 / CHURN_BUCKET_S / Math.max(1, n - 1)) * W
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke()
  }, [model, tNow])

  // ---- click a reconciled chain to follow it ----
  const onRecClick = useCallback((ev: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!tf || !model) return
    const rect = ev.currentTarget.getBoundingClientRect()
    const mx = (ev.clientX - rect.left) * (CW / rect.width), my = (ev.clientY - rect.top) * (CH / rect.height)
    const toPx = (x: number, z: number): [number, number] => [x * tf.scale + tf.ox, CH - (z * tf.scale + tf.oz)]
    let best: string | null = null, bestD = 14 * 14
    const consider = (seg: Seg) => { const [px, py] = toPx(seg.x1, seg.z1); const d = (px - mx) ** 2 + (py - my) ** 2; if (d < bestD) { bestD = d; best = seg.stable } }
    if (viewMode === 'window') { const t0 = tNow - winLenS * 1000; for (const seg of model.recSegs) { if (seg.t < t0 || seg.t > tNow) continue; consider(seg) } }
    else if (viewMode === 'trails') { for (const [id, tsegs] of model.recByTrack) { const L = model.recLife.get(id); if (!L || L.t0 > tNow || L.t1 < tNow - TRAIL_FADE_MS) continue; for (const seg of tsegs) { if (seg.t > tNow) break; consider(seg) } } }
    else { const { s0, s1 } = span; for (const [id, tsegs] of model.recByTrack) { const L = model.recLife.get(id); if (!L || L.t1 < s0 || L.t0 > s1) continue; for (const seg of tsegs) consider(seg) } }
    setSelected(best)
  }, [tf, model, tNow, winLenS, viewMode, span])

  const selInfo = useMemo(() => {
    if (!selected || !model) return null
    const frags = model.fragCount.get(selected) ?? 0
    const life = model.recLife.get(selected)
    return { frags, durS: life ? (life.t1 - life.t0) / 1000 : 0 }
  }, [selected, model])

  const focusChain = useCallback((e: RankEntry) => {
    setStoryOn(false); setPlaying(false); setSelected(e.stable)
    setTNow(viewMode === 'cohort' ? Math.max(0, e.t0 - 2000) : e.t1)
  }, [viewMode])

  const stepRank = useCallback((dir: number) => {
    const list = model?.ranked; if (!list?.length) return
    let i = list.findIndex((r) => r.stable === selected)
    i = i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length
    focusChain(list[i])
  }, [model, selected, focusChain])

  useEffect(() => {
    if (!model?.ranked.length) return
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowRight') { e.preventDefault(); stepRank(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); stepRank(-1) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [model, stepRank])

  const startStory = () => {
    if (!model?.beats.length) return
    setViewMode('trails'); setStoryOn(true); setSelected(model.beats[0].stable); setStoryIdx(0)
    setTNow(Math.max(0, model.beats[0].t0 - 1000)); setSpeed(4); setPlaying(true)
  }
  useEffect(() => { if (storyOn && model?.beats.length) setSelected(model.beats[storyIdx % model.beats.length].stable) }, [storyIdx, storyOn, model])

  const churnCut = perception?.unique_perception_ids && recon?.stable_tracks
    ? (1 - recon.stable_tracks / perception.unique_perception_ids) * 100 : null

  if (!sourceFile) return <div className="text-sm text-gray-500 py-8 text-center">No source capture on this run.</div>
  if (loading) return <div className="flex items-center gap-2 text-gray-400 py-12 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading reconciliation graph…</div>
  if (error) return (
    <div className="rounded-xl border border-amber-800/50 bg-amber-950/20 p-6 text-sm text-amber-200">
      {error}
      <p className="text-amber-300/70 mt-2 text-xs">Run a reconciliation post-process for <code>{presetLabel}</code> on <code>{sourceFile}</code>, then pick it from the “Reconciled” selector above to compare it against the raw perception.</p>
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

  const ViewBtn = ({ id, label }: { id: ViewMode; label: string }) => (
    <button type="button" onClick={() => setViewMode(id)} className={`px-2.5 py-1 rounded text-xs ${viewMode === id ? 'bg-emerald-700 text-white' : 'text-gray-400 hover:text-white'}`}>{label}</button>
  )

  const paneCount = (pane: 'raw' | 'rec') => (viewMode === 'cohort' ? `${pane === 'raw' ? spanStats?.raw : spanStats?.rec} in ${fmtSpan(cohortLenS)}` : `${pane === 'raw' ? spanStats?.raw : spanStats?.rec} active`)

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
        {presets.length > 0 && (
          <div className="flex items-center gap-1.5 bg-gray-800 rounded-lg p-1 pl-2">
            <span className="text-[10px] uppercase text-gray-500">Reconciled</span>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              title="Compare raw perception against this reconciled preset"
              className="bg-gray-900 text-gray-100 text-xs rounded px-2 py-1 border border-gray-700 focus:outline-none focus:border-emerald-600"
            >
              {presets.map((p) => (
                <option key={p.presetId} value={p.presetId}>{p.presetLabel}</option>
              ))}
            </select>
          </div>
        )}
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
          <span className="text-[10px] uppercase text-gray-500 px-1.5">View</span>
          <ViewBtn id="trails" label="Trails" />
          <ViewBtn id="cohort" label="Cohort" />
          <ViewBtn id="window" label="Window" />
        </div>
        <button type="button" onClick={startStory} disabled={!model?.beats.length} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-purple-600/60 bg-purple-950/40 text-purple-200 hover:bg-purple-900/40 disabled:opacity-40">
          <Film className="w-4 h-4" /> Story mode
        </button>
        <button type="button" onClick={() => setColorMode((m) => (m === 'id' ? 'time' : 'id'))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-600 text-gray-300 hover:text-white">
          <Palette className="w-4 h-4" /> {colorMode === 'id' ? 'by identity' : 'by time'}
        </button>
        {wire.length > 0 && (
          <button type="button" onClick={() => setShowWire((v) => !v)} title="Faint store-fixture wireframe behind the tracks (venue floorplan)" className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border ${showWire ? 'border-slate-500 text-slate-200 bg-slate-800/40' : 'border-gray-600 text-gray-400'} hover:text-white`}>
            <LayoutGrid className="w-4 h-4" /> Floorplan
          </button>
        )}
        {(selected || storyOn) && (
          <button type="button" onClick={() => { setSelected(null); setStoryOn(false) }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-600 text-gray-400 hover:text-white">
            <Eraser className="w-4 h-4" /> Clear focus
          </button>
        )}
      </div>

      {/* window-KPI overlay (extract real KPIs in this time slice) */}
      {spanStats && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-emerald-800/40 bg-emerald-950/15 px-4 py-2.5 text-sm">
          <span className="text-[10px] uppercase tracking-wide text-emerald-400/80">
            {viewMode === 'cohort' ? `In this ${fmtSpan(cohortLenS)} window` : viewMode === 'window' ? `In this ${winLenS}s window` : 'At this moment'}
          </span>
          <span className="text-gray-300">Raw counts <span className="text-blue-300 font-semibold font-mono">{spanStats.raw}</span> "shoppers"</span>
          <span className="text-gray-300">Reconciled <span className="text-emerald-300 font-semibold font-mono">{spanStats.rec}</span> real people</span>
          {spanStats.over > 0 && <span className="text-amber-300">→ raw over-counts {spanStats.over.toFixed(1)}×</span>}
          <span className="text-gray-500">avg duration {spanStats.rawDurS.toFixed(0)}s → <span className="text-emerald-300">{spanStats.recDurS.toFixed(0)}s</span></span>
        </div>
      )}

      {/* top-reconstructions navigator — surfaces the most dramatic stitched journeys */}
      {model && model.ranked.length > 0 && (() => {
        const cur = model.ranked.findIndex((r) => r.stable === selected)
        return (
          <div className="flex items-center gap-2 rounded-lg border border-purple-800/40 bg-purple-950/15 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wide text-purple-300/80 whitespace-nowrap">Top reconstructions</span>
            <button type="button" onClick={() => stepRank(-1)} title="Previous (←)" className="p-1 rounded text-gray-300 hover:text-white hover:bg-gray-700"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-xs text-gray-400 w-12 text-center font-mono">{cur >= 0 ? cur + 1 : '–'}/{model.ranked.length}</span>
            <button type="button" onClick={() => stepRank(1)} title="Next (→)" className="p-1 rounded text-gray-300 hover:text-white hover:bg-gray-700"><ChevronRight className="w-4 h-4" /></button>
            <div className="flex gap-1 overflow-x-auto py-0.5">
              {model.ranked.map((r) => (
                <button key={r.stable} type="button" onClick={() => focusChain(r)} title={`${r.frags} raw IDs → ${r.durS.toFixed(0)}s journey${r.gapS > 0 ? `, bridged ${r.gapS.toFixed(1)}s gap` : ''}`}
                  className={`px-2 py-0.5 rounded text-[11px] whitespace-nowrap font-mono ${selected === r.stable ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-300 hover:text-white'}`}>
                  ×{r.frags}·{r.durS.toFixed(0)}s
                </button>
              ))}
            </div>
          </div>
        )
      })()}

      {/* dual maps */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl border border-blue-900/40 bg-[#0b0e14] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <span className="text-xs font-medium text-blue-300">RAW perception <span className="text-gray-600">· colour = LiDAR ID</span></span>
            <span className="text-xs text-gray-400 flex items-center gap-1"><Users className="w-3 h-3" /> {paneCount('raw')}</span>
          </div>
          <canvas ref={rawCanvas} width={CW} height={CH} className="w-full block" style={{ aspectRatio: `${CW}/${CH}` }} />
        </div>
        <div className="rounded-xl border border-emerald-900/40 bg-[#0b0e14] overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <span className="text-xs font-medium text-emerald-300">RECONCILED · {presetLabel} <span className="text-gray-600">· click a track to follow</span></span>
            <span className="text-xs text-gray-400 flex items-center gap-1"><Users className="w-3 h-3" /> {paneCount('rec')}</span>
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
          <span className="text-xs text-gray-400 font-mono w-24 text-right">{viewMode === 'cohort' ? `${fmtClock(tNow)}–${fmtClock(tNow + cohortLenS * 1000)}` : `${fmtClock(tNow)} / ${fmtClock(totalDur)}`}</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <span className="text-gray-500">Speed</span>
            {SPEEDS.map((s) => (<button key={s} type="button" onClick={() => setSpeed(s)} className={`px-2 py-0.5 rounded ${speed === s ? 'bg-emerald-700 text-white' : 'text-gray-400 hover:text-white'}`}>{s}×</button>))}
          </div>
          {viewMode === 'window' && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500">Window</span>
              {WIN_LENGTHS.map((w) => (<button key={w} type="button" onClick={() => setWinLenS(w)} className={`px-2 py-0.5 rounded ${winLenS === w ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}>{w}s</button>))}
            </div>
          )}
          {viewMode === 'cohort' && (
            <div className="flex items-center gap-1">
              <span className="text-gray-500">Cohort length</span>
              {COHORT_LENGTHS.map((w) => (<button key={w} type="button" onClick={() => setCohortLenS(w)} className={`px-2 py-0.5 rounded ${cohortLenS === w ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}>{fmtSpan(w)}</button>))}
            </div>
          )}
          <span className="text-gray-600">
            {viewMode === 'trails' ? 'Trails grow as people move; raw fragments die, reconciled journeys persist.'
              : viewMode === 'cohort' ? 'Every shopper present in the window, full path — the store filling up.'
                : 'Sliding window — the moving snapshot.'}
          </span>
        </div>
      </div>

      {/* churn sparkline */}
      <div className="rounded-xl border border-gray-700 bg-gray-800/40 p-3">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[10px] uppercase tracking-wide text-gray-500">ID churn over time (births + deaths / {CHURN_BUCKET_S}s)</p>
          <div className="flex items-center gap-3 text-[10px]"><span className="text-red-400">▬ raw</span><span className="text-emerald-400">▬ reconciled</span></div>
        </div>
        <canvas ref={churnCanvas} width={920} height={70} className="w-full block" style={{ aspectRatio: '920/70' }} />
      </div>

      {/* cumulative KPI strip */}
      <div className="overflow-x-auto rounded-xl border border-gray-700">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-800 text-gray-400 text-left">
            <th className="px-4 py-2 font-medium">Continuity & duration KPIs (whole capture)</th>
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
