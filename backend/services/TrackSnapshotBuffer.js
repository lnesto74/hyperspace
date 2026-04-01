/**
 * TrackSnapshotBuffer - Buffered track snapshots for smooth Neural Dashboard playback
 * 
 * Collects track updates and emits compressed snapshots at fixed intervals.
 * Allows Neural Dashboard to interpolate between snapshots for smooth 30fps rendering
 * while actual data has 10-30s latency.
 * 
 * Architecture:
 *   MQTT → TrackAggregator → TrackSnapshotBuffer → Socket.IO → Frontend Playback
 */

import { EventEmitter } from 'events';

const SNAPSHOT_INTERVAL_MS = 2000; // Emit snapshot every 2 seconds
const BUFFER_DURATION_MS = 60000;  // Keep 60 seconds of history
const MAX_SNAPSHOTS = Math.ceil(BUFFER_DURATION_MS / SNAPSHOT_INTERVAL_MS);

export class TrackSnapshotBuffer extends EventEmitter {
  constructor() {
    super();
    this.currentTracks = new Map(); // trackKey -> { x, z, vx, vz, color, timestamp }
    this.snapshots = [];            // Ring buffer of snapshots
    this.snapshotInterval = null;
    this.venueId = null;
    this.isRunning = false;
    
    // Pre-computed KPIs (updated each snapshot)
    this.cachedKpis = {
      totalPax: 0,
      avgVelocity: 0,
    };
  }

  start(venueId) {
    if (this.isRunning) return;
    
    this.venueId = venueId;
    this.isRunning = true;
    this.currentTracks.clear();
    this.snapshots = [];
    
    this.snapshotInterval = setInterval(() => {
      this.createSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
    
    console.log(`📸 TrackSnapshotBuffer started for venue ${venueId}`);
  }

  stop() {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
    this.isRunning = false;
    this.currentTracks.clear();
    this.snapshots = [];
    console.log('📸 TrackSnapshotBuffer stopped');
  }

  /**
   * Ingest tracks from TrackAggregator
   * Called on every track batch (high frequency)
   */
  ingestTracks(tracks) {
    if (!tracks || !Array.isArray(tracks)) return;
    
    const now = Date.now();
    
    for (const track of tracks) {
      if (!track || !track.trackKey) continue;
      
      this.currentTracks.set(track.trackKey, {
        id: track.trackKey,
        x: track.venuePosition?.x ?? track.position?.x ?? 0,
        z: track.venuePosition?.z ?? track.position?.z ?? 0,
        vx: track.velocity?.x ?? 0,
        vz: track.velocity?.z ?? 0,
        color: track.color || '#22c55e',
        timestamp: now,
      });
    }
  }

  /**
   * Remove stale tracks (called periodically or on track_removed event)
   */
  removeTrack(trackKey) {
    this.currentTracks.delete(trackKey);
  }

  /**
   * Create a snapshot of current state
   * Called every SNAPSHOT_INTERVAL_MS
   */
  createSnapshot() {
    try {
      const now = Date.now();
      
      // Prune tracks not updated in last 5 seconds
      const staleThreshold = now - 5000;
      for (const [key, track] of this.currentTracks) {
        if (track.timestamp < staleThreshold) {
          this.currentTracks.delete(key);
        }
      }
      
      // Build compact snapshot
      const tracks = [];
      let totalVelocity = 0;
      
      for (const [, track] of this.currentTracks) {
        tracks.push({
          id: track.id,
          x: Math.round(track.x * 100) / 100,  // 2 decimal places
          z: Math.round(track.z * 100) / 100,
          vx: Math.round((track.vx || 0) * 100) / 100,
          vz: Math.round((track.vz || 0) * 100) / 100,
          c: track.color || '#00ff88',
        });
        const vx = track.vx || 0;
        const vz = track.vz || 0;
        totalVelocity += Math.sqrt(vx * vx + vz * vz);
      }
      
      const snapshot = {
        ts: now,
        venueId: this.venueId,
        tracks,
        kpi: {
          pax: tracks.length,
          avgV: tracks.length > 0 ? Math.round((totalVelocity / tracks.length) * 100) / 100 : 0,
        },
      };
      
      // Add to ring buffer
      this.snapshots.push(snapshot);
      if (this.snapshots.length > MAX_SNAPSHOTS) {
        this.snapshots.shift();
      }
      
      // Update cached KPIs
      this.cachedKpis.totalPax = tracks.length;
      this.cachedKpis.avgVelocity = snapshot.kpi.avgV;
      
      // Emit to listeners (Socket.IO will pick this up)
      this.emit('snapshot', snapshot);
    } catch (e) {
      console.error('📸 Error creating snapshot:', e.message);
    }
  }

  /**
   * Get recent snapshots for initial load
   * @param {number} count - Number of snapshots to return
   */
  getRecentSnapshots(count = 10) {
    return this.snapshots.slice(-count);
  }

  /**
   * Get latest snapshot
   */
  getLatestSnapshot() {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /**
   * Get cached KPIs (for instant API responses)
   */
  getCachedKpis() {
    return { ...this.cachedKpis };
  }
}

export default TrackSnapshotBuffer;
