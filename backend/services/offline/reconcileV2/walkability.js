/**
 * Walkability grid + geodesic oracle for map-constrained reconciliation (v2).
 *
 * Pure, no I/O. Venue-meter frame {x,z} (same as ROIs and reconciled output).
 *
 * BLOCKED = object/fixture ROI polygons  ∪  empirical never-visited cells.
 * Objects can never be walked through (your rule 5). Distances are geodesic
 * (shortest walk-around path), never straight-line through a shelf.
 */

import { readFileSync } from 'fs';

/** Ray-cast point-in-polygon on {x,z} vertices. */
export function pointInPolygon(x, z, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x, zi = verts[i].z, xj = verts[j].x, zj = verts[j].z;
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

const FREE = 1, BLOCKED = 0;

export class WalkabilityGrid {
  constructor({ x0, z0, cellM, nx, nz, cells, obstacle = null }) {
    this.x0 = x0; this.z0 = z0; this.cellM = cellM; this.nx = nx; this.nz = nz;
    this.cells = cells;        // Uint8Array, FREE/BLOCKED (free = walkable interior minus inflated obstacles)
    this.obstacle = obstacle;  // Uint8Array, 1 = real (un-inflated) shelf/fixture footprint; for hard wall-cross tests
    this._geoCache = new Map();
  }

  ix(x) { return Math.floor((x - this.x0) / this.cellM); }
  iz(z) { return Math.floor((z - this.z0) / this.cellM); }
  inBounds(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz; }
  idx(ix, iz) { return iz * this.nx + ix; }
  cellCenter(ix, iz) { return { x: this.x0 + (ix + 0.5) * this.cellM, z: this.z0 + (iz + 0.5) * this.cellM }; }

  isFreeIdx(i) { return this.cells[i] === FREE; }
  isFreeXZ(x, z) {
    const ix = this.ix(x), iz = this.iz(z);
    if (!this.inBounds(ix, iz)) return false;
    return this.cells[this.idx(ix, iz)] === FREE;
  }

  /** Nearest free cell to a world point (for snapping endpoints that sit on/near a blocked cell). */
  nearestFree(x, z, maxRing = 3) {
    const cx = this.ix(x), cz = this.iz(z);
    if (this.inBounds(cx, cz) && this.cells[this.idx(cx, cz)] === FREE) return [cx, cz];
    for (let r = 1; r <= maxRing; r++) {
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const ix = cx + dx, iz = cz + dz;
        if (this.inBounds(ix, iz) && this.cells[this.idx(ix, iz)] === FREE) return [ix, iz];
      }
    }
    return null;
  }

  /** Does the straight segment a→b pass through a REAL shelf/fixture (un-inflated)?
   *  Used to split a raw id that teleports across a gondola (perception ID swap).
   *  Tests the obstacle footprint, not the inflation buffer, so people walking in
   *  narrow aisles next to shelves are NOT falsely split. */
  segmentCrossesObstacle(ax, az, bx, bz) {
    const mask = this.obstacle;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (this.cellM * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const ix = this.ix(x), iz = this.iz(z);
      if (!this.inBounds(ix, iz)) continue; // outside grid ≠ shelf cross
      if (mask ? mask[this.idx(ix, iz)] === 1 : this.cells[this.idx(ix, iz)] === BLOCKED) return true;
    }
    return false;
  }

  /** Does the straight segment a→b touch any BLOCKED (non-walkable) cell? */
  segmentCrossesBlocked(ax, az, bx, bz) {
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (this.cellM * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ix = this.ix(ax + (bx - ax) * t), iz = this.iz(az + (bz - az) * t);
      if (!this.inBounds(ix, iz) || this.cells[this.idx(ix, iz)] === BLOCKED) return true;
    }
    return false;
  }

  /** Geodesic walkable distance (meters) between two world points. Infinity if unreachable. */
  geo(ax, az, bx, bz) {
    const a = this.nearestFree(ax, az), b = this.nearestFree(bx, bz);
    if (!a || !b) return Infinity;
    const key = `${a[0]},${a[1]}>${b[0]},${b[1]}`;
    const hit = this._geoCache.get(key);
    if (hit !== undefined) return hit;
    const d = this._astar(a[0], a[1], b[0], b[1], false).dist;
    if (this._geoCache.size > 200000) this._geoCache.clear();
    this._geoCache.set(key, d);
    return d;
  }

  /** Geodesic path as world polyline (for direction checks + rendering). */
  path(ax, az, bx, bz) {
    const a = this.nearestFree(ax, az), b = this.nearestFree(bx, bz);
    if (!a || !b) return null;
    return this._astar(a[0], a[1], b[0], b[1], true).path;
  }

  _astar(sx, sz, tx, tz, wantPath) {
    const { nx, nz, cells, cellM } = this;
    const start = this.idx(sx, sz), goal = this.idx(tx, tz);
    if (start === goal) return { dist: 0, path: wantPath ? [this.cellCenter(sx, sz)] : null };
    const D = cellM, D2 = cellM * Math.SQRT2;
    const g = new Float64Array(nx * nz).fill(Infinity);
    const came = wantPath ? new Int32Array(nx * nz).fill(-1) : null;
    const open = new MinHeap();
    g[start] = 0;
    open.push(start, this._h(sx, sz, tx, tz) * D);
    const neigh = [[1,0,D],[-1,0,D],[0,1,D],[0,-1,D],[1,1,D2],[1,-1,D2],[-1,1,D2],[-1,-1,D2]];
    while (open.size) {
      const cur = open.pop();
      if (cur === goal) break;
      const cix = cur % nx, ciz = (cur - cix) / nx;
      for (const [dx, dz, cost] of neigh) {
        const ix = cix + dx, iz = ciz + dz;
        if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
        const ni = iz * nx + ix;
        if (cells[ni] === BLOCKED) continue;
        // no corner cutting on diagonals
        if (dx !== 0 && dz !== 0) {
          if (cells[ciz * nx + ix] === BLOCKED || cells[iz * nx + cix] === BLOCKED) continue;
        }
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          if (came) came[ni] = cur;
          open.push(ni, ng + this._h(ix, iz, tx, tz) * D);
        }
      }
    }
    const dist = g[goal];
    let path = null;
    if (wantPath && Number.isFinite(dist)) {
      path = [];
      let c = goal;
      while (c !== -1) { const ix = c % nx, iz = (c - ix) / nx; path.push(this.cellCenter(ix, iz)); c = came[c]; }
      path.reverse();
    }
    return { dist, path };
  }

  _h(ax, az, bx, bz) { // octile heuristic in cells
    const dx = Math.abs(ax - bx), dz = Math.abs(az - bz);
    return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
  }
}

/** Binary min-heap keyed by priority. */
class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    this.k.push(key); this.p.push(pri);
    let i = this.k.length - 1;
    while (i > 0) { const par = (i - 1) >> 1; if (this.p[par] <= this.p[i]) break; this._swap(i, par); i = par; }
  }
  pop() {
    const top = this.k[0]; const lastK = this.k.pop(); const lastP = this.p.pop();
    if (this.k.length) { this.k[0] = lastK; this.p[0] = lastP; this._down(0); }
    return top;
  }
  _down(i) {
    const n = this.k.length;
    for (;;) {
      let s = i; const l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.p[l] < this.p[s]) s = l;
      if (r < n && this.p[r] < this.p[s]) s = r;
      if (s === i) break; this._swap(i, s); i = s;
    }
  }
  _swap(a, b) { const tk = this.k[a]; this.k[a] = this.k[b]; this.k[b] = tk; const tp = this.p[a]; this.p[a] = this.p[b]; this.p[b] = tp; }
}

/** Morphological dilation of a boolean mask by `r` cells (8-connectivity). */
function dilate(mask, nx, nz, r) {
  let cur = mask;
  for (let p = 0; p < r; p++) {
    const next = cur.slice();
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      if (cur[iz * nx + ix]) continue;
      let on = false;
      for (let dz = -1; dz <= 1 && !on; dz++) for (let dx = -1; dx <= 1; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx >= 0 && jz >= 0 && jx < nx && jz < nz && cur[jz * nx + jx]) { on = true; break; }
      }
      if (on) next[iz * nx + ix] = 1;
    }
    cur = next;
  }
  return cur;
}
/** Fill enclosed holes: any 0-cell not connected to the border becomes 1.
 *  Turns "cells we happened to walk" into "the whole store interior" so unwalked
 *  aisles are walkable; real shelves are carved back out afterwards. */
function fillHoles(mask, nx, nz) {
  const n = nx * nz;
  const ext = new Uint8Array(n); // 0-cells reachable from the border
  const stack = [];
  for (let ix = 0; ix < nx; ix++) { stack.push(ix); stack.push((nz - 1) * nx + ix); }
  for (let iz = 0; iz < nz; iz++) { stack.push(iz * nx); stack.push(iz * nx + nx - 1); }
  while (stack.length) {
    const c = stack.pop();
    if (ext[c] || mask[c]) continue;
    ext[c] = 1;
    const ix = c % nx, iz = (c - ix) / nx;
    if (ix > 0) stack.push(c - 1);
    if (ix < nx - 1) stack.push(c + 1);
    if (iz > 0) stack.push(c - nx);
    if (iz < nz - 1) stack.push(c + nx);
  }
  const out = mask.slice();
  for (let i = 0; i < n; i++) if (!mask[i] && !ext[i]) out[i] = 1;
  return out;
}

/** Erosion of a boolean mask by `r` cells (8-connectivity). */
function erode(mask, nx, nz, r) {
  let cur = mask;
  for (let p = 0; p < r; p++) {
    const next = cur.slice();
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      if (!cur[iz * nx + ix]) continue;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz || !cur[jz * nx + jx]) { next[iz * nx + ix] = 0; }
      }
    }
    cur = next;
  }
  return cur;
}

/**
 * Build a walkability grid.
 *
 * FREE = store interior (visited cells, morphologically closed to bridge aisle
 *        gaps nobody walked in this capture) MINUS obstacle footprints.
 * BLOCKED = obstacle fixtures (inflated by body radius) ∪ everything outside the interior.
 *
 * @param {Object} o
 * @param {{x0,z0,nx,nz,cellM}} o.bounds  grid geometry
 * @param {Uint32Array|Float64Array} o.visitCounts  per-cell observed detections (aligned to bounds)
 * @param {Array<{vertices:Array<{x,z}>}>} o.obstacles  shelf/fixture polygons (always BLOCKED)
 * @param {number} [o.inflateCells=1]  body-radius dilation of obstacle BLOCKED
 * @param {number} [o.interiorDilateCells=4]  dilate visited mask by this radius before hole-fill (connects aisle islands)
 */
export function buildWalkability({ bounds, visitCounts, obstacles = [], inflateCells = 1, interiorDilateCells = 4 }) {
  const { x0, z0, nx, nz, cellM } = bounds;
  const n = nx * nz;
  const centerX = (ix) => x0 + (ix + 0.5) * cellM;
  const centerZ = (iz) => z0 + (iz + 0.5) * cellM;

  // 1) Store interior = visited cells, dilated to connect aisle islands, then
  //    hole-filled so unwalked-but-enclosed aisles become walkable, then eroded
  //    back so we don't bleed past the real store walls.
  const visited = new Uint8Array(n);
  if (visitCounts) for (let i = 0; i < n; i++) if (visitCounts[i] > 0) visited[i] = 1;
  let interior = visited;
  if (interiorDilateCells > 0) {
    interior = dilate(visited, nx, nz, interiorDilateCells);
    interior = fillHoles(interior, nx, nz);
    interior = erode(interior, nx, nz, Math.max(0, interiorDilateCells - 1));
  }

  // 2) Obstacle mask from fixture polygons (always BLOCKED)
  const obstacleMask = new Uint8Array(n);
  if (obstacles.length) {
    for (let iz = 0; iz < nz; iz++) {
      const cz = centerZ(iz);
      for (let ix = 0; ix < nx; ix++) {
        const cx = centerX(ix);
        for (const ob of obstacles) {
          if (ob.vertices && ob.vertices.length >= 3 && pointInPolygon(cx, cz, ob.vertices)) { obstacleMask[iz * nx + ix] = 1; break; }
        }
      }
    }
  }
  const obstacleInflated = inflateCells > 0 ? dilate(obstacleMask, nx, nz, inflateCells) : obstacleMask;

  // 3) FREE = interior AND not obstacle
  const grid = new Uint8Array(n);
  for (let i = 0; i < n; i++) grid[i] = (interior[i] && !obstacleInflated[i]) ? FREE : BLOCKED;

  const free = grid.reduce((s, v) => s + v, 0);
  return {
    grid: new WalkabilityGrid({ x0, z0, cellM, nx, nz, cells: grid, obstacle: obstacleMask }),
    freeCells: free, blockedCells: n - free,
    visitedCells: visited.reduce((s, v) => s + v, 0),
    obstacleCells: obstacleMask.reduce((s, v) => s + v, 0),
  };
}

/** Load a cached walkability grid written by walkability_audit.mjs (--cache-out). */
export function loadWalkabilityCache(jsonOrPath) {
  const doc = typeof jsonOrPath === 'string' ? JSON.parse(readFileSync(jsonOrPath, 'utf8')) : jsonOrPath;
  const { bounds, cellM } = doc;
  const cells = new Uint8Array(Buffer.from(doc.cells, 'base64'));
  const obstacle = doc.obstacle ? new Uint8Array(Buffer.from(doc.obstacle, 'base64')) : null;
  return new WalkabilityGrid({ x0: bounds.x0, z0: bounds.z0, cellM, nx: bounds.nx, nz: bounds.nz, cells, obstacle });
}

export { FREE, BLOCKED };
