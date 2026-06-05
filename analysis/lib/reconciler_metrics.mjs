import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG } from '../../backend/services/TrajectoryReconciler.js';
import { reconcileV2Pipeline } from '../../backend/services/offline/reconcileV2/reconcileV2.js';
import { reconcileV3Pipeline } from '../../backend/services/offline/reconcileV3/reconcileV3.js';
import { IDENTITY_TRANSFORM } from '../../backend/services/PerceptionTransform.js';
import { streamMessages } from './load_jsonl.mjs';

function createTrackRollup(t, x, z) {
  return {
    firstTs: t,
    lastTs: t,
    firstX: x,
    firstZ: z,
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
  // Capture streams are not guaranteed globally time-sorted (multi-sensor /
  // clock skew). Track the true time span via min/max so lifetime can never go
  // negative; use |dt| for the incremental speed estimate.
  const dt = Math.max(Math.abs(t - r.lastT) / 1000, 0.001);
  const step = Math.hypot(x - r.lastX, z - r.lastZ);
  r.totalDisp += step;
  const sp = step / dt;
  if (sp > 3.0) r.teleports++;
  if (Math.abs(sp - r.prevSpeed) / dt > 5) r.accelSpikes++;
  r.prevSpeed = sp;
  if (t < r.firstTs) r.firstTs = t;
  if (t > r.lastTs) r.lastTs = t;
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

const BUCKET_MS = 60_000;

function sampleRows(rows, maxN) {
  if (rows.length <= maxN) return rows;
  const idx = [];
  const step = (rows.length - 1) / (maxN - 1);
  for (let i = 0; i < maxN; i++) idx.push(Math.round(i * step));
  return idx.map((i) => rows[i]);
}

/** Map-friendly export: one birth/death per stable track + playback timeline. */
export function buildReconcilerSpatial(rollups, metrics, configName, firstTs, lastTs, timelineBuckets) {
  const births = [];
  const deaths = [];
  for (const [sid, r] of rollups.entries()) {
    const life = (r.lastTs - r.firstTs) / 1000;
    births.push({
      id: sid,
      x: r.firstX,
      z: r.firstZ,
      t: r.firstTs,
      lifetime_s: life,
    });
    deaths.push({
      id: sid,
      x: r.lastX,
      z: r.lastZ,
      t: r.lastTs,
      lifetime_s: life,
      total_path_m: r.totalDisp,
    });
  }

  const timeline = [];
  for (const t0 of [...timelineBuckets.keys()].sort((a, b) => a - b)) {
    const ptsRaw = timelineBuckets.get(t0) || [];
    const stride = Math.max(1, Math.floor(ptsRaw.length / 400));
    const points = ptsRaw.filter((_, i) => i % stride === 0).map((p) => ({ x: p.x, z: p.z }));
    timeline.push({ t0, t1: t0 + BUCKET_MS, points });
  }

  return {
    available: true,
    config: configName,
    frame: 'perception',
    time_ms: { min: firstTs, max: lastTs },
    counts: {
      stable_tracks: rollups.size,
      perception_ids: metrics.perception_id_count,
      fragmentation_factor: metrics.fragmentation_factor,
      mean_lifetime_s: metrics.lt_mean,
      mean_displacement_m: metrics.disp_mean,
      births: births.length,
      deaths: deaths.length,
      timeline_buckets: timeline.length,
    },
    births: sampleRows(births, 5000),
    deaths: sampleRows(deaths, 5000),
    timeline,
  };
}

/** Stream file once through reconciler — RAM-safe for multi-GB captures. */
export async function runReconcilerStream(filePath, overrides, { venueId, afterMs, beforeMs, label, onProgress } = {}) {
  const cfg = normalizeReconcilerConfig({ ...DEFAULT_CONFIG, ...overrides });
  const reconciler = new TrajectoryReconciler(() => cfg);
  const rollups = new Map();
  const perceptionIds = new Set();
  const timelineBuckets = new Map();
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
    const t0 = Math.floor(t / BUCKET_MS) * BUCKET_MS;
    let bucket = timelineBuckets.get(t0);
    if (!bucket) {
      bucket = [];
      timelineBuckets.set(t0, bucket);
    }
    if (bucket.length < 2000) bucket.push({ x, z });
    if (onProgress && totalRaw % 500_000 === 0) onProgress(totalRaw, label);
  }

  if (lastTs != null) reconciler.sweep(lastTs + 60000);
  const gs = reconciler.getStats(venueId) || { ghost_dropped: 0 };
  const metrics = scoreStableTracks(rollups, totalRaw, perceptionIds.size, gs);
  const spatial = buildReconcilerSpatial(rollups, metrics, label, firstTs, lastTs, timelineBuckets);
  return {
    config: cfg,
    first_ts: firstTs,
    last_ts: lastTs,
    raw_messages: totalRaw,
    spatial,
    ...metrics,
  };
}

/**
 * Map-aware v2 reconciler scored in the SAME shape as runReconcilerStream.
 *
 * v2 is a batch/map engine (tracklets + geodesic association), not a streaming
 * reconciler — so this runs the full v2 pipeline in-memory and then scores the
 * resulting chains. To stay directly comparable with the raw + v1 rows it runs
 * in the raw perception frame (identity transform) and builds its walkability
 * grid from this capture's own coverage (no external cache / DB obstacles).
 */
export async function runReconcileV2Stream(filePath, overrides, { venueId, afterMs, beforeMs, label, onProgress, transform, db } = {}) {
  const { engine, ...cfgRest } = overrides || {};
  const {
    mergedTracks, totalRaw, perceptionIdCount, firstTs, lastTs, trackletCount, stats,
  } = await reconcileV2Pipeline({
    filePath,
    venueId,
    transform: transform || IDENTITY_TRANSFORM,
    configOverrides: { ...cfgRest, logGraph: false },
    db: db || null,
    afterMs,
    beforeMs,
    onProgress: onProgress ? (p) => { if (p.messages) onProgress(p.messages, label); } : undefined,
  });

  const rollups = new Map();
  const timelineBuckets = new Map();
  for (const [cid, tr] of mergedTracks) {
    for (const s of tr.samples) {
      const r = rollups.get(cid);
      if (!r) rollups.set(cid, createTrackRollup(s.t, s.x, s.z));
      else updateTrackRollup(r, s.t, s.x, s.z);
      const t0 = Math.floor(s.t / BUCKET_MS) * BUCKET_MS;
      let bucket = timelineBuckets.get(t0);
      if (!bucket) { bucket = []; timelineBuckets.set(t0, bucket); }
      if (bucket.length < 2000) bucket.push({ x: s.x, z: s.z });
    }
  }

  // v2 drops nothing as "ghost" the way v1 does; report a comparable proxy of 0.
  const metrics = scoreStableTracks(rollups, totalRaw, perceptionIdCount, { ghost_dropped: 0 });
  const spatial = buildReconcilerSpatial(rollups, metrics, label, firstTs, lastTs, timelineBuckets);
  return {
    config: { engine: 'v2', ...cfgRest },
    engine: 'v2',
    first_ts: firstTs,
    last_ts: lastTs,
    raw_messages: totalRaw,
    tracklets: trackletCount,
    links_accepted: stats?.links_accepted ?? null,
    spatial,
    ...metrics,
  };
}

/** Map-aware v3 (v2 + concurrent-duplicate fusion), same scorecard shape as v2. */
export async function runReconcileV3Stream(filePath, overrides, { venueId, afterMs, beforeMs, label, onProgress, transform, db } = {}) {
  const { engine, ...cfgRest } = overrides || {};
  const {
    mergedTracks, totalRaw, perceptionIdCount, firstTs, lastTs, trackletCount, trackletCountRaw, fuseStats, stats,
  } = await reconcileV3Pipeline({
    filePath,
    venueId,
    transform: transform || IDENTITY_TRANSFORM,
    configOverrides: { ...cfgRest, logGraph: false },
    db: db || null,
    afterMs,
    beforeMs,
    onProgress: onProgress ? (p) => { if (p.messages) onProgress(p.messages, label); } : undefined,
  });

  const rollups = new Map();
  const timelineBuckets = new Map();
  for (const [cid, tr] of mergedTracks) {
    for (const s of tr.samples) {
      const r = rollups.get(cid);
      if (!r) rollups.set(cid, createTrackRollup(s.t, s.x, s.z));
      else updateTrackRollup(r, s.t, s.x, s.z);
      const t0 = Math.floor(s.t / BUCKET_MS) * BUCKET_MS;
      let bucket = timelineBuckets.get(t0);
      if (!bucket) { bucket = []; timelineBuckets.set(t0, bucket); }
      if (bucket.length < 2000) bucket.push({ x: s.x, z: s.z });
    }
  }

  const metrics = scoreStableTracks(rollups, totalRaw, perceptionIdCount, { ghost_dropped: 0 });
  const spatial = buildReconcilerSpatial(rollups, metrics, label, firstTs, lastTs, timelineBuckets);
  return {
    config: { engine: 'v3', ...cfgRest },
    engine: 'v3',
    first_ts: firstTs,
    last_ts: lastTs,
    raw_messages: totalRaw,
    tracklets: trackletCount,
    tracklets_raw: trackletCountRaw,
    fused_groups: fuseStats?.fused_groups ?? 0,
    fused_removed: fuseStats?.removed ?? 0,
    links_accepted: stats?.links_accepted ?? null,
    spatial,
    ...metrics,
  };
}
