/**
 * useBufferedPlayback - DISABLED
 * 
 * Buffered playback was removed because the extra connections (SSE / Socket.IO snapshots)
 * caused the Edge Simulator to disconnect. The Neural Dashboard now uses live tracks
 * directly from TrackingContext with throttled metrics (1s interval).
 * 
 * This file is kept as a stub so any stale imports don't break the build.
 */

export function useBufferedPlayback(_venueId?: string, _enabled?: boolean) {
  return {
    tracks: new Map(),
    isConnected: false,
    metrics: { totalPax: 0, avgVelocity: 0, snapshotAge: 0, bufferSize: 0 },
  }
}

export default useBufferedPlayback
