/**
 * Independent insight layers for the people-flow field:
 * screen SEZ, rounded speaker reach, profit evaporate, media→shelf, ROI pick.
 */
import * as THREE from 'three';

export const CATEGORY_MARGIN = {
  Pesce: 2.8, Carne: 2.4, Gastronomia: 2.2, Latticini: 1.6,
  Frutta: 1.4, Verdura: 1.4, Pane: 1.3, 'Bakery & Breakfast': 1.3,
  Surgelati: 1.2, Salumi: 1.8, Bar: 1.5, Acqua: 0.4,
};
export const CATEGORY_HSL = {
  Pesce: [0.55, 0.65, 0.48],
  Carne: [0.02, 0.62, 0.46],
  Gastronomia: [0.08, 0.58, 0.50],
  Latticini: [0.13, 0.45, 0.62],
  Frutta: [0.32, 0.55, 0.45],
  Verdura: [0.28, 0.60, 0.40],
  Pane: [0.10, 0.50, 0.52],
  'Bakery & Breakfast': [0.09, 0.48, 0.55],
  Surgelati: [0.58, 0.45, 0.55],
  Salumi: [0.00, 0.50, 0.42],
  Bar: [0.07, 0.35, 0.48],
  Acqua: [0.52, 0.40, 0.58],
};

/** Same Lucide glyphs + colours as Piazza del Fresco (`getCategoryVisual`). */
const ICON_APPLE = [
  'M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z',
  'M10 2c1 .5 2 2 2 5',
];
const ICON_SALAD = [
  'M7 21h10',
  'M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z',
  'M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1',
  'm13 12 4-4',
  'M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2',
];
const ICON_FISH = [
  'M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z',
  'M18 12v.5',
  'M16 17.93a9.77 9.77 0 0 1 0-11.86',
  'M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33',
];
const ICON_MILK = [
  'M8 2h8',
  'M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2',
  'M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0',
];
const ICON_CROISSANT = [
  'm4.6 13.11 5.79-3.21c1.89-1.05 4.79 1.78 3.71 3.71l-3.22 5.81C8.8 23.16.79 15.23 4.6 13.11Z',
  'm10.5 9.5-1-2.29C9.2 6.48 8.8 6 8 6H4.5C2.79 6 2 6.5 2 8.5a7.71 7.71 0 0 0 2 4.83',
  'M8 6c0-1.55.24-4-2-4-2 0-2.5 2.17-2.5 4',
];
const ICON_DRUMSTICK = [
  'M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23',
  'm8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59',
];
const ICON_SNOW = [
  'm10 20-1.25-2.5L6 18', 'M10 4 8.75 6.5 6 6', 'm14 20 1.25-2.5L18 18',
  'm14 4 1.25 2.5L18 6', 'm17 21-3-6h-4', 'm17 3-3 6 1.5 3',
  'M2 12h6.5L10 9', 'm20 10-1.5 2 1.5 2', 'M22 12h-6.5L14 15',
  'm4 10 1.5 2L4 14', 'm7 21 3-6-1.5-3', 'm7 3 3 6h4',
];
const ICON_COFFEE = [
  'M10 2v2', 'M14 2v2',
  'M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1',
  'M6 2v2',
];
const ICON_DROP = [
  'M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z',
  'M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97',
];
const ICON_LEAF = [
  'M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z',
  'M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12',
];
const ICON_PACK = [
  'M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z',
  'M12 22V12',
  'm3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7',
];

export const CATEGORY_VISUAL = {
  Pesce: { color: '#38bdf8', bg: 'rgba(14, 165, 233, 0.92)', paths: ICON_FISH },
  Carne: { color: '#f87171', bg: 'rgba(239, 68, 68, 0.92)', paths: ICON_DRUMSTICK },
  Salumi: { color: '#fb7185', bg: 'rgba(244, 63, 94, 0.92)', paths: ICON_DRUMSTICK },
  Gastronomia: { color: '#fb7185', bg: 'rgba(244, 63, 94, 0.92)', paths: ICON_DRUMSTICK },
  Latticini: { color: '#fde047', bg: 'rgba(234, 179, 8, 0.92)', paths: ICON_MILK },
  Frutta: { color: '#fb923c', bg: 'rgba(249, 115, 22, 0.92)', paths: ICON_APPLE },
  Verdura: { color: '#4ade80', bg: 'rgba(34, 197, 94, 0.92)', paths: ICON_SALAD },
  'Frutta e Verdura': { color: '#4ade80', bg: 'rgba(34, 197, 94, 0.92)', paths: ICON_SALAD },
  Pane: { color: '#fbbf24', bg: 'rgba(217, 119, 6, 0.92)', paths: ICON_CROISSANT },
  'Bakery & Breakfast': { color: '#fbbf24', bg: 'rgba(217, 119, 6, 0.92)', paths: ICON_CROISSANT },
  Surgelati: { color: '#67e8f9', bg: 'rgba(8, 145, 178, 0.92)', paths: ICON_SNOW },
  Bar: { color: '#c084fc', bg: 'rgba(168, 85, 247, 0.92)', paths: ICON_COFFEE },
  Acqua: { color: '#60a5fa', bg: 'rgba(59, 130, 246, 0.92)', paths: ICON_DROP },
};

const CATEGORY_FALLBACK = { color: '#a1a1aa', bg: 'rgba(39, 45, 56, 0.94)', paths: ICON_LEAF };

export function categoryVisual(name) {
  if (!name) return CATEGORY_FALLBACK;
  if (CATEGORY_VISUAL[name]) return CATEGORY_VISUAL[name];
  const hit = Object.keys(CATEGORY_VISUAL).find((k) => k.toLowerCase() === String(name).toLowerCase());
  return hit ? CATEGORY_VISUAL[hit] : CATEGORY_FALLBACK;
}

const badgeTexCache = new Map();

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function categoryBadgeTexture(THREE, category, selected) {
  const key = `${category || 'Zone'}|${selected ? '1' : '0'}`;
  if (badgeTexCache.has(key)) return badgeTexCache.get(key);
  const vis = categoryVisual(category);
  const W = 160, H = 176;
  const cvs = document.createElement('canvas');
  cvs.width = W;
  cvs.height = H;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const pad = 10, box = 108, x0 = (W - box) / 2, y0 = 8;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = selected ? 18 : 10;
  ctx.fillStyle = vis.bg;
  roundRectPath(ctx, x0, y0, box, box, 22);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = vis.color;
  ctx.lineWidth = selected ? 4 : 2;
  ctx.stroke();
  ctx.save();
  ctx.translate(x0 + 22, y0 + 22);
  ctx.scale(64 / 24, 64 / 24);
  ctx.strokeStyle = vis.color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of vis.paths) {
    try { ctx.stroke(new Path2D(d)); } catch { /* ignore unparsable lucide arcs */ }
  }
  ctx.restore();
  const label = String(category || 'Zone');
  ctx.font = '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(7,8,11,0.72)';
  roundRectPath(ctx, 18, 126, W - 36, 28, 10);
  ctx.fill();
  ctx.fillStyle = '#e6e9ef';
  ctx.fillText(label.length > 16 ? `${label.slice(0, 15)}\u2026` : label, W / 2, 140);
  const tex = new THREE.CanvasTexture(cvs);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  badgeTexCache.set(key, tex);
  return tex;
}

const AC_CELL = 0.75;
const WAVE_N = 8;
const WAVE_MAX = 120000;
const WAVE_PERIOD = 20;
const WAVE_SPEED = 1.25;
const WAVE_Y = 0.12;
const RING_RAYS = 192;
const PROFIT_N = 900;
const PROFIT_TRAIL = 18;
const MEDIA_N = 240;
const MEDIA_TRAIL = 22;
const LISTEN_DB = 58;

export function shoelace(verts) {
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i], q = verts[(i + 1) % verts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) * 0.5;
}

export function pointInPoly(x, z, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i][0], zi = verts[i][1], xj = verts[j][0], zj = verts[j][1];
    const hit = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / ((zj - zi) || 1e-9) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}

function clearGroup(group) {
  while (group.children.length) {
    const c = group.children.pop();
    c.geometry?.dispose();
    const mats = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
    for (const m of mats) { m.map?.dispose(); m.dispose(); }
  }
}

function zoneRibbon(verts, y, width, closed) {
  const pts = [];
  if (!verts?.length) return pts;
  const n = closed ? verts.length : Math.max(0, verts.length - 1);
  const hw = width * 0.5;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * hw, nz = (dx / len) * hw;
    const a0x = a[0] + nx, a0z = a[1] + nz, a1x = a[0] - nx, a1z = a[1] - nz;
    const b0x = b[0] + nx, b0z = b[1] + nz, b1x = b[0] - nx, b1z = b[1] - nz;
    pts.push(a0x, y, a0z, b0x, y, b0z, a1x, y, a1z);
    pts.push(a1x, y, a1z, b0x, y, b0z, b1x, y, b1z);
  }
  return pts;
}

function addZoneStroke(group, T, verts, {
  closed = false, y = 0.28, preview = false, hotIndex = -1, width = 0.16,
} = {}) {
  if (!verts?.length) return;
  const w = Math.max(0.07, width);
  const haloW = preview ? w * 0.65 : w * 1.35;
  const coreW = preview ? w * 0.35 : w;
  const halo = zoneRibbon(verts, y, haloW, closed);
  const core = zoneRibbon(verts, y + 0.02, coreW, closed);
  const mk = (arr, color, opacity) => {
    if (!arr.length) return;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(arr, 3));
    const mesh = new T.Mesh(g, new T.MeshBasicMaterial({
      color, transparent: true, opacity, side: T.DoubleSide,
      depthTest: false, depthWrite: false,
    }));
    mesh.renderOrder = 40;
    group.add(mesh);
  };
  mk(halo, 0x1e293b, preview ? 0.22 : 0.28);
  mk(core, preview ? 0x7dd3fc : 0xf59e0b, preview ? 0.4 : 0.48);
  const closeTarget = !preview && !closed && verts.length >= 3;
  const ballR = Math.max(0.08, w * 0.7);
  const ballMat = new T.MeshBasicMaterial({
    color: preview ? 0xbae6fd : 0xfbbf24, transparent: true, opacity: 0.7,
    depthTest: false, depthWrite: false,
  });
  const start = preview && verts.length === 2 ? 1 : 0;
  for (let i = start; i < verts.length; i++) {
    const v = verts[i];
    const hot = i === hotIndex || (closeTarget && i === 0);
    const r = hot ? ballR * 1.7 : ballR;
    const ball = new T.Mesh(
      new T.SphereGeometry(r, 10, 7),
      hot
        ? new T.MeshBasicMaterial({ color: 0x4ade80, depthTest: false, depthWrite: false })
        : ballMat,
    );
    ball.position.set(v[0], y + 0.06, v[1]);
    ball.renderOrder = 41;
    group.add(ball);
  }
}

function dijkstra8(blocked, nx, ny, cell, seeds) {
  const N = nx * ny;
  const dist = new Float32Array(N);
  dist.fill(1e9);
  const heap = [];
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][1] <= heap[i][1]) break;
      const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp;
      i = p;
    }
  };
  const down = (i) => {
    for (;;) {
      let s = i, l = i * 2 + 1, r = l + 1;
      if (l < heap.length && heap[l][1] < heap[s][1]) s = l;
      if (r < heap.length && heap[r][1] < heap[s][1]) s = r;
      if (s === i) break;
      const tmp = heap[s]; heap[s] = heap[i]; heap[i] = tmp;
      i = s;
    }
  };
  const push = (k, d) => { heap.push([k, d]); up(heap.length - 1); };
  const pop = () => {
    const t = heap[0];
    const last = heap.pop();
    if (heap.length) { heap[0] = last; down(0); }
    return t;
  };
  for (const s of seeds) {
    if (s < 0 || s >= N || blocked[s]) continue;
    dist[s] = 0;
    push(s, 0);
  }
  const diag = cell * 1.41421356;
  const nbr = [
    [1, 0, cell], [-1, 0, cell], [0, 1, cell], [0, -1, cell],
    [1, 1, diag], [1, -1, diag], [-1, 1, diag], [-1, -1, diag],
  ];
  while (heap.length) {
    const [k, d] = pop();
    if (d !== dist[k]) continue;
    const i = k % nx, j = (k / nx) | 0;
    for (const [di, dj, cost] of nbr) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const nk = jj * nx + ii;
      if (blocked[nk]) continue;
      const nd = d + cost;
      if (nd < dist[nk]) { dist[nk] = nd; push(nk, nd); }
    }
  }
  return dist;
}

function rayAabb2(ox, oz, dx, dz, b) {
  let tmin = 0, tmax = 1e9;
  if (Math.abs(dx) < 1e-12) {
    if (ox < b.minX || ox > b.maxX) return Infinity;
  } else {
    let t1 = (b.minX - ox) / dx, t2 = (b.maxX - ox) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return Infinity;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < b.minZ || oz > b.maxZ) return Infinity;
  } else {
    let t1 = (b.minZ - oz) / dz, t2 = (b.maxZ - oz) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmax < tmin) return Infinity;
  }
  if (tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : tmax;
}

function polarHits(sx, sz, boxes, maxR) {
  const hits = new Float32Array(RING_RAYS);
  for (let r = 0; r < RING_RAYS; r++) {
    const ang = (r / RING_RAYS) * Math.PI * 2;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    let reach = maxR;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (sx >= b.minX && sx <= b.maxX && sz >= b.minZ && sz <= b.maxZ) continue;
      const t = rayAabb2(sx, sz, dx, dz, b);
      if (t > 0.08 && t < reach) reach = t;
    }
    hits[r] = reach;
  }
  return hits;
}

export function createLayerEngine(api) {
  const {
    THREE: T, scene, params, pack,
    getField, gridToVenue, venueToGrid,
    terrainHeightAt, terrainHeightAtVenue, supportNorm,
    getFixtureBoxes, layout, getStrokeWidth,
  } = api;

  const root = new T.Group();
  root.name = 'insightLayers';
  scene.add(root);
  const gScreen = new T.Group();
  const gSpeak = new T.Group();
  const gListen = new T.Group();
  const gWave = new T.Group();
  const gRoi = new T.Group();
  const gSel = new T.Group();
  gSel.renderOrder = 30;
  const gProfit = new T.Group();
  const gMedia = new T.Group();
  const gCat = new T.Group();
  gCat.renderOrder = 46;
  root.add(gScreen, gSpeak, gListen, gWave, gRoi, gSel, gProfit, gMedia, gCat);

  let ac = {
    nx: 0, ny: 0, originX: 0, originZ: 0, blocked: null,
    dist: null, spl: null, listen: null, sezVis: null, polarHits: null,
  };
  let euro = null;
  let euroMax = 1;
  let roiStats = [];
  let catOf = null;
  let profitBasis = 'HEURISTIC';
  let liveByRoi = null;
  let liveMeta = {};
  let lastInsights = [];
  let selection = null;
  let draft = [];
  let wavePhase = 0;
  let waveMeshes = [];
  let profitParts = [];
  let mediaParts = [];
  let profitGeom = null, mediaGeom = null;
  let profitPos, profitCol, mediaPos, mediaCol;
  let profitCellPool = [];
  let pFrame = 0, mFrame = 0;

  function acToVenue(i, j) {
    return { x: ac.originX + i * AC_CELL, z: ac.originZ + j * AC_CELL };
  }
  function venueToAc(x, z) {
    return { i: (x - ac.originX) / AC_CELL, j: (z - ac.originZ) / AC_CELL };
  }

  function rebuildAcoustic() {
    const bb = layout.bbox;
    ac.originX = bb.minX;
    ac.originZ = bb.minZ;
    ac.nx = Math.ceil((bb.maxX - bb.minX) / AC_CELL) + 1;
    ac.ny = Math.ceil((bb.maxZ - bb.minZ) / AC_CELL) + 1;
    const N = ac.nx * ac.ny;
    ac.blocked = new Uint8Array(N);
    const boxes = getFixtureBoxes();
    for (const b of boxes) {
      const i0 = Math.max(0, Math.floor((b.minX - ac.originX) / AC_CELL));
      const i1 = Math.min(ac.nx - 1, Math.floor((b.maxX - ac.originX) / AC_CELL));
      const j0 = Math.max(0, Math.floor((b.minZ - ac.originZ) / AC_CELL));
      const j1 = Math.min(ac.ny - 1, Math.floor((b.maxZ - ac.originZ) / AC_CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) ac.blocked[j * ac.nx + i] = 1;
      }
    }
    const seeds = [];
    for (const s of pack.speakers) {
      const a = venueToAc(s.x, s.z);
      const i = Math.round(a.i), j = Math.round(a.j);
      if (i >= 0 && j >= 0 && i < ac.nx && j < ac.ny) seeds.push(j * ac.nx + i);
    }
    ac.dist = dijkstra8(ac.blocked, ac.nx, ac.ny, AC_CELL, seeds);
    ac.polarHits = pack.speakers.map((s) => polarHits(
      s.x, s.z, boxes, WAVE_PERIOD + 6,
    ));
    ac.spl = new Float32Array(N);
    ac.listen = new Uint8Array(N);

    const visFrom = (sx, sz) => {
      const vis = new Uint8Array(N);
      const a0 = venueToAc(sx, sz);
      const rays = 96, reach = Math.max(ac.nx, ac.ny);
      for (let r = 0; r < rays; r++) {
        const ang = (r / rays) * Math.PI * 2;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        let x = a0.i, y = a0.j;
        for (let s = 0; s < reach; s++) {
          x += dx; y += dy;
          const i = Math.round(x), j = Math.round(y);
          if (i < 0 || j < 0 || i >= ac.nx || j >= ac.ny) break;
          const k = j * ac.nx + i;
          if (ac.blocked[k]) break;
          vis[k] = 1;
        }
      }
      const si = Math.round(a0.i), sj = Math.round(a0.j);
      if (si >= 0 && sj >= 0 && si < ac.nx && sj < ac.ny) vis[sj * ac.nx + si] = 1;
      return vis;
    };

    const speakerVis = pack.speakers.map((s) => visFrom(s.x, s.z));
    for (let k = 0; k < N; k++) {
      if (ac.blocked[k]) { ac.spl[k] = -99; continue; }
      const i = k % ac.nx, j = (k / ac.nx) | 0;
      const p = acToVenue(i + 0.5, j + 0.5);
      let best = -99;
      for (let si = 0; si < pack.speakers.length; si++) {
        const s = pack.speakers[si];
        const dx = p.x - s.x, dz = p.z - s.z;
        const eu = Math.max(0.5, Math.hypot(dx, dz));
        const yaw = (s.yawDeg || 0) * Math.PI / 180;
        const align = (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / eu;
        let Lw = s.kind === 'promo' ? 88 : 92;
        if (s.kind === 'promo') Lw += (align - 1) * 3;
        let db = Lw - 20 * Math.log10(eu) - 11;
        if (!speakerVis[si][k]) db -= 10;
        if (db > best) best = db;
      }
      ac.spl[k] = best;
      ac.listen[k] = best >= LISTEN_DB ? 1 : 0;
    }

    ac.sezVis = new Uint8Array(N);
    for (const sc of pack.screens) {
      const poly = sc.sez.map((p) => [p.x, p.z]);
      const vis = visFrom(sc.x, sc.z);
      for (let j = 0; j < ac.ny; j++) {
        for (let i = 0; i < ac.nx; i++) {
          const p = acToVenue(i + 0.5, j + 0.5);
          if (!pointInPoly(p.x, p.z, poly)) continue;
          const k = j * ac.nx + i;
          if (!vis[k]) continue;
          ac.sezVis[k] = 1;
        }
      }
    }
  }

  function rebuildEuro() {
    const field = getField();
    const N = field.NX * field.NY;
    euro = new Float32Array(N);
    catOf = new Array(N);
    const dwellMax = field.scalars.dwell.max || 1;
    const live = liveByRoi || {};
    profitBasis = liveByRoi ? 'LIVE' : 'HEURISTIC';
    roiStats = [];
    const roiCells = pack.rois.map((roi) => {
      const cells = [];
      for (let k = 0; k < N; k++) {
        const i = k % field.NX, j = (k / field.NX) | 0;
        const p = gridToVenue(i + 0.5, j + 0.5);
        if (pointInPoly(p.x, p.z, roi.vertices)) cells.push(k);
      }
      return cells;
    });
    for (let r = 0; r < pack.rois.length; r++) {
      const roi = pack.rois[r];
      const cells = roiCells[r];
      if (!cells.length) continue;
      const liveHit = live[roi.id];
      let trafficSum = 0;
      let eng = 0, n = 0;
      for (const k of cells) {
        trafficSum += field.traffic[k] || 0;
        if (supportNorm(k) < 0.04) continue;
        eng += Math.min(1, (field.dwell[k] / dwellMax) * 0.85);
        n++;
        if (roi.category) catOf[k] = roi.category;
      }
      const engagement = n ? eng / n : 0;
      const gap = Math.max(0, 0.45 - engagement);
      let euroDay;
      const product = !!(roi.category && CATEGORY_MARGIN[roi.category] != null)
        && !/Checkout|Entrance|LiDAR|Coverage/i.test(roi.name || '');
      if (!product) {
        euroDay = 0;
      } else if (liveHit != null) {
        euroDay = liveHit;
        const per = liveHit / Math.max(1, cells.length);
        for (const k of cells) euro[k] += per;
      } else {
        const margin = CATEGORY_MARGIN[roi.category];
        const exposed = Math.max(20, trafficSum * 0.35);
        euroDay = exposed * gap * 0.12 * margin;
        const perCell = euroDay / Math.max(1, cells.length);
        for (const k of cells) euro[k] += perCell;
      }
      const meta = liveMeta[roi.id] || {};
      roiStats.push({
        roi,
        euroDay,
        engagement,
        gap,
        foot: trafficSum,
        area: roi.area_m2 || 0,
        m2: roi.area_m2 > 0.5 ? euroDay / roi.area_m2 : 0,
        lever: meta.lever || (gap > 0.2 ? 'Reposition / speed-bump' : 'Price / retail-media promo'),
      });
    }
    euroMax = 1e-6;
    for (let k = 0; k < N; k++) if (euro[k] > euroMax) euroMax = euro[k];
  }

  function cellInSel(vx, vz) {
    if (!selection?.vertices?.length) return true;
    return pointInPoly(vx, vz, selection.vertices);
  }

  function buildScreens() {
    clearGroup(gScreen);
    for (const sc of pack.screens) {
      const poly = sc.sez;
      const shape = new T.Shape();
      shape.moveTo(poly[0].x - sc.x, -(poly[0].z - sc.z));
      for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i].x - sc.x, -(poly[i].z - sc.z));
      shape.closePath();
      const h = sc.mountHeightM + 0.5;
      const geo = new T.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({
        color: 0x9333ea, transparent: true, opacity: 0.14, side: T.DoubleSide, depthWrite: false,
      }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(sc.x, 0.04, sc.z);
      gScreen.add(mesh);
      const edgePts = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        edgePts.push(a.x, 0.06, a.z, b.x, 0.06, b.z);
        edgePts.push(a.x, h, a.z, b.x, h, b.z);
        edgePts.push(a.x, 0.06, a.z, a.x, h, a.z);
      }
      const eg = new T.BufferGeometry();
      eg.setAttribute('position', new T.Float32BufferAttribute(edgePts, 3));
      gScreen.add(new T.LineSegments(eg, new T.LineBasicMaterial({
        color: 0xc084fc, transparent: true, opacity: 0.7, depthWrite: false,
      })));
      const yaw = sc.yawDeg * Math.PI / 180;
      const dirX = Math.sin(yaw), dirZ = Math.cos(yaw);
      const ax = sc.x, az = sc.z, ay = sc.mountHeightM;
      const arrow = new T.BufferGeometry();
      arrow.setAttribute('position', new T.Float32BufferAttribute([
        ax, ay, az, ax + dirX * 1.6, ay, az + dirZ * 1.6,
      ], 3));
      gScreen.add(new T.Line(arrow, new T.LineBasicMaterial({ color: 0xe9d5ff })));
      const pane = new T.Mesh(
        new T.PlaneGeometry(sc.widthM || 1.5, sc.heightM || 2),
        new T.MeshBasicMaterial({ color: 0x1e1b4b, transparent: true, opacity: 0.85, side: T.DoubleSide }),
      );
      pane.position.set(sc.x, sc.mountHeightM * 0.5, sc.z);
      pane.rotation.y = yaw;
      gScreen.add(pane);
    }
    gScreen.visible = !!params.showScreenFov;
  }

  function buildSpeakers() {
    clearGroup(gSpeak);
    const floorMat = new T.MeshBasicMaterial({
      color: 0x67e8f9, transparent: true, opacity: 0.8,
      depthWrite: false, depthTest: false, side: T.DoubleSide,
    });
    const ceilMat = new T.MeshBasicMaterial({
      color: 0xa5f3fc, transparent: true, opacity: 0.65,
      depthWrite: false, depthTest: false, side: T.DoubleSide,
    });
    for (const s of pack.speakers) {
      const promo = s.kind === 'promo';
      const floor = new T.Mesh(
        new T.RingGeometry(promo ? 0.07 : 0.05, promo ? 0.16 : 0.12, 24),
        floorMat,
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(s.x, WAVE_Y + 0.01, s.z);
      floor.renderOrder = 6;
      gSpeak.add(floor);
      const ceil = new T.Mesh(new T.CircleGeometry(promo ? 0.12 : 0.09, 14), ceilMat);
      ceil.rotation.x = -Math.PI / 2;
      ceil.position.set(s.x, s.y, s.z);
      ceil.renderOrder = 6;
      gSpeak.add(ceil);
    }
    gSpeak.visible = !!params.showSpeakers;
  }

  function buildListen() {
    clearGroup(gListen);
    if (!ac.listen) { gListen.visible = !!params.showSpeakers; return; }
    const pos = [];
    const idx = [];
    let n = 0;
    for (let j = 0; j < ac.ny - 1; j++) {
      for (let i = 0; i < ac.nx - 1; i++) {
        const k = j * ac.nx + i;
        if (ac.blocked[k] || ac.blocked[k + 1] || ac.blocked[k + ac.nx] || ac.blocked[k + ac.nx + 1]) continue;
        if (!ac.listen[k] && !ac.listen[k + 1] && !ac.listen[k + ac.nx] && !ac.listen[k + ac.nx + 1]) continue;
        const a = acToVenue(i, j), b = acToVenue(i + 1, j);
        const c = acToVenue(i, j + 1), d = acToVenue(i + 1, j + 1);
        const y = WAVE_Y - 0.05;
        const base = n;
        pos.push(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z, d.x, y, d.z);
        idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        n += 4;
      }
    }
    if (pos.length) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      const mesh = new T.Mesh(g, new T.MeshBasicMaterial({
        color: 0x22d3ee, transparent: true, opacity: 0.07,
        depthWrite: false, depthTest: false, side: T.DoubleSide,
      }));
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      gListen.add(mesh);
    }
    gListen.visible = !!params.showSpeakers;
  }

  function buildWaves() {
    clearGroup(gWave);
    waveMeshes = [];
    const cols = [0xecfeff, 0xa5f3fc, 0x67e8f9, 0x22d3ee];
    for (let w = 0; w < WAVE_N; w++) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(new Float32Array(WAVE_MAX), 3));
      g.setDrawRange(0, 0);
      const mesh = new T.LineSegments(g, new T.LineBasicMaterial({
        color: cols[w % cols.length],
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        depthTest: false,
      }));
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      gWave.add(mesh);
      waveMeshes.push(mesh);
    }
    gWave.visible = !!params.showSpeakers;
  }

  function buildRois() {
    clearGroup(gRoi);
    const pts = [];
    for (const roi of pack.rois) {
      if (!roi.category && !/Checkout|Entrance/i.test(roi.name)) continue;
      const vs = roi.vertices;
      const y = 0.14;
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i], b = vs[(i + 1) % vs.length];
        pts.push(a[0], y, a[1], b[0], y, b[1]);
      }
    }
    if (pts.length) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      gRoi.add(new T.LineSegments(g, new T.LineBasicMaterial({
        color: 0x64748b, transparent: true, opacity: 0.35, depthWrite: false,
      })));
    }
    gRoi.visible = true;
  }

  function roiCentroid(roi) {
    if (Number.isFinite(roi.cx) && Number.isFinite(roi.cz)) return { x: roi.cx, z: roi.cz };
    const vs = roi.vertices || [];
    if (!vs.length) return null;
    return {
      x: vs.reduce((s, p) => s + p[0], 0) / vs.length,
      z: vs.reduce((s, p) => s + p[1], 0) / vs.length,
    };
  }

  function nearbyCategorised(sel) {
    const origin = roiCentroid(sel) || (sel.vertices?.length ? {
      x: sel.vertices.reduce((s, p) => s + p[0], 0) / sel.vertices.length,
      z: sel.vertices.reduce((s, p) => s + p[1], 0) / sel.vertices.length,
    } : null);
    if (!origin) return [];
    const NEAR = 16;
    const out = [];
    for (const roi of pack.rois) {
      if (!roi.category) continue;
      if (roi.id && sel.id && roi.id === sel.id) continue;
      if ((roi.area_m2 || 0) > 400) continue;
      const c = roiCentroid(roi);
      if (!c) continue;
      const d = Math.hypot(c.x - origin.x, c.z - origin.z);
      const sameShelf = sel.shelf_id && roi.shelf_id && roi.shelf_id === sel.shelf_id;
      if (!sameShelf && d > NEAR) continue;
      out.push({ roi, d, sameShelf });
    }
    out.sort((a, b) => (b.sameShelf - a.sameShelf) || a.d - b.d);
    return out.slice(0, 12);
  }

  function addCategorySprite(roi, selected) {
    const c = roiCentroid(roi);
    if (!c) return;
    const y = (terrainHeightAtVenue ? terrainHeightAtVenue(c.x, c.z) : 0) + (selected ? 2.35 : 1.85);
    const tex = categoryBadgeTexture(T, roi.category, selected);
    const mat = new T.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false,
      sizeAttenuation: true,
    });
    const spr = new T.Sprite(mat);
    const w = selected ? 3.4 : 2.45;
    spr.scale.set(w, w * (176 / 160), 1);
    spr.position.set(c.x, y, c.z);
    spr.renderOrder = selected ? 48 : 47;
    spr.userData.roiId = roi.id;
    gCat.add(spr);
  }

  function addCategoryOutline(roi, colorHex, opacity) {
    const vs = roi.vertices;
    if (!vs?.length) return;
    const pts = [];
    const y = 0.24;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i], b = vs[(i + 1) % vs.length];
      pts.push(a[0], y, a[1], b[0], y, b[1]);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
    const line = new T.LineSegments(g, new T.LineBasicMaterial({
      color: colorHex, transparent: true, opacity, depthWrite: false, depthTest: false,
    }));
    line.renderOrder = 44;
    gCat.add(line);
  }

  function buildCategoryMarks(sel) {
    clearGroup(gCat);
    if (!sel?.vertices?.length) return;
    if (/Checkout|Cassa|Self-?check|Self-?scan/i.test(sel.name || '')) return;
    const vis = categoryVisual(sel.category);
    if (sel.category) {
      addCategoryOutline(sel, vis.color, 0.95);
      addCategorySprite(sel, true);
    }
    for (const { roi } of nearbyCategorised(sel)) {
      const v = categoryVisual(roi.category);
      addCategoryOutline(roi, v.color, 0.72);
      addCategorySprite(roi, false);
    }
  }

  function setSelection(sel, opts = {}) {
    selection = sel;
    draft = [];
    clearGroup(gSel);
    if (params.showProfit && !opts.skipProfit) buildProfit();
    if (!sel?.vertices?.length) {
      clearGroup(gCat);
      return;
    }
    const vs = sel.vertices;
    const width = getStrokeWidth ? getStrokeWidth() : 0.2;
    addZoneStroke(gSel, T, vs, { closed: true, y: 0.28, width });
    const vis = categoryVisual(sel.category);
    const shape = new T.Shape();
    shape.moveTo(vs[0][0], -vs[0][1]);
    for (let i = 1; i < vs.length; i++) shape.lineTo(vs[i][0], -vs[i][1]);
    shape.closePath();
    const fill = new T.Mesh(
      new T.ShapeGeometry(shape),
      new T.MeshBasicMaterial({
        color: vis.color, transparent: true, opacity: 0.08,
        side: T.DoubleSide, depthWrite: false, depthTest: false,
      }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.05;
    gSel.add(fill);
    buildCategoryMarks(sel);
  }

  function setDraft(verts, preview = null) {
    draft = verts;
    if (selection) return;
    clearGroup(gSel);
    if (verts.length < 1 && !preview) return;
    const width = getStrokeWidth ? getStrokeWidth() : 0.2;
    addZoneStroke(gSel, T, verts, {
      closed: false, y: 0.32, width,
      hotIndex: preview?.close ? 0 : -1,
    });
    if (preview && verts.length) {
      const last = verts[verts.length - 1];
      addZoneStroke(gSel, T, [last, [preview.x, preview.z]], {
        closed: false, y: 0.34, preview: true, width,
        hotIndex: preview.close ? 1 : -1,
      });
    }
  }

  function pickRoi(x, z) {
    let best = null, bestA = Infinity;
    for (const roi of pack.rois) {
      if (!pointInPoly(x, z, roi.vertices)) continue;
      if (roi.area_m2 < bestA) { bestA = roi.area_m2; best = roi; }
    }
    return best;
  }

  function collectProfitCells() {
    const field = getField();
    if (!euro) return [];
    const N = field.NX * field.NY;
    const hot = [];
    const any = [];
    const thresh = euroMax * 0.05;
    for (let k = 0; k < N; k++) {
      const i = k % field.NX, j = (k / field.NX) | 0;
      const v = gridToVenue(i + 0.5, j + 0.5);
      if (!cellInSel(v.x, v.z)) continue;
      if (!(euro[k] > 0) || !catOf[k]) continue;
      any.push({ k, i, j, w: euro[k] });
      if (euro[k] >= thresh) hot.push({ k, i, j, w: Math.pow(euro[k], 1.45) });
    }
    return hot.length ? hot : any;
  }

  function pickProfitCell(pool) {
    let tot = 0;
    for (const c of pool) tot += c.w;
    let r = Math.random() * tot;
    for (const c of pool) {
      r -= c.w;
      if (r <= 0) return c;
    }
    return pool[pool.length - 1];
  }

  function spawnProfit(p) {
    const field = getField();
    const pool = profitCellPool;
    if (pool.length) {
      const c = pickProfitCell(pool);
      const x = c.i + Math.random();
      const y = c.j + Math.random();
      const v = gridToVenue(x, y);
      const e = Math.max(0.22, euro[c.k] / euroMax);
      p.x = x; p.y = y; p.e = e;
      p.h = 0.12 + Math.random() * 0.55;
      p.vz = 1.15 + e * 3.6;
      p.age = 0;
      p.life = 50 + Math.random() * 90;
      p.hist = p.hist || new Float32Array(PROFIT_TRAIL * 3);
      const hy = terrainHeightAt(p.x, p.y) + p.h;
      for (let i = 0; i < PROFIT_TRAIL; i++) { p.hist[i * 3] = v.x; p.hist[i * 3 + 1] = hy; p.hist[i * 3 + 2] = v.z; }
      return p;
    }
    for (let t = 0; t < 40; t++) {
      const s = field.randomSpawn();
      const k = field.idx(Math.floor(s.x), Math.floor(s.y));
      const v = gridToVenue(s.x, s.y);
      if (!cellInSel(v.x, v.z)) continue;
      const e = euro ? euro[k] / euroMax : 0;
      if (e < 0.08 && Math.random() > 0.08) continue;
      p.x = s.x; p.y = s.y; p.e = Math.max(0.15, e);
      p.h = 0.2 + Math.random() * 0.3;
      p.vz = 0.7 + p.e * 2.4;
      p.age = 0;
      p.life = 45 + Math.random() * 80;
      p.hist = p.hist || new Float32Array(PROFIT_TRAIL * 3);
      const hy = terrainHeightAt(p.x, p.y) + p.h;
      for (let i = 0; i < PROFIT_TRAIL; i++) { p.hist[i * 3] = v.x; p.hist[i * 3 + 1] = hy; p.hist[i * 3 + 2] = v.z; }
      return p;
    }
    p.x = 0; p.y = 0; p.e = 0; p.h = 0; p.age = 999; p.hist = p.hist || new Float32Array(PROFIT_TRAIL * 3);
    return p;
  }

  function spawnMedia(p) {
    const field = getField();
    const targets = pack.rois.filter((r) => r.category && (
      pack.screens.some((s) => (s.targetCategories || []).includes(r.category))
      || pack.speakers.some((s) => (s.targetCategories || []).includes(r.category))
    ));
    for (let t = 0; t < 50; t++) {
      const s = field.randomSpawn();
      const v = gridToVenue(s.x, s.y);
      if (!cellInSel(v.x, v.z)) continue;
      const a = venueToAc(v.x, v.z);
      const i = Math.floor(a.i), j = Math.floor(a.j);
      if (i < 0 || j < 0 || i >= ac.nx || j >= ac.ny) continue;
      const ak = j * ac.nx + i;
      if (!ac.sezVis[ak] && !ac.listen[ak]) continue;
      p.x = s.x; p.y = s.y;
      p.age = 0; p.life = 70 + Math.random() * 90;
      const tgt = targets[Math.floor(Math.random() * Math.max(1, targets.length))] || pack.rois[0];
      p.tx = tgt.cx; p.tz = tgt.cz;
      p.hist = p.hist || new Float32Array(MEDIA_TRAIL * 3);
      const y = terrainHeightAt(p.x, p.y) + 0.28;
      for (let n = 0; n < MEDIA_TRAIL; n++) { p.hist[n * 3] = v.x; p.hist[n * 3 + 1] = y; p.hist[n * 3 + 2] = v.z; }
      return p;
    }
    p.age = 999; p.hist = p.hist || new Float32Array(MEDIA_TRAIL * 3);
    return p;
  }

  function buildProfit() {
    clearGroup(gProfit);
    profitCellPool = collectProfitCells();
    profitParts = new Array(PROFIT_N);
    for (let i = 0; i < PROFIT_N; i++) profitParts[i] = spawnProfit({});
    const segs = PROFIT_TRAIL - 1;
    profitPos = new Float32Array(PROFIT_N * segs * 2 * 3);
    profitCol = new Float32Array(PROFIT_N * segs * 2 * 3);
    profitGeom = new T.BufferGeometry();
    profitGeom.setAttribute('position', new T.BufferAttribute(profitPos, 3));
    profitGeom.setAttribute('color', new T.BufferAttribute(profitCol, 3));
    const mesh = new T.LineSegments(profitGeom, new T.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false,
    }));
    mesh.frustumCulled = false;
    gProfit.add(mesh);
    gProfit.visible = !!params.showProfit;
  }

  function buildMedia() {
    clearGroup(gMedia);
    mediaParts = new Array(MEDIA_N);
    for (let i = 0; i < MEDIA_N; i++) mediaParts[i] = spawnMedia({});
    const segs = MEDIA_TRAIL - 1;
    mediaPos = new Float32Array(MEDIA_N * segs * 2 * 3);
    mediaCol = new Float32Array(MEDIA_N * segs * 2 * 3);
    mediaGeom = new T.BufferGeometry();
    mediaGeom.setAttribute('position', new T.BufferAttribute(mediaPos, 3));
    mediaGeom.setAttribute('color', new T.BufferAttribute(mediaCol, 3));
    const mat = new T.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: T.AdditiveBlending, depthWrite: false,
    });
    const mesh = new T.LineSegments(mediaGeom, mat);
    mesh.frustumCulled = false;
    gMedia.add(mesh);
    const ribbon = new T.LineSegments(mediaGeom, mat);
    ribbon.frustumCulled = false;
    ribbon.position.y = 0.08;
    gMedia.add(ribbon);
    gMedia.visible = !!params.showMedia;
  }

  function stepProfit(dt) {
    if (!params.showProfit || !profitGeom) return;
    const push = (pFrame++ % 2) === 0;
    for (let i = 0; i < profitParts.length; i++) {
      const p = profitParts[i];
      if (p.age > p.life || p.h > 14) { spawnProfit(p); continue; }
      p.h += p.vz * dt;
      p.age += dt * 60;
      if (push) {
        p.hist.copyWithin(3, 0, (PROFIT_TRAIL - 1) * 3);
        const v = gridToVenue(p.x, p.y);
        p.hist[0] = v.x; p.hist[1] = terrainHeightAt(p.x, p.y) + p.h; p.hist[2] = v.z;
      }
    }
    if (!push) return;
    const segs = PROFIT_TRAIL - 1;
    for (let i = 0; i < profitParts.length; i++) {
      const p = profitParts[i];
      for (let t = 0; t < segs; t++) {
        const fade = Math.pow(1 - t / segs, 1.05) * Math.max(0.12, 1 - p.h / 16);
        const o = ((i * segs + t) * 2) * 3;
        profitPos[o] = p.hist[t * 3]; profitPos[o + 1] = p.hist[t * 3 + 1]; profitPos[o + 2] = p.hist[t * 3 + 2];
        profitPos[o + 3] = p.hist[(t + 1) * 3]; profitPos[o + 4] = p.hist[(t + 1) * 3 + 1]; profitPos[o + 5] = p.hist[(t + 1) * 3 + 2];
        const r = 1.0 * fade, g = (0.68 + 0.28 * p.e) * fade, b = 0.06 * fade;
        profitCol[o] = r; profitCol[o + 1] = g; profitCol[o + 2] = b;
        profitCol[o + 3] = r; profitCol[o + 4] = g; profitCol[o + 5] = b;
      }
    }
    profitGeom.attributes.position.needsUpdate = true;
    profitGeom.attributes.color.needsUpdate = true;
  }

  function stepMedia(dt) {
    if (!params.showMedia || !mediaGeom) return;
    const field = getField();
    const cell = field.meta.cell_m;
    const push = (mFrame++ % 2) === 0;
    for (let i = 0; i < mediaParts.length; i++) {
      const p = mediaParts[i];
      if (p.age > p.life) { spawnMedia(p); continue; }
      const v = gridToVenue(p.x, p.y);
      const dx = p.tx - v.x, dz = p.tz - v.z;
      const dm = Math.hypot(dx, dz) || 1;
      const k = field.idx(
        Math.max(0, Math.min(field.NX - 1, Math.floor(p.x))),
        Math.max(0, Math.min(field.NY - 1, Math.floor(p.y))),
      );
      const mx = field.meanX[k], my = field.meanY[k];
      const mag = Math.hypot(mx, my) || 1;
      const seekX = dx / dm, seekZ = dz / dm;
      const gSeek = venueToGrid(v.x + seekX, v.z + seekZ);
      const vx = 0.45 * (mx / mag) + 0.55 * (gSeek.x - p.x);
      const vy = 0.45 * (my / mag) + 0.55 * (gSeek.y - p.y);
      const vm = Math.hypot(vx, vy) || 1;
      p.x += (vx / vm) * 0.85 * (dt * params.timeScale) / cell;
      p.y += (vy / vm) * 0.85 * (dt * params.timeScale) / cell;
      p.age += dt * 60;
      if (dm < 1.4) spawnMedia(p);
      if (push) {
        p.hist.copyWithin(3, 0, (MEDIA_TRAIL - 1) * 3);
        const nv = gridToVenue(p.x, p.y);
        p.hist[0] = nv.x; p.hist[1] = terrainHeightAt(p.x, p.y) + 0.28; p.hist[2] = nv.z;
      }
    }
    if (!push) return;
    const segs = MEDIA_TRAIL - 1;
    for (let i = 0; i < mediaParts.length; i++) {
      const p = mediaParts[i];
      for (let t = 0; t < segs; t++) {
        const fade = Math.pow(1 - t / segs, 1.25);
        const o = ((i * segs + t) * 2) * 3;
        mediaPos[o] = p.hist[t * 3]; mediaPos[o + 1] = p.hist[t * 3 + 1]; mediaPos[o + 2] = p.hist[t * 3 + 2];
        mediaPos[o + 3] = p.hist[(t + 1) * 3]; mediaPos[o + 4] = p.hist[(t + 1) * 3 + 1]; mediaPos[o + 5] = p.hist[(t + 1) * 3 + 2];
        const r = 1.0 * fade, g = 0.28 * fade, b = 0.95 * fade;
        mediaCol[o] = r; mediaCol[o + 1] = g; mediaCol[o + 2] = b;
        mediaCol[o + 3] = r; mediaCol[o + 4] = g; mediaCol[o + 5] = b;
      }
    }
    mediaGeom.attributes.position.needsUpdate = true;
    mediaGeom.attributes.color.needsUpdate = true;
  }

  function stepWaves(dt) {
    if (!params.showSpeakers || !ac.polarHits || !waveMeshes.length) {
      gWave.visible = false;
      return;
    }
    gWave.visible = true;
    wavePhase += dt * WAVE_SPEED;
    const y = WAVE_Y;
    for (let w = 0; w < WAVE_N; w++) {
      const radius = ((wavePhase + w * (WAVE_PERIOD / WAVE_N)) % WAVE_PERIOD) + 0.6;
      const mesh = waveMeshes[w];
      const arr = mesh.geometry.attributes.position.array;
      let n = 0;
      const max = arr.length;
      for (let si = 0; si < pack.speakers.length; si++) {
        const s = pack.speakers[si];
        const hits = ac.polarHits[si];
        if (!hits) continue;
        for (let r = 0; r < RING_RAYS; r++) {
          const r1 = (r + 1) % RING_RAYS;
          if (hits[r] < radius || hits[r1] < radius) continue;
          if (n + 6 > max) break;
          const a0 = (r / RING_RAYS) * Math.PI * 2;
          const a1 = (r1 / RING_RAYS) * Math.PI * 2;
          arr[n++] = s.x + Math.cos(a0) * radius;
          arr[n++] = y;
          arr[n++] = s.z + Math.sin(a0) * radius;
          arr[n++] = s.x + Math.cos(a1) * radius;
          arr[n++] = y;
          arr[n++] = s.z + Math.sin(a1) * radius;
        }
      }
      if (n < arr.length) arr.fill(0, n);
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.setDrawRange(0, Math.floor(n / 3));
      const fade = Math.max(0.18, 1 - (radius / (WAVE_PERIOD + 0.6)));
      mesh.material.opacity = 0.28 + 0.5 * fade;
    }
  }

  function applyVisibility() {
    gScreen.visible = !!params.showScreenFov;
    gSpeak.visible = !!params.showSpeakers;
    gListen.visible = !!params.showSpeakers;
    gWave.visible = !!params.showSpeakers;
    gProfit.visible = !!params.showProfit;
    gMedia.visible = !!params.showMedia;
  }

  function inspect(sel = selection) {
    const field = getField();
    const verts = sel?.vertices;
    const area = verts ? shoelace(verts) : 0;
    const dwellMax = field.scalars?.dwell?.max || 1;
    let foot = 0, dwell = 0, speed = 0, n = 0, euroSum = 0, listenN = 0, sezN = 0, cells = 0, engSum = 0;
    const cats = {};
    if (verts) {
      for (let k = 0; k < field.NX * field.NY; k++) {
        const i = k % field.NX, j = (k / field.NX) | 0;
        const p = gridToVenue(i + 0.5, j + 0.5);
        if (!pointInPoly(p.x, p.z, verts)) continue;
        cells++;
        if (supportNorm(k) > 0.04) {
          foot += field.traffic[k];
          dwell += field.dwell[k];
          speed += field.speed[k];
          engSum += Math.min(1, (field.dwell[k] / dwellMax) * 0.85);
          n++;
        }
        euroSum += euro ? euro[k] : 0;
        if (catOf?.[k]) cats[catOf[k]] = (cats[catOf[k]] || 0) + 1;
        const a = venueToAc(p.x, p.z);
        const ai = Math.floor(a.i), aj = Math.floor(a.j);
        if (ai >= 0 && aj >= 0 && ai < ac.nx && aj < ac.ny) {
          if (ac.listen[aj * ac.nx + ai]) listenN++;
          if (ac.sezVis[aj * ac.nx + ai]) sezN++;
        }
      }
    }
    const screensHit = pack.screens.filter((s) => verts && s.sez.some((p) => pointInPoly(p.x, p.z, verts)
      || pointInPoly(s.x, s.z, verts)));
    const speakersHit = pack.speakers.filter((s) => verts && pointInPoly(s.x, s.z, verts));
    const pExp = cells ? sezN / cells : 0;
    const pCtl = cells ? Math.max(0.02, 1 - pExp) * 0.22 : 0.22;
    const pActExp = pExp * 0.38;
    const pActCtl = 0.22;
    const eal = pActCtl > 0 ? (pActExp - pActCtl) / pActCtl : 0;
    const ces = Math.max(0, Math.min(1, 0.45 * Math.max(0, eal) + 0.35 * pExp + 0.2 * (listenN / Math.max(1, cells))));
    const st = sel?.id ? roiStats.find((s) => s.roi.id === sel.id) : null;
    const engagement = st?.engagement ?? (n ? engSum / n : 0);
    return {
      selection: sel,
      name: sel?.name || 'Zone',
      area,
      cells,
      footfall: foot,
      dwell: n ? dwell / n : 0,
      speed: n ? speed / n : 0,
      euroDay: st?.euroDay != null ? st.euroDay : euroSum,
      euroM2: st?.m2 != null ? st.m2 : (area > 0.5 ? euroSum / area : 0),
      engagement,
      cats,
      profitBasis: (sel?.id && liveByRoi && liveByRoi[sel.id] != null) ? 'LIVE' : 'HEURISTIC',
      screensHit,
      speakersHit,
      listenPct: cells ? listenN / cells : 0,
      sezPct: cells ? sezN / cells : 0,
      eal,
      ces,
      pebleBadge: pack.badges.peble,
    };
  }

  function tintCell(k) {
    if (!params.showCategory || !catOf) return null;
    const c = catOf[k];
    if (!c || !CATEGORY_HSL[c]) return null;
    return CATEGORY_HSL[c];
  }

  function selectionMask(k) {
    if (!selection?.vertices) return 1;
    const field = getField();
    const i = k % field.NX, j = (k / field.NX) | 0;
    const p = gridToVenue(i + 0.5, j + 0.5);
    return pointInPoly(p.x, p.z, selection.vertices) ? 1 : 0.22;
  }

  function euroAt(k) {
    return euro ? euro[k] : 0;
  }

  function tickerFacts(sliceLabel) {
    const field = getField();
    const cell = field.meta.cell_m;
    const skipName = /Checkout|Entrance|LiDAR/i;
    const product = roiStats.filter((s) => s.roi.category && !skipName.test(s.roi.name));
    const euroTotal = roiStats
      .filter((s) => !skipName.test(s.roi.name))
      .reduce((a, s) => a + s.euroDay, 0);
    const areaMeas = (() => {
      let n = 0;
      for (let k = 0; k < field.NX * field.NY; k++) if (supportNorm(k) > 0.04) n++;
      return n * cell * cell;
    })();
    const hottest = product.slice().sort((a, b) => b.m2 - a.m2)[0] || product[0];
    const trap = product.slice().sort((a, b) => b.gap - a.gap || b.foot - a.foot)[0] || product[0];
    const move = recommendMove();

    let totFoot = 0, sezFoot = 0;
    for (let k = 0; k < field.NX * field.NY; k++) {
      if (supportNorm(k) < 0.04) continue;
      const t = field.traffic[k] || 0;
      totFoot += t;
      const i = k % field.NX, j = (k / field.NX) | 0;
      const p = gridToVenue(i + 0.5, j + 0.5);
      const a = venueToAc(p.x, p.z);
      const ai = Math.floor(a.i), aj = Math.floor(a.j);
      if (ai >= 0 && aj >= 0 && ai < ac.nx && aj < ac.ny && ac.sezVis?.[aj * ac.nx + ai]) sezFoot += t;
    }
    const sezShare = totFoot > 0 ? sezFoot / totFoot : 0;
    const blind = Math.max(0, 1 - sezShare);
    const pActExp = sezShare * 0.38;
    const pActCtl = 0.22;
    const eal = pActCtl > 0 ? (pActExp - pActCtl) / pActCtl : 0;
    const targets = [...new Set(pack.screens.flatMap((s) => s.targetCategories || []))];
    const targetCat = product.filter((s) => targets.includes(s.roi.category))
      .sort((a, b) => b.euroDay - a.euroDay)[0]?.roi.category || targets[0] || 'Pesce';
    const badge = profitBasis;
    const window = sliceLabel || 'All trading hours (7–22)';
    const euro = (n) => `\u20ac${Math.round(Math.max(0, n)).toLocaleString()}`;
    const pct = (n) => `${Math.round(n * 100)}%`;

    return [
      {
        id: 'recoverable',
        kicker: 'RECOVERABLE',
        tone: 'gold',
        text: `${window} \u00b7 ${euro(euroTotal)} margin still on the floor \u00b7 ${euro(areaMeas > 1 ? euroTotal / areaMeas : 0)} / m\u00b2`,
        badge,
        roiId: hottest?.roi.id,
        layers: { profit: true },
        fly: 'home',
      },
      {
        id: 'hottest',
        kicker: 'HOTTEST m\u00b2',
        tone: 'amber',
        text: `${(hottest?.roi.category || 'ZONE').toUpperCase()} \u00b7 ${hottest?.roi.name || ''} \u00b7 ${euro(hottest?.m2 || 0)} / m\u00b2 hidden \u00b7 ${pct(hottest?.engagement || 0)} engagement vs 45% healthy`,
        badge,
        roiId: hottest?.roi.id,
        layers: { category: true, profit: true },
        camera: 'rise',
      },
      {
        id: 'trap',
        kicker: 'ENGAGEMENT TRAP',
        tone: 'rose',
        text: `${(trap?.roi.category || '').toUpperCase()} \u00b7 ${trap?.roi.name || ''} \u00b7 ${Math.round(trap?.foot || 0).toLocaleString()} visitors \u00b7 ${pct(trap?.engagement || 0)} stop \u00b7 ${trap?.lever || 'layout / speed-bump'} is the lever`,
        badge,
        roiId: trap?.roi.id,
        layers: { category: true },
      },
      {
        id: 'eal',
        kicker: 'PEBLE',
        tone: 'cyan',
        text: `Post-Exposure Behavioral Lift Engine \u00b7 Exposure-to-Action Lift ${eal >= 0 ? '+' : ''}${pct(eal)} on ${targetCat} after in-store screens`,
        badge: 'SIMULATED',
        roiId: pack.screens[0]?.id,
        fly: 'screen',
        layers: { screen: true, media: true },
      },
      {
        id: 'blind',
        kicker: 'MEDIA-BLIND',
        tone: 'violet',
        text: `${pct(blind)} of this window\u2019s traffic never entered a Screen Exposure Zone \u00b7 ${pack.screens.length} displays \u00b7 15 m cones`,
        badge: 'GEOMETRY FROM FIXTURE',
        roiId: pack.screens[0]?.id,
        fly: 'home',
        layers: { screen: true, speakers: true },
      },
      {
        id: 'move',
        kicker: 'ONE MOVE',
        tone: 'mint',
        text: `${move?.lever || 'Reposition'} \u00b7 ${move?.name || ''} \u00b7 expected ${euro(move?.euroDay || 0)} / day \u00b7 ${euro(move?.euroYear || 0)} / year`,
        badge,
        roiId: move?.roi.id,
        layers: { category: true, profit: true },
        camera: 'rise',
      },
    ];
  }

  function recommendMove() {
    const skipName = /Checkout|Entrance|LiDAR/i;
    const product = roiStats.filter((s) => s.roi.category && !skipName.test(s.roi.name));
    const bays = product.filter((s) => s.area >= 0.8 && s.area <= 80 && s.euroDay > 1);
    const pool = bays.length ? bays : product.filter((s) => s.euroDay > 0);
    const move = pool.slice().sort((a, b) => b.euroDay - a.euroDay || b.m2 - a.m2)[0] || product[0] || null;
    if (!move) return null;
    return {
      roi: move.roi,
      name: move.roi.name || 'Selected bay',
      category: move.roi.category || '',
      euroDay: move.euroDay,
      euroYear: move.euroDay * 365,
      engagement: move.engagement,
      gap: move.gap,
      foot: move.foot,
      m2: move.m2,
      lever: move.lever,
      badge: profitBasis,
    };
  }

  function storyTargets() {
    const facts = tickerFacts();
    const trap = facts.find((b) => b.id === 'trap');
    const move = recommendMove();
    return {
      trap: pack.rois.find((r) => r.id === trap?.roiId) || null,
      move: move?.roi || pack.rois.find((r) => r.id === facts.find((b) => b.id === 'move')?.roiId) || null,
      screen: pack.screens[0] || null,
    };
  }

  function rebuild() {
    rebuildAcoustic();
    rebuildEuro();
    buildScreens();
    buildSpeakers();
    buildListen();
    buildWaves();
    buildRois();
    buildProfit();
    buildMedia();
    if (selection) setSelection(selection);
    applyVisibility();
  }

  async function tryLiveProfit() {
    try {
      const r = await fetch('/api/profit-radar/insights', { credentials: 'include' });
      if (!r.ok) return;
      const data = await r.json();
      lastInsights = data.insights || [];
      const map = {};
      const meta = {};
      for (const ins of lastInsights) {
        const id = ins.dataBasis?.roiId;
        const rng = ins.economics?.range;
        const v = rng?.expected ?? rng?.likely
          ?? (Number.isFinite(rng?.conservative) && Number.isFinite(rng?.aggressive)
            ? (rng.conservative + rng.aggressive) / 2
            : null)
          ?? ins.impact?.max;
        if (id && v != null) map[id] = Number(v) || 0;
        if (id) {
          meta[id] = {
            lever: ins.economics?.recommendedLeverLabel || ins.suggestedFix?.slice(0, 48),
            engagement: ins.dataBasis?.engagement,
          };
        }
      }
      if (Object.keys(map).length) {
        liveByRoi = map;
        liveMeta = meta;
        rebuildEuro();
        if (params.showProfit) buildProfit();
      }
    } catch {
      /* iframe may be unauthenticated */
    }
  }

  function getSelection() { return selection; }
  function getDraft() { return draft; }
  function selectionCenter() {
    const vs = selection?.vertices;
    if (!vs?.length) return null;
    const cx = vs.reduce((s, p) => s + p[0], 0) / vs.length;
    const cz = vs.reduce((s, p) => s + p[1], 0) / vs.length;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of vs) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
    }
    return { cx, cz, span: Math.max(maxX - minX, maxZ - minZ, 8), dx: maxX - minX, dz: maxZ - minZ };
  }

  function step(dt) {
    if (!params.paused) {
      stepProfit(dt);
      stepMedia(dt);
      stepWaves(dt);
    }
  }

  return {
    rebuild, step, applyVisibility, tryLiveProfit,
    setSelection, setDraft, pickRoi, inspect,
    getSelection, getDraft, selectionCenter, clearSelection: () => setSelection(null),
    tintCell, selectionMask, euroAt, profitBasis: () => profitBasis,
    tickerFacts, storyTargets, recommendMove,
    rebuildProfit: () => buildProfit(),
    pack,
    roiStatFor(sel) {
      if (!sel?.id) return null;
      return roiStats.find((s) => s.roi.id === sel.id) || null;
    },
    advertisedRoi() {
      const cats = new Set();
      for (const s of pack.screens) for (const c of (s.targetCategories || [])) cats.add(c);
      return pack.rois.find((r) => r.category && cats.has(r.category)) || null;
    },
    inScreenCone(x, z) {
      return pack.screens.some((s) => s.sez?.length && pointInPoly(x, z, s.sez.map((p) => [p.x, p.z])));
    },
    screenSezVerts() {
      const s = pack.screens[0];
      return s?.sez?.length ? s.sez.map((p) => [p.x, p.z]) : null;
    },
    liveInsights: () => lastInsights,
    rudderMetrics() {
      const bay = this.advertisedRoi();
      if (!bay?.vertices) return null;
      const field = getField();
      let bayFoot = 0, baySpd = 0, bayN = 0, toward = 0, nHead = 0;
      let allFoot = 0, allSpd = 0, allN = 0;
      for (let k = 0; k < field.NX * field.NY; k++) {
        if (supportNorm(k) < 0.04) continue;
        allFoot += field.traffic[k];
        allSpd += field.speed[k];
        allN++;
        const i = k % field.NX, j = (k / field.NX) | 0;
        const p = gridToVenue(i + 0.5, j + 0.5);
        if (!pointInPoly(p.x, p.z, bay.vertices)) continue;
        bayFoot += field.traffic[k];
        baySpd += field.speed[k];
        bayN++;
        const dx = bay.cx - p.x, dz = bay.cz - p.z;
        const dm = Math.hypot(dx, dz) || 1;
        const mx = field.meanX[k], my = field.meanY[k];
        const mag = Math.hypot(mx, my);
        if (mag < 1e-4) continue;
        const g = venueToGrid(p.x + dx / dm, p.z + dz / dm);
        const tx = g.x - (i + 0.5), ty = g.y - (j + 0.5);
        const tm = Math.hypot(tx, ty) || 1;
        toward += (mx * tx + my * ty) / (mag * tm);
        nHead++;
      }
      const meanAllF = allN ? allFoot / allN : 1;
      const meanAllS = allN ? allSpd / allN : 1;
      return {
        bay,
        heading: nHead ? toward / nHead : 0,
        dSpeed: meanAllS ? ((bayN ? baySpd / bayN : 0) / meanAllS) - 1 : 0,
        dDens: meanAllF ? ((bayN ? bayFoot / bayN : 0) / meanAllF) - 1 : 0,
      };
    },
  };
}
