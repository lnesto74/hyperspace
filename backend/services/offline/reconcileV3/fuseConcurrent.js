/**
 * Reconciliation v3 — Stage 0: concurrent-duplicate fusion.
 *
 * The v2 associator only links end(i) → start(j). It cannot merge two tracklets
 * that overlap in time — the dominant fragmentation cause when multi-sensor /
 * split perception emits two IDs for the same person at once (design doc §13:
 * 65% of human "same" labels blocked as CONCURRENT).
 *
 * Before sequential association, cluster tracklets whose intervals overlap AND
 * whose positions stay within proximityM for the whole overlap window, then fuse
 * each cluster into one tracklet (samples merged chronologically).
 */

const DEFAULTS = {
  proximityM: 1.5,
  bucketMs: 500,
  minOverlapMs: 300,
  requireDifferentSource: true,
  bboxPadM: 0.5,
};

class UnionFind {
  constructor(n) {
    this.p = [...Array(n).keys()];
    this.r = new Array(n).fill(0);
  }
  find(x) {
    while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; }
    return x;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    if (this.r[ra] < this.r[rb]) this.p[ra] = rb;
    else if (this.r[ra] > this.r[rb]) this.p[rb] = ra;
    else { this.p[rb] = ra; this.r[ra]++; }
  }
}

function bboxOf(tracklet) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of tracklet.samples) {
    if (s.x < minX) minX = s.x; if (s.x > maxX) maxX = s.x;
    if (s.z < minZ) minZ = s.z; if (s.z > maxZ) maxZ = s.z;
  }
  return { minX, maxX, minZ, maxZ };
}

function bboxNear(a, b, pad) {
  return !(a.maxX + pad < b.minX - pad || b.maxX + pad < a.minX - pad
    || a.maxZ + pad < b.minZ - pad || b.maxZ + pad < a.minZ - pad);
}

function positionAt(samples, t) {
  if (!samples.length) return null;
  if (t <= samples[0].t) return { x: samples[0].x, z: samples[0].z };
  const last = samples[samples.length - 1];
  if (t >= last.t) return { x: last.x, z: last.z };
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t >= t) {
      const a = samples[i - 1], b = samples[i];
      const dt = Math.max(b.t - a.t, 1);
      const f = (t - a.t) / dt;
      return { x: a.x + f * (b.x - a.x), z: a.z + f * (b.z - a.z) };
    }
  }
  return { x: last.x, z: last.z };
}

/** True when two tracklets overlap in time and stay within proximityM throughout. */
function shouldFuse(a, b, p) {
  if (p.requireDifferentSource && a.sourceId === b.sourceId) return false;
  const o0 = Math.max(a.firstTs, b.firstTs);
  const o1 = Math.min(a.lastTs, b.lastTs);
  if (o1 - o0 < p.minOverlapMs) return false;

  for (let t = o0; t <= o1; t += p.bucketMs) {
    const pa = positionAt(a.samples, t);
    const pb = positionAt(b.samples, t);
    if (!pa || !pb) continue;
    if (Math.hypot(pa.x - pb.x, pa.z - pb.z) > p.proximityM) return false;
  }
  return true;
}

function edgeVel(samples, atEnd) {
  const n = samples.length;
  if (n < 2) return { x: 0, z: 0 };
  const k = Math.min(4, n);
  const a = atEnd ? samples[n - k] : samples[0];
  const b = atEnd ? samples[n - 1] : samples[Math.min(k - 1, n - 1)];
  const dt = Math.max((b.t - a.t) / 1000, 0.05);
  return { x: (b.x - a.x) / dt, z: (b.z - a.z) / dt };
}

function mergeCluster(members, seq) {
  const merged = [];
  for (const t of members) {
    for (const s of t.samples) merged.push({ ...s });
  }
  merged.sort((a, b) => a.t - b.t || a.x - b.x);

  // Collapse near-simultaneous samples (same moment, two concurrent IDs).
  const out = [];
  for (const s of merged) {
    const prev = out[out.length - 1];
    if (prev && (s.t - prev.t) < 180) {
      prev.x = (prev.x + s.x) / 2;
      prev.z = (prev.z + s.z) / 2;
      prev.vx = (prev.vx + (s.vx || 0)) / 2;
      prev.vz = (prev.vz + (s.vz || 0)) / 2;
      continue;
    }
    out.push({ ...s });
  }

  const sources = [...new Set(members.map((m) => m.sourceId))];
  const fusedFrom = members.map((m) => m.trackletId);
  const first = out[0], last = out[out.length - 1];
  let disp = 0;
  for (let i = 1; i < out.length; i++) disp += Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z);

  return {
    trackletId: `fuse#${seq}`,
    sourceId: sources.join('+'),
    samples: out,
    firstTs: first.t,
    lastTs: last.t,
    start: { x: first.x, z: first.z },
    end: { x: last.x, z: last.z },
    entryVel: edgeVel(out, false),
    exitVel: edgeVel(out, true),
    totalDisp: disp,
    lifeMs: last.t - first.t,
    fusedFrom,
    _fused: true,
  };
}

/**
 * @param {Array} tracklets from extractTracklets
 * @param {object} [opts]
 * @returns {{ tracklets: Array, stats: object }}
 */
export function fuseConcurrentDuplicates(tracklets, opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const N = tracklets.length;
  if (N < 2) {
    return { tracklets, stats: { input: N, output: N, fused_groups: 0, removed: 0, pairs_checked: 0, pairs_fused: 0 } };
  }

  const boxes = tracklets.map(bboxOf);
  const uf = new UnionFind(N);
  let pairsChecked = 0, pairsFused = 0;

  for (let i = 0; i < N; i++) {
    const ti = tracklets[i];
    for (let j = i + 1; j < N; j++) {
      const tj = tracklets[j];
      if (tj.firstTs > ti.lastTs + p.minOverlapMs) break;
      if (tj.lastTs < ti.firstTs - p.minOverlapMs) continue;
      if (!bboxNear(boxes[i], boxes[j], p.bboxPadM + p.proximityM)) continue;
      pairsChecked++;
      if (shouldFuse(ti, tj, p)) { uf.union(i, j); pairsFused++; }
    }
  }

  const groups = new Map();
  for (let i = 0; i < N; i++) {
    const r = uf.find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }

  const out = [];
  let fusedGroups = 0, removed = 0, fuseSeq = 0;
  for (const indices of groups.values()) {
    if (indices.length === 1) {
      out.push(tracklets[indices[0]]);
    } else {
      fusedGroups++;
      removed += indices.length - 1;
      out.push(mergeCluster(indices.map((i) => tracklets[i]), fuseSeq++));
    }
  }

  return {
    tracklets: out,
    stats: {
      input: N,
      output: out.length,
      fused_groups: fusedGroups,
      removed,
      pairs_checked: pairsChecked,
      pairs_fused: pairsFused,
    },
  };
}

export { DEFAULTS as FUSE_CONCURRENT_DEFAULTS };
