// Phase A tuner for Reconciliation v2.
//
// Extracts tracklets ONCE, then sweeps associator parameters. For each param
// set it runs association in-memory and scores:
//   - fragments/person  (chains / entrance-crossing chains)  → push toward < 20
//   - label agreement   (human merge annotations: 'same' should land in one
//                         chain, 'different' must land in different chains)
// The recommended params are the lowest fragments/person with ZERO label
// violations (fall back to fewest violations). Labels keep it from over-merging.
//
// Run in backend container:
//   NODE_PATH=/app/node_modules node --max-old-space-size=4096 \
//     analysis/reconcile_tune.mjs --file CAP.jsonl --venue-id ID \
//     --grid /data/replay/walkability_<venueId>.json \
//     --context /data/benchmark/runs/_gatefinder/context.json \
//     [--source-file CAP.jsonl] [--job-id UUID] [--out report.json]
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { createRequire } from 'module';
import { perceptionToFloor, applyTransformToPoint, applyTransformToVelocity, normalizePerceptionTransform } from '../backend/services/PerceptionTransform.js';
import { loadWalkabilityCache } from '../backend/services/offline/reconcileV2/walkability.js';
import { extractTracklets } from '../backend/services/offline/reconcileV2/tracklets.js';
import { associateTracklets } from '../backend/services/offline/reconcileV2/associate.js';

const require = createRequire('/app/index.js');

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const file = arg('--file'); const venueId = arg('--venue-id'); const gridPath = arg('--grid');
const contextPath = arg('--context'); const outPath = arg('--out');
const sourceFile = arg('--source-file', file ? path.basename(file) : null);
const jobId = arg('--job-id');
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

// ---- annotations from main DB (graceful if table/DB absent) ----
function loadAnnotations() {
  try {
    const Database = require('better-sqlite3');
    const db = new Database(process.env.DB_PATH || '/data/db/hyperspace.db', { readonly: true });
    let rows = [];
    if (jobId) rows = db.prepare('SELECT * FROM reconcile_merge_annotations WHERE job_id = ?').all(jobId);
    else if (sourceFile) rows = db.prepare('SELECT * FROM reconcile_merge_annotations WHERE source_file = ?').all(sourceFile);
    db.close();
    return rows.filter(r => r.kind === 'same' || r.kind === 'different');
  } catch (e) { console.warn('annotations: none loaded (', e.message, ')'); return []; }
}

const inPoly = (x, z, vs) => { let c = false; for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) { const xi = vs[i].x, zi = vs[i].z, xj = vs[j].x, zj = vs[j].z; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c; } return c; };
const entrance = (ctx.rois || []).find(r => /1121|traffic/i.test(r.name) && !/suggested/i.test(r.name) && r.vertices?.length >= 3);

// map an annotation pick (x,z,ts) → trackletId (nearest sample within a time window)
function pickToTracklet(tracklets, x, z, ts) {
  let best = null, bestD = Infinity;
  const tol = 3000; // ms
  for (const t of tracklets) {
    if (ts != null && (t.firstTs - tol > ts || t.lastTs + tol < ts)) continue;
    for (const s of t.samples) {
      if (ts != null && Math.abs(s.t - ts) > tol) continue;
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) { bestD = d; best = t.trackletId; }
    }
  }
  return bestD <= 4 ? best : best; // accept nearest; caller may inspect bestD via re-call if needed
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
  const rawIds = byId.size;
  const tracklets = extractTracklets(byId, grid, {});
  return { tracklets: tracklets.slice(), rawIds, total };
}

function evaluate(tracklets, params, labelPairs) {
  const { chains, graph, stats } = associateTracklets(tracklets.slice(), grid, { ...params, logGraph: true });
  // tracklet → chain stableId
  const chainOf = new Map();
  for (const c of graph.chains) for (const tid of c.tracklets) chainOf.set(tid, c.stableId);
  // fragments/person
  let footfall = 0;
  for (const samples of chains.values()) if (entrance && samples.some(pt => inPoly(pt.x, pt.z, entrance.vertices))) footfall++;
  const fpp = footfall ? +(chains.size / footfall).toFixed(1) : null;
  // label agreement
  let sameOk = 0, sameBad = 0, diffOk = 0, diffBad = 0;
  for (const lp of labelPairs) {
    const ca = chainOf.get(lp.ta), cb = chainOf.get(lp.tb);
    if (ca == null || cb == null) continue;
    if (lp.kind === 'same') { if (ca === cb) sameOk++; else sameBad++; }
    else { if (ca !== cb) diffOk++; else diffBad++; }
  }
  return {
    params,
    chains: chains.size, entrance_chains: footfall, fragments_per_person: fpp,
    links_accepted: stats.links_accepted,
    label_violations: sameBad + diffBad,
    same_ok: sameOk, same_bad: sameBad, diff_ok: diffOk, diff_bad: diffBad,
  };
}

async function run() {
  console.log('loading tracklets …');
  const { tracklets, rawIds, total } = await loadTracklets();
  console.log(`raw ids ${rawIds.toLocaleString()} (${total.toLocaleString()} msgs) → tracklets ${tracklets.length.toLocaleString()}`);

  const anns = loadAnnotations();
  const labelPairs = [];
  for (const a of anns) {
    const ta = pickToTracklet(tracklets, a.x_a, a.z_a, a.ts_a);
    const tb = pickToTracklet(tracklets, a.x_b, a.z_b, a.ts_b);
    if (ta && tb && ta !== tb) labelPairs.push({ kind: a.kind, ta, tb });
  }
  console.log(`annotations: ${anns.length} loaded, ${labelPairs.length} mapped to tracklet pairs`);

  // search space (coordinate-ish grid over the merge-aggressiveness knobs)
  const C_maxes = [5, 6, 7, 8, 10];
  const margins = [0.3, 0.5, 0.7];
  const T_maxes = [10, 12];
  const D_maxes = [4, 5];
  const results = [];
  let n = 0; const totalRuns = C_maxes.length * margins.length * T_maxes.length * D_maxes.length;
  for (const C_max of C_maxes) for (const margin of margins) for (const T_max_s of T_maxes) for (const D_max_m of D_maxes) {
    const r = evaluate(tracklets, { C_max, margin, T_max_s, D_max_m }, labelPairs);
    results.push(r);
    n++;
    process.stdout.write(`\r  sweep ${n}/${totalRuns}  C=${C_max} m=${margin} T=${T_max_s} D=${D_max_m} → fpp=${r.fragments_per_person} viol=${r.label_violations}   `);
  }
  process.stdout.write('\n');

  // rank: fewest label violations, then lowest fragments/person
  results.sort((a, b) => (a.label_violations - b.label_violations) || ((a.fragments_per_person ?? 1e9) - (b.fragments_per_person ?? 1e9)));

  console.log('\n=== top 10 param sets ===');
  console.log('rank  C_max margin T_max D_max | chains  entr  frag/pp | viol (same✓/✗ diff✓/✗)');
  results.slice(0, 10).forEach((r, i) => {
    const p = r.params;
    console.log(
      `${String(i + 1).padStart(2)}.   ${String(p.C_max).padStart(4)} ${String(p.margin).padStart(5)} ${String(p.T_max_s).padStart(5)} ${String(p.D_max_m).padStart(5)} | `
      + `${String(r.chains).padStart(6)} ${String(r.entrance_chains).padStart(5)} ${String(r.fragments_per_person).padStart(7)} | `
      + `${String(r.label_violations).padStart(4)}  (${r.same_ok}/${r.same_bad} ${r.diff_ok}/${r.diff_bad})`,
    );
  });
  const best = results[0];
  console.log('\nRECOMMENDED associate params:', JSON.stringify(best.params));
  console.log(`→ ${best.chains} chains, ${best.entrance_chains} entrance, fragments/person ${best.fragments_per_person}, label violations ${best.label_violations}`);

  if (outPath) {
    fs.writeFileSync(outPath, JSON.stringify({ capture: path.basename(file), venueId, rawIds, tracklets: tracklets.length, annotations: anns.length, mapped_pairs: labelPairs.length, results }, null, 2));
    console.log('report:', outPath);
  }
}

run().catch(e => { console.error(e); process.exit(1); });
