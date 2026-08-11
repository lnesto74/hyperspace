import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, RefreshCw, SkipBack } from 'lucide-react'
import { API_BASE } from '../../../config/api'
import {
  boundsToViewBox,
  computeFloorPlanBounds,
  getDrawableFixtureOutline,
  normalizeFloorVertex,
  polygonPath,
  venueObjectsToFixtures,
  type MapBounds,
  type MapRegion,
} from '../../../utils/venueFloorPlanMap'
import type { VenueObject } from '../../../types'

const TREVIGLIO = '55fdd53b-3298-4355-97c0-b4e789b11d06'

type Pt = { t: number; x: number; z: number; inRoi?: boolean }
type Sample = {
  trackKey: string
  durationS: number
  inRoiDurationS: number
  episodes: number
  rawIdCount: number
  t0: number
  t1: number
  chopFactor: number
  maxJumpM?: number
  spanM?: number
  suspectJumps?: number
  gapCount?: number
  segmentCount?: number
  continuous?: boolean
  plausible?: boolean
  reconciledPath: Pt[]
  rawPaths: Record<string, Pt[]>
}
type ViewMode = 'raw' | 'reconciled'
type LifeBucket = {
  id: string
  label: string
  minS: number
  maxS: number | null
  count: number
}

type Payload = {
  venueId: string
  category: string
  mode?: ViewMode
  categories: string[]
  rois: { id: string; name: string; vertices: { x: number; z: number }[] }[]
  samples: Sample[]
  lifeBucket?: string
  lifeBuckets?: LifeBucket[]
  stats?: {
    touchers: number
    returned: number
    meanTrackLifeS: number
    meanInRoiS: number
    meanRawIds: number
    plausibleShare?: number
    continuousShare?: number
    meanGaps?: number
  }
  error?: string
}

type WindowPreset = '1h' | '6h' | '24h' | 'sat' | 'sun'

function hue(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360
  return h
}
const colorId = (str: string, a = 0.9) => `hsla(${hue(str)}, 72%, 62%, ${a})`

function windowRange(preset: WindowPreset): { start: number; end: number; label: string } {
  const end = Date.now()
  if (preset === '1h') return { start: end - 3600_000, end, label: 'Last 1 hour' }
  if (preset === '6h') return { start: end - 6 * 3600_000, end, label: 'Last 6 hours' }
  if (preset === '24h') return { start: end - 24 * 3600_000, end, label: 'Last 24 hours' }
  // Local Italy days for the weekend we audited (Europe/Rome ≈ UTC+2 in Aug)
  if (preset === 'sat') {
    // 2026-08-08 00:00 → 24:00 Rome (CEST = UTC+2)
    return { start: Date.parse('2026-08-08T00:00:00+02:00'), end: Date.parse('2026-08-09T00:00:00+02:00'), label: 'Sat 8 Aug' }
  }
  return { start: Date.parse('2026-08-09T00:00:00+02:00'), end: Date.parse('2026-08-10T00:00:00+02:00'), label: 'Sun 9 Aug' }
}

/**
 * Split a polyline on real discontinuities.
 * Stored samples are ~3s apart (often 5–10s) — only treat dt≥7s or teleports as gaps.
 */
function splitSegments(pts: Pt[], maxDtS = 7, teleportM = 3, teleportSpeed = 2.5): { solid: Pt[][]; gaps: [Pt, Pt][] } {
  const solid: Pt[][] = []
  const gaps: [Pt, Pt][] = []
  if (!pts.length) return { solid, gaps }
  let cur: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]
    const b = pts[i]
    const dt = (b.t - a.t) / 1000
    const dist = Math.hypot(b.x - a.x, b.z - a.z)
    const isGap = dt >= maxDtS || (dist > teleportM && dt > 0.05 && dist / dt > teleportSpeed)
    if (isGap) {
      if (cur.length >= 2) solid.push(cur)
      else if (cur.length === 1) solid.push(cur)
      gaps.push([a, b])
      cur = [b]
    } else {
      cur.push(b)
    }
  }
  if (cur.length) solid.push(cur)
  return { solid, gaps }
}

function pathD(pts: Pt[]): string {
  if (pts.length < 2) return ''
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.z}`).join(' ')
}

function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

function interpAt(pts: Pt[], t: number): { x: number; z: number; vx: number; vz: number; inRoi: boolean } | null {
  if (!pts.length) return null
  if (t <= pts[0].t) return { x: pts[0].x, z: pts[0].z, vx: 0, vz: 0, inRoi: !!pts[0].inRoi }
  if (t >= pts[pts.length - 1].t) {
    const a = pts[pts.length - 2] || pts[0]
    const b = pts[pts.length - 1]
    const dt = Math.max(0.001, (b.t - a.t) / 1000)
    return { x: b.x, z: b.z, vx: (b.x - a.x) / dt, vz: (b.z - a.z) / dt, inRoi: !!b.inRoi }
  }
  let i = 1
  while (i < pts.length && pts[i].t < t) i++
  const a = pts[i - 1]
  const b = pts[i]
  const u = (t - a.t) / Math.max(1, b.t - a.t)
  const dt = Math.max(0.001, (b.t - a.t) / 1000)
  return {
    x: a.x + (b.x - a.x) * u,
    z: a.z + (b.z - a.z) * u,
    vx: (b.x - a.x) / dt,
    vz: (b.z - a.z) / dt,
    inRoi: !!(u < 0.5 ? a.inRoi : b.inRoi),
  }
}

function SampleMap({
  objects,
  regions,
  focusRois,
  paths,
  highlightPath,
  title,
  subtitle,
  bounds,
  breakGaps = false,
  compact = false,
}: {
  objects: VenueObject[]
  regions: MapRegion[]
  focusRois: MapRegion[]
  paths: { id: string; pts: Pt[]; stroke: string; width?: number }[]
  highlightPath?: Pt[]
  title: string
  subtitle: string
  bounds: MapBounds
  breakGaps?: boolean
  compact?: boolean
}) {
  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])
  const vb = boundsToViewBox(bounds)

  return (
    <div className={`rounded-xl border border-gray-700 bg-gray-950 overflow-hidden flex flex-col min-h-0 ${compact ? 'max-w-md' : ''}`}>
      <div className="px-3 py-2 border-b border-gray-800 flex items-baseline justify-between gap-2">
        <div>
          <p className="text-sm text-white font-medium">{title}</p>
          <p className="text-[11px] text-gray-500">{subtitle}</p>
        </div>
      </div>
      <svg
        viewBox={vb}
        className={`w-full bg-[#0b0e14] ${compact ? 'h-[220px]' : 'h-[240px]'}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {fixtures.map((f) => {
          const outline = getDrawableFixtureOutline(f)
          if (outline.length < 3) return null
          return (
            <path
              key={f.id}
              d={polygonPath(outline)}
              fill="rgba(125,145,175,0.06)"
              stroke="rgba(125,145,175,0.28)"
              strokeWidth={0.04}
            />
          )
        })}
        {regions.map((r) => (
          <path
            key={r.id}
            d={polygonPath(r.vertices)}
            fill="rgba(148,163,184,0.03)"
            stroke="rgba(148,163,184,0.12)"
            strokeWidth={0.03}
          />
        ))}
        {focusRois.map((r) => (
          <path
            key={`f-${r.id}`}
            d={polygonPath(r.vertices)}
            fill="rgba(251,191,36,0.12)"
            stroke="rgba(251,191,36,0.55)"
            strokeWidth={0.06}
          />
        ))}
        {paths.map((p) => {
          if (!breakGaps) {
            return (
              <path
                key={p.id}
                d={pathD(p.pts)}
                fill="none"
                stroke={p.stroke}
                strokeWidth={p.width ?? 0.08}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
              />
            )
          }
          const { solid, gaps } = splitSegments(p.pts)
          return (
            <g key={p.id}>
              {solid.map((seg, i) => (
                seg.length >= 2 ? (
                  <path
                    key={`${p.id}-s${i}`}
                    d={pathD(seg)}
                    fill="none"
                    stroke={p.stroke}
                    strokeWidth={p.width ?? 0.08}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.95}
                  />
                ) : (
                  <circle key={`${p.id}-d${i}`} cx={seg[0].x} cy={seg[0].z} r={0.14} fill={p.stroke} />
                )
              ))}
              {gaps.map(([a, b], i) => (
                <line
                  key={`${p.id}-g${i}`}
                  x1={a.x}
                  y1={a.z}
                  x2={b.x}
                  y2={b.z}
                  stroke="rgba(248,113,113,0.55)"
                  strokeWidth={0.07}
                  strokeDasharray="0.25 0.2"
                />
              ))}
            </g>
          )
        })}
        {highlightPath && highlightPath.length > 0 && (
          <>
            <circle
              cx={highlightPath[0].x}
              cy={highlightPath[0].z}
              r={0.18}
              fill="rgba(52,211,153,0.9)"
            />
            <circle
              cx={highlightPath[highlightPath.length - 1].x}
              cy={highlightPath[highlightPath.length - 1].z}
              r={0.18}
              fill="rgba(248,113,113,0.9)"
            />
          </>
        )}
      </svg>
    </div>
  )
}

const PLAY_SPEEDS = [1, 4, 8, 16]

/** Compact animated playback for a single raw vendor path. */
function AnimatedRawTrackMap({
  objects,
  regions,
  focusRois,
  path,
  title,
  subtitle,
  bounds,
}: {
  objects: VenueObject[]
  regions: MapRegion[]
  focusRois: MapRegion[]
  path: Pt[]
  title: string
  subtitle: string
  bounds: MapBounds
}) {
  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])
  const vb = boundsToViewBox(bounds)
  const t0 = path[0]?.t ?? 0
  const t1 = path[path.length - 1]?.t ?? t0
  const dur = Math.max(1, t1 - t0)

  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(8)
  const [tNow, setTNow] = useState(t0)
  const rafRef = useRef<number | null>(null)
  const lastFrameRef = useRef(0)

  useEffect(() => {
    setTNow(t0)
    setPlaying(true)
    lastFrameRef.current = 0
  }, [t0, path])

  useEffect(() => {
    if (!playing || path.length < 2) return
    const step = (ts: number) => {
      const last = lastFrameRef.current || ts
      const dt = ts - last
      lastFrameRef.current = ts
      setTNow((prev) => {
        let next = prev + dt * speed
        if (next >= t1) {
          setPlaying(false)
          return t1
        }
        return next
      })
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      lastFrameRef.current = 0
    }
  }, [playing, speed, t1, path.length])

  const pos = useMemo(() => interpAt(path, tNow), [path, tNow])
  const trail = useMemo(() => path.filter((p) => p.t <= tNow), [path, tNow])
  const { solid: fullSolid, gaps: fullGaps } = useMemo(() => splitSegments(path), [path])
  const { solid: trailSolid } = useMemo(() => splitSegments(trail), [trail])
  const elapsed = tNow - t0
  const speedMps = pos ? Math.hypot(pos.vx, pos.vz) : 0
  const arrowLen = Math.min(1.8, Math.max(0.35, speedMps * 0.55))
  const isFragmented = fullGaps.length > 0

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-950 overflow-hidden max-w-md">
      <div className="px-3 py-2 border-b border-gray-800 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm text-white font-medium truncate">{title}</p>
          <p className="text-[11px] text-gray-500 truncate">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ${
            isFragmented
              ? 'bg-red-950/60 text-red-300 border border-red-800/50'
              : 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/50'
          }`}>
            {isFragmented ? `${fullGaps.length} gap${fullGaps.length === 1 ? '' : 's'}` : 'continuous'}
          </span>
          <div className="font-mono text-sm text-emerald-300 tabular-nums">
            {fmtClock(elapsed)}
            <span className="text-gray-600"> / </span>
            <span className="text-gray-400">{fmtClock(dur)}</span>
          </div>
        </div>
      </div>

      <svg viewBox={vb} className="w-full h-[220px] bg-[#0b0e14]" preserveAspectRatio="xMidYMid meet">
        {fixtures.map((f) => {
          const outline = getDrawableFixtureOutline(f)
          if (outline.length < 3) return null
          return (
            <path
              key={f.id}
              d={polygonPath(outline)}
              fill="rgba(125,145,175,0.06)"
              stroke="rgba(125,145,175,0.28)"
              strokeWidth={0.04}
            />
          )
        })}
        {regions.map((r) => (
          <path
            key={r.id}
            d={polygonPath(r.vertices)}
            fill="rgba(148,163,184,0.03)"
            stroke="rgba(148,163,184,0.12)"
            strokeWidth={0.03}
          />
        ))}
        {focusRois.map((r) => (
          <path
            key={`f-${r.id}`}
            d={polygonPath(r.vertices)}
            fill="rgba(251,191,36,0.12)"
            stroke="rgba(251,191,36,0.55)"
            strokeWidth={0.06}
          />
        ))}
        {/* faint solid segments (walking) */}
        {fullSolid.map((seg, i) => (
          <path
            key={`fs-${i}`}
            d={pathD(seg)}
            fill="none"
            stroke="rgba(52,211,153,0.22)"
            strokeWidth={0.07}
            strokeLinecap="round"
          />
        ))}
        {/* red dashed = tracking hole / discontinuity (not a blind-spot paint) */}
        {fullGaps.map(([a, b], i) => (
          <line
            key={`fg-${i}`}
            x1={a.x}
            y1={a.z}
            x2={b.x}
            y2={b.z}
            stroke="rgba(248,113,113,0.85)"
            strokeWidth={0.1}
            strokeDasharray="0.25 0.18"
            strokeLinecap="round"
          />
        ))}
        {/* played trail — solid segments only */}
        {trailSolid.map((seg, i) => (
          seg.length >= 2 ? (
            <path
              key={`ts-${i}`}
              d={pathD(seg)}
              fill="none"
              stroke="rgba(52,211,153,0.95)"
              strokeWidth={0.11}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null
        ))}
        {pos && (
          <g>
            {speedMps > 0.08 && (
              <line
                x1={pos.x}
                y1={pos.z}
                x2={pos.x + (pos.vx / speedMps) * arrowLen}
                y2={pos.z + (pos.vz / speedMps) * arrowLen}
                stroke={pos.inRoi ? 'rgba(251,191,36,0.95)' : 'rgba(96,165,250,0.95)'}
                strokeWidth={0.12}
                strokeLinecap="round"
              />
            )}
            <circle
              cx={pos.x}
              cy={pos.z}
              r={0.22}
              fill={pos.inRoi ? '#fbbf24' : '#34d399'}
              stroke="#fff"
              strokeWidth={0.05}
            />
          </g>
        )}
      </svg>

      <div className="px-3 py-1.5 border-t border-gray-800/80 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500">
        <span><span className="inline-block w-3 h-0.5 bg-emerald-400/90 align-middle mr-1" />walking (stored samples)</span>
        <span><span className="inline-block w-3 border-t border-dashed border-red-400 align-middle mr-1" />gap ≥7s or teleport</span>
        <span className="text-amber-200/80">amber zone = Verdura ROI</span>
      </div>

      <div className="px-3 py-2 border-t border-gray-800 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => { setTNow(t0); setPlaying(true); lastFrameRef.current = 0 }}
          className="p-1.5 rounded-lg bg-gray-800 border border-gray-600 text-gray-300 hover:text-white"
          title="Restart"
        >
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="p-1.5 rounded-lg bg-gray-800 border border-gray-600 text-gray-300 hover:text-white"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <input
          type="range"
          min={t0}
          max={t1}
          step={Math.max(1, Math.floor(dur / 400))}
          value={tNow}
          onChange={(e) => { setPlaying(false); setTNow(Number(e.target.value)) }}
          className="flex-1 min-w-[120px] accent-emerald-500"
        />
        <div className="flex gap-0.5">
          {PLAY_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                speed === s ? 'bg-emerald-700 text-white' : 'text-gray-500 hover:text-white'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
        <span className="text-[11px] text-gray-400 font-mono tabular-nums w-14 text-right">
          {speedMps.toFixed(1)} m/s
        </span>
        {pos?.inRoi && (
          <span className="text-[10px] uppercase tracking-wide text-amber-300">in ROI</span>
        )}
      </div>
    </div>
  )
}

export default function LiveTrackSamplesTab({
  defaultVenueId = TREVIGLIO,
}: {
  defaultVenueId?: string
}) {
  const [venueId] = useState(defaultVenueId)
  const [preset, setPreset] = useState<WindowPreset>('sat')
  const [category, setCategory] = useState('Verdura')
  const [categories, setCategories] = useState<string[]>([])
  const [mode, setMode] = useState<ViewMode>('raw')
  const [sort, setSort] = useState<'longest' | 'gaps' | 'shortest' | 'chopped' | 'recent'>('longest')
  const [lifeBucket, setLifeBucket] = useState('ge120')
  const [limit, setLimit] = useState(12)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payload, setPayload] = useState<Payload | null>(null)
  const [idx, setIdx] = useState(0)
  const [objects, setObjects] = useState<VenueObject[]>([])
  const [allRois, setAllRois] = useState<MapRegion[]>([])
  const [venueSize, setVenueSize] = useState<{ width: number; depth: number } | null>(null)
  const abortRef = useRef(0)

  const range = useMemo(() => windowRange(preset), [preset])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [vRes, rRes, cRes] = await Promise.all([
          fetch(`${API_BASE}/api/venues/${venueId}`),
          fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`),
          fetch(`${API_BASE}/api/benchmark/live-samples/categories?venueId=${encodeURIComponent(venueId)}`),
        ])
        if (vRes.ok) {
          const data = await vRes.json()
          if (!cancelled) {
            setObjects(data.objects || [])
            if (data.venue) setVenueSize({ width: data.venue.width, depth: data.venue.depth })
          }
        }
        if (rRes.ok) {
          const rois = await rRes.json()
          if (!cancelled) {
            setAllRois(
              (rois || []).map((r: { id: string; vertices: { x: number; z?: number; y?: number }[] }) => ({
                id: r.id,
                vertices: (r.vertices || []).map(normalizeFloorVertex),
              })),
            )
          }
        }
        if (cRes.ok) {
          const j = await cRes.json()
          if (!cancelled && Array.isArray(j.categories) && j.categories.length) {
            setCategories(j.categories)
            setCategory((prev) => (j.categories.includes(prev) ? prev : j.categories[0]))
          }
        }
      } catch { /* ignore bootstrap errors */ }
    })()
    return () => { cancelled = true }
  }, [venueId])

  const load = useCallback(async () => {
    const token = ++abortRef.current
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({
        venueId,
        category,
        start: String(range.start),
        end: String(range.end),
        limit: String(limit),
        sort,
        mode,
      })
      if (mode === 'raw' && lifeBucket) qs.set('lifeBucket', lifeBucket)
      const res = await fetch(`${API_BASE}/api/benchmark/live-samples?${qs}`)
      const j = await res.json()
      if (token !== abortRef.current) return
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      if (j.error) setError(j.error)
      setPayload(j as Payload)
      setIdx(0)
      if (Array.isArray(j.categories) && j.categories.length) setCategories(j.categories)
      // Keep select in sync if server falls back to another cluster.
      if (mode === 'raw' && j.lifeBucket && j.lifeBucket !== lifeBucket) {
        setLifeBucket(j.lifeBucket)
      }
    } catch (e) {
      if (token !== abortRef.current) return
      setError(e instanceof Error ? e.message : String(e))
      setPayload(null)
    } finally {
      if (token === abortRef.current) setLoading(false)
    }
  }, [venueId, category, range.start, range.end, limit, sort, mode, lifeBucket])

  useEffect(() => { void load() }, [load])

  const sample = payload?.samples?.[idx] ?? null
  const focusRois: MapRegion[] = useMemo(
    () => (payload?.rois || []).map((r) => ({ id: r.id, vertices: r.vertices })),
    [payload],
  )

  const bounds = useMemo(() => {
    const pts: { x: number; z: number }[] = []
    // Raw playback: crop tightly to the track (full ROIs make the window gigantic).
    // Reconciled compare: include department ROI outline for context.
    if (mode !== 'raw') {
      for (const r of focusRois) for (const v of r.vertices) pts.push(v)
    }
    if (sample) {
      for (const p of sample.reconciledPath) pts.push({ x: p.x, z: p.z })
      if (mode !== 'raw') {
        for (const arr of Object.values(sample.rawPaths)) {
          for (const p of arr) pts.push({ x: p.x, z: p.z })
        }
      }
    }
    if (pts.length >= 2) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
      for (const p of pts) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z)
      }
      // Keep a usable aspect — avoid ultra-thin strips on aisle-local tracks.
      const minSpan = mode === 'raw' ? 6 : 8
      const cx = (minX + maxX) / 2
      const cz = (minZ + maxZ) / 2
      let spanX = maxX - minX
      let spanZ = maxZ - minZ
      if (spanX < minSpan) { minX = cx - minSpan / 2; maxX = cx + minSpan / 2; spanX = minSpan }
      if (spanZ < minSpan) { minZ = cz - minSpan / 2; maxZ = cz + minSpan / 2; spanZ = minSpan }
      const pad = mode === 'raw' ? 1.2 : 2.0
      return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad }
    }
    return computeFloorPlanBounds(objects, allRois, venueSize ?? undefined)
  }, [focusRois, sample, objects, allRois, venueSize, mode])

  const rawPaths = useMemo(() => {
    if (!sample) return []
    return Object.entries(sample.rawPaths).map(([id, pts]) => ({
      id,
      pts,
      stroke: colorId(id),
      width: 0.09,
    }))
  }, [sample])

  const recPaths = useMemo(() => {
    if (!sample) return []
    return [{
      id: sample.trackKey,
      pts: sample.reconciledPath,
      stroke: 'rgba(52,211,153,0.95)',
      width: 0.12,
    }]
  }, [sample])

  const step = (dir: number) => {
    if (!payload?.samples?.length) return
    setIdx((i) => (i + dir + payload.samples.length) % payload.samples.length)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100/90 space-y-1.5">
        {mode === 'raw' ? (
          <>
            <p>
              <strong className="text-amber-50">Raw vendor tracks by life cluster</strong> — one{' '}
              <code className="text-amber-200/80">original_perception_id</code>, no reconciler merge.
              Pick a duration cluster (most IDs sit under ~15 s) and animate them in the same ROI.
            </p>
            <p className="text-amber-100/70 text-xs">
              <strong className="text-amber-50">How to audit:</strong>{' '}
              1) Window = Last 24h, Department = Verdura.{' '}
              2) Life cluster = <em>15–30 s</em> (or 10–15 s).{' '}
              3) Within cluster = <em>Most gappy</em> → play a red-dashed path.{' '}
              4) Switch to <em>Longest (continuous first)</em> → play a solid green path in the same amber ROI.{' '}
              Same coverage, different continuity → tracking inconsistency (not a dead sensor zone).
              Gap = hole ≥7 s or teleport (normal 3–10 s samples are not gaps).
            </p>
          </>
        ) : (
          <>
            <p>
              <strong className="text-amber-50">Live luca reconciled</strong> identities — left = vendor
              fragments, right = one stable <code className="text-amber-200/80">track_key</code>.
            </p>
            <p className="text-amber-100/70 text-xs">
              Live gates tightened 11 Aug: 7 s / 5.0 m / 2.0 m/s (was 12 s / 12.7 m / 2.6 m/s). Red dashed = gaps in stored path.
            </p>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-400">
          View
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ViewMode)}
            className="mt-1 block bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white min-w-[200px]"
          >
            <option value="raw">Raw vendor (no merge)</option>
            <option value="reconciled">Reconciled (live luca)</option>
          </select>
        </label>
        <label className="text-xs text-gray-400">
          Department
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="mt-1 block bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white min-w-[160px]"
          >
            {(categories.length ? categories : [category]).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-400">
          Window
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value as WindowPreset)}
            className="mt-1 block bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white"
          >
            <option value="1h">Last 1 hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
            <option value="sat">Sat 8 Aug (audit day)</option>
            <option value="sun">Sun 9 Aug</option>
          </select>
        </label>
        {mode === 'raw' && (
          <label className="text-xs text-gray-400">
            Life cluster
            <select
              value={lifeBucket}
              onChange={(e) => setLifeBucket(e.target.value)}
              className="mt-1 block bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white min-w-[260px]"
            >
              {(payload?.lifeBuckets?.length
                ? payload.lifeBuckets
                : [
                    { id: 'lt3', label: '< 3 s — blink / 1–2 samples', count: 0 },
                    { id: '3_6', label: '3–6 s', count: 0 },
                    { id: '6_10', label: '6–10 s', count: 0 },
                    { id: '10_15', label: '10–15 s — under the KPI median', count: 0 },
                    { id: '15_30', label: '15–30 s — around the median', count: 0 },
                    { id: '30_60', label: '30–60 s', count: 0 },
                    { id: '60_120', label: '60–120 s', count: 0 },
                    { id: 'ge120', label: '≥ 120 s — longest survivors', count: 0 },
                  ]
              ).map((b) => (
                <option key={b.id} value={b.id} disabled={b.count === 0 && !!payload?.lifeBuckets}>
                  {b.label} ({b.count.toLocaleString()})
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-xs text-gray-400">
          Within cluster
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="mt-1 block bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white"
          >
            <option value="longest">{mode === 'raw' ? 'Longest in cluster (continuous first)' : 'Longest track life'}</option>
            {mode === 'raw' && (
              <option value="gaps">Most gappy (fragmented first)</option>
            )}
            {mode === 'raw' && (
              <option value="shortest">Shortest in cluster</option>
            )}
            {mode === 'reconciled' && (
              <option value="chopped">Most chopped (life ÷ in-ROI)</option>
            )}
            <option value="recent">Most recent</option>
          </select>
        </label>
        <label className="text-xs text-gray-400">
          Samples
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="mt-1 block bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-sm text-white"
          >
            {[8, 12, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Reload
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading samples…
        </div>
      )}
      {error && !loading && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {!loading && payload && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2">
              <p className="text-gray-500 uppercase tracking-wide text-[10px]">Touchers</p>
              <p className="text-white text-lg font-semibold">{payload.stats?.touchers?.toLocaleString() ?? '—'}</p>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2">
              <p className="text-gray-500 uppercase tracking-wide text-[10px]">Mean track life</p>
              <p className="text-emerald-300 text-lg font-semibold">{payload.stats?.meanTrackLifeS ?? '—'}s</p>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2">
              <p className="text-gray-500 uppercase tracking-wide text-[10px]">Mean in-ROI</p>
              <p className="text-amber-200 text-lg font-semibold">{payload.stats?.meanInRoiS ?? '—'}s</p>
            </div>
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2">
              <p className="text-gray-500 uppercase tracking-wide text-[10px]">
                {mode === 'raw' ? 'Continuous in list' : 'Mean raw IDs'}
              </p>
              <p className="text-blue-300 text-lg font-semibold">
                {mode === 'raw'
                  ? (payload.stats?.continuousShare != null ? `${payload.stats.continuousShare}%` : '—')
                  : (payload.stats?.meanRawIds ?? '—')}
              </p>
            </div>
            {mode === 'raw' && (
              <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2">
                <p className="text-gray-500 uppercase tracking-wide text-[10px]">Mean gaps / track</p>
                <p className="text-red-300 text-lg font-semibold">{payload.stats?.meanGaps ?? '—'}</p>
              </div>
            )}
            <div className="rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2">
              <p className="text-gray-500 uppercase tracking-wide text-[10px]">Window</p>
              <p className="text-white text-sm font-medium pt-1">{range.label}</p>
            </div>
          </div>

          {sample ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => step(-1)} className="p-1.5 rounded-lg bg-gray-800 border border-gray-600 text-gray-300 hover:text-white">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-sm text-gray-300 min-w-[7rem] text-center">
                    Sample {idx + 1} / {payload.samples.length}
                  </span>
                  <button type="button" onClick={() => step(1)} className="p-1.5 rounded-lg bg-gray-800 border border-gray-600 text-gray-300 hover:text-white">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <code className="text-[11px] text-gray-500 font-mono truncate max-w-[280px]">{sample.trackKey}</code>
                <span className="text-xs text-emerald-300">life {sample.durationS.toFixed(1)}s</span>
                <span className="text-xs text-amber-200">in-ROI {sample.inRoiDurationS.toFixed(1)}s</span>
                {mode === 'reconciled' && (
                  <span className="text-xs text-blue-300">{sample.rawIdCount} raw IDs</span>
                )}
                {mode === 'raw' && sample.gapCount != null && (
                  <span className={`text-xs ${(sample.gapCount || 0) > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                    {sample.gapCount} gap{(sample.gapCount || 0) === 1 ? '' : 's'}
                    {sample.segmentCount != null ? ` · ${sample.segmentCount} segments` : ''}
                  </span>
                )}
                {sample.chopFactor != null && (
                  <span className="text-xs text-gray-400">chop ×{sample.chopFactor}</span>
                )}
                {sample.spanM != null && (
                  <span className="text-xs text-gray-400">span {sample.spanM.toFixed(1)}m</span>
                )}
                {sample.maxJumpM != null && (
                  <span className={`text-xs ${(sample.suspectJumps || 0) > 0 ? 'text-red-400' : 'text-gray-400'}`}>
                    max jump {sample.maxJumpM.toFixed(1)}m
                    {(sample.suspectJumps || 0) > 0 ? ` · ${sample.suspectJumps} suspect` : ''}
                  </span>
                )}
                {mode === 'raw' && sample.continuous === true && (
                  <span className="text-xs text-emerald-300 font-medium">continuous</span>
                )}
                {mode === 'raw' && sample.continuous === false && (
                  <span className="text-xs text-red-300 font-medium">fragmented</span>
                )}
                {mode === 'reconciled' && sample.plausible === false && (
                  <span className="text-xs text-red-300 font-medium">likely over-merge</span>
                )}
              </div>

              {mode === 'raw' ? (
                <AnimatedRawTrackMap
                  objects={objects}
                  regions={allRois}
                  focusRois={focusRois}
                  path={sample.reconciledPath}
                  title="Raw vendor track (no merge)"
                  subtitle={`1 original_perception_id · ${sample.durationS.toFixed(1)}s · ${payload.category}`}
                  bounds={bounds}
                />
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 max-w-4xl">
                  <SampleMap
                    objects={objects}
                    regions={allRois}
                    focusRois={focusRois}
                    paths={rawPaths}
                    highlightPath={sample.reconciledPath}
                    title="Raw perception IDs"
                    subtitle={`${sample.rawIdCount} vendor fragment${sample.rawIdCount === 1 ? '' : 's'} · each colour = one original_perception_id`}
                    bounds={bounds}
                    breakGaps
                    compact
                  />
                  <SampleMap
                    objects={objects}
                    regions={allRois}
                    focusRois={focusRois}
                    paths={recPaths}
                    highlightPath={sample.reconciledPath}
                    title="After reconciliation (live luca)"
                    subtitle={
                      (sample.suspectJumps || 0) > 0
                        ? `1 track_key · ${sample.durationS.toFixed(1)}s · dashed red = gaps/jumps`
                        : `1 track_key · ${sample.durationS.toFixed(1)}s full life`
                    }
                    bounds={bounds}
                    breakGaps
                    compact
                  />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-gray-500 py-8 text-center">
              No tracks touched {payload.category || 'this department'} in {range.label}.
            </p>
          )}

          {payload.samples.length > 0 && (
            <div className="rounded-xl border border-gray-700 overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-800/80 text-gray-400">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">#</th>
                    <th className="text-right px-3 py-2 font-medium">Track life</th>
                    <th className="text-right px-3 py-2 font-medium">In-ROI</th>
                    {mode === 'reconciled' && (
                      <th className="text-right px-3 py-2 font-medium">Raw IDs</th>
                    )}
                    {mode === 'raw' && (
                      <th className="text-right px-3 py-2 font-medium">Gaps</th>
                    )}
                    <th className="text-right px-3 py-2 font-medium">Span</th>
                    <th className="text-right px-3 py-2 font-medium">Max jump</th>
                    {mode === 'raw' && (
                      <th className="text-left px-3 py-2 font-medium">Path</th>
                    )}
                    <th className="text-left px-3 py-2 font-medium">
                      {mode === 'raw' ? 'original_perception_id' : 'track_key'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {payload.samples.map((s, i) => (
                    <tr
                      key={s.trackKey}
                      onClick={() => setIdx(i)}
                      className={`cursor-pointer border-t border-gray-800 ${i === idx ? 'bg-amber-950/30' : 'hover:bg-gray-800/40'}`}
                    >
                      <td className="px-3 py-1.5 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-300 font-mono">{s.durationS.toFixed(1)}s</td>
                      <td className="px-3 py-1.5 text-right text-amber-200 font-mono">{s.inRoiDurationS.toFixed(1)}s</td>
                      {mode === 'reconciled' && (
                        <td className="px-3 py-1.5 text-right text-blue-300 font-mono">{s.rawIdCount}</td>
                      )}
                      {mode === 'raw' && (
                        <td className={`px-3 py-1.5 text-right font-mono ${(s.gapCount || 0) > 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                          {s.gapCount ?? 0}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-right text-gray-300 font-mono">{s.spanM?.toFixed(1) ?? '—'}m</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${(s.suspectJumps || 0) > 0 ? 'text-red-400' : 'text-gray-300'}`}>
                        {s.maxJumpM?.toFixed(1) ?? '—'}m
                      </td>
                      {mode === 'raw' && (
                        <td className={`px-3 py-1.5 font-medium ${s.continuous ? 'text-emerald-300' : 'text-red-300'}`}>
                          {s.continuous ? 'continuous' : 'fragmented'}
                        </td>
                      )}
                      <td className="px-3 py-1.5 text-gray-500 font-mono truncate max-w-[220px]">{s.trackKey}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
