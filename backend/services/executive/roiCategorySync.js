/**
 * Propagate venue_objects.business_category_label → ROI metadata when missing.
 */

import { resolveShelfCategories } from '../ShelfCategoryResolver.js';

function parseMeta(json) {
  if (!json) return {};
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return {};
  }
}

function resolveLinkedCategoryLabel(db, meta) {
  const shelfId = meta.shelfId || meta.cashierId || null;
  if (!shelfId) return null;
  const resolved = resolveShelfCategories(db, shelfId);
  return resolved.categories[0]
    || resolved.business_category?.business_category_label
    || null;
}

/** Write missing business_category_label from linked shelf objects. Returns rows updated. */
export function ensureRoiCategoryLabels(db, venueId) {
  const rois = db.prepare(
    'SELECT id, metadata_json FROM regions_of_interest WHERE venue_id = ?',
  ).all(venueId);

  const update = db.prepare(
    'UPDATE regions_of_interest SET metadata_json = ? WHERE id = ?',
  );

  let updated = 0;
  const run = db.transaction(() => {
    for (const roi of rois) {
      const meta = parseMeta(roi.metadata_json);
      const existing = meta.business_category_label || meta.business_category;
      if (existing && String(existing).trim() && existing !== 'Uncategorized') continue;

      const label = resolveLinkedCategoryLabel(db, meta);
      if (!label || label === 'Uncategorized' || label === 'No content available') continue;

      meta.business_category_label = label;
      if (!meta.business_category) meta.business_category = label;
      update.run(JSON.stringify(meta), roi.id);
      updated++;
    }
    return updated;
  });

  return run();
}
