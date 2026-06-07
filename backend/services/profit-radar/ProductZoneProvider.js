/**
 * ProductZoneProvider
 *
 * Resolves which engagement ROIs map to a shelf that actually has planogram
 * products assigned (i.e. the "What's on this shelf" card will render items).
 * Profit Radar uses this to guarantee the demo always surfaces a few
 * product-rich shelves, and to carry the real roiId on those insights.
 *
 * Read-only. Mirrors the shelf-resolution used by /roi/:roiId/shelf-info.
 */

import { marginPerUnit } from './recoveryModel.js';

const CACHE_TTL_MS = 120 * 1000;
const _cache = new Map(); // venueId -> { ts, zones }
const _shelfEconCache = new Map(); // roiId -> { ts, econ }

function resolveShelfId(db, roi) {
  // Method 1: explicit shelfId on the ROI metadata.
  if (roi.metadata_json) {
    try { const m = JSON.parse(roi.metadata_json); if (m.shelfId) return m.shelfId; } catch { /* ignore */ }
  }
  // Method 2: "ShelfName - Engagement (...)" name pattern.
  if (roi.name) {
    const match = roi.name.match(/^(.+?)\s*-\s*Engagement/i);
    if (match) {
      const shelf = db.prepare(
        "SELECT id FROM venue_objects WHERE venue_id = ? AND name = ? AND type = 'shelf'"
      ).get(roi.venue_id, match[1].trim());
      if (shelf) return shelf.id;
    }
  }
  // Method 3: nearest shelf within 3m of the ROI centroid.
  try {
    const verts = JSON.parse(roi.vertices || '[]');
    if (verts.length > 0) {
      const cx = verts.reduce((s, v) => s + (v.x || 0), 0) / verts.length;
      const cz = verts.reduce((s, v) => s + (v.z ?? v.y ?? 0), 0) / verts.length;
      const shelves = db.prepare(
        "SELECT id, position_x, position_z FROM venue_objects WHERE venue_id = ? AND type = 'shelf'"
      ).all(roi.venue_id);
      let min = 3, best = null;
      for (const s of shelves) {
        const d = Math.hypot((s.position_x ?? 0) - cx, (s.position_z ?? 0) - cz);
        if (d < min) { min = d; best = s.id; }
      }
      if (best) return best;
    }
  } catch { /* ignore */ }
  return null;
}

function countShelfProducts(db, shelfId) {
  let row = db.prepare(`
    SELECT sp.slots_json FROM shelf_planograms sp
    JOIN planograms p ON sp.planogram_id = p.id
    WHERE sp.shelf_id = ? AND p.status = 'active'
    ORDER BY p.updated_at DESC LIMIT 1
  `).get(shelfId);
  if (!row) row = db.prepare('SELECT slots_json FROM shelf_planograms WHERE shelf_id = ? LIMIT 1').get(shelfId);
  if (!row || !row.slots_json) return 0;
  try {
    const slots = JSON.parse(row.slots_json);
    let n = 0;
    for (const lvl of (slots.levels || [])) {
      for (const s of (lvl.slots || [])) if (s && s.skuItemId) n++;
    }
    return n;
  } catch { return 0; }
}

/** Collect distinct skuItemIds placed on a shelf's active planogram. */
function getShelfSkuIds(db, shelfId) {
  let row = db.prepare(`
    SELECT sp.slots_json FROM shelf_planograms sp
    JOIN planograms p ON sp.planogram_id = p.id
    WHERE sp.shelf_id = ? AND p.status = 'active'
    ORDER BY p.updated_at DESC LIMIT 1
  `).get(shelfId);
  if (!row) row = db.prepare('SELECT slots_json FROM shelf_planograms WHERE shelf_id = ? LIMIT 1').get(shelfId);
  if (!row || !row.slots_json) return [];
  try {
    const slots = JSON.parse(row.slots_json);
    const ids = new Set();
    for (const lvl of (slots.levels || [])) {
      for (const s of (lvl.slots || [])) if (s && s.skuItemId) ids.add(s.skuItemId);
    }
    return [...ids];
  } catch { return []; }
}

/**
 * Real per-shelf economics for the ROI behind an insight: average unit price,
 * average gross margin per unit, SKU count, and the highest-margin SKUs.
 * Used to ground recovery € in the products actually on the shelf.
 *
 * @returns {{ avgPrice:number, avgMarginPerUnit:number, skuCount:number,
 *   topSkus:{name:string,price:number,marginPerUnit:number}[], basis:'shelf'|'none' }}
 */
export function getShelfEconomicsByRoi(db, roiId, fallbackMarginPct = 30) {
  const empty = { avgPrice: 0, avgMarginPerUnit: 0, skuCount: 0, topSkus: [], basis: 'none' };
  if (!db || !roiId) return empty;
  const hit = _shelfEconCache.get(roiId);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.econ;
  try {
    const roi = db.prepare(
      'SELECT id, name, metadata_json, vertices, venue_id FROM regions_of_interest WHERE id = ?'
    ).get(roiId);
    if (!roi) return empty;
    const shelfId = resolveShelfId(db, roi);
    if (!shelfId) { _shelfEconCache.set(roiId, { ts: Date.now(), econ: empty }); return empty; }

    const skuIds = getShelfSkuIds(db, shelfId);
    if (skuIds.length === 0) { _shelfEconCache.set(roiId, { ts: Date.now(), econ: empty }); return empty; }

    const get = db.prepare('SELECT name, price, margin, category FROM sku_items WHERE id = ?');
    let priceSum = 0, priceCount = 0, mpuSum = 0, mpuCount = 0;
    const skus = [];
    for (const id of skuIds) {
      const sku = get.get(id);
      if (!sku) continue;
      const price = Number(sku.price);
      const mpu = marginPerUnit(sku, fallbackMarginPct);
      if (Number.isFinite(price) && price > 0) { priceSum += price; priceCount++; }
      if (Number.isFinite(mpu) && mpu > 0) { mpuSum += mpu; mpuCount++; }
      skus.push({ name: sku.name, price: Number.isFinite(price) ? price : 0, marginPerUnit: Number.isFinite(mpu) ? mpu : 0 });
    }
    const avgPrice = priceCount > 0 ? priceSum / priceCount : 0;
    const avgMarginPerUnit = mpuCount > 0 ? mpuSum / mpuCount : 0;
    const topSkus = skus.sort((a, b) => b.marginPerUnit - a.marginPerUnit).slice(0, 5);
    const econ = {
      avgPrice: +avgPrice.toFixed(2),
      avgMarginPerUnit: +avgMarginPerUnit.toFixed(2),
      skuCount: skuIds.length,
      topSkus,
      basis: avgMarginPerUnit > 0 ? 'shelf' : 'none',
    };
    _shelfEconCache.set(roiId, { ts: Date.now(), econ });
    return econ;
  } catch (err) {
    console.warn('[ProductZoneProvider] shelf economics failed:', err.message);
    return empty;
  }
}

/**
 * @returns {{ roiId: string, roiName: string, shelfId: string, productCount: number }[]}
 *   product-bearing engagement zones, sorted by product count (desc).
 */
export function getProductZones(db, venueId) {
  if (!db || !venueId) return [];
  const hit = _cache.get(venueId);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.zones;
  try {
    const rois = db.prepare(
      'SELECT id, name, metadata_json, vertices, venue_id FROM regions_of_interest WHERE venue_id = ?'
    ).all(venueId);
    const out = [];
    const seenShelf = new Set();
    for (const roi of rois) {
      const shelfId = resolveShelfId(db, roi);
      if (!shelfId || seenShelf.has(shelfId)) continue;
      const productCount = countShelfProducts(db, shelfId);
      if (productCount <= 0) continue;
      seenShelf.add(shelfId);
      out.push({ roiId: roi.id, roiName: roi.name, shelfId, productCount });
    }
    out.sort((a, b) => b.productCount - a.productCount);
    _cache.set(venueId, { ts: Date.now(), zones: out });
    return out;
  } catch (err) {
    console.warn('[ProductZoneProvider] failed:', err.message);
    return [];
  }
}

export default getProductZones;
