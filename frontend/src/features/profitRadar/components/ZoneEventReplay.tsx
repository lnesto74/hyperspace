import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2, Radio, Users } from 'lucide-react'
import { useVenue } from '../../../context/VenueContext'
import { useTracking } from '../../../context/TrackingContext'
import { API_BASE } from '../../../config/api'
import {
  boundsToViewBox,
  computeFloorPlanBounds,
  getDrawableFixtureOutline,
  normalizeFloorVertex,
  polygonPath,
  venueObjectsToFixtures,
  type MapRegion,
} from '../../../utils/venueFloorPlanMap'
import type { VenueObject } from '../../../types'

interface RoiShape {
  id: string
  name: string
  vertices: { x: number; z?: number; y?: number }[]
}

interface ZoneEventReplayProps {
  venueId: string
  roiId: string | null
  zoneName: string
}

function pointInPolygon(p: { x: number; z: number }, verts: { x: number; z: number }[]): boolean {
  let inside = false
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[i]
    const b = verts[j]
    if (((a.z > p.z) !== (b.z > p.z)) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Focused live/replay view of the insight's zone. Reuses the shared floor-plan
 * geometry utils and the real tracking stream (live, or the recorded MQTT
 * replay when active) — so it shows the actual shoppers moving through the zone.
 */
export default function ZoneEventReplay({ venueId, roiId, zoneName }: ZoneEventReplayProps) {
  const { objects: ctxObjects, venue: ctxVenue } = useVenue()
  const { tracks, mqttReplayActive, storyReplayActive } = useTracking()

  const [rois, setRois] = useState<RoiShape[]>([])
  const [objects, setObjects] = useState<VenueObject[]>([])
  const [venueSize, setVenueSize] = useState<{ width: number; depth: number } | null>(null)
  const [expanded, setExpanded] = useState(false)

  const trailsRef = useRef<Map<string, { x: number; z: number }[]>>(new Map())
  const pulseRef = useRef(0)
  const [, forceTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (ctxVenue?.id === venueId && ctxObjects.length > 0) {
        setObjects(ctxObjects)
        setVenueSize({ width: ctxVenue.width, depth: ctxVenue.depth })
      } else {
        try {
          const res = await fetch(`${API_BASE}/api/venues/${venueId}`)
          if (res.ok) {
            const data = await res.json()
            if (cancelled) return
            setObjects(data.objects || [])
            if (data.venue) setVenueSize({ width: data.venue.width, depth: data.venue.depth })
          }
        } catch { /* ignore */ }
      }
      try {
        const roiRes = await fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`)
        if (roiRes.ok) {
          const data = await roiRes.json()
          if (!cancelled) setRois(data || [])
        }
      } catch { /* ignore */ }
    }
    load()
    return () => { cancelled = true }
  }, [venueId, ctxVenue?.id, ctxVenue?.width, ctxVenue?.depth, ctxObjects.length])

  // Pulse + redraw loop.
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

  // Accumulate short movement trails from the live/replay track stream.
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
        if (arr.length > 12) arr.shift()
        m.set(t.trackKey, arr)
      }
    })
    for (const k of Array.from(m.keys())) if (!seen.has(k)) m.delete(k)
  }, [tracks])

  const regions: MapRegion[] = useMemo(
    () => rois.map(r => ({ id: r.id, vertices: r.vertices.map(normalizeFloorVertex) })),
    [rois],
  )
  const zoneVerts = useMemo(() => {
    const z = rois.find(r => r.id === roiId)
    return z ? z.vertices.map(normalizeFloorVertex) : []
  }, [rois, roiId])

  const bounds = useMemo(
    () => computeFloorPlanBounds(objects, regions, venueSize ?? undefined),
    [objects, regions, venueSize],
  )
  const viewBox = useMemo(() => boundsToViewBox(bounds), [bounds])
  const fixtures = useMemo(() => venueObjectsToFixtures(objects), [objects])

  const pulseWave = 0.5 + 0.5 * Math.sin(pulseRef.current * Math.PI * 2)
  const isReplay = mqttReplayActive || storyReplayActive

  // Live shoppers + how many are inside the focused zone right now.
  const livePoints: { key: string; x: number; z: number; inZone: boolean }[] = []
  tracks.forEach(t => {
    const p = t.venuePosition ?? t.position
    if (!p) return
    const inZone = zoneVerts.length >= 3 && pointInPolygon({ x: p.x, z: p.z }, zoneVerts)
    livePoints.push({ key: t.trackKey, x: p.x, z: p.z, inZone })
  })
  const inZoneCount = livePoints.filter(p => p.inZone).length

  const mapHeight = expanded ? 560 : 240

  const svg = (
    <svg viewBox={viewBox} preserveAspectRatio="xMidYMid meet" className="w-full block" style={{ height: mapHeight, background: '#050810' }}>
      {fixtures.map(f => {
        const outline = getDrawableFixtureOutline(f)
        if (outline.length < 3) return null
        return (
          <path
            key={f.id}
            d={polygonPath(outline)}
            fill="rgba(0,210,255,0.04)"
            stroke="rgba(0,210,255,0.22)"
            strokeWidth={0.04}
            strokeLinejoin="round"
          />
        )
      })}

      {/* non-focused zones, faint */}
      {regions.map(r => {
        if (r.id === roiId) return null
        return <path key={r.id} d={polygonPath(r.vertices)} fill="rgba(148,163,184,0.05)" stroke="rgba(75,85,99,0.4)" strokeWidth={0.03} />
      })}

      {/* focused zone, pulsing red */}
      {zoneVerts.length >= 3 && (
        <path
          d={polygonPath(zoneVerts)}
          fill={`rgba(255,40,40,${0.12 + pulseWave * 0.18})`}
          stroke={`rgba(255,70,70,${0.65 + pulseWave * 0.35})`}
          strokeWidth={0.08 + pulseWave * 0.04}
          strokeLinejoin="round"
        />
      )}

      {/* movement trails */}
      {Array.from(trailsRef.current.entries()).map(([key, pts]) => {
        if (pts.length < 2) return null
        return (
          <polyline
            key={`tr-${key}`}
            points={pts.map(p => `${p.x},${p.z}`).join(' ')}
            fill="none"
            stroke="rgba(96,165,250,0.4)"
            strokeWidth={0.05}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )
      })}

      {/* live shopper dots */}
      {livePoints.map(p => (
        <circle
          key={`dot-${p.key}`}
          cx={p.x}
          cy={p.z}
          r={p.inZone ? 0.2 : 0.15}
          fill={p.inZone ? '#f87171' : '#60a5fa'}
          stroke="rgba(0,0,0,0.4)"
          strokeWidth={0.03}
        />
      ))}
    </svg>
  )

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
