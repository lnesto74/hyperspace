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

const CACHE_TTL_MS = 120 * 1000;
const _cache = new Map(); // venueId -> { ts, zones }

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
