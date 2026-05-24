import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG } from '../../backend/services/TrajectoryReconciler.js';
import { streamMessages } from './load_jsonl.mjs';

export function scoreStableTracks(stable, totalRaw, perceptionIdSet, ghostStats) {
  const lifetimes = [];
  const displacements = [];
  const meanSpeeds = [];
  let totalSamples = 0;
  let teleports = 0;
  let accelSpikes = 0;

  for (const t of stable.values()) {
    const s = t.samples;
    if (s.length < 2) continue;
    totalSamples += s.length;
    const life = (s[s.length - 1].t - s[0].t) / 1000;
    lifetimes.push(life);
    let disp = 0;
    let prevSpeed = 0;
    for (let i = 1; i < s.length; i++) {
      const dt = Math.max((s[i].t - s[i - 1].t) / 1000, 0.001);
      const dx = s[i].x - s[i - 1].x;
      const dz = s[i].z - s[i - 1].z;
      const step = Math.hypot(dx, dz);
      disp += step;
      const sp = step / dt;
      if (sp > 3.0) teleports++;
      if (Math.abs(sp - prevSpeed) / dt > 5) accelSpikes++;
      prevSpeed = sp;
    }
    displacements.push(disp);
    if (life > 0) meanSpeeds.push(disp / life);
  }

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (a, p) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
  };
  const realShoppers = displacements.filter((d) => d >= 30).length;

  return {
    n_stable: stable.size,
    n_samples: totalSamples,
    perception_id_count: perceptionIdSet.size,
    fragmentation_factor: perceptionIdSet.size / Math.max(stable.size, 1),
    lt_mean: mean(lifetimes),
    lt_p50: pct(lifetimes, 50),
    lt_p95: pct(lifetimes, 95),
    disp_mean: mean(displacements),
    disp_p50: pct(displacements, 50),
    disp_p95: pct(displacements, 95),
    speed_mean: mean(meanSpeeds),
    teleports,
    accelSpikes,
    teleports_per_1k: (teleports / Math.max(totalSamples, 1)) * 1000,
    real_shopper_count: realShoppers,
    ghost_dropped: ghostStats.ghost_dropped,
    ghost_pct: (ghostStats.ghost_dropped / Math.max(totalRaw, 1)) * 100,
  };
}

/** Stream file once through reconciler — RAM-safe for multi-GB captures. */
export async function runReconcilerStream(filePath, overrides, { venueId, afterMs, beforeMs, label, onProgress } = {}) {
  const cfg = normalizeReconcilerConfig({ ...DEFAULT_CONFIG, ...overrides });
  const reconciler = new TrajectoryReconciler(() => cfg);
  const stable = new Map();
  const pidSet = new Set();
  let lastSweep = 0;
  let totalRaw = 0;
  let firstTs = null;
  let lastTs = null;

  for await (const m of streamMessages(filePath, { venueId, afterMs, beforeMs })) {
    totalRaw++;
    pidSet.add(m.id);
    if (firstTs == null) firstTs = m.timestamp;
    lastTs = m.timestamp;
    if (m.timestamp - lastSweep > 250) {
      lastSweep = m.timestamp;
      reconciler.sweep(m.timestamp);
    }
    const out = reconciler.process(m);
    if (!out) continue;
    const sid = out.stableId || out.id;
    let rec = stable.get(sid);
    if (!rec) {
      rec = { samples: [] };
      stable.set(sid, rec);
    }
    rec.samples.push({ t: out.timestamp, x: out.venuePosition.x, z: out.venuePosition.z });
    if (onProgress && totalRaw % 500_000 === 0) onProgress(totalRaw, label);
  }

  if (lastTs != null) reconciler.sweep(lastTs + 60000);
  const gs = reconciler.getStats(venueId) || { ghost_dropped: 0 };
  const metrics = scoreStableTracks(stable, totalRaw, pidSet, gs);
  return { config: cfg, first_ts: firstTs, last_ts: lastTs, raw_messages: totalRaw, ...metrics };
}
