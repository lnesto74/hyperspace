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

/**
 * Life-duration clusters for raw vendor IDs that touched a category ROI.
 * Edges follow the 3 s position sample cadence and the observed 15 s median mass.
 */
export const RAW_LIFE_BUCKETS = Object.freeze([
  { id: 'lt3', label: '< 3 s — blink / 1–2 samples', minS: 0, maxS: 3 },
  { id: '3_6', label: '3–6 s', minS: 3, maxS: 6 },
  { id: '6_10', label: '6–10 s', minS: 6, maxS: 10 },
  { id: '10_15', label: '10–15 s — under the KPI median', minS: 10, maxS: 15 },
  { id: '15_30', label: '15–30 s — around the median', minS: 15, maxS: 30 },
  { id: '30_60', label: '30–60 s', minS: 30, maxS: 60 },
  { id: '60_120', label: '60–120 s', minS: 60, maxS: 120 },
  { id: 'ge120', label: '≥ 120 s — longest survivors', minS: 120, maxS: Infinity },
]);

function bucketForLifeS(lifeS) {
  for (const b of RAW_LIFE_BUCKETS) {
    if (lifeS >= b.minS && lifeS < b.maxS) return b.id;
    if (b.maxS === Infinity && lifeS >= b.minS) return b.id;
  }
  return RAW_LIFE_BUCKETS[0].id;
}

function resolveLifeBucket(id) {
  if (!id || id === 'all') return null;
  return RAW_LIFE_BUCKETS.find((b) => b.id === id) || null;
}

/**
 * Count real path discontinuities.
 * Positions are sampled ~every 3s (often ~5–10s near shelves), so a gap must be
 * a missed-sample streak (dt ≥ 7s) or a teleport (fast jump > 3 m).
 * Do NOT use dt>2.5 — that marks every stored track as fragmented.
 */
function countPathGaps(rows, maxDtS = 7.0, teleportM = 3.0, teleportSpeed = 2.5) {
  let gaps = 0;
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const dt = (b.timestamp - a.timestamp) / 1000;
    const dist = Math.hypot(b.position_x - a.position_x, b.position_z - a.position_z);
    if (dt >= maxDtS) gaps += 1;
    else if (dist > teleportM && dt > 0.05 && dist / dt > teleportSpeed) gaps += 1;
  }
  return gaps;
}

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
        categories, rois: [], samples: [], lifeBuckets: [],
        error: `Unknown category. Try one of: ${categories.slice(0, 12).join(', ')}`,
      };
    }

    const roiIds = resolved.rois.map((r) => r.id);
    const placeholders = roiIds.map(() => '?').join(',');

    // Histogram of ALL raw IDs that touched the category (n≥2), for the cluster select.
    const lifeRows = this.db.prepare(`
      SELECT (MAX(timestamp) - MIN(timestamp)) AS life_ms
      FROM track_positions
      WHERE venue_id = ?
        AND timestamp >= ? AND timestamp < ?
        AND original_perception_id IS NOT NULL
        AND original_perception_id != ''
      GROUP BY original_perception_id
      HAVING SUM(CASE WHEN roi_id IN (${placeholders}) THEN 1 ELSE 0 END) >= 1
         AND COUNT(*) >= 2
    `).all(venueId, start, end, ...roiIds);

    const bucketCounts = Object.fromEntries(RAW_LIFE_BUCKETS.map((b) => [b.id, 0]));
    for (const r of lifeRows) {
      const id = bucketForLifeS((Number(r.life_ms) || 0) / 1000);
      bucketCounts[id] = (bucketCounts[id] || 0) + 1;
    }
    const lifeBuckets = RAW_LIFE_BUCKETS.map((b) => ({
      id: b.id,
      label: b.label,
      minS: b.minS,
      maxS: b.maxS === Infinity ? null : b.maxS,
      count: bucketCounts[b.id] || 0,
    }));

    // Default cluster: longest survivors if any, else the fattest bucket.
    let bucket = resolveLifeBucket(opts.lifeBucket);
    if (!bucket) {
      const ge120 = lifeBuckets.find((b) => b.id === 'ge120');
      if (ge120?.count) bucket = resolveLifeBucket('ge120');
      else {
        const fattest = [...lifeBuckets].sort((a, b) => b.count - a.count)[0];
        bucket = resolveLifeBucket(fattest?.id) || resolveLifeBucket('15_30');
      }
    }
    const lifeLoMs = Math.round(bucket.minS * 1000);
    const lifeHiMs = bucket.maxS === Infinity
      ? Number.MAX_SAFE_INTEGER
      : Math.round(bucket.maxS * 1000);
    // Short blinks often have only 2 samples; longer clusters need more.
    const minPts = bucket.minS < 6 ? 2 : bucket.minS < 15 ? 3 : 5;

    const orderSql =
      sort === 'recent' ? 't1 DESC'
        : sort === 'chopped' || sort === 'shortest' ? 'life_ms ASC'
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
        HAVING in_roi_hits >= 1
           AND n >= ?
           AND life_ms >= ?
           AND life_ms < ?
      )
      SELECT raw_id AS rawId, t0, t1, life_ms AS lifeMs, n AS nPts, in_roi_hits AS inRoiHits
      FROM candidates
      ORDER BY ${orderSql}
      LIMIT ?
    `).all(
      ...roiIds, venueId, start, end,
      minPts, lifeLoMs, lifeHiMs,
      Math.max(limit * 8, 160),
    );

    const touchersCount = lifeRows.length;

    if (!ranked.length) {
      return {
        venueId, start, end, mode: 'raw',
        category: resolved.label,
        categories, rois: resolved.rois, samples: [],
        lifeBucket: bucket.id,
        lifeBuckets,
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

    const built = [];
    for (const row of ranked) {
      const rows = posStmt.all(venueId, row.rawId, row.t0, row.t1);
      if (rows.length < minPts) continue;
      const q = pathQuality(rows);
      const gapCount = countPathGaps(rows);
      const segmentCount = gapCount + 1;
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
      })), bucket.minS < 15 ? 200 : 400);
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
        gapCount,
        segmentCount,
        // Continuous = no time/space gaps in the stored path (blind-spot vs chop test).
        continuous: gapCount === 0 && q.suspectJumps === 0,
        plausible: q.plausible && gapCount === 0,
        reconciledPath: path,
        rawPaths: { [row.rawId]: path },
      });
    }

    if (sort === 'gaps' || sort === 'chopped') {
      // Most fragmented first — bingo candidates if neighbours are continuous.
      built.sort((a, b) => {
        if (b.gapCount !== a.gapCount) return b.gapCount - a.gapCount;
        return b.durationS - a.durationS;
      });
    } else if (sort === 'longest') {
      built.sort((a, b) => {
        // Prefer continuous paths within the cluster, then longer life.
        if (a.continuous !== b.continuous) return a.continuous ? -1 : 1;
        return b.durationS - a.durationS;
      });
    } else if (sort === 'shortest') {
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
      lifeBucket: bucket.id,
      lifeBuckets,
      samples,
      stats: {
        touchers: touchersCount,
        ranked: built.length,
        returned: samples.length,
        meanTrackLifeS: Math.round(mean(samples.map((s) => s.durationS)) * 10) / 10,
        meanInRoiS: Math.round(mean(samples.map((s) => s.inRoiDurationS)) * 10) / 10,
        meanRawIds: 1,
        meanGaps: Math.round(mean(samples.map((s) => s.gapCount || 0)) * 10) / 10,
        continuousShare: samples.length
          ? Math.round((samples.filter((s) => s.continuous).length / samples.length) * 100)
          : 0,
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
