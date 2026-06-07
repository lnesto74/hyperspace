/**
 * recoveryModel — fingerprint-driven monetization for Profit Radar.
 *
 * Replaces the old "severity-tier × store-wide daily margin" band (which made
 * every medium insight read the identical €/day) with a bottom-up estimate
 * grounded in:
 *   - how many shoppers actually pass the zone   (exposedPerDay)
 *   - how far the zone is from a healthy benchmark (gap)
 *   - how much of that gap is realistically winnable (intentPresence)
 *   - the real margin of the SKUs on that shelf   (marginPerUnit)
 *   - WHICH action the behavioral fingerprint says will work (lever + match)
 *
 * The fingerprint (12 kinematic intent axes) selects the lever and scales the
 * capture factor: a price promo on an "avoidance" zone recovers almost nothing,
 * a speed-bump layout fix recovers a lot — and the € reflects that.
 *
 * Pure functions, no DB. Mirrored on the frontend (recoveryModel.ts) so the
 * effort/lever sliders recompute live without a round-trip.
 */

const HEALTHY_ENGAGEMENT = 0.45; // benchmark a product shelf should reach
const CAPTURE_CEILING = 0.6; // never claim to recover more than 60% of the gap
const DEFAULT_DAILY_SHOPPERS = 1200;
const DEFAULT_MARGIN_PER_UNIT = 1.5; // € when no SKU economics at all
const ASSUMED_ITEMS_PER_BASKET = 8;

// Levers a merchandiser/cashier can pull. Every lever converts the commitment
// gap (turns passers-by into buyers); base = share of the gap captured at 100%
// effort & perfect fingerprint match. The lever's reach is gated by how well its
// targetAxis matches the observed fingerprint — so a price promo on an
// "avoidance" zone (where nobody stops) recovers almost nothing, while a
// speed-bump layout fix on that same zone recovers a lot. Bases are similar so
// the FINGERPRINT, not an arbitrary weight, decides which lever wins.
const LEVERS = [
  { id: 'layout', label: 'Reposition / speed-bump', role: 'merchandiser', targetAxis: 'avoidance', base: 0.35 },
  { id: 'pricing', label: 'Price / retail-media promo', role: 'merchandiser', targetAxis: '__low_commitment', base: 0.32 },
  { id: 'wayfinding', label: 'Signage / wayfinding', role: 'merchandiser', targetAxis: 'confusion', base: 0.30 },
  { id: 'crossmerch', label: 'Cross-merch / bundle', role: 'merchandiser', targetAxis: 'hesitation', base: 0.30 },
  { id: 'staffing', label: 'Extra lane / staff', role: 'cashier', targetAxis: 'waiting_queueing', base: 0.40 },
];

// How strongly fingerprint match gates a lever. A fully mismatched lever still
// captures MATCH_FLOOR of its base (some spillover), a perfect match captures
// all of it. Low floor ⇒ "the wrong lever recovers almost nothing".
const MATCH_FLOOR = 0.15;

const LEVER_BY_ID = Object.fromEntries(LEVERS.map((l) => [l.id, l]));

const MODE_FACTOR = { conservative: 0.6, expected: 1.0, aggressive: 1.4 };

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

/**
 * How well a lever matches the observed fingerprint (0..1). A mismatched lever
 * (e.g. pricing on a zone nobody stops in) scores near 0 → near-zero recovery.
 */
function leverMatch(lever, axes, engagement, commitment) {
  const a = axes || {};
  if (lever.targetAxis === '__low_commitment') {
    // Pricing/retail-media works when shoppers DO engage but DON'T commit.
    const eng = engagement != null ? engagement : (a.engagement_with_POI || 0);
    const com = commitment != null ? commitment : (a.commitment || 0);
    return clamp01(eng * (1 - com) * 2);
  }
  return clamp01(a[lever.targetAxis]);
}

/** Pick the lever the fingerprint most supports. Queue zones force staffing. */
function recommendLever(axes, engagement, commitment, isQueue) {
  if (isQueue) return 'staffing';
  let best = LEVERS[0];
  let bestScore = -1;
  for (const lever of LEVERS) {
    if (lever.id === 'staffing') continue; // only for queue insights
    const m = leverMatch(lever, axes, engagement, commitment);
    const score = m * lever.base; // weight by how much the lever can move
    if (score > bestScore) { bestScore = score; best = lever; }
  }
  return best.id;
}

/**
 * Winnable share of passers-by (intent presence). Shoppers who are exploring,
 * hesitating or already engaging are recoverable; those rushing to the exit are
 * mostly lost.
 */
function intentPresence(axes) {
  const a = axes || {};
  const winnable = 0.4
    + 0.4 * (a.exploration || 0)
    + 0.4 * (a.hesitation || 0)
    + 0.3 * (a.engagement_with_POI || 0)
    - 0.5 * (a.churn_exit_intent || 0)
    - 0.3 * (a.urgency || 0);
  return Math.max(0.15, Math.min(0.95, winnable));
}

/** € gross margin for a single unit of a SKU, robust to messy margin fields. */
function marginPerUnit(sku, fallbackPct) {
  if (!sku) return null;
  const price = Number(sku.price);
  const margin = Number(sku.margin);
  const pct = Number.isFinite(fallbackPct) && fallbackPct > 0 ? fallbackPct : 30;
  if (Number.isFinite(margin) && margin > 0) {
    if (margin <= 1) return Number.isFinite(price) && price > 0 ? price * margin : null; // fraction
    if (margin <= 100) return Number.isFinite(price) && price > 0 ? price * (margin / 100) : null; // percent
    return margin; // absolute €
  }
  if (Number.isFinite(price) && price > 0) return price * (pct / 100);
  return null;
}

/**
 * Compute the recovery for one lever at a given effort. Single formula handles
 * both conversion levers (new buyers) and attach levers (existing buyers buy
 * more).
 */
function recoveryForLever(inputs, leverId, effort, mode = 'expected') {
  const lever = LEVER_BY_ID[leverId] || LEVER_BY_ID.layout;
  const {
    exposedPerDay = 0,
    engagement = 0,
    conversionRate = null,
    benchmark = HEALTHY_ENGAGEMENT,
    winnable = 0.5,
    marginPerUnit: mpu = DEFAULT_MARGIN_PER_UNIT,
    baseAttachRate = 1.0,
    axes = {},
    commitment = null,
    tradingDaysPerWeek = 7,
  } = inputs || {};

  const e = clamp01(effort);
  const modeF = MODE_FACTOR[mode] || 1.0;
  const match = leverMatch(lever, axes, engagement, commitment);

  // Buyers today = realized purchase intent. Prefer commitment, fall back to a
  // haircut on dwell (engagement). The gap is how far that sits below a healthy
  // conversion benchmark — that's the recoverable headroom.
  const conv = conversionRate != null
    ? conversionRate
    : (commitment != null ? commitment : engagement * 0.6);
  const gap = Math.max(0, benchmark - conv);

  const capture = Math.min(CAPTURE_CEILING, lever.base * modeF * e * (MATCH_FLOOR + (1 - MATCH_FLOOR) * match));
  const newConverters = exposedPerDay * gap * capture * winnable;
  const perDay = newConverters * baseAttachRate * mpu;

  const perWeek = perDay * tradingDaysPerWeek;
  const perYear = perDay * tradingDaysPerWeek * 52;

  return {
    leverId: lever.id,
    leverLabel: lever.label,
    role: lever.role,
    match: +match.toFixed(2),
    capture: +capture.toFixed(3),
    gap: +gap.toFixed(3),
    perDay: Math.round(perDay),
    perWeek: Math.round(perWeek),
    perYear: Math.round(perYear),
  };
}

/**
 * Full recovery summary for an insight: the recommended lever, every applicable
 * lever's €, and a conservative→aggressive range for the recommended lever.
 */
function recoverySummary(inputs, effort = 0.6) {
  const isQueue = !!inputs.isQueue;
  const applicable = isQueue ? ['staffing'] : LEVERS.filter((l) => l.id !== 'staffing').map((l) => l.id);
  const levers = applicable.map((id) => recoveryForLever(inputs, id, effort, 'expected'));

  // The recommended lever is the one that recovers the most € — and since each
  // lever's € is gated by how well it matches the fingerprint, this is the
  // fingerprint's pick (a price promo on an avoidance zone scores ~0 and loses).
  const recommendedLeverId = inputs.recommendedLeverId
    || (levers.length
      ? levers.reduce((best, l) => (l.perDay > best.perDay ? l : best), levers[0]).leverId
      : recommendLever(inputs.axes, inputs.engagement, inputs.commitment, isQueue));

  const recommended = recoveryForLever(inputs, recommendedLeverId, effort, 'expected');
  const range = {
    conservative: recoveryForLever(inputs, recommendedLeverId, effort, 'conservative').perDay,
    expected: recommended.perDay,
    aggressive: recoveryForLever(inputs, recommendedLeverId, effort, 'aggressive').perDay,
  };

  return { recommendedLeverId, recommended, levers, range };
}

const FIX_TEXT = {
  layout: (zone) => `Shoppers walk straight through ${zone} without stopping. Reposition a high-demand or high-margin SKU to the eye-level facing to create a "speed bump" and interrupt the flow.`,
  pricing: (zone) => `Shoppers stop and look in ${zone} but don't buy — a price/value objection. Add a clear promo, multi-buy, or sponsored placement on the top sellers here.`,
  wayfinding: (zone) => `Shoppers backtrack and circle around ${zone} — they can't find or decide. Fix shelf signage, add category headers, and group confusing SKUs by use-case.`,
  crossmerch: (zone) => `Shoppers hesitate in ${zone} — interested but uncommitted. Bundle or cross-merchandise with a complementary popular product to push them over the line.`,
  staffing: (zone) => `Queue building at ${zone}. Open an additional lane or deploy a roaming cashier during the peak to recover abandoned baskets.`,
};

/** Merchandiser-facing instruction derived from the chosen lever. */
function suggestedFixForLever(leverId, zoneName, topSkus) {
  const zone = zoneName || 'this zone';
  const base = (FIX_TEXT[leverId] || FIX_TEXT.layout)(zone);
  if (Array.isArray(topSkus) && topSkus.length > 0) {
    const names = topSkus.slice(0, 3).map((s) => s.name).filter(Boolean);
    if (names.length) return `${base} Start with: ${names.join(', ')}.`;
  }
  return base;
}

export {
  LEVERS,
  LEVER_BY_ID,
  HEALTHY_ENGAGEMENT,
  DEFAULT_DAILY_SHOPPERS,
  ASSUMED_ITEMS_PER_BASKET,
  clamp01,
  leverMatch,
  recommendLever,
  intentPresence,
  marginPerUnit,
  recoveryForLever,
  recoverySummary,
  suggestedFixForLever,
};
