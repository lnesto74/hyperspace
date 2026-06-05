/**
 * Map-aware probabilistic association (Reconciliation v2, Phase 1 core).
 *
 * Stitches tracklets into chains by maximising the likelihood that the person who
 * disappeared at the end of tracklet i reappears at the start of tracklet j:
 *
 *   P(j|i) = P_walk · P_gap(Δt|ρ) · P_dist(geo | v_i, Δt) · P_head(v_i, conn, v_j)
 *   cost(i→j) = −log P(j|i)
 *
 * - geo = geodesic walk-around distance (never through a shelf); hard gates remove
 *   teleports, obstacle-crossings, and gaps/distances beyond rule-7 limits.
 * - ρ = number of OTHER tracklets near end_i at that moment ("other IDs around"):
 *   a vanish in a crowd is occlusion (gap tolerated); a vanish in open space is not.
 * - Global one-to-one assignment (greedy by lowest cost, one successor / one
 *   predecessor) + ambiguity margin → at a junction we prefer to SPLIT, not guess
 *   (fewer false merges). A tracklet with no acceptable successor simply ends (EXIT).
 */

const DEFAULTS = {
  T_max_s: 10,        // rule 7: max bridge gap
  D_max_m: 4,         // max geodesic bridge distance (rule 7 said ~3m; 4m covers a multi-second occlusion at walking pace)
  R_max: 1.6,         // max detour ratio geo/euclid
  vMax: 2.2,          // m/s hard speed gate
  tau0_s: 3,          // gap prior scale
  beta: 0.4,          // density widening of gap tolerance per neighbour
  densityRadius_m: 2, // radius for "other IDs around"
  sigma0_m: 0.4,      // displacement σ base
  kSigma: 0.35,       // displacement σ growth with |v|·Δt
  kappa: 3,           // von Mises concentration (heading)
  C_max: 5.0,         // accept if cost ≤ this
  margin: 0.7,        // ambiguity / EXIT margin (2nd-best must be this much worse)
  minSpeedForHeading: 0.1,
};

const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const speed = (v) => Math.hypot(v.x || 0, v.z || 0);

/** Downsample a chain's samples to a compact polyline [[x,z,t], …] for the annotation UI. */
function chainPolyline(samples, stepM = 0.7, cap = 48) {
  if (!samples.length) return null;
  const pts = []; let last = null;
  for (const s of samples) {
    if (!last || Math.hypot(s.x - last.x, s.z - last.z) >= stepM) { pts.push([+s.x.toFixed(1), +s.z.toFixed(1), s.t]); last = s; }
  }
  const lastS = samples[samples.length - 1];
  if (!pts.length || pts[pts.length - 1][2] !== lastS.t) pts.push([+lastS.x.toFixed(1), +lastS.z.toFixed(1), lastS.t]);
  if (pts.length > cap) { const out = []; const stride = pts.length / cap; for (let k = 0; k < cap; k++) out.push(pts[Math.floor(k * stride)]); out.push(pts[pts.length - 1]); return out; }
  return pts;
}

/** Interpolate the walkable geodesic path between two samples as synthetic points
 *  (so a bridged trajectory routes around shelves, not through them). */
function geodesicBridge(grid, a, b) {
  if (!grid) return [];
  if (!grid.segmentCrossesBlocked(a.x, a.z, b.x, b.z)) return []; // straight chord stays in free space
  const path = grid.path(a.x, a.z, b.x, b.z);
  if (!path || path.length <= 2) return [];
  let total = 0; const cum = [0];
  for (let i = 1; i < path.length; i++) { total += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z); cum.push(total); }
  if (total <= 0) return [];
  const dtMs = b.t - a.t;
  const spd = total / Math.max(dtMs / 1000, 0.05);
  const out = [];
  for (let i = 1; i < path.length - 1; i++) {        // skip endpoints (≈ a and b)
    const frac = cum[i] / total;
    const t = Math.round(a.t + dtMs * frac);
    const pPrev = path[i - 1], pNext = path[i + 1];
    const seg = Math.hypot(pNext.x - pPrev.x, pNext.z - pPrev.z) || 1;
    out.push({ t, x: path[i].x, z: path[i].z, vx: (pNext.x - pPrev.x) / seg * spd, vz: (pNext.z - pPrev.z) / seg * spd, perceptionId: a.perceptionId, bridge: true });
  }
  return out;
}

/** Spatio-temporal index of tracklet presence for the density term. */
function buildDensityIndex(tracklets) {
  const idx = new Map(); // tBucket(1s) -> [{x,z,i}]
  for (let i = 0; i < tracklets.length; i++) {
    const t = tracklets[i];
    let lastB = null;
    for (const s of t.samples) {
      const b = Math.floor(s.t / 1000);
      if (b === lastB) continue;
      lastB = b;
      let arr = idx.get(b); if (!arr) { arr = []; idx.set(b, arr); }
      arr.push({ x: s.x, z: s.z, i });
    }
  }
  return idx;
}
function densityAt(idx, x, z, t, radius, selfI) {
  const b = Math.floor(t / 1000);
  const r2 = radius * radius;
  const seen = new Set();
  for (let bb = b - 1; bb <= b + 1; bb++) {
    const arr = idx.get(bb); if (!arr) continue;
    for (const e of arr) {
      if (e.i === selfI || seen.has(e.i)) continue;
      const dx = e.x - x, dz = e.z - z;
      if (dx * dx + dz * dz <= r2) seen.add(e.i);
    }
  }
  return seen.size;
}

/**
 * @param {Array} tracklets  from extractTracklets
 * @param {WalkabilityGrid} grid
 * @param {object} [opts]
 * @returns {{ chains: Map<string, object[]>, links: Array, stats: object }}
 */
export function associateTracklets(tracklets, grid, opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const N = tracklets.length;
  const order = [...tracklets.keys()].sort((a, b) => tracklets[a].firstTs - tracklets[b].firstTs);
  const startByTime = order.slice(); // indices sorted by firstTs
  const startTs = startByTime.map(j => tracklets[j].firstTs);
  const lowerBound = (val) => { let lo = 0, hi = startTs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (startTs[m] <= val) lo = m + 1; else hi = m; } return lo; };
  const density = buildDensityIndex(tracklets);

  // candidate edges: for each predecessor i (its END), find successor starts j in window
  const edges = [];
  const bestForI = new Map(); // i -> {cost, second}
  let geoCalls = 0;

  for (let ii = 0; ii < N; ii++) {
    const i = order[ii];
    const ti = tracklets[i];
    const tEnd = ti.lastTs;
    const winEnd = tEnd + p.T_max_s * 1000;
    const ex = ti.end.x, ez = ti.end.z;
    const vExit = ti.exitVel, vExitMag = speed(vExit);
    const rho = densityAt(density, ex, ez, tEnd, p.densityRadius_m, i);
    const tau = p.tau0_s * (1 + p.beta * rho);

    // only scan successor starts whose firstTs ∈ (tEnd, tEnd + T_max]
    let costs = [];
    const lo = lowerBound(tEnd);                       // first start with firstTs > tEnd
    const hi = lowerBound(winEnd);                     // first start with firstTs > winEnd
    for (let jj = lo; jj < hi; jj++) {
      const j = startByTime[jj];
      if (j === i) continue;
      const tj = tracklets[j];
      const dt = (tj.firstTs - tEnd) / 1000;
      if (dt <= 0) continue;
      const sx = tj.start.x, sz = tj.start.z;
      const euclid = Math.hypot(sx - ex, sz - ez);
      if (euclid > p.D_max_m) continue;                  // rule 7 distance gate (prefilter)

      const geo = grid ? grid.geo(ex, ez, sx, sz) : euclid; geoCalls++;
      if (!Number.isFinite(geo) || geo > p.D_max_m) continue;
      const detour = geo / Math.max(euclid, 0.1);
      if (detour > p.R_max) continue;
      const implied = geo / Math.max(dt, 0.05);
      if (implied > p.vMax) continue;

      // --- probability terms (as −logP contributions) ---
      const logP_gap = -dt / tau;

      const mu = vExitMag * dt;
      const sigma = p.sigma0_m + p.kSigma * vExitMag * dt;
      const zscore = (geo - mu) / sigma;
      const logP_dist = -0.5 * zscore * zscore - Math.log(sigma);

      let logP_head = 0;
      const connAng = Math.atan2(sz - ez, sx - ex);
      if (vExitMag > p.minSpeedForHeading) {
        const dExit = wrapPi(connAng - Math.atan2(vExit.z, vExit.x));
        logP_head += p.kappa * (Math.cos(dExit) - 1);
      }
      const vEntry = tj.entryVel, vEntryMag = speed(vEntry);
      if (vEntryMag > p.minSpeedForHeading) {
        const dEntry = wrapPi(Math.atan2(vEntry.z, vEntry.x) - connAng);
        logP_head += p.kappa * (Math.cos(dEntry) - 1);
      }

      const logP = logP_gap + logP_dist + logP_head;
      const cost = -logP;
      edges.push({ i, j, cost, dt, geo, rho });
      costs.push(cost);
    }
    if (costs.length) {
      costs.sort((a, b) => a - b);
      bestForI.set(i, { cost: costs[0], second: costs.length > 1 ? costs[1] : Infinity });
    }
  }

  // global greedy one-to-one assignment, conservative
  edges.sort((a, b) => a.cost - b.cost);
  const succ = new Int32Array(N).fill(-1);   // i -> j
  const pred = new Int32Array(N).fill(-1);   // j -> i
  const outUsed = new Uint8Array(N), inUsed = new Uint8Array(N);
  const links = [];
  let accepted = 0, rejectedAmbig = 0, rejectedCmax = 0;

  for (const e of edges) {
    if (outUsed[e.i] || inUsed[e.j]) { if (!e.dec) e.dec = 'occupied'; continue; }
    if (e.cost > p.C_max) { e.dec = 'cmax'; rejectedCmax++; continue; }
    const bf = bestForI.get(e.i);
    // ambiguity: only accept the clear best for i; if 2nd-best is within margin, split
    if (bf && (bf.second - e.cost) < p.margin && bf.cost === e.cost) {
      // this IS the best edge but it's ambiguous vs second → prefer EXIT (split)
      e.dec = 'ambiguous'; rejectedAmbig++; continue;
    }
    if (bf && e.cost > bf.cost) { e.dec = 'suboptimal'; continue; } // only link i to its best
    succ[e.i] = e.j; pred[e.j] = e.i; outUsed[e.i] = 1; inUsed[e.j] = 1;
    e.dec = 'accepted';
    links.push({ from: tracklets[e.i].trackletId, to: tracklets[e.j].trackletId, cost: +e.cost.toFixed(3), gapS: +e.dt.toFixed(2), geo: +e.geo.toFixed(2), rho: e.rho });
    accepted++;
  }

  // build chains by following succ from heads (pred==-1).
  // Between two stitched tracklets, insert the GEODESIC path so the bridged
  // trajectory walks AROUND shelves instead of teleporting straight across.
  const chains = new Map();
  const chainMembers = opts.logGraph ? [] : null; // [{ stableId, tracklets:[trackletId] }]
  let chainSeq = 0, bridgePoints = 0;
  for (let i = 0; i < N; i++) {
    if (pred[i] !== -1) continue; // not a head
    const chainId = `${opts.chainPrefix || 'v2'}-${chainSeq++}`;
    const merged = [];
    const members = chainMembers ? [] : null;
    let cur = i;
    const guard = new Set();
    while (cur !== -1 && !guard.has(cur)) {
      guard.add(cur);
      if (members) members.push(tracklets[cur].trackletId);
      for (const s of tracklets[cur].samples) {
        if (merged.length && s.t < merged[merged.length - 1].t) continue;
        merged.push(s);
      }
      const nxt = succ[cur];
      if (nxt !== -1 && merged.length) {
        const a = merged[merged.length - 1];
        const b = tracklets[nxt].samples[0];
        const bridge = geodesicBridge(grid, a, b);
        for (const bp of bridge) { if (bp.t > merged[merged.length - 1].t) { merged.push(bp); bridgePoints++; } }
      }
      cur = nxt;
    }
    chains.set(chainId, merged);
    if (chainMembers) {
      const entry = { stableId: chainId, tracklets: members };
      let disp = 0;
      for (let k = 1; k < merged.length; k++) disp += Math.hypot(merged[k].x - merged[k - 1].x, merged[k].z - merged[k - 1].z);
      const life = merged.length ? merged[merged.length - 1].t - merged[0].t : 0;
      // only attach a renderable polyline for meaningful journeys (keeps the sidecar light + the UI uncluttered)
      if (merged.length >= 4 && life >= 3000 && disp >= 2) {
        entry.path = chainPolyline(merged);
        entry.t0 = merged[0].t; entry.t1 = merged[merged.length - 1].t;
        entry.disp = +disp.toFixed(1);
      }
      chainMembers.push(entry);
    }
  }

  // training substrate: tracklet endpoints + candidate edges (with accept/reject) + chain membership
  let graph = null;
  if (opts.logGraph) {
    graph = {
      params: p,
      tracklets: tracklets.map(t => ({
        id: t.trackletId, src: t.sourceId, t0: t.firstTs, t1: t.lastTs, n: t.samples.length,
        sx: +t.start.x.toFixed(2), sz: +t.start.z.toFixed(2), ex: +t.end.x.toFixed(2), ez: +t.end.z.toFixed(2),
      })),
      chains: chainMembers,
      edges: edges.map(e => ({
        from: tracklets[e.i].trackletId, to: tracklets[e.j].trackletId,
        cost: +e.cost.toFixed(3), gapS: +e.dt.toFixed(2), geo: +e.geo.toFixed(2), rho: e.rho,
        dec: e.dec || 'unseen',
      })),
    };
  }

  return {
    chains, links, graph,
    stats: {
      tracklets: N, candidate_edges: edges.length, geo_calls: geoCalls,
      links_accepted: accepted, rejected_ambiguous: rejectedAmbig, rejected_cmax: rejectedCmax,
      chains: chains.size, bridge_points: bridgePoints,
    },
  };
}

export { DEFAULTS as ASSOCIATE_DEFAULTS };
