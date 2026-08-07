/**
 * Resolve shelf/ROI product categories:
 * 1. Planogram SKU categories (when planogram has SKUs)
 * 2. Venue object business_category from DWG mapping (fallback)
 */

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function collectSkuIdsFromSlots(slotsJson) {
  const slots = parseJson(slotsJson);
  if (!slots) return [];

  const skuIds = new Set();
  for (const level of slots.levels || []) {
    for (const slot of level.slots || []) {
      if (slot.skuItemId) skuIds.add(slot.skuItemId);
    }
  }
  return [...skuIds];
}

/**
 * Placeholders the planogram importer writes when a SKU row carries no real
 * category. They are not categories, and treating them as one hides the shelf
 * fixture's own label behind a string no shopper would recognise.
 */
const PLACEHOLDER_CATEGORIES = new Set([
  'no content available',
  'uncategorized',
  'uncategorised',
  'n/a',
  '-',
]);

const isRealCategory = (c) => {
  const s = String(c ?? '').trim();
  return s.length > 0 && !PLACEHOLDER_CATEGORIES.has(s.toLowerCase());
};

export function getPlanogramSkuCategories(db, shelfId) {
  const row = db.prepare('SELECT slots_json FROM shelf_planograms WHERE shelf_id = ?').get(shelfId);
  if (!row?.slots_json) return [];

  const skuIds = collectSkuIdsFromSlots(row.slots_json);
  if (!skuIds.length) return [];

  const placeholders = skuIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT DISTINCT category FROM sku_items
     WHERE id IN (${placeholders}) AND category IS NOT NULL
     ORDER BY category`
  ).all(...skuIds).map((r) => r.category).filter(isRealCategory);
}

export function getObjectBusinessCategory(db, shelfId) {
  const row = db.prepare('SELECT type, metadata_json FROM venue_objects WHERE id = ?').get(shelfId);
  if (!row) return null;

  const meta = parseJson(row.metadata_json) || {};
  const label = meta.business_category_label || meta.business_category;
  if (!isRealCategory(label)) return null;

  return {
    objectType: row.type || null,
    business_category_id: meta.business_category_id || null,
    business_category: meta.business_category || null,
    business_category_label: meta.business_category_label || label,
    categories: [meta.business_category_label || label],
  };
}

/**
 * @returns {{ categories: string[], source: 'planogram'|'object'|'none', objectType?: string|null, business_category?: object|null }}
 */
export function resolveShelfCategories(db, shelfId) {
  if (!shelfId) {
    return { categories: [], source: 'none', objectType: null, business_category: null };
  }

  const planogramCategories = getPlanogramSkuCategories(db, shelfId);
  if (planogramCategories.length > 0) {
    return {
      categories: planogramCategories,
      source: 'planogram',
      objectType: null,
      business_category: null,
    };
  }

  const objectCategory = getObjectBusinessCategory(db, shelfId);
  if (objectCategory?.categories?.length) {
    return {
      categories: objectCategory.categories,
      source: 'object',
      objectType: objectCategory.objectType,
      business_category: objectCategory,
    };
  }

  return { categories: [], source: 'none', objectType: null, business_category: null };
}

export default { resolveShelfCategories, getPlanogramSkuCategories, getObjectBusinessCategory };
