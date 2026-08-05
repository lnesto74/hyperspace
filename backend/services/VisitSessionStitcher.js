/**
 * Entrance-anchored visit session stitching for analytics.
 * Chains fragmented track_keys into store visits using time + spatial proximity.
 */

import { trackSuffix } from './dooh_attribution/TrackIdentityMatcher.js';
import {
  normalizeVisitSessionConfig,
  loadVisitSessionConfigFromTransformJson,
} from '../config/visitSessionConfig.js';
import { isTrafficZoneName } from '../lib/storeHours.js';

/** Slack allowed on a negative gap when linking two fragments (see canLinkFragments). */
const LINK_BACKDATE_TOLERANCE_MS = 2000;

/**
 * Upper bound on fragments chained into a single session. Guards against a
 * dense crowd collapsing into one runaway chain on long ranges.
 */
const MAX_SESSION_FRAGMENTS = 400;

/** Minimum episodes a visit needs to enter the stitching pool. */
const MIN_POOL_DURATION_MS = 300;

/**
 * @typedef {object} TrackFragment
 * @property {string} trackKey
 * @property {number} firstTime
 * @property {number} lastTime
 * @property {{ x: number, z: number } | null} firstEntry
 * @property {{ x: number, z: number } | null} lastExit
 * @property {object[]} visits
 */

/**
 * @typedef {object} VisitSession
 * @property {string} sessionId
 * @property {string[]} trackKeys
 * @property {number} startTime
 * @property {number} endTime
 * @property {boolean} converted
 * @property {string[]} categories
 * @property {Map<string, number>} dwellPerCat
 * @property {boolean} visitedShelf
 * @property {boolean} engagedShelf
 * @property {number} shelfZoneCount
 * @property {number} durationSec
 * @property {string} entranceTrackKey
 */

export function resolveVenueRoiContext(db, venueId) {
  const rois = db.prepare(
    'SELECT id, name FROM regions_of_interest WHERE venue_id = ?'
  ).all(venueId);

  let savedFootfallId = null;
  try {
    const venue = db.prepare('SELECT footfall_roi_id FROM venues WHERE id = ?').get(venueId);
    savedFootfallId = venue?.footfall_roi_id || null;
  } catch { /* ignore */ }

  const entranceRoiIds = new Set();
  if (savedFootfallId) entranceRoiIds.add(savedFootfallId);
  for (const r of rois) {
    if (isTrafficZoneName(r.name)) entranceRoiIds.add(r.id);
    const n = (r.name || '').toLowerCase();
    if (/entrance|entry|ingress|ingresso/.test(n)) entranceRoiIds.add(r.id);
  }

  const checkoutRoiIds = new Set();
  const shelfRoiIds = new Set();
  for (const r of rois) {
    const n = (r.name || '').toLowerCase();
    if (/checkout|register|cashier|\bservice\b/.test(n)) checkoutRoiIds.add(r.id);
    else if (/shelf|gondola|aisle|product|display|fridge|promo|engagement/.test(n)) {
      shelfRoiIds.add(r.id);
    }
  }

  return { rois, entranceRoiIds, checkoutRoiIds, shelfRoiIds };
}

function posOrNull(x, z) {
  if (x == null || z == null || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function trackKeysEquivalent(keyA, keyB, mode) {
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  if (mode === 'exact') return false;
  const sA = trackSuffix(keyA);
  const sB = trackSuffix(keyB);
  return sA.length > 0 && sA === sB;
}

function canLinkFragments(prev, next, config) {
  if (!prev || !next) return false;
  const gap = next.firstTime - prev.lastTime;
  if (gap < -2000 || gap > config.reidMaxGapMs) return false;

  if (trackKeysEquivalent(prev.trackKey, next.trackKey, config.trackKeyMode)) {
    return true;
  }

  if (config.trackKeyMode === 'exact') return false;

  const d = dist(prev.lastExit, next.firstEntry);
  if (d <= config.reidMaxDistanceM) return true;

  return false;
}

function buildFragments(visits) {
  /** @type {Map<string, TrackFragment>} */
  const byKey = new Map();
  for (const v of visits) {
    let frag = byKey.get(v.track_key);
    if (!frag) {
      frag = {
        trackKey: v.track_key,
        firstTime: v.start_time,
        lastTime: v.end_time || v.start_time,
        firstEntry: posOrNull(v.entry_position_x, v.entry_position_z),
        lastExit: posOrNull(v.exit_position_x, v.exit_position_z),
        visits: [],
      };
      byKey.set(v.track_key, frag);
    }
    frag.visits.push(v);
    frag.firstTime = Math.min(frag.firstTime, v.start_time);
    const end = v.end_time || v.start_time;
    frag.lastTime = Math.max(frag.lastTime, end);
    const entry = posOrNull(v.entry_position_x, v.entry_position_z);
    if (entry && v.start_time <= frag.firstTime + 1) frag.firstEntry = entry;
    const exit = posOrNull(v.exit_position_x, v.exit_position_z);
    if (exit) frag.lastExit = exit;
  }
  return byKey;
}

/**
 * Time-ordered view of the fragment pool. Chaining only ever links fragments
 * that start inside a re-ID gap window, so keeping starts sorted lets us
 * binary-search that window instead of rescanning the whole pool per seed.
 */
function buildFragmentIndex(allFragments) {
  const sorted = [...allFragments.values()].sort((a, b) => a.firstTime - b.firstTime);
  const starts = new Float64Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) starts[i] = sorted[i].firstTime;
  return { sorted, starts };
}

function firstIndexAtOrAfter(starts, t) {
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function chainFragments(seedFrag, allFragments, config, windowEnd, index, maxFragments = MAX_SESSION_FRAGMENTS) {
  const linked = new Set([seedFrag.trackKey]);
  if (!index) return linked;

  // Breadth-first over the same "can link" relation the pairwise scan used,
  // expanding only forward in time from each newly linked fragment.
  const frontier = [seedFrag];
  while (frontier.length) {
    const prev = frontier.pop();
    const gapLimit = prev.lastTime + config.reidMaxGapMs;
    const upperBound = Math.min(gapLimit, windowEnd);
    for (let i = firstIndexAtOrAfter(index.starts, prev.lastTime - LINK_BACKDATE_TOLERANCE_MS); i < index.sorted.length; i++) {
      const frag = index.sorted[i];
      if (frag.firstTime > upperBound) break;
      if (frag.firstTime < seedFrag.firstTime) continue;
      if (linked.has(frag.trackKey)) continue;
      if (!canLinkFragments(prev, frag, config)) continue;
      linked.add(frag.trackKey);
      frontier.push(frag);
      if (linked.size >= maxFragments) return linked;
    }
  }
  return linked;
}

function mergeVisitsIntoSession(linkedKeys, allFragments, roiToCategory, checkoutRoiIds, shelfRoiIds) {
  const allVisits = [];
  for (const key of linkedKeys) {
    const frag = allFragments.get(key);
    if (frag) allVisits.push(...frag.visits);
  }
  allVisits.sort((a, b) => a.start_time - b.start_time);

  let converted = false;
  let startTime = Infinity;
  let endTime = 0;
  const categories = [];
  const dwellPerCat = new Map();
  let lastCategory = null;
  const shelfZones = new Set();
  let engagedShelf = false;

  for (const v of allVisits) {
    startTime = Math.min(startTime, v.start_time);
    endTime = Math.max(endTime, v.end_time || v.start_time);
    if (checkoutRoiIds.has(v.roi_id)) converted = true;

    const cat = roiToCategory.get(v.roi_id) || 'Other';
    if (cat !== lastCategory) {
      categories.push(cat);
      lastCategory = cat;
    }

    const dwellMs = (v.end_time || v.start_time) - v.start_time;
    dwellPerCat.set(cat, (dwellPerCat.get(cat) || 0) + dwellMs);

    if (shelfRoiIds.has(v.roi_id)) {
      shelfZones.add(v.roi_id);
      if (v.is_dwell === 1 || (v.duration_ms != null && v.duration_ms >= 3000)) {
        engagedShelf = true;
      }
    }
  }

  const shoppingCats = new Set(
    categories.filter(c => c !== 'Entrance' && c !== 'Checkout')
  );

  return {
    startTime: startTime === Infinity ? 0 : startTime,
    endTime,
    converted,
    categories,
    dwellPerCat,
    visitedShelf: shelfZones.size > 0,
    engagedShelf,
    shelfZoneCount: shelfZones.size,
    uniqueCategoryCount: shoppingCats.size,
    durationSec: startTime === Infinity ? 0 : (endTime - startTime) / 1000,
    totalDwellSec: [...dwellPerCat.values()].reduce((s, ms) => s + ms, 0) / 1000,
  };
}

function loadStitchingVisits(db, venueId, startTime, endTime, entranceRoiIds) {
  const entranceIds = [...entranceRoiIds];
  const entranceClause = entranceIds.length
    ? ` OR (zv.duration_ms = 0 AND zv.roi_id IN (${entranceIds.map(() => '?').join(',')}))`
    : '';
  return db.prepare(`
    SELECT zv.id, zv.track_key, zv.roi_id, zv.start_time, zv.end_time, zv.duration_ms,
           zv.is_dwell, zv.entry_position_x, zv.entry_position_z,
           zv.exit_position_x, zv.exit_position_z, zv.visitor_session_id
    FROM zone_visits zv
    WHERE zv.venue_id = ? AND zv.start_time >= ? AND zv.start_time < ?
      AND (zv.duration_ms >= ${MIN_POOL_DURATION_MS} OR zv.is_dwell = 1${entranceClause})
      AND zv.track_key NOT LIKE '%cashier%'
    ORDER BY zv.start_time ASC
  `).all(venueId, startTime, endTime, ...entranceIds);
}

/**
 * Build entrance-anchored visit sessions from zone_visits.
 *
 * @param {object} [options]
 * @param {object[]} [options.preloadedVisits] Reuse an already-fetched visit set
 *   (ordered by start_time) instead of issuing a second range scan.
 * @param {number} [options.seedStart] Only seed sessions from entrances at or after
 *   this time. Lets a caller process a long range in windows while still reading
 *   ahead far enough for sessions near the window edge to complete.
 * @param {number} [options.seedEnd] Only seed sessions from entrances before this time.
 */
export function buildVisitSessions(db, venueId, startTime, endTime, configInput, roiContext, roiToCategory, options = {}) {
  const config = normalizeVisitSessionConfig(configInput);
  const { entranceRoiIds, checkoutRoiIds, shelfRoiIds } = roiContext;
  const recoveredTrackKeys = options.recoveredTrackKeys || [];
  const seedStart = options.seedStart ?? startTime;
  const seedEnd = options.seedEnd ?? endTime;
  const inSeedWindow = ts => ts >= seedStart && ts < seedEnd;

  // Gate crossings are persisted with an exact zero duration (see
  // TrajectoryStorageService.recordPerimeterCrossing), so they cannot be held to
  // the same minimum-duration bar as dwell episodes or no session ever seeds.
  const isPoolCandidate = (v) => {
    if (!v.track_key || v.track_key.includes('cashier')) return false;
    const dur = v.duration_ms ?? 0;
    if (dur >= MIN_POOL_DURATION_MS || v.is_dwell === 1) return true;
    return dur === 0 && entranceRoiIds.has(v.roi_id);
  };

  const visits = options.preloadedVisits
    ? options.preloadedVisits.filter(isPoolCandidate)
    : loadStitchingVisits(db, venueId, startTime, endTime, entranceRoiIds);

  if (!visits.length) {
    return {
      sessions: [],
      stats: emptySessionStats(),
      config,
    };
  }

  // Prefer persisted visitor_session_id when enough visits have it (live stitching).
  const withSession = visits.filter(v => v.visitor_session_id).length;
  if (withSession > visits.length * 0.15) {
    return buildSessionsFromPersistedIds(
      visits, roiToCategory, checkoutRoiIds, shelfRoiIds, config, inSeedWindow,
    );
  }

  const allFragments = buildFragments(visits);

  // Tag for unattributed stats
  for (const v of visits) {
    v._checkout = checkoutRoiIds.has(v.roi_id);
    v._shelf = shelfRoiIds.has(v.roi_id);
  }
  for (const frag of allFragments.values()) {
    for (const v of frag.visits) {
      v._checkout = checkoutRoiIds.has(v.roi_id);
      v._shelf = shelfRoiIds.has(v.roi_id);
    }
  }

  const entranceSeeds = visits.filter((v) => {
    if (!entranceRoiIds.has(v.roi_id)) return false;
    if (!inSeedWindow(v.start_time)) return false;
    const dur = v.duration_ms ?? 0;
    // A zero-duration row in a gate ROI is a perimeter crossing, not noise.
    if (dur === 0) return true;
    return dur >= config.entranceMinDurationMs || v.is_dwell === 1 || dur >= MIN_POOL_DURATION_MS;
  });

  const fragmentIndex = buildFragmentIndex(allFragments);

  /** @type {VisitSession[]} */
  const sessions = [];
  const assignedKeys = new Set();

  for (const seed of entranceSeeds) {
    // Seeds arrive in start_time order, so the first crossing to claim a track
    // wins and later crossings of the same visit need no work at all.
    if (assignedKeys.has(seed.track_key)) continue;

    const seedFrag = allFragments.get(seed.track_key);
    if (!seedFrag) continue;

    const windowEnd = seed.start_time + config.maxVisitDurationMs;
    const linkedKeys = chainFragments(seedFrag, allFragments, config, windowEnd, fragmentIndex);
    const merged = mergeVisitsIntoSession(
      linkedKeys, allFragments, roiToCategory, checkoutRoiIds, shelfRoiIds
    );

    sessions.push({
      sessionId: `vs-${seed.id}`,
      trackKeys: [...linkedKeys],
      entranceTrackKey: seed.track_key,
      ...merged,
    });
    for (const k of linkedKeys) assignedKeys.add(k);
  }

  // Proximity-recovered entrants (missed gate track_key but first shelf appearance near gate).
  for (const trackKey of recoveredTrackKeys) {
    if (!trackKey || assignedKeys.has(trackKey)) continue;
    const seedFrag = allFragments.get(trackKey);
    if (!seedFrag) continue;
    if (!inSeedWindow(seedFrag.firstTime)) continue;
    const windowEnd = seedFrag.firstTime + config.maxVisitDurationMs;
    const linkedKeys = chainFragments(seedFrag, allFragments, config, windowEnd, fragmentIndex);
    const overlap = [...linkedKeys].some(k => assignedKeys.has(k));
    if (overlap) continue;
    const merged = mergeVisitsIntoSession(
      linkedKeys, allFragments, roiToCategory, checkoutRoiIds, shelfRoiIds,
    );
    if (merged.durationSec < (config.minInStoreDurationSec || 30)) continue;
    sessions.push({
      sessionId: `vs-rec-${trackKey}`,
      trackKeys: [...linkedKeys],
      entranceTrackKey: trackKey,
      recoveredEntrant: true,
      ...merged,
    });
    for (const k of linkedKeys) assignedKeys.add(k);
  }

  // Dedupe sessions that share track keys (pick earliest entrance).
  const sessionsDeduped = dedupeSessionsByTrackOverlap(sessions);

  const stats = computeSessionStats(sessionsDeduped, visits, allFragments, entranceRoiIds, config);

  return { sessions: sessionsDeduped, stats, config };
}

function buildSessionsFromPersistedIds(
  visits, roiToCategory, checkoutRoiIds, shelfRoiIds, config, inSeedWindow = () => true,
) {
  /** @type {Map<string, object[]>} */
  const bySession = new Map();
  for (const v of visits) {
    const sid = v.visitor_session_id;
    if (!sid) continue;
    if (!bySession.has(sid)) bySession.set(sid, []);
    bySession.get(sid).push(v);
  }

  /** @type {VisitSession[]} */
  const sessions = [];
  for (const [sessionId, sessionVisits] of bySession) {
    sessionVisits.sort((a, b) => a.start_time - b.start_time);
    // Attribute each session to the window holding its first visit so a
    // windowed caller counts it exactly once.
    if (!inSeedWindow(sessionVisits[0].start_time)) continue;
    const trackKeys = [...new Set(sessionVisits.map(v => v.track_key))];
    const allFragments = buildFragments(sessionVisits);
    const merged = mergeVisitsIntoSession(
      new Set(trackKeys), allFragments, roiToCategory, checkoutRoiIds, shelfRoiIds
    );
    sessions.push({
      sessionId,
      trackKeys,
      entranceTrackKey: trackKeys[0],
      ...merged,
    });
  }

  sessions.sort((a, b) => a.startTime - b.startTime);
  return {
    sessions,
    stats: computeSessionStats(sessions, visits, buildFragments(visits), new Set(), config),
    config,
  };
}

function dedupeSessionsByTrackOverlap(sessions) {
  sessions.sort((a, b) => a.startTime - b.startTime);
  /** @type {VisitSession[]} */
  const kept = [];
  const assignedKeys = new Set();

  for (const session of sessions) {
    const overlap = session.trackKeys.some(k => assignedKeys.has(k));
    if (overlap) continue;
    for (const k of session.trackKeys) assignedKeys.add(k);
    kept.push(session);
  }
  return kept;
}

function emptySessionStats() {
  return {
    entranceSessions: 0,
    convertedSessions: 0,
    conversionRate: 0,
    unattributedCheckoutFragments: 0,
    unattributedBrowseFragments: 0,
    rawTrackKeys: 0,
    stitchedTrackKeys: 0,
    sessionModel: 'entrance_anchored',
  };
}

function computeSessionStats(sessions, allVisits, allFragments, entranceRoiIds, config) {
  const sessionTrackKeys = new Set();
  for (const s of sessions) {
    for (const k of s.trackKeys) sessionTrackKeys.add(k);
  }

  let unattributedCheckout = 0;
  let unattributedBrowse = 0;
  for (const [key, frag] of allFragments) {
    if (sessionTrackKeys.has(key)) continue;
    const hasCheckout = frag.visits.some(v => v.roi_id && v._checkout);
    const hasShelf = frag.visits.some(v => v._shelf);
    if (hasCheckout) unattributedCheckout++;
    else if (hasShelf && frag.lastTime - frag.firstTime >= config.minInStoreDurationSec * 1000) {
      unattributedBrowse++;
    }
  }

  const converted = sessions.filter(s => s.converted).length;
  return {
    entranceSessions: sessions.length,
    convertedSessions: converted,
    conversionRate: sessions.length > 0 ? +(converted / sessions.length).toFixed(3) : 0,
    unattributedCheckoutFragments: unattributedCheckout,
    unattributedBrowseFragments: unattributedBrowse,
    rawTrackKeys: allFragments.size,
    stitchedTrackKeys: sessionTrackKeys.size,
    sessionModel: 'entrance_anchored',
  };
}

export function classifySessionArchetype(session, config) {
  const catCount = session.uniqueCategoryCount || 0;
  const totalDwellSec = session.totalDwellSec || 0;
  const durationSec = session.durationSec || 0;

  if (session.converted) {
    if (catCount >= 4) return 'full-shop';
    if (catCount <= 2 && totalDwellSec > 5) return 'category-specialist';
    return 'full-shop';
  }
  if (catCount >= 1 && durationSec >= (config.minInStoreDurationSec || 30)) {
    return 'browse-and-bail';
  }
  return 'quick-run';
}

export function loadVisitSessionConfigForVenue(db, venueId) {
  try {
    const row = db.prepare('SELECT dwg_transform_json FROM venues WHERE id = ?').get(venueId);
    if (!row?.dwg_transform_json) return normalizeVisitSessionConfig(null);
    const parsed = JSON.parse(row.dwg_transform_json);
    return loadVisitSessionConfigFromTransformJson(parsed);
  } catch {
    return normalizeVisitSessionConfig(null);
  }
}

/** Assign visitor_session_id on finalized visits (batch backfill helper). */
export function backfillVisitorSessionIds(db, venueId, startTime, endTime, configInput, roiContext, roiToCategory) {
  const { sessions } = buildVisitSessions(
    db, venueId, startTime, endTime, configInput, roiContext, roiToCategory
  );
  const update = db.prepare(`
    UPDATE zone_visits SET visitor_session_id = ?, is_conversion = ?
    WHERE id = ?
  `);
  const run = db.transaction(() => {
    let updated = 0;
    for (const session of sessions) {
      const visitIds = new Set();
      for (const key of session.trackKeys) {
        const rows = db.prepare(`
          SELECT id FROM zone_visits
          WHERE venue_id = ? AND track_key = ? AND start_time >= ? AND start_time < ?
        `).all(venueId, key, session.startTime - 5000, session.endTime + 5000);
        for (const r of rows) visitIds.add(r.id);
      }
      for (const id of visitIds) {
        update.run(session.sessionId, session.converted ? 1 : 0, id);
        updated++;
      }
    }
    return updated;
  });
  return run();
}
