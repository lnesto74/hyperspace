// Explain WHY human-labeled SAME pairs fail to merge in Reconciliation v2.
//
// For each 'same' annotation (two tracks the human says are one person) we map
// both picks to tracklets and classify the blocker:
//   - CONCURRENT      : the two tracklets overlap in time → duplicate IDs from
//                       overlapping sensor coverage. The sequential associator
//                       cannot merge these by design (it only links A.end→B.start).
//   - GAP_TOO_LONG    : sequential, but the time gap exceeds T_max_s.
//   - UNREACHABLE     : geodesic path blocked by walls/obstacles (geo = ∞).
//   - TOO_FAR         : geodesic distance exceeds D_max_m.
//   - SPEED           : implied speed end→start exceeds vMax.
//   - FEASIBLE        : none of the above — should be mergeable; look at cost/R_max.
//
// Usage (backend container):
//   node --max-old-space-size=4096 analysis/reconcile_explain.mjs \
//     --file CAP.jsonl --venue-id ID --grid /data/replay/walkability_<id>.json \
//     --context /data/benchmark/runs/_gatefinder/context.json \
//     --source-file CAP.jsonl [--T 12] [--D 5] [--vmax 2.0]
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createRequire } from 'module';
import { perceptionToFloor, applyTransformToPoint, applyTransformToVelocity, normalizePerceptionTransform } from '../backend/services/PerceptionTransform.js';
import { loadWalkabilityCache } from '../backend/services/offline/reconcileV2/walkability.js';
import { extractTracklets } from '../backend/services/offline/reconcileV2/tracklets.js';

const require = createRequire('/app/index.js');
function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const file = arg('--file'); const venueId = arg('--venue-id'); const gridPath = arg('--grid');
const contextPath = arg('--context');
const sourceFile = arg('--source-file', file ? path.basename(file) : null);
const jobId = arg('--job-id');
const T_max_s = Number(arg('--T', 12));
const D_max_m = Number(arg('--D', 5));
const vMax = Number(arg('--vmax', 2.0));
if (!file || !venueId || !gridPath) { console.error('Required: --file --venue-id --grid'); process.exit(1); }

const ctx = contextPath && fs.existsSync(contextPath) ? JSON.parse(fs.readFileSync(contextPath, 'utf8')) : {};
const transform = normalizePerceptionTransform(ctx.transform || {});
const grid = loadWalkabilityCache(gridPath);

function parseLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith('nohup:') || raw.startsWith('mosquitto_sub')) return null;
  const idx = raw.indexOf(' ');
  try { return JSON.parse(idx < 0 ? raw : raw.slice(idx + 1)); } catch { return null; }
}
function toVenue(d) {
  const fp = perceptionToFloor(transform.input_frame, d.position || { x: 0, y: 0, z: 0 });
  const fv = perceptionToFloor(transform.input_frame, d.velocity || { x: 0, y: 0, z: 0 });
  const v = applyTransformToPoint(transform, fp);
  const vel = applyTransformToVelocity(transform, fv);
  return { x: v.x, z: v.z, vx: vel.x, vz: vel.z };
}

function loadAnnotations() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DB_PATH || '/data/db/hyperspace.db', { readonly: true });
    let rows = [];
    if (jobId) rows = db.prepare('SELECT * FROM reconcile_merge_annotations WHERE job_id = ?').all(jobId);
    else if (sourceFile) rows = db.prepare('SELECT * FROM reconcile_merge_annotations WHERE source_file = ?').all(sourceFile);
    db.close();
    return rows;
  } catch (e) { console.warn('annotations: none loaded (', e.message, ')'); return []; }
}

// map a pick (x,z,ts) → tracklet object (nearest sample within a time window)
function pickToTracklet(tracklets, x, z, ts) {
  let best = null, bestD = Infinity;
  const tol = 3000;
  for (const t of tracklets) {
    if (ts != null && (t.firstTs - tol > ts || t.lastTs + tol < ts)) continue;
    for (const s of t.samples) {
      if (ts != null && Math.abs(s.t - ts) > tol) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) { bestD = d; best = t; }
    }
  }
  return best;
}

async function loadTracklets() {
  const byId = new Map();
  let total = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const d = parseLine(line);
    if (!d || !d.position) continue;
    if (d.venueId && d.venueId !== venueId) continue;
    const t = Number(d.timestamp) || 0; if (!t) continue;
    total++;
    const id = String(d.id);
    const { x, z, vx, vz } = toVenue(d);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    let arr = byId.get(id); if (!arr) { arr = []; byId.set(id, arr); }
    const lp = arr.length ? arr[arr.length - 1] : null;
    if (!lp || (t - lp.t) >= 150 || Math.hypot(x - lp.x, z - lp.z) >= 0.25) arr.push({ t, x, z, vx, vz, perceptionId: id });
    if (total % 1000000 === 0) process.stdout.write(`\r  … ${total.toLocaleString()} msgs`);
  }
  process.stdout.write('\n');
  return { tracklets: extractTracklets(byId, grid, {}).slice(), rawIds: byId.size };
}

function endpoint(t, which) {
  const s = which === 'last' ? t.samples[t.samples.length - 1] : t.samples[0];
  return s;
}

function classify(a, b) {
  // temporal relationship
  const overlap = a.firstTs <= b.lastTs && b.firstTs <= a.lastTs;
  if (overlap) {
    // closest approach in space during overlap window (sample the nearer endpoints)
    const dmin = Math.min(
      Math.hypot(endpoint(a, 'first').x - endpoint(b, 'first').x, endpoint(a, 'first').z - endpoint(b, 'first').z),
      Math.hypot(endpoint(a, 'last').x - endpoint(b, 'last').x, endpoint(a, 'last').z - endpoint(b, 'last').z),
    );
    return { kind: 'CONCURRENT', overlapMs: Math.min(a.lastTs, b.lastTs) - Math.max(a.firstTs, b.firstTs), endpointSepM: +dmin.toFixed(2) };
  }
  // sequential: earlier → later
  const [e, l] = a.lastTs <= b.firstTs ? [a, b] : [b, a];
  const eEnd = endpoint(e, 'last'), lStart = endpoint(l, 'first');
  const gapS = (l.firstTs - e.lastTs) / 1000;
  const eucl = Math.hypot(eEnd.x - lStart.x, eEnd.z - lStart.z);
  const geo = grid.geo(eEnd.x, eEnd.z, lStart.x, lStart.z);
  const reachable = Number.isFinite(geo);
  const speed = gapS > 0 ? (reachable ? geo : eucl) / gapS : Infinity;
  let kind = 'FEASIBLE';
  if (gapS > T_max_s) kind = 'GAP_TOO_LONG';
  else if (!reachable) kind = 'UNREACHABLE';
  else if (geo > D_max_m) kind = 'TOO_FAR';
  else if (speed > vMax) kind = 'SPEED';
  return { kind, gapS: +gapS.toFixed(1), euclM: +eucl.toFixed(2), geoM: reachable ? +geo.toFixed(2) : null, speedMS: +speed.toFixed(2) };
}

async function run() {
  console.log('loading tracklets …');
  const { tracklets, rawIds } = await loadTracklets();
  console.log(`raw ids ${rawIds.toLocaleString()} → tracklets ${tracklets.length.toLocaleString()}`);
  console.log(`thresholds: T_max=${T_max_s}s  D_max=${D_max_m}m  vMax=${vMax}m/s\n`);

  const anns = loadAnnotations();
  const same = anns.filter(a => a.kind === 'same');
  const diff = anns.filter(a => a.kind === 'different');
  console.log(`annotations: ${anns.length} (same=${same.length} different=${diff.length} bad_jump=${anns.filter(a => a.kind === 'bad_jump').length})\n`);

  const tally = {};
  console.log('=== SAME pairs (human says: one person) ===');
  console.log('#   blocker        detail');
  let i = 0;
  for (const a of same) {
    i++;
    const ta = pickToTracklet(tracklets, a.x_a, a.z_a, a.ts_a);
    const tb = pickToTracklet(tracklets, a.x_b, a.z_b, a.ts_b);
    if (!ta || !tb) { console.log(`${String(i).padStart(2)}. UNMAPPED      could not map pick→tracklet (ta=${!!ta} tb=${!!tb})`); tally.UNMAPPED = (tally.UNMAPPED||0)+1; continue; }
    if (ta.trackletId === tb.trackletId) { console.log(`${String(i).padStart(2)}. SELF          both picks → same tracklet ${ta.trackletId}`); tally.SELF=(tally.SELF||0)+1; continue; }
    const c = classify(ta, tb);
    tally[c.kind] = (tally[c.kind] || 0) + 1;
    const det = c.kind === 'CONCURRENT'
      ? `overlap=${(c.overlapMs/1000).toFixed(1)}s endpointSep=${c.endpointSepM}m  (${ta.trackletId} ⟂ ${tb.trackletId})`
      : `gap=${c.gapS}s eucl=${c.euclM}m geo=${c.geoM==null?'∞':c.geoM+'m'} v=${c.speedMS}m/s  (${ta.trackletId}→${tb.trackletId})`;
    console.log(`${String(i).padStart(2)}. ${c.kind.padEnd(13)} ${det}`);
  }

  console.log('\n=== blocker tally (SAME) ===');
  for (const [k, v] of Object.entries(tally).sort((x, y) => y[1] - x[1])) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log('\ninterpretation:');
  console.log('  CONCURRENT → need a DUPLICATE-MERGE pass (merge overlapping co-located IDs) BEFORE sequential association.');
  console.log('  UNREACHABLE → walkability over-blocks; relax inflation / fix obstacle mask near these spots.');
  console.log('  GAP_TOO_LONG/TOO_FAR → your labels imply longer re-ID than current rules allow; raise T_max/D_max for entrance-anchored chains.');
  console.log('  FEASIBLE → edge should exist; suspect R_max (nearest-K) pruning or cost ranking.');
}

run().catch(e => { console.error(e); process.exit(1); });
