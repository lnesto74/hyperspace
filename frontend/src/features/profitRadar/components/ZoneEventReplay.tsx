import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2, Radio, Users } from 'lucide-react'
import { useTracking } from '../../../context/TrackingContext'
import {
  getDrawableFixtureOutline,
  polygonPath,
  venueObjectsToFixtures,
} from '../../../utils/venueFloorPlanMap'
import { pointInPolygon, useZoneMapData } from '../hooks/useZoneMapData'

interface ZoneEventReplayProps {
  venueId: string
  roiId: string | null
  zoneName: string
  variant?: 'card' | 'stage'
  dimOutside?: boolean
  focusTrackKey?: string | null
  onTrackSelect?: (trackKey: string | null) => void
}

/**
 * Focused live/replay view of the insight's zone. Reuses the shared floor-plan
 * geometry utils and the real tracking stream (live, or the recorded MQTT
 * replay when active) — so it shows the actual shoppers moving through the zone.
 */
export default function ZoneEventReplay({
  venueId,
  roiId,
  zoneName,
  variant = 'card',
  dimOutside = false,
  focusTrackKey = null,
  onTrackSelect,
}: ZoneEventReplayProps) {
  const { tracks, mqttReplayActive, storyReplayActive } = useTracking()
  const { objects, regions, zoneVerts, viewBox } = useZoneMapData(venueId, roiId)

  const [expanded, setExpanded] = useState(false)
  const trailsRef = useRef<Map<string, { x: number; z: number }[]>>(new Map())
  const pulseRef = useRef(0)
  const [, forceTick] = useState(0)

  const isStage = variant === 'stage'

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
        const maxLen = isStage ? 24 : 12
        if (arr.length > maxLen) arr.shift()
        m.set(t.trackKey, arr)
      }
    })
    for (const k of Array.from(m.keys())) if (!seen.has(k)) m.delete(k)
  }, [tracks, isStage])

  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])
  const pulseWave = 0.5 + 0.5 * Math.sin(pulseRef.current * Math.PI * 2)
  const isReplay = mqttReplayActive || storyReplayActive

  const livePoints: { key: string; x: number; z: number; inZone: boolean }[] = []
  tracks.forEach(t => {
    const p = t.venuePosition ?? t.position
    if (!p) return
    const inZone = zoneVerts.length >= 3 && pointInPolygon({ x: p.x, z: p.z }, zoneVerts)
    livePoints.push({ key: t.trackKey, x: p.x, z: p.z, inZone })
  })
  const inZoneCount = livePoints.filter(p => p.inZone).length

  const mapHeight = isStage ? undefined : (expanded ? 560 : 240)

  const svg = (
    <svg
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      className={`w-full block ${isStage ? 'h-full flex-1' : ''}`}
      style={isStage ? { background: '#050810', minHeight: 0 } : { height: mapHeight, background: '#050810' }}
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
        if (r.id === roiId) return null
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
        if (pts.length < 2) return null
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

  if (isStage) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800/80 bg-gray-900/50 shrink-0">
          <div className="flex items-center gap-2">
            <Radio className={`w-3.5 h-3.5 ${isReplay ? 'text-amber-400' : 'text-green-400'}`} />
            <div>
              <span className="text-xs font-medium text-gray-200">Event Replay</span>
              <p className="text-[10px] text-gray-500">{zoneName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400 hidden md:inline">
              Click a dot to focus trajectory
            </span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${isReplay ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/15 text-green-300'}`}>
              {isReplay ? '● REPLAY' : '● LIVE'}
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-300">
              <Users className="w-3 h-3" /> {inZoneCount} in zone
            </span>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">{svg}</div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/60 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/60">
        <div className="flex items-center gap-2">
          <Radio className={`w-3.5 h-3.5 ${isReplay ? 'text-amber-400' : 'text-green-400'}`} />
          <div>
            <span className="text-xs font-medium text-gray-200">Event Replay</span>
            <p className="text-[10px] text-gray-500">{zoneName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${isReplay ? 'bg-amber-500/15 text-amber-300' : 'bg-green-500/15 text-green-300'}`}>
            {isReplay ? '● REPLAY' : '● LIVE'}
          </span>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-700/50"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className="rounded-b-md overflow-hidden">{svg}</div>

      <div className="flex items-center gap-3 px-3 py-2 text-[10px] text-gray-500 border-t border-gray-700/60">
        <span className="flex items-center gap-1 text-gray-300">
          <Users className="w-3 h-3" /> {inZoneCount} in zone
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-400" /> in zone
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-blue-400" /> elsewhere
        </span>
        <span className="ml-auto">{livePoints.length} shoppers tracked</span>
      </div>
    </div>
  )
}
