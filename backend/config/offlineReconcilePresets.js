/**
 * Offline reconciliation presets — tuned for full-recording post-processing.
 * Live canvas should NOT use these; run via Replay panel → Post-process job.
 */
import { DEFAULT_CONFIG, normalizeReconcilerConfig } from '../services/TrajectoryReconciler.js';

/** Grocery-store motion heuristics applied only in batch merge pass. */
export const GROCERY_MOTION = Object.freeze({
  max_walk_speed_m_s: 2.2,
  max_aisle_turn_cos: -0.15,
  min_fragment_samples: 4,
  min_fragment_disp_m: 1.0,
  merge_distance_bonus_m: 2.0,
});

export const OFFLINE_RECONCILE_PRESETS = [
  {
    id: 'GROCERY_BALANCED',
    label: 'Grocery — Balanced',
    description: 'Best general grocery post-process: ghost filter + aisle-aware re-ID merge across full session.',
    config: normalizeReconcilerConfig({
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 0,
      ghost_min_promotion_displacement_m: 0.03,
      ghost_static_timeout_s: 120,
      ghost_static_displacement_m: 0.35,
      reid_max_gap_s: 18,
      reid_max_distance_m: 9.0,
      reid_max_implied_speed_m_s: 2.4,
      reid_velocity_cosine_min: -0.25,
      smoothing_alpha: 0.55,
      active_to_lost_timeout_ms: 2500,
      trail_max_length: 64,
      offline_instant_promote: true,
      persist_perception_bindings: true,
    }),
  },
  {
    id: 'GROCERY_AGGRESSIVE',
    label: 'Grocery — Aggressive merge',
    description: 'Maximum fragment stitching for continuity; use when density is moderate.',
    config: normalizeReconcilerConfig({
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 0,
      ghost_min_promotion_displacement_m: 0.02,
      ghost_static_timeout_s: 150,
      ghost_static_displacement_m: 0.4,
      reid_max_gap_s: 25,
      reid_max_distance_m: 12.0,
      reid_max_implied_speed_m_s: 2.5,
      reid_velocity_cosine_min: -0.45,
      smoothing_alpha: 0.5,
      active_to_lost_timeout_ms: 3500,
      trail_max_length: 80,
      offline_instant_promote: true,
      persist_perception_bindings: true,
    }),
  },
  {
    id: 'GROCERY_CONSERVATIVE',
    label: 'Grocery — Conservative',
    description: 'Fewer merges, tighter gates — when false merges are unacceptable.',
    config: normalizeReconcilerConfig({
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 0,
      ghost_min_promotion_displacement_m: 0.08,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 0.25,
      reid_max_gap_s: 12,
      reid_max_distance_m: 5.5,
      reid_max_implied_speed_m_s: 2.0,
      reid_velocity_cosine_min: 0.0,
      smoothing_alpha: 0.65,
      active_to_lost_timeout_ms: 1800,
      trail_max_length: 48,
      offline_instant_promote: true,
      persist_perception_bindings: true,
    }),
  },
  {
    id: 'RAJ_v1_OFFLINE',
    label: 'Raj v1 — Offline visual',
    description: 'Light smooth + strong ghost filter; preserves natural motion on Raj perception.',
    config: normalizeReconcilerConfig({
      enabled: true,
      ghost_max_speed_m_s: 3.5,
      ghost_min_promotion_lifetime_ms: 0,
      ghost_min_promotion_displacement_m: 0.04,
      ghost_static_timeout_s: 90,
      ghost_static_displacement_m: 0.3,
      reid_max_gap_s: 12,
      reid_max_distance_m: 5.5,
      reid_max_implied_speed_m_s: 2.1,
      reid_velocity_cosine_min: -0.1,
      smoothing_alpha: 0.2,
      active_to_lost_timeout_ms: 4000,
      trail_max_length: 100,
      offline_instant_promote: true,
      persist_perception_bindings: true,
    }),
  },
  {
    id: 'GROCERY_V2_MAP',
    label: 'Grocery — Map-aware v2 (beta)',
    description: 'Map-constrained physics reconciler: tracklets + geodesic probabilistic association (motion vector + density + EXIT). Routes around shelves, no teleports. Conservative (fewer false merges).',
    engine: 'v2',
    config: {
      engine: 'v2',
      smoothing_alpha: 0.6,
      min_chain_life_ms: 0,
      tracklet: {},   // tracklets.js defaults
      // Best params from the label-scored sweep (capture 0106): pushes gap/distance
      // ceilings to their physically-plausible limits → ~43 frag/person (vs ~57) with
      // ZERO label violations on the 4 'different' guards. (Floor is gated by concurrent
      // duplicate IDs that need a separate fusion pass — see RECONCILIATION_V2_DESIGN.)
      associate: { C_max: 12, margin: 0.3, T_max_s: 45, D_max_m: 8 },
    },
  },
  {
    id: 'BASELINE_DEFAULT',
    label: 'Baseline (production default)',
    description: 'Standard online reconciler params — for comparison only.',
    config: normalizeReconcilerConfig({ ...DEFAULT_CONFIG, enabled: true, offline_instant_promote: true, persist_perception_bindings: true }),
  },
];

export function getOfflinePreset(presetId) {
  return OFFLINE_RECONCILE_PRESETS.find(p => p.id === presetId) || null;
}

export function listOfflinePresets() {
  return OFFLINE_RECONCILE_PRESETS.map(({ id, label, description }) => ({ id, label, description }));
}
