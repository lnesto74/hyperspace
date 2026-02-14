import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001'

interface PlaylistItem {
  videoId: string
  filePath: string
  durationMs: number
  name: string
}

interface ScreenVideoState {
  video: HTMLVideoElement
  texture: THREE.VideoTexture
  playlist: PlaylistItem[]
  currentIndex: number
  loopCount: number
  startTs: number
  isPlaying: boolean
}

interface UseDoohVideoPlayerProps {
  venueId: string | undefined
  screenIds: string[]
  enabled: boolean
}

export function useDoohVideoPlayer({ venueId, screenIds, enabled }: UseDoohVideoPlayerProps) {
  const screenVideosRef = useRef<Map<string, ScreenVideoState>>(new Map())
  const clientId = useRef(`client-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  // Log proof of play to backend
  const logProofOfPlay = useCallback(async (
    screenId: string,
    videoId: string,
    startTs: number,
    endTs: number,
    loopIndex: number,
    playbackStatus: 'completed' | 'interrupted' = 'completed'
  ) => {
    if (!venueId) return
    
    try {
      await fetch(`${API_BASE}/api/dooh/proof-of-play`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          venueId,
          screenId,
          videoId,
          startTs,
          endTs,
          loopIndex,
          playbackStatus,
          clientId: clientId.current,
        }),
      })
    } catch (err) {
      console.error('Failed to log proof of play:', err)
    }
  }, [venueId])

  // Fetch playlist for a screen
  const fetchPlaylist = useCallback(async (screenId: string): Promise<PlaylistItem[]> => {
    try {
      const res = await fetch(`${API_BASE}/api/dooh/screens/${screenId}/playlist`)
      if (!res.ok) return []
      
      const data = await res.json()
      return (data.playlist || []).map((item: any) => ({
        videoId: item.videoId,
        filePath: item.video.filePath,
        durationMs: item.video.durationMs,
        name: item.video.name,
      }))
    } catch (err) {
      console.error('Failed to fetch playlist:', err)
      return []
    }
  }, [])

  // Initialize video player for a screen
  const initScreenVideo = useCallback(async (screenId: string): Promise<ScreenVideoState | null> => {
    const playlist = await fetchPlaylist(screenId)
    if (playlist.length === 0) return null

    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.loop = false // We handle looping manually for proof-of-play
    video.muted = true // Required for autoplay
    video.playsInline = true
    video.preload = 'auto'

    const texture = new THREE.VideoTexture(video)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.colorSpace = THREE.SRGBColorSpace

    const state: ScreenVideoState = {
      video,
      texture,
      playlist,
      currentIndex: 0,
      loopCount: 0,
      startTs: 0,
      isPlaying: false,
    }

    // Handle video ended - move to next in playlist
    video.onended = () => {
      const endTs = Date.now()
      const currentItem = state.playlist[state.currentIndex]
      
      // Log proof of play
      if (currentItem) {
        logProofOfPlay(screenId, currentItem.videoId, state.startTs, endTs, state.loopCount)
      }

      // Move to next video
      state.currentIndex = (state.currentIndex + 1) % state.playlist.length
      if (state.currentIndex === 0) {
        state.loopCount++
      }

      // Play next video
      playCurrentVideo(state, screenId)
    }

    video.onerror = (e) => {
      console.error('Video error:', e)
      // Try next video on error
      state.currentIndex = (state.currentIndex + 1) % state.playlist.length
      playCurrentVideo(state, screenId)
    }

    return state
  }, [fetchPlaylist, logProofOfPlay])

  // Play current video in playlist
  const playCurrentVideo = useCallback((state: ScreenVideoState, screenId: string) => {
    const currentItem = state.playlist[state.currentIndex]
    if (!currentItem) return

    state.video.src = `${API_BASE}${currentItem.filePath}`
    state.startTs = Date.now()
    state.isPlaying = true
    
    state.video.play().catch(err => {
      console.error('Failed to play video:', err)
    })
  }, [])

  // Get texture for a screen (to be used by MainViewport)
  const getScreenTexture = useCallback((screenId: string): THREE.VideoTexture | null => {
    const state = screenVideosRef.current.get(screenId)
    return state?.texture || null
  }, [])

  // Check if screen has video
  const screenHasVideo = useCallback((screenId: string): boolean => {
    return screenVideosRef.current.has(screenId)
  }, [])

  // Initialize videos for all screens
  useEffect(() => {
    if (!enabled || !venueId || screenIds.length === 0) return

    const initAll = async () => {
      for (const screenId of screenIds) {
        if (!screenVideosRef.current.has(screenId)) {
          const state = await initScreenVideo(screenId)
          if (state) {
            screenVideosRef.current.set(screenId, state)
            playCurrentVideo(state, screenId)
          }
        }
      }
    }

    initAll()

    // Cleanup
    return () => {
      screenVideosRef.current.forEach((state, screenId) => {
        // Log interrupted playback
        if (state.isPlaying) {
          const currentItem = state.playlist[state.currentIndex]
          if (currentItem) {
            logProofOfPlay(screenId, currentItem.videoId, state.startTs, Date.now(), state.loopCount, 'interrupted')
          }
        }
        
        state.video.pause()
        state.video.src = ''
        state.video.load()
        state.texture.dispose()
      })
      screenVideosRef.current.clear()
    }
  }, [enabled, venueId, screenIds, initScreenVideo, playCurrentVideo, logProofOfPlay])

  // Pause/resume based on visibility
  useEffect(() => {
    const handleVisibility = () => {
      screenVideosRef.current.forEach((state) => {
        if (document.hidden) {
          state.video.pause()
        } else if (state.isPlaying) {
          state.video.play().catch(() => {})
        }
      })
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  return {
    getScreenTexture,
    screenHasVideo,
    refreshPlaylist: async (screenId: string) => {
      const existingState = screenVideosRef.current.get(screenId)
      if (existingState) {
        // Cleanup existing
        existingState.video.pause()
        existingState.video.src = ''
        existingState.texture.dispose()
        screenVideosRef.current.delete(screenId)
      }
      
      // Re-initialize
      const state = await initScreenVideo(screenId)
      if (state) {
        screenVideosRef.current.set(screenId, state)
        playCurrentVideo(state, screenId)
      }
    },
  }
}
