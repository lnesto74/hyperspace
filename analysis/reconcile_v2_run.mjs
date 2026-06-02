// Standalone driver for the v2 engine — produces a real replay artifact
// (byte-compatible with the offline reconcile job) WITHOUT touching the live
// backend. Lets us validate playback format before a backend rebuild.
//
//   NODE_PATH=/app/node_modules node --max-old-space-size=4096 \
//     analysis/reconcile_v2_run.mjs --file CAP.jsonl --venue-id ID \
//     --grid /data/replay/walkability_<venueId>.json \
//     --context /data/benchmark/runs/_gatefinder/context.json \
//     --out /data/replay/reconciled/CAP__GROCERY_V2_MAP.reconciled.jsonl
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { runReconcileV2ToFile } from '../backend/services/offline/reconcileV2/reconcileV2.js';
import { normalizePerceptionTransform } from '../backend/services/PerceptionTransform.js';

const require = createRequire('/app/index.js');

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const file = arg('--file'); const venueId = arg('--venue-id'); const grid = arg('--grid');
const context = arg('--context'); const out = arg('--out');
if (!file || !venueId || !out) { console.error('Required: --file --venue-id --out'); process.exit(1); }

const ctx = context && fs.existsSync(context) ? JSON.parse(fs.readFileSync(context, 'utf8')) : {};
const transform = normalizePerceptionTransform(ctx.transform || {});
fs.mkdirSync(path.dirname(out), { recursive: true });

let db = null;
try { const Database = require('better-sqlite3'); db = new Database(process.env.DB_PATH, { readonly: true }); } catch { /* obstacles fallback only */ }

const res = await runReconcileV2ToFile({
  filePath: file, artifactPath: out, venueId, transform,
  configOverrides: { engine: 'v2', walkabilityCachePath: grid, smoothing_alpha: 0.6 },
  meta: { presetId: 'GROCERY_V2_MAP', presetLabel: 'Grocery — Map-aware v2 (beta)', sourceFile: path.basename(file), venueId },
  onProgress: (p) => { if (p.phase === 'write' && p.batches) process.stdout.write(`\r  write ${p.batches} batches`); },
  db,
});
process.stdout.write('\n');
console.log('metrics:', JSON.stringify(res.metrics, null, 2));
console.log('artifact:', out, fs.existsSync(out) ? `(${fs.statSync(out).size} bytes)` : '(MISSING)');
