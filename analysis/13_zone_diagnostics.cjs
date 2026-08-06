/**
 * Per-zone KPIs with the one measurement that separates a zone problem from a
 * perception problem: how far people actually travelled inside the zone.
 *
 * Dwell alone cannot tell those apart. A zone showing 3 s of dwell might be a
 * corridor nobody stops in, or a counter where the tracker keeps losing people.
 * Path length distinguishes them:
 *
 *   short dwell + near-zero path   → the track died on arrival (perception)
 *   short dwell + long path        → walked straight through (genuine transit)
 *   long dwell  + short path       → browsing, working as intended
 *   any dwell   + impossible speed → identity swap (perception)
 *
 * Path is summed between consecutive stored samples for one track inside one
 * zone. Sampling is every ~3 s per track, so this is a lower bound on the true
 * path — it chords the corners. That is fine for comparing zones against each
 * other and against themselves on a different day, which is all it is used for.
 *
 * The comparison day matters more than any single number. Running the same
 * zones on a reconciler-off day and a reconciler-on day holds the store, the
 * sensors, the vendor build and the geometry fixed, so whatever moves is the
 * reconciliation layer and not the zone.
 *
 * Usage: node 13_zone_diagnostics.cjs --days 2026-08-04,2026-08-06 [--out FILE]
 */
const fs = require('fs');

function loadSqlite() {
  for (const base of ['better-sqlite3', '/app/node_modules/better-sqlite3']) {
    try { return require(base); } catch { /* try next */ }
  }
  throw new Error('better-sqlite3 not found');
}

const args = process.argv.slice(2);
const argVal = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const VENUE = argVal('--venue', '55fdd53b-3298-4355-97c0-b4e789b11d06');
const DB_PATH = argVal('--db', '/data/db/hyperspace.db');
const DAYS = argVal('--days', '').split(',').filter(Boolean);
const OUT = argVal('--out', null);
const TZ_OFF_H = Number(argVal('--tz-offset', 2));

const Database = loadSqlite();
const db = new Database(DB_PATH, { readonly: true });

const dayBounds = (d) => {
  const start = Date.parse(`${d}T00:00:00Z`) - TZ_OFF_H * 3600e3;
  return [start, start + 86400e3];
};

/** Polygon area via the shoelace formula; vertices are {x, z} in metres. */
function polygonArea(verts) {
  if (!Array.isArray(verts) || verts.length < 3) return null;
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i], q = verts[(i + 1) % verts.length];
    const px = p.x ?? p[0], pz = p.z ?? p.y ?? p[1];
    const qx = q.x ?? q[0], qz = q.z ?? q.y ?? q[1];
    if (![px, pz, qx, qz].every(Number.isFinite)) return null;
    a += px * qz - qx * pz;
  }
  return Math.abs(a) / 2;
}

// ------------------------------------------------------------------ zone names
const zones = new Map();
for (const r of db.prepare(`
  SELECT id, name, vertices, metadata_json FROM regions_of_interest WHERE venue_id = ?
`).all(VENUE)) {
  let meta = {}; let verts = null;
  try { meta = JSON.parse(r.metadata_json || '{}'); } catch { /* ignore */ }
  try { verts = JSON.parse(r.vertices || 'null'); } catch { /* ignore */ }
  const area = polygonArea(verts);
  zones.set(r.id, {
    id: r.id,
    name: r.name,
    category: meta.business_category_label || null,
    template: meta.template || null,
    area_m2: area != null ? +area.toFixed(1) : null,
    // Typical straight crossing of a zone of this size — the yardstick path
    // length is judged against.
    span_m: area != null ? +Math.sqrt(area).toFixed(1) : null,
  });
}

// Fill missing categories from the linked shelf fixture, the same chain the
// reporting layer uses.
const objStmt = db.prepare('SELECT metadata_json FROM venue_objects WHERE id = ?');
for (const [id, z] of zones) {
  if (z.category) continue;
  try {
    const row = db.prepare('SELECT metadata_json FROM regions_of_interest WHERE id = ?').get(id);
    const meta = JSON.parse(row?.metadata_json || '{}');
    if (meta.shelfId) {
      const o = objStmt.get(meta.shelfId);
      const om = JSON.parse(o?.metadata_json || '{}');
      z.category = om.business_category_label || null;
    }
  } catch { /* leave null */ }
}

// --------------------------------------------------------------- per-day stats
const result = { venue: VENUE, generated: new Date().toISOString(), days: {} };

for (const day of DAYS) {
  const [from, to] = dayBounds(day);

  const visits = db.prepare(`
    SELECT roi_id,
           COUNT(*) visits,
           COUNT(DISTINCT track_key) identities,
           AVG(duration_ms) mean_ms,
           SUM(CASE WHEN duration_ms = 0 THEN 1 ELSE 0 END) zero_visits,
           SUM(CASE WHEN duration_ms >= 60000 THEN 1 ELSE 0 END) over60s
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ?
    GROUP BY roi_id
  `).all(VENUE, from, to);

  const medianStmt = db.prepare(`
    SELECT duration_ms FROM zone_visits
    WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND start_time < ?
    ORDER BY duration_ms
    LIMIT 1 OFFSET (
      SELECT COUNT(*) / 2 FROM zone_visits
      WHERE venue_id = ? AND roi_id = ? AND start_time >= ? AND start_time < ?
    )
  `);

  // Path travelled per (track, zone), summed between consecutive samples.
  const paths = new Map(); // roi_id -> { pathTotal, dispTotal, n, single }
  const rows = db.prepare(`
    SELECT track_key, roi_id, timestamp, position_x, position_z
    FROM track_positions
    WHERE venue_id = ? AND timestamp >= ? AND timestamp < ? AND roi_id IS NOT NULL
    ORDER BY track_key, roi_id, timestamp
  `).iterate(VENUE, from, to);

  let curKey = null, curRoi = null, first = null, last = null, path = 0, samples = 0;
  const closeRun = () => {
    if (!curRoi || samples === 0) return;
    let e = paths.get(curRoi);
    if (!e) { e = { pathTotal: 0, dispTotal: 0, n: 0, single: 0, samplesTotal: 0 }; paths.set(curRoi, e); }
    e.n++;
    e.samplesTotal += samples;
    e.pathTotal += path;
    e.dispTotal += Math.hypot(last.x - first.x, last.z - first.z);
    if (samples === 1) e.single++;
  };

  for (const r of rows) {
    if (r.track_key !== curKey || r.roi_id !== curRoi) {
      closeRun();
      curKey = r.track_key; curRoi = r.roi_id;
      first = { x: r.position_x, z: r.position_z };
      last = first; path = 0; samples = 1;
      continue;
    }
    path += Math.hypot(r.position_x - last.x, r.position_z - last.z);
    last = { x: r.position_x, z: r.position_z };
    samples++;
  }
  closeRun();

  const zoneRows = [];
  for (const v of visits) {
    const z = zones.get(v.roi_id) || { id: v.roi_id, name: null, category: null, area_m2: null, span_m: null };
    const med = medianStmt.get(VENUE, v.roi_id, from, to, VENUE, v.roi_id, from, to)?.duration_ms ?? 0;
    const p = paths.get(v.roi_id);
    const meanPath = p && p.n ? p.pathTotal / p.n : null;
    const meanDisp = p && p.n ? p.dispTotal / p.n : null;
    const meanDwellS = v.mean_ms / 1000;
    zoneRows.push({
      roi_id: v.roi_id,
      name: z.name,
      category: z.category,
      template: z.template,
      area_m2: z.area_m2,
      span_m: z.span_m,
      visits: v.visits,
      identities: v.identities,
      mean_dwell_s: +meanDwellS.toFixed(1),
      median_dwell_s: +(med / 1000).toFixed(1),
      zero_pct: +(100 * v.zero_visits / v.visits).toFixed(1),
      over60s_pct: +(100 * v.over60s / v.visits).toFixed(1),
      mean_path_m: meanPath != null ? +meanPath.toFixed(2) : null,
      mean_disp_m: meanDisp != null ? +meanDisp.toFixed(2) : null,
      mean_samples: p && p.n ? +(p.samplesTotal / p.n).toFixed(1) : null,
      single_sample_pct: p && p.n ? +(100 * p.single / p.n).toFixed(1) : null,
      // Path over dwell. Above walking pace inside a browsing zone means the
      // identity jumped rather than the person moved.
      implied_speed_ms: meanPath != null && meanDwellS > 0.5 ? +(meanPath / meanDwellS).toFixed(2) : null,
      // How much of a typical crossing the track actually covered before it
      // was lost. Well below 1 means tracks do not survive the zone.
      path_vs_span: meanPath != null && z.span_m ? +(meanPath / z.span_m).toFixed(2) : null,
    });
  }

  zoneRows.sort((a, b) => b.visits - a.visits);
  result.days[day] = {
    totals: {
      zones: zoneRows.length,
      visits: zoneRows.reduce((s, r) => s + r.visits, 0),
      identities: db.prepare(`SELECT COUNT(DISTINCT track_key) n FROM zone_visits
        WHERE venue_id=? AND start_time>=? AND start_time<?`).get(VENUE, from, to).n,
      mean_dwell_s: +(db.prepare(`SELECT AVG(duration_ms) m FROM zone_visits
        WHERE venue_id=? AND start_time>=? AND start_time<?`).get(VENUE, from, to).m / 1000).toFixed(1),
    },
    zones: zoneRows,
  };
}

const json = JSON.stringify(result, null, 2);
if (OUT) { fs.writeFileSync(OUT, json); console.log(`written ${OUT}`); }
else console.log(json);
db.close();
