import { useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair } from 'lucide-react'
import { useTracking } from '../../../context/TrackingContext'
import { useProfitRadar } from '../../../context/ProfitRadarContext'
import {
  getDrawableFixtureOutline,
  polygonPath,
  venueObjectsToFixtures,
} from '../../../utils/venueFloorPlanMap'
import { pointInPolygon, useZoneMapData } from '../hooks/useZoneMapData'
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

interface TrajectoryMicroscopeProps {
  venueId: string
  roiId: string | null
  zoneName: string
  focusTrackKey: string | null
}

/**
 * Magnified crop of the underperforming zone — highlights one shopper trajectory
 * with dwell halos and a plain-English annotation.
 */
export default function TrajectoryMicroscope({ venueId, roiId, zoneName, focusTrackKey }: TrajectoryMicroscopeProps) {
  const { tracks } = useTracking()
  const { trackAxes } = useProfitRadar()
  const { objects, zoneVerts, zoneViewBox } = useZoneMapData(venueId, roiId)

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
    const m = trailsRef.current
    const now = Date.now()
    const seen = new Set<string>()
    tracks.forEach(t => {
      const p = t.venuePosition ?? t.position
      if (!p) return
      seen.add(t.trackKey)
      const arr = m.get(t.trackKey) ?? []
      const last = arr[arr.length - 1]
      if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.025) {
        arr.push({ x: p.x, z: p.z, t: now })
        if (arr.length > 40) arr.shift()
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

  const focusKey = focusTrackKey ?? inZoneTracks[0]?.key ?? null
  const focusTrail = focusKey ? (trailsRef.current.get(focusKey) ?? []) : []
  const focusAxes = focusKey ? trackAxes.find(t => t.trackKey === focusKey)?.axes : null

  const annotation = useMemo(() => {
    if (!focusAxes) {
      if (focusTrail.length >= 2) return 'Shopper moving through zone — tracking trajectory…'
      return 'Select a shopper on the map or wait for movement in zone'
    }
    const engage = focusAxes.engagement_with_POI ?? 0
    const avoid = focusAxes.avoidance ?? 0
    const commit = focusAxes.commitment ?? 0
    const hesitate = focusAxes.hesitation ?? 0

    if (avoid > 0.55 && engage < 0.25) {
      return `Pass-through pattern — high avoidance (${(avoid * 100).toFixed(0)}%), minimal POI engagement`
    }
    if (hesitate > 0.5 && commit < 0.3) {
      return `Stopped and hesitated (${(hesitate * 100).toFixed(0)}%) — oriented toward shelf but no purchase commitment`
    }
    if (engage > 0.5 && commit < 0.35) {
      return `Engaged with products (${(engage * 100).toFixed(0)}%) but low commitment — potential lost sale`
    }
    const dominant = (Object.entries(focusAxes) as [IntentAxisName, number][])
      .sort((a, b) => b[1] - a[1])[0]
    return `Dominant behavior: ${AXIS_LABELS[dominant[0]]} (${(dominant[1] * 100).toFixed(0)}%)`
  }, [focusAxes, focusTrail.length])

  const ghostTrails = useMemo(() => {
    return inZoneTracks
      .filter(t => t.key !== focusKey)
      .slice(0, 3)
      .map(t => ({ key: t.key, pts: trailsRef.current.get(t.key) ?? [] }))
  }, [inZoneTracks, focusKey, tracks])

  return (
    <div className="shrink-0 border-t border-gray-700/60 bg-gray-950/80">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800/80">
        <Crosshair className="w-3.5 h-3.5 text-red-400" />
        <span className="text-[11px] font-medium text-gray-200">Trajectory microscope</span>
        <span className="text-[10px] text-gray-500 truncate">{zoneName}</span>
        {focusKey && (
          <span className="ml-auto text-[9px] text-red-300/80 font-mono truncate max-w-[120px]">
            track {focusKey.slice(-6)}
          </span>
        )}
      </div>

      <div className="flex items-stretch gap-0" style={{ height: 168 }}>
        <div className="flex-1 min-w-0 relative">
          {zoneVerts.length >= 3 ? (
            <svg viewBox={zoneViewBox} preserveAspectRatio="xMidYMid meet" className="w-full h-full block" style={{ background: '#030508' }}>
              {fixtures.map(f => {
                const outline = getDrawableFixtureOutline(f)
                if (outline.length < 3) return null
                const cx = outline.reduce((s, p) => s + p.x, 0) / outline.length
                const cz = outline.reduce((s, p) => s + p.z, 0) / outline.length
                if (!pointInPolygon({ x: cx, z: cz }, zoneVerts)) return null
                return (
                  <path
                    key={f.id}
                    d={polygonPath(outline)}
                    fill="rgba(0,210,255,0.06)"
                    stroke="rgba(0,210,255,0.25)"
                    strokeWidth={0.03}
                  />
                )
              })}

              <path
                d={polygonPath(zoneVerts)}
                fill="rgba(255,40,40,0.08)"
                stroke="rgba(255,70,70,0.85)"
                strokeWidth={0.06}
                strokeDasharray="0.12 0.08"
              />

              {ghostTrails.map(({ key, pts }) => {
                if (pts.length < 2) return null
                return (
                  <polyline
                    key={`g-${key}`}
                    points={pts.map(p => `${p.x},${p.z}`).join(' ')}
                    fill="none"
                    stroke="rgba(96,165,250,0.15)"
                    strokeWidth={0.04}
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
                    strokeWidth={0.08}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {focusTrail.filter((_, i) => i > 0 && i % 4 === 0).map((p, i) => (
                    <circle key={`dw-${i}`} cx={p.x} cy={p.z} r={0.12} fill="rgba(251,191,36,0.35)" stroke="#fbbf24" strokeWidth={0.02} />
                  ))}
                  {(() => {
                    const last = focusTrail[focusTrail.length - 1]
                    const prev = focusTrail[focusTrail.length - 2]
                    const dx = last.x - prev.x
                    const dz = last.z - prev.z
                    const len = Math.hypot(dx, dz) || 1
                    const ax = last.x + (dx / len) * 0.25
                    const az = last.z + (dz / len) * 0.25
                    return (
                      <>
                        <circle cx={last.x} cy={last.z} r={0.14} fill="#f87171" stroke="#fff" strokeWidth={0.03} />
                        <line x1={last.x} y1={last.z} x2={ax} y2={az} stroke="#fca5a5" strokeWidth={0.05} markerEnd="url(#arrow)" />
                      </>
                    )
                  })()}
                </>
              )}
            </svg>
          ) : (
            <div className="flex items-center justify-center h-full text-xs text-gray-600">Zone geometry loading…</div>
          )}
        </div>

        <div className="w-[280px] shrink-0 border-l border-gray-800/80 px-3 py-2 flex flex-col justify-center">
          <p className="text-[11px] text-gray-300 leading-relaxed">{annotation}</p>
          {focusAxes && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                ['Engage', focusAxes.engagement_with_POI, '#14b8a6'],
                ['Avoid', focusAxes.avoidance, '#6b7280'],
                ['Commit', focusAxes.commitment, '#10b981'],
                ['Hesitate', focusAxes.hesitation, '#f59e0b'],
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
        </div>
      </div>
    </div>
  )
}
