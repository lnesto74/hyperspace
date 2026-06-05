/** Reconciler presets for benchmark verify step.
 *
 * INVARIANT: every enabled reconciler must emit <= raw perception-id count.
 * `persist_perception_bindings: true` guarantees this — a raw id keeps ONE
 * stable id for the whole capture (resurrects under the same id after gaps)
 * instead of fragmenting into many. This is what fixed reconciled > raw.
 */
export const VERIFY_CONFIGS = [
  ['BYPASS_RAW', { enabled: false }],
  ['BASELINE_DEFAULT', { persist_perception_bindings: true }],
  ['GROCERY_BALANCED', {
    enabled: true,
    ghost_max_speed_m_s: 3.5,
    ghost_min_promotion_lifetime_ms: 200,
    ghost_min_promotion_displacement_m: 0.05,
    ghost_static_timeout_s: 90,
    ghost_static_displacement_m: 0.3,
    reid_max_gap_s: 15,
    reid_max_distance_m: 8.0,
    reid_max_implied_speed_m_s: 2.5,
    reid_velocity_cosine_min: -0.3,
    reid_weight_distance: 1.0,
    reid_weight_velocity: 0.5,
    reid_weight_time: 0.1,
    smoothing_alpha: 0.7,
    active_to_lost_timeout_ms: 1500,
    trail_max_length: 32,
    persist_perception_bindings: true,
  }],
  ['GROCERY_AGGRESSIVE', {
    enabled: true,
    ghost_max_speed_m_s: 3.5,
    ghost_min_promotion_lifetime_ms: 150,
    ghost_min_promotion_displacement_m: 0.05,
    ghost_static_timeout_s: 120,
    ghost_static_displacement_m: 0.3,
    reid_max_gap_s: 20,
    reid_max_distance_m: 10.0,
    reid_max_implied_speed_m_s: 2.5,
    reid_velocity_cosine_min: -0.5,
    reid_weight_distance: 0.8,
    reid_weight_velocity: 0.6,
    reid_weight_time: 0.1,
    smoothing_alpha: 0.7,
    active_to_lost_timeout_ms: 2000,
    trail_max_length: 48,
    persist_perception_bindings: true,
  }],
  ['GROCERY_CONSERVATIVE', {
    enabled: true,
    ghost_max_speed_m_s: 3.5,
    ghost_min_promotion_lifetime_ms: 300,
    ghost_min_promotion_displacement_m: 0.1,
    ghost_static_timeout_s: 90,
    ghost_static_displacement_m: 0.3,
    reid_max_gap_s: 10,
    reid_max_distance_m: 5.0,
    reid_max_implied_speed_m_s: 2.0,
    reid_velocity_cosine_min: 0.0,
    reid_weight_distance: 1.0,
    reid_weight_velocity: 0.5,
    reid_weight_time: 0.1,
    smoothing_alpha: 0.7,
    active_to_lost_timeout_ms: 1200,
    trail_max_length: 32,
    persist_perception_bindings: true,
  }],
  // Raj v1.0.1 — tighter re-ID (analysis/runs/raj_preset_sweep, 35m window May 2026)
  ['RAJ_v1_CONSERVATIVE', {
    enabled: true,
    ghost_max_speed_m_s: 3.5,
    ghost_min_promotion_lifetime_ms: 200,
    ghost_min_promotion_displacement_m: 0.05,
    ghost_static_timeout_s: 90,
    ghost_static_displacement_m: 0.3,
    reid_max_gap_s: 8,
    reid_max_distance_m: 4.0,
    reid_max_implied_speed_m_s: 2.0,
    reid_velocity_cosine_min: 0.0,
    reid_weight_distance: 1.0,
    reid_weight_velocity: 0.5,
    reid_weight_time: 0.1,
    smoothing_alpha: 0.7,
    active_to_lost_timeout_ms: 1500,
    trail_max_length: 32,
    persist_perception_bindings: true,
  }],
  ['RAJ_v1_BALANCED', {
    enabled: true,
    ghost_max_speed_m_s: 3.5,
    ghost_min_promotion_lifetime_ms: 200,
    ghost_min_promotion_displacement_m: 0.05,
    ghost_static_timeout_s: 90,
    ghost_static_displacement_m: 0.3,
    reid_max_gap_s: 10,
    reid_max_distance_m: 5.0,
    reid_max_implied_speed_m_s: 2.2,
    reid_velocity_cosine_min: -0.2,
    reid_weight_distance: 1.0,
    reid_weight_velocity: 0.5,
    reid_weight_time: 0.1,
    smoothing_alpha: 0.7,
    active_to_lost_timeout_ms: 1500,
    trail_max_length: 32,
    persist_perception_bindings: true,
  }],
  // Map-aware v2 (batch): tracklets + geodesic probabilistic association.
  // Runs in the raw perception frame with a capture-derived walkability grid so
  // it stays directly comparable to the raw + v1 rows above.
  ['GROCERY_V2_MAP', {
    engine: 'v2',
    smoothing_alpha: 0.6,
    min_chain_life_ms: 0,
    tracklet: {},
    // Best params from the label-scored sweep (capture 0106): ~43 frag/person
    // (vs ~57) with zero 'different'-label violations. See reconcile_tune.mjs.
    associate: { C_max: 12, margin: 0.3, T_max_s: 45, D_max_m: 8 },
  }],
  // v3 = v2 baseline + Stage-0 concurrent-duplicate fusion (design doc §13).
  ['GROCERY_V3_MAP', {
    engine: 'v3',
    smoothing_alpha: 0.6,
    min_chain_life_ms: 0,
    tracklet: {},
    fuseConcurrent: { proximityM: 1.5, minOverlapMs: 300, requireDifferentSource: true },
    associate: { C_max: 12, margin: 0.3, T_max_s: 45, D_max_m: 8 },
  }],
];

/** All reconciler preset names emitted in benchmark scorecards. */
export const VERIFY_CONFIG_NAMES = VERIFY_CONFIGS.map(([name]) => name);
