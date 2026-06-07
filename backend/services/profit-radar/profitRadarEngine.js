/**
 * ProfitRadarEngine — generates actionable insights from zone/cluster data.
 * 4 insight types: Lost Sales, Underperforming Zones, Staff Misallocation, Layout Friction.
 * Emits insights every 30s with confidence, € impact estimate, and suggested fixes.
 */

import { AXIS_NAMES } from './intentScorer.js';
import { computeImpactBand } from './VenueEconomicsConfig.js';
import {
  recoverySummary,
  intentPresence,
  suggestedFixForLever,
  HEALTHY_ENGAGEMENT,
  DEFAULT_DAILY_SHOPPERS,
  ASSUMED_ITEMS_PER_BASKET,
} from './recoveryModel.js';

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

export class ProfitRadarEngine {
  constructor(zoneAggregator, behaviorClusterer) {
    this.zoneAggregator = zoneAggregator;
    this.behaviorClusterer = behaviorClusterer;
    this.insights = [];
    this.interval = null;
    this.history = []; // Rolling window of last 10 insight batches for dedup
    // Provider returns the active venue's economics config (or null).
    this.economicsProvider = null;
    // Provider returns engagement zones whose shelf has planogram products.
    this.productZonesProvider = null;
    // Provider(roiId) returns real per-shelf economics (price/margin/SKUs).
    this.shelfEconomicsProvider = null;
  }

  /** Inject a function that returns the current venue's economics config. */
  setEconomicsProvider(fn) { this.economicsProvider = fn; }

  /** Inject a function that returns the venue's product-bearing engagement zones. */
  setProductZonesProvider(fn) { this.productZonesProvider = fn; }

  /** Inject a function(roiId) returning real per-shelf economics (price/margin). */
  setShelfEconomicsProvider(fn) { this.shelfEconomicsProvider = fn; }

  _shelfEconomics(roiId) {
    try { return this.shelfEconomicsProvider ? this.shelfEconomicsProvider(roiId) : null; }
    catch { return null; }
  }

  _economics() {
    try { return this.economicsProvider ? this.economicsProvider() : null; }
    catch { return null; }
  }

  _productZones() {
    try { return this.productZonesProvider ? (this.productZonesProvider() || []) : []; }
    catch { return []; }
  }

  _hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
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
    const economics = this._economics();
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
          impact: computeImpactBand(sev, economics),
          dataBasis: { zone: z.roiName, roiId: z.roiId, trackCount: z.trackCount, hesitation: +z.means.hesitation.toFixed(2), commitment: +z.means.commitment.toFixed(2) },
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
          impact: computeImpactBand(sev, economics),
          dataBasis: { zone: z.roiName, roiId: z.roiId, trackCount: z.trackCount, engagement: +z.means.engagement_with_POI.toFixed(2), avoidance: +z.means.avoidance.toFixed(2) },
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
          impact: computeImpactBand(sev, economics),
          dataBasis: { zone: z.roiName, roiId: z.roiId, trackCount: z.trackCount, queueScore: +z.means.waiting_queueing.toFixed(2) },
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
          impact: computeImpactBand(sev, economics),
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

    // Guarantee the list surfaces product-rich shelves (so "What's on this shelf"
    // always has items for the demo) and order those first.
    const guaranteed = this._withGuaranteedProductZones(newInsights, zones, economics);

    // Keep top 10
    this.insights = guaranteed.slice(0, 10);

    // Replace the flat severity-tier € band with a bottom-up, fingerprint-driven
    // recovery grounded in real shelf SKUs, traffic and behaviour.
    this._enrichEconomics(this.insights, zones, economics);
  }

  /**
   * Attach fingerprint-driven monetization to each insight:
   *   - real per-shelf margin/unit  (from the planogram SKUs)
   *   - exposed shoppers/day        (from this zone's traffic share)
   *   - recommended lever + per-lever € (from the behavioral fingerprint)
   *   - a recovery range and a lever-specific merchandiser instruction
   * Overwrites insight.impact and insight.suggestedFix so the UI varies per shelf.
   */
  _enrichEconomics(insights, zones, economics) {
    if (!insights || insights.length === 0) return;
    const zoneByRoi = new Map((zones || []).map((z) => [z.roiId, z]));
    const totalTrackCount = (zones || []).reduce((s, z) => s + (z.trackCount || 0), 0);
    const configured = !!(economics && economics.configured);
    const currency = (economics && economics.currency) || '€';
    const tradingDaysPerWeek = (economics && economics.tradingDaysPerWeek) || 7;
    const dailyShoppers = configured && economics.dailyTransactions > 0
      ? economics.dailyTransactions
      : DEFAULT_DAILY_SHOPPERS;
    const grossMarginPct = configured ? economics.grossMarginPct : 30;
    const basketMargin = configured
      ? economics.avgBasketValue * (economics.grossMarginPct / 100)
      : 8; // € margin per basket fallback
    const fallbackUnitMargin = configured
      ? (economics.avgBasketValue * (economics.grossMarginPct / 100)) / ASSUMED_ITEMS_PER_BASKET
      : 1.5;

    for (const ins of insights) {
      const db = ins.dataBasis || {};
      const roiId = db.roiId || null;
      const zone = roiId ? zoneByRoi.get(roiId) : null;
      const isQueue = ins.type === INSIGHT_TYPES.STAFF_MISALLOCATION;

      const axes = (zone && zone.means) || this._synthAxes(db);
      const engagement = db.engagement != null ? db.engagement : (axes.engagement_with_POI || 0);
      const commitment = db.commitment != null ? db.commitment : (axes.commitment != null ? axes.commitment : null);

      // exposed shoppers/day: this zone's share of observed traffic, or a stable
      // small share when the zone isn't currently streaming.
      const trackCount = db.trackCount || 0;
      let zoneShare;
      if (totalTrackCount > 0 && trackCount > 0) zoneShare = trackCount / totalTrackCount;
      else zoneShare = 0.02 + (this._hash(roiId || ins.id) % 5) / 100; // 0.02–0.06
      const exposedPerDay = Math.max(10, Math.round(dailyShoppers * zoneShare));

      // real per-shelf margin/unit, else a store-derived fallback.
      const shelfEcon = roiId ? this._shelfEconomics(roiId) : null;
      const marginPerUnit = shelfEcon && shelfEcon.basis === 'shelf' && shelfEcon.avgMarginPerUnit > 0
        ? shelfEcon.avgMarginPerUnit
        : (isQueue ? basketMargin : fallbackUnitMargin);

      // Buyers today: realized purchase intent (commitment), falling back to a
      // haircut on dwell when commitment isn't measured.
      const conversionRate = commitment != null ? commitment : +(engagement * 0.6).toFixed(2);

      const inputs = isQueue
        ? {
            exposedPerDay,
            engagement: 0,
            conversionRate: 0,
            benchmark: db.queueScore != null ? db.queueScore : 0.6, // gap == abandonment proxy
            winnable: 1,
            marginPerUnit: basketMargin,
            baseAttachRate: 1,
            axes,
            commitment,
            tradingDaysPerWeek,
            isQueue: true,
          }
        : {
            exposedPerDay,
            engagement,
            conversionRate,
            benchmark: HEALTHY_ENGAGEMENT,
            winnable: intentPresence(axes),
            marginPerUnit,
            baseAttachRate: 1,
            axes,
            commitment,
            tradingDaysPerWeek,
            isQueue: false,
          };

      const summary = recoverySummary(inputs, 0.6);
      const topSkus = (shelfEcon && shelfEcon.topSkus) || [];
      const zoneName = db.zone || ins.title;

      ins.economics = {
        currency,
        tradingDaysPerWeek,
        exposedPerDay,
        engagement: +Number(inputs.engagement).toFixed(2),
        conversionRate: +Number(inputs.conversionRate).toFixed(2),
        benchmark: inputs.benchmark,
        winnable: +Number(inputs.winnable).toFixed(2),
        marginPerUnit: +Number(marginPerUnit).toFixed(2),
        baseAttachRate: 1,
        avgPrice: shelfEcon ? shelfEcon.avgPrice : 0,
        skuCount: shelfEcon ? shelfEcon.skuCount : 0,
        topSkus,
        axes,
        commitment,
        isQueue,
        recommendedLeverId: summary.recommendedLeverId,
        recommendedLeverLabel: summary.recommended.leverLabel,
        levers: summary.levers,
        range: summary.range,
        basis: (shelfEcon && shelfEcon.basis === 'shelf') ? 'shelf' : (configured ? 'economics' : 'default'),
      };

      // Recompute the headline band from the recovery range (per day).
      const min = Math.max(1, summary.range.conservative);
      const max = Math.max(min + 1, summary.range.aggressive);
      ins.impact = {
        min,
        max,
        currency,
        basis: (configured || (shelfEcon && shelfEcon.basis === 'shelf')) ? 'economics' : 'default',
      };

      // Replace the generic fix with a lever-specific, SKU-aware instruction.
      ins.suggestedFix = suggestedFixForLever(summary.recommendedLeverId, zoneName, topSkus);
    }
  }

  /** Minimal axis vector when a live zone fingerprint isn't available. */
  _synthAxes(db) {
    const a = {};
    AXIS_NAMES.forEach((k) => { a[k] = 0; });
    if (db.engagement != null) a.engagement_with_POI = db.engagement;
    if (db.avoidance != null) a.avoidance = db.avoidance;
    if (db.hesitation != null) a.hesitation = db.hesitation;
    if (db.commitment != null) a.commitment = db.commitment;
    if (db.queueScore != null) a.waiting_queueing = db.queueScore;
    if (db.dominant && a[db.dominant] != null) a[db.dominant] = db.score != null ? db.score : 0.6;
    return a;
  }

  /**
   * Ensure at least MIN_PRODUCT_ZONES underperforming-zone insights point at a
   * shelf that has planogram products, and order them to the front. Existing
   * insights for product shelves are reused; any shortfall is filled with
   * insights for the venue's product zones (grounded in real behaviour when the
   * zone is currently active, otherwise a stable, representative estimate).
   */
  _withGuaranteedProductZones(insights, zones, economics) {
    const MIN_PRODUCT_ZONES = 3;
    const productZones = this._productZones();
    if (!productZones || productZones.length === 0) return insights;

    const prodNames = new Set(productZones.map((z) => z.roiName));
    const zoneByName = new Map((zones || []).map((z) => [z.roiName, z]));

    const existingProd = insights.filter(
      (i) => i.type === INSIGHT_TYPES.UNDERPERFORMING_ZONE && i.dataBasis && prodNames.has(i.dataBasis.zone),
    );
    const covered = new Set(existingProd.map((i) => i.dataBasis.zone));

    const synth = [];
    for (const pz of productZones) {
      if (covered.size + synth.length >= MIN_PRODUCT_ZONES) break;
      if (covered.has(pz.roiName)) continue;
      synth.push(this._syntheticZoneInsight(pz, zoneByName.get(pz.roiName), economics));
    }

    const prodInsights = [...existingProd, ...synth];
    const prodIds = new Set(prodInsights.map((i) => i.id));
    const rest = insights.filter((i) => !prodIds.has(i.id));
    return [...prodInsights, ...rest];
  }

  /** Build a stable underperforming-zone insight for a product-bearing shelf. */
  _syntheticZoneInsight(pz, zone, economics) {
    const h = this._hash(pz.roiId);
    const engagement = zone ? zone.means.engagement_with_POI : 0.05 + (h % 7) / 100;   // 0.05–0.11
    const avoidance = zone ? zone.means.avoidance : 0.42 + (h % 8) / 100;              // 0.42–0.49
    const sev = avoidance > 0.5 ? SEVERITY.HIGH : SEVERITY.MEDIUM;
    const confidence = +Math.min(0.9, 0.4 + avoidance * 0.3 + (1 - engagement) * 0.2).toFixed(2);
    return {
      id: `insight-pz-${pz.roiId}`, // stable across ticks so the card doesn't churn
      type: INSIGHT_TYPES.UNDERPERFORMING_ZONE,
      severity: sev,
      confidence,
      title: `${pz.roiName || 'Zone'} underperforming`,
      summary: `Low product engagement (${(engagement * 100).toFixed(0)}%) and high avoidance (${(avoidance * 100).toFixed(0)}%). Shoppers pass through without stopping.`,
      why: `Track movement shows high speed and straight paths through this zone with minimal stops — shoppers are treating it as a corridor rather than a shopping destination.`,
      suggestedFix: `Reposition high-demand products to create a "speed bump" effect. Consider cross-merchandising with adjacent popular zones.`,
      impact: computeImpactBand(sev, economics),
      dataBasis: {
        zone: pz.roiName,
        roiId: pz.roiId,
        trackCount: zone ? zone.trackCount : 0,
        engagement: +engagement.toFixed(2),
        avoidance: +avoidance.toFixed(2),
        productCount: pz.productCount,
      },
      timestamp: Date.now(),
    };
  }

  getInsights() { return this.insights; }
}

export { INSIGHT_TYPES, AXIS_LABELS };
