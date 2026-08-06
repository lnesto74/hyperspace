import { API_BASE } from '../../../config/api'
import { useState, useEffect, useMemo, useRef } from 'react'
import { MonitorPlay } from 'lucide-react'
import { useVenue } from '../../../context/VenueContext'
import type { VenueObject } from '../../../types'
import FloorPlanMiniMap, { type DoohScreenMarker } from '../../../components/shared/FloorPlanMiniMap'
import { type MapRegion } from '../../../utils/venueFloorPlanMap'

export interface CampaignPerformanceItem {
  id: string
  name: string
  ces: number
  eal: number
  aar: number
  exposures: number
  confidence: number
  screenIds?: string[]
}

type CampaignTab = 'topPerformers' | 'underperforming'

interface PebleEffectivenessViewportProps {
  venueId: string
  topCampaigns: CampaignPerformanceItem[]
  underperformingCampaigns: CampaignPerformanceItem[]
  doohScreens: DoohScreenMarker[]
  dataWindowStartTs?: number
  dataWindowEndTs?: number
}

function formatWindow(start?: number, end?: number) {
  if (!start || !end) return null
  const fmt = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(start)} – ${fmt(end)}`
}

export default function PebleEffectivenessViewport({
  venueId,
  topCampaigns,
  underperformingCampaigns,
  doohScreens,
  dataWindowStartTs,
  dataWindowEndTs,
}: PebleEffectivenessViewportProps) {
  const { objects: contextObjects, venue: contextVenue } = useVenue()
  const pulseRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [, setPulseTick] = useState(0)

  const [tab, setTab] = useState<CampaignTab>(
    topCampaigns.length > 0 ? 'topPerformers' : 'underperforming',
  )
  const [mapObjects, setMapObjects] = useState<VenueObject[]>([])
  const [venueSize, setVenueSize] = useState<{ width: number; depth: number } | null>(null)
  const [hoveredCampaignId, setHoveredCampaignId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (topCampaigns.length > 0) setTab('topPerformers')
    else if (underperformingCampaigns.length > 0) setTab('underperforming')
  }, [topCampaigns.length, underperformingCampaigns.length])

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
      } catch (err) {
        console.error('Failed to load PEBLE map layout:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    loadLayout()
    return () => { cancelled = true }
  }, [venueId, contextVenue?.id, contextVenue?.width, contextVenue?.depth, contextObjects.length])

  const activeCampaigns = tab === 'topPerformers' ? topCampaigns : underperformingCampaigns
  const isUnder = tab === 'underperforming'

  const campaignScreenIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of activeCampaigns) {
      for (const sid of c.screenIds || []) ids.add(sid)
    }
    return ids
  }, [activeCampaigns])

  const hoveredScreenIds = useMemo(() => {
    if (!hoveredCampaignId) return campaignScreenIds
    const campaign = activeCampaigns.find(c => c.id === hoveredCampaignId)
    return new Set(campaign?.screenIds || [])
  }, [hoveredCampaignId, activeCampaigns, campaignScreenIds])

  const hasMapData = mapObjects.length > 0 || doohScreens.length > 0
  const mapHeight = typeof window !== 'undefined' && window.innerWidth >= 1280 ? 440 : 360
  const windowLabel = formatWindow(dataWindowStartTs, dataWindowEndTs)

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
      <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
        Loading screen map…
      </div>
    )
  }

  if (!hasMapData && activeCampaigns.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
        No DOOH screens or campaign data for this venue.
      </div>
    )
  }

  const emptyRegions: MapRegion[] = []

  return (
    <div className="bg-gray-900/80 rounded-lg border border-gray-700/80 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-gray-700/60">
        <div className="flex items-center gap-2 min-w-0">
          <MonitorPlay className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <div className="min-w-0">
            <span className="text-xs font-medium text-gray-300">Screen & Campaign Map</span>
            {windowLabel && (
              <p className="text-xs text-gray-400 truncate">Data window: {windowLabel}</p>
            )}
          </div>
        </div>
        <div className="flex bg-gray-800 rounded-md p-0.5 border border-gray-700">
          <button
            type="button"
            onClick={() => setTab('topPerformers')}
            disabled={topCampaigns.length === 0}
            className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
              !isUnder
                ? 'bg-green-500/20 text-green-300 border border-green-500/40'
                : 'text-gray-400 hover:text-gray-300 disabled:opacity-40'
            }`}
          >
            Top campaigns ({topCampaigns.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('underperforming')}
            disabled={underperformingCampaigns.length === 0}
            className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
              isUnder
                ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                : 'text-gray-400 hover:text-gray-300 disabled:opacity-40'
            }`}
          >
            Needs attention ({underperformingCampaigns.length})
          </button>
        </div>
        <span className="text-xs text-gray-400 w-full sm:w-auto text-right">
          {doohScreens.length} screens · {activeCampaigns.length} campaigns
        </span>
      </div>

      <div className="flex flex-col xl:flex-row">
        <div className="flex-1 min-w-0 p-2">
          {hasMapData ? (
            <>
              <div
                className="rounded-md border overflow-hidden"
                style={{ background: '#050810', borderColor: 'rgba(255,255,255,0.06)' }}
              >
                <FloorPlanMiniMap
                  objects={mapObjects}
                  regions={emptyRegions}
                  venueSize={venueSize ?? undefined}
                  mode="doohScreens"
                  doohScreens={doohScreens}
                  highlightIds={hoveredScreenIds}
                  doohPulseColor={isUnder ? 'red' : 'green'}
                  hoveredZoneId={null}
                  pulse={pulseRef.current}
                  height={mapHeight}
                />
              </div>
              <div className="flex items-center gap-3 mt-2 px-1 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 border border-cyan-400/50 bg-cyan-400/10 rounded-sm" />
                  DWG fixtures
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 border border-purple-500/50 bg-purple-500/20 rounded-sm" />
                  DOOH screen (SEZ)
                </span>
                <span className="flex items-center gap-1">
                  <span
                    className={`w-2.5 h-2.5 rounded-sm border ${
                      isUnder
                        ? 'border-red-500 bg-red-500/30 animate-pulse'
                        : 'border-green-500 bg-green-500/30 animate-pulse'
                    }`}
                  />
                  {isUnder ? 'Underperforming' : 'Top'} campaign screens
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-40 text-gray-400 text-xs rounded-md border border-gray-700/60">
              No screen positions configured — campaign list still available →
            </div>
          )}
        </div>

        <div className="xl:w-80 shrink-0 border-t xl:border-t-0 xl:border-l border-gray-700/60 p-2">
          <h4 className="text-[11px] font-medium text-gray-400 mb-2 px-1">
            {isUnder ? `Needs Attention (${underperformingCampaigns.length})` : `Top Campaigns (${topCampaigns.length})`}
          </h4>
          <div className="space-y-1 max-h-[280px] xl:max-h-[460px] overflow-y-auto">
            {activeCampaigns.map(campaign => {
              const hovered = hoveredCampaignId === campaign.id
              const hot = isUnder
                ? hovered
                  ? 'bg-red-500/20 border-red-500/50 text-red-300'
                  : 'bg-gray-800/60 border-transparent text-gray-300 hover:bg-gray-800'
                : hovered
                  ? 'bg-green-500/20 border-green-500/50 text-green-300'
                  : 'bg-gray-800/60 border-transparent text-gray-300 hover:bg-gray-800'
              const primaryScore = campaign.ces > 0 ? campaign.ces : campaign.eal
              const scoreLabel = campaign.ces > 0 ? 'CES' : 'EAL'
              return (
                <div
                  key={campaign.id}
                  onMouseEnter={() => setHoveredCampaignId(campaign.id)}
                  onMouseLeave={() => setHoveredCampaignId(null)}
                  className={`px-2.5 py-2 rounded-md cursor-pointer transition-all text-xs border ${hot}`}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate leading-snug font-medium">{campaign.name}</div>
                      <div className="flex flex-wrap gap-1.5 mt-1 text-xs text-gray-400">
                        <span>{scoreLabel} {primaryScore.toFixed(1)}{scoreLabel === 'EAL' ? '%' : ''}</span>
                        <span>·</span>
                        <span>{campaign.exposures.toLocaleString()} exp</span>
                        <span>·</span>
                        <span>{campaign.confidence.toFixed(0)}% conf</span>
                      </div>
                    </div>
                    <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                      AAR {campaign.aar.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )
            })}
            {activeCampaigns.length === 0 && (
              <p className="text-gray-400 text-xs px-1">
                {isUnder ? 'No underperforming campaigns in this period.' : 'No top campaigns in this period.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
