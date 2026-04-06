import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { Track, TrackWithTrail, LidarStatus } from '../types'
import { useVenue } from './VenueContext'
import { API_BASE } from '../config/api'

const MAX_TRAIL_LENGTH = 50 // ~5 seconds at 10Hz (reduced from 100 to save memory)
const TRACK_TTL_MS = 20000 // 20s — generous margin to survive backend event-loop stalls without removing tracks
const CLEANUP_INTERVAL_MS = 1000 // Cleanup stale tracks every 1 second
const LERP_SPEED = 0.18 // Exponential smoothing factor per frame
const EXTRAP_FACTOR = 0.001 // Velocity extrapolation: m/s → m/frame (tuned for 60fps)
const INTERP_TRAIL_INTERVAL = 3 // Add trail point every N interpolation frames

// Diagnostic logging — filter browser console with "[DIAG]"
const DIAG = true
let diagLastTrackCount = 0
let diagLastSocketTs = 0
let diagInterpFrameCount = 0
let diagInterpDrops = 0

interface TrackingContextType {
  tracks: Map<string, TrackWithTrail>
  isConnected: boolean
  isReplayMode: boolean
  subscribe: (venueId: string) => void
  unsubscribe: (venueId: string) => void
  setReplayMode: (enabled: boolean) => void
  setReplayTracks: (tracks: Map<string, TrackWithTrail>) => void
  setTrackVisibility: (visible: boolean) => void
  setInterpolation: (enabled: boolean) => void
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
}
const TrackingActionsContext = createContext<TrackingActionsType | null>(null)

/**
 * Stable ref context — provides a ref to the latest tracks Map without triggering
 * re-renders when tracks change. Dashboard panels that only need tracks in throttled
 * intervals should use useTracksRef() instead of useTracking().
 */
const TracksRefContext = createContext<React.MutableRefObject<Map<string, TrackWithTrail>> | null>(null)

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { venue } = useVenue()
  const [liveTracks, setLiveTracks] = useState<Map<string, TrackWithTrail>>(new Map())
  const [replayTracks, setReplayTracksState] = useState<Map<string, TrackWithTrail>>(new Map())
  const [isConnected, setIsConnected] = useState(false)
  const [isReplayMode, setIsReplayMode] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const subscribedVenueRef = useRef<string | null>(null)
  const trackLastSeenRef = useRef<Map<string, number>>(new Map())
  
  // Interpolation state (only active when Neural Dashboard enables it)
  const interpEnabledRef = useRef(false)
  const interpRAFRef = useRef<number | null>(null)
  const interpFrameRef = useRef(0)
  // Target positions from socket — extrapolated using velocity between updates
  const targetTracksRef = useRef<Map<string, Track>>(new Map())
  // Timestamp when each target was received (for velocity extrapolation)
  const interpTsRef = useRef<Map<string, number>>(new Map())
  
  // Return replay tracks when in replay mode, otherwise live tracks
  const tracks = isReplayMode ? replayTracks : liveTracks
  
  // Stable ref always points to latest tracks — consumers using useTracksRef() 
  // won't re-render when tracks change
  const stableTracksRef = useRef(tracks)
  stableTracksRef.current = tracks

  useEffect(() => {
    const socket = io(`${API_BASE}/tracking`, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    })

    socket.on('connect', () => {
      if (DIAG) console.log(`[DIAG] Socket CONNECTED  id=${socket.id}  t=${Date.now()}`)
      setIsConnected(true)
      if (subscribedVenueRef.current) {
        socket.emit('subscribe', { venueId: subscribedVenueRef.current })
      }
    })

    socket.on('disconnect', (reason) => {
      if (DIAG) console.warn(`[DIAG] Socket DISCONNECTED  reason="${reason}"  t=${Date.now()}`)
      setIsConnected(false)
    })

    socket.io.on('reconnect_attempt', (attempt) => {
      if (DIAG) console.warn(`[DIAG] Socket RECONNECT attempt #${attempt}  t=${Date.now()}`)
    })

    // Throttle track updates to reduce memory pressure (target ~15fps instead of 30fps)
    let pendingBatches: Track[][] = []
    let lastFlushTime = 0
    const MIN_FLUSH_INTERVAL = 66 // ~15fps max update rate (was ~30fps)
    
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
        latestByKey.set(track.trackKey, track)
      }
      pendingBatches = []
      
      setLiveTracks(prev => {
        const next = new Map<string, TrackWithTrail>()
        
        for (const [key, track] of latestByKey) {
          const existing = prev.get(key)
          const oldTrail = existing?.trail || []
          let trail = [...oldTrail, { ...track.venuePosition }]
          if (trail.length > MAX_TRAIL_LENGTH) {
            trail = trail.slice(trail.length - MAX_TRAIL_LENGTH)
          }
          
          next.set(key, { ...track, trail })
          trackLastSeenRef.current.set(key, now)
        }

        if (DIAG && prev.size !== next.size) {
          const removed = [...prev.keys()].filter(k => !next.has(k))
          if (removed.length > 0) {
            console.log(`[DIAG] Snapshot reconciliation removed ${removed.length} stale tracks: ${removed.join(', ')}  t=${now}`)
          }
        }
        
        return next
      })
    }
    
    socket.on('tracks', (data: { venueId: string, tracks: Track[] }) => {
      if (data.venueId !== subscribedVenueRef.current) return
      if (isReplayMode) return

      const now = Date.now()

      if (DIAG) {
        const gap = diagLastSocketTs ? now - diagLastSocketTs : 0
        diagLastSocketTs = now
        if (gap > 2000) {
          console.warn(`[DIAG] Socket tracks GAP  ${gap}ms since last emission  n=${data.tracks.length}  t=${now}`)
        }
      }
      
      if (interpEnabledRef.current) {
        // Build a Set of trackKeys in this snapshot to prune stale targets
        const incomingKeys = new Set<string>()
        for (const track of data.tracks) {
          targetTracksRef.current.set(track.trackKey, track)
          interpTsRef.current.set(track.trackKey, now)
          trackLastSeenRef.current.set(track.trackKey, now)
          incomingKeys.add(track.trackKey)
        }
        // Remove targets missing from this full snapshot for longer than the
        // aggregator TTL (6s) + a small buffer.  The aggregator emits a complete
        // set every 100ms, so a track absent for >7s is genuinely gone.
        const INTERP_MISSING_GRACE_MS = 7000
        for (const key of targetTracksRef.current.keys()) {
          if (!incomingKeys.has(key)) {
            const lastSeen = trackLastSeenRef.current.get(key) ?? 0
            if (now - lastSeen > INTERP_MISSING_GRACE_MS) {
              targetTracksRef.current.delete(key)
              interpTsRef.current.delete(key)
              trackLastSeenRef.current.delete(key)
              if (DIAG) console.log(`[DIAG] Interp removed missing target  key=${key}  age=${now - lastSeen}ms  t=${now}`)
            }
          }
        }
      } else {
        pendingBatches.push(data.tracks)
        requestAnimationFrame(flushTrackUpdates)
      }
    })

    socket.on('track_removed', (data: { trackKey: string }) => {
      if (isReplayMode) return
      if (DIAG) console.log(`[DIAG] track_removed event  key=${data.trackKey}  t=${Date.now()}`)
      setLiveTracks(prev => {
        const next = new Map(prev)
        next.delete(data.trackKey)
        return next
      })
      trackLastSeenRef.current.delete(data.trackKey)
      targetTracksRef.current.delete(data.trackKey)
      interpTsRef.current.delete(data.trackKey)
    })

    socket.on('tracks_cleared', () => {
      if (isReplayMode) return
      if (DIAG) console.log(`[DIAG] tracks_cleared event  t=${Date.now()}`)
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
      const staleKeys: string[] = []
      
      trackLastSeenRef.current.forEach((lastSeen, key) => {
        if (now - lastSeen > TRACK_TTL_MS) {
          staleKeys.push(key)
        }
      })
      
      if (staleKeys.length > 0) {
        if (DIAG) {
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
          if (DIAG && next.size === 0 && prev.size > 0) {
            console.error(`[DIAG] ALL TRACKS REMOVED by TTL cleanup!  was=${prev.size}  t=${Date.now()}`)
          }
          return next
        })
      }
    }, CLEANUP_INTERVAL_MS)

    return () => {
      socket.disconnect()
      clearInterval(cleanupInterval)
      trackLastSeenRef.current.clear()
    }
  }, [isReplayMode])

  useEffect(() => {
    if (venue?.id && socketRef.current?.connected) {
      subscribe(venue.id)
    }
  }, [venue?.id])

  const subscribe = useCallback((venueId: string) => {
    if (subscribedVenueRef.current) {
      socketRef.current?.emit('unsubscribe', { venueId: subscribedVenueRef.current })
    }
    subscribedVenueRef.current = venueId
    socketRef.current?.emit('subscribe', { venueId })
    setLiveTracks(new Map())
  }, [])

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

  const setTrackVisibility = useCallback((visible: boolean) => {
    socketRef.current?.emit('track_visibility', { visible })
  }, [])

  // Interpolation RAF loop — only runs when Neural Dashboard enables it
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
        if (DIAG) console.log(`[DIAG] Interp pruned stale target  key=${key}  t=${now}`)
      }
    }

    if (targets.size === 0) {
      // No active targets — clear any leftover liveTracks from interpolation
      setLiveTracks(prev => prev.size === 0 ? prev : new Map())
      interpRAFRef.current = requestAnimationFrame(interpLoop)
      return
    }
    
    // Skip this frame if we updated too recently
    if (now - interpLastFlushRef.current < INTERP_MIN_INTERVAL) {
      interpRAFRef.current = requestAnimationFrame(interpLoop)
      return
    }

    if (DIAG) {
      const frameDelta = now - interpLastFlushRef.current
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

      if (DIAG) {
        const countDiff = prev.size - diagLastTrackCount
        if (Math.abs(countDiff) > 5) {
          console.warn(`[DIAG] Track count JUMP  ${diagLastTrackCount} → ${prev.size}  (${countDiff > 0 ? '+' : ''}${countDiff})  t=${now}`)
        }
        diagLastTrackCount = prev.size
      }
      
      // Only include tracks that exist in targetTracksRef — this is the
      // authoritative set of active tracks when interpolation is on.
      for (const [key, target] of targets) {
        const baseX = target.venuePosition?.x ?? 0
        const baseZ = target.venuePosition?.z ?? 0
        const vx = target.velocity?.x ?? 0
        const vz = target.velocity?.z ?? 0
        
        const receivedAt = interpTsRef.current.get(key) ?? now
        const dt = (now - receivedAt) * EXTRAP_FACTOR
        const tx = baseX + vx * dt
        const tz = baseZ + vz * dt
        
        const existing = prev.get(key)
        
        if (existing) {
          const cx = existing.venuePosition.x
          const cz = existing.venuePosition.z
          const nx = cx + (tx - cx) * LERP_SPEED
          const nz = cz + (tz - cz) * LERP_SPEED
          
          let trail: { x: number; y: number; z: number }[]
          if (addTrail) {
            trail = existing.trail ? [...existing.trail, { x: nx, y: 0, z: nz }] : [{ x: nx, y: 0, z: nz }]
            if (trail.length > MAX_TRAIL_LENGTH) trail = trail.slice(trail.length - MAX_TRAIL_LENGTH)
          } else {
            trail = existing.trail || []
          }
          
          next.set(key, {
            ...target,
            venuePosition: { x: nx, y: 0, z: nz },
            trail,
          })
        } else {
          next.set(key, { ...target, trail: [{ x: baseX, y: 0, z: baseZ }] })
        }
      }
      
      return next
    })
    
    interpRAFRef.current = requestAnimationFrame(interpLoop)
  }, [])

  const setInterpolation = useCallback((enabled: boolean) => {
    if (DIAG) console.log(`[DIAG] setInterpolation  enabled=${enabled}  t=${Date.now()}`)
    interpEnabledRef.current = enabled
    if (enabled) {
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
  }, [interpLoop])

  const contextValue = useMemo(() => ({ 
    tracks, 
    isConnected, 
    isReplayMode,
    subscribe, 
    unsubscribe,
    setReplayMode,
    setReplayTracks,
    setTrackVisibility,
    setInterpolation
  }), [tracks, isConnected, isReplayMode, subscribe, unsubscribe, setReplayMode, setReplayTracks, setTrackVisibility, setInterpolation])

  const actionsValue = useMemo(() => ({
    subscribe,
    unsubscribe,
    setReplayMode,
    setReplayTracks,
    setTrackVisibility,
    setInterpolation
  }), [subscribe, unsubscribe, setReplayMode, setReplayTracks, setTrackVisibility, setInterpolation])

  return (
    <TracksRefContext.Provider value={stableTracksRef}>
      <TrackingActionsContext.Provider value={actionsValue}>
        <TrackingContext.Provider value={contextValue}>
          {children}
        </TrackingContext.Provider>
      </TrackingActionsContext.Provider>
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
