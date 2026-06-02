// Graph-only generator for the annotation tool. Runs load → tracklets →
// associate(logGraph) and writes ONLY the .graph.json sidecar (chain polylines
// + tracklets + candidate edges + entrance ROI + extent) — no 14 GB playback
// artifact. The annotation panel renders from this; labels key off the capture.
//
//   NODE_PATH=/app/node_modules node --max-old-space-size=4096 \
//     analysis/reconcile_graph.mjs --file CAP.jsonl --venue-id ID \
//     --grid /data/replay/walkability_<venueId>.json \
//     --context /data/benchmark/runs/_gatefinder/context.json \
//     --out /data/replay/reconciled/CAP__GRAPHONLY.graph.json
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { perceptionToFloor, applyTransformToPoint, applyTransformToVelocity, normalizePerceptionTransform } from '../backend/services/PerceptionTransform.js';
import { loadWalkabilityCache } from '../backend/services/offline/reconcileV2/walkability.js';
import { extractTracklets } from '../backend/services/offline/reconcileV2/tracklets.js';
import { associateTracklets } from '../backend/services/offline/reconcileV2/associate.js';

function arg(name, def) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
const file = arg('--file'); const venueId = arg('--venue-id'); const gridPath = arg('--grid');
const contextPath = arg('--context'); let outPath = arg('--out');
if (!file || !venueId || !gridPath) { console.error('Required: --file --venue-id --grid'); process.exit(1); }
const capBase = path.basename(file).replace(/\.jsonl$/, '');
if (!outPath) outPath = path.join('/data/replay/reconciled', `${capBase}__GRAPHONLY.graph.json`);

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

async function run() {
  const byId = new Map();
  let total = 0, firstTs = null, lastTs = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const d = parseLine(line);
    if (!d || !d.position) continue;
    if (d.venueId && d.venueId !== venueId) continue;
    const t = Number(d.timestamp) || 0; if (!t) continue;
    total++; if (firstTs == null) firstTs = t; lastTs = t;
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
  const { stats, graph } = associateTracklets(tracklets.slice(), grid, { logGraph: true });

  const entrance = (ctx.rois || []).find(r => /1121|traffic/i.test(r.name) && !/suggested/i.test(r.name) && r.vertices?.length >= 3);
  const inPoly = (x, z, vs) => { let c = false; for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) { const xi = vs[i].x, zi = vs[i].z, xj = vs[j].x, zj = vs[j].z; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c; } return c; };

  // extent from rendered chain polylines; flag entrance-crossing chains (the real shoppers)
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let rendered = 0, entranceChains = 0;
  for (const c of graph.chains) {
    if (!c.path) continue; rendered++;
    for (const [x, z] of c.path) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    if (entrance && c.path.some(([x, z]) => inPoly(x, z, entrance.vertices))) { c.entr = 1; entranceChains++; }
  }

  const sidecar = {
    sourceFile: path.basename(file), venueId, engine: 'v2', graphOnly: true,
    firstTs, lastTs, rawIds, stats,
    extent: Number.isFinite(minX) ? { minX, maxX, minZ, maxZ } : null,
    entrance: entrance ? { name: entrance.name, vertices: entrance.vertices.map(v => ({ x: v.x, z: v.z })) } : null,
    ...graph,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(sidecar));
  const bytes = fs.statSync(outPath).size;
  console.log(`raw ids ${rawIds.toLocaleString()} → tracklets ${tracklets.length.toLocaleString()} → chains ${stats.chains.toLocaleString()} (rendered ${rendered.toLocaleString()}, entrance ${entranceChains.toLocaleString()})`);
  console.log(`graph: ${outPath}  (${(bytes / 1e6).toFixed(1)} MB)`);
}
run().catch(e => { console.error(e); process.exit(1); });
