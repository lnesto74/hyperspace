// Pure geometry helpers. No KPI or movement calculation belongs in this module.
export function inPolygon(x, z, p) {
  let yes = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}
export const inRings = (x, z, rings) => rings.some(r => inPolygon(x, z, r.outer) && !(r.holes || []).some(h => inPolygon(x, z, h)));

export function ringBounds(rings) {
  const pts = rings.flatMap(r => r.outer);
  if (!pts.length) return null;
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, span: Math.max(maxX-minX, maxZ-minZ) };
}

/** Actual level sets, not a terrain wire grid. Each triangle must have three
 * observed vertices. Missing support never gets interpolated across a gap.
 * Splitting quads consistently resolves saddle ambiguity without joining islands.
 */
export function contourSegments(values, observed, nx, ny, levels) {
  const segments = [];
  const emit = (tri, level) => {
    if (tri.some(([i,j]) => !observed[j*nx+i] || !Number.isFinite(values[j*nx+i]))) return;
    const hits = [];
    for (let e=0;e<3;e++) {
      const a=tri[e],b=tri[(e+1)%3],va=values[a[1]*nx+a[0]],vb=values[b[1]*nx+b[0]];
      if ((va < level) === (vb < level)) continue;
      const t=(level-va)/(vb-va);
      hits.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);
    }
    if (hits.length===2 && Math.hypot(hits[0][0]-hits[1][0],hits[0][1]-hits[1][1])>1e-8) segments.push({level,a:hits[0],b:hits[1]});
  };
  for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++)for(const level of levels){
    emit([[i,j],[i+1,j],[i+1,j+1]],level);emit([[i,j],[i+1,j+1],[i,j+1]],level);
  }
  return segments;
}

// Use raw emitted cells, not the renderer's one-cell dilation of observed coverage.
export function observedCells(field) {
  const mask = new Uint8Array(field.NX*field.NY);
  for(const c of field.cells || []) {
    const i=c.i-field.i0,j=c.j-field.j0;
    if(i>=0 && j>=0 && i<field.NX && j<field.NY && (c.k>0 || c.t>0)) mask[j*field.NX+i]=1;
  }
  return mask;
}

/**
 * Floor that is fenced in on every side by fixtures (e.g. the inside of a closed ring of shelves).
 * Fixture footprints are rasterised at `res` metres (filled polygon + its outline), the free floor is
 * flood-filled, and every free piece that is not part of the largest open floor is a closed pocket.
 * Nobody can stand there, so movement drawn there is sensor noise (people seen over the shelves).
 * Returns { at(x, z) → true inside a pocket, pockets:[{area_m2, minX, maxX, minZ, maxZ}] }.
 */
export function closedPockets(polys, { res = 0.25, maxSide = 34, pad = 2 } = {}) {
  const usable = (polys || []).filter((p) => p && p.length >= 3);
  if (!usable.length) return { at: () => false, pockets: [] };
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of usable) for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  const W = Math.ceil((x1 - x0) / res), H = Math.ceil((z1 - z0) / res);
  const solid = new Uint8Array(W * H);
  const stamp = (x, z) => { const i = Math.floor((x - x0) / res), j = Math.floor((z - z0) / res); if (i >= 0 && j >= 0 && i < W && j < H) solid[j * W + i] = 1; };
  for (const p of usable) {
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for (const [x, z] of p) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); }
    if (Math.max(b - a, d - c) > maxSide) continue; // building outline, not a fixture
    const i0 = Math.max(0, Math.floor((a - x0) / res)), i1 = Math.min(W - 1, Math.floor((b - x0) / res));
    const j0 = Math.max(0, Math.floor((c - z0) / res)), j1 = Math.min(H - 1, Math.floor((d - z0) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (inPolygon(x0 + (i + 0.5) * res, z0 + (j + 0.5) * res, p)) solid[j * W + i] = 1;
    }
    for (let k = 0; k < p.length; k++) {
      const [ax, az] = p[k], [bx, bz] = p[(k + 1) % p.length];
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (res / 2)) + 1;
      for (let t = 0; t <= n; t++) stamp(ax + (bx - ax) * t / n, az + (bz - az) * t / n);
    }
  }
  const lab = new Int32Array(W * H);
  const sizes = [0];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (solid[s] || lab[s]) continue;
    const id = sizes.length; let top = 0, n = 0;
    stack[top++] = s; lab[s] = id;
    while (top) {
      const q = stack[--top]; n++;
      const i = q % W, j = (q - i) / W;
      if (i > 0 && !solid[q - 1] && !lab[q - 1]) { lab[q - 1] = id; stack[top++] = q - 1; }
      if (i < W - 1 && !solid[q + 1] && !lab[q + 1]) { lab[q + 1] = id; stack[top++] = q + 1; }
      if (j > 0 && !solid[q - W] && !lab[q - W]) { lab[q - W] = id; stack[top++] = q - W; }
      if (j < H - 1 && !solid[q + W] && !lab[q + W]) { lab[q + W] = id; stack[top++] = q + W; }
    }
    sizes.push(n);
  }
  let open = 1;
  for (let id = 2; id < sizes.length; id++) if (sizes[id] > sizes[open]) open = id;
  const mask = new Uint8Array(W * H);
  const box = new Map();
  for (let s = 0; s < W * H; s++) {
    const id = lab[s];
    if (!id || id === open) continue;
    const i = s % W, j = (s - i) / W;
    if (i === 0 || j === 0 || i === W - 1 || j === H - 1) continue; // never treat the outside as closed
    mask[s] = 1;
    const x = x0 + (i + 0.5) * res, z = z0 + (j + 0.5) * res;
    const b = box.get(id) || { n: 0, minX: x, maxX: x, minZ: z, maxZ: z };
    b.n++; b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minZ = Math.min(b.minZ, z); b.maxZ = Math.max(b.maxZ, z);
    box.set(id, b);
  }
  const pockets = [...box.values()].map((b) => ({ area_m2: b.n * res * res, minX: b.minX, maxX: b.maxX, minZ: b.minZ, maxZ: b.maxZ }))
    .sort((a, b) => b.area_m2 - a.area_m2);
  const at = (x, z) => {
    const i = Math.floor((x - x0) / res), j = Math.floor((z - z0) / res);
    return i >= 0 && j >= 0 && i < W && j < H && mask[j * W + i] === 1;
  };
  /** Share (0..1) of a square [x-h, x+h]×[z-h, z+h] that lies in a closed pocket or inside a fixture. */
  const closedShare = (x, z, h) => {
    let n = 0, c = 0;
    for (let zz = z - h + res / 2; zz < z + h; zz += res) for (let xx = x - h + res / 2; xx < x + h; xx += res) {
      n++;
      const i = Math.floor((xx - x0) / res), j = Math.floor((zz - z0) / res);
      if (i >= 0 && j >= 0 && i < W && j < H && (mask[j * W + i] || solid[j * W + i])) c++;
    }
    return n ? c / n : 0;
  };
  /** True inside a fixture footprint or a closed pocket: nowhere a person can stand. */
  const blockedAt = (x, z) => {
    const i = Math.floor((x - x0) / res), j = Math.floor((z - z0) / res);
    return i >= 0 && j >= 0 && i < W && j < H && (mask[j * W + i] === 1 || solid[j * W + i] === 1);
  };
  return { at, blockedAt, closedShare, pockets };
}
