import { EventEmitter } from 'events';

const EMIT_INTERVAL_MS = 50; // 20 fps
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

  setPlacement(deviceId, placement) {
    this.placements.set(deviceId, placement);
  }

  removePlacement(deviceId) {
    this.placements.delete(deviceId);
  }

  addTrack(rawTrack) {
    const trackKey = `${rawTrack.deviceId}:${rawTrack.id}`;
    
    // Transform coordinates based on placement
    const placement = this.placements.get(rawTrack.deviceId);
    const venuePosition = this.transformToVenueCoords(rawTrack.position, placement);
    
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
}
