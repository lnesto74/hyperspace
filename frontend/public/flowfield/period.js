// Period picker data layer: which days exist, loading a day / week / month of Visitor Journey,
// and merging the flow-field packs of several days onto one floor.
//
// Backend contract (backend/routes/businessReporting.js, already in production):
//   GET /api/reporting/daily-kpi/range?venueId&from&to
//       → { days:[{day,…}], parquetDays:[…], labDays:[…], computableDays:[…] }
//   GET /api/reporting/daily-kpi?venueId&day
//       200 { status:'ok', …payload }       the day is calculated
//       202 { status:'computing', eta_s }    a job was queued / is running: poll again
//       404 { status:'no_data' }             no raw data for that day
//       503 { status:'error', error }        the job failed
// Nothing here computes a KPI. Combining days is done on the Visitor Journey view
// (visitor-journey.js combineViews): sums of counts, entrant-weighted means of per-entrant minutes.

export const MODES = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];
const DAY_MS = 86400000;

// ------------------------------------------------------------------ dates (plain YYYY-MM-DD, local calendar)
const parse = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd)); };
const iso = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d, n) => iso(parse(d).getTime() + n * DAY_MS);
export function enumerate(from, to) {
  const out = [];
  for (let t = parse(from).getTime(), end = parse(to).getTime(); t <= end; t += DAY_MS) out.push(iso(t));
  return out;
}
/** Monday-first week containing `day`. */
export function weekOf(day) {
  const dow = (parse(day).getUTCDay() + 6) % 7; // 0 = Monday
  const from = addDays(day, -dow);
  return { from, to: addDays(from, 6) };
}
export function monthOf(day) {
  const d = parse(day);
  const from = iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const to = iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from, to };
}
export function periodFor(mode, day) {
  const r = mode === 'week' ? weekOf(day) : mode === 'month' ? monthOf(day) : { from: day, to: day };
  return { mode, ...r, days: enumerate(r.from, r.to) };
}
const fmt = (d, o) => parse(d).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
export function periodLabel(p) {
  if (!p) return '';
  if (p.mode === 'day' || p.from === p.to) return fmt(p.from, { weekday: 'short', day: 'numeric', month: 'short' });
  if (p.mode === 'month') return fmt(p.from, { month: 'long', year: 'numeric' });
  const a = parse(p.from), b = parse(p.to);
  return a.getUTCMonth() === b.getUTCMonth()
    ? `Week ${a.getUTCDate()}–${fmt(p.to, { day: 'numeric', month: 'short' })}`
    : `Week ${fmt(p.from, { day: 'numeric', month: 'short' })} – ${fmt(p.to, { day: 'numeric', month: 'short' })}`;
}
/** Calendar grid for the month of `day`: 6 rows × 7 (Monday first), null outside the month. */
export function monthGrid(day) {
  const { from, to } = monthOf(day);
  const lead = (parse(from).getUTCDay() + 6) % 7;
  const cells = Array(lead).fill(null).concat(enumerate(from, to));
  while (cells.length % 7) cells.push(null);
  return cells;
}

// ------------------------------------------------------------------ availability
/** Status of each day in [from, to]: 'ready' | 'computable' | 'none'. `online` false when the API is unreachable. */
export async function availability({ venueId, from, to, fetcher = fetch, offlineDays = [] }) {
  try {
    const r = await fetcher(`/api/reporting/daily-kpi/range?venueId=${encodeURIComponent(venueId)}&from=${from}&to=${to}`, { credentials: 'include', cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const ready = new Set((j.days || []).map((d) => (typeof d === 'string' ? d : d.day)));
    const comp = new Set([...(j.computableDays || []), ...(j.parquetDays || []), ...(j.labDays || [])]);
    const status = {};
    for (const d of enumerate(from, to)) status[d] = ready.has(d) ? 'ready' : comp.has(d) ? 'computable' : 'none';
    return { online: true, status };
  } catch (e) {
    const status = {};
    for (const d of enumerate(from, to)) status[d] = offlineDays.includes(d) ? 'ready' : 'none';
    return { online: false, status, error: e.message };
  }
}

// ------------------------------------------------------------------ loading days (with server-side calculation)
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('cancelled', 'AbortError')); }, { once: true });
});

/**
 * Load one day; while the backend is calculating it, report progress and poll.
 * onUpdate({day, state:'loading'|'computing'|'ready'|'none'|'error', eta_s, note})
 */
export async function loadDay({ venueId, day, fetcher = fetch, signal, onUpdate = () => {}, pollMs = 5000, maxWaitMs = 30 * 60000, retry = false }) {
  const t0 = Date.now();
  onUpdate({ day, state: 'loading' });
  let first = true;
  for (;;) {
    if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
    let r;
    try {
      r = await fetcher(`/api/reporting/daily-kpi?venueId=${encodeURIComponent(venueId)}&day=${day}${first && retry ? '&retry=1' : ''}`, { credentials: 'include', cache: 'no-store', signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      onUpdate({ day, state: 'error', note: 'Server not reachable' });
      return { day, state: 'error', note: 'Server not reachable' };
    }
    first = false;
    const body = await r.json().catch(() => ({}));
    if (r.status === 202 || body.status === 'computing') {
      const waited = Date.now() - t0;
      if (waited > maxWaitMs) { onUpdate({ day, state: 'error', note: 'Still calculating after 30 min' }); return { day, state: 'error', note: 'Still calculating after 30 min' }; }
      onUpdate({ day, state: 'computing', eta_s: body.eta_s ?? null, waited_s: Math.round(waited / 1000), missing: body.missing || null });
      await sleep(pollMs, signal);
      continue;
    }
    if (r.status === 404 || body.status === 'no_data') { onUpdate({ day, state: 'none', note: 'No data for this day' }); return { day, state: 'none' }; }
    if (!r.ok || body.status === 'error') {
      const note = body.error || `HTTP ${r.status}`;
      onUpdate({ day, state: 'error', note }); return { day, state: 'error', note };
    }
    onUpdate({ day, state: 'ready' });
    return { day, state: 'ready', payload: body };
  }
}

/** Load many days, `concurrency` at a time (the backend queue calculates one day at a time anyway). */
export async function loadDays({ days, concurrency = 2, ...rest }) {
  const out = new Array(days.length);
  let next = 0;
  const worker = async () => { while (next < days.length) { const k = next++; out[k] = await loadDay({ ...rest, day: days[k] }); } };
  await Promise.all(Array.from({ length: Math.min(concurrency, days.length) }, worker));
  return out;
}

// ------------------------------------------------------------------ flow floor over several days
/**
 * Merge flow-field packs (same slice, same 1.5 m anchor grid) cell by cell.
 * Counts and seconds add up (t track keys, k accepted steps, d slow seconds, e presence seconds, r rose);
 * speed and purity are step-weighted means. The result is a regular pack, so the renderer and every
 * Flow Explorer layer work unchanged.
 */
export function mergeFieldPacks(packs, label = {}) {
  const ok = packs.filter((p) => p?.meta && Array.isArray(p.cells) && p.cells.length);
  if (!ok.length) return null;
  const base = ok[0].meta;
  for (const p of ok) {
    if (p.meta.cell_m !== base.cell_m || p.meta.bins !== base.bins || p.meta.origin_m?.x !== base.origin_m?.x || p.meta.origin_m?.y !== base.origin_m?.y) {
      throw new Error('Flow packs are on different grids and cannot be combined');
    }
  }
  const B = base.bins;
  const map = new Map();
  for (const p of ok) for (const c of p.cells) {
    const key = `${c.i},${c.j}`;
    let m = map.get(key);
    if (!m) { m = { i: c.i, j: c.j, t: 0, k: 0, d: 0, e: 0, sw: 0, pw: 0, r: new Array(B).fill(0) }; map.set(key, m); }
    const k = Number(c.k) || 0;
    m.t += Number(c.t) || 0; m.k += k; m.d += Number(c.d) || 0; m.e += Number(c.e) || 0;
    m.sw += (Number(c.s) || 0) * k; m.pw += (Number(c.p) || 0) * k;
    if (Array.isArray(c.r)) for (let b = 0; b < B; b++) m.r[b] += Number(c.r[b]) || 0;
  }
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const cells = [...map.values()].map((m) => ({ i: m.i, j: m.j, t: m.t, k: r3(m.k), p: m.k ? r3(m.pw / m.k) : 0, s: m.k ? r3(m.sw / m.k) : 0, d: r3(m.d), e: r3(m.e), r: m.r }));
  const max = (f) => cells.reduce((a, c) => Math.max(a, c[f]), 0);
  return {
    meta: { ...base, pack: 'range', window: 'range', source: `${ok.length} days combined: ${label.days?.join(', ') || ''}`.trim(),
      local_date: label.from || base.local_date, range: { from: label.from, to: label.to, days: label.days || [], combined: ok.length },
      cells_emitted: cells.length, max_traffic: max('t'), max_steps: max('k'), max_dwell_sec: max('d'),
      steps_total: r3(cells.reduce((a, c) => a + c.k, 0)), built_at: Date.now() },
    cells,
  };
}
