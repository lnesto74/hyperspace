/**
 * Per-SKU slot performance from track_positions + planogram geometry.
 * Computes Attraction and Attention indices for a rolling time window.
 */

import {
  distance2D,
  distanceToShelfFootprint,
  loadVenueSkuSlots,
  speed2D,
} from './planogramSlotGeometry.js';
import { inferEsselungaImageUrl, isEmptyScrapedValue } from './ScrapeGraphCatalogService.js';

export const DEFAULT_SKU_PROXIMITY = {
  dAudience: 2.5,
  dAttract: 1.2,
  dSlot: 0.8,
  vSlowMax: 0.35,
  sampleGapCapMs: 5000,
  windowMs: 30000,
  minAudience: 1,
  minViewers: 1,
  weightAttraction: 0.4,
  weightAttention: 0.6,
};

const BADGE_IMAGE_RE = /\/displayable\/.*\.webp/i;

export function resolveSkuDisplayImage(sku) {
  if (!sku) return null;
  const raw = sku.imageUrl || sku.image_url;
  if (!isEmptyScrapedValue(raw) && String(raw).startsWith('http') && !BADGE_IMAGE_RE.test(String(raw))) {
    return String(raw).trim();
  }
  const inferred = inferEsselungaImageUrl(
    sku.skuCode || sku.sku_code,
    raw,
    'https://spesaonline.esselunga.it/',
  );
  if (inferred && !BADGE_IMAGE_RE.test(inferred)) return inferred;
  return null;
}

function slotKey(shelfId, levelIndex, slotIndex) {
  return `${shelfId}:${levelIndex}:${slotIndex}`;
}

/**
 * @param {Array<{track_key, timestamp, position_x, position_z, velocity_x, velocity_z}>} positions
 */
export function computeSkuSlotMetrics({
  shelves,
  slots,
  positions,
  windowStart,
  windowEnd,
  params = DEFAULT_SKU_PROXIMITY,
}) {
  if (!slots.length || !positions.length) {
    return { slotMetrics: [], shelfAudience: new Map() };
  }

  const slotsByShelf = new Map();
  for (const slot of slots) {
    if (!slotsByShelf.has(slot.shelfId)) slotsByShelf.set(slot.shelfId, []);
    slotsByShelf.get(slot.shelfId).push(slot);
  }

  const shelfById = new Map(shelves.map((s) => [s.id, s]));

  /** @type {Map<string, { audience: Set, viewers: Set, attentionMs: number, dwellMs: number }>} */
  const slotStats = new Map();
  for (const slot of slots) {
    slotStats.set(slotKey(slot.shelfId, slot.levelIndex, slot.slotIndex), {
      audience: new Set(),
      viewers: new Set(),
      attentionMs: 0,
      dwellMs: 0,
    });
  }

  /** shelfId → Set<trackKey> */
  const shelfAudience = new Map();
  for (const shelf of shelves) shelfAudience.set(shelf.id, new Set());

      /** trackKey||shelfId → dwell ms */
  const trackShelfDwell = new Map();

  const byTrack = new Map();
  for (const p of positions) {
    if (p.timestamp < windowStart || p.timestamp > windowEnd) continue;
    if (!byTrack.has(p.track_key)) byTrack.set(p.track_key, []);
    byTrack.get(p.track_key).push(p);
  }

  for (const [, trackSamples] of byTrack) {
    trackSamples.sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < trackSamples.length; i++) {
      const sample = trackSamples[i];
      const prev = trackSamples[i - 1];
      const dt = prev
        ? Math.min(sample.timestamp - prev.timestamp, params.sampleGapCapMs)
        : 0;

      const px = sample.position_x;
      const pz = sample.position_z;
      const spd = speed2D(sample.velocity_x, sample.velocity_z);

      let closestShelf = null;
      let closestShelfDist = Infinity;
      for (const shelf of shelves) {
        const d = distanceToShelfFootprint(px, pz, shelf);
        if (d < closestShelfDist) {
          closestShelfDist = d;
          closestShelf = shelf;
        }
      }

      if (!closestShelf) continue;

      if (closestShelfDist <= params.dAudience) {
        shelfAudience.get(closestShelf.id)?.add(sample.track_key);
      }

      const isAttracted = closestShelfDist <= params.dAttract
        || (closestShelfDist <= params.dAudience && spd <= params.vSlowMax);

      if (isAttracted && dt > 0) {
        const dwellKey = `${sample.track_key}||${closestShelf.id}`;
        trackShelfDwell.set(dwellKey, (trackShelfDwell.get(dwellKey) || 0) + dt);
      }

      if (!isAttracted) continue;

      const shelfSlots = slotsByShelf.get(closestShelf.id) || [];
      let nearestSlot = null;
      let nearestDist = Infinity;
      for (const slot of shelfSlots) {
        const d = distance2D(px, pz, slot.worldX, slot.worldZ);
        if (d < nearestDist) {
          nearestDist = d;
          nearestSlot = slot;
        }
      }

      if (!nearestSlot || nearestDist > params.dSlot) continue;

      const key = slotKey(nearestSlot.shelfId, nearestSlot.levelIndex, nearestSlot.slotIndex);
      const stats = slotStats.get(key);
      if (!stats) continue;

      stats.audience.add(sample.track_key);
      stats.viewers.add(sample.track_key);

      if (dt > 0 && (nearestDist <= params.dSlot || spd <= params.vSlowMax)) {
        stats.attentionMs += dt;
      }
    }
  }

  // Attribute shelf dwell to slots a viewer looked at
  for (const [dwellKey, dwellMs] of trackShelfDwell) {
    const sep = dwellKey.lastIndexOf('||');
    const trackKey = dwellKey.slice(0, sep);
    const shelfId = dwellKey.slice(sep + 2);
    const shelfSlots = slotsByShelf.get(shelfId) || [];
    for (const slot of shelfSlots) {
      const key = slotKey(slot.shelfId, slot.levelIndex, slot.slotIndex);
      const stats = slotStats.get(key);
      if (stats?.viewers.has(trackKey)) {
        stats.dwellMs += dwellMs;
      }
    }
  }

  const slotMetrics = [];
  for (const slot of slots) {
    const key = slotKey(slot.shelfId, slot.levelIndex, slot.slotIndex);
    const stats = slotStats.get(key);
    const aud = shelfAudience.get(slot.shelfId)?.size || 0;
    const viewers = stats?.viewers.size || 0;
    const attentionMs = stats?.attentionMs || 0;
    const dwellMs = stats?.dwellMs || 0;

    const attractionIndex = aud > 0 ? viewers / aud : 0;
    const attentionIndex = dwellMs > 0 ? (attentionMs / dwellMs) * 100 : 0;
    const compositeScore = params.weightAttraction * attractionIndex
      + params.weightAttention * (attentionIndex / 100);

    slotMetrics.push({
      slotKey: key,
      shelfId: slot.shelfId,
      shelfName: slot.shelfName,
      levelIndex: slot.levelIndex,
      slotIndex: slot.slotIndex,
      skuItemId: slot.skuItemId,
      skuCode: slot.skuCode,
      name: slot.name,
      brand: slot.brand,
      price: slot.price,
      imageUrl: resolveSkuDisplayImage(slot),
      worldX: slot.worldX,
      worldZ: slot.worldZ,
      audience: aud,
      viewers,
      attentionSeconds: attentionMs / 1000,
      dwellSeconds: dwellMs / 1000,
      attractionIndex,
      attentionIndex,
      compositeScore,
    });
  }

  return { slotMetrics, shelfAudience };
}

const LIVE_TRAIL_STEP_MS = 100;

/**
 * Live tracks from TrackAggregator (~10s trail) — fills gap before track_positions DB sync (60s).
 */
export function collectLiveTrackPositions(trackAggregator, venueId, windowStart, windowEnd) {
  if (!trackAggregator || trackAggregator.venueId !== venueId) return [];

  const now = Date.now();
  const positions = [];

  for (const [trackKey, entry] of trackAggregator.tracks) {
    if (now - entry.lastUpdate > 15000) continue;

    const trail = entry.trail || [];
    const vx = entry.track?.velocity?.x || 0;
    const vz = entry.track?.velocity?.z || 0;

    for (let i = 0; i < trail.length; i++) {
      const ts = entry.lastUpdate - (trail.length - 1 - i) * LIVE_TRAIL_STEP_MS;
      if (ts < windowStart || ts > windowEnd) continue;
      const pt = trail[i];
      positions.push({
        track_key: trackKey,
        timestamp: ts,
        position_x: pt.x,
        position_z: pt.z,
        velocity_x: vx,
        velocity_z: vz,
      });
    }
  }

  return positions;
}

export function mergeTrackPositions(dbPositions, livePositions) {
  const seen = new Set(
    dbPositions.map((p) => `${p.track_key}:${Math.floor(p.timestamp / 1000)}`),
  );
  const merged = [...dbPositions];
  for (const p of livePositions) {
    const key = `${p.track_key}:${Math.floor(p.timestamp / 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(p);
  }
  merged.sort((a, b) => a.timestamp - b.timestamp || a.track_key.localeCompare(b.track_key));
  return merged;
}

export function pickBestWorstSlots(slotMetrics, params = DEFAULT_SKU_PROXIMITY) {
  const eligible = slotMetrics.filter(
    (m) => m.audience >= params.minAudience && m.viewers >= params.minViewers,
  );
  if (eligible.length === 0) return { best: null, worst: null, eligible: [] };

  const sorted = [...eligible].sort((a, b) => b.compositeScore - a.compositeScore);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return {
    best,
    worst: sorted.length > 1 && worst.slotKey !== best.slotKey ? worst : null,
    eligible: sorted,
  };
}

export function computeVenueSkuPerformance(db, venueId, options = {}) {
  const params = { ...DEFAULT_SKU_PROXIMITY, ...options };
  const windowEnd = options.windowEnd ?? Date.now();
  const windowStart = windowEnd - params.windowMs;
  const trackAggregator = options.trackAggregator ?? null;

  const { shelves, slots } = loadVenueSkuSlots(db, venueId);
  if (!slots.length) {
    return {
      best: null,
      worst: null,
      slotMetrics: [],
      windowMs: params.windowMs,
      diagnostic: 'no_planogram_slots',
    };
  }

  const dbPositions = db.prepare(`
    SELECT track_key, timestamp, position_x, position_z, velocity_x, velocity_z
    FROM track_positions
    WHERE venue_id = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY track_key, timestamp ASC
  `).all(venueId, windowStart, windowEnd);

  const livePositions = collectLiveTrackPositions(trackAggregator, venueId, windowStart, windowEnd);
  const positions = mergeTrackPositions(dbPositions, livePositions);

  const { slotMetrics } = computeSkuSlotMetrics({
    shelves,
    slots,
    positions,
    windowStart,
    windowEnd,
    params,
  });

  const { best, worst, eligible } = pickBestWorstSlots(slotMetrics, params);

  let diagnostic = null;
  if (!best) {
    if (positions.length === 0) diagnostic = 'no_track_samples_in_window';
    else if (eligible.length === 0) diagnostic = 'insufficient_audience_near_shelves';
    else diagnostic = 'no_ranked_slots';
  }

  return {
    best,
    worst,
    slotMetrics,
    windowMs: params.windowMs,
    windowStart,
    windowEnd,
    sampleCount: positions.length,
    dbSampleCount: dbPositions.length,
    liveSampleCount: livePositions.length,
    slotCount: slots.length,
    eligibleCount: eligible.length,
    diagnostic,
  };
}

export function buildSkuPerformanceAlerts(performance, now = Date.now()) {
  const alerts = [];
  const windowLabel = `${Math.round((performance.windowMs || 30000) / 1000)}s`;

  if (performance.best) {
    const b = performance.best;
    alerts.push({
      id: 'sku-best-performer',
      type: 'sku_best',
      severity: 'low',
      title: 'TOP SKU',
      message: `${b.name} — Attraction ${(b.attractionIndex * 100).toFixed(0)}%, Attention ${b.attentionIndex.toFixed(1)} (last ${windowLabel})`,
      action: 'Strong shelf placement — consider expanding facings',
      timestamp: now,
      skuItemId: b.skuItemId,
      skuCode: b.skuCode,
      skuName: b.name,
      brand: b.brand,
      imageUrl: b.imageUrl,
      shelfId: b.shelfId,
      shelfName: b.shelfName,
      levelIndex: b.levelIndex,
      slotIndex: b.slotIndex,
      attractionIndex: b.attractionIndex,
      attentionIndex: b.attentionIndex,
      compositeScore: b.compositeScore,
      viewers: b.viewers,
      audience: b.audience,
      rank: 'best',
    });
  }

  if (performance.worst) {
    const w = performance.worst;
    alerts.push({
      id: 'sku-worst-performer',
      type: 'sku_worst',
      severity: 'medium',
      title: 'UNDERPERFORMING SKU',
      message: `${w.name} — Attraction ${(w.attractionIndex * 100).toFixed(0)}%, Attention ${w.attentionIndex.toFixed(1)} (last ${windowLabel})`,
      action: 'Review placement, signage, or facing — low shopper interest',
      timestamp: now,
      skuItemId: w.skuItemId,
      skuCode: w.skuCode,
      skuName: w.name,
      brand: w.brand,
      imageUrl: w.imageUrl,
      shelfId: w.shelfId,
      shelfName: w.shelfName,
      levelIndex: w.levelIndex,
      slotIndex: w.slotIndex,
      attractionIndex: w.attractionIndex,
      attentionIndex: w.attentionIndex,
      compositeScore: w.compositeScore,
      viewers: w.viewers,
      audience: w.audience,
      rank: 'worst',
    });
  }

  return alerts;
}

export default {
  DEFAULT_SKU_PROXIMITY,
  collectLiveTrackPositions,
  mergeTrackPositions,
  computeSkuSlotMetrics,
  pickBestWorstSlots,
  computeVenueSkuPerformance,
  buildSkuPerformanceAlerts,
  resolveSkuDisplayImage,
};
