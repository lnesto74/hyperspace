/**
 * Sample tracks that touched a fresco (business-category) ROI for visual
 * benchmarking on the floorplan wireframe.
 *
 * Modes:
 *   reconciled — stable track_key from the live luca reconciler (+ raw fragments)
 *   raw        — vendor original_perception_id only (no merge), long continuous paths
 */

function parse(json, fallback) {
  try {
    return JSON.parse(json ?? '');
  } catch {
    return fallback;
  }
}

function normalizeLabel(s) {
  return String(s || '').trim().toLowerCase();
}

function loadCategoryRois(db, venueId) {
  const objStmt = db.prepare('SELECT metadata_json FROM venue_objects WHERE id = ?');
  const byCategory = new Map();

  for (const r of db.prepare(
    'SELECT id, name, vertices, metadata_json FROM regions_of_interest WHERE venue_id = ?',
  ).all(venueId)) {
    const meta = parse(r.metadata_json, {}) || {};
    let category = meta.business_category_label || meta.business_category || null;
    if (!category && meta.shelfId) {
      const om = parse(objStmt.get(meta.shelfId)?.metadata_json, {}) || {};
      category = om.business_category_label || om.business_category || null;
    }
    if (!category) continue;
    const verts = parse(r.vertices, null);
    if (!Array.isArray(verts) || verts.length < 3) continue;
    const vertices = verts.map((v) => ({
      x: Number(v.x ?? v[0]),
      z: Number(v.z ?? v.y ?? v[1]),
    })).filter((v) => Number.isFinite(v.x) && Number.isFinite(v.z));
    if (vertices.length < 3) continue;
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ id: r.id, name: r.name, vertices });
  }
  return byCategory;
}

function resolveCategory(byCategory, category) {
  if (!category) return null;
  const want = normalizeLabel(category);
  for (const [label, rois] of byCategory) {
    if (normalizeLabel(label) === want) return { label, rois };
  }
  for (const [label, rois] of byCategory) {
    if (normalizeLabel(label).includes(want) || want.includes(normalizeLabel(label))) {
      return { label, rois };
    }
  }
  return null;
}

function downsample(points, maxPts = 400) {
  if (points.length <= maxPts) return points;
  const step = Math.ceil(points.length / maxPts);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function pathQuality(rows, jumpDistM = 5.0, jumpSpeed = 2.0) {
  let maxJumpM = 0;
  let suspectJumps = 0;
  let spanM = 0;
  if (!rows.length) return { maxJumpM, suspectJumps, spanM, plausible: false };
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const p = rows[i];
    const x = p.position_x ?? p.x;
    const z = p.position_z ?? p.z;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    if (i === 0) continue;
    const a = rows[i - 1];
    const ax = a.position_x ?? a.x; const az = a.position_z ?? a.z;
    const at = a.timestamp ?? a.t; const bt = p.timestamp ?? p.t;
    const dt = (bt - at) / 1000;
    const dist = Math.hypot(x - ax, z - az);
    if (dist > maxJumpM) maxJumpM = dist;
    if (dist > jumpDistM || (dt > 0.05 && dist / dt > jumpSpeed)) suspectJumps += 1;
  }
  spanM = Math.hypot(maxX - minX, maxZ - minZ);
  return {
    maxJumpM: Math.round(maxJumpM * 10) / 10,
    suspectJumps,
    spanM: Math.round(spanM * 10) / 10,
    plausible: spanM <= 15 && suspectJumps === 0,
  };
}

const mean = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);

export default class LiveTrackSampleService {
  constructor({ db }) {
    this.db = db;
  }

  listCategories(venueId) {
    const byCategory = loadCategoryRois(this.db, venueId);
    return [...byCategory.keys()].sort((a, b) => a.localeCompare(b));
  }

  /**
   * @param {{ venueId: string, category: string, start: number, end: number, limit?: number, sort?: string, mode?: 'reconciled'|'raw' }} opts
   */
  getSamples(opts) {
    const mode = opts.mode === 'raw' ? 'raw' : 'reconciled';
    return mode === 'raw' ? this._getRawSamples(opts) : this._getReconciledSamples(opts);
  }

  _resolveContext(opts) {
    const venueId = opts.venueId;
    const start = Number(opts.start);
    const end = Number(opts.end);
    const limit = Math.min(40, Math.max(1, Number(opts.limit) || 12));
    const sort = opts.sort || 'longest';

    if (!venueId) throw new Error('venueId required');
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error('valid start/end timestamps required');
    }

    const byCategory = loadCategoryRois(this.db, venueId);
    const categories = [...byCategory.keys()].sort((a, b) => a.localeCompare(b));
    const resolved = resolveCategory(byCategory, opts.category);
    return { venueId, start, end, limit, sort, categories, resolved };
  }

  /** Vendor original_perception_id paths that touched the ROI — no reconciler merge. */
  _getRawSamples(opts) {
    const { venueId, start, end, limit, sort, categories, resolved } = this._resolveContext(opts);
    if (!resolved) {
      return {
        venueId, start, end, mode: 'raw', category: opts.category || null,
        categories, rois: [], samples: [],
        error: `Unknown category. Try one of: ${categories.slice(0, 12).join(', ')}`,
      };
    }

    const roiIds = resolved.rois.map((r) => r.id);
    const placeholders = roiIds.map(() => '?').join(',');
    // Prefer long, continuous vendor tracks (not chopped single blips).
    const minLifeMs = 15_000;
    const minPts = 5;

    const orderSql =
      sort === 'recent' ? 't1 DESC'
        : sort === 'chopped' ? 'life_ms ASC'
          : 'life_ms DESC';

    const ranked = this.db.prepare(`
      WITH candidates AS (
        SELECT original_perception_id AS raw_id,
               MIN(timestamp) AS t0,
               MAX(timestamp) AS t1,
               (MAX(timestamp) - MIN(timestamp)) AS life_ms,
               COUNT(*) AS n,
               SUM(CASE WHEN roi_id IN (${placeholders}) THEN 1 ELSE 0 END) AS in_roi_hits
        FROM track_positions
        WHERE venue_id = ?
          AND timestamp >= ? AND timestamp < ?
          AND original_perception_id IS NOT NULL
          AND original_perception_id != ''
        GROUP BY original_perception_id
        HAVING in_roi_hits >= 1 AND n >= ? AND life_ms >= ?
      )
      SELECT raw_id AS rawId, t0, t1, life_ms AS lifeMs, n AS nPts, in_roi_hits AS inRoiHits
      FROM candidates
      ORDER BY ${orderSql}
      LIMIT ?
    `).all(...roiIds, venueId, start, end, minPts, minLifeMs, Math.max(limit * 6, 120));

    const touchersCountRow = this.db.prepare(`
      SELECT COUNT(DISTINCT original_perception_id) AS c
      FROM track_positions
      WHERE venue_id = ?
        AND timestamp >= ? AND timestamp < ?
        AND original_perception_id IS NOT NULL
        AND roi_id IN (${placeholders})
    `).get(venueId, start, end, ...roiIds);
    const touchersCount = touchersCountRow?.c || 0;

    if (!ranked.length) {
      return {
        venueId, start, end, mode: 'raw',
        category: resolved.label,
        categories, rois: resolved.rois, samples: [],
        stats: { touchers: touchersCount },
      };
    }

    const posStmt = this.db.prepare(`
      SELECT timestamp, position_x, position_z, roi_id
      FROM track_positions
      WHERE venue_id = ? AND original_perception_id = ?
        AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    // Build samples, then prefer "not chopped" = no suspect jumps / modest span.
    const built = [];
    for (const row of ranked) {
      const rows = posStmt.all(venueId, row.rawId, row.t0, row.t1);
      if (rows.length < minPts) continue;
      const q = pathQuality(rows);
      // Estimate in-ROI time from consecutive samples that sit inside a category ROI.
      let inRoiMs = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i - 1].roi_id && roiIds.includes(rows[i - 1].roi_id)) {
          inRoiMs += Math.max(0, rows[i].timestamp - rows[i - 1].timestamp);
        }
      }
      const path = downsample(rows.map((p) => ({
        t: p.timestamp,
        x: p.position_x,
        z: p.position_z,
        inRoi: !!(p.roi_id && roiIds.includes(p.roi_id)),
      })));
      built.push({
        trackKey: row.rawId,
        rawId: row.rawId,
        durationS: Math.round(row.lifeMs) / 1000,
        inRoiDurationS: Math.round(inRoiMs) / 1000,
        episodes: 1,
        rawIdCount: 1,
        t0: row.t0,
        t1: row.t1,
        chopFactor: inRoiMs > 0 ? Math.round((row.lifeMs / inRoiMs) * 10) / 10 : null,
        maxJumpM: q.maxJumpM,
        spanM: q.spanM,
        suspectJumps: q.suspectJumps,
        plausible: q.plausible,
        reconciledPath: path,
        rawPaths: { [row.rawId]: path },
      });
    }

    // For "longest" raw view: show continuous long tracks first (plausible before junk).
    if (sort === 'longest') {
      built.sort((a, b) => {
        if (a.plausible !== b.plausible) return a.plausible ? -1 : 1;
        return b.durationS - a.durationS;
      });
    } else if (sort === 'chopped') {
      built.sort((a, b) => a.durationS - b.durationS);
    } else {
      built.sort((a, b) => b.t1 - a.t1);
    }

    const samples = built.slice(0, limit);

    return {
      venueId,
      start,
      end,
      mode: 'raw',
      category: resolved.label,
      categories,
      rois: resolved.rois,
      samples,
      stats: {
        touchers: touchersCount,
        ranked: built.length,
        returned: samples.length,
        meanTrackLifeS: Math.round(mean(samples.map((s) => s.durationS)) * 10) / 10,
        meanInRoiS: Math.round(mean(samples.map((s) => s.inRoiDurationS)) * 10) / 10,
        meanRawIds: 1,
        plausibleShare: samples.length
          ? Math.round((samples.filter((s) => s.plausible).length / samples.length) * 100)
          : 0,
      },
    };
  }

  _getReconciledSamples(opts) {
    const { venueId, start, end, limit, sort, categories, resolved } = this._resolveContext(opts);
    if (!resolved) {
      return {
        venueId, start, end, mode: 'reconciled', category: opts.category || null,
        categories, rois: [], samples: [],
        error: `Unknown category. Try one of: ${categories.slice(0, 12).join(', ')}`,
      };
    }

    const roiIds = resolved.rois.map((r) => r.id);
    const placeholders = roiIds.map(() => '?').join(',');
    const pad = 60_000;
    const lifeLo = start - pad;
    const lifeHi = end + pad;

    const orderSql =
      sort === 'chopped' ? '(life_ms * 1.0 / NULLIF(in_roi_ms, 0)) DESC, life_ms DESC'
        : sort === 'recent' ? 't1 DESC'
          : 'life_ms DESC';

    const ranked = this.db.prepare(`
      WITH touchers AS (
        SELECT track_key,
               SUM(COALESCE(duration_ms, 0)) AS in_roi_ms,
               MIN(start_time) AS first_touch,
               MAX(end_time) AS last_touch,
               COUNT(*) AS episodes
        FROM zone_visits
        WHERE venue_id = ?
          AND roi_id IN (${placeholders})
          AND start_time >= ? AND start_time < ?
          AND track_key IS NOT NULL
        GROUP BY track_key
      ),
      life AS (
        SELECT t.track_key,
               t.in_roi_ms,
               t.first_touch,
               t.last_touch,
               t.episodes,
               MIN(p.timestamp) AS t0,
               MAX(p.timestamp) AS t1,
               (MAX(p.timestamp) - MIN(p.timestamp)) AS life_ms,
               COUNT(*) AS n,
               COUNT(DISTINCT p.original_perception_id) AS raw_n
        FROM touchers t
        JOIN track_positions p
          ON p.venue_id = ?
         AND p.track_key = t.track_key
         AND p.timestamp >= ?
         AND p.timestamp <= ?
        GROUP BY t.track_key
        HAVING n >= 2
      )
      SELECT track_key AS trackKey, in_roi_ms AS inRoiMs, episodes,
             first_touch AS firstTouch, last_touch AS lastTouch,
             t0, t1, life_ms AS lifeMs, raw_n AS rawN, n AS nPts
      FROM life
      ORDER BY ${orderSql}
      LIMIT ?
    `).all(venueId, ...roiIds, start, end, venueId, lifeLo, lifeHi, Math.max(limit * 4, 80));

    const touchersCountRow = this.db.prepare(`
      SELECT COUNT(DISTINCT track_key) AS c
      FROM zone_visits
      WHERE venue_id = ?
        AND roi_id IN (${placeholders})
        AND start_time >= ? AND start_time < ?
        AND track_key IS NOT NULL
    `).get(venueId, ...roiIds, start, end);
    const touchersCount = touchersCountRow?.c || 0;

    if (!ranked.length) {
      return {
        venueId, start, end, mode: 'reconciled',
        category: resolved.label,
        categories, rois: resolved.rois, samples: [],
        stats: { touchers: touchersCount },
      };
    }

    const withChop = ranked.map((t) => {
      const inRoiMs = Number(t.inRoiMs) || 0;
      const lifeMs = Number(t.lifeMs) || 0;
      return { ...t, inRoiMs, lifeMs, chop: inRoiMs > 0 ? lifeMs / inRoiMs : lifeMs };
    });
    const picked = withChop.slice(0, limit);
    const posStmt = this.db.prepare(`
      SELECT timestamp, position_x, position_z, original_perception_id, roi_id
      FROM track_positions
      WHERE venue_id = ? AND track_key = ?
        AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    const samples = picked.map((row) => {
      const rows = posStmt.all(venueId, row.trackKey, row.t0, row.t1);
      const reconciled = downsample(rows.map((p) => ({
        t: p.timestamp,
        x: p.position_x,
        z: p.position_z,
        inRoi: !!(p.roi_id && roiIds.includes(p.roi_id)),
      })));

      const byRaw = new Map();
      for (const p of rows) {
        const id = p.original_perception_id || '_unknown';
        if (!byRaw.has(id)) byRaw.set(id, []);
        byRaw.get(id).push({ t: p.timestamp, x: p.position_x, z: p.position_z });
      }
      const rawPaths = {};
      for (const [id, pts] of byRaw) {
        rawPaths[id] = downsample(pts);
      }

      const q = pathQuality(rows);

      return {
        trackKey: row.trackKey,
        durationS: Math.round(row.lifeMs) / 1000,
        inRoiDurationS: Math.round(row.inRoiMs) / 1000,
        episodes: row.episodes,
        rawIdCount: row.rawN || Object.keys(rawPaths).length,
        t0: row.t0,
        t1: row.t1,
        chopFactor: Math.round(row.chop * 10) / 10,
        maxJumpM: q.maxJumpM,
        spanM: q.spanM,
        suspectJumps: q.suspectJumps,
        plausible: q.plausible,
        reconciledPath: reconciled,
        rawPaths,
      };
    });

    return {
      venueId,
      start,
      end,
      mode: 'reconciled',
      category: resolved.label,
      categories,
      rois: resolved.rois,
      samples,
      stats: {
        touchers: touchersCount,
        ranked: withChop.length,
        returned: samples.length,
        meanTrackLifeS: Math.round(mean(samples.map((s) => s.durationS)) * 10) / 10,
        meanInRoiS: Math.round(mean(samples.map((s) => s.inRoiDurationS)) * 10) / 10,
        meanRawIds: Math.round(mean(samples.map((s) => s.rawIdCount)) * 10) / 10,
      },
    };
  }
}
