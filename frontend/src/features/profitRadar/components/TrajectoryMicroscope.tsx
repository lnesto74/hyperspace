import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, ZoomIn } from 'lucide-react'
import { useTracking } from '../../../context/TrackingContext'
import { useProfitRadar } from '../../../context/ProfitRadarContext'
import {
  boundsToViewBox,
  getDrawableFixtureOutline,
  polygonPath,
  venueObjectsToFixtures,
} from '../../../utils/venueFloorPlanMap'
import { pointInPolygon, trajectoryBounds, useZoneMapData } from '../hooks/useZoneMapData'
import { trackKeyMatchesMoment, type BehaviorShowcaseMoment } from '../behaviorShowcaseCatalog'
import type { IntentAxisName } from '../../../types'

const AXIS_LABELS: Record<IntentAxisName, string> = {
  exploration: 'Exploring',
  goal_directedness: 'Goal-directed',
  urgency: 'Urgent',
  commitment: 'Committed',
  hesitation: 'Hesitating',
  confusion: 'Confused',
  social_groupness: 'Group',
  avoidance: 'Avoiding',
  waiting_queueing: 'Queueing',
  engagement_with_POI: 'Engaged',
  churn_exit_intent: 'Leaving',
  friction: 'Friction',
}

const TRAIL_MAX = 100

interface TrajectoryMicroscopeProps {
  venueId: string
  roiId: string | null
  zoneName: string
  focusTrackKey: string | null
  showcaseMoment?: BehaviorShowcaseMoment | null
}

/**
 * Magnified crop locked to the shopper trajectory (not the full zone polygon).
 * In long aisles the zone view is too wide — this follows the path at ~2–3 m scale.
 */
export default function TrajectoryMicroscope({
  venueId,
  roiId,
  zoneName,
  focusTrackKey,
  showcaseMoment = null,
}: TrajectoryMicroscopeProps) {
  const { tracks } = useTracking()
  const { trackAxes } = useProfitRadar()
  const { objects, zoneVerts } = useZoneMapData(venueId, roiId)

  const trailsRef = useRef<Map<string, { x: number; z: number; t: number }[]>>(new Map())
  const [, forceTick] = useState(0)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      forceTick(f => (f + 1) % 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    trailsRef.current.clear()
  }, [showcaseMoment?.id])

  useEffect(() => {
    const m = trailsRef.current
    const now = Date.now()
    const seen = new Set<string>()
    tracks.forEach(t => {
      const p = t.venuePosition ?? t.position
      if (!p) return
      seen.add(t.trackKey)
      const arr = m.get(t.trackKey) ?? []
      const last = arr[arr.length - 1]
      if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.02) {
        arr.push({ x: p.x, z: p.z, t: now })
        if (arr.length > TRAIL_MAX) arr.shift()
        m.set(t.trackKey, arr)
      }
    })
    for (const k of Array.from(m.keys())) if (!seen.has(k)) m.delete(k)
  }, [tracks])

  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])

  const inZoneTracks = useMemo(() => {
    if (zoneVerts.length < 3) return [] as { key: string; x: number; z: number }[]
    const out: { key: string; x: number; z: number }[] = []
    tracks.forEach(t => {
      const p = t.venuePosition ?? t.position
      if (!p || !pointInPolygon({ x: p.x, z: p.z }, zoneVerts)) return
      out.push({ key: t.trackKey, x: p.x, z: p.z })
    })
    return out
  }, [tracks, zoneVerts])

  const focusKey = showcaseMoment
    ? (focusTrackKey && trackKeyMatchesMoment(focusTrackKey, showcaseMoment) ? focusTrackKey : null)
    : (focusTrackKey ?? inZoneTracks[0]?.key ?? null)
  const focusTrail = focusKey ? (trailsRef.current.get(focusKey) ?? []) : []
  const focusAxes = focusKey ? trackAxes.find(t => t.trackKey === focusKey)?.axes : null
  const displayAxes = focusAxes ?? (showcaseMoment ? showcaseMoment.catalogAxes : null)

  const viewBox = useMemo(() => {
    const trailPts = focusTrail.length >= 1
      ? focusTrail
      : showcaseMoment
        ? [{ x: showcaseMoment.center.x, z: showcaseMoment.center.z }]
        : []
    if (trailPts.length === 0) return boundsToViewBox(trajectoryBounds([], 0.5, 2.4))
    const minSpan = showcaseMoment ? Math.max(2.0, Math.min(3.2, showcaseMoment.spanM + 1.8)) : 2.4
    return boundsToViewBox(trajectoryBounds(trailPts, 0.5, minSpan))
  }, [focusTrail, showcaseMoment])

  const annotation = useMemo(() => {
    if (showcaseMoment && !focusAxes) {
      return `${showcaseMoment.storyLine} (${showcaseMoment.label} · ${(showcaseMoment.axisScore * 100).toFixed(0)}%)`
    }
    if (!focusAxes) {
      if (focusTrail.length >= 2) return 'Shopper moving — fingerprint building as trajectory evolves…'
      return 'Select a shopper on the map or wait for movement in zone'
    }
    const engage = focusAxes.engagement_with_POI ?? 0
    const avoid = focusAxes.avoidance ?? 0
    const commit = focusAxes.commitment ?? 0
    const hesitate = focusAxes.hesitation ?? 0
    const confused = focusAxes.confusion ?? 0
    const urgent = focusAxes.urgency ?? 0
    const goal = focusAxes.goal_directedness ?? 0

    if (confused > 0.55) return `Confused — backtracking / looping (${(confused * 100).toFixed(0)}%)`
    if (urgent > 0.55 && hesitate < 0.35) return `Urgent pass-through (${(urgent * 100).toFixed(0)}%) — minimal shelf dwell`
    if (hesitate > 0.5 && commit < 0.35) return `Hesitating at shelf (${(hesitate * 100).toFixed(0)}%) — stops without commitment`
    if (goal > 0.55 && commit > 0.4) return `Goal-directed & committed (${(goal * 100).toFixed(0)}% / ${(commit * 100).toFixed(0)}%)`
    if (avoid > 0.55 && engage < 0.25) return `Pass-through — high avoidance (${(avoid * 100).toFixed(0)}%)`
    if (engage > 0.5 && commit < 0.35) return `Engaged but no commitment (${(engage * 100).toFixed(0)}%) — potential lost sale`
    const dominant = (Object.entries(focusAxes) as [IntentAxisName, number][])
      .sort((a, b) => b[1] - a[1])[0]
    return `Dominant: ${AXIS_LABELS[dominant[0]]} (${(dominant[1] * 100).toFixed(0)}%)`
  }, [focusAxes, focusTrail.length, showcaseMoment])

  const ghostTrails = useMemo(() => {
    return inZoneTracks
      .filter(t => t.key !== focusKey)
      .slice(0, 2)
      .map(t => ({ key: t.key, pts: trailsRef.current.get(t.key) ?? [] }))
  }, [inZoneTracks, focusKey, tracks])

  const strokeScale = useMemo(() => {
    const parts = viewBox.split(/\s+/).map(Number)
    const w = parts[2] || 3
    return Math.max(0.04, Math.min(0.12, w * 0.025))
  }, [viewBox])

  return (
    <div className="shrink-0 border-t border-gray-700/60 bg-gray-950/80">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/80">
        <Crosshair className="w-3.5 h-3.5 text-red-400" />
        <span className="text-[11px] font-medium text-gray-200">Trajectory microscope</span>
        <ZoomIn className="w-3 h-3 text-gray-500" />
        <span className="text-[10px] text-gray-500 truncate">{zoneName}</span>
        {showcaseMoment && (
          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
            {showcaseMoment.label}
          </span>
        )}
        {focusKey && (
          <span className="ml-auto text-[9px] text-red-300/80 font-mono truncate max-w-[120px]">
            track {focusKey.slice(-8)}
          </span>
        )}
      </div>

      <div className="flex items-stretch gap-0" style={{ height: 188 }}>
        <div className="flex-1 min-w-0 relative">
          <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="w-full h-full block" style={{ background: '#030508' }}>
            {fixtures.map(f => {
              const outline = getDrawableFixtureOutline(f)
              if (outline.length < 3) return null
              const cx = outline.reduce((s, p) => s + p.x, 0) / outline.length
              const cz = outline.reduce((s, p) => s + p.z, 0) / outline.length
              const parts = viewBox.split(/\s+/).map(Number)
              const vx = parts[0] ?? 0
              const vz = parts[1] ?? 0
              const vw = parts[2] ?? 10
              const vh = parts[3] ?? 10
              if (cx < vx - 1 || cx > vx + vw + 1 || cz < vz - 1 || cz > vz + vh + 1) return null
              return (
                <path
                  key={f.id}
                  d={polygonPath(outline)}
                  fill="rgba(0,210,255,0.05)"
                  stroke="rgba(0,210,255,0.2)"
                  strokeWidth={strokeScale * 0.5}
                />
              )
            })}

            {ghostTrails.map(({ key, pts }) => {
              if (pts.length < 2) return null
              return (
                <polyline
                  key={`g-${key}`}
                  points={pts.map(p => `${p.x},${p.z}`).join(' ')}
                  fill="none"
                  stroke="rgba(96,165,250,0.18)"
                  strokeWidth={strokeScale * 0.6}
                  strokeLinecap="round"
                />
              )
            })}

            {focusTrail.length >= 2 && (
              <>
                <polyline
                  points={focusTrail.map(p => `${p.x},${p.z}`).join(' ')}
                  fill="none"
                  stroke="#f87171"
                  strokeWidth={strokeScale * 1.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {focusTrail.filter((_, i) => i > 0 && i % 3 === 0).map((p, i) => (
                  <circle
                    key={`dw-${i}`}
                    cx={p.x}
                    cy={p.z}
                    r={strokeScale * 1.4}
                    fill="rgba(251,191,36,0.35)"
                    stroke="#fbbf24"
                    strokeWidth={strokeScale * 0.25}
                  />
                ))}
                {(() => {
                  const last = focusTrail[focusTrail.length - 1]
                  const prev = focusTrail[Math.max(0, focusTrail.length - 3)]
                  const dx = last.x - prev.x
                  const dz = last.z - prev.z
                  const len = Math.hypot(dx, dz) || 1
                  const ax = last.x + (dx / len) * (strokeScale * 3)
                  const az = last.z + (dz / len) * (strokeScale * 3)
                  return (
                    <>
                      <circle cx={last.x} cy={last.z} r={strokeScale * 1.6} fill="#f87171" stroke="#fff" strokeWidth={strokeScale * 0.35} />
                      <line x1={last.x} y1={last.z} x2={ax} y2={az} stroke="#fca5a5" strokeWidth={strokeScale * 0.8} />
                    </>
                  )
                })()}
              </>
            )}

            {focusTrail.length < 2 && showcaseMoment && (
              <circle
                cx={focusTrail[0]?.x ?? showcaseMoment.center.x}
                cy={focusTrail[0]?.z ?? showcaseMoment.center.z}
                r={strokeScale * 2.2}
                fill="rgba(248,113,113,0.35)"
                stroke="#f87171"
                strokeWidth={strokeScale * 0.5}
              />
            )}
          </svg>
        </div>

        <div className="w-[280px] shrink-0 border-l border-gray-800/80 px-3 py-2 flex flex-col justify-center">
          {showcaseMoment && (
            <p className="text-[10px] font-medium text-indigo-300 mb-1">{showcaseMoment.storyTitle}</p>
          )}
          <p className="text-[11px] text-gray-300 leading-relaxed">{annotation}</p>
          {displayAxes && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                ['Hesitate', displayAxes.hesitation, '#f59e0b'],
                ['Confused', displayAxes.confusion, '#f97316'],
                ['Urgent', displayAxes.urgency, '#ef4444'],
                ['Commit', displayAxes.commitment, '#10b981'],
                ['Goal', displayAxes.goal_directedness, '#22c55e'],
              ].map(([label, val, c]) => (
                <span
                  key={label as string}
                  className="text-[9px] px-1.5 py-0.5 rounded tabular-nums"
                  style={{ color: c as string, backgroundColor: `${c}18`, border: `1px solid ${c}44` }}
                >
                  {label as string} {(Number(val) * 100).toFixed(0)}%
                </span>
              ))}
            </div>
          )}
          <p className="text-[9px] text-gray-600 mt-2">1× replay · zoom follows trajectory</p>
        </div>
      </div>
    </div>
  )
}
