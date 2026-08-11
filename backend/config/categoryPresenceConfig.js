/**
 * Category presence metrics — engagement (shelf face) vs category dwell (aisle halo).
 * Stored per-venue in dwg_transform_json.category_presence.
 *
 * Approved defaults (2026-08-11 Treviglio raw-track study):
 *   δ_D = 2.0 m category dwell, δ_E = 0.5 m engagement,
 *   τ_gap dwell = 3 s, τ_stitch = 8 s, identity = raw perception id.
 */

export const DEFAULT_CATEGORY_PRESENCE_CONFIG = Object.freeze({
  /** Distance to category ROI union for category dwell (metres). */
  categoryDwellRadiusM: 2.0,
  /** Distance for engagement; also true when inside the painted ROI (metres). */
  engagementRadiusM: 0.5,
  /** Must stay outside the dwell halo this long to close a dwell episode (seconds). */
  dwellGapS: 3,
  /** Merge consecutive dwell episodes if the gap between them is shorter (seconds). 0 = off. */
  dwellStitchS: 8,
  /** Gap to close an engagement episode (seconds). */
  engagementGapS: 1,
  /** Drop flicker shorter than this (seconds). */
  dwellMinDurationS: 2,
  engagementMinDurationS: 0.5,
  /**
   * Which identity column to attribute presence to.
   *   raw       — original_perception_id (safer while live luca over-merges)
   *   track_key — reconciled stable id
   */
  identityMode: 'raw',
});

export function normalizeCategoryPresenceConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_CATEGORY_PRESENCE_CONFIG };
  }
  const out = { ...DEFAULT_CATEGORY_PRESENCE_CONFIG };
  for (const key of Object.keys(DEFAULT_CATEGORY_PRESENCE_CONFIG)) {
    if (raw[key] !== undefined && raw[key] !== null) out[key] = raw[key];
  }

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v)));
  out.categoryDwellRadiusM = clamp(out.categoryDwellRadiusM, 0.5, 5);
  out.engagementRadiusM = clamp(out.engagementRadiusM, 0, 2);
  if (out.engagementRadiusM > out.categoryDwellRadiusM) {
    out.engagementRadiusM = out.categoryDwellRadiusM;
  }
  out.dwellGapS = clamp(out.dwellGapS, 1, 15);
  out.dwellStitchS = clamp(out.dwellStitchS, 0, 30);
  out.engagementGapS = clamp(out.engagementGapS, 0.5, 5);
  out.dwellMinDurationS = clamp(out.dwellMinDurationS, 0.5, 30);
  out.engagementMinDurationS = clamp(out.engagementMinDurationS, 0.2, 10);

  if (out.identityMode !== 'track_key' && out.identityMode !== 'raw') {
    out.identityMode = 'raw';
  }
  return out;
}

export function loadCategoryPresenceConfigFromTransformJson(transformJson) {
  if (!transformJson) return { ...DEFAULT_CATEGORY_PRESENCE_CONFIG };
  try {
    const parsed = typeof transformJson === 'string' ? JSON.parse(transformJson) : transformJson;
    return normalizeCategoryPresenceConfig(parsed?.category_presence);
  } catch {
    return { ...DEFAULT_CATEGORY_PRESENCE_CONFIG };
  }
}
