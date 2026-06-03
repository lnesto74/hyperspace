import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, MapPin, TrendingUp, TrendingDown, Clock, Film } from 'lucide-react'
import type { NarrationPack } from '../../context/ReplayInsightContext'
import type { VenueObject } from '../../types'
import {
  boundsToViewBox,
  computeFloorPlanBounds,
  getDrawableFixtureOutline,
  normalizeFloorVertex,
  polygonPath,
  venueObjectsToFixtures,
  type MapRegion,
} from '../../utils/venueFloorPlanMap'

interface DayRecapReelProps {
  episodes: NarrationPack[]
  objects: VenueObject[]
  venueSize?: { width: number; depth: number }
  autoPlay?: boolean
  onWatchOnFloor?: (episodeId: string) => void
}

const SEVERITY_DOT: Record<string, string> = {
  high: '#f87171',
  medium: '#fbbf24',
  low: '#60a5fa',
}

const STEP_MS = 4800

function startMs(e: NarrationPack): number {
  return e.replay_window?.start ?? 0
}

export default function DayRecapReel({ episodes, objects, venueSize, autoPlay = false, onWatchOnFloor }: DayRecapReelProps) {
  const ordered = useMemo(
    () => [...episodes].sort((a, b) => startMs(a) - startMs(b)),
    [episodes],
  )

  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const [progress, setProgress] = useState(0)
  const pulseRef = useRef(0)
  const [, forceTick] = useState(0)

  useEffect(() => { setIndex(0) }, [ordered.length])
  useEffect(() => { setPlaying(autoPlay) }, [autoPlay])

  // Auto-advance with a progress bar.
  useEffect(() => {
    if (!playing || ordered.length === 0) return
    const started = performance.now()
    setProgress(0)
    let raf = 0
    const tick = (ts: number) => {
      const p = Math.min(1, (ts - started) / STEP_MS)
      setProgress(p)
      pulseRef.current = (ts % 2000) / 2000
      forceTick(f => (f + 1) % 1000)
      if (p >= 1) {
        setIndex(i => (i + 1) % ordered.length)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, index, ordered.length])

  // Keep the pulse going even when paused.
  useEffect(() => {
    if (playing) return
    let raf = 0
    const tick = (ts: number) => {
      pulseRef.current = (ts % 2000) / 2000
      forceTick(f => (f + 1) % 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const allRegions: MapRegion[] = useMemo(
    () => ordered.flatMap(e => (e.highlight_zones || []).map(z => ({ id: z.id, vertices: z.vertices.map(normalizeFloorVertex) }))),
    [ordered],
  )
  const bounds = useMemo(() => computeFloorPlanBounds(objects, allRegions, venueSize), [objects, allRegions, venueSize])
  const viewBox = useMemo(() => boundsToViewBox(bounds), [bounds])
  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])

  if (ordered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <Film className="w-10 h-10 mb-3 opacity-30" />
        <p className="text-sm">No episodes captured for this day yet.</p>
        <p className="text-xs mt-1">Episodes appear as the system analyses the day's trajectories.</p>
      </div>
    )
  }

  const ep = ordered[index]
  const pulseWave = 0.5 + 0.5 * Math.sin(pulseRef.current * Math.PI * 2)
  const accent = ep.color || '#60a5fa'
  const focusIds = new Set((ep.highlight_zones || []).map(z => z.id))

  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900/60 overflow-hidden">
      {/* Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-2">
        {/* Map */}
        <div className="relative" style={{ background: '#050810' }}>
          <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="w-full block" style={{ height: 340 }}>
            {fixtures.map(f => {
              const outline = getDrawableFixtureOutline(f)
              if (outline.length < 3) return null
              return (
                <path key={f.id} d={polygonPath(outline)} fill="rgba(0,210,255,0.04)" stroke="rgba(0,210,255,0.22)" strokeWidth={0.04} strokeLinejoin="round" />
              )
            })}
            {allRegions.map(r => {
              if (focusIds.has(r.id)) return null
              return <path key={r.id} d={polygonPath(r.vertices)} fill="rgba(148,163,184,0.04)" stroke="rgba(75,85,99,0.35)" strokeWidth={0.03} />
            })}
            {(ep.highlight_zones || []).map(z => (
              <path
                key={`hl-${z.id}`}
                d={polygonPath(z.vertices.map(normalizeFloorVertex))}
                fill={`${accent}${Math.round((0.18 + pulseWave * 0.22) * 255).toString(16).padStart(2, '0')}`}
                stroke={accent}
                strokeWidth={0.08 + pulseWave * 0.05}
                strokeLinejoin="round"
              />
            ))}
          </svg>
          <div className="absolute top-3 left-3 flex items-center gap-1.5 text-[11px] text-gray-300 bg-black/40 backdrop-blur px-2 py-1 rounded-full">
            <Clock className="w-3 h-3" /> {ep.time_label}
          </div>
        </div>

        {/* Info */}
        <div className="p-5 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
              style={{ color: SEVERITY_DOT[ep.severity], backgroundColor: `${SEVERITY_DOT[ep.severity]}22` }}
            >
              {ep.severity}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-400">{ep.category}</span>
            {ep.product_category && <span className="text-[10px] text-gray-500">· {ep.product_category}</span>}
          </div>
          <h3 className="text-lg font-semibold text-white leading-snug mb-2">{ep.title}</h3>
          <p className="text-sm text-gray-400 leading-relaxed">{ep.business_summary}</p>

          {ep.kpis && ep.kpis.length > 0 && (
            <div className="grid grid-cols-3 gap-2 mt-4">
              {ep.kpis.slice(0, 3).map(k => {
                const c = k.direction === 'up' ? '#34d399' : k.direction === 'down' ? '#f87171' : '#9ca3af'
                return (
                  <div key={k.id} className="rounded-lg bg-gray-800/70 border border-gray-700/60 px-2.5 py-2">
                    <div className="text-[10px] text-gray-500 truncate" title={k.label}>{k.label}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      {k.direction === 'up' ? <TrendingUp className="w-3 h-3" style={{ color: c }} /> : k.direction === 'down' ? <TrendingDown className="w-3 h-3" style={{ color: c }} /> : null}
                      <span className="text-sm font-semibold text-white tabular-nums">
                        {k.value != null ? `${k.value}${k.unit || ''}` : '—'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {ep.recommended_actions && ep.recommended_actions.length > 0 && (
            <div className="mt-4 text-xs text-gray-300">
              <span className="text-gray-500">Suggested action: </span>{ep.recommended_actions[0]}
            </div>
          )}

          <div className="mt-auto pt-4">
            {onWatchOnFloor && (
              <button
                onClick={() => onWatchOnFloor(ep.episode_id)}
                className="flex items-center gap-1.5 text-xs font-medium text-blue-300 hover:text-blue-200"
              >
                <MapPin className="w-3.5 h-3.5" /> Watch on the floor →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-700/60 bg-gray-900/80">
        <button onClick={() => setIndex(i => (i - 1 + ordered.length) % ordered.length)} className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/50">
          <SkipBack className="w-4 h-4" />
        </button>
        <button onClick={() => setPlaying(p => !p)} className="p-2 rounded-full bg-blue-600 hover:bg-blue-500 text-white">
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button onClick={() => setIndex(i => (i + 1) % ordered.length)} className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-gray-700/50">
          <SkipForward className="w-4 h-4" />
        </button>
        <span className="text-xs text-gray-500 tabular-nums ml-1">{index + 1} / {ordered.length}</span>
        <div className="flex-1 h-1 rounded-full bg-gray-700 overflow-hidden">
          <div className="h-full bg-blue-500" style={{ width: `${playing ? progress * 100 : 0}%` }} />
        </div>
      </div>

      {/* Film-strip */}
      <div className="flex gap-2 overflow-x-auto px-4 py-3 border-t border-gray-700/60">
        {ordered.map((e, i) => (
          <button
            key={e.episode_id}
            onClick={() => { setIndex(i); setPlaying(false) }}
            className={`shrink-0 w-36 text-left rounded-lg border px-2.5 py-2 transition-all ${
              i === index ? 'border-blue-500/60 bg-blue-500/10' : 'border-gray-700/60 bg-gray-800/40 hover:bg-gray-800'
            }`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SEVERITY_DOT[e.severity] }} />
              <span className="text-[10px] text-gray-500">{e.time_label}</span>
            </div>
            <div className="text-[11px] text-gray-200 leading-tight line-clamp-2">{e.title}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
