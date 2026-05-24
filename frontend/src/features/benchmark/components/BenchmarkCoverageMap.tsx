import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Pause, Play, RefreshCw, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { API_BASE } from '../../../config/api'
import type {
  CoverageSpatial,
  FloorplanContext,
  MapBbox,
  ProblemZone,
  ProblemZonesData,
} from '../types'
import type { PerceptionTransform } from '../../../types/perceptionTransform'
import {
  DEFAULT_MAP_VIEW,
  perceptionToVenue,
  projectPoint,
  severityColor,
  transformZoneToVenue,
  venueBbox,
  type MapView,
} from '../benchmarkMapUtils'

type LayerKey =
  | 'floorplan'
  | 'problem_zones'
  | 'compare_zones'
  | 'detections'
  | 'births'
  | 'deaths'
  | 'ghosts'
  | 'links'
  | 'blindspots'

const LINK_COLORS: Record<string, string> = {
  shelf_occlusion_short: 'rgba(250, 204, 21, 0.35)',
  blindspot_gap_long: 'rgba(239, 68, 68, 0.35)',
  continuous_perception_loss: 'rgba(96, 165, 250, 0.25)',
}

interface Props {
  runId: string
  compareRunId?: string | null
  compareLabel?: string
}

function mapPoint(
  x: number,
  z: number,
  mode: 'venue' | 'sensor',
  transform: PerceptionTransform | null | undefined,
) {
  if (mode === 'venue') return perceptionToVenue(x, z, transform)
  return { x, z }
}

export default function BenchmarkCoverageMap({ runId, compareRunId, compareLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const [spatial, setSpatial] = useState<CoverageSpatial | null>(null)
  const [zones, setZones] = useState<ProblemZonesData | null>(null)
  const [compareZones, setCompareZones] = useState<ProblemZonesData | null>(null)
  const [floorplan, setFloorplan] = useState<FloorplanContext | null>(null)
  const [floorplanImg, setFloorplanImg] = useState<HTMLImageElement | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [view, setView] = useState<MapView>(DEFAULT_MAP_VIEW)
  const [coordMode, setCoordMode] = useState<'venue' | 'sensor'>('venue')
  const [selectedZone, setSelectedZone] = useState<ProblemZone | null>(null)

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    floorplan: true,
    problem_zones: true,
    compare_zones: true,
    detections: true,
    births: false,
    deaths: false,
    ghosts: false,
    links: false,
    blindspots: true,
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSelectedZone(null)
    setView(DEFAULT_MAP_VIEW)
    try {
      const [spRes, zRes, fpRes] = await Promise.all([
        fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/coverage/spatial`),
        fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/coverage/zones`),
        fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/coverage/floorplan`),
      ])
      if (!spRes.ok) throw new Error(await spRes.text())
      setSpatial(await spRes.json())
      setZones(zRes.ok ? await zRes.json() : { available: false })
      const fp: FloorplanContext = fpRes.ok ? await fpRes.json() : { available: false }
      setFloorplan(fp)
      setFrame(0)

      if (compareRunId && compareRunId !== runId) {
        const czRes = await fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(compareRunId)}/coverage/zones`)
        setCompareZones(czRes.ok ? await czRes.json() : { available: false })
      } else {
        setCompareZones(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load coverage map')
    } finally {
      setLoading(false)
    }
  }, [runId, compareRunId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!layers.floorplan || !floorplan?.floorplan_image_url) {
      setFloorplanImg(null)
      return
    }
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => setFloorplanImg(img)
    img.onerror = () => setFloorplanImg(null)
    img.src = `${API_BASE}${floorplan.floorplan_image_url}`
  }, [layers.floorplan, floorplan?.floorplan_image_url])

  useEffect(() => {
    if (!playing || !spatial?.timeline?.length) return
    const ms = Math.max(120, 600 / speed)
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % spatial.timeline!.length)
    }, ms)
    return () => window.clearInterval(id)
  }, [playing, spatial, speed])

  const transform = floorplan?.perceptionTransform ?? null
  const useVenue = coordMode === 'venue' && floorplan?.available && floorplan.has_transform

  const displayBbox: MapBbox | null = useVenue && floorplan?.venue_width && floorplan?.venue_depth
    ? venueBbox(floorplan.venue_width, floorplan.venue_depth)
    : spatial?.bbox ?? null

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !spatial?.available || !displayBbox) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = container.getBoundingClientRect()
    const w = rect.width
    const h = rect.height
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const pad = 20
    const bbox = displayBbox
    const timeline = spatial.timeline ?? []
    const bucket = timeline[frame] ?? timeline[0]
    const playbackMode = playing && layers.detections && timeline.length > 0
    const staticAlpha = playbackMode ? 0.15 : 0.55
    const mode: 'venue' | 'sensor' = useVenue ? 'venue' : 'sensor'

    const proj = (x: number, z: number) => projectPoint(x, z, bbox, w, h, pad, view)

    ctx.fillStyle = '#0f1419'
    ctx.fillRect(0, 0, w, h)

    // Floorplan raster underlay (venue coords, full venue extent)
    if (layers.floorplan && floorplanImg && useVenue && floorplan?.venue_width && floorplan?.venue_depth) {
      const tl = proj(0, floorplan.venue_depth)
      const br = proj(floorplan.venue_width, 0)
      ctx.globalAlpha = 0.35
      ctx.drawImage(floorplanImg, tl.cx, tl.cy, br.cx - tl.cx, br.cy - tl.cy)
      ctx.globalAlpha = 1
    }

    // DWG fixture outlines
    if (layers.floorplan && floorplan?.objects?.length && useVenue) {
      for (const obj of floorplan.objects) {
        const c = proj(obj.x, obj.z)
        const hw = (obj.w * c.scale) / 2
        const hd = (obj.d * c.scale) / 2
        ctx.fillStyle = `${obj.color}22`
        ctx.strokeStyle = `${obj.color}88`
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.rect(c.cx - hw, c.cy - hd, hw * 2, hd * 2)
        ctx.fill()
        ctx.stroke()
      }
    }

    // Blindspots
    if (layers.blindspots && spatial.blindspots) {
      for (const b of spatial.blindspots) {
        const p = mapPoint(b.x, b.z, mode, transform)
        const { cx, cy, scale } = proj(p.x, p.z)
        const r = Math.max(4, Math.sqrt(b.area_m2) * scale * 0.35)
        ctx.fillStyle = `rgba(234, 179, 8, ${0.12 * staticAlpha})`
        ctx.strokeStyle = `rgba(234, 179, 8, ${0.55 * staticAlpha})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
      }
    }

    // Compare baseline zones (outline)
    if (layers.compare_zones && compareZones?.available && compareZones.zones?.length) {
      for (const z of compareZones.zones.slice(0, 30)) {
        const zv = useVenue ? transformZoneToVenue(z, transform) : z
        const tl = proj(zv.x0, zv.z1)
        const br = proj(zv.x1, zv.z0)
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.55)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 3])
        ctx.strokeRect(tl.cx, tl.cy, br.cx - tl.cx, br.cy - tl.cy)
        ctx.setLineDash([])
      }
    }

    // Problem zones (ranked squares)
    if (layers.problem_zones && zones?.available && zones.zones?.length) {
      for (const z of zones.zones) {
        const zv = useVenue ? transformZoneToVenue(z, transform) : z
        const tl = proj(zv.x0, zv.z1)
        const br = proj(zv.x1, zv.z0)
        const isSel = selectedZone?.cell_id === z.cell_id
        ctx.fillStyle = severityColor(z.severity, isSel ? 0.75 : 0.5)
        ctx.fillRect(tl.cx, tl.cy, br.cx - tl.cx, br.cy - tl.cy)
        ctx.strokeStyle = isSel ? '#fff' : severityColor(z.severity, 0.95)
        ctx.lineWidth = isSel ? 2 : 1
        ctx.strokeRect(tl.cx, tl.cy, br.cx - tl.cx, br.cy - tl.cy)
        if (z.rank <= 15) {
          ctx.fillStyle = '#fff'
          ctx.font = 'bold 10px system-ui'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(String(z.rank), (tl.cx + br.cx) / 2, (tl.cy + br.cy) / 2)
        }
      }
    }

    // Fragmentation links
    if (layers.links && spatial.links) {
      for (const ln of spatial.links) {
        const a = mapPoint(ln.x0, ln.z0, mode, transform)
        const b = mapPoint(ln.x1, ln.z1, mode, transform)
        const pa = proj(a.x, a.z)
        const pb = proj(b.x, b.z)
        ctx.strokeStyle = LINK_COLORS[ln.category] || 'rgba(148, 163, 184, 0.2)'
        ctx.lineWidth = 0.8
        ctx.beginPath()
        ctx.moveTo(pa.cx, pa.cy)
        ctx.lineTo(pb.cx, pb.cy)
        ctx.stroke()
      }
    }

    if (layers.ghosts && spatial.ghosts) {
      ctx.fillStyle = `rgba(251, 146, 60, ${0.85 * staticAlpha})`
      for (const g of spatial.ghosts) {
        const p = mapPoint(g.x, g.z, mode, transform)
        const { cx, cy } = proj(p.x, p.z)
        ctx.beginPath()
        ctx.arc(cx, cy, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    if (layers.births && spatial.births) {
      ctx.fillStyle = `rgba(74, 222, 128, ${0.7 * staticAlpha})`
      for (const b of spatial.births) {
        const p = mapPoint(b.x, b.z, mode, transform)
        const { cx, cy } = proj(p.x, p.z)
        ctx.beginPath()
        ctx.arc(cx, cy, 1.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    if (layers.deaths && spatial.deaths) {
      ctx.fillStyle = `rgba(248, 113, 113, ${0.75 * staticAlpha})`
      for (const d of spatial.deaths) {
        const p = mapPoint(d.x, d.z, mode, transform)
        const { cx, cy } = proj(p.x, p.z)
        ctx.beginPath()
        ctx.arc(cx, cy, 1.3, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Detections on top
    if (layers.detections && bucket?.points?.length) {
      ctx.fillStyle = 'rgba(34, 211, 238, 0.92)'
      for (const pt of bucket.points) {
        const p = mapPoint(pt.x, pt.z, mode, transform)
        const { cx, cy } = proj(p.x, p.z)
        ctx.beginPath()
        ctx.arc(cx, cy, playbackMode ? 2.5 : 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.strokeStyle = 'rgba(75, 85, 99, 0.8)'
    ctx.lineWidth = 1
    const tl = proj(bbox.x0, bbox.z1)
    const br = proj(bbox.x1, bbox.z0)
    ctx.strokeRect(tl.cx, tl.cy, br.cx - tl.cx, br.cy - tl.cy)
  }, [
    spatial, zones, compareZones, floorplan, floorplanImg, layers, frame, playing,
    view, useVenue, transform, displayBbox, selectedZone,
  ])

  useEffect(() => {
    draw()
    const ro = new ResizeObserver(() => draw())
    if (containerRef.current) ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [draw])

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    setView((v) => ({ ...v, scale: Math.max(0.4, Math.min(8, v.scale * factor)) }))
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    dragRef.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    setView((v) => ({
      ...v,
      panX: dragRef.current!.panX + (e.clientX - dragRef.current!.x),
      panY: dragRef.current!.panY + (e.clientY - dragRef.current!.y),
    }))
  }

  const onPointerUp = () => { dragRef.current = null }

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!zones?.zones?.length || !displayBbox || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top
    const pad = 20
    const w = rect.width
    const h = rect.height

    for (const z of zones.zones) {
      const zv = useVenue ? transformZoneToVenue(z, transform) : z
      const tl = projectPoint(zv.x0, zv.z1, displayBbox, w, h, pad, view)
      const br = projectPoint(zv.x1, zv.z0, displayBbox, w, h, pad, view)
      if (clickX >= tl.cx && clickX <= br.cx && clickY >= tl.cy && clickY <= br.cy) {
        setSelectedZone(z)
        return
      }
    }
    setSelectedZone(null)
  }

  const toggle = (k: LayerKey) => setLayers((prev) => ({ ...prev, [k]: !prev[k] }))

  if (loading) {
    return <div className="text-sm text-gray-500 py-12 text-center">Loading venue diagnostic map…</div>
  }
  if (error) {
    return <div className="text-sm text-red-400 py-6">{error}</div>
  }
  if (!spatial?.available) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 p-6 text-sm text-gray-500">
        {spatial?.reason || 'Coverage map not available.'}
      </div>
    )
  }

  const timeline = spatial.timeline ?? []
  const bucket = timeline[frame]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(layers) as LayerKey[])
          .filter((k) => k !== 'compare_zones' || compareZones?.available)
          .map((k) => (
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
              {k.replace(/_/g, ' ')}
            </button>
          ))}
        <div className="flex items-center gap-1 ml-2 border border-gray-700 rounded-md overflow-hidden">
          <button
            type="button"
            onClick={() => setCoordMode('venue')}
            disabled={!floorplan?.has_transform}
            className={`px-2 py-1 text-[10px] ${coordMode === 'venue' ? 'bg-amber-600 text-white' : 'text-gray-500'}`}
          >
            Floorplan
          </button>
          <button
            type="button"
            onClick={() => setCoordMode('sensor')}
            className={`px-2 py-1 text-[10px] ${coordMode === 'sensor' ? 'bg-gray-600 text-white' : 'text-gray-500'}`}
          >
            Sensor
          </button>
        </div>
        <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.min(8, v.scale * 1.25) }))} className="p-1.5 rounded hover:bg-gray-800 text-gray-400" title="Zoom in">
          <ZoomIn className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.max(0.4, v.scale / 1.25) }))} className="p-1.5 rounded hover:bg-gray-800 text-gray-400" title="Zoom out">
          <ZoomOut className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => setView(DEFAULT_MAP_VIEW)} className="p-1.5 rounded hover:bg-gray-800 text-gray-400" title="Reset view">
          <RotateCcw className="w-4 h-4" />
        </button>
        <button type="button" onClick={load} className="ml-auto p-1.5 rounded hover:bg-gray-800 text-gray-400" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {!zones?.available && (
        <p className="text-xs text-amber-500/90">
          Problem zones not found — re-run stage 05_forensic to generate problem_zones.json
        </p>
      )}
      {!floorplan?.has_transform && coordMode === 'venue' && (
        <p className="text-xs text-gray-500">
          No perception transform on venue — using sensor frame. Calibrate in Live Tuner to enable floorplan overlay.
        </p>
      )}

      <div className="flex gap-3 flex-col lg:flex-row">
        <div
          ref={containerRef}
          className="relative flex-1 rounded-xl border border-gray-700 bg-gray-950 overflow-hidden cursor-grab active:cursor-grabbing min-h-[420px]"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <canvas ref={canvasRef} className="w-full h-[420px] block" onClick={onCanvasClick} />
          <div className="absolute top-2 left-2 text-[10px] bg-gray-900/90 px-2 py-1 rounded border border-gray-700 text-gray-400 flex items-center gap-1">
            <Maximize2 className="w-3 h-3" />
            Scroll zoom · drag pan · click zone for details
          </div>
          {compareZones?.available && compareLabel && (
            <div className="absolute top-2 right-2 text-[10px] bg-gray-900/90 px-2 py-1 rounded border border-blue-800 text-blue-300">
              Blue outlines = {compareLabel}
            </div>
          )}
        </div>

        {selectedZone && (
          <div className="lg:w-72 rounded-xl border border-gray-700 bg-gray-800/60 p-3 text-sm shrink-0">
            <p className="text-amber-300 font-semibold">Problem zone #{selectedZone.rank}</p>
            <p className="text-xs text-gray-500 mt-1">Severity {(selectedZone.severity * 100).toFixed(0)}%</p>
            <dl className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between"><dt className="text-gray-500">Track breaks</dt><dd>{selectedZone.death_count.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Re-births nearby</dt><dd>{selectedZone.birth_count.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Ghosts</dt><dd>{selectedZone.ghost_count.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Shelf occlusion</dt><dd>{selectedZone.shelf_occlusion_pct.toFixed(0)}%</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Blindspot gap</dt><dd>{selectedZone.blindspot_gap_pct.toFixed(0)}%</dd></div>
            </dl>
            <p className="text-[10px] text-gray-500 mt-3 leading-relaxed">
              High break density here — reconciler can merge many shelf occlusions; persistent blindspot gaps may need LiDAR / layout change.
            </p>
          </div>
        )}
      </div>

      {timeline.length > 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-800/50 p-3 space-y-2">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setPlaying((p) => !p)} className="p-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white">
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
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-white">
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </div>
          {bucket && (
            <p className="text-[11px] text-gray-500">
              {new Date(bucket.t0).toLocaleString()} → {new Date(bucket.t1).toLocaleTimeString()}
              · {bucket.points.length.toLocaleString()} detections
              {playing && layers.detections && <span className="text-cyan-400/80"> · static layers dimmed</span>}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500/50 border border-red-400" /> Problem zone (ranked)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 border border-blue-400 border-dashed" /> Baseline compare</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /> Detections</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full border border-yellow-500/60" /> Blindspot</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-slate-500/30 border border-slate-400/50" /> DWG fixtures</span>
      </div>
    </div>
  )
}
