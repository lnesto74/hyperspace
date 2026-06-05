// Simulate alternative entrant denominators (fragments-per-shopper) on N captures.
// One gate pass per file; multiple dedup / inflation options from the same events.
//
//   NODE_PATH=/app/node_modules node --max-old-space-size=4096 \
//     analysis/footfall_denominator_sweep.mjs \
//     --venue-id 55fdd53b-3298-4355-97c0-b4e789b11d06 \
//     --captures cap1.jsonl,cap2.jsonl,...

import fs from 'fs';
import path from 'path';
import { loadEntranceContext, computeEntranceFootfall } from './lib/footfall.mjs';

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const venueId = arg('--venue-id');
const captures = (arg('--captures') || '').split(',').map((s) => s.trim()).filter(Boolean);
const replayDir = arg('--replay-dir', '/data/replay');
const runsDir = arg('--runs-dir', '/data/benchmark/runs');

if (!venueId || !captures.length) {
  console.error('Required: --venue-id --captures file1.jsonl,file2.jsonl,...');
  process.exit(1);
}

async function sweepFile(filePath, { roi, transform }) {
  const base = await computeEntranceFootfall(filePath, {
    venueId, roiVertices: roi.vertices, transform,
    dedupVariants: [
      { id: 'loose_a', dedupT: 4000, dedupD: 1.8 },
      { id: 'loose_b', dedupT: 5000, dedupD: 2.0 },
      { id: 'loose_c', dedupT: 6000, dedupD: 2.5 },
    ],
  });

  const current = base.footfall;
  const v = base.dedup_variants || {};
  const options = [
    { id: 'A_current', label: 'A — Current directional dedup', entrants: current, source: 'baseline' },
    { id: 'B_all_dir', label: 'B — All directions (same dedup)', entrants: base.footfall_all_directions, source: 'diagnostic' },
    { id: 'C_loose_4s', label: 'C — Directional, looser 4s/1.8m', entrants: v.loose_a?.directional ?? current, source: 'simulated' },
    { id: 'D_loose_5s', label: 'D — Directional, looser 5s/2.0m', entrants: v.loose_b?.directional ?? current, source: 'simulated' },
    { id: 'E_loose_6s', label: 'E — Directional, looser 6s/2.5m', entrants: v.loose_c?.directional ?? current, source: 'simulated' },
    { id: 'F_blend_mid', label: 'F — Midpoint current↔all-dir', entrants: Math.round((current + base.footfall_all_directions) / 2), source: 'derived' },
    { id: 'G_x110', label: 'G — Current × 1.10', entrants: Math.round(current * 1.10), source: 'multiplier' },
    { id: 'H_x115', label: 'H — Current × 1.15', entrants: Math.round(current * 1.15), source: 'multiplier' },
    { id: 'I_x120', label: 'I — Current × 1.20', entrants: Math.round(current * 1.20), source: 'multiplier' },
    { id: 'J_x125', label: 'J — Current × 1.25', entrants: Math.round(current * 1.25), source: 'multiplier' },
    { id: 'K_counted_tracks', label: 'K — Counted gate tracks (inclusive)', entrants: base.counted_tracks_inclusive, source: 'diagnostic (no dedup)' },
    { id: 'L_touched_tracks', label: 'L — Touched gate tracks', entrants: base.touched_tracks, source: 'diagnostic' },
  ];

  return { base, options };
}

function loadStableCounts(captureBase) {
  const verifyPath = path.join(runsDir, captureBase, 'artifacts', '06_verify.json');
  if (!fs.existsSync(verifyPath)) return {};
  const rows = JSON.parse(fs.readFileSync(verifyPath, 'utf8'));
  const out = {};
  for (const name of ['BYPASS_RAW', 'GROCERY_V2_MAP', 'GROCERY_V3_MAP']) {
    const r = rows.find((x) => x.name === name);
    if (r?.n_stable != null) out[name] = r.n_stable;
  }
  return out;
}

const { roi, transform, error } = loadEntranceContext(venueId);
if (error || !roi) {
  console.error('Entrance context failed:', error || 'no ROI');
  process.exit(1);
}

console.log(`venue: ${venueId}`);
console.log(`ROI:   ${roi.name}`);
console.log(`captures: ${captures.length}\n`);

const allResults = [];

for (const cap of captures) {
  const filePath = path.isAbsolute(cap) ? cap : path.join(replayDir, cap);
  const captureBase = path.basename(filePath, '.jsonl');
  console.log(`\n======== ${captureBase} ========`);
  if (!fs.existsSync(filePath)) { console.log('  MISSING'); continue; }

  const stable = loadStableCounts(captureBase);
  const { base, options } = await sweepFile(filePath, { roi, transform });

  console.log(`Diagnostics: events=${base.engagement_events} touched=${base.touched_tracks} counted=${base.counted_tracks_inclusive} dir_purity=${base.directional_purity}`);
  console.log(`Stable tracks: raw=${stable.BYPASS_RAW ?? '—'} v2=${stable.GROCERY_V2_MAP ?? '—'} v3=${stable.GROCERY_V3_MAP ?? '—'}`);
  console.log('');
  console.log('Option                          Entrants  ΔvsA   raw frag  v2 frag  v3 frag');
  console.log('────────────────────────────────────────────────────────────────────────────');

  const currentEntrants = options.find((o) => o.id === 'A_current').entrants;
  for (const o of options) {
    const delta = o.entrants - currentEntrants;
    const pct = currentEntrants ? ((delta / currentEntrants) * 100).toFixed(0) : '—';
    const frag = (n) => (n && o.entrants ? (n / o.entrants).toFixed(1) : '—');
    console.log(
      `${o.label.padEnd(32)} ${String(o.entrants).padStart(7)}  +${String(delta).padStart(3)} (${pct}%)`
      + `  ${frag(stable.BYPASS_RAW).padStart(7)}  ${frag(stable.GROCERY_V2_MAP).padStart(7)}  ${frag(stable.GROCERY_V3_MAP).padStart(7)}`,
    );
  }

  allResults.push({ capture: captureBase, currentEntrants, stable, options, base });
}

// Cross-capture summary: recommend options that inflate ~10-20% consistently
console.log('\n\n======== CROSS-CAPTURE SUMMARY (v3 frag/shopper if available, else v2) ========');
const optionIds = allResults[0]?.options.map((o) => o.id) || [];
console.log('Option                          Avg Δ%   Avg v3/v2 frag');
for (const oid of optionIds) {
  let sumPct = 0, sumFrag = 0, n = 0;
  for (const r of allResults) {
    const o = r.options.find((x) => x.id === oid);
    const entA = r.currentEntrants;
    if (!o || !entA) continue;
    sumPct += ((o.entrants - entA) / entA) * 100;
    const stableN = r.stable.GROCERY_V3_MAP ?? r.stable.GROCERY_V2_MAP;
    if (stableN) { sumFrag += stableN / o.entrants; n++; }
  }
  if (!n) continue;
  const o0 = allResults[0].options.find((x) => x.id === oid);
  console.log(
    `${(o0?.label || oid).padEnd(32)} ${(sumPct / allResults.length).toFixed(1).padStart(6)}%`
    + `  ${(sumFrag / n).toFixed(1).padStart(10)}`,
  );
}

const outPath = path.join(runsDir, '_footfall_denominator_sweep.json');
fs.writeFileSync(outPath, JSON.stringify({ venueId, roi: { id: roi.id, name: roi.name }, captures: allResults }, null, 2));
console.log(`\nWrote ${outPath}`);
