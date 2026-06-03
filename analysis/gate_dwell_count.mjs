// One-off: how many UNIQUE IDs transited the entrance ROI with an in-ROI dwell
// in [min,max] seconds (default 2..30). Reported for BOTH raw perception IDs and
// reconciled stable tracks, so we can compare with the directional-deduped
// entrant formula (footfall) on the same capture.
//
//   node --max-old-space-size=4096 analysis/gate_dwell_count.mjs \
//     --file CAP.jsonl --venue-id ID [--min-s 2] [--max-s 30] [--roi-id RID]
import fs from 'fs';
import readline from 'readline';
import { loadEntranceContext } from './lib/footfall.mjs';
import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG } from '../backend/services/TrajectoryReconciler.js';
import { perceptionToFloor, applyTransformToPoint, applyTransformToVelocity, normalizePerceptionTransform } from '../backend/services/PerceptionTransform.js';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const FILE = arg('--file');
const VENUE = arg('--venue-id');
const MIN_S = Number(arg('--min-s', '2'));
const MAX_S = Number(arg('--max-s', '30'));
const ROI_ID = arg('--roi-id', null);
const GAP_MS = 1000; // samples >1s apart start a new in-ROI run
if (!FILE || !VENUE) { console.error('Required: --file --venue-id'); process.exit(1); }

const { roi, transform } = loadEntranceContext(VENUE);
if (!roi) { console.error('No entrance ROI found for venue'); process.exit(1); }
if (ROI_ID && roi.id !== ROI_ID) console.error(`(note: using ROI ${roi.name} / ${roi.id})`);
const VERTS = roi.vertices;
const inPoly = (x, z) => {
  let inside = false;
  for (let i = 0, j = VERTS.length - 1; i < VERTS.length; j = i++) {
    const xi = VERTS[i].x, zi = VERTS[i].z, xj = VERTS[j].x, zj = VERTS[j].z;
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
};

const normT = normalizePerceptionTransform(transform || {});
const toVenue = (d) => {
  const fp = perceptionToFloor(normT.input_frame, d.position || { x: 0, y: 0, z: 0 });
  const fv = perceptionToFloor(normT.input_frame, d.velocity || { x: 0, y: 0, z: 0 });
  return { venuePosition: applyTransformToPoint(normT, fp), velocity: applyTransformToVelocity(normT, fv) };
};

const cfg = normalizeReconcilerConfig({
  ...DEFAULT_CONFIG, enabled: true, offline_instant_promote: true,
  ghost_max_speed_m_s: 3.5, ghost_min_promotion_lifetime_ms: 0, ghost_min_promotion_displacement_m: 0.03,
  ghost_static_timeout_s: 120, ghost_static_displacement_m: 0.35,
  reid_max_gap_s: 18, reid_max_distance_m: 9.0, reid_max_implied_speed_m_s: 2.4,
  reid_velocity_cosine_min: -0.25, smoothing_alpha: 0.55, active_to_lost_timeout_ms: 2500, trail_max_length: 64,
});
const reconciler = new TrajectoryReconciler(() => cfg);

function parseLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith('nohup:') || raw.startsWith('mosquitto_sub')) return null;
  const idx = raw.indexOf(' ');
  try { return JSON.parse(idx < 0 ? raw : raw.slice(idx + 1)); } catch { return null; }
}

// Per key (raw id and stable id): list of in-ROI runs as {start, last}.
const rawRuns = new Map();
const stableRuns = new Map();
function feed(map, key, t) {
  let r = map.get(key);
  if (!r) { r = { runs: [], cur: null }; map.set(key, r); }
  if (r.cur && t - r.cur.last <= GAP_MS) { r.cur.last = t; }
  else { r.cur = { start: t, last: t }; r.runs.push(r.cur); }
}

let total = 0, lastSweep = 0, lastTs = null;
const rl = readline.createInterface({ input: fs.createReadStream(FILE), crlfDelay: Infinity });
console.error(`Counting in-ROI transits in "${roi.name}" with dwell ∈ [${MIN_S}s, ${MAX_S}s] ...`);
for await (const line of rl) {
  const d = parseLine(line);
  if (!d || !d.position) continue;
  if (d.venueId && d.venueId !== VENUE) continue;
  const t = Number(d.timestamp) || 0; if (!t) continue;
  const { venuePosition, velocity } = toVenue(d);
  total++; lastTs = t;
  // raw id keying
  if (inPoly(venuePosition.x, venuePosition.z)) feed(rawRuns, String(d.id), t);
  // reconciled keying
  if (t - lastSweep > 250) { lastSweep = t; reconciler.sweep(t); }
  const out = reconciler.process({ id: String(d.id), deviceId: d.deviceId || 'edge', venueId: VENUE, timestamp: t, position: venuePosition, venuePosition, velocity });
  if (out && inPoly(out.venuePosition.x, out.venuePosition.z)) feed(stableRuns, out.stableId || out.id, t);
  if (total % 500000 === 0) process.stderr.write(`\r  … ${total.toLocaleString()} msgs`);
}
process.stderr.write('\n');

function summarize(map) {
  const minMs = MIN_S * 1000, maxMs = MAX_S * 1000;
  let touched = 0, inWindow = 0, under = 0, over = 0;
  for (const r of map.values()) {
    touched++;
    // longest contiguous in-ROI run = a single transit duration
    let longest = 0;
    for (const run of r.runs) longest = Math.max(longest, run.last - run.start);
    if (longest >= minMs && longest <= maxMs) inWindow++;
    else if (longest < minMs) under++;
    else over++;
  }
  return { touched, inWindow, under, over };
}

const rawS = summarize(rawRuns);
const stableS = summarize(stableRuns);

console.log('');
console.log(`Capture transit window: [${MIN_S}s .. ${MAX_S}s]  (longest contiguous in-ROI run per ID)`);
console.log(`ROI: ${roi.name}`);
console.log('');
console.log('keying                 touched_roi   in_window[2..30s]   <2s     >30s');
console.log('────────────────────── ─────────── ─────────────────── ─────── ───────');
console.log(`raw perception IDs     ${String(rawS.touched).padStart(11)} ${String(rawS.inWindow).padStart(19)} ${String(rawS.under).padStart(7)} ${String(rawS.over).padStart(7)}`);
console.log(`reconciled stable tks  ${String(stableS.touched).padStart(11)} ${String(stableS.inWindow).padStart(19)} ${String(stableS.under).padStart(7)} ${String(stableS.over).padStart(7)}`);
