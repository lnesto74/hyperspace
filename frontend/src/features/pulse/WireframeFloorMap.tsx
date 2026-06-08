import { useEffect, useMemo, useRef, useState } from 'react'
import { useTracking } from '../../context/TrackingContext'
import {
  getDrawableFixtureOutline,
  polygonPath,
  venueObjectsToFixtures,
} from '../../utils/venueFloorPlanMap'
import { pointInPolygon, useZoneMapData } from '../profitRadar/hooks/useZoneMapData'

export interface WireframeFloorMapProps {
  venueId: string
  focusRoiId?: string | null
  className?: string
  style?: React.CSSProperties
  dimOutside?: boolean
  maxDots?: number
  trailMaxLen?: number
  focusTrackKey?: string | null
  onTrackSelect?: (trackKey: string | null) => void
}

/**
 * Monochrome wireframe floor — shared by Event Replay (Profit Radar) and Pulse.
 */
export default function WireframeFloorMap({
  venueId,
  focusRoiId = null,
  className = '',
  style,
  dimOutside = false,
  maxDots = 80,
  trailMaxLen = 12,
  focusTrackKey = null,
  onTrackSelect,
}: WireframeFloorMapProps) {
  const { tracks } = useTracking()
  const { objects, regions, zoneVerts, viewBox } = useZoneMapData(venueId, focusRoiId)

  const trailsRef = useRef<Map<string, { x: number; z: number }[]>>(new Map())
  const pulseRef = useRef(0)
  const [, forceTick] = useState(0)

  useEffect(() => {
    let raf = 0
    const tick = (ts: number) => {
      pulseRef.current = (ts % 2000) / 2000
      forceTick(f => (f + 1) % 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const m = trailsRef.current
    const seen = new Set<string>()
    tracks.forEach(t => {
      const p = t.venuePosition ?? t.position
      if (!p) return
      seen.add(t.trackKey)
      const arr = m.get(t.trackKey) ?? []
      const last = arr[arr.length - 1]
      if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 0.04) {
        arr.push({ x: p.x, z: p.z })
        if (arr.length > trailMaxLen) arr.shift()
        m.set(t.trackKey, arr)
      }
    })
    for (const k of Array.from(m.keys())) if (!seen.has(k)) m.delete(k)
  }, [tracks, trailMaxLen])

  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])
  const pulseWave = 0.5 + 0.5 * Math.sin(pulseRef.current * Math.PI * 2)

  const livePoints = useMemo(() => {
    const pts: { key: string; x: number; z: number; inZone: boolean }[] = []
    tracks.forEach(t => {
      const p = t.venuePosition ?? t.position
      if (!p) return
      const inZone = zoneVerts.length >= 3 && pointInPolygon({ x: p.x, z: p.z }, zoneVerts)
      pts.push({ key: t.trackKey, x: p.x, z: p.z, inZone })
    })
    pts.sort((a, b) => {
      if (a.inZone !== b.inZone) return a.inZone ? -1 : 1
      if (a.key === focusTrackKey) return -1
      if (b.key === focusTrackKey) return 1
      return 0
    })
    return pts.slice(0, maxDots)
  }, [tracks, zoneVerts, focusTrackKey, maxDots])

  const visibleKeys = useMemo(() => new Set(livePoints.map(p => p.key)), [livePoints])

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className={`w-full h-full block ${className}`}
      style={{ background: '#050810', ...style }}
    >
      {fixtures.map(f => {
        const outline = getDrawableFixtureOutline(f)
        if (outline.length < 3) return null
        return (
          <path
            key={f.id}
            d={polygonPath(outline)}
            fill={dimOutside ? 'rgba(0,210,255,0.02)' : 'rgba(0,210,255,0.04)'}
            stroke={dimOutside ? 'rgba(0,210,255,0.12)' : 'rgba(0,210,255,0.22)'}
            strokeWidth={0.04}
            strokeLinejoin="round"
          />
        )
      })}

      {regions.map(r => {
        if (r.id === focusRoiId) return null
        return (
          <path
            key={r.id}
            d={polygonPath(r.vertices)}
            fill={dimOutside ? 'rgba(15,23,42,0.6)' : 'rgba(148,163,184,0.05)'}
            stroke={dimOutside ? 'rgba(55,65,81,0.25)' : 'rgba(75,85,99,0.4)'}
            strokeWidth={0.03}
          />
        )
      })}

      {zoneVerts.length >= 3 && (
        <path
          d={polygonPath(zoneVerts)}
          fill={`rgba(255,40,40,${0.12 + pulseWave * 0.22})`}
          stroke={`rgba(255,70,70,${0.65 + pulseWave * 0.35})`}
          strokeWidth={0.08 + pulseWave * 0.04}
          strokeLinejoin="round"
        />
      )}

      {Array.from(trailsRef.current.entries()).map(([key, pts]) => {
        if (!visibleKeys.has(key) || pts.length < 2) return null
        const focused = key === focusTrackKey
        const inZone = livePoints.find(p => p.key === key)?.inZone
        return (
          <polyline
            key={`tr-${key}`}
            points={pts.map(p => `${p.x},${p.z}`).join(' ')}
            fill="none"
            stroke={focused ? 'rgba(248,113,113,0.85)' : inZone ? 'rgba(248,113,113,0.45)' : 'rgba(96,165,250,0.35)'}
            strokeWidth={focused ? 0.08 : 0.05}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )
      })}

      {livePoints.map(p => {
        const focused = p.key === focusTrackKey
        const r = focused ? 0.26 : p.inZone ? 0.2 : 0.15
        return (
          <circle
            key={`dot-${p.key}`}
            cx={p.x}
            cy={p.z}
            r={r}
            fill={focused ? '#fff' : p.inZone ? '#f87171' : '#60a5fa'}
            stroke={focused ? '#f87171' : 'rgba(0,0,0,0.4)'}
            strokeWidth={focused ? 0.06 : 0.03}
            style={{ cursor: onTrackSelect ? 'pointer' : undefined }}
            onClick={onTrackSelect ? () => onTrackSelect(focused ? null : p.key) : undefined}
          />
        )
      })}
    </svg>
  )
}
