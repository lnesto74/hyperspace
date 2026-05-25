/**
 * Resolve campaign targets to engagement ROIs and category labels for PEBLE attribution.
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

/**
 * Map shelf/category targets to Smart KPI engagement ROI ids.
 */
export function resolveEngagementRoiIds(db, venueId, target) {
  if (!target?.ids?.length) return [];

  const roiIds = new Set(target.engagementRoiIds || []);
  const rows = db.prepare(`
    SELECT id, metadata_json FROM regions_of_interest WHERE venue_id = ?
  `).all(venueId);

  for (const row of rows) {
    const meta = parseJson(row.metadata_json) || {};
    if (meta.template !== 'shelf-engagement' || !meta.shelfId) continue;

    if (target.type === 'shelf' && target.ids.includes(meta.shelfId)) {
      roiIds.add(row.id);
    }
  }

  return [...roiIds];
}

/**
 * Enrich campaign target with engagement ROI ids + category labels (persisted in target_json).
 */
export function resolveCampaignTarget(db, venueId, target) {
  if (!target?.type || !Array.isArray(target.ids)) return target;

  const enriched = { ...target };
  const categoryLabels = new Set(enriched.categoryLabels || []);

  if (target.type === 'shelf') {
    for (const shelfId of target.ids) {
      const resolved = resolveShelfCategories(db, shelfId);
      resolved.categories.forEach((c) => categoryLabels.add(c));
      const obj = db.prepare('SELECT metadata_json FROM venue_objects WHERE id = ?').get(shelfId);
      const meta = parseJson(obj?.metadata_json) || {};
      if (meta.business_category_label) categoryLabels.add(meta.business_category_label);
      if (meta.business_category) categoryLabels.add(meta.business_category);
    }
    enriched.engagementRoiIds = resolveEngagementRoiIds(db, venueId, target);
  }

  if (categoryLabels.size > 0) {
    enriched.categoryLabels = [...categoryLabels];
  }

  return enriched;
}

/**
 * Clear cached attribution results so the next run re-evaluates conversions.
 */
export function clearCampaignAttribution(db, campaignId, startTs, endTs) {
  const eventIds = db.prepare(`
    SELECT id FROM dooh_attribution_events
    WHERE campaign_id = ? AND exposure_end_ts >= ? AND exposure_end_ts <= ?
  `).all(campaignId, startTs, endTs).map(r => r.id);

  if (eventIds.length > 0) {
    const placeholders = eventIds.map(() => '?').join(',');
    db.prepare(`
      DELETE FROM dooh_control_matches
      WHERE attribution_event_id IN (${placeholders})
    `).run(...eventIds);
    db.prepare(`
      DELETE FROM dooh_attribution_events
      WHERE id IN (${placeholders})
    `).run(...eventIds);
  }

  db.prepare(`
    DELETE FROM dooh_campaign_kpis
    WHERE campaign_id = ? AND bucket_start_ts >= ? AND bucket_start_ts <= ?
  `).run(campaignId, startTs, endTs);

  return { clearedEvents: eventIds.length };
}
