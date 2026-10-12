// Precision spatial twin — geometric primitives (UX v3).
//
// Everything here is pure geometry in venue metres (x, z), the same frame as layout_prod.json,
// visitor-areas.json and the flow field. Nothing here computes a KPI.
//   simplifyRing   Douglas–Peucker on raster-derived rings (0.25 m staircase → clean outline)
//   cornerIndices  the few vertices that carry the shape (cage verticals / corner handles)
//   frontageEdges  the edges of the ≤ 1 m "at the shelf" band that touch a CAD fixture (shelf face)
//   contours       marching squares on a supported grid; squares with an unmeasured corner are skipped,
//                  so no line ever crosses floor the sensors did not see
//   levelsFor      quantile thresholds over supported values only
// Painter draws them on a 2D canvas through the renderer's camera (api.projector()).

export const TOKENS = {
  cad: '#294355', cyan: '#57BBD0', selection: '#A9B5EE', muted: 'rgba(122,146,163,0.42)', contour: '#C1D7E8',
  frontage: '#E1F0F7', queue: '#E58E92', service: '#C9D6E2', scenario: '#C2A87F', positive: '#7CCBA7',
};

// ------------------------------------------------------------------ rings

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = dx * dx + dz * dz;
  if (!L) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}
function dp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  let best = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = perpDist(pts[i], pts[0], pts[pts.length - 1]); if (d > best) { best = d; idx = i; } }
  if (best <= tol) return [pts[0], pts[pts.length - 1]];
  const a = dp(pts.slice(0, idx + 1), tol), b = dp(pts.slice(idx), tol);
  return a.slice(0, -1).concat(b);
}
/** Closed ring → simplified closed ring (first point not repeated). */
export function simplifyRing(ring, tol = 0.3) {
  const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring.slice();
  if (r.length < 4) return r;
  // Split at the vertex farthest from the first one so DP sees two open chains.
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]); if (d > fd) { fd = d; far = i; } }
  const a = dp(r.slice(0, far + 1), tol), b = dp(r.slice(far).concat([r[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** Indices of the n sharpest corners (largest turning angle), at least 2 m apart. */
export function cornerIndices(ring, n = 6) {
  const m = ring.length;
  if (m <= n) return ring.map((_, i) => i);
  const turn = ring.map((p, i) => {
    const a = ring[(i - 1 + m) % m], b = ring[(i + 1) % m];
    const h1 = Math.atan2(p[1] - a[1], p[0] - a[0]), h2 = Math.atan2(b[1] - p[1], b[0] - p[0]);
    let d = Math.abs(h2 - h1); if (d > Math.PI) d = 2 * Math.PI - d;
    return { i, d };
  }).sort((x, y) => y.d - x.d);
  const out = [];
  for (const t of turn) {
    if (out.every((j) => Math.hypot(ring[j][0] - ring[t.i][0], ring[j][1] - ring[t.i][1]) >= 2)) out.push(t.i);
    if (out.length >= n) break;
  }
  return out.sort((a, b) => a - b);
}

export function ringArea(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(s / 2);
}
export function pointInRing(x, z, p) {
  let inside = false;
  for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
    if ((p[a][1] > z) !== (p[b][1] > z) && x < (p[b][0] - p[a][0]) * (z - p[a][1]) / (p[b][1] - p[a][1]) + p[a][0]) inside = !inside;
  }
  return inside;
}
export const inRings = (x, z, rings) => (rings || []).some((r) => pointInRing(x, z, r.outer || r) && !(r.holes || []).some((h) => pointInRing(x, z, h)));

// ------------------------------------------------------------------ shelf frontage

/** Spatial hash of CAD fixture edges (layout_prod.json polys). */
export function fixtureIndex(polys, cell = 2) {
  const grid = new Map();
  const put = (k, s) => { if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); };
  for (const p of polys || []) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      const s = [a, b];
      const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const z0 = Math.floor(Math.min(a[1], b[1]) / cell), z1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) put(`${x},${z}`, s);
    }
  }
  const near = (x, z, tol) => {
    const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      for (const s of grid.get(`${cx + dx},${cz + dz}`) || []) if (perpDist([x, z], s[0], s[1]) <= tol) return true;
    }
    return false;
  };
  return { near };
}

/**
 * Shelf-face edges of an "at the shelf" band: band edges whose samples lie on a CAD fixture
 * (within tol). Returns open polylines in venue metres. Nothing is inferred where no fixture is drawn.
 */
export function frontageEdges(bandRings, fix, { tol = 0.35, step = 0.25, minLen = 0.75 } = {}) {
  const out = [];
  for (const r of bandRings || []) {
    const ring = simplifyRing(r.outer || r, 0.12);
    let cur = null;
    const flush = () => { if (cur && cur.length > 1) { let L = 0; for (let i = 1; i < cur.length; i++) L += Math.hypot(cur[i][0] - cur[i - 1][0], cur[i][1] - cur[i - 1][1]); if (L >= minLen) out.push(cur); } cur = null; };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.max(1, Math.round(L / step));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        if (fix.near(mid[0], mid[1], tol)) { if (!cur) cur = [p0]; cur.push(p1); } else flush();
      }
    }
    flush();
  }
  return out;
}

// ------------------------------------------------------------------ contours

/**
 * Light smoothing inside support only: 3×3 weighted mean over supported neighbours.
 * Unsupported cells stay NaN, so contours stop at the edge of what was measured.
 */
export function smoothSupported(NX, NY, value, supported, passes = 1) {
  let cur = new Float32Array(NX * NY);
  for (let k = 0; k < NX * NY; k++) cur[k] = supported(k) ? value(k) : NaN;
  for (let p = 0; p < passes; p++) {
    const nxt = new Float32Array(NX * NY);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (Number.isNaN(cur[k])) { nxt[k] = NaN; continue; }
      let s = 0, w = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
        const v = cur[jj * NX + ii]; if (Number.isNaN(v)) continue;
        const ww = di === 0 && dj === 0 ? 4 : (di === 0 || dj === 0 ? 2 : 1);
        s += v * ww; w += ww;
      }
      nxt[k] = s / w;
    }
    cur = nxt;
  }
  return cur;
}

export function levelsFor(values, ps = [0.5, 0.7, 0.84, 0.93, 0.98]) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (v.length < 8) return [];
  const out = ps.map((p) => v[Math.min(v.length - 1, Math.floor(p * v.length))]);
  return out.filter((x, i) => i === 0 || x > out[i - 1] * 1.02);
}

/**
 * Marching squares on cell centres. grid[k] (k = j*NX+i), NaN = unsupported.
 * Returns {level, lines:[[[gx,gy],...]]} in grid coordinates (cell centre = i + 0.5).
 */
export function contours(NX, NY, grid, levels, { keep = null } = {}) {
  const out = [];
  for (const L of levels) {
    const segs = [];
    for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const a = grid[j * NX + i], b = grid[j * NX + i + 1], c = grid[(j + 1) * NX + i + 1], d = grid[(j + 1) * NX + i];
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue;
      if (keep && !keep(i + 1, j + 1)) continue;
      const code = (a >= L ? 1 : 0) | (b >= L ? 2 : 0) | (c >= L ? 4 : 0) | (d >= L ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const x0 = i + 0.5, y0 = j + 0.5;
      const lerp = (v1, v2) => (L - v1) / ((v2 - v1) || 1e-9);
      const E = {
        t: [x0 + lerp(a, b), y0], r: [x0 + 1, y0 + lerp(b, c)], b: [x0 + lerp(d, c), y0 + 1], l: [x0, y0 + lerp(a, d)],
      };
      const add = (p, q) => segs.push([E[p], E[q]]);
      switch (code) {
        case 1: case 14: add('l', 't'); break;
        case 2: case 13: add('t', 'r'); break;
        case 3: case 12: add('l', 'r'); break;
        case 4: case 11: add('r', 'b'); break;
        case 6: case 9: add('t', 'b'); break;
        case 7: case 8: add('l', 'b'); break;
        case 5: add('l', 't'); add('r', 'b'); break;
        case 10: add('t', 'r'); add('l', 'b'); break;
        default: break;
      }
    }
    out.push({ level: L, lines: joinSegments(segs) });
  }
  return out;
}

function joinSegments(segs) {
  const key = (p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  const ends = new Map();
  segs.forEach((s, n) => { for (const e of [0, 1]) { const k = key(s[e]); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(n); } });
  const used = new Uint8Array(segs.length);
  const lines = [];
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const line = [segs[n][0], segs[n][1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const tip = dir ? line[line.length - 1] : line[0];
        const next = (ends.get(key(tip)) || []).find((m) => !used[m]);
        if (next == null) break;
        used[next] = 1;
        const s = segs[next];
        const other = key(s[0]) === key(tip) ? s[1] : s[0];
        if (dir) line.push(other); else line.unshift(other);
      }
    }
    if (line.length >= 3) lines.push(line);
  }
  return lines;
}

/** Chaikin corner cutting, keeps closed loops closed. */
export function chaikin(line, iter = 2) {
  let pts = line;
  const closed = pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6;
  for (let t = 0; t < iter; t++) {
    const out = closed ? [] : [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (closed) out.push(out[0]); else out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Local maxima of a supported grid (for sparse anchors), strongest first. */
export function localMaxima(NX, NY, grid, { n = 3, minSep = 4 } = {}) {
  const c = [];
  for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
    const v = grid[j * NX + i]; if (!(v > 0)) continue;
    let top = true;
    for (let dj = -1; dj <= 1 && top; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const w = grid[(j + dj) * NX + i + di]; if (w > v) { top = false; break; } }
    if (top) c.push({ i, j, v });
  }
  c.sort((a, b) => b.v - a.v);
  const out = [];
  for (const p of c) { if (out.every((q) => Math.hypot(q.i - p.i, q.j - p.j) >= minSep)) out.push(p); if (out.length >= n) break; }
  return out;
}

// ------------------------------------------------------------------ painter

/**
 * Draw a list of items on a 2D canvas through a projector {at(x,y,z) → [sx,sy]|null, pitch}.
 * Items (all coordinates venue metres, y up):
 *   {t:'ring', pts, color, width, dash, alpha, fill}                 closed outline on the floor
 *   {t:'line', pts, color, width, dash, alpha}                       open polyline on the floor
 *   {t:'cage', ring, corners, height, color}                         wire volume: floor ring, top ring, sparse verticals
 *   {t:'brackets', pts, color}                                       small end brackets on frontage lines
 *   {t:'rect', x, z, s, color, alpha}                                 floor square (s metres)
 *   {t:'arrow', x, z, dx, dz, len, color, alpha, width}               short floor glyph
 */
export function paint(ctx, P, items, dpr = 1) {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const path = (pts, y = 0.04, closed = false) => {
    let started = false, ok = 0;
    ctx.beginPath();
    for (const p of pts) {
      const s = P.at(p[0], p[2] ?? y, p[1]);
      if (!s) { started = false; continue; }
      if (!started) { ctx.moveTo(s[0], s[1]); started = true; } else ctx.lineTo(s[0], s[1]);
      ok++;
    }
    if (closed && ok === pts.length) ctx.closePath();
    return ok;
  };
  for (const it of items) {
    ctx.globalAlpha = it.alpha ?? 1;
    ctx.setLineDash(it.dash || []);
    if (it.t === 'ring' || it.t === 'line') {
      if (path(it.pts, it.y ?? 0.04, it.t === 'ring') < 2) continue;
      if (it.fill) { ctx.fillStyle = it.fill; ctx.fill(); }
      if (it.glow) { ctx.shadowColor = it.color; ctx.shadowBlur = it.glow; }
      ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 1; ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (it.t === 'cage') {
      const H = it.height ?? 2.2;
      const flat = P.pitch > 1.4; // ~80°+: looking straight down, the volume collapses into its outline
      ctx.strokeStyle = it.color;
      if (it.fill) { if (path(it.ring, 0.03, true) > 2) { ctx.fillStyle = it.fill; ctx.fill(); } }
      ctx.lineWidth = it.width || 1.6; ctx.shadowColor = it.color; ctx.shadowBlur = 6;
      if (path(it.ring, 0.05, true) > 2) ctx.stroke();
      ctx.shadowBlur = 0;
      if (!flat) {
        ctx.globalAlpha = (it.alpha ?? 1) * 0.55; ctx.lineWidth = 1;
        if (path(it.ring.map((p) => [p[0], p[1], H]), H, true) > 2) ctx.stroke();
        for (const i of it.corners || []) {
          const p = it.ring[i]; const a = P.at(p[0], 0.05, p[1]), b = P.at(p[0], H, p[1]);
          if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        }
        ctx.globalAlpha = it.alpha ?? 1;
      }
      // corner handles
      ctx.fillStyle = '#EEF2FF';
      for (const i of it.corners || []) {
        const p = it.ring[i]; const s = P.at(p[0], 0.05, p[1]); if (!s) continue;
        ctx.beginPath(); ctx.arc(s[0], s[1], 2.6, 0, Math.PI * 2); ctx.fill();
      }
    } else if (it.t === 'brackets') {
      ctx.strokeStyle = it.color; ctx.lineWidth = 1.2;
      for (const line of it.lines || []) {
        for (const [p, q] of [[line[0], line[1]], [line[line.length - 1], line[line.length - 2]]]) {
          const a = P.at(p[0], 0.06, p[1]), b = P.at(q[0], 0.06, q[1]); if (!a || !b) continue;
          const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = -dy / L * 4, ny = dx / L * 4;
          ctx.beginPath(); ctx.moveTo(a[0] - nx, a[1] - ny); ctx.lineTo(a[0] + nx, a[1] + ny); ctx.stroke();
        }
      }
    } else if (it.t === 'rect') {
      const h = it.s / 2;
      if (path([[it.x - h, it.z - h], [it.x + h, it.z - h], [it.x + h, it.z + h], [it.x - h, it.z + h]], 0.03, true) === 4) { ctx.fillStyle = it.color; ctx.fill(); }
    } else if (it.t === 'arrow') {
      const L = it.len, x1 = it.x + it.dx * L, z1 = it.z + it.dz * L;
      const a = P.at(it.x, 0.06, it.z), b = P.at(x1, 0.06, z1); if (!a || !b) continue;
      ctx.strokeStyle = it.color; ctx.lineWidth = it.width || 1.2;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hs = Math.min(5, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.45);
      ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - hs * Math.cos(ang - 0.5), b[1] - hs * Math.sin(ang - 0.5));
      ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - hs * Math.cos(ang + 0.5), b[1] - hs * Math.sin(ang + 0.5));
      ctx.stroke();
    }
  }
  ctx.restore();
}
