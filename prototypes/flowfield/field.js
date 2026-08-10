// Field preparation: load the extracted per-cell rose/dwell/footfall grid,
// crop it to the covered area, smooth it, and expose sampling helpers.
//
// The important design choice lives here: each cell keeps a DIRECTION ROSE
// (an 8-bin histogram of travel headings), not a mean vector. Measured median
// directional purity on this capture is 0.28 and the busiest cells sit near
// 0.01, so a mean vector would cancel to zero exactly where the store is
// busiest. The rose keeps both directions of a two-way aisle alive.

/** Behaviour-regime class ids used by the regime surface colour. */
export const REGIME_CATEGORIES = [
  { id: 0, key: 'mixed', label: 'Mixed / quiet', color: '#3a4558' },
  { id: 1, key: 'through_route', label: 'Through-route', color: '#38bdf8' },
  { id: 2, key: 'dwell_node', label: 'Dwell node', color: '#f59e0b' },
  { id: 3, key: 'one_way_spine', label: 'One-way spine', color: '#a78bfa' },
  { id: 4, key: 'two_way_aisle', label: 'Two-way aisle', color: '#34d399' },
];

export async function loadField(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const { meta, cells } = await res.json();
  const B = meta.bins;

  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const c of cells) {
    if (c.i < i0) i0 = c.i; if (c.i > i1) i1 = c.i;
    if (c.j < j0) j0 = c.j; if (c.j > j1) j1 = c.j;
  }
  const NX = i1 - i0 + 1, NY = j1 - j0 + 1;
  const idx = (i, j) => j * NX + i;

  const raw = {
    traffic: new Float32Array(NX * NY),
    dwell: new Float32Array(NX * NY),
    steps: new Float32Array(NX * NY),
    speed: new Float32Array(NX * NY),
    rose: new Float32Array(NX * NY * B),
  };
  for (const c of cells) {
    const k = idx(c.i - i0, c.j - j0);
    raw.traffic[k] = c.t;
    raw.dwell[k] = c.d;
    raw.steps[k] = c.k;
    raw.speed[k] = c.s;
    // weight the normalised rose by the cell's step count so busy cells
    // dominate the blur, rather than every cell counting equally
    for (let b = 0; b < B; b++) raw.rose[k * B + b] = c.r[b] * c.k;
  }

  const blur = (src, stride, sigma) => {
    const r = Math.max(1, Math.ceil(sigma * 2));
    const ker = [];
    for (let d = -r; d <= r; d++) ker.push(Math.exp(-(d * d) / (2 * sigma * sigma)));
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      for (let s = 0; s < stride; s++) {
        let acc = 0, w = 0;
        for (let d = -r; d <= r; d++) {
          const ii = i + d; if (ii < 0 || ii >= NX) continue;
          acc += src[idx(ii, j) * stride + s] * ker[d + r]; w += ker[d + r];
        }
        tmp[idx(i, j) * stride + s] = w > 0 ? acc / w : 0;
      }
    }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      for (let s = 0; s < stride; s++) {
        let acc = 0, w = 0;
        for (let d = -r; d <= r; d++) {
          const jj = j + d; if (jj < 0 || jj >= NY) continue;
          acc += tmp[idx(i, jj) * stride + s] * ker[d + r]; w += ker[d + r];
        }
        out[idx(i, j) * stride + s] = w > 0 ? acc / w : 0;
      }
    }
    return out;
  };

  const SIGMA = 1.5;
  const traffic = blur(raw.traffic, 1, SIGMA);
  const dwell = blur(raw.dwell, 1, SIGMA);
  const steps = blur(raw.steps, 1, SIGMA);
  const speed = blur(raw.speed, 1, SIGMA);
  const rose = blur(raw.rose, B, SIGMA);

  // Where do we actually have evidence? Everything else stays dark and unseeded
  // rather than being interpolated into existence.
  //
  // Coverage is taken from the UNBLURRED counts, dilated by one cell for a soft
  // edge. Deriving it from the blurred field instead let the Gaussian tails
  // claim floor we never observed — 3,881 m² of carpet on 1,071 m² of evidence.
  // Blurring is legitimate for estimating a value, but not for asserting that a
  // square metre was measured at all.
  const covered = new Uint8Array(NX * NY);
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      if (raw.steps[idx(i, j)] <= 0 && raw.traffic[idx(i, j)] <= 0) continue;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii >= 0 && jj >= 0 && ii < NX && jj < NY) covered[idx(ii, jj)] = 1;
        }
      }
    }
  }

  const support = new Float32Array(NX * NY);
  let maxSupport = 0;
  for (let k = 0; k < NX * NY; k++) {
    support[k] = covered[k] ? steps[k] + traffic[k] * 0.5 : 0;
    if (support[k] > maxSupport) maxSupport = support[k];
  }

  // Reference level for "this cell is properly measured". Over days of data the
  // single busiest cell — a till queue — carries orders of magnitude more
  // evidence than an ordinary aisle, so dividing by the maximum pushes real
  // shop floor under the culling and seeding thresholds and the carpet shrinks
  // back to the hotspots. A high percentile keeps those thresholds meaningful.
  const supportRef = (() => {
    const vals = [];
    for (let k = 0; k < NX * NY; k++) if (support[k] > 0) vals.push(support[k]);
    if (!vals.length) return 1;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length * 0.95)] || 1;
  })();

  // Mean flow direction and directional purity, per cell.
  const meanX = new Float32Array(NX * NY);
  const meanY = new Float32Array(NX * NY);
  const purity = new Float32Array(NX * NY);
  for (let k = 0; k < NX * NY; k++) {
    let sx = 0, sy = 0, tot = 0;
    for (let b = 0; b < B; b++) {
      const a = (b / B) * Math.PI * 2, w = rose[k * B + b];
      sx += Math.cos(a) * w; sy += Math.sin(a) * w; tot += w;
    }
    if (tot > 0) { meanX[k] = sx / tot; meanY[k] = sy / tot; purity[k] = Math.hypot(sx, sy) / tot; }
  }

  // Divergence of the mean flow: negative = flows converging into this cell.
  // This is the mathematical form of "consolidation".
  const divergence = new Float32Array(NX * NY);
  for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
    divergence[idx(i, j)] =
      (meanX[idx(i + 1, j)] - meanX[idx(i - 1, j)]) / 2 +
      (meanY[idx(i, j + 1)] - meanY[idx(i, j - 1)]) / 2;
  }

  // Normalise on a high percentile, not the maximum. Over days of stored tracks
  // a single abandoned trolley or a stool parked in view banks hours of dwell in
  // one cell, and scaling to that flattens the whole shop to black.
  const maxOf = (arr, p = 0.98) => {
    const vals = [];
    for (let k = 0; k < arr.length; k++) if (support[k] > 0 && arr[k] > 0) vals.push(arr[k]);
    if (!vals.length) return 1;
    vals.sort((a, b) => a - b);
    return vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] || 1;
  };

  // Support-weighted spawn table, so particle birth rate tracks footfall.
  const spawnCdf = new Float32Array(NX * NY);
  let running = 0;
  for (let k = 0; k < NX * NY; k++) { running += Math.pow(Math.min(1, support[k] / supportRef), 1.1); spawnCdf[k] = running; }
  const spawnTotal = running;

  const scalars = {
    dwell: { data: dwell, max: maxOf(dwell), label: 'Dwell', unit: 's', signed: false },
    footfall: { data: traffic, max: maxOf(traffic), label: 'Footfall', unit: 'distinct tracks', signed: false },
    speed: { data: speed, max: maxOf(speed), label: 'Walking speed', unit: 'm/s', signed: false },
    purity: { data: purity, max: 1, label: 'Directional purity', unit: '0\u20131', signed: false },
    convergence: { data: divergence, max: 0, label: 'Convergence', unit: 'divergence', signed: true },
  };
  {
    let lo = 0, hi = 0;
    for (let k = 0; k < NX * NY; k++) {
      if (support[k] <= 0) continue;
      if (divergence[k] < lo) lo = divergence[k];
      if (divergence[k] > hi) hi = divergence[k];
    }
    scalars.convergence.min = lo;
    scalars.convergence.max = hi;
  }

  // Behaviour regimes + dwell/traffic outliers from the current time slice.
  // Priority: dwell node > through-route > one-way spine > two-way aisle.
  const dwellVals = [], stepFloor = 20, busyFloor = 10, trafficFloor = 50;
  for (let k = 0; k < NX * NY; k++) {
    if (support[k] > 0 && dwell[k] > 0) dwellVals.push(dwell[k]);
  }
  dwellVals.sort((a, b) => a - b);
  const pct = (arr, p) => {
    if (!arr.length) return 0;
    return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  };
  const dwellP95 = pct(dwellVals, 0.95);
  const dwellP30 = pct(dwellVals, 0.30);
  const regime = new Float32Array(NX * NY); // 0..4 category ids
  const outlier = new Float32Array(NX * NY);
  const ratios = [];
  for (let k = 0; k < NX * NY; k++) {
    if (support[k] <= 0) continue;
    if (dwell[k] >= dwellP95 && dwellP95 > 0) regime[k] = 2;
    else if (steps[k] >= stepFloor && dwell[k] <= dwellP30) regime[k] = 1;
    else if (steps[k] >= busyFloor && purity[k] >= 0.55) regime[k] = 3;
    else if (steps[k] >= busyFloor && purity[k] <= 0.25) regime[k] = 4;
    else regime[k] = 0;
    if (traffic[k] >= trafficFloor) {
      const r = dwell[k] / Math.max(1, traffic[k]);
      outlier[k] = r;
      ratios.push(r);
    }
  }
  ratios.sort((a, b) => a - b);
  const outlierRef = pct(ratios, 0.95) || 1;
  for (let k = 0; k < NX * NY; k++) {
    if (outlier[k] > 0) outlier[k] = Math.min(1, outlier[k] / outlierRef);
  }
  scalars.regime = {
    data: regime,
    max: 4,
    label: 'Behaviour regime',
    unit: 'class',
    categorical: true,
    categories: REGIME_CATEGORIES,
  };
  scalars.outlier = {
    data: outlier,
    max: 1,
    label: 'Outlier (dwell / traffic)',
    unit: 'relative',
    signed: false,
  };

  return {
    meta, B, NX, NY, idx, i0, j0,
    traffic, dwell, steps, speed, rose, support, maxSupport, supportRef,
    meanX, meanY, purity, divergence, regime, outlier, scalars,
    spawnCdf, spawnTotal,

    /** Bilinear sample of a scalar grid at fractional cell coords. */
    sampleScalar(arr, x, y) {
      const fx = Math.min(NX - 1.001, Math.max(0, x));
      const fy = Math.min(NY - 1.001, Math.max(0, y));
      const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
      const i2 = Math.min(NX - 1, i + 1), j2 = Math.min(NY - 1, j + 1);
      return arr[idx(i, j)] * (1 - tx) * (1 - ty)
        + arr[idx(i2, j)] * tx * (1 - ty)
        + arr[idx(i, j2)] * (1 - tx) * ty
        + arr[idx(i2, j2)] * tx * ty;
    },

    /** Bilinear sample of the direction rose into `out`, returns support+speed. */
    sampleRose(x, y, out) {
      const fx = Math.min(NX - 1.001, Math.max(0, x));
      const fy = Math.min(NY - 1.001, Math.max(0, y));
      const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
      const i2 = Math.min(NX - 1, i + 1), j2 = Math.min(NY - 1, j + 1);
      const corners = [
        [idx(i, j), (1 - tx) * (1 - ty)],
        [idx(i2, j), tx * (1 - ty)],
        [idx(i, j2), (1 - tx) * ty],
        [idx(i2, j2), tx * ty],
      ];
      out.fill(0);
      let sup = 0, spd = 0;
      for (const [k, w] of corners) {
        for (let b = 0; b < B; b++) out[b] += rose[k * B + b] * w;
        sup += support[k] * w;
        spd += speed[k] * w;
      }
      return { sup, spd };
    },

    /** Pick a spawn cell with probability proportional to footfall support. */
    randomSpawn() {
      const r = Math.random() * spawnTotal;
      let lo = 0, hi = NX * NY - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (spawnCdf[mid] < r) lo = mid + 1; else hi = mid; }
      return { x: (lo % NX) + Math.random(), y: Math.floor(lo / NX) + Math.random() };
    },
  };
}

/**
 * Diverging ramp for signed scalars, centred on zero.
 * Convergence (flows merging) reads cyan, divergence (flows splitting) reads
 * red, and "nothing much happens here" stays neutral. A sequential ramp cannot
 * express this — zero would land in the middle of the hue range and dominate.
 */
export function divergingRamp(t) {
  const v = Math.max(-1, Math.min(1, t));
  const m = Math.pow(Math.abs(v), 0.65);
  const h = v < 0 ? 0.52 : 0.02;
  return { h, s: 0.15 + 0.75 * m, l: 0.16 + 0.42 * m };
}

/** Product heat ramp (mirrors frontend/src/components/heatmap/heatmapUtils.ts). */
export function heatRamp(t) {
  t = Math.max(0, Math.min(1, t));
  const e = Math.pow(t, 0.6);
  let h, s, l;
  if (e < 0.25) { const r = e / 0.25; h = 240 - r * 60; s = 0.7 + r * 0.2; l = 0.35 + r * 0.15; }
  else if (e < 0.5) { const r = (e - 0.25) / 0.25; h = 180 - r * 60; s = 0.9; l = 0.5 + r * 0.05; }
  else if (e < 0.75) { const r = (e - 0.5) / 0.25; h = 120 - r * 80; s = 0.9 + r * 0.1; l = 0.55 - r * 0.05; }
  else { const r = (e - 0.75) / 0.25; h = 40 - r * 40; s = 1.0; l = 0.5 + r * 0.1; }
  return { h: h / 360, s, l };
}

/** Map a regime class id to an HSL triple for vertex colours. */
export function regimeRamp(id) {
  const c = REGIME_CATEGORIES[id | 0] || REGIME_CATEGORIES[0];
  const hex = c.color;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s: Math.min(1, s * 1.05), l: Math.min(0.62, l + 0.06) };
}

/** Absolute (i,j) → cell lookup from a raw field JSON payload. */
export function cellMapFromFieldJson(payload) {
  const m = new Map();
  for (const c of payload.cells || []) m.set(`${c.i},${c.j}`, c);
  return m;
}

/**
 * Attach a signed relative footfall-shift scalar onto an already-loaded field
 * grid, matched by absolute venue cell indices (i0/j0 crop aware).
 *
 * Counts are share-normalised by each slice's total footfall first, so a quieter
 * evening window is not painted "loss" everywhere — only cells whose *share* of
 * store traffic moved. delta = (toShare − fromShare) / (toShare + fromShare + ε).
 */
export function attachShiftScalar(field, fromMap, toMap, key, label) {
  const { NX, NY, i0, j0, support, scalars } = field;
  let fromTot = 0, toTot = 0, fromDwell = 0, toDwell = 0;
  for (const c of fromMap.values()) { fromTot += c.t || 0; fromDwell += c.d || 0; }
  for (const c of toMap.values()) { toTot += c.t || 0; toDwell += c.d || 0; }
  fromTot = fromTot || 1;
  toTot = toTot || 1;
  fromDwell = fromDwell || 1;
  toDwell = toDwell || 1;

  const data = new Float32Array(NX * NY);
  const dwellDelta = new Float32Array(NX * NY);
  const purityBreak = new Float32Array(NX * NY);
  let lo = 0, hi = 0;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (support[k] <= 0) continue;
      const a = fromMap.get(`${i0 + i},${j0 + j}`);
      const b = toMap.get(`${i0 + i},${j0 + j}`);
      const at = (a?.t || 0) / fromTot, bt = (b?.t || 0) / toTot;
      const ad = (a?.d || 0) / fromDwell, bd = (b?.d || 0) / toDwell;
      const ap = a?.p || 0, bp = b?.p || 0;
      const d = (bt - at) / (at + bt + 1e-12);
      data[k] = d;
      dwellDelta[k] = (bd - ad) / (ad + bd + 1e-12);
      purityBreak[k] = Math.abs(bp - ap);
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
  }
  scalars[key] = {
    data,
    min: lo,
    max: hi,
    signed: true,
    label,
    unit: 'share Δ footfall',
    dwellDelta,
    purityBreak,
  };
  return scalars[key];
}

/**
 * Boost the outlier scalar with morning↔evening purity breaks once companion
 * slices are available (cells that flip one-way ↔ two-way).
 */
export function boostOutliersWithPurityBreak(field, fromMap, toMap) {
  const { NX, NY, i0, j0, support, outlier, scalars } = field;
  let boosted = 0;
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const k = j * NX + i;
      if (support[k] <= 0) continue;
      const a = fromMap.get(`${i0 + i},${j0 + j}`);
      const b = toMap.get(`${i0 + i},${j0 + j}`);
      if (!a || !b) continue;
      const br = Math.abs((b.p || 0) - (a.p || 0));
      if (br < 0.35) continue;
      // Keep dwell/traffic signal dominant; purity flips lift quiet-but-unstable cells.
      const next = Math.min(1, Math.max(outlier[k], 0.55 + br * 0.4));
      if (next > outlier[k]) { outlier[k] = next; boosted++; }
    }
  }
  if (scalars.outlier) {
    scalars.outlier.label = 'Outlier (dwell/traffic + purity break)';
  }
  return boosted;
}
