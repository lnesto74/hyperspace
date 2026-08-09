/**
 * TrajectoryReconciler
 * --------------------
 * Stateful per-venue post-processing of perception tracks:
 *   1. Filter out ghost detections (artifacts, reflections, fixtures, jitter).
 *   2. Re-identify a perception ID against recently lost stable tracks so a
 *      single person keeps the same stable ID across drop-outs.
 *   3. Smooth position / velocity for jitter-free visualization.
 *
 * Pure JS, no I/O. Hot path target: < 1 ms per frame at N ≈ 100 active tracks.
 *
 * State containers (per venue):
 *   activeTracks: stableId -> TrackState  (updated in last UPDATE_TIMEOUT_MS)
 *   lostTracks:   stableId -> TrackState  (gap < REID_MAX_GAP_S, eligible for re-ID)
 *   perceptionToStable: perceptionId -> stableId
 *
 * TrackState shape:
 *   {
 *     stableId, position, velocity, timestamp,
 *     firstSeen, lastDisplacement, trail (Array of recent samples),
 *     perceptionIds (Set of perception IDs that bound to this stable ID),
 *     shopperNumber (session display # for live canvas — stable across re-ID),
 *     smoothedPos, smoothedVel,
 *   }
 */

import { randomUUID } from 'crypto';

export const DEFAULT_CONFIG = Object.freeze({
  enabled: true,

  // Ghost filter
  ghost_max_speed_m_s: 3.5,                // walking max ~ 2 m/s; sprint ~ 6 m/s
  ghost_min_promotion_lifetime_ms: 500,    // a perception ID must be alive this long before it gets a stable ID
  ghost_min_promotion_displacement_m: 0.4, // and have moved at least this far
  // Soft grocery-safe gate (OR): promote if lived this long OR covered this extent.
  // Holds only short+tiny flicker. Never uses net displacement as a hard kill —
  // that deletes shelf browsers. 0/0 disables (legacy AND gates above apply alone).
  ghost_soft_min_lifetime_ms: 0,
  ghost_soft_min_extent_m: 0,
  ghost_static_timeout_s: 30,              // stable tracks stationary for this long get dropped (fixture)
  ghost_static_displacement_m: 0.2,        // < this displacement during static_timeout counts as stationary
  // Venue bounds gate (in venue meters). null means no gate.
  ghost_bounds_min: null,                  // { x, z }
  ghost_bounds_max: null,                  // { x, z }

  // Re-identification
  reid_max_gap_s: 10,                      // perception ID gap eligible for re-ID
  reid_max_distance_m: 3.0,                // hard gate on predicted-vs-new distance (moving)
  reid_max_implied_speed_m_s: 2.5,         // hard gate on distance/dt: prevents teleports
  reid_velocity_cosine_min: -0.2,          // reject if walking backwards (cos < this)
  reid_weight_distance: 1.0,
  reid_weight_velocity: 0.5,
  reid_weight_time: 0.1,
  // Slow / occlusion re-ID (person static or decelerating before drop-out)
  reid_slow_speed_m_s: 0.35,               // lost or new speed below → occlusion rules
  reid_static_max_distance_m: 3.5,         // max raw distance from last pos (not velocity-predicted)
  reid_static_max_implied_speed_m_s: 1.2,  // tighter implied-speed cap in occlusion mode
  reid_aligned_cosine_min: 0.45,           // same-direction boost when cos ≥ this
  reid_aligned_distance_boost: 1.25,       // multiply reid_max_distance_m when aligned
  reid_isolation_radius_m: 2.5,            // occlusion merge only if no other track within (0=off)
  reid_occlusion_bypass_promotion: true,   // new ID can re-ID lost track before probation ends
  reid_stale_active_ms: 1000,              // also match active tracks silent this long (before lost sweep)

  // Smoothing
  smoothing_alpha: 0.6,                    // EMA blend (1 = use raw, 0 = no update)

  // Housekeeping
  active_to_lost_timeout_ms: 4000,         // keep visible through brief perception gaps

  // Trail
  trail_max_length: 32,
});

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

export function normalizeReconcilerConfig(raw) {
  if (!raw || typeof raw !== 'object') return clone(DEFAULT_CONFIG);
  const merged = { ...DEFAULT_CONFIG, ...raw };
  merged.enabled = raw.enabled !== false;
  // Number clamping
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  merged.ghost_max_speed_m_s = num(raw.ghost_max_speed_m_s, DEFAULT_CONFIG.ghost_max_speed_m_s);
  merged.ghost_min_promotion_lifetime_ms = num(raw.ghost_min_promotion_lifetime_ms, DEFAULT_CONFIG.ghost_min_promotion_lifetime_ms);
  merged.ghost_min_promotion_displacement_m = num(raw.ghost_min_promotion_displacement_m, DEFAULT_CONFIG.ghost_min_promotion_displacement_m);
  merged.ghost_soft_min_lifetime_ms = num(raw.ghost_soft_min_lifetime_ms, DEFAULT_CONFIG.ghost_soft_min_lifetime_ms);
  merged.ghost_soft_min_extent_m = num(raw.ghost_soft_min_extent_m, DEFAULT_CONFIG.ghost_soft_min_extent_m);
  merged.ghost_static_timeout_s = num(raw.ghost_static_timeout_s, DEFAULT_CONFIG.ghost_static_timeout_s);
  merged.ghost_static_displacement_m = num(raw.ghost_static_displacement_m, DEFAULT_CONFIG.ghost_static_displacement_m);
  merged.reid_max_gap_s = num(raw.reid_max_gap_s, DEFAULT_CONFIG.reid_max_gap_s);
  merged.reid_max_distance_m = num(raw.reid_max_distance_m, DEFAULT_CONFIG.reid_max_distance_m);
  merged.reid_max_implied_speed_m_s = num(raw.reid_max_implied_speed_m_s, DEFAULT_CONFIG.reid_max_implied_speed_m_s);
  merged.reid_velocity_cosine_min = num(raw.reid_velocity_cosine_min, DEFAULT_CONFIG.reid_velocity_cosine_min);
  merged.reid_weight_distance = num(raw.reid_weight_distance, DEFAULT_CONFIG.reid_weight_distance);
  merged.reid_weight_velocity = num(raw.reid_weight_velocity, DEFAULT_CONFIG.reid_weight_velocity);
  merged.reid_weight_time = num(raw.reid_weight_time, DEFAULT_CONFIG.reid_weight_time);
  merged.reid_slow_speed_m_s = num(raw.reid_slow_speed_m_s, DEFAULT_CONFIG.reid_slow_speed_m_s);
  merged.reid_static_max_distance_m = num(raw.reid_static_max_distance_m, DEFAULT_CONFIG.reid_static_max_distance_m);
  merged.reid_static_max_implied_speed_m_s = num(raw.reid_static_max_implied_speed_m_s, DEFAULT_CONFIG.reid_static_max_implied_speed_m_s);
  merged.reid_aligned_cosine_min = num(raw.reid_aligned_cosine_min, DEFAULT_CONFIG.reid_aligned_cosine_min);
  merged.reid_aligned_distance_boost = num(raw.reid_aligned_distance_boost, DEFAULT_CONFIG.reid_aligned_distance_boost);
  merged.reid_isolation_radius_m = num(raw.reid_isolation_radius_m, DEFAULT_CONFIG.reid_isolation_radius_m);
  merged.reid_occlusion_bypass_promotion = raw.reid_occlusion_bypass_promotion !== false;
  merged.reid_stale_active_ms = num(raw.reid_stale_active_ms, DEFAULT_CONFIG.reid_stale_active_ms);
  merged.reid_churn_active_ms = num(raw.reid_churn_active_ms, merged.reid_churn_active_ms ?? 80);
  merged.smoothing_alpha = Math.max(0, Math.min(1, num(raw.smoothing_alpha, DEFAULT_CONFIG.smoothing_alpha)));
  merged.active_to_lost_timeout_ms = num(raw.active_to_lost_timeout_ms, DEFAULT_CONFIG.active_to_lost_timeout_ms);
  merged.trail_max_length = num(raw.trail_max_length, DEFAULT_CONFIG.trail_max_length);
  merged.offline_instant_promote = raw.offline_instant_promote === true;
  // Batch/offline mode: a perception id keeps ONE stable id for the whole
  // recording. Bindings survive expiry so a long, gappy id is never shattered
  // into multiple stable ids (which made reconciled worse than raw). Default
  // OFF for the live reconciler, where freeing ids for occupancy matters.
  merged.persist_perception_bindings = raw.persist_perception_bindings === true;
  // One stable id, one publishing perception id. Off by default so the deployed
  // behaviour is unchanged until the venue opts in. See _claimReidTarget.
  merged.reid_exclusive_bindings = raw.reid_exclusive_bindings === true;
  return merged;
}

/** Per-venue state. Created lazily by the reconciler when the first track arrives. */
class VenueState {
  constructor(venueId, config) {
    this.venueId = venueId;
    this.config = normalizeReconcilerConfig(config);
    this.activeTracks = new Map();        // stableId -> TrackState
    this.lostTracks = new Map();          // stableId -> TrackState
    this.perceptionToStable = new Map();  // perceptionId -> stableId
    this.candidatePerceptions = new Map();// perceptionId -> { firstSeen, firstPos, lastPos, lastTs, totalDisp }
    this.nextShopperNumber = 1;
    this.stableShopperNumbers = new Map(); // stableId -> display # (for resurrect / lookup)
    this.stats = {
      raw_total: 0,
      ghost_dropped: 0,
      reid_count: 0,
      new_stable_ids: 0,
      ghost_drop_reasons: {}, // reason -> count
      first_track_ts: null,
      last_track_ts: null,
    };
    this.lastHousekeeping = Date.now();
  }

  setConfig(config) {
    this.config = normalizeReconcilerConfig(config);
  }

  getStats() {
    return {
      venueId: this.venueId,
      activeCount: this.activeTracks.size,
      lostCount: this.lostTracks.size,
      candidateCount: this.candidatePerceptions.size,
      raw_total: this.stats.raw_total,
      ghost_dropped: this.stats.ghost_dropped,
      ghost_drop_reasons: { ...this.stats.ghost_drop_reasons },
      reid_count: this.stats.reid_count,
      new_stable_ids: this.stats.new_stable_ids,
      resurrected: this.stats.resurrected || 0,
      ghost_rejection_rate: this.stats.raw_total > 0 ? this.stats.ghost_dropped / this.stats.raw_total : 0,
      reid_success_rate: (this.stats.reid_count + this.stats.new_stable_ids) > 0
        ? this.stats.reid_count / (this.stats.reid_count + this.stats.new_stable_ids)
        : 0,
      mean_active_lifetime_s: this.computeMeanActiveLifetime(),
    };
  }

  computeMeanActiveLifetime() {
    if (this.activeTracks.size === 0) return 0;
    const now = Date.now();
    let total = 0;
    for (const t of this.activeTracks.values()) {
      total += (now - t.firstSeen) / 1000;
    }
    return total / this.activeTracks.size;
  }
}

/**
 * Main reconciler. Multi-venue.
 */
export class TrajectoryReconciler {
  /**
   * @param getVenueConfig function(venueId) => config object
   * @param options.now    source of the reconciler's internal clock.
   *
   * Live ingest must age tracks by wall time, because an MQTT timestamp can lag
   * by minutes and a track judged on it would be retired the moment it arrived.
   * Replaying an archive is the opposite case: the frames are hours old and
   * arrive far faster than real time, so wall time makes every gap look
   * instantaneous and nothing ever expires — the track pool then grows for the
   * whole capture and each sweep walks all of it. Offline callers pass a clock
   * driven by the frames themselves; live callers get Date.now unchanged.
   */
  constructor(getVenueConfig = () => DEFAULT_CONFIG, { now = Date.now } = {}) {
    /** venueId -> VenueState */
    this.venues = new Map();
    /** function(venueId) => config object */
    this.getVenueConfig = getVenueConfig;
    this.now = now;
  }

  setVenueConfig(venueId, config) {
    const state = this.venues.get(venueId);
    if (state) state.setConfig(config);
  }

  resetVenue(venueId) {
    this.venues.delete(venueId);
  }

  getOrCreateState(venueId) {
    let state = this.venues.get(venueId);
    if (!state) {
      state = new VenueState(venueId, this.getVenueConfig(venueId));
      this.venues.set(venueId, state);
    }
    return state;
  }

  /**
   * Process a single track update from MqttTrajectoryService.
   *
   * Input track shape (already passed through Y/Z swap + perceptionTransform):
   *   { id, deviceId, venueId, timestamp, position, venuePosition, velocity, ... }
   *
   * Returns either:
   *   - A reconciled track (with stableId replacing `id`, plus `originalPerceptionId`), OR
   *   - null if the update was filtered as a ghost.
   */
  process(track) {
    const venueId = track.venueId || 'default';
    const state = this.getOrCreateState(venueId);
    const cfg = state.config;
    state.stats.raw_total++;
    state.stats.last_track_ts = this.now();
    if (!state.stats.first_track_ts) state.stats.first_track_ts = state.stats.last_track_ts;

    if (!cfg.enabled) {
      // Reconciler is disabled — pass-through unchanged.
      return track;
    }

    const perceptionId = track.id;
    // Internal clocks must agree with sweep(). Live that means wall time, since
    // an MQTT timestamp can lag minutes and would trigger instant
    // static_fixture drops; offline it means the archive's own clock.
    const now = this.now();
    const pos = track.venuePosition || track.position;
    const vel = track.velocity || { x: 0, y: 0, z: 0 };
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) {
      this._rejectGhost(state, 'invalid_position');
      return null;
    }

    // ---------- Stage 1: cheap ghost filters that don't need history ----------
    const speed = Math.hypot(vel.x || 0, vel.z || 0);
    if (speed > cfg.ghost_max_speed_m_s) {
      this._rejectGhost(state, 'speed_implausible');
      return null;
    }
    if (cfg.ghost_bounds_min && cfg.ghost_bounds_max) {
      const { ghost_bounds_min: lo, ghost_bounds_max: hi } = cfg;
      if (pos.x < lo.x || pos.x > hi.x || pos.z < lo.z || pos.z > hi.z) {
        this._rejectGhost(state, 'out_of_bounds');
        return null;
      }
    }

    // ---------- Stage 2: do we already have a binding? ----------
    const existingStableId = state.perceptionToStable.get(perceptionId);
    if (existingStableId) {
      const active = state.activeTracks.get(existingStableId) || state.lostTracks.get(existingStableId);
      if (active) {
        // Reactivate if it was lost
        if (state.lostTracks.has(existingStableId)) {
          state.lostTracks.delete(existingStableId);
          state.activeTracks.set(existingStableId, active);
        }
        this._updateTrackState(active, pos, vel, now, cfg);
        active.perceptionIds.add(perceptionId);
        return this._emit(track, active, perceptionId);
      }
      if (cfg.persist_perception_bindings) {
        // Stable track was swept out of the active/lost pools, but this is the
        // SAME perception id reappearing. Resurrect under the SAME stable id so
        // one raw id never fragments into many stable ids (the core defect that
        // made reconciled identity counts exceed raw). Reuse → stable_count is
        // bounded by the number of distinct perception ids.
        const resurrected = this._createTrackState(state, pos, vel, now, cfg, existingStableId);
        resurrected.perceptionIds.add(perceptionId);
        state.activeTracks.set(existingStableId, resurrected);
        state.stats.resurrected = (state.stats.resurrected || 0) + 1;
        return this._emit(track, resurrected, perceptionId);
      }
      // Live mode: stale binding — drop it and treat as new perception ID.
      state.perceptionToStable.delete(perceptionId);
    }

    // Offline batch post-process: full recording known — skip live probation gates.
    if (cfg.offline_instant_promote) {
      state.candidatePerceptions.delete(perceptionId);
      const matched = this._tryReid(state, pos, vel, now, cfg);
      let stableState;
      if (matched) {
        stableState = matched;
        stableState.perceptionIds.add(perceptionId);
        this._claimReidTarget(state, stableState, perceptionId, cfg);
        state.perceptionToStable.set(perceptionId, stableState.stableId);
        this._updateTrackState(stableState, pos, vel, now, cfg);
        state.stats.reid_count++;
      } else {
        stableState = this._createTrackState(state, pos, vel, now, cfg);
        state.activeTracks.set(stableState.stableId, stableState);
        state.perceptionToStable.set(perceptionId, stableState.stableId);
        stableState.perceptionIds.add(perceptionId);
        state.stats.new_stable_ids++;
      }
      return this._emit(track, stableState, perceptionId);
    }

    // ---------- Stage 3: candidate gating (don't promote until proven) ----------
    let candidate = state.candidatePerceptions.get(perceptionId);
    if (!candidate) {
      const quick = this._tryReid(state, pos, vel, now, cfg);
      if (quick) {
        quick.perceptionIds.add(perceptionId);
        this._claimReidTarget(state, quick, perceptionId, cfg);
        state.perceptionToStable.set(perceptionId, quick.stableId);
        this._updateTrackState(quick, pos, vel, now, cfg);
        state.stats.reid_count++;
        return this._emit(track, quick, perceptionId);
      }
      // Raj 1-frame IDs: hold unless re-ID matched — instant mint causes zig-zag.
      candidate = {
        firstSeen: now,
        firstPos: { x: pos.x, z: pos.z },
        lastPos: { x: pos.x, z: pos.z },
        lastTs: now,
        totalDisp: 0,
        minX: pos.x,
        maxX: pos.x,
        minZ: pos.z,
        maxZ: pos.z,
      };
      state.candidatePerceptions.set(perceptionId, candidate);
      return null;
    }
    candidate.totalDisp += Math.hypot(pos.x - candidate.lastPos.x, pos.z - candidate.lastPos.z);
    candidate.lastPos = { x: pos.x, z: pos.z };
    candidate.lastTs = now;
    if (pos.x < candidate.minX) candidate.minX = pos.x;
    if (pos.x > candidate.maxX) candidate.maxX = pos.x;
    if (pos.z < candidate.minZ) candidate.minZ = pos.z;
    if (pos.z > candidate.maxZ) candidate.maxZ = pos.z;
    const lifetime = now - candidate.firstSeen;
    const initialDisp = Math.hypot(pos.x - candidate.firstPos.x, pos.z - candidate.firstPos.z);
    const extent = Math.hypot(candidate.maxX - candidate.minX, candidate.maxZ - candidate.minZ);

    const softLife = cfg.ghost_soft_min_lifetime_ms;
    const softExtent = cfg.ghost_soft_min_extent_m;
    const softEnabled = softLife > 0 || softExtent > 0;

    if (softEnabled) {
      // Grocery-safe OR gate: promote if lived long enough OR covered enough
      // floor area. Only short+tiny flicker stays in probation.
      const livedLong = softLife <= 0 || lifetime >= softLife;
      const movedEnough = softExtent <= 0 || extent >= softExtent;
      if (!livedLong && !movedEnough) {
        if (cfg.reid_occlusion_bypass_promotion !== false) {
          const occlusion = this._tryReid(state, pos, vel, now, cfg, { occlusionOnly: true });
          if (occlusion) {
            state.candidatePerceptions.delete(perceptionId);
            this._claimReidTarget(state, occlusion, perceptionId, cfg);
            occlusion.perceptionIds.add(perceptionId);
            state.perceptionToStable.set(perceptionId, occlusion.stableId);
            this._updateTrackState(occlusion, pos, vel, now, cfg);
            state.stats.reid_count++;
            return this._emit(track, occlusion, perceptionId);
          }
        }
        return null;
      }
    } else {
      if (cfg.ghost_min_promotion_lifetime_ms > 0 && lifetime < cfg.ghost_min_promotion_lifetime_ms) {
        // Occlusion: new blip near a recently-lost track — merge before probation ends.
        if (cfg.reid_occlusion_bypass_promotion !== false) {
          const occlusion = this._tryReid(state, pos, vel, now, cfg, { occlusionOnly: true });
          if (occlusion) {
            state.candidatePerceptions.delete(perceptionId);
            this._claimReidTarget(state, occlusion, perceptionId, cfg);
            occlusion.perceptionIds.add(perceptionId);
            state.perceptionToStable.set(perceptionId, occlusion.stableId);
            this._updateTrackState(occlusion, pos, vel, now, cfg);
            state.stats.reid_count++;
            return this._emit(track, occlusion, perceptionId);
          }
        }
        return null;
      }
      if (candidate.totalDisp < cfg.ghost_min_promotion_displacement_m && initialDisp < cfg.ghost_min_promotion_displacement_m) {
        // Probation passed but the candidate barely moved — ghost.
        this._rejectGhost(state, 'jitter_no_motion');
        // Keep it in the candidate map so subsequent updates are also dropped (don't churn).
        return null;
      }
    }

    // ---------- Stage 4: try to re-identify against lost tracks ----------
    state.candidatePerceptions.delete(perceptionId);
    const matched = this._tryReid(state, pos, vel, now, cfg);
    let stableState;
    if (matched) {
      stableState = matched;
      stableState.perceptionIds.add(perceptionId);
      this._claimReidTarget(state, stableState, perceptionId, cfg);
      state.perceptionToStable.set(perceptionId, stableState.stableId);
      this._updateTrackState(stableState, pos, vel, now, cfg);
      state.stats.reid_count++;
    } else {
      // New stable identity
      stableState = this._createTrackState(state, pos, vel, now, cfg);
      state.activeTracks.set(stableState.stableId, stableState);
      state.perceptionToStable.set(perceptionId, stableState.stableId);
      stableState.perceptionIds.add(perceptionId);
      state.stats.new_stable_ids++;
    }

    return this._emit(track, stableState, perceptionId);
  }

  /**
   * Housekeeping pass — call periodically (e.g. every 250 ms) to:
   *  - Move stale active tracks to lost pool (newly_lost): caller should hide them
   *    immediately so they don't inflate live occupancy counts. They'll come back
   *    if perception re-IDs them within REID_MAX_GAP_S.
   *  - Drop lost tracks beyond REID_MAX_GAP_S (expired): permanent removal.
   *  - Drop static "fixture" tracks (static_fixture): permanent removal.
   *
   * Returns: Array<{ venueId, stableId, trackKey, reason: 'newly_lost'|'expired'|'static_fixture' }>
   */
  sweep(now = this.now()) {
    const events = [];
    for (const state of this.venues.values()) {
      const cfg = state.config;
      // active -> lost (or static fixture removal)
      for (const [stableId, t] of state.activeTracks) {
        if (cfg.ghost_static_timeout_s > 0
            && now - t.firstSeen > cfg.ghost_static_timeout_s * 1000
            && t.totalDisplacement < cfg.ghost_static_displacement_m) {
          // Static "fixture" — drop and free the stable ID.
          state.activeTracks.delete(stableId);
          state.stableShopperNumbers.delete(stableId);
          // In persist mode keep the binding so a reappearing id resurrects under
          // the SAME stable id (never mints a fresh one) — preserves the
          // stable_count <= perception_id_count invariant.
          if (!cfg.persist_perception_bindings) {
            for (const pid of t.perceptionIds) state.perceptionToStable.delete(pid);
          }
          events.push({ venueId: state.venueId, stableId, trackKey: t.lastTrackKey, reason: 'static_fixture' });
          state.stats.ghost_dropped++;
          state.stats.ghost_drop_reasons.static_fixture = (state.stats.ghost_drop_reasons.static_fixture || 0) + 1;
        } else if (now - t.lastTs > cfg.active_to_lost_timeout_ms) {
          state.activeTracks.delete(stableId);
          state.lostTracks.set(stableId, t);
          // Tell the caller to hide this track immediately. It may come back via re-ID,
          // in which case the regular `tracks` emission will re-introduce it.
          events.push({ venueId: state.venueId, stableId, trackKey: t.lastTrackKey, reason: 'newly_lost' });
        }
      }
      // lost expiry — permanent removal after REID_MAX_GAP_S
      for (const [stableId, t] of state.lostTracks) {
        if (now - t.lastTs > cfg.reid_max_gap_s * 1000) {
          state.lostTracks.delete(stableId);
          state.stableShopperNumbers.delete(stableId);
          // Persist mode: keep perception->stable bindings past expiry so the
          // same id resurrects under the same stable id instead of fragmenting.
          if (!cfg.persist_perception_bindings) {
            for (const pid of t.perceptionIds) state.perceptionToStable.delete(pid);
          }
          events.push({ venueId: state.venueId, stableId, trackKey: t.lastTrackKey, reason: 'expired' });
        }
      }
      // candidate expiry — perception IDs that never made it past probation
      const holdMs = Math.max(
        cfg.ghost_min_promotion_lifetime_ms || 0,
        cfg.ghost_soft_min_lifetime_ms || 0,
        500,
      );
      for (const [pid, c] of state.candidatePerceptions) {
        if (now - c.lastTs > 2 * holdMs) {
          state.candidatePerceptions.delete(pid);
        }
      }
      state.lastHousekeeping = now;
    }
    return events;
  }

  getStats(venueId = null) {
    if (venueId) {
      const state = this.venues.get(venueId);
      return state ? state.getStats() : null;
    }
    const all = {};
    for (const [vid, state] of this.venues) all[vid] = state.getStats();
    return all;
  }

  // ---------- internals ----------

  _rejectGhost(state, reason) {
    state.stats.ghost_dropped++;
    state.stats.ghost_drop_reasons[reason] = (state.stats.ghost_drop_reasons[reason] || 0) + 1;
  }

  _shopperNumberFor(state, stableId) {
    let n = state.stableShopperNumbers.get(stableId);
    if (n == null) {
      n = state.nextShopperNumber++;
      state.stableShopperNumbers.set(stableId, n);
    }
    return n;
  }

  _createTrackState(state, pos, vel, now, cfg, forcedId = null) {
    const stableId = forcedId || randomUUID();
    const shopperNumber = this._shopperNumberFor(state, stableId);
    return {
      stableId,
      shopperNumber,
      position: { x: pos.x, y: pos.y || 0, z: pos.z },
      velocity: { x: vel.x || 0, y: vel.y || 0, z: vel.z || 0 },
      smoothedPos: { x: pos.x, y: pos.y || 0, z: pos.z },
      smoothedVel: { x: vel.x || 0, y: vel.y || 0, z: vel.z || 0 },
      timestamp: now,
      firstSeen: now,
      lastTs: now,
      lastDisplacement: 0,
      totalDisplacement: 0,
      trail: [{ x: pos.x, z: pos.z, t: now }],
      perceptionIds: new Set(),
    };
  }

  _updateTrackState(t, pos, vel, now, cfg) {
    const dx = pos.x - t.position.x;
    const dz = pos.z - t.position.z;
    t.lastDisplacement = Math.hypot(dx, dz);
    t.totalDisplacement += t.lastDisplacement;
    t.position = { x: pos.x, y: pos.y || 0, z: pos.z };
    t.velocity = { x: vel.x || 0, y: vel.y || 0, z: vel.z || 0 };
    const a = cfg.smoothing_alpha;
    t.smoothedPos = {
      x: a * pos.x + (1 - a) * t.smoothedPos.x,
      y: pos.y || 0,
      z: a * pos.z + (1 - a) * t.smoothedPos.z,
    };
    t.smoothedVel = {
      x: a * (vel.x || 0) + (1 - a) * t.smoothedVel.x,
      y: vel.y || 0,
      z: a * (vel.z || 0) + (1 - a) * t.smoothedVel.z,
    };
    t.timestamp = now;
    t.lastTs = now;
    t.trail.push({ x: pos.x, z: pos.z, t: now });
    if (t.trail.length > cfg.trail_max_length) t.trail.shift();
  }

  /**
   * @param claimingPerceptionId the id that just won this track, if known.
   *
   * Re-ID asserts that the incoming perception id IS the person this track was
   * following, which means whatever id was feeding it before is finished. When
   * that old id keeps publishing — routine with a supplier that fragments an id
   * mid-walk and resumes it — both ids stay bound to the one stable id and the
   * emitted position alternates between two people standing metres apart. On the
   * canvas that is the zig-zag; in the data it is teleports and walked distance
   * the supplier never published. Evicting the previous bindings forces the old
   * id to re-qualify, so at worst it becomes a second identity, which is the
   * honest answer when there are two people.
   */
  _claimReidTarget(state, t, claimingPerceptionId = null, cfg = null) {
    state.lostTracks.delete(t.stableId);
    state.activeTracks.set(t.stableId, t);

    if (cfg?.reid_exclusive_bindings && claimingPerceptionId != null) {
      for (const pid of t.perceptionIds) {
        if (pid !== claimingPerceptionId) state.perceptionToStable.delete(pid);
      }
      // The set is what sweep() walks to release bindings, so it has to end up
      // holding exactly the id that now owns this track.
      t.perceptionIds.clear();
      t.perceptionIds.add(claimingPerceptionId);
    }
  }

  /** Lost tracks + active tracks quiet enough for re-ID (Raj ID churn). */
  _reidTargets(state, now, cfg) {
    const minQuietMs = Math.min(
      cfg.reid_churn_active_ms ?? 80,
      cfg.reid_stale_active_ms ?? 200,
    );
    const out = [];
    for (const t of state.lostTracks.values()) out.push(t);
    for (const t of state.activeTracks.values()) {
      if (now - t.lastTs >= minQuietMs) out.push(t);
    }
    return out;
  }

  _countNearbyTracks(state, pos, excludeStableId, radiusM, now, cfg) {
    if (!radiusM || radiusM <= 0) return 0;
    const r2 = radiusM * radiusM;
    let n = 0;
    for (const pool of [state.activeTracks, state.lostTracks]) {
      for (const [sid, t] of pool) {
        if (sid === excludeStableId) continue;
        const dx = pos.x - t.position.x;
        const dz = pos.z - t.position.z;
        if (dx * dx + dz * dz <= r2) n++;
      }
    }
    return n;
  }

  _tryReid(state, pos, vel, now, cfg, opts = {}) {
    const { occlusionOnly = false } = opts;
    const targets = this._reidTargets(state, now, cfg);
    if (targets.length === 0) return null;
    const slowThresh = cfg.reid_slow_speed_m_s ?? 0.35;
    const alignedCosMin = cfg.reid_aligned_cosine_min ?? 0.45;
    const alignedBoost = cfg.reid_aligned_distance_boost ?? 1.25;
    const staticDMax = cfg.reid_static_max_distance_m ?? 3.5;
    const staticImplied = cfg.reid_static_max_implied_speed_m_s ?? 1.2;
    const isoR = cfg.reid_isolation_radius_m ?? 0;

    let best = null;
    let bestCost = Infinity;
    for (const t of targets) {
      const dt = (now - t.lastTs) / 1000;
      if (dt > cfg.reid_max_gap_s) continue;

      const speedLost = Math.hypot(t.smoothedVel.x || 0, t.smoothedVel.z || 0);
      const speedNew = Math.hypot(vel.x || 0, vel.z || 0);
      // Occlusion rules apply when the person was slow/static at dropout — not when the
      // new perception blip reports noisy zero velocity on its first frames.
      const slowMode = speedLost < slowThresh;
      if (occlusionOnly && !slowMode) continue;

      const rawDx = pos.x - t.position.x;
      const rawDz = pos.z - t.position.z;
      const rawDist = Math.hypot(rawDx, rawDz);

      // Velocity prediction overshoots when the person was slowing down before dropout.
      const px = t.position.x + (t.smoothedVel.x || 0) * dt;
      const pz = t.position.z + (t.smoothedVel.z || 0) * dt;
      const predDist = Math.hypot(pos.x - px, pos.z - pz);

      const dist = slowMode ? rawDist : Math.min(rawDist, predDist);

      const cos = _cosine(vel, t.smoothedVel);
      let dMax = cfg.reid_max_distance_m;
      if (slowMode) {
        dMax = staticDMax;
      } else if (cos >= alignedCosMin) {
        dMax *= alignedBoost;
      }
      if (dist > dMax) continue;

      const impliedSpeed = dt > 0.05 ? rawDist / dt : 0;
      const impliedCap = slowMode ? staticImplied : cfg.reid_max_implied_speed_m_s;
      if (impliedSpeed > impliedCap) continue;

      if (!slowMode && cos < cfg.reid_velocity_cosine_min) continue;

      if (slowMode && isoR > 0 && this._countNearbyTracks(state, pos, t.stableId, isoR, now, cfg) > 0) {
        continue;
      }

      const cost =
        cfg.reid_weight_distance * dist +
        cfg.reid_weight_velocity * (slowMode ? 0 : (1 - cos)) +
        cfg.reid_weight_time * dt;
      if (cost < bestCost) {
        bestCost = cost;
        best = t;
      }
    }
    return best;
  }

  _emit(originalTrack, stableState, perceptionId) {
    const trackKey = `${originalTrack.deviceId || 'edge'}:${stableState.stableId}`;
    // Remember the trackKey used in the last emission so the housekeeping sweep
    // can issue a matching `track_removed` event when the track is removed.
    stableState.lastTrackKey = trackKey;
    return {
      ...originalTrack,
      id: stableState.stableId,
      stableId: stableState.stableId,
      originalPerceptionId: perceptionId,
      shopperNumber: stableState.shopperNumber,
      trackKey,
      venuePosition: { ...stableState.position },
      velocity: { ...stableState.smoothedVel },
      smoothedPosition: { ...stableState.smoothedPos },
      smoothedVelocity: { ...stableState.smoothedVel },
      rawPosition: originalTrack.venuePosition || originalTrack.position,
      rawVelocity: originalTrack.velocity || { x: 0, y: 0, z: 0 },
      // Track quality hints for the UI
      _reconciler: {
        firstSeen: stableState.firstSeen,
        totalDisplacement: stableState.totalDisplacement,
        perceptionIdCount: stableState.perceptionIds.size,
      },
    };
  }
}

function _cosine(a, b) {
  const ax = a?.x || 0, az = a?.z || 0;
  const bx = b?.x || 0, bz = b?.z || 0;
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 1e-3 || lb < 1e-3) return 1; // unknown direction → don't penalize
  return (ax * bx + az * bz) / (la * lb);
}

export default TrajectoryReconciler;
