// Stage 6 — reconciler verify (streaming, multi-GB safe).
//
// Usage:
//   node analysis/06_verify.mjs --file capture.jsonl --out-dir analysis/runs/foo/artifacts

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VERIFY_CONFIGS } from './lib/configs.mjs';
import { detectPrimaryVenue, parseWhen } from './lib/load_jsonl.mjs';
import { runReconcilerStream, runReconcileV2Stream, runReconcileV3Stream } from './lib/reconciler_metrics.mjs';
import { loadEntranceContext, computeEntranceFootfall } from './lib/footfall.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {
    file: null,
    outDir: path.join(__dirname, 'out'),
    venueId: null,
    after: null,
    before: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') out.file = argv[++i];
    else if (a === '--out-dir' || a === '-o') out.outDir = argv[++i];
    else if (a === '--venue-id') out.venueId = argv[++i];
    else if (a === '--after') out.after = argv[++i];
    else if (a === '--before') out.before = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node analysis/06_verify.mjs --file CAPTURE.jsonl [--out-dir DIR] [--venue-id ID]`);
      process.exit(0);
    }
  }
  if (!out.file) {
    console.error('Missing --file');
    process.exit(1);
  }
  return out;
}

const args = parseArgs(process.argv);
const afterMs = parseWhen(args.after);
const beforeMs = parseWhen(args.before);
const outDir = path.resolve(args.outDir);
fs.mkdirSync(outDir, { recursive: true });

const main = async () => {
  const filePath = path.resolve(args.file);
  const venueId = args.venueId || await (async () => {
    console.log(`Detecting primary venue in ${filePath} ...`);
    return detectPrimaryVenue(filePath, { afterMs, beforeMs });
  })();
  if (!venueId) {
    console.error('No messages found');
    process.exit(1);
  }
  console.log(`Venue: ${venueId}`);

  // Entrance-gate footfall — one shared "real shoppers" denominator for every row.
  // Computed once; raw + every reconciler divide their track count by this number,
  // so fragments-per-shopper is an honest apples-to-apples comparison.
  let footfall = null;
  try {
    const { roi, transform, error } = loadEntranceContext(venueId);
    if (error) console.log(`Footfall: skipped (${error})`);
    if (roi) {
      console.log(`Footfall: counting entrants across "${roi.name}" ...`);
      footfall = await computeEntranceFootfall(filePath, {
        venueId, roiVertices: roi.vertices, transform, afterMs, beforeMs,
        onProgress: (n) => process.stdout.write(`\r  … ${n.toLocaleString()} messages`),
      });
      process.stdout.write('\n');
      footfall.roi = { id: roi.id, name: roi.name };
      fs.writeFileSync(path.join(outDir, 'entrance_footfall.json'), JSON.stringify(footfall, null, 2));
      console.log(`  → entrance_footfall.json (${footfall.footfall} entrants all-dir, ${footfall.footfall_directional ?? '?'} directional-only, purity ${footfall.directional_purity})`);
    } else {
      console.log('Footfall: no entrance ROI found for venue — fragments-per-shopper will be unavailable');
    }
  } catch (e) {
    console.log(`Footfall: failed (${e.message})`);
  }

  const outPath = path.join(outDir, '06_verify.json');
  const results = [];
  for (const [name, cfg] of VERIFY_CONFIGS) {
    const engine = cfg?.engine || 'v1';
    const engineLabel = engine === 'v3' ? 'map-aware v3' : engine === 'v2' ? 'map-aware v2' : 'streaming';
    console.log(`Running ${name} (${engineLabel}) ...`);
    const t0 = Date.now();
    const runner = engine === 'v3' ? runReconcileV3Stream : engine === 'v2' ? runReconcileV2Stream : runReconcilerStream;
    const r = await runner(filePath, cfg, {
      venueId,
      afterMs,
      beforeMs,
      label: name,
      onProgress: (n) => process.stdout.write(`\r  … ${n.toLocaleString()} messages`),
    });
    process.stdout.write('\n');
    const elapsed_s = (Date.now() - t0) / 1000;
    const { spatial, ...metricsOnly } = r;
    if (spatial) {
      const spatialPath = path.join(outDir, `reconciler_spatial_${name}.json`);
      fs.writeFileSync(spatialPath, JSON.stringify(spatial, null, 2));
      console.log(`  → ${path.basename(spatialPath)} (${spatial.counts?.stable_tracks?.toLocaleString()} stable tracks)`);
    }
    const fps = footfall?.footfall ? r.n_stable / footfall.footfall : null;
    results.push({ name, ...metricsOnly, fragments_per_shopper: fps, elapsed_s });
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(
      `  stable=${r.n_stable} frag=${r.fragmentation_factor.toFixed(2)}${fps != null ? ` frag/shopper=${fps.toFixed(1)}` : ''} lt=${r.lt_mean.toFixed(1)}s tp/1k=${r.teleports_per_1k.toFixed(2)} ghost=${r.ghost_pct.toFixed(1)}% (${elapsed_s.toFixed(0)}s)`,
    );
  }

  if (footfall?.footfall) {
    console.log(`\nEntrance-gate footfall (shared denominator): ${footfall.footfall} real shoppers`);
  }
  console.log('\nname                  stable   frag_x  frag/shopper  lt_mean  disp_mean  shopper_qty  tp/1k   ghost%');
  console.log('───────────────────── ────── ──────── ──────────── ──────── ────────── ──────────── ─────── ───────');
  for (const r of results) {
    const fps = r.fragments_per_shopper != null ? `${r.fragments_per_shopper.toFixed(1)}×` : '—';
    console.log(
      `${r.name.padEnd(21)} ${String(r.n_stable).padStart(6)}  ${r.fragmentation_factor.toFixed(2).padStart(6)}  ${fps.padStart(12)}  ${r.lt_mean.toFixed(1).padStart(6)}s  ${r.disp_mean.toFixed(1).padStart(7)}m  ${String(r.real_shopper_count).padStart(11)}  ${r.teleports_per_1k.toFixed(2).padStart(5)}  ${r.ghost_pct.toFixed(1).padStart(5)}%`,
    );
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
