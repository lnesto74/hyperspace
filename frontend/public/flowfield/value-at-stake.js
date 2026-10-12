// Value at stake per area — the original purpose of Opportunities: where is value being left
// on the floor, and roughly how much.
//
// Formula: the existing Profit Radar recovery model (recovery-model.js, verbatim mirror of
// backend/services/profit-radar/recoveryModel.js). No new formula.
// Behaviour inputs: audited Visitor Journey (daily_kpi) instead of live fingerprints:
//   shoppers      = clienti entrati in the slot                       (daily_kpi entrances)
//   exposure      = engine rule: shoppers × 25 % × relative popularity, popularity = this
//                   department's minutes per customer ÷ the department average (daily_kpi area)
//   engagement    = choice index = time at the shelf ÷ time in the area (daily_kpi)
//   avoidance     = 1 − choice ÷ 0.40 (share of area time not spent at the shelf, vs "lavorato")
//   queue score   = peak queue minutes per customer ÷ the 1-minute line (daily_kpi)
// With the measured kinetic states (kinetic.js, Journey Lab 220, raw 10 Hz) the behaviour axes come
// from how people actually moved in the department instead of the choice-index approximation:
//   avoidance = moving past ÷ (moving past + choosing); hesitation, confusion (U-turns), exploration
//   are read against the store's own level (0,5 = like the store). Engagement stays the audited choice index.
// Money inputs are ASSUMPTIONS until the store's economics are configured: margin per unit by
// category (layers.js CATEGORY_MARGIN, editable) and € 8 margin per basket (engine fallback).
// The result is a modelled scenario range, not measured lost sales. Areas are not summed:
// the engine treats them as alternatives.

import { recoverySummary, suggestedFixForLever, intentPresence, HEALTHY_ENGAGEMENT } from './recovery-model.js';
import { rankDepartments, queuePeak, deptLabel, DAY, PACKAGED, SERVED } from './visitor-journey.js';
import { axesFor, fingerprint } from './kinetic.js';

// Same constants as backend/services/profit-radar/profitRadarEngine.js (not exported there).
export const ENGINE = { ZONE_PASS_RATE: 0.25, MIN_PASS_RATE: 0.05, MAX_ABANDON_RATE: 0.08, BASKET_MARGIN: 8, UNIT_MARGIN: 1.5, NEUTRAL_COMMITMENT: 0.3, EFFORT: 0.6 };

// Same values as layers.js CATEGORY_MARGIN (€ margin per unit by category, legacy defaults).
// Copied because layers.js imports three; value-at-stake.test.mjs checks they stay equal.
export const CATEGORY_MARGIN = {
  Pesce: 2.8, Carne: 2.4, Gastronomia: 2.2, Latticini: 1.6,
  Frutta: 1.4, Verdura: 1.4, Pane: 1.3, 'Bakery & Breakfast': 1.3,
  Surgelati: 1.2, Salumi: 1.8, Bar: 1.5, Acqua: 0.4,
};

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

export function defaultEconomics() {
  return { effort: ENGINE.EFFORT, basketMargin: ENGINE.BASKET_MARGIN, margins: { ...CATEGORY_MARGIN, [PACKAGED]: ENGINE.UNIT_MARGIN }, configured: false };
}

export function valueAtStake(view, slot = DAY, econ = defaultEconomics(), kinetic = null) {
  if (!view) return [];
  const shoppers = view.entrances?.[slot]?.value;
  if (!(shoppers > 0)) return [];
  // A department with no measurable shelf layer (choice index 0: served counters whose waiting band
  // lies beyond 1 m, e.g. Gastronomia, Salumi, Pane) has no engagement reading, so no value is modelled.
  const depts = rankDepartments(view, slot, { includePackaged: true }).filter((d) => d.banco?.value != null && d.choiceShare > 0);
  const mean = depts.reduce((s, d) => s + d.area.value, 0) / Math.max(1, depts.length);
  const items = depts.map((d) => {
    const choice = d.choiceShare ?? 0;
    const relPopularity = Math.max(0.3, Math.min(3, d.area.value / Math.max(1e-9, mean)));
    const exposedPerDay = Math.max(Math.round(shoppers * ENGINE.MIN_PASS_RATE), Math.round(shoppers * ENGINE.ZONE_PASS_RATE * relPopularity));
    const measured = kinetic ? axesFor(kinetic, d.id, slot) : null;
    const axes = measured ? { ...measured, engagement_with_POI: clamp01(choice) } : { avoidance: clamp01(1 - choice / 0.4), engagement_with_POI: clamp01(choice) };
    const engagement = clamp01(choice);
    const conversionRate = +(engagement * (0.4 + 0.6 * ENGINE.NEUTRAL_COMMITMENT)).toFixed(3);
    const marginPerUnit = Number(econ.margins?.[d.id]) > 0 ? Number(econ.margins[d.id]) : ENGINE.UNIT_MARGIN;
    const inputs = { exposedPerDay, engagement, conversionRate, benchmark: HEALTHY_ENGAGEMENT, winnable: intentPresence(axes), marginPerUnit, baseAttachRate: 1, axes, commitment: null, tradingDaysPerWeek: 7, isQueue: false };
    const s = recoverySummary(inputs, econ.effort);
    return { kind: 'dept', id: d.id, name: d.name, sel: { kind: 'dept', id: d.id }, inputs, summary: s, fix: suggestedFixForLever(s.recommendedLeverId, d.name),
      served: SERVED.includes(d.id),
      axesSource: measured ? 'measured' : 'approx', movement: measured ? fingerprint(kinetic, d.id, slot) : null,
      evidence: { area: d.area.value, banco: d.banco.value, choice, shoppers, relPopularity } };
  });
  const { peak } = queuePeak(view);
  const top = view.lanes?.list?.[0];
  if (peak && top) {
    const queueScore = clamp01(peak.value / 1.0);
    const inputs = { exposedPerDay: Math.round(shoppers), engagement: 0, conversionRate: 0, benchmark: queueScore * ENGINE.MAX_ABANDON_RATE, winnable: 1, marginPerUnit: Number(econ.basketMargin) > 0 ? Number(econ.basketMargin) : ENGINE.BASKET_MARGIN, baseAttachRate: 1, axes: {}, commitment: null, tradingDaysPerWeek: 7, isQueue: true };
    const s = recoverySummary(inputs, econ.effort);
    items.push({ kind: 'queue', id: 'casse', name: `Checkouts · peak ${peak.slot.replace('-', '–')}`, sel: { kind: 'lane', id: top.lane }, inputs, summary: s, fix: suggestedFixForLever('staffing', `Lane ${top.lane}`),
      evidence: { peak, lane: top.lane, laneShare: top.share, shoppers, queueScore } });
  }
  return items.filter((x) => x.summary.range.expected > 0).sort((a, b) => b.summary.range.expected - a.summary.range.expected);
}

export const LEVER_IT = { layout: 'Riposizionare / creare un punto di sosta', pricing: 'Prezzo / promo in scaffale', wayfinding: 'Segnaletica', crossmerch: 'Abbinamenti / bundle', staffing: 'Una cassa in più nel picco' };
export { deptLabel };
