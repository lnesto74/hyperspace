import type { Track } from '../types'

/** Max message age when liveFrameTs is unavailable (fallback). */
export const LIVE_FRAME_MAX_AGE_MS = 400

export function isTrackInLiveFrame(
  track: Track & { inLiveFrame?: boolean },
  liveFrameTs: number | null,
): boolean {
  if (track.trackKey?.startsWith('replay-')) return true
  if (track.inLiveFrame === true) return true
  if (track.inLiveFrame === false) return false
  if (liveFrameTs != null && track.timestamp != null) {
    return Math.abs(track.timestamp - liveFrameTs) <= 120
  }
  return Date.now() - (track.timestamp || 0) <= LIVE_FRAME_MAX_AGE_MS
}

/** Keep only tracks from the current perception frame (matches fast3dis object count). */
export function filterLiveFrameTracks<T extends Track>(
  tracks: Map<string, T>,
  liveFrameTs: number | null,
): Map<string, T> {
  const filtered = new Map<string, T>()
  for (const [key, track] of tracks) {
    if (isTrackInLiveFrame(track, liveFrameTs)) filtered.set(key, track)
  }
  return filtered
}

/**
 * Live floor dots must match occupancy, not aggregator TTL ghosts.
 * Perception IDs churn; the aggregator keeps them 6–15s → hundreds of frozen dots.
 */
export function selectLiveOccupancyTracks<T extends Track>(
  tracks: Map<string, T>,
  occupancy: number,
): Map<string, T> {
  if (tracks.size === 0 || !(occupancy > 0)) return tracks
  const slack = Math.min(4, Math.max(2, Math.ceil(occupancy * 0.15)))
  const cap = occupancy + slack
  if (tracks.size <= cap) return tracks
  const ranked = [...tracks.entries()].sort(
    (a, b) => (b[1].timestamp ?? 0) - (a[1].timestamp ?? 0),
  )
  return new Map(ranked.slice(0, cap))
}

export function countLiveFrameTracks(
  tracks: Map<string, Track>,
  liveFrameTs: number | null,
  frameOccupancy?: number,
): number {
  if (frameOccupancy != null && frameOccupancy > 0) return frameOccupancy
  return filterLiveFrameTracks(tracks, liveFrameTs).size
}
