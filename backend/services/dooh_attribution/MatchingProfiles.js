/**
 * PEBLE conversion-matching profiles for simulation and production tuning.
 *
 * Treviglio context (overnight benchmark): fragmentation_ratio ~2.4–6×,
 * 61% shelf-occlusion splits, median stable track ~12–94s depending on reconciler.
 * Strict start-in-window + exact track_key matching collapses conversions to ~0.
 */

/** @typedef {'start_in' | 'overlap'} WindowMode */
/** @typedef {'exact' | 'suffix_alias' | 'reid_chain' | 'journey_reachability'} TrackKeyMode */

/**
 * @typedef {Object} MatchingProfile
 * @property {string} id
 * @property {string} label
 * @property {string} rationale
 * @property {number} actionWindowMinutes
 * @property {number} minVisitDurationMs
 * @property {WindowMode} windowMode
 * @property {TrackKeyMode} trackKeyMode
 * @property {number} positionFallbackM
 * @property {number} positionMinDwellMs
 * @property {boolean} usePositionFallback
 * @property {boolean} useZoneVisits
 * @property {number} [reidMaxGapMs]
 * @property {number} [reidMaxDistanceM]
 * @property {number} [maxWalkMps]
 * @property {number} [walkSlack]
 * @property {number} [walkBaseSlackM]
 */

/** @type {MatchingProfile[]} */
export const MATCHING_PROFILES = [
  {
    id: 'strict_legacy',
    label: 'Strict legacy (pre-fix baseline)',
    rationale: 'Start-in-window only, exact track_key, 3s dwell, 15m window — fails under fragmentation.',
    actionWindowMinutes: 15,
    minVisitDurationMs: 3000,
    windowMode: 'start_in',
    trackKeyMode: 'exact',
    positionFallbackM: 1.5,
    positionMinDwellMs: 2000,
    usePositionFallback: true,
    useZoneVisits: true,
  },
  {
    id: 'overlap_alias_15m',
    label: 'Overlap + alias (15m)',
    rationale: 'Overlap window + suffix track_key alias + 1s visits — moderate fragmentation tolerance.',
    actionWindowMinutes: 15,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'suffix_alias',
    positionFallbackM: 2.5,
    positionMinDwellMs: 1000,
    usePositionFallback: true,
    useZoneVisits: true,
  },
  {
    id: 'frag_20m_zone_only',
    label: 'Fragmented 20m (zone visits only)',
    rationale: '20m window, alias keys, overlap — no spatial fallback (isolates zone_visit linkage).',
    actionWindowMinutes: 20,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'suffix_alias',
    positionFallbackM: 2.5,
    positionMinDwellMs: 1000,
    usePositionFallback: false,
    useZoneVisits: true,
  },
  {
    id: 'frag_25m_balanced',
    label: 'Fragmented 25m balanced',
    rationale: 'Extended window for cross-aisle journeys (screens z≈60 → shelves z≈22 ~38m).',
    actionWindowMinutes: 25,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'suffix_alias',
    positionFallbackM: 3.0,
    positionMinDwellMs: 1500,
    usePositionFallback: true,
    useZoneVisits: true,
  },
  {
    id: 'frag_30m_spatial',
    label: 'Fragmented 30m spatial-heavy',
    rationale: 'Wider spatial proxy when ROI visits break across track IDs after occlusion.',
    actionWindowMinutes: 30,
    minVisitDurationMs: 2000,
    windowMode: 'overlap',
    trackKeyMode: 'suffix_alias',
    positionFallbackM: 3.5,
    positionMinDwellMs: 2000,
    usePositionFallback: true,
    useZoneVisits: true,
  },
  {
    id: 'frag_35m_ceiling',
    label: 'Fragmented 35m (sanity ceiling)',
    rationale: 'Upper-bound exploratory profile — flags over-attribution if lift explodes.',
    actionWindowMinutes: 35,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'suffix_alias',
    positionFallbackM: 4.0,
    positionMinDwellMs: 1000,
    usePositionFallback: true,
    useZoneVisits: true,
  },
  {
    id: 'spatial_only_20m',
    label: 'Spatial-only 20m (fragmentation bypass)',
    rationale: 'Ignores zone_visits; matches via track_positions near shelf — fragmentation stress test.',
    actionWindowMinutes: 20,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'suffix_alias',
    positionFallbackM: 3.0,
    positionMinDwellMs: 1500,
    usePositionFallback: true,
    useZoneVisits: false,
  },
  {
    id: 'frag_reid_15m',
    label: 'Re-ID chain 15m',
    rationale: 'Bridge fragmented track IDs via spatiotemporal proximity at occlusion gaps (4m / 15s).',
    actionWindowMinutes: 15,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'reid_chain',
    positionFallbackM: 2.5,
    positionMinDwellMs: 1000,
    usePositionFallback: true,
    useZoneVisits: true,
    reidMaxGapMs: 15_000,
    reidMaxDistanceM: 4,
  },
  {
    id: 'frag_reid_25m',
    label: 'Re-ID chain 25m',
    rationale: 'Re-ID chain + 25m window for cross-aisle journeys after ID splits.',
    actionWindowMinutes: 25,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'reid_chain',
    positionFallbackM: 3.0,
    positionMinDwellMs: 1500,
    usePositionFallback: true,
    useZoneVisits: true,
    reidMaxGapMs: 20_000,
    reidMaxDistanceM: 5,
  },
  {
    id: 'frag_reid_30m_loose',
    label: 'Re-ID chain 30m (looser gap)',
    rationale: 'Looser re-ID thresholds (5m / 25s) — upper exploratory bound for heavy fragmentation.',
    actionWindowMinutes: 30,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'reid_chain',
    positionFallbackM: 3.5,
    positionMinDwellMs: 1500,
    usePositionFallback: true,
    useZoneVisits: true,
    reidMaxGapMs: 25_000,
    reidMaxDistanceM: 5,
  },
  {
    id: 'frag_journey_25m',
    label: 'Journey reachability 25m',
    rationale: 'When track IDs diverge, link screen/exposure anchor to shelf visit by walkable distance + time (fragmented store).',
    actionWindowMinutes: 25,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'journey_reachability',
    positionFallbackM: 3.0,
    positionMinDwellMs: 1500,
    usePositionFallback: false,
    useZoneVisits: true,
    maxWalkMps: 1.35,
    walkSlack: 1.2,
    walkBaseSlackM: 5,
  },
  {
    id: 'frag_journey_30m_tight',
    label: 'Journey reachability 30m (tighter)',
    rationale: '30m window with tighter walk slack — exploratory ceiling with less over-attribution.',
    actionWindowMinutes: 30,
    minVisitDurationMs: 1000,
    windowMode: 'overlap',
    trackKeyMode: 'journey_reachability',
    positionFallbackM: 3.0,
    positionMinDwellMs: 1500,
    usePositionFallback: false,
    useZoneVisits: true,
    maxWalkMps: 1.25,
    walkSlack: 1.1,
    walkBaseSlackM: 3,
  },
];

const profileMap = new Map(MATCHING_PROFILES.map(p => [p.id, p]));

export function getMatchingProfile(id) {
  const profile = profileMap.get(id);
  if (!profile) {
    throw new Error(`Unknown PEBLE matching profile: ${id}. Available: ${[...profileMap.keys()].join(', ')}`);
  }
  return profile;
}

/** Production default until simulation picks a winner (env override: PEBLE_MATCHING_PROFILE). */
export function getDefaultMatchingProfileId() {
  return process.env.PEBLE_MATCHING_PROFILE || 'strict_legacy';
}

export function getDefaultMatchingProfile() {
  return getMatchingProfile(getDefaultMatchingProfileId());
}
