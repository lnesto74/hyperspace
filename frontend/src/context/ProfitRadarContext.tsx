import { createContext, useContext, useState, useEffect, useRef, MutableRefObject, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { useVenue } from './VenueContext'
import { API_BASE } from '../config/api'
import type {
  IntentAxes, ZoneFieldEntry, BehaviorCluster, ProfitRadarInsight,
  TrackAxesEvent, ZoneFieldEvent, ProfitRadarInsightsEvent, Vector3
} from '../types'

interface TrackAxesEntry {
  trackKey: string
  axes: IntentAxes
  position: Vector3
}

interface ProfitRadarContextType {
  trackAxes: TrackAxesEntry[]
  zoneField: ZoneFieldEntry[]
  clusters: BehaviorCluster[]
  insights: ProfitRadarInsight[]
  intentFieldEnabled: boolean
  setIntentFieldEnabled: (v: boolean) => void
  selectedInsight: ProfitRadarInsight | null
  setSelectedInsight: (i: ProfitRadarInsight | null) => void
  hoveredCluster: BehaviorCluster | null
  setHoveredCluster: (c: BehaviorCluster | null) => void
  liveClusterKeysRef: MutableRefObject<string[]>
}

const ProfitRadarContext = createContext<ProfitRadarContextType | null>(null)

export function ProfitRadarProvider({ children }: { children: ReactNode }) {
  const { venue } = useVenue()
  const [trackAxes, setTrackAxes] = useState<TrackAxesEntry[]>([])
  const [zoneField, setZoneField] = useState<ZoneFieldEntry[]>([])
  const [clusters, setClusters] = useState<BehaviorCluster[]>([])
  const [insights, setInsights] = useState<ProfitRadarInsight[]>([])
  const [intentFieldEnabled, setIntentFieldEnabled] = useState(false)
  const [selectedInsight, setSelectedInsight] = useState<ProfitRadarInsight | null>(null)
  const [hoveredCluster, setHoveredCluster] = useState<BehaviorCluster | null>(null)
  const liveClusterKeysRef = useRef<string[]>([])
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    // Reuse existing tracking socket connection
    const socket = io(`${API_BASE}/tracking`, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    })

    socket.on('connect', () => {
      if (venue?.id) {
        socket.emit('subscribe', { venueId: venue.id })
      }
    })

    socket.on('semantics:trackAxes', (data: TrackAxesEvent) => {
      if (data.venueId !== venue?.id) return
      setTrackAxes(data.tracks)
    })

    socket.on('semantics:zoneField', (data: ZoneFieldEvent) => {
      if (data.venueId !== venue?.id) return
      setZoneField(data.zones)
      setClusters(data.clusters)
    })

    socket.on('profitRadar:insights', (data: ProfitRadarInsightsEvent) => {
      if (data.venueId !== venue?.id) return
      setInsights(data.insights)
    })

    socketRef.current = socket

    // Fetch initial data via REST
    if (venue?.id) {
      fetch(`${API_BASE}/api/profit-radar/insights`)
        .then(r => r.json())
        .then(data => {
          if (data.insights) setInsights(data.insights)
          if (data.zones) setZoneField(data.zones)
          if (data.clusters) setClusters(data.clusters)
        })
        .catch(() => {})
    }

    return () => {
      socket.disconnect()
    }
  }, [venue?.id])

  // Auto-refresh live cluster keys via ref (no state mutation — keeps hoveredCluster reference stable)
  useEffect(() => {
    if (!hoveredCluster) { liveClusterKeysRef.current = []; return }
    // Initialize from frozen snapshot
    liveClusterKeysRef.current = hoveredCluster.trackKeys
  }, [hoveredCluster])

  useEffect(() => {
    if (!hoveredCluster || clusters.length === 0) return
    const match = clusters.find(c =>
      c.dominant === hoveredCluster.dominant &&
      c.trajectory.journeyType === hoveredCluster.trajectory.journeyType
    )
    if (match && match.trackKeys.length > 0) {
      liveClusterKeysRef.current = match.trackKeys // ref update, no re-render
    }
  }, [clusters])

  return (
    <ProfitRadarContext.Provider value={{
      trackAxes, zoneField, clusters, insights,
      intentFieldEnabled, setIntentFieldEnabled,
      selectedInsight, setSelectedInsight,
      hoveredCluster, setHoveredCluster, liveClusterKeysRef,
    }}>
      {children}
    </ProfitRadarContext.Provider>
  )
}

export function useProfitRadar() {
  const ctx = useContext(ProfitRadarContext)
  if (!ctx) throw new Error('useProfitRadar must be used within ProfitRadarProvider')
  return ctx
}
