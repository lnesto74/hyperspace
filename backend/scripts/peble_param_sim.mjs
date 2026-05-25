#!/usr/bin/env node
/**
 * PEBLE parameter simulation — compare matching profiles on real store data.
 *
 * Run from backend container (has better-sqlite3 in node_modules):
 *   docker compose -f docker-compose.prod.yml exec backend \
 *     node scripts/peble_param_sim.mjs \
 *     --venue 55fdd53b-3298-4355-97c0-b4e789b11d06 \
 *     --campaign 3f54a978-f064-4d34-abae-a9e3b583b2d0 \
 *     --start-ts 1779606900000 --end-ts 1779700500000
 *
 * Or via API:
 *   curl -X POST http://localhost:3001/api/dooh-attribution/simulate ...
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { PebleParamSimulator } from '../services/dooh_attribution/PebleParamSimulator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

const dbPath = arg('db', process.env.DB_PATH || '/data/db/hyperspace.db');
const venueId = arg('venue');
const campaignId = arg('campaign');
const startTs = parseInt(arg('start-ts', '0'), 10);
const endTs = parseInt(arg('end-ts', '0'), 10);
const outPath = arg('out', path.join(__dirname, '../../analysis/out/peble_param_sim.json'));
const maxEvents = parseInt(arg('max-events', '5000'), 10);

if (!venueId || !campaignId || !startTs || !endTs) {
  console.error(`Usage: node scripts/peble_param_sim.mjs \\
  [--db /data/db/hyperspace.db] \\
  --venue <uuid> --campaign <uuid> \\
  --start-ts <ms> --end-ts <ms> [--out path] [--max-events 5000]

Note: run inside the backend container (WORKDIR /app), not from analysis/.`);
  process.exit(1);
}

if (!fs.existsSync(dbPath)) {
  console.error(`Database not found: ${dbPath}`);
  console.error('Production default is /data/db/hyperspace.db (DB_PATH env).');
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const simulator = new PebleParamSimulator(db);
const report = simulator.simulate(venueId, campaignId, startTs, endTs, { maxEvents });
db.close();

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log('\n=== PEBLE Parameter Simulation ===');
console.log(`DB: ${dbPath}`);
console.log(`Campaign: ${report.campaign}`);
console.log(`Sampled: ${report.sampledExposures} / ${report.totalExposuresInDb} exposures`);
console.log(`Shelf engagement visits in range: ${report.shelfEngagementVisitsInRange}`);
console.log('\nFragmentation context:');
console.log(`  Any zone visit (15m): ${report.fragmentation.pctAnyZoneVisit.toFixed(1)}%`);
console.log(`  Alias-only match:     ${report.fragmentation.pctAliasOnly.toFixed(1)}%`);
console.log(`  No zone visit:        ${report.fragmentation.exposuresWithNoZoneVisit}`);

console.log('\nProfile results:');
for (const p of report.profiles) {
  console.log(
    `  ${p.profileId.padEnd(22)} conv=${String(p.conversionRatePct).padStart(5)}%  ` +
    `roi=${p.matchSource.roi_visit} pos=${p.matchSource.position} none=${p.matchSource.none}  ` +
    `tta=${p.medianTtaSec ?? '—'}s`,
  );
}

if (report.recommendation) {
  console.log(`\nRecommendation: ${report.recommendation.profileId} (${report.recommendation.conversionRatePct}%)`);
  console.log(`  ${report.recommendation.note}`);
}

console.log(`\nWrote ${outPath}`);
