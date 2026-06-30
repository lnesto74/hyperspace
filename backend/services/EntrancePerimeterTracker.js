/**
 * Live (~10Hz) entrance footfall via perimeter-edge crossing on the MQTT trail.
 * Replaces polygon-inside zone_visits for entrance / traffic ROIs.
 */
import { isTrafficZoneName } from '../lib/storeHours.js';
import {
  parseRoiVertices,
  perimeterEdges,
  movementCrossesPerimeter,
} from '../lib/entrancePerimeterCrossing.js';

const GATE_CACHE_MS = 120_000;

export class EntrancePerimeterTracker {
  constructor(db, trajectoryStorage) {
    this.db = db;
    this.storage = trajectoryStorage;
    /** @type {Map<string, { gates: Array<{ id: string, edges: object[] }>, loadedAt: number }>} */
    this.gateCache = new Map();
    /** @type {Map<string, { x: number, z: number, t: number }>} */
    this.lastPos = new Map();
  }

  invalidateVenue(venueId) {
    this.gateCache.delete(venueId);
  }

  clearTrack(trackKey) {
    this.lastPos.delete(trackKey);
  }

  loadGates(venueId) {
    const cached = this.gateCache.get(venueId);
    if (cached && Date.now() - cached.loadedAt < GATE_CACHE_MS) return cached.gates;

    const gateIds = new Set();
    try {
      const venue = this.db.prepare('SELECT footfall_roi_id FROM venues WHERE id = ?').get(venueId);
      if (venue?.footfall_roi_id) gateIds.add(venue.footfall_roi_id);

      const rois = this.db.prepare(
        'SELECT id, name, vertices FROM regions_of_interest WHERE venue_id = ?',
      ).all(venueId);

      for (const r of rois) {
        const n = (r.name || '').toLowerCase();
        if (isTrafficZoneName(r.name) || /entrance|entry|ingress|ingresso/.test(n)) {
          gateIds.add(r.id);
        }
      }

      const gates = [];
      for (const r of rois) {
        if (!gateIds.has(r.id)) continue;
        const verts = parseRoiVertices(r.vertices);
        if (verts.length < 3) continue;
        gates.push({ id: r.id, name: r.name, edges: perimeterEdges(verts) });
      }

      this.gateCache.set(venueId, { gates, loadedAt: Date.now() });
      return gates;
    } catch (err) {
      console.warn('[EntrancePerimeter] loadGates failed:', err.message);
      return [];
    }
  }

  /**
   * Process one live track update (call at MQTT / aggregator rate, not 3s DB sample).
   * @param {string} venueId
   * @param {{ trackKey: string, venuePosition?: { x: number, z: number }, timestamp?: number, stableId?: string }} track
   */
  processTrack(venueId, track) {
    if (!venueId || !track?.trackKey) return;
    if (track.trackKey.startsWith('replay-') || track.trackKey.includes('cashier')) return;

    const pos = track.venuePosition;
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.z)) return;

    const t = Number(track.timestamp) || Date.now();
    const cur = { x: pos.x, z: pos.z, t };
    const prev = this.lastPos.get(track.trackKey);
    this.lastPos.set(track.trackKey, cur);

    if (!prev) return;

    const gates = this.loadGates(venueId);
    if (!gates.length) return;

    for (const gate of gates) {
      if (!movementCrossesPerimeter(prev, cur, gate.edges)) continue;
      this.storage.recordPerimeterCrossing({
        venueId,
        roiId: gate.id,
        trackKey: track.trackKey,
        crossedAt: t,
        x: cur.x,
        z: cur.z,
        stableId: track.stableId || null,
      });
    }
  }

  /** Process a full aggregator snapshot (~10Hz). */
  processBatch(venueId, tracks) {
    if (!tracks?.length) return;
    for (const track of tracks) {
      this.processTrack(venueId, track);
    }
  }
}
