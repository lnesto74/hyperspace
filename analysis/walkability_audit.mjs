// Walkability audit — build the obstacle map (v2 reconciliation foundation) and
// render it so we can VISUALLY verify it before association is built on top.
//
// BLOCKED = venue_objects (shelves/fixtures) footprints  ∪  never-observed cells.
// FREE    = cells where ≥ minVisits raw detections landed (empirical free space).
// Distances downstream are geodesic around BLOCKED — never through a shelf.
//
// Run in backend container:
//   NODE_PATH=/app/node_modules node --max-old-space-size=4096 \
//     analysis/walkability_audit.mjs --file CAP.jsonl --venue-id ID \
//     --context /data/benchmark/runs/_gatefinder/context.json \
//     --out-dir /data/benchmark/runs/_gatefinder [--cell 1.0] [--min-visits 2]
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import readline from 'readline';
import { createRequire } from 'module';
import { perceptionToFloor, applyTransformToPoint, normalizePerceptionTransform } from '../backend/services/PerceptionTransform.js';
import { buildWalkability } from '../backend/services/offline/reconcileV2/walkability.js';

const require = createRequire('/app/index.js');

function parseArgs(argv) {
  const o = { files: [], venueId: null, context: null, outDir: '.', cacheOut: null, label: null, cell: 1.0, minVisits: 1, inflate: 1, interiorDilate: 3 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') o.files.push(argv[++i]);
    else if (a === '--files') o.files.push(...argv[++i].split(',').map(s => s.trim()).filter(Boolean));
    else if (a === '--venue-id') o.venueId = argv[++i];
    else if (a === '--context') o.context = argv[++i];
    else if (a === '--out-dir') o.outDir = argv[++i];
    else if (a === '--cache-out') o.cacheOut = argv[++i];
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--cell') o.cell = Number(argv[++i]);
    else if (a === '--min-visits') o.minVisits = Number(argv[++i]);
    else if (a === '--inflate') o.inflate = Number(argv[++i]);
    else if (a === '--interior-dilate') o.interiorDilate = Number(argv[++i]);
  }
  if (!o.files.length || !o.venueId) { console.error('Required: --file/--files --venue-id'); process.exit(1); }
  return o;
}
const args = parseArgs(process.argv);
fs.mkdirSync(args.outDir, { recursive: true });

const ctx = args.context && fs.existsSync(args.context) ? JSON.parse(fs.readFileSync(args.context, 'utf8')) : {};
const transform = normalizePerceptionTransform(ctx.transform || {});
const capName = args.label || (args.files.length > 1
  ? `union_${args.files.length}cap`
  : path.basename(args.files[0]).replace(/\.jsonl$/, ''));

// The actual footfall ROI we count entrants on (drawn prominently). Anything else
// matching entrance/gate (e.g. the old "Suggested Entrance Gate" scratch ROI) is secondary.
const isFootfallRoi = (name) => /1121|traffic/i.test(name || '') && !/suggested/i.test(name || '');

// ---------- obstacle footprints from venue_objects ----------
// Physical fixtures that block walking. Exclude sensors/markers/zones.
const NON_OBSTACLE = /lidar|camera|sensor|zone|label|marker|entrance|door|gate|person|trajectory|heat/i;
function loadObstacles() {
  const Database = require('better-sqlite3');
  const db = new Database(process.env.DB_PATH, { readonly: true });
  const rows = db.prepare(`
    SELECT id, type, name, position_x, position_z, scale_x, scale_z, rotation_y, metadata_json
    FROM venue_objects WHERE venue_id = ?
  `).all(args.venueId);
  db.close();
  const obstacles = [];
  for (const r of rows) {
    if (NON_OBSTACLE.test(r.type || '') || NON_OBSTACLE.test(r.name || '')) continue;
    // Prefer DWG footprint polygon if present
    let poly = null;
    try {
      const meta = r.metadata_json ? JSON.parse(r.metadata_json) : null;
      const fp = meta?.footprint || meta?.polygon || meta?.points;
      if (Array.isArray(fp) && fp.length >= 3) {
        poly = fp.map(p => ({ x: Number(p.x ?? p[0]), z: Number(p.z ?? p[1]) }))
                 .filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
        if (poly.length < 3) poly = null;
      }
    } catch { /* ignore */ }
    if (!poly) {
      const sx = Math.abs(r.scale_x || 0) / 2, sz = Math.abs(r.scale_z || 0) / 2;
      if (sx < 0.05 || sz < 0.05) continue; // no footprint
      const th = r.rotation_y || 0, c = Math.cos(th), s = Math.sin(th);
      const corners = [[-sx,-sz],[sx,-sz],[sx,sz],[-sx,sz]];
      poly = corners.map(([lx, lz]) => ({
        x: r.position_x + lx * c + lz * s,
        z: r.position_z - lx * s + lz * c,
      }));
    }
    obstacles.push({ id: r.id, type: r.type, name: r.name, vertices: poly });
  }
  return obstacles;
}

function parseLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith('nohup:') || raw.startsWith('mosquitto_sub')) return null;
  const idx = raw.indexOf(' ');
  const payload = idx < 0 ? raw : raw.slice(idx + 1);
  try { return JSON.parse(payload); } catch { return null; }
}
function toVenueXZ(d) {
  const fp = perceptionToFloor(transform.input_frame, d.position || { x: 0, y: 0, z: 0 });
  const v = applyTransformToPoint(transform, fp);
  return { x: v.x, z: v.z };
}

async function run() {
  const obstacles = loadObstacles();
  console.log(`obstacles        : ${obstacles.length} fixture footprints from venue_objects`);

  // Accumulate raw detection coverage across ALL captures (union), then bin.
  const cell = args.cell;
  const pts = []; // [x,z, x,z, ...] downsampled coverage points
  let total = 0, kept = 0;
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const file of args.files) {
    if (!fs.existsSync(file)) { console.error(`  ! missing ${file}`); continue; }
    let fileTotal = 0;
    const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
    for await (const line of rl) {
      const d = parseLine(line);
      if (!d || !d.position) continue;
      if (d.venueId && d.venueId !== args.venueId) continue;
      total++; fileTotal++;
      if (fileTotal % 4 !== 0) continue; // 1/4 sample is plenty for spatial coverage
      const { x, z } = toVenueXZ(d);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      if (x < xmin) xmin = x; if (x > xmax) xmax = x;
      if (z < zmin) zmin = z; if (z > zmax) zmax = z;
      pts.push(x, z); kept++;
    }
    console.log(`  capture ${path.basename(file)}: ${fileTotal.toLocaleString()} msgs`);
  }
  if (!pts.length) { console.error('No detections parsed'); process.exit(2); }

  // include obstacle extents in bounds so fixtures aren't clipped
  for (const ob of obstacles) for (const v of ob.vertices) {
    if (v.x < xmin) xmin = v.x; if (v.x > xmax) xmax = v.x;
    if (v.z < zmin) zmin = v.z; if (v.z > zmax) zmax = v.z;
  }
  const PAD = 2;
  xmin -= PAD; zmin -= PAD; xmax += PAD; zmax += PAD;
  const nx = Math.max(1, Math.ceil((xmax - xmin) / cell));
  const nz = Math.max(1, Math.ceil((zmax - zmin) / cell));
  const bounds = { x0: xmin, z0: zmin, nx, nz, cellM: cell };

  const visitCounts = new Uint32Array(nx * nz);
  for (let i = 0; i < pts.length; i += 2) {
    const ix = Math.floor((pts[i] - xmin) / cell), iz = Math.floor((pts[i + 1] - zmin) / cell);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
    visitCounts[iz * nx + ix]++;
  }
  // apply min-visits floor (drop single-ping noise)
  if (args.minVisits > 1) for (let i = 0; i < visitCounts.length; i++) if (visitCounts[i] < args.minVisits) visitCounts[i] = 0;

  const { grid, freeCells, blockedCells, visitedCells, obstacleCells } = buildWalkability({
    bounds, visitCounts, obstacles, inflateCells: args.inflate, interiorDilateCells: args.interiorDilate,
  });

  const out = {
    capture: capName, venueId: args.venueId, cell_m: cell,
    bounds: { xmin, zmin, xmax, zmax, nx, nz },
    raw_messages: total, sampled: kept,
    obstacles: obstacles.length, free_cells: freeCells, blocked_cells: blockedCells,
    visited_cells: visitedCells, obstacle_cells: obstacleCells,
    free_area_m2: +(freeCells * cell * cell).toFixed(1),
    min_visits: args.minVisits, inflate_cells: args.inflate, interior_dilate_cells: args.interiorDilate,
  };
  const jsonPath = path.join(args.outDir, `walk_${capName}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));

  // Cache artifact for the v2 reconciler (load once per venue).
  if (args.cacheOut) {
    const cache = {
      venueId: args.venueId, cellM: cell,
      bounds: { x0: bounds.x0, z0: bounds.z0, nx, nz },
      builtFrom: args.files.map(f => path.basename(f)),
      builtAt: new Date().toISOString(),
      freeCells, blockedCells,
      cells: Buffer.from(grid.cells).toString('base64'),
      obstacle: grid.obstacle ? Buffer.from(grid.obstacle).toString('base64') : null,
    };
    fs.mkdirSync(path.dirname(args.cacheOut), { recursive: true });
    fs.writeFileSync(args.cacheOut, JSON.stringify(cache));
    console.log(`cache            : ${args.cacheOut}`);
  }

  renderPng(path.join(args.outDir, `walk_${capName}.png`), { grid, bounds, obstacles, ctx });

  console.log(`bounds           : x[${xmin.toFixed(1)},${xmax.toFixed(1)}] z[${zmin.toFixed(1)},${zmax.toFixed(1)}]  grid ${nx}×${nz} @ ${cell}m`);
  console.log(`visited/obstacle : ${visitedCells} visited cells, ${obstacleCells} obstacle cells (pre-inflate)`);
  console.log(`free / blocked   : ${freeCells} / ${blockedCells}  (free area ≈ ${out.free_area_m2} m²)`);
  console.log(`png              : ${path.join(args.outDir, `walk_${capName}.png`)}`);
  console.log(`json             : ${jsonPath}`);
}

// ---------- render ----------
function renderPng(outPath, { grid, bounds, obstacles, ctx }) {
  const { nx, nz, cellM, x0, z0 } = bounds;
  const SCALE = Math.max(3, Math.floor(900 / Math.max(nx, nz)));
  const W = nx * SCALE, H = nz * SCALE;
  const img = Buffer.alloc(W * H * 3);
  const px = (x, z) => [Math.round((x - x0) / cellM * SCALE), Math.round(H - (z - z0) / cellM * SCALE)];
  const setpx = (ix, iz, rgb) => { if (ix<0||iz<0||ix>=W||iz>=H) return; const o=(iz*W+ix)*3; img[o]=rgb[0]; img[o+1]=rgb[1]; img[o+2]=rgb[2]; };
  // cells: FREE = soft gray-green, BLOCKED = dark
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const free = grid.cells[iz * nx + ix] === 1;
    const rgb = free ? [70, 120, 95] : [22, 24, 30];
    const py = H - (iz + 1) * SCALE;
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) setpx(ix * SCALE + dx, py + dy, rgb);
  }
  const line = (p0, p1, rgb) => {
    let [x0p, y0p] = p0, [x1p, y1p] = p1;
    const dx = Math.abs(x1p - x0p), dy = Math.abs(y1p - y0p), sx = x0p < x1p ? 1 : -1, sy = y0p < y1p ? 1 : -1;
    let err = dx - dy;
    for (;;) { setpx(x0p, y0p, rgb); setpx(x0p+1, y0p, rgb); setpx(x0p, y0p+1, rgb);
      if (x0p === x1p && y0p === y1p) break; const e2 = 2*err; if (e2 > -dy) { err -= dy; x0p += sx; } if (e2 < dx) { err += dx; y0p += sy; } }
  };
  // obstacle footprints (orange outline) so we can verify they match the dark voids
  for (const ob of obstacles) {
    const vs = ob.vertices; if (!vs || vs.length < 3) continue;
    for (let i = 0; i < vs.length; i++) line(px(vs[i].x, vs[i].z), px(vs[(i+1)%vs.length].x, vs[(i+1)%vs.length].z), [240, 150, 40]);
  }
  const fillPoly = (vs, rgb, alpha) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const pts = vs.map(v => px(v.x, v.z));
    for (const [x, y] of pts) { if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        if (((pts[i][1] > y) !== (pts[j][1] > y)) && (x < (pts[j][0]-pts[i][0])*(y-pts[i][1])/(pts[j][1]-pts[i][1])+pts[i][0])) inside = !inside;
      }
      if (!inside) continue;
      if (x<0||y<0||x>=W||y>=H) continue;
      const o=(y*W+x)*3; img[o]=Math.round(img[o]*(1-alpha)+rgb[0]*alpha); img[o+1]=Math.round(img[o+1]*(1-alpha)+rgb[1]*alpha); img[o+2]=Math.round(img[o+2]*(1-alpha)+rgb[2]*alpha);
    }
  };
  const thickPoly = (vs, rgb) => { for (let t = 0; t < 2; t++) for (let i = 0; i < vs.length; i++) {
    const a = px(vs[i].x, vs[i].z), b = px(vs[(i+1)%vs.length].x, vs[(i+1)%vs.length].z);
    line([a[0]+t,a[1]], [b[0]+t,b[1]], rgb); line([a[0],a[1]+t], [b[0],b[1]+t], rgb);
  } };
  for (const roi of (ctx.rois || [])) {
    if (!roi.vertices?.length) continue;
    if (/^suggested/i.test(roi.name)) {            // old scratch gate — dim gray, secondary
      for (let i = 0; i < roi.vertices.length; i++) line(px(roi.vertices[i].x, roi.vertices[i].z), px(roi.vertices[(i+1)%roi.vertices.length].x, roi.vertices[(i+1)%roi.vertices.length].z), [110, 110, 120]);
    } else if (/1121|traffic/i.test(roi.name)) {   // the ACTUAL footfall entrance — bright + filled
      fillPoly(roi.vertices, [0, 230, 255], 0.45);
      thickPoly(roi.vertices, [0, 230, 255]);
    } else {
      for (let i = 0; i < roi.vertices.length; i++) line(px(roi.vertices[i].x, roi.vertices[i].z), px(roi.vertices[(i+1)%roi.vertices.length].x, roi.vertices[(i+1)%roi.vertices.length].z), [255, 0, 200]);
    }
  }
  fs.writeFileSync(outPath, encodePng(W, H, img));
}
function encodePng(width, height, rgb) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) { raw[y*(width*3+1)] = 0; rgb.copy(raw, y*(width*3+1)+1, y*width*3, (y+1)*width*3); }
  const idat = zlib.deflateSync(raw, { level: 6 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}
let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) { CRC_TABLE = new Int32Array(256); for (let n=0;n<256;n++){ let c=n; for (let k=0;k<8;k++) c = c&1 ? 0xedb88320 ^ (c>>>1) : c>>>1; CRC_TABLE[n]=c; } }
  let c = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) c = (c>>>8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ (-1)) >>> 0;
}

run().catch(e => { console.error(e); process.exit(1); });
