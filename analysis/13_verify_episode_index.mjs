#!/usr/bin/env node
/**
 * Check the shipped ZoneEpisodeIndex against the numbers the standalone probe
 * (analysis/12) validated, and time it on the windows the report actually
 * requests. The index reconstructs episodes in SQL where the probe did it in
 * JS, so agreement is not a given and the cost has to be paid at query time.
 *
 * Usage (on the droplet):
 *   docker exec -w /app hyperspace-backend-1 node scripts/13_verify_episode_index.mjs
 *
 * Read-only.
 */
import Database from 'better-sqlite3';
import { loadClassifiedRois, FRESCO_DEPT_LABELS } from '/app/services/executive/ExecutiveZoneTaxonomy.js';
import { buildZoneEpisodeIndex } from '/app/services/executive/ZoneEpisodeIndex.js';

const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const VENUE_ID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const db = new Database(DB_PATH, { readonly: true });
const now = Date.now();

// What analysis/12 measured at the 10s / 4.5m gate over the same 24h window.
const PROBE_24H = {
  Verdura: { episodes: 7809, fragPerEp: 1.86, stopping: 66.4, median: 13.6, p75: 24.6 },
  Pane: { episodes: 3647, fragPerEp: 1.61, stopping: 73.6, median: 14.2, p75: 25.1 },
  Latticini: { episodes: 2644, fragPerEp: 1.75, stopping: 72.7, median: 15.2, p75: 26.5 },
  Carne: { episodes: 2879, fragPerEp: 1.87, stopping: 60.5, median: 14.4, p75: 25.1 },
  Pesce: { episodes: 1040, fragPerEp: 2.02, stopping: 57.4, median: 15.6, p75: 28.9 },
};

const classified = loadClassifiedRois(db, VENUE_ID);
const byDept = new Map();
for (const roi of classified.filter(r => r.classification.group === 'fresco')) {
  const dept = roi.classification.subGroup || 'fresco';
  const label = roi.classification.categoryLabel || roi.linkedCategory
    || FRESCO_DEPT_LABELS[dept] || dept;
  if (!byDept.has(dept)) byDept.set(dept, { label, ids: [] });
  byDept.get(dept).ids.push(roi.id);
}

for (const [hours, name] of [[24, '24h'], [24 * 7, '7d'], [24 * 30, '30d']]) {
  const startTs = now - hours * 3600_000;
  const t0 = Date.now();
  const idx = buildZoneEpisodeIndex(db, VENUE_ID, startTs, now, { dwellMs: 5000 });
  const buildMs = Date.now() - t0;

  console.log(`\n${'='.repeat(92)}`);
  console.log(`WINDOW ${name}   index build ${buildMs} ms   available=${idx.available}`);
  console.log('='.repeat(92));

  const rows = [];
  for (const [, { label, ids }] of byDept) {
    const s = idx.statsFor(ids);
    const ref = name === '24h' ? PROBE_24H[label] : null;
    rows.push({
      dept: label,
      episodes: s.episodes,
      fragPerEp: s.fragmentsPerEpisode,
      stoppingPct: s.stoppingPct,
      medianSec: s.medianStopSec,
      p75Sec: s.p75StopSec,
      meanSec: s.meanStopSec,
      reliable: s.reliable,
      ...(ref
        ? {
          probeEpisodes: ref.episodes,
          deltaEpisodesPct: Math.round(((s.episodes - ref.episodes) / ref.episodes) * 1000) / 10,
          probeMedian: ref.median,
          deltaMedianSec: Math.round((s.medianStopSec - ref.median) * 10) / 10,
        }
        : {}),
    });
  }
  console.table(rows);
}

// Does the ranking the card implies survive the choice of statistic? If median
// and stopping rate disagree about which counter is best, the card must not
// invite the reader to rank on dwell.
const idx = buildZoneEpisodeIndex(db, VENUE_ID, now - 7 * 86400_000, now, { dwellMs: 5000 });
const scored = [...byDept.values()]
  .map(({ label, ids }) => ({ label, ...idx.statsFor(ids) }))
  .filter(r => r.reliable);
const byMedian = [...scored].sort((a, b) => b.medianStopSec - a.medianStopSec).map(r => r.label);
const byStopping = [...scored].sort((a, b) => b.stoppingPct - a.stoppingPct).map(r => r.label);
console.log('\nranking by median dwell :', byMedian.join(' > '));
console.log('ranking by stopping rate:', byStopping.join(' > '));
console.log(byMedian.join() === byStopping.join()
  ? 'rankings agree'
  : 'rankings DISAGREE — dwell and stopping are measuring different things, do not merge them into one score');
