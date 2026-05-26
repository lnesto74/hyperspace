/**
 * VisualTrackService (VTL)
 * ------------------------
 * Continuity-first delayed playback for reconciler-on live visualization.
 * Raw bypass mode never touches this service.
 *
 * Priorities: (1) continuity (2) smooth motion (3) latency — default 10s lag.
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

const DEFAULTS = Object.freeze({
  playbackLagMs: 10000,
  bufferMs: 25000,
  emitIntervalMs: 33,
  coastMaxMs: 15000,
  fadeMs: 2500,
  expireMs: 120000,
  reacquireMaxMs: 15000,
  reacquireMaxDistM: 8,
  maxSpeedM_s: 2.5,
  maxTrailPoints: 48,
});

/** @typedef {'incubating'|'active'|'coasting'|'reacquiring'|'fading'} VtlState */

function dist2d(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clampSpeed(x0, z0, x1, z1, dtMs, maxSpeed) {
  if (dtMs <= 0) return { x: x1, z: z1 };
  const dt = dtMs / 1000;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const d = Math.hypot(dx, dz);
  const maxD = maxSpeed * dt;
  if (d <= maxD || d < 1e-6) return { x: x1, z: z1 };
  const s = maxD / d;
  return { x: x0 + dx * s, z: z0 + dz * s };
}

export class VisualTrackService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = { ...DEFAULTS, ...options };
    /** @type {Map<string, Map<string, object>>} venueId -> visualId -> entity */
    this.venues = new Map();
    /** stableId -> { venueId, visualId } */
    this.stableIndex = new Map();
    this.emitTimer = null;
    this.activeVenues = new Set();
  }

  setVenueActive(venueId, active) {
    if (active) this.activeVenues.add(venueId);
    else {
      this.activeVenues.delete(venueId);
      this.venues.delete(venueId);
      for (const [sid, ref] of this.stableIndex) {
        if (ref.venueId === venueId) this.stableIndex.delete(sid);
      }
    }
  }

  isVenueActive(venueId) {
    return this.activeVenues.has(venueId);
  }

  start() {
    if (this.emitTimer) return;
    this.emitTimer = setInterval(() => this._emitAll(), this.options.emitIntervalMs);
  }

  stop() {
    if (this.emitTimer) clearInterval(this.emitTimer);
    this.emitTimer = null;
    this.venues.clear();
    this.stableIndex.clear();
    this.activeVenues.clear();
  }

  /** @param {object} track reconciled track from MqttTrajectoryService */
  ingest(venueId, track) {
    if (!this.activeVenues.has(venueId) || !track?.venuePosition) return;

    const now = Date.now();
    const pos = track.venuePosition;
    const vel = track.velocity || { x: 0, y: 0, z: 0 };
    const stableId = track.stableId || track.id;
    const sample = {
      t: now,
      x: pos.x,
      z: pos.z,
      vx: vel.x || 0,
      vz: vel.z || 0,
    };

    let entity = null;
    const idx = this.stableIndex.get(stableId);
    if (idx && idx.venueId === venueId) {
      entity = this.venues.get(venueId)?.get(idx.visualId);
    }

    if (!entity) {
      entity = this._tryReacquire(venueId, sample, stableId);
    }
    if (!entity) {
      entity = this._createEntity(venueId, track, stableId);
    }

    entity.stableIds.add(stableId);
    if (track.originalPerceptionId) entity.perceptionIds.add(String(track.originalPerceptionId));
    entity.deviceId = track.deviceId || entity.deviceId;
    entity.color = track.color || entity.color;
    entity.objectType = track.objectType || entity.objectType;
    entity.lastIngestWall = now;
    entity.samples.push(sample);
    this._pruneSamples(entity, now);

    this.stableIndex.set(stableId, { venueId, visualId: entity.visualId });

    if (entity.state === 'incubating' || entity.state === 'reacquiring' || entity.state === 'fading') {
      entity.state = 'active';
      entity.opacity = 1;
      entity.fadeStart = null;
    } else if (entity.state === 'coasting') {
      entity.state = 'active';
    }
  }

  _venueMap(venueId) {
    if (!this.venues.has(venueId)) this.venues.set(venueId, new Map());
    return this.venues.get(venueId);
  }

  _createEntity(venueId, track, stableId) {
    const visualId = randomUUID();
    const entity = {
      visualId,
      trackKey: `vtl:${visualId}`,
      deviceId: track.deviceId || 'edge',
      stableIds: new Set([stableId]),
      perceptionIds: new Set(track.originalPerceptionId ? [String(track.originalPerceptionId)] : []),
      state: /** @type {VtlState} */ ('incubating'),
      opacity: 0.35,
      color: track.color || '#22c55e',
      objectType: track.objectType || 'person',
      samples: [],
      lastIngestWall: Date.now(),
      fadeStart: null,
    };
    this._venueMap(venueId).set(visualId, entity);
    return entity;
  }

  _tryReacquire(venueId, sample, stableId) {
    const map = this.venues.get(venueId);
    if (!map) return null;
    const { reacquireMaxMs, reacquireMaxDistM } = this.options;
    const now = Date.now();
    let best = null;
    let bestDist = Infinity;
    for (const entity of map.values()) {
      if (entity.state !== 'coasting' && entity.state !== 'reacquiring' && entity.state !== 'fading') continue;
      const age = now - entity.lastIngestWall;
      if (age > reacquireMaxMs) continue;
      const last = entity.samples[entity.samples.length - 1];
      if (!last) continue;
      const d = dist2d(last, sample);
      if (d <= reacquireMaxDistM && d < bestDist) {
        bestDist = d;
        best = entity;
      }
    }
    if (best) {
      best.stableIds.add(stableId);
      return best;
    }
    return null;
  }

  _pruneSamples(entity, now) {
    const cutoff = now - this.options.bufferMs;
    while (entity.samples.length > 0 && entity.samples[0].t < cutoff) {
      entity.samples.shift();
    }
  }

  _positionAt(entity, displayT) {
    const samples = entity.samples;
    if (samples.length === 0) return null;

    if (displayT <= samples[0].t) {
      return { x: samples[0].x, z: samples[0].z, vx: samples[0].vx, vz: samples[0].vz };
    }

    const last = samples[samples.length - 1];
    if (displayT >= last.t) {
      const dt = displayT - last.t;
      const capped = clampSpeed(last.x, last.z, last.x + last.vx * (dt / 1000), last.z + last.vz * (dt / 1000), dt, this.options.maxSpeedM_s);
      return { x: capped.x, z: capped.z, vx: last.vx, vz: last.vz };
    }

    let i = 1;
    while (i < samples.length && samples[i].t < displayT) i++;
    const a = samples[i - 1];
    const b = samples[i];
    const span = b.t - a.t;
    const u = span > 0 ? (displayT - a.t) / span : 0;
    let x = lerp(a.x, b.x, u);
    let z = lerp(a.z, b.z, u);
    const dt = span;
    const capped = clampSpeed(a.x, a.z, x, z, dt, this.options.maxSpeedM_s);
    return {
      x: capped.x,
      z: capped.z,
      vx: lerp(a.vx, b.vx, u),
      vz: lerp(a.vz, b.vz, u),
    };
  }

  _buildTrail(entity, displayT) {
    const trail = [];
    for (const s of entity.samples) {
      if (s.t <= displayT) trail.push({ x: s.x, y: 0, z: s.z });
    }
    const max = this.options.maxTrailPoints;
    if (trail.length > max) return trail.slice(trail.length - max);
    return trail;
  }

  _tickVenue(venueId) {
    const map = this.venues.get(venueId);
    if (!map) return { entities: [], occupancy: 0 };
    const now = Date.now();
    const displayT = now - this.options.playbackLagMs;
    const entities = [];

    for (const entity of map.values()) {
      const gap = now - entity.lastIngestWall;

      if (gap > this.options.expireMs) {
        map.delete(entity.visualId);
        for (const sid of entity.stableIds) this.stableIndex.delete(sid);
        continue;
      }

      if (gap > this.options.coastMaxMs && entity.state === 'active') {
        entity.state = 'reacquiring';
      } else if (gap > 2000 && entity.state === 'active') {
        entity.state = 'coasting';
      }

      if (entity.state === 'reacquiring' && gap > this.options.reacquireMaxMs) {
        entity.state = 'fading';
        entity.fadeStart = entity.fadeStart || now;
      }

      if (entity.state === 'fading') {
        const fadeAge = now - (entity.fadeStart || now);
        entity.opacity = Math.max(0, 1 - fadeAge / this.options.fadeMs);
        if (entity.opacity <= 0) {
          map.delete(entity.visualId);
          for (const sid of entity.stableIds) this.stableIndex.delete(sid);
          continue;
        }
      } else if (entity.state === 'incubating') {
        entity.opacity = Math.min(1, entity.opacity + 0.05);
        if (entity.samples.length >= 3) entity.state = 'active';
      } else {
        entity.opacity = 1;
      }

      const pos = this._positionAt(entity, displayT);
      if (!pos) continue;

      const trail = this._buildTrail(entity, displayT);
      entities.push({
        visualId: entity.visualId,
        trackKey: entity.trackKey,
        id: entity.visualId,
        deviceId: entity.deviceId,
        state: entity.state,
        opacity: entity.opacity,
        timestamp: displayT,
        venuePosition: { x: pos.x, y: 0, z: pos.z },
        velocity: { x: pos.vx, y: 0, z: pos.vz },
        objectType: entity.objectType,
        color: entity.color,
        trail,
      });
    }

    return { entities, occupancy: entities.filter(e => e.opacity > 0.2).length };
  }

  _emitAll() {
    for (const venueId of this.activeVenues) {
      const { entities, occupancy } = this._tickVenue(venueId);
      this.emit('visual_tracks', {
        venueId,
        visualization: 'vtl',
        playbackLagMs: this.options.playbackLagMs,
        frameOccupancy: occupancy,
        entities,
        timestamp: Date.now(),
      });
    }
  }
}

export default VisualTrackService;
