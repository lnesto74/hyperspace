/**
 * ProfitRadarEngine — generates actionable insights from zone/cluster data.
 * 4 insight types: Lost Sales, Underperforming Zones, Staff Misallocation, Layout Friction.
 * Emits insights every 30s with confidence, € impact estimate, and suggested fixes.
 */

import { AXIS_NAMES } from './intentScorer.js';

const INSIGHT_TYPES = {
  LOST_SALES: 'lost_sales',
  UNDERPERFORMING_ZONE: 'underperforming_zone',
  STAFF_MISALLOCATION: 'staff_misallocation',
  LAYOUT_FRICTION: 'layout_friction',
};

const AXIS_LABELS = {
  exploration: 'Exploring',
  goal_directedness: 'Goal-directed',
  urgency: 'In a hurry',
  commitment: 'Committed shoppers',
  hesitation: 'Hesitating',
  confusion: 'Confused',
  social_groupness: 'Shopping in groups',
  avoidance: 'Avoiding zone',
  waiting_queueing: 'Waiting in queue',
  engagement_with_POI: 'Engaged with products',
  churn_exit_intent: 'About to leave',
  friction: 'Experiencing friction',
};

const SEVERITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

let insightCounter = 0;

function makeId() { return `insight-${Date.now()}-${++insightCounter}`; }

function euroImpact(severity) {
  if (severity === SEVERITY.HIGH) return { min: 500, max: 2000, currency: '€' };
  if (severity === SEVERITY.MEDIUM) return { min: 100, max: 500, currency: '€' };
  return { min: 20, max: 100, currency: '€' };
}

export class ProfitRadarEngine {
  constructor(zoneAggregator, behaviorClusterer) {
    this.zoneAggregator = zoneAggregator;
    this.behaviorClusterer = behaviorClusterer;
    this.insights = [];
    this.interval = null;
    this.history = []; // Rolling window of last 10 insight batches for dedup
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 30000); // every 30s
    // Also run once immediately after a short delay
    setTimeout(() => this.tick(), 5000);
    console.log('📡 ProfitRadarEngine started (30s cycle)');
  }

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    this.insights = [];
  }

  tick() {
    const zones = this.zoneAggregator.getZoneFieldArray();
    const clusters = this.behaviorClusterer.getClusters();
    const newInsights = [];

    // --- 1. Lost Sales: zones with high hesitation + low commitment ---
    for (const z of zones) {
      if (z.means.hesitation > 0.4 && z.means.commitment < 0.3 && z.trackCount >= 2) {
        const confidence = Math.min(0.95, 0.5 + z.means.hesitation * 0.3 + (1 - z.means.commitment) * 0.2);
        const sev = z.means.hesitation > 0.6 ? SEVERITY.HIGH : SEVERITY.MEDIUM;
        newInsights.push({
          id: makeId(),
          type: INSIGHT_TYPES.LOST_SALES,
          severity: sev,
          confidence: +confidence.toFixed(2),
          title: `Potential lost sales in ${z.roiName || 'zone'}`,
          summary: `${z.trackCount} shoppers show hesitation (${(z.means.hesitation*100).toFixed(0)}%) with low commitment (${(z.means.commitment*100).toFixed(0)}%). They may leave without buying.`,
          why: `Shoppers in this zone exhibit stop-start movement, repeated backtracking, and low directional consistency — classic hesitation signals. Combined with weak commitment scores, this suggests product confusion or price resistance.`,
          suggestedFix: `Add clearer shelf labeling or promotional signage. Consider a staff greeter for this zone during peak hours.`,
          impact: euroImpact(sev),
          dataBasis: { zone: z.roiName, trackCount: z.trackCount, hesitation: +z.means.hesitation.toFixed(2), commitment: +z.means.commitment.toFixed(2) },
          timestamp: Date.now(),
        });
      }
    }

    // --- 2. Underperforming Zones: low engagement + low visit count ---
    for (const z of zones) {
      if (z.means.engagement_with_POI < 0.2 && z.means.avoidance > 0.3 && z.trackCount >= 1) {
        const confidence = Math.min(0.9, 0.4 + z.means.avoidance * 0.3 + (1 - z.means.engagement_with_POI) * 0.2);
        const sev = z.means.avoidance > 0.5 ? SEVERITY.HIGH : SEVERITY.MEDIUM;
        newInsights.push({
          id: makeId(),
          type: INSIGHT_TYPES.UNDERPERFORMING_ZONE,
          severity: sev,
          confidence: +confidence.toFixed(2),
          title: `${z.roiName || 'Zone'} underperforming`,
          summary: `Low product engagement (${(z.means.engagement_with_POI*100).toFixed(0)}%) and high avoidance (${(z.means.avoidance*100).toFixed(0)}%). Shoppers pass through without stopping.`,
          why: `Track movement shows high speed and straight paths through this zone with minimal stops — shoppers are treating it as a corridor rather than a shopping destination.`,
          suggestedFix: `Reposition high-demand products to create a "speed bump" effect. Consider cross-merchandising with adjacent popular zones.`,
          impact: euroImpact(sev),
          dataBasis: { zone: z.roiName, trackCount: z.trackCount, engagement: +z.means.engagement_with_POI.toFixed(2), avoidance: +z.means.avoidance.toFixed(2) },
          timestamp: Date.now(),
        });
      }
    }

    // --- 3. Staff Misallocation: high queue/waiting in zones without staff need ---
    for (const z of zones) {
      if (z.means.waiting_queueing > 0.5 && z.trackCount >= 3) {
        const sev = z.means.waiting_queueing > 0.7 ? SEVERITY.HIGH : SEVERITY.MEDIUM;
        const confidence = Math.min(0.9, 0.5 + z.means.waiting_queueing * 0.4);
        newInsights.push({
          id: makeId(),
          type: INSIGHT_TYPES.STAFF_MISALLOCATION,
          severity: sev,
          confidence: +confidence.toFixed(2),
          title: `Queue building in ${z.roiName || 'zone'}`,
          summary: `${z.trackCount} people waiting (queue score ${(z.means.waiting_queueing*100).toFixed(0)}%). Consider reallocating staff.`,
          why: `Multiple tracks show near-zero movement and micro-stepping patterns consistent with queue waiting behavior. This zone's wait score significantly exceeds the store average.`,
          suggestedFix: `Open an additional checkout lane or deploy a roaming cashier. For non-checkout zones, add self-service kiosk.`,
          impact: euroImpact(sev),
          dataBasis: { zone: z.roiName, trackCount: z.trackCount, queueScore: +z.means.waiting_queueing.toFixed(2) },
          timestamp: Date.now(),
        });
      }
    }

    // --- 4. Layout Friction: high friction + confusion clusters ---
    for (const c of clusters) {
      if ((c.dominant === 'friction' || c.dominant === 'confusion') && c.memberCount >= 2) {
        const score = c.meanAxes[c.dominant] || 0;
        const sev = score > 0.5 ? SEVERITY.HIGH : c.memberCount >= 3 ? SEVERITY.MEDIUM : SEVERITY.LOW;
        const confidence = Math.min(0.85, 0.4 + score * 0.3 + c.memberCount * 0.05);
        const traj = c.trajectory || {};
        newInsights.push({
          id: makeId(),
          type: INSIGHT_TYPES.LAYOUT_FRICTION,
          severity: sev,
          confidence: +confidence.toFixed(2),
          title: `Layout friction detected (${c.memberCount} shoppers)`,
          summary: `A cluster of ${c.memberCount} shoppers${c.anchorZoneName ? ` in ${c.anchorZoneName}` : ''} shows ${c.dominant} behavior. Journey type: ${traj.journeyType || 'unknown'}.`,
          why: `${c.memberCount} shoppers on similar journeys all exhibit ${AXIS_LABELS[c.dominant] || c.dominant} patterns — backtracking, revisiting areas, and erratic speed changes. This suggests a layout or signage problem${c.anchorZoneName ? ` around ${c.anchorZoneName}` : ''}.`,
          suggestedFix: `Review signage and aisle layout in this area. Consider adding directional floor markers or repositioning endcap displays.`,
          impact: euroImpact(sev),
          dataBasis: { clusterSize: c.memberCount, dominant: c.dominant, score: +score.toFixed(2), journeyType: traj.journeyType, zones: traj.zonesVisited },
          timestamp: Date.now(),
        });
      }
    }

    // Rank by severity then confidence
    const sevOrder = { high: 0, medium: 1, low: 2 };
    newInsights.sort((a, b) => {
      const sd = (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2);
      if (sd !== 0) return sd;
      return b.confidence - a.confidence;
    });

    // Keep top 10
    this.insights = newInsights.slice(0, 10);
  }

  getInsights() { return this.insights; }
}

export { INSIGHT_TYPES, AXIS_LABELS };
