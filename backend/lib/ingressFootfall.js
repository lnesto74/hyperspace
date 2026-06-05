/**
 * Live ingress footfall counting (Option B).
 *
 * Aligns Business Reporting with analysis/lib/footfall.mjs: count every qualifying
 * crossing through the entrance ROI (entries and exits), not one row per fragment ID.
 *
 * zone_visits stores one row per in-zone episode; COUNT(*) sums all episodes while
 * COUNT(DISTINCT track_key) under-counts re-entries and over-weights fragment splits.
 */
export const INGRESS_VISIT_COUNT_SQL = 'COUNT(*)';
