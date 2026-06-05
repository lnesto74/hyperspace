// Recompute entrance footfall (Option B) and refresh fragments_per_shopper on
// existing 06_verify rows without re-running reconcilers.
//
//   node analysis/refresh_footfall_denominator.mjs --venue-id ID --capture CAPTURE_BASE

import fs from 'fs';
import path from 'path';
import { loadEntranceContext, computeEntranceFootfall } from './lib/footfall.mjs';
import { buildScorecard, writeScorecard } from './lib/scorecard.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const venueId = arg('--venue-id');
const captureBase = arg('--capture');
const replayDir = arg('--replay-dir', '/data/replay');
const runsDir = arg('--runs-dir', '/data/benchmark/runs');

if (!venueId || !captureBase) {
  console.error('Required: --venue-id --capture <capture_base_without_.jsonl>');
  process.exit(1);
}

const filePath = path.join(replayDir, `${captureBase}.jsonl`);
const runDir = path.join(runsDir, captureBase);
const artifactsDir = path.join(runDir, 'artifacts');
const verifyPath = path.join(artifactsDir, '06_verify.json');

if (!fs.existsSync(filePath)) { console.error('Missing capture:', filePath); process.exit(1); }
if (!fs.existsSync(verifyPath)) { console.error('Missing verify:', verifyPath); process.exit(1); }

const { roi, transform, error } = loadEntranceContext(venueId);
if (error || !roi) { console.error('Entrance context failed:', error || 'no ROI'); process.exit(1); }

console.log(`Recomputing footfall for ${captureBase} ...`);
const footfall = await computeEntranceFootfall(filePath, { venueId, roiVertices: roi.vertices, transform });
footfall.roi = { id: roi.id, name: roi.name };
fs.writeFileSync(path.join(artifactsDir, 'entrance_footfall.json'), JSON.stringify(footfall, null, 2));

const rows = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
const ff = footfall.footfall;
for (const r of rows) {
  if (r.n_stable != null && ff > 0) r.fragments_per_shopper = r.n_stable / ff;
}
fs.writeFileSync(verifyPath, JSON.stringify(rows, null, 2));

const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'meta.json'), 'utf8'));
writeScorecard(runDir, buildScorecard({ meta, artifactsDir, verifyRows: rows, startedAt: meta.started_at, finishedAt: meta.finished_at }));

console.log(`footfall: ${ff} all-dir (was directional-only: ${footfall.footfall_directional})`);
for (const name of ['BYPASS_RAW', 'GROCERY_V2_MAP', 'GROCERY_V3_MAP']) {
  const r = rows.find((x) => x.name === name);
  if (r) console.log(`  ${name}: frag/shopper=${r.fragments_per_shopper?.toFixed(1)}`);
}
