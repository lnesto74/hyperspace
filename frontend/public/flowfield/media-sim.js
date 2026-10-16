// Media simulator: what a totem spot would deliver for one product, message, set of weekdays and hours.
// Input: media/sim.json (241_media_sim.py). Pure functions, no DOM.
//
// Measured (LiDAR): impressions, qualified impressions, time in view, department traffic, and the probability
// that a viewer reaches the product's department (or a planogram category target, along its real fronts) within 3 minutes (movement model, calibrated on ids that survive).
// Assumed (DEMO): baseline sales per department, the effect of each message type, the base CPM.

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Day indices used for a weekday: same weekday if measured, else same type (Mon–Fri / Sat / Sun), else all. */
export function daysFor(S, wd) {
  const same = S.weekdays.map((w, i) => (w === wd ? i : -1)).filter((i) => i >= 0);
  if (same.length) return { idx: same, measured: true };
  const type = (w) => (w < 5 ? 0 : w);
  const sameType = S.weekdays.map((w, i) => (type(w) === type(wd) ? i : -1)).filter((i) => i >= 0);
  if (sameType.length) return { idx: sameType, measured: false };
  return { idx: S.weekdays.map((_, i) => i), measured: false };
}

const avg = (rows) => rows[0].map((_, k) => rows.reduce((s, r) => s + r[k], 0) / rows.length);

/** Average day profile for a weekday: audience[h] = [imp, qual, aqsSum, dwellSum], traffic[h] for the department. */
export function weekdayProfile(S, spotIdx, deptIdx, wd, trafficOf = (i) => S.profiles.traffic[i][deptIdx]) {
  const { idx, measured } = daysFor(S, wd);
  const aud = idx.map((i) => S.profiles.aud[i][spotIdx]);
  const audience = aud[0].map((_, h) => avg(aud.map((a) => a[h])));
  const traffic = avg(idx.map(trafficOf));
  return { audience, traffic, measured, days: idx.map((i) => S.days[i]) };
}

/** Attention reference: average attention score over every spot and day (so the index is relative to this store). */
export function attentionRef(S) {
  let a = 0, n = 0;
  for (const day of S.profiles.aud) for (const spot of day) for (const h of spot) { a += h[2]; n += h[0]; }
  return n ? a / n : 45;
}

/** Planogram category targets (sim.json built with MEDIA_TARGETS); [] for a department-only build. */
export function targetsOf(S) { return S.targets || []; }

/** Proposed target for a spot: the configured group for it, if any. */
export function defaultTarget(S, spot) { return targetsOf(S).find((t) => t.default_for_spot === spot)?.id ?? null; }

export function simulate(S, { spot, sku, msg, days, hours, spotSec = 15, weeks = 2, lift = null, target = null }) {
  const si = S.spots.findIndex((s) => s.id === spot);
  const P = S.catalog.find((p) => p.sku === sku);
  const Mx = S.messages.find((m) => m.id === msg);
  if (si < 0 || !P || !Mx) throw new Error('unknown spot, product or message');
  const ti = target == null ? -1 : targetsOf(S).findIndex((t) => t.id === target);
  if (target != null && ti < 0) throw new Error('unknown target');
  const T = ti >= 0 ? S.targets[ti] : null;
  // A target the LiDAR does not see has no audience figure: never simulate it as 0 viewers.
  if (T && !T.measured) throw new Error(`target not measured: ${T.reason || 'no coverage'}`);
  const d = S.depts.indexOf(P.dept);
  const trafficOf = T ? (i) => S.profiles.ttraffic[i][ti] : (i) => S.profiles.traffic[i][d];
  const loop = S.params.loop_s, cal = S.params.calibration ?? 1;
  const reach = (T ? S.spots[si].treach[ti] : S.spots[si].reach[d]) * cal;
  const index = (T ? S.spots[si].tindex[ti] : S.spots[si].index[d]) ?? 0;
  const NH = S.h1 - S.h0;
  // conversion: units of the SKU per target passer (DEMO units / measured average traffic)
  const dailyTraffic = S.profiles.traffic.map((_, i) => trafficOf(i).reduce((a, b) => a + b, 0));
  const conv = P.units_day / Math.max(1, dailyTraffic.reduce((a, b) => a + b, 0) / dailyTraffic.length);
  const ref = attentionRef(S);
  // tiers from this spot's whole week of qualified viewers
  const week = WEEKDAYS.map((_, wd) => weekdayProfile(S, si, d, wd, trafficOf));
  const allQ = week.flatMap((w) => w.audience.map((a) => a[1])).sort((a, b) => a - b);
  const q70 = allQ[Math.floor(allQ.length * 0.7)], q30 = allQ[Math.floor(allQ.length * 0.3)];
  const tierOf = (q) => (q >= q70 ? 'prime' : q <= q30 ? 'value' : 'standard');
  const TIER = { prime: 1.25, standard: 1, value: 0.8 };
  const rel = Math.min(1.5, 1 + 0.25 * Math.max(0, index - 1));
  let imp = 0, qual = 0, seen = 0, inTarget = 0, base = 0, price = 0, aqs = 0;
  const heat = week.map((w) => w.audience.map((a, h) => {
    const dw = a[0] ? a[3] / a[0] : 0, pSee = Math.min(1, (dw + spotSec) / loop);
    return a[1] * pSee * reach;
  }));
  const perHour = Array.from({ length: NH }, () => ({ seen: 0, inTarget: 0, price: 0 }));
  const estimated = [];
  for (const wd of days) {
    const w = week[wd]; if (!w.measured) estimated.push(WEEKDAYS[wd]);
    for (const h of hours) {
      const k = h - S.h0; if (k < 0 || k >= NH) continue;
      const [i, q, aSum, dSum] = w.audience[k];
      const dw = i ? dSum / i : 0, pSee = Math.min(1, (dw + spotSec) / loop);
      const s = i * pSee, t = q * pSee * reach;
      const qi = Math.min(1.5, Math.max(0.7, (i ? aSum / i : ref) / ref));
      const cpm = S.params.baseCpm * qi * rel * TIER[tierOf(q)];
      imp += i; qual += q; seen += s; inTarget += t; aqs += aSum; base += conv * w.traffic[k];
      price += s / 1000 * cpm;
      perHour[k].seen += s; perHour[k].inTarget += t; perHour[k].price += s / 1000 * cpm;
    }
  }
  const W = weeks, nDays = days.length * W;
  // effect on viewers who reach the shelf: the message's assumption, or the value set by the user (range scales with it)
  const L = lift ?? Mx.lift, k = Mx.lift ? L / Mx.lift : 1;
  const extra = { lo: inTarget * conv * Mx.lo * k * W, mid: inTarget * conv * L * W, hi: inTarget * conv * Mx.hi * k * W };
  const baseUnits = base * W;
  const diluted = baseUnits ? extra.mid / baseUnits : 0;
  const uDay = nDays ? baseUnits / nDays : 0;
  const Z = 1.645 + 0.842; // 90% one-sided, 80% power
  // proof 1 · sales of the SKU, ON vs OFF slots: the effect is diluted over everyone who buys it
  const testDays = diluted > 0 && uDay > 0 ? Math.ceil((Z * 2 / Math.sqrt(uDay) / diluted) ** 2) : null;
  // proof 2 · direction: among the viewers, share heading to the department when they leave the view (ON vs OFF)
  const p = Math.min(0.95, reach), nDay = nDays ? seen / days.length : 0;
  const dirDays = p > 0 && L > 0 && nDay > 0 ? Math.max(1, Math.ceil((Z ** 2 * 2 * p * (1 - p) / (p * L) ** 2) / (nDay / 2))) : null;
  const total = price * W;
  return {
    spot: S.spots[si], product: P, message: Mx, dept: P.dept, target: T, weeks: W, days, hours, spotSec,
    impressions: imp * W, qualified: qual * W, seen: seen * W, inTarget: inTarget * W,
    reach, index, relevance: rel, attention: imp ? aqs / imp / ref : 1,
    cpm: seen ? total / (seen * W) * 1000 : 0, price: total, inTargetCpm: inTarget ? total / (inTarget * W) * 1000 : 0,
    extraUnits: extra, extraRevenue: { lo: extra.lo * P.price, mid: extra.mid * P.price, hi: extra.hi * P.price },
    baseUnits, dilutedLift: diluted, testDays, dirDays, lift: L, roi: total ? extra.mid * P.price / total : 0,
    heat, perHour, estimated,
  };
}
