// Kinetic states — HOW people move, measured on the raw 10 Hz LiDAR (Journey Lab 220).
//
// 5-second windows per track, 1-second steps, six states (first match wins):
// Field `it` is the short display name (English UI since v3), `en` the one-line description.
//   wait      in a checkout queue / till ROI below 0.5 m/s (as the audited 150 queue job), or still at a served counter
//   choose    still ≥ 60 % of the window within 1 m of a shelf face (the 199 "al banco" band)
//   pause     still ≥ 60 % anywhere else (standing in the aisle)
//   hesitate  a U-turn (heading change > 120°) or circling (≥ 1,5 m over ≤ half as many 0,5 m cells)
//   transit   ≥ 0,7 m/s and straight (displacement ÷ path ≥ 0,8)
//   browse    the rest: moving slowly, curving
// rgb = UI swatch; glow = saturated stream colour (additive blending washes pastel colours to white).
// Features are the same as the live Profit Radar scorer (intentScorer.js extractFeatures).
// Validation (in the file): choose+wait per department vs audited al-banco minutes, wait per lane
// vs audited queue waiting minutes. Units are person-seconds, not shoppers.

export const STATES = [
  { id: 'transit', it: 'Passing', en: 'Fast and straight', color: '#65DEF0', rgb: [0.40, 0.87, 0.94], glow: [0.05, 0.85, 1.0], note: 'Fast and straight. The area is a corridor here.' },
  { id: 'browse', it: 'Browsing', en: 'Slow, curving', color: '#A99BFF', rgb: [0.66, 0.61, 1.0], glow: [0.48, 0.30, 1.0], note: 'Moving slowly and curving: looking, not yet stopping.' },
  { id: 'choose', it: 'Choosing', en: 'Stopped at the shelf', color: '#F3C778', rgb: [0.95, 0.78, 0.47], glow: [1.0, 0.68, 0.12], note: 'Stopped within 1 m of a shelf face.' },
  { id: 'pause', it: 'Standing', en: 'Stopped in the aisle', color: '#8DA2B8', rgb: [0.55, 0.64, 0.72], glow: [0.22, 0.36, 0.52], note: 'Stopped away from shelves: trolley, talk, reading a list.' },
  { id: 'hesitate', it: 'Hesitating', en: 'Turning back', color: '#FF7AC8', rgb: [1.0, 0.48, 0.78], glow: [1.0, 0.16, 0.72], note: 'Turned back or circled the same spot.' },
  { id: 'wait', it: 'Waiting', en: 'Queue or counter', color: '#FB8B80', rgb: [0.98, 0.55, 0.50], glow: [1.0, 0.30, 0.24], note: 'In a till queue or at a served counter.' },
];
export const STATE = Object.fromEntries(STATES.map((s, k) => [s.id, { ...s, k }]));
const IDS = STATES.map((s) => s.id);
export const MIN_DEPT_PERSON_MIN = 100;

/** Raw seconds-per-state object → shares (sum 1). */
export function shares(mix) {
  if (!mix) return null;
  const tot = IDS.reduce((s, k) => s + (Number(mix[k]) || 0), 0);
  if (!(tot > 0)) return null;
  return Object.fromEntries(IDS.map((k) => [k, (Number(mix[k]) || 0) / tot]));
}
export const total = (mix) => IDS.reduce((s, k) => s + (Number(mix?.[k]) || 0), 0);

/** Mix for a department (or the store) in a Visitor Journey slot ('giorno' = whole day). */
export function mixOf(K, dept = null, slot = 'giorno') {
  if (!K) return null;
  if (!dept) return slot === 'giorno' ? K.store : K.by_slot?.[slot] || null;
  return slot === 'giorno' ? K.by_dept?.[dept] || null : K.by_dept_slot?.[dept]?.[slot] || null;
}

/**
 * Behaviour fingerprint of a department vs the store, same slot.
 * lift[k] = department share ÷ store share (1 = like the store).
 */
export function fingerprint(K, dept, slot = 'giorno') {
  const m = mixOf(K, dept, slot), s = mixOf(K, null, slot);
  const a = shares(m), b = shares(s);
  if (!a || !b) return null;
  const lift = Object.fromEntries(IDS.map((k) => [k, b[k] > 0 ? a[k] / b[k] : null]));
  const dominant = IDS.slice().sort((x, y) => a[y] - a[x])[0];
  const signature = IDS.filter((k) => a[k] >= 0.03).sort((x, y) => (lift[y] || 0) - (lift[x] || 0))[0];
  return { dept, slot, share: a, store: b, lift, dominant, signature, personMin: total(m) / 60,
    uturnsPerMin: K.uturns_per_min?.[dept] ?? null, speed: K.speed_m_s?.[dept] ?? null };
}

/** Departments with enough observed time, ranked by person-minutes (the big rooms first). */
export function departments(K, slot = 'giorno', exclude = []) {
  if (!K) return [];
  return Object.keys(K.by_dept || {})
    .filter((d) => !exclude.includes(d) && total(K.by_dept[d]) / 60 >= MIN_DEPT_PERSON_MIN)
    .map((d) => fingerprint(K, d, slot)).filter(Boolean)
    .sort((a, b) => b.personMin - a.personMin);
}

/** Store U-turn rate per minute, weighted by department time. */
export function storeUturnRate(K) {
  let num = 0, den = 0;
  for (const [d, r] of Object.entries(K?.uturns_per_min || {})) { const t = total(K.by_dept[d]); num += r * t; den += t; }
  return den ? num / den : null;
}

/**
 * Recovery-model axes from measured movement (replaces the choice-derived approximation).
 * Each axis is 0..1 with 0,5 = the store's own level, so a department is read against its store.
 *   avoidance         = moving past ÷ (moving past + choosing)          — absolute, 0..1
 *   hesitation        = hesitate share ÷ (2 × store hesitate share)
 *   confusion         = U-turns per minute ÷ (2 × store U-turns per minute)
 *   exploration       = browse share ÷ (2 × store browse share)
 *   waiting_queueing  = wait share
 * engagement_with_POI stays the audited choice index (passed in by the caller).
 */
export function axesFor(K, dept, slot = 'giorno') {
  const f = fingerprint(K, dept, slot);
  if (!f) return null;
  const c = (x) => Math.max(0, Math.min(1, Number(x) || 0));
  const s = f.share, st = f.store;
  const moving = s.transit + s.browse;
  const ut = storeUturnRate(K);
  return {
    avoidance: c(moving + s.choose > 0 ? moving / (moving + s.choose) : 0),
    hesitation: c(st.hesitate > 0 ? s.hesitate / (2 * st.hesitate) : 0),
    confusion: c(ut && f.uturnsPerMin != null ? f.uturnsPerMin / (2 * ut) : 0),
    exploration: c(st.browse > 0 ? s.browse / (2 * st.browse) : 0),
    waiting_queueing: c(s.wait),
  };
}

/** Cell index for one slice: Map "i,j" → {sec:[6], tot, cum:[6]} plus a venue-coordinate lookup. */
export function cellIndex(K, slice = 'trading') {
  const rows = K?.cells?.[slice];
  if (!rows) return null;
  const { cell_m: cell, origin_m: o } = K.grid;
  const map = new Map();
  let maxTot = 0;
  for (const r of rows) {
    const sec = r.slice(2, 2 + IDS.length);
    const tot = sec.reduce((a, b) => a + b, 0);
    let acc = 0; const cum = sec.map((x) => (acc += x / tot));
    map.set(`${r[0]},${r[1]}`, { i: r[0], j: r[1], sec, tot, cum });
    if (tot > maxTot) maxTot = tot;
  }
  const at = (x, z) => map.get(`${Math.floor((x - o.x) / cell)},${Math.floor((z - o.y) / cell)}`) || null;
  const centre = (i, j) => ({ x: o.x + (i + 0.5) * cell, z: o.y + (j + 0.5) * cell });
  return { slice, cell, map, maxTot, at, centre };
}

/** Pick a state for a particle with stable random u in [0,1). */
export function stateAt(idx, x, z, u) {
  const c = idx?.at(x, z);
  if (!c) return -1;
  for (let k = 0; k < c.cum.length; k++) if (u < c.cum[k]) return k;
  return c.cum.length - 1;
}

/**
 * Hesitation hotspots: cells where hesitating is far above the store rate, with enough time to matter.
 * Neighbouring cells are merged greedily (the strongest cell wins a 3 m radius).
 */
export function hotspots(K, slice = 'trading', { n = 6, minSec = 600 } = {}) {
  const idx = cellIndex(K, slice);
  if (!idx) return [];
  const st = shares(slice === 'trading' ? K.store : K.by_slot?.[SLICE_SLOT[slice]] || K.store);
  const H = STATE.hesitate.k;
  const cand = [...idx.map.values()].filter((c) => c.tot >= minSec && c.sec[H] > 0)
    .map((c) => ({ ...c, share: c.sec[H] / c.tot, lift: (c.sec[H] / c.tot) / st.hesitate, ...idx.centre(c.i, c.j) }))
    .filter((c) => c.lift >= 1.5)
    .sort((a, b) => b.sec[H] * b.lift - a.sec[H] * a.lift);
  const out = [];
  for (const c of cand) {
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 3.2)) continue;
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

/** Dominant state per cell, for 2D maps. */
export function dominantCells(K, slice = 'trading') {
  const idx = cellIndex(K, slice);
  if (!idx) return [];
  return [...idx.map.values()].map((c) => {
    let best = 0;
    for (let k = 1; k < c.sec.length; k++) if (c.sec[k] > c.sec[best]) best = k;
    return { ...c, ...idx.centre(c.i, c.j), k: best, purity: c.sec[best] / c.tot, weight: c.tot / idx.maxTot };
  });
}

export const SLICE_SLOT = { trading: 'giorno', h08_10: '08-10', h10_12: '10-12', h12_14: '12-14', h14_16: '14-16', h16_18: '16-18', h18_20: '18-20' };
export const SLOT_SLICE = Object.fromEntries(Object.entries(SLICE_SLOT).map(([a, b]) => [b, a]));

export async function loadKinetic(url = './kinetic.json') {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`kinetic.json ${r.status}`);
  return r.json();
}

/**
 * Combine the movement states of several measured days (same grid). Seconds add up; U-turn rate and
 * speed per department are weighted by that department's person-time. `day` labels the result
 * (a day string, or the period object of the Visitor Journey view so the two stay matched).
 */
export function mergeKinetic(list, day) {
  const Ks = (list || []).filter((K) => K && K.store);
  if (!Ks.length) return null;
  if (Ks.length === 1) return { ...Ks[0], day, days: [Ks[0].day] };
  const add = (a, b) => { for (const k of IDS) a[k] = (a[k] || 0) + (Number(b?.[k]) || 0); return a; };
  const out = { ...Ks[0], day, days: Ks.map((K) => K.day), store: {}, by_slot: {}, by_dept: {}, by_dept_slot: {}, by_lane: {},
    uturns_per_min: {}, speed_m_s: {}, cells: {}, windows: 0, person_hours: 0, validation: null };
  const ut = {}, sp = {}, wt = {};
  const cellMaps = {};
  for (const K of Ks) {
    add(out.store, K.store);
    for (const [s, m] of Object.entries(K.by_slot || {})) add(out.by_slot[s] ||= {}, m);
    for (const [d, m] of Object.entries(K.by_dept || {})) {
      add(out.by_dept[d] ||= {}, m);
      const w = total(m);
      if (K.uturns_per_min?.[d] != null) { ut[d] = (ut[d] || 0) + K.uturns_per_min[d] * w; }
      if (K.speed_m_s?.[d] != null) { sp[d] = (sp[d] || 0) + K.speed_m_s[d] * w; }
      wt[d] = (wt[d] || 0) + w;
    }
    for (const [d, slots] of Object.entries(K.by_dept_slot || {})) for (const [s, m] of Object.entries(slots)) add((out.by_dept_slot[d] ||= {})[s] ||= {}, m);
    for (const [l, m] of Object.entries(K.by_lane || {})) add(out.by_lane[l] ||= {}, m);
    for (const [sl, rows] of Object.entries(K.cells || {})) {
      const M = cellMaps[sl] ||= new Map();
      for (const r of rows) {
        const key = `${r[0]},${r[1]}`;
        const c = M.get(key) || [r[0], r[1], ...new Array(IDS.length).fill(0)];
        for (let k = 0; k < IDS.length; k++) c[2 + k] += Number(r[2 + k]) || 0;
        M.set(key, c);
      }
    }
    out.windows += Number(K.windows) || 0; out.person_hours += Number(K.person_hours) || 0;
  }
  for (const d of Object.keys(wt)) {
    if (!wt[d]) continue;
    if (ut[d] != null) out.uturns_per_min[d] = ut[d] / wt[d];
    if (sp[d] != null) out.speed_m_s[d] = sp[d] / wt[d];
  }
  for (const [sl, M] of Object.entries(cellMaps)) out.cells[sl] = [...M.values()];
  out.person_hours = Math.round(out.person_hours * 10) / 10;
  return out;
}
