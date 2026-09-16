/**
 * Port of analysis/journey_lab/41_ids_phantoms.py CASE (thresholds from config).
 * STATIC_SUSPECT is kept as a customer (suspect_is_customer: true).
 */

export const DEFAULT_PHANTOM_FILTER = {
  min_path_m: 1.0,
  min_extent_m: 0.5,
  min_duration_s: 1.0,
  static_duration_s: 600,
  static_extent_m: 3.0,
  suspect_duration_s: 300,
  suspect_extent_m: 1.5,
  max_median_speed_m_s: 3.5,
  suspect_is_customer: true,
};

/** First matching CASE wins — same order as 41_ids_phantoms.py. */
export function classifyId(id, pf = DEFAULT_PHANTOM_FILTER) {
  const dur = Number(id.dur_s) || 0;
  const extent = Number(id.extent_m) || 0;
  const path = Number(id.path_m) || 0;
  const med = Number(id.med_spd_w) || 0;
  if (dur >= pf.static_duration_s && extent < pf.static_extent_m) return 'PHANTOM_STATIC';
  if (dur >= pf.suspect_duration_s && extent < pf.suspect_extent_m) return 'STATIC_SUSPECT';
  if (path < pf.min_path_m && extent < pf.min_extent_m) return 'PHANTOM_MICRO';
  if (dur < pf.min_duration_s) return 'FLICKER_SHORT';
  if (med > pf.max_median_speed_m_s) return 'SPEED_ANOMALY';
  return 'VALID';
}

export function isCustomerClass(cls, pf = DEFAULT_PHANTOM_FILTER) {
  if (cls === 'VALID') return true;
  if (cls === 'STATIC_SUSPECT' && pf.suspect_is_customer) return true;
  return false;
}
