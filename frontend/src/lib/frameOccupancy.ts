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
  return filtered.size > 0 ? filtered : tracks
}

export function countLiveFrameTracks(
  tracks: Map<string, Track>,
  liveFrameTs: number | null,
  frameOccupancy?: number,
): number {
  if (frameOccupancy != null && frameOccupancy > 0) return frameOccupancy
  return filterLiveFrameTracks(tracks, liveFrameTs).size
}
