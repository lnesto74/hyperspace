// Entrance-gate footfall — a single "real shoppers" denominator per capture.
//
// Counts distinct PEOPLE crossing the entrance ROI, using the method validated
// in analysis/gate_entrants.mjs: stream raw → light v1 reconciler (reduces
// fragments near the gate) → engagement events for any track that touches the
// gate polygon (full pass / born-inside-exit / enter-die-inside / through-move,
// no duration floor) → de-duplicate events that are close in time+space+
// direction → keep only crossings within ±90° of the dominant flow.
//
// The directional, de-duplicated count is the recommended entrant estimate and
// is used as the SHARED denominator for fragments-per-shopper across raw + every
// reconciler config, so the benchmark comparison is apples-to-apples.
import fs from 'fs';
import readline from 'readline';
import { createRequire } from 'module';
import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG } from '../../backend/services/TrajectoryReconciler.js';
import { perceptionToFloor, applyTransformToPoint, applyTransformToVelocity, normalizePerceptionTransform, IDENTITY_TRANSFORM } from '../../backend/services/PerceptionTransform.js';

// better-sqlite3 lives in the backend's node_modules. In the container that is
// reachable from /app/index.js; locally fall back to this module's own resolver.
function loadBetterSqlite() {
  for (const base of ['/app/index.js', import.meta.url]) {
    try { return createRequire(base)('better-sqlite3'); } catch { /* try next */ }
  }
  throw new Error('better-sqlite3 not resolvable');
}

/** Load the entrance ROI polygon + venue perceptionTransform from the main DB. */
export function loadEntranceContext(venueId, dbPath = process.env.DB_PATH || '/data/db/hyperspace.db') {
  try {
    const Database = loadBetterSqlite();
    const db = new Database(dbPath, { readonly: true });
    const rois = db.prepare('SELECT id, name, vertices FROM regions_of_interest WHERE venue_id = ?').all(venueId);
    const venue = db.prepare('SELECT dwg_transform_json FROM venues WHERE id = ?').get(venueId);
    db.close();

    // Prefer the manually-positioned entrance gate; fall back to any entrance/gate ROI.
    let roi = rois.find((r) => /1121|traffic/i.test(r.name || '') && !/suggested/i.test(r.name || ''));
    if (!roi) roi = rois.find((r) => /entrance|ingress|ingresso|gate|door/i.test(r.name || ''));
    let vertices = null;
    if (roi) {
      try {
        const vs = JSON.parse(roi.vertices || '[]');
        if (Array.isArray(vs) && vs.length >= 3) {
          vertices = vs.map((p) => ({ x: Number(p.x), z: Number(p.z ?? p.y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
          if (vertices.length < 3) vertices = null;
        }
      } catch { vertices = null; }
    }
    let transform = IDENTITY_TRANSFORM;
    if (venue?.dwg_transform_json) {
      try {
        const tj = JSON.parse(venue.dwg_transform_json);
        if (tj.perceptionTransform) transform = normalizePerceptionTransform(tj.perceptionTransform);
      } catch { /* identity */ }
    }
    return { roi: vertices ? { id: roi.id, name: roi.name, vertices } : null, transform };
  } catch (e) {
    return { roi: null, transform: IDENTITY_TRANSFORM, error: e.message };
  }
}

function parseLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith('nohup:') || raw.startsWith('mosquitto_sub')) return null;
  const idx = raw.indexOf(' ');
  try { return JSON.parse(idx < 0 ? raw : raw.slice(idx + 1)); } catch { return null; }
}

/**
 * Count entrants crossing the entrance ROI. Returns the directional de-duplicated
 * people estimate (`footfall`) plus diagnostics. Returns null `footfall` if no ROI.
 */
export async function computeEntranceFootfall(filePath, {
  venueId, roiVertices, transform = IDENTITY_TRANSFORM, afterMs = null, beforeMs = null,
  moveM = 0.3, dedupT = 3000, dedupD = 1.2, onProgress,
} = {}) {
  if (!roiVertices || roiVertices.length < 3) {
    return { footfall: null, reason: 'no entrance ROI' };
  }
  const VERTS = roiVertices;
  const xs = VERTS.map((p) => p.x), zs = VERTS.map((p) => p.z);
  const bbox = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  const inPoly = (x, z) => {
    let inside = false;
    for (let i = 0, j = VERTS.length - 1; i < VERTS.length; j = i++) {
      const xi = VERTS[i].x, zi = VERTS[i].z, xj = VERTS[j].x, zj = VERTS[j].z;
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
    }
    return inside;
  };
  const PADB = { x0: bbox.x0 - 3, x1: bbox.x1 + 3, z0: bbox.z0 - 3, z1: bbox.z1 + 3 };
  const nearBox = (x, z) => x >= PADB.x0 && x <= PADB.x1 && z >= PADB.z0 && z <= PADB.z1;

  const normT = normalizePerceptionTransform(transform || {});
  const toVenue = (d) => {
    const fp = perceptionToFloor(normT.input_frame, d.position || { x: 0, y: 0, z: 0 });
    const fv = perceptionToFloor(normT.input_frame, d.velocity || { x: 0, y: 0, z: 0 });
    return { venuePosition: applyTransformToPoint(normT, fp), velocity: applyTransformToVelocity(normT, fv) };
  };

  const cfg = normalizeReconcilerConfig({
    ...DEFAULT_CONFIG, enabled: true, offline_instant_promote: true,
    ghost_max_speed_m_s: 3.5, ghost_min_promotion_lifetime_ms: 0, ghost_min_promotion_displacement_m: 0.03,
    ghost_static_timeout_s: 120, ghost_static_displacement_m: 0.35,
    reid_max_gap_s: 18, reid_max_distance_m: 9.0, reid_max_implied_speed_m_s: 2.4,
    reid_velocity_cosine_min: -0.25, smoothing_alpha: 0.55, active_to_lost_timeout_ms: 2500, trail_max_length: 64,
  });
  const reconciler = new TrajectoryReconciler(() => cfg);

  const tracks = new Map();
  const DS = 0.2;
  let lastSweep = 0, total = 0, lastTs = null;

  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const d = parseLine(line);
    if (!d || !d.position) continue;
    if (d.venueId && venueId && d.venueId !== venueId) continue;
    const t = Number(d.timestamp) || 0; if (!t) continue;
    if (afterMs && t < afterMs) continue;
    if (beforeMs && t > beforeMs) continue;
    const { venuePosition, velocity } = toVenue(d);
    total++; lastTs = t;
    if (t - lastSweep > 250) { lastSweep = t; reconciler.sweep(t); }
    const out = reconciler.process({ id: String(d.id), deviceId: d.deviceId || 'edge', venueId, timestamp: t, position: venuePosition, venuePosition, velocity });
    if (!out) continue;
    const sid = out.stableId || out.id;
    const x = out.venuePosition.x, z = out.venuePosition.z;
    let r = tracks.get(sid);
    if (!r) { r = { firstTs: t, lastTs: t, totalDisp: 0, lastX: x, lastZ: z, near: [] }; tracks.set(sid, r); }
    else { r.totalDisp += Math.hypot(x - r.lastX, z - r.lastZ); r.lastTs = t; r.lastX = x; r.lastZ = z; }
    if (nearBox(x, z)) {
      const arr = r.near; const p = arr.length ? arr[arr.length - 1] : null;
      if (!p || Math.hypot(x - p.x, z - p.z) >= DS || t - p.t >= 400) arr.push({ x, z, t });
    }
    if (onProgress && total % 500000 === 0) onProgress(total);
  }
  if (lastTs != null) reconciler.sweep(lastTs + 60000);

  // engagement events
  const events = [];
  let touchedTracks = 0, countedTracks = 0;
  for (const r of tracks.values()) {
    if (r.totalDisp < 0.8) continue;
    const pts = r.near; if (!pts.length) continue;
    let i = 0, trackCounted = false, trackTouched = false;
    while (i < pts.length) {
      if (!inPoly(pts[i].x, pts[i].z)) { i++; continue; }
      trackTouched = true;
      const rs = i; while (i < pts.length && inPoly(pts[i].x, pts[i].z)) i++; const re = i - 1;
      const born = rs === 0, died = re === pts.length - 1;
      const crossed = rs > 0 || re < pts.length - 1;
      let pathLen = 0; for (let k = rs + 1; k <= re; k++) pathLen += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z);
      const dx = pts[re].x - pts[rs].x, dz = pts[re].z - pts[rs].z; const m = Math.hypot(dx, dz) || 1;
      if (crossed || pathLen >= moveM) {
        events.push({ t: pts[rs].t, x: (pts[rs].x + pts[re].x) / 2, z: (pts[rs].z + pts[re].z) / 2, dx: dx / m, dz: dz / m, born, died, crossed });
        trackCounted = true;
      }
    }
    if (trackTouched) touchedTracks++;
    if (trackCounted) countedTracks++;
  }

  // dominant direction + directional filter
  let ndx = 0, ndz = 0; for (const e of events) { ndx += e.dx; ndz += e.dz; }
  const nmag = Math.hypot(ndx, ndz) || 1; const ndir = { x: ndx / nmag, z: ndz / nmag };
  const dirEvents = events.filter((e) => (e.dx * ndir.x + e.dz * ndir.z) >= 0);

  // de-dup directional events into people
  const sortedDir = [...dirEvents].sort((a, b) => a.t - b.t);
  const clustersDir = [];
  for (const e of sortedDir) {
    let merged = false;
    for (let c = clustersDir.length - 1; c >= 0; c--) {
      const cl = clustersDir[c];
      if (e.t - cl.t > dedupT) break;
      if (Math.hypot(e.x - cl.x, e.z - cl.z) <= dedupD) { cl.t = e.t; cl.x = e.x; cl.z = e.z; merged = true; break; }
    }
    if (!merged) clustersDir.push({ t: e.t, x: e.x, z: e.z, dx: e.dx, dz: e.dz });
  }
  // de-dup all-direction events (diagnostic)
  const sortedAll = [...events].sort((a, b) => a.t - b.t);
  const clustersAll = [];
  for (const e of sortedAll) {
    let merged = false;
    for (let c = clustersAll.length - 1; c >= 0; c--) {
      const cl = clustersAll[c];
      if (e.t - cl.t > dedupT) break;
      if (Math.hypot(e.x - cl.x, e.z - cl.z) <= dedupD && (e.dx * cl.dx + e.dz * cl.dz) >= 0) { cl.t = e.t; cl.x = e.x; cl.z = e.z; merged = true; break; }
    }
    if (!merged) clustersAll.push({ t: e.t, x: e.x, z: e.z, dx: e.dx, dz: e.dz });
  }

  return {
    footfall: clustersDir.length,            // recommended: directional, fragment-deduped people
    footfall_all_directions: clustersAll.length,
    counted_tracks_inclusive: countedTracks,
    touched_tracks: touchedTracks,
    engagement_events: events.length,
    dominant_dir_deg: +(Math.atan2(ndir.z, ndir.x) * 180 / Math.PI).toFixed(1),
    directional_purity: +(events.length ? nmag / events.length : 0).toFixed(3),
    method: 'entrance_gate_directional_deduped',
  };
}
