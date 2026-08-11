/**
 * Shared reconciler parameter sets.
 * LUCA_LIVE is the owner-tuned Treviglio live default — do not widen without approval.
 *
 * 2026-08-11: tightened after Live-samples audit — 12s/12.7m was chaining
 * store-crossing identity merges (28m jumps, span>40m). New gates keep
 * aisle-scale re-ID without teleport chains.
 */

export const LUCA_LIVE_RECONCILER_RAW = Object.freeze({
  enabled: true,

  ghost_max_speed_m_s: 3.5,
  // Legacy AND gates stay off — soft OR filter below is the grocery-safe gate.
  ghost_min_promotion_lifetime_ms: 0,
  ghost_min_promotion_displacement_m: 0,
  // Soft filter from 2026-08-08 Treviglio sweep: drop only short+tiny flicker
  // (span<2s AND extent<0.5m). Keeps 100% of dweller-candidates and ~97% of
  // people-present; vendor net>=2m kept only ~45% of dwellers.
  ghost_soft_min_lifetime_ms: 2000,
  ghost_soft_min_extent_m: 0.5,
  ghost_static_timeout_s: 90,
  ghost_static_displacement_m: 1.6,

  reid_max_gap_s: 7,
  reid_max_distance_m: 5.0,
  reid_max_implied_speed_m_s: 2.0,
  reid_velocity_cosine_min: 0.25,
  reid_weight_distance: 4,
  reid_weight_velocity: 0.5,
  reid_weight_time: 3.1,
  reid_slow_speed_m_s: 0.35,
  reid_static_max_distance_m: 2.5,
  reid_static_max_implied_speed_m_s: 1.0,
  reid_aligned_cosine_min: 0.45,
  reid_aligned_distance_boost: 1.15,
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
