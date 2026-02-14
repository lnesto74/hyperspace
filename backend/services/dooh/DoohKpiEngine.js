/**
 * DOOH KPI Engine
 * 
 * Computes exposure events and Attention Quality Scores (AQS) for digital display screens
 * using LiDAR trajectory data only (no cameras).
 * 
 * Feature flag: FEATURE_DOOH_KPIS
 */

import { v4 as uuidv4 } from 'uuid';

// Default parameter values
export const DEFAULT_PARAMS = {
  // Timing/filtering
  T_min_seconds: 0.7,
  max_gap_seconds: 1.5,
  
  // Speed thresholds
  speed_attention_max_mps: 1.2,
  speed_stationary_max_mps: 0.35,
  speed_passby_max_mps: 2.0,
  slowdown_entry_window_s: 1.0,
  
  // Distance
  d_min_m: 0.8,
  d_max_m: 4.0,
  distance_percentile: 10,
  
  // SEZ Viewing Cone Geometry
  sez_reach_m: 15,           // How far the viewing cone extends (meters)
  sez_near_width_m: 2.0,     // Width at near edge
  sez_far_width_m: 12.0,     // Width at far edge (cone spread)
  
  // Orientation model
  heading_min_speed_mps: 0.2,
  standing_heading_default: 0.6,
  use_screen_normal_gate: true,
  
  // AQS model
  tau_d_seconds: 2.5,
  slowdown_gamma: 0.7,
  w_dwell: 0.35,
  w_proximity: 0.20,
  w_orientation: 0.20,
  w_slowdown: 0.15,
  w_stability: 0.10,
  AQS_qualified_min: 40,
  AQS_premium_min: 70,
  
  // Reporting
  report_interval_minutes: 15,
  visitor_reset_minutes: 45,
  
  // Context segmentation
  context_mode: 'roi',
  context_priority_json: ['queue', 'checkout', 'promo', 'aisle', 'entrance', 'exit', 'other'],
  pre_post_window_s: 30,
};

/**
 * Point-in-polygon test using ray casting algorithm
 */
export function pointInPolygon(px, pz, polygon) {
  if (!polygon || polygon.length < 3) return false;
  
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, zi = polygon[i].z;
    const xj = polygon[j].x, zj = polygon[j].z;
    
    if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Calculate distance between two points in xz plane
 */
export function distance2D(x1, z1, x2, z2) {
  return Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
}

/**
 * Normalize a 2D vector
 */
function normalize2D(x, z) {
  const mag = Math.sqrt(x * x + z * z);
  if (mag < 0.0001) return { x: 0, z: 0 };
  return { x: x / mag, z: z / mag };
}

/**
 * Dot product of two 2D vectors
 */
function dot2D(a, b) {
  return a.x * b.x + a.z * b.z;
}

/**
 * Clamp value between min and max
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate percentile of an array
 */
function percentile(arr, p) {
  if (!arr || arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

/**
 * Get screen normal vector from yaw_deg
 * Yaw = 0 means screen faces +Z, yaw = 90 means screen faces +X
 */
function getScreenNormal(yawDeg) {
  const rad = (yawDeg * Math.PI) / 180;
  return {
    x: Math.sin(rad),
    z: Math.cos(rad),
  };
}

export class DoohKpiEngine {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get all enabled screens for a venue
   */
  getScreensForVenue(venueId) {
    const rows = this.db.prepare(`
      SELECT * FROM dooh_screens WHERE venue_id = ? AND enabled = 1
    `).all(venueId);
    
    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      objectId: row.object_id,
      name: row.name,
      position: JSON.parse(row.position_json),
      yawDeg: row.yaw_deg,
      mountHeightM: row.mount_height_m,
      sezPolygon: JSON.parse(row.sez_polygon_json),
      azPolygon: row.az_polygon_json ? JSON.parse(row.az_polygon_json) : null,
      params: { ...DEFAULT_PARAMS, ...JSON.parse(row.params_json) },
      enabled: row.enabled === 1,
    }));
  }

  /**
   * Get trajectories from storage for a time range
   * Uses track_positions table populated by TrajectoryStorageService from simulator
   */
  getTrajectoriesForTimeRange(venueId, startTs, endTs) {
    // Query track_positions table (populated by TrajectoryStorageService from simulator)
    const rows = this.db.prepare(`
      SELECT 
        track_key,
        timestamp,
        position_x as x,
        position_z as z,
        SQRT(velocity_x * velocity_x + velocity_z * velocity_z) as speed
      FROM track_positions
      WHERE venue_id = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY track_key, timestamp
    `).all(venueId, startTs, endTs);

    // Group by track_key
    const tracks = new Map();
    for (const row of rows) {
      if (!tracks.has(row.track_key)) {
        tracks.set(row.track_key, []);
      }
      tracks.get(row.track_key).push({
        timestamp: row.timestamp,
        x: row.x,
        z: row.z,
        speed: row.speed || 0,
      });
    }

    return tracks;
  }

  /**
   * Compute exposure events for a single screen and track
   */
  computeExposureForTrack(screen, trackKey, samples) {
    const params = screen.params;
    const sez = screen.sezPolygon;
    const screenPos = screen.position;
    const screenNormal = getScreenNormal(screen.yawDeg);

    // Find segments where track is inside SEZ
    const segments = [];
    let currentSegment = null;

    for (const sample of samples) {
      const inSez = pointInPolygon(sample.x, sample.z, sez);
      
      if (inSez) {
        if (!currentSegment) {
          currentSegment = {
            startTs: sample.timestamp,
            endTs: sample.timestamp,
            samples: [sample],
          };
        } else {
          // Check for gap
          const gap = (sample.timestamp - currentSegment.endTs) / 1000;
          if (gap <= params.max_gap_seconds) {
            currentSegment.endTs = sample.timestamp;
            currentSegment.samples.push(sample);
          } else {
            // Close current segment and start new one
            segments.push(currentSegment);
            currentSegment = {
              startTs: sample.timestamp,
              endTs: sample.timestamp,
              samples: [sample],
            };
          }
        }
      } else {
        if (currentSegment) {
          segments.push(currentSegment);
          currentSegment = null;
        }
      }
    }
    
    if (currentSegment) {
      segments.push(currentSegment);
    }

    // Merge segments if gap is within max_gap_seconds
    const mergedSegments = [];
    for (const seg of segments) {
      if (mergedSegments.length === 0) {
        mergedSegments.push(seg);
      } else {
        const last = mergedSegments[mergedSegments.length - 1];
        const gap = (seg.startTs - last.endTs) / 1000;
        if (gap <= params.max_gap_seconds) {
          last.endTs = seg.endTs;
          last.samples = last.samples.concat(seg.samples);
        } else {
          mergedSegments.push(seg);
        }
      }
    }

    // Process each segment into exposure events
    const events = [];
    
    for (const seg of mergedSegments) {
      const duration = (seg.endTs - seg.startTs) / 1000;
      
      // Filter by minimum duration
      if (duration < params.T_min_seconds) continue;

      // Calculate metrics
      const distances = seg.samples.map(s => distance2D(s.x, s.z, screenPos.x, screenPos.z));
      const speeds = seg.samples.map(s => s.speed);
      
      const minDistance = Math.min(...distances);
      const p10Distance = percentile(distances, params.distance_percentile);
      const meanSpeed = speeds.reduce((a, b) => a + b, 0) / speeds.length;
      const minSpeed = Math.min(...speeds);

      // Calculate effective dwell (time spent at attention-eligible speed)
      let effectiveDwell = 0;
      for (let i = 1; i < seg.samples.length; i++) {
        if (seg.samples[i].speed <= params.speed_attention_max_mps) {
          const dt = (seg.samples[i].timestamp - seg.samples[i - 1].timestamp) / 1000;
          effectiveDwell += dt;
        }
      }

      // Calculate entry speed (first slowdown_entry_window_s)
      const entryWindowEnd = seg.startTs + params.slowdown_entry_window_s * 1000;
      const entrySamples = seg.samples.filter(s => s.timestamp <= entryWindowEnd);
      const entrySpeed = entrySamples.length > 0
        ? entrySamples.reduce((a, s) => a + s.speed, 0) / entrySamples.length
        : meanSpeed;

      // Calculate orientation score
      let orientationSum = 0;
      let orientationCount = 0;
      
      for (let i = 1; i < seg.samples.length; i++) {
        const s = seg.samples[i];
        const prev = seg.samples[i - 1];
        
        // Calculate heading vector
        let heading;
        if (s.speed >= params.heading_min_speed_mps) {
          const dx = s.x - prev.x;
          const dz = s.z - prev.z;
          heading = normalize2D(dx, dz);
        } else {
          // Use default standing heading
          heading = null;
        }

        // Vector from track to screen
        const toScreen = normalize2D(screenPos.x - s.x, screenPos.z - s.z);

        let o = 0;
        if (heading) {
          // Approach component: how much heading points toward screen
          const f = Math.max(0, dot2D(heading, toScreen));
          
          if (params.use_screen_normal_gate) {
            // In-front-of-screen component
            const negNormal = { x: -screenNormal.x, z: -screenNormal.z };
            const g = Math.max(0, dot2D(negNormal, toScreen));
            o = Math.sqrt(f * g);
          } else {
            o = f;
          }
        } else {
          // Standing: use default
          o = params.standing_heading_default * 0.7;
        }

        if (s.speed <= params.speed_attention_max_mps) {
          orientationSum += o;
          orientationCount++;
        }
      }

      const orientationScore = orientationCount > 0 
        ? orientationSum / orientationCount 
        : params.standing_heading_default * 0.7;

      // Calculate component scores
      const dEff = p10Distance || minDistance;
      
      // Dwell score: Sd = 1 - exp(-Te / tau_d)
      const dwellScore = 1 - Math.exp(-effectiveDwell / params.tau_d_seconds);
      
      // Proximity score: Sp = clamp((d_max - d_eff) / (d_max - d_min), 0, 1)
      const proximityScore = clamp(
        (params.d_max_m - dEff) / (params.d_max_m - params.d_min_m),
        0,
        1
      );
      
      // Slowdown score: Ss = r^gamma where r = (entry_speed - min_speed) / (entry_speed + 0.05)
      const r = clamp((entrySpeed - minSpeed) / (entrySpeed + 0.05), 0, 1);
      const slowdownScore = Math.pow(r, params.slowdown_gamma);
      
      // Stability score: St = 0.5 * F_stat + 0.5 * Sd
      const stationaryFraction = seg.samples.filter(s => s.speed < params.speed_stationary_max_mps).length / seg.samples.length;
      const stabilityScore = clamp(0.5 * stationaryFraction + 0.5 * dwellScore, 0, 1);

      // Calculate AQS
      const aqs = 100 * (
        params.w_dwell * dwellScore +
        params.w_proximity * proximityScore +
        params.w_orientation * orientationScore +
        params.w_slowdown * slowdownScore +
        params.w_stability * stabilityScore
      );

      // Determine tier
      let tier = 'low';
      if (aqs >= params.AQS_premium_min) {
        tier = 'premium';
      } else if (aqs >= params.AQS_qualified_min) {
        tier = 'qualified';
      }

      // Pass-by filter
      if (meanSpeed > params.speed_passby_max_mps && duration < 2) {
        tier = 'low';
      }

      events.push({
        id: uuidv4(),
        venueId: screen.venueId,
        screenId: screen.id,
        trackKey,
        startTs: seg.startTs,
        endTs: seg.endTs,
        durationS: duration,
        effectiveDwellS: effectiveDwell,
        minDistanceM: minDistance,
        p10DistanceM: p10Distance,
        meanSpeedMps: meanSpeed,
        minSpeedMps: minSpeed,
        entrySpeedMps: entrySpeed,
        orientationScore,
        proximityScore,
        dwellScore,
        slowdownScore,
        stabilityScore,
        aqs,
        tier,
        contextJson: null, // Will be filled by ContextResolver
        samples: seg.samples, // Keep for context resolution
      });
    }

    return events;
  }

  /**
   * Store exposure events (idempotent)
   */
  storeExposureEvents(events) {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO dooh_exposure_events (
        id, venue_id, screen_id, track_key, start_ts, end_ts,
        duration_s, effective_dwell_s, min_distance_m, p10_distance_m,
        mean_speed_mps, min_speed_mps, entry_speed_mps,
        orientation_score, proximity_score, dwell_score, slowdown_score, stability_score,
        aqs, tier, context_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const insertMany = this.db.transaction((evts) => {
      for (const e of evts) {
        insertStmt.run(
          e.id, e.venueId, e.screenId, e.trackKey, e.startTs, e.endTs,
          e.durationS, e.effectiveDwellS, e.minDistanceM, e.p10DistanceM,
          e.meanSpeedMps, e.minSpeedMps, e.entrySpeedMps,
          e.orientationScore, e.proximityScore, e.dwellScore, e.slowdownScore, e.stabilityScore,
          e.aqs, e.tier, e.contextJson ? JSON.stringify(e.contextJson) : null
        );
      }
    });

    insertMany(events);
    return events.length;
  }

  /**
   * Run exposure detection for a venue and time range
   */
  async run(venueId, startTs, endTs, screenIds = null) {
    const screens = this.getScreensForVenue(venueId);
    const filteredScreens = screenIds 
      ? screens.filter(s => screenIds.includes(s.id))
      : screens;

    if (filteredScreens.length === 0) {
      return { screens: 0, tracks: 0, events: 0 };
    }

    const tracks = this.getTrajectoriesForTimeRange(venueId, startTs, endTs);
    
    let totalEvents = 0;
    const allEvents = [];

    for (const screen of filteredScreens) {
      for (const [trackKey, samples] of tracks) {
        const events = this.computeExposureForTrack(screen, trackKey, samples);
        allEvents.push(...events);
      }
    }

    if (allEvents.length > 0) {
      totalEvents = this.storeExposureEvents(allEvents);
    }

    return {
      screens: filteredScreens.length,
      tracks: tracks.size,
      events: totalEvents,
    };
  }
}

export default DoohKpiEngine;
