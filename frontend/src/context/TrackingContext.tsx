import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react'
import { io, Socket } from 'socket.io-client'
import { Track, TrackWithTrail, LidarStatus } from '../types'
import { useVenue } from './VenueContext'

const MAX_TRAIL_LENGTH = 100 // ~10 seconds at 10Hz
const TRACK_TTL_MS = 5000 // 5 seconds before track is removed
const CLEANUP_INTERVAL_MS = 1000 // Cleanup stale tracks every 1 second

interface TrackingContextType {
  tracks: Map<string, TrackWithTrail>
  isConnected: boolean
  isReplayMode: boolean
  subscribe: (venueId: string) => void
  unsubscribe: (venueId: string) => void
  setReplayMode: (enabled: boolean) => void
  setReplayTracks: (tracks: Map<string, TrackWithTrail>) => void
}

const TrackingContext = createContext<TrackingContextType | null>(null)

export function TrackingProvider({ children }: { children: ReactNode }) {
  const { venue } = useVenue()
  const [liveTracks, setLiveTracks] = useState<Map<string, TrackWithTrail>>(new Map())
  const [replayTracks, setReplayTracksState] = useState<Map<string, TrackWithTrail>>(new Map())
  const [isConnected, setIsConnected] = useState(false)
  const [isReplayMode, setIsReplayMode] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const subscribedVenueRef = useRef<string | null>(null)
  const trackLastSeenRef = useRef<Map<string, number>>(new Map())
  
  // Return replay tracks when in replay mode, otherwise live tracks
  const tracks = isReplayMode ? replayTracks : liveTracks

  useEffect(() => {
    const socket = io('http://localhost:3001/tracking', {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    })

    socket.on('connect', () => {
      setIsConnected(true)
      if (subscribedVenueRef.current) {
        socket.emit('subscribe', { venueId: subscribedVenueRef.current })
      }
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
    })

    // Throttle track updates to avoid overwhelming React
    let pendingTracks: Track[] = []
    let updateScheduled = false
    
    const flushTrackUpdates = () => {
      if (pendingTracks.length === 0) return
      
      const tracksToProcess = pendingTracks
      pendingTracks = []
      updateScheduled = false
      
      const now = Date.now()
      setLiveTracks(prev => {
        const next = new Map(prev)
        
        for (const track of tracksToProcess) {
          const existing = next.get(track.trackKey)
          const trail = existing?.trail || []
          
          trail.push({ ...track.venuePosition })
          if (trail.length > MAX_TRAIL_LENGTH) {
            trail.shift()
          }
          
          next.set(track.trackKey, { ...track, trail })
          
          // Update last seen timestamp (no timeout creation)
          trackLastSeenRef.current.set(track.trackKey, now)
        }
        
        return next
      })
    }
    
    socket.on('tracks', (data: { venueId: string, tracks: Track[] }) => {
      if (data.venueId !== subscribedVenueRef.current) return
      
      // Skip live updates when in replay mode
      if (isReplayMode) return
      
      // Buffer tracks and throttle updates to ~30fps max
      pendingTracks.push(...data.tracks)
      
      if (!updateScheduled) {
        updateScheduled = true
        requestAnimationFrame(flushTrackUpdates)
      }
    })

    socket.on('track_removed', (data: { trackKey: string }) => {
      if (isReplayMode) return
      setLiveTracks(prev => {
        const next = new Map(prev)
        next.delete(data.trackKey)
        return next
      })
      trackLastSeenRef.current.delete(data.trackKey)
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
        setLiveTracks(prev => {
          const next = new Map(prev)
          staleKeys.forEach(key => {
            next.delete(key)
            trackLastSeenRef.current.delete(key)
          })
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

  return (
    <TrackingContext.Provider value={{ 
      tracks, 
      isConnected, 
      isReplayMode,
      subscribe, 
      unsubscribe,
      setReplayMode,
      setReplayTracks
    }}>
      {children}
    </TrackingContext.Provider>
  )
}

export function useTracking() {
  const context = useContext(TrackingContext)
  if (!context) {
    throw new Error('useTracking must be used within a TrackingProvider')
  }
  return context
}
