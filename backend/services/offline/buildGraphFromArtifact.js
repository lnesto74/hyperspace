import fs from 'fs';
import readline from 'readline';

/**
 * Synthesize a Proof-tab graph ({ chains, tracklets, ... }) from a reconciled
 * replay artifact (`*.reconciled.jsonl`). The v2 engine writes a rich `.graph.json`
 * sidecar, but the v1 streaming engine only writes the replay artifact — yet that
 * artifact carries `stableId` + `originalPerceptionId` on every emitted point, which
 * is exactly what the before/after view needs: reconciled chains (grouped by
 * stableId) and the raw LiDAR fragments inside each chain (runs of perception id).
 *
 * This lets the Proof tab compare RAW vs ANY reconciled preset (v1 or v2), not just v2.
 *
 * Memory is bounded: points are decimated on insert (dist/dt) and each chain is
 * capped via in-place halving so a multi-hour mover never blows up the heap on the
 * 4GB droplet.
 */

const KEEP_DIST_M = 0.4;   // skip near-duplicate points (stationary noise)
const KEEP_DT_MS = 700;    // ...but always keep one point per ~0.7s for time coverage
const CAP = 256;           // per-chain soft cap; halve in place when 2× exceeded

export async function buildGraphFromArtifact(artifactPath, { venueId = null, sourceFile = null, presetId = null } = {}) {
  const rl = readline.createInterface({
    input: fs.createReadStream(artifactPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  /** @type {Map<string, { pts: {x:number,z:number,t:number,pid:string}[], last: {x:number,z:number,t:number}|null }>} */
  const perStable = new Map();
  let firstTs = null;
  let lastTs = null;
  let metaVenue = venueId;

  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;
    let d;
    try { d = JSON.parse(raw); } catch { continue; }

    if (d._type === 'meta') {
      if (!metaVenue && d.venueId) metaVenue = d.venueId;
      if (d.firstTs != null) firstTs = firstTs == null ? Number(d.firstTs) : firstTs;
      if (d.lastTs != null) lastTs = Number(d.lastTs);
      continue;
    }
    if (d._type !== 'batch' || !Array.isArray(d.tracks)) continue;

    const t = Number(d.timestamp) || 0;
    if (t) { if (firstTs == null) firstTs = t; lastTs = t; }

    for (const tk of d.tracks) {
      const sid = tk.stableId || tk.id;
      if (!sid) continue;
      const pos = tk.venuePosition || tk.position;
      if (!pos) continue;
      const x = Number(pos.x);
      const z = Number(pos.z);
      if (!Number.isFinite(x) || !Number.isFinite(z)) continue;
      const pid = String(tk.originalPerceptionId || tk.perceptionId || '');

      let e = perStable.get(sid);
      if (!e) { e = { pts: [], last: null }; perStable.set(sid, e); }
      const last = e.last;
      const keep = !last
        || Math.hypot(x - last.x, z - last.z) >= KEEP_DIST_M
        || (t - last.t) >= KEEP_DT_MS;
      if (!keep) continue;

      e.pts.push({ x, z, t, pid });
      e.last = { x, z, t };

      if (e.pts.length >= CAP * 2) {
        // Decimate in place: keep every other point, always retain the last one.
        const half = [];
        for (let i = 0; i < e.pts.length; i += 2) half.push(e.pts[i]);
        if (half[half.length - 1] !== e.pts[e.pts.length - 1]) half.push(e.pts[e.pts.length - 1]);
        e.pts = half;
      }
    }
  }

  const chains = [];
  const tracklets = [];
  for (const [sid, e] of perStable) {
    const pts = e.pts;
    if (pts.length < 2) continue;

    const path = pts.map((p) => [Number(p.x.toFixed(2)), Number(p.z.toFixed(2)), p.t]);

    // tracklets = consecutive runs of the same perception id within this chain
    const tkIds = [];
    let runStart = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i === pts.length || pts[i].pid !== pts[runStart].pid) {
        const id = `${sid}#${tkIds.length}`;
        tracklets.push({ id, src: pts[runStart].pid || id, t0: pts[runStart].t, t1: pts[i - 1].t, n: i - runStart });
        tkIds.push(id);
        runStart = i;
      }
    }

    let disp = 0;
    for (let i = 1; i < pts.length; i++) disp += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);

    chains.push({
      stableId: sid,
      path,
      tracklets: tkIds,
      t0: pts[0].t,
      t1: pts[pts.length - 1].t,
      disp: Number(disp.toFixed(1)),
    });
  }

  return {
    synthesized: true,
    sourceFile,
    presetId,
    venueId: metaVenue,
    firstTs,
    lastTs,
    chains,
    tracklets,
  };
}
