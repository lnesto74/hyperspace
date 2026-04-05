/**
 * ZoneAggregator — aggregates intent axes per ROI zone.
 * Emits dominant axis, mean scores, and track counts per zone at 0.5Hz.
 */

import { AXIS_NAMES } from './intentScorer.js';

function pointInPolygon(point, vertices) {
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

export class ZoneAggregator {
  constructor(intentScorer) {
    this.intentScorer = intentScorer;
    this.rois = []; // [{id, name, vertices, color}]
    this.zoneField = new Map(); // roiId -> { dominant, means, trackCount, trackKeys }
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
    this.interval = setInterval(() => this.tick(), 20000); // 0.05Hz — zone field updates are low-priority
    console.log('📡 ZoneAggregator started (0.05Hz / 20s)');
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.zoneField.clear();
  }

  tick() {
    const _t0 = Date.now();
    const trackAxes = this.intentScorer.getTrackAxes();
    if (!trackAxes || trackAxes.size === 0 || this.rois.length === 0) return;

    this.zoneField.clear();

    for (const roi of this.rois) {
      if (!roi.vertices || roi.vertices.length < 3) continue;

      const sums = {};
      AXIS_NAMES.forEach(a => sums[a] = 0);
      let count = 0;
      const trackKeys = [];

      for (const [trackKey, data] of trackAxes) {
        if (!data.position) continue;
        if (pointInPolygon(data.position, roi.vertices)) {
          count++;
          trackKeys.push(trackKey);
          for (const axis of AXIS_NAMES) {
            sums[axis] += (data.axes[axis] || 0);
          }
        }
      }

      if (count === 0) continue;

      const means = {};
      for (const axis of AXIS_NAMES) {
        means[axis] = sums[axis] / count;
      }

      // Find dominant axis
      let dominant = AXIS_NAMES[0];
      let maxVal = 0;
      for (const axis of AXIS_NAMES) {
        if (means[axis] > maxVal) {
          maxVal = means[axis];
          dominant = axis;
        }
      }

      this.zoneField.set(roi.id, {
        roiId: roi.id,
        roiName: roi.name,
        dominant,
        dominantScore: maxVal,
        means,
        trackCount: count,
        trackKeys,
      });
    }
    const _elapsed = Date.now() - _t0;
    if (_elapsed > 50) console.warn(`⏱️ ZoneAggregator.tick took ${_elapsed}ms (${trackAxes.size} tracks, ${this.rois.length} ROIs)`);
  }

  getZoneField() { return this.zoneField; }

  getZoneFieldArray() {
    const result = [];
    for (const [, data] of this.zoneField) {
      result.push(data);
    }
    return result;
  }
}
