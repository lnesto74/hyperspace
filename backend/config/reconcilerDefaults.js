/**
 * Shared reconciler parameter sets.
 * LUCA_LIVE is the owner-tuned Treviglio live default — do not change without approval.
 */

export const LUCA_LIVE_RECONCILER_RAW = Object.freeze({
  enabled: true,

  ghost_max_speed_m_s: 3.5,
  ghost_min_promotion_lifetime_ms: 0,
  ghost_min_promotion_displacement_m: 0,
  ghost_static_timeout_s: 90,
  ghost_static_displacement_m: 1.6,

  reid_max_gap_s: 12,
  reid_max_distance_m: 12.7,
  reid_max_implied_speed_m_s: 2.6,
  reid_velocity_cosine_min: 0.2,
  reid_weight_distance: 4,
  reid_weight_velocity: 0.5,
  reid_weight_time: 3.1,
  reid_slow_speed_m_s: 0.35,
  reid_static_max_distance_m: 3.5,
  reid_static_max_implied_speed_m_s: 1.2,
  reid_aligned_cosine_min: 0.45,
  reid_aligned_distance_boost: 1.25,
  reid_isolation_radius_m: 2.5,
  reid_occlusion_bypass_promotion: true,
  reid_stale_active_ms: 200,
  reid_churn_active_ms: 80,
  reid_nn_enabled: false,
  reid_nn_max_distance_m: 2.5,
  reid_nn_min_separation_m: 0.6,

  smoothing_alpha: 0.12,
  active_to_lost_timeout_ms: 6000,
  trail_max_length: 100,
});
