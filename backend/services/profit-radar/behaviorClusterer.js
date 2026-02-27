/**
 * BehaviorClusterer — groups tracks by trajectory similarity (journey fingerprint).
 * Clusters are NOT based on spatial proximity; instead they group people with
 * similar journey patterns: same journey type, dominant intent axis, zone set,
 * and comparable stop/dwell characteristics.
 * Emits at 0.5Hz alongside zone field data.
 */

import { AXIS_NAMES } from './intentScorer.js';

function dist2D(a, b) { return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2); }

/** Sample every Nth point from trail to reduce PIP test count */
function sampleTrail(trail, step = 20) {
  if (!trail || trail.length <= step) return trail;
  const sampled = [];
  for (let i = 0; i < trail.length; i += step) sampled.push(trail[i]);
  // Always include last point
  if (sampled[sampled.length - 1] !== trail[trail.length - 1]) sampled.push(trail[trail.length - 1]);
  return sampled;
}

function getDominantAxis(axes) {
  let best = AXIS_NAMES[0], max = 0;
  for (const a of AXIS_NAMES) {
    if ((axes[a] || 0) > max) { max = axes[a]; best = a; }
  }
  return best;
}

function classifyJourney(trail, rois) {
  if (!trail || trail.length < 5) return 'quick-run';
  const zonesVisited = new Set();
  let stopCount = 0;
  let totalDwell = 0;

  for (let i = 1; i < trail.length; i++) {
    const d = dist2D(trail[i], trail[i - 1]);
    const speed = d / 0.1;
    if (speed < 0.1) { stopCount++; totalDwell += 0.1; }
  }

  // Use sampled trail for PIP tests (zone membership doesn't need per-point precision)
  const sampled = sampleTrail(trail);
  if (rois && rois.length > 0) {
    for (const pt of sampled) {
      for (const roi of rois) {
        if (pointInPoly(pt, roi.vertices)) { zonesVisited.add(roi.id); break; }
      }
    }
  }

  const zoneCount = zonesVisited.size;
  if (zoneCount <= 1 && totalDwell < 3) return 'quick-run';
  if (zoneCount <= 2 && totalDwell > 5) return 'category-specialist';
  if (zoneCount >= 4) return 'full-shop';
  if (totalDwell < 2 && zoneCount >= 2) return 'browse-and-bail';
  return 'quick-run';
}

function pointInPoly(point, vertices) {
  if (!vertices || vertices.length < 3) return false;
  let inside = false;
  const x = point.x, z = point.z;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x, zi = vertices[i].z;
    const xj = vertices[j].x, zj = vertices[j].z;
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function getZoneSequence(trail, rois) {
  if (!trail || !rois || rois.length === 0) return [];
  const seq = [];
  let lastZone = null;
  for (const pt of trail) {
    for (const roi of rois) {
      if (pointInPoly(pt, roi.vertices)) {
        if (roi.id !== lastZone) {
          seq.push({ roiId: roi.id, roiName: roi.name });
          lastZone = roi.id;
        }
        break;
      }
    }
  }
  return seq;
}

/** Bucket a number into coarse ranges for fingerprint matching */
function bucket(val, size) { return Math.floor(val / size); }

/**
 * Build a trajectory fingerprint string for a track.
 * Tracks with the same fingerprint are considered behaviourally similar.
 */
function buildFingerprint(trail, axes, rois) {
  const dominant = getDominantAxis(axes);
  const journeyType = classifyJourney(trail, rois);

  // Zone set (sorted IDs visited — order-independent, sampled for performance)
  const zonesVisited = new Set();
  if (rois && rois.length > 0 && trail) {
    const sampled = sampleTrail(trail);
    for (const pt of sampled) {
      for (const roi of rois) {
        if (pointInPoly(pt, roi.vertices)) { zonesVisited.add(roi.id); break; }
      }
    }
  }
  const zoneKey = [...zonesVisited].sort().join(',') || 'none';

  // Stop / dwell buckets
  let stops = 0, dwell = 0;
  if (trail) {
    for (let i = 1; i < trail.length; i++) {
      if (dist2D(trail[i], trail[i - 1]) / 0.1 < 0.1) { stops++; dwell += 0.1; }
    }
  }
  const stopBucket = bucket(stops, 3);   // groups of ~3 stops
  const dwellBucket = bucket(dwell, 2);  // groups of ~2 seconds

  return `${journeyType}|${dominant}|${zoneKey}|s${stopBucket}|d${dwellBucket}`;
}

export class BehaviorClusterer {
  constructor(intentScorer) {
    this.intentScorer = intentScorer;
    this.rois = [];
    this.clusters = [];
    this.interval = null;
  }

  setRois(rois) {
    this.rois = (rois || []).map(r => {
      let verts = r.vertices;
      if (typeof verts === 'string') {
        try { verts = JSON.parse(verts); } catch { verts = []; }
      }
      return { id: r.id, name: r.name, color: r.color, vertices: verts };
    });
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 30000); // 0.033Hz (behaviour patterns change slowly)
    console.log('📡 BehaviorClusterer started (0.033Hz / 30s, trajectory-similarity)');
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.clusters = [];
  }

  tick() {
    const _t0 = Date.now();
    const trackAxes = this.intentScorer.getTrackAxes();
    if (!trackAxes || trackAxes.size === 0) { this.clusters = []; return; }

    // Limit tracks processed per tick to prevent event loop blocking
    // 200 tracks × 133 ROIs × multiple PIP passes = millions of PIP tests
    const MAX_TRACKS = 50;
    const entries = [...trackAxes.entries()];
    const sample = entries.length <= MAX_TRACKS ? entries
      : entries.filter((_, i) => i % Math.ceil(entries.length / MAX_TRACKS) === 0).slice(0, MAX_TRACKS);

    // Build fingerprint per track and group by fingerprint
    const fpGroups = new Map(); // fingerprint -> [{ trackKey, position, axes, trail }]
    for (const [trackKey, data] of sample) {
      const fp = buildFingerprint(data.trail, data.axes, this.rois);
      if (!fpGroups.has(fp)) fpGroups.set(fp, []);
      fpGroups.get(fp).push({
        trackKey,
        position: data.position,
        axes: data.axes,
        trail: data.trail,
      });
    }

    const newClusters = [];
    let clusterId = 0;

    for (const [fp, members] of fpGroups) {
      if (members.length < 2) continue; // Need ≥2 tracks for a cluster

      const dominant = getDominantAxis(members[0].axes);

      // Aggregate axes means
      const meanAxes = {};
      for (const a of AXIS_NAMES) {
        meanAxes[a] = members.reduce((s, m) => s + (m.axes[a] || 0), 0) / members.length;
      }

      // Trajectory enrichment
      const trajectoryCtx = this._enrichTrajectory(members);

      // Find anchor zone: the ROI where the most members currently are
      const { anchorZoneId, anchorZoneName, anchorPosition } = this._findAnchor(members);

      newClusters.push({
        id: `cluster-${clusterId++}`,
        dominant,
        dominantScore: meanAxes[dominant] || 0,
        memberCount: members.length,
        trackKeys: members.map(m => m.trackKey),
        meanAxes,
        trajectory: trajectoryCtx,
        anchorZoneId,
        anchorZoneName,
        anchorPosition,
      });
    }

    this.clusters = newClusters;
    const _elapsed = Date.now() - _t0;
    if (_elapsed > 50) console.warn(`⏱️ BehaviorClusterer.tick took ${_elapsed}ms (${sample.length}/${entries.length} tracks, ${this.rois.length} ROIs, ${newClusters.length} clusters)`);
  }

  /** Find the zone where the most cluster members currently are, for billboard placement */
  _findAnchor(members) {
    const zoneCounts = new Map(); // roiId -> { count, name, sumX, sumZ }
    for (const m of members) {
      for (const roi of this.rois) {
        if (pointInPoly(m.position, roi.vertices)) {
          const e = zoneCounts.get(roi.id) || { count: 0, name: roi.name, sumX: 0, sumZ: 0 };
          e.count++;
          e.sumX += m.position.x;
          e.sumZ += m.position.z;
          zoneCounts.set(roi.id, e);
          break;
        }
      }
    }

    if (zoneCounts.size === 0) {
      // Fallback: average position of all members
      const cx = members.reduce((s, m) => s + m.position.x, 0) / members.length;
      const cz = members.reduce((s, m) => s + m.position.z, 0) / members.length;
      return { anchorZoneId: null, anchorZoneName: null, anchorPosition: { x: cx, y: 0, z: cz } };
    }

    // Pick zone with most members
    let bestId = null, best = null;
    for (const [id, e] of zoneCounts) {
      if (!best || e.count > best.count) { bestId = id; best = e; }
    }

    return {
      anchorZoneId: bestId,
      anchorZoneName: best.name,
      anchorPosition: { x: best.sumX / best.count, y: 0, z: best.sumZ / best.count },
    };
  }

  _enrichTrajectory(clusterMembers) {
    let totalStops = 0;
    let totalDwell = 0;
    let totalDuration = 0;
    const allZones = new Set();
    const journeyTypes = {};
    // Aggregate per-zone dwell across members: zoneName → total dwell seconds
    const zoneDwellMap = new Map();

    for (const m of clusterMembers) {
      const trail = m.trail || [];
      let stops = 0, dwell = 0;
      for (let i = 1; i < trail.length; i++) {
        if (dist2D(trail[i], trail[i - 1]) / 0.1 < 0.1) { stops++; dwell += 0.1; }
      }
      totalStops += stops;
      totalDwell += dwell;
      totalDuration += trail.length * 0.1; // ~10Hz sample rate

      // Compute per-zone dwell for this member (use sampled trail for PIP performance)
      const sampledTrail = sampleTrail(trail);
      const sampleStep = trail.length > 5 ? Math.round(trail.length / sampledTrail.length) : 1;
      let currentZone = null;
      let zoneEnterIdx = 0;
      for (let i = 0; i < sampledTrail.length; i++) {
        let inZone = null;
        for (const roi of this.rois) {
          if (pointInPoly(sampledTrail[i], roi.vertices)) {
            inZone = roi.name || roi.id;
            break;
          }
        }
        if (inZone !== currentZone) {
          if (currentZone) {
            const dwellSec = (i - zoneEnterIdx) * sampleStep * 0.1;
            if (dwellSec >= 1) {
              const prev = zoneDwellMap.get(currentZone) || { totalDwell: 0, count: 0 };
              prev.totalDwell += dwellSec;
              prev.count += 1;
              zoneDwellMap.set(currentZone, prev);
            }
          }
          currentZone = inZone;
          zoneEnterIdx = i;
        }
      }
      if (currentZone) {
        const dwellSec = (sampledTrail.length - zoneEnterIdx) * sampleStep * 0.1;
        if (dwellSec >= 1) {
          const prev = zoneDwellMap.get(currentZone) || { totalDwell: 0, count: 0 };
          prev.totalDwell += dwellSec;
          prev.count += 1;
          zoneDwellMap.set(currentZone, prev);
        }
      }

      const seq = getZoneSequence(sampledTrail, this.rois);
      seq.forEach(z => allZones.add(z.roiName || z.roiId));

      const jt = classifyJourney(trail, this.rois);
      journeyTypes[jt] = (journeyTypes[jt] || 0) + 1;
    }

    const n = clusterMembers.length;
    const topJourney = Object.entries(journeyTypes).sort((a, b) => b[1] - a[1])[0];

    // Build ordered zone stops with average dwell
    const zoneStops = [];
    for (const [zoneName, data] of zoneDwellMap) {
      zoneStops.push({ zoneName, dwellSec: +(data.totalDwell / data.count).toFixed(1) });
    }
    zoneStops.sort((a, b) => b.dwellSec - a.dwellSec);


    return {
      avgStops: Math.round(totalStops / n),
      avgDwellSec: +(totalDwell / n).toFixed(1),
      totalDurationSec: +(totalDuration / n).toFixed(1),
      zonesVisited: [...allZones].slice(0, 5),
      zoneStops: zoneStops.slice(0, 6),
      journeyType: topJourney ? topJourney[0] : 'unknown',
    };
  }

  getClusters() { return this.clusters; }
}
