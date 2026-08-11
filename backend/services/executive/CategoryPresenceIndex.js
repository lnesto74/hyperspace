/**
 * Category dwell + shelf engagement from geometry, not polygon chop alone.
 *
 * For each fresco department (union of its ROIs):
 *   engagement  — d ≤ engagementRadiusM (or inside ROI), episodic
 *   category dwell — d ≤ categoryDwellRadiusM, with gap + optional stitch
 *
 * Identity defaults to original_perception_id (raw) so luca over-merges do not
 * inflate clocks. Switchable to track_key via category_presence.identityMode.
 */

import {
  DEFAULT_CATEGORY_PRESENCE_CONFIG,
  loadCategoryPresenceConfigFromTransformJson,
} from '../../config/categoryPresenceConfig.js';

function parseJson(raw, fallback) {
  try {
    return JSON.parse(raw ?? '');
  } catch {
    return fallback;
  }
}

function pointInPoly(x, z, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x; const zi = poly[i].z;
    const xj = poly[j].x; const zj = poly[j].z;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-18) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function distToSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax; const dz = bz - az;
  if (dx === 0 && dz === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function distToPoly(x, z, poly) {
  if (pointInPoly(x, z, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    best = Math.min(best, distToSeg(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

function distToUnion(x, z, polys) {
  let best = Infinity;
  for (const poly of polys) {
    const d = distToPoly(x, z, poly);
    if (d === 0) return 0;
    if (d < best) best = d;
  }
  return best;
}

function loadRoiPolys(db, venueId, roiIds) {
  if (!roiIds.length) return [];
  const ph = roiIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT id, vertices FROM regions_of_interest
    WHERE venue_id = ? AND id IN (${ph})
  `).all(venueId, ...roiIds);
  const polys = [];
  for (const r of rows) {
    const verts = parseJson(r.vertices, null);
    if (!Array.isArray(verts) || verts.length < 3) continue;
    const poly = verts.map((v) => ({
      x: Number(v.x ?? v[0]),
      z: Number(v.z ?? v.y ?? v[1]),
    })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

function polyBBox(polys, pad) {
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const poly of polys) {
    for (const p of poly) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return {
    minX: minX - pad, maxX: maxX + pad,
    minZ: minZ - pad, maxZ: maxZ + pad,
  };
}

/**
 * Extract episodes from a time series of {t, inside} with gap hysteresis.
 * stitchS merges consecutive episodes whose gap is shorter.
 */
function extractEpisodes(samples, gapS, minS, stitchS = 0) {
  const episodes = [];
  let open = null; // { t0, lastIn }
  let gapStart = null;

  const close = (t1) => {
    if (!open) return;
    const dur = (t1 - open.t0) / 1000;
    if (dur >= minS) episodes.push({ t0: open.t0, t1, durationS: dur });
    open = null;
    gapStart = null;
  };

  for (const s of samples) {
    if (s.inside) {
      if (!open) open = { t0: s.t, lastIn: s.t };
      else open.lastIn = s.t;
      gapStart = null;
    } else if (open) {
      if (gapStart == null) gapStart = s.t;
      if ((s.t - gapStart) / 1000 >= gapS) close(open.lastIn);
    }
  }
  if (open) close(open.lastIn);

  if (!stitchS || episodes.length < 2) return episodes;
  const merged = [episodes[0]];
  for (let i = 1; i < episodes.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = episodes[i];
    if ((cur.t0 - prev.t1) / 1000 <= stitchS) {
      prev.t1 = cur.t1;
      prev.durationS = (prev.t1 - prev.t0) / 1000;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx];
}

function summarizeEpisodes(episodes) {
  if (!episodes.length) {
    return {
      episodes: 0, meanSec: 0, medianSec: 0, p75Sec: 0, totalSec: 0, reliable: false,
    };
  }
  const durs = episodes.map((e) => e.durationS).sort((a, b) => a - b);
  const totalSec = durs.reduce((s, v) => s + v, 0);
  return {
    episodes: episodes.length,
    meanSec: totalSec / durs.length,
    medianSec: percentile(durs, 0.5),
    p75Sec: percentile(durs, 0.75),
    totalSec,
    reliable: episodes.length >= 15,
  };
}

const EMPTY_SUMMARY = Object.freeze({
  episodes: 0, meanSec: 0, medianSec: 0, p75Sec: 0, totalSec: 0, reliable: false,
});

const EMPTY = Object.freeze({
  /** All 2 m halo episodes (including aisle grazes). */
  dwell: { ...EMPTY_SUMMARY },
  /**
   * Category dwell among stops only — a stop is a dwell episode that reached
   * the shelf face (engagement radius / inside ROI) at least once.
   */
  dwellAmongEngaged: { ...EMPTY_SUMMARY },
  engagement: { ...EMPTY_SUMMARY },
  /** % of category-dwell episodes that reached engagement. */
  stoppingEngPct: null,
  identityMode: 'raw',
  sampleTracks: 0,
});

/**
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.db
 * @param {string} opts.venueId
 * @param {number} opts.startTs
 * @param {number} opts.endTs
 * @param {Array<{ key: string, roiIds: string[] }>} opts.departments
 * @param {object} [opts.config]
 */
export function buildCategoryPresenceIndex({
  db, venueId, startTs, endTs, departments, config,
}) {
  const cfg = { ...DEFAULT_CATEGORY_PRESENCE_CONFIG, ...(config || {}) };
  const idCol = cfg.identityMode === 'track_key' ? 'track_key' : 'original_perception_id';
  const byDept = new Map();

  for (const dept of departments) {
    const polys = loadRoiPolys(db, venueId, dept.roiIds || []);
    if (!polys.length) {
      byDept.set(dept.key, { ...EMPTY, identityMode: cfg.identityMode });
      continue;
    }
    const bbox = polyBBox(polys, cfg.categoryDwellRadiusM + 0.5);
    if (!bbox) {
      byDept.set(dept.key, { ...EMPTY, identityMode: cfg.identityMode });
      continue;
    }

    // Pull samples in the dilated bbox. Identity nulls are skipped.
    const rows = db.prepare(`
      SELECT ${idCol} AS id, timestamp AS t, position_x AS x, position_z AS z
      FROM track_positions
      WHERE venue_id = ?
        AND timestamp >= ? AND timestamp < ?
        AND ${idCol} IS NOT NULL AND ${idCol} != ''
        AND position_x BETWEEN ? AND ?
        AND position_z BETWEEN ? AND ?
      ORDER BY ${idCol}, timestamp
    `).all(venueId, startTs, endTs, bbox.minX, bbox.maxX, bbox.minZ, bbox.maxZ);

    const byId = new Map();
    for (const r of rows) {
      let arr = byId.get(r.id);
      if (!arr) { arr = []; byId.set(r.id, arr); }
      arr.push(r);
    }

    const dwellEps = [];
    const engEps = [];
    let sampleTracks = 0;

    for (const samples of byId.values()) {
      if (samples.length < 2) continue;
      const series = [];
      for (const s of samples) {
        const d = distToUnion(s.x, s.z, polys);
        series.push({
          t: s.t,
          d,
          inDwell: d <= cfg.categoryDwellRadiusM,
          inEng: d <= cfg.engagementRadiusM,
        });
      }
      // Skip tracks that never entered the dwell halo
      if (!series.some((s) => s.inDwell)) continue;
      sampleTracks += 1;

      const dwellSeries = series.map((s) => ({ t: s.t, inside: s.inDwell }));
      const engSeries = series.map((s) => ({ t: s.t, inside: s.inEng }));

      for (const e of extractEpisodes(dwellSeries, cfg.dwellGapS, cfg.dwellMinDurationS, cfg.dwellStitchS)) {
        // Stop = this category-dwell visit reached the shelf face at least once.
        e.hadEng = series.some((s) => s.inEng && s.t >= e.t0 && s.t <= e.t1);
        dwellEps.push(e);
      }
      for (const e of extractEpisodes(engSeries, cfg.engagementGapS, cfg.engagementMinDurationS, 0)) {
        engEps.push(e);
      }
    }

    const engagedDwell = dwellEps.filter((e) => e.hadEng);
    const stoppingEngPct = dwellEps.length
      ? Math.round((engagedDwell.length / dwellEps.length) * 1000) / 10
      : null;

    byDept.set(dept.key, {
      dwell: summarizeEpisodes(dwellEps),
      dwellAmongEngaged: summarizeEpisodes(engagedDwell),
      engagement: summarizeEpisodes(engEps),
      stoppingEngPct,
      identityMode: cfg.identityMode,
      sampleTracks,
      config: {
        categoryDwellRadiusM: cfg.categoryDwellRadiusM,
        engagementRadiusM: cfg.engagementRadiusM,
        dwellGapS: cfg.dwellGapS,
        dwellStitchS: cfg.dwellStitchS,
      },
    });
  }

  return {
    config: cfg,
    statsFor(deptKey) {
      return byDept.get(deptKey) || { ...EMPTY, identityMode: cfg.identityMode };
    },
  };
}

export function loadCategoryPresenceConfigForVenue(db, venueId) {
  try {
    const row = db.prepare('SELECT dwg_transform_json FROM venues WHERE id = ?').get(venueId);
    return loadCategoryPresenceConfigFromTransformJson(row?.dwg_transform_json);
  } catch {
    return { ...DEFAULT_CATEGORY_PRESENCE_CONFIG };
  }
}
