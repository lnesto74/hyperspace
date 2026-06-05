/**
 * Reconciliation v3 — map-constrained v2 + Stage-0 concurrent-duplicate fusion.
 *
 * v2 baseline: walkability grid → tracklet split → geodesic association → chains.
 * v3 adds: fuse overlapping near-duplicate tracklets (multi-sensor concurrent IDs)
 * BEFORE association so fragmentation can drop below the v2 sequential floor.
 *
 * Artifact format, replay writer, and graph sidecar are byte-compatible with v2.
 */
import fs from 'fs';
import readline from 'readline';
import { finished } from 'node:stream/promises';
import {
  normalizePerceptionTransform, perceptionToFloor, applyTransformToPoint, applyTransformToVelocity, IDENTITY_TRANSFORM,
} from '../../PerceptionTransform.js';
import { loadWalkabilityCache, buildWalkability } from '../reconcileV2/walkability.js';
import { extractTracklets } from '../reconcileV2/tracklets.js';
import { associateTracklets } from '../reconcileV2/associate.js';
import { fuseConcurrentDuplicates } from './fuseConcurrent.js';
import { streamBatchTimelineToFile, writeStreamLine, parseCaptureLine, smoothSamples } from '../BatchTrajectoryReconciler.js';

// Reuse obstacle extraction from v2 orchestrator (same venue frame).
import { reconcileV2Pipeline } from '../reconcileV2/reconcileV2.js';

const NON_OBSTACLE = /lidar|camera|sensor|zone|label|marker|entrance|door|gate|person|trajectory|heat/i;

function obstaclesFromDb(db, venueId) {
  if (!db || !venueId) return [];
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT id, type, name, position_x, position_z, scale_x, scale_z, rotation_y, metadata_json
      FROM venue_objects WHERE venue_id = ?
    `).all(venueId);
  } catch { return []; }
  const out = [];
  for (const r of rows) {
    if (NON_OBSTACLE.test(r.type || '') || NON_OBSTACLE.test(r.name || '')) continue;
    let poly = null;
    try {
      const meta = r.metadata_json ? JSON.parse(r.metadata_json) : null;
      const fp = meta?.footprint || meta?.polygon || meta?.points;
      if (Array.isArray(fp) && fp.length >= 3) {
        poly = fp.map(p => ({ x: Number(p.x ?? p[0]), z: Number(p.z ?? p[1]) })).filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
        if (poly.length < 3) poly = null;
      }
    } catch { /* ignore */ }
    if (!poly) {
      const sx = Math.abs(r.scale_x || 0) / 2, sz = Math.abs(r.scale_z || 0) / 2;
      if (sx < 0.05 || sz < 0.05) continue;
      const th = r.rotation_y || 0, c = Math.cos(th), s = Math.sin(th);
      poly = [[-sx,-sz],[sx,-sz],[sx,sz],[-sx,sz]].map(([lx, lz]) => ({ x: r.position_x + lx * c + lz * s, z: r.position_z - lx * s + lz * c }));
    }
    out.push({ id: r.id, vertices: poly });
  }
  return out;
}

/**
 * v3 pipeline: same as v2 through tracklet extraction, then Stage-0 fusion, then association.
 */
export async function reconcileV3Pipeline({
  filePath, venueId, transform = IDENTITY_TRANSFORM,
  configOverrides = {}, onProgress, db = null, afterMs = null, beforeMs = null,
}) {
  const normT = normalizePerceptionTransform(transform);
  const cfg = configOverrides || {};

  const byId = new Map();
  let total = 0, firstTs = null, lastTs = null;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const coverage = [];

  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const d = parseCaptureLine(line);
    if (!d?.position) continue;
    if (venueId && d.venueId && d.venueId !== venueId) continue;
    const t = Number(d.timestamp) || 0; if (!t) continue;
    if (afterMs && t < afterMs) continue;
    if (beforeMs && t > beforeMs) continue;
    const fp = perceptionToFloor(normT.input_frame, d.position);
    const fv = perceptionToFloor(normT.input_frame, d.velocity || { x: 0, y: 0, z: 0 });
    const v = applyTransformToPoint(normT, fp);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.z)) continue;
    const vel = applyTransformToVelocity(normT, fv);
    total++; if (firstTs == null) firstTs = t; lastTs = t;
    if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x; if (v.z < minZ) minZ = v.z; if (v.z > maxZ) maxZ = v.z;
    const id = String(d.id);
    let arr = byId.get(id); if (!arr) { arr = []; byId.set(id, arr); }
    const lp = arr.length ? arr[arr.length - 1] : null;
    if (!lp || (t - lp.t) >= 150 || Math.hypot(v.x - lp.x, v.z - lp.z) >= 0.25) {
      arr.push({ t, x: v.x, z: v.z, vx: vel.x, vz: vel.z, perceptionId: id });
      if (total % 3 === 0) coverage.push(v.x, v.z);
    }
    if (onProgress && total % 250000 === 0) onProgress({ phase: 'forward', messages: total });
  }
  const perceptionIdCount = byId.size;

  let grid = null;
  if (cfg.walkabilityCachePath && fs.existsSync(cfg.walkabilityCachePath)) {
    try { grid = loadWalkabilityCache(cfg.walkabilityCachePath); } catch { grid = null; }
  }
  if (!grid && coverage.length) {
    const cell = 1.0, PAD = 2;
    const x0 = minX - PAD, z0 = minZ - PAD;
    const nx = Math.max(1, Math.ceil((maxX + PAD - x0) / cell));
    const nz = Math.max(1, Math.ceil((maxZ + PAD - z0) / cell));
    const visitCounts = new Uint32Array(nx * nz);
    for (let i = 0; i < coverage.length; i += 2) {
      const ix = Math.floor((coverage[i] - x0) / cell), iz = Math.floor((coverage[i + 1] - z0) / cell);
      if (ix >= 0 && iz >= 0 && ix < nx && iz < nz) visitCounts[iz * nx + ix]++;
    }
    grid = buildWalkability({ bounds: { x0, z0, nx, nz, cellM: cell }, visitCounts, obstacles: obstaclesFromDb(db, venueId), inflateCells: 1, interiorDilateCells: 4 }).grid;
  }

  if (onProgress) onProgress({ phase: 'merge', fragments: byId.size });

  let tracklets = extractTracklets(byId, grid, cfg.tracklet || {});
  byId.clear();
  const trackletCountRaw = tracklets.length;

  // ---- v3 Stage 0: fuse concurrent duplicate tracklets ----
  const { tracklets: fusedTracklets, stats: fuseStats } = fuseConcurrentDuplicates(
    tracklets.slice(),
    cfg.fuseConcurrent || {},
  );
  tracklets = fusedTracklets;
  const trackletCount = tracklets.length;

  if (onProgress) onProgress({ phase: 'fuse', fragments: trackletCount });

  const logGraph = cfg.logGraph !== false;
  const { chains, stats, graph } = associateTracklets(tracklets.slice(), grid, {
    ...(cfg.associate || {}),
    logGraph,
    chainPrefix: 'v3',
  });

  if (onProgress) onProgress({ phase: 'smooth', merged: chains.size });

  const minLifeMs = cfg.min_chain_life_ms || 0;
  const alpha = cfg.smoothing_alpha ?? 0.6;
  const mergedTracks = new Map();
  for (const [cid, samples] of chains) {
    if (!samples.length) continue;
    if (minLifeMs && (samples[samples.length - 1].t - samples[0].t) < minLifeMs) continue;
    mergedTracks.set(cid, { stableId: cid, samples: smoothSamples(samples, alpha) });
  }
  chains.clear();

  return {
    mergedTracks, stats, graph, grid, totalRaw: total, perceptionIdCount,
    firstTs, lastTs, trackletCount, trackletCountRaw, fuseStats,
  };
}

export async function runReconcileV3ToFile({
  filePath, artifactPath, venueId, transform = IDENTITY_TRANSFORM,
  configOverrides = {}, meta = {}, onProgress, db = null,
}) {
  const {
    mergedTracks, stats, graph, grid, totalRaw: total, firstTs, lastTs,
    trackletCount, trackletCountRaw, fuseStats,
  } = await reconcileV3Pipeline({ filePath, venueId, transform, configOverrides, onProgress, db });

  const ws = fs.createWriteStream(artifactPath, { flags: 'w' });
  await writeStreamLine(ws, `${JSON.stringify({ _type: 'meta', ...meta, firstTs, lastTs, venueId: venueId || meta.venueId || null, engine: 'v3' })}\n`);
  if (onProgress) onProgress({ phase: 'write', progress: 0.9 });
  const batchCount = await streamBatchTimelineToFile(mergedTracks, venueId || 'default', ws, 'replay-offline-', (n, t0, tEnd) => {
    if (onProgress) { const frac = tEnd > firstTs ? (t0 - firstTs) / (tEnd - firstTs) : 0; onProgress({ phase: 'write', progress: 0.9 + frac * 0.095, batches: n }); }
  });
  if (onProgress) onProgress({ phase: 'write', progress: 0.995, batches: batchCount });
  await writeStreamLine(ws, `${JSON.stringify({ _type: 'meta_footer', batchCount })}\n`);
  ws.end();
  await finished(ws);

  let graphPath = null;
  if (graph) {
    graphPath = artifactPath.replace(/\.reconciled\.jsonl$/, '.graph.json');
    try {
      fs.writeFileSync(graphPath, JSON.stringify({
        jobId: meta.jobId || null, venueId: venueId || null, sourceFile: meta.sourceFile || null,
        presetId: meta.presetId || null, firstTs, lastTs, engine: 'v3', fuse: fuseStats, ...graph,
      }));
    } catch (e) { graphPath = null; console.warn('[reconcileV3] graph sidecar write failed:', e.message); }
  }

  const mergedCount = mergedTracks.size;
  mergedTracks.clear();

  const metrics = {
    raw_messages: total,
    forward_fragments: trackletCountRaw,
    tracklets_after_fusion: trackletCount,
    fused_groups: fuseStats?.fused_groups ?? 0,
    fused_removed: fuseStats?.removed ?? 0,
    merged_tracks: mergedCount,
    batch_count: batchCount,
    span_ms: firstTs != null && lastTs != null ? lastTs - firstTs : 0,
    tracklets: trackletCount,
    chains: stats.chains,
    links_accepted: stats.links_accepted,
    bridge_points: stats.bridge_points,
    merge_reduction: trackletCount - stats.chains,
    walkability: grid ? 'grid' : 'none',
    graph_path: graphPath,
  };
  return { metrics, meta: { venueId, firstTs, lastTs } };
}

// Re-export v2 pipeline for A/B tooling that wants the baseline without fusion.
export { reconcileV2Pipeline };

export default runReconcileV3ToFile;
