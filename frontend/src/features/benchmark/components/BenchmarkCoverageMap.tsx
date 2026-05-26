import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Maximize2, Move, Pause, Play, RefreshCw, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { API_BASE } from '../../../config/api'
import type {
  CoverageSpatial,
  FloorplanContext,
  MapBbox,
  ProblemZone,
  ProblemZonesData,
  ReconciledSpatial,
  TrackViewMode,
} from '../types'
import type { PerceptionTransform } from '../../../types/perceptionTransform'
import {
  DEFAULT_MAP_CALIBRATION,
  DEFAULT_MAP_VIEW,
  applyMapCalibration,
  computeDisplayBbox,
  floorplanImageRect,
  loadMapCalibration,
  perceptionToVenue,
  projectPoint,
  saveMapCalibration,
  severityColor,
  transformZoneWithCalibration,
  type DwgBootstrap,
  type MapCalibration,
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

const TRACK_VIEW_OPTIONS: { id: TrackViewMode; label: string }[] = [
  { id: 'raw', label: 'Before — raw perception' },
  { id: 'overlay_GROCERY_BALANCED', label: 'Before + After (Grocery Balanced)' },
  { id: 'GROCERY_BALANCED', label: 'After — Grocery Balanced only' },
  { id: 'overlay_GROCERY_AGGRESSIVE', label: 'Before + After (Aggressive)' },
  { id: 'GROCERY_AGGRESSIVE', label: 'After — Aggressive only' },
  { id: 'overlay_GROCERY_CONSERVATIVE', label: 'Before + After (Grocery Conservative)' },
  { id: 'GROCERY_CONSERVATIVE', label: 'After — Grocery Conservative only' },
  { id: 'overlay_RAJ_v1_CONSERVATIVE', label: 'Before + After (Raj v1 Conservative)' },
  { id: 'RAJ_v1_CONSERVATIVE', label: 'After — Raj v1 Conservative only' },
  { id: 'overlay_RAJ_v1_BALANCED', label: 'Before + After (Raj v1 Balanced)' },
  { id: 'RAJ_v1_BALANCED', label: 'After — Raj v1 Balanced only' },
]

function reconciledConfigFor(view: TrackViewMode): string | null {
  if (view === 'raw') return null
  if (view.startsWith('overlay_')) return view.replace('overlay_', '')
  return view
}

function isOverlay(view: TrackViewMode) {
  return view.startsWith('overlay_')
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
  calibration: MapCalibration,
  pivot: { x: number; z: number },
) {
  if (mode === 'venue') {
    const p = perceptionToVenue(x, z, transform)
    return applyMapCalibration(p, calibration, pivot)
  }
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
  const [bootstrap, setBootstrap] = useState<DwgBootstrap | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [view, setView] = useState<MapView>(DEFAULT_MAP_VIEW)
  const [coordMode, setCoordMode] = useState<'venue' | 'sensor'>('venue')
  const [selectedZone, setSelectedZone] = useState<ProblemZone | null>(null)
  const [calibration, setCalibration] = useState<MapCalibration>(DEFAULT_MAP_CALIBRATION)
  const [showAlignPanel, setShowAlignPanel] = useState(false)

  const [trackView, setTrackView] = useState<TrackViewMode>('overlay_RAJ_v1_CONSERVATIVE')
  const [reconciled, setReconciled] = useState<ReconciledSpatial | null>(null)

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    floorplan: true,
    problem_zones: true,
    compare_zones: false,
    detections: true,
    births: true,
    deaths: true,
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
      setBootstrap(null)
      if (fp.available && fp.venue_id) {
        setCalibration(loadMapCalibration(fp.venue_id))
      } else {
        setCalibration(DEFAULT_MAP_CALIBRATION)
      }
      setFrame(0)

      if (fp.available && fp.dwg_layout_version_id) {
        const sc = fp.scaleCorrection ?? 1
        fetch(`${API_BASE}/api/dwg/layout/${encodeURIComponent(fp.dwg_layout_version_id)}/as-venue-bootstrap?scaleCorrection=${sc}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.transform) setBootstrap(data.transform as DwgBootstrap)
          })
          .catch(() => setBootstrap(null))
      }

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
    const cfg = reconciledConfigFor(trackView)
    if (!cfg) {
      setReconciled(null)
      return
    }
    let cancelled = false
    fetch(`${API_BASE}/api/benchmark/runs/${encodeURIComponent(runId)}/coverage/reconciled/${encodeURIComponent(cfg)}`)
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((data) => { if (!cancelled) setReconciled(data) })
      .catch(() => { if (!cancelled) setReconciled({ available: false }) })
    return () => { cancelled = true }
  }, [trackView, runId])

  useEffect(() => {
    setFrame(0)
  }, [trackView, reconciled?.config])

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
    const activeTimeline = trackView === 'raw' || isOverlay(trackView)
      ? spatial?.timeline
      : reconciled?.timeline ?? spatial?.timeline
    if (!playing || !activeTimeline?.length) return
    const ms = Math.max(120, 600 / speed)
    const id = window.setInterval(() => {
      setFrame((f) => (f + 1) % activeTimeline!.length)
    }, ms)
    return () => window.clearInterval(id)
  }, [playing, spatial, reconciled, speed, trackView])

  const transform = floorplan?.perceptionTransform ?? null
  const useVenue = coordMode === 'venue' && floorplan?.available && floorplan.has_transform
  const venueWidth = floorplan?.venue_width ?? 74
  const venueDepth = floorplan?.venue_depth ?? 74
  const venuePivot = useMemo(() => ({ x: venueWidth / 2, z: venueDepth / 2 }), [venueWidth, venueDepth])

  const floorplanRect = useMemo(() => {
    if (!bootstrap || !floorplanImg || !floorplan?.floorplan_transform) return null
    return floorplanImageRect(
      floorplanImg.naturalWidth,
      floorplanImg.naturalHeight,
      floorplan.floorplan_transform,
      bootstrap,
    )
  }, [bootstrap, floorplanImg, floorplan?.floorplan_transform])

  const displayBbox: MapBbox | null = useMemo(() => {
    if (!spatial?.bbox) return null
    if (!useVenue) return spatial.bbox
    return computeDisplayBbox({
      spatialBbox: spatial.bbox,
      useVenue: true,
      transform,
      calibration,
      venueWidth,
      venueDepth,
      objects: floorplan?.objects,
      floorplanRect,
    })
  }, [spatial?.bbox, useVenue, transform, calibration, venueWidth, venueDepth, floorplan?.objects, floorplanRect])

  const updateCalibration = useCallback((patch: Partial<MapCalibration>) => {
    setCalibration((prev) => {
      const next = { ...prev, ...patch }
      if (floorplan?.venue_id) saveMapCalibration(floorplan.venue_id, next)
      return next
    })
  }, [floorplan?.venue_id])

  const resetCalibration = useCallback(() => {
    const next = { ...DEFAULT_MAP_CALIBRATION }
    setCalibration(next)
    if (floorplan?.venue_id) saveMapCalibration(floorplan.venue_id, next)
  }, [floorplan?.venue_id])

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
    const showRaw = trackView === 'raw' || isOverlay(trackView)
    const showReconciled = trackView !== 'raw' && reconciled?.available
    const activeTimeline = showReconciled && reconciled?.timeline?.length
      ? reconciled.timeline
      : (spatial.timeline ?? [])
    const bucket = activeTimeline[frame] ?? activeTimeline[0]
    const playbackMode = playing && layers.detections && activeTimeline.length > 0
    const staticAlpha = playbackMode ? 0.15 : 0.55
    const mode: 'venue' | 'sensor' = useVenue ? 'venue' : 'sensor'
    const pivot = venuePivot

    const proj = (x: number, z: number) => projectPoint(x, z, bbox, w, h, pad, view)
    const toMap = (x: number, z: number) => mapPoint(x, z, mode, transform, calibration, pivot)

    const drawTrackEndpoints = (
      data: { births?: Array<{ x: number; z: number }>; deaths?: Array<{ x: number; z: number }> },
      opts: { birthColor: string; deathColor: string; alpha: number; radius: number },
    ) => {
      if (layers.births && data.births) {
        ctx.fillStyle = opts.birthColor.replace('ALPHA', String(opts.alpha))
        for (const b of data.births) {
          const p = toMap(b.x, b.z)
          const { cx, cy } = proj(p.x, p.z)
          ctx.beginPath()
          ctx.arc(cx, cy, opts.radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      if (layers.deaths && data.deaths) {
        ctx.fillStyle = opts.deathColor.replace('ALPHA', String(opts.alpha))
        for (const d of data.deaths) {
          const p = toMap(d.x, d.z)
          const { cx, cy } = proj(p.x, p.z)
          ctx.beginPath()
          ctx.arc(cx, cy, opts.radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    ctx.fillStyle = '#0f1419'
    ctx.fillRect(0, 0, w, h)

    // Floorplan raster — positioned like MainViewport (DXF transform + bootstrap)
    if (layers.floorplan && floorplanImg && useVenue && floorplanRect) {
      const fp = floorplanRect
      const center = proj(fp.cx, fp.cz)
      const halfW = (fp.w * center.scale) / 2
      const halfD = (fp.d * center.scale) / 2
      ctx.save()
      ctx.translate(center.cx, center.cy)
      ctx.rotate(-fp.rotationDeg * Math.PI / 180)
      ctx.globalAlpha = fp.opacity
      ctx.drawImage(floorplanImg, -halfW, -halfD, halfW * 2, halfD * 2)
      ctx.restore()
      ctx.globalAlpha = 1
    } else if (layers.floorplan && floorplanImg && useVenue) {
      // Fallback: full venue extent when bootstrap not loaded yet
      const tl = proj(0, venueDepth)
      const br = proj(venueWidth, 0)
      ctx.globalAlpha = 0.25
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
        const p = toMap(b.x, b.z)
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
        const zv = useVenue ? transformZoneWithCalibration(z, transform, calibration, pivot) : z
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
        const zv = useVenue ? transformZoneWithCalibration(z, transform, calibration, pivot) : z
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

    // Fragmentation links (raw only)
    if (layers.links && showRaw && spatial.links) {
      for (const ln of spatial.links) {
        const a = toMap(ln.x0, ln.z0)
        const b = toMap(ln.x1, ln.z1)
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

    if (layers.ghosts && showRaw && spatial.ghosts) {
      ctx.fillStyle = `rgba(251, 146, 60, ${0.85 * staticAlpha})`
      for (const g of spatial.ghosts) {
        const p = toMap(g.x, g.z)
        const { cx, cy } = proj(p.x, p.z)
        ctx.beginPath()
        ctx.arc(cx, cy, 1.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Raw perception track starts/ends (before)
    if (showRaw) {
      drawTrackEndpoints(spatial, {
        birthColor: 'rgba(74, 222, 128, ALPHA)',
        deathColor: 'rgba(248, 113, 113, ALPHA)',
        alpha: isOverlay(trackView) ? 0.12 : 0.65 * staticAlpha,
        radius: isOverlay(trackView) ? 1.0 : 1.3,
      })
    }

    // Reconciled stable track starts/ends (after)
    if (showReconciled && reconciled) {
      drawTrackEndpoints(reconciled, {
        birthColor: 'rgba(167, 139, 250, ALPHA)',
        deathColor: 'rgba(52, 211, 153, ALPHA)',
        alpha: isOverlay(trackView) ? 0.92 : 0.75 * staticAlpha,
        radius: isOverlay(trackView) ? 2.8 : 2.0,
      })
    }

    // Detections / stable playback on top
    if (layers.detections && bucket?.points?.length) {
      const isReconciledPlayback = showReconciled && !isOverlay(trackView)
      ctx.fillStyle = isReconciledPlayback ? 'rgba(167, 139, 250, 0.92)' : 'rgba(34, 211, 238, 0.92)'
      for (const pt of bucket.points) {
        const p = toMap(pt.x, pt.z)
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
    spatial, zones, compareZones, floorplan, floorplanImg, floorplanRect, layers, frame, playing,
    view, useVenue, transform, calibration, venuePivot, displayBbox, selectedZone, trackView, reconciled,
    venueWidth, venueDepth,
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
      const zv = useVenue ? transformZoneWithCalibration(z, transform, calibration, venuePivot) : z
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

  const timeline = (trackView !== 'raw' && reconciled?.timeline?.length)
    ? reconciled.timeline
    : (spatial.timeline ?? [])
  const bucket = timeline[frame]

  const rawIds = spatial.counts?.births ?? spatial.counts?.deaths
  const reconCounts = reconciled?.counts

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-purple-900/40 bg-purple-950/20 p-3 flex flex-wrap items-center gap-3">
        <label className="text-[11px] text-gray-400 uppercase tracking-wide">Track view</label>
        <select
          value={trackView}
          onChange={(e) => setTrackView(e.target.value as TrackViewMode)}
          className="bg-gray-900 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white min-w-[240px]"
        >
          {TRACK_VIEW_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        {trackView !== 'raw' && reconciled?.available && reconCounts && (
          <p className="text-xs text-gray-300">
            <span className="text-red-300/80">{rawIds?.toLocaleString()} raw IDs</span>
            {' → '}
            <span className="text-emerald-300 font-medium">{reconCounts.stable_tracks.toLocaleString()} stable tracks</span>
            {' · '}
            <span className="text-purple-300">{reconCounts.fragmentation_factor.toFixed(1)}× fragmentation</span>
            {' · '}
            mean life {reconCounts.mean_lifetime_s.toFixed(0)}s
          </p>
        )}
        {trackView !== 'raw' && !reconciled?.available && (
          <p className="text-xs text-amber-500">Re-run stage 06_verify to generate reconciler map layers</p>
        )}
      </div>

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

      {useVenue && (
        <div className="rounded-xl border border-gray-700 bg-gray-900/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setShowAlignPanel((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-800/50 transition-colors"
          >
            <span className="flex items-center gap-2 text-xs text-gray-300">
              <Move className="w-3.5 h-3.5 text-amber-400" />
              Align trajectories to floorplan
              {(calibration.offsetX !== 0 || calibration.offsetZ !== 0 || calibration.rotationDeg !== 0 || calibration.scale !== 1) && (
                <span className="text-amber-400/90">(adjusted)</span>
              )}
            </span>
            {showAlignPanel ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </button>
          {showAlignPanel && (
            <div className="px-3 pb-3 pt-1 border-t border-gray-800 space-y-3">
              <p className="text-[10px] text-gray-500 leading-relaxed">
                Uses your Live Tuner transform first. If tracks still don&apos;t line up with the DWG, nudge here — saved per venue in this browser.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="text-gray-500">Shift X (m)</span>
                  <input
                    type="range"
                    min={-25}
                    max={25}
                    step={0.25}
                    value={calibration.offsetX}
                    onChange={(e) => updateCalibration({ offsetX: Number(e.target.value) })}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-gray-400 tabular-nums">{calibration.offsetX.toFixed(2)} m</span>
                </label>
                <label className="space-y-1">
                  <span className="text-gray-500">Shift Z (m)</span>
                  <input
                    type="range"
                    min={-25}
                    max={25}
                    step={0.25}
                    value={calibration.offsetZ}
                    onChange={(e) => updateCalibration({ offsetZ: Number(e.target.value) })}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-gray-400 tabular-nums">{calibration.offsetZ.toFixed(2)} m</span>
                </label>
                <label className="space-y-1">
                  <span className="text-gray-500">Rotation (°)</span>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={0.5}
                    value={calibration.rotationDeg}
                    onChange={(e) => updateCalibration({ rotationDeg: Number(e.target.value) })}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-gray-400 tabular-nums">{calibration.rotationDeg.toFixed(1)}°</span>
                </label>
                <label className="space-y-1">
                  <span className="text-gray-500">Scale</span>
                  <input
                    type="range"
                    min={0.5}
                    max={2}
                    step={0.01}
                    value={calibration.scale}
                    onChange={(e) => updateCalibration({ scale: Number(e.target.value) })}
                    className="w-full accent-amber-500"
                  />
                  <span className="text-gray-400 tabular-nums">{calibration.scale.toFixed(2)}×</span>
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => updateCalibration({ offsetX: calibration.offsetX - 0.5 })} className="px-2 py-1 rounded border border-gray-700 text-[10px] text-gray-400 hover:bg-gray-800">← X</button>
                <button type="button" onClick={() => updateCalibration({ offsetX: calibration.offsetX + 0.5 })} className="px-2 py-1 rounded border border-gray-700 text-[10px] text-gray-400 hover:bg-gray-800">X →</button>
                <button type="button" onClick={() => updateCalibration({ offsetZ: calibration.offsetZ + 0.5 })} className="px-2 py-1 rounded border border-gray-700 text-[10px] text-gray-400 hover:bg-gray-800">↑ Z</button>
                <button type="button" onClick={() => updateCalibration({ offsetZ: calibration.offsetZ - 0.5 })} className="px-2 py-1 rounded border border-gray-700 text-[10px] text-gray-400 hover:bg-gray-800">Z ↓</button>
                <button type="button" onClick={() => updateCalibration({ rotationDeg: calibration.rotationDeg - 5 })} className="px-2 py-1 rounded border border-gray-700 text-[10px] text-gray-400 hover:bg-gray-800">↺ 5°</button>
                <button type="button" onClick={() => updateCalibration({ rotationDeg: calibration.rotationDeg + 5 })} className="px-2 py-1 rounded border border-gray-700 text-[10px] text-gray-400 hover:bg-gray-800">↻ 5°</button>
                <button type="button" onClick={resetCalibration} className="px-2 py-1 rounded border border-amber-800/60 text-[10px] text-amber-300 hover:bg-amber-950/40 ml-auto">Reset alignment</button>
              </div>
              {!bootstrap && floorplan?.dwg_layout_version_id && (
                <p className="text-[10px] text-amber-600/80">Loading DWG placement… floorplan may be approximate until bootstrap loads.</p>
              )}
            </div>
          )}
        </div>
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
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400/40" /> Raw birth (before)</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400/40" /> Raw death (before)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-violet-400" /> Stable start (after)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Stable end (after)</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-500/50 border border-red-400" /> Problem zone</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400" /> Detections (playback)</span>
      </div>
    </div>
  )
}
