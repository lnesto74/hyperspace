/**
 * Resolve product category for an ROI (planogram SKUs, ROI metadata, or linked shelf object).
 */
import { resolveShelfCategories } from '../ShelfCategoryResolver.js';

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function resolveRoiCategoryLabel(mainDb, venueId, roiId) {
  if (!mainDb || !roiId) return null;

  try {
    const row = mainDb.prepare(
      'SELECT metadata_json FROM regions_of_interest WHERE id = ? AND venue_id = ?',
    ).get(roiId, venueId);
    if (!row?.metadata_json) return null;

    const metadata = parseJson(row.metadata_json) || {};
    if (metadata.business_category_label) return metadata.business_category_label;
    if (metadata.business_category) return metadata.business_category;

    const shelfId = metadata.shelfId;
    if (shelfId) {
      const resolved = resolveShelfCategories(mainDb, shelfId);
      if (resolved.categories[0]) return resolved.categories[0];
    }
  } catch (err) {
    console.warn('[RoiCategoryResolver] resolveRoiCategoryLabel failed:', err.message);
  }

  return null;
}

export default { resolveRoiCategoryLabel };
