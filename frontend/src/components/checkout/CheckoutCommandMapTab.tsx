import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Expand,
  Lightbulb,
  Loader2,
  MapPin,
  Minimize2,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  WifiOff,
} from 'lucide-react'
import { API_BASE } from '../../config/api'
import { useVenue } from '../../context/VenueContext'
import FloorPlanMiniMap, { type CheckoutLaneRender } from '../shared/FloorPlanMiniMap'
import { computeFloorPlanBounds, type MapRegion } from '../../utils/venueFloorPlanMap'
import {
  computeCheckoutFocusBounds,
  getLaneHealth,
  layoutQueuePersonDots,
  parseCheckoutRegions,
  regionCentroid,
  type CheckoutRoiRegion,
} from './checkoutMapUtils'
import type { VenueObject } from '../../types'

interface QueuedPerson {
  id: string
  waitTimeSec: number
}

interface LaneStatus {
  laneId: number
  name?: string
  queueZoneId?: string
  desiredState: 'open' | 'closed'
  status: 'OPEN' | 'CLOSED' | 'OPENING' | 'CLOSING'
  queueCount: number
  queuedPeople?: QueuedPerson[]
  avgWaitTimeSec?: number
}

interface QueuePressure {
  totalQueueCount: number
  openLaneCount: number
  closedLaneCount: number
  avgQueuePerLane: number
  shouldOpenMore: boolean
  suggestedLaneToOpen: number | null
}

interface CheckoutStatus {
  lanes: LaneStatus[]
  pressure: QueuePressure
}

interface ThresholdSettings {
  waitTimeWarningMin: number
  waitTimeCriticalMin: number
  queueLengthWarning: number
  queueLengthCritical: number
}

interface ActiveSession {
  personId: string
  queueZoneId: string
  laneNumber: number | null
  inService: boolean
}

interface CheckoutAlert {
  id: string
  laneId?: number
  severity: 'warning' | 'critical'
  message: string
  acknowledged: boolean
  dismissed: boolean
}

interface KpiPerLane {
  laneId: string
  sessions: number
  avgWaitSec: number
}

interface CheckoutCommandMapTabProps {
  venueId: string
  status: CheckoutStatus | null
  thresholds: ThresholdSettings
  loading: boolean
  error: string | null
  activeAlerts: CheckoutAlert[]
  onRefresh: () => void
  onSetLaneState: (laneId: number, state: 'open' | 'closed') => void
}

export default function CheckoutCommandMapTab({
  venueId,
  status,
  thresholds,
  loading,
  error,
  activeAlerts,
  onRefresh,
  onSetLaneState,
}: CheckoutCommandMapTabProps) {
  const { venue, objects: contextObjects } = useVenue()
  const pulseRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const [, setPulseTick] = useState(0)

  const [mapObjects, setMapObjects] = useState<VenueObject[]>([])
  const [venueSize, setVenueSize] = useState<{ width: number; depth: number } | null>(null)
  const [mapLoading, setMapLoading] = useState(true)
  const [namedCheckoutRegions, setNamedCheckoutRegions] = useState<CheckoutRoiRegion[]>([])
  const [checkoutRois, setCheckoutRois] = useState<MapRegion[]>([])
  const [focusCheckout, setFocusCheckout] = useState(true)
  const [expandedMap, setExpandedMap] = useState(false)
  const [hoveredLaneId, setHoveredLaneId] = useState<number | null>(null)
  const [selectedLaneId, setSelectedLaneId] = useState<number | null>(null)
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [perLaneKpi, setPerLaneKpi] = useState<KpiPerLane[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setMapLoading(true)
      try {
        if (venue?.id === venueId && contextObjects.length > 0) {
          if (!cancelled) {
            setMapObjects(contextObjects)
            setVenueSize({ width: venue.width, depth: venue.depth })
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
          if (!cancelled) {
            const parsed = parseCheckoutRegions(roiData)
            setNamedCheckoutRegions(parsed)
            setCheckoutRois(parsed.map(r => ({ id: r.id, vertices: r.vertices })))
          }
        }
      } catch (err) {
        console.error('[CheckoutCommandMap] layout load failed:', err)
      } finally {
        if (!cancelled) setMapLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [venueId, venue?.id, venue?.width, venue?.depth, contextObjects.length])

  const fetchLiveExtras = useCallback(async () => {
    try {
      const [sessRes, kpiRes] = await Promise.all([
        fetch(`${API_BASE}/api/venues/${venueId}/checkout/active-sessions`),
        fetch(`${API_BASE}/api/venues/${venueId}/checkout/kpi-snapshot?period=hour`),
      ])
      if (sessRes.ok) {
        const data = await sessRes.json()
        setActiveSessions(data.sessions || [])
      }
      if (kpiRes.ok) {
        const data = await kpiRes.json()
        setPerLaneKpi(data.perLane || [])
      }
    } catch { /* ignore */ }
  }, [venueId])

  useEffect(() => {
    fetchLiveExtras()
    const id = setInterval(fetchLiveExtras, 2000)
    return () => clearInterval(id)
  }, [fetchLiveExtras])

  useEffect(() => {
    const tick = (ts: number) => {
      pulseRef.current = (ts % 2000) / 2000
      setPulseTick(t => t + 1)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const inServiceByLane = useMemo(() => {
    const m = new Map<number, number>()
    for (const s of activeSessions) {
      if (s.inService && s.laneNumber != null) {
        m.set(s.laneNumber, (m.get(s.laneNumber) || 0) + 1)
      }
    }
    return m
  }, [activeSessions])

  const kpiByLaneName = useMemo(() => {
    const m = new Map<string, KpiPerLane>()
    for (const row of perLaneKpi) m.set(row.laneId, row)
    return m
  }, [perLaneKpi])

  const checkoutLaneRenders: CheckoutLaneRender[] = useMemo(() => {
    const buildFromLane = (lane: LaneStatus): CheckoutLaneRender | null => {
      const queueRegion = namedCheckoutRegions.find(
        r => r.kind === 'queue' && (r.id === lane.queueZoneId || r.laneNumber === lane.laneId),
      )
      if (!queueRegion) return null

      const serviceRegion = namedCheckoutRegions.find(r => {
        if (r.kind !== 'service') return false
        const prefix = queueRegion.name.replace('- Queue', '').trim()
        return prefix && r.name.replace('- Service', '').trim() === prefix
      })

      const serviceCenter = serviceRegion ? regionCentroid(serviceRegion.vertices) : null
      const queuedPeople = lane.queuedPeople?.length
        ? lane.queuedPeople
        : Array.from({ length: lane.queueCount }, () => ({ waitTimeSec: lane.avgWaitTimeSec ?? 0 }))

      return {
        laneId: lane.laneId,
        label: lane.name || `L${lane.laneId}`,
        health: getLaneHealth(lane, thresholds),
        hovered: hoveredLaneId === lane.laneId,
        selected: selectedLaneId === lane.laneId,
        queueVertices: queueRegion.vertices,
        serviceVertices: serviceRegion?.vertices,
        queueDots: layoutQueuePersonDots(queueRegion.vertices, serviceCenter, queuedPeople, thresholds),
        inService: (inServiceByLane.get(lane.laneId) || 0) > 0,
      }
    }

    if (status?.lanes?.length) {
      return status.lanes.map(buildFromLane).filter((l): l is CheckoutLaneRender => l != null && l.queueVertices.length >= 3)
    }

    return namedCheckoutRegions
      .filter(r => r.kind === 'queue')
      .map(qr => {
        const serviceRegion = namedCheckoutRegions.find(r => {
          if (r.kind !== 'service') return false
          const prefix = qr.name.replace('- Queue', '').trim()
          return r.name.replace('- Service', '').trim() === prefix
        })
        return {
          laneId: qr.laneNumber,
          label: `L${qr.laneNumber}`,
          health: 'closed' as const,
          hovered: hoveredLaneId === qr.laneNumber,
          selected: selectedLaneId === qr.laneNumber,
          queueVertices: qr.vertices,
          serviceVertices: serviceRegion?.vertices,
          queueDots: [],
          inService: false,
        }
      })
      .filter(l => l.queueVertices.length >= 3)
  }, [status?.lanes, namedCheckoutRegions, thresholds, hoveredLaneId, selectedLaneId, inServiceByLane])

  const boundsOverride = useMemo(() => {
    if (!focusCheckout || namedCheckoutRegions.length === 0) return null
    return computeCheckoutFocusBounds(namedCheckoutRegions, 0.3)
  }, [focusCheckout, namedCheckoutRegions])

  const fullStoreBounds = useMemo(
    () => computeFloorPlanBounds(mapObjects, checkoutRois, venueSize ?? undefined),
    [mapObjects, checkoutRois, venueSize],
  )

  const mapHeight = expandedMap ? Math.min(window.innerHeight - 180, 720) : 400

  const laneAlerts = useMemo(() => {
    const m = new Map<number, CheckoutAlert[]>()
    for (const a of activeAlerts) {
      if (a.laneId == null) continue
      const list = m.get(a.laneId) || []
      list.push(a)
      m.set(a.laneId, list)
    }
    return m
  }, [activeAlerts])

  if (mapLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading checkout map…
      </div>
    )
  }

  if (namedCheckoutRegions.length === 0 && !mapLoading) {
    return (
      <div className="text-center py-12 text-gray-400 text-sm">
        <MapPin className="w-8 h-8 mx-auto mb-2 opacity-40" />
        <p>No checkout queue zones on the floor plan.</p>
        <p className="text-xs mt-1 text-gray-500">Run Smart KPI checkout calibration to create lane ROIs.</p>
      </div>
    )
  }

  const pressure = status?.pressure
  const lanes = status?.lanes ?? []

  const mapPanel = (
    <div
      className={`rounded-md border overflow-hidden relative ${expandedMap ? 'fixed inset-4 z-[60] flex flex-col bg-gray-950 border-gray-600 shadow-2xl' : ''}`}
      style={{ background: '#050810', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      {expandedMap && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-900/90">
          <span className="text-sm font-medium text-white">Checkout Command Map — expanded</span>
          <button
            type="button"
            onClick={() => setExpandedMap(false)}
            className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className={expandedMap ? 'flex-1 min-h-0 p-2' : ''}>
        <FloorPlanMiniMap
          objects={mapObjects}
          regions={checkoutRois}
          venueSize={venueSize ?? undefined}
          mode="checkoutLanes"
          checkoutLanes={checkoutLaneRenders}
          boundsOverride={focusCheckout ? boundsOverride : fullStoreBounds}
          pulse={pulseRef.current}
          height={mapHeight}
          onLaneClick={id => setSelectedLaneId(prev => (prev === id ? null : id))}
          onLaneHover={setHoveredLaneId}
        />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-2 py-1.5 border-t border-gray-800/80 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 border border-cyan-400/50 bg-cyan-400/10 rounded-sm" />
          DWG fixtures
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-green-500/40 border border-green-400/60" />
          Queue OK
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-amber-500/40 border border-amber-400/60 animate-pulse" />
          Warning
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-red-500/40 border border-red-400/60 animate-pulse" />
          Critical
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-gray-600/50 border border-gray-500" style={{ backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(148,163,184,0.4) 2px, rgba(148,163,184,0.4) 3px)' }} />
          Closed
        </span>
        <span className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            onClick={() => setFocusCheckout(v => !v)}
            className={`px-2 py-0.5 rounded border ${focusCheckout ? 'border-green-500/40 text-green-400 bg-green-500/10' : 'border-gray-600 text-gray-400'}`}
          >
            {focusCheckout ? 'Focused on checkout' : 'Full store'}
          </button>
          {!expandedMap && (
            <button
              type="button"
              onClick={() => setExpandedMap(true)}
              className="px-2 py-0.5 rounded border border-gray-600 text-gray-400 hover:text-white flex items-center gap-1"
            >
              <Expand className="w-3 h-3" /> Expand
            </button>
          )}
        </span>
      </div>
    </div>
  )

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 text-amber-400 text-sm bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <WifiOff className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Operations strip */}
      <div className="flex flex-wrap items-center gap-3 bg-gray-800/80 border border-gray-700 rounded-lg px-4 py-2.5">
        <div className="flex items-center gap-4 text-sm">
          <span><span className="text-gray-500">Open</span>{' '}<span className="text-green-400 font-semibold">{pressure?.openLaneCount ?? '—'}</span><span className="text-gray-600">/{lanes.length}</span></span>
          <span><span className="text-gray-500">Queued</span>{' '}<span className="text-blue-400 font-semibold">{pressure?.totalQueueCount ?? '—'}</span></span>
          <span><span className="text-gray-500">Avg/lane</span>{' '}<span className="text-white font-semibold">{pressure?.avgQueuePerLane?.toFixed(1) ?? '—'}</span></span>
        </div>
        {pressure?.shouldOpenMore && pressure.suggestedLaneToOpen != null && (
          <div className="flex items-center gap-2 ml-auto bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-1.5">
            <Lightbulb className="w-4 h-4 text-yellow-400 shrink-0" />
            <span className="text-xs text-yellow-300">Open Lane {pressure.suggestedLaneToOpen}</span>
            <button
              type="button"
              onClick={() => onSetLaneState(pressure.suggestedLaneToOpen!, 'open')}
              className="text-xs px-2 py-0.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 rounded"
            >
              Open
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => { onRefresh(); fetchLiveExtras() }}
          disabled={loading}
          className="ml-auto p-1.5 text-gray-500 hover:text-white rounded hover:bg-gray-700 disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-col xl:flex-row gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          {mapPanel}

          {/* Horizontal lane strip */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {lanes.map(lane => {
              const health = getLaneHealth(lane, thresholds)
              const hovered = hoveredLaneId === lane.laneId
              const selected = selectedLaneId === lane.laneId
              const alerts = laneAlerts.get(lane.laneId) || []
              const kpi = kpiByLaneName.get(lane.name || `Lane ${lane.laneId}`)
              const border =
                health === 'critical' ? 'border-red-500/60' :
                health === 'warning' ? 'border-amber-500/50' :
                health === 'closed' ? 'border-gray-600' :
                'border-green-500/30'

              return (
                <div
                  key={lane.laneId}
                  onMouseEnter={() => setHoveredLaneId(lane.laneId)}
                  onMouseLeave={() => setHoveredLaneId(null)}
                  onClick={() => setSelectedLaneId(prev => (prev === lane.laneId ? null : lane.laneId))}
                  className={`shrink-0 min-w-[140px] rounded-lg border-2 px-3 py-2 cursor-pointer transition-all bg-gray-800/80 ${border} ${
                    hovered || selected ? 'ring-1 ring-white/20 scale-[1.02]' : ''
                  } ${health === 'critical' ? 'animate-pulse' : ''}`}
                  style={{ animationDuration: '1.4s' }}
                >
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <span className="text-xs font-medium text-white truncate">{lane.name || `Lane ${lane.laneId}`}</span>
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        onSetLaneState(lane.laneId, lane.desiredState === 'open' ? 'closed' : 'open')
                      }}
                      className={lane.desiredState === 'open' ? 'text-green-400' : 'text-gray-500'}
                    >
                      {lane.desiredState === 'open' ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-400">
                    {lane.queueCount} queued
                    {lane.avgWaitTimeSec != null && ` · ${(lane.avgWaitTimeSec / 60).toFixed(1)}m`}
                  </div>
                  {kpi && (
                    <div className="text-[10px] text-purple-400/90 mt-0.5">
                      {kpi.sessions} sess/hr · {kpi.avgWaitSec}s avg
                    </div>
                  )}
                  {alerts.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-400">
                      <AlertTriangle className="w-3 h-3" />
                      {alerts.length} alert{alerts.length > 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Lane detail + alerts sidebar */}
        <div className="xl:w-64 shrink-0 space-y-2">
          <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
            <h4 className="text-[11px] font-medium text-gray-400 mb-2 uppercase tracking-wide">Lane detail</h4>
            {selectedLaneId == null ? (
              <p className="text-xs text-gray-500">Click a lane on the map or strip to inspect.</p>
            ) : (() => {
              const lane = lanes.find(l => l.laneId === selectedLaneId)
              if (!lane) return null
              const health = getLaneHealth(lane, thresholds)
              return (
                <div className="space-y-2 text-xs">
                  <div className="font-medium text-white">{lane.name || `Lane ${lane.laneId}`}</div>
                  <div className={`inline-block px-2 py-0.5 rounded text-[10px] uppercase ${
                    health === 'critical' ? 'bg-red-500/20 text-red-300' :
                    health === 'warning' ? 'bg-amber-500/20 text-amber-300' :
                    health === 'closed' ? 'bg-gray-600/30 text-gray-400' :
                    'bg-green-500/20 text-green-300'
                  }`}>
                    {health}
                  </div>
                  <div className="text-gray-400 space-y-0.5">
                    <div>Status: <span className="text-gray-200">{lane.status}</span></div>
                    <div>Queue: <span className="text-gray-200">{lane.queueCount}</span></div>
                    {lane.avgWaitTimeSec != null && (
                      <div>Avg wait: <span className="text-gray-200">{(lane.avgWaitTimeSec / 60).toFixed(1)} min</span></div>
                    )}
                    {inServiceByLane.get(lane.laneId) ? (
                      <div className="text-purple-400">In service now</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSetLaneState(lane.laneId, lane.desiredState === 'open' ? 'closed' : 'open')}
                    className="w-full mt-2 px-2 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-white text-xs"
                  >
                    {lane.desiredState === 'open' ? 'Close lane' : 'Open lane'}
                  </button>
                </div>
              )
            })()}
          </div>

          <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3 max-h-48 overflow-y-auto">
            <h4 className="text-[11px] font-medium text-gray-400 mb-2 uppercase tracking-wide">
              Active alerts ({activeAlerts.length})
            </h4>
            {activeAlerts.length === 0 ? (
              <p className="text-xs text-gray-500">No active alerts</p>
            ) : (
              <div className="space-y-1.5">
                {activeAlerts.slice(0, 8).map(a => (
                  <div key={a.id} className="text-[11px] flex gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${a.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                    <span className="text-gray-300 leading-snug">{a.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
