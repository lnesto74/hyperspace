import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG } from '../../backend/services/TrajectoryReconciler.js';
import { streamMessages } from './load_jsonl.mjs';

function createTrackRollup(t, x, z) {
  return {
    firstTs: t,
    lastTs: t,
    totalDisp: 0,
    sampleCount: 1,
    teleports: 0,
    accelSpikes: 0,
    lastX: x,
    lastZ: z,
    lastT: t,
    prevSpeed: 0,
  };
}

function updateTrackRollup(r, t, x, z) {
  const dt = Math.max((t - r.lastT) / 1000, 0.001);
  const step = Math.hypot(x - r.lastX, z - r.lastZ);
  r.totalDisp += step;
  const sp = step / dt;
  if (sp > 3.0) r.teleports++;
  if (Math.abs(sp - r.prevSpeed) / dt > 5) r.accelSpikes++;
  r.prevSpeed = sp;
  r.lastTs = t;
  r.lastX = x;
  r.lastZ = z;
  r.lastT = t;
  r.sampleCount++;
}

/** Score from compact per-track rollups (not full sample arrays). */
export function scoreStableTracks(rollups, totalRaw, perceptionIdCount, ghostStats) {
  const lifetimes = [];
  const displacements = [];
  const meanSpeeds = [];
  let totalSamples = 0;
  let teleports = 0;
  let accelSpikes = 0;

  for (const r of rollups.values()) {
    if (r.sampleCount < 2) continue;
    totalSamples += r.sampleCount;
    teleports += r.teleports;
    accelSpikes += r.accelSpikes;
    const life = (r.lastTs - r.firstTs) / 1000;
    lifetimes.push(life);
    displacements.push(r.totalDisp);
    if (life > 0) meanSpeeds.push(r.totalDisp / life);
  }

  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const pct = (a, p) => {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(s.length * p / 100))];
  };
  const realShoppers = displacements.filter((d) => d >= 30).length;

  return {
    n_stable: rollups.size,
    n_samples: totalSamples,
    perception_id_count: perceptionIdCount,
    fragmentation_factor: perceptionIdCount / Math.max(rollups.size, 1),
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
  const rollups = new Map();
  const perceptionIds = new Set();
  let lastSweep = 0;
  let totalRaw = 0;
  let firstTs = null;
  let lastTs = null;

  for await (const m of streamMessages(filePath, { venueId, afterMs, beforeMs })) {
    totalRaw++;
    perceptionIds.add(m.id);
    if (firstTs == null) firstTs = m.timestamp;
    lastTs = m.timestamp;
    if (m.timestamp - lastSweep > 250) {
      lastSweep = m.timestamp;
      reconciler.sweep(m.timestamp);
    }
    const out = reconciler.process(m);
    if (!out) continue;
    const sid = out.stableId || out.id;
    const x = out.venuePosition.x;
    const z = out.venuePosition.z;
    const t = out.timestamp;
    let r = rollups.get(sid);
    if (!r) {
      rollups.set(sid, createTrackRollup(t, x, z));
    } else {
      updateTrackRollup(r, t, x, z);
    }
    if (onProgress && totalRaw % 500_000 === 0) onProgress(totalRaw, label);
  }

  if (lastTs != null) reconciler.sweep(lastTs + 60000);
  const gs = reconciler.getStats(venueId) || { ghost_dropped: 0 };
  const metrics = scoreStableTracks(rollups, totalRaw, perceptionIds.size, gs);
  return { config: cfg, first_ts: firstTs, last_ts: lastTs, raw_messages: totalRaw, ...metrics };
}
