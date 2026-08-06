/**
 * Per-zone measurement audit.
 *
 * This is not a business report. It exists to answer one question — is a number
 * that looks wrong the store's behaviour, our processing, or the perception
 * vendor's tracking — and it is built to be shown to the vendor, so every
 * figure is traceable to a table and every limit of the method is stated rather
 * than smoothed over.
 *
 * Three identities are counted for the same people, which is what makes the
 * before-and-after visible:
 *
 *   original_perception_id  what the vendor's software emitted
 *   track_key               after our reconciler merges re-identifications
 *   visitor_session_id      after fragments are stitched into a store visit
 *
 * The ratio between the first two is the fragmentation the reconciler absorbs.
 * If it is near 1.0 the vendor's tracking is holding identity; well above 1.0
 * means a single shopper is being emitted as several people, which inflates
 * visit counts and cuts every dwell measurement short.
 */

/** Shoelace area. Vertices are {x, z} in metres on the floor plane. */
function polygonArea(verts) {
  if (!Array.isArray(verts) || verts.length < 3) return null;
  let a = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const px = p.x ?? p[0];
    const pz = p.z ?? p.y ?? p[1];
    const qx = q.x ?? q[0];
    const qz = q.z ?? q.y ?? q[1];
    if (![px, pz, qx, qz].every(Number.isFinite)) return null;
    a += px * qz - qx * pz;
  }
  return Math.abs(a) / 2;
}

const round = (n, dp = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** dp) / 10 ** dp : null);
const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

function parse(json, fallback) {
  try {
    return JSON.parse(json ?? '');
  } catch {
    return fallback;
  }
}

function loadZones(db, venueId) {
  const zones = new Map();
  const objStmt = db.prepare('SELECT metadata_json FROM venue_objects WHERE id = ?');

  for (const r of db.prepare(
    'SELECT id, name, vertices, metadata_json FROM regions_of_interest WHERE venue_id = ?',
  ).all(venueId)) {
    const meta = parse(r.metadata_json, {}) || {};
    const area = polygonArea(parse(r.vertices, null));

    let category = meta.business_category_label || meta.business_category || null;
    if (!category && meta.shelfId) {
      const om = parse(objStmt.get(meta.shelfId)?.metadata_json, {}) || {};
      category = om.business_category_label || om.business_category || null;
    }

    zones.set(r.id, {
      id: r.id,
      name: r.name,
      category: category || null,
      role: meta.template || null,
      areaM2: round(area, 1),
      // The yardstick a path length is judged against: roughly how far a
      // shopper walks crossing a zone of this size in a straight line.
      spanM: area != null ? round(Math.sqrt(area), 1) : null,
    });
  }
  return zones;
}

/**
 * Mean, median and the spread of distinct values, in one ordered pass rather
 * than a median query per zone. The count of distinct durations is the
 * quantisation tell: a zone with thousands of visits and a handful of distinct
 * durations is being measured on a coarse clock.
 */
function loadDwell(db, venueId, startTs, endTs) {
  const agg = new Map();

  for (const r of db.prepare(`
    SELECT roi_id,
           COUNT(*) AS visits,
           COUNT(DISTINCT track_key) AS tracks,
           COUNT(DISTINCT visitor_session_id) AS sessions,
           COUNT(DISTINCT duration_ms) AS distinctDurations,
           AVG(duration_ms) AS meanMs,
           SUM(CASE WHEN duration_ms = 0 THEN 1 ELSE 0 END) AS zeroVisits
    FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ? AND duration_ms IS NOT NULL
    GROUP BY roi_id
  `).all(venueId, startTs, endTs)) {
    agg.set(r.roi_id, r);
  }

  const medians = new Map();
  let currentRoi = null;
  let bucket = [];
  const flush = () => {
    if (currentRoi && bucket.length) {
      medians.set(currentRoi, bucket[Math.floor(bucket.length / 2)]);
    }
    bucket = [];
  };
  for (const r of db.prepare(`
    SELECT roi_id, duration_ms FROM zone_visits
    WHERE venue_id = ? AND start_time >= ? AND start_time < ? AND duration_ms IS NOT NULL
    ORDER BY roi_id, duration_ms
  `).iterate(venueId, startTs, endTs)) {
    if (r.roi_id !== currentRoi) {
      flush();
      currentRoi = r.roi_id;
    }
    bucket.push(r.duration_ms);
  }
  flush();

  return { agg, medians };
}

/**
 * Distance walked inside each zone, accumulated between consecutive stored
 * samples of the same track.
 *
 * Positions are stored about every three seconds, so this cuts corners and is a
 * lower bound on the true path. It is honest for comparing zones with each
 * other, and for comparing a zone with itself on another day; it is not a
 * measurement of how far someone actually walked. The share of runs with a
 * single sample is reported alongside, because a run of one sample contributes
 * no distance at all and is the main reason the bound is loose.
 */
function loadPaths(db, venueId, startTs, endTs) {
  const paths = new Map();
  const entry = (roiId) => {
    if (!paths.has(roiId)) {
      paths.set(roiId, { pathTotal: 0, displacementTotal: 0, runs: 0, singleSample: 0, samples: 0 });
    }
    return paths.get(roiId);
  };

  let curTrack = null;
  let curRoi = null;
  let first = null;
  let last = null;
  let path = 0;
  let samples = 0;

  const closeRun = () => {
    if (!curRoi || samples === 0) return;
    const e = entry(curRoi);
    e.pathTotal += path;
    e.displacementTotal += Math.hypot(last.x - first.x, last.z - first.z);
    e.runs += 1;
    e.samples += samples;
    if (samples === 1) e.singleSample += 1;
  };

  for (const r of db.prepare(`
    SELECT track_key, roi_id, position_x, position_z
    FROM track_positions
    WHERE venue_id = ? AND timestamp >= ? AND timestamp < ? AND roi_id IS NOT NULL
    ORDER BY track_key, roi_id, timestamp
  `).iterate(venueId, startTs, endTs)) {
    if (r.track_key !== curTrack || r.roi_id !== curRoi) {
      closeRun();
      curTrack = r.track_key;
      curRoi = r.roi_id;
      first = { x: r.position_x, z: r.position_z };
      last = first;
      path = 0;
      samples = 1;
      continue;
    }
    path += Math.hypot(r.position_x - last.x, r.position_z - last.z);
    last = { x: r.position_x, z: r.position_z };
    samples += 1;
  }
  closeRun();

  return paths;
}

/** Raw vendor identities against reconciled ones, per zone. */
function loadIdentities(db, venueId, startTs, endTs) {
  const map = new Map();
  for (const r of db.prepare(`
    SELECT roi_id,
           COUNT(DISTINCT original_perception_id) AS rawIds,
           COUNT(DISTINCT track_key) AS trackKeys
    FROM track_positions
    WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
      AND roi_id IS NOT NULL AND original_perception_id IS NOT NULL
    GROUP BY roi_id
  `).all(venueId, startTs, endTs)) {
    map.set(r.roi_id, r);
  }
  return map;
}

export function computeZoneAudit(db, venueId, startTs, endTs) {
  const zones = loadZones(db, venueId);
  const { agg, medians } = loadDwell(db, venueId, startTs, endTs);
  const paths = loadPaths(db, venueId, startTs, endTs);
  const identities = loadIdentities(db, venueId, startTs, endTs);

  const rows = [];
  for (const [roiId, zone] of zones) {
    const a = agg.get(roiId);
    const p = paths.get(roiId);
    const ident = identities.get(roiId);
    if (!a && !p) continue;

    const visits = a?.visits ?? 0;
    const meanPathM = p && p.runs > 0 ? p.pathTotal / p.runs : null;
    const rawIds = ident?.rawIds ?? 0;
    const trackKeys = ident?.trackKeys ?? 0;

    rows.push({
      ...zone,
      visits,
      tracks: a?.tracks ?? 0,
      sessions: a?.sessions ?? 0,
      meanDwellSec: a?.meanMs != null ? round(a.meanMs / 1000, 1) : null,
      medianDwellSec: medians.has(roiId) ? round(medians.get(roiId) / 1000, 1) : null,
      distinctDurations: a?.distinctDurations ?? 0,
      // Thousands of visits sharing few distinct durations means the clock is
      // coarse, whatever the mean happens to be.
      durationResolution: visits > 0 ? round((a?.distinctDurations ?? 0) / visits, 3) : null,
      zeroLengthPct: pct(a?.zeroVisits ?? 0, visits),
      meanPathM: round(meanPathM, 2),
      meanDisplacementM: p && p.runs > 0 ? round(p.displacementTotal / p.runs, 2) : null,
      pathVsSpan: meanPathM != null && zone.spanM ? round(meanPathM / zone.spanM, 2) : null,
      samplesPerRun: p && p.runs > 0 ? round(p.samples / p.runs, 2) : null,
      singleSamplePct: p && p.runs > 0 ? pct(p.singleSample, p.runs) : null,
      rawPerceptionIds: rawIds,
      reconciledTracks: trackKeys,
      // The heart of the audit: how many identities the vendor emitted for
      // each person we ended up counting.
      fragmentsPerTrack: trackKeys > 0 ? round(rawIds / trackKeys, 2) : null,
    });
  }

  rows.sort((x, y) => y.visits - x.visits);

  const totals = rows.reduce((acc, r) => {
    acc.visits += r.visits;
    acc.rawPerceptionIds += r.rawPerceptionIds;
    acc.reconciledTracks += r.reconciledTracks;
    return acc;
  }, { visits: 0, rawPerceptionIds: 0, reconciledTracks: 0 });

  // Venue-wide identity counts, which are not the sum of the per-zone counts:
  // one shopper crossing six zones is six zone-level identities and one person.
  const venueIdentities = db.prepare(`
    SELECT COUNT(DISTINCT original_perception_id) AS rawIds,
           COUNT(DISTINCT track_key) AS trackKeys,
           COUNT(*) AS samples
    FROM track_positions
    WHERE venue_id = ? AND timestamp >= ? AND timestamp < ?
      AND original_perception_id IS NOT NULL
  `).get(venueId, startTs, endTs) || {};

  return {
    venueId,
    range: { startTs, endTs },
    generatedAt: new Date().toISOString(),
    method: {
      positionSampleSec: 3,
      pathIsLowerBound: true,
      note: 'Distance is accumulated between stored position samples, taken about every three seconds, so it cuts corners and understates the true walked path. Each sample is attributed to the first zone containing it, so a track inside two overlapping zones counts toward one of them.',
    },
    totals: {
      ...totals,
      zones: rows.length,
      venueRawPerceptionIds: venueIdentities.rawIds ?? 0,
      venueReconciledTracks: venueIdentities.trackKeys ?? 0,
      venueFragmentsPerTrack: venueIdentities.trackKeys > 0
        ? round(venueIdentities.rawIds / venueIdentities.trackKeys, 2)
        : null,
      positionSamples: venueIdentities.samples ?? 0,
    },
    zones: rows,
  };
}

export default { computeZoneAudit };
