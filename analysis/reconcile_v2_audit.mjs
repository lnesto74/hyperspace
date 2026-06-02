// Reconciliation v2 audit — Phase 1 (tracklets). Loads the cached walkability
// grid, streams a capture, splits raw perception ids into physics-consistent
// tracklets, and renders them over the map so we can verify they are clean and
// never cross shelves BEFORE association is turned on.
//
// Run in backend container:
//   NODE_PATH=/app/node_modules node --max-old-space-size=4096 \
//     analysis/reconcile_v2_audit.mjs --file CAP.jsonl --venue-id ID \
//     --grid /data/benchmark/runs/_gatefinder/walkability_55fdd53b.json \
//     --context /data/benchmark/runs/_gatefinder/context.json \
//     --out-dir /data/benchmark/runs/_gatefinder
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { perceptionToFloor, applyTransformToPoint, applyTransformToVelocity, normalizePerceptionTransform } from '../backend/services/PerceptionTransform.js';
import { loadWalkabilityCache } from '../backend/services/offline/reconcileV2/walkability.js';
import { extractTracklets } from '../backend/services/offline/reconcileV2/tracklets.js';
import { associateTracklets } from '../backend/services/offline/reconcileV2/associate.js';

function parseArgs(argv) {
  const o = { file: null, venueId: null, grid: null, context: null, outDir: '.', downsampleM: 0.25 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') o.file = argv[++i];
    else if (a === '--venue-id') o.venueId = argv[++i];
    else if (a === '--grid') o.grid = argv[++i];
    else if (a === '--context') o.context = argv[++i];
    else if (a === '--out-dir') o.outDir = argv[++i];
    else if (a === '--downsample') o.downsampleM = Number(argv[++i]);
  }
  if (!o.file || !o.venueId || !o.grid) { console.error('Required: --file --venue-id --grid'); process.exit(1); }
  return o;
}
const args = parseArgs(process.argv);
fs.mkdirSync(args.outDir, { recursive: true });

const ctx = args.context && fs.existsSync(args.context) ? JSON.parse(fs.readFileSync(args.context, 'utf8')) : {};
const transform = normalizePerceptionTransform(ctx.transform || {});
const capName = path.basename(args.file).replace(/\.jsonl$/, '');
const grid = loadWalkabilityCache(args.grid);

function parseLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith('nohup:') || raw.startsWith('mosquitto_sub')) return null;
  const idx = raw.indexOf(' ');
  const payload = idx < 0 ? raw : raw.slice(idx + 1);
  try { return JSON.parse(payload); } catch { return null; }
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
  let total = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(args.file), crlfDelay: Infinity });
  for await (const line of rl) {
    const d = parseLine(line);
    if (!d || !d.position) continue;
    if (d.venueId && d.venueId !== args.venueId) continue;
    const t = Number(d.timestamp) || 0; if (!t) continue;
    total++;
    const id = String(d.id);
    const { x, z, vx, vz } = toVenue(d);
    if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
    let arr = byId.get(id);
    if (!arr) { arr = []; byId.set(id, arr); }
    // light per-id downsample to bound memory (keep time + motion)
    const lastP = arr.length ? arr[arr.length - 1] : null;
    if (!lastP || (t - lastP.t) >= 150 || Math.hypot(x - lastP.x, z - lastP.z) >= args.downsampleM) {
      arr.push({ t, x, z, vx, vz, perceptionId: id });
    }
    if (total % 1000000 === 0) process.stdout.write(`\r  … ${total.toLocaleString()} msgs, ${byId.size.toLocaleString()} ids`);
  }
  process.stdout.write('\n');

  const rawIds = byId.size;
  const tracklets = extractTracklets(byId, grid, {});
  const dropped = tracklets._dropped || {};

  // stats
  let totDisp = 0, totLife = 0;
  for (const t of tracklets) { totDisp += t.totalDisp; totLife += t.lifeMs; }
  const out = {
    capture: capName, venueId: args.venueId,
    raw_messages: total, raw_ids: rawIds,
    tracklets: tracklets.length,
    dropped_ghost: dropped.ghost || 0, dropped_static_breaks: dropped.static || 0,
    tracklets_per_raw_id: +(tracklets.length / Math.max(1, rawIds)).toFixed(2),
    avg_tracklet_disp_m: +(totDisp / Math.max(1, tracklets.length)).toFixed(2),
    avg_tracklet_life_s: +(totLife / Math.max(1, tracklets.length) / 1000).toFixed(2),
  };
  renderTracklets(path.join(args.outDir, `v2tracklets_${capName}.png`), { grid, tracklets, ctx });

  // ---- associate tracklets into chains ----
  const tArr = tracklets.slice(); // strip _dropped non-index props for clean array
  const { chains, links, stats } = associateTracklets(tArr, grid, {});

  // entrance footfall = chains that intersect the entrance ROI
  const entrance = (ctx.rois || []).find(r => /1121|traffic/i.test(r.name) && !/suggested/i.test(r.name) && r.vertices?.length >= 3);
  const inPoly = (x, z, vs) => { let c = false; for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) { const xi = vs[i].x, zi = vs[i].z, xj = vs[j].x, zj = vs[j].z; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c; } return c; };
  let footfall = 0;
  const chainArr = [...chains.values()];
  if (entrance) for (const s of chainArr) if (s.some(pt => inPoly(pt.x, pt.z, entrance.vertices))) footfall++;

  out.tracklets = tracklets.length;
  out.chains = chains.size;
  out.links_accepted = stats.links_accepted;
  out.rejected_ambiguous = stats.rejected_ambiguous;
  out.candidate_edges = stats.candidate_edges;
  out.entrance_chains = footfall;
  out.fragments_per_person = footfall ? +(chains.size / footfall).toFixed(1) : null;
  const jsonPath = path.join(args.outDir, `v2_${capName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ ...out, sample_links: links.slice(0, 20) }, null, 2));

  renderChains(path.join(args.outDir, `v2chains_${capName}.png`), { grid, chainArr, ctx });

  console.log(`raw ids          : ${rawIds.toLocaleString()}  (${total.toLocaleString()} msgs)`);
  console.log(`tracklets        : ${tracklets.length.toLocaleString()}  (${out.tracklets_per_raw_id}/raw id)`);
  console.log(`dropped          : ghost=${out.dropped_ghost}  static-breaks=${out.dropped_static_breaks}`);
  console.log(`candidate edges  : ${stats.candidate_edges.toLocaleString()}  (geo calls ${stats.geo_calls.toLocaleString()})`);
  console.log(`links accepted   : ${stats.links_accepted.toLocaleString()}  (ambiguous-split ${stats.rejected_ambiguous.toLocaleString()}, over-Cmax ${stats.rejected_cmax.toLocaleString()})`);
  console.log(`CHAINS           : ${chains.size.toLocaleString()}   (final reconciled tracks)`);
  if (entrance) console.log(`entrance chains  : ${footfall}  →  fragments/person = ${out.fragments_per_person}`);
  console.log(`png              : v2tracklets_${capName}.png , v2chains_${capName}.png`);
}

// ---------- render ----------
function hsv(h, s, v) { // h 0..1
  const i = Math.floor(h * 6), f = h * 6 - i, p = v*(1-s), q = v*(1-f*s), t = v*(1-(1-f)*s);
  const r = [v,q,p,p,t,v][i%6], g = [t,v,v,q,p,p][i%6], b = [p,p,t,v,v,q][i%6];
  return [Math.round(r*255), Math.round(g*255), Math.round(b*255)];
}
function setupCanvas(grid) {
  const { nx, nz, cellM, x0, z0 } = grid;
  const SCALE = Math.max(3, Math.floor(900 / Math.max(nx, nz)));
  const W = nx * SCALE, H = nz * SCALE;
  const img = Buffer.alloc(W * H * 3);
  const px = (x, z) => [Math.round((x - x0) / cellM * SCALE), Math.round(H - (z - z0) / cellM * SCALE)];
  const setpx = (ix, iz, rgb) => { if (ix<0||iz<0||ix>=W||iz>=H) return; const o=(iz*W+ix)*3; img[o]=rgb[0]; img[o+1]=rgb[1]; img[o+2]=rgb[2]; };
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const free = grid.cells[iz * nx + ix] === 1;
    const rgb = free ? [40, 46, 54] : [12, 13, 16];
    const py = H - (iz + 1) * SCALE;
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) setpx(ix * SCALE + dx, py + dy, rgb);
  }
  const line = (p0, p1, rgb) => {
    let [x0p, y0p] = p0, [x1p, y1p] = p1;
    const dx = Math.abs(x1p - x0p), dy = Math.abs(y1p - y0p), sx = x0p < x1p ? 1 : -1, sy = y0p < y1p ? 1 : -1;
    let err = dx - dy;
    for (;;) { setpx(x0p, y0p, rgb); if (x0p === x1p && y0p === y1p) break; const e2 = 2*err; if (e2 > -dy) { err -= dy; x0p += sx; } if (e2 < dx) { err += dx; y0p += sy; } }
  };
  return { W, H, img, px, setpx, line };
}
function drawEntrance(px, line, ctx) {
  for (const roi of (ctx.rois || [])) {
    if (!roi.vertices?.length || !/1121|traffic/i.test(roi.name) || /suggested/i.test(roi.name)) continue;
    for (let i = 0; i < roi.vertices.length; i++) {
      const a = px(roi.vertices[i].x, roi.vertices[i].z), b = px(roi.vertices[(i+1)%roi.vertices.length].x, roi.vertices[(i+1)%roi.vertices.length].z);
      line(a, b, [0,230,255]); line([a[0]+1,a[1]],[b[0]+1,b[1]],[0,230,255]);
    }
  }
}
function renderTracklets(outPath, { grid, tracklets, ctx }) {
  const { W, H, img, px, setpx, line } = setupCanvas(grid);
  let k = 0;
  for (const t of tracklets) {
    const rgb = hsv((k++ * 0.61803398875) % 1, 0.65, 0.95);
    for (let i = 1; i < t.samples.length; i++) line(px(t.samples[i-1].x, t.samples[i-1].z), px(t.samples[i].x, t.samples[i].z), rgb);
    const s = px(t.start.x, t.start.z), e = px(t.end.x, t.end.z);
    for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) { setpx(s[0]+dx, s[1]+dy, [60,255,120]); setpx(e[0]+dx, e[1]+dy, [255,70,70]); }
  }
  drawEntrance(px, line, ctx);
  fs.writeFileSync(outPath, encodePng(W, H, img));
}
function renderChains(outPath, { grid, chainArr, ctx }) {
  const { W, H, img, px, line } = setupCanvas(grid);
  let k = 0;
  for (const samples of chainArr) {
    const rgb = hsv((k++ * 0.61803398875) % 1, 0.7, 0.98);
    for (let i = 1; i < samples.length; i++) line(px(samples[i-1].x, samples[i-1].z), px(samples[i].x, samples[i].z), rgb);
  }
  drawEntrance(px, line, ctx);
  fs.writeFileSync(outPath, encodePng(W, H, img));
}
function encodePng(width, height, rgb) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))>>>0, 0); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width,0); ihdr.writeUInt32BE(height,4); ihdr[8]=8; ihdr[9]=2;
  const raw = Buffer.alloc(height*(width*3+1));
  for (let y=0;y<height;y++){ raw[y*(width*3+1)]=0; rgb.copy(raw, y*(width*3+1)+1, y*width*3, (y+1)*width*3); }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw,{level:6})), chunk('IEND', Buffer.alloc(0))]);
}
let CRC_TABLE;
function crc32(buf){ if(!CRC_TABLE){CRC_TABLE=new Int32Array(256); for(let n=0;n<256;n++){let c=n; for(let k=0;k<8;k++) c=c&1?0xedb88320^(c>>>1):c>>>1; CRC_TABLE[n]=c;}} let c=0^(-1); for(let i=0;i<buf.length;i++) c=(c>>>8)^CRC_TABLE[(c^buf[i])&0xff]; return (c^(-1))>>>0; }

run().catch(e => { console.error(e); process.exit(1); });
