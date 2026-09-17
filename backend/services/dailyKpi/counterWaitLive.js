/**
 * Rolling 1-minute served-counter occupancy on the live aggregator (STEP B).
 * Band ≈ SHELF_ENGAGEMENT ROI of the counter department, minus staff strips.
 * Phantom filter: previous-day drop list is applied when provided; checkout
 * fixed-object rule uses the same 600 s / 1.2 m gates as the daily job.
 */

import { counterAlertTracker, DEFAULT_COUNTER_ALERT, DEFAULT_CHECKOUT_ALERT } from './counterAlerts.js';

const SERVED = ['Carne', 'Pesce', 'Bar', 'Gastronomia', 'Salumi', 'Pane'];
const WAIT_SPEED = 0.3;

function pointInRect(x, z, r) {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

function pointInPoly(x, z, vertices) {
  if (!vertices || vertices.length < 3) return false;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, zi = vertices[i].z;
    const xj = vertices[j].x, zj = vertices[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function countWaitingInBands(tracks, bands, staffStrips, droppedIds, speedMax = WAIT_SPEED) {
  const counts = {};
  for (const b of bands) counts[b.dept] = 0;
  for (const t of tracks) {
    if (droppedIds && droppedIds.has(t.originalPerceptionId || t.id)) continue;
    const pos = t.venuePosition || t.position;
    if (!pos) continue;
    const spd = Math.hypot(t.velocity?.x || 0, t.velocity?.z || 0);
    if (spd >= speedMax) continue;
    if (staffStrips?.some((s) => pointInRect(pos.x, pos.z, s))) continue;
    for (const b of bands) {
      if (pointInPoly(pos.x, pos.z, b.vertices)) {
        counts[b.dept] += 1;
        break;
      }
    }
  }
  return counts;
}

export function loadCounterBandsFromDb(db, venueId) {
  const rois = db.prepare(
    `SELECT name, vertices, metadata_json FROM regions_of_interest WHERE venue_id = ?`,
  ).all(venueId);
  const bands = [];
  for (const r of rois) {
    let meta = {};
    try { meta = JSON.parse(r.metadata_json || '{}'); } catch { meta = {}; }
    const dept = meta.business_category_label || meta.business_category;
    const isEng = meta.template === 'shelf-engagement' || /engagement/i.test(r.name || '');
    if (!isEng || !SERVED.includes(dept)) continue;
    let vertices = r.vertices;
    if (typeof vertices === 'string') {
      try { vertices = JSON.parse(vertices); } catch { vertices = []; }
    }
    if (vertices?.length >= 3) bands.push({ dept, vertices });
  }
  return bands;
}

export function startCounterWaitLoop({
  db,
  trackAggregator,
  venueId,
  intervalMs = 10_000,
  staffStrips = [],
  droppedIds = new Set(),
  counterRule = DEFAULT_COUNTER_ALERT,
  checkoutRule = DEFAULT_CHECKOUT_ALERT,
} = {}) {
  if (!trackAggregator || !venueId) return () => {};
  const bands = db ? loadCounterBandsFromDb(db, venueId) : [];
  const tick = () => {
    const tracks = [];
    for (const [, entry] of trackAggregator.tracks || []) {
      if (entry?.track) tracks.push(entry.track);
    }
    const counts = countWaitingInBands(tracks, bands, staffStrips, droppedIds);
    counterAlertTracker.updateCounters(venueId, counts);
    const lanes = {};
    try {
      const rois = db?.prepare(
        `SELECT id, name FROM regions_of_interest WHERE venue_id = ?`,
      ).all(venueId) || [];
      for (const r of rois) {
        if (!/queue/i.test(r.name || '')) continue;
        lanes[r.name] = trackAggregator.getZoneOccupancy?.(r.id) ?? 0;
      }
    } catch { /* ignore */ }
    counterAlertTracker.updateLanes(venueId, lanes);
  };
  const iv = setInterval(tick, intervalMs);
  tick();
  return () => clearInterval(iv);
}

export { SERVED, WAIT_SPEED };
