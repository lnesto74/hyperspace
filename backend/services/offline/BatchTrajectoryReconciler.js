/**
 * BatchTrajectoryReconciler
 * -------------------------
 * Offline post-processing on a full MQTT capture. Uses the production reconciler
 * for forward pass, then a global grocery-aware fragment merge with full path
 * geometry (impossible in real-time).
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { finished } from 'node:stream/promises';
import { TrajectoryReconciler, normalizeReconcilerConfig } from '../TrajectoryReconciler.js';
import {
  perceptionToFloor,
  applyTransformToPoint,
  applyTransformToVelocity,
  normalizePerceptionTransform,
  IDENTITY_TRANSFORM,
} from '../PerceptionTransform.js';
import { GROCERY_MOTION } from '../../config/offlineReconcilePresets.js';

const BATCH_MS = 100;
/** Offline artifacts use coarser buckets — fewer batches, same replay semantics. */
const OFFLINE_BATCH_MS = 250;
const SWEEP_MS = 250;

function parseCaptureLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith('nohup:') || raw.startsWith('mosquitto_sub')) return null;
  const idx = raw.indexOf(' ');
  if (idx < 0) return null;
  try {
    return JSON.parse(raw.slice(idx + 1));
  } catch {
    return null;
  }
}

function buildIncoming(d, transform) {
  const inputFrame = transform?.input_frame || 'legacy';
  const percPos = d.position || { x: 0, y: 0, z: 0 };
  const percVel = d.velocity || { x: 0, y: 0, z: 0 };
  const floorPos = perceptionToFloor(inputFrame, percPos);
  const floorVel = perceptionToFloor(inputFrame, percVel);
  const venuePosition = applyTransformToPoint(transform, floorPos);
  const velocity = applyTransformToVelocity(transform, floorVel);
  return {
    id: String(d.id),
    deviceId: d.deviceId || 'edge',
    venueId: d.venueId || 'default',
    timestamp: Number(d.timestamp) || Date.now(),
    position: floorPos,
    venuePosition,
    velocity,
    objectType: d.objectType || 'person',
    boundingBox: d.boundingBox || { width: 0.5, height: 1.7, depth: 0.5 },
  };
}

function vecAt(samples, fromEnd = 0) {
  const i = fromEnd ? Math.max(0, samples.length - 1 - fromEnd) : 0;
  const j = fromEnd ? samples.length - 1 : Math.min(samples.length - 1, 3);
  if (j <= i) return { x: 0, z: 0 };
  const a = samples[i];
  const b = samples[j];
  const dt = Math.max((b.t - a.t) / 1000, 0.05);
  return { x: (b.x - a.x) / dt, z: (b.z - a.z) / dt };
}

function cosine2(a, b) {
  const ax = a.x || 0; const az = a.z || 0;
  const bx = b.x || 0; const bz = b.z || 0;
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 0.05 || lb < 0.05) return 1;
  return (ax * bx + az * bz) / (la * lb);
}

function summarizeFragment(samples) {
  if (!samples.length) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  let disp = 0;
  for (let i = 1; i < samples.length; i++) {
    disp += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
  }
  return {
    firstTs: first.t,
    lastTs: last.t,
    start: { x: first.x, z: first.z },
    end: { x: last.x, z: last.z },
    entryVel: vecAt(samples, 0),
    exitVel: vecAt(samples, 3),
    samples,
    totalDisp: disp,
  };
}

/** Union-find merge of stable track fragments using global geometry. */
function mergeFragments(fragments, cfg, motion = GROCERY_MOTION) {
  const ids = [...fragments.keys()];
  if (ids.length <= 1) {
    const merged = new Map();
    for (const [id, frag] of fragments) {
      merged.set(id, { stableId: id, samples: frag.samples });
    }
    return merged;
  }

  const parent = new Map(ids.map(id => [id, id]));
  const find = (x) => {
    let p = parent.get(x);
    while (p !== parent.get(p)) p = parent.get(p);
    let cur = x;
    while (cur !== p) {
      const next = parent.get(cur);
      parent.set(cur, p);
      cur = next;
    }
    return p;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };

  const maxGapMs = cfg.reid_max_gap_s * 1000;
  const entries = ids.map(id => ({ id, ...fragments.get(id) })).sort((a, b) => a.firstTs - b.firstTs);
  const merges = [];

  for (let i = 0; i < entries.length; i++) {
    const fragA = entries[i];
    if (fragA.samples.length < motion.min_fragment_samples) continue;
    if (fragA.totalDisp < motion.min_fragment_disp_m) continue;
    for (let j = i + 1; j < entries.length; j++) {
      const fragB = entries[j];
      const gap = fragB.firstTs - fragA.lastTs;
      if (gap <= 0) continue;
      if (gap > maxGapMs) break;
      if (fragB.samples.length < motion.min_fragment_samples) continue;

      const dt = gap / 1000;
      const predX = fragA.end.x + fragA.exitVel.x * dt;
      const predZ = fragA.end.z + fragA.exitVel.z * dt;
      const distPred = Math.hypot(predX - fragB.start.x, predZ - fragB.start.z);
      const distRaw = Math.hypot(fragB.start.x - fragA.end.x, fragB.start.z - fragA.end.z);
      const dist = Math.min(distPred, distRaw);
      const implied = distRaw / Math.max(dt, 0.05);
      if (dist > cfg.reid_max_distance_m + motion.merge_distance_bonus_m) continue;
      if (implied > Math.min(cfg.reid_max_implied_speed_m_s, motion.max_walk_speed_m_s)) continue;

      const cos = cosine2(fragA.exitVel, fragB.entryVel);
      if (cos < cfg.reid_velocity_cosine_min - 0.15) continue;

      const cost = dist + (gap / 1000) * 0.35 + (1 - cos) * 2.0;
      merges.push({ idA: fragA.id, idB: fragB.id, cost });
    }
  }

  merges.sort((a, b) => a.cost - b.cost);
  for (const m of merges) {
    if (find(m.idA) === find(m.idB)) continue;
    union(m.idA, m.idB);
  }

  const groups = new Map();
  for (const id of ids) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }

  const merged = new Map();
  for (const [root, group] of groups) {
    const sorted = group
      .map(id => fragments.get(id))
      .filter(Boolean)
      .sort((a, b) => a.firstTs - b.firstTs);
    const samples = [];
    for (const frag of sorted) {
      for (const s of frag.samples) {
        if (samples.length && s.t < samples[samples.length - 1].t) continue;
        samples.push(s);
      }
    }
    merged.set(root, { stableId: root, samples });
  }
  return merged;
}

function smoothSamples(samples, alpha) {
  if (alpha >= 0.99 || samples.length < 2) return samples;
  const out = [{ ...samples[0] }];
  for (let i = 1; i < samples.length; i++) {
    const prev = out[out.length - 1];
    const cur = samples[i];
    out.push({
      t: cur.t,
      x: alpha * cur.x + (1 - alpha) * prev.x,
      z: alpha * cur.z + (1 - alpha) * prev.z,
      vx: cur.vx,
      vz: cur.vz,
      perceptionId: cur.perceptionId,
    });
  }
  return out;
}

async function writeStreamLine(ws, line) {
  if (ws.write(line)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      ws.off('drain', onDrain);
      ws.off('error', onError);
    };
    const onDrain = () => { cleanup(); resolve(); };
    const onError = (err) => { cleanup(); reject(err); };
    ws.on('drain', onDrain);
    ws.on('error', onError);
  });
}

async function streamBatchTimelineToFile(mergedTracks, venueId, ws, devicePrefix = 'replay-offline-', onBatch = null) {
  let firstTs = Infinity;
  let lastTs = -Infinity;
  for (const track of mergedTracks.values()) {
    if (!track.samples?.length) continue;
    firstTs = Math.min(firstTs, track.samples[0].t);
    lastTs = Math.max(lastTs, track.samples[track.samples.length - 1].t);
  }
  if (!Number.isFinite(firstTs) || !Number.isFinite(lastTs)) return 0;

  const trackList = [...mergedTracks.values()]
    .filter(t => t.samples?.length)
    .map(t => ({ stableId: t.stableId, samples: t.samples, idx: 0, last: null }));

  let batchCount = 0;
  for (let t0 = firstTs; t0 <= lastTs; t0 += OFFLINE_BATCH_MS) {
    const t1 = t0 + OFFLINE_BATCH_MS;
    const tracks = [];
    for (const tr of trackList) {
      if (tr.samples) {
        while (tr.idx < tr.samples.length && tr.samples[tr.idx].t < t1) {
          tr.last = tr.samples[tr.idx];
          tr.idx++;
        }
        if (tr.idx >= tr.samples.length) tr.samples = null;
      }
      if (!tr.last) continue;
      const s = tr.last;
      tracks.push({
        id: tr.stableId,
        stableId: tr.stableId,
        trackKey: `${devicePrefix}${tr.stableId}`,
        deviceId: devicePrefix.replace(/-$/, '') || 'replay-offline',
        venueId,
        timestamp: t0,
        venuePosition: { x: s.x, y: 0, z: s.z },
        velocity: { x: s.vx || 0, y: 0, z: s.vz || 0 },
        objectType: 'person',
        originalPerceptionId: s.perceptionId || '',
        _offlineReconciled: true,
      });
    }
    if (tracks.length === 0) continue;
    await writeStreamLine(ws, `${JSON.stringify({ _type: 'batch', venueId, timestamp: t0, tracks })}\n`);
    batchCount++;
    if (onBatch && (batchCount % 200 === 0 || t0 + OFFLINE_BATCH_MS > lastTs)) {
      onBatch(batchCount, t0, lastTs);
    }
    if (batchCount % 500 === 0) {
      await new Promise(r => setImmediate(r));
    }
  }
  return batchCount;
}

/**
 * Run reconciliation and stream artifact directly to disk (memory-safe for 30+ min captures).
 */
export async function runBatchReconciliationToFile({
  filePath,
  artifactPath,
  venueId,
  transform = IDENTITY_TRANSFORM,
  configOverrides = {},
  meta = {},
  onProgress,
}) {
  const cfg = normalizeReconcilerConfig({ ...configOverrides, enabled: true });
  const normTransform = normalizePerceptionTransform(transform);
  const reconciler = new TrajectoryReconciler(() => cfg);

  const fragmentSamples = new Map();
  let lastSweep = 0;
  let totalRaw = 0;
  let firstTs = null;
  let lastTs = null;

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const d = parseCaptureLine(line);
    if (!d?.position) continue;
    if (venueId && d.venueId && d.venueId !== venueId) continue;

    const incoming = buildIncoming(d, normTransform);
    totalRaw++;
    if (firstTs == null) firstTs = incoming.timestamp;
    lastTs = incoming.timestamp;

    if (incoming.timestamp - lastSweep > SWEEP_MS) {
      lastSweep = incoming.timestamp;
      reconciler.sweep(incoming.timestamp);
    }

    const out = reconciler.process(incoming);
    if (!out) continue;

    const sid = out.stableId || out.id;
    const sample = {
      t: out.timestamp,
      x: out.venuePosition.x,
      z: out.venuePosition.z,
      vx: out.velocity?.x || 0,
      vz: out.velocity?.z || 0,
      perceptionId: out.originalPerceptionId || incoming.id,
    };

    let arr = fragmentSamples.get(sid);
    if (!arr) {
      arr = [];
      fragmentSamples.set(sid, arr);
    }
    arr.push(sample);

    if (onProgress && totalRaw % 250_000 === 0) {
      onProgress({ phase: 'forward', messages: totalRaw });
    }
  }

  if (lastTs != null) reconciler.sweep(lastTs + 60_000);

  const fragments = new Map();
  for (const [sid, samples] of fragmentSamples) {
    const frag = summarizeFragment(samples);
    if (frag) fragments.set(sid, frag);
  }
  fragmentSamples.clear();

  const forwardFragmentCount = fragments.size;

  if (onProgress) onProgress({ phase: 'merge', fragments: forwardFragmentCount });

  const mergedRaw = mergeFragments(fragments, cfg);
  fragments.clear();

  if (onProgress) onProgress({ phase: 'smooth', merged: mergedRaw.size });

  const mergedTracks = new Map();
  for (const [sid, track] of mergedRaw) {
    mergedTracks.set(sid, {
      stableId: sid,
      samples: smoothSamples(track.samples, cfg.smoothing_alpha),
    });
  }
  const mergedTrackCount = mergedTracks.size;
  mergedRaw.clear();

  const ws = fs.createWriteStream(artifactPath, { flags: 'w' });
  await writeStreamLine(ws, `${JSON.stringify({ _type: 'meta', ...meta, firstTs, lastTs })}\n`);

  if (onProgress) onProgress({ phase: 'write', progress: 0.9 });

  const batchCount = await streamBatchTimelineToFile(
    mergedTracks,
    venueId || 'default',
    ws,
    'replay-offline-',
    (n, t0, tEnd) => {
      if (onProgress) {
        const frac = tEnd > firstTs ? (t0 - firstTs) / (tEnd - firstTs) : 0;
        onProgress({ phase: 'write', progress: 0.9 + frac * 0.095, batches: n });
      }
    },
  );

  if (onProgress) onProgress({ phase: 'write', progress: 0.995, batches: batchCount });

  ws.end();
  await finished(ws);

  mergedTracks.clear();
  const stats = reconciler.getStats(venueId) || {};

  const metrics = {
    raw_messages: totalRaw,
    forward_fragments: forwardFragmentCount,
    merged_tracks: mergedTrackCount,
    batch_count: batchCount,
    span_ms: firstTs != null && lastTs != null ? lastTs - firstTs : 0,
    ghost_dropped: stats.ghost_dropped || 0,
    reid_count: stats.reid_count || 0,
    merge_reduction: forwardFragmentCount - mergedTrackCount,
  };

  return { metrics, meta: { venueId, firstTs, lastTs, presetConfig: cfg } };
}

/**
 * Run full offline reconciliation on a capture file (in-memory batches — small files only).
 * @returns {{ batches, metrics, meta }}
 */
export async function runBatchReconciliation({
  filePath,
  venueId,
  transform = IDENTITY_TRANSFORM,
  configOverrides = {},
  onProgress,
}) {
  const { default: os } = await import('os');
  const tmpPath = path.join(os.tmpdir(), `hyperspace-reconcile-${Date.now()}.jsonl`);
  try {
    const { metrics, meta } = await runBatchReconciliationToFile({
      filePath,
      artifactPath: tmpPath,
      venueId,
      transform,
      configOverrides,
      onProgress,
    });
    return { batches: [], metrics, meta };
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/** Write reconciled batches to JSONL artifact (replay-ready). */
export async function writeReconciledArtifact(filePath, batches, meta = {}) {
  const ws = fs.createWriteStream(filePath, { flags: 'w' });
  ws.write(`${JSON.stringify({ _type: 'meta', ...meta })}\n`);
  for (const batch of batches) {
    ws.write(`${JSON.stringify({ _type: 'batch', ...batch })}\n`);
  }
  await new Promise((resolve, reject) => {
    ws.end(() => resolve());
    ws.on('error', reject);
  });
}
