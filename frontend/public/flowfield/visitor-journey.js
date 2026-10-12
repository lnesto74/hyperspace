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

const LABELS = {
  Frutta: 'Frutta', Verdura: 'Verdura', Surgelati: 'Surgelati', 'Bakery & Breakfast': 'Pane e colazione',
  Latticini: 'Latticini', Carne: 'Carne', Pesce: 'Pesce', Bar: 'Bar', Acqua: 'Acqua',
  Gastronomia: 'Gastronomia', Salumi: 'Salumi', Pane: 'Pane (banco)', [PACKAGED]: 'Corsie del confezionato',
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
      name: `Cassa ${l.lane}`,
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
    reconOk,
    counterStay,
    lanes: lanes(payload),
    checks: checks(payload),
  };
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
export const CHOICE_LABEL = { worked: 'lavorato', passed: 'attraversato', mixed: 'intermedio' };

/** "Com'è fatta la visita": same four segments as visitComposition.ts. */
export function visitComposition(view, slot = DAY) {
  const v = view?.visit?.[slot]?.value;
  if (v == null) return null;
  const packaged = view.area[PACKAGED]?.[slot]?.value || 0;
  const fresh = FRESH.reduce((s, d) => s + (view.area[d]?.[slot]?.value || 0), 0);
  const checkout = (view.queue[slot]?.value || 0) + (view.service[slot]?.value || 0);
  const other = Math.max(0, v - packaged - fresh - checkout);
  return { visit: v, segments: [
    { id: 'packaged', label: 'Corsie del confezionato', minutes: packaged },
    { id: 'fresh', label: 'Reparti freschi', minutes: fresh },
    { id: 'checkout', label: 'Casse', minutes: checkout },
    { id: 'other', label: 'Ingresso e altro', minutes: other },
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
export function fmtInt(n) { return n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('it-IT'); }
export function fmtSlot(sl) { return sl === DAY ? 'Giornata 08–20' : sl.replace('-', '–'); }
export function fmtDay(day) {
  if (!day) return '';
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ----------------------------------------------------------------- loading

const isPreviewHost = () => ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) || location.hostname.endsWith('.localhost');

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
