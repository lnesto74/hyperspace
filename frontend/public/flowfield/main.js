import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
// Dynamic, cache-busted: the field module is edited alongside the extractor and
// the browser otherwise pins the first version it saw for the whole session.
const bust = `?t=${Date.now()}`;
const {
  loadField,
  heatRamp,
  regimeRamp,
  REGIME_CATEGORIES,
  cellMapFromFieldJson,
  attachShiftScalar,
  boostOutliersWithPurityBreak,
} = await import('./field.js' + bust);
const { createLayerEngine, CATEGORY_HSL, pointInPoly, categoryVisual } = await import('./layers.js' + bust);
const { initDrilldown } = await import('./drilldown.js' + bust);

const params = {
  scalar: 'dwell',
  terrainHeight: 6.0,
  // Tuned as a density, not a count: the production field covers roughly three
  // times the floor the capture did, so the number that read as legible over the
  // old patch reads as empty here.
  particles: 2400,
  trail: 18,
  timeScale: 12.0,   // time compression — real walking speed makes trails too short to read
  kappa: 2.8,        // how strongly a particle sticks to its current heading
  inertia: 0.82,     // heading smoothing
  dwellDrag: true,   // slow particles down in high-dwell cells
  showArrows: false,
  showTerrain: true,
  paused: false,
  showPlan: true,
  showFixtures: true,
  showHeat: false,
  showIsoline: false,
  showPeakGlow: false,
  showCurtain: false,
  showScreenFov: false,
  showSpeakers: false,
  showProfit: true,
  showMedia: false,
  showCategory: false,
  showTicker: false,
  pickMode: false,
  drawMode: false,
  shiftLo: '#1d9a8a',
  shiftHi: '#e0b15a',
  shiftContrast: 1,
  obstacleHeight: 1.65,
  planOpacity: 0.85,
  planRotDeg: 0,
  planDx: 0,
  planDz: 0,
  planMirror: false,
};

// Production track store, pre-sliced by hour-of-day / weekday so the control
// panel can switch windows without re-aggregating 3M rows in the browser.
const SLICE_LABELS = {
  all: 'All trading hours (7–22)',
  morning: 'Morning 7–11',
  midday: 'Midday 11–15',
  afternoon: 'Afternoon 15–19',
  evening: 'Evening 19–22',
  weekday: 'Weekday (Mon–Fri)',
  weekend: 'Weekend (Sat–Sun)',
};
const bootQs = new URLSearchParams(location.search);

async function gateDemoToken() {
  const tok = bootQs.get('demo');
  if (!tok || bootQs.has('embed') || bootQs.has('export')) return;
  let ok = false;
  try {
    const res = await fetch(`/api/demo-access/validate?token=${encodeURIComponent(tok)}`);
    const data = await res.json().catch(() => null);
    ok = !!(res.ok && data?.valid && data.linkType === 'flowfield');
  } catch {
    ok = false;
  }
  if (ok) return;
  const loader = document.getElementById('loader');
  const label = document.getElementById('loaderLabel');
  if (loader) {
    loader.classList.remove('hidden');
    loader.style.opacity = '1';
    loader.style.pointerEvents = 'auto';
  }
  if (label) {
    label.style.maxWidth = '28rem';
    label.style.textAlign = 'center';
    label.innerHTML =
      '<span style="display:block;color:#e6e9ef;font-size:16px;font-weight:600;margin-bottom:8px">This link is no longer available</span>'
      + 'The shared people-flow link may have expired or been revoked. Ask your Hyperspace contact for a new public link.';
  }
  await new Promise(() => {});
}
await gateDemoToken();

let sliceId = SLICE_LABELS[bootQs.get('slice')] ? bootQs.get('slice') : 'all';
const fieldApi = {
  venue: bootQs.get('venue') || '',
  date: bootQs.get('date') || '',
  compare: bootQs.get('compare') || '',
};
const isEmbed = bootQs.has('embed');
// Dashboard tile must paint the static Windy snapshot. Waiting on
// /api/flowfield/field rebuilds 7 days of tracks and leaves the iframe
// on the splash until that finishes (or forever if it hangs).
let useLivePack = !(isEmbed && !fieldApi.date);
let dateCatalog = null;

async function fetchDateCatalog() {
  try {
    const q = fieldApi.venue ? `?venue=${encodeURIComponent(fieldApi.venue)}` : '';
    const res = await fetch(`/api/flowfield/dates${q}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return null;
  }
}

function fieldUrl(slice, date) {
  if (!useLivePack) return `./slices/field_${slice}.json${bust}`;
  const u = new URL('/api/flowfield/field', location.origin);
  u.searchParams.set('slice', slice);
  if (fieldApi.venue) u.searchParams.set('venue', fieldApi.venue);
  if (date) u.searchParams.set('date', date);
  return u.pathname + u.search;
}

function withTimeout(promise, ms, label) {
  let t = 0;
  const timeout = new Promise((_, reject) => {
    t = window.setTimeout(() => reject(new Error(label || `timeout ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(t));
}

async function loadFieldSmart(slice, date = fieldApi.date) {
  try {
    if (useLivePack) {
      return await withTimeout(loadField(fieldUrl(slice, date)), 8000, 'live field timeout');
    }
    return await loadField(`./slices/field_${slice}.json${bust}`);
  } catch (err) {
    if (useLivePack && !field) {
      console.warn('Live flowfield pack unavailable, falling back to static snapshot', err);
      useLivePack = false;
      return loadField(`./slices/field_${slice}.json${bust}`);
    }
    throw err;
  }
}

dateCatalog = await fetchDateCatalog();
if (dateCatalog?.latest && !fieldApi.date) fieldApi.date = dateCatalog.latest;
if (dateCatalog && dateCatalog.dates?.length === 0) useLivePack = false;

let field = await loadFieldSmart(sliceId);
const layout = await (await fetch('./layout_prod.json' + bust)).json();
const layersPack = await (await fetch('./layers_pack.json' + bust)).json();
let CELL = field.meta.cell_m;
let FIELD_W = field.NX * CELL;
let FIELD_D = field.NY * CELL;

// Everything is drawn in VENUE metres, matching how the product works: the DWG
// plan stays axis-aligned and the measured field is transformed into it.
const planCenter = {
  x: (layout.bbox.minX + layout.bbox.maxX) / 2,
  z: (layout.bbox.minZ + layout.bbox.maxZ) / 2,
};
const VENUE_W = layout.bbox.maxX - layout.bbox.minX;
const VENUE_D = layout.bbox.maxZ - layout.bbox.minZ;
const VENUE_SPAN = Math.max(VENUE_W, VENUE_D);

// The field is aggregated in venue metres, so the grid is already parallel to
// the building and the mapping is a plain offset. The controls below apply a
// DELTA on top, for correcting the fitted pose by eye — at zero they do nothing.
let ORIGIN = field.meta.origin_m;
const fieldCenter = { x: ORIGIN.x + FIELD_W / 2, z: ORIGIN.y + FIELD_D / 2 };

function setLoader(visible, label, opts = {}) {
  const el = document.getElementById('loader');
  const text = document.getElementById('loaderLabel');
  if (!el) return;
  if (label && text) text.textContent = label;
  if (visible) {
    if (setLoader._hideTimer) {
      clearTimeout(setLoader._hideTimer);
      setLoader._hideTimer = null;
    }
    setLoader._indefinite = !!opts.indefinite;
    window.__ffLoader?.setUnbounded?.(!!opts.indefinite);
    el.classList.remove('hidden');
    el.setAttribute('aria-busy', 'true');
    window.__ffLoader?.resetClock?.();
    window.__ffLoader?.play();
    return;
  }
  const minMs = setLoader._indefinite ? 400 : (window.__ffLoader?.minMs ?? 5000);
  const shownAt = window.__ffLoader?.getShownAt?.() ?? performance.now();
  const left = Math.max(0, minMs - (performance.now() - shownAt));
  const hide = () => {
    setLoader._hideTimer = null;
    setLoader._indefinite = false;
    window.__ffLoader?.setUnbounded?.(false);
    el.classList.add('hidden');
    el.setAttribute('aria-busy', 'false');
    window.setTimeout(() => {
      if (el.classList.contains('hidden')) window.__ffLoader?.pause();
    }, 450);
  };
  if (setLoader._hideTimer) clearTimeout(setLoader._hideTimer);
  if (left <= 0) hide();
  else setLoader._hideTimer = window.setTimeout(hide, left);
}

/** Fractional field-grid coords -> venue metres. */
function gridToVenue(gx, gy) {
  const bx = ORIGIN.x + gx * CELL - fieldCenter.x;
  const bz = ORIGIN.y + gy * CELL - fieldCenter.z;
  const mx = params.planMirror ? -bx : bx;
  const th = params.planRotDeg * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  return {
    x: fieldCenter.x + params.planDx + (mx * cos - bz * sin),
    z: fieldCenter.z + params.planDz + (mx * sin + bz * cos),
  };
}

/** Venue metres -> fractional field-grid coords. */
function venueToGrid(vx, vz) {
  const ux = vx - fieldCenter.x - params.planDx;
  const uz = vz - fieldCenter.z - params.planDz;
  const th = params.planRotDeg * Math.PI / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  const rx = ux * cos + uz * sin;
  const rz = -ux * sin + uz * cos;
  return {
    x: ((params.planMirror ? -rx : rx) + fieldCenter.x - ORIGIN.x) / CELL,
    y: (rz + fieldCenter.z - ORIGIN.y) / CELL,
  };
}

// ---------------------------------------------------------------- scene setup
const container = document.getElementById('view');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080b);
scene.fog = new THREE.Fog(0x07080b, VENUE_SPAN * 1.8, VENUE_SPAN * 4.2);

const camera = new THREE.PerspectiveCamera(48, 1, 0.5, 1200);
camera.position.set(
  planCenter.x + VENUE_SPAN * 0.42,
  VENUE_SPAN * 0.72,
  planCenter.z + VENUE_SPAN * 0.95,
);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  // Needed so canvas.toDataURL / report captures see the last drawn frame.
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(planCenter.x, 0, planCenter.z);
controls.maxPolarAngle = Math.PI * 0.495;
params.panMode = false;
function applyNavMode() {
  if (params.panMode) {
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
  } else {
    controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  }
  document.getElementById('navPan')?.classList.toggle('on', params.panMode);
  document.getElementById('navRotate')?.classList.toggle('on', !params.panMode);
}
applyNavMode();

scene.add(new THREE.AmbientLight(0xffffff, 0.72));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(planCenter.x, VENUE_SPAN * 0.8, planCenter.z - VENUE_D * 0.7);
scene.add(key);

// ------------------------------------------------------------------- terrain
// Dwell becomes elevation, so the streams visibly flow around and over the
// places where people stop. The colour ramp carries the selected scalar.
const gridGeom = new THREE.BufferGeometry();
let vertCount = 0;
let positions = new Float32Array(0);
let colors = new Float32Array(0);
// Quads are emitted only where the sensor actually saw people, so the surface is
// a measured patch floating over the plan rather than a slab that hides it —
// uncovered floor stays visibly uncovered instead of being interpolated away.
let indices = new Uint32Array(0);

function syncFieldGeometry() {
  CELL = field.meta.cell_m;
  FIELD_W = field.NX * CELL;
  FIELD_D = field.NY * CELL;
  ORIGIN = field.meta.origin_m;
  fieldCenter.x = ORIGIN.x + FIELD_W / 2;
  fieldCenter.z = ORIGIN.y + FIELD_D / 2;
  vertCount = field.NX * field.NY;
  positions = new Float32Array(vertCount * 3);
  colors = new Float32Array(vertCount * 3);
  indices = new Uint32Array(Math.max(0, (field.NX - 1) * (field.NY - 1) * 6));
  for (let j = 0; j < field.NY; j++) {
    for (let i = 0; i < field.NX; i++) {
      const v = j * field.NX + i;
      const p = gridToVenue(i, j);
      positions[v * 3] = p.x;
      positions[v * 3 + 1] = 0;
      positions[v * 3 + 2] = p.z;
    }
  }
  gridGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  gridGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  gridGeom.setIndex(new THREE.BufferAttribute(indices, 1));
}
syncFieldGeometry();

const terrain = new THREE.Mesh(
  gridGeom,
  // Held back from full opacity: the scalar carpet is background, and the plan
  // and streamlines both need to read on top of it.
  new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.78 }),
);
scene.add(terrain);

const peekGroup = new THREE.Group();
peekGroup.renderOrder = 6;
scene.add(peekGroup);

const pickPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(VENUE_W * 2.2, VENUE_D * 2.2).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
);
pickPlane.position.set(planCenter.x, 0, planCenter.z);
pickPlane.visible = true;
scene.add(pickPlane);

// Store extents from the DWG, so the field is readable against the building.
const bounds = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.PlaneGeometry(VENUE_W, VENUE_D).rotateX(-Math.PI / 2)),
  new THREE.LineBasicMaterial({ color: 0x2a3140 }),
);
bounds.position.set(planCenter.x, 0, planCenter.z);
scene.add(bounds);

const supportNorm = (k) => Math.min(1, Math.sqrt(field.support[k] / field.supportRef) * 1.4);

function heightAtCell(k) {
  const s = field.scalars.dwell;
  const n = Math.pow(Math.min(1, field.dwell[k] / s.max), 0.75);
  return n * params.terrainHeight * supportNorm(k);
}

function peakDwellCut(q = 0.88) {
  const vals = [];
  for (let k = 0; k < vertCount; k++) {
    if (supportNorm(k) > 0.08) vals.push(field.dwell[k]);
  }
  vals.sort((a, b) => a - b);
  if (!vals.length) return Infinity;
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))];
}

function signedColourExtent(sc) {
  if (!sc?.signed) return 1;
  const vals = [];
  for (let k = 0; k < sc.data.length; k++) {
    if (field.support[k] > 0) vals.push(Math.abs(sc.data[k]));
  }
  if (!vals.length) return Math.max(Math.abs(sc.min ?? 0), Math.abs(sc.max ?? 1)) || 1;
  vals.sort((a, b) => a - b);
  const p = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.82))] || 0;
  return Math.max(p, 0.06);
}

const SHIFT_STORE = 'ff-shift-mix';
const SHIFT_PALETTES = [
  { id: 'teal-amber', label: 'Teal / amber', lo: '#1d9a8a', hi: '#e0b15a' },
  { id: 'slate-copper', label: 'Slate / copper', lo: '#7c93b2', hi: '#c47a4a' },
  { id: 'ink-sand', label: 'Ink / sand', lo: '#5b6abf', hi: '#d7b896' },
  { id: 'forest-gold', label: 'Forest / gold', lo: '#3d7a5a', hi: '#d4a017' },
  { id: 'cyan-rose', label: 'Cyan / rose', lo: '#22d3ee', hi: '#fb7185' },
];

function hexToRgb(hex) {
  const n = String(hex || '').replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n.padEnd(6, '0').slice(0, 6);
  const v = parseInt(full, 16);
  if (!Number.isFinite(v)) return { r: 0.2, g: 0.6, b: 0.55 };
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

function rgbToHsl(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function shiftRamp(t) {
  const v = Math.max(-1, Math.min(1, t));
  const contrast = Math.max(0.35, Math.min(1.45, Number(params.shiftContrast) || 1));
  const m = Math.pow(Math.abs(v), 0.32 + 0.38 / contrast);
  const lo = hexToRgb(params.shiftLo);
  const hi = hexToRgb(params.shiftHi);
  const mid = { r: 0.20, g: 0.23, b: 0.27 };
  const to = v < 0 ? lo : hi;
  const r = mid.r + (to.r - mid.r) * m;
  const g = mid.g + (to.g - mid.g) * m;
  const b = mid.b + (to.b - mid.b) * m;
  return rgbToHsl(r, g, b);
}

function signedRamp(t) {
  if (String(params.scalar).startsWith('shift_')) return shiftRamp(t);
  const v = Math.max(-1, Math.min(1, t));
  const m = Math.pow(Math.abs(v), 0.65);
  const h = v < 0 ? 0.52 : 0.985;
  return { h, s: 0.15 + 0.75 * m, l: 0.16 + 0.42 * m };
}

function loadShiftMix() {
  try {
    const j = JSON.parse(localStorage.getItem(SHIFT_STORE) || 'null');
    if (!j || typeof j !== 'object') return;
    if (/^#[0-9a-fA-F]{6}$/.test(j.lo)) params.shiftLo = j.lo;
    if (/^#[0-9a-fA-F]{6}$/.test(j.hi)) params.shiftHi = j.hi;
    if (Number.isFinite(Number(j.contrast))) params.shiftContrast = Number(j.contrast);
  } catch { /* ignore */ }
}

function saveShiftMix() {
  try {
    localStorage.setItem(SHIFT_STORE, JSON.stringify({
      lo: params.shiftLo, hi: params.shiftHi, contrast: params.shiftContrast,
    }));
  } catch { /* ignore */ }
}

function applyShiftPalette(id) {
  const pal = SHIFT_PALETTES.find((p) => p.id === id);
  if (!pal) return;
  params.shiftLo = pal.lo;
  params.shiftHi = pal.hi;
  saveShiftMix();
  syncShiftMixUi();
  if (String(params.scalar).startsWith('shift_')) {
    rebuildTerrain();
    paintReadKey();
  }
}

function syncShiftMixUi() {
  const lo = document.getElementById('shiftLo');
  const hi = document.getElementById('shiftHi');
  const c = document.getElementById('shiftContrast');
  const cv = document.getElementById('shiftContrastVal');
  if (lo && document.activeElement !== lo) lo.value = params.shiftLo;
  if (hi && document.activeElement !== hi) hi.value = params.shiftHi;
  if (c && document.activeElement !== c) c.value = String(Math.round((params.shiftContrast || 1) * 100));
  if (cv) cv.textContent = `${Math.round((params.shiftContrast || 1) * 100)}%`;
  document.querySelectorAll('#shiftPresets button').forEach((btn) => {
    btn.classList.toggle('on', btn.dataset.shiftPal === SHIFT_PALETTES.find((p) => p.lo === params.shiftLo && p.hi === params.shiftHi)?.id);
  });
  const bar = document.getElementById('readKeyBar');
  if (bar) bar.style.background = `linear-gradient(90deg, ${params.shiftLo}, #3a4554, ${params.shiftHi})`;
  const loEl = document.getElementById('readKeyLo');
  const hiEl = document.getElementById('readKeyHi');
  if (loEl) loEl.style.color = params.shiftLo;
  if (hiEl) hiEl.style.color = params.shiftHi;
}

loadShiftMix();

function rebuildTerrain() {
  let sc = field.scalars[params.scalar];
  if (!sc && field.scalars.dwell) {
    params.scalar = 'dwell';
    sc = field.scalars.dwell;
  }
  if (!sc) return;
  const extent = sc.signed ? signedColourExtent(sc) : 0;
  const dwellMax = field.scalars.dwell.max || 1;
  const peakCut = params.showPeakGlow ? peakDwellCut(0.88) : Infinity;
  const col = new THREE.Color();
  for (let k = 0; k < vertCount; k++) {
    const sup = supportNorm(k);
    positions[k * 3 + 1] = params.showTerrain ? heightAtCell(k) : 0;
    let r = 0.04, g = 0.05, b = 0.07;
    if (sup > 0.02) {
      const catHsl = (params.showCategory && layersEngine) ? layersEngine.tintCell(k) : null;
      const { h, s, l } = catHsl
        ? { h: catHsl[0], s: catHsl[1], l: catHsl[2] }
        : sc.categorical
          ? regimeRamp(sc.data[k])
          : sc.signed
            ? signedRamp(sc.data[k] / extent)
            : heatRamp(sc.data[k] / (sc.max || 1));
      col.setHSL(h, s, l);
      const lift = (sc.categorical && !catHsl) ? 0.04 : 0.10;
      r = lift + col.r * (1 - lift);
      g = lift + col.g * (1 - lift * 0.9);
      b = lift + col.b * (1 - lift * 0.7);
      const mask = layersEngine ? layersEngine.selectionMask(k) : 1;
      r *= mask; g *= mask; b *= mask;
    }
    if (params.showPeakGlow && field.dwell[k] >= peakCut) {
      const t = Math.min(1, (field.dwell[k] - peakCut) / Math.max(1e-6, dwellMax - peakCut));
      const w = 0.28 + 0.42 * t;
      r = r * (1 - w) + 1.00 * w;
      g = g * (1 - w) + (0.38 + 0.28 * t) * w;
      b = b * (1 - w) + 0.07 * w;
    }
    colors[k * 3] = r; colors[k * 3 + 1] = g; colors[k * 3 + 2] = b;
  }

  let n = 0;
  for (let j = 0; j < field.NY - 1; j++) {
    for (let i = 0; i < field.NX - 1; i++) {
      const v = j * field.NX + i;
      const a = v, b = v + 1, c = v + field.NX, d = v + field.NX + 1;
      const covered = Math.max(supportNorm(a), supportNorm(b), supportNorm(c), supportNorm(d));
      if (covered <= 0.02) continue;
      indices[n++] = a; indices[n++] = c; indices[n++] = b;
      indices[n++] = b; indices[n++] = c; indices[n++] = d;
    }
  }
  gridGeom.setDrawRange(0, n);
  gridGeom.index.needsUpdate = true;
  gridGeom.attributes.position.needsUpdate = true;
  gridGeom.attributes.color.needsUpdate = true;
  gridGeom.computeVertexNormals();
  terrain.visible = params.showTerrain;
  const shiftOn = !!(sc.signed && String(params.scalar).startsWith('shift_'));
  terrain.material.opacity = shiftOn ? 0.94 : (params.showIsoline ? 0.30 : 0.78);
  updateLegend();
  rebuildReadings();
}

function terrainHeightAt(x, y) {
  if (!params.showTerrain) return 0;
  const s = field.scalars.dwell;
  const d = field.sampleScalar(field.dwell, x, y);
  const sup = Math.min(1, Math.sqrt(field.sampleScalar(field.support, x, y) / field.supportRef) * 1.4);
  return Math.pow(Math.min(1, d / s.max), 0.75) * params.terrainHeight * sup;
}

// Extra readings — isoline relief, peak glow, aisle curtain. Height is still
// dwell; these sit on top of the filled carpet instead of replacing it.
const isolineMesh = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.58, depthWrite: false }),
);
isolineMesh.frustumCulled = false;
isolineMesh.renderOrder = 2;
isolineMesh.visible = false;
scene.add(isolineMesh);

function makeGlowTexture() {
  const s = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = s;
  const ctx = cvs.getContext('2d');
  const grd = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.00, 'rgba(255,230,170,1)');
  grd.addColorStop(0.18, 'rgba(255,160,50,0.75)');
  grd.addColorStop(0.48, 'rgba(255,90,20,0.22)');
  grd.addColorStop(1.00, 'rgba(255,40,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cvs);
  tex.needsUpdate = true;
  return tex;
}

const GLOW_MAX = 64;
const peakGlowGeom = new THREE.CircleGeometry(1, 32);
peakGlowGeom.rotateX(-Math.PI / 2);
const peakGlowMesh = new THREE.InstancedMesh(
  peakGlowGeom,
  new THREE.MeshBasicMaterial({
    map: makeGlowTexture(),
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  }),
  GLOW_MAX,
);
peakGlowMesh.frustumCulled = false;
peakGlowMesh.renderOrder = 3;
peakGlowMesh.visible = false;
peakGlowMesh.count = 0;
scene.add(peakGlowMesh);
const _glowDummy = new THREE.Object3D();
const _glowCol = new THREE.Color();

const euroGhostMesh = new THREE.LineSegments(
  new THREE.BufferGeometry(),
  new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false }),
);
euroGhostMesh.frustumCulled = false;
euroGhostMesh.visible = false;
scene.add(euroGhostMesh);

const curtainMesh = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
curtainMesh.frustumCulled = false;
curtainMesh.renderOrder = 7;
curtainMesh.visible = false;
scene.add(curtainMesh);

function setLineGeom(mesh, pos, col) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const old = mesh.geometry;
  mesh.geometry = geom;
  old.dispose();
}

function supportNormFrac(gx, gy) {
  return Math.min(1, Math.sqrt(field.sampleScalar(field.support, gx, gy) / field.supportRef) * 1.4);
}

function sampleTerrainColor(gx, gy, out) {
  const NX = field.NX;
  const fx = Math.min(NX - 1.001, Math.max(0, gx));
  const fy = Math.min(field.NY - 1.001, Math.max(0, gy));
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
  const i2 = Math.min(NX - 1, i + 1), j2 = Math.min(field.NY - 1, j + 1);
  const c = (ii, jj, ch) => colors[(jj * NX + ii) * 3 + ch];
  for (let ch = 0; ch < 3; ch++) {
    const a = c(i, j, ch) * (1 - tx) + c(i2, j, ch) * tx;
    const b = c(i, j2, ch) * (1 - tx) + c(i2, j2, ch) * tx;
    out[ch] = a * (1 - ty) + b * ty;
  }
}

function rebuildIsolines() {
  if (!params.showIsoline) { isolineMesh.visible = false; return; }
  const NX = field.NX, NY = field.NY;
  const stepG = 0.45 / CELL;
  const pos = [];
  const col = [];
  const rgb = [0, 0, 0];
  const pushSeg = (gx0, gy0, gx1, gy1) => {
    if (supportNormFrac(gx0, gy0) < 0.04 && supportNormFrac(gx1, gy1) < 0.04) return;
    const p0 = gridToVenue(gx0, gy0);
    const p1 = gridToVenue(gx1, gy1);
    pos.push(p0.x, terrainHeightAt(gx0, gy0) + 0.04, p0.z);
    pos.push(p1.x, terrainHeightAt(gx1, gy1) + 0.04, p1.z);
    sampleTerrainColor(gx0, gy0, rgb);
    col.push(rgb[0], rgb[1], rgb[2]);
    sampleTerrainColor(gx1, gy1, rgb);
    col.push(rgb[0], rgb[1], rgb[2]);
  };
  for (let gy = 0; gy <= NY - 1; gy += stepG) {
    for (let gx = 0; gx < NX - 1; gx += stepG) {
      pushSeg(gx, gy, Math.min(gx + stepG, NX - 1), gy);
    }
  }
  for (let gx = 0; gx <= NX - 1; gx += stepG) {
    for (let gy = 0; gy < NY - 1; gy += stepG) {
      pushSeg(gx, gy, gx, Math.min(gy + stepG, NY - 1));
    }
  }
  if (pos.length < 6) { isolineMesh.visible = false; return; }
  setLineGeom(isolineMesh, new Float32Array(pos), new Float32Array(col));
  isolineMesh.visible = true;
}

function rebuildPeakGlow() {
  if (!params.showPeakGlow) { peakGlowMesh.visible = false; return; }
  const NX = field.NX, NY = field.NY;
  const cut = peakDwellCut(0.88);
  const dwellMax = field.scalars.dwell.max || 1;
  const peaks = [];
  for (let k = 0; k < vertCount; k++) {
    if (supportNorm(k) < 0.08 || field.dwell[k] < cut) continue;
    const i = k % NX, j = (k / NX) | 0;
    let local = true;
    for (let dj = -1; dj <= 1 && local; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
        if (field.dwell[jj * NX + ii] > field.dwell[k]) local = false;
      }
    }
    if (local) peaks.push(k);
  }
  peaks.sort((a, b) => field.dwell[b] - field.dwell[a]);
  const n = Math.min(GLOW_MAX, peaks.length);
  for (let i = 0; i < n; i++) {
    const k = peaks[i];
    const gi = k % NX, gj = (k / NX) | 0;
    const p = gridToVenue(gi + 0.5, gj + 0.5);
    const t = Math.min(1, (field.dwell[k] - cut) / Math.max(1e-6, dwellMax - cut));
    const r = 1.8 + 3.2 * t;
    _glowDummy.position.set(p.x, heightAtCell(k) + 0.08, p.z);
    _glowDummy.scale.set(r, 1, r);
    _glowDummy.updateMatrix();
    peakGlowMesh.setMatrixAt(i, _glowDummy.matrix);
    _glowCol.setRGB(1, 0.42 + 0.4 * t, 0.1);
    peakGlowMesh.setColorAt(i, _glowCol);
  }
  peakGlowMesh.count = n;
  peakGlowMesh.instanceMatrix.needsUpdate = true;
  if (peakGlowMesh.instanceColor) peakGlowMesh.instanceColor.needsUpdate = true;
  peakGlowMesh.visible = n > 0;
}

function rebuildEuroGhost() {
  if (!params.showPeakGlow || !params.showProfit || !layersEngine?.euroAt) {
    euroGhostMesh.visible = false;
    return;
  }
  const NX = field.NX, NY = field.NY;
  let euroMax = 0;
  for (let k = 0; k < vertCount; k++) {
    const e = layersEngine.euroAt(k) || 0;
    if (e > euroMax) euroMax = e;
  }
  if (euroMax <= 0) { euroGhostMesh.visible = false; return; }
  const hMax = 5.5;
  const step = 2;
  const pos = [];
  const col = [];
  const heightE = (k) => ((layersEngine.euroAt(k) || 0) / euroMax) * hMax;
  const pushSeg = (a, b) => {
    const ea = layersEngine.euroAt(a) || 0;
    const eb = layersEngine.euroAt(b) || 0;
    if (ea < euroMax * 0.08 && eb < euroMax * 0.08) return;
    pos.push(positions[a * 3], heightE(a), positions[a * 3 + 2]);
    pos.push(positions[b * 3], heightE(b), positions[b * 3 + 2]);
    const fa = Math.min(1, ea / euroMax), fb = Math.min(1, eb / euroMax);
    col.push(1.0, 0.72 + 0.2 * fa, 0.12, 1.0, 0.72 + 0.2 * fb, 0.12);
  };
  for (let j = 0; j < NY; j += step) {
    for (let i = 0; i < NX - step; i += step) pushSeg(j * NX + i, j * NX + Math.min(i + step, NX - 1));
  }
  for (let i = 0; i < NX; i += step) {
    for (let j = 0; j < NY - step; j += step) pushSeg(j * NX + i, Math.min(j + step, NY - 1) * NX + i);
  }
  if (pos.length < 6) { euroGhostMesh.visible = false; return; }
  setLineGeom(euroGhostMesh, new Float32Array(pos), new Float32Array(col));
  euroGhostMesh.visible = true;
}

function boundsFromVerts(vs) {
  if (!vs?.length) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  let cx = 0, cz = 0;
  for (const p of vs) {
    cx += p[0]; cz += p[1];
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
  }
  cx /= vs.length; cz /= vs.length;
  return {
    cx, cz,
    dx: Math.max(4, maxX - minX),
    dz: Math.max(4, maxZ - minZ),
    span: Math.max(maxX - minX, maxZ - minZ, 8),
  };
}

function curtainBounds() {
  const c = layersEngine?.selectionCenter?.();
  if (c) return c;
  return boundsFromVerts(layersEngine?.storyTargets?.()?.trap?.vertices);
}

function rebuildCurtain() {
  if (!params.showCurtain) { curtainMesh.visible = false; return; }
  const c = curtainBounds();
  if (!c) { curtainMesh.visible = false; return; }
  const dx = Math.max(4, c.dx || c.span);
  const dz = Math.max(4, c.dz || c.span);
  const alongX = dx >= dz;
  const len = Math.max(dx, dz);
  const n = Math.max(20, Math.min(48, Math.round(len / 0.5)));
  const barW = Math.max(0.22, (len / n) * 0.82);
  const offset = 1.35;
  const samples = [];
  let dLoc = 0, fLoc = 0;
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    const sx = alongX ? (c.cx - dx / 2) + t * dx : c.cx;
    const sz = alongX ? c.cz : (c.cz - dz / 2) + t * dz;
    const g = venueToGrid(sx, sz);
    const dwell = field.sampleScalar(field.dwell, g.x, g.y);
    const foot = field.sampleScalar(field.traffic, g.x, g.y);
    dLoc = Math.max(dLoc, dwell);
    fLoc = Math.max(fLoc, foot);
    samples.push({ sx, sz, dwell, foot });
  }
  const dRef = Math.max(dLoc, (field.scalars.dwell.max || 1) * 0.18);
  const fRef = Math.max(fLoc, (field.scalars.footfall.max || 1) * 0.18);
  const hMax = 6.2;
  const y0 = 0.06;
  const pos = [];
  const col = [];
  const idx = [];
  const pushQuad = (ax, ay, az, bx, by, bz, cxp, cy, czp, dxp, dy, dzp, r, g, b) => {
    const base = pos.length / 3;
    pos.push(ax, ay, az, bx, by, bz, cxp, cy, czp, dxp, dy, dzp);
    for (let i = 0; i < 4; i++) col.push(r, g, b);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let s = 0; s < n; s++) {
    const a = samples[s], b = samples[s + 1];
    const mx = (a.sx + b.sx) / 2;
    const mz = (a.sz + b.sz) / 2;
    const hx = alongX ? barW / 2 : 0;
    const hz = alongX ? 0 : barW / 2;
    const wx = alongX ? mx : mx + offset;
    const wz = alongX ? mz + offset : mz;
    const dH = y0 + Math.max(0.55, ((a.dwell + b.dwell) * 0.5 / dRef) * hMax);
    const fH = y0 + Math.max(0.55, ((a.foot + b.foot) * 0.5 / fRef) * hMax);
    const ox = alongX ? 0 : 0.32;
    const oz = alongX ? 0.32 : 0;
    pushQuad(
      wx - hx, y0, wz - hz,
      wx + hx, y0, wz + hz,
      wx + hx, dH, wz + hz,
      wx - hx, dH, wz - hz,
      1.0, 0.55, 0.1,
    );
    pushQuad(
      wx - hx + ox, y0, wz - hz + oz,
      wx + hx + ox, y0, wz + hz + oz,
      wx + hx + ox, fH, wz + hz + oz,
      wx - hx + ox, fH, wz - hz + oz,
      0.22, 0.82, 0.96,
    );
  }
  if (idx.length < 6) { curtainMesh.visible = false; return; }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  geom.setIndex(idx);
  const old = curtainMesh.geometry;
  curtainMesh.geometry = geom;
  old.dispose();
  curtainMesh.visible = true;
}

function rebuildReadings() {
  rebuildIsolines();
  rebuildPeakGlow();
  rebuildEuroGhost();
  rebuildCurtain();
}

// ------------------------------------------------------------- DWG floor plan
// The store wireframe, so the flow can be read against real fixtures.
//
// Both the plan and the field now come from the same venue row in the product
// database, and stored positions are already venue metres, so no pose fitting
// is involved and the two are aligned by construction. The offset controls
// below are left in as a nudge for eyeballing, and do nothing at zero.
const planGroup = new THREE.Group();
scene.add(planGroup);

/** Terrain height at a venue-space point (0 outside the measured field). */
function terrainHeightAtVenue(vx, vz) {
  const g = venueToGrid(vx, vz);
  if (g.x < 0 || g.y < 0 || g.x >= field.NX || g.y >= field.NY) return 0;
  return terrainHeightAt(g.x, g.y);
}

function buildFloorplan() {
  while (planGroup.children.length) {
    const c = planGroup.children.pop();
    c.geometry.dispose(); c.material.dispose();
  }
  const verts = [];
  const y = 0.08;
  for (const poly of layout.polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      verts.push(a[0], y, a[1]);
      verts.push(b[0], y, b[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0x8fd8ee, transparent: true, opacity: params.planOpacity,
    depthTest: false, depthWrite: false,
  });
  const lines = new THREE.LineSegments(g, mat);
  lines.renderOrder = 3;
  planGroup.add(lines);
  planGroup.visible = params.showPlan;
}

function clearGroup(group) {
  while (group.children.length) {
    const c = group.children.pop();
    c.geometry?.dispose();
    const mats = c.material ? (Array.isArray(c.material) ? c.material : [c.material]) : [];
    for (const m of mats) {
      m.map?.dispose();
      m.dispose();
    }
  }
}

function fixtureAabb(poly) {
  if (!poly || poly.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minZ) minZ = p[1]; if (p[1] > maxZ) maxZ = p[1];
  }
  const w = maxX - minX, d = maxZ - minZ;
  const maxS = Math.max(w, d), minS = Math.min(w, d);
  if (maxS < 0.32) return null;
  if (minS < 0.07) return null;
  if (maxS > 34) return null;
  if (minS > 8 && maxS > 16) return null;
  return { minX, maxX, minZ, maxZ, w, d, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
}

let layersEngine = null;
let fixtureBoxes = [];
let blocked = new Uint8Array(0);
function rasterizeObstacles() {
  blocked = new Uint8Array(field.NX * field.NY);
  fixtureBoxes = [];
  for (const poly of layout.polys) {
    const box = fixtureAabb(poly);
    if (!box) continue;
    fixtureBoxes.push(box);
    const g0 = venueToGrid(box.minX, box.minZ);
    const g1 = venueToGrid(box.maxX, box.maxZ);
    const iLo = Math.max(0, Math.floor(Math.min(g0.x, g1.x)));
    const iHi = Math.min(field.NX - 1, Math.floor(Math.max(g0.x, g1.x)));
    const jLo = Math.max(0, Math.floor(Math.min(g0.y, g1.y)));
    const jHi = Math.min(field.NY - 1, Math.floor(Math.max(g0.y, g1.y)));
    for (let j = jLo; j <= jHi; j++) {
      for (let i = iLo; i <= iHi; i++) {
        blocked[field.idx(i, j)] = 1;
      }
    }
  }
}

const obstacleGroup = new THREE.Group();
scene.add(obstacleGroup);
function buildObstacles() {
  clearGroup(obstacleGroup);
  const boxes = fixtureBoxes.length ? fixtureBoxes : [];
  if (!boxes.length) {
    for (const poly of layout.polys) {
      const box = fixtureAabb(poly);
      if (box) boxes.push(box);
    }
  }
  if (!boxes.length) { obstacleGroup.visible = params.showFixtures; return; }
  const dummy = new THREE.Object3D();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const fill = new THREE.InstancedMesh(
    boxGeo,
    new THREE.MeshLambertMaterial({
      color: 0x14331f, transparent: true, opacity: 0.18,
      depthTest: false, depthWrite: false,
    }),
    boxes.length,
  );
  const edgePts = [];
  for (let n = 0; n < boxes.length; n++) {
    const b = boxes[n];
    const y0 = 0;
    dummy.position.set(b.cx, y0, b.cz);
    dummy.scale.set(Math.max(0.2, b.w), params.obstacleHeight, Math.max(0.2, b.d));
    dummy.updateMatrix();
    fill.setMatrixAt(n, dummy.matrix);
    const x0 = b.minX, x1 = b.maxX, z0 = b.minZ, z1 = b.maxZ;
    const y1 = params.obstacleHeight;
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], c = corners[(i + 1) % 4];
      edgePts.push(a[0], y0, a[1], c[0], y0, c[1]);
      edgePts.push(a[0], y1, a[1], c[0], y1, c[1]);
      edgePts.push(a[0], y0, a[1], a[0], y1, a[1]);
    }
  }
  fill.instanceMatrix.needsUpdate = true;
  fill.frustumCulled = false;
  fill.renderOrder = 4;
  obstacleGroup.add(fill);
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
  const edges = new THREE.LineSegments(eg, new THREE.LineBasicMaterial({
    color: 0x7dff9a, transparent: true, opacity: 0.55,
    depthTest: false, depthWrite: false,
  }));
  edges.renderOrder = 5;
  obstacleGroup.add(edges);
  obstacleGroup.visible = params.showFixtures;
}

function plumeRamp(t) {
  t = Math.max(0, Math.min(1, t));
  return { h: 0.33 - t * 0.31, s: 0.72 + 0.22 * t, l: 0.40 + 0.14 * t };
}

function recirculationAt(k) {
  const lo = field.scalars.convergence?.min ?? 0;
  const span = Math.max(1e-6, -lo);
  return Math.min(1, Math.max(0, -field.divergence[k] / span));
}

const HEAT_N = 1400;
const HEAT_TRAIL = 16;
const volumeGroup = new THREE.Group();
scene.add(volumeGroup);
let heatParts = [];
let heatGeom = null;
let heatMesh = null;
let heatPos = null;
let heatCol = null;
let heatFrame = 0;

function cellBlocked(gx, gy) {
  const i = Math.floor(gx), j = Math.floor(gy);
  if (i < 0 || j < 0 || i >= field.NX || j >= field.NY) return true;
  return !!blocked[field.idx(i, j)];
}

function pickHeatSpawn() {
  for (let t = 0; t < 48; t++) {
    const s = field.randomSpawn();
    if (cellBlocked(s.x, s.y)) continue;
    const k = field.idx(Math.floor(s.x), Math.floor(s.y));
    const rec = recirculationAt(k);
    const dwellN = Math.min(1, field.dwell[k] / (field.scalars.dwell.max || 1));
    const heat = Math.max(rec, dwellN * 0.55);
    if (heat > 0.10 || Math.random() < 0.06) return { x: s.x, y: s.y, heat };
  }
  const s = field.randomSpawn();
  return { x: s.x, y: s.y, heat: 0.18 };
}

function distGrad(gx, gy) {
  if (!reachDist) return { x: 0, y: 0 };
  const i = Math.max(1, Math.min(field.NX - 2, Math.floor(gx)));
  const j = Math.max(1, Math.min(field.NY - 2, Math.floor(gy)));
  const dx = reachDist[field.idx(i + 1, j)] - reachDist[field.idx(i - 1, j)];
  const dy = reachDist[field.idx(i, j + 1)] - reachDist[field.idx(i, j - 1)];
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 1e7 || Math.abs(dy) > 1e7) {
    return { x: 0, y: 0 };
  }
  return { x: dx / (2 * CELL), y: dy / (2 * CELL) };
}

function spawnHeat(p) {
  const s = pickHeatSpawn();
  p.x = s.x; p.y = s.y;
  p.heat = s.heat;
  p.life = 50 + Math.random() * 90;
  p.age = 0;
  p.h = 0.25 + Math.random() * 0.35;
  p.vz = 0.55 + p.heat * 2.2;
  p.hist = p.hist || new Float32Array(HEAT_TRAIL * 3);
  const v = gridToVenue(p.x, p.y);
  const y = terrainHeightAt(p.x, p.y) + p.h;
  for (let i = 0; i < HEAT_TRAIL; i++) {
    p.hist[i * 3] = v.x;
    p.hist[i * 3 + 1] = y;
    p.hist[i * 3 + 2] = v.z;
  }
  return p;
}

function buildVolume() {
  clearGroup(volumeGroup);
  heatGeom = null;
  heatMesh = null;
  heatParts = new Array(HEAT_N);
  for (let i = 0; i < HEAT_N; i++) heatParts[i] = spawnHeat({});
  const segs = HEAT_TRAIL - 1;
  heatPos = new Float32Array(HEAT_N * segs * 2 * 3);
  heatCol = new Float32Array(HEAT_N * segs * 2 * 3);
  heatGeom = new THREE.BufferGeometry();
  heatGeom.setAttribute('position', new THREE.BufferAttribute(heatPos, 3));
  heatGeom.setAttribute('color', new THREE.BufferAttribute(heatCol, 3));
  heatMesh = new THREE.LineSegments(heatGeom, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, linewidth: 1,
  }));
  heatMesh.frustumCulled = false;
  volumeGroup.add(heatMesh);
  volumeGroup.visible = params.showHeat;
}

function stepHeatPlumes(dt) {
  if (!params.showHeat || !heatMesh || !heatParts.length) return;
  const push = (heatFrame++ % 2) === 0;
  const col = new THREE.Color();
  const dwellMax = field.scalars.dwell.max || 1;
  for (let i = 0; i < heatParts.length; i++) {
    const p = heatParts[i];
    if (p.age > p.life || p.h > 7.5 || cellBlocked(p.x, p.y)) {
      spawnHeat(p);
      continue;
    }
    const k = field.idx(
      Math.max(0, Math.min(field.NX - 1, Math.floor(p.x))),
      Math.max(0, Math.min(field.NY - 1, Math.floor(p.y))),
    );
    const mx = field.meanX[k], my = field.meanY[k];
    const mag = Math.hypot(mx, my);
    const g = distGrad(p.x, p.y);
    const gm = Math.hypot(g.x, g.y);
    let vx = 0, vy = 0;
    if (mag > 1e-4) { vx += 0.62 * mx / mag; vy += 0.62 * my / mag; }
    if (gm > 1e-4) { vx += 0.38 * g.x / gm; vy += 0.38 * g.y / gm; }
    const vm = Math.hypot(vx, vy) || 1;
    vx /= vm; vy /= vm;
    const rec = recirculationAt(k);
    const dwellN = Math.min(1, field.dwell[k] / dwellMax);
    p.heat = p.heat * 0.96 + Math.max(rec, dwellN * 0.5) * 0.04;
    const speed = (0.35 + 0.9 * (1 - dwellN)) * params.timeScale * 0.55;
    const nx = p.x + vx * (speed / CELL) * dt;
    const ny = p.y + vy * (speed / CELL) * dt;
    if (!cellBlocked(nx, ny)) { p.x = nx; p.y = ny; }
    else if (!cellBlocked(nx, p.y)) p.x = nx;
    else if (!cellBlocked(p.x, ny)) p.y = ny;
    else { spawnHeat(p); continue; }
    p.vz += (0.35 + p.heat * 1.8) * dt;
    p.h += p.vz * dt;
    p.age += dt * 60;
    if (push) {
      p.hist.copyWithin(3, 0, (HEAT_TRAIL - 1) * 3);
      const v = gridToVenue(p.x, p.y);
      p.hist[0] = v.x;
      p.hist[1] = terrainHeightAt(p.x, p.y) + p.h;
      p.hist[2] = v.z;
    }
  }
  if (!push) return;
  const segs = HEAT_TRAIL - 1;
  for (let i = 0; i < heatParts.length; i++) {
    const p = heatParts[i];
    const { h, s, l } = plumeRamp(p.heat);
    col.setHSL(h, s, l);
    for (let t = 0; t < segs; t++) {
      const fade = Math.pow(1 - t / segs, 1.35) * (1 - p.h / 8.5);
      const o = ((i * segs + t) * 2) * 3;
      heatPos[o] = p.hist[t * 3];
      heatPos[o + 1] = p.hist[t * 3 + 1];
      heatPos[o + 2] = p.hist[t * 3 + 2];
      heatPos[o + 3] = p.hist[(t + 1) * 3];
      heatPos[o + 4] = p.hist[(t + 1) * 3 + 1];
      heatPos[o + 5] = p.hist[(t + 1) * 3 + 2];
      const r = col.r * fade, g = col.g * fade, b = col.b * fade;
      heatCol[o] = r; heatCol[o + 1] = g; heatCol[o + 2] = b;
      heatCol[o + 3] = r; heatCol[o + 4] = g; heatCol[o + 5] = b;
    }
  }
  heatGeom.attributes.position.needsUpdate = true;
  heatGeom.attributes.color.needsUpdate = true;
}

const WAVE_COUNT = 3;
const WAVE_MAX_FLOATS = 48000;
const WAVE_PERIOD_M = 30;
const WAVE_SPEED = 10;
const reachGroup = new THREE.Group();
scene.add(reachGroup);
const waveGroup = new THREE.Group();
scene.add(waveGroup);
let reachSource = null;
let reachFar = null;
let reachDist = null;
let waveMeshes = [];
let wavePhase = 0;

function defaultReachSource() {
  let best = -1, bestV = -Infinity;
  for (let k = 0; k < field.NX * field.NY; k++) {
    if (supportNorm(k) < 0.12 || blocked[k]) continue;
    const v = recirculationAt(k) * 1.4 + Math.min(1, field.dwell[k] / (field.scalars.dwell.max || 1));
    if (v > bestV) { bestV = v; best = k; }
  }
  return best;
}

function geodesicFrom(src) {
  const N = field.NX * field.NY;
  const dist = new Float32Array(N);
  dist.fill(1e9);
  if (src == null || src < 0) return dist;
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  dist[src] = 0;
  q[qt++] = src;
  const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (qh < qt) {
    const k = q[qh++];
    const i = k % field.NX, j = (k / field.NX) | 0;
    for (const [di, dj] of nbr) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= field.NX || jj >= field.NY) continue;
      const nk = field.idx(ii, jj);
      if (blocked[nk] || dist[nk] < 1e8) continue;
      dist[nk] = dist[k] + CELL;
      q[qt++] = nk;
    }
  }
  return dist;
}

function marchingIso(dist, iso) {
  const segs = [];
  const at = (i, j) => dist[field.idx(i, j)];
  const cross = (i0, j0, i1, j1) => {
    const a = at(i0, j0), b = at(i1, j1);
    if (a > 1e8 || b > 1e8) return null;
    if ((a - iso) * (b - iso) > 0) return null;
    const t = (iso - a) / ((b - a) || 1e-9);
    return gridToVenue(i0 + (i1 - i0) * t, j0 + (j1 - j0) * t);
  };
  for (let j = 0; j < field.NY - 1; j++) {
    for (let i = 0; i < field.NX - 1; i++) {
      const hits = [
        cross(i, j, i + 1, j),
        cross(i + 1, j, i + 1, j + 1),
        cross(i, j + 1, i + 1, j + 1),
        cross(i, j, i, j + 1),
      ].filter(Boolean);
      if (hits.length === 2) {
        const y = (terrainHeightAt(i + 0.5, j + 0.5) + 0.18);
        segs.push(hits[0].x, y, hits[0].z, hits[1].x, y, hits[1].z);
      } else if (hits.length === 4) {
        const y = (terrainHeightAt(i + 0.5, j + 0.5) + 0.18);
        segs.push(hits[0].x, y, hits[0].z, hits[1].x, y, hits[1].z);
        segs.push(hits[2].x, y, hits[2].z, hits[3].x, y, hits[3].z);
      }
    }
  }
  return segs;
}

function pickFarProbe(dist) {
  let best = -1, bestD = -1;
  for (let k = 0; k < dist.length; k++) {
    if (dist[k] > 1e8 || blocked[k] || supportNorm(k) < 0.04) continue;
    const quiet = field.traffic[k] < (field.scalars.footfall.max || 1) * 0.12;
    if (!quiet) continue;
    if (dist[k] > bestD) { bestD = dist[k]; best = k; }
  }
  if (best < 0) {
    for (let k = 0; k < dist.length; k++) {
      if (dist[k] > 1e8 || blocked[k]) continue;
      if (dist[k] > bestD) { bestD = dist[k]; best = k; }
    }
  }
  return best;
}

function makeSpriteLabel(title, sub, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = 'rgba(6, 10, 8, 0.55)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.font = '600 32px ui-sans-serif, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(title, 18, 48);
  ctx.font = '20px ui-sans-serif, sans-serif';
  ctx.fillStyle = '#c6e6d0';
  ctx.fillText(sub, 18, 88);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, sizeAttenuation: true,
  }));
  spr.scale.set(11, 2.75, 1);
  return spr;
}

function cellVenue(k) {
  const i = k % field.NX, j = (k / field.NX) | 0;
  return { ...gridToVenue(i + 0.5, j + 0.5), i, j, y: terrainHeightAt(i + 0.5, j + 0.5) };
}

function cellAtVenue(x, z) {
  const g = venueToGrid(x, z);
  const i = Math.round(g.x), j = Math.round(g.y);
  if (i < 0 || j < 0 || i >= field.NX || j >= field.NY) return null;
  return field.idx(i, j);
}

function cellStopRate(k) {
  const dwellMax = field.scalars.dwell?.max || 1;
  return Math.min(1, (field.dwell[k] / dwellMax) * 0.85);
}

function neighborhood(k, radius = 3) {
  const i0 = k % field.NX, j0 = (k / field.NX) | 0;
  let n = 0, dwell = 0, traffic = 0, outlier = 0, speed = 0, purity = 0, stop = 0;
  for (let dj = -radius; dj <= radius; dj++) {
    for (let di = -radius; di <= radius; di++) {
      if (di === 0 && dj === 0) continue;
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= field.NX || j >= field.NY) continue;
      const kk = field.idx(i, j);
      if (field.support[kk] <= 0) continue;
      n++;
      dwell += field.dwell[kk];
      traffic += field.traffic[kk];
      outlier += field.outlier?.[kk] || 0;
      speed += field.speed[kk];
      purity += field.purity[kk];
      stop += cellStopRate(kk);
    }
  }
  if (!n) return null;
  return {
    n,
    dwell: dwell / n,
    traffic: traffic / n,
    outlier: outlier / n,
    speed: speed / n,
    purity: purity / n,
    stop: stop / n,
  };
}

function signedPct(here, near) {
  if (near == null || !Number.isFinite(near)) return '—';
  const d = (here - near) / Math.max(Math.abs(near), 1e-3);
  const pct = Math.round(d * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

function classifyPatch(k) {
  const near = neighborhood(k);
  const here = {
    dwell: field.dwell[k],
    traffic: field.traffic[k],
    outlier: field.outlier?.[k] || 0,
    stop: cellStopRate(k),
    speed: field.speed[k],
    purity: field.purity[k],
  };
  if (!near) {
    return { ...here, near: null, kind: 'even', title: 'This cell', note: 'Not enough neighbours to compare.' };
  }
  let kind = 'even';
  let title = 'Like its neighbours';
  let note = 'No strong local contrast — try a warmer or cooler peak.';
  if (here.traffic > near.traffic * 1.2 && here.dwell < near.dwell * 0.9) {
    kind = 'pass';
    title = 'Pass-by';
    note = 'Busier than the cells around it, but people do not linger. A commute, not a stop.';
  } else if (here.dwell > near.dwell * 1.3 && here.traffic >= near.traffic * 0.7) {
    kind = 'stop';
    title = 'Linger / stop';
    note = 'People stay here more than in the ring around this patch.';
  } else if (here.outlier > near.outlier + 0.12) {
    kind = 'hot';
    title = 'Hot vs nearby';
    note = 'Dwell per passer-by stands out from the aisle that feeds this cell.';
  } else if (here.outlier + 0.12 < near.outlier && here.traffic > near.traffic * 0.8) {
    kind = 'cold';
    title = 'Cool vs nearby';
    note = 'This patch is quieter than the aisle around it — people pass, they do not commit.';
  }
  return { ...here, near, kind, title, note };
}

function cellPatchVerts(k, r = 1) {
  const i = k % field.NX, j = (k / field.NX) | 0;
  const a = gridToVenue(i - r, j - r);
  const b = gridToVenue(i + r + 1, j - r);
  const c = gridToVenue(i + r + 1, j + r + 1);
  const d = gridToVenue(i - r, j + r + 1);
  return [[a.x, a.z], [b.x, b.z], [c.x, c.z], [d.x, d.z]];
}

function snapInteresting(k, radius = 2) {
  const i0 = k % field.NX, j0 = (k / field.NX) | 0;
  let best = k;
  let bestV = Math.abs((field.outlier?.[k] || 0) - (neighborhood(k)?.outlier || 0));
  for (let dj = -radius; dj <= radius; dj++) {
    for (let di = -radius; di <= radius; di++) {
      const i = i0 + di, j = j0 + dj;
      if (i < 0 || j < 0 || i >= field.NX || j >= field.NY) continue;
      const kk = field.idx(i, j);
      if (field.support[kk] <= 0) continue;
      const near = neighborhood(kk);
      const contrast = Math.abs((field.outlier?.[kk] || 0) - (near?.outlier || 0));
      const lift = contrast + Math.min(0.2, field.traffic[kk] / 400);
      if (lift > bestV) { bestV = lift; best = kk; }
    }
  }
  return best;
}

let pinnedCell = null;

function peekCandidates() {
  const linger = [];
  const pass = [];
  for (let k = 0; k < field.NX * field.NY; k++) {
    if (field.support[k] <= 0) continue;
    const o = field.outlier?.[k] || 0;
    const t = field.traffic[k] || 0;
    if (t >= 40 && o >= 0.55) linger.push({ k, v: o * Math.log10(2 + t) });
    if (t >= 70 && o <= 0.28) pass.push({ k, v: t * (1 - o) });
  }
  return {
    linger: clusterPeekCells(linger).slice(0, 4),
    pass: clusterPeekCells(pass).slice(0, 4),
  };
}

/** Adjacent extreme cells are one hill / one commute, not a ring per cell. */
function clusterPeekCells(cells) {
  if (!cells.length) return [];
  const NX = field.NX, NY = field.NY;
  const inSet = new Set(cells.map((c) => c.k));
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  for (const c of cells) parent.set(c.k, c.k);
  for (const c of cells) {
    const i = c.k % NX, j = (c.k / NX) | 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
        const nk = field.idx(ii, jj);
        if (!inSet.has(nk)) continue;
        const a = find(c.k), b = find(nk);
        if (a !== b) parent.set(a, b);
      }
    }
  }
  const groups = new Map();
  for (const c of cells) {
    const r = find(c.k);
    let g = groups.get(r);
    if (!g) {
      g = { cells: [], v: 0, kPeak: c.k, vPeak: -Infinity };
      groups.set(r, g);
    }
    g.cells.push(c);
    g.v += c.v;
    if (c.v > g.vPeak) { g.vPeak = c.v; g.kPeak = c.k; }
  }
  return [...groups.values()].sort((a, b) => b.v - a.v);
}

function clusterGridCentroid(cluster) {
  let wsum = 0, ci = 0, cj = 0;
  for (const c of cluster.cells) {
    const i = (c.k % field.NX) + 0.5;
    const j = ((c.k / field.NX) | 0) + 0.5;
    ci += i * c.v; cj += j * c.v; wsum += c.v;
  }
  if (wsum <= 0) wsum = 1;
  return { ci: ci / wsum, cj: cj / wsum, wsum };
}

function clusterEllipse(cluster) {
  const { ci, cj, wsum } = clusterGridCentroid(cluster);
  let cxx = 0, cxy = 0, cyy = 0;
  for (const c of cluster.cells) {
    const i = (c.k % field.NX) + 0.5 - ci;
    const j = ((c.k / field.NX) | 0) + 0.5 - cj;
    cxx += c.v * i * i; cxy += c.v * i * j; cyy += c.v * j * j;
  }
  cxx /= wsum; cxy /= wsum; cyy /= wsum;
  const tr = cxx + cyy;
  const disc = Math.sqrt(Math.max(0, tr * tr * 0.25 - (cxx * cyy - cxy * cxy)));
  const l1 = tr * 0.5 + disc;
  const l2 = tr * 0.5 - disc;
  const ang = Math.abs(cxy) > 1e-8 ? Math.atan2(l1 - cxx, cxy) : (cxx >= cyy ? 0 : Math.PI / 2);
  const pad = 2.15 * CELL;
  const rx = Math.max(1.05, Math.sqrt(Math.max(l1, 0.18)) * pad);
  const rz = Math.max(0.85, Math.sqrt(Math.max(l2, 0.12)) * pad);
  const center = gridToVenue(ci, cj);
  const along = gridToVenue(ci + Math.cos(ang), cj + Math.sin(ang));
  return {
    ci, cj,
    x: center.x,
    z: center.z,
    y: terrainHeightAt(ci, cj) + 0.1,
    rx, rz,
    rotY: Math.atan2(along.z - center.z, along.x - center.x),
  };
}

function venueDirFromGrid(ci, cj, gx, gy) {
  const a = gridToVenue(ci, cj);
  const b = gridToVenue(ci + gx, cj + gy);
  let dx = b.x - a.x, dz = b.z - a.z;
  const m = Math.hypot(dx, dz) || 1;
  return { dx: dx / m, dz: dz / m };
}

/** Strongest rose bin of the cluster — not the mean, so two-way aisles still point. */
function clusterRoseDir(cluster) {
  const { ci, cj } = clusterGridCentroid(cluster);
  const B = field.B;
  const acc = new Float32Array(B);
  for (const c of cluster.cells) {
    for (let b = 0; b < B; b++) acc[b] += field.rose[c.k * B + b] * c.v;
  }
  let best = 0, bestW = -1;
  for (let b = 0; b < B; b++) if (acc[b] > bestW) { bestW = acc[b]; best = b; }
  const a = (best / B) * Math.PI * 2;
  return { ci, cj, ...venueDirFromGrid(ci, cj, Math.cos(a), Math.sin(a)) };
}

function addPeekPuddle(cluster, strength, labeled) {
  const ell = clusterEllipse(cluster);
  const t = Math.max(0.35, Math.min(1, strength));
  const rx = ell.rx * (0.88 + 0.28 * t);
  const rz = ell.rz * (0.88 + 0.28 * t);
  const holder = new THREE.Group();
  holder.position.set(ell.x, ell.y, ell.z);
  holder.rotation.y = ell.rotY;
  const gold = 0xfbbf24;
  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(1, 32),
    new THREE.MeshBasicMaterial({
      color: gold, side: THREE.DoubleSide, transparent: true,
      opacity: 0.16 + 0.14 * t, depthWrite: false,
    }),
  );
  fill.rotation.x = -Math.PI / 2;
  fill.scale.set(rx, rz, 1);
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(1, 24),
    new THREE.MeshBasicMaterial({
      color: gold, side: THREE.DoubleSide, transparent: true,
      opacity: 0.32 + 0.18 * t, depthWrite: false,
    }),
  );
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.04;
  core.scale.set(rx * 0.38, rz * 0.38, 1);
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(0.86, 1, 32),
    new THREE.MeshBasicMaterial({
      color: gold, side: THREE.DoubleSide, transparent: true,
      opacity: 0.72 + 0.18 * t, depthWrite: false,
    }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.05;
  rim.scale.set(rx, rz, 1);
  holder.add(fill, core, rim);
  holder.userData.cell = cluster.kPeak;
  peekGroup.add(holder);
  if (labeled) {
    const lab = makePeekWord('LINGER', '#fbbf24');
    lab.position.set(ell.x, ell.y + 1.15 + Math.min(0.5, rx * 0.12), ell.z);
    peekGroup.add(lab);
  }
}

function addPeekChevron(x, y, z, dx, dz, scale) {
  const len = 0.95 * scale;
  const half = 0.34 * scale;
  const px = -dz, pz = dx;
  const tipx = x + dx * len * 0.55, tipz = z + dz * len * 0.55;
  const bx = x - dx * len * 0.2, bz = z - dz * len * 0.2;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute([
    tipx, y, tipz,
    bx + px * half, y, bz + pz * half,
    bx - px * half, y, bz - pz * half,
  ], 3));
  const cyan = 0x67e8f9;
  peekGroup.add(new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    color: cyan, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false,
  })));
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute([
    x - dx * len * 0.2, y, z - dz * len * 0.2,
    x - dx * len * 0.72, y, z - dz * len * 0.72,
  ], 3));
  peekGroup.add(new THREE.Line(lg, new THREE.LineBasicMaterial({
    color: cyan, transparent: true, opacity: 0.78, depthWrite: false,
  })));
}

function addPeekChevrons(cluster, strength, labeled) {
  const { ci, cj, dx, dz } = clusterRoseDir(cluster);
  const t = Math.max(0.4, Math.min(1, strength));
  const scale = 0.85 + 0.7 * t;
  let tMin = 0, tMax = 0;
  const origin = gridToVenue(ci, cj);
  for (const c of cluster.cells) {
    const p = cellVenue(c.k);
    const along = (p.x - origin.x) * dx + (p.z - origin.z) * dz;
    if (along < tMin) tMin = along;
    if (along > tMax) tMax = along;
  }
  const span = tMax - tMin;
  const n = span < 2.4 ? 1 : span < 5.2 ? 2 : 3;
  const y = terrainHeightAt(ci, cj) + 0.2;
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? (tMin + tMax) * 0.5 : tMin + (span * (i + 0.5)) / n;
    addPeekChevron(origin.x + dx * u, y, origin.z + dz * u, dx, dz, scale);
  }
  if (labeled) {
    const lab = makePeekWord('PASS-BY', '#67e8f9');
    const mid = (tMin + tMax) * 0.5;
    lab.position.set(origin.x + dx * mid, y + 1.05, origin.z + dz * mid);
    peekGroup.add(lab);
  }
}

function makePeekWord(word, color) {
  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 320, 64);
  ctx.font = '600 34px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(word, 160, 34);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.92,
  }));
  spr.scale.set(3.4, 0.68, 1);
  spr.renderOrder = 8;
  return spr;
}

function addPeekRing(k, color, scale) {
  const p = cellVenue(k);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35 * scale, 0.58 * scale, 28),
    new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(p.x, p.y + 0.28, p.z);
  ring.userData.cell = k;
  peekGroup.add(ring);
}

function rebuildPeekMarks() {
  peekGroup.clear();
  const on = params.scalar === 'outlier' || everydayId === 'hot';
  peekGroup.visible = on;
  if (!on) return;
  const { linger, pass } = peekCandidates();
  const lingerTop = linger[0]?.v || 1;
  const passTop = pass[0]?.v || 1;
  linger.forEach((c, i) => addPeekPuddle(c, c.v / lingerTop, i === 0));
  pass.forEach((c, i) => addPeekChevrons(c, c.v / passTop, i === 0));
  if (pinnedCell != null) addPeekRing(pinnedCell, 0xffffff, 1.35);
}

function isHotView() {
  return everydayId === 'hot' || params.scalar === 'outlier';
}

function isProductRoi(roi) {
  if (!roi || isCheckoutRoi(roi)) return false;
  if (String(roi.id || '').startsWith('patch:')) return false;
  return !!(roi.category);
}

/** Linger vs nearby belongs on Hot/cold only — not every floor click. */
function glanceAllowed(roi) {
  if (everydayId === 'queues' || isCheckoutRoi(roi)) return false;
  return isHotView();
}

function fingerprintRoi(roi) {
  return isProductRoi(roi);
}

function paintGlance() {
  const card = document.getElementById('glance');
  const roiPinned = pinnedCell != null && layersEngine
    ? layersEngine.pickRoi?.(cellVenue(pinnedCell).x, cellVenue(pinnedCell).z)
    : null;
  const on = pinnedCell != null && field.support[pinnedCell] > 0
    && glanceAllowed(roiPinned)
    && !document.documentElement.classList.contains('story-on')
    && !document.documentElement.classList.contains('drill-on');
  document.documentElement.classList.toggle('glance-on', on);
  if (!card || !on) return;
  const info = classifyPatch(pinnedCell);
  const v = cellVenue(pinnedCell);
  const roi = layersEngine?.pickRoi?.(v.x, v.z);
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('glanceTitle', roi ? `${info.title} · ${roi.category || roi.name}` : info.title);
  set('glanceNote', info.note);
  const rows = document.getElementById('glanceRows');
  if (rows) {
    const near = info.near;
    rows.innerHTML = `
      ${hudRow('glance-stop', 'Stop-rate', `${Math.round(info.stop * 100)}%${near ? ` · nearby ${Math.round(near.stop * 100)}%` : ''}`)}
      ${hudRow('glance-dwell', 'Dwell vs nearby', near ? signedPct(info.dwell, near.dwell) : '—')}
      ${hudRow('glance-traffic', 'Traffic vs nearby', near ? signedPct(info.traffic, near.traffic) : '—')}
      ${hudRow('glance-outlier', 'Outlier', `${info.outlier.toFixed(2)}${near ? ` · nearby ${near.outlier.toFixed(2)}` : ''}`)}
      ${hudRow('glance-tracks', 'Tracks here', Math.round(info.traffic).toLocaleString())}`;
  }
  if (explainOn) syncExplainMarks();
  const more = document.getElementById('glanceMore');
  if (more) more.textContent = roi ? 'Open this facing' : 'Pin this patch';
}

function pinPatch(k, roi) {
  if (!glanceAllowed(roi)) {
    pinnedCell = null;
    document.documentElement.classList.remove('glance-on');
    if (roi) commitSelection(roi, { fly: false });
    rebuildPeekMarks();
    paintGlance();
    refreshWhyChip();
    const hint = document.getElementById('hint');
    if (hint) {
      hint.textContent = isCheckoutRoi(roi) || everydayId === 'queues'
        ? (roi
          ? 'Lane selected · click another till or queue for its wait'
          : 'Click a checkout lane for wait and throughput')
        : fingerprintRoi(roi)
          ? 'Bay selected · Why this bay opens the fingerprint'
          : 'Zone selected · fingerprint is for a product facing';
    }
    return;
  }
  pinnedCell = k;
  if (roi) commitSelection(roi, { fly: false });
  else {
    const info = classifyPatch(k);
    commitSelection({
      id: `patch:${k}`,
      name: info.title,
      vertices: cellPatchVerts(k, 1),
    }, { fly: false });
  }
  rebuildPeekMarks();
  paintGlance();
  refreshWhyChip();
  const hint = document.getElementById('hint');
  if (hint) {
    hint.textContent = roi
      ? 'Click again to drill this facing · or pick another hill'
      : 'Click again to go deeper · gold puddles linger, cyan arrows pass-by';
  }
}

function clearPin() {
  pinnedCell = null;
  document.documentElement.classList.remove('glance-on');
  rebuildPeekMarks();
}

function goDeeper() {
  const v = pinnedCell != null ? cellVenue(pinnedCell) : null;
  const roi = v
    ? (layersEngine?.pickRoi?.(v.x, v.z) || layersEngine?.getSelection())
    : layersEngine?.getSelection();
  if (!fingerprintRoi(roi)) return;
  commitSelection(roi, { fly: false });
  window.__ffDrill?.open(roi);
}

function buildReach() {
  clearGroup(reachGroup);
  if (reachSource == null || reachSource < 0 || blocked[reachSource]) {
    reachSource = defaultReachSource();
  }
  reachDist = geodesicFrom(reachSource);
  reachFar = pickFarProbe(reachDist);
  if (reachSource >= 0) {
    const p = cellVenue(reachSource);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.72, 32),
      new THREE.MeshBasicMaterial({ color: 0xff6b6b, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, p.y + 0.22, p.z);
    reachGroup.add(ring);
    const lab = makeSpriteLabel('SOURCE', 'heat / sound origin', '#ff8a8a');
    lab.position.set(p.x, p.y + 2.4, p.z);
    reachGroup.add(lab);
  }
  if (reachFar >= 0) {
    const p = cellVenue(reachFar);
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x7dff9a }),
    );
    dot.position.set(p.x, p.y + 0.5, p.z);
    reachGroup.add(dot);
    const metres = reachDist[reachFar] < 1e8 ? reachDist[reachFar].toFixed(0) : '—';
    const lab = makeSpriteLabel('FAR FIELD', `reach ${metres} m`, '#7dff9a');
    lab.position.set(p.x, p.y + 2.4, p.z);
    reachGroup.add(lab);
  }
  reachGroup.visible = false;
}

function buildWavefronts() {
  clearGroup(waveGroup);
  waveMeshes = [];
  const colors = [0x67e8f9, 0x7dff9a, 0xfacc15];
  for (let w = 0; w < WAVE_COUNT; w++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WAVE_MAX_FLOATS), 3));
    g.setDrawRange(0, 0);
    const mesh = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: colors[w], transparent: true, opacity: 0.85, depthWrite: false,
    }));
    mesh.frustumCulled = false;
    waveGroup.add(mesh);
    waveMeshes.push(mesh);
  }
  waveGroup.visible = params.showHeat;
}

function stepWavefronts(dt) {
  if (!params.showHeat || !reachDist || !waveMeshes.length) {
    waveGroup.visible = false;
    return;
  }
  waveGroup.visible = true;
  wavePhase += dt * WAVE_SPEED;
  for (let w = 0; w < WAVE_COUNT; w++) {
    const iso = ((wavePhase + w * (WAVE_PERIOD_M / WAVE_COUNT)) % WAVE_PERIOD_M) + 1.2;
    const segs = marchingIso(reachDist, iso);
    const mesh = waveMeshes[w];
    const attr = mesh.geometry.attributes.position;
    const n = Math.min(segs.length, WAVE_MAX_FLOATS);
    for (let i = 0; i < n; i++) attr.array[i] = segs[i];
    if (n < attr.array.length) attr.array.fill(0, n);
    attr.needsUpdate = true;
    mesh.geometry.setDrawRange(0, Math.floor(n / 3));
    mesh.material.opacity = 0.88 * (1 - ((iso - 1.2) / WAVE_PERIOD_M));
  }
}

const partitionGroup = new THREE.Group();
scene.add(partitionGroup);
function buildPartitions() {
  clearGroup(partitionGroup);
  let iMin = field.NX, iMax = 0, jMin = field.NY, jMax = 0;
  for (let j = 0; j < field.NY; j++) {
    for (let i = 0; i < field.NX; i++) {
      if (supportNorm(field.idx(i, j)) < 0.05) continue;
      if (i < iMin) iMin = i; if (i > iMax) iMax = i;
      if (j < jMin) jMin = j; if (j > jMax) jMax = j;
    }
  }
  if (iMax <= iMin || jMax <= jMin) { partitionGroup.visible = params.showHeat; return; }
  const iMid = (iMin + iMax) >> 1;
  const jMid = (jMin + jMax) >> 1;
  const names = ['PARTITION B', 'PARTITION C', 'PARTITION D', 'PARTITION E'];
  const rects = [
    [iMin, iMid, jMin, jMid],
    [iMid, iMax, jMin, jMid],
    [iMin, iMid, jMid, jMax],
    [iMid, iMax, jMid, jMax],
  ];
  const edgePts = [];
  for (let r = 0; r < 4; r++) {
    const [ia, ib, ja, jb] = rects[r];
    const nx = Math.max(1, ib - ia), ny = Math.max(1, jb - ja);
    let covered = 0;
    for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) {
      if (supportNorm(field.idx(i, j)) > 0.05) covered++;
    }
    if (covered < 25) continue;
    const c00 = gridToVenue(ia, ja);
    const c10 = gridToVenue(ib, ja);
    const c11 = gridToVenue(ib, jb);
    const c01 = gridToVenue(ia, jb);
    const y = 2.35;
    const ring = [c00, c10, c11, c01];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4];
      edgePts.push(a.x, y, a.z, b.x, y, b.z);
    }
    const cx = (c00.x + c11.x) / 2, cz = (c00.z + c11.z) / 2;
    const lab = makeSpriteLabel(
      names[r],
      `${nx} \u00d7 ${ny} \u00d7 1   \u00b7   ${covered.toLocaleString()} CELLS`,
      '#7dff9a',
    );
    lab.position.set(cx, y + 1.1, cz);
    partitionGroup.add(lab);
  }
  if (edgePts.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineDashedMaterial({
      color: 0x7dff9a, dashSize: 0.85, gapSize: 0.45, transparent: true, opacity: 0.7,
    }));
    lines.computeLineDistances();
    partitionGroup.add(lines);
  }
  partitionGroup.visible = params.showHeat;
}

function applyHeat() {
  if (reachGroup) reachGroup.visible = false;
  if (waveGroup) waveGroup.visible = false;
  if (partitionGroup) partitionGroup.visible = false;
  if (volumeGroup) volumeGroup.visible = !!params.showHeat;
  if (obstacleGroup) obstacleGroup.visible = !!params.showFixtures;
}

function fmtEuro(n) {
  const v = Math.round(n);
  return `\u20ac${Math.abs(v).toLocaleString()}`;
}

function updateInspector() {
  const el = document.getElementById('probes');
  const body = document.getElementById('probesBody') || el;
  if (!el || !layersEngine) return;
  const sel = layersEngine.getSelection();
  if (!sel) { el.style.display = 'none'; return; }
  const info = layersEngine.inspect();
  if (isCheckoutRoi(sel)) {
    const kind = checkoutKind(sel);
    const sib = siblingCheckoutRoi(sel);
    const sibInfo = sib ? layersEngine.inspect(sib) : null;
    const kicker = kind === 'queue' ? 'QUEUE' : kind === 'service' ? 'TILL' : 'CHECKOUT';
    const waitLabel = kind === 'service' ? 'Service time' : 'Avg wait';
    const waitVal = fmtWait(info.dwell);
    const pairLabel = kind === 'queue' ? 'Service time' : 'Queue wait';
    const pairVal = sibInfo ? fmtWait(sibInfo.dwell) : null;
    el.style.display = 'block';
    body.innerHTML = `
      <div class="probe-title">ZONE</div>
      ${hudRow('zone-name', 'Name', sel.name || 'Checkout')}
      ${hudRow('zone-area', 'Area', `${info.area.toFixed(0)} m\u00b2`)}
      ${hudRow('zone-cells', 'Cells', info.cells)}
      <div class="probe-title" style="margin-top:8px">${kicker}</div>
      ${hudRow('zone-wait', waitLabel, waitVal)}
      ${hudRow('zone-through', 'People through', Math.round(info.footfall).toLocaleString())}
      ${pairVal ? hudRow('zone-wait', pairLabel, pairVal) : ''}
      ${hudRow('zone-speed', 'Walking speed', `${info.speed.toFixed(2)} m/s`)}
      <div class="hud-note">Wait is mean dwell in this lane. Throughput is unique tracks in the window. Stop-rate is a shelf metric, so it stays off here.</div>`;
    if (explainOn) syncExplainMarks();
    return;
  }
  const catList = Object.entries(info.cats).sort((a, b) => b[1] - a[1]);
  const catHtml = catList.length
    ? catList.map(([c, n]) => `<div class="hud-row"><span>${c}</span><b>${n} cells</b></div>`).join('')
    : `<div class="hud-row"><span>Categories</span><b>uncategorised</b></div>`;
  const mediaScreens = info.screensHit.map((s) => s.name.replace('Digital Display ', 'Screen ')).join(', ') || 'none';
  const mediaSpk = info.speakersHit.map((s) => s.id).join(', ') || 'none';
  const liveEuro = info.profitBasis === 'LIVE';
  const euro = info.euroDay || 0;
  const profitHtml = euro <= 0.5
    ? `<div class="probe-title" style="margin-top:8px">PROFIT</div>
    ${hudRow('zone-leakage', 'Margin leakage / day', '\u2014')}
    <div class="hud-note">No category margin on this zone (uncategorised, checkout, or entrance).</div>`
    : liveEuro
    ? `<div class="probe-title" style="margin-top:8px">PROFIT</div>
    ${hudRow('zone-leakage', 'Recoverable / day', fmtEuro(euro))}
    ${hudRow('zone-euro-m2', 'Per m\u00b2 / day', `${fmtEuro(info.euroM2)}/m\u00b2`)}
    ${hudRow('zone-basis', 'Basis', '<span class="badge">LIVE</span>')}`
    : `<div class="probe-title" style="margin-top:8px">PROFIT</div>
    ${hudRow('zone-leakage', 'Leakage / day', `${fmtEuro(euro)} <span class="badge">modelled</span>`)}
    ${hudRow('zone-euro-m2', 'Per m\u00b2 / day', `${fmtEuro(info.euroM2)}/m\u00b2`)}
    <div class="hud-note">Traffic \u00d7 engagement-gap \u00d7 category margin \u2014 not till scans. Profit Radar LIVE replaces this when the bay is attached.</div>`;
  const vis = categoryVisual(sel.category);
  const catChip = sel.category
    ? `<div class="cat-chip">
        <span class="cat-glyph" style="background:${vis.bg}">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="${vis.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${vis.paths.map((d) => `<path d="${d}"/>`).join('')}</svg>
        </span>
        <b>${sel.category}</b>
      </div>`
    : '';
  el.style.display = 'block';
  body.innerHTML = `
    <div class="probe-title">ZONE</div>
    ${catChip}
    ${hudRow('zone-name', 'Name', sel.name || 'Custom')}
    ${hudRow('zone-area', 'Area', `${info.area.toFixed(0)} m\u00b2`)}
    ${hudRow('zone-cells', 'Cells', info.cells)}
    ${profitHtml}
    <div class="probe-title" style="margin-top:8px">MERCH</div>
    ${catHtml}
    <div class="probe-title" style="margin-top:8px">BEHAVIOUR</div>
    ${hudRow('zone-footfall', 'Footfall', `${Math.round(info.footfall).toLocaleString()} tracks`)}
    ${hudRow('zone-dwell', 'Mean dwell', `${Math.round(info.dwell)} s`)}
    ${hudRow('zone-speed', 'Walking speed', `${info.speed.toFixed(2)} m/s`)}
    ${hudRow('zone-stop', 'Stop-rate', `${Math.round((info.engagement || 0) * 100)}%`)}
    <div class="probe-title" style="margin-top:8px">MEDIA</div>
    ${hudRow('kpi-screens', 'Screens', mediaScreens)}
    ${hudRow('kpi-screens', 'Speakers', mediaSpk)}
    ${hudRow('kpi-sez', 'SEZ coverage', `${(info.sezPct * 100).toFixed(0)}%`)}
    ${hudRow('kpi-sez', 'Listen coverage', `${(info.listenPct * 100).toFixed(0)}%`)}
    ${hudRow('kpi-eal', 'EAL (sim)', `${(info.eal * 100).toFixed(0)}%`)}
    ${hudRow('kpi-ces', 'CES (sim)', info.ces.toFixed(2))}
    <div class="hud-note">${info.pebleBadge} \u00b7 PEBLE is modelled from SEZ / listen-zone \u00d7 nearby categorised shelves, not a live campaign.</div>`;
  if (explainOn) syncExplainMarks();
}

function productImageUrl(p) {
  if (p.imageUrl && /^https?:\/\//i.test(p.imageUrl) && !/\/displayable\/.*\.webp/i.test(p.imageUrl)) {
    return p.imageUrl;
  }
  if (p.skuCode && /^\d{5,7}$/.test(String(p.skuCode))) {
    return `https://images.services.esselunga.it/html/img_prodotti/esselunga/big/${p.skuCode}.jpg`;
  }
  return null;
}

function fmtPrice(n) {
  if (n == null || Number.isNaN(Number(n))) return '';
  return `\u20ac${Number(n).toFixed(2)}`;
}

const productCache = new Map();
let productFetchSeq = 0;

async function fetchRoiProducts(roiId) {
  if (productCache.has(roiId)) return productCache.get(roiId);
  const infoRes = await fetch(`/api/roi/${roiId}/shelf-info`, { credentials: 'include' });
  if (!infoRes.ok) { productCache.set(roiId, []); return []; }
  const info = await infoRes.json();
  if (!info?.shelfId || !info?.planogramId) { productCache.set(roiId, []); return []; }
  const expRes = await fetch(`/api/planogram/planograms/${info.planogramId}/export`, { credentials: 'include' });
  if (!expRes.ok) { productCache.set(roiId, []); return []; }
  const exp = await expRes.json();
  const shelf = (exp.shelves || []).find((s) => s.shelfId === info.shelfId);
  const skuDetails = exp.skuDetails || {};
  const seen = new Set();
  const list = [];
  const levels = shelf?.slots?.levels || [];
  for (const lvl of levels) {
    for (const slot of (lvl?.slots || [])) {
      const id = slot?.skuItemId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const sku = skuDetails[id];
      if (!sku) continue;
      list.push({
        id,
        name: sku.name || 'SKU',
        brand: sku.brand,
        price: sku.price,
        category: sku.category,
        skuCode: sku.skuCode || sku.sku_code,
        imageUrl: sku.imageUrl || sku.image_url,
        shelfName: info.shelfName || '',
      });
    }
  }
  productCache.set(roiId, list);
  return list;
}

function roiIdsForSelection(sel) {
  if (!sel) return [];
  if (sel.id && sel.id !== 'custom') return [sel.id];
  const verts = sel.vertices;
  if (!verts?.length) return [];
  const ids = [];
  for (const roi of layersPack.rois) {
    if (!roi.id) continue;
    const hit = pointInPoly(roi.cx, roi.cz, verts)
      || (roi.vertices || []).some((p) => pointInPoly(p[0], p[1], verts));
    if (hit) ids.push(roi.id);
  }
  return ids;
}

function hideProductGallery() {
  const el = document.getElementById('products');
  if (el) el.style.display = 'none';
}

async function updateProductGallery() {
  const el = document.getElementById('products');
  const body = document.getElementById('productsBody') || el;
  if (!el || !layersEngine) return;
  const sel = layersEngine.getSelection();
  if (!sel || !params.showCategory || storyActive || isCheckoutRoi(sel)) { hideProductGallery(); return; }
  const seq = ++productFetchSeq;
  const roiIds = roiIdsForSelection(sel);
  el.style.display = 'block';
  body.innerHTML = `<div class="empty">Loading shelf SKUs\u2026</div>`;
  let products = [];
  try {
    const lists = await Promise.all(roiIds.map((id) => fetchRoiProducts(id).catch(() => [])));
    const seen = new Set();
    for (const list of lists) {
      for (const p of list) {
        const key = p.skuCode || p.id;
        if (seen.has(key)) continue;
        seen.add(key);
        products.push(p);
      }
    }
  } catch {
    products = [];
  }
  if (seq !== productFetchSeq) return;
  if (!layersEngine.getSelection() || !params.showCategory) { hideProductGallery(); return; }
  const cat = sel.category || '';
  const head = el.querySelector('.panel-head .hud-kicker, .panel-head h1');
  if (!products.length) {
    if (head) head.textContent = 'Products';
    body.innerHTML = `
      <div class="empty">${cat ? `No planogram SKUs for ${cat}.` : 'No planogram linked to this zone.'} Sign in on app.hyspace.app if the shelf is populated in Profit Radar.</div>`;
    return;
  }
  if (head) head.textContent = `Products · ${products.length}${cat ? ' · ' + cat : ''}`;
  body.innerHTML = `
    ${products.map((p) => {
      const img = productImageUrl(p);
      const thumb = img
        ? `<img src="${img}" alt="" loading="lazy" onerror="this.parentNode.innerHTML='<span class=noimg>NO IMG</span>'" />`
        : `<span class="noimg">NO IMG</span>`;
      const loc = [p.shelfName, p.brand, p.category].filter(Boolean).join(' \u00b7 ');
      return `<div class="sku-card">
        <div class="sku-thumb">${thumb}</div>
        <div class="sku-body">
          <div class="sku-name">${escapeHtml(p.name)}</div>
          ${p.skuCode ? `<div class="sku-code">${escapeHtml(String(p.skuCode))}</div>` : ''}
          <div class="sku-row">
            <div class="sku-meta">${escapeHtml(loc)}</div>
            <div class="sku-price">${fmtPrice(p.price)}</div>
          </div>
        </div>
      </div>`;
    }).join('')}`;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function rebuildPhysicsLayers() {
  rasterizeObstacles();
  buildObstacles();
  buildVolume();
  applyHeat();
  if (layersEngine) layersEngine.rebuild();
  refreshTicker();
}

let camAnim = null;
function flyToSelection(mode = 'plan') {
  if (!layersEngine) return;
  const c = layersEngine.selectionCenter();
  if (!c) return;
  const span = Math.max(c.span, 8);
  const dx = Math.max(4, c.dx || span);
  const dz = Math.max(4, c.dz || span);
  const alongX = dx >= dz;
  let toTgt;
  let toPos;
  if (mode === 'rise') {
    // Side-on furnace: gold trails need vertical length on screen, not a view
    // up the pipe. Camera at chimney mid-height, pulled back along the aisle.
    const back = Math.max(22, span * 2.15);
    toTgt = new THREE.Vector3(c.cx, 4.0, c.cz);
    toPos = alongX
      ? new THREE.Vector3(c.cx - back * 0.28, 5.5, c.cz + back)
      : new THREE.Vector3(c.cx + back, 5.5, c.cz - back * 0.28);
  } else if (mode === 'rudder') {
    const screen = layersEngine.pack?.screens?.[0];
    const bay = c;
    if (screen) {
      const dx = bay.cx - screen.x, dz = bay.cz - screen.z;
      const mag = Math.hypot(dx, dz) || 1;
      toTgt = new THREE.Vector3(bay.cx, 1.15, bay.cz);
      toPos = new THREE.Vector3(
        screen.x - (dx / mag) * 8,
        7.2,
        screen.z - (dz / mag) * 8,
      );
    } else {
      toTgt = new THREE.Vector3(c.cx, 1.2, c.cz);
      toPos = new THREE.Vector3(c.cx - 16, 7.2, c.cz + 10);
    }
  } else if (mode === 'aisle') {
    // Low look along the long axis so streamlines read as a commute, not as
    // carpet texture. Pull back far enough to include the feeding aisle.
    const back = Math.max(18, span * 1.45);
    const side = Math.max(4.2, Math.min(dx, dz) * 0.4 + 3.2);
    toTgt = new THREE.Vector3(c.cx, 1.2, c.cz);
    toPos = alongX
      ? new THREE.Vector3(c.cx - back, 6.8, c.cz + side)
      : new THREE.Vector3(c.cx + side, 6.8, c.cz - back);
  } else {
    toTgt = new THREE.Vector3(c.cx, 0, c.cz);
    toPos = new THREE.Vector3(
      c.cx + Math.max(10, c.span * 0.55),
      Math.max(14, c.span * 1.15),
      c.cz + Math.max(10, c.span * 0.8),
    );
  }
  camAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTgt: controls.target.clone(),
    toTgt,
    toPos,
  };
}

function flyHome() {
  camAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTgt: controls.target.clone(),
    toTgt: new THREE.Vector3(planCenter.x, 0, planCenter.z),
    toPos: new THREE.Vector3(
      planCenter.x + VENUE_SPAN * 0.42,
      VENUE_SPAN * 0.72,
      planCenter.z + VENUE_SPAN * 0.95,
    ),
  };
}

function flyWind() {
  // Story beat 1 — look across the dwell mountains so streamlines read as wind,
  // not as a top-down carpet. Same pose as the report "low" capture.
  camAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTgt: controls.target.clone(),
    toTgt: new THREE.Vector3(
      planCenter.x - VENUE_W * 0.05,
      params.terrainHeight * 0.15,
      planCenter.z - VENUE_D * 0.05,
    ),
    toPos: new THREE.Vector3(
      planCenter.x + VENUE_SPAN * 0.55,
      VENUE_SPAN * 0.38,
      planCenter.z + VENUE_SPAN * 0.72,
    ),
  };
}

function flyOblique() {
  // Report "low" pose: shallow elevation so streamlines have length on screen
  // instead of reading as a top-down carpet over fixtures and dwell relief.
  camAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTgt: controls.target.clone(),
    toTgt: new THREE.Vector3(
      planCenter.x - VENUE_W * 0.08,
      2.2,
      planCenter.z - VENUE_D * 0.04,
    ),
    toPos: new THREE.Vector3(
      planCenter.x + VENUE_SPAN * 0.74,
      VENUE_SPAN * 0.26,
      planCenter.z + VENUE_SPAN * 0.32,
    ),
  };
}

function flyToPoint(x, z, span = 18) {
  camAnim = {
    t: 0,
    fromPos: camera.position.clone(),
    fromTgt: controls.target.clone(),
    toTgt: new THREE.Vector3(x, 0, z),
    toPos: new THREE.Vector3(
      x + Math.max(10, span * 0.55),
      Math.max(14, span * 1.15),
      z + Math.max(10, span * 0.8),
    ),
  };
}

let tickerFactsCache = [];
let tickerIdx = 0;
let tickerTimer = null;
let tickerPaused = false;
const TICKER_HOLD_MS = 6500;

function tickerBadgeClass(badge) {
  const raw = String(badge || 'HEURISTIC');
  if (raw.startsWith('LIVE')) return 'LIVE';
  if (raw.startsWith('SIMULATED')) return 'SIMULATED';
  if (raw.includes('GEOMETRY')) return 'GEOMETRY';
  return 'HEURISTIC';
}

function beatHtml(beat) {
  const cls = tickerBadgeClass(beat.badge);
  return `<button type="button" class="ticker-beat" data-id="${escapeHtml(beat.id)}" data-tone="${escapeHtml(beat.tone || 'gold')}">
    <span class="ticker-topline">
      <span class="ticker-kicker">${escapeHtml(beat.kicker)}</span>
      <span class="ticker-badge ${cls}">${escapeHtml(beat.badge)}</span>
    </span>
    <span class="ticker-text">${escapeHtml(beat.text)}</span>
  </button>`;
}

function stopTickerLoop() {
  if (tickerTimer) { clearInterval(tickerTimer); tickerTimer = null; }
}

function mountTickerBeat(index, slideIn) {
  const stage = document.getElementById('tickerStage');
  if (!stage || !tickerFactsCache.length) return;
  tickerIdx = ((index % tickerFactsCache.length) + tickerFactsCache.length) % tickerFactsCache.length;
  const incoming = document.createElement('div');
  incoming.innerHTML = beatHtml(tickerFactsCache[tickerIdx]);
  const next = incoming.firstElementChild;
  const current = stage.querySelector('.ticker-beat.in');
  stage.appendChild(next);
  if (!slideIn) {
    next.classList.add('in');
    if (current) current.remove();
    return;
  }
  if (current) current.classList.add('leave');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => next.classList.add('in'));
  });
  if (current) {
    current.addEventListener('transitionend', () => current.remove(), { once: true });
    setTimeout(() => current.remove(), 900);
  }
}

function advanceTicker() {
  if (tickerPaused || !params.showTicker || tickerFactsCache.length < 2) return;
  mountTickerBeat(tickerIdx + 1, true);
}

function startTickerLoop() {
  stopTickerLoop();
  if (!params.showTicker || tickerFactsCache.length < 2) return;
  tickerTimer = setInterval(advanceTicker, TICKER_HOLD_MS);
}

function refreshTicker() {
  const stage = document.getElementById('tickerStage');
  const bar = document.getElementById('ticker');
  if (!stage || !bar) return;
  const on = !!params.showTicker;
  document.documentElement.classList.toggle('ticker-on', on);
  bar.setAttribute('aria-hidden', on ? 'false' : 'true');
  stopTickerLoop();
  if (!on || !layersEngine) {
    stage.innerHTML = '';
    tickerFactsCache = [];
    return;
  }
  tickerFactsCache = layersEngine.tickerFacts(SLICE_LABELS[sliceId]);
  tickerIdx = 0;
  stage.innerHTML = '';
  mountTickerBeat(0, true);
  startTickerLoop();
}

function onTickerClick(e) {
  const btn = e.target.closest?.('.ticker-beat');
  if (!btn || !layersEngine || storyActive) return;
  const beat = tickerFactsCache.find((b) => b.id === btn.dataset.id);
  if (!beat) return;
  applyInsightChecks(beat.layers || {});
  if (beat.fly === 'screen') {
    const sc = (layersEngine.pack?.screens || []).find((s) => s.id === beat.roiId)
      || layersEngine.pack?.screens?.[0];
    storyClearZone();
    if (sc) flyToPoint(sc.x, sc.z, 22);
    return;
  }
  if (beat.fly === 'home') {
    storyClearZone();
    flyHome();
    return;
  }
  const roi = (layersEngine.pack?.rois || []).find((r) => r.id === beat.roiId);
  if (roi) {
    commitSelection(roi);
    if (beat.camera === 'rise') flyToSelection('rise');
  }
}

const STORY_RUNG_COLOR = {
  OBSERVE: '#3b82f6',
  SENSE: '#3b82f6',
  ALERT: '#e0a83e',
  EXPLAIN: '#e0a83e',
  QUANTIFY: '#3ea06b',
  RECOMMEND: '#3ea06b',
};

const VIEW_PRESETS = [
  {
    id: 'media-rudder',
    note: 'Did the screen change heading toward the advertised shelf? Purity is commitment; media trails are the intended vector; the cone is who could have seen it.',
    slice: 'evening', scalar: 'purity',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: true, speakers: false, profit: false, media: true, category: false,
    zone: 'media', camera: 'rudder', curtain: true,
  },
  {
    id: 'media-stop',
    note: 'Heading toward the bay is not conversion. Dwell on the facing after the cone is the stop — the other half of PEBLE.',
    slice: 'evening', scalar: 'dwell',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: true, speakers: false, profit: false, media: true, category: false,
    camera: 'screen',
  },
  {
    id: 'media-blind',
    note: 'Coverage, not conversion. Footfall in the cone vs the PA rings: how many journeys the glass never sees.',
    slice: 'all', scalar: 'footfall',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: true, speakers: true, profit: false, media: false, category: false,
    camera: 'oblique',
  },
  {
    id: 'trap',
    note: 'High traffic, low stop — that is the outlier ratio. Category colour stays off so the ratio remains visible. The selected bay is the worst commute.',
    slice: 'evening', scalar: 'outlier',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: false, speakers: false, profit: false, media: false, category: false,
    zone: 'trap', camera: 'aisle', terrainHeight: 3.5, curtain: true,
  },
  {
    id: 'chimney',
    note: 'Recoverable margin leaving the facing. Streamlines, heat and media stay off so the gold chimney can be read. Category names the family.',
    slice: 'evening', scalar: 'dwell',
    flow: false, terrain: true, arrows: false, heat: false,
    screen: false, speakers: false, profit: true, media: false, category: true,
    zone: 'trap', camera: 'rise', terrainHeight: 2.5, peakGlow: true,
  },
  {
    id: 'shop-works',
    note: 'Through-route, dwell node, one-way spine, two-way aisle. Regime already compresses dwell, traffic and purity — insight layers would be a second story.',
    slice: 'all', scalar: 'regime',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: false, speakers: false, profit: false, media: false, category: false,
    camera: 'oblique', isoline: true,
  },
  {
    id: 'consolidation',
    note: 'Negative divergence is a sink — tills, fresco, promo ends. Mean arrows stay off: they cancel on the two-way floor that feeds the sink.',
    slice: 'all', scalar: 'convergence',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: false, speakers: false, profit: false, media: false, category: false,
    camera: 'oblique',
  },
  {
    id: 'evening-rewrite',
    note: 'The planogram did not move; the field did. The signed shift is morning vs evening on one carpet — isolate the rewrite before attaching a lever.',
    slice: 'all', scalar: 'shift_me',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: false, speakers: false, profit: false, media: false, category: false,
    camera: 'oblique', isoline: true,
  },
  {
    id: 'weekend-rewrite',
    note: 'Weekend is a different trip mission. The carpet is the weekday→weekend rewrite; category colour stays off so the shift remains visible.',
    slice: 'all', scalar: 'shift_ww',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: false, speakers: false, profit: false, media: false, category: false,
    camera: 'oblique', isoline: true,
  },
  {
    id: 'screen-commute',
    note: 'A high-purity cell in the cone is a through-route. People are already committed — the cheap test before Media → shelf can invent a lift.',
    slice: 'evening', scalar: 'purity',
    flow: true, terrain: true, arrows: false, heat: false,
    screen: true, speakers: false, profit: false, media: false, category: false,
    camera: 'screen',
  },
];

const STORY_BEATS = [
  {
    id: 'wind',
    time: '08:00', period: 'Morning', rung: 'OBSERVE', persona: 'Everyone',
    title: 'The floor is a wind field',
    floor: 'A manager sees a busy store and a gut feeling. Nobody can point to which aisle is actually working.',
    hyperspace: 'Anonymous journeys become a continuous wind field \u2014 not dots, not cameras. Streamlines are people; dwell relief is where they linger.',
    outcome: 'Live flow \u00b7 100% anonymous',
    component: 'People-flow field',
    slice: 'all', zone: null,
    layers: { isoline: true },
    camera: 'wind',
    autoAdvanceMs: 14000,
  },
  {
    id: 'evening',
    time: '19:00', period: 'Evening', rung: 'SENSE', persona: 'Store director',
    title: 'Evening is a different store',
    floor: 'The planogram did not move. The shop did. Evening traffic is a different P&L.',
    hyperspace: 'The same fixtures, a new field. Switching to 19\u201322 rewrites dwell and heading without touching the CAD.',
    outcome: 'Time window changes the P&L',
    component: 'Evening 19\u201322',
    slice: 'evening', zone: null,
    layers: { isoline: true },
    camera: 'wind',
    autoAdvanceMs: 14000,
  },
  {
    id: 'trap',
    time: '19:20', period: 'Evening', rung: 'ALERT', persona: 'Merchandising',
    title: 'They pass \u2014 they do not stop',
    floor: 'The aisle looks fine. The bay is a commute: people walk it, they do not commit.',
    hyperspace: 'Category colour plus the engagement-trap ROI. High footfall, stop-rate far below the 45% healthy line. The lever is layout / speed-bump.',
    outcome: 'Trap bay \u00b7 layout / speed-bump',
    component: 'Category colour \u00b7 people flow',
    slice: 'evening', zone: 'trap',
    layers: { category: true, curtain: true },
    camera: 'aisle',
    autoAdvanceMs: 14000,
  },
  {
    id: 'margin',
    time: '19:35', period: 'Evening', rung: 'QUANTIFY', persona: 'Category / CFO',
    title: 'Margin leaving the shelf',
    floor: 'The leak is invisible on a spreadsheet. The facing looks stocked.',
    hyperspace: 'Same bay, different physics: people-flow drops away and recoverable margin leaves straight up \u2014 a gold chimney off the facing, not a drift to the tills.',
    outcome: 'Recoverable \u20ac / day on this window',
    component: 'Profit evaporate',
    slice: 'evening', zone: 'trap',
    layers: { profit: true, flow: false, peakGlow: true },
    camera: 'rise',
    autoAdvanceMs: 16000,
  },
  {
    id: 'margin-why',
    time: '19:38', period: 'Evening', rung: 'EXPLAIN', persona: 'Category / CFO',
    title: 'Why this bay leaks',
    floor: 'A chimney is a symptom. The facing still looks stocked.',
    hyperspace: 'Behavioral fingerprint versus the store average. Hidden value as a range. Four levers with match % and an effort slider \u2014 recovery is priced before anyone moves a fixture.',
    outcome: 'Fingerprint \u00b7 \u20ac min\u2013max / day',
    component: 'Margin drill-down \u00b7 Why',
    slice: 'evening', zone: 'trap',
    layers: { profit: true, flow: false, peakGlow: true },
    camera: 'rise',
    drill: 'why',
    autoAdvanceMs: 18000,
  },
  {
    id: 'margin-who',
    time: '19:42', period: 'Evening', rung: 'EXPLAIN', persona: 'Merchandising',
    title: 'Who is leaking this',
    floor: 'The bay is not \u201ceveryone\u201d. The leak is the cluster that matches this facing\u2019s fingerprint.',
    hyperspace: 'Every ID that entered this zone, grouped by fingerprint cluster. The default list is the dominant leak status \u2014 not two demo people.',
    outcome: 'Cluster in this zone',
    component: 'Margin drill-down \u00b7 Who',
    slice: 'evening', zone: 'trap',
    layers: { profit: true, flow: false, peakGlow: true },
    camera: 'rise',
    drill: 'who',
    autoAdvanceMs: 14000,
  },
  {
    id: 'margin-id',
    time: '19:45', period: 'Evening', rung: 'EXPLAIN', persona: 'Merchandising',
    title: 'One shopper, full kinematics',
    floor: 'A list of IDs is not an explanation. You need the path.',
    hyperspace: 'Trajectory microscope: v, \u03b8, \u03c9, a, \u03ba, S, L, \u03c4, the velocity arrow on the head, and the shopper radar. Levers stay at the bay.',
    outcome: '1\u00d7 replay \u00b7 demo trail',
    component: 'Margin drill-down \u00b7 One ID',
    slice: 'evening', zone: 'trap',
    layers: { profit: true, flow: false, peakGlow: true },
    camera: 'rise',
    drill: 'id',
    moment: 'hesitation',
    autoAdvanceMs: 18000,
  },
  {
    id: 'screen',
    time: '19:50', period: 'Evening', rung: 'EXPLAIN', persona: 'Retail media',
    title: 'The screen is seen. The shelf is not.',
    floor: 'Marketing counts impressions. The glass is on. Conversion is assumed.',
    hyperspace: 'Screen Exposure Zone plus Media \u2192 shelf. Post-Exposure Behavioral Lift Engine asks whether the cone moved anyone to Pesce, Frutta, Carne or Gastronomia.',
    outcome: 'Exposure-to-Action Lift \u00b7 SIMULATED',
    component: 'Screen FOV \u00b7 Media \u2192 shelf',
    slice: 'evening', zone: 'screen',
    layers: { screen: true, media: true },
    autoAdvanceMs: 16000,
  },
  {
    id: 'audio',
    time: '20:05', period: 'Evening', rung: 'EXPLAIN', persona: 'Retail media',
    title: 'Speakers reach aisles the screen never sees',
    floor: 'Whole aisles never enter the screen cone. The PA is covering people the display cannot.',
    hyperspace: 'Rings are the listen zone at 58 dBA and above. They stop on shelf faces and wrap the gondolas \u2014 the floor the screen never touched.',
    outcome: 'Aisles the screen misses \u00b7 58 dBA',
    component: 'Speaker reach',
    slice: 'evening', zone: null,
    layers: { speakers: true },
    autoAdvanceMs: 16000,
  },
  {
    id: 'move',
    time: '20:20', period: 'Evening', rung: 'RECOMMEND', persona: 'Director + merch',
    title: 'One move, priced',
    floor: 'A manager wants an instruction, not another dashboard.',
    hyperspace: 'The highest-\u20ac bay, the recommended lever, expected \u20ac/day and \u20ac/year. Fix here first.',
    outcome: 'One lever \u00b7 \u20ac / day \u00b7 \u20ac / year',
    component: 'Profit evaporate \u00b7 ROI zoom',
    slice: 'evening', zone: 'move',
    layers: { category: true, profit: true },
    camera: 'rise',
    autoAdvanceMs: 16000,
  },
];

let storyActive = false;
let storyIndex = 0;
let storyPlaying = false;
let storyBusy = false;
let storyTimer = null;
let storySnap = null;
let storyMomentOverride = null;

function syncCheck(id, on) {
  const el = document.getElementById(id);
  if (el) el.checked = !!on;
}

function applyInsightChecks(ins = {}) {
  params.showScreenFov = !!ins.screen; syncCheck('showScreenFov', ins.screen);
  params.showSpeakers = !!ins.speakers; syncCheck('showSpeakers', ins.speakers);
  if (ins.profit === false) {
    params.showProfit = false;
    syncCheck('showProfit', false);
  } else if (ins.profit) {
    params.showProfit = true;
    syncCheck('showProfit', true);
  }
  params.showMedia = !!ins.media; syncCheck('showMedia', ins.media);
  params.showCategory = !!ins.category; syncCheck('showCategory', ins.category);
  applyHeat();
  layersEngine?.applyVisibility();
  rebuildTerrain();
  updateLegend();
  refreshRudderHud();
  refreshWhyChip();
}

function applyReadingChecks(ins = {}) {
  params.showIsoline = !!ins.isoline; syncCheck('showIsoline', params.showIsoline);
  params.showPeakGlow = !!ins.peakGlow; syncCheck('showPeakGlow', params.showPeakGlow);
  params.showCurtain = !!ins.curtain; syncCheck('showCurtain', params.showCurtain);
}

function applyStoryLayers(ins = {}) {
  markPresetCustom();
  const flowOn = ins.flow !== false;
  const flow = document.getElementById('showFlow');
  if (flow) flow.checked = flowOn;
  if (lineMesh) lineMesh.visible = flowOn;
  params.dwellDrag = true; syncCheck('dwellDrag', true);
  params.showArrows = false; syncCheck('showArrows', false); if (arrowGroup) arrowGroup.visible = false;
  params.showPlan = true; syncCheck('showPlan', true); if (planGroup) planGroup.visible = true;
  params.showFixtures = true; syncCheck('showFixtures', true); if (obstacleGroup) obstacleGroup.visible = true;
  params.planMirror = false; syncCheck('planMirror', false);
  params.showTerrain = true; syncCheck('showTerrain', true);
  params.terrainHeight = 6;
  const th = document.getElementById('terrainHeight');
  const thv = document.getElementById('terrainHeightVal');
  if (th) th.value = '6';
  if (thv) thv.textContent = '6.0 m';
  params.showHeat = false; syncCheck('showHeat', false);
  params.showTicker = false; syncCheck('showTicker', false);
  applyReadingChecks(ins);
  applyInsightChecks(ins);
  hideProductGallery();
  refreshTicker();
}

let applyingPreset = false;
let applyingEveryday = false;
let everydayId = '';
let tourOn = false;
let explainOn = false;
let explainKey = 'idle';
let explainPinned = false;
let tourIndex = 0;

function markPresetCustom() {
  if (applyingPreset || applyingEveryday) return;
  const sel = document.getElementById('viewPreset');
  if (sel && sel.value) sel.value = '';
  const note = document.getElementById('viewPresetNote');
  if (note && sel && !sel.value) {
    note.textContent = 'Custom — mix freely. Pick a guided view to apply a coherent bundle.';
  }
  everydayId = '';
  paintEverydayChips();
}

function stopStoryForPreset() {
  if (!storyActive) return;
  stopStoryTimer();
  storyActive = false;
  storyPlaying = false;
  window.__ffDrill?.close();
  document.documentElement.classList.remove('story-on');
  paintStoryTransport();
  storySnap = null;
}

async function applyViewPreset(id) {
  const preset = VIEW_PRESETS.find((p) => p.id === id);
  const note = document.getElementById('viewPresetNote');
  const sel = document.getElementById('viewPreset');
  if (!preset) {
    if (sel) sel.value = '';
    if (note) note.textContent = 'Custom — mix freely. Pick a guided view to apply a coherent bundle.';
    return;
  }
  applyingPreset = true;
  try {
    everydayId = '';
    paintEverydayChips();
    stopStoryForPreset();
    if (preset.slice) await switchSlice(preset.slice);
    if (preset.scalar) await setScalar(preset.scalar);

    const flowOn = preset.flow !== false;
    const flow = document.getElementById('showFlow');
    if (flow) flow.checked = flowOn;
    if (lineMesh) lineMesh.visible = flowOn;
    params.dwellDrag = true; syncCheck('dwellDrag', true);
    params.showArrows = !!preset.arrows;
    syncCheck('showArrows', params.showArrows);
    if (arrowGroup) arrowGroup.visible = params.showArrows;
    params.showPlan = true; syncCheck('showPlan', true);
    if (planGroup) planGroup.visible = true;
    params.showFixtures = true; syncCheck('showFixtures', true);
    if (obstacleGroup) obstacleGroup.visible = true;
    params.showTerrain = preset.terrain !== false;
    syncCheck('showTerrain', params.showTerrain);
    params.showHeat = !!preset.heat;
    syncCheck('showHeat', params.showHeat);
    params.terrainHeight = preset.terrainHeight != null ? preset.terrainHeight : 6;
    const th = document.getElementById('terrainHeight');
    const thv = document.getElementById('terrainHeightVal');
    if (th) th.value = String(params.terrainHeight);
    if (thv) thv.textContent = params.terrainHeight.toFixed(1) + ' m';
    applyReadingChecks(preset);
    applyInsightChecks({
      screen: !!preset.screen,
      speakers: !!preset.speakers,
      profit: !!preset.profit,
      media: !!preset.media,
      category: !!preset.category,
    });
    buildArrows();
    if (preset.category) void updateProductGallery();
    else hideProductGallery();
    refreshTicker();

    const targets = layersEngine?.storyTargets?.() || {};
    if (preset.zone === 'trap' && targets.trap) {
      commitSelection(targets.trap, { fly: false });
      flyToSelection(preset.camera || 'aisle');
    } else if (preset.zone === 'move' && targets.move) {
      commitSelection(targets.move, { fly: false });
      flyToSelection(preset.camera || 'plan');
    } else if (preset.camera === 'rudder' || preset.zone === 'media') {
      const bay = layersEngine.advertisedRoi();
      if (bay) commitSelection(bay, { fly: false });
      else storyClearZone();
      flyToSelection('rudder');
    } else if (preset.camera === 'screen' && targets.screen) {
      storyClearZone();
      flyToPoint(targets.screen.x, targets.screen.z, 22);
    } else if (preset.camera === 'oblique') {
      storyClearZone();
      flyOblique();
    } else {
      storyClearZone();
      flyHome();
    }
    refreshRudderHud();

    if (sel) sel.value = preset.id;
    if (note) note.textContent = preset.note;
  } finally {
    applyingPreset = false;
  }
}

function hudRow(key, lab, val) {
  return `<div class="hud-row" data-explain="${key}"><span>${lab}</span><b>${val}</b></div>`;
}

function kpiBlock(key, lab, fig) {
  return `<div class="kpi-block" data-explain="${key}">
    <div class="kpi-lab">${lab}</div>
    <div class="kpi-fig">${fig}</div>
  </div>`;
}

const EXPLAIN = {
  idle: {
    kicker: 'Explain',
    title: 'Hover a number',
    body: 'Yellow outline means this figure has a note. Move over a KPI, chart, or Ask chip — this panel follows. Click a figure to pin it. Off by default so the floor stays quiet.',
  },
  'view-moved': {
    kicker: 'Ask',
    title: 'How the shop moved',
    body: 'Each white line is someone walking through the shop — not a camera, not a name. Warm colour and hills = they stopped. Cool floor = they only walked through. Hover a white number on the left for what that figure is.',
  },
  'view-stopped': {
    kicker: 'Ask',
    title: 'Where they stopped',
    body: 'Hills and warm patches are linger. Height is how long people stayed, not euros. Streamlines stay on so empty floor never looks like a dead store.',
  },
  'view-queues': {
    kicker: 'Ask',
    title: 'Queues & checkout',
    body: 'Evening on the checkout spine. Click a lane for wait and people-through. Stop-rate is a shelf metric — it stays off at the till.',
  },
  'view-hot': {
    kicker: 'Ask',
    title: 'Hot / cold bays',
    body: 'Gold puddles = linger. Cyan arrows = pass-by along the commute. The % is stop-rate versus the aisle around this hill, not versus the whole store.',
  },
  'view-change': {
    kicker: 'Ask',
    title: 'Did my change work?',
    body: 'Two days, same store. Colour is traffic share, not euros. Pick the pair on the card. DEMO cannot prove a layout change — you need a LIVE pack with two dates.',
  },
  legend: {
    kicker: 'Colour bar',
    title: 'What the floor colour means',
    body: 'Left of the bar is low for this metric, right is high. The label above the bar names the metric (dwell, outlier, share shift). It is not money unless Profit Radar says LIVE.',
  },
  'change-colour': {
    kicker: 'Did my change work?',
    title: 'Colour is share, not euros',
    body: 'Left colour = the earlier day had a larger share of traffic on this patch. Right colour = the later day did. Mix the two swatches if the default pair is too loud.',
  },
  'change-hills': {
    kicker: 'Did my change work?',
    title: 'Hills are linger',
    body: 'Height is people stopping, not how big the rewrite is. A tall hill with little colour change means they still linger — the traffic mix did not move.',
  },
  'kpi-dwell': {
    kicker: 'KPI',
    title: 'Dwell',
    body: 'Seconds a track spent on this patch, or the mean in this zone. High dwell is linger or a queue — not automatically a sale.',
  },
  'kpi-footfall': {
    kicker: 'KPI',
    title: 'Footfall',
    body: 'How many tracks crossed this cell. A busy aisle can have high footfall and still be cold if nobody stops.',
  },
  'kpi-purity': {
    kicker: 'KPI',
    title: 'Directional purity',
    body: 'How one-way the motion is. Near 1 = a commute. Near 0 = milling or two-way — a mean arrow would cancel here.',
  },
  'kpi-stop': {
    kicker: 'KPI',
    title: 'Stop-rate',
    body: 'Share of tracks here that slowed enough to count as a stop. Healthy shelf is around 45%. At checkout this metric is off — wait time is the till number.',
  },
  'kpi-gauge': {
    kicker: 'KPI',
    title: 'Stop vs healthy 45%',
    body: 'The fill is this bay’s stop-rate. The tick is 45% — a simple healthy line for a product facing, not a law.',
  },
  'kpi-tracks': {
    kicker: 'KPI',
    title: 'Tracks',
    body: 'Unique people-paths in this zone in the selected window. Not till scans, not receipts.',
  },
  'kpi-nearby': {
    kicker: 'KPI',
    title: 'This vs nearby',
    body: 'The same metric on this patch versus the aisle around it. Use this to see if a hill is special or just a busy corridor.',
  },
  'kpi-share': {
    kicker: 'KPI',
    title: 'Traffic share change',
    body: 'How this patch’s slice of store traffic moved between the two sides of the compare. Positive = the later side took share here.',
  },
  'kpi-leakage': {
    kicker: 'KPI',
    title: 'Margin leakage',
    body: 'Traffic × engagement-gap × category margin — modelled euros unless the badge says LIVE. Not till scans. Chimney gold is the same model.',
  },
  'kpi-wait': {
    kicker: 'Checkout',
    title: 'Wait / service time',
    body: 'Mean dwell in this lane. Queue = time in line. Till = time at the scanner. People-through is unique tracks, not receipts.',
  },
  'kpi-through': {
    kicker: 'Checkout',
    title: 'People through',
    body: 'Unique tracks that used this lane in the window. Not basket size, not euros.',
  },
  'kpi-speed': {
    kicker: 'KPI',
    title: 'Walking speed',
    body: 'Mean metres per second on this patch. Slow near a shelf is linger; slow on the checkout spine is a queue.',
  },
  'kpi-sez': {
    kicker: 'Media',
    title: 'SEZ',
    body: 'Share of this zone that sits in a screen’s effective zone — modelled coverage, not proof anyone looked.',
  },
  'kpi-eal': {
    kicker: 'Media',
    title: 'EAL (simulated)',
    body: 'Estimated advertising look — simulated from coverage × nearby shelves. Not a live campaign measurement.',
  },
  'kpi-ces': {
    kicker: 'Media',
    title: 'CES (simulated)',
    body: 'Creative engagement score from the PEBLE model. Simulated, not a live campaign.',
  },
  'kpi-screens': {
    kicker: 'Media',
    title: 'Screens / speakers',
    body: 'Which screens or speakers cover this zone on the plan. Coverage is not attention.',
  },
  'kpi-density': {
    kicker: 'Media',
    title: 'Facing density',
    body: 'Tracks per square metre on the advertised bay. Dense does not mean they looked at the screen.',
  },
  'kpi-heading': {
    kicker: 'Media',
    title: 'Heading to shelf',
    body: 'Change in heading toward the advertised facing inside the corridor. Simulated media rudder, not a camera.',
  },
  'glance-patch': {
    kicker: 'This patch',
    title: 'Pinned vs nearby',
    body: 'You pinned a hill. These rows compare it with the aisle around it so a busy corridor does not look like a hero bay.',
  },
  'glance-title': {
    kicker: 'This patch',
    title: 'What this hill is',
    body: 'A short label for the patch — linger, pass-by, or a named facing if one sits under the pin.',
  },
  'glance-note': {
    kicker: 'This patch',
    title: 'Why it stands out',
    body: 'Plain-language reason this patch is hot or cold versus nearby. Click Go deeper for the fingerprint on a product facing.',
  },
  'glance-outlier': {
    kicker: 'This patch',
    title: 'Outlier',
    body: 'How strange this cell is versus its neighbourhood (dwell vs traffic). High = linger in a quiet aisle, or a rush with no stop.',
  },
  'zone-name': {
    kicker: 'Zone',
    title: 'Name',
    body: 'The ROI drawn on the plan. Custom polygons keep the name you gave them.',
  },
  'zone-area': {
    kicker: 'Zone',
    title: 'Area',
    body: 'Square metres of the selected polygon.',
  },
  'zone-cells': {
    kicker: 'Zone',
    title: 'Cells',
    body: 'How many grid cells sit inside the polygon. Small zones are noisier.',
  },
  'zone-euro-m2': {
    kicker: 'Profit',
    title: 'Per m² / day',
    body: 'Modelled leakage divided by zone area. Still modelled unless the badge says LIVE.',
  },
  'zone-basis': {
    kicker: 'Profit',
    title: 'LIVE vs modelled',
    body: 'LIVE means Profit Radar is attached. Modelled is traffic × gap × category margin — not till scans.',
  },
  'why-bay': {
    kicker: 'Fingerprint',
    title: 'Why this bay',
    body: 'Opens the bay fingerprint — stop, dwell, nearby, and the story for this facing. Only on a product ROI, not a checkout lane.',
  },
};
EXPLAIN['glance-stop'] = EXPLAIN['kpi-stop'];
EXPLAIN['glance-dwell'] = EXPLAIN['kpi-nearby'];
EXPLAIN['glance-traffic'] = EXPLAIN['kpi-nearby'];
EXPLAIN['glance-tracks'] = EXPLAIN['kpi-footfall'];
EXPLAIN['zone-footfall'] = EXPLAIN['kpi-footfall'];
EXPLAIN['zone-dwell'] = EXPLAIN['kpi-dwell'];
EXPLAIN['zone-speed'] = EXPLAIN['kpi-speed'];
EXPLAIN['zone-stop'] = EXPLAIN['kpi-stop'];
EXPLAIN['zone-wait'] = EXPLAIN['kpi-wait'];
EXPLAIN['zone-through'] = EXPLAIN['kpi-through'];
EXPLAIN['zone-leakage'] = EXPLAIN['kpi-leakage'];

function defaultExplainKey() {
  return everydayId ? `view-${everydayId}` : 'idle';
}

function syncExplainMarks() {
  document.querySelectorAll('[data-explain].is-explaining').forEach((el) => {
    el.classList.toggle('is-explaining', el.getAttribute('data-explain') === explainKey);
  });
}

function paintExplain(key, opts = {}) {
  const entry = EXPLAIN[key];
  if (!entry) return;
  explainKey = key;
  if (opts.pin) explainPinned = true;
  const kicker = document.getElementById('explainKicker');
  const title = document.getElementById('explainTitle');
  const body = document.getElementById('explainBody');
  if (kicker) kicker.textContent = entry.kicker || 'Explain';
  if (title) title.textContent = entry.title;
  if (body) body.innerHTML = entry.body;
  syncExplainMarks();
}

function setExplain(on) {
  explainOn = !!on;
  explainPinned = false;
  document.documentElement.classList.toggle('explain-on', explainOn);
  const btn = document.getElementById('explainToggle');
  if (btn) {
    btn.classList.toggle('on', explainOn);
    btn.setAttribute('aria-pressed', explainOn ? 'true' : 'false');
  }
  if (explainOn) paintExplain(defaultExplainKey());
}

function explainTarget(node) {
  const hit = node?.closest?.('[data-explain]');
  const key = hit?.getAttribute('data-explain');
  return key && EXPLAIN[key] ? { el: hit, key } : null;
}

const EVERYDAY_VIEWS = [
  {
    id: 'moved',
    label: 'How the shop moved',
    tour: 'Each white line is someone walking through the shop \u2014 not a camera, not a name. Warm colour (and the hills) is where they stopped. Cool floor is where they only walked through. The menu on the left still works; this tour does not lock it.',
    slice: 'all',
    scalar: 'dwell',
    camera: 'oblique',
    isoline: true,
  },
  {
    id: 'stopped',
    label: 'Where they stopped',
    tour: 'Hills and warm patches are linger. Streamlines stay on so the floor never goes blank.',
    slice: 'all',
    scalar: 'dwell',
    terrainHeight: 8,
    camera: 'wind',
    isoline: true,
    peakGlow: true,
  },
  {
    id: 'queues',
    label: 'Queues & checkout',
    tour: 'Evening on the checkout spine. No zone is pre-selected \u2014 click a lane if you want numbers.',
    slice: 'evening',
    scalar: 'dwell',
    camera: 'checkout',
    isoline: true,
  },
  {
    id: 'hot',
    label: 'Hot / cold bays',
    tour: 'Gold puddles = linger. Cyan arrows = pass-by along the commute. Hover for vs-nearby; click any hill \u2014 you do not need a named ROI.',
    slice: 'evening',
    scalar: 'outlier',
    camera: 'oblique',
    isoline: true,
  },
  {
    id: 'change',
    label: 'Did my change work?',
    tour: 'Pick two days on the card. Mix the two colours if the default pair is too loud. Hills are linger.',
    slice: 'all',
    scalar: 'shift_day',
    camera: 'oblique',
    isoline: true,
    needCompare: true,
  },
];

function paintEverydayChips() {
  document.querySelectorAll('button.everyday[data-everyday]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.everyday === everydayId);
  });
  document.documentElement.classList.toggle('change-on', everydayId === 'change');
  document.documentElement.classList.toggle('queues-on', everydayId === 'queues');
  paintReadKey();
}

let compareError = '';

function shiftStory() {
  const date = field.meta?.local_date || fieldApi.date || 'selected day';
  if (compareError) {
    return {
      kicker: 'Did my change work?',
      title: fieldApi.compare ? `${fieldApi.compare} vs ${date}` : 'Need two days',
      lo: fieldApi.compare || 'Earlier',
      hi: date,
      note: compareError,
      hoverPos: `${date} took share here`,
      hoverNeg: `${fieldApi.compare || 'Earlier'} had more share here`,
    };
  }
  if (params.scalar === 'shift_day' && fieldApi.compare && liveCompareOk() && field.scalars?.shift_day) {
    return {
      kicker: 'Did my change work?',
      title: `${fieldApi.compare} vs ${date}`,
      lo: fieldApi.compare,
      hi: date,
      note: `Colour is traffic share, not euros. Left colour = ${fieldApi.compare} had a larger share here. Right colour = ${date} did. Hills are linger (people stopped).`,
      hoverPos: `${date} took share here`,
      hoverNeg: `${fieldApi.compare} had more share here`,
    };
  }
  if (params.scalar === 'shift_ww') {
    return {
      kicker: 'Weekday vs weekend',
      title: 'Same store, different trip',
      lo: 'Weekday',
      hi: 'Weekend',
      note: 'Left colour = weekday had a larger share of traffic here. Right colour = weekend did. Height is linger, not the size of the rewrite.',
      hoverPos: 'Weekend took share here',
      hoverNeg: 'Weekday had more share here',
    };
  }
  return {
    kicker: 'Morning vs evening \u2014 not a layout test',
    title: 'Same snapshot, two windows',
    lo: 'Morning 7\u201311',
    hi: 'Evening 19\u201322',
    note: 'This snapshot has no second LIVE day loaded yet. Use the two calendars on this card to pick before / after. If they stay on morning vs evening, the live pack did not load (same file twice).',
    hoverPos: 'Evening took share here',
    hoverNeg: 'Morning had more share here',
  };
}

function paintReadKey() {
  const on = everydayId === 'change' || String(params.scalar).startsWith('shift_');
  document.documentElement.classList.toggle('change-on', everydayId === 'change');
  document.documentElement.classList.toggle('shift-on', on);
  if (!on) return;
  const s = shiftStory();
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('readKeyKicker', s.kicker);
  set('readKeyTitle', s.title);
  set('readKeyLo', s.lo);
  set('readKeyHi', s.hi);
  set('readKeyNote', s.note);
  fillChangeDaySelects();
  syncShiftMixUi();
}

function fillChangeDaySelects() {
  const wrap = document.getElementById('readKeyDays');
  const after = document.getElementById('readKeyAfter');
  const before = document.getElementById('readKeyBefore');
  const days = dateCatalog?.dates || [];
  if (wrap) wrap.hidden = days.length < 2;
  if (days.length < 2 || !after || !before) return;
  const here = fieldApi.date || days[0].date;
  after.innerHTML = days.map((d) =>
    `<option value="${d.date}">${d.date}</option>`
  ).join('');
  after.value = after.querySelector(`option[value="${here}"]`) ? here : days[0].date;
  before.innerHTML = `<option value="">Morning vs evening</option>` + days
    .filter((d) => d.date !== after.value)
    .map((d) => `<option value="${d.date}">${d.date}</option>`).join('');
  before.value = fieldApi.compare && before.querySelector(`option[value="${fieldApi.compare}"]`)
    ? fieldApi.compare
    : '';
}

function paintTour() {
  document.documentElement.classList.toggle('tour-on', tourOn);
  const btn = document.getElementById('tourToggle');
  if (btn) {
    btn.classList.toggle('on', tourOn);
    btn.setAttribute('aria-pressed', tourOn ? 'true' : 'false');
  }
  const step = EVERYDAY_VIEWS[tourIndex] || EVERYDAY_VIEWS[0];
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('tourTitle', step.label);
  set('tourStep', `${tourIndex + 1} / ${EVERYDAY_VIEWS.length}`);
  set('tourNote', step.tour);
}

function suggestCompareDate() {
  const days = (dateCatalog?.dates || []).map((d) => d.date);
  const here = fieldApi.date;
  if (!here || days.length < 2) return '';
  return days.find((d) => d !== here) || '';
}

function findCheckoutRoi() {
  const rois = layersEngine?.pack?.rois || [];
  return rois.find((r) => /Checkout.*Queue/i.test(r.name))
    || rois.find((r) => /Checkout/i.test(r.name))
    || null;
}

function catalogHasDays() {
  return (dateCatalog?.dates?.length || 0) >= 2;
}

function liveCompareOk() {
  return !!(useLivePack && field?.meta?.pack === 'live' && catalogHasDays());
}

function dropFakeCompare() {
  if (catalogHasDays() || !fieldApi.compare) return false;
  fieldApi.compare = '';
  if (field?.scalars?.shift_day) delete field.scalars.shift_day;
  writeUrlState();
  fillDateSelects();
  return true;
}

async function ensureLivePack() {
  if (liveCompareOk()) return true;
  if (!catalogHasDays()) return false;
  useLivePack = true;
  const date = fieldApi.date || dateCatalog.latest;
  fieldApi.date = date;
  setLoader(true, `Loading live day ${date} \u2014 first open can take a minute\u2026`);
  try {
    const nextField = await loadField(fieldUrl(sliceId, date));
    field = nextField;
    reachSource = null;
    reachFar = null;
    analysisPromise = null;
    companionMaps = null;
    roseBuf = new Float32Array(field.B);
    syncFieldGeometry();
    CELL = field.meta.cell_m;
    fillDateSelects();
    updateMeta();
    rebuildTerrain();
    buildArrows();
    buildFloorplan();
    rebuildPhysicsLayers();
    buildParticles();
    writeUrlState();
    return field.meta?.pack === 'live';
  } catch (err) {
    console.warn('Could not recover live pack', err);
    useLivePack = false;
    return false;
  } finally {
    setLoader(false);
  }
}

function flyToCheckout() {
  const roi = findCheckoutRoi();
  if (roi && Number.isFinite(roi.cx) && Number.isFinite(roi.cz)) {
    flyToPoint(roi.cx, roi.cz, 28);
    return;
  }
  flyOblique();
}

function setParticleCount(n) {
  if (n == null) return;
  params.particles = n;
  const el = document.getElementById('particles');
  const val = document.getElementById('particlesVal');
  if (el) el.value = String(n);
  if (val) val.textContent = n.toLocaleString();
  buildParticles();
}

function stopTour() {
  if (!tourOn) return;
  tourOn = false;
  paintTour();
}

async function applyEverydayView(id) {
  const view = EVERYDAY_VIEWS.find((v) => v.id === id);
  if (!view) return;
  applyingEveryday = true;
  try {
    stopStoryForPreset();
    storyClearZone();

    let scalar = view.scalar;
    if (!view.needCompare && fieldApi.compare) {
      fieldApi.compare = '';
      if (field.scalars?.shift_day) delete field.scalars.shift_day;
    }
    if (view.needCompare) {
      const live = await ensureLivePack();
      if (live) {
        if (!fieldApi.compare) {
          const d = suggestCompareDate();
          if (d) fieldApi.compare = d;
        }
        scalar = fieldApi.compare ? 'shift_day' : 'shift_me';
      } else {
        dropFakeCompare();
        compareError = 'Need a LIVE pack with two dates. DEMO is the same snapshot twice.';
        scalar = 'shift_me';
      }
    }

    if (view.slice) await switchSlice(view.slice);

    const flowOn = true;
    const flow = document.getElementById('showFlow');
    if (flow) flow.checked = flowOn;
    if (lineMesh) lineMesh.visible = flowOn;
    params.dwellDrag = true; syncCheck('dwellDrag', true);
    params.showArrows = false; syncCheck('showArrows', false);
    if (arrowGroup) arrowGroup.visible = false;
    params.showPlan = true; syncCheck('showPlan', true);
    if (planGroup) planGroup.visible = true;
    params.showFixtures = true; syncCheck('showFixtures', true);
    if (obstacleGroup) obstacleGroup.visible = true;
    params.showTerrain = true; syncCheck('showTerrain', true);
    params.showHeat = false; syncCheck('showHeat', false);
    params.terrainHeight = view.terrainHeight != null ? view.terrainHeight : 6;
    const th = document.getElementById('terrainHeight');
    const thv = document.getElementById('terrainHeightVal');
    if (th) th.value = String(params.terrainHeight);
    if (thv) thv.textContent = params.terrainHeight.toFixed(1) + ' m';
    applyReadingChecks({ isoline: !!view.isoline, peakGlow: !!view.peakGlow });
    applyInsightChecks({
      screen: false, speakers: false, profit: view.id !== 'change', media: false, category: false,
    });
    if (view.needCompare && scalar === 'shift_day' && fieldApi.compare) {
      setLoader(true, `Comparing ${fieldApi.compare} \u2192 ${fieldApi.date}\u2026`);
    }
    try {
      if (scalar) await setScalar(scalar);
    } finally {
      if (view.needCompare) setLoader(false);
    }
    setParticleCount(view.id === 'change' ? 900 : 1600);
    if (lineMesh) lineMesh.visible = true;
    hideProductGallery();
    refreshTicker();
    refreshWhyChip();

    if (view.camera === 'checkout') flyToCheckout();
    else if (view.camera === 'wind') flyWind();
    else if (view.camera === 'home') flyHome();
    else flyOblique();

    const sel = document.getElementById('viewPreset');
    if (sel) sel.value = '';
    const note = document.getElementById('viewPresetNote');
    if (note) {
      note.textContent = view.id === 'change'
        ? shiftStory().note
        : `${view.label}. Guided view stays Custom \u2014 mix the left rail whenever you want.`;
    }
    everydayId = view.id;
    if (!isHotView()) clearPin();
    paintEverydayChips();
    rebuildPeekMarks();
    paintGlance();
    writeUrlState();
    paintReadKey();
    if (tourOn) {
      tourIndex = EVERYDAY_VIEWS.findIndex((v) => v.id === view.id);
      if (tourIndex < 0) tourIndex = 0;
      paintTour();
    }
    if (explainOn) {
      explainPinned = false;
      paintExplain(`view-${view.id}`);
    }
  } finally {
    applyingEveryday = false;
  }
}

async function startTour() {
  if (tourOn) return;
  if (storyActive) await exitStory();
  tourOn = true;
  tourIndex = everydayId
    ? Math.max(0, EVERYDAY_VIEWS.findIndex((v) => v.id === everydayId))
    : 0;
  paintTour();
  await applyEverydayView(EVERYDAY_VIEWS[tourIndex].id);
}

async function stepTour(delta) {
  if (!tourOn) return;
  tourIndex = (tourIndex + delta + EVERYDAY_VIEWS.length) % EVERYDAY_VIEWS.length;
  paintTour();
  await applyEverydayView(EVERYDAY_VIEWS[tourIndex].id);
}

function paintStoryCard(beat) {
  const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  set('storyTime', beat.time);
  set('storyPeriod', beat.period);
  set('storyRung', beat.rung);
  set('storyTitle', beat.title);
  set('storyPersona', beat.persona);
  set('storyFloor', beat.floor);
  set('storyHyperspace', beat.hyperspace);
  set('storyOutcome', beat.outcome);
  set('storyComponent', beat.component);
}

function paintStoryTransport() {
  const on = storyActive;
  document.documentElement.classList.toggle('story-on', on);
  window.dispatchEvent(new CustomEvent('ff-story-chrome', { detail: { on } }));
  try { window.parent?.postMessage({ type: 'ff-story-chrome', on }, window.location.origin); } catch (_) {}
  const toggle = document.getElementById('storyToggle');
  if (toggle) {
    toggle.classList.toggle('active', on);
    toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  for (const id of ['storySep', 'storyPrev', 'storyTicks', 'storyNext', 'storyPlay', 'storyCount', 'storyExit']) {
    const el = document.getElementById(id);
    if (el) el.hidden = !on;
  }
  const ticks = document.getElementById('storyTicks');
  if (ticks && on) {
    ticks.innerHTML = STORY_BEATS.map((b, i) =>
      `<i data-i="${i}" class="${i === storyIndex ? 'on' : ''}" style="background:${i === storyIndex ? (STORY_RUNG_COLOR[b.rung] || '#93c5fd') : '#3a4250'}" title="${escapeHtml(b.title)}"></i>`).join('');
  }
  const count = document.getElementById('storyCount');
  if (count) count.textContent = `${storyIndex + 1} / ${STORY_BEATS.length}`;
  const prev = document.getElementById('storyPrev');
  const next = document.getElementById('storyNext');
  if (prev) prev.disabled = storyIndex <= 0;
  if (next) next.disabled = storyIndex >= STORY_BEATS.length - 1;
  const play = document.getElementById('storyPlay');
  if (play) {
    play.textContent = storyPlaying ? '\u275a\u275a' : '\u25b6';
    play.title = storyPlaying ? 'Pause auto-advance' : 'Auto-advance';
  }
}

function stopStoryTimer() {
  if (storyTimer) { clearTimeout(storyTimer); storyTimer = null; }
}

function scheduleStoryAdvance() {
  stopStoryTimer();
  if (!storyActive || !storyPlaying) return;
  const beat = STORY_BEATS[storyIndex];
  const ms = beat?.autoAdvanceMs || 14000;
  storyTimer = setTimeout(() => {
    if (!storyActive || !storyPlaying) return;
    if (storyIndex >= STORY_BEATS.length - 1) {
      storyPlaying = false;
      paintStoryTransport();
      return;
    }
    void gotoStory(storyIndex + 1);
  }, ms);
}

function storyClearZone() {
  clearPin();
  layersEngine?.clearSelection();
  params.pickMode = false;
  params.drawMode = false;
  document.getElementById('pickZone')?.classList.remove('active');
  document.getElementById('drawZone')?.classList.remove('active');
  rebuildTerrain();
  updateInspector();
  hideProductGallery();
}

function fillStoryBeat(beat) {
  if (!layersEngine) return beat;
  if (beat.drill === 'why') {
    const info = layersEngine.inspect();
    if (!info) return beat;
    const stop = `${Math.round((info.engagement || 0) * 100)}%`;
    return {
      ...beat,
      outcome: `${fmtEuro(info.euroDay)} / day \u00b7 stop ${stop}`,
      component: `${info.name || beat.component} \u00b7 ${info.profitBasis || ''}`.trim(),
    };
  }
  if (beat.id !== 'move' || !layersEngine.recommendMove) return beat;
  const mv = layersEngine.recommendMove();
  if (!mv) return beat;
  const window = SLICE_LABELS[sliceId] || 'this window';
  const stop = `${Math.round((mv.engagement || 0) * 100)}%`;
  return {
    ...beat,
    floor: `${mv.category} \u00b7 ${mv.name} is leaking ${fmtEuro(mv.euroDay)} on ${window}. Stop-rate ${stop} vs 45% healthy. The facing looks stocked.`,
    hyperspace: `Lever: ${mv.lever}. Expected ${fmtEuro(mv.euroDay)} / day \u00b7 ${fmtEuro(mv.euroYear)} / year. Fix this bay first.`,
    outcome: `${fmtEuro(mv.euroDay)} / day \u00b7 ${fmtEuro(mv.euroYear)} / year`,
    component: `${mv.category} \u00b7 ${mv.name} \u00b7 ${mv.badge}`,
  };
}

async function applyStoryBeat(i) {
  const beat = STORY_BEATS[i];
  if (!beat || !layersEngine) return;
  if (beat.slice && beat.slice !== sliceId) await switchSlice(beat.slice);
  if (params.scalar !== 'dwell') await setScalar('dwell');
  applyStoryLayers(beat.layers);
  const targets = layersEngine.storyTargets?.() || {};
  if (beat.zone === 'trap' && targets.trap) {
    commitSelection(targets.trap);
  } else if (beat.zone === 'move' && targets.move) {
    commitSelection(targets.move);
  } else if (beat.zone === 'screen' && targets.screen) {
    storyClearZone();
    flyToPoint(targets.screen.x, targets.screen.z, 22);
  } else {
    storyClearZone();
    if (beat.camera === 'wind') flyWind();
    else if (beat.camera === 'oblique') flyOblique();
    else flyHome();
  }
  if (beat.camera === 'rise') flyToSelection('rise');
  if (beat.camera === 'aisle') flyToSelection('aisle');
  if (beat.camera === 'plan' && layersEngine?.selectionCenter()) flyToSelection('plan');
  if (beat.drill) {
    const sel = layersEngine.getSelection()
      || (beat.zone === 'move' ? targets.move : targets.trap);
    if (sel) {
      window.__ffDrill?.open(sel, {
        step: beat.drill,
        moment: storyMomentOverride || beat.moment || (beat.drill === 'id' ? 'hesitation' : null),
      });
    }
    storyMomentOverride = null;
  } else {
    window.__ffDrill?.close();
  }
  paintStoryCard(fillStoryBeat(beat));
}

async function gotoStory(i) {
  if (storyBusy) return;
  const next = Math.max(0, Math.min(STORY_BEATS.length - 1, i));
  storyBusy = true;
  storyIndex = next;
  paintStoryTransport();
  try { await applyStoryBeat(next); }
  finally { storyBusy = false; }
  if (storyPlaying) scheduleStoryAdvance();
}

function snapshotStory() {
  return {
    sliceId,
    scalar: params.scalar,
    showTerrain: params.showTerrain,
    showArrows: params.showArrows,
    showPlan: params.showPlan,
    showFixtures: params.showFixtures,
    showHeat: params.showHeat,
    showScreenFov: params.showScreenFov,
    showSpeakers: params.showSpeakers,
    showProfit: params.showProfit,
    showMedia: params.showMedia,
    showCategory: params.showCategory,
    showTicker: params.showTicker,
    showIsoline: params.showIsoline,
    showPeakGlow: params.showPeakGlow,
    showCurtain: params.showCurtain,
    dwellDrag: params.dwellDrag,
    planMirror: params.planMirror,
    flow: document.getElementById('showFlow')?.checked !== false,
  };
}

async function restoreStory(snap) {
  if (!snap) return;
  if (snap.sliceId && snap.sliceId !== sliceId) await switchSlice(snap.sliceId);
  if (snap.scalar && snap.scalar !== params.scalar) await setScalar(snap.scalar);
  const flow = document.getElementById('showFlow');
  if (flow) flow.checked = snap.flow;
  if (lineMesh) lineMesh.visible = snap.flow;
  params.dwellDrag = snap.dwellDrag; syncCheck('dwellDrag', snap.dwellDrag);
  params.showArrows = snap.showArrows; syncCheck('showArrows', snap.showArrows); if (arrowGroup) arrowGroup.visible = snap.showArrows;
  params.showPlan = snap.showPlan; syncCheck('showPlan', snap.showPlan); if (planGroup) planGroup.visible = snap.showPlan;
  params.showFixtures = snap.showFixtures; syncCheck('showFixtures', snap.showFixtures); if (obstacleGroup) obstacleGroup.visible = snap.showFixtures;
  params.planMirror = snap.planMirror; syncCheck('planMirror', snap.planMirror);
  params.showTerrain = snap.showTerrain; syncCheck('showTerrain', snap.showTerrain);
  params.showHeat = snap.showHeat; syncCheck('showHeat', snap.showHeat);
  params.showTicker = snap.showTicker; syncCheck('showTicker', snap.showTicker);
  params.showIsoline = !!snap.showIsoline; syncCheck('showIsoline', params.showIsoline);
  params.showPeakGlow = !!snap.showPeakGlow; syncCheck('showPeakGlow', params.showPeakGlow);
  params.showCurtain = !!snap.showCurtain; syncCheck('showCurtain', params.showCurtain);
  params.showScreenFov = snap.showScreenFov; syncCheck('showScreenFov', snap.showScreenFov);
  params.showSpeakers = snap.showSpeakers; syncCheck('showSpeakers', snap.showSpeakers);
  params.showProfit = snap.showProfit; syncCheck('showProfit', snap.showProfit);
  params.showMedia = snap.showMedia; syncCheck('showMedia', snap.showMedia);
  params.showCategory = snap.showCategory; syncCheck('showCategory', snap.showCategory);
  applyHeat();
  layersEngine?.applyVisibility();
  rebuildTerrain();
  updateLegend();
  refreshTicker();
  storyClearZone();
  flyHome();
}

async function enterStory() {
  if (storyActive) return;
  stopTour();
  storySnap = snapshotStory();
  storyActive = true;
  storyIndex = 0;
  storyPlaying = true;
  document.documentElement.classList.add('story-on');
  peekGroup.visible = false;
  paintStoryTransport();
  await gotoStory(0);
}

async function exitStory() {
  if (!storyActive) return;
  stopStoryTimer();
  storyActive = false;
  storyPlaying = false;
  window.__ffDrill?.close();
  document.documentElement.classList.remove('story-on');
  paintStoryTransport();
  await restoreStory(storySnap);
  storySnap = null;
  rebuildPeekMarks();
}

function commitSelection(sel, opts = {}) {
  if (!layersEngine) return;
  layersEngine.setSelection(sel);
  params.pickMode = false;
  params.drawMode = false;
  document.getElementById('pickZone')?.classList.remove('active');
  document.getElementById('drawZone')?.classList.remove('active');
  rebuildTerrain();
  updateInspector();
  void updateProductGallery();
  if (opts.fly !== false) flyToSelection();
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = 'Zone selected \u00b7 Drag a vertex to reshape \u00b7 Clear zone to return';
  refreshWhyChip();
  refreshRudderHud();
  if (sel && document.documentElement.classList.contains('ff-phone')
      && !document.documentElement.classList.contains('story-on')
      && !document.documentElement.classList.contains('drill-on')) {
    window.dispatchEvent(new CustomEvent('ff-phone-zone-picked'));
  }
}

// ------------------------------------------------------- static arrow glyphs
// The export/print fallback: particles do not survive a screenshot.
const arrowGroup = new THREE.Group();
scene.add(arrowGroup);
function buildArrows() {
  arrowGroup.clear();
  const pts = [];
  for (let j = 0; j < field.NY; j += 2) for (let i = 0; i < field.NX; i += 2) {
    const k = field.idx(i, j);
    if (supportNorm(k) < 0.12 || field.purity[k] < 0.02) continue;
    const mx = field.meanX[k], my = field.meanY[k];
    const mag = Math.hypot(mx, my);
    if (mag < 1e-4) continue;
    const len = (0.5 + 2.4 * field.purity[k]) * CELL;
    const y = heightAtCell(k) + 0.35;
    // Map both endpoints through the alignment so the glyph rotates with the field.
    const tail = gridToVenue(i, j);
    const head = gridToVenue(i + (mx / mag) * len / CELL, j + (my / mag) * len / CELL);
    pts.push(tail.x, y, tail.z, head.x, y, head.z);
    const ang = Math.atan2(head.z - tail.z, head.x - tail.x);
    for (const da of [2.5, -2.5]) {
      pts.push(head.x, y, head.z,
        head.x + Math.cos(ang + da) * len * 0.3, y, head.z + Math.sin(ang + da) * len * 0.3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  arrowGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.85 })));
  arrowGroup.visible = params.showArrows;
}

// ---------------------------------------------------------------- streamlines
const MAX_PARTICLES = 12000;
const MAX_TRAIL = 20;
let roseBuf = new Float32Array(field.B);

let particles = [];
let lineGeom, lineMesh, linePos, lineCol;

function buildParticles() {
  particles = new Array(params.particles);
  for (let p = 0; p < params.particles; p++) particles[p] = spawn({});
  const segs = params.trail - 1;
  linePos = new Float32Array(params.particles * segs * 2 * 3);
  lineCol = new Float32Array(params.particles * segs * 2 * 3);
  // Tail fade is constant per segment index, so the colour buffer is written once.
  for (let p = 0; p < params.particles; p++) {
    for (let s = 0; s < segs; s++) {
      const head = 1 - s / segs;
      const a = Math.pow(head, 1.6);
      for (let e = 0; e < 2; e++) {
        const o = ((p * segs + s) * 2 + e) * 3;
        lineCol[o] = a * 0.88; lineCol[o + 1] = a * 0.94; lineCol[o + 2] = a;
      }
    }
  }
  if (lineMesh) { scene.remove(lineMesh); lineGeom.dispose(); }
  lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
  lineGeom.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
  lineMesh = new THREE.LineSegments(lineGeom, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  // The buffer is empty on the first frame, so the cached bounding sphere would
  // be a zero-radius sphere at the origin and cull every trail once the camera
  // looks at the venue instead of the origin.
  lineMesh.frustumCulled = false;
  scene.add(lineMesh);
}

function spawn(p) {
  let s = field.randomSpawn();
  if (params.showHeat) {
    for (let tries = 0; tries < 12; tries++) {
      const ii = Math.floor(s.x), jj = Math.floor(s.y);
      if (ii < 0 || jj < 0 || ii >= field.NX || jj >= field.NY) break;
      if (!blocked[field.idx(ii, jj)]) break;
      s = field.randomSpawn();
    }
  }
  p.x = s.x; p.y = s.y;
  p.age = 0;
  p.life = 60 + Math.random() * 110;
  const { sup } = field.sampleRose(p.x, p.y, roseBuf);
  p.heading = sup > 0 ? pickHeading(roseBuf, Math.random() * Math.PI * 2) ?? Math.random() * Math.PI * 2
    : Math.random() * Math.PI * 2;
  p.hist = p.hist || new Float32Array(MAX_TRAIL * 3);
  const v = gridToVenue(p.x, p.y);
  const h = terrainHeightAt(p.x, p.y) + 0.25;
  for (let i = 0; i < MAX_TRAIL; i++) {
    p.hist[i * 3] = v.x;
    p.hist[i * 3 + 1] = h;
    p.hist[i * 3 + 2] = v.z;
  }
  return p;
}

// Sample a heading from the local rose, weighted toward where the particle is
// already going. This is what separates a two-way aisle into two visible
// counter-streams instead of letting them average to nothing.
function pickHeading(rose, heading) {
  let tot = 0;
  const w = new Array(field.B);
  for (let b = 0; b < field.B; b++) {
    const a = (b / field.B) * Math.PI * 2;
    w[b] = rose[b] * Math.exp(params.kappa * Math.cos(a - heading));
    tot += w[b];
  }
  if (tot <= 0) return null;
  let r = Math.random() * tot, pick = 0;
  for (let b = 0; b < field.B; b++) { r -= w[b]; if (r <= 0) { pick = b; break; } }
  return (pick / field.B) * Math.PI * 2 + (Math.random() - 0.5) * (Math.PI * 2 / field.B);
}

// Trails are sampled every few frames rather than every frame, so a trail spans
// a readable stretch of floor instead of a couple of centimetres.
const HIST_STRIDE = 3;
let frame = 0;

function stepParticles(dt) {
  const push = (frame++ % HIST_STRIDE) === 0;
  const supportFloor = field.supportRef * 0.02;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const { sup, spd } = field.sampleRose(p.x, p.y, roseBuf);
    if (sup < supportFloor || p.age > p.life || p.x < 0 || p.y < 0 || p.x >= field.NX || p.y >= field.NY) {
      spawn(p);
      continue;
    }
    const nh = pickHeading(roseBuf, p.heading);
    if (nh == null) { spawn(p); continue; }
    const k = params.inertia;
    p.heading = Math.atan2(
      k * Math.sin(p.heading) + (1 - k) * Math.sin(nh),
      k * Math.cos(p.heading) + (1 - k) * Math.cos(nh),
    );

    // Dwell shows up in the motion, not just the colour: particles crawl where
    // people linger, which reads as pooling.
    let speed = Math.max(0.08, Math.min(1.8, spd));
    if (params.dwellDrag) {
      const dn = Math.min(1, field.sampleScalar(field.dwell, p.x, p.y) / field.scalars.dwell.max);
      speed *= 1 - 0.72 * Math.pow(dn, 0.7);
    }
    const adv = (speed / CELL) * dt * params.timeScale;
    p.x += Math.cos(p.heading) * adv;
    p.y += Math.sin(p.heading) * adv;
    p.age += dt * 60;
    const ii = Math.floor(p.x), jj = Math.floor(p.y);
    if (params.showHeat && ii >= 0 && jj >= 0 && ii < field.NX && jj < field.NY && blocked[field.idx(ii, jj)]) {
      spawn(p);
      continue;
    }

    if (push) {
      p.hist.copyWithin(3, 0, (MAX_TRAIL - 1) * 3);
      const v = gridToVenue(p.x, p.y);
      p.hist[0] = v.x;
      p.hist[1] = terrainHeightAt(p.x, p.y) + 0.25;
      p.hist[2] = v.z;
    }
  }

  if (!push) return;
  const segs = params.trail - 1;
  const bay = params.showMedia ? layersEngine?.advertisedRoi?.() : null;
  for (let i = 0; i < particles.length; i++) {
    const h = particles[i].hist;
    const p = particles[i];
    let cr = 0.88, cg = 0.94, cb = 1;
    if (bay) {
      const vx = h[0], vz = h[2];
      const inCone = layersEngine.inScreenCone?.(vx, vz);
      if (inCone) {
        const dx = bay.cx - vx, dz = bay.cz - vz;
        const g = venueToGrid(vx + dx, vz + dz);
        const tx = g.x - p.x, ty = g.y - p.y;
        const tm = Math.hypot(tx, ty) || 1;
        const cos = (Math.cos(p.heading) * tx + Math.sin(p.heading) * ty) / tm;
        if (cos > 0.18) { cr = 0.45; cg = 0.98; cb = 1; }
        else { cr = 0.32; cg = 0.36; cb = 0.46; }
      }
    }
    for (let s = 0; s < segs; s++) {
      const o = ((i * segs + s) * 2) * 3;
      linePos[o] = h[s * 3]; linePos[o + 1] = h[s * 3 + 1]; linePos[o + 2] = h[s * 3 + 2];
      linePos[o + 3] = h[(s + 1) * 3]; linePos[o + 4] = h[(s + 1) * 3 + 1]; linePos[o + 5] = h[(s + 1) * 3 + 2];
      const head = 1 - s / segs;
      const a = Math.pow(head, 1.6);
      for (let e = 0; e < 2; e++) {
        const co = o + e * 3;
        lineCol[co] = a * cr; lineCol[co + 1] = a * cg; lineCol[co + 2] = a * cb;
      }
    }
  }
  lineGeom.attributes.position.needsUpdate = true;
  lineGeom.attributes.color.needsUpdate = true;
}

// ------------------------------------------------------------------ hover HUD
const SNAP_PX = 26;
const CLOSE_PX = 34;
const GRAB_PX = 22;
const _proj = new THREE.Vector3();

function getStrokeWidth() {
  return Math.max(0.08, Math.min(0.55, camera.position.y * 0.006));
}

function projectFloor(x, z) {
  _proj.set(x, 0.3, z).project(camera);
  if (_proj.z < -1 || _proj.z > 1) return null;
  const r = renderer.domElement.getBoundingClientRect();
  return {
    sx: (_proj.x * 0.5 + 0.5) * r.width,
    sy: (-_proj.y * 0.5 + 0.5) * r.height,
  };
}

function closeDraft(verts) {
  if (!verts || verts.length < 3) return false;
  let cx = 0, cz = 0;
  for (const v of verts) { cx += v[0]; cz += v[1]; }
  cx /= verts.length; cz /= verts.length;
  commitSelection({
    id: 'custom',
    name: 'Custom zone',
    category: null,
    vertices: verts.map((v) => [v[0], v[1]]),
    area_m2: 0,
    cx, cz,
  }, { fly: false });
  return true;
}

function snapDrawPoint(x, z, draft, { forClose = true } = {}) {
  const cur = projectFloor(x, z);
  if (!cur) return null;
  let best = null;
  let bestD = SNAP_PX;
  const consider = (px, pz, meta = {}) => {
    const s = projectFloor(px, pz);
    if (!s) return;
    const d = Math.hypot(s.sx - cur.sx, s.sy - cur.sy);
    const limit = meta.close ? CLOSE_PX : SNAP_PX;
    if (d < limit && (best == null || d < bestD || (meta.close && d < bestD + 8))) {
      bestD = d;
      best = { x: px, z: pz, d, ...meta };
    }
  };
  for (const b of fixtureBoxes) {
    consider(b.minX, b.minZ);
    consider(b.maxX, b.minZ);
    consider(b.minX, b.maxZ);
    consider(b.maxX, b.maxZ);
  }
  for (const roi of layersPack.rois || []) {
    const vs = roi.vertices;
    if (!vs) continue;
    for (const v of vs) consider(v[0], v[1]);
  }
  if (forClose && draft.length >= 3) consider(draft[0][0], draft[0][1], { close: true });
  return best;
}

function nearestPolyVertex(x, z, verts, maxPx = GRAB_PX) {
  if (!verts?.length) return -1;
  const cur = projectFloor(x, z);
  if (!cur) return -1;
  let best = -1, bestD = maxPx;
  for (let i = 0; i < verts.length; i++) {
    const s = projectFloor(verts[i][0], verts[i][1]);
    if (!s) continue;
    const d = Math.hypot(s.sx - cur.sx, s.sy - cur.sy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

let vertexDrag = null;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverCell = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (vertexDrag) {
    const hit = floorHit(e);
    if (!hit) return;
    let x = hit.point.x, z = hit.point.z;
    const snap = snapDrawPoint(x, z, [], { forClose: false });
    if (snap) { x = snap.x; z = snap.z; }
    vertexDrag.moved = true;
    if (vertexDrag.kind === 'draft') {
      const draft = layersEngine.getDraft().slice();
      draft[vertexDrag.index] = [x, z];
      layersEngine.setDraft(draft);
    } else if (vertexDrag.kind === 'sel') {
      const sel = layersEngine.getSelection();
      if (!sel?.vertices) return;
      const verts = sel.vertices.map((v) => v.slice());
      verts[vertexDrag.index] = [x, z];
      layersEngine.setSelection({ ...sel, vertices: verts }, { skipProfit: true });
    }
    return;
  }
  if (params.drawMode && layersEngine && !layersEngine.getSelection()) {
    const hit = floorHit(e);
    const draft = layersEngine.getDraft();
    if (hit && draft.length) {
      let x = hit.point.x, z = hit.point.z;
      const snap = snapDrawPoint(x, z, draft);
      if (snap) { x = snap.x; z = snap.z; }
      layersEngine.setDraft(draft, { x, z, close: !!snap?.close });
    }
  }
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(terrain, false)[0];
  if (!hit) { hoverCell = null; updateHud(); return; }
  const g = venueToGrid(hit.point.x, hit.point.z);
  const i = Math.round(g.x), j = Math.round(g.y);
  hoverCell = (i >= 0 && j >= 0 && i < field.NX && j < field.NY) ? field.idx(i, j) : null;
  updateHud();
});

let pointerDownAt = null;
let lastClickAt = 0;
function floorHit(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(pickPlane, false)[0]
    || raycaster.intersectObject(terrain, false)[0]
    || null;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  pointerDownAt = { x: e.clientX, y: e.clientY };
  if (!layersEngine) return;
  const hit = floorHit(e);
  if (!hit) return;
  const x = hit.point.x, z = hit.point.z;
  const draft = layersEngine.getDraft();
  const sel = layersEngine.getSelection();
  if (params.drawMode && draft.length) {
    const i = nearestPolyVertex(x, z, draft);
    if (i >= 0) {
      vertexDrag = { kind: 'draft', index: i, moved: false };
      controls.enabled = false;
      return;
    }
  }
  if (sel?.vertices?.length && !params.drawMode) {
    const i = nearestPolyVertex(x, z, sel.vertices);
    if (i >= 0) {
      vertexDrag = { kind: 'sel', index: i, moved: false };
      controls.enabled = false;
    }
  }
}, { capture: true });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (vertexDrag) {
    const drag = vertexDrag;
    vertexDrag = null;
    controls.enabled = true;
    pointerDownAt = null;
    if (drag.kind === 'draft' && !drag.moved && drag.index === 0) {
      const draft = layersEngine.getDraft();
      if (draft.length >= 3) closeDraft(draft);
    } else if (drag.kind === 'sel' && drag.moved) {
      const sel = layersEngine.getSelection();
      if (sel) layersEngine.setSelection(sel);
      rebuildTerrain();
      updateInspector();
    }
    return;
  }
  if (!pointerDownAt) return;
  const dx = e.clientX - pointerDownAt.x, dy = e.clientY - pointerDownAt.y;
  pointerDownAt = null;
  if (dx * dx + dy * dy > 25) return;
  if (!layersEngine) return;
  const hit = floorHit(e);
  if (!hit) return;
  const x = hit.point.x, z = hit.point.z;
  const now = performance.now();
  const dbl = now - lastClickAt < 320;
  lastClickAt = now;
  if (params.drawMode) {
    const draft = layersEngine.getDraft().slice();
    if (dbl && draft.length >= 3) {
      closeDraft(draft);
      return;
    }
    const snap = snapDrawPoint(x, z, draft);
    const px = snap ? snap.x : x;
    const pz = snap ? snap.z : z;
    if (snap?.close) {
      closeDraft(draft);
      return;
    }
    if (draft.length) {
      const last = draft[draft.length - 1];
      if (Math.hypot(last[0] - px, last[1] - pz) < 0.25) return;
    }
    draft.push([px, pz]);
    layersEngine.setDraft(draft);
    return;
  }
  const roi = layersEngine.pickRoi(x, z);
  const k0 = cellAtVenue(x, z);
  if (k0 == null || field.support[k0] <= 0) {
    if (isCheckoutRoi(roi) || everydayId === 'queues') {
      clearPin();
      if (roi) commitSelection(roi, { fly: false });
      return;
    }
    if (roi) commitSelection(roi, { fly: false });
    return;
  }
  const snapped = isHotView() ? snapInteresting(k0) : k0;
  const v = cellVenue(snapped);
  const roiAt = layersEngine.pickRoi(v.x, v.z) || roi;
  const sel = layersEngine.getSelection();
  if (!glanceAllowed(roiAt)) {
    if (roiAt && sel && roiAt.id === sel.id && fingerprintRoi(roiAt)) {
      goDeeper();
      return;
    }
    clearPin();
    if (roiAt) commitSelection(roiAt, { fly: false });
    refreshWhyChip();
    return;
  }
  if (pinnedCell === snapped || (roiAt && sel && roiAt.id === sel.id)) {
    goDeeper();
    return;
  }
  pinPatch(snapped, roiAt);
});
renderer.domElement.addEventListener('pointercancel', () => {
  vertexDrag = null;
  controls.enabled = true;
  pointerDownAt = null;
});

const REGIME_NOTE = {
  0: 'Mixed / quiet — no dominant behaviour class',
  1: 'Through-route — high motion, low dwell',
  2: 'Dwell node — top engagement / queueing',
  3: 'One-way spine — directional purity ≥ 0.55',
  4: 'Two-way aisle — milling / opposing flows',
};

function collapsedRail() {
  return document.documentElement.classList.contains('controls-collapsed');
}

function refreshWhyChip() {
  const el = document.getElementById('whyChip');
  if (!el) return;
  const sel = layersEngine?.getSelection();
  const show = !!(fingerprintRoi(sel)
    && !document.documentElement.classList.contains('story-on')
    && !document.documentElement.classList.contains('drill-on'));
  el.style.display = show ? 'block' : 'none';
  el.textContent = 'Why this bay';
}

function refreshRudderHud() {
  const el = document.getElementById('rudderHud');
  if (!el || !layersEngine) return;
  if (!params.showMedia) { el.classList.remove('on'); return; }
  const m = layersEngine.rudderMetrics();
  const bay = m?.bay || layersEngine.advertisedRoi();
  const info = bay ? layersEngine.inspect(bay) : null;
  const headPct = m ? Math.round(m.heading * 100) : 0;
  const spdPct = m ? Math.round(m.dSpeed * 100) : 0;
  const densPct = m ? Math.round(m.dDens * 100) : 0;
  const ealPct = info ? Math.round(info.eal * 100) : 0;
  const signed = (n) => `${n >= 0 ? '+' : ''}${n}`;
  el.classList.add('on');
  el.innerHTML = `
    ${kpiBlock('kpi-heading', '\u0394 heading to shelf', `${signed(headPct)}%`)}
    ${kpiBlock('kpi-speed', '\u0394 speed in corridor', `${signed(spdPct)}%`)}
    ${kpiBlock('kpi-density', 'density SKU vs floor', `${signed(densPct)}%`)}
    ${kpiBlock('kpi-eal', 'EAL <span class="kpi-sim">simulated</span>', `${signed(ealPct)}%`)}`;
  if (explainOn) syncExplainMarks();
}

function isCheckoutRoi(roi) {
  return !!(roi && /Checkout|Cassa|Self-?check|Self-?scan/i.test(roi.name || ''));
}

function checkoutKind(roi) {
  const n = roi?.name || '';
  if (/Queue/i.test(n)) return 'queue';
  if (/Service/i.test(n)) return 'service';
  return 'checkout';
}

function checkoutLane(roi) {
  const m = String(roi?.name || '').match(/^(Checkout\s+\d+|Cassa\s+\d+)/i);
  return m ? m[1] : null;
}

function siblingCheckoutRoi(roi) {
  const lane = checkoutLane(roi);
  if (!lane || !roi || !layersEngine?.pack?.rois) return null;
  const kind = checkoutKind(roi);
  const want = kind === 'queue' ? /Service/i : /Queue/i;
  const prefix = new RegExp(`^${lane.replace(/\s+/g, '\\s+')}\\s*-`, 'i');
  return layersEngine.pack.rois.find((r) => r.id !== roi.id && prefix.test(r.name || '') && want.test(r.name || '')) || null;
}

function fmtWait(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '\u2014';
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}m ${String(s).padStart(2, '0')}s` : `${m}m`;
}

const HEALTHY_STOP = 0.45;

function stopGaugeSvg(stop01, opts = {}) {
  const showValue = opts.showValue !== false;
  const pct = Math.round(Math.max(0, Math.min(1, Number(stop01) || 0)) * 100);
  const line = Math.round(HEALTHY_STOP * 100);
  const r = showValue ? 50 : 42;
  const stroke = 6;
  const w = 168;
  const cx = w / 2;
  const cy = r + stroke + 6;
  const h = cy + stroke + 4;
  const pt = (t, rad = r) => {
    const a = Math.PI + Math.PI * t;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const arc = (from, to) => {
    if (to <= from + 0.004) return '';
    const [x0, y0] = pt(from);
    const [x1, y1] = pt(to);
    const large = to - from > 0.5 ? 1 : 0;
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  const fill = Math.max(0, Math.min(1, pct / 100));
  const tick = Math.max(0.02, Math.min(0.98, line / 100));
  const [ix, iy] = pt(tick, r - 8);
  const [ox, oy] = pt(tick, r + 6);
  const color = pct < line ? '#f59e0b' : '#fff';
  const track = arc(0, 1);
  const value = arc(0, fill);
  const valueY = cy - r * 0.42;
  return `<div class="kpi-chart kpi-gauge-wrap" data-explain="kpi-gauge">
    <svg class="kpi-gauge" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="hidden" aria-hidden="true">
      <path d="${track}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="${stroke}" stroke-linecap="butt"/>
      ${value ? `<path d="${value}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="butt"/>` : ''}
      <line x1="${ix.toFixed(1)}" y1="${iy.toFixed(1)}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="rgba(255,255,255,0.7)" stroke-width="2" stroke-linecap="square"/>
      ${showValue ? `<text x="${cx}" y="${valueY.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="20" font-weight="500">${pct}%</text>` : ''}
    </svg>
    <div class="kpi-gauge-cap">Stop vs healthy ${line}%</div>
  </div>`;
}

function kpiBarRow(lab, val, max, opts = {}) {
  const n = Number(val) || 0;
  const cap = Math.max(Number(max) || 1, 1);
  const w = Math.max(n > 0 ? 2 : 0, Math.min(100, Math.round((n / cap) * 100)));
  const hi = opts.hi !== false;
  const suffix = opts.suffix || '';
  const fill = hi ? '#fff' : 'rgba(255,255,255,0.38)';
  return `<div class="kpi-bar-row">
    <span>${lab}</span>
    <span class="kpi-bar-track"><span class="kpi-bar-fill" style="width:${w}%;background:${fill}"></span></span>
    <b>${Number.isFinite(n) ? `${Math.round(n)}${suffix}` : '—'}</b>
  </div>`;
}

function nearbyBarsHtml(here, near) {
  if (!here || !near) return '';
  const stopH = Math.round((here.stop || 0) * 100);
  const stopN = Math.round((near.stop || 0) * 100);
  const dwellIdx = near.dwell > 1e-3 ? Math.round((here.dwell / near.dwell) * 100) : 100;
  const stopMax = Math.max(stopH, stopN, 1);
  const dwellMax = Math.max(dwellIdx, 100);
  return `<div class="kpi-chart" data-explain="kpi-nearby">
    <div class="kpi-bar-k">Stop-rate</div>
    ${kpiBarRow('This', stopH, stopMax, { suffix: '%', hi: true })}
    ${kpiBarRow('Nearby', stopN, stopMax, { suffix: '%', hi: false })}
    <div class="kpi-bar-k">Dwell index</div>
    ${kpiBarRow('This', dwellIdx, dwellMax, { hi: true })}
    ${kpiBarRow('Nearby', 100, dwellMax, { hi: false })}
  </div>`;
}

function pairTimeBarsHtml(aLab, aSec, bLab, bSec) {
  if (!Number.isFinite(aSec) || !Number.isFinite(bSec) || aSec < 0 || bSec < 0) return '';
  const max = Math.max(aSec, bSec, 1);
  return `<div class="kpi-chart" data-explain="kpi-wait">
    <div class="kpi-bar-k">This lane</div>
    ${kpiBarRow(aLab, aSec, max, { suffix: 's', hi: true })}
    ${kpiBarRow(bLab, bSec, max, { suffix: 's', hi: false })}
  </div>`;
}

function checkoutKpi(info, roi) {
  const kind = checkoutKind(roi);
  const lane = (checkoutLane(roi) || roi?.name || 'Checkout').toUpperCase();
  const sib = siblingCheckoutRoi(roi);
  const sibInfo = sib ? layersEngine.inspect(sib) : null;
  const through = Math.round(info?.footfall || 0).toLocaleString();
  const speed = Number.isFinite(info?.speed) ? `${info.speed.toFixed(2)} m/s` : '\u2014';
  if (kind === 'queue') {
    const service = sibInfo?.dwell;
    return `
      ${kpiBlock('kpi-wait', `${lane} \u00b7 avg wait`, fmtWait(info.dwell))}
      ${Number.isFinite(service) ? pairTimeBarsHtml('Wait', info.dwell, 'Till', service) : ''}
      ${kpiBlock('kpi-through', 'people through', through)}
      ${kpiBlock(service != null ? 'kpi-wait' : 'kpi-speed', service != null ? 'service time' : 'pace', service != null ? fmtWait(service) : speed)}`;
  }
  if (kind === 'service') {
    const wait = sibInfo?.dwell;
    return `
      ${kpiBlock('kpi-wait', `${lane} \u00b7 service time`, fmtWait(info.dwell))}
      ${Number.isFinite(wait) ? pairTimeBarsHtml('Wait', wait, 'Till', info.dwell) : ''}
      ${kpiBlock('kpi-through', 'people through', through)}
      ${kpiBlock(wait != null ? 'kpi-wait' : 'kpi-speed', wait != null ? 'queue wait' : 'pace', wait != null ? fmtWait(wait) : speed)}`;
  }
  return `
    ${kpiBlock('kpi-wait', `${lane} \u00b7 time at till`, fmtWait(info.dwell))}
    ${kpiBlock('kpi-through', 'people through', through)}
    ${kpiBlock('kpi-speed', 'pace', speed)}`;
}

function leakageKpi(info, roi) {
  if (isCheckoutRoi(roi)) return checkoutKpi(info, roi);
  const euro = info?.euroDay || 0;
  const live = info?.profitBasis === 'LIVE';
  const label = (roi?.category || roi?.name || info?.name || 'Zone').toUpperCase();
  const stop = Math.round((info?.engagement || 0) * 100);
  const leakOn = euro > 0.5;
  const gauge = isProductRoi(roi) ? stopGaugeSvg(info?.engagement, { showValue: leakOn }) : '';
  if (leakOn) {
    return `
      ${kpiBlock('kpi-leakage', `${label} \u00b7 ${live ? 'recoverable / day' : 'margin leakage / day'}`, `${fmtEuro(euro)}${live ? '' : '<span class="kpi-sim"> modelled</span>'}`)}
      ${gauge}
      ${kpiBlock('kpi-tracks', 'tracks', Math.round(info.footfall).toLocaleString())}`;
  }
  return `
    ${kpiBlock('kpi-stop', `${label} \u00b7 stop`, `${stop}%`)}
    ${gauge}
    ${kpiBlock('kpi-dwell', 'mean dwell', `${Math.round(info.dwell)} s`)}
    ${kpiBlock('kpi-tracks', 'tracks', Math.round(info.footfall).toLocaleString())}`;
}

let kpiKey = '';
function paintKpiHud() {
  const el = document.getElementById('kpiHud');
  if (!el) return;
  const hide = hoverCell == null || field.support[hoverCell] <= 0
    || document.documentElement.classList.contains('story-on')
    || document.documentElement.classList.contains('drill-on')
    || document.documentElement.classList.contains('tour-on')
    || document.documentElement.classList.contains('export');
  if (hide) {
    kpiKey = '';
    el.classList.remove('on');
    return;
  }
  const v = cellVenue(hoverCell);
  const roi = layersEngine?.pickRoi?.(v.x, v.z);
  const inCone = !roi && layersEngine?.inScreenCone?.(v.x, v.z);
  const hotView = isHotView();
  const key = `${params.scalar}:${hotView ? 'h' : ''}:${roi && !hotView ? `z:${roi.id}` : inCone ? 's' : `c:${hoverCell}`}:${layersEngine?.profitBasis?.() || ''}`;
  if (key === kpiKey && el.classList.contains('on')) return;
  kpiKey = key;
  let html = '';
  if (roi && isCheckoutRoi(roi)) {
    html = checkoutKpi(layersEngine.inspect(roi), roi);
  } else if (hotView) {
    const info = classifyPatch(hoverCell);
    html = `
      ${kpiBlock('kpi-stop', info.title, `${Math.round(info.stop * 100)}%`)}
      ${nearbyBarsHtml(info, info.near)}
      ${kpiBlock('kpi-nearby', 'stop vs nearby', info.near ? signedPct(info.stop, info.near.stop) : '—')}
      ${kpiBlock('kpi-nearby', 'dwell vs nearby', info.near ? signedPct(info.dwell, info.near.dwell) : '—')}`;
  } else if (roi) {
    html = leakageKpi(layersEngine.inspect(roi), roi);
  } else if (inCone) {
    const sez = layersEngine.screenSezVerts();
    const info = sez ? layersEngine.inspect({ vertices: sez, name: 'Screen cone' }) : null;
    const bay = layersEngine.advertisedRoi();
    const bayInfo = bay ? layersEngine.inspect(bay) : null;
    const dens = bayInfo && info?.area
      ? (bayInfo.footfall / Math.max(1, bayInfo.area))
      : 0;
    html = `
      ${kpiBlock('kpi-sez', 'SEZ', `${info ? Math.round(info.sezPct * 100) : 0}%`)}
      ${kpiBlock('kpi-eal', 'EAL <span class="kpi-sim">simulated</span>', `${info ? Math.round(info.eal * 100) : 0}%`)}
      ${kpiBlock('kpi-density', 'facing density', dens.toFixed(1))}`;
  } else {
    const k = hoverCell;
    const sc = field.scalars[params.scalar];
    if (sc?.signed && params.scalar.startsWith('shift_')) {
      const story = shiftStory();
      const d = sc.data[k];
      html = `
      ${kpiBlock('kpi-share', d >= 0 ? story.hoverPos : story.hoverNeg, `${d >= 0 ? '+' : ''}${Math.round(d * 100)}%`)}
      ${kpiBlock('kpi-share', 'share \u0394', sc.dwellDelta ? `${sc.dwellDelta[k] >= 0 ? '+' : ''}${Math.round(sc.dwellDelta[k] * 100)}%` : '—')}
      ${kpiBlock('kpi-dwell', 'dwell \u0394', `${Math.round(field.dwell[k])} s`)}`;
    } else {
      const cellEuro = layersEngine?.euroAt?.(k) || 0;
      html = cellEuro > 0.05
        ? `
      ${kpiBlock('kpi-leakage', 'margin leakage', `${fmtEuro(cellEuro)}<span class="kpi-sim"> / cell</span>`)}
      ${kpiBlock('kpi-dwell', 'dwell', `${Math.round(field.dwell[k])} s`)}
      ${kpiBlock('kpi-footfall', 'footfall', Math.round(field.traffic[k]))}`
        : `
      ${kpiBlock('kpi-dwell', 'dwell', `${Math.round(field.dwell[k])} s`)}
      ${kpiBlock('kpi-footfall', 'footfall', Math.round(field.traffic[k]))}
      ${kpiBlock('kpi-purity', 'purity', field.purity[k].toFixed(2))}`;
    }
  }
  el.innerHTML = html;
  el.classList.add('on');
  if (explainOn) syncExplainMarks();
}

function updateHud() {
  const el = document.getElementById('hud');
  const productsOpen = document.getElementById('products')?.style.display === 'block';
  paintKpiHud();
  if (collapsedRail()) {
    if (el) el.style.display = 'none';
    return;
  }
  if (productsOpen || hoverCell == null || field.support[hoverCell] <= 0) { el.style.display = 'none'; return; }
  const k = hoverCell;
  const info = classifyPatch(k);
  const hotView = params.scalar === 'outlier' || everydayId === 'hot';
  const near = info.near;
  el.style.display = 'block';
  if (hotView) {
    el.innerHTML = `
      <div class="hud-kicker">${info.title}</div>
      ${hudRow('kpi-stop', 'Stop-rate', `${Math.round(info.stop * 100)}%`)}
      ${hudRow('kpi-nearby', 'vs nearby stop', near ? signedPct(info.stop, near.stop) : '—')}
      ${hudRow('kpi-nearby', 'Dwell vs nearby', near ? signedPct(info.dwell, near.dwell) : '—')}
      ${hudRow('kpi-nearby', 'Traffic vs nearby', near ? signedPct(info.traffic, near.traffic) : '—')}
      ${hudRow('glance-outlier', 'Outlier', info.outlier.toFixed(2))}
      <div class="hud-note">${info.note} Click the hill to pin it.</div>`;
    if (explainOn) syncExplainMarks();
    return;
  }
  const deg = ((Math.atan2(field.meanY[k], field.meanX[k]) * 180 / Math.PI) + 360) % 360;
  const rid = field.regime ? (field.regime[k] | 0) : 0;
  const sc = field.scalars[params.scalar];
  let extra = '';
  if (params.scalar === 'regime') {
    extra = hudRow('kpi-purity', 'Regime', REGIME_CATEGORIES[rid]?.label || '—');
  } else if (sc?.signed && sc.dwellDelta) {
    const story = shiftStory();
    const dFoot = sc.data[k];
    extra = `
      <div class="hud-kicker">${dFoot >= 0 ? story.hoverPos : story.hoverNeg}</div>
      ${hudRow('kpi-share', 'Share \u0394', `${dFoot >= 0 ? '+' : ''}${(dFoot * 100).toFixed(0)}%`)}
      ${hudRow('kpi-dwell', 'Dwell \u0394', `${sc.dwellDelta[k] >= 0 ? '+' : ''}${(sc.dwellDelta[k] * 100).toFixed(0)}%`)}
      ${hudRow('kpi-nearby', 'Dwell vs nearby', near ? signedPct(info.dwell, near.dwell) : '—')}`;
  } else {
    extra = `
      ${hudRow('kpi-nearby', 'Dwell vs nearby', near ? signedPct(info.dwell, near.dwell) : '—')}
      ${hudRow('kpi-nearby', 'Traffic vs nearby', near ? signedPct(info.traffic, near.traffic) : '—')}`;
  }
  const vHover = cellVenue(k);
  const roiHover = layersEngine?.pickRoi?.(vHover.x, vHover.z);
  if (roiHover) {
    const z = layersEngine.inspect(roiHover);
    if ((z.euroDay || 0) > 0.5) {
      const live = z.profitBasis === 'LIVE';
      extra = `
      <div class="hud-kicker">${live ? 'Profit Radar' : 'Margin leakage'}</div>
      ${hudRow('kpi-leakage', live ? 'Recoverable / day' : 'Leakage / day', `${fmtEuro(z.euroDay)}${live ? '' : ' · modelled'}`)}
      ${hudRow('kpi-stop', 'Stop-rate', `${Math.round((z.engagement || 0) * 100)}%`)}
      ${extra}`;
    }
  }
  el.innerHTML = `
    ${hudRow('kpi-footfall', 'Footfall', `${Math.round(field.traffic[k])} tracks`)}
    ${hudRow('kpi-dwell', 'Dwell', `${Math.round(field.dwell[k])} s`)}
    ${hudRow('kpi-speed', 'Walking speed', `${field.speed[k].toFixed(2)} m/s`)}
    ${hudRow('kpi-purity', 'Directional purity', field.purity[k].toFixed(2))}
    ${hudRow('kpi-heading', 'Net heading', `${deg.toFixed(0)}&deg;`)}
    ${extra}
    <div class="hud-note">${params.scalar === 'regime' ? (REGIME_NOTE[rid] || '')
      : params.scalar?.startsWith('shift_') ? shiftStory().note
      : field.purity[k] < 0.25 ? 'Two-way / milling — a mean arrow would cancel here' : 'Click a patch to compare it with the aisle around it.'}</div>`;
  if (explainOn) syncExplainMarks();
}

function updateLegend() {
  const sc = field.scalars[params.scalar];
  if (!sc) return;
  const bar = document.getElementById('legend-bar');
  const cats = document.getElementById('legend-cats');
  const ends = document.querySelector('.legend-ends');
  if (params.showCategory) {
    bar.style.display = 'none';
    if (ends) ends.style.display = 'none';
    const keys = Object.keys(CATEGORY_HSL);
    if (cats) {
      cats.style.display = 'grid';
      cats.innerHTML = keys.map((c) => {
        const [h, s, l] = CATEGORY_HSL[c];
        const col = `hsl(${(h * 360).toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`;
        return `<div class="legend-cat"><span class="swatch" style="background:${col}"></span>${c}</div>`;
      }).join('');
    }
    document.getElementById('legend-label').textContent = 'Product category';
    return;
  }
  if (sc.categorical) {
    bar.style.display = 'none';
    if (ends) ends.style.display = 'none';
    if (cats) {
      cats.style.display = 'grid';
      cats.innerHTML = (sc.categories || REGIME_CATEGORIES).map((c) =>
        `<div class="legend-cat"><span class="swatch" style="background:${c.color}"></span>${c.label}</div>`
      ).join('');
    }
    document.getElementById('legend-label').textContent = sc.label;
    return;
  }
  bar.style.display = 'block';
  if (ends) ends.style.display = 'flex';
  if (cats) { cats.style.display = 'none'; cats.innerHTML = ''; }
  const extent = sc.signed ? signedColourExtent(sc) : 0;
  const stops = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const { h, s, l } = sc.signed
      ? signedRamp(u * 2 - 1)
      : heatRamp(u);
    stops.push(`hsl(${(h * 360).toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%) ${(u * 100).toFixed(0)}%`);
  }
  bar.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
  document.getElementById('legend-label').textContent = sc.signed
    ? (params.scalar.startsWith('shift_')
      ? shiftStory().title
      : `${sc.label} — cyan = flows merging, red = flows splitting`)
    : `${sc.label} (${sc.unit})`;
  document.getElementById('legend-lo').textContent = sc.signed
    ? (params.scalar.startsWith('shift_') ? shiftStory().lo : `\u2212${extent.toFixed(2)}`)
    : '0';
  document.getElementById('legend-hi').textContent = sc.signed
    ? (params.scalar.startsWith('shift_') ? shiftStory().hi : `+${extent.toFixed(2)}`)
    : (sc.max <= 1 ? sc.max.toFixed(2) : Math.round(sc.max).toLocaleString());
}

// Companion slices for temporal-shift / purity-break overlays (lazy).
let analysisPromise = null;
let companionMaps = null;
async function fetchFieldJson(slice, date) {
  const res = await fetch(fieldUrl(slice, date), { cache: 'no-store' });
  if (!res.ok) throw new Error(`field HTTP ${res.status}`);
  return res.json();
}

async function applyDayCompare() {
  if (!fieldApi.compare || !fieldApi.date) {
    if (field.scalars.shift_day) delete field.scalars.shift_day;
    return false;
  }
  const label = `Shift ${fieldApi.compare} \u2192 ${fieldApi.date}`;
  if (field.scalars.shift_day?.label === label) return true;
  const [cmp, here] = await Promise.all([
    fetchFieldJson(sliceId, fieldApi.compare),
    fetchFieldJson(sliceId, fieldApi.date),
  ]);
  if (!cmp?.cells?.length || !here?.cells?.length) {
    throw new Error('empty compare payload');
  }
  attachShiftScalar(
    field,
    cellMapFromFieldJson(cmp),
    cellMapFromFieldJson(here),
    'shift_day',
    label,
  );
  compareError = '';
  return true;
}

async function ensureShiftAnalysis() {
  if (params.scalar === 'shift_day') {
    if (fieldApi.compare) await applyDayCompare();
    return;
  }
  if (!field.scalars.shift_me || !field.scalars.shift_ww) {
    if (!analysisPromise) {
      analysisPromise = (async () => {
        if (!companionMaps) {
          const ids = ['morning', 'evening', 'weekday', 'weekend'];
          const payloads = await Promise.all(ids.map((id) => fetchFieldJson(id, fieldApi.date)));
          const [morning, evening, weekday, weekend] = payloads.map(cellMapFromFieldJson);
          companionMaps = { morning, evening, weekday, weekend };
        }
        const { morning, evening, weekday, weekend } = companionMaps;
        attachShiftScalar(field, morning, evening, 'shift_me', 'Shift morning \u2192 evening');
        attachShiftScalar(field, weekday, weekend, 'shift_ww', 'Shift weekday \u2192 weekend');
        boostOutliersWithPurityBreak(field, morning, evening);
      })();
    }
    await analysisPromise;
  }
  if (fieldApi.compare && !field.scalars.shift_day) await applyDayCompare();
}

function markSliceActive(id) {
  document.querySelectorAll('button.slice[data-slice]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.slice === id);
  });
  const note = document.getElementById('sliceNote');
  if (note) note.textContent = SLICE_LABELS[id] || id;
}

function fmtDay(ts) {
  if (!ts) return '—';
  const tz = field.meta.tz_offset_h ?? 2;
  const d = new Date(ts + tz * 3600 * 1000);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' local';
}

function updateMeta() {
  const live = useLivePack && field.meta.pack === 'live';
  const date = field.meta.local_date || fieldApi.date || 'snapshot';
  document.getElementById('meta').innerHTML =
    `${field.NX}\u00d7${field.NY} cells at ${CELL} m \u00b7 ` +
    `${(field.meta.rows_in_hours || 0).toLocaleString()} positions \u00b7 ` +
    `${field.meta.cells_emitted.toLocaleString()} cells \u00b7 ` +
    `${(field.meta.steps_total || 0).toLocaleString()} steps`;
  const asOf = document.getElementById('asOf');
  if (asOf) {
    asOf.textContent = live
      ? `${date} \u00b7 ${fmtDay(field.meta.first_ts)} \u2192 ${fmtDay(field.meta.last_ts)}`
      : 'Static demo snapshot (live pack unavailable)';
  }
  const cmpNote = document.getElementById('compareNote');
  if (cmpNote) {
    if (everydayId === 'change' || params.scalar?.startsWith('shift_')) {
      cmpNote.textContent = shiftStory().note;
    } else if (fieldApi.compare) {
      cmpNote.textContent = `Compare ${fieldApi.compare} is only used on “Did my change work?”. This floor is one day (${date}) — dwell colour, like the landing snapshot. Set Compare to None or open that chip for cyan/red.`;
    } else {
      cmpNote.textContent = 'Leave Compare on None for a single-day snapshot (landing page). Pick a second day only when you want cyan/red share Δ.';
    }
  }
  const badge = document.getElementById('packBadge');
  if (badge) badge.textContent = live ? 'LIVE' : 'DEMO';
  const shiftBtn = document.getElementById('shiftDayBtn');
  if (shiftBtn) shiftBtn.hidden = !fieldApi.compare;
  paintReadKey();
  const planSource = document.getElementById('planSource');
  if (planSource) {
    planSource.textContent =
      `${layout.venue?.name || 'Venue'} \u00b7 `
      + `${(layout.counts?.polygons || 0).toLocaleString()} fixtures \u00b7 `
      + `${date} \u00b7 slice: ${sliceId}`;
  }
}

function fillDateSelects() {
  const dayEl = document.getElementById('fieldDate');
  const cmpEl = document.getElementById('compareDate');
  if (!dayEl || !cmpEl) return;
  const days = dateCatalog?.dates || [];
  if (!days.length) {
    dayEl.innerHTML = `<option value="">Snapshot</option>`;
    dayEl.disabled = true;
    cmpEl.disabled = true;
    return;
  }
  dayEl.innerHTML = days.map((d) =>
    `<option value="${d.date}">${d.date} \u00b7 ${Number(d.rows).toLocaleString()} samples</option>`
  ).join('');
  dayEl.value = fieldApi.date || dateCatalog.latest || days[0].date;
  const ok = catalogHasDays();
  cmpEl.disabled = !ok;
  cmpEl.innerHTML = `<option value="">None — one day</option>` + days
    .filter((d) => d.date !== dayEl.value)
    .map((d) => `<option value="${d.date}">${d.date}</option>`).join('');
  cmpEl.value = ok && fieldApi.compare && cmpEl.querySelector(`option[value="${fieldApi.compare}"]`)
    ? fieldApi.compare
    : '';
}

function writeUrlState() {
  const u = new URL(location.href);
  u.searchParams.set('slice', sliceId);
  if (useLivePack && fieldApi.date) u.searchParams.set('date', fieldApi.date);
  else u.searchParams.delete('date');
  if (fieldApi.compare) u.searchParams.set('compare', fieldApi.compare);
  else u.searchParams.delete('compare');
  history.replaceState(null, '', u.toString());
}

let sliceSwitching = false;
async function switchSlice(next) {
  if (!next || !SLICE_LABELS[next] || next === sliceId || sliceSwitching) return;
  markPresetCustom();
  sliceSwitching = true;
  markSliceActive(next);
  setLoader(true, `Loading ${SLICE_LABELS[next]}…`);
  document.querySelectorAll('button.slice[data-slice]').forEach((b) => { b.disabled = true; });
  try {
    const nextField = await loadFieldSmart(next);
    field = nextField;
    sliceId = next;
    reachSource = null;
    reachFar = null;
    // Shift overlays are tied to absolute cells of the active grid — rebuild.
    analysisPromise = null;
    companionMaps = null;
    if (field.scalars.shift_me) delete field.scalars.shift_me;
    if (field.scalars.shift_ww) delete field.scalars.shift_ww;
    if (field.scalars.shift_day) delete field.scalars.shift_day;
    roseBuf = new Float32Array(field.B);
    syncFieldGeometry();
    if (params.scalar === 'shift_me' || params.scalar === 'shift_ww' || params.scalar === 'shift_day' || params.scalar === 'outlier') {
      await ensureShiftAnalysis();
    } else if (!field.scalars[params.scalar]) {
      params.scalar = 'dwell';
      const sel = document.getElementById('scalar');
      if (sel) sel.value = 'dwell';
      document.querySelectorAll('button.analysis').forEach((btn) => btn.classList.remove('active'));
    }
    updateMeta();
    rebuildTerrain();
    buildArrows();
    buildFloorplan();
    rebuildPhysicsLayers();
    buildParticles();
    writeUrlState();
  } catch (err) {
    console.error('Failed to switch time window', err);
    markSliceActive(sliceId);
    setLoader(true, 'Could not load that time window');
    await new Promise((r) => setTimeout(r, 900));
  } finally {
    if (!field.scalars[params.scalar]) params.scalar = 'dwell';
    try { rebuildTerrain(); } catch { /* keep fixtures visible */ }
    document.querySelectorAll('button.slice[data-slice]').forEach((b) => { b.disabled = false; });
    setLoader(false);
    sliceSwitching = false;
  }
}

async function switchDate(nextDate) {
  if (!nextDate || nextDate === fieldApi.date || sliceSwitching) return;
  if (!useLivePack && catalogHasDays()) {
    const ok = await ensureLivePack();
    if (!ok) {
      setLoader(true, 'Could not load live days');
      await new Promise((r) => setTimeout(r, 1200));
      setLoader(false);
      return;
    }
    if (nextDate === fieldApi.date) return;
  }
  sliceSwitching = true;
  setLoader(true, `Loading ${nextDate}…`);
  try {
    fieldApi.date = nextDate;
    if (fieldApi.compare === nextDate) fieldApi.compare = '';
    const nextField = await loadFieldSmart(sliceId, nextDate);
    field = nextField;
    reachSource = null;
    reachFar = null;
    analysisPromise = null;
    companionMaps = null;
    roseBuf = new Float32Array(field.B);
    syncFieldGeometry();
    CELL = field.meta.cell_m;
    fillDateSelects();
    const paintCompare = (everydayId === 'change' || params.scalar === 'shift_day') && !!fieldApi.compare;
    if (paintCompare) {
      try {
        await applyDayCompare();
        params.scalar = 'shift_day';
        compareError = '';
      } catch (err) {
        console.error('Compare after date switch failed', err);
        compareError = 'Could not paint the earlier day. Floor is this date’s dwell until both load.';
        params.scalar = 'dwell';
      }
      const sel = document.getElementById('scalar');
      if (sel) sel.value = params.scalar;
      document.querySelectorAll('button.analysis').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.scalar === params.scalar);
      });
    } else if (String(params.scalar || '').startsWith('shift_') && everydayId !== 'change') {
      params.scalar = everydayId === 'hot' ? 'outlier' : 'dwell';
      const sel = document.getElementById('scalar');
      if (sel && field.scalars[params.scalar]) sel.value = params.scalar;
    }
    updateMeta();
    rebuildTerrain();
    buildArrows();
    buildFloorplan();
    rebuildPhysicsLayers();
    buildParticles();
    writeUrlState();
    paintReadKey();
  } catch (err) {
    console.error('Failed to switch day', err);
    setLoader(true, 'Could not load that day');
    await new Promise((r) => setTimeout(r, 900));
  } finally {
    if (!field.scalars[params.scalar]) params.scalar = 'dwell';
    try { rebuildTerrain(); } catch { /* keep fixtures visible */ }
    setLoader(false);
    sliceSwitching = false;
    paintReadKey();
  }
}

async function onCompareChange(next) {
  if (next && !useLivePack && catalogHasDays()) {
    const ok = await ensureLivePack();
    if (!ok) {
      setLoader(true, 'Could not load live days for compare');
      await new Promise((r) => setTimeout(r, 1200));
      setLoader(false);
      fillChangeDaySelects();
      return;
    }
  }
  fieldApi.compare = next || '';
  if (field.scalars.shift_day) delete field.scalars.shift_day;
  writeUrlState();
  if (!fieldApi.compare) {
    updateMeta();
    if (everydayId === 'change') await setScalar('shift_me');
    else if (String(params.scalar).startsWith('shift_')) {
      await setScalar(everydayId === 'hot' ? 'outlier' : 'dwell');
    } else rebuildTerrain();
    paintReadKey();
    return;
  }
  setLoader(true, `Comparing ${fieldApi.compare} \u2192 ${fieldApi.date}…`);
  try {
    await applyDayCompare();
    params.scalar = 'shift_day';
    compareError = '';
    const sel = document.getElementById('scalar');
    if (sel) sel.value = 'shift_day';
    document.querySelectorAll('button.analysis').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.scalar === 'shift_day');
    });
    updateMeta();
    updateLegend();
    rebuildTerrain();
    paintReadKey();
  } catch (err) {
    console.error('Failed to compare days', err);
    compareError = 'Could not load the compare day. Floor stays on dwell.';
    params.scalar = 'dwell';
    rebuildTerrain();
    paintReadKey();
    setLoader(true, 'Could not load the compare day');
    await new Promise((r) => setTimeout(r, 900));
  } finally {
    setLoader(false);
  }
}

async function setScalar(next) {
  if (!next) return;
  markPresetCustom();
  params.scalar = next;
  const sel = document.getElementById('scalar');
  if (sel && sel.value !== next) sel.value = next;
  document.querySelectorAll('button.analysis').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scalar === next);
  });
  try {
    if (next === 'shift_day') {
      if (fieldApi.compare) await applyDayCompare();
      else params.scalar = 'shift_me';
    }
    if (params.scalar === 'shift_me' || params.scalar === 'shift_ww' || params.scalar === 'outlier') {
      await ensureShiftAnalysis();
    }
  } catch (err) {
    console.error('Failed to paint scalar', next, err);
    if (next === 'shift_day') {
      compareError = 'Could not paint the day compare. Floor is dwell.';
    }
    params.scalar = field.scalars.dwell ? 'dwell' : params.scalar;
  }
  if (!field.scalars[params.scalar]) params.scalar = 'dwell';
  rebuildTerrain();
  rebuildPeekMarks();
  paintReadKey();
}

// ---------------------------------------------------------------------- wiring
const bind = (id, fn, evt = 'input') => document.getElementById(id).addEventListener(evt, fn);
bind('scalar', (e) => { void setScalar(e.target.value); }, 'change');
bind('viewPreset', (e) => { void applyViewPreset(e.target.value); }, 'change');
document.querySelectorAll('button.everyday[data-everyday]').forEach((btn) => {
  btn.addEventListener('click', () => {
    void applyEverydayView(btn.dataset.everyday);
    if (document.documentElement.classList.contains('ff-phone')) {
      window.dispatchEvent(new CustomEvent('ff-phone-ask-picked'));
    }
  });
});
document.getElementById('tourToggle')?.addEventListener('click', () => {
  if (tourOn) stopTour();
  else void startTour();
});
document.getElementById('explainToggle')?.addEventListener('click', () => {
  setExplain(!explainOn);
});
document.addEventListener('pointerover', (e) => {
  if (!explainOn) return;
  const hit = explainTarget(e.target);
  if (!hit) return;
  if (explainPinned && hit.key !== explainKey) return;
  paintExplain(hit.key);
});
document.addEventListener('pointerout', (e) => {
  if (!explainOn || explainPinned) return;
  const from = explainTarget(e.target);
  const to = explainTarget(e.relatedTarget);
  if (from && !to) paintExplain(defaultExplainKey());
});
document.addEventListener('click', (e) => {
  if (!explainOn) return;
  if (e.target.closest('#explainToggle')) return;
  const hit = explainTarget(e.target);
  if (hit) {
    if (hit.key === explainKey && explainPinned) explainPinned = false;
    else paintExplain(hit.key, { pin: true });
    if (!e.target.closest('#everydayBar, #whyChip, button, a, select, input, label')) {
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }
  if (explainPinned && !e.target.closest('#explainDock')) {
    explainPinned = false;
    paintExplain(defaultExplainKey());
  }
});
document.getElementById('tourPrev')?.addEventListener('click', () => { void stepTour(-1); });
document.getElementById('tourNext')?.addEventListener('click', () => { void stepTour(1); });
document.querySelectorAll('button.analysis').forEach((btn) => {
  btn.addEventListener('click', () => { void setScalar(btn.dataset.scalar); });
  if (btn.dataset.scalar === params.scalar) btn.classList.add('active');
});
bind('terrainHeight', (e) => {
  params.terrainHeight = +e.target.value;
  document.getElementById('terrainHeightVal').textContent = params.terrainHeight.toFixed(1) + ' m';
  rebuildTerrain(); buildArrows(); buildFloorplan(); rebuildPhysicsLayers();
});
// Changing the alignment moves the measured field, not the plan, so the terrain,
// glyphs and in-flight streamlines all have to be rebuilt.
function realign() {
  rebuildTerrain();
  buildArrows();
  buildFloorplan();
  rebuildPhysicsLayers();
  buildParticles();
}
bind('planRot', (e) => {
  params.planRotDeg = +e.target.value;
  document.getElementById('planRotVal').textContent = params.planRotDeg.toFixed(1) + '\u00b0';
  realign();
});
bind('planDx', (e) => {
  params.planDx = +e.target.value;
  document.getElementById('planDxVal').textContent = params.planDx.toFixed(1) + ' m';
  realign();
});
bind('planDz', (e) => {
  params.planDz = +e.target.value;
  document.getElementById('planDzVal').textContent = params.planDz.toFixed(1) + ' m';
  realign();
});
bind('showPlan', (e) => { markPresetCustom(); params.showPlan = e.target.checked; planGroup.visible = params.showPlan; }, 'change');
bind('showFixtures', (e) => {
  markPresetCustom();
  params.showFixtures = e.target.checked;
  obstacleGroup.visible = params.showFixtures;
}, 'change');
bind('planMirror', (e) => { params.planMirror = e.target.checked; realign(); }, 'change');
bind('particles', (e) => {
  params.particles = +e.target.value;
  document.getElementById('particlesVal').textContent = params.particles.toLocaleString();
  buildParticles();
});
bind('trail', (e) => {
  params.trail = +e.target.value;
  document.getElementById('trailVal').textContent = params.trail;
  buildParticles();
});
bind('timeScale', (e) => {
  params.timeScale = +e.target.value;
  document.getElementById('timeScaleVal').textContent = params.timeScale.toFixed(1) + '\u00d7';
  document.getElementById('timeScaleNote').textContent =
    `\u2248 ${(0.6 * params.timeScale).toFixed(1)} m/s on screen for a 0.6 m/s walker`;
});
bind('kappa', (e) => {
  params.kappa = +e.target.value;
  document.getElementById('kappaVal').textContent = params.kappa.toFixed(1);
});
bind('dwellDrag', (e) => { markPresetCustom(); params.dwellDrag = e.target.checked; }, 'change');
bind('showTerrain', (e) => { markPresetCustom(); params.showTerrain = e.target.checked; rebuildTerrain(); buildArrows(); buildFloorplan(); rebuildPhysicsLayers(); }, 'change');
bind('showArrows', (e) => { markPresetCustom(); params.showArrows = e.target.checked; arrowGroup.visible = params.showArrows; }, 'change');
bind('showFlow', (e) => { markPresetCustom(); lineMesh.visible = e.target.checked; }, 'change');
function bindLayer(id, key, extra) {
  const el = document.getElementById(id);
  if (!el) return;
  el.checked = !!params[key];
  el.addEventListener('change', () => {
    markPresetCustom();
    params[key] = el.checked;
    extra?.();
  });
}
bindLayer('showHeat', 'showHeat', () => applyHeat());
bindLayer('showScreenFov', 'showScreenFov', () => layersEngine?.applyVisibility());
bindLayer('showSpeakers', 'showSpeakers', () => layersEngine?.applyVisibility());
bindLayer('showProfit', 'showProfit', () => {
  layersEngine?.applyVisibility();
  rebuildReadings();
  refreshWhyChip();
});
bindLayer('showMedia', 'showMedia', () => {
  layersEngine?.applyVisibility();
  refreshRudderHud();
});
bindLayer('showCategory', 'showCategory', () => {
  rebuildTerrain();
  updateLegend();
  void updateProductGallery();
});
bindLayer('showTicker', 'showTicker', () => refreshTicker());
bindLayer('showIsoline', 'showIsoline', () => rebuildTerrain());
bindLayer('showPeakGlow', 'showPeakGlow', () => rebuildTerrain());
bindLayer('showCurtain', 'showCurtain', () => rebuildReadings());
document.getElementById('tickerStage')?.addEventListener('click', onTickerClick);
const tickerBar = document.getElementById('ticker');
if (tickerBar) {
  tickerBar.addEventListener('mouseenter', () => { tickerPaused = true; });
  tickerBar.addEventListener('mouseleave', () => {
    tickerPaused = false;
    startTickerLoop();
  });
}
document.getElementById('storyToggle')?.addEventListener('click', () => {
  if (storyActive) void exitStory();
  else void enterStory();
});
window.__ffStory = {
  enter: () => { if (!storyActive) void enterStory(); },
  exit: () => { if (storyActive) void exitStory(); },
  toggle: () => { if (storyActive) void exitStory(); else void enterStory(); },
  isActive: () => storyActive,
};
window.addEventListener('message', (e) => {
  if (e.origin !== window.location.origin) return;
  const t = e.data && e.data.type;
  if (t === 'ff-controls-collapsed') window.__ffControls?.setCollapsed?.(!!e.data.on);
  if (t === 'ff-story-toggle') window.__ffStory.toggle();
});

const FF_DEFAULT_VENUE = '55fdd53b-3298-4355-97c0-b4e789b11d06';
const FF_DAY_MS = 24 * 3600 * 1000;
const FF_MAX_RANGE_MS = 30 * FF_DAY_MS;
const FF_REPORT_TIMEOUT_MS = 120000;
let reportBusy = false;

function ymdInRome(ts = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

function dayBoundsRome(ymd) {
  const noonUtc = Date.parse(`${ymd}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(noonUtc));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const offsetH = (Number.isFinite(hour) ? hour : 14) - 12 + (Number.isFinite(minute) ? minute / 60 : 0);
  const startTs = Date.parse(`${ymd}T00:00:00Z`) - offsetH * 3600 * 1000;
  return { startTs, endTs: startTs + FF_DAY_MS };
}

function trailingRange(durationMs) {
  const align = 5 * 60 * 1000;
  const endTs = Math.floor(Date.now() / align) * align;
  return { startTs: endTs - durationMs, endTs };
}

function showReportErr(msg) {
  const el = document.getElementById('reportErr');
  if (!el) return;
  el.hidden = !msg;
  el.textContent = msg || '';
}

function prepareReportSheet() {
  showReportErr('');
  const to = ymdInRome();
  const from = ymdInRome(Date.now() - 6 * FF_DAY_MS);
  const fromEl = document.getElementById('reportFrom');
  const toEl = document.getElementById('reportTo');
  const min = ymdInRome(Date.now() - FF_MAX_RANGE_MS);
  if (fromEl) {
    fromEl.min = min;
    fromEl.max = to;
    if (!fromEl.value) fromEl.value = from;
  }
  if (toEl) {
    toEl.min = min;
    toEl.max = to;
    if (!toEl.value) toEl.value = to;
  }
}

function reportWindow(kind) {
  if (kind === '24h') return { ...trailingRange(FF_DAY_MS), label: '24-hour', file: '24h' };
  if (kind === '7d') return { ...trailingRange(7 * FF_DAY_MS), label: '7-day', file: '7d' };
  if (kind === '30d') return { ...trailingRange(FF_MAX_RANGE_MS), label: '1-month', file: '1month' };
  const fromEl = document.getElementById('reportFrom');
  const toEl = document.getElementById('reportTo');
  let from = fromEl?.value;
  let to = toEl?.value;
  if (!from || !to) throw new Error('Pick a start and end date');
  if (from > to) { const swap = from; from = to; to = swap; }
  let { startTs } = dayBoundsRome(from);
  let { endTs } = dayBoundsRome(to);
  if (endTs - startTs > FF_MAX_RANGE_MS) {
    startTs = endTs - FF_MAX_RANGE_MS;
  }
  return { startTs, endTs, label: `${from} → ${to}`, file: `${from}_${to}` };
}

async function downloadExecutivePdf(kind) {
  if (reportBusy) return;
  const venue = fieldApi.venue || dateCatalog?.venue_id || field?.meta?.venue_id || FF_DEFAULT_VENUE;
  let win;
  try {
    win = reportWindow(kind);
  } catch (err) {
    showReportErr(err?.message || 'Pick a range');
    return;
  }
  const params = new URLSearchParams({
    venueId: venue,
    startTs: String(win.startTs),
    endTs: String(win.endTs),
    variant: 'live',
    includeFlowField: '1',
  });
  reportBusy = true;
  showReportErr('');
  window.dispatchEvent(new CustomEvent('ff-phone-report-busy'));
  setLoader(true, `Building ${win.label} report…`, { indefinite: true });
  const ctrl = new AbortController();
  const kill = window.setTimeout(() => ctrl.abort(), FF_REPORT_TIMEOUT_MS);
  try {
    const res = await fetch(`/api/reporting/esselunga-executive/pdf?${params}`, { signal: ctrl.signal });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.error) detail = body.error;
      } catch (_) { /* use status */ }
      throw new Error(detail);
    }
    const blob = await res.blob();
    const dispo = res.headers.get('Content-Disposition') || '';
    const m = /filename="([^"]+)"/.exec(dispo);
    const name = m ? m[1] : `hyperspace-${win.file}.pdf`;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 8000);
  } catch (err) {
    const msg = err?.name === 'AbortError'
      ? 'Timed out — try a shorter window'
      : (err?.message || 'Download failed');
    showReportErr(msg);
    window.dispatchEvent(new CustomEvent('ff-phone-report-error'));
    throw err;
  } finally {
    window.clearTimeout(kill);
    reportBusy = false;
    setLoader(false);
  }
}

window.__ffReport = {
  prepare: prepareReportSheet,
  download: (kind) => {
    void downloadExecutivePdf(kind).catch((err) => {
      console.error('Report download failed', err);
    });
  },
};
document.getElementById('storyPrev')?.addEventListener('click', () => { void gotoStory(storyIndex - 1); });
document.getElementById('storyNext')?.addEventListener('click', () => { void gotoStory(storyIndex + 1); });
document.getElementById('storyPlay')?.addEventListener('click', () => {
  if (!storyActive) return;
  storyPlaying = !storyPlaying;
  paintStoryTransport();
  if (storyPlaying) scheduleStoryAdvance();
  else stopStoryTimer();
});
document.getElementById('storyExit')?.addEventListener('click', () => { void exitStory(); });
document.getElementById('storyTicks')?.addEventListener('click', (e) => {
  const t = e.target.closest?.('i[data-i]');
  if (!t) return;
  void gotoStory(Number(t.dataset.i));
});
const storyCard = document.getElementById('storyCard');
if (storyCard) {
  storyCard.addEventListener('mouseenter', () => {
    if (storyPlaying) stopStoryTimer();
  });
  storyCard.addEventListener('mouseleave', () => {
    if (storyPlaying) scheduleStoryAdvance();
  });
}
const drillRoot = document.getElementById('drill');
if (drillRoot) {
  drillRoot.addEventListener('mouseenter', () => {
    if (storyPlaying) stopStoryTimer();
  });
  drillRoot.addEventListener('mouseleave', () => {
    if (storyPlaying) scheduleStoryAdvance();
  });
}
window.__ffStoryGotoDrill = (step, momentId) => {
  if (!storyActive) return false;
  if (momentId) storyMomentOverride = momentId;
  const i = STORY_BEATS.findIndex((b) => b.drill === step);
  if (i < 0) return false;
  void gotoStory(i);
  return true;
};
window.addEventListener('keydown', (e) => {
  if (storyActive) {
    if (e.key === 'Escape') { e.preventDefault(); void exitStory(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); void gotoStory(storyIndex + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); void gotoStory(storyIndex - 1); }
    else if (e.key === ' ') {
      e.preventDefault();
      storyPlaying = !storyPlaying;
      paintStoryTransport();
      if (storyPlaying) scheduleStoryAdvance();
      else stopStoryTimer();
    }
    return;
  }
  if (tourOn) {
    if (e.key === 'Escape') { e.preventDefault(); stopTour(); }
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); void stepTour(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); void stepTour(-1); }
    return;
  }
  if (!params.drawMode || !layersEngine) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    closeDraft(layersEngine.getDraft());
  } else if (e.key === 'Escape') {
    e.preventDefault();
    layersEngine.setDraft([]);
  }
});
document.getElementById('pickZone').addEventListener('click', () => {
  params.pickMode = !params.pickMode;
  params.drawMode = false;
  document.getElementById('pickZone').classList.toggle('active', params.pickMode);
  document.getElementById('drawZone').classList.remove('active');
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = params.pickMode ? 'Click a named ROI on the floor' : 'Drag to orbit';
});
document.getElementById('drawZone').addEventListener('click', () => {
  params.drawMode = !params.drawMode;
  params.pickMode = false;
  document.getElementById('drawZone').classList.toggle('active', params.drawMode);
  document.getElementById('pickZone').classList.remove('active');
  if (params.drawMode) {
    layersEngine?.clearSelection();
    rebuildTerrain();
    updateInspector();
    hideProductGallery();
  }
  layersEngine?.setDraft([]);
  const hint = document.getElementById('hint');
  if (hint) {
    hint.textContent = params.drawMode
      ? 'Click corners \u00b7 snap to a shelf corner or the first point to close \u00b7 Enter closes \u00b7 drag a vertex'
      : 'Drag to orbit';
  }
});
document.getElementById('clearZone').addEventListener('click', () => {
  layersEngine?.clearSelection();
  params.pickMode = false;
  params.drawMode = false;
  document.getElementById('pickZone')?.classList.remove('active');
  document.getElementById('drawZone')?.classList.remove('active');
  rebuildTerrain();
  updateInspector();
  hideProductGallery();
  flyHome();
  refreshWhyChip();
});
bind('pause', (e) => { params.paused = !params.paused; e.target.textContent = params.paused ? 'Resume' : 'Pause'; }, 'click');
document.getElementById('navPan')?.addEventListener('click', () => {
  params.panMode = true; applyNavMode();
});
document.getElementById('navRotate')?.addEventListener('click', () => {
  params.panMode = false; applyNavMode();
});
document.getElementById('whyChip')?.addEventListener('click', () => {
  const sel = layersEngine?.getSelection();
  if (sel) window.__ffDrill?.open(sel);
});
document.getElementById('glanceMore')?.addEventListener('click', () => goDeeper());
new MutationObserver(() => { updateHud(); refreshWhyChip(); })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(container);

dropFakeCompare();
fillDateSelects();
updateMeta();
writeUrlState();
markSliceActive(sliceId);
document.getElementById('fieldDate')?.addEventListener('change', (e) => {
  void switchDate(e.target.value);
});
document.getElementById('compareDate')?.addEventListener('change', (e) => {
  onCompareChange(e.target.value);
});
document.getElementById('readKeyAfter')?.addEventListener('change', (e) => {
  void switchDate(e.target.value);
});
document.getElementById('readKeyBefore')?.addEventListener('change', (e) => {
  void onCompareChange(e.target.value);
});
document.querySelectorAll('#shiftPresets button').forEach((btn) => {
  btn.addEventListener('click', () => applyShiftPalette(btn.dataset.shiftPal));
});
document.getElementById('shiftLo')?.addEventListener('input', (e) => {
  params.shiftLo = e.target.value;
  saveShiftMix();
  syncShiftMixUi();
  if (String(params.scalar).startsWith('shift_')) rebuildTerrain();
});
document.getElementById('shiftHi')?.addEventListener('input', (e) => {
  params.shiftHi = e.target.value;
  saveShiftMix();
  syncShiftMixUi();
  if (String(params.scalar).startsWith('shift_')) rebuildTerrain();
});
document.getElementById('shiftContrast')?.addEventListener('input', (e) => {
  params.shiftContrast = Math.max(0.4, Math.min(1.45, Number(e.target.value) / 100));
  saveShiftMix();
  const cv = document.getElementById('shiftContrastVal');
  if (cv) cv.textContent = `${Math.round(params.shiftContrast * 100)}%`;
  if (String(params.scalar).startsWith('shift_')) rebuildTerrain();
});
document.querySelectorAll('button.slice[data-slice]').forEach((btn) => {
  btn.addEventListener('click', () => { void switchSlice(btn.dataset.slice); });
});

rebuildTerrain();
buildArrows();
rebuildPeekMarks();
buildFloorplan();
layersEngine = createLayerEngine({
  THREE, scene, params, pack: layersPack, layout,
  getField: () => field,
  gridToVenue, venueToGrid, terrainHeightAt, terrainHeightAtVenue, supportNorm,
  getFixtureBoxes: () => fixtureBoxes,
  getStrokeWidth,
});
rebuildPhysicsLayers();
buildParticles();
applyHeat();
initDrilldown({
  getSelection: () => layersEngine?.getSelection(),
  inspect: (sel) => layersEngine?.inspect(sel),
  liveInsights: () => layersEngine?.liveInsights?.() || [],
  getFixtureBoxes: () => fixtureBoxes,
  pointInPoly,
  getClusterContext() {
    const meta = field?.meta || {};
    const venueId = meta.venue_id || layersPack.venue_id || '';
    let start = Number(meta.first_ts);
    let end = Number(meta.last_ts);
    if (!(Number.isFinite(start) && Number.isFinite(end) && end > start) && meta.local_date) {
      const tz = meta.tz_offset_h ?? 2;
      const sign = tz >= 0 ? '+' : '-';
      const hh = String(Math.floor(Math.abs(tz))).padStart(2, '0');
      start = Date.parse(`${meta.local_date}T07:00:00${sign}${hh}:00`);
      end = Date.parse(`${meta.local_date}T22:00:00${sign}${hh}:00`);
    }
    return { venueId, start, end, date: meta.local_date || fieldApi.date || '' };
  },
  fmtEuro,
  onOpen() {
    document.documentElement.classList.add('drill-on');
    refreshWhyChip();
  },
  onClose() {
    document.documentElement.classList.remove('drill-on');
    refreshWhyChip();
  },
});
void layersEngine.tryLiveProfit().then(() => {
  refreshTicker();
  kpiKey = '';
  paintKpiHud();
});
resize();
if (bootQs.has('story')) void enterStory();
setLoader(false);

/** Named camera poses for report captures (`?export=1&view=overview`). */
function setExportView(name = 'overview') {
  const views = {
    overview: {
      pos: [planCenter.x + VENUE_SPAN * 0.18, VENUE_SPAN * 0.95, planCenter.z + VENUE_SPAN * 0.88],
      target: [planCenter.x, 0, planCenter.z],
    },
    low: {
      pos: [planCenter.x + VENUE_SPAN * 0.55, VENUE_SPAN * 0.38, planCenter.z + VENUE_SPAN * 0.72],
      target: [planCenter.x - VENUE_W * 0.05, params.terrainHeight * 0.15, planCenter.z - VENUE_D * 0.05],
    },
    top: {
      pos: [planCenter.x, VENUE_SPAN * 1.35, planCenter.z + 0.01],
      target: [planCenter.x, 0, planCenter.z],
    },
  };
  const v = views[name] || views.overview;
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  controls.update();
}

if (bootQs.has('export') || bootQs.get('scalar')) {
  const scalar = bootQs.get('scalar');
  if (scalar && (field.scalars[scalar] || scalar === 'shift_me' || scalar === 'shift_ww')) {
    await setScalar(scalar);
  }
  if (bootQs.has('export')) {
    setExportView(bootQs.get('view') || 'overview');
    rebuildTerrain();
    // Pause after trails have a moment to form, so report frames are sharp.
    setTimeout(() => { params.paused = true; }, 4500);
  }
}

// Exposed so the scene can be poked from the devtools console while tuning.
window.flowProto = {
  THREE, scene, camera, controls, params,
  get field() { return field; },
  get sliceId() { return sliceId; },
  switchSlice, rebuildTerrain, buildArrows, buildParticles, stepParticles, renderer, setExportView,
  rebuildPhysicsLayers, buildVolume,
  applyHeat, stepHeatPlumes, layersEngine,
};

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!params.paused) {
    stepParticles(dt);
    stepHeatPlumes(dt);
    layersEngine?.step(dt);
  }
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + dt * 1.6);
    const u = camAnim.t * camAnim.t * (3 - 2 * camAnim.t);
    camera.position.lerpVectors(camAnim.fromPos, camAnim.toPos, u);
    controls.target.lerpVectors(camAnim.fromTgt, camAnim.toTgt, u);
    if (camAnim.t >= 1) camAnim = null;
  }
  controls.update();
  renderer.render(scene, camera);
});
