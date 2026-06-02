/**
 * Tracklet extraction (Reconciliation v2, Phase 1).
 *
 * A raw perception id is NOT trusted as one person. We split its samples into
 * tracklets — short segments that are each physically self-consistent — wherever:
 *   - there is a time gap  > gapSplitMs            (we lost them; new tracklet)
 *   - an implied jump speed > vMax                 (teleport; perception swap)
 *   - the straight step crosses a BLOCKED cell     (walked through a shelf = impossible)
 *
 * Ghost/noise tracklets (too short-lived, no real displacement, or static jitter)
 * are dropped. The survivors are the clean building blocks the associator stitches.
 */

const DEFAULTS = {
  gapSplitMs: 1500,     // > this gap → split (rule 7 family)
  vMax: 2.2,            // m/s human cap; faster implied step = teleport
  minDispM: 0.8,        // ghost filter: total path shorter than this = noise
  minLifeMs: 700,       // ghost filter: shorter than this = blip
  minSamples: 3,
  staticTimeoutMs: 10000, // standing still this long ends a tracklet (rule 7)
  staticRadiusM: 0.35,    // movement under this = "static"
};

/** velocity (m/s) over the first/last few samples of a sample array. */
function edgeVel(samples, atEnd) {
  const n = samples.length;
  if (n < 2) return { x: 0, z: 0 };
  const k = Math.min(4, n);
  const a = atEnd ? samples[n - k] : samples[0];
  const b = atEnd ? samples[n - 1] : samples[Math.min(k - 1, n - 1)];
  const dt = Math.max((b.t - a.t) / 1000, 0.05);
  return { x: (b.x - a.x) / dt, z: (b.z - a.z) / dt };
}

function summarize(id, seq, samples) {
  const first = samples[0], last = samples[samples.length - 1];
  let disp = 0;
  for (let i = 1; i < samples.length; i++) disp += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
  return {
    trackletId: `${id}#${seq}`,
    sourceId: id,
    samples,
    firstTs: first.t, lastTs: last.t,
    start: { x: first.x, z: first.z },
    end: { x: last.x, z: last.z },
    entryVel: edgeVel(samples, false),
    exitVel: edgeVel(samples, true),
    totalDisp: disp,
    lifeMs: last.t - first.t,
  };
}

/**
 * @param {Map<string, Array<{t,x,z,vx,vz,perceptionId}>>} samplesById  raw samples grouped by perception id (sorted or not)
 * @param {WalkabilityGrid} grid
 * @param {object} [opts]
 * @returns {Array} tracklets
 */
export function extractTracklets(samplesById, grid, opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const out = [];
  let dropped = { ghost: 0, static: 0 };

  for (const [id, raw] of samplesById) {
    if (!raw || raw.length < 2) { if (raw?.length) dropped.ghost++; continue; }
    const samples = raw.slice().sort((a, b) => a.t - b.t);

    let cur = [samples[0]];
    let seq = 0;
    let staticAnchor = samples[0];

    const flush = () => {
      if (cur.length >= p.minSamples) {
        const t = summarize(id, seq++, cur);
        if (t.totalDisp < p.minDispM || t.lifeMs < p.minLifeMs) dropped.ghost++;
        else out.push(t);
      } else if (cur.length) dropped.ghost++;
      cur = [];
    };

    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      const dt = (b.t - a.t) / 1000;
      const step = Math.hypot(b.x - a.x, b.z - a.z);
      const implied = dt > 0 ? step / dt : Infinity;

      const gapBreak = (b.t - a.t) > p.gapSplitMs;
      const teleBreak = implied > p.vMax * 1.3 && step > 1.0;  // clearly faster than walking AND far
      const wallBreak = grid ? grid.segmentCrossesObstacle(a.x, a.z, b.x, b.z) : false;

      // static-dwell break: if they haven't left staticRadius for staticTimeout, cut
      if (Math.hypot(b.x - staticAnchor.x, b.z - staticAnchor.z) > p.staticRadiusM) {
        staticAnchor = b;
      } else if ((b.t - staticAnchor.t) > p.staticTimeoutMs) {
        flush(); cur = [b]; staticAnchor = b; dropped.static++; continue;
      }

      if (gapBreak || teleBreak || wallBreak) {
        flush(); cur = [b]; staticAnchor = b; continue;
      }
      cur.push(b);
    }
    flush();
  }

  return Object.assign(out, { _dropped: dropped });
}

export { DEFAULTS as TRACKLET_DEFAULTS };
