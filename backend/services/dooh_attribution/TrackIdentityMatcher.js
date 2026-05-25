/**
 * Link fragmented track IDs via spatiotemporal proximity (re-ID gap bridging).
 */

export function trackSuffix(trackKey) {
  if (!trackKey) return '';
  const idx = trackKey.indexOf(':');
  return idx >= 0 ? trackKey.slice(idx + 1) : trackKey;
}

export function trackKeysEquivalent(keyA, keyB, mode) {
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  if (mode === 'exact') return false;
  const suffixA = trackSuffix(keyA);
  const suffixB = trackSuffix(keyB);
  return suffixA.length > 0 && suffixA === suffixB;
}

/**
 * Load position trail for a track (exact + optional suffix alias).
 */
export function loadTrackPositions(db, venueId, trackKey, trackKeyMode, startTs, endTs) {
  if (trackKeyMode === 'exact') {
    return db.prepare(`
      SELECT position_x as x, position_z as z, timestamp, track_key
      FROM track_positions
      WHERE venue_id = ? AND track_key = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(venueId, trackKey, startTs, endTs);
  }

  const suffix = trackSuffix(trackKey);
  return db.prepare(`
    SELECT position_x as x, position_z as z, timestamp, track_key
    FROM track_positions
    WHERE venue_id = ?
      AND (track_key = ? OR track_key LIKE ? OR track_key = ?)
      AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `).all(venueId, trackKey, `%:${suffix}`, suffix, startTs, endTs);
}

/**
 * True if track B plausibly continues track A after a fragmentation gap.
 */
export function tracksLinkedByReid(posA, posB, { maxGapMs = 15_000, maxDistanceM = 4 } = {}) {
  if (!posA?.length || !posB?.length) return false;

  for (const a of posA) {
    for (const b of posB) {
      if (b.timestamp < a.timestamp) continue;
      const dt = b.timestamp - a.timestamp;
      if (dt > maxGapMs) break;
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      if (dist <= maxDistanceM) return true;
    }
  }
  return false;
}

export function tracksLinkedByReidFromDb(
  db,
  venueId,
  keyA,
  keyB,
  tStart,
  tEnd,
  profile,
) {
  if (trackKeysEquivalent(keyA, keyB, profile.trackKeyMode === 'exact' ? 'exact' : 'suffix_alias')) {
    return true;
  }
  if (profile.trackKeyMode !== 'reid_chain') return false;

  const posA = loadTrackPositions(
    db,
    venueId,
    keyA,
    'suffix_alias',
    tStart - 5000,
    tEnd,
  );
  const posB = loadTrackPositions(
    db,
    venueId,
    keyB,
    'suffix_alias',
    tStart,
    tEnd + 5000,
  );

  return tracksLinkedByReid(posA, posB, {
    maxGapMs: profile.reidMaxGapMs ?? 15_000,
    maxDistanceM: profile.reidMaxDistanceM ?? 4,
  });
}

export function isJourneyReachable(anchor, visit, exposureEndTs, profile) {
  if (!anchor || anchor.x == null || anchor.z == null) return false;
  const walkMps = profile.maxWalkMps ?? 1.4;
  const slack = profile.walkSlack ?? 1.25;
  const baseM = profile.walkBaseSlackM ?? 6;
  const windowS = (profile.actionWindowMinutes ?? 15) * 60;

  const tGapS = (visit.start_time - exposureEndTs) / 1000;
  if (tGapS <= 0 || tGapS > windowS) return false;

  const vx = visit.entry_position_x;
  const vz = visit.entry_position_z;
  if (vx == null || vz == null) return false;

  const dist = Math.hypot(vx - anchor.x, vz - anchor.z);
  const maxReach = walkMps * tGapS * slack + baseM;
  return dist <= maxReach;
}

export function resolveExposureAnchor(db, venueId, trackKey, exposureEndTs, exposureContext, profile) {
  if (exposureContext?.endPositionX != null && exposureContext?.endPositionZ != null) {
    return { x: exposureContext.endPositionX, z: exposureContext.endPositionZ, source: 'stored' };
  }

  const keyMode = profile.trackKeyMode === 'exact' ? 'exact' : 'suffix_alias';
  const pos = loadTrackPositions(db, venueId, trackKey, keyMode, exposureEndTs - 120_000, exposureEndTs + 5000);
  if (pos.length) {
    const last = pos[pos.length - 1];
    return { x: last.x, z: last.z, source: 'track_positions' };
  }

  const screenPos = exposureContext?.screenPosition;
  if (screenPos?.x != null && screenPos?.z != null) {
    return { x: screenPos.x, z: screenPos.z, source: 'screen_proxy' };
  }

  return null;
}
