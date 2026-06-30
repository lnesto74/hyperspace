/**
 * Count entrants by perimeter-crossing rule:
 * A track qualifies if its trail crosses at least one edge of the entrance rectangle.
 * Tracks may start inside the polygon — still count if any trail segment crosses a side.
 * No duration filter, no dedup, no store-hours filter (use --store-hours to enable).
 *
 * Usage (production):
 *   docker exec hyperspace-backend-1 node /opt/hyperspace/scripts/entrance_perimeter_crossing_audit.mjs
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const VENUE_ID = process.env.VENUE_ID || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const GATE_ROI_ID = process.env.GATE_ROI_ID || 'e95db8c1-a077-4e3c-962d-a4e08ed96272';
const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const DAYS = Number(process.env.DAYS || 7);
const STORE_HOURS = process.env.STORE_HOURS === '1';
const OPEN_H = Number(process.env.OPEN_HOUR || 8);
const CLOSE_H = Number(process.env.CLOSE_HOUR || 21);
const TZ = process.env.TZ || 'Europe/Rome';

const now = Date.now();
const startTs = now - DAYS * 86400000;

function parseVerts(json) {
  const vs = typeof json === 'string' ? JSON.parse(json) : json;
  return vs.map((p) => ({ x: Number(p.x), z: Number(p.z ?? p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
}

/** Rectangle perimeter as 4 line segments (closed polygon edges). */
function perimeterEdges(verts) {
  const edges = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    edges.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  return edges;
}

function inPoly(x, z, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x; const zi = verts[i].z;
    const xj = verts[j].x; const zj = verts[j].z;
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

/** Segment (p1→p2) intersects segment (a→b), excluding shared endpoints only touches. */
function segmentsIntersect(p1x, p1z, p2x, p2z, ax, az, bx, bz) {
  const d1x = p2x - p1x; const d1z = p2z - p1z;
  const d2x = bx - ax; const d2z = bz - az;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-12) return false;
  const t = ((ax - p1x) * d2z - (az - p1z) * d2x) / denom;
  const u = ((ax - p1x) * d1z - (az - p1z) * d1x) / denom;
  return t > 0 && t < 1 && u >= 0 && u <= 1;
}

function trailCrossesPerimeter(points, verts, edges) {
  if (points.length < 2) return { crosses: false, reason: 'too_few_points', events: 0 };

  let events = 0;
  let firstAt = null;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    for (const e of edges) {
      if (segmentsIntersect(p0.x, p0.z, p1.x, p1.z, e.ax, e.az, e.bx, e.bz)) {
        events++;
        if (firstAt == null) firstAt = p1.t;
      }
    }
  }
  if (events === 0) return { crosses: false, reason: 'no_edge_cross', events: 0 };
  return { crosses: true, at: firstAt, events };
}

function hourLocal(ts) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: 'numeric', hour12: false,
  }).format(new Date(ts)));
}

function inStoreHours(ts) {
  const h = hourLocal(ts);
  return h >= OPEN_H && h < CLOSE_H;
}

const db = new Database(DB_PATH, { readonly: true });

const gate = db.prepare('SELECT id, name, vertices FROM regions_of_interest WHERE id = ?').get(GATE_ROI_ID);
if (!gate) {
  console.error('Gate ROI not found:', GATE_ROI_ID);
  process.exit(1);
}

const verts = parseVerts(gate.vertices);
const edges = perimeterEdges(verts);
const xs = verts.map((p) => p.x);
const zs = verts.map((p) => p.z);
const bbox = {
  x0: Math.min(...xs), x1: Math.max(...xs),
  z0: Math.min(...zs), z1: Math.max(...zs),
};

// Current method (zone_visits episodes)
const current = db.prepare(`
  SELECT COUNT(*) AS crossings, COUNT(DISTINCT track_key) AS uniqueTracks
  FROM zone_visits
  WHERE venue_id = ? AND roi_id = ?
    AND start_time >= ? AND start_time < ?
    AND track_key NOT LIKE '%cashier%'
`).get(VENUE_ID, GATE_ROI_ID, startTs, now);

const currentRecovery = db.prepare(`
  SELECT COUNT(*) AS crossings, COUNT(DISTINCT track_key) AS uniqueTracks
  FROM zone_visits
  WHERE venue_id = ? AND roi_id = ?
    AND start_time >= ? AND start_time < ?
    AND track_key NOT LIKE '%cashier%'
    AND duration_ms >= 5000
`).get(VENUE_ID, GATE_ROI_ID, startTs, now);

// Load track positions — only tracks that have any point near gate bbox (padded 5m)
const pad = 5;
const nearTracks = db.prepare(`
  SELECT DISTINCT track_key
  FROM track_positions
  WHERE venue_id = ?
    AND timestamp >= ? AND timestamp < ?
    AND position_x BETWEEN ? AND ?
    AND position_z BETWEEN ? AND ?
    AND track_key NOT LIKE '%cashier%'
`).all(
  VENUE_ID, startTs, now,
  bbox.x0 - pad, bbox.x1 + pad,
  bbox.z0 - pad, bbox.z1 + pad,
);

const loadPositions = db.prepare(`
  SELECT timestamp, position_x, position_z
  FROM track_positions
  WHERE venue_id = ? AND track_key = ?
    AND timestamp >= ? AND timestamp < ?
  ORDER BY timestamp ASC
`);

let perimeterCrossingTracks = 0;
let perimeterCrossingEvents = 0;
let bornInsideCrossing = 0;
let startedOutsideCrossing = 0;
let nearTracksWithTrail = 0;
let noCrossSamples = [];
const dailyPerimeter = new Map();

for (const { track_key: trackKey } of nearTracks) {
  const rows = loadPositions.all(VENUE_ID, trackKey, startTs, now);
  if (rows.length < 2) continue;
  nearTracksWithTrail++;

  const points = rows.map((r) => ({ t: r.timestamp, x: r.position_x, z: r.position_z }));
  const first = points[0];
  const result = trailCrossesPerimeter(points, verts, edges);
  if (!result.crosses) {
    if (noCrossSamples.length < 5) {
      noCrossSamples.push({ trackKey, pts: points.length, bornInside: inPoly(first.x, first.z, verts) });
    }
    continue;
  }

  const crossTs = result.at ?? first.t;
  if (STORE_HOURS && !inStoreHours(crossTs)) continue;

  perimeterCrossingTracks++;
  perimeterCrossingEvents += result.events || 1;
  if (inPoly(first.x, first.z, verts)) bornInsideCrossing++;
  else startedOutsideCrossing++;

  const day = new Date(crossTs).toLocaleDateString('en-CA', { timeZone: TZ });
  dailyPerimeter.set(day, (dailyPerimeter.get(day) || 0) + 1);
}

// Hybrid: augment sparse trails with gate zone_visits entry/exit coordinates
const gateVisits = db.prepare(`
  SELECT track_key, start_time, end_time, entry_position_x, entry_position_z, exit_position_x, exit_position_z
  FROM zone_visits
  WHERE venue_id = ? AND roi_id = ?
    AND start_time >= ? AND start_time < ?
    AND track_key NOT LIKE '%cashier%'
  ORDER BY track_key, start_time
`).all(VENUE_ID, GATE_ROI_ID, startTs, now);

const visitsByTrack = new Map();
for (const v of gateVisits) {
  if (!visitsByTrack.has(v.track_key)) visitsByTrack.set(v.track_key, []);
  visitsByTrack.get(v.track_key).push(v);
}

let hybridCrossingTracks = 0;
const hybridDaily = new Map();
const hybridTracks = new Set();

for (const [trackKey, visits] of visitsByTrack) {
  const rows = loadPositions.all(VENUE_ID, trackKey, startTs, now);
  const extra = [];
  for (const v of visits) {
    if (Number.isFinite(v.entry_position_x) && Number.isFinite(v.entry_position_z)) {
      extra.push({ t: v.start_time, x: v.entry_position_x, z: v.entry_position_z });
    }
    if (Number.isFinite(v.exit_position_x) && Number.isFinite(v.exit_position_z) && v.end_time) {
      extra.push({ t: v.end_time, x: v.exit_position_x, z: v.exit_position_z });
    }
  }
  const merged = [...rows.map((r) => ({ t: r.timestamp, x: r.position_x, z: r.position_z })), ...extra]
    .sort((a, b) => a.t - b.t);
  // de-dupe near-identical timestamps
  const points = [];
  for (const p of merged) {
    const last = points[points.length - 1];
    if (last && Math.abs(p.t - last.t) < 50 && Math.hypot(p.x - last.x, p.z - last.z) < 0.05) continue;
    points.push(p);
  }
  if (points.length < 2) continue;
  const result = trailCrossesPerimeter(points, verts, edges);
  if (!result.crosses) continue;
  const crossTs = result.at ?? points[0].t;
  if (STORE_HOURS && !inStoreHours(crossTs)) continue;
  if (hybridTracks.has(trackKey)) continue;
  hybridTracks.add(trackKey);
  hybridCrossingTracks++;
  const day = new Date(crossTs).toLocaleDateString('en-CA', { timeZone: TZ });
  hybridDaily.set(day, (hybridDaily.get(day) || 0) + 1);
}

// Also scan ALL tracks with any position in window (broader — slower)
const allTrackCount = db.prepare(`
  SELECT COUNT(DISTINCT track_key) c FROM track_positions
  WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
    AND track_key NOT LIKE '%cashier%'
`).get(VENUE_ID, startTs, now);

const tpStats = db.prepare(`
  SELECT COUNT(*) c, COUNT(DISTINCT track_key) u
  FROM track_positions
  WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
`).get(VENUE_ID, startTs, now);

const daily = db.prepare(`
  SELECT date(timestamp/1000, 'unixepoch', 'localtime') d,
         COUNT(DISTINCT track_key) tracks
  FROM track_positions
  WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
    AND position_x BETWEEN ? AND ? AND position_z BETWEEN ? AND ?
  GROUP BY d ORDER BY d
`).all(VENUE_ID, startTs, now, bbox.x0 - pad, bbox.x1 + pad, bbox.z0 - pad, bbox.z1 + pad);

db.close();

const report = {
  rule: 'trail_crosses_at_least_one_perimeter_edge',
  venueId: VENUE_ID,
  gate: { id: gate.id, name: gate.name, bbox, vertices: verts },
  window: {
    days: DAYS,
    start: new Date(startTs).toISOString(),
    end: new Date(now).toISOString(),
    storeHoursFilter: STORE_HOURS ? `${OPEN_H}:00-${CLOSE_H}:00 ${TZ}` : 'none',
  },
  dataCoverage: {
    trackPositionRows: tpStats.c,
    distinctTracksAll: allTrackCount.c,
    distinctTracksNearGate: nearTracks.length,
    tracksWithTrail2Plus: nearTracksWithTrail,
  },
  counts: {
    perimeterCrossingTracks,
    perimeterCrossingEvents,
    hybridPerimeterCrossingTracks: hybridCrossingTracks,
    bornInsideThenCrossed: bornInsideCrossing,
    startedOutsideThenCrossed: startedOutsideCrossing,
    current_zone_visits_crossings: current.crossings,
    current_zone_visits_uniqueTracks: current.uniqueTracks,
    current_zone_visits_5s_plus: currentRecovery.crossings,
  },
  dailyPerimeterCrossings: Object.fromEntries([...dailyPerimeter.entries()].sort()),
  dailyHybridPerimeterCrossings: Object.fromEntries([...hybridDaily.entries()].sort()),
  delta: {
    vs_zone_visits_crossings: perimeterCrossingTracks - current.crossings,
    vs_zone_visits_unique: perimeterCrossingTracks - current.uniqueTracks,
    pct_of_current_crossings: current.crossings > 0
      ? Math.round((perimeterCrossingTracks / current.crossings) * 1000) / 10
      : null,
  },
  dailyNearGateTracks: daily,
  sampleNoCross: noCrossSamples,
};

console.log(JSON.stringify(report, null, 2));
