/**
 * Live in-memory visitor session tracking (Phase 3).
 * Assigns visitor_session_id to zone visits as they finalize.
 */

import { randomUUID } from 'crypto';
import { normalizeVisitSessionConfig } from '../config/visitSessionConfig.js';

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export class VisitSessionManager {
  constructor() {
    /** @type {Map<string, object>} venueId -> state */
    this.venues = new Map();
  }

  getVenueState(venueId, config) {
    if (!this.venues.has(venueId)) {
      this.venues.set(venueId, {
        config: normalizeVisitSessionConfig(config),
        /** sessionId -> session */
        sessions: new Map(),
        /** trackKey -> sessionId */
        trackToSession: new Map(),
        /** stableId -> sessionId */
        stableToSession: new Map(),
      });
    }
    const state = this.venues.get(venueId);
    if (config) state.config = normalizeVisitSessionConfig(config);
    return state;
  }

  /**
   * Resolve or create visitor_session_id for a finalized zone visit.
   */
  resolveForVisit(venueId, visit, { isEntranceRoi, isCheckoutRoi, config }) {
    const state = this.getVenueState(venueId, config);
    const cfg = state.config;
    const now = visit.endTime || visit.startTime;
    this.expireSessions(state, now);

    const trackKey = visit.trackKey;
    const stableId = visit.stableId || null;
    const pos = visit.exitPosition || visit.entryPosition || null;

    let sessionId = state.trackToSession.get(trackKey) || (stableId && state.stableToSession.get(stableId));

    if (!sessionId && isEntranceRoi && visit.durationMs >= cfg.entranceMinDurationMs) {
      sessionId = `vs-${randomUUID()}`;
      state.sessions.set(sessionId, {
        sessionId,
        startTime: visit.startTime,
        lastActivity: now,
        converted: false,
        trackKeys: new Set([trackKey]),
        lastExit: pos,
      });
      this.bindTrack(state, sessionId, trackKey, stableId);
      if (isCheckoutRoi) this.markConverted(state, sessionId);
      return sessionId;
    }

    if (!sessionId) {
      sessionId = this.tryLinkOpenSession(state, visit, pos, now);
    }

    if (sessionId) {
      const session = state.sessions.get(sessionId);
      session.lastActivity = now;
      session.lastExit = pos || session.lastExit;
      session.trackKeys.add(trackKey);
      this.bindTrack(state, sessionId, trackKey, stableId);
      if (isCheckoutRoi) this.markConverted(state, sessionId);
      return sessionId;
    }

    return null;
  }

  /** Track position sample — link new fragment before visit ends. */
  registerTrackSample(venueId, trackKey, stableId, timestamp, position, config) {
    const state = this.getVenueState(venueId, config);
    this.expireSessions(state, timestamp);

    if (state.trackToSession.has(trackKey)) return state.trackToSession.get(trackKey);
    if (stableId && state.stableToSession.has(stableId)) {
      return state.stableToSession.get(stableId);
    }

    const fakeVisit = {
      trackKey,
      startTime: timestamp,
      endTime: timestamp,
      entryPosition: position,
      exitPosition: position,
    };
    return this.tryLinkOpenSession(state, fakeVisit, position, timestamp);
  }

  tryLinkOpenSession(state, visit, pos, now) {
    const cfg = state.config;
    let bestId = null;
    let bestGap = Infinity;

    for (const [sessionId, session] of state.sessions) {
      if (now - session.startTime > cfg.maxVisitDurationMs) continue;
      const gap = visit.startTime - session.lastActivity;
      if (gap < -2000 || gap > cfg.reidMaxGapMs) continue;
      const d = dist(session.lastExit, pos || visit.entryPosition);
      if (d <= cfg.reidMaxDistanceM && gap < bestGap) {
        bestGap = gap;
        bestId = sessionId;
      }
    }

    if (bestId) {
      this.bindTrack(state, bestId, visit.trackKey, visit.stableId);
      return bestId;
    }
    return null;
  }

  bindTrack(state, sessionId, trackKey, stableId) {
    state.trackToSession.set(trackKey, sessionId);
    if (stableId) state.stableToSession.set(stableId, sessionId);
  }

  markConverted(state, sessionId) {
    const session = state.sessions.get(sessionId);
    if (session) session.converted = true;
  }

  expireSessions(state, now) {
    const cfg = state.config;
    for (const [sessionId, session] of state.sessions) {
      const idle = now - session.lastActivity;
      const total = now - session.startTime;
      if (idle > cfg.reidMaxGapMs * 3 || total > cfg.maxVisitDurationMs) {
        for (const key of session.trackKeys) {
          state.trackToSession.delete(key);
        }
        state.sessions.delete(sessionId);
      }
    }
  }
}

/** Singleton used by TrajectoryStorageService. */
export const visitSessionManager = new VisitSessionManager();
