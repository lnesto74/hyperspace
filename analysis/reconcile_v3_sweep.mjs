// Sweep v3 Stage-0 proximityM on a capture (production walkability cache).
//
//   NODE_PATH=/app/node_modules node --max-old-space-size=4096 \
//     analysis/reconcile_v3_sweep.mjs \
//     --file /data/replay/CAP.jsonl \
//     --venue-id ID \
//     --grid /data/replay/walkability_ID.json \
//     --footfall /data/benchmark/runs/RUN/artifacts/entrance_footfall.json

import fs from 'fs';
import { reconcileV3Pipeline } from '../backend/services/offline/reconcileV3/reconcileV3.js';
import { reconcileV2Pipeline } from '../backend/services/offline/reconcileV2/reconcileV2.js';
import { IDENTITY_TRANSFORM, normalizePerceptionTransform } from '../backend/services/PerceptionTransform.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const file = arg('--file');
const venueId = arg('--venue-id');
const grid = arg('--grid');
const footfallPath = arg('--footfall');
const proxArg = arg('--prox', '1.0,1.25,1.5,1.75,2.0,2.25,2.5');

if (!file || !venueId) {
  console.error('Required: --file --venue-id [--grid] [--footfall] [--prox 1.0,1.5,...]');
  process.exit(1);
}

const proximities = proxArg.split(',').map(Number).filter((n) => Number.isFinite(n) && n > 0);
const footfall = footfallPath && fs.existsSync(footfallPath)
  ? JSON.parse(fs.readFileSync(footfallPath, 'utf8'))
  : null;
const entrants = footfall?.footfall || null;

let db = null;
try {
  const Database = require('better-sqlite3');
  db = new Database(process.env.DB_PATH || '/data/db/hyperspace.db', { readonly: true });
} catch { /* obstacles fallback only */ }

const baseCfg = {
  smoothing_alpha: 0.6,
  min_chain_life_ms: 0,
  tracklet: {},
  walkabilityCachePath: grid,
  logGraph: false,
  associate: { C_max: 12, margin: 0.3, T_max_s: 45, D_max_m: 8 },
};

const transform = IDENTITY_TRANSFORM;
const v2Base = { ...baseCfg };

console.log(`capture: ${file}`);
console.log(`venue:   ${venueId}`);
console.log(`grid:    ${grid || '(capture-derived)'}`);
console.log(`entrants:${entrants ?? 'n/a'}`);
console.log('');

console.log('Running v2 baseline ...');
const t2 = Date.now();
const v2 = await reconcileV2Pipeline({
  filePath: file, venueId, transform, configOverrides: v2Base, db,
});
const v2Chains = v2.mergedTracks.size;
const v2Fps = entrants ? v2Chains / entrants : null;
console.log(`  v2 chains=${v2Chains} tracklets=${v2.trackletCount} frag/shopper=${v2Fps?.toFixed(2) ?? '—'} (${((Date.now() - t2) / 1000).toFixed(0)}s)\n`);

const rows = [];
for (const proximityM of proximities) {
  process.stdout.write(`proximityM=${proximityM.toFixed(2)} ... `);
  const t0 = Date.now();
  const r = await reconcileV3Pipeline({
    filePath: file,
    venueId,
    transform,
    configOverrides: {
      ...baseCfg,
      fuseConcurrent: { proximityM, minOverlapMs: 300, requireDifferentSource: true },
    },
    db,
  });
  const chains = r.mergedTracks.size;
  const fps = entrants ? chains / entrants : null;
  const delta = chains - v2Chains;
  const row = {
    proximityM,
    chains,
    tracklets_raw: r.trackletCountRaw,
    tracklets_after: r.trackletCount,
    fused_groups: r.fuseStats?.fused_groups ?? 0,
    fused_removed: r.fuseStats?.removed ?? 0,
    pairs_fused: r.fuseStats?.pairs_fused ?? 0,
    links_accepted: r.stats?.links_accepted ?? 0,
    fragments_per_shopper: fps,
    delta_vs_v2: delta,
    elapsed_s: (Date.now() - t0) / 1000,
  };
  rows.push(row);
  console.log(
    `chains=${chains} (Δv2 ${delta >= 0 ? '+' : ''}${delta}) `
    + `fused=${row.fused_groups}/${row.fused_removed} frag/shopper=${fps?.toFixed(2) ?? '—'} `
    + `${row.elapsed_s.toFixed(0)}s`,
  );
  r.mergedTracks.clear();
}

rows.sort((a, b) => a.chains - b.chains);
const best = rows[0];
console.log('\n--- ranked (fewest chains = best fragmentation) ---');
for (const r of rows) {
  const mark = r.proximityM === best.proximityM ? ' ← best' : '';
  console.log(
    `  ${r.proximityM.toFixed(2)}m  chains=${r.chains}  frag/shopper=${r.fragments_per_shopper?.toFixed(2) ?? '—'}`
    + `  fused_groups=${r.fused_groups}  Δv2=${r.delta_vs_v2}${mark}`,
  );
}
console.log(`\nRecommended proximityM: ${best.proximityM} (chains ${best.chains} vs v2 ${v2Chains})`);
