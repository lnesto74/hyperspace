import { EventEmitter } from 'events';

const EMIT_INTERVAL_MS = 100; // 10 fps — sufficient for smooth visualization, halves event loop load
const TRACK_TTL_MS = 6000; // 6 seconds
const MAX_TRAIL_LENGTH = 100; // ~10 seconds of trail at 10Hz

export class TrackAggregator extends EventEmitter {
  constructor() {
    super();
    this.tracks = new Map(); // trackKey -> { track, trail, lastUpdate, venueId }
    this.placements = new Map(); // deviceId -> placement (for coordinate transforms)
    this.emitInterval = null;
    this.venueId = null;
  }

  start(venueId) {
    this.venueId = venueId;
    
    if (this.emitInterval) return;
    
    this.emitInterval = setInterval(() => {
      this.emitTracks();
      this.pruneStale();
    }, EMIT_INTERVAL_MS);
    
    console.log(`📊 Track aggregator started for venue ${venueId}`);
  }

  stop() {
    if (this.emitInterval) {
      clearInterval(this.emitInterval);
      this.emitInterval = null;
    }
    this.tracks.clear();
    console.log('📊 Track aggregator stopped');
  }

  /**
   * Immediately remove all tracks for a venue, emitting track_removed for each
   * so all connected clients clear their visuals instantly.
   */
  flushTracks() {
    const keys = [...this.tracks.keys()];
    this.tracks.clear();
    for (const trackKey of keys) {
      this.emit('track_removed', { trackKey });
    }
    this.emit('tracks_cleared');
    if (keys.length > 0) {
      console.log(`📊 Track aggregator flushed ${keys.length} tracks`);
    }
  }

  /** Remove only MQTT replay tracks (deviceId / trackKey prefixed with replay-). */
  flushReplayTracks() {
    const keys = [...this.tracks.keys()].filter(k => k.startsWith('replay-'));
    if (keys.length === 0) return 0;
    for (const trackKey of keys) {
      this.tracks.delete(trackKey);
      this.emit('track_removed', { trackKey });
    }
    console.log(`📊 Track aggregator flushed ${keys.length} replay tracks`);
    return keys.length;
  }

  setPlacement(deviceId, placement) {
    this.placements.set(deviceId, placement);
  }

  removePlacement(deviceId) {
    this.placements.delete(deviceId);
  }

  addTrack(rawTrack) {
    const trackKey = `${rawTrack.deviceId}:${rawTrack.id}`;

    // If the caller already supplied a venuePosition (e.g. MqttTrajectoryService applied
    // the per-venue perceptionTransform), trust it. Otherwise fall back to the legacy
    // per-device placement transform.
    let venuePosition;
    if (rawTrack.venuePosition) {
      venuePosition = rawTrack.venuePosition;
    } else {
      const placement = this.placements.get(rawTrack.deviceId);
      venuePosition = this.transformToVenueCoords(rawTrack.position, placement);
    }

    const track = {
      ...rawTrack,
      trackKey,
      venuePosition,
    };

    const existing = this.tracks.get(trackKey);
    const trail = existing?.trail || [];
    
    // Add to trail
    trail.push({ ...venuePosition });
    if (trail.length > MAX_TRAIL_LENGTH) {
      trail.shift();
    }

    this.tracks.set(trackKey, {
      track,
      trail,
      lastUpdate: Date.now(),
      venueId: this.venueId,
    });
  }

  transformToVenueCoords(localPosition, placement) {
    if (!placement) {
      // No placement info, return as-is with offset
      return { ...localPosition };
    }

    // Apply rotation (simplified - just Y rotation)
    const cos = Math.cos(placement.rotation?.y || 0);
    const sin = Math.sin(placement.rotation?.y || 0);
    
    const rotatedX = localPosition.x * cos - localPosition.z * sin;
    const rotatedZ = localPosition.x * sin + localPosition.z * cos;

    // Apply translation
    return {
      x: rotatedX + (placement.position?.x || 0),
      y: localPosition.y + (placement.mountHeight || 0) - (placement.mountHeight || 3), // Floor level
      z: rotatedZ + (placement.position?.z || 0),
    };
  }

  emitTracks() {
    if (this.tracks.size === 0) return;

    const tracksBatch = [];
    
    for (const [trackKey, entry] of this.tracks) {
      tracksBatch.push({
        ...entry.track,
        trail: entry.trail,
      });
    }

    if (tracksBatch.length > 0) {
      this.emit('tracks', {
        venueId: this.venueId,
        tracks: tracksBatch,
        timestamp: Date.now(),
      });
    }
  }

  pruneStale() {
    const now = Date.now();
    const staleKeys = [];

    for (const [trackKey, entry] of this.tracks) {
      if (now - entry.lastUpdate > TRACK_TTL_MS) {
        staleKeys.push(trackKey);
      }
    }

    for (const trackKey of staleKeys) {
      this.tracks.delete(trackKey);
      this.emit('track_removed', { trackKey });
    }
  }

  getActiveTrackCount() {
    return this.tracks.size;
  }

  /**
   * Set ROIs for zone occupancy tracking
   * @param {Array} rois - Array of ROI objects with id and vertices
   */
  setRois(rois) {
    this.rois = rois || [];
  }

  /**
   * Check if a point is inside a polygon (ray casting algorithm)
   */
  pointInPolygon(point, vertices) {
    if (!vertices || vertices.length < 3) return false;
    
    let inside = false;
    const x = point.x, z = point.z;
    
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x, zi = vertices[i].z;
      const xj = vertices[j].x, zj = vertices[j].z;
      
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  /**
   * Get the number of tracks currently inside a zone (ROI)
   * @param {string} roiId - The UUID of the ROI
   * @returns {number} Number of tracks inside the zone
   */
  getZoneOccupancy(roiId) {
    if (!this.rois || this.rois.length === 0) return 0;
    
    const roi = this.rois.find(r => r.id === roiId);
    if (!roi) return 0;
    
    let vertices = roi.vertices;
    if (typeof vertices === 'string') {
      try {
        vertices = JSON.parse(vertices);
      } catch (e) {
        return 0;
      }
    }
    
    if (!vertices || vertices.length < 3) return 0;
    
    let count = 0;
    for (const [, entry] of this.tracks) {
      const pos = entry.track.venuePosition;
      if (pos && this.pointInPolygon(pos, vertices)) {
        count++;
      }
    }
    
    return count;
  }
}
