/**
 * FrameOccupancyTracker
 * ---------------------
 * Counts people the same way fast3dis / edge activePeopleCount does:
 * unique perception IDs in the current (or last complete) perception frame.
 *
 * Edge publishes one MQTT message per object with a shared frame timestamp.
 * Hyperspace aggregator TTL counts IDs across seconds → ~2× inflation on Raj.
 */

export class FrameOccupancyTracker {
  constructor() {
    /** @type {Map<string, object>} */
    this.venues = new Map();
  }

  _state(venueId) {
    let s = this.venues.get(venueId);
    if (!s) {
      s = {
        frameTs: null,
        ids: new Set(),
        lastCompleteCount: 0,
        lastCompleteTs: null,
        lastCompleteIds: new Set(),
        lastWallMs: 0,
      };
      this.venues.set(venueId, s);
    }
    return s;
  }

  /**
   * @param {string} venueId
   * @param {string|number} perceptionId - raw perception object id
   * @param {number} frameTimestamp - frame timestamp from perception (shared per frame)
   */
  ingest(venueId, perceptionId, frameTimestamp) {
    if (!venueId || perceptionId == null) return;
    const ts = Number(frameTimestamp) || Date.now();
    const pid = String(perceptionId);
    const s = this._state(venueId);

    if (s.frameTs !== null && ts !== s.frameTs) {
      s.lastCompleteCount = s.ids.size;
      s.lastCompleteTs = s.frameTs;
      s.lastCompleteIds = new Set(s.ids);
      s.ids.clear();
    }
    s.frameTs = ts;
    s.ids.add(pid);
    s.lastWallMs = Date.now();
  }

  /** Instant occupancy — matches len(fast3dis.objects) when frames flow at 10 Hz. */
  getOccupancy(venueId) {
    const s = this.venues.get(venueId);
    if (!s) return 0;
    const age = Date.now() - s.lastWallMs;
    if (age < 250 && s.ids.size > 0) return s.ids.size;
    return s.lastCompleteCount || s.ids.size || 0;
  }

  getLiveFrameTimestamp(venueId) {
    const s = this.venues.get(venueId);
    if (!s) return null;
    const age = Date.now() - s.lastWallMs;
    if (age < 250 && s.frameTs != null) return s.frameTs;
    return s.lastCompleteTs ?? s.frameTs ?? null;
  }

  isInLiveFrame(venueId, perceptionId, trackTimestamp) {
    const s = this.venues.get(venueId);
    if (!s || perceptionId == null) return false;
    const pid = String(perceptionId);
    const ts = Number(trackTimestamp);
    if (!Number.isFinite(ts)) return false;
    if (ts === s.frameTs && s.ids.has(pid)) return true;
    if (ts === s.lastCompleteTs && s.lastCompleteIds.has(pid)) return true;
    return false;
  }
}

export default FrameOccupancyTracker;
