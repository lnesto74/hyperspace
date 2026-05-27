import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { Track, TrackWithTrail, LidarStatus } from '../types'
import { useVenue } from './VenueContext'
import { API_BASE } from '../config/api'
import { appendTrailPoint, isFiniteTrackPos, clampPlanarVelocity, TRAIL_JUMP_RESET_M } from '../lib/trackTrail'
import { countLiveFrameTracks } from '../lib/frameOccupancy'

const MAX_TRAIL_LENGTH = 50 // ~5s at 10Hz in raw bypass mode
const RECONCILE_TRAIL_LENGTH = 100 // ~10s at 10Hz when preset active
const MAX_EXTRAP_MS = 120 // Short extrap only — long gaps snap to latest MQTT position
const TRACK_TTL_MS = 12000 // Drop stale client tracks sooner under raw-ID churn
const SNAPSHOT_GRACE_MS = 400 // Brief flicker hold when reconciler bypassed
const RECONCILE_GRACE_MS = 2000 // hold through reconciler re-ID gaps
const CLEANUP_INTERVAL_MS = 1000 // Cleanup stale tracks every 1 second
const INTERP_MAX_TRACKS = 220 // Match render cap — never drop tracks from interp state (see interp loop)
const MAX_CLIENT_TRACKS = 220 // Emergency cap only — reconciler keeps count low
const EMERGENCY_CAP_THRESHOLD = 200 // Only sticky-cap above this
const INTERP_MISSING_GRACE_MS = 600 // Drop ghost targets faster when ID churns

function capTrackMap<T extends { timestamp?: number }>(source: Map<string, T>): Map<string, T> {
  if (source.size <= MAX_CLIENT_TRACKS) return source
  const entries = [...source.entries()].sort((a, b) => {
    const tsDiff = (b[1].timestamp ?? 0) - (a[1].timestamp ?? 0)
    if (tsDiff !== 0) return tsDiff
    const aReplay = a[0].startsWith('replay-') ? 1 : 0
    const bReplay = b[0].startsWith('replay-') ? 1 : 0
    return aReplay - bReplay
  })
  return new Map(entries.slice(0, MAX_CLIENT_TRACKS))
}

/** Prefer tracks already on screen so the cap doesn't swap IDs every frame. */
function stickyCapTrackMap<T extends { timestamp?: number }>(
  incoming: Map<string, T>,
  prev: Map<string, unknown>,
  max = MAX_CLIENT_TRACKS,
): Map<string, T> {
  if (incoming.size <= EMERGENCY_CAP_THRESHOLD) return incoming
  if (incoming.size <= max) return incoming
  const result = new Map<string, T>()
  for (const key of prev.keys()) {
    const track = incoming.get(key)
    if (track) result.set(key, track)
  }
  if (result.size < max) {
    const rest = [...incoming.entries()]
      .filter(([k]) => !result.has(k))
      .sort((a, b) => (b[1].timestamp ?? 0) - (a[1].timestamp ?? 0))
    for (const [k, t] of rest) {
      if (result.size >= max) break
      result.set(k, t)
    }
  }
  return result
}
const LERP_SPEED = 0.32 // Reconciler/VTL smoothing
const LERP_SPEED_RAW = 1.0 // Raw bypass: MQTT positions are authoritative — no lag
const EXTRAP_FACTOR = 0.001 // Velocity extrapolation: m/s → m/frame (tuned for ~30fps)
const INTERP_TRAIL_INTERVAL = 3 // Add trail point every N interpolation frames

// Diagnostic logging — production: localStorage hyperspace-diag=1 or ?diag=1 on URL
function isTrackingDiag(): boolean {
  try {
    if (import.meta.env.DEV) return true
    if (localStorage.getItem('hyperspace-diag') === '1') return true
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search)
      if (q.get('diag') === '1' || q.get('hyperspace-diag') === '1') return true
    }
  } catch { /* private mode / blocked storage */ }
  return false
}

/** Live canvas stays raw unless user explicitly enables experimental live reconciler. */
function isExperimentalLiveReconciler() {
  try {
    return localStorage.getItem('hyperspace-experimental-live-reconciler') === '1'
  } catch {
    return false
  }
}
let diagLastTrackCount = 0
let diagLastSocketTs = 0
let diagTrackRecvCount = 0
let diagInterpFrameCount = 0
let diagInterpDrops = 0

export type LiveTrackDelivery = 'direct' | 'buffered'

const LIVE_TRACK_DELIVERY_KEY = 'hyperspace-live-track-delivery'

export function readLiveTrackDelivery(): LiveTrackDelivery {
  try {
    return localStorage.getItem(LIVE_TRACK_DELIVERY_KEY) === 'buffered' ? 'buffered' : 'direct'
  } catch {
    return 'direct'
  }
}

interface TrackingContextType {
  tracks: Map<string, TrackWithTrail>
  isConnected: boolean
  isReplayMode: boolean
  mqttReplayActive: boolean
  useHistoricalTracks: boolean
  demoSessionId: string | null
  liveTrackDelivery: LiveTrackDelivery
  subscribe: (venueId: string) => void
  unsubscribe: (venueId: string) => void
  setReplayMode: (enabled: boolean) => void
  setReplayTracks: (tracks: Map<string, TrackWithTrail>) => void
  setTrackVisibility: (visible: boolean) => void
  setInterpolation: (enabled: boolean) => void
  setVisualizationMode: (mode: 'vtl' | 'raw', opts?: { forceClear?: boolean }) => void
  setMqttReplayActive: (active: boolean) => void
  clearReplayTracks: () => void
}

const TrackingContext = createContext<TrackingContextType | null>(null)

/**
 * Stable actions context — holds only callback functions (setTrackVisibility,
 * setInterpolation, subscribe, etc.) whose identity never changes. Components
 * that only need to *control* tracking (not read tracks) use useTrackingActions()
 * to avoid re-rendering when tracks update.
 */
interface TrackingActionsType {
  subscribe: (venueId: string) => void
  unsubscribe: (venueId: string) => void
  setReplayMode: (enabled: boolean) => void
  setReplayTracks: (tracks: Map<string, TrackWithTrail>) => void
  setTrackVisibility: (visible: boolean) => void
  setInterpolation: (enabled: boolean) => void
  setVisualizationMode: (mode: 'vtl' | 'raw', opts?: { forceClear?: boolean }) => void
  setMqttReplayActive: (active: boolean) => void
  clearReplayTracks: () => void
  setLiveTrackDelivery: (mode: LiveTrackDelivery) => void
  applyLiveTrackDelivery: () => void
  startDemoSession: (venueId: string) => Promise<string | null>
  stopDemoSession: () => Promise<void>
}
const TrackingActionsContext = createContext<TrackingActionsType | null>(null)

/**
 * Stable ref context — provides a ref to the latest tracks Map without triggering
 * re-renders when tracks change. Dashboard panels that only need tracks in throttled
 * intervals should use useTracksRef() instead of useTracking().
 */
const TracksRefContext = createContext<React.MutableRefObject<Map<string, TrackWithTrail>> | null>(null)

export interface LiveMetricsSnapshot {
  frameOccupancy: number
  liveFrameTs: number | null
}

const LiveMetricsRefContext = createContext<React.MutableRefObject<LiveMetricsSnapshot> | null>(null)

const VtlModeRefContext = createContext<React.MutableRefObject<boolean> | null>(null)

interface VisualTrackEntityPayload extends Track {
  visualId?: string
  state?: string
  opacity?: number
  trail?: { x: number; y: number; z: number }[]
}

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { venue } = useVenue()
  const [liveTracks, setLiveTracks] = useState<Map<string, TrackWithTrail>>(new Map())
  const [replayTracks, setReplayTracksState] = useState<Map<string, TrackWithTrail>>(new Map())
  const liveTracksRef = useRef(liveTracks)
  liveTracksRef.current = liveTracks
  const replayTracksRef = useRef(replayTracks)
  replayTracksRef.current = replayTracks
  const [isConnected, setIsConnected] = useState(false)
  const [isReplayMode, setIsReplayMode] = useState(false)
  const [mqttReplayActive, setMqttReplayActiveState] = useState(false)
  const [demoSessionId, setDemoSessionId] = useState<string | null>(null)
  const [liveTrackDelivery, setLiveTrackDeliveryState] = useState<LiveTrackDelivery>(readLiveTrackDelivery)
  const demoSessionIdRef = useRef<string | null>(null)
  demoSessionIdRef.current = demoSessionId
  const mqttReplayActiveRef = useRef(false)
  mqttReplayActiveRef.current = mqttReplayActive
  const socketRef = useRef<Socket | null>(null)
  const subscribedVenueRef = useRef<string | null>(null)
  const venueIdRef = useRef<string | null>(null)
  const isReplayModeRef = useRef(false)
  const subscribeRef = useRef<(venueId: string) => void>(() => {})
  const trackLastSeenRef = useRef<Map<string, number>>(new Map())
  venueIdRef.current = venue?.id ?? null
  isReplayModeRef.current = isReplayMode
  
  // Client delivery path for live MQTT: direct snapshots (default) vs buffered RAF loop.
  const interpEnabledRef = useRef(false)
  const interpRAFRef = useRef<number | null>(null)
  const interpFrameRef = useRef(0)
  // Target positions from socket — extrapolated using velocity between updates
  const targetTracksRef = useRef<Map<string, Track>>(new Map())
  // Timestamp when each target was received (for velocity extrapolation)
  const interpTsRef = useRef<Map<string, number>>(new Map())
  const pendingRemovalsRef = useRef<Set<string>>(new Set())
  const removalFlushTimerRef = useRef<number | null>(null)
  const smoothMotionRequestedRef = useRef(readLiveTrackDelivery() === 'buffered')
  const setInterpolationRef = useRef<(enabled: boolean) => void>(() => {})
  const liveMetricsRef = useRef<LiveMetricsSnapshot>({ frameOccupancy: 0, liveFrameTs: null })
  const vtlModeRef = useRef(false)
  const vtlPlaybackLagRef = useRef(10000)

  const applyVisualizationMode = useCallback((
    mode: 'vtl' | 'raw',
    playbackLagMs?: number,
    opts?: { forceClear?: boolean },
  ) => {
    const nextVtl = mode === 'vtl'
    if (playbackLagMs != null) vtlPlaybackLagRef.current = playbackLagMs
    if (!opts?.forceClear && vtlModeRef.current === nextVtl) return
    vtlModeRef.current = nextVtl
    setLiveTracks(new Map())
    targetTracksRef.current.clear()
    interpTsRef.current.clear()
    trackLastSeenRef.current.clear()
    liveMetricsRef.current = { frameOccupancy: 0, liveFrameTs: null }
    // Reconcile preset uses the same live interp pipeline as bypass — longer trails only.
    setInterpolationRef.current(smoothMotionRequestedRef.current)
    window.dispatchEvent(new CustomEvent('hyperspace:visualization-mode', { detail: { mode } }))
    if (isTrackingDiag()) console.log(`[DIAG] visualization mode → ${mode}  lag=${vtlPlaybackLagRef.current}ms  t=${Date.now()}`)
  }, [])

  const setVisualizationMode = useCallback((
    mode: 'vtl' | 'raw',
    opts?: { forceClear?: boolean },
  ) => {
    applyVisualizationMode(mode, undefined, opts)
  }, [applyVisualizationMode])
  
  // Historical timeline/insight replay uses DB snapshots; MQTT JSONL replay uses live socket.
  const useHistoricalTracks = isReplayMode && !mqttReplayActive && replayTracks.size > 0
  const tracks = useHistoricalTracks ? replayTracks : liveTracks
  
  // Stable ref always points to latest tracks — consumers using useTracksRef() 
  // won't re-render when tracks change
  const stableTracksRef = useRef(tracks)
  stableTracksRef.current = tracks

  const maxTrailLength = () => (vtlModeRef.current ? RECONCILE_TRAIL_LENGTH : MAX_TRAIL_LENGTH)
  const snapshotGraceMs = () => (vtlModeRef.current ? RECONCILE_GRACE_MS : SNAPSHOT_GRACE_MS)

  const subscribe = useCallback((venueId: string, { force = false }: { force?: boolean } = {}) => {
    // Socket.io drops room membership on reconnect — must re-emit subscribe for the same venue.
    if (!force && subscribedVenueRef.current === venueId && socketRef.current?.connected) {
      return
    }
    if (subscribedVenueRef.current && subscribedVenueRef.current !== venueId) {
      socketRef.current?.emit('unsubscribe', { venueId: subscribedVenueRef.current })
    }
    const venueChanged = subscribedVenueRef.current !== venueId
    subscribedVenueRef.current = venueId
    if (isTrackingDiag()) console.log(`[DIAG] subscribe venue=${venueId}  force=${force}  connected=${!!socketRef.current?.connected}  t=${Date.now()}`)
    socketRef.current?.emit('subscribe', { venueId })
    if (venueChanged) setLiveTracks(new Map())
  }, [])

  subscribeRef.current = subscribe

  // Live canvas is always raw — reconciler presets run offline in Replay panel.
  useEffect(() => {
    if (!venue?.id) return
    applyVisualizationMode('raw')
  }, [venue?.id, applyVisualizationMode])

  // Restore demo session + replay flag after page refresh (server-side replay survives reload).
  useEffect(() => {
    if (!venue?.id) return
    let cancelled = false
    fetch(`${API_BASE}/api/demo/sessions/active?venueId=${encodeURIComponent(venue.id)}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data?.active || !data.sessionId) return
        demoSessionIdRef.current = data.sessionId
        setDemoSessionId(data.sessionId)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [venue?.id])

  useEffect(() => {
    if (isTrackingDiag()) {
      console.info('[DIAG] Hyperspace tracking diagnostics ENABLED — filter console by [DIAG]')
    }
  }, [])

  useEffect(() => {
    const socket = io(`${API_BASE}/tracking`, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    })

    socket.on('connect', () => {
      if (isTrackingDiag()) console.log(`[DIAG] Socket CONNECTED  id=${socket.id}  t=${Date.now()}`)
      setIsConnected(true)
      const targetVenue = subscribedVenueRef.current || venueIdRef.current
      if (targetVenue) {
        subscribeRef.current(targetVenue, { force: true })
      }
    })

    socket.on('disconnect', (reason) => {
      if (isTrackingDiag()) console.warn(`[DIAG] Socket DISCONNECTED  reason="${reason}"  t=${Date.now()}`)
      setIsConnected(false)
      subscribedVenueRef.current = null
    })

    socket.io.on('reconnect_attempt', (attempt) => {
      if (isTrackingDiag()) console.warn(`[DIAG] Socket RECONNECT attempt #${attempt}  t=${Date.now()}`)
    })

    // When interpolation is on, socket updates only feed targets — keep flush fast as fallback.
    let pendingBatches: Track[][] = []
    let lastFlushTime = 0
    const MIN_FLUSH_INTERVAL = 33 // ~30fps — matches original MainViewport sync
    
    const flushTrackUpdates = () => {
      if (pendingBatches.length === 0) return
      
      const now = Date.now()
      // Skip if we flushed too recently
      if (now - lastFlushTime < MIN_FLUSH_INTERVAL) {
        requestAnimationFrame(flushTrackUpdates)
        return
      }
      lastFlushTime = now
      
      // Use the LAST complete batch as the authoritative set of active tracks.
      // The TrackAggregator emits a full snapshot every 100ms, so the latest
      // batch represents ALL currently active tracks — anything not in it is gone.
      const lastBatch = pendingBatches[pendingBatches.length - 1]
      const latestByKey = new Map<string, Track>()
      for (const track of lastBatch) {
        if (mqttReplayActiveRef.current) {
          if (!track.trackKey.startsWith('replay-')) continue
        } else if (track.trackKey.startsWith('replay-')) {
          continue
        }
        latestByKey.set(track.trackKey, track)
      }
      pendingBatches = []

      const cappedKeys = stickyCapTrackMap(latestByKey, liveTracksRef.current)
      
      setLiveTracks(prev => {
        const next = new Map<string, TrackWithTrail>()

        for (const [key, track] of cappedKeys) {
          if (!isFiniteTrackPos(track.venuePosition)) continue
          const existing = prev.get(key)
          const trail = appendTrailPoint(
            existing?.trail,
            { ...track.venuePosition, y: track.venuePosition.y ?? 0 },
            maxTrailLength(),
          )

          next.set(key, { ...track, trail })
          trackLastSeenRef.current.set(key, now)
        }

        // Brief grace: reconciler re-ID can drop a track from one snapshot then restore it
        for (const [key, track] of prev) {
          if (next.has(key)) continue
          if (mqttReplayActiveRef.current && !key.startsWith('replay-')) continue
          if (key.startsWith('replay-') && !mqttReplayActiveRef.current) continue
          const lastSeen = trackLastSeenRef.current.get(key) ?? 0
          if (now - lastSeen < snapshotGraceMs()) {
            next.set(key, track)
          }
        }

        if (isTrackingDiag() && prev.size !== next.size) {
          const removed = [...prev.keys()].filter(k => !next.has(k))
          if (removed.length > 0) {
            console.log(`[DIAG] Snapshot reconciliation removed ${removed.length} stale tracks: ${removed.join(', ')}  t=${now}`)
          }
        }

        return next
      })
    }
    
    const applyModeFromSocket = (mode: 'vtl' | 'raw', playbackLagMs?: number, forceClear = false) => {
      applyVisualizationMode(mode, playbackLagMs, { forceClear })
    }

    socket.on('visualization_mode', (data: { venueId: string; mode: string; playbackLagMs?: number }) => {
      if (data.venueId !== subscribedVenueRef.current) return
      if (!isExperimentalLiveReconciler()) return
      applyModeFromSocket(data.mode === 'vtl' ? 'vtl' : 'raw', data.playbackLagMs, true)
    })

    socket.on('venue:reconciler-updated', (data: { venueId: string; reconciler?: { enabled?: boolean } | null }) => {
      if (data.venueId !== subscribedVenueRef.current) return
      if (!isExperimentalLiveReconciler()) return
      applyModeFromSocket(data.reconciler?.enabled === true ? 'vtl' : 'raw', undefined, true)
    })

    socket.on('visual_tracks', (_data: {
      venueId: string
      entities: VisualTrackEntityPayload[]
      frameOccupancy?: number
      playbackLagMs?: number
    }) => {
      // Delayed VTL channel disabled — canvas uses live reconciled `tracks` instead.
    })

    socket.on('tracks', (data: { venueId: string, tracks: Track[] }) => {
      if (data.venueId !== subscribedVenueRef.current) {
        if (isTrackingDiag()) console.warn(`[DIAG] tracks IGNORED  eventVenue=${data.venueId}  subscribed=${subscribedVenueRef.current}  n=${data.tracks.length}  t=${Date.now()}`)
        return
      }
      if (isReplayModeRef.current && !mqttReplayActiveRef.current && replayTracksRef.current.size > 0) return

      const now = Date.now()

      if (isTrackingDiag()) {
        const gap = diagLastSocketTs ? now - diagLastSocketTs : 0
        diagLastSocketTs = now
        if (gap > 2000) {
          console.warn(`[DIAG] Socket tracks GAP  ${gap}ms since last emission  n=${data.tracks.length}  t=${now}`)
        }
        diagTrackRecvCount += 1
        if (diagTrackRecvCount <= 3 || diagTrackRecvCount % 300 === 0) {
          const sample = data.tracks[0]
          console.log(`[DIAG] tracks recv  n=${data.tracks.length}  sample=${sample?.trackKey}  pos=(${sample?.venuePosition?.x?.toFixed(2)},${sample?.venuePosition?.z?.toFixed(2)})  #=${diagTrackRecvCount}  t=${now}`)
        }
      }
      
      if (interpEnabledRef.current && !mqttReplayActiveRef.current) {
        // Build a Set of trackKeys in this snapshot to prune stale targets
        const incomingKeys = new Set<string>()
        for (const track of data.tracks) {
          if (!mqttReplayActiveRef.current && track.trackKey.startsWith('replay-')) continue
          targetTracksRef.current.set(track.trackKey, track)
          interpTsRef.current.set(track.trackKey, now)
          trackLastSeenRef.current.set(track.trackKey, now)
          incomingKeys.add(track.trackKey)
        }
        // Remove targets missing from this full snapshot quickly under raw ID churn.
        const INTERP_MISSING_GRACE_MS_LOCAL = INTERP_MISSING_GRACE_MS
        for (const key of targetTracksRef.current.keys()) {
          if (!incomingKeys.has(key)) {
            const lastSeen = trackLastSeenRef.current.get(key) ?? 0
            if (now - lastSeen > INTERP_MISSING_GRACE_MS_LOCAL) {
              targetTracksRef.current.delete(key)
              interpTsRef.current.delete(key)
              trackLastSeenRef.current.delete(key)
              if (isTrackingDiag()) console.log(`[DIAG] Interp removed missing target  key=${key}  age=${now - lastSeen}ms  t=${now}`)
            }
          }
        }
      } else {
        const batch = mqttReplayActiveRef.current
          ? data.tracks.filter(t => t.trackKey.startsWith('replay-'))
          : data.tracks.filter(t => !t.trackKey.startsWith('replay-'))
        pendingBatches.push(batch)
        requestAnimationFrame(flushTrackUpdates)
      }
    })

    const flushPendingRemovals = () => {
      removalFlushTimerRef.current = null
      const keys = [...pendingRemovalsRef.current]
      pendingRemovalsRef.current.clear()
      if (keys.length === 0) return

      const now = Date.now()
      const toRemove = keys.filter((key) => {
        const lastSeen = trackLastSeenRef.current.get(key) ?? 0
        return now - lastSeen >= snapshotGraceMs()
      })
      if (toRemove.length === 0) return

      if (isTrackingDiag()) {
        console.log(
          `[DIAG] track_removed batch flush  n=${toRemove.length}  t=${now}`
        )
      }

      setLiveTracks(prev => {
        let changed = false
        const next = new Map(prev)
        for (const key of toRemove) {
          if (next.delete(key)) changed = true
          trackLastSeenRef.current.delete(key)
          targetTracksRef.current.delete(key)
          interpTsRef.current.delete(key)
        }
        return changed ? next : prev
      })
    }

    const removeTrackKeyImmediately = (trackKey: string) => {
      pendingRemovalsRef.current.delete(trackKey)
      trackLastSeenRef.current.delete(trackKey)
      targetTracksRef.current.delete(trackKey)
      interpTsRef.current.delete(trackKey)
      setLiveTracks(prev => {
        if (!prev.has(trackKey)) return prev
        const next = new Map(prev)
        next.delete(trackKey)
        return next
      })
    }

    socket.on('track_removed', (data: { trackKey: string; replay?: boolean; liveSuppressed?: boolean }) => {
      if (data.replay || data.trackKey?.startsWith('replay-')) {
        removeTrackKeyImmediately(data.trackKey)
        return
      }
      if (mqttReplayActiveRef.current || data.liveSuppressed) {
        removeTrackKeyImmediately(data.trackKey)
        return
      }
      // With interpolation on, full snapshots every 100ms are authoritative — track_removed
      // from aggregator prune/re-ID churn only causes frozen grace meshes.
      if (interpEnabledRef.current) {
        if (isTrackingDiag() && pendingRemovalsRef.current.size === 0) {
          // Throttle: log once per burst
          console.log(`[DIAG] track_removed ignored (interp snapshots authoritative)  key=${data.trackKey}  t=${Date.now()}`)
        }
        return
      }
      pendingRemovalsRef.current.add(data.trackKey)
      if (removalFlushTimerRef.current != null) {
        window.clearTimeout(removalFlushTimerRef.current)
      }
      removalFlushTimerRef.current = window.setTimeout(flushPendingRemovals, snapshotGraceMs())
    })

    socket.on('tracks_cleared', () => {
      if (isTrackingDiag()) console.log(`[DIAG] tracks_cleared event  t=${Date.now()}`)
      setLiveTracks(new Map())
      trackLastSeenRef.current.clear()
      targetTracksRef.current.clear()
      interpTsRef.current.clear()
    })

    socket.on('lidar_status', (data: { deviceId: string, status: LidarStatus, message?: string }) => {
      console.log('LiDAR status update:', data)
    })

    socketRef.current = socket

    // Single interval to cleanup stale tracks (instead of per-track timeouts)
    const cleanupInterval = setInterval(() => {
      const now = Date.now()
      let staleKeys: string[] = []
      
      trackLastSeenRef.current.forEach((lastSeen, key) => {
        if (now - lastSeen > TRACK_TTL_MS) {
          staleKeys.push(key)
        }
      })
      if (staleKeys.length > 0) {
        // Remove at most 40 stale keys per tick to avoid one-frame mass wipe
        if (staleKeys.length > 40) staleKeys = staleKeys.slice(0, 40)
        if (isTrackingDiag()) {
          const total = trackLastSeenRef.current.size
          console.warn(`[DIAG] TTL cleanup  removing=${staleKeys.length}  remaining=${total - staleKeys.length}  t=${now}`)
        }
        staleKeys.forEach(key => {
          trackLastSeenRef.current.delete(key)
          targetTracksRef.current.delete(key)
          interpTsRef.current.delete(key)
        })
        setLiveTracks(prev => {
          const next = new Map(prev)
          staleKeys.forEach(key => next.delete(key))
          if (isTrackingDiag() && next.size === 0 && prev.size > 0) {
            console.error(`[DIAG] ALL TRACKS REMOVED by TTL cleanup!  was=${prev.size}  t=${Date.now()}`)
          }
          return next
        })
      }
      // Prevent trackLastSeen map from growing without bound (raw MQTT ID churn).
      if (trackLastSeenRef.current.size > MAX_CLIENT_TRACKS * 2) {
        const liveKeys = new Set(liveTracksRef.current.keys())
        const sorted = [...trackLastSeenRef.current.entries()]
          .filter(([k]) => !liveKeys.has(k))
          .sort((a, b) => a[1] - b[1])
        const drop = Math.min(sorted.length, trackLastSeenRef.current.size - MAX_CLIENT_TRACKS)
        for (let i = 0; i < drop; i++) {
          const k = sorted[i][0]
          trackLastSeenRef.current.delete(k)
          targetTracksRef.current.delete(k)
          interpTsRef.current.delete(k)
        }
      }
    }, CLEANUP_INTERVAL_MS)

    return () => {
      if (removalFlushTimerRef.current != null) {
        window.clearTimeout(removalFlushTimerRef.current)
      }
      socket.disconnect()
      clearInterval(cleanupInterval)
      trackLastSeenRef.current.clear()
      pendingRemovalsRef.current.clear()
    }
  }, [applyVisualizationMode])

  useEffect(() => {
    if (venue?.id && isConnected) {
      subscribe(venue.id)
    }
  }, [venue?.id, isConnected, subscribe])

  // Frame-accurate occupancy from backend (not capped client track map size).
  useEffect(() => {
    if (!venue?.id || !isConnected) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tracking/venue/${venue.id}/status`)
        if (!res.ok || cancelled) return
        const data = await res.json()
        liveMetricsRef.current = {
          frameOccupancy: Number(data.frameOccupancy) || 0,
          liveFrameTs: data.liveFrameTs ?? null,
        }
      } catch { /* ignore */ }
    }
    poll()
    const iv = window.setInterval(poll, 1000)
    return () => { cancelled = true; window.clearInterval(iv) }
  }, [venue?.id, isConnected])

  const unsubscribe = useCallback((venueId: string) => {
    if (subscribedVenueRef.current === venueId) {
      socketRef.current?.emit('unsubscribe', { venueId })
      subscribedVenueRef.current = null
      setLiveTracks(new Map())
    }
  }, [])

  const setReplayMode = useCallback((enabled: boolean) => {
    setIsReplayMode(enabled)
    if (!enabled) {
      setReplayTracksState(new Map())
    }
  }, [])

  const setReplayTracks = useCallback((newTracks: Map<string, TrackWithTrail>) => {
    setReplayTracksState(newTracks)
  }, [])

  const seedInterpolationTargets = useCallback(() => {
    const now = Date.now()
    const source = isReplayModeRef.current ? replayTracksRef.current : liveTracksRef.current
    for (const [key, track] of source) {
      const { trail: _trail, ...base } = track
      targetTracksRef.current.set(key, base as Track)
      interpTsRef.current.set(key, now)
      trackLastSeenRef.current.set(key, now)
    }
  }, [])

  // Interpolation RAF loop — optional buffered delivery for live MQTT (off by default).
  // Throttled to ~30fps to halve React reconciliation load while staying visually smooth
  const interpLastFlushRef = useRef(0)
  const INTERP_MIN_INTERVAL = 33 // ~30fps cap
  
  const interpLoop = useCallback(() => {
    if (!interpEnabledRef.current) return

    const targets = targetTracksRef.current
    const now = Date.now()

    // Prune stale targets that haven't received an update within TTL
    for (const [key] of targets) {
      const lastSeen = trackLastSeenRef.current.get(key)
      if (lastSeen && now - lastSeen > TRACK_TTL_MS) {
        targets.delete(key)
        interpTsRef.current.delete(key)
        trackLastSeenRef.current.delete(key)
        if (isTrackingDiag()) console.log(`[DIAG] Interp pruned stale target  key=${key}  t=${now}`)
      }
    }

    if (targets.size === 0) {
      // Preserve tracks during brief gaps (e.g. Neural Dashboard enabling interpolation)
      if (liveTracksRef.current.size > 0 || isReplayModeRef.current) {
        interpRAFRef.current = requestAnimationFrame(interpLoop)
        return
      }
      setLiveTracks(prev => prev.size === 0 ? prev : new Map())
      interpRAFRef.current = requestAnimationFrame(interpLoop)
      return
    }
    
    // Skip this frame if we updated too recently
    if (now - interpLastFlushRef.current < INTERP_MIN_INTERVAL) {
      interpRAFRef.current = requestAnimationFrame(interpLoop)
      return
    }

      if (isTrackingDiag()) {
        const frameDelta = interpLastFlushRef.current > 0 ? now - interpLastFlushRef.current : 0
        diagInterpFrameCount++
        if (frameDelta > 200) {
        diagInterpDrops++
        console.warn(`[DIAG] Interp FRAME DROP  delta=${frameDelta}ms  targets=${targets.size}  drop#=${diagInterpDrops}  t=${now}`)
      }
      if (diagInterpFrameCount % 300 === 0) {
        console.log(`[DIAG] Interp heartbeat  frames=${diagInterpFrameCount}  drops=${diagInterpDrops}  targets=${targets.size}  t=${now}`)
      }
    }

    interpLastFlushRef.current = now
    
    interpFrameRef.current++
    const addTrail = interpFrameRef.current % INTERP_TRAIL_INTERVAL === 0
    
    setLiveTracks(prev => {
      const next = new Map<string, TrackWithTrail>()
      // Do NOT cap here — dropping tracks from React state caused cyclic vanish/reappear
      // and spoke artifacts when occupancy > INTERP_MAX_TRACKS. MainViewport caps meshes.
      const frameTargets = targets
      const lerpSpeed = vtlModeRef.current ? LERP_SPEED : LERP_SPEED_RAW

      if (isTrackingDiag()) {
        const countDiff = prev.size - diagLastTrackCount
        if (Math.abs(countDiff) > 5) {
          console.warn(`[DIAG] Track count JUMP  ${diagLastTrackCount} → ${prev.size}  (${countDiff > 0 ? '+' : ''}${countDiff})  t=${now}`)
        }
        diagLastTrackCount = prev.size
        if (targets.size > INTERP_MAX_TRACKS && diagInterpFrameCount % 300 === 0) {
          console.warn(`[DIAG] Interp cap  targets=${targets.size}  rendering=${frameTargets.size}  t=${now}`)
        }
      }
      
      // Only include tracks that exist in frameTargets — capped sticky set when over limit.
      for (const [key, target] of frameTargets) {
        if (!isFiniteTrackPos(target.venuePosition)) continue
        const baseX = target.venuePosition.x
        const baseZ = target.venuePosition.z
        const existing = prev.get(key)

        // Teleport / re-ID — snap instead of lerping across the store (spoke trails).
        const jumpResetM = vtlModeRef.current ? TRAIL_JUMP_RESET_M : 2.5
        if (existing && isFiniteTrackPos(existing.venuePosition)) {
          const jump = Math.hypot(baseX - existing.venuePosition.x, baseZ - existing.venuePosition.z)
          if (jump > jumpResetM) {
            next.set(key, {
              ...target,
              venuePosition: { x: baseX, y: 0, z: baseZ },
              trail: [{ x: baseX, y: 0, z: baseZ }],
            })
            continue
          }
        }

        // Raw bypass: no velocity extrap (MQTT positions are authoritative at 10 Hz).
        let tx = baseX
        let tz = baseZ
        if (vtlModeRef.current) {
          const { x: vx, z: vz } = clampPlanarVelocity(target.velocity)
          const receivedAt = interpTsRef.current.get(key) ?? now
          const extrapMs = Math.min(now - receivedAt, MAX_EXTRAP_MS)
          const dt = extrapMs * EXTRAP_FACTOR
          tx = baseX + vx * dt
          tz = baseZ + vz * dt
        }

        if (existing) {
          const cx = existing.venuePosition.x
          const cz = existing.venuePosition.z
          const nx = cx + (tx - cx) * lerpSpeed
          const nz = cz + (tz - cz) * lerpSpeed

          let trail = existing.trail || []
          if (addTrail) {
            trail = appendTrailPoint(trail, { x: nx, y: 0, z: nz }, maxTrailLength())
          }

          next.set(key, {
            ...target,
            venuePosition: { x: nx, y: 0, z: nz },
            trail,
          })
        } else {
          next.set(key, {
            ...target,
            venuePosition: { x: baseX, y: 0, z: baseZ },
            trail: [{ x: baseX, y: 0, z: baseZ }],
          })
        }
      }
      
      return next
    })
    
    interpRAFRef.current = requestAnimationFrame(interpLoop)
  }, [])

  const setInterpolation = useCallback((enabled: boolean) => {
    smoothMotionRequestedRef.current = enabled
    const historicalReplay = isReplayModeRef.current && !mqttReplayActiveRef.current
    const trackCount = liveTracksRef.current.size
    const shouldInterp =
      enabled &&
      !historicalReplay &&
      !mqttReplayActiveRef.current
    if (isTrackingDiag()) {
      console.log(
        `[DIAG] setInterpolation  enabled=${enabled}  active=${shouldInterp}  historicalReplay=${historicalReplay}  mqttReplay=${mqttReplayActiveRef.current}  tracks=${trackCount}  t=${Date.now()}`
      )
    }
    interpEnabledRef.current = shouldInterp
    if (shouldInterp) {
      seedInterpolationTargets()
      diagInterpFrameCount = 0
      diagInterpDrops = 0
      if (!interpRAFRef.current) {
        interpRAFRef.current = requestAnimationFrame(interpLoop)
      }
    } else {
      if (interpRAFRef.current) {
        cancelAnimationFrame(interpRAFRef.current)
        interpRAFRef.current = null
      }
      targetTracksRef.current.clear()
      interpTsRef.current.clear()
      interpFrameRef.current = 0
    }
  }, [interpLoop, seedInterpolationTargets])
  setInterpolationRef.current = setInterpolation

  const applyLiveTrackDelivery = useCallback(() => {
    const mode = readLiveTrackDelivery()
    smoothMotionRequestedRef.current = mode === 'buffered'
    setLiveTrackDeliveryState(mode)
    setInterpolation(mode === 'buffered')
  }, [setInterpolation])

  const setLiveTrackDelivery = useCallback((mode: LiveTrackDelivery) => {
    try {
      localStorage.setItem(LIVE_TRACK_DELIVERY_KEY, mode)
    } catch { /* private mode */ }
    smoothMotionRequestedRef.current = mode === 'buffered'
    setLiveTrackDeliveryState(mode)
    setInterpolation(mode === 'buffered')
  }, [setInterpolation])

  const purgeLiveEdgeTracks = useCallback(() => {
    for (const key of [...trackLastSeenRef.current.keys()]) {
      if (!key.startsWith('replay-')) trackLastSeenRef.current.delete(key)
    }
    for (const key of [...targetTracksRef.current.keys()]) {
      if (!key.startsWith('replay-')) targetTracksRef.current.delete(key)
    }
    for (const key of [...interpTsRef.current.keys()]) {
      if (!key.startsWith('replay-')) interpTsRef.current.delete(key)
    }
    setLiveTracks(prev => {
      let hasLive = false
      for (const key of prev.keys()) {
        if (!key.startsWith('replay-')) {
          hasLive = true
          break
        }
      }
      if (!hasLive) return prev
      const next = new Map<string, TrackWithTrail>()
      for (const [key, track] of prev) {
        if (key.startsWith('replay-')) next.set(key, track)
      }
      return next
    })
    window.dispatchEvent(new CustomEvent('hyperspace:live-tracks-hidden'))
  }, [])

  const setMqttReplayActive = useCallback((active: boolean) => {
    mqttReplayActiveRef.current = active
    setMqttReplayActiveState(active)
    if (active) {
      // JSONL/reconciled replay uses live socket snapshots — insight/timeline DB tracks must not block.
      setReplayTracksState(new Map())
      purgeLiveEdgeTracks()
    } else if (isReplayModeRef.current) {
      // After MQTT replay stops, resume live edge tracks (don't leave historical snapshot blocking socket).
      setIsReplayMode(false)
      setReplayTracksState(new Map())
    }
    setInterpolationRef.current(smoothMotionRequestedRef.current)
  }, [purgeLiveEdgeTracks])

  // Keep mqttReplayActive in sync when replay runs server-side (ReplayPanel may be closed).
  useEffect(() => {
    if (!venue?.id) return
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/replay/status`)
        if (!res.ok || cancelled) return
        const status = await res.json()
        const running = !!status.running
        if (running !== mqttReplayActiveRef.current) {
          setMqttReplayActive(running)
        }
        if (!running && demoSessionIdRef.current) {
          demoSessionIdRef.current = null
          setDemoSessionId(null)
        }
      } catch { /* ignore */ }
    }
    poll()
    const iv = window.setInterval(poll, 3000)
    return () => { cancelled = true; window.clearInterval(iv) }
  }, [venue?.id, setMqttReplayActive])

  const startDemoSession = useCallback(async (venueId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/demo/sessions/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ venueId }),
      })
      if (!res.ok) {
        console.warn('[DemoSession] start failed', res.status)
        return null
      }
      const data = await res.json()
      const sessionId = data.sessionId as string
      demoSessionIdRef.current = sessionId
      setDemoSessionId(sessionId)
      return sessionId
    } catch (err) {
      console.warn('[DemoSession] start error', err)
      return null
    }
  }, [])

  const stopDemoSession = useCallback(async () => {
    const sessionId = demoSessionIdRef.current
    if (!sessionId) return
    demoSessionIdRef.current = null
    setDemoSessionId(null)
    try {
      await fetch(`${API_BASE}/api/demo/sessions/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
    } catch (err) {
      console.warn('[DemoSession] stop error', err)
    }
  }, [])

  const setTrackVisibility = useCallback((visible: boolean) => {
    socketRef.current?.emit('track_visibility', { visible })
  }, [])

  const clearReplayTracks = useCallback(() => {
    const purge = (keys: Iterable<string>) => {
      for (const key of keys) {
        if (key.startsWith('replay-')) {
          trackLastSeenRef.current.delete(key)
          targetTracksRef.current.delete(key)
          interpTsRef.current.delete(key)
        }
      }
    }
    purge(trackLastSeenRef.current.keys())
    purge(targetTracksRef.current.keys())
    setLiveTracks(prev => {
      let changed = false
      const next = new Map<string, TrackWithTrail>()
      for (const [key, track] of prev) {
        if (key.startsWith('replay-')) {
          changed = true
        } else {
          next.set(key, track)
        }
      }
      return changed ? next : prev
    })
    window.dispatchEvent(new CustomEvent('hyperspace:replay-tracks-cleared'))
  }, [])

  const contextValue = useMemo(() => ({ 
    tracks, 
    isConnected, 
    isReplayMode,
    subscribe, 
    unsubscribe,
    setReplayMode,
    setReplayTracks,
    setTrackVisibility,
    setInterpolation,
    setVisualizationMode,
    setMqttReplayActive,
    clearReplayTracks,
    mqttReplayActive,
    useHistoricalTracks,
    demoSessionId,
    liveTrackDelivery,
  }), [tracks, isConnected, isReplayMode, mqttReplayActive, useHistoricalTracks, demoSessionId, liveTrackDelivery, subscribe, unsubscribe, setReplayMode, setReplayTracks, setTrackVisibility, setInterpolation, setVisualizationMode, setMqttReplayActive, clearReplayTracks])

  const actionsValue = useMemo(() => ({
    subscribe,
    unsubscribe,
    setReplayMode,
    setReplayTracks,
    setTrackVisibility,
    setInterpolation,
    setVisualizationMode,
    setMqttReplayActive,
    clearReplayTracks,
    setLiveTrackDelivery,
    applyLiveTrackDelivery,
    startDemoSession,
    stopDemoSession,
  }), [subscribe, unsubscribe, setReplayMode, setReplayTracks, setTrackVisibility, setInterpolation, setVisualizationMode, setMqttReplayActive, clearReplayTracks, setLiveTrackDelivery, applyLiveTrackDelivery, startDemoSession, stopDemoSession])

  return (
    <TracksRefContext.Provider value={stableTracksRef}>
      <LiveMetricsRefContext.Provider value={liveMetricsRef}>
      <VtlModeRefContext.Provider value={vtlModeRef}>
      <TrackingActionsContext.Provider value={actionsValue}>
        <TrackingContext.Provider value={contextValue}>
          {children}
        </TrackingContext.Provider>
      </TrackingActionsContext.Provider>
      </VtlModeRefContext.Provider>
      </LiveMetricsRefContext.Provider>
    </TracksRefContext.Provider>
  )
}

export function useTracking() {
  const context = useContext(TrackingContext)
  if (!context) {
    throw new Error('useTracking must be used within a TrackingProvider')
  }
  return context
}

/**
 * Returns stable action callbacks only — never re-renders due to tracks changes.
 * Use in components that need to *control* tracking (toggle visibility, enable
 * interpolation, etc.) without subscribing to track data.
 */
export function useTrackingActions() {
  const ctx = useContext(TrackingActionsContext)
  if (!ctx) {
    throw new Error('useTrackingActions must be used within a TrackingProvider')
  }
  return ctx
}

/**
 * Returns a stable ref to the latest tracks Map.
 * Components using this hook will NOT re-render when tracks change — 
 * they should read ref.current inside their own intervals/callbacks.
 * Use this for dashboard panels that poll tracks at low frequency (1-2fps).
 */
export function useTracksRef() {
  const ref = useContext(TracksRefContext)
  if (!ref) {
    throw new Error('useTracksRef must be used within a TrackingProvider')
  }
  return ref
}

/** Frame-accurate occupancy (matches fast3dis / edge activePeopleCount). */
export function useLiveMetricsRef() {
  const ref = useContext(LiveMetricsRefContext)
  if (!ref) {
    throw new Error('useLiveMetricsRef must be used within a TrackingProvider')
  }
  return ref
}

/** True when Trajectory Quality reconciler preset is active (VTL visualization). */
export function useVtlModeRef() {
  const ref = useContext(VtlModeRefContext)
  if (!ref) {
    throw new Error('useVtlModeRef must be used within a TrackingProvider')
  }
  return ref
}
