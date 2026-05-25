import { API_BASE } from '../../../config/api'
import { useState, useEffect, useMemo, useRef } from 'react'
import { MapPin } from 'lucide-react'
import { useVenue } from '../../../context/VenueContext'
import { ROI_CATEGORY_COLOR } from '../../../utils/roiCategoryUtils'
import type { VenueObject } from '../../../types'
import FloorPlanMiniMap from '../../../components/shared/FloorPlanMiniMap'
import { normalizeFloorVertex, type MapRegion } from '../../../utils/venueFloorPlanMap'

interface DeadZone {
  id: string
  name: string
  utilization: number
  category?: string | null
}

interface ROI {
  id: string
  name: string
  vertices: { x: number; z?: number; y?: number }[]
  color: string
}

interface DeadZonesViewportProps {
  venueId: string
  deadZones: DeadZone[]
}

export default function DeadZonesViewport({ venueId, deadZones }: DeadZonesViewportProps) {
  const { objects: contextObjects, venue: contextVenue } = useVenue()
  const pulseRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [, setPulseTick] = useState(0)

  const [allRois, setAllRois] = useState<ROI[]>([])
  const [mapObjects, setMapObjects] = useState<VenueObject[]>([])
  const [venueSize, setVenueSize] = useState<{ width: number; depth: number } | null>(null)
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const loadLayout = async () => {
      setLoading(true)
      try {
        if (contextVenue?.id === venueId && contextObjects.length > 0) {
          if (!cancelled) {
            setMapObjects(contextObjects)
            setVenueSize({ width: contextVenue.width, depth: contextVenue.depth })
          }
        } else {
          const res = await fetch(`${API_BASE}/api/venues/${venueId}`)
          if (res.ok) {
            const data = await res.json()
            if (!cancelled) {
              setMapObjects(data.objects || [])
              if (data.venue) {
                setVenueSize({ width: data.venue.width, depth: data.venue.depth })
              }
            }
          }
        }

        const roiRes = await fetch(`${API_BASE}/api/venues/${venueId}/roi?all=true`)
        if (roiRes.ok) {
          const roiData = await roiRes.json()
          if (!cancelled) setAllRois(roiData)
        }
      } catch (err) {
        console.error('Failed to load dead zone map layout:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadLayout()
    return () => { cancelled = true }
  }, [venueId, contextVenue?.id, contextVenue?.width, contextVenue?.depth, contextObjects.length])

  const mapRegions: MapRegion[] = useMemo(
    () => allRois.map(r => ({
      id: r.id,
      vertices: r.vertices.map(normalizeFloorVertex),
    })),
    [allRois],
  )

  const deadZoneIds = useMemo(() => new Set(deadZones.map(z => z.id)), [deadZones])
  const hasMapData = mapObjects.length > 0 || mapRegions.length > 0

  useEffect(() => {
    if (!hasMapData) return
    const tick = (ts: number) => {
      pulseRef.current = (ts % 2000) / 2000
      setPulseTick(t => t + 1)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [hasMapData])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        Loading zones...
      </div>
    )
  }

  if (!hasMapData) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        No venue layout available
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="bg-gray-900 rounded-lg border border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-medium text-gray-400 flex items-center gap-2">
            <MapPin className="w-3 h-3" />
            Store Layout — Dead Zones Highlighted
          </h4>
          <span className="text-[8px] text-gray-500">
            {mapObjects.length} fixtures · {mapRegions.length} zones
          </span>
        </div>
        <div
          className="rounded-md border overflow-hidden"
          style={{ background: '#050810', borderColor: 'rgba(255,255,255,0.06)' }}
        >
          <FloorPlanMiniMap
            objects={mapObjects}
            regions={mapRegions}
            venueSize={venueSize ?? undefined}
            mode="deadZones"
            deadZoneIds={deadZoneIds}
            hoveredZoneId={hoveredZoneId}
            pulse={pulseRef.current}
            height={320}
          />
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-cyan-400/10 border border-cyan-400/40 rounded-sm" />
            DWG fixtures
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500/30 border border-red-500 rounded-sm animate-pulse" />
            Dead zone (pulsing)
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-green-500/15 border border-gray-600 rounded-sm" />
            Active zone
          </div>
        </div>
      </div>

      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
        <h4 className="text-xs font-medium text-gray-400 mb-3">
          Dead Zones ({deadZones.length})
        </h4>
        <div className="space-y-1 max-h-64 overflow-y-auto">
          {deadZones.map((zone) => (
            <div
              key={zone.id}
              onMouseEnter={() => setHoveredZoneId(zone.id)}
              onMouseLeave={() => setHoveredZoneId(null)}
              className={`px-3 py-2 rounded-lg cursor-pointer transition-all text-sm ${
                hoveredZoneId === zone.id
                  ? 'bg-red-500/20 border border-red-500/50 text-red-300'
                  : 'bg-gray-700/50 border border-transparent text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{zone.name}</div>
                  {zone.category && (
                    <div className="mt-1">
                      <span
                        className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold truncate max-w-full"
                        style={{
                          color: ROI_CATEGORY_COLOR,
                          backgroundColor: `${ROI_CATEGORY_COLOR}18`,
                          border: `1px solid ${ROI_CATEGORY_COLOR}44`,
                        }}
                      >
                        {zone.category}
                      </span>
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-500 shrink-0">{zone.utilization}%</span>
              </div>
            </div>
          ))}
          {deadZones.length === 0 && (
            <p className="text-gray-500 text-sm">No dead zones detected!</p>
          )}
        </div>
      </div>
    </div>
  )
}
