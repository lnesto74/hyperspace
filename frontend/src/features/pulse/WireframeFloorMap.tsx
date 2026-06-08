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
  valueByRoiId?: Record<string, number>
  className?: string
  style?: React.CSSProperties
  dimOutside?: boolean
  maxDots?: number
  trailMaxLen?: number
  focusTrackKey?: string | null
  onTrackSelect?: (trackKey: string | null) => void
  onZoneClick?: (roiId: string) => void
}

/**
 * Monochrome wireframe floor — shared by Event Replay (Profit Radar) and Pulse.
 */
export default function WireframeFloorMap({
  venueId,
  focusRoiId = null,
  valueByRoiId = {},
  className = '',
  style,
  dimOutside = false,
  maxDots = 80,
  trailMaxLen = 12,
  focusTrackKey = null,
  onTrackSelect,
  onZoneClick,
}: WireframeFloorMapProps) {
  const { tracks } = useTracking()
  const { objects, regions, zoneVerts, viewBox } = useZoneMapData(venueId, focusRoiId)

  const trailsRef = useRef<Map<string, { x: number; z: number }[]>>(new Map())
  const pulseRef = useRef(0)
  const [, forceTick] = useState(0)

  useEffect(() => {
    let raf = 0
    const tick = (ts: number) => {
      pulseRef.current = (ts / 1000) % 1
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

  const flowVectors = useMemo(() => {
    const bins = new Map<string, { x: number; z: number; vx: number; vz: number; n: number }>()
    tracks.forEach(t => {
      const p = t.venuePosition ?? t.position
      const v = t.velocity
      if (!p || !v) return
      const gx = Math.round(p.x * 2) / 2
      const gz = Math.round(p.z * 2) / 2
      const k = `${gx},${gz}`
      const b = bins.get(k) || { x: gx, z: gz, vx: 0, vz: 0, n: 0 }
      b.vx += v.x
      b.vz += v.z
      b.n += 1
      bins.set(k, b)
    })
    return [...bins.values()]
      .filter(b => b.n >= 2 && Math.hypot(b.vx, b.vz) > 0.05)
      .slice(0, 24)
  }, [tracks])

  return (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className={`w-full h-full block ${className}`}
      style={{ background: '#050810', ...style }}
    >
      <defs>
        <pattern id="pulse-hatch" width="0.35" height="0.35" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="0.35" stroke="rgba(34,211,238,0.35)" strokeWidth="0.025" />
        </pattern>
      </defs>

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
        const val = valueByRoiId[r.id] ?? 0
        const isFocus = r.id === focusRoiId
        if (isFocus) return null
        return (
          <g key={r.id}>
            {val > 0.05 && (
              <path
                d={polygonPath(r.vertices)}
                fill="url(#pulse-hatch)"
                opacity={0.15 + val * 0.45}
                stroke="none"
              />
            )}
            <path
              d={polygonPath(r.vertices)}
              fill={dimOutside ? 'rgba(15,23,42,0.6)' : val > 0 ? 'rgba(148,163,184,0.03)' : 'rgba(148,163,184,0.05)'}
              stroke={val > 0 ? `rgba(34,211,238,${0.25 + val * 0.35})` : dimOutside ? 'rgba(55,65,81,0.25)' : 'rgba(75,85,99,0.4)'}
              strokeWidth={val > 0 ? 0.04 : 0.03}
              style={{ cursor: onZoneClick ? 'pointer' : undefined }}
              onClick={onZoneClick ? () => onZoneClick(r.id) : undefined}
            />
          </g>
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

      {flowVectors.map((b, i) => {
        const mag = Math.hypot(b.vx, b.vz)
        const ux = b.vx / mag
        const uz = b.vz / mag
        const len = Math.min(1.2, mag * 0.8)
        return (
          <line
            key={`flow-${i}`}
            x1={b.x}
            y1={b.z}
            x2={b.x + ux * len}
            y2={b.z + uz * len}
            stroke="rgba(34,211,238,0.2)"
            strokeWidth={0.04}
          />
        )
      })}

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
            onClick={onTrackSelect ? (e) => { e.stopPropagation(); onTrackSelect(focused ? null : p.key) } : undefined}
          />
        )
      })}

      {onZoneClick && regions.map(r => (
        <path
          key={`hit-${r.id}`}
          d={polygonPath(r.vertices)}
          fill="transparent"
          stroke="none"
          style={{ cursor: 'pointer' }}
          onClick={() => onZoneClick(r.id)}
        />
      ))}
    </svg>
  )
}
