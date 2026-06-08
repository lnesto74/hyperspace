/**
 * InsightModeOverlay
 *
 * Top bar shown when the user enters Insight Mode.
 * Shows episode title, time, playback controls, and progress.
 * Implements animated track playback through historical positions.
 */

import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import { X, Play, Pause, RotateCcw } from 'lucide-react'
import { useReplayInsight } from '../../context/ReplayInsightContext'
import { useTrackingActions } from '../../context/TrackingContext'
import { useVenue } from '../../context/VenueContext'
import { API_BASE } from '../../config/api'

type TrackPosition = { timestamp: number; x: number; z: number; vx?: number; vz?: number; roiId?: string }

/** Pass-by / shelf episodes — sparse 1–2 point tracks per visitor. */
const SPARSE_ZONE_EPISODES = new Set([
  'HIGH_PASSBY_LOW_BROWSE',
  'BROWSE_NO_CONVERT_PROXY',
  'PLACEMENT_PENALTY_CLUSTER',
  'BRAND_UNFAIRNESS',
  'CATEGORY_SPIKE_FROM_LAYOUT',
])

function isSparseZoneClip(episode: { episode_type?: string; scope?: string } | null | undefined) {
  if (!episode) return false
  if (episode.scope === 'zone') return true
  return SPARSE_ZONE_EPISODES.has(episode.episode_type || '')
}

function positionsFromApiTracks(
  tracks: Record<string, Array<{ timestamp: number; x: number; z: number; vx?: number; vz?: number }>>,
): Map<string, TrackPosition[]> {
  const data = new Map<string, TrackPosition[]>()
  for (const [trackKey, positions] of Object.entries(tracks || {})) {
    if (!positions?.length) continue
    data.set(trackKey, positions.map(p => ({
      timestamp: p.timestamp,
      x: p.x,
      z: p.z,
      vx: p.vx,
      vz: p.vz,
    })))
  }
  return data
}

function positionsFromEpisode(
  trackPositions: Record<string, TrackPosition[]> | undefined,
): Map<string, TrackPosition[]> {
  const data = new Map<string, TrackPosition[]>()
  if (!trackPositions) return data
  for (const [trackKey, positions] of Object.entries(trackPositions)) {
    if (Array.isArray(positions) && positions.length > 0) data.set(trackKey, positions)
  }
  return data
}

export default function InsightModeOverlay() {
  const {
    selectedEpisode,
    isInsightMode,
    exitInsightMode,
  } = useReplayInsight()

  const { venue } = useVenue()
  const { setReplayMode, setReplayTracks, setInsightReplayActive } = useTrackingActions()

  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [fetchedTrackData, setFetchedTrackData] = useState<Map<string, TrackPosition[]>>(new Map())
  const animationRef = useRef<number | null>(null)
  const lastFrameTimeRef = useRef<number>(0)

  // Prefer embedded clip positions; fall back to venue trajectories API for the replay window.
  useEffect(() => {
    if (!isInsightMode || !selectedEpisode) {
      setFetchedTrackData(new Map())
      return
    }

    const embedded = positionsFromEpisode(selectedEpisode.track_positions as Record<string, TrackPosition[]>)
    if (embedded.size > 0) {
      setFetchedTrackData(new Map())
      return
    }

    const win = selectedEpisode.replay_window
    if (!venue?.id || !win?.start || !win?.end) return

    let cancelled = false
    fetch(`${API_BASE}/api/venues/${venue.id}/trajectories?start=${win.start}&end=${win.end}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data?.tracks) return
        setFetchedTrackData(positionsFromApiTracks(data.tracks))
      })
      .catch(err => console.warn('[InsightModeOverlay] trajectory fallback failed:', err))

    return () => { cancelled = true }
  }, [isInsightMode, selectedEpisode, venue?.id])

  const trackData = useMemo(() => {
    const embedded = positionsFromEpisode(selectedEpisode?.track_positions as Record<string, TrackPosition[]>)
    if (embedded.size > 0) return embedded
    return fetchedTrackData
  }, [selectedEpisode?.track_positions, fetchedTrackData])

  const sparsePassBy = isSparseZoneClip(selectedEpisode)

  const { minTime, maxTime, duration } = useMemo(() => {
    const win = selectedEpisode?.replay_window
    // Zone pass-by clips: scrub across the full episode window so visitors appear over time,
    // not crammed into the timestamp span of the capped 40-track sample.
    if (sparsePassBy && win?.start && win?.end && win.end > win.start) {
      return { minTime: win.start, maxTime: win.end, duration: win.end - win.start }
    }

    let min = Infinity
    let max = -Infinity
    for (const positions of trackData.values()) {
      for (const p of positions) {
        if (p.timestamp < min) min = p.timestamp
        if (p.timestamp > max) max = p.timestamp
      }
    }
    return {
      minTime: min === Infinity ? 0 : min,
      maxTime: max === -Infinity ? 0 : max,
      duration: min === Infinity ? 0 : max - min,
    }
  }, [trackData, sparsePassBy, selectedEpisode?.replay_window])

  /** How long (real ms) a sparse pass-by track stays visible during replay. */
  const passByVisibilityMs = useMemo(() => {
    if (!sparsePassBy || duration === 0) return Infinity
    return Math.min(45_000, Math.max(12_000, duration * 0.04))
  }, [sparsePassBy, duration])

  const getPositionAtTime = useCallback((positions: TrackPosition[], time: number): TrackPosition | null => {
    if (positions.length === 0) return null
    if (time < positions[0].timestamp) return null
    if (positions.length === 1) return positions[0]
    if (time >= positions[positions.length - 1].timestamp) return positions[positions.length - 1]

    let lo = 0
    let hi = positions.length - 1
    while (lo < hi - 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (positions[mid].timestamp <= time) lo = mid
      else hi = mid
    }

    const p1 = positions[lo]
    const p2 = positions[hi]
    const t = (time - p1.timestamp) / (p2.timestamp - p1.timestamp)

    return {
      timestamp: time,
      x: p1.x + (p2.x - p1.x) * t,
      z: p1.z + (p2.z - p1.z) * t,
      vx: p1.vx,
      vz: p1.vz,
    }
  }, [])

  const isTrackVisibleAtTime = useCallback((
    positions: TrackPosition[],
    time: number,
    sparse: boolean,
    visibilityMs: number,
  ): boolean => {
    if (positions.length === 0) return false
    const first = positions[0].timestamp
    const last = positions[positions.length - 1].timestamp

    if (!sparse) {
      return time >= first
    }

    if (positions.length === 1) {
      return Math.abs(time - first) <= visibilityMs / 2
    }

    const pad = visibilityMs / 4
    return time >= first - pad && time <= last + pad
  }, [])

  const updateTracksAtProgress = useCallback((prog: number) => {
    if (trackData.size === 0 || duration === 0) return

    const currentTime = minTime + prog * duration
    const trackMap = new Map()

    for (const [trackKey, positions] of trackData) {
      if (!isTrackVisibleAtTime(positions, currentTime, sparsePassBy, passByVisibilityMs)) continue

      const pos = getPositionAtTime(positions, currentTime)
      if (!pos) continue

      const trail = positions
        .filter(p => p.timestamp <= currentTime)
        .map(p => ({ x: p.x, y: 0, z: p.z }))

      trackMap.set(trackKey, {
        id: trackKey,
        trackKey,
        deviceId: 'insight-replay',
        timestamp: pos.timestamp,
        position: { x: pos.x, y: 0, z: pos.z },
        venuePosition: { x: pos.x, y: 0, z: pos.z },
        velocity: { x: pos.vx || 0, y: 0, z: pos.vz || 0 },
        objectType: 'person' as const,
        trail,
      })
    }

    setReplayTracks(trackMap)
  }, [
    trackData,
    minTime,
    duration,
    sparsePassBy,
    passByVisibilityMs,
    isTrackVisibleAtTime,
    getPositionAtTime,
    setReplayTracks,
  ])

  useEffect(() => {
    if (!isPlaying || duration === 0) return

    const TARGET_PLAYBACK_MS = 16000
    const animate = (timestamp: number) => {
      if (lastFrameTimeRef.current === 0) lastFrameTimeRef.current = timestamp

      const deltaMs = timestamp - lastFrameTimeRef.current
      lastFrameTimeRef.current = timestamp
      const deltaProgress = deltaMs / TARGET_PLAYBACK_MS

      setProgress(prev => {
        const next = prev + deltaProgress
        if (next >= 1) {
          setIsPlaying(false)
          return 1
        }
        return next
      })

      animationRef.current = requestAnimationFrame(animate)
    }

    lastFrameTimeRef.current = 0
    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [isPlaying, duration])

  useEffect(() => {
    if (isInsightMode && trackData.size > 0) {
      updateTracksAtProgress(progress)
    }
  }, [progress, isInsightMode, trackData, updateTracksAtProgress])

  useEffect(() => {
    if (!isInsightMode || !selectedEpisode) return

    setInsightReplayActive(true)
    setReplayMode(true)
    setProgress(0)
    setIsPlaying(true)

    return () => {
      setInsightReplayActive(false)
      setReplayMode(false)
      setReplayTracks(new Map())
      setIsPlaying(false)
      setProgress(0)
    }
  }, [isInsightMode, selectedEpisode?.episode_id, setInsightReplayActive, setReplayMode, setReplayTracks])

  // Seed first frame once track data arrives (embedded or fetched).
  useEffect(() => {
    if (isInsightMode && trackData.size > 0) {
      updateTracksAtProgress(progress)
    }
  }, [isInsightMode, trackData.size, updateTracksAtProgress]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleExit = useCallback(() => {
    setIsPlaying(false)
    exitInsightMode()
  }, [exitInsightMode])

  const handlePlayPause = useCallback(() => {
    if (progress >= 1) setProgress(0)
    setIsPlaying(prev => !prev)
  }, [progress])

  const handleRestart = useCallback(() => {
    setProgress(0)
    setIsPlaying(true)
  }, [])

  if (!isInsightMode || !selectedEpisode) return null

  const progressPercent = Math.round(progress * 100)
  const hasTracks = trackData.size > 0

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50">
      <div className="bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-700 shadow-2xl">
        <div className="px-4 py-2.5 flex items-center gap-3">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              backgroundColor: selectedEpisode.color,
              animation: isPlaying ? 'none' : 'pulse 2s infinite',
            }}
          />

          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate max-w-[200px]">
              {selectedEpisode.title}
            </div>
            <div className="text-[10px] text-gray-400">
              {selectedEpisode.time_label}
              {!hasTracks && ' · loading trajectories…'}
              {hasTracks && sparsePassBy && ' · pass-by replay'}
            </div>
          </div>

          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={handlePlayPause}
              disabled={!hasTracks}
              className="p-1.5 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={handleRestart}
              disabled={!hasTracks}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-40"
              title="Restart"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="w-px h-5 bg-gray-700" />

          <button
            onClick={handleExit}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="Exit Insight Mode"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 pb-2">
          <div className="flex items-center gap-2">
            <div
              className="flex-1 h-1 bg-gray-700 rounded-full overflow-hidden cursor-pointer"
              onClick={(e) => {
                if (!hasTracks) return
                const rect = e.currentTarget.getBoundingClientRect()
                const clickX = e.clientX - rect.left
                setProgress(Math.max(0, Math.min(1, clickX / rect.width)))
              }}
            >
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: selectedEpisode.color,
                }}
              />
            </div>
            <span className="text-[10px] text-gray-500 w-8 text-right">
              {progressPercent}%
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
