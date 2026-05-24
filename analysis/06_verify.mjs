// Stage 6 — reconciler verify (streaming, multi-GB safe).
//
// Usage:
//   node analysis/06_verify.mjs --file capture.jsonl --out-dir analysis/runs/foo/artifacts

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VERIFY_CONFIGS } from './lib/configs.mjs';
import { detectPrimaryVenue, parseWhen } from './lib/load_jsonl.mjs';
import { runReconcilerStream } from './lib/reconciler_metrics.mjs';

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

  const outPath = path.join(outDir, '06_verify.json');
  const results = [];
  for (const [name, cfg] of VERIFY_CONFIGS) {
    console.log(`Running ${name} (streaming) ...`);
    const t0 = Date.now();
    const r = await runReconcilerStream(filePath, cfg, {
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
    results.push({ name, ...metricsOnly, elapsed_s });
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(
      `  stable=${r.n_stable} frag=${r.fragmentation_factor.toFixed(2)} lt=${r.lt_mean.toFixed(1)}s tp/1k=${r.teleports_per_1k.toFixed(2)} ghost=${r.ghost_pct.toFixed(1)}% (${elapsed_s.toFixed(0)}s)`,
    );
  }

  console.log('\nname                  stable   frag_x  lt_mean  disp_mean  shopper_qty  tp/1k   ghost%');
  console.log('───────────────────── ────── ──────── ──────── ────────── ──────────── ─────── ───────');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(21)} ${String(r.n_stable).padStart(6)}  ${r.fragmentation_factor.toFixed(2).padStart(6)}  ${r.lt_mean.toFixed(1).padStart(6)}s  ${r.disp_mean.toFixed(1).padStart(7)}m  ${String(r.real_shopper_count).padStart(11)}  ${r.teleports_per_1k.toFixed(2).padStart(5)}  ${r.ghost_pct.toFixed(1).padStart(5)}%`,
    );
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
