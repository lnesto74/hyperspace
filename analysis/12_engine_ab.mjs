// Compare two builds of the reconciler engine over one capture.
//
// Written to settle whether the post-merge engine should replace the one
// running at Treviglio. It should not, and `main` was reverted to the deployed
// build (adde0d7) as a result — so by default this now compares that build
// against itself. To reproduce the original question:
//
//   node analysis/12_engine_ab.mjs --file raw_tracks.jsonl \
//     --engine-committed analysis/engines/TrajectoryReconciler.postmerge-2d6e2a1.mjs
//
// Both builds are archived under analysis/engines/ so the comparison does not
// depend on what happens to be checked out.
//
// The answer, for the record: on the 19 May capture the post-merge build looks
// better (213 journeys over 30 m against 152) with teleports unchanged. On the
// 27 May capture it produces 15.86 teleports per 1,000 against 3.39 for the
// deployed build and 5.94 for the raw vendor feed — it teleports more than the
// input it is meant to be cleaning up, and its larger displacement is that jump
// distance rather than longer journeys. One capture is not a result.
//
// Under the production `luca` gates, two of the four differences cancel out —
// reid_stale_active_ms and reid_churn_active_ms are both supplied explicitly
// and normalise to the same values either way. What is actually under test:
//   1. _reidTargets de-duplicates candidates by stable id (committed) vs
//      allowing the same track to appear twice (deployed).
//   2. the implied-speed teleport gate is skipped for gaps under 250 ms
//      (committed) vs always applied (deployed).
//
// Usage:
//   node analysis/12_engine_ab.mjs --file raw_tracks.jsonl
//
// The .mjs extension matters: analysis/engines sits outside the backend
// package, so a .js copy loads as CommonJS and fails. Re-snapshot production
// with:
//   ssh root@100.76.196.2 'cat /opt/hyperspace/backend/services/TrajectoryReconciler.js' \
//     > analysis/engines/TrajectoryReconciler.deployed-2026-06-30.mjs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LUCA_LIVE_RECONCILER_RAW } from '../backend/config/reconcilerDefaults.js';
import { detectPrimaryVenue, parseWhen } from './lib/load_jsonl.mjs';
import { runReconcilerStream } from './lib/reconciler_metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    file: null, outDir: path.join(__dirname, 'out'), venueId: null, after: null, before: null,
    // Both engines are addressable so this can run wherever the captures are —
    // on the droplet the checked-out backend IS the deployed engine, so the
    // committed one has to be supplied as a file.
    engineDeployed: path.join(__dirname, 'engines', 'TrajectoryReconciler.deployed-2026-06-30.mjs'),
    engineCommitted: null,
    tag: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') out.file = argv[++i];
    else if (a === '--out-dir' || a === '-o') out.outDir = argv[++i];
    else if (a === '--venue-id') out.venueId = argv[++i];
    else if (a === '--after') out.after = argv[++i];
    else if (a === '--before') out.before = argv[++i];
    else if (a === '--engine-deployed') out.engineDeployed = argv[++i];
    else if (a === '--engine-committed') out.engineCommitted = argv[++i];
    else if (a === '--tag') out.tag = argv[++i];
  }
  if (!out.file) { console.error('Missing --file'); process.exit(1); }
  return out;
}

const args = parseArgs(process.argv);
const afterMs = parseWhen(args.after);
const beforeMs = parseWhen(args.before);
const outDir = path.resolve(args.outDir);
fs.mkdirSync(outDir, { recursive: true });

const PROD_ENGINE_PATH = path.resolve(args.engineDeployed);

const main = async () => {
  if (!fs.existsSync(PROD_ENGINE_PATH)) {
    console.error(`Missing deployed engine copy at ${PROD_ENGINE_PATH}`);
    console.error('Fetch it first — see the header of this file.');
    process.exit(1);
  }

  const prodEngine = await import(PROD_ENGINE_PATH);
  const repoEngine = args.engineCommitted
    ? await import(path.resolve(args.engineCommitted))
    : await import('../backend/services/TrajectoryReconciler.js');

  const filePath = path.resolve(args.file);
  const venueId = args.venueId || await detectPrimaryVenue(filePath, { afterMs, beforeMs });
  if (!venueId) { console.error('No messages found'); process.exit(1); }

  console.log(`Capture: ${filePath}`);
  console.log(`Venue:   ${venueId}\n`);

  const luca = { ...LUCA_LIVE_RECONCILER_RAW, enabled: true };
  const CASES = [
    ['RAW (control)', repoEngine, { ...luca, enabled: false }],
    ['DEPLOYED engine', prodEngine, luca],
    ['COMMITTED engine', repoEngine, luca],
  ];

  // Confirm the gates really are identical before comparing behaviour, so a
  // difference in results cannot be blamed on a difference in configuration.
  const gates = ['reid_max_gap_s', 'reid_max_distance_m', 'reid_max_implied_speed_m_s',
                 'reid_stale_active_ms', 'reid_churn_active_ms', 'smoothing_alpha',
                 'ghost_static_timeout_s', 'active_to_lost_timeout_ms'];
  const pCfg = prodEngine.normalizeReconcilerConfig({ ...prodEngine.DEFAULT_CONFIG, ...luca });
  const rCfg = repoEngine.normalizeReconcilerConfig({ ...repoEngine.DEFAULT_CONFIG, ...luca });
  const gateDiff = gates.filter(k => pCfg[k] !== rCfg[k]);
  console.log(gateDiff.length === 0
    ? 'Gate check: both engines normalise the luca config to identical values.\n'
    : `Gate check: DIFFER on ${gateDiff.map(k => `${k} (${pCfg[k]} vs ${rCfg[k]})`).join(', ')}\n`);

  const results = [];
  for (const [name, engine, cfg] of CASES) {
    console.log(`Running ${name} ...`);
    const t0 = Date.now();
    const r = await runReconcilerStream(filePath, cfg, {
      venueId, afterMs, beforeMs, label: name, engine,
      onProgress: (n) => process.stdout.write(`\r  … ${n.toLocaleString()} messages`),
    });
    process.stdout.write('\n');
    const { spatial, ...m } = r;
    results.push({ name, ...m, elapsed_s: (Date.now() - t0) / 1000 });
  }

  const [raw, dep, com] = results;

  console.log('\nname                 stable  frag_x  lt_mean  lt_p50  lt_p95  disp_mean  tp/1k  ghost%');
  console.log('──────────────────── ─────── ─────── ──────── ─────── ─────── ────────── ────── ───────');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(20)} ${String(r.n_stable).padStart(6)}  ${r.fragmentation_factor.toFixed(2).padStart(6)}  ` +
      `${r.lt_mean.toFixed(1).padStart(6)}s  ${r.lt_p50.toFixed(1).padStart(5)}s  ${r.lt_p95.toFixed(1).padStart(5)}s  ` +
      `${r.disp_mean.toFixed(1).padStart(8)}m  ${r.teleports_per_1k.toFixed(2).padStart(5)}  ${r.ghost_pct.toFixed(1).padStart(5)}%`,
    );
  }

  const pct = (a, b) => (b === 0 ? '—' : `${(((a - b) / b) * 100).toFixed(1)}%`);
  console.log('\nCommitted vs deployed');
  console.log(`  identities          ${dep.n_stable} → ${com.n_stable}  (${pct(com.n_stable, dep.n_stable)}; fewer is better)`);
  console.log(`  median lifetime     ${dep.lt_p50.toFixed(1)}s → ${com.lt_p50.toFixed(1)}s  (${pct(com.lt_p50, dep.lt_p50)}; longer is better)`);
  console.log(`  mean lifetime       ${dep.lt_mean.toFixed(1)}s → ${com.lt_mean.toFixed(1)}s  (${pct(com.lt_mean, dep.lt_mean)})`);
  console.log(`  mean displacement   ${dep.disp_mean.toFixed(1)}m → ${com.disp_mean.toFixed(1)}m  (${pct(com.disp_mean, dep.disp_mean)})`);
  console.log(`  teleports/1k        ${dep.teleports_per_1k.toFixed(2)} → ${com.teleports_per_1k.toFixed(2)}  (${pct(com.teleports_per_1k, dep.teleports_per_1k)}; fewer is better)`);
  console.log(`  invariant vs raw    deployed ${dep.n_stable <= raw.n_stable ? 'holds' : 'VIOLATED'}, committed ${com.n_stable <= raw.n_stable ? 'holds' : 'VIOLATED'}`);

  const outPath = path.join(outDir, `12_engine_ab${args.tag ? `_${args.tag}` : ''}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ venueId, file: filePath, results }, null, 2));
  console.log(`\n→ ${outPath}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
