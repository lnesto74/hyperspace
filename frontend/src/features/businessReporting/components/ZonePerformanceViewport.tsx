import { API_BASE } from '../../../config/api'
import { useState, useEffect, useMemo, useRef } from 'react'
import { MapPin } from 'lucide-react'
import { useVenue } from '../../../context/VenueContext'
import { ROI_CATEGORY_COLOR } from '../../../utils/roiCategoryUtils'
import type { VenueObject } from '../../../types'
import FloorPlanMiniMap from '../../../components/shared/FloorPlanMiniMap'
import { normalizeFloorVertex, type MapRegion } from '../../../utils/venueFloorPlanMap'

export interface ZonePerformanceItem {
  id: string
  name: string
  utilization: number
  category?: string | null
}

type ZoneTab = 'underperforming' | 'topPerformers'

interface ROI {
  id: string
  name: string
  vertices: { x: number; z?: number; y?: number }[]
  color: string
}

interface ZonePerformanceViewportProps {
  venueId: string
  deadZones: ZonePerformanceItem[]
  topZones: ZonePerformanceItem[]
}

export default function ZonePerformanceViewport({
  venueId,
  deadZones,
  topZones,
}: ZonePerformanceViewportProps) {
  const { objects: contextObjects, venue: contextVenue } = useVenue()
  const pulseRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [, setPulseTick] = useState(0)

  const [tab, setTab] = useState<ZoneTab>(
    deadZones.length > 0 ? 'underperforming' : 'topPerformers',
  )
  const [allRois, setAllRois] = useState<ROI[]>([])
  const [mapObjects, setMapObjects] = useState<VenueObject[]>([])
  const [venueSize, setVenueSize] = useState<{ width: number; depth: number } | null>(null)
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (deadZones.length > 0) setTab('underperforming')
    else if (topZones.length > 0) setTab('topPerformers')
  }, [deadZones.length, topZones.length])

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
        console.error('Failed to load zone performance map:', err)
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

  const activeZones = tab === 'underperforming' ? deadZones : topZones
  const highlightIds = useMemo(() => new Set(activeZones.map(z => z.id)), [activeZones])
  const hasMapData = mapObjects.length > 0 || mapRegions.length > 0
  const mapHeight = typeof window !== 'undefined' && window.innerWidth >= 1280 ? 440 : 360

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
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        Loading zone map…
      </div>
    )
  }

  if (!hasMapData) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        No venue layout available
      </div>
    )
  }

  const isUnder = tab === 'underperforming'

  return (
    <div className="bg-gray-900/80 rounded-lg border border-gray-700/80 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-gray-700/60">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs font-medium text-gray-300">Zone Performance Map</span>
        </div>
        <div className="flex bg-gray-800 rounded-md p-0.5 border border-gray-700">
          <button
            type="button"
            onClick={() => setTab('underperforming')}
            disabled={deadZones.length === 0}
            className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
              isUnder
                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                : 'text-gray-500 hover:text-gray-300 disabled:opacity-40'
            }`}
          >
            Underperforming ({deadZones.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('topPerformers')}
            disabled={topZones.length === 0}
            className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
              !isUnder
                ? 'bg-green-500/20 text-green-300 border border-green-500/40'
                : 'text-gray-500 hover:text-gray-300 disabled:opacity-40'
            }`}
          >
            Top performers ({topZones.length})
          </button>
        </div>
        <span className="text-[10px] text-gray-500 w-full sm:w-auto text-right">
          {mapObjects.length} fixtures · {mapRegions.length} zones
        </span>
      </div>

      <div className="flex flex-col xl:flex-row">
        <div className="flex-1 min-w-0 p-2">
          <div
            className="rounded-md border overflow-hidden"
            style={{ background: '#050810', borderColor: 'rgba(255,255,255,0.06)' }}
          >
            <FloorPlanMiniMap
              objects={mapObjects}
              regions={mapRegions}
              venueSize={venueSize ?? undefined}
              mode={isUnder ? 'deadZones' : 'topPerformers'}
              deadZoneIds={isUnder ? highlightIds : new Set()}
              topPerformerIds={!isUnder ? highlightIds : new Set()}
              hoveredZoneId={hoveredZoneId}
              pulse={pulseRef.current}
              height={mapHeight}
            />
          </div>
          <div className="flex items-center gap-3 mt-2 px-1 text-[10px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 border border-cyan-400/50 bg-cyan-400/10 rounded-sm" />
              DWG fixtures
            </span>
            <span className="flex items-center gap-1">
              <span
                className={`w-2.5 h-2.5 rounded-sm border ${
                  isUnder
                    ? 'border-red-500 bg-red-500/30 animate-pulse'
                    : 'border-green-500 bg-green-500/30 animate-pulse'
                }`}
              />
              {isUnder ? 'Dead zone' : 'Top zone'} (pulsing)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 border border-gray-600 bg-gray-700/30 rounded-sm" />
              Other zones
            </span>
          </div>
        </div>

        <div className="xl:w-72 shrink-0 border-t xl:border-t-0 xl:border-l border-gray-700/60 p-2">
          <h4 className="text-[11px] font-medium text-gray-400 mb-2 px-1">
            {isUnder ? `Dead Zones (${deadZones.length})` : `Best Zones (${topZones.length})`}
          </h4>
          <div className="space-y-1 max-h-[280px] xl:max-h-[460px] overflow-y-auto">
            {activeZones.map(zone => {
              const hovered = hoveredZoneId === zone.id
              const hot = isUnder
                ? hovered
                  ? 'bg-red-500/20 border-red-500/50 text-red-300'
                  : 'bg-gray-800/60 border-transparent text-gray-300 hover:bg-gray-800'
                : hovered
                  ? 'bg-green-500/20 border-green-500/50 text-green-300'
                  : 'bg-gray-800/60 border-transparent text-gray-300 hover:bg-gray-800'
              return (
                <div
                  key={zone.id}
                  onMouseEnter={() => setHoveredZoneId(zone.id)}
                  onMouseLeave={() => setHoveredZoneId(null)}
                  className={`px-2.5 py-1.5 rounded-md cursor-pointer transition-all text-xs border ${hot}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate leading-snug">{zone.name}</div>
                      {zone.category && (
                        <span
                          className="inline-block mt-0.5 rounded-full px-1.5 py-px text-[9px] font-semibold truncate max-w-full"
                          style={{
                            color: ROI_CATEGORY_COLOR,
                            backgroundColor: `${ROI_CATEGORY_COLOR}18`,
                            border: `1px solid ${ROI_CATEGORY_COLOR}44`,
                          }}
                        >
                          {zone.category}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-500 shrink-0 tabular-nums">{zone.utilization}%</span>
                  </div>
                </div>
              )
            })}
            {activeZones.length === 0 && (
              <p className="text-gray-500 text-xs px-1">
                {isUnder ? 'No underperforming zones in this period.' : 'No top performers in this period.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
