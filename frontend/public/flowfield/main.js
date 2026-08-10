import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
// Dynamic, cache-busted: the field module is edited alongside the extractor and
// the browser otherwise pins the first version it saw for the whole session.
const bust = `?t=${Date.now()}`;
const {
  loadField,
  heatRamp,
  divergingRamp,
  regimeRamp,
  REGIME_CATEGORIES,
  cellMapFromFieldJson,
  attachShiftScalar,
  boostOutliersWithPurityBreak,
} = await import('./field.js' + bust);

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
const sliceId = SLICE_LABELS[bootQs.get('slice')] ? bootQs.get('slice') : 'all';
const field = await loadField(`./slices/field_${sliceId}.json` + bust);
const layout = await (await fetch('./layout_prod.json' + bust)).json();
const CELL = field.meta.cell_m;
const FIELD_W = field.NX * CELL;
const FIELD_D = field.NY * CELL;

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
const ORIGIN = field.meta.origin_m;
const fieldCenter = { x: ORIGIN.x + FIELD_W / 2, z: ORIGIN.y + FIELD_D / 2 };

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

scene.add(new THREE.AmbientLight(0xffffff, 0.72));
const key = new THREE.DirectionalLight(0xffffff, 0.9);
key.position.set(planCenter.x, VENUE_SPAN * 0.8, planCenter.z - VENUE_D * 0.7);
scene.add(key);

// ------------------------------------------------------------------- terrain
// Dwell becomes elevation, so the streams visibly flow around and over the
// places where people stop. The colour ramp carries the selected scalar.
const gridGeom = new THREE.BufferGeometry();
const vertCount = field.NX * field.NY;
const positions = new Float32Array(vertCount * 3);
const colors = new Float32Array(vertCount * 3);
// Quads are emitted only where the sensor actually saw people, so the surface is
// a measured patch floating over the plan rather than a slab that hides it —
// uncovered floor stays visibly uncovered instead of being interpolated away.
const indices = new Uint32Array((field.NX - 1) * (field.NY - 1) * 6);
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
const terrain = new THREE.Mesh(
  gridGeom,
  // Held back from full opacity: the scalar carpet is background, and the plan
  // and streamlines both need to read on top of it.
  new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.78 }),
);
scene.add(terrain);

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

function rebuildTerrain() {
  const sc = field.scalars[params.scalar];
  if (!sc) return;
  const extent = sc.signed ? Math.max(Math.abs(sc.min ?? 0), Math.abs(sc.max ?? 1)) || 1 : 0;
  const col = new THREE.Color();
  for (let k = 0; k < vertCount; k++) {
    const sup = supportNorm(k);
    positions[k * 3 + 1] = params.showTerrain ? heightAtCell(k) : 0;
    let r = 0.04, g = 0.05, b = 0.07;
    if (sup > 0.02) {
      const { h, s, l } = sc.categorical
        ? regimeRamp(sc.data[k])
        : sc.signed
          ? divergingRamp(sc.data[k] / extent)
          : heatRamp(sc.data[k] / (sc.max || 1));
      col.setHSL(h, s, l);
      // Lift the bottom of the ramp: a corridor people walk through has ~0 dwell
      // and would otherwise render as black, indistinguishable from floor the
      // sensor never saw. Measured-and-quiet must not look like unmeasured.
      // Categorical regimes keep fuller saturation so classes stay distinct.
      const lift = sc.categorical ? 0.04 : 0.10;
      r = lift + col.r * (1 - lift);
      g = lift + col.g * (1 - lift * 0.9);
      b = lift + col.b * (1 - lift * 0.7);
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
  updateLegend();
}

function terrainHeightAt(x, y) {
  if (!params.showTerrain) return 0;
  const s = field.scalars.dwell;
  const d = field.sampleScalar(field.dwell, x, y);
  const sup = Math.min(1, Math.sqrt(field.sampleScalar(field.support, x, y) / field.supportRef) * 1.4);
  return Math.pow(Math.min(1, d / s.max), 0.75) * params.terrainHeight * sup;
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
  for (const poly of layout.polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      // Drape over the dwell relief so fixtures are not buried inside hills.
      verts.push(a[0], terrainHeightAtVenue(a[0], a[1]) + 0.12, a[1]);
      verts.push(b[0], terrainHeightAtVenue(b[0], b[1]) + 0.12, b[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  planGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({
    color: 0x8fd8ee, transparent: true, opacity: params.planOpacity, depthWrite: false,
  })));
  planGroup.visible = params.showPlan;
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
const roseBuf = new Float32Array(field.B);

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
  const s = field.randomSpawn();
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
  for (let i = 0; i < particles.length; i++) {
    const h = particles[i].hist;
    for (let s = 0; s < segs; s++) {
      const o = ((i * segs + s) * 2) * 3;
      linePos[o] = h[s * 3]; linePos[o + 1] = h[s * 3 + 1]; linePos[o + 2] = h[s * 3 + 2];
      linePos[o + 3] = h[(s + 1) * 3]; linePos[o + 4] = h[(s + 1) * 3 + 1]; linePos[o + 5] = h[(s + 1) * 3 + 2];
    }
  }
  lineGeom.attributes.position.needsUpdate = true;
}

// ------------------------------------------------------------------ hover HUD
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hoverCell = null;
renderer.domElement.addEventListener('pointermove', (e) => {
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

const REGIME_NOTE = {
  0: 'Mixed / quiet — no dominant behaviour class',
  1: 'Through-route — high motion, low dwell',
  2: 'Dwell node — top engagement / queueing',
  3: 'One-way spine — directional purity ≥ 0.55',
  4: 'Two-way aisle — milling / opposing flows',
};

function updateHud() {
  const el = document.getElementById('hud');
  if (hoverCell == null || field.support[hoverCell] <= 0) { el.style.display = 'none'; return; }
  const k = hoverCell;
  const deg = ((Math.atan2(field.meanY[k], field.meanX[k]) * 180 / Math.PI) + 360) % 360;
  const rid = field.regime ? (field.regime[k] | 0) : 0;
  const sc = field.scalars[params.scalar];
  let extra = '';
  if (params.scalar === 'regime') {
    extra = `<div class="hud-row"><span>Regime</span><b>${REGIME_CATEGORIES[rid]?.label || '—'}</b></div>`;
  } else if (params.scalar === 'outlier') {
    extra = `<div class="hud-row"><span>Outlier score</span><b>${(field.outlier[k] || 0).toFixed(2)}</b></div>`;
  } else if (sc?.signed && sc.dwellDelta) {
    const dFoot = sc.data[k];
    const dDwell = sc.dwellDelta[k];
    const pBr = sc.purityBreak?.[k] || 0;
    extra = `
      <div class="hud-row"><span>Δ footfall</span><b>${dFoot >= 0 ? '+' : ''}${(dFoot * 100).toFixed(0)}%</b></div>
      <div class="hud-row"><span>Δ dwell</span><b>${dDwell >= 0 ? '+' : ''}${(dDwell * 100).toFixed(0)}%</b></div>
      <div class="hud-row"><span>Purity break</span><b>${pBr.toFixed(2)}</b></div>`;
  }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="hud-row"><span>Footfall</span><b>${Math.round(field.traffic[k])} tracks</b></div>
    <div class="hud-row"><span>Dwell</span><b>${Math.round(field.dwell[k])} s</b></div>
    <div class="hud-row"><span>Walking speed</span><b>${field.speed[k].toFixed(2)} m/s</b></div>
    <div class="hud-row"><span>Directional purity</span><b>${field.purity[k].toFixed(2)}</b></div>
    <div class="hud-row"><span>Net heading</span><b>${deg.toFixed(0)}&deg;</b></div>
    ${extra}
    <div class="hud-note">${params.scalar === 'regime' ? (REGIME_NOTE[rid] || '')
      : field.purity[k] < 0.25 ? 'Two-way / milling — a mean arrow would cancel here' : 'Directional flow'}</div>`;
}

function updateLegend() {
  const sc = field.scalars[params.scalar];
  if (!sc) return;
  const bar = document.getElementById('legend-bar');
  const cats = document.getElementById('legend-cats');
  const ends = document.querySelector('.legend-ends');
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
  const extent = sc.signed ? Math.max(Math.abs(sc.min ?? 0), Math.abs(sc.max ?? 1)) || 1 : 0;
  const stops = [];
  for (let i = 0; i <= 24; i++) {
    const u = i / 24;
    const { h, s, l } = sc.signed ? divergingRamp(u * 2 - 1) : heatRamp(u);
    stops.push(`hsl(${(h * 360).toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%) ${(u * 100).toFixed(0)}%`);
  }
  bar.style.background = `linear-gradient(90deg, ${stops.join(',')})`;
  document.getElementById('legend-label').textContent = sc.signed
    ? (params.scalar.startsWith('shift_')
      ? `${sc.label} — cyan = loss, red = gain`
      : `${sc.label} — cyan = flows merging, red = flows splitting`)
    : `${sc.label} (${sc.unit})`;
  document.getElementById('legend-lo').textContent = sc.signed
    ? (params.scalar.startsWith('shift_') ? 'Earlier stronger' : `\u2212${extent.toFixed(2)}`)
    : '0';
  document.getElementById('legend-hi').textContent = sc.signed
    ? (params.scalar.startsWith('shift_') ? 'Later stronger' : `+${extent.toFixed(2)}`)
    : (sc.max <= 1 ? sc.max.toFixed(2) : Math.round(sc.max).toLocaleString());
}

// Companion slices for temporal-shift / purity-break overlays (lazy).
let analysisPromise = null;
async function ensureShiftAnalysis() {
  if (field.scalars.shift_me && field.scalars.shift_ww) return;
  if (!analysisPromise) {
    analysisPromise = (async () => {
      const ids = ['morning', 'evening', 'weekday', 'weekend'];
      const payloads = await Promise.all(
        ids.map((id) => fetch(`./slices/field_${id}.json` + bust).then((r) => r.json())),
      );
      const [morning, evening, weekday, weekend] = payloads.map(cellMapFromFieldJson);
      attachShiftScalar(field, morning, evening, 'shift_me', 'Shift morning \u2192 evening');
      attachShiftScalar(field, weekday, weekend, 'shift_ww', 'Shift weekday \u2192 weekend');
      boostOutliersWithPurityBreak(field, morning, evening);
    })();
  }
  await analysisPromise;
}

async function setScalar(next) {
  if (!next) return;
  params.scalar = next;
  const sel = document.getElementById('scalar');
  if (sel && sel.value !== next) sel.value = next;
  document.querySelectorAll('button.analysis').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.scalar === next);
  });
  if (next === 'shift_me' || next === 'shift_ww' || next === 'outlier') {
    await ensureShiftAnalysis();
  }
  rebuildTerrain();
}

// ---------------------------------------------------------------------- wiring
const bind = (id, fn, evt = 'input') => document.getElementById(id).addEventListener(evt, fn);
bind('scalar', (e) => { void setScalar(e.target.value); }, 'change');
document.querySelectorAll('button.analysis').forEach((btn) => {
  btn.addEventListener('click', () => { void setScalar(btn.dataset.scalar); });
  if (btn.dataset.scalar === params.scalar) btn.classList.add('active');
});
bind('terrainHeight', (e) => {
  params.terrainHeight = +e.target.value;
  document.getElementById('terrainHeightVal').textContent = params.terrainHeight.toFixed(1) + ' m';
  rebuildTerrain(); buildArrows(); buildFloorplan();
});
// Changing the alignment moves the measured field, not the plan, so the terrain,
// glyphs and in-flight streamlines all have to be rebuilt.
function realign() {
  rebuildTerrain();
  buildArrows();
  buildFloorplan();
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
bind('showPlan', (e) => { params.showPlan = e.target.checked; planGroup.visible = params.showPlan; }, 'change');
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
bind('dwellDrag', (e) => { params.dwellDrag = e.target.checked; }, 'change');
bind('showTerrain', (e) => { params.showTerrain = e.target.checked; rebuildTerrain(); buildArrows(); buildFloorplan(); }, 'change');
bind('showArrows', (e) => { params.showArrows = e.target.checked; arrowGroup.visible = params.showArrows; }, 'change');
bind('showFlow', (e) => { lineMesh.visible = e.target.checked; }, 'change');
bind('pause', (e) => { params.paused = !params.paused; e.target.textContent = params.paused ? 'Resume' : 'Pause'; }, 'click');

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
new ResizeObserver(resize).observe(container);

document.getElementById('meta').innerHTML =
  `${field.NX}\u00d7${field.NY} cells at ${CELL} m \u00b7 ` +
  `${(field.meta.rows_in_hours || 0).toLocaleString()} positions \u00b7 ` +
  `${field.meta.cells_emitted.toLocaleString()} cells \u00b7 ` +
  `${(field.meta.steps_total || 0).toLocaleString()} steps`;

const sliceNote = document.getElementById('sliceNote');
if (sliceNote) sliceNote.textContent = SLICE_LABELS[sliceId] || sliceId;
document.querySelectorAll('button.slice').forEach((btn) => {
  if (btn.dataset.slice === sliceId) btn.classList.add('active');
  btn.addEventListener('click', () => {
    const next = btn.dataset.slice;
    if (!next || next === sliceId) return;
    const u = new URL(location.href);
    u.searchParams.set('slice', next);
    // Keep embed/export flags so the executive iframe stays in panel mode.
    location.href = u.toString();
  });
});

const planSource = document.getElementById('planSource');
if (planSource) {
  planSource.textContent =
    `${layout.venue?.name || 'Venue'} \u00b7 `
    + `${(layout.counts?.polygons || 0).toLocaleString()} fixtures \u00b7 `
    + `slice: ${sliceId}`;
}

rebuildTerrain();
buildArrows();
buildFloorplan();
buildParticles();
resize();

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
  THREE, scene, camera, controls, field, params,
  rebuildTerrain, buildArrows, buildParticles, stepParticles, renderer, setExportView,
};

let last = performance.now();
renderer.setAnimationLoop(() => {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!params.paused) stepParticles(dt);
  controls.update();
  renderer.render(scene, camera);
});
