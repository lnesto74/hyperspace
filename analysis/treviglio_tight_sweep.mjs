// Tight re-ID sweep for Treviglio captures — v1 Euclidean + v2 map-aware.
//
//   node --max-old-space-size=4096 analysis/treviglio_tight_sweep.mjs \
//     --file /data/replay/CAP.jsonl \
//     --venue-id 55fdd53b-3298-4355-97c0-b4e789b11d06 \
//     [--grid /data/replay/walkability_<venueId>.json] \
//     [--out-dir analysis/runs/treviglio_sweep_2906]
//
// Grid: gap 2–5s × distance 2–4m (12 combos each engine).
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HYPERSPACE_ROOT || path.join(__dirname, '..');
const require = createRequire(path.join(ROOT, 'backend/index.js'));

const rootUrl = pathToFileURL(ROOT.endsWith(path.sep) ? ROOT : `${ROOT}${path.sep}`);
const {
  runReconcilerStream,
  scoreStableTracks,
} = await import(new URL('analysis/lib/reconciler_metrics.mjs', rootUrl).href);
const {
  loadEntranceContext,
  computeEntranceFootfall,
} = await import(new URL('analysis/lib/footfall.mjs', rootUrl).href);
const { loadWalkabilityCache } = await import(new URL('backend/services/offline/reconcileV2/walkability.js', rootUrl).href);
const { extractTracklets } = await import(new URL('backend/services/offline/reconcileV2/tracklets.js', rootUrl).href);
const { associateTracklets } = await import(new URL('backend/services/offline/reconcileV2/associate.js', rootUrl).href);
const {
  perceptionToFloor,
  applyTransformToPoint,
  applyTransformToVelocity,
  IDENTITY_TRANSFORM,
} = await import(new URL('backend/services/PerceptionTransform.js', rootUrl).href);

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const file = arg('--file');
const venueId = arg('--venue-id');
const gridPath = arg('--grid');
const outDir = path.resolve(arg('--out-dir', path.join(__dirname, 'runs', 'treviglio_tight_sweep')));
const gaps = (arg('--gaps', '2,3,4,5')).split(',').map(Number);
const dists = (arg('--dists', '2,3,4')).split(',').map(Number);

if (!file || !venueId) {
  console.error('Required: --file --venue-id [--grid] [--out-dir]');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const V1_BASE = {
  enabled: true,
  ghost_max_speed_m_s: 3.5,
  ghost_min_promotion_lifetime_ms: 200,
  ghost_min_promotion_displacement_m: 0.05,
  ghost_static_timeout_s: 90,
  ghost_static_displacement_m: 0.3,
  reid_max_implied_speed_m_s: 2.0,
  reid_velocity_cosine_min: 0.0,
  reid_weight_distance: 1.0,
  reid_weight_velocity: 0.5,
  reid_weight_time: 0.1,
  smoothing_alpha: 0.7,
  active_to_lost_timeout_ms: 1500,
  trail_max_length: 32,
  persist_perception_bindings: true,
};

function absurdChains(rollups) {
  if (!rollups?.size) return { over300s: 0, over150m: 0, over500m: 0, max_lifetime_s: 0, max_path_m: 0 };
  let over300s = 0;
  let over150m = 0;
  let over500m = 0;
  let maxLife = 0;
  let maxDisp = 0;
  for (const r of rollups.values()) {
    const life = (r.lastTs - r.firstTs) / 1000;
    if (life > maxLife) maxLife = life;
    if (r.totalDisp > maxDisp) maxDisp = r.totalDisp;
    if (life > 300) over300s++;
    if (r.totalDisp > 150) over150m++;
    if (r.totalDisp > 500) over500m++;
  }
  return { over300s, over150m, over500m, max_lifetime_s: maxLife, max_path_m: maxDisp };
}

function rankScore(r) {
  // Lower is better. Penalize teleports and absurd long chains heavily;
  // reward moderate fragmentation reduction without chasing lifetime.
  const tp = r.teleports_per_1k ?? 99;
  const absurd = (r.over300s ?? 0) * 5 + (r.over500m ?? 0) * 20 + (r.over150m ?? 0) * 0.5;
  const frag = r.fragments_per_shopper ?? r.fragmentation_factor ?? 50;
  const lt = Math.min(r.lt_p95 ?? r.lt_mean ?? 0, 600);
  return tp * 3 + absurd + Math.max(0, lt - 120) * 0.05 + Math.max(0, frag - 40) * 0.1;
}

function summarizeV1(name, r, footfall) {
  const rollups = r._rollups;
  const absurd = rollups ? absurdChains(rollups) : {
    over300s: (r.lt_p95 ?? 0) > 300 ? 1 : 0,
    over150m: (r.disp_p95 ?? 0) > 150 ? 1 : 0,
    over500m: (r.disp_p95 ?? 0) > 500 ? 1 : 0,
    max_lifetime_s: r.lt_p95 ?? r.lt_mean ?? 0,
    max_path_m: r.disp_p95 ?? r.disp_mean ?? 0,
  };
  return {
    engine: 'v1',
    name,
    reid_max_gap_s: r.config?.reid_max_gap_s,
    reid_max_distance_m: r.config?.reid_max_distance_m,
    n_stable: r.n_stable,
    fragmentation_factor: r.fragmentation_factor,
    fragments_per_shopper: footfall?.footfall ? r.n_stable / footfall.footfall : null,
    lt_mean: r.lt_mean,
    lt_p50: r.lt_p50,
    lt_p95: r.lt_p95,
    disp_mean: r.disp_mean,
    disp_p95: r.disp_p95,
    teleports_per_1k: r.teleports_per_1k,
    ghost_pct: r.ghost_pct,
    ...absurd,
    rank_score: 0,
    elapsed_s: r.elapsed_s,
  };
}

function scoreV2Chains(chains, totalRaw, perceptionIdCount, footfall) {
  const rollups = new Map();
  for (const [chainId, samples] of chains) {
    for (const s of samples) {
      let r = rollups.get(chainId);
      if (!r) {
        rollups.set(chainId, {
          firstTs: s.t, lastTs: s.t, firstX: s.x, firstZ: s.z,
          lastX: s.x, lastZ: s.z, lastT: s.t, totalDisp: 0, sampleCount: 1,
          teleports: 0, accelSpikes: 0, prevSpeed: 0,
        });
      } else {
        const dt = Math.max(Math.abs(s.t - r.lastT) / 1000, 0.001);
        const step = Math.hypot(s.x - r.lastX, s.z - r.lastZ);
        r.totalDisp += step;
        if (step / dt > 3.0) r.teleports++;
        r.lastX = s.x; r.lastZ = s.z; r.lastT = s.t;
        if (s.t < r.firstTs) r.firstTs = s.t;
        if (s.t > r.lastTs) r.lastTs = s.t;
        r.sampleCount++;
      }
    }
  }
  const metrics = scoreStableTracks(rollups, totalRaw, perceptionIdCount, { ghost_dropped: 0 });
  const absurd = absurdChains(rollups);
  return {
    engine: 'v2',
    n_stable: chains.size,
    fragmentation_factor: metrics.fragmentation_factor,
    fragments_per_shopper: footfall?.footfall ? chains.size / footfall.footfall : null,
    lt_mean: metrics.lt_mean,
    lt_p50: metrics.lt_p50,
    lt_p95: metrics.lt_p95,
    disp_mean: metrics.disp_mean,
    disp_p95: metrics.disp_p95,
    teleports_per_1k: metrics.teleports_per_1k,
    ghost_pct: 0,
    ...absurd,
    rank_score: 0,
  };
}

async function loadTrackletsForV2(transform, grid) {
  const byId = new Map();
  let total = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const raw = line.trim();
    if (!raw || raw.startsWith('nohup:')) continue;
    const idx = raw.indexOf(' ');
    let d;
    try { d = JSON.parse(idx < 0 ? raw : raw.slice(idx + 1)); } catch { continue; }
    if (!d?.position) continue;
    if (d.venueId && d.venueId !== venueId) continue;
    const t = Number(d.timestamp) || 0;
    if (!t) continue;
    total++;
    const id = String(d.id);
    const fp = perceptionToFloor(transform.input_frame, d.position);
    const fv = perceptionToFloor(transform.input_frame, d.velocity || { x: 0, y: 0, z: 0 });
    const v = applyTransformToPoint(transform, fp);
    const vel = applyTransformToVelocity(transform, fv);
    const x = v.x; const z = v.z; const vx = vel.x; const vz = vel.z;
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    let arr = byId.get(id);
    if (!arr) { arr = []; byId.set(id, arr); }
    const lp = arr.length ? arr[arr.length - 1] : null;
    if (!lp || (t - lp.t) >= 150 || Math.hypot(x - lp.x, z - lp.z) >= 0.25) {
      arr.push({ t, x, z, vx, vz, perceptionId: id });
    }
  }
  const tracklets = extractTracklets(byId, grid, {});
  return { tracklets, rawIds: byId.size, total };
}

async function main() {
  console.log(`capture: ${file}`);
  console.log(`venue:   ${venueId}`);
  console.log(`gaps:    ${gaps.join(',')}s  dists: ${dists.join(',')}m`);
  console.log(`out:     ${outDir}\n`);

  let footfall = null;
  try {
    const { roi, transform, error } = loadEntranceContext(venueId);
    if (roi) {
      console.log(`Footfall via "${roi.name}" ...`);
      footfall = await computeEntranceFootfall(file, {
        venueId, roiVertices: roi.vertices, transform, onProgress: (n) => process.stdout.write(`\r  … ${n.toLocaleString()}`),
      });
      process.stdout.write('\n');
      console.log(`  → ${footfall.footfall} entrants\n`);
      fs.writeFileSync(path.join(outDir, 'entrance_footfall.json'), JSON.stringify(footfall, null, 2));
    } else {
      console.log(`Footfall skipped: ${error || 'no ROI'}\n`);
    }
  } catch (e) {
    console.log(`Footfall failed: ${e.message}\n`);
  }

  const results = [];

  // Baselines
  const baselines = [
    ['BYPASS_RAW', { enabled: false }],
    ['GROCERY_BALANCED', {
      enabled: true, reid_max_gap_s: 15, reid_max_distance_m: 8.0, reid_max_implied_speed_m_s: 2.5,
      reid_velocity_cosine_min: -0.3, persist_perception_bindings: true, smoothing_alpha: 0.7,
      active_to_lost_timeout_ms: 1500, trail_max_length: 32,
    }],
    ['RAJ_v1_CONSERVATIVE', { ...V1_BASE, reid_max_gap_s: 8, reid_max_distance_m: 4.0 }],
  ];

  for (const [name, cfg] of baselines) {
    console.log(`v1 baseline ${name} ...`);
    const t0 = Date.now();
    const r = await runReconcilerStream(file, cfg, { venueId, label: name });
    const row = summarizeV1(name, { ...r, elapsed_s: (Date.now() - t0) / 1000, config: cfg }, footfall);
    row.rank_score = rankScore(row);
    results.push(row);
    console.log(`  stable=${row.n_stable} frag/shop=${row.fragments_per_shopper?.toFixed(1) ?? '—'} lt_p95=${(row.lt_p95 ?? 0).toFixed(0)}s tp/1k=${row.teleports_per_1k.toFixed(2)} absurd>300s=${row.over300s ?? 0} maxLife=${(row.max_lifetime_s ?? 0).toFixed(0)}s`);
  }

  // v1 tight grid
  for (const gap of gaps) {
    for (const dist of dists) {
      const name = `v1_${gap}s_${dist}m`;
      const cfg = { ...V1_BASE, reid_max_gap_s: gap, reid_max_distance_m: dist };
      console.log(`v1 sweep ${name} ...`);
      const t0 = Date.now();
      const r = await runReconcilerStream(file, cfg, { venueId, label: name });
      const row = summarizeV1(name, { ...r, elapsed_s: (Date.now() - t0) / 1000, config: cfg }, footfall);
      row.rank_score = rankScore(row);
      results.push(row);
      console.log(`  stable=${row.n_stable} frag/shop=${row.fragments_per_shopper?.toFixed(1) ?? '—'} lt_p95=${(row.lt_p95 ?? 0).toFixed(0)}s tp/1k=${row.teleports_per_1k.toFixed(2)} absurd>300s=${row.over300s ?? 0}`);
    }
  }

  // v2 map-aware — load tracklets once
  let grid = null;
  if (gridPath && fs.existsSync(gridPath)) {
    grid = loadWalkabilityCache(gridPath);
    console.log(`\nv2 walkability: ${gridPath} (${grid?.cells?.length ?? '?'} cells)`);
  } else {
    console.log('\nv2 walkability: capture-derived (no cache)');
  }

  const { tracklets, rawIds, total } = await loadTrackletsForV2(IDENTITY_TRANSFORM, grid);
  console.log(`v2 tracklets: ${tracklets.length.toLocaleString()} from ${rawIds.toLocaleString()} raw ids\n`);

  const v2Default = { C_max: 12, margin: 0.3, T_max_s: 45, D_max_m: 8 };
  console.log('v2 baseline GROCERY_V2_MAP (T=45 D=8) ...');
  {
    const { chains, stats } = associateTracklets(tracklets.slice(), grid, v2Default);
    const row = scoreV2Chains(chains, total, rawIds, footfall);
    row.name = 'GROCERY_V2_MAP';
    row.T_max_s = 45;
    row.D_max_m = 8;
    row.links_accepted = stats.links_accepted;
    row.rank_score = rankScore(row);
    results.push(row);
    console.log(`  chains=${row.n_stable} frag/shop=${row.fragments_per_shopper?.toFixed(1) ?? '—'} lt_p95=${(row.lt_p95 ?? 0).toFixed(0)}s tp/1k=${row.teleports_per_1k.toFixed(2)} absurd>300s=${row.over300s ?? 0}`);
  }

  for (const gap of gaps) {
    for (const dist of dists) {
      const name = `v2_${gap}s_${dist}m`;
      const params = { C_max: 12, margin: 0.3, T_max_s: gap, D_max_m: dist };
      console.log(`v2 sweep ${name} (geodesic) ...`);
      const { chains, stats } = associateTracklets(tracklets.slice(), grid, params);
      const row = scoreV2Chains(chains, total, rawIds, footfall);
      row.name = name;
      row.T_max_s = gap;
      row.D_max_m = dist;
      row.links_accepted = stats.links_accepted;
      row.rank_score = rankScore(row);
      results.push(row);
      console.log(`  chains=${row.n_stable} frag/shop=${row.fragments_per_shopper?.toFixed(1) ?? '—'} lt_p95=${(row.lt_p95 ?? 0).toFixed(0)}s tp/1k=${row.teleports_per_1k.toFixed(2)} absurd>300s=${row.over300s ?? 0} links=${stats.links_accepted}`);
    }
  }

  results.sort((a, b) => a.rank_score - b.rank_score);

  const report = {
    capture: path.basename(file),
    venueId,
    footfall: footfall?.footfall ?? null,
    grid: gridPath || 'capture-derived',
    sweep: { gaps, dists },
    ranked: results,
    best_v1: results.find((r) => r.engine === 'v1' && r.name.startsWith('v1_')) || null,
    best_v2: results.find((r) => r.engine === 'v2' && r.name.startsWith('v2_')) || null,
    best_overall: results[0],
  };

  const outPath = path.join(outDir, 'tight_sweep.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('RANKED (lower rank_score = better: low teleports, few absurd mega-chains)');
  console.log('engine  name                    frag/shop  lt_p95   tp/1k  >300s  maxLife  score');
  console.log('──────  ──────────────────────  ─────────  ───────  ─────  ─────  ───────  ─────');
  for (const r of results.slice(0, 20)) {
    const fps = r.fragments_per_shopper != null ? r.fragments_per_shopper.toFixed(1) : '—';
    console.log(
      `${r.engine.padEnd(6)}  ${r.name.padEnd(22)}  ${fps.padStart(7)}  ${(r.lt_p95 ?? 0).toFixed(0).padStart(5)}s  ${r.teleports_per_1k.toFixed(2).padStart(5)}  ${String(r.over300s ?? 0).padStart(5)}  ${(r.max_lifetime_s ?? 0).toFixed(0).padStart(5)}s  ${r.rank_score.toFixed(1)}`,
    );
  }
  console.log(`\nWrote ${outPath}`);
  if (report.best_overall) {
    console.log(`\nBEST OVERALL: ${report.best_overall.name} (${report.best_overall.engine})`);
  }
  if (report.best_v2) {
    console.log(`BEST MAP-AWARE v2: ${report.best_v2.name} T=${report.best_v2.T_max_s}s D=${report.best_v2.D_max_m}m geodesic`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
