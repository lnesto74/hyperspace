// Visitor Journey adapter for the spatial workspace.
//
// Source of truth: GET /api/reporting/daily-kpi (table daily_kpi), the same payload
// Business Reporting → Visitor Journey reads through buildClienteMedioView
// (frontend/src/features/businessReporting/esselunga/clienteMedio/adapter.ts).
// This file only selects and names rows. It never computes a KPI: every number
// shown is a daily_kpi value, or a sum/ratio of daily_kpi values that the
// Visitor Journey page already shows (visit composition, choice index, lane shares).
//
// Stricter than the page in one place: a row whose status is not 'ok' is shown
// as unavailable with its reason, never as a number (TREVIGLIO_LIVE_AND_FLOW §4.1).

export const SLOTS = ['08-10', '10-12', '12-14', '14-16', '16-18', '18-20'];
export const DAY = 'giorno';
export const PACKAGED = 'Scaffali senza categoria';
export const CORSIE = 'Corsie / fuori zona';
export const INGRESSO = 'Ingresso, casse, retro banchi';
export const FRESH = ['Frutta', 'Verdura', 'Surgelati', 'Bakery & Breakfast', 'Latticini', 'Carne', 'Pesce', 'Bar', 'Acqua', 'Gastronomia', 'Salumi', 'Pane'];
export const SERVED = ['Carne', 'Pesce', 'Bar', 'Gastronomia', 'Salumi', 'Pane'];
export const THRESHOLDS = { queueSlotMin: 1, choiceWorked: 0.4, choicePassed: 0.25 };

// Display names (English UI). Ids stay the daily_kpi department ids.
const LABELS = {
  Frutta: 'Fruit', Verdura: 'Vegetables', Surgelati: 'Frozen', 'Bakery & Breakfast': 'Bakery & Breakfast',
  Latticini: 'Dairy', Carne: 'Meat counter', Pesce: 'Fish counter', Bar: 'Bar', Acqua: 'Water',
  Gastronomia: 'Deli counter', Salumi: 'Cured meats', Pane: 'Bread counter', [PACKAGED]: 'Packaged aisles',
  Corsie: 'Aisles (no department)', 'Ingresso/casse': 'Entrance & checkouts',
};
export const deptLabel = (id) => LABELS[id] || id;

const finite = (v) => v != null && Number.isFinite(Number(v));

export function pickKpi(payload, id, slot = DAY) {
  return (payload?.kpis || []).find((k) => k.kpi_id === id && k.slot === slot);
}

/** A daily_kpi row reduced to what the UI may show. */
export function cell(row, fallbackReason = 'Not in this day’s report') {
  if (!row) return { value: null, status: 'missing', reason: fallbackReason, label: null, method: null };
  const usable = row.status === 'ok' && finite(row.value);
  return {
    value: usable ? Number(row.value) : null,
    status: row.status || 'missing',
    reason: usable ? null : (row.status_reason || (row.status === 'no_coverage' ? 'No sensor coverage' : 'Failed a daily check')),
    label: row.label || null,
    method: row.method || null,
  };
}

function slotSeries(payload, id) {
  const out = {};
  for (const sl of [...SLOTS, DAY]) out[sl] = cell(pickKpi(payload, id, sl));
  return out;
}

/** Department minutes per customer (area or al banco), keyed rows first, slot payload maps second — as adapter.ts minutesKeyed. */
function deptMinutes(payload, id, layer) {
  const out = {};
  const names = new Set([PACKAGED, ...FRESH]);
  for (const name of names) {
    out[name] = {};
    for (const sl of [...SLOTS, DAY]) {
      const keyed = pickKpi(payload, id, `${sl}|${name}`);
      if (keyed) { out[name][sl] = cell(keyed); continue; }
      const slotRow = pickKpi(payload, id, sl);
      const raw = slotRow?.payload?.[name];
      const v = typeof raw === 'number' ? raw : raw?.[layer];
      out[name][sl] = slotRow && finite(v)
        ? cell({ ...slotRow, value: v })
        : cell(null);
    }
  }
  return out;
}

function lanes(payload) {
  const row = pickKpi(payload, 'queue_decomposition_per_lane', DAY);
  const sessions = pickKpi(payload, 'queue_sessions', DAY);
  const perLane = sessions?.status === 'ok' ? (sessions.payload?.per_lane || {}) : {};
  const list = row?.status === 'ok' && Array.isArray(row.payload) ? row.payload : [];
  const service = new Map(list.filter((l) => l.roi_group === 'CHECKOUT_SERVICE').map((l) => [Number(l.lane), l]));
  const queue = list.filter((l) => l.roi_group === 'CHECKOUT_QUEUE').map((l) => {
    const W = Number(l.WAITING || 0), T = Number(l.TRANSIT || 0), F = Number(l.FIXED || 0);
    const n = Number(l.sessions) > 0 ? Number(l.sessions) : (Number(perLane[l.lane]) > 0 ? Number(perLane[l.lane]) : null);
    const svc = service.get(Number(l.lane));
    return {
      lane: Number(l.lane),
      name: `Lane ${l.lane}`,
      waitingPm: W, transitPm: T, fixedPm: F,
      servicePm: Number(svc?.WAITING || 0),
      sessions: n,
      waitPerSessionMin: finite(l.wait_min_per_session) ? Number(l.wait_min_per_session) : (n ? W / n : null),
      servicePerSessionMin: finite(svc?.service_min_per_session) ? Number(svc.service_min_per_session) : (n && svc ? Number(svc.WAITING || 0) / n : null),
      meanPeopleWaiting: finite(l.mean_people_waiting) ? Number(l.mean_people_waiting) : null,
    };
  });
  const total = queue.reduce((s, l) => s + l.waitingPm, 0);
  return {
    status: row ? row.status : 'missing',
    reason: row && row.status !== 'ok' ? (row.status_reason || 'Failed a daily check') : (row ? null : 'Not in this day’s report'),
    totalWaitingPm: total,
    list: queue.map((l) => ({ ...l, share: total ? l.waitingPm / total : 0 })).sort((a, b) => b.waitingPm - a.waitingPm),
  };
}

function checks(payload) {
  const list = Array.isArray(payload?.checks) ? payload.checks : [];
  return { passed: list.filter((c) => c.passed).length, total: list.length, failed: list.filter((c) => !c.passed).map((c) => c.check_id) };
}

/** Build the view the workspace renders. `expected` guards venue/day. */
export function buildVisitorView(payload, expected = {}) {
  if (!payload || !Array.isArray(payload.kpis)) throw new Error('The Visitor Journey report is empty.');
  if (expected.venueId && payload.venue_id && payload.venue_id !== expected.venueId) throw new Error('The report belongs to another venue.');
  if (expected.day && payload.day !== expected.day) throw new Error(`The report is for ${payload.day}, not ${expected.day}.`);
  const area = deptMinutes(payload, 'minutes_per_customer_by_dept_area', 'area');
  const banco = deptMinutes(payload, 'minutes_per_customer_by_dept_counter', 'al_banco');
  const choice = {};
  for (const d of Object.keys(area)) {
    const keyed = pickKpi(payload, 'choice_index_by_dept', `giorno|${d}`);
    choice[d] = keyed ? cell(keyed) : { value: null, status: 'missing', reason: 'Not in this day’s report' };
  }
  const nextRow = pickKpi(payload, 'dept_next_area_share', DAY);
  const recon = { precision: cell(pickKpi(payload, 'recon_blind_precision')), vendor: cell(pickKpi(payload, 'recon_vendor_pairs_linked')) };
  const reconOk = recon.precision.value != null && recon.vendor.value != null && recon.precision.value >= 0.85 && recon.vendor.value >= 0.5;
  const counterStay = {};
  for (const d of SERVED) counterStay[d] = cell(pickKpi(payload, 'counter_stay_s', `giorno|${d}`));
  const hours = Array.isArray(payload.store_hours_local) ? `${payload.store_hours_local[0]}–${payload.store_hours_local[1]}` : '08:00–20:00';
  return {
    schema: 'visitor-journey-v1',
    venueId: payload.venue_id,
    day: payload.day,
    hours,
    source: payload.source || 'daily_kpi',
    entrances: slotSeries(payload, 'entrances'),
    visit: slotSeries(payload, 'visit_min'),
    peopleMean: slotSeries(payload, 'people_mean'),
    queue: slotSeries(payload, 'queue_wait_min_per_entrance'),
    service: slotSeries(payload, 'service_min_per_entrance'),
    area, banco, choice,
    next: reconOk && nextRow?.status === 'ok' ? (nextRow.payload || {}) : null,
    // Adjacent department hops on reconstructed journeys (201), counts — the UI shows shares of these
    // counts with their denominator, only when the reconstruction passes the same gate.
    hops: (() => { const r = pickKpi(payload, 'dept_transitions', DAY); return reconOk && r?.status === 'ok' && r.payload?.counts ? r.payload.counts : null; })(),
    reconRecall: cell(pickKpi(payload, 'recon_blind_recall')),
    reconOk,
    counterStay,
    lanes: lanes(payload),
    checks: checks(payload),
    behaviour: behaviour(payload),
  };
}

// ----------------------------------------------------------------- behaviour modes ("modi di visita")
// Journey Lab 120_behaviour_clusters: k-means on reconstructed journey segments >= 20 s, named by fixed
// rules. Stored nightly in daily_kpi as behaviour_share (store mix, mix per department, per slot) and
// behaviour_mix_by_slot. ESTIMATED. Colours are the workspace's, names are the job's.
export const BEHAVIOUR_MODES = [
  { id: 'Movimento con soste brevi', color: '#65DEF0', en: 'Walking, short stops' },
  { id: 'Giro lungo in corsia', color: '#A99BFF', en: 'Long browse in the aisles' },
  { id: 'Fermo a scaffale (sceglie)', color: '#F3C778', en: 'Stopped at the shelf, choosing' },
  { id: 'Al banco servito', color: '#81E0A3', en: 'At a served counter' },
  { id: 'Fermo in corsia (fuori zona)', color: '#7E93A6', en: 'Standing in the aisle, off the shelves' },
  { id: 'In coda', color: '#FB8B80', en: 'Queuing' },
  { id: 'In cassa (servizio)', color: '#F6A6C9', en: 'At the till, being served' },
];

function behaviour(payload) {
  const row = pickKpi(payload, 'behaviour_share', DAY);
  if (!row || row.status !== 'ok' || !row.payload) {
    return { ok: false, reason: row ? (row.status_reason || 'Failed a daily check') : 'Not in this day’s report' };
  }
  const p = row.payload;
  const share = { ...(p.share || {}) };
  // {mode: {dept: share}} -> {dept: {mode: share}}
  const deptMix = {};
  for (const [mode, depts] of Object.entries(p.dept_mix_time_share || {})) {
    for (const [dept, v] of Object.entries(depts || {})) (deptMix[dept] ||= {})[mode] = Number(v) || 0;
  }
  const slotRow = pickKpi(payload, 'behaviour_mix_by_slot', DAY);
  let slotMix = {};
  if (slotRow?.status === 'ok' && slotRow.payload) slotMix = slotRow.payload;
  else for (const [mode, slots] of Object.entries(p.slot_mix_segment_share || {})) for (const [sl, v] of Object.entries(slots || {})) (slotMix[sl] ||= {})[mode] = Number(v) || 0;
  return { ok: true, label: row.label, method: row.method, segments: Number(p.segments) || null, share, deptMix, slotMix,
    profiles: Array.isArray(p.cluster_profiles) ? p.cluster_profiles : [] };
}

/** A department's mix as [{mode, share}] over the seven modes, normalised to 1. */
export function modeMix(view, dept) {
  const m = view?.behaviour?.deptMix?.[dept];
  if (!m) return null;
  const rows = BEHAVIOUR_MODES.map((b) => ({ ...b, share: Number(m[b.id]) || 0 }));
  const tot = rows.reduce((s, r) => s + r.share, 0);
  if (!(tot > 0)) return null;
  return rows.map((r) => ({ ...r, share: r.share / tot })).sort((a, b) => b.share - a.share);
}

// ----------------------------------------------------------------- derived views
// Only sums and ratios that Visitor Journey already shows.

/** Departments ranked by minutes per customer in the slot; packaged aisles kept apart. */
export function rankDepartments(view, slot = DAY, { includePackaged = false } = {}) {
  if (!view) return [];
  return Object.keys(view.area)
    .filter((d) => includePackaged || d !== PACKAGED)
    .map((d) => {
      const a = view.area[d]?.[slot], b = view.banco[d]?.[slot];
      const share = a?.value > 0 && b?.value != null ? b.value / a.value : null;
      return { id: d, name: deptLabel(d), area: a, banco: b, choiceShare: share, choice: choiceKind(share) };
    })
    .filter((r) => r.area?.value != null && r.area.value >= 0.05)
    .sort((x, y) => y.area.value - x.area.value);
}

export function choiceKind(share) {
  if (share == null) return 'mixed';
  if (share >= THRESHOLDS.choiceWorked) return 'worked';
  if (share < THRESHOLDS.choicePassed) return 'passed';
  return 'mixed';
}
export const CHOICE_LABEL = { worked: 'worked', passed: 'crossed', mixed: 'in between' };

/** "Com'è fatta la visita": same four segments as visitComposition.ts. */
export function visitComposition(view, slot = DAY) {
  const v = view?.visit?.[slot]?.value;
  if (v == null) return null;
  const packaged = view.area[PACKAGED]?.[slot]?.value || 0;
  const fresh = FRESH.reduce((s, d) => s + (view.area[d]?.[slot]?.value || 0), 0);
  const checkout = (view.queue[slot]?.value || 0) + (view.service[slot]?.value || 0);
  const other = Math.max(0, v - packaged - fresh - checkout);
  return { visit: v, segments: [
    { id: 'packaged', label: 'Packaged aisles', minutes: packaged },
    { id: 'fresh', label: 'Fresh departments', minutes: fresh },
    { id: 'checkout', label: 'Checkouts', minutes: checkout },
    { id: 'other', label: 'Entrance and other', minutes: other },
  ] };
}

/** Slot with the highest queue wait per customer, and the first slot over the 1-minute line. */
export function queuePeak(view) {
  let peak = null, over = null;
  for (const sl of SLOTS) {
    const v = view?.queue?.[sl]?.value;
    if (v == null) continue;
    if (!peak || v > peak.value) peak = { slot: sl, value: v };
    if (v > THRESHOLDS.queueSlotMin && (!over || v > over.value)) over = { slot: sl, value: v };
  }
  return { peak, over };
}

/** Next department after `dept`: shares of the reconstructed adjacent hops leaving it (whole day). */
export function nextDepartments(view, dept, min = 0.05) {
  const row = view?.hops?.[dept];
  if (!row) return null;
  const total = Object.entries(row).filter(([k]) => k !== dept).reduce((s, [, n]) => s + (Number(n) || 0), 0);
  if (!(total > 0)) return null;
  return { total, list: Object.entries(row).filter(([k, n]) => k !== dept && n / total >= min).map(([k, n]) => ({ id: k, n, share: n / total })).sort((a, b) => b.n - a.n) };
}

export function entrancePeak(view) {
  let best = null;
  for (const sl of SLOTS) {
    const v = view?.entrances?.[sl]?.value;
    if (v != null && (!best || v > best.value)) best = { slot: sl, value: v };
  }
  return best;
}

// ----------------------------------------------------------------- formatting

export function fmtDuration(min) {
  if (min == null || !Number.isFinite(min)) return '—';
  const s = Math.round(min * 60);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
export function fmtInt(n) { return n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-GB'); }
export function fmtSlot(sl) { return sl === DAY ? 'Whole day 08–20' : sl.replace('-', '–'); }
export function fmtDay(day) {
  if (!day) return '';
  // A combined period is carried as "from/to" (see combineViews).
  if (day.includes('/')) {
    const [a, b] = day.split('/');
    const o = { day: 'numeric', month: 'short', timeZone: 'UTC' };
    return `${new Date(`${a}T12:00:00Z`).toLocaleDateString('en-GB', o)} – ${new Date(`${b}T12:00:00Z`).toLocaleDateString('en-GB', o)}`;
  }
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ----------------------------------------------------------------- loading

// Snapshot only off the production app (local preview or a private review page), never on *.hyspace.app.
export const isPreviewHost = () => !/(^|\.)hyspace\.app$/.test(location.hostname);

/**
 * Load the day. Production: the API, or an honest unavailable state.
 * Local preview only: a labelled snapshot assembled by scripts/daily-customer-kpi.py.
 */
export async function loadVisitorJourney({ venueId, day, fetcher = fetch }) {
  const tries = [];
  if (venueId && day) tries.push(['api', `/api/reporting/daily-kpi?venueId=${encodeURIComponent(venueId)}&day=${encodeURIComponent(day)}`]);
  if (isPreviewHost()) tries.push(['snapshot', `./visitor-journey-snapshot.json`]);
  let lastError = 'No day selected';
  for (const [kind, url] of tries) {
    try {
      const r = await fetcher(url, { credentials: 'include', cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const payload = await r.json();
      if (payload?.status === 'computing') { lastError = 'The nightly job is still computing this day'; continue; }
      const view = buildVisitorView(payload, { venueId, day: kind === 'api' ? day : undefined });
      return { view, origin: kind, note: kind === 'snapshot' ? `Local preview snapshot of daily_kpi for ${view.day}` : 'daily_kpi · Visitor Journey' };
    } catch (e) { lastError = e.message; }
  }
  return { view: null, origin: 'none', note: `Visitor Journey unavailable: ${lastError}` };
}

let areasPromise = null;
export function loadAreas() {
  areasPromise ||= fetch('./visitor-areas.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return areasPromise;
}

export function polygonCentre(rings) {
  let sx = 0, sz = 0, n = 0;
  for (const r of rings || []) for (const [x, z] of r.outer) { sx += x; sz += z; n++; }
  return n ? { x: sx / n, z: sz / n } : null;
}


// ----------------------------------------------------------------- several days → one view
// Week / month: the same view shape, so every lens works unchanged. Only exact recombinations:
//   counts (entrants, person-minutes, sessions) add up;
//   per-entrant minutes = Σ(value × entrants) ÷ Σ entrants of the same slot (= Σ person-minutes ÷ Σ entrants);
//   choice index = combined time at the shelf ÷ combined time in area;
//   people in store = mean of the days.
// A day whose cell failed its daily check is left out of that cell, and the cell says how many days it uses.

function partial(cells, combine, n, why) {
  const ok = cells.filter((c) => c && c.status === 'ok' && c.value != null);
  if (!ok.length) return { value: null, status: 'missing', reason: why || `No reliable day in this period (${n} days)`, label: null, method: null, days: 0, of: n };
  const label = ok.every((c) => c.label === 'MEASURED') ? 'MEASURED' : (ok.find((c) => c.label)?.label || null);
  const value = combine(ok);
  return { value, status: value == null ? 'missing' : 'ok', reason: ok.length < n ? `${ok.length} of ${n} days` : null, label,
    method: `Combined over ${ok.length} of ${n} days. ${ok[0].method || ''}`.trim(), days: ok.length, of: n };
}

export function combineViews(views, { from, to } = {}) {
  const vs = views.filter(Boolean);
  if (!vs.length) return null;
  if (vs.length === 1 && (!from || from === to)) return vs[0];
  const n = vs.length;
  const slots = [...SLOTS, DAY];
  const series = (get) => Object.fromEntries(slots.map((sl) => [sl, get(sl)]));
  const entr = (v, sl) => (v.entrances?.[sl]?.status === 'ok' ? v.entrances[sl].value : null);
  const sum = (key) => series((sl) => partial(vs.map((v) => v[key]?.[sl]), (ok) => ok.reduce((a, c) => a + c.value, 0), n));
  const mean = (key) => series((sl) => partial(vs.map((v) => v[key]?.[sl]), (ok) => ok.reduce((a, c) => a + c.value, 0) / ok.length, n));
  // Entrant-weighted: keep only days where both the value and that slot's entrants are reliable.
  const weighted = (getCell) => series((sl) => {
    const pairs = vs.map((v) => ({ c: getCell(v, sl), w: entr(v, sl) })).filter((x) => x.c?.status === 'ok' && x.c.value != null && x.w > 0);
    return partial(pairs.map((x) => ({ ...x.c, _w: x.w })), (ok) => { const W = ok.reduce((a, c) => a + c._w, 0); return W ? ok.reduce((a, c) => a + c.value * c._w, 0) / W : null; }, n);
  });
  const depts = [...new Set(vs.flatMap((v) => Object.keys(v.area || {})))];
  const area = Object.fromEntries(depts.map((d) => [d, weighted((v, sl) => v.area?.[d]?.[sl])]));
  const banco = Object.fromEntries(depts.map((d) => [d, weighted((v, sl) => v.banco?.[d]?.[sl])]));
  const choice = Object.fromEntries(depts.map((d) => {
    const a = area[d][DAY], b = banco[d][DAY];
    return [d, a.value > 0 && b.value != null
      ? { value: b.value / a.value, status: 'ok', reason: null, label: 'ESTIMATED', method: 'Combined time at the shelf ÷ combined time in area over the period', days: Math.min(a.days, b.days), of: n }
      : { value: null, status: 'missing', reason: 'Not enough reliable days', label: null, method: null }];
  }));
  // Lanes: add the person-minutes and sessions, then recompute shares and per-session minutes.
  const laneMap = new Map();
  for (const v of vs) for (const l of v.lanes?.list || []) {
    const m = laneMap.get(l.lane) || { lane: l.lane, name: l.name, waitingPm: 0, transitPm: 0, fixedPm: 0, servicePm: 0, sessions: 0, sessionsKnown: true, people: [], days: 0 };
    m.waitingPm += l.waitingPm; m.transitPm += l.transitPm; m.fixedPm += l.fixedPm || 0; m.servicePm += l.servicePm || 0;
    if (l.sessions > 0) m.sessions += l.sessions; else m.sessionsKnown = false;
    if (l.meanPeopleWaiting != null) m.people.push(l.meanPeopleWaiting);
    m.days++; laneMap.set(l.lane, m);
  }
  const laneList = [...laneMap.values()].map((m) => ({ lane: m.lane, name: m.name, waitingPm: m.waitingPm, transitPm: m.transitPm, fixedPm: m.fixedPm, servicePm: m.servicePm,
    sessions: m.sessionsKnown && m.sessions > 0 ? m.sessions : null,
    waitPerSessionMin: m.sessionsKnown && m.sessions > 0 ? m.waitingPm / m.sessions : null,
    servicePerSessionMin: m.sessionsKnown && m.sessions > 0 ? m.servicePm / m.sessions : null,
    meanPeopleWaiting: m.people.length ? m.people.reduce((a, b) => a + b, 0) / m.people.length : null, days: m.days }));
  const totalW = laneList.reduce((a, l) => a + l.waitingPm, 0);
  const laneDays = vs.filter((v) => v.lanes?.status === 'ok').length;
  // Behaviour modes: segment-weighted.
  const bv = vs.filter((v) => v.behaviour?.ok);
  const wmix = (get) => { const out = {}; let W = 0; for (const v of bv) { const w = v.behaviour.segments || 1; W += w; for (const [k, x] of Object.entries(get(v) || {})) out[k] = (out[k] || 0) + x * w; } for (const k of Object.keys(out)) out[k] /= W || 1; return out; };
  const nested = (get) => { const keys = new Set(bv.flatMap((v) => Object.keys(get(v) || {}))); return Object.fromEntries([...keys].map((k) => [k, wmix((v) => get(v)?.[k])])); };
  const behaviour = bv.length ? { ok: true, label: 'ESTIMATED', method: `Segment-weighted over ${bv.length} of ${n} days`, segments: bv.reduce((a, v) => a + (v.behaviour.segments || 0), 0),
    share: wmix((v) => v.behaviour.share), deptMix: nested((v) => v.behaviour.deptMix), slotMix: nested((v) => v.behaviour.slotMix), profiles: [] }
    : { ok: false, reason: 'No day in this period has behaviour modes' };
  // Reconstructed hops: counts add up, only when every day passed the reconstruction gate.
  let hops = null;
  if (vs.every((v) => v.hops)) {
    hops = {};
    for (const v of vs) for (const [a, row] of Object.entries(v.hops)) for (const [b, c] of Object.entries(row)) ((hops[a] ||= {})[b] = (hops[a][b] || 0) + (Number(c) || 0));
  }
  const ck = vs.map((v) => v.checks || { passed: 0, total: 0, failed: [] });
  return {
    schema: 'visitor-journey-v1', venueId: vs[0].venueId,
    day: from && to ? `${from}/${to}` : vs[0].day,
    period: { from, to, days: vs.map((v) => v.day), n },
    hours: vs[0].hours, source: vs[0].source,
    entrances: sum('entrances'),
    visit: weighted((v, sl) => v.visit?.[sl]),
    peopleMean: mean('peopleMean'),
    queue: weighted((v, sl) => v.queue?.[sl]),
    service: weighted((v, sl) => v.service?.[sl]),
    area, banco, choice,
    next: null, hops,
    reconRecall: { value: null, status: 'missing', reason: 'Per-day measure', label: null, method: null },
    reconOk: vs.every((v) => v.reconOk),
    counterStay: Object.fromEntries(SERVED.map((d) => [d, { value: null, status: 'missing', reason: 'Per-day measure, not combined', label: null, method: null }])),
    lanes: { status: laneDays ? 'ok' : 'missing', reason: laneDays ? (laneDays < n ? `${laneDays} of ${n} days` : null) : 'No day in this period has lane data',
      totalWaitingPm: totalW, list: laneList.map((l) => ({ ...l, share: totalW ? l.waitingPm / totalW : 0 })).sort((a, b) => b.waitingPm - a.waitingPm) },
    checks: { passed: ck.reduce((a, c) => a + c.passed, 0), total: ck.reduce((a, c) => a + c.total, 0), failed: [...new Set(ck.flatMap((c) => c.failed))] },
    behaviour,
  };
}
