/**
 * Visit session stitching — tunable parameters.
 * Stored per-venue in dwg_transform_json.visit_session (optional override).
 */

export const DEFAULT_VISIT_SESSION_CONFIG = Object.freeze({
  /** Max store visit length from entrance crossing (ms). */
  maxVisitDurationMs: 90 * 60 * 1000,
  /** Max gap between track fragments to chain (ms). Grocery LiDAR: typically 5–10 s. */
  reidMaxGapMs: 10_000,
  /** Max distance (m) between fragment exit and next entry to chain. */
  reidMaxDistanceM: 4.5,
  /** Min entrance dwell to seed a visit session (ms). */
  entranceMinDurationMs: 5_000,
  /** Min total in-store duration to classify as browse (sec). */
  minInStoreDurationSec: 30,
  /** How to match fragmented track_keys: reid_chain | suffix_alias | exact */
  trackKeyMode: 'reid_chain',
  /** Optional POS / manual conversion rate for calibration display (0–1). */
  calibrationConversionRate: null,
});

export function normalizeVisitSessionConfig(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_VISIT_SESSION_CONFIG };
  }
  const out = { ...DEFAULT_VISIT_SESSION_CONFIG };
  for (const key of Object.keys(DEFAULT_VISIT_SESSION_CONFIG)) {
    if (raw[key] !== undefined && raw[key] !== null) {
      out[key] = raw[key];
    }
  }
  if (typeof out.maxVisitDurationMs === 'number') {
    out.maxVisitDurationMs = Math.max(60_000, Math.min(out.maxVisitDurationMs, 4 * 60 * 60 * 1000));
  }
  if (typeof out.reidMaxGapMs === 'number') {
    out.reidMaxGapMs = Math.max(2_000, Math.min(out.reidMaxGapMs, 30_000));
  }
  if (typeof out.calibrationConversionRate === 'number') {
    out.calibrationConversionRate = Math.max(0, Math.min(out.calibrationConversionRate, 1));
  }
  if (typeof out.reidMaxDistanceM === 'number') {
    out.reidMaxDistanceM = Math.max(1, Math.min(out.reidMaxDistanceM, 15));
  }
  if (typeof out.minInStoreDurationSec === 'number') {
    out.minInStoreDurationSec = Math.max(5, Math.min(out.minInStoreDurationSec, 600));
  }
  const validModes = new Set(['reid_chain', 'suffix_alias', 'exact']);
  if (!validModes.has(out.trackKeyMode)) {
    out.trackKeyMode = DEFAULT_VISIT_SESSION_CONFIG.trackKeyMode;
  }
  return out;
}

export function loadVisitSessionConfigFromTransformJson(transformJson) {
  if (!transformJson) return { ...DEFAULT_VISIT_SESSION_CONFIG };
  try {
    const parsed = typeof transformJson === 'string' ? JSON.parse(transformJson) : transformJson;
    return normalizeVisitSessionConfig(parsed?.visit_session);
  } catch {
    return { ...DEFAULT_VISIT_SESSION_CONFIG };
  }
}
