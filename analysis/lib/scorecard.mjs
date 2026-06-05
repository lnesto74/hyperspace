import fs from 'fs';
import path from 'path';

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function pickRaw(summary, continuity, footfall) {
  if (!summary) return null;
  const n = summary.unique_perception_ids || 0;
  const est = summary.estimated_real_shoppers || continuity?.estimated_unique_shoppers || 0;
  const ff = footfall?.footfall || 0;
  return {
    messages: summary.messages,
    unique_perception_ids: summary.unique_perception_ids,
    time_span_h: summary.time_span_h,
    mean_lifetime_s: summary.mean_lifetime_s ?? summary.median_lifetime_s,
    mean_displacement_m: summary.mean_displacement_m ?? summary.median_total_disp,
    fragmentation_factor: est > 0 ? n / est : null,
    // Honest, shared-denominator fragmentation: raw IDs per real shopper counted
    // at the entrance gate. Comparable directly with the reconciler layer.
    fragments_per_shopper: ff > 0 ? n / ff : null,
    teleports_per_1k: summary.teleports_per_1k,
    pct_ids_under_2s: summary.pct_ids_under_2s,
    shopper_grade_ge_30m: summary.shopper_grade_ge_30m,
    estimated_real_shoppers: est,
  };
}

function pickSpatial(spatial, continuity, fragmentation) {
  const cats = fragmentation?.categories || {};
  const totalDeaths = Object.values(cats).reduce((a, b) => a + b, 0) || 0;
  const pct = (k) => (totalDeaths ? ((cats[k] || 0) / totalDeaths) * 100 : null);
  return {
    walkable_area_m2: continuity?.walkable_area_m2,
    significant_blindspot_m2: continuity?.big_blindspot_m2,
    fragmentation_cause_pct: {
      occlusion: pct('shelf_occlusion_short'),
      blindspot: pct('blindspot_gap_long'),
      new_person: pct('true_new_person_or_exit'),
    },
    bbox_x: spatial?.bbox_x,
    bbox_z: spatial?.bbox_z,
  };
}

function pickReconciled(verifyRows) {
  if (!verifyRows?.length) return null;
  const byName = Object.fromEntries(verifyRows.map((r) => [r.name, r]));
  const out = {};
  for (const name of [
    'BYPASS_RAW', 'BASELINE_DEFAULT',
    'GROCERY_BALANCED', 'GROCERY_AGGRESSIVE', 'GROCERY_CONSERVATIVE',
    'RAJ_v1_CONSERVATIVE', 'RAJ_v1_BALANCED', 'GROCERY_V2_MAP', 'GROCERY_V3_MAP',
  ]) {
    const r = byName[name];
    if (!r) continue;
    out[name] = {
      stable_tracks: r.n_stable,
      fragmentation_x: r.fragmentation_factor,
      // Honest, shared-denominator: stable tracks per real shopper (entrance gate).
      fragments_per_shopper: r.fragments_per_shopper ?? null,
      mean_lifetime_s: r.lt_mean,
      mean_displacement_m: r.disp_mean,
      teleports_per_1k: r.teleports_per_1k,
      ghost_pct: r.ghost_pct,
      shopper_grade_ge_30m: r.real_shopper_count,
    };
  }
  return out;
}

export function buildScorecard({ meta, artifactsDir, verifyRows, startedAt, finishedAt }) {
  const summary = readJson(path.join(artifactsDir, '01_summary.json'));
  const spatial = readJson(path.join(artifactsDir, '02_spatial_summary.json'));
  const continuity = readJson(path.join(artifactsDir, '05_continuity.json'));
  const fragmentation = readJson(path.join(artifactsDir, '05_fragmentation.json'));
  const footfall = readJson(path.join(artifactsDir, 'entrance_footfall.json'));

  return {
    schema_version: 1,
    capture_id: meta.capture_id,
    source_file: meta.source_file,
    venue_id: meta.venue_id,
    perception_version: meta.perception_version || null,
    reconciler_at_capture: meta.reconciler_at_capture || null,
    scope: meta.scope || 'full',
    generated_at: new Date().toISOString(),
    run_started_at: startedAt,
    run_finished_at: finishedAt,
    layers: {
      perception: pickRaw(summary, continuity, footfall),
      reconciler: pickReconciled(verifyRows),
      structural: pickSpatial(spatial, continuity, fragmentation),
      footfall: footfall
        ? {
            entrance_footfall: footfall.footfall,
            method: footfall.method,
            roi: footfall.roi || null,
            counted_tracks_inclusive: footfall.counted_tracks_inclusive,
            dominant_dir_deg: footfall.dominant_dir_deg,
            directional_purity: footfall.directional_purity,
          }
        : null,
    },
    notes: meta.notes || null,
  };
}

export function writeScorecard(runDir, scorecard) {
  const out = path.join(runDir, 'scorecard.json');
  fs.writeFileSync(out, JSON.stringify(scorecard, null, 2));
  return out;
}
