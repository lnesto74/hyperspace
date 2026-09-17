/**
 * Live served-counter / checkout-queue alert state machine (STEP B).
 *
 * Fires when people ≥ N for ≥ M consecutive minutes; clears after 1 minute below N.
 */

export const DEFAULT_COUNTER_ALERT = { n: 3, mMinutes: 2, clearMinutes: 1 };
export const DEFAULT_CHECKOUT_ALERT = { n: 4, mMinutes: 3, clearMinutes: 1 };

/**
 * @param {object} state  { since: number|null, lastAbove: number|null, lastBelow: number|null, active: boolean }
 * @param {number} people
 * @param {number} nowMs
 * @param {{ n: number, mMinutes: number, clearMinutes: number }} rule
 */
export function stepAlert(state, people, nowMs, rule) {
  const next = { ...state };
  const n = rule.n;
  if (people >= n) {
    next.lastAbove = nowMs;
    next.lastBelow = null;
    if (next.since == null) next.since = nowMs;
    const heldMin = (nowMs - next.since) / 60000;
    if (!next.active && heldMin >= rule.mMinutes) {
      next.active = true;
    }
  } else {
    if (next.lastBelow == null) next.lastBelow = nowMs;
    const belowMin = (nowMs - next.lastBelow) / 60000;
    if (belowMin >= rule.clearMinutes) {
      next.active = false;
      next.since = null;
      next.lastAbove = null;
    }
  }
  next.people = people;
  return next;
}

export function alertEvent(kind, venueId, key, state) {
  if (!state.active || state.since == null) return null;
  return {
    type: kind,
    venueId,
    counter: kind === 'counter_queue_alert' ? key : undefined,
    lane: kind === 'queue_wait' ? key : undefined,
    people: state.people,
    since: new Date(state.since).toISOString(),
    minutes: Math.round((Date.now() - state.since) / 60000),
  };
}

export class CounterAlertTracker {
  constructor({
    counterRule = DEFAULT_COUNTER_ALERT,
    checkoutRule = DEFAULT_CHECKOUT_ALERT,
    now = Date.now,
  } = {}) {
    this.counterRule = counterRule;
    this.checkoutRule = checkoutRule;
    this.now = now;
    /** venueId -> { counters: {name: state}, lanes: {name: state} } */
    this.venues = new Map();
  }

  _bucket(venueId) {
    let b = this.venues.get(venueId);
    if (!b) {
      b = { counters: {}, lanes: {} };
      this.venues.set(venueId, b);
    }
    return b;
  }

  updateCounters(venueId, peopleByCounter) {
    const b = this._bucket(venueId);
    const t = this.now();
    for (const [name, people] of Object.entries(peopleByCounter || {})) {
      b.counters[name] = stepAlert(b.counters[name] || emptyState(), people, t, this.counterRule);
    }
    return this.active(venueId);
  }

  updateLanes(venueId, peopleByLane) {
    const b = this._bucket(venueId);
    const t = this.now();
    for (const [name, people] of Object.entries(peopleByLane || {})) {
      b.lanes[name] = stepAlert(b.lanes[name] || emptyState(), people, t, this.checkoutRule);
    }
    return this.active(venueId);
  }

  active(venueId) {
    const b = this.venues.get(venueId);
    if (!b) return [];
    const out = [];
    for (const [k, st] of Object.entries(b.counters)) {
      const ev = alertEvent('counter_queue_alert', venueId, k, { ...st, people: st.people });
      if (ev) out.push(ev);
    }
    for (const [k, st] of Object.entries(b.lanes)) {
      const ev = alertEvent('queue_wait', venueId, k, { ...st, people: st.people });
      if (ev) out.push(ev);
    }
    return out;
  }

  snapshot(venueId) {
    const b = this.venues.get(venueId);
    if (!b) return { counters: {}, lanes: {}, alerts: [] };
    const counters = {};
    for (const [k, st] of Object.entries(b.counters)) counters[k] = st.people ?? 0;
    const lanes = {};
    for (const [k, st] of Object.entries(b.lanes)) lanes[k] = st.people ?? 0;
    return { counters, lanes, alerts: this.active(venueId) };
  }
}

function emptyState() {
  return { since: null, lastAbove: null, lastBelow: null, active: false, people: 0 };
}

export const counterAlertTracker = new CounterAlertTracker();
