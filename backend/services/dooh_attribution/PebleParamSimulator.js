/**
 * Dry-run PEBLE conversion matching across parameter profiles.
 * Does NOT write to dooh_attribution_events — replays existing exposures only.
 */

import { ShelfAnalyticsAdapter } from './ShelfAnalyticsAdapter.js';
import { resolveCampaignTarget } from './CampaignTargetResolver.js';
import { MATCHING_PROFILES, getMatchingProfile } from './MatchingProfiles.js';

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function trackSuffix(trackKey) {
  if (!trackKey) return '';
  const idx = trackKey.indexOf(':');
  return idx >= 0 ? trackKey.slice(idx + 1) : trackKey;
}

export class PebleParamSimulator {
  constructor(db) {
    this.db = db;
  }

  getCampaign(campaignId) {
    const row = this.db.prepare('SELECT * FROM dooh_campaigns WHERE id = ?').get(campaignId);
    if (!row) throw new Error(`Campaign ${campaignId} not found`);
    return {
      id: row.id,
      name: row.name,
      venueId: row.venue_id,
      target: JSON.parse(row.target_json),
      params: JSON.parse(row.params_json),
    };
  }

  computeIdentityDiagnostics(venueId, events, startTs, endTs) {
    const expKeys = [...new Set(events.map(e => e.track_key))];
    const visitKeyRows = this.db.prepare(`
      SELECT DISTINCT track_key FROM zone_visits
      WHERE venue_id = ? AND start_time <= ? AND COALESCE(end_time, start_time + COALESCE(duration_ms, 0)) >= ?
    `).all(venueId, endTs, startTs);
    const visitKeys = new Set(visitKeyRows.map(r => r.track_key));

    const expSuffixes = new Set(expKeys.map(trackSuffix));
    const visitSuffixes = new Set([...visitKeys].map(trackSuffix));

    let exactIntersection = 0;
    let suffixIntersection = 0;
    for (const k of expKeys) {
      if (visitKeys.has(k)) exactIntersection++;
      if (visitSuffixes.has(trackSuffix(k))) suffixIntersection++;
    }

    const sampleKeys = expKeys.slice(0, 8);
    let positionSamples = 0;
    if (sampleKeys.length) {
      const ph = sampleKeys.map(() => '?').join(',');
      positionSamples = this.db.prepare(`
        SELECT COUNT(*) as c FROM track_positions
        WHERE venue_id = ? AND track_key IN (${ph})
          AND timestamp >= ? AND timestamp <= ?
      `).get(venueId, ...sampleKeys, startTs, endTs)?.c || 0;
    }

    return {
      exposureUniqueTrackKeys: expKeys.length,
      zoneVisitUniqueTrackKeys: visitKeys.size,
      exactTrackKeyOverlap: exactIntersection,
      suffixOverlap: suffixIntersection,
      pctExactKeyOverlap: expKeys.length ? +((exactIntersection / expKeys.length) * 100).toFixed(2) : 0,
      pctSuffixOverlap: expKeys.length ? +((suffixIntersection / expKeys.length) * 100).toFixed(2) : 0,
      positionSamplesForSampleExposureKeys: positionSamples,
      sampleExposureTrackKeys: sampleKeys,
      sampleZoneVisitTrackKeys: [...visitKeys].slice(0, 8),
      note: exactIntersection === 0
        ? 'Zero track_key overlap — exposures and zone_visits use disjoint ID spaces; re-ID chain profiles required.'
        : null,
    };
  }

  /** Fragmentation context for the exposure sample. */
  computeFragmentationContext(venueId, events, actionWindowMs) {
    let anyVisit = 0;
    let exactKeyVisit = 0;
    let aliasOnlyVisit = 0;
    let noVisit = 0;
    const suffixCounts = new Map();

    for (const event of events) {
      const suffix = trackSuffix(event.track_key);
      suffixCounts.set(suffix, (suffixCounts.get(suffix) || 0) + 1);

      const windowEnd = event.exposure_end_ts + actionWindowMs;
      const exact = this.db.prepare(`
        SELECT COUNT(*) as c FROM zone_visits
        WHERE venue_id = ? AND track_key = ?
          AND start_time <= ? AND COALESCE(end_time, start_time + COALESCE(duration_ms, 0)) >= ?
      `).get(venueId, event.track_key, windowEnd, event.exposure_end_ts)?.c || 0;

      const alias = exact === 0
        ? this.db.prepare(`
            SELECT COUNT(*) as c FROM zone_visits
            WHERE venue_id = ? AND track_key != ? AND (track_key LIKE ? OR track_key = ?)
              AND start_time <= ? AND COALESCE(end_time, start_time + COALESCE(duration_ms, 0)) >= ?
          `).get(venueId, event.track_key, `%:${suffix}`, suffix, windowEnd, event.exposure_end_ts)?.c || 0
        : 0;

      if (exact > 0) {
        anyVisit++;
        exactKeyVisit++;
      } else if (alias > 0) {
        anyVisit++;
        aliasOnlyVisit++;
      } else {
        noVisit++;
      }
    }

    const multiIdSuffixes = [...suffixCounts.values()].filter(c => c > 1).length;

    return {
      exposureEvents: events.length,
      uniqueTrackKeys: new Set(events.map(e => e.track_key)).size,
      uniqueTrackSuffixes: suffixCounts.size,
      suffixesWithMultipleExposureIds: multiIdSuffixes,
      exposuresWithAnyZoneVisit: anyVisit,
      exposuresWithExactKeyVisit: exactKeyVisit,
      exposuresWithAliasOnlyVisit: aliasOnlyVisit,
      exposuresWithNoZoneVisit: noVisit,
      pctAnyZoneVisit: events.length ? (anyVisit / events.length) * 100 : 0,
      pctAliasOnly: events.length ? (aliasOnlyVisit / events.length) * 100 : 0,
    };
  }

  evaluateProfile(venueId, target, profile, events) {
    const adapter = new ShelfAnalyticsAdapter(this.db, { matchingProfile: profile });
    adapter.initTargetCache(venueId, target);

    const actionWindowMs = profile.actionWindowMinutes * 60 * 1000;
    const paddedStart = Math.min(...events.map(e => e.exposure_end_ts)) - 60_000;
    const paddedEnd = Math.max(...events.map(e => e.exposure_end_ts)) + actionWindowMs + 60_000;
    adapter.preloadChunk(venueId, paddedStart, paddedEnd);

    let conversions = 0;
    const ttaSamples = [];
    const matchSource = { roi_visit: 0, reid_chain: 0, position: 0, none: 0 };
    const trackKeyMatch = { exact: 0, alias: 0, none: 0 };

    for (const event of events) {
      const windowEnd = event.exposure_end_ts + actionWindowMs;
      const engagement = adapter.queryEngagementsForTrack(
        venueId,
        event.track_key,
        event.exposure_end_ts,
        windowEnd,
        target,
        { matchMeta: true },
      );

      if (!engagement) {
        matchSource.none++;
        trackKeyMatch.none++;
        continue;
      }

      conversions++;
      if (engagement._matchSource === 'position') matchSource.position++;
      else if (engagement._matchSource === 'reid_chain') matchSource.reid_chain++;
      else matchSource.roi_visit++;

      if (engagement._trackKeyMatch === 'alias') trackKeyMatch.alias++;
      else if (engagement._trackKeyMatch === 'exact') trackKeyMatch.exact++;

      if (engagement.startTs != null && event.exposure_end_ts != null) {
        const tta = Math.max(0, (engagement.startTs - event.exposure_end_ts) / 1000);
        ttaSamples.push(tta);
      }
    }

    adapter.clearCaches();

    const n = events.length;
    return {
      profileId: profile.id,
      label: profile.label,
      rationale: profile.rationale,
      params: {
        actionWindowMinutes: profile.actionWindowMinutes,
        minVisitDurationMs: profile.minVisitDurationMs,
        windowMode: profile.windowMode,
        trackKeyMode: profile.trackKeyMode,
        positionFallbackM: profile.positionFallbackM,
        usePositionFallback: profile.usePositionFallback,
        useZoneVisits: profile.useZoneVisits,
      },
      exposures: n,
      conversions,
      conversionRatePct: n ? +((conversions / n) * 100).toFixed(2) : 0,
      matchSource,
      trackKeyMatch,
      medianTtaSec: median(ttaSamples) != null ? +median(ttaSamples).toFixed(1) : null,
    };
  }

  /**
   * Run all (or selected) profiles against stored exposures for a campaign.
   */
  simulate(venueId, campaignId, startTs, endTs, options = {}) {
    const {
      profileIds = null,
      maxEvents = 5000,
    } = options;

    const campaign = this.getCampaign(campaignId);
    const target = resolveCampaignTarget(this.db, venueId, campaign.target);
    const baseActionWindowMs = (campaign.params.action_window_minutes || 15) * 60 * 1000;

    let events = this.db.prepare(`
      SELECT id, track_key, exposure_end_ts, aqs, converted
      FROM dooh_attribution_events
      WHERE campaign_id = ? AND exposure_end_ts >= ? AND exposure_end_ts <= ?
      ORDER BY exposure_end_ts ASC
    `).all(campaignId, startTs, endTs);

    const totalEvents = events.length;
    if (maxEvents && events.length > maxEvents) {
      const step = Math.ceil(events.length / maxEvents);
      events = events.filter((_, i) => i % step === 0).slice(0, maxEvents);
    }

    const profiles = (profileIds || MATCHING_PROFILES.map(p => p.id))
      .map(id => getMatchingProfile(id));

    const fragmentation = this.computeFragmentationContext(venueId, events, baseActionWindowMs);
    const identity = this.computeIdentityDiagnostics(venueId, events, startTs, endTs);

    const targetRoiVisits = this.db.prepare(`
      SELECT COUNT(*) as c FROM zone_visits zv
      JOIN regions_of_interest r ON zv.roi_id = r.id
      WHERE zv.venue_id = ? AND r.metadata_json LIKE '%"template":"shelf-engagement"%'
        AND zv.start_time <= ? AND COALESCE(zv.end_time, zv.start_time + COALESCE(zv.duration_ms, 0)) >= ?
    `).get(venueId, endTs, startTs)?.c || 0;

    const results = profiles.map(profile => this.evaluateProfile(venueId, target, profile, events));

    // Rank: prefer moderate conversion (1–40%), not zero, not ceiling (>60%)
    const ranked = [...results].sort((a, b) => {
      const score = (r) => {
        const c = r.conversionRatePct;
        if (c === 0) return -100;
        if (c > 60) return 40 - c;
        if (c >= 1 && c <= 40) return 100 + c;
        return c;
      };
      return score(b) - score(a);
    });

    return {
      campaign: campaign.name,
      campaignId,
      venueId,
      timeRange: { startTs, endTs },
      sampledExposures: events.length,
      totalExposuresInDb: totalEvents,
      targetShelfCount: target.ids?.length || 0,
      engagementRoiIds: resolveCampaignTarget(this.db, venueId, target).engagementRoiIds || [],
      shelfEngagementVisitsInRange: targetRoiVisits,
      identity,
      fragmentation,
      profiles: results,
      recommendation: ranked[0] ? {
        profileId: ranked[0].profileId,
        label: ranked[0].label,
        conversionRatePct: ranked[0].conversionRatePct,
        note: 'Auto-pick favors 1–40% conversion band; verify matchSource mix before production.',
      } : null,
    };
  }
}

export default PebleParamSimulator;
