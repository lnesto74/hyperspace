import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RefreshCw } from 'lucide-react'
import { API_BASE } from '../../../config/api'
import type { CoverageSpatial } from '../types'

type LayerKey = 'heatmap' | 'detections' | 'births' | 'deaths' | 'ghosts' | 'links' | 'blindspots'

const LINK_COLORS: Record<string, string> = {
  shelf_occlusion_short: 'rgba(250, 204, 21, 0.35)',
  blindspot_gap_long: 'rgba(239, 68, 68, 0.35)',
  continuous_perception_loss: 'rgba(96, 165, 250, 0.25)',
}

interface Props {
  runId: string
  compareRunId?: string | null
}

function worldToCanvas(
  x: number,
  z: number,
  bbox: { x0: number; x1: number; z0: number; z1: number },
  w: number,
  h: number,
  pad: number,
) {
  const bw = bbox.x1 - bbox.x0 || 1
  const bh = bbox.z1 - bbox.z0 || 1
  const sx = (w - pad * 2) / bw
  const sy = (h - pad * 2) / bh
  const scale = Math.min(sx, sy)
  const ox = pad + (w - pad * 2 - bw * scale) / 2
  const oz = pad + (h - pad * 2 - bh * scale) / 2
  return {
    cx: ox + (x - bbox.x0) * scale,
    cy: h - (oz + (z - bbox.z0) * scale),
    scale,
  }
}

export default function BenchmarkCoverageMap({ runId, compareRunId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heatmapImgRef = useRef<HTMLImageElement | null>(null)
  const [spatial, setSpatial] = useState<CoverageSpatial | null>(null)
  const [compareSpatial, setCompareSpatial] = useState<CoverageSpatial | null>(null)
  const [heatmapUrl, setHeatmapUrl] = useState<string | null>(null)
  const [heatmapReady, setHeatmapReady] = useState(0)
  const [heatmapLoading, setHeatmapLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    heatmap: false,
    detections: true,
    births: true,
    deaths: true,
    ghosts: true,
    links: false,
    blindspots: true,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    heatmapImgRef.current = null
    setHeatmapReady(0)
    try {
      const spRes = await fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/coverage/spatial`)
      if (!spRes.ok) throw new Error(await spRes.text())
      const sp: CoverageSpatial = await spRes.json()
      setSpatial(sp)
      setHeatmapUrl(
        `${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/coverage/heatmap?bust=${Date.now()}`,
      )
      setFrame(0)

      if (compareRunId && compareRunId !== runId) {
        const cRes = await fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(compareRunId)}/coverage/spatial`)
        if (cRes.ok) setCompareSpatial(await cRes.json())
        else setCompareSpatial(null)
      } else {
        setCompareSpatial(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load coverage map')
    } finally {
      setLoading(false)
    }
  }, [runId, compareRunId])

  useEffect(() => { load() }, [load])

  // Load heatmap in background — never block other layers on this.
  useEffect(() => {
    if (!layers.heatmap || !heatmapUrl) {
      heatmapImgRef.current = null
      setHeatmapLoading(false)
      return
    }
    let cancelled = false
    setHeatmapLoading(true)
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (cancelled) return
      heatmapImgRef.current = img
      setHeatmapLoading(false)
      setHeatmapReady((n) => n + 1)
    }
    img.onerror = () => {
      if (cancelled) return
      heatmapImgRef.current = null
      setHeatmapLoading(false)
      setHeatmapReady((n) => n + 1)
    }
    img.src = heatmapUrl
    return () => { cancelled = true }
  }, [layers.heatmap, heatmapUrl])

  // Animation loop
  useEffect(() => {
    if (!playing || !spatial?.timeline?.length) return
    const ms = Math.max(120, 600 / speed)
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % spatial.timeline!.length)
    }, ms)
    return () => window.clearInterval(id)
  }, [playing, spatial, speed])

  // Draw canvas (sync — heatmap overlays when ready)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !spatial?.available || !spatial.bbox) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = rect.width
    const h = rect.height
    const pad = 16
    const bbox = spatial.bbox
    const timeline = spatial.timeline ?? []
    const bucket = timeline[frame] ?? timeline[0]
    const playbackMode = playing && layers.detections && timeline.length > 0
    const staticAlpha = playbackMode ? 0.18 : 1

    ctx.fillStyle = '#0f1419'
    ctx.fillRect(0, 0, w, h)

    const plotX = pad
    const plotY = pad
    const plotW = w - pad * 2
    const plotH = h - pad * 2

    if (layers.heatmap && heatmapImgRef.current?.complete && heatmapImgRef.current.naturalWidth > 0) {
      ctx.globalAlpha = 0.62
      ctx.drawImage(heatmapImgRef.current, plotX, plotY, plotW, plotH)
      ctx.globalAlpha = 1
    }

    if (compareSpatial?.available && compareSpatial.births) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.25)'
      for (const b of compareSpatial.births) {
        const { cx, cy } = worldToCanvas(b.x, b.z, bbox, w, h, pad)
        ctx.beginPath()
        ctx.arc(cx, cy, 1.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    if (layers.blindspots && spatial.blindspots) {
      for (const b of spatial.blindspots) {
        const { cx, cy, scale } = worldToCanvas(b.x, b.z, bbox, w, h, pad)
        const r = Math.max(4, Math.sqrt(b.area_m2) * scale * 0.4)
        ctx.fillStyle = `rgba(234, 179, 8, ${0.15 * staticAlpha})`
        ctx.strokeStyle = `rgba(234, 179, 8, ${0.6 * staticAlpha})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    }

    if (layers.links && spatial.links) {
      for (const ln of spatial.links) {
        const a = worldToCanvas(ln.x0, ln.z0, bbox, w, h, pad)
        const b = worldToCanvas(ln.x1, ln.z1, bbox, w, h, pad)
        ctx.strokeStyle = LINK_COLORS[ln.category] || 'rgba(148, 163, 184, 0.2)'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(a.cx, a.cy)
        ctx.lineTo(b.cx, b.cy)
        ctx.stroke()
      }
    }

    if (layers.ghosts && spatial.ghosts) {
      ctx.fillStyle = `rgba(251, 146, 60, ${0.85 * staticAlpha})`
      for (const g of spatial.ghosts) {
        const { cx, cy } = worldToCanvas(g.x, g.z, bbox, w, h, pad)
        ctx.beginPath()
        ctx.arc(cx, cy, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    if (layers.births && spatial.births) {
      ctx.fillStyle = `rgba(74, 222, 128, ${0.7 * staticAlpha})`
      for (const b of spatial.births) {
        const { cx, cy } = worldToCanvas(b.x, b.z, bbox, w, h, pad)
        ctx.beginPath()
        ctx.arc(cx, cy, 1.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (layers.deaths && spatial.deaths) {
      ctx.fillStyle = `rgba(248, 113, 113, ${0.75 * staticAlpha})`
      for (const d of spatial.deaths) {
        const { cx, cy } = worldToCanvas(d.x, d.z, bbox, w, h, pad)
        ctx.beginPath()
        ctx.arc(cx, cy, 1.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Detections on top so playback stays visible over static layers
    if (layers.detections && bucket?.points?.length) {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.92)'
      for (const p of bucket.points) {
        const { cx, cy } = worldToCanvas(p.x, p.z, bbox, w, h, pad)
        ctx.beginPath()
        ctx.arc(cx, cy, playbackMode ? 2.4 : 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.strokeStyle = 'rgba(75, 85, 99, 0.8)'
    ctx.lineWidth = 1
    ctx.strokeRect(plotX, plotY, plotW, plotH)
  }, [spatial, compareSpatial, layers, frame, playing, heatmapReady])

  const toggle = (k: LayerKey) => setLayers((prev) => ({ ...prev, [k]: !prev[k] }))

  if (loading) {
    return <div className="text-sm text-gray-500 py-12 text-center">Loading coverage map…</div>
  }
  if (error) {
    return <div className="text-sm text-red-400 py-6">{error}</div>
  }
  if (!spatial?.available) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 p-6 text-sm text-gray-500">
        {spatial?.reason || 'Coverage map not available.'}
        <p className="text-xs mt-2 text-gray-600">Re-run benchmark including stage 05_forensic to generate coverage_spatial.json</p>
      </div>
    )
  }

  const timeline = spatial.timeline ?? []
  const bucket = timeline[frame]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(layers) as LayerKey[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => toggle(k)}
            className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${
              layers[k]
                ? 'border-amber-500/50 bg-amber-950/40 text-amber-100'
                : 'border-gray-700 text-gray-500 hover:text-gray-300'
            }`}
          >
            {k}
          </button>
        ))}
        {layers.heatmap && heatmapLoading && (
          <span className="text-[10px] text-gray-500">heatmap loading…</span>
        )}
        <button type="button" onClick={load} className="ml-auto p-1.5 rounded hover:bg-gray-800 text-gray-400" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="relative rounded-xl border border-gray-700 bg-gray-950 overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-[420px] block" />
        {compareRunId && compareSpatial?.available && (
          <div className="absolute top-2 left-2 text-[10px] bg-gray-900/90 px-2 py-1 rounded border border-blue-800 text-blue-300">
            Blue dots = baseline compare run
          </div>
        )}
      </div>

      {timeline.length > 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-3 space-y-2">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="p-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, timeline.length - 1)}
              value={frame}
              onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)) }}
              className="flex-1 accent-amber-500"
            />
            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white"
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </div>
          <div className="flex flex-wrap gap-4 text-[11px] text-gray-500">
            {bucket && (
              <span>
                Window: {new Date(bucket.t0).toLocaleString()} → {new Date(bucket.t1).toLocaleTimeString()}
                · {bucket.points.length.toLocaleString()} dots
              </span>
            )}
            {spatial.counts && (
              <span>
                {spatial.counts.births?.toLocaleString()} births · {spatial.counts.deaths?.toLocaleString()} deaths ·{' '}
                {spatial.counts.ghosts?.toLocaleString()} ghosts · {spatial.counts.blindspots} blindspots
              </span>
            )}
            {playing && layers.detections && (
              <span className="text-cyan-400/80">Playback: static layers dimmed</span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /> Detections (animated)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> ID birth</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> ID death</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400" /> Ghost (&lt;2s)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full border border-yellow-500/60 bg-yellow-500/10" /> Blindspot</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gradient-to-r from-orange-500/40 to-red-500/20" /> Heatmap (stage 02)</span>
      </div>
    </div>
  )
}
