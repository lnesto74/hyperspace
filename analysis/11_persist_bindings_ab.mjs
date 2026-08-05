// Does persist_perception_bindings help or hurt the live Treviglio config?
//
// The flag is false in production but true in every tuned offline preset, and
// nobody had measured the difference on the live gates. With it on, one vendor
// id keeps ONE stable id for the whole capture — it resurrects under the same
// id after a gap instead of fragmenting. That guarantees the benchmark
// invariant (reconciled ids <= raw ids) but stops ids being freed, which is why
// the live reconciler defaults it off: occupancy counts what is currently
// tracked.
//
// This runs the exact production LUCA gates both ways over one capture, with
// raw as the control.
//
// Usage:
//   node analysis/11_persist_bindings_ab.mjs --file raw_tracks.jsonl [--venue-id ID]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LUCA_LIVE_RECONCILER_RAW } from '../backend/config/reconcilerDefaults.js';
import { detectPrimaryVenue, parseWhen } from './lib/load_jsonl.mjs';
import { runReconcilerStream } from './lib/reconciler_metrics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { file: null, outDir: path.join(__dirname, 'out'), venueId: null, after: null, before: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') out.file = argv[++i];
    else if (a === '--out-dir' || a === '-o') out.outDir = argv[++i];
    else if (a === '--venue-id') out.venueId = argv[++i];
    else if (a === '--after') out.after = argv[++i];
    else if (a === '--before') out.before = argv[++i];
  }
  if (!out.file) { console.error('Missing --file'); process.exit(1); }
  return out;
}

const args = parseArgs(process.argv);
const afterMs = parseWhen(args.after);
const beforeMs = parseWhen(args.before);
const outDir = path.resolve(args.outDir);
fs.mkdirSync(outDir, { recursive: true });

const CASES = [
  ['RAW (control)', { ...LUCA_LIVE_RECONCILER_RAW, enabled: false }],
  ['LUCA persist=false', { ...LUCA_LIVE_RECONCILER_RAW, enabled: true, persist_perception_bindings: false }],
  ['LUCA persist=true', { ...LUCA_LIVE_RECONCILER_RAW, enabled: true, persist_perception_bindings: true }],
];

const main = async () => {
  const filePath = path.resolve(args.file);
  const venueId = args.venueId || await detectPrimaryVenue(filePath, { afterMs, beforeMs });
  if (!venueId) { console.error('No messages found'); process.exit(1); }
  console.log(`Capture: ${filePath}`);
  console.log(`Venue:   ${venueId}\n`);

  const results = [];
  for (const [name, cfg] of CASES) {
    console.log(`Running ${name} ...`);
    const t0 = Date.now();
    const r = await runReconcilerStream(filePath, cfg, {
      venueId, afterMs, beforeMs, label: name,
      onProgress: (n) => process.stdout.write(`\r  … ${n.toLocaleString()} messages`),
    });
    process.stdout.write('\n');
    const { spatial, ...m } = r;
    results.push({ name, ...m, elapsed_s: (Date.now() - t0) / 1000 });
  }

  const raw = results[0];
  const off = results[1];
  const on = results[2];

  console.log('\nname                  stable  frag_x  lt_mean  lt_p50  lt_p95  disp_mean  tp/1k  ghost%');
  console.log('───────────────────── ─────── ─────── ──────── ─────── ─────── ────────── ────── ───────');
  for (const r of results) {
    console.log(
      `${r.name.padEnd(21)} ${String(r.n_stable).padStart(6)}  ${r.fragmentation_factor.toFixed(2).padStart(6)}  ` +
      `${r.lt_mean.toFixed(1).padStart(6)}s  ${r.lt_p50.toFixed(1).padStart(5)}s  ${r.lt_p95.toFixed(1).padStart(5)}s  ` +
      `${r.disp_mean.toFixed(1).padStart(8)}m  ${r.teleports_per_1k.toFixed(2).padStart(5)}  ${r.ghost_pct.toFixed(1).padStart(5)}%`,
    );
  }

  const pct = (a, b) => (b === 0 ? '—' : `${(((a - b) / b) * 100).toFixed(1)}%`);
  console.log('\nVerdict');
  console.log(`  raw perception ids            ${raw.n_stable}`);
  console.log(`  invariant (stable <= raw)     persist=false: ${off.n_stable <= raw.n_stable ? 'holds' : 'VIOLATED'}` +
              `   persist=true: ${on.n_stable <= raw.n_stable ? 'holds' : 'VIOLATED'}`);
  console.log(`  identities vs raw             persist=false: ${(raw.n_stable / off.n_stable).toFixed(2)}x fewer` +
              `   persist=true: ${(raw.n_stable / on.n_stable).toFixed(2)}x fewer`);
  console.log(`  persist=true vs false         stable ${pct(on.n_stable, off.n_stable)}` +
              `, median lifetime ${pct(on.lt_p50, off.lt_p50)}` +
              `, mean lifetime ${pct(on.lt_mean, off.lt_mean)}` +
              `, teleports ${pct(on.teleports_per_1k, off.teleports_per_1k)}`);

  const outPath = path.join(outDir, '11_persist_bindings_ab.json');
  fs.writeFileSync(outPath, JSON.stringify({ venueId, file: filePath, results }, null, 2));
  console.log(`\n→ ${outPath}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
