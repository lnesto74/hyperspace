/**
 * DoohAttributionEngine
 * 
 * PEBLE™ - Post-Exposure Behavioral Lift Engine
 * 
 * Implements matched control attribution algorithm to measure
 * incremental lift from DOOH ad exposure on shelf engagement.
 * 
 * Feature flag: FEATURE_DOOH_ATTRIBUTION
 */

import { v4 as uuidv4 } from 'uuid';
import { ShelfAnalyticsAdapter } from './ShelfAnalyticsAdapter.js';
import { pointInPolygon, distance2D } from '../dooh/DoohKpiEngine.js';

// Default campaign parameters
export const DEFAULT_CAMPAIGN_PARAMS = {
  action_window_minutes: 10,
  match_time_bucket_min: 15,
  control_matches_M: 5,
  min_controls_required: 3,
  near_corridor_buffer_m: 1.5,
  aqs_min_for_exposed: 50,
  visitor_reset_minutes: 45,
  confidence_floor: 0.3,
  context_priority_json: ['queue', 'checkout', 'promo', 'aisle', 'entrance', 'exit', 'other'],
  pre_post_window_s: 30,
  // Matching weights
  w_time: 0.4,
  w_heading: 0.3,
  w_speed: 0.3,
  // Heading bins
  heading_bins: 8,
  heading_tolerance: 1, // +/- 1 bin allowed
  speed_tolerance: 0.2, // +/- 20%
};

export class DoohAttributionEngine {
  constructor(db) {
    this.db = db;
    this.shelfAdapter = new ShelfAnalyticsAdapter(db);
    this.positionCache = new Map();
    this.screenCache = new Map();
  }

  /**
   * Clear caches between runs
   */
  clearCaches() {
    this.positionCache.clear();
    this.screenCache.clear();
  }

  /**
   * Load campaign configuration
   */
  getCampaign(campaignId) {
    const row = this.db.prepare(`
      SELECT * FROM dooh_campaigns WHERE id = ?
    `).get(campaignId);

    if (!row) return null;

    return {
      id: row.id,
      venueId: row.venue_id,
      name: row.name,
      screenIds: JSON.parse(row.screen_ids_json),
      target: JSON.parse(row.target_json),
      params: { ...DEFAULT_CAMPAIGN_PARAMS, ...JSON.parse(row.params_json) },
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Get screen details (cached)
   */
  getScreen(screenId) {
    if (this.screenCache.has(screenId)) {
      return this.screenCache.get(screenId);
    }

    const row = this.db.prepare(`
      SELECT * FROM dooh_screens WHERE id = ?
    `).get(screenId);

    if (!row) return null;

    const screen = {
      id: row.id,
      venueId: row.venue_id,
      name: row.name,
      position: JSON.parse(row.position_json),
      yawDeg: row.yaw_deg,
      sezPolygon: JSON.parse(row.sez_polygon_json),
      params: JSON.parse(row.params_json),
    };

    this.screenCache.set(screenId, screen);
    return screen;
  }

  /**
   * Load exposure events for campaign screens
   */
  getExposureEvents(venueId, screenIds, startTs, endTs, aqsMin) {
    const placeholders = screenIds.map(() => '?').join(',');
    
    const rows = this.db.prepare(`
      SELECT * FROM dooh_exposure_events
      WHERE venue_id = ? 
        AND screen_id IN (${placeholders})
        AND end_ts >= ? AND end_ts <= ?
        AND aqs >= ?
      ORDER BY end_ts ASC
    `).all(venueId, ...screenIds, startTs, endTs, aqsMin);

    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      screenId: row.screen_id,
      trackKey: row.track_key,
      startTs: row.start_ts,
      endTs: row.end_ts,
      durationS: row.duration_s,
      effectiveDwellS: row.effective_dwell_s,
      aqs: row.aqs,
      tier: row.tier,
      context: row.context_json ? JSON.parse(row.context_json) : null,
    }));
  }

  /**
   * Get trajectory samples for control matching
   */
  getTrajectoryAroundTime(venueId, trackKey, centerTs, windowMs = 5000) {
    const rows = this.db.prepare(`
      SELECT timestamp, position_x as x, position_z as z, velocity_x as vx, velocity_z as vz
      FROM track_positions
      WHERE venue_id = ? AND track_key = ? 
        AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(venueId, trackKey, centerTs - windowMs, centerTs + windowMs);

    return rows;
  }

  /**
   * Calculate heading bin (0-7) from velocity vector
   */
  getHeadingBin(vx, vz, numBins = 8) {
    const angle = Math.atan2(vx, vz); // radians, 0 = +Z
    const degrees = ((angle * 180 / Math.PI) + 360) % 360;
    return Math.floor(degrees / (360 / numBins)) % numBins;
  }

  /**
   * Calculate Direction Change Index (DCI)
   * Measures change in trajectory alignment toward target after exposure
   */
  calculateDCI(venueId, trackKey, exposureEndTs, targetPosition, windowS = 10) {
    const preStart = exposureEndTs - (windowS * 1000);
    const postEnd = exposureEndTs + (windowS * 1000);

    // Get positions before and after
    const preSamples = this.db.prepare(`
      SELECT position_x as x, position_z as z
      FROM track_positions
      WHERE venue_id = ? AND track_key = ? 
        AND timestamp >= ? AND timestamp < ?
      ORDER BY timestamp ASC
    `).all(venueId, trackKey, preStart, exposureEndTs);

    const postSamples = this.db.prepare(`
      SELECT position_x as x, position_z as z
      FROM track_positions
      WHERE venue_id = ? AND track_key = ? 
        AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `).all(venueId, trackKey, exposureEndTs, postEnd);

    if (preSamples.length < 2 || postSamples.length < 2) {
      return null;
    }

    // Calculate pre-exposure direction
    const preFirst = preSamples[0];
    const preLast = preSamples[preSamples.length - 1];
    const preDx = preLast.x - preFirst.x;
    const preDz = preLast.z - preFirst.z;
    const preMag = Math.sqrt(preDx * preDx + preDz * preDz);

    // Calculate post-exposure direction
    const postFirst = postSamples[0];
    const postLast = postSamples[postSamples.length - 1];
    const postDx = postLast.x - postFirst.x;
    const postDz = postLast.z - postFirst.z;
    const postMag = Math.sqrt(postDx * postDx + postDz * postDz);

    if (preMag < 0.1 || postMag < 0.1) {
      return null; // Not enough movement
    }

    // Normalize directions
    const preDir = { x: preDx / preMag, z: preDz / preMag };
    const postDir = { x: postDx / postMag, z: postDz / postMag };

    // Direction to target from exposure position
    const toTargetX = targetPosition.x - postFirst.x;
    const toTargetZ = targetPosition.z - postFirst.z;
    const toTargetMag = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ);
    
    if (toTargetMag < 0.1) return null;
    
    const toTarget = { x: toTargetX / toTargetMag, z: toTargetZ / toTargetMag };

    // Calculate alignment scores
    const preAlignment = preDir.x * toTarget.x + preDir.z * toTarget.z;
    const postAlignment = postDir.x * toTarget.x + postDir.z * toTarget.z;

    // DCI = change in alignment toward target
    const dci = postAlignment - preAlignment;

    return dci;
  }

  /**
   * Build near-corridor polygon for control matching
   * Buffer around SEZ edge, excluding SEZ interior
   */
  buildNearCorridorPolygon(sezPolygon, bufferM) {
    // Simple approximation: expand polygon by buffer
    // In production, use proper polygon buffering library
    const center = this.getPolygonCenter(sezPolygon);
    
    const bufferedPolygon = sezPolygon.map(p => {
      const dx = p.x - center.x;
      const dz = p.z - center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const scale = (dist + bufferM) / dist;
      return {
        x: center.x + dx * scale,
        z: center.z + dz * scale,
      };
    });

    return bufferedPolygon;
  }

  getPolygonCenter(polygon) {
    const sumX = polygon.reduce((s, p) => s + p.x, 0);
    const sumZ = polygon.reduce((s, p) => s + p.z, 0);
    return { x: sumX / polygon.length, z: sumZ / polygon.length };
  }

  /**
   * Batch load all positions for a time range (cached)
   */
  batchLoadPositions(venueId, startTs, endTs) {
    const cacheKey = `${venueId}:${startTs}:${endTs}`;
    if (this.positionCache.has(cacheKey)) {
      return this.positionCache.get(cacheKey);
    }

    console.log(`📊 [PEBLE] Batch loading positions ${startTs} - ${endTs}...`);
    const rows = this.db.prepare(`
      SELECT track_key, timestamp, position_x as x, position_z as z, velocity_x as vx, velocity_z as vz
      FROM track_positions
      WHERE venue_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY track_key, timestamp
    `).all(venueId, startTs, endTs);

    // Group by track
    const byTrack = new Map();
    for (const row of rows) {
      if (!byTrack.has(row.track_key)) {
        byTrack.set(row.track_key, []);
      }
      byTrack.get(row.track_key).push(row);
    }

    console.log(`📊 [PEBLE] Loaded ${rows.length} positions for ${byTrack.size} tracks`);
    this.positionCache.set(cacheKey, byTrack);
    return byTrack;
  }

  /**
   * Find candidate control tracks (OPTIMIZED - uses batch loaded data)
   */
  findControlCandidatesFast(venueId, screenId, exposureEvent, screen, params, allPositions, exposedTracksSet) {
    const nearCorridor = this.buildNearCorridorPolygon(screen.sezPolygon, params.near_corridor_buffer_m);
    const candidates = [];
    const bucketMs = params.match_time_bucket_min * 60 * 1000;
    const searchStart = exposureEvent.endTs - bucketMs / 2;
    const searchEnd = exposureEvent.endTs + bucketMs / 2;

    for (const [trackKey, positions] of allPositions) {
      if (exposedTracksSet.has(trackKey)) continue;

      // Filter to time window
      const relevantPositions = positions.filter(p => 
        p.timestamp >= searchStart && p.timestamp <= searchEnd
      );

      let corridorCrossing = null;
      let minDistToScreen = Infinity;

      for (const pos of relevantPositions) {
        const inCorridor = pointInPolygon(pos.x, pos.z, nearCorridor);
        const inSez = pointInPolygon(pos.x, pos.z, screen.sezPolygon);

        if (inCorridor && !inSez) {
          const dist = distance2D(pos.x, pos.z, screen.position.x, screen.position.z);
          if (dist < minDistToScreen) {
            minDistToScreen = dist;
            corridorCrossing = pos;
          }
        }
      }

      if (corridorCrossing) {
        candidates.push({
          trackKey,
          corridorCrossing,
          pseudoExposureTs: corridorCrossing.timestamp,
          distToScreen: minDistToScreen,
        });
      }
    }

    return candidates;
  }

  /**
   * Find candidate control tracks (original - kept for compatibility)
   */
  findControlCandidates(venueId, screenId, exposureEvent, screen, params) {
    const bucketMs = params.match_time_bucket_min * 60 * 1000;
    const bucketStart = Math.floor(exposureEvent.endTs / bucketMs) * bucketMs;
    const bucketEnd = bucketStart + bucketMs;

    // Get all tracks in the time bucket
    const allTracks = this.db.prepare(`
      SELECT DISTINCT track_key
      FROM track_positions
      WHERE venue_id = ? AND timestamp >= ? AND timestamp <= ?
    `).all(venueId, bucketStart, bucketEnd);

    // Filter out exposed track and tracks with their own exposure
    const exposedTracks = new Set();
    exposedTracks.add(exposureEvent.trackKey);

    // Get other exposed tracks in ±30s window
    const otherExposures = this.db.prepare(`
      SELECT DISTINCT track_key
      FROM dooh_exposure_events
      WHERE screen_id = ? 
        AND end_ts >= ? AND end_ts <= ?
    `).all(screenId, exposureEvent.endTs - 30000, exposureEvent.endTs + 30000);

    otherExposures.forEach(e => exposedTracks.add(e.track_key));

    // Build near-corridor polygon
    const nearCorridor = this.buildNearCorridorPolygon(screen.sezPolygon, params.near_corridor_buffer_m);

    const candidates = [];

    for (const track of allTracks) {
      if (exposedTracks.has(track.track_key)) continue;

      // Check if track crossed near-corridor
      const positions = this.getTrajectoryAroundTime(venueId, track.track_key, exposureEvent.endTs, bucketMs / 2);
      
      let corridorCrossing = null;
      let minDistToScreen = Infinity;

      for (const pos of positions) {
        // Check if in near-corridor but NOT in SEZ
        const inCorridor = pointInPolygon(pos.x, pos.z, nearCorridor);
        const inSez = pointInPolygon(pos.x, pos.z, screen.sezPolygon);

        if (inCorridor && !inSez) {
          const dist = distance2D(pos.x, pos.z, screen.position.x, screen.position.z);
          if (dist < minDistToScreen) {
            minDistToScreen = dist;
            corridorCrossing = pos;
          }
        }
      }

      if (corridorCrossing) {
        candidates.push({
          trackKey: track.track_key,
          corridorCrossing,
          pseudoExposureTs: corridorCrossing.timestamp,
          distToScreen: minDistToScreen,
        });
      }
    }

    return candidates;
  }

  /**
   * Match controls to exposed event using feature distance
   */
  matchControls(venueId, exposureEvent, candidates, screen, params) {
    if (candidates.length === 0) return [];

    // Get exposed track features at exposure time
    const exposedSamples = this.getTrajectoryAroundTime(
      venueId, 
      exposureEvent.trackKey, 
      exposureEvent.endTs, 
      2000
    );

    if (exposedSamples.length === 0) return [];

    // Calculate exposed features
    const exposedSpeed = this.calculateMeanSpeed(exposedSamples);
    const exposedHeading = this.calculateHeadingAtTime(exposedSamples, exposureEvent.endTs);

    // Get pre-zone context
    const exposedContext = this.shelfAdapter.queryPrePostContextForTrack(
      venueId, 
      exposureEvent.trackKey, 
      exposureEvent.endTs,
      params.pre_post_window_s
    );

    const matches = [];

    for (const candidate of candidates) {
      const controlSamples = this.getTrajectoryAroundTime(
        venueId,
        candidate.trackKey,
        candidate.pseudoExposureTs,
        2000
      );

      if (controlSamples.length === 0) continue;

      // Calculate control features
      const controlSpeed = this.calculateMeanSpeed(controlSamples);
      const controlHeading = this.calculateHeadingAtTime(controlSamples, candidate.pseudoExposureTs);
      
      const controlContext = this.shelfAdapter.queryPrePostContextForTrack(
        venueId,
        candidate.trackKey,
        candidate.pseudoExposureTs,
        params.pre_post_window_s
      );

      // Hard filters
      // Same heading bin (+/- tolerance)
      const headingDiff = Math.abs(exposedHeading - controlHeading);
      const headingDiffWrapped = Math.min(headingDiff, params.heading_bins - headingDiff);
      if (headingDiffWrapped > params.heading_tolerance) continue;

      // Speed within tolerance
      const speedRatio = Math.abs(exposedSpeed - controlSpeed) / (exposedSpeed + 0.1);
      if (speedRatio > params.speed_tolerance) continue;

      // Same preZone if available
      if (exposedContext.preZone && controlContext.preZone) {
        if (exposedContext.preZone !== controlContext.preZone) continue;
      }

      // Calculate matching distance
      const timeDelta = Math.abs(candidate.pseudoExposureTs - exposureEvent.endTs) / 1000;
      const distance = 
        params.w_time * (timeDelta / (params.match_time_bucket_min * 60)) +
        params.w_heading * (headingDiffWrapped / params.heading_bins) +
        params.w_speed * speedRatio;

      matches.push({
        ...candidate,
        matchDistance: distance,
        controlSpeed,
        controlHeading,
        controlContext,
      });
    }

    // Sort by distance and take top M
    matches.sort((a, b) => a.matchDistance - b.matchDistance);
    return matches.slice(0, params.control_matches_M);
  }

  /**
   * Match controls using batch-loaded positions (OPTIMIZED)
   */
  matchControlsFast(venueId, exposureEvent, candidates, screen, params, allPositions) {
    if (candidates.length === 0) return [];

    // Get exposed track samples from cache
    const exposedPositions = allPositions.get(exposureEvent.trackKey) || [];
    const exposedSamples = exposedPositions.filter(p => 
      Math.abs(p.timestamp - exposureEvent.endTs) <= 2000
    );

    if (exposedSamples.length === 0) return [];

    const exposedSpeed = this.calculateMeanSpeed(exposedSamples);
    const exposedHeading = this.calculateHeadingAtTime(exposedSamples, exposureEvent.endTs);

    const matches = [];

    for (const candidate of candidates) {
      const controlPositions = allPositions.get(candidate.trackKey) || [];
      const controlSamples = controlPositions.filter(p => 
        Math.abs(p.timestamp - candidate.pseudoExposureTs) <= 2000
      );

      if (controlSamples.length === 0) continue;

      const controlSpeed = this.calculateMeanSpeed(controlSamples);
      const controlHeading = this.calculateHeadingAtTime(controlSamples, candidate.pseudoExposureTs);

      // Hard filters
      const headingDiff = Math.abs(exposedHeading - controlHeading);
      const headingDiffWrapped = Math.min(headingDiff, params.heading_bins - headingDiff);
      if (headingDiffWrapped > params.heading_tolerance) continue;

      const speedRatio = Math.abs(exposedSpeed - controlSpeed) / (exposedSpeed + 0.1);
      if (speedRatio > params.speed_tolerance) continue;

      // Calculate matching distance
      const timeDelta = Math.abs(candidate.pseudoExposureTs - exposureEvent.endTs) / 1000;
      const distance = 
        params.w_time * (timeDelta / (params.match_time_bucket_min * 60)) +
        params.w_heading * (headingDiffWrapped / params.heading_bins) +
        params.w_speed * speedRatio;

      matches.push({
        ...candidate,
        matchDistance: distance,
        controlSpeed,
        controlHeading,
      });
    }

    matches.sort((a, b) => a.matchDistance - b.matchDistance);
    return matches.slice(0, params.control_matches_M);
  }

  /**
   * Calculate DCI using batch-loaded positions (OPTIMIZED)
   */
  calculateDCIFast(trackKey, exposureEndTs, targetPosition, allPositions, windowS = 10) {
    const positions = allPositions.get(trackKey) || [];
    if (positions.length < 4) return null;

    const preStart = exposureEndTs - (windowS * 1000);
    const postEnd = exposureEndTs + (windowS * 1000);

    const preSamples = positions.filter(p => p.timestamp >= preStart && p.timestamp < exposureEndTs);
    const postSamples = positions.filter(p => p.timestamp >= exposureEndTs && p.timestamp <= postEnd);

    if (preSamples.length < 2 || postSamples.length < 2) return null;

    const preFirst = preSamples[0];
    const preLast = preSamples[preSamples.length - 1];
    const preDx = preLast.x - preFirst.x;
    const preDz = preLast.z - preFirst.z;
    const preMag = Math.sqrt(preDx * preDx + preDz * preDz);

    const postFirst = postSamples[0];
    const postLast = postSamples[postSamples.length - 1];
    const postDx = postLast.x - postFirst.x;
    const postDz = postLast.z - postFirst.z;
    const postMag = Math.sqrt(postDx * postDx + postDz * postDz);

    if (preMag < 0.1 || postMag < 0.1) return null;

    const preDir = { x: preDx / preMag, z: preDz / preMag };
    const postDir = { x: postDx / postMag, z: postDz / postMag };

    const toTargetX = targetPosition.x - postFirst.x;
    const toTargetZ = targetPosition.z - postFirst.z;
    const toTargetMag = Math.sqrt(toTargetX * toTargetX + toTargetZ * toTargetZ);
    
    if (toTargetMag < 0.1) return null;
    
    const toTarget = { x: toTargetX / toTargetMag, z: toTargetZ / toTargetMag };

    const preAlign = preDir.x * toTarget.x + preDir.z * toTarget.z;
    const postAlign = postDir.x * toTarget.x + postDir.z * toTarget.z;

    return postAlign - preAlign;
  }

  calculateMeanSpeed(samples) {
    if (samples.length === 0) return 0;
    
    let totalSpeed = 0;
    for (const s of samples) {
      const speed = Math.sqrt((s.vx || 0) ** 2 + (s.vz || 0) ** 2);
      totalSpeed += speed;
    }
    return totalSpeed / samples.length;
  }

  calculateHeadingAtTime(samples, timestamp) {
    // Find closest sample
    let closest = samples[0];
    let minDiff = Math.abs(samples[0].timestamp - timestamp);

    for (const s of samples) {
      const diff = Math.abs(s.timestamp - timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closest = s;
      }
    }

    return this.getHeadingBin(closest.vx || 0, closest.vz || 0);
  }

  /**
   * Get target shelf position for DCI calculation
   */
  getTargetPosition(venueId, target) {
    if (target.type === 'shelf' && target.ids.length > 0) {
      const shelf = this.db.prepare(`
        SELECT position_x, position_z FROM venue_objects 
        WHERE id = ? AND venue_id = ?
      `).get(target.ids[0], venueId);

      if (shelf) {
        return { x: shelf.position_x, z: shelf.position_z };
      }
    }

    // Find any shelf with target category/brand/sku
    const shelfIds = this.shelfAdapter.findShelvesForTarget(venueId, target.type, target.ids);
    if (shelfIds.length > 0) {
      const shelf = this.db.prepare(`
        SELECT position_x, position_z FROM venue_objects WHERE id = ?
      `).get(shelfIds[0]);

      if (shelf) {
        return { x: shelf.position_x, z: shelf.position_z };
      }
    }

    return null;
  }

  /**
   * Run attribution analysis for a campaign (OPTIMIZED)
   */
  async run(venueId, campaignId, startTs, endTs) {
    const runStart = Date.now();
    console.log(`\n🚀 [PEBLE] Starting attribution analysis...`);
    console.log(`📅 Time range: ${new Date(startTs).toISOString()} - ${new Date(endTs).toISOString()}`);

    // Clear caches for fresh run
    this.clearCaches();

    const campaign = this.getCampaign(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    if (!campaign.enabled) {
      throw new Error(`Campaign ${campaignId} is disabled`);
    }

    const params = campaign.params;
    const target = campaign.target;
    const actionWindowMs = params.action_window_minutes * 60 * 1000;
    const bucketMs = params.match_time_bucket_min * 60 * 1000;

    console.log(`🎯 Campaign: ${campaign.name}`);
    console.log(`📺 Screens: ${campaign.screenIds.length}`);
    console.log(`🎯 Target: ${target.type} = ${target.ids.join(', ')}`);

    // Get target position for DCI
    const targetPosition = this.getTargetPosition(venueId, target);
    console.log(`📍 Target position: ${targetPosition ? `(${targetPosition.x.toFixed(1)}, ${targetPosition.z.toFixed(1)})` : 'N/A'}`);

    // Load exposure events
    const exposureEvents = this.getExposureEvents(
      venueId,
      campaign.screenIds,
      startTs,
      endTs,
      params.aqs_min_for_exposed
    );
    console.log(`👀 Exposure events found: ${exposureEvents.length}`);

    if (exposureEvents.length === 0) {
      console.log(`⚠️ No exposure events found - nothing to analyze`);
      return { attributionEvents: [], kpis: null };
    }

    // OPTIMIZATION: Batch load ALL positions for the time range
    const paddedStart = startTs - bucketMs;
    const paddedEnd = endTs + actionWindowMs + bucketMs;
    const allPositions = this.batchLoadPositions(venueId, paddedStart, paddedEnd);

    // OPTIMIZATION: Pre-build exposed tracks set
    const exposedTracksSet = new Set(exposureEvents.map(e => e.trackKey));
    console.log(`🚶 Unique exposed tracks: ${exposedTracksSet.size}`);

    const attributionEvents = [];
    const controlMatches = [];
    let processed = 0;
    const logInterval = Math.max(1, Math.floor(exposureEvents.length / 10));

    for (const exposure of exposureEvents) {
      processed++;
      if (processed % logInterval === 0 || processed === exposureEvents.length) {
        const pct = ((processed / exposureEvents.length) * 100).toFixed(0);
        const elapsed = ((Date.now() - runStart) / 1000).toFixed(1);
        console.log(`⏳ [PEBLE] Progress: ${processed}/${exposureEvents.length} (${pct}%) - ${elapsed}s elapsed`);
      }

      const screen = this.getScreen(exposure.screenId);
      if (!screen) continue;

      // Determine conversion outcome
      const actionWindowEnd = exposure.endTs + actionWindowMs;
      const engagement = this.shelfAdapter.queryEngagementsForTrack(
        venueId,
        exposure.trackKey,
        exposure.endTs,
        actionWindowEnd,
        target
      );

      const converted = engagement !== null;
      const ttaS = converted ? (engagement.startTs - exposure.endTs) / 1000 : null;

      // Calculate DCI (skip if no target position to save time)
      let dciValue = null;
      if (targetPosition && allPositions.has(exposure.trackKey)) {
        dciValue = this.calculateDCIFast(exposure.trackKey, exposure.endTs, targetPosition, allPositions);
      }

      // Get context
      const context = this.shelfAdapter.queryPrePostContextForTrack(
        venueId,
        exposure.trackKey,
        exposure.endTs,
        params.pre_post_window_s
      );

      // Build outcome JSON
      const outcomeJson = converted ? {
        targetType: target.type,
        targetId: engagement.matchedId,
        engaged: true,
        engagement: {
          dwell_s: engagement.dwellS,
          effective_dwell_s: engagement.effectiveDwellS,
          micro_wander: 0,
          engagementStrength: engagement.engagementStrength,
          skuId: engagement.skuId || null,
          categoryId: engagement.categoryId || null,
          brandId: engagement.brandId || null,
          slotId: engagement.slotId || null,
        },
        postExposurePath: context,
      } : {
        targetType: target.type,
        targetId: target.ids[0],
        engaged: false,
        postExposurePath: context,
      };

      // Find and match controls (OPTIMIZED)
      const candidates = this.findControlCandidatesFast(venueId, exposure.screenId, exposure, screen, params, allPositions, exposedTracksSet);
      const matched = this.matchControlsFast(venueId, exposure, candidates, screen, params, allPositions);

      // Evaluate control outcomes
      const matchedControls = [];
      for (const ctrl of matched) {
        const ctrlActionEnd = ctrl.pseudoExposureTs + actionWindowMs;
        const ctrlEngagement = this.shelfAdapter.queryEngagementsForTrack(
          venueId,
          ctrl.trackKey,
          ctrl.pseudoExposureTs,
          ctrlActionEnd,
          target
        );

        const ctrlConverted = ctrlEngagement !== null;
        const ctrlTtaS = ctrlConverted ? (ctrlEngagement.startTs - ctrl.pseudoExposureTs) / 1000 : null;

        let ctrlDci = null;
        if (targetPosition && allPositions.has(ctrl.trackKey)) {
          ctrlDci = this.calculateDCIFast(ctrl.trackKey, ctrl.pseudoExposureTs, targetPosition, allPositions);
        }

        const ctrlOutcome = ctrlConverted ? {
          targetType: target.type,
          targetId: ctrlEngagement.matchedId,
          engaged: true,
          engagement: {
            dwell_s: ctrlEngagement.dwellS,
            effective_dwell_s: ctrlEngagement.effectiveDwellS,
            engagementStrength: ctrlEngagement.engagementStrength,
          },
        } : {
          engaged: false,
        };

        const controlMatchId = uuidv4();
        matchedControls.push({
          id: controlMatchId,
          trackKey: ctrl.trackKey,
          pseudoExposureTs: ctrl.pseudoExposureTs,
          matchDistance: ctrl.matchDistance,
          outcome: ctrlOutcome,
          converted: ctrlConverted ? 1 : 0,
          ttaS: ctrlTtaS,
          dciValue: ctrlDci,
        });
      }

      // Calculate confidence
      const controlsFound = matchedControls.length;
      let confidence = Math.min(1, controlsFound / params.control_matches_M);
      
      // Degrade if average match distance is high
      if (matchedControls.length > 0) {
        const avgDist = matchedControls.reduce((s, m) => s + m.matchDistance, 0) / matchedControls.length;
        confidence *= Math.exp(-avgDist);
      }

      // Floor confidence if minimum controls not met
      if (controlsFound < params.min_controls_required) {
        confidence = Math.min(confidence, params.confidence_floor);
      }

      const attributionEventId = uuidv4();
      attributionEvents.push({
        id: attributionEventId,
        venueId,
        campaignId,
        screenId: exposure.screenId,
        exposureEventId: exposure.id,
        trackKey: exposure.trackKey,
        exposureStartTs: exposure.startTs,
        exposureEndTs: exposure.endTs,
        aqs: exposure.aqs,
        tier: exposure.tier,
        contextJson: context,
        outcomeJson,
        converted: converted ? 1 : 0,
        ttaS,
        dciValue,
        confidence,
      });

      // Link controls to this event
      for (const ctrl of matchedControls) {
        controlMatches.push({
          ...ctrl,
          attributionEventId,
        });
      }
    }

    // Persist results
    console.log(`💾 [PEBLE] Storing ${attributionEvents.length} attribution events...`);
    this.storeAttributionEvents(attributionEvents);
    this.storeControlMatches(controlMatches);

    const totalTime = ((Date.now() - runStart) / 1000).toFixed(1);
    const convertedCount = attributionEvents.filter(e => e.converted).length;
    const conversionRate = exposureEvents.length > 0 ? ((convertedCount / exposureEvents.length) * 100).toFixed(1) : 0;

    console.log(`\n✅ [PEBLE] Attribution analysis complete!`);
    console.log(`📊 Results:`);
    console.log(`   - Exposure events: ${exposureEvents.length}`);
    console.log(`   - Attribution events: ${attributionEvents.length}`);
    console.log(`   - Control matches: ${controlMatches.length}`);
    console.log(`   - Conversions: ${convertedCount} (${conversionRate}%)`);
    console.log(`   - Total time: ${totalTime}s\n`);

    return {
      campaign: campaign.name,
      exposureEvents: exposureEvents.length,
      attributionEvents: attributionEvents.length,
      controlMatches: controlMatches.length,
      converted: convertedCount,
      conversionRate: parseFloat(conversionRate),
      totalTimeS: parseFloat(totalTime),
    };
  }

  /**
   * Store attribution events
   */
  storeAttributionEvents(events) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO dooh_attribution_events (
        id, venue_id, campaign_id, screen_id, exposure_event_id, track_key,
        exposure_start_ts, exposure_end_ts, aqs, tier, context_json,
        outcome_json, converted, tta_s, dci_value, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const insertMany = this.db.transaction((evts) => {
      for (const e of evts) {
        stmt.run(
          e.id, e.venueId, e.campaignId, e.screenId, e.exposureEventId, e.trackKey,
          e.exposureStartTs, e.exposureEndTs, e.aqs, e.tier,
          JSON.stringify(e.contextJson),
          JSON.stringify(e.outcomeJson),
          e.converted, e.ttaS, e.dciValue, e.confidence
        );
      }
    });

    insertMany(events);
  }

  /**
   * Store control matches
   */
  storeControlMatches(matches) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO dooh_control_matches (
        id, attribution_event_id, control_track_key, pseudo_exposure_ts,
        match_distance, control_outcome_json, control_converted, 
        control_tta_s, control_dci_value, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const insertMany = this.db.transaction((ms) => {
      for (const m of ms) {
        stmt.run(
          m.id, m.attributionEventId, m.trackKey, m.pseudoExposureTs,
          m.matchDistance, JSON.stringify(m.outcome),
          m.converted, m.ttaS, m.dciValue
        );
      }
    });

    insertMany(matches);
  }

  /**
   * Aggregate KPIs for a campaign
   */
  aggregateKPIs(venueId, campaignId, startTs, endTs, bucketMinutes = 15) {
    const bucketMs = bucketMinutes * 60 * 1000;

    // Get attribution events
    const events = this.db.prepare(`
      SELECT * FROM dooh_attribution_events
      WHERE venue_id = ? AND campaign_id = ?
        AND exposure_end_ts >= ? AND exposure_end_ts <= ?
      ORDER BY exposure_end_ts ASC
    `).all(venueId, campaignId, startTs, endTs);

    // Group by bucket
    const buckets = new Map();

    for (const event of events) {
      const bucketStart = Math.floor(event.exposure_end_ts / bucketMs) * bucketMs;
      
      if (!buckets.has(bucketStart)) {
        buckets.set(bucketStart, {
          exposed: [],
          controls: [],
        });
      }

      const bucket = buckets.get(bucketStart);
      bucket.exposed.push({
        converted: event.converted === 1,
        ttaS: event.tta_s,
        aqs: event.aqs,
        dci: event.dci_value,
        confidence: event.confidence,
        outcomeJson: event.outcome_json ? JSON.parse(event.outcome_json) : null,
      });

      // Get controls for this event
      const controls = this.db.prepare(`
        SELECT * FROM dooh_control_matches WHERE attribution_event_id = ?
      `).all(event.id);

      for (const ctrl of controls) {
        bucket.controls.push({
          converted: ctrl.control_converted === 1,
          ttaS: ctrl.control_tta_s,
          dci: ctrl.control_dci_value,
          outcomeJson: ctrl.control_outcome_json ? JSON.parse(ctrl.control_outcome_json) : null,
        });
      }
    }

    // Calculate KPIs per bucket
    const kpis = [];

    for (const [bucketStart, bucket] of buckets) {
      const exposedCount = bucket.exposed.length;
      const controlsCount = bucket.controls.length;

      if (exposedCount === 0) continue;

      const exposedConverted = bucket.exposed.filter(e => e.converted).length;
      const controlsConverted = bucket.controls.filter(c => c.converted).length;

      const pExposed = exposedCount > 0 ? exposedConverted / exposedCount : 0;
      const pControl = controlsCount > 0 ? controlsConverted / controlsCount : 0;

      const liftAbs = pExposed - pControl;
      const liftRel = pControl > 0 ? liftAbs / pControl : (pExposed > 0 ? 1 : 0);

      // Median TTA
      const exposedTtas = bucket.exposed.filter(e => e.ttaS !== null).map(e => e.ttaS).sort((a, b) => a - b);
      const controlTtas = bucket.controls.filter(c => c.ttaS !== null).map(c => c.ttaS).sort((a, b) => a - b);

      const medianTtaExposed = this.median(exposedTtas);
      const medianTtaControl = this.median(controlTtas);
      const ttaAccel = medianTtaControl > 0 ? medianTtaControl / (medianTtaExposed || medianTtaControl) : 1;

      // Engagement dwell
      const exposedDwells = bucket.exposed
        .filter(e => e.outcomeJson?.engagement?.effective_dwell_s)
        .map(e => e.outcomeJson.engagement.effective_dwell_s);
      const controlDwells = bucket.controls
        .filter(c => c.outcomeJson?.engagement?.effective_dwell_s)
        .map(c => c.outcomeJson.engagement.effective_dwell_s);

      const meanDwellExposed = this.mean(exposedDwells);
      const meanDwellControl = this.mean(controlDwells);
      const engagementLiftS = meanDwellExposed - meanDwellControl;

      // Mean AQS
      const meanAqs = this.mean(bucket.exposed.map(e => e.aqs));

      // Mean DCI
      const exposedDcis = bucket.exposed.filter(e => e.dci !== null).map(e => e.dci);
      const controlDcis = bucket.controls.filter(c => c.dci !== null).map(c => c.dci);
      const meanDciExposed = this.mean(exposedDcis);
      const meanDciControl = this.mean(controlDcis);

      // Confidence mean
      const confidenceMean = this.mean(bucket.exposed.map(e => e.confidence));

      // CES calculation
      const sLift = Math.min(1, Math.max(0, liftRel / 0.5));
      const sTta = 1 - Math.exp(-Math.max(ttaAccel - 1, 0) / 1.0);
      const sEng = 1 - Math.exp(-Math.max(engagementLiftS, 0) / 10.0);
      const cesScore = 100 * confidenceMean * (0.55 * sLift + 0.25 * sTta + 0.20 * sEng);

      // AAR: Attention-to-Action Rate (conversions / qualified exposures)
      const qualifiedExposures = bucket.exposed.filter(e => e.aqs >= 40).length;
      const aarScore = qualifiedExposures > 0 ? (exposedConverted / qualifiedExposures) * 100 : 0;

      const kpi = {
        id: uuidv4(),
        venueId,
        campaignId,
        bucketStartTs: bucketStart,
        bucketMinutes,
        exposedCount,
        controlsCount,
        pExposed,
        pControl,
        liftAbs,
        liftRel,
        medianTtaExposed,
        medianTtaControl,
        ttaAccel,
        meanEngagementDwellExposed: meanDwellExposed,
        meanEngagementDwellControl: meanDwellControl,
        engagementLiftS,
        meanAqsExposed: meanAqs,
        meanDciExposed,
        meanDciControl,
        confidenceMean,
        cesScore,
        aarScore,
      };

      kpis.push(kpi);
    }

    // Store KPIs
    this.storeKPIs(kpis);

    return kpis;
  }

  median(arr) {
    if (arr.length === 0) return null;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }

  mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  storeKPIs(kpis) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO dooh_campaign_kpis (
        id, venue_id, campaign_id, bucket_start_ts, bucket_minutes,
        exposed_count, controls_count, p_exposed, p_control,
        lift_abs, lift_rel, median_tta_exposed, median_tta_control, tta_accel,
        mean_engagement_dwell_exposed, mean_engagement_dwell_control, engagement_lift_s,
        mean_aqs_exposed, mean_dci_exposed, mean_dci_control,
        confidence_mean, ces_score, aar_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const insertMany = this.db.transaction((ks) => {
      for (const k of ks) {
        stmt.run(
          k.id, k.venueId, k.campaignId, k.bucketStartTs, k.bucketMinutes,
          k.exposedCount, k.controlsCount, k.pExposed, k.pControl,
          k.liftAbs, k.liftRel, k.medianTtaExposed, k.medianTtaControl, k.ttaAccel,
          k.meanEngagementDwellExposed, k.meanEngagementDwellControl, k.engagementLiftS,
          k.meanAqsExposed, k.meanDciExposed, k.meanDciControl,
          k.confidenceMean, k.cesScore, k.aarScore
        );
      }
    });

    insertMany(kpis);
  }

  /**
   * Get summary KPIs for a campaign
   */
  getSummaryKPIs(venueId, campaignId, startTs, endTs) {
    const row = this.db.prepare(`
      SELECT 
        SUM(exposed_count) as total_exposed,
        SUM(controls_count) as total_controls,
        AVG(p_exposed) as avg_p_exposed,
        AVG(p_control) as avg_p_control,
        AVG(lift_rel) as avg_lift_rel,
        AVG(median_tta_exposed) as avg_tta_exposed,
        AVG(median_tta_control) as avg_tta_control,
        AVG(tta_accel) as avg_tta_accel,
        AVG(engagement_lift_s) as avg_engagement_lift,
        AVG(mean_aqs_exposed) as avg_aqs,
        AVG(mean_dci_exposed) as avg_dci_exposed,
        AVG(mean_dci_control) as avg_dci_control,
        AVG(confidence_mean) as avg_confidence,
        AVG(ces_score) as avg_ces,
        AVG(aar_score) as avg_aar
      FROM dooh_campaign_kpis
      WHERE venue_id = ? AND campaign_id = ?
        AND bucket_start_ts >= ? AND bucket_start_ts <= ?
    `).get(venueId, campaignId, startTs, endTs);

    return {
      totalExposed: row.total_exposed || 0,
      totalControls: row.total_controls || 0,
      eal: row.avg_lift_rel || 0,
      pExposed: row.avg_p_exposed || 0,
      pControl: row.avg_p_control || 0,
      ttaExposed: row.avg_tta_exposed,
      ttaControl: row.avg_tta_control,
      ttaAccel: row.avg_tta_accel || 1,
      engagementLift: row.avg_engagement_lift || 0,
      aqs: row.avg_aqs || 0,
      dciExposed: row.avg_dci_exposed,
      dciControl: row.avg_dci_control,
      confidence: row.avg_confidence || 0,
      ces: row.avg_ces || 0,
      aar: row.avg_aar || 0,
    };
  }
}

export default DoohAttributionEngine;
