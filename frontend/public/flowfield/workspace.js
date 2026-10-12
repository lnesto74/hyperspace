// Hyperspace Retail — spatial workspace. One living twin, seven lenses.
//
// Numbers: only Visitor Journey (daily_kpi) through visitor-journey.js. The flow field
// is movement context and never produces a KPI here.
// Geometry: visitor-areas.json = the exact 0.25 m department raster the minutes were
// measured on (scripts/daily_kpi/export_area_geometry.py), plus checkout lane ROIs.
// Renderer: main.js keeps every flow algorithm; this file picks lens, layer, camera.

import { LENSES, LENS, SLOT_TO_SLICE, ICONS } from './lenses.js?v=lens-1';
import * as VJ from './visitor-journey.js?v=lens-1';
import { radarAreas } from './value-opportunities.js';
import { loadExecutiveReport } from './executive-report.js?v=lens-1';
import { reportRow } from './journey-scorecard.js?v=lens-1';

// Two KPI contracts, never merged on one card:
//   vj   = Visitor Journey (daily_kpi, 08–20, 2-hour slots) — default.
//   exec = Esselunga executive customer-journey report (ExecutiveJourneyService, 00:00–23:30),
//          through Astra's executive-report.js adapter; archived PDF snapshot when the service is down.
const EXEC_LAYERS = { engagement: [['stoppingPct', 'Stopping'], ['dwellSec', 'Dwell'], ['engagementSec', 'Engagement'], ['crossings', 'Crossings']], service: [['avgWaitSec', 'Average wait']] };
const EXEC_FMT = { stoppingPct: (x) => `${num(x, 1)}%`, dwellSec: (x) => `${Math.round(x)} s`, engagementSec: (x) => `${Math.round(x)} s`, crossings: (x) => Math.round(x).toLocaleString('it-IT'), avgWaitSec: (x) => `${Math.round(x)} s` };
const EXEC_COPY = { engagement: ['Where customers stop', 'Stopping, dwell and engagement at each mapped frontage, from the customer journey report.'], service: ['Where waiting concentrates', 'Average wait per lane from the customer journey report, on the real checkout lanes.'] };
const FLOW_SLICES = [['all', 'All day'], ['morning', '07–11'], ['midday', '11–15'], ['afternoon', '15–19'], ['evening', '19–22']];

const SVG_NS = 'http://www.w3.org/2000/svg';

function h(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
  return n;
}
const sv = (tag, attrs = {}) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const pct = (x, d = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d).replace('.', ','));

function kpiValue(c, fmt = VJ.fmtDuration) {
  if (!c || c.value == null) return h('span', { class: 'hx-na', title: c?.reason || 'Not available' }, '—');
  return fmt(c.value);
}
function chip(label, cls = '') { return h('span', { class: `hx-chip ${cls}` }, label); }
function srcTag(c) {
  if (!c?.label) return null;
  return h('span', { class: `hx-src ${c.label === 'MEASURED' ? 'm' : 'e'}`, title: c.method || '' }, c.label === 'MEASURED' ? 'MISURATO' : 'STIMATO');
}

export function mountAnalysisWorkspace(api) {
  const root = document.documentElement;
  if (root.classList.contains('export')) return;
  root.classList.add('hx');

  const qs = new URLSearchParams(location.search);
  const state = {
    lens: LENS[qs.get('lens')] ? qs.get('lens') : 'pulse',
    slot: 'giorno',
    sel: null, // {kind:'dept'|'lane', id}
    layer: {},
    perspective: 'business',
    vj: { view: null, origin: 'loading', note: 'Loading Visitor Journey…' },
    vjB: null,
    areas: null,
    radar: { list: [], note: '', busy: false, stamp: '' },
    compare: { a: 'morning', b: 'evening', packs: {}, note: '' },
    busy: false,
    source: qs.get('source') === 'exec' ? 'exec' : 'vj',
    exec: { report: null, status: 'idle', note: '' },
    execLayer: { engagement: 'stoppingPct', service: 'avgWaitSec' },
  };
  for (const l of LENSES) state.layer[l.id] = l.layers[0][0];

  // ------------------------------------------------------------------ shell
  const top = h('header', { class: 'hx-top' });
  const brand = h('div', { class: 'hx-brand' }, h('i', { html: ICONS.logo }), h('div', null, h('b', null, 'HYPERSPACE'), h('small', null, 'RETAIL INTELLIGENCE')));
  const venue = h('div', { class: 'hx-venue' }, 'Esselunga / Treviglio');
  const tabs = h('nav', { class: 'hx-tabs', 'aria-label': 'Lenses' });
  const dayBox = h('div', { class: 'hx-day' });
  const labBtn = h('button', { class: 'hx-ghost', type: 'button', title: 'Engineering controls (Lab)', onclick: () => toggleLab() }, h('i', { html: ICONS.lab }), 'Lab');
  top.append(brand, venue, tabs, h('div', { class: 'hx-top-r' }, dayBox, labBtn));

  const rail = h('nav', { class: 'hx-rail', 'aria-label': 'Lenses' });
  const main = h('main', { class: 'hx-main' });
  const titleRow = h('div', { class: 'hx-title' });
  const stage = h('section', { class: 'hx-stage', 'aria-label': 'Spatial digital twin' });
  const inspector = h('aside', { class: 'hx-inspector', 'aria-label': 'Inspector' });
  const sheetBtn = h('button', { class: 'hx-sheet-btn', type: 'button', onclick: () => root.classList.toggle('hx-sheet-open') }, 'Details');
  const foot = h('footer', { class: 'hx-foot' }, h('span', null, h('b', null, 'HYPERSPACE'), ' / TREVIGLIO · SPATIAL RETAIL INTELLIGENCE'),
    h('span', null, 'One digital twin · contextual lenses · source-aware metrics'), h('span', { class: 'hx-foot-src' }));
  main.append(titleRow, stage);
  document.body.append(top, rail, main, inspector, sheetBtn, foot);

  const view = document.getElementById('view');
  stage.append(view);
  const overlay = sv('svg', { class: 'hx-overlay' });
  const tags = h('div', { class: 'hx-tags' });
  const twinTag = h('div', { class: 'hx-twin-tag' }, h('i'), 'SPATIAL DIGITAL TWIN', h('span', null, '·'), 'TREVIGLIO / LEVEL 00');
  const layerSeg = h('div', { class: 'hx-seg hx-layer-seg', role: 'group', 'aria-label': 'Layers' });
  const legend = h('div', { class: 'hx-legend' });
  const bar = h('div', { class: 'hx-bar' });
  const compareBox = h('div', { class: 'hx-compare', hidden: true });
  const stageNote = h('div', { class: 'hx-stage-note', hidden: true });
  stage.append(overlay, tags, twinTag, layerSeg, legend, bar, compareBox, stageNote);

  // Legacy chrome stays mounted for the renderer's bindings, but out of sight.
  const controls = document.getElementById('controls');
  controls?.setAttribute('aria-hidden', 'true');
  const labHead = h('div', { class: 'hx-lab-head' }, h('b', null, 'LAB'), ' · engineering controls. Tuning, not analysis.', h('button', { type: 'button', class: 'hx-ghost', onclick: () => toggleLab(false) }, 'Close'));
  controls?.prepend(labHead);
  function toggleLab(on) {
    const v = root.classList.toggle('hx-lab', on);
    controls?.setAttribute('aria-hidden', String(!v));
  }

  for (const l of LENSES) {
    tabs.append(h('button', { type: 'button', 'data-lens': l.id, onclick: () => setLens(l.id) }, l.tab));
    rail.append(h('button', { type: 'button', 'data-lens': l.id, title: l.tab, 'aria-label': l.tab, onclick: () => setLens(l.id), html: ICONS[l.icon] }));
  }
  rail.append(h('span', { class: 'hx-rail-gap' }), h('button', { type: 'button', title: 'Lab', 'aria-label': 'Lab', onclick: () => toggleLab(), html: ICONS.lab }));

  // ------------------------------------------------------------------ data
  const info = () => api.packInfo();
  const kpiDay = () => state.vj.view?.day || info().date || info().latest || null;

  async function loadVJ() {
    const i = info();
    state.vj = { view: null, origin: 'loading', note: 'Loading Visitor Journey…' };
    render();
    const venueId = i.venue || api.snapshot().field?.meta?.venue_id;
    state.vj = await VJ.loadVisitorJourney({ venueId, day: i.date || i.latest });
    render();
  }

  const isExec = () => state.source === 'exec' && ['pulse', 'engagement', 'service'].includes(state.lens);
  async function loadExec() {
    if (state.exec.status === 'loading' || state.exec.report) return;
    state.exec = { report: null, status: 'loading', note: 'Loading the customer journey report…' };
    render();
    const venue = info().venue || api.snapshot().field?.meta?.venue_id;
    try {
      const report = await loadExecutiveReport(venue);
      state.exec = { report, status: 'calc', note: 'Report calculated · ExecutiveJourneyService' };
    } catch (e) {
      try {
        const data = await fetch('./journey-reference.json', { cache: 'no-store' }).then((r) => r.json());
        if (data.venueId !== venue) throw new Error('venue mismatch');
        state.exec = { report: data, status: 'archived', note: `Archived PDF snapshot · ${data.source}` };
      } catch { state.exec = { report: null, status: 'none', note: `Customer journey report unavailable (${e.message})` }; }
    }
    render();
  }
  async function setSource(src) {
    if (state.source === src) return;
    state.source = src;
    if (state.sel) select(null);
    if (src === 'exec') await loadExec();
    render();
  }
  /** Mapped ROI unions per category / queue lane, straight from the venue ROIs (no flow gating). */
  let execAreaCache = null;
  function execAreas() {
    const rois = api.snapshot().rois || [];
    if (execAreaCache?.rois === rois) return execAreaCache.areas;
    const groups = new Map();
    for (const roi of rois) {
      if (!roi.vertices?.length) continue;
      const queue = /checkout.*queue|cassa.*coda/i.test(roi.name || '');
      if (!queue && !roi.category) continue;
      const key = queue ? roi.id : `department:${roi.category}`;
      if (!groups.has(key)) groups.set(key, { key, name: queue ? roi.name.replace(/\s*-\s*Queue/i, '') : roi.category, kind: queue ? 'queue' : 'department', rois: [], polygons: [] });
      groups.get(key).rois.push(roi); groups.get(key).polygons.push(roi.vertices);
    }
    const areas = [...groups.values()].map((g) => {
      const pts = g.polygons.flat();
      return { ...g, x: pts.reduce((t, p) => t + p[0], 0) / pts.length, z: pts.reduce((t, p) => t + p[1], 0) / pts.length };
    });
    execAreaCache = { rois, areas };
    return areas;
  }
  /** Report rows joined to mapped areas. Only reportable fresco departments rank (30-crossing gate), as in the report. */
  function execRanked(kind, key) {
    const report = state.exec.report; if (!report) return [];
    return execAreas().filter((a) => a.kind === kind).map((a) => ({ ...a, row: reportRow(report, a) }))
      .filter((a) => a.row && Number.isFinite(a.row[key]) && (kind === 'queue' || (a.row.section === 'fresco' && a.row.crossings >= 30)))
      .sort((a, b) => b.row[key] - a.row[key]);
  }
  function execSelect(area, opts = {}) {
    state.sel = area ? { kind: 'roi', id: area.key } : null;
    if (area) api.select({ id: area.key, name: area.name, vertices: area.polygons[0], polygons: area.polygons, businessKind: area.kind, cx: area.x, cz: area.z }, { fly: !!opts.fly, span: area.kind === 'queue' ? 14 : 22 });
    else api.select(null);
    render();
  }

  // ------------------------------------------------------------------ selection
  function deptGeom(id) { return state.areas?.departments.find((d) => d.id === id); }
  function laneGeom(n) { return state.areas?.lanes.find((l) => l.lane === n); }
  function select(sel, { fly = false } = {}) {
    state.sel = sel;
    if (!sel) { api.select(null); render(); return; }
    const g = sel.kind === 'dept' ? deptGeom(sel.id) : laneGeom(sel.id);
    const rings = sel.kind === 'dept' ? g?.area : g?.queue;
    if (rings?.length) {
      const polys = rings.map((r) => r.outer);
      const c = VJ.polygonCentre(rings);
      api.select({ id: `${sel.kind}:${sel.id}`, name: sel.kind === 'dept' ? VJ.deptLabel(sel.id) : `Cassa ${sel.id}`, vertices: polys[0], polygons: polys, businessKind: sel.kind === 'lane' ? 'queue' : 'department', cx: c.x, cz: c.z }, { fly, span: sel.kind === 'lane' ? 14 : 22 });
    }
    render();
  }

  // ------------------------------------------------------------------ lens / layer / time
  async function setLens(id) {
    if (!LENS[id] || state.busy) return;
    const prev = state.lens;
    state.lens = id;
    // Keep compatible selections: departments travel between Pulse/Engagement/Opportunities/Live,
    // lanes between Pulse/Service/Live.
    if (state.sel?.kind === 'lane' && ['engagement', 'opportunities'].includes(id)) select(null);
    if (state.sel?.kind === 'dept' && id === 'service') select(null);
    if (state.sel?.kind === 'roi') { const a = execAreas().find((x) => x.key === state.sel.id); if (a && ((a.kind === 'queue') !== (id === 'service'))) execSelect(null); }
    root.classList.remove('hx-sheet-open');
    render();
    await applyRenderer(prev !== id);
    render();
  }

  async function applyRenderer(lensChanged) {
    const lens = LENS[state.lens];
    const layer = state.layer[state.lens];
    state.busy = true;
    try {
      if (state.lens === 'flow') {
        const scalar = layer === 'movement' ? 'speed' : layer;
        await api.lens({ base: 'moved', mode: layer === 'movement' ? 'moved' : 'flow', scalar, particles: 2400 });
      } else if (state.lens === 'pulse') {
        await api.lens({ base: 'moved', mode: layer === 'dwell' ? 'flow' : 'moved', scalar: layer === 'dwell' ? 'dwell' : null, particles: 2400 });
      } else if (state.lens === 'live') {
        await api.lens({ base: layer === 'context' ? 'moved' : 'hot', mode: layer === 'context' ? 'moved' : 'hot', particles: 900 });
      } else if (state.lens === 'compare') {
        await api.lens({ base: 'moved', mode: 'moved' });
      } else {
        await api.lens({ base: lens.base });
      }
      api.relief(state.lens === 'flow' && layer === 'dwell');
      if (lensChanged) {
        if (state.lens === 'service' && !state.sel) flyCheckout();
        else if (state.sel && ['engagement', 'service', 'live'].includes(state.lens)) focusSelection();
        else if (['pulse', 'flow', 'opportunities', 'live'].includes(state.lens)) api.overview();
        else if (state.lens === 'engagement') api.overview();
      }
    } finally { state.busy = false; }
    if (state.lens === 'compare') void renderCompare();
  }

  function flyCheckout() {
    const lanes = state.areas?.lanes || [];
    const pts = lanes.flatMap((l) => (l.queue || []).flatMap((r) => r.outer));
    if (!pts.length) return;
    api.flyTo(pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length, 34);
  }
  function focusSelection() {
    if (!state.sel) { api.overview(); return; }
    if (state.sel.kind === 'roi') { const a = execAreas().find((x) => x.key === state.sel.id); if (a) api.flyTo(a.x, a.z, a.kind === 'queue' ? 14 : 22); return; }
    const g = state.sel.kind === 'dept' ? deptGeom(state.sel.id)?.area : laneGeom(state.sel.id)?.queue;
    const c = VJ.polygonCentre(g);
    if (c) api.flyTo(c.x, c.z, state.sel.kind === 'lane' ? 14 : 24);
  }

  async function setLayer(id) {
    state.layer[state.lens] = id;
    render();
    await applyRenderer(false);
    render();
  }

  async function setSlot(sl) {
    state.slot = sl;
    render();
    const i = info();
    const slice = SLOT_TO_SLICE[sl];
    if (i.live && api.hasSlice(slice) && i.slice !== slice) {
      try { await api.slice(slice); } catch { /* flow stays on its window; the chip says so */ }
    }
    render();
    if (state.lens === 'compare') void renderCompare();
  }

  // ------------------------------------------------------------------ header + title
  function renderChrome() {
    const lens = LENS[state.lens];
    root.style.setProperty('--hx-accent', lens.accent);
    root.dataset.lens = state.lens;
    for (const b of document.querySelectorAll('.hx-tabs button, .hx-rail button[data-lens]')) b.setAttribute('aria-pressed', String(b.dataset.lens === state.lens));

    // Day: one picker drives both the floor and the numbers when live days exist.
    const i = info();
    dayBox.replaceChildren();
    const vjDay = kpiDay();
    if (i.days?.length > 1) {
      const s = h('select', { 'aria-label': 'Day', onchange: async (e) => { await api.setDate(e.target.value); await loadVJ(); if (state.lens === 'compare') void renderCompare(); } });
      for (const d of [...i.days].sort().reverse()) s.append(h('option', { value: d, selected: d === (i.date || vjDay) }, VJ.fmtDay(d)));
      dayBox.append(h('i', { html: ICONS.calendar }), s);
    } else {
      dayBox.append(h('i', { html: ICONS.calendar }), h('span', null, vjDay ? VJ.fmtDay(vjDay) : 'No day'));
    }

    // Title row with explicit source chips.
    const vj = state.vj;
    const flowLabel = i.live ? `${i.sliceLabel} · ${VJ.fmtDay(i.date)}` : `Sample pack · ${(i.hours || [7, 22]).map((x) => `${String(x).padStart(2, '0')}:00`).join('–')}`;
    const kpiLabel = vj.view ? `${VJ.fmtSlot(state.slot)} · ${VJ.fmtDay(vj.view.day)}` : (vj.origin === 'loading' ? 'loading…' : 'unavailable');
    const persp = h('div', { class: 'hx-seg hx-persp', role: 'group', 'aria-label': 'Perspective' },
      ...[['business', 'Business'], ['ops', 'Operations']].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(state.perspective === k), onclick: () => { state.perspective = k; render(); } }, t)));
    titleRow.replaceChildren(
      h('div', null, h('div', { class: 'hx-kicker' }, `${lens.n} / ${lens.kicker}`), h('h1', null, isExec() && EXEC_COPY[state.lens] ? EXEC_COPY[state.lens][0] : lens.title), h('p', null, isExec() && EXEC_COPY[state.lens] ? EXEC_COPY[state.lens][1] : lens.sub)),
      h('div', { class: 'hx-title-r' },
        state.lens === 'live'
          ? h('span', { class: 'hx-pill live' }, h('i'), 'Live feed ', h('b', null, 'not connected in this view'))
          : [isExec()
            ? h('span', { class: `hx-pill kpi ${state.exec.status === 'archived' ? 'snapshot' : state.exec.status}`, title: state.exec.note }, h('i'), 'Customer Journey report ',
              h('b', null, state.exec.report ? `${state.exec.report.window} · ${state.exec.status === 'archived' ? 'Archived PDF' : 'calculated'}` : state.exec.status === 'loading' ? 'loading…' : 'unavailable'))
            : h('span', { class: `hx-pill kpi ${vj.origin}`, title: vj.note }, h('i'), 'Visitor Journey ', h('b', null, kpiLabel)),
            h('span', { class: 'hx-pill flow', title: i.source || '' }, h('i'), 'Flow context ', h('b', null, flowLabel))],
        persp),
    );
    root.classList.toggle('hx-ops', state.perspective === 'ops');
    foot.querySelector('.hx-foot-src').textContent = isExec() ? `KPIs: ${state.exec.note}` : vj.view ? `KPIs: ${vj.note}` : vj.note;
  }

  // ------------------------------------------------------------------ stage controls
  function renderStageControls() {
    const lens = LENS[state.lens];
    const execL = isExec() && EXEC_LAYERS[state.lens];
    layerSeg.replaceChildren(...(execL || lens.layers).map(([id, label]) => h('button', { type: 'button',
      'aria-pressed': String(execL ? state.execLayer[state.lens] === id : state.layer[state.lens] === id),
      onclick: () => (execL ? (state.execLayer[state.lens] = id, render()) : setLayer(id)) }, label)));

    bar.replaceChildren();
    const paused = api.snapshot().paused;
    bar.append(h('button', { type: 'button', class: 'hx-play', 'aria-label': paused ? 'Play' : 'Pause', html: paused ? ICONS.play : ICONS.pause, onclick: () => { api.pause(!api.snapshot().paused); renderStageControls(); } }));
    if (state.lens === 'compare') {
      bar.append(h('span', { class: 'hx-bar-note' }, 'Windows are chosen in the inspector. Both maps share grid, scale and orientation (top view).'));
    } else if (state.lens === 'live') {
      bar.append(h('span', { class: 'hx-now' }, h('i'), 'NOW'), h('span', { class: 'hx-bar-note' }, 'Europe/Rome · live positions appear only with a verified feed'));
    } else if (isExec()) {
      // The report keeps its 00:00–23:30 window; these chips move the floor only.
      const i = info();
      const slices = h('div', { class: 'hx-seg hx-slots', role: 'group', 'aria-label': 'Flow window' });
      for (const [id, label] of FLOW_SLICES) slices.append(h('button', { type: 'button', 'aria-pressed': String(i.slice === id), onclick: async () => { try { await api.slice(id); } catch { /* keep */ } render(); } }, label));
      bar.append(slices, h('span', { class: 'hx-bar-note' }, `Flow window only · report KPIs stay ${state.exec.report?.window || '00:00–23:30'}`));
    } else {
      const slots = h('div', { class: 'hx-seg hx-slots', role: 'group', 'aria-label': 'Time slot' });
      for (const sl of [VJ.DAY, ...VJ.SLOTS]) {
        const v = state.vj.view?.entrances?.[sl]?.value;
        slots.append(h('button', { type: 'button', 'aria-pressed': String(state.slot === sl), title: v != null ? `${VJ.fmtInt(v)} clienti entrati` : '', onclick: () => setSlot(sl) }, sl === VJ.DAY ? 'Giornata' : sl.replace('-', '–')));
      }
      const i = info();
      const moved = i.live && i.slice === SLOT_TO_SLICE[state.slot];
      bar.append(slots, h('span', { class: 'hx-bar-note', title: 'Visitor Journey always uses the slot you pick. The floor follows when a dated pack has that slot.' },
        moved ? 'Floor and numbers on the same slot' : `Numbers: ${VJ.fmtSlot(state.slot)} · floor: ${i.live ? i.sliceLabel : 'sample pack'}`));
    }
    const cam = h('div', { class: 'hx-seg hx-cam', role: 'group', 'aria-label': 'Camera' },
      h('button', { type: 'button', onclick: () => api.top() }, 'Top'),
      h('button', { type: 'button', onclick: () => api.overview() }, '3D'),
      h('button', { type: 'button', onclick: () => focusSelection(), disabled: !state.sel && state.lens !== 'service' }, 'Focus'));
    if (state.lens === 'service' && !state.sel) cam.lastChild.onclick = () => flyCheckout();
    if (state.lens !== 'compare') bar.append(cam);
  }

  // ------------------------------------------------------------------ map overlay
  let shapes = []; // {poly: SVGPolygonElement, pts:[[x,z]...]}
  let pins = []; // {el, x, z}
  let overlayKey = '';

  function addShape(rings, cls, onClick, style = '') {
    for (const r of rings || []) {
      const poly = sv('polygon', { class: cls });
      if (style) poly.setAttribute('style', style);
      if (onClick) { poly.addEventListener('click', onClick); poly.classList.add('hit'); }
      overlay.append(poly);
      shapes.push({ poly, pts: r.outer });
    }
  }
  function addPin(x, z, el) { tags.append(el); pins.push({ el, x, z }); }

  function buildOverlay() {
    const view = state.vj.view, A = state.areas;
    const key = [state.lens, state.source, state.execLayer[state.lens], !!state.exec.report, state.layer[state.lens], state.slot, state.sel?.kind, state.sel?.id, !!view, !!A, state.radar.list.length, state.radar.stamp].join('|');
    if (key === overlayKey) return;
    overlayKey = key;
    overlay.replaceChildren(); tags.replaceChildren(); shapes = []; pins = [];
    if (!A || state.lens === 'compare') return;
    const L = state.lens, layer = state.layer[L];
    if (isExec()) { buildExecOverlay(L); return; }
    const ranked = VJ.rankDepartments(view, state.slot);

    if (L === 'pulse' || (L === 'live')) {
      if (L === 'pulse' && layer === 'areas') {
        const max = Math.max(0.01, ...ranked.map((r) => r.area.value));
        for (const r of ranked) addShape(deptGeom(r.id)?.area, 'dept soft', () => select({ kind: 'dept', id: r.id }), `--a:${(0.06 + 0.3 * r.area.value / max).toFixed(3)}`);
      }
      if (L === 'live' && state.sel?.kind === 'dept') addShape(deptGeom(state.sel.id)?.area, 'dept sel live');
      const show = L === 'pulse' ? ranked.slice(0, 3) : [];
      show.forEach((r, i) => {
        const g = deptGeom(r.id); if (!g?.label) return;
        addPin(g.label[0], g.label[1], h('button', { type: 'button', class: `hx-tag t${i}`, onclick: () => { select({ kind: 'dept', id: r.id }); setLens('engagement'); } }, r.name.toUpperCase(), h('small', null, VJ.fmtDuration(r.area.value))));
      });
      if (L === 'pulse') {
        const lanes = A.lanes.flatMap((l) => l.queue);
        const c = VJ.polygonCentre(lanes);
        if (c) addPin(c.x, c.z, h('button', { type: 'button', class: 'hx-tag coral', onclick: () => setLens('service') }, 'CASSE', h('small', null, view ? VJ.fmtDuration(view.queue[state.slot]?.value) + ' / cliente' : '')));
        const ent = VJ.polygonCentre(A.entrance);
        if (ent) addPin(ent.x, ent.z, h('span', { class: 'hx-tag ghost' }, 'INGRESSO'));
      }
    }

    if (L === 'engagement') {
      const val = (r) => (layer === 'banco' ? r.banco?.value : layer === 'choice' ? r.choiceShare : r.area.value);
      const max = Math.max(0.01, ...ranked.map((r) => val(r) || 0));
      for (const r of ranked) {
        const v = val(r);
        const t = v == null ? 0 : v / max;
        const kind = layer === 'choice' ? r.choice : 'amber';
        const isSel = state.sel?.kind === 'dept' && state.sel.id === r.id;
        addShape(deptGeom(r.id)?.area, `dept ${kind}${isSel ? ' sel' : ''}`, () => select({ kind: 'dept', id: r.id }), `--a:${(0.07 + 0.38 * t).toFixed(3)}`);
        if (layer !== 'area') addShape(deptGeom(r.id)?.banco, `banco${isSel ? ' sel' : ''}`, null, `--a:${(0.15 + 0.5 * t).toFixed(3)}`);
      }
      const showPins = state.sel?.kind === 'dept' ? ranked.filter((r) => r.id === state.sel.id) : ranked.slice(0, 5);
      showPins.forEach((r) => {
        const g = deptGeom(r.id); if (!g?.label) return;
        const v = layer === 'choice' ? (r.choiceShare == null ? '—' : num(r.choiceShare)) : VJ.fmtDuration(val(r));
        addPin(g.label[0], g.label[1], h('button', { type: 'button', class: `hx-tag amber${state.sel?.id === r.id ? ' on' : ''}`, onclick: () => select({ kind: 'dept', id: r.id }) }, r.name.toUpperCase(), h('small', null, v)));
      });
    }

    if (L === 'service') {
      const lanes = view?.lanes.list || [];
      const maxW = Math.max(1e-6, ...lanes.map((l) => (layer === 'transit' ? l.transitPm : l.waitingPm)));
      for (const g of A.lanes) {
        const l = lanes.find((x) => x.lane === g.lane);
        const v = l ? (layer === 'transit' ? l.transitPm : l.waitingPm) : 0;
        const isSel = state.sel?.kind === 'lane' && state.sel.id === g.lane;
        addShape(g.queue, `lane${l ? '' : ' none'}${isSel ? ' sel' : ''}`, () => select({ kind: 'lane', id: g.lane }), `--a:${(0.08 + 0.5 * v / maxW).toFixed(3)}`);
        addShape(g.service, 'svc');
      }
      const top = state.sel?.kind === 'lane' ? lanes.filter((l) => l.lane === state.sel.id) : lanes.slice(0, 3);
      top.forEach((l, i) => {
        const c = VJ.polygonCentre(laneGeom(l.lane)?.queue); if (!c) return;
        addPin(c.x, c.z, h('button', { type: 'button', class: `hx-pin coral${state.sel?.id === l.lane ? ' on' : ''}`, onclick: () => select({ kind: 'lane', id: l.lane }) }, h('b', null, String(l.lane)), h('span', null, `${pct(l.share)} dell’attesa`)));
      });
    }

    if (L === 'opportunities') {
      const list = layer === 'radar' ? state.radar.list : reviewCandidates();
      list.slice(0, 3).forEach((c, i) => {
        const letter = String.fromCharCode(65 + i);
        if (c.rings) addShape(c.rings, `opp${state.sel && c.sel && state.sel.id === c.sel.id ? ' sel' : ''}`, () => c.sel && select(c.sel));
        if (c.polygons) addShape(c.polygons.map((p) => ({ outer: p })), 'opp', null);
        if (Number.isFinite(c.x)) addPin(c.x, c.z, h('button', { type: 'button', class: `hx-opp${state.sel && c.sel && state.sel.id === c.sel.id ? ' on' : ''}`, onclick: () => c.sel && select(c.sel) }, h('b', null, letter), h('span', null, c.name)));
      });
    }
  }

  function buildExecOverlay(L) {
    if (!state.exec.report) return;
    if (L === 'service') {
      const ranked = execRanked('queue', 'avgWaitSec');
      const max = Math.max(1, ...ranked.map((a) => a.row.avgWaitSec));
      for (const a of execAreas().filter((x) => x.kind === 'queue')) {
        const r = ranked.find((x) => x.key === a.key);
        addShape(a.polygons.map((p) => ({ outer: p })), `roi q${r ? '' : ' none'}${state.sel?.id === a.key ? ' sel' : ''}`, () => execSelect(a), `--a:${r ? (0.08 + 0.5 * r.row.avgWaitSec / max).toFixed(3) : 0.03}`);
      }
      const pinsFor = state.sel ? ranked.filter((a) => a.key === state.sel.id) : ranked.slice(0, 3);
      pinsFor.forEach((a) => addPin(a.x, a.z, h('button', { type: 'button', class: `hx-pin coral${state.sel?.id === a.key ? ' on' : ''}`, onclick: () => execSelect(a) }, h('b', null, String(a.row.lane || '')), h('span', null, `${Math.round(a.row.avgWaitSec)} s avg wait`))));
      return;
    }
    const key = L === 'engagement' ? state.execLayer.engagement : 'stoppingPct';
    const ranked = execRanked('department', key);
    const max = Math.max(1e-9, ...ranked.map((a) => a.row[key]));
    for (const a of ranked) addShape(a.polygons.map((p) => ({ outer: p })), `roi${state.sel?.id === a.key ? ' sel' : ''}`, () => execSelect(a), `--a:${(0.1 + 0.45 * a.row[key] / max).toFixed(3)}`);
    const pinsFor = state.sel ? ranked.filter((a) => a.key === state.sel.id) : ranked.slice(0, L === 'pulse' ? 3 : 5);
    pinsFor.forEach((a, i) => addPin(a.x, a.z, h('button', { type: 'button', class: `hx-tag amber t${i}${state.sel?.id === a.key ? ' on' : ''}`, onclick: () => { execSelect(a); if (L === 'pulse') setLens('engagement'); } }, a.name.toUpperCase(), h('small', null, EXEC_FMT[key](a.row[key])))));
    if (L === 'pulse') {
      const q = execRanked('queue', 'avgWaitSec')[0];
      if (q) addPin(q.x, q.z, h('button', { type: 'button', class: 'hx-tag coral', onclick: () => { execSelect(q); setLens('service'); } }, (q.name || 'CHECKOUT').toUpperCase(), h('small', null, `${Math.round(q.row.avgWaitSec)} s avg wait`)));
    }
  }

  api.onFrame(() => {
    buildOverlay();
    const r = view.getBoundingClientRect();
    overlay.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    for (const s of shapes) {
      let ok = true;
      const pts = s.pts.map(([x, z]) => { const p = api.project({ x, z }); if (!p) ok = false; return p ? `${p.sx.toFixed(1)},${p.sy.toFixed(1)}` : ''; });
      s.poly.setAttribute('points', ok ? pts.join(' ') : '');
    }
    for (const p of pins) {
      const s = api.project({ x: p.x, z: p.z });
      p.el.hidden = !s || s.sx < -40 || s.sy < -40 || s.sx > r.width + 40 || s.sy > r.height + 40;
      if (s) p.el.style.transform = `translate(${s.sx.toFixed(1)}px, ${s.sy.toFixed(1)}px)`;
    }
  });

  // ------------------------------------------------------------------ opportunities (no euros)
  function reviewCandidates() {
    const view = state.vj.view; if (!view || !state.areas) return [];
    const out = [];
    const { over } = VJ.queuePeak(view);
    if (over && view.lanes.list[0]) {
      const l = view.lanes.list[0]; const c = VJ.polygonCentre(laneGeom(l.lane)?.queue);
      out.push({ kind: 'queue', name: `Cassa ${l.lane} · ${VJ.fmtSlot(over.slot)}`, sel: { kind: 'lane', id: l.lane }, rings: laneGeom(l.lane)?.queue, x: c?.x, z: c?.z,
        why: [`Queue wait ${VJ.fmtDuration(over.value)} per customer at ${VJ.fmtSlot(over.slot)}, above the 1-minute line.`, `Cassa ${l.lane} carries ${pct(l.share)} of the day’s waiting time.`],
        test: 'Open one more lane at the start of that slot on two matched weekdays.',
        verify: `Compare queue minutes per customer at ${VJ.fmtSlot(over.slot)} in Visitor Journey, same weekday, before and after.` });
    }
    for (const r of VJ.rankDepartments(view, state.slot)) {
      // Served counters are excluded: people wait there more than 1 m from the fixture, so a low index is not 'crossed'.
      if (r.choice !== 'passed' || r.area.value < 0.3 || VJ.SERVED.includes(r.id)) continue;
      const g = deptGeom(r.id);
      out.push({ kind: 'dept', name: r.name, sel: { kind: 'dept', id: r.id }, rings: g?.area, x: g?.label?.[0], z: g?.label?.[1],
        why: [`${VJ.fmtDuration(r.area.value)} per customer in the area, only ${VJ.fmtDuration(r.banco?.value)} at the shelf.`, `Choice index ${num(r.choiceShare)}: under 0,25 the department is crossed more than worked.`],
        test: 'Check shelf visibility, signage and availability at the frontage customers walk past.',
        verify: 'Watch the choice index for this department in Visitor Journey on matched days. A rise means more time at the shelf, not more sales.' });
    }
    return out;
  }

  async function loadRadar() {
    state.radar.busy = true; state.radar.note = ''; render();
    const s = api.snapshot(), venue = s.venue || s.field.meta.venue_id;
    try {
      const r = await fetch('/api/profit-radar/insights?venueId=' + encodeURIComponent(venue || ''), { credentials: 'include' });
      if (!r.ok) throw new Error('Current Profit Radar is not reachable from here.');
      const list = radarAreas(await r.json(), venue, s.rois);
      state.radar.list = list.map((a) => ({ ...a, sel: null }));
      state.radar.stamp = new Date().toLocaleTimeString('it-IT');
      state.radar.note = list.length ? 'Fresh, observed, mapped findings only.' : 'No fresh observed finding passed the evidence checks. Demo entries are excluded.';
    } catch (e) { state.radar.list = []; state.radar.note = e.message; }
    finally { state.radar.busy = false; render(); }
  }

  // ------------------------------------------------------------------ compare (2D, matched)
  let layoutPolys = null;
  async function renderCompare() {
    compareBox.hidden = state.lens !== 'compare';
    if (state.lens !== 'compare') return;
    const C = state.compare, i = info();
    const windows = i.live && api.hasSlice('h08_10')
      ? [['h08_10', '08–10'], ['h10_12', '10–12'], ['h12_14', '12–14'], ['h14_16', '14–16'], ['h16_18', '16–18'], ['h18_20', '18–20'], ['morning', '07–11'], ['evening', '19–22']]
      : [['morning', 'Morning 07–11'], ['midday', 'Midday 11–15'], ['afternoon', 'Afternoon 15–19'], ['evening', 'Evening 19–22']];
    if (!windows.some((w) => w[0] === C.a)) C.a = windows[0][0];
    if (!windows.some((w) => w[0] === C.b)) C.b = windows[windows.length - 1][0];
    layoutPolys ||= await fetch('./layout_prod.json').then((r) => r.json()).then((j) => j.polys).catch(() => []);
    const load = async (slice) => (C.packs[slice] ||= await api.sliceField(slice).catch(() => null));
    const [pa, pb] = await Promise.all([load(C.a), load(C.b)]);
    const metric = state.layer.compare;
    compareBox.replaceChildren();
    const f = api.snapshot().field;
    const share = (pack, key) => {
      const m = new Map(); let sum = 0;
      for (const c of pack?.cells || []) { const v = Number(c[key] || 0); sum += v; m.set(`${c.i},${c.j}`, v); }
      for (const [k, v] of m) m.set(k, sum ? v / sum : 0);
      return m;
    };
    const key = metric === 'dwell' ? 'd' : 't';
    const A = share(pa, metric === 'diff' ? 't' : key), B = share(pb, metric === 'diff' ? 't' : key);
    let max = 1e-9;
    for (const m of [A, B]) for (const v of m.values()) max = Math.max(max, v);
    const boxes = metric === 'diff' ? [['Difference', 'B − A, share of activity', null]] : [[`Window A`, windows.find((w) => w[0] === C.a)[1], A], [`Window B`, windows.find((w) => w[0] === C.b)[1], B]];
    const wrap = h('div', { class: `hx-cmp-grid n${boxes.length}` });
    for (const [title, sub, data] of boxes) {
      const canvas = h('canvas', { width: 900, height: 900, role: 'img', 'aria-label': `${title} ${sub}` });
      wrap.append(h('figure', null, h('figcaption', null, h('small', null, title.toUpperCase()), h('b', null, sub)), canvas));
      drawCompare(canvas, f, data, max, metric === 'diff' ? { A, B } : null, metric);
    }
    compareBox.append(wrap, h('p', { class: 'hx-cmp-note' }, `Same store geometry, same grid (${f.meta.cell_m} m), same colour scale. Colour is each window’s share of ${metric === 'dwell' ? 'slow presence' : 'track activity'}, so a quieter window is not painted as an empty store. A redistribution is not a sales result.`));
    if (!pa || !pb) compareBox.append(h('p', { class: 'hx-cmp-warn' }, 'One window could not be loaded. Nothing is compared.'));
  }

  function drawCompare(canvas, f, data, max, diff, metric) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, pad = 30;
    const bx = [4.5, 72], bz = [2.5, 74.5];
    const s = Math.min((W - 2 * pad) / (bx[1] - bx[0]), (H - 2 * pad) / (bz[1] - bz[0]));
    const X = (x) => pad + (x - bx[0]) * s, Z = (z) => pad + (z - bz[0]) * s;
    ctx.fillStyle = '#050B12'; ctx.fillRect(0, 0, W, H);
    const cell = f.meta.cell_m;
    const cells = new Set([...(diff ? [...diff.A.keys(), ...diff.B.keys()] : data.keys())]);
    for (const k of cells) {
      const [i, j] = k.split(',').map(Number);
      const p = api.toVenue(i - f.i0 + 0.5, j - f.j0 + 0.5);
      let fill;
      if (diff) {
        const d = (diff.B.get(k) || 0) - (diff.A.get(k) || 0);
        const t = Math.min(1, Math.abs(d) / (max * 0.35));
        fill = d >= 0 ? `rgba(101,222,240,${0.08 + 0.8 * t})` : `rgba(243,199,120,${0.08 + 0.8 * t})`;
      } else {
        const t = Math.sqrt((data.get(k) || 0) / max);
        fill = metric === 'dwell' ? `rgba(243,199,120,${0.05 + 0.9 * t})` : `rgba(101,222,240,${0.05 + 0.9 * t})`;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(X(p.x - cell / 2), Z(p.z - cell / 2), cell * s + 0.6, cell * s + 0.6);
    }
    ctx.strokeStyle = 'rgba(160,190,210,.28)'; ctx.lineWidth = 1;
    for (const poly of layoutPolys || []) {
      ctx.beginPath(); poly.forEach(([x, z], n) => (n ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)))); ctx.closePath(); ctx.stroke();
    }
    ctx.font = '600 15px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(238,248,255,.75)';
    for (const d of (state.areas?.departments || []).filter((d) => d.area_m2 > 60 && d.id !== VJ.PACKAGED)) ctx.fillText(VJ.deptLabel(d.id).toUpperCase(), X(d.label[0]) - 24, Z(d.label[1]));
  }

  // ------------------------------------------------------------------ inspector
  function card(cls, ...kids) { return h('section', { class: `hx-card ${cls || ''}` }, ...kids); }
  function hero(label, value, note, cls = '') { return h('div', { class: `hx-hero ${cls}` }, h('small', null, label), h('strong', null, value), note ? h('p', null, note) : null); }
  function stat(label, value, note, src) { return h('div', { class: 'hx-stat' }, h('small', null, label, src || ''), h('b', null, value), note ? h('span', null, note) : null); }
  function method(text) { return text ? h('p', { class: 'hx-method ops-only' }, text) : null; }
  function bars(rows, fmt, opts = {}) {
    const max = Math.max(1e-9, ...rows.map((r) => r.value || 0));
    return h('div', { class: 'hx-bars' }, ...rows.map((r) => h('button', { type: 'button', class: `hx-barrow${r.on ? ' on' : ''}`, onclick: r.onclick, disabled: !r.onclick },
      h('span', null, r.label), h('b', null, fmt(r.value)), h('i', { style: `--w:${((r.value || 0) / max * 100).toFixed(1)}%;${opts.color ? `--c:${opts.color}` : ''}` }, r.split != null ? h('em', { style: `--s:${(r.split * 100).toFixed(1)}%` }) : null))));
  }
  function slotChart(series, { line = null, second = null } = {}) {
    const vals = VJ.SLOTS.map((sl) => series[sl]?.value);
    const vals2 = second ? VJ.SLOTS.map((sl) => second[sl]?.value) : [];
    const max = Math.max(line || 0, ...vals.filter(Number.isFinite), ...vals2.filter(Number.isFinite), 1e-9);
    const el = h('div', { class: 'hx-slots-chart' });
    if (line) el.append(h('i', { class: 'hx-line', style: `--y:${(line / max * 100).toFixed(1)}` }, h('small', null, '1 min')));
    VJ.SLOTS.forEach((sl, k) => {
      const v = vals[k], v2 = vals2[k];
      el.append(h('button', { type: 'button', class: `hx-col${state.slot === sl ? ' on' : ''}${line && v > line ? ' over' : ''}`, onclick: () => setSlot(sl), title: `${sl}: ${VJ.fmtDuration(v)}` },
        h('i', { style: `--h:${v == null ? 0 : (v / max * 100).toFixed(1)}%` }), second ? h('i', { class: 'b', style: `--h:${v2 == null ? 0 : (v2 / max * 100).toFixed(1)}%` }) : null, h('small', null, sl.slice(0, 2) + 'h')));
    });
    return el;
  }
  function unavailable(msg) { return card('hx-empty', h('b', null, 'Visitor Journey unavailable'), h('p', null, msg), h('p', null, 'No number is shown in its place. The floor below is movement context only.')); }

  function inspectPulse(v) {
    const ranked = VJ.rankDepartments(v, state.slot);
    const lead = ranked[0];
    const { peak, over } = VJ.queuePeak(v);
    const comp = VJ.visitComposition(v, state.slot);
    const signals = h('div', { class: 'hx-signals' });
    if (lead) signals.append(h('button', { type: 'button', class: 'hx-signal amber', onclick: () => { select({ kind: 'dept', id: lead.id }); setLens('engagement'); } },
      h('i', { html: ICONS.up }), h('div', null, h('small', null, 'DEPARTMENT SIGNAL'), h('b', null, `${lead.name} · ${VJ.fmtDuration(lead.area.value)}`), h('p', null, `Most time per customer of any department, ${VJ.fmtDuration(lead.banco?.value)} of it at the shelf.`))));
    const qs = over || peak;
    if (qs) signals.append(h('button', { type: 'button', class: `hx-signal ${over ? 'coral' : 'green'}`, onclick: () => setLens('service') },
      h('i', { html: over ? ICONS.alert : ICONS.cart }), h('div', null, h('small', null, 'SERVICE SIGNAL'), h('b', null, `Coda ${VJ.fmtSlot(qs.slot)} · ${VJ.fmtDuration(qs.value)}`), h('p', null, over ? 'Queue time per customer above the 1-minute line in this slot.' : 'Busiest queue slot of the day, within the 1-minute line.'))));
    signals.append(h('div', { class: 'hx-signal cyan' }, h('i', { html: ICONS.waves }), h('div', null, h('small', null, 'MOVEMENT CONTEXT'), h('b', null, 'Two-way aisle flow'), h('p', null, 'Streams sample the 8-direction field. They show aggregate movement, not individual customers.'))));
    const kp = card('hx-kpis', h('div', { class: 'hx-card-h' }, h('b', null, 'Visitor Journey'), h('small', null, VJ.fmtSlot(state.slot))),
      h('div', { class: 'hx-grid2' },
        stat('Clienti entrati', kpiValue(v.entrances[state.slot], VJ.fmtInt), null, srcTag(v.entrances[state.slot])),
        stat('Tempo in negozio', kpiValue(v.visit[state.slot]), 'cliente medio', srcTag(v.visit[state.slot])),
        stat('Attesa in coda', kpiValue(v.queue[state.slot]), 'per cliente', srcTag(v.queue[state.slot])),
        stat('Persone presenti', kpiValue(v.peopleMean[state.slot], (x) => num(x, 0)), 'in media', srcTag(v.peopleMean[state.slot]))));
    if (comp) {
      const segs = comp.segments.filter((s) => s.minutes > 0);
      kp.append(h('div', { class: 'hx-comp' }, ...segs.map((s) => h('i', { class: s.id, style: `flex:${s.minutes}`, title: `${s.label} ${VJ.fmtDuration(s.minutes)}` }))),
        h('div', { class: 'hx-comp-k' }, ...segs.map((s) => h('span', { class: s.id }, `${s.label} ${VJ.fmtDuration(s.minutes)}`))));
    }
    return [h('div', { class: 'hx-kicker' }, 'STORE SIGNALS'), h('h2', null, 'How the day went'), h('p', { class: 'hx-lead' }, `${VJ.fmtDay(v.day)}, ${VJ.fmtSlot(state.slot)}. Numbers from Visitor Journey; the floor shows movement.`),
      signals, kp,
      h('button', { type: 'button', class: 'hx-cta', onclick: () => setLens('engagement') }, h('div', null, h('b', null, 'Explore departments'), h('p', null, 'Pick a department on the floor; the same twin focuses on it.')), h('i', { html: ICONS.arrow }))];
  }

  function inspectFlow() {
    const sc = api.scalarInfo();
    const i = info();
    const layer = state.layer.flow;
    const leg = h('div', { class: 'hx-legend-card' });
    if (layer === 'movement') leg.append(h('div', { class: 'hx-key' }, h('i', { class: 'stream' }), 'Movement streams, two directions kept'), h('div', { class: 'hx-key' }, h('i', { class: 'dark' }), 'Floor without sensor coverage stays dark'));
    else if (sc?.categorical) leg.append(...(sc.categories || []).map((c) => h('div', { class: 'hx-key' }, h('i', { style: `background:${c.color || c.colour || '#888'}` }), c.label || c.name)));
    else if (sc) leg.append(h('div', { class: `hx-ramp${sc.signed ? ' signed' : ''}` }), h('div', { class: 'hx-ramp-k' }, h('span', null, sc.signed ? 'converging' : 'low'), h('span', null, `${sc.label}${sc.unit ? ` · ${sc.unit}` : ''}`), h('span', null, sc.signed ? 'splitting' : 'high')));
    const reading = {
      movement: 'Bright streams are where people walked. Two-way aisles draw as two counter-flows.',
      dwell: 'Warm floor and relief are where people moved slower than 0,25 m/s. Linger, a queue or a counter: the colour does not say which.',
      footfall: 'Distinct track keys per cell. A body that loses its id counts twice, so this is activity, not shoppers.',
      purity: 'Near 1: everyone walks the same way (entrance, till lane). Near 0: two-way aisle or milling.',
      convergence: 'Where streams meet (sinks such as tills and counters) versus where they split.',
      regime: 'One behaviour class per cell: dwell node, through-route, one-way spine, two-way aisle.',
    }[layer];
    return [h('div', { class: 'hx-kicker' }, 'FIELD EXPLORER'), h('h2', null, 'Movement anatomy'), h('p', { class: 'hx-lead' }, reading),
      card('hx-big', h('small', null, 'FIELD REPRESENTATION'), h('strong', null, '8 ', h('span', null, 'directions')), h('p', null, 'Each cell keeps a rose of headings, so opposite streams in the same aisle do not cancel.')),
      card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Spatial evidence'), h('small', null, 'aggregated')),
        h('dl', { class: 'hx-dl' },
          h('dt', null, 'Window'), h('dd', null, i.live ? `${i.sliceLabel} · ${VJ.fmtDay(i.date)}` : 'Sample pack, 07–22'),
          h('dt', null, 'Cell'), h('dd', null, `${i.cell || 1.5} m`),
          h('dt', null, 'Mask'), h('dd', null, 'measured cells only'),
          h('dt', null, 'Colour scale'), h('dd', null, 'p98, not max'),
          h('dt', null, 'Heading model'), h('dd', null, '8-bin rose, κ 2.8'))),
      leg,
      h('p', { class: 'hx-note' }, 'Cell values count track keys, not unique shoppers. Department minutes and queue times are on the Engagement and Service lenses, from Visitor Journey.'),
      h('button', { type: 'button', class: 'hx-ghost wide', onclick: () => toggleLab(true) }, 'Open Lab · particle and rendering controls')];
  }

  function inspectEngagement(v) {
    const ranked = VJ.rankDepartments(v, state.slot);
    const sel = (state.sel?.kind === 'dept' && ranked.find((r) => r.id === state.sel.id)) || null;
    const d = sel || ranked[0];
    const layer = state.layer.engagement;
    const metricOf = (r) => (layer === 'banco' ? r.banco?.value : layer === 'choice' ? r.choiceShare : r.area.value);
    const fmtM = layer === 'choice' ? (x) => num(x) : VJ.fmtDuration;
    const out = [h('div', { class: 'hx-kicker' }, sel ? 'SELECTED DEPARTMENT' : 'DEPARTMENTS'), h('h2', null, d ? d.name : 'No department'),
      h('p', { class: 'hx-lead' }, sel ? 'Two layers: time in the department area, and the part of it spent at the shelf.' : 'Ranked by minutes per customer. Select one on the floor or in the list.')];
    if (d) {
      const g = deptGeom(d.id);
      const kind = d.choice;
      out.push(card('amber', hero('MINUTI PER CLIENTE · AREA', VJ.fmtDuration(d.area.value), `${VJ.fmtSlot(state.slot)} · ${sel ? 'selected' : 'highest of the comparable departments'}`, 'amber'),
        h('div', { class: 'hx-grid3' },
          stat('Al banco', kpiValue(d.banco), '≤1 m, lento'),
          stat('Indice di scelta', d.choiceShare == null ? '—' : num(d.choiceShare), VJ.CHOICE_LABEL[kind]),
          stat('Area misurata', g ? `${Math.round(g.area_m2)} m²` : '—', 'entro 3 m'))),
        card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Through the day'), h('small', null, 'min per cliente')), slotChart(v.area[d.id], { second: v.banco[d.id] }),
          h('div', { class: 'hx-comp-k' }, h('span', { class: 'fresh' }, 'area'), h('span', { class: 'banco' }, 'al banco'))));
      if (v.next?.[d.id]) {
        const nx = Object.entries(v.next[d.id]).filter(([k, x]) => k !== d.id && x > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 3);
        if (nx.length) out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Da qui si va a'), h('small', null, 'reconstructed paths')), bars(nx.map(([k, x]) => ({ label: VJ.deptLabel(k), value: x, onclick: () => select({ kind: 'dept', id: k }) })), (x) => pct(x))));
      }
    }
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Department ranking'), h('small', null, { area: 'min in area', banco: 'min al banco', choice: 'choice index' }[layer])),
      bars(ranked.slice().sort((a, b) => (metricOf(b) || 0) - (metricOf(a) || 0)).map((r) => ({ label: r.name, value: metricOf(r), on: d && r.id === d.id, onclick: () => select({ kind: 'dept', id: r.id }) })), fmtM, { color: 'var(--amber)' })),
      h('p', { class: 'hx-note' }, 'Area = floor within 3 m of the department’s fixtures, nearest department wins. Al banco = within 1 m of the fixture face, slower than 0,4 m/s. Both ÷ customers who entered in the slot. Choice index under 0,25: crossed; 0,40 or more: worked.'),
      method(v.area[d?.id]?.[state.slot]?.method));
    return out;
  }

  function inspectService(v) {
    const lanes = v.lanes.list;
    const sel = state.sel?.kind === 'lane' ? lanes.find((l) => l.lane === state.sel.id) : null;
    const { peak, over } = VJ.queuePeak(v);
    const out = [h('div', { class: 'hx-kicker' }, 'CHECKOUT SERVICE'), h('h2', null, sel ? `Cassa ${sel.lane}` : 'Checkouts'),
      h('p', { class: 'hx-lead' }, 'Queue time per customer who entered, people walking through and objects parked at the till removed.')];
    out.push(card('coral', hero('ATTESA IN CODA · PER CLIENTE', kpiValue(v.queue[state.slot]), over ? `Sopra soglia alle ${VJ.fmtSlot(over.slot)}` : peak ? `Nella norma · picco ${VJ.fmtSlot(peak.slot)}` : '', 'coral'),
      h('div', { class: 'hx-grid3' },
        stat('Servizio in cassa', kpiValue(v.service[state.slot]), 'per cliente'),
        stat('Picco', peak ? VJ.fmtDuration(peak.value) : '—', peak ? VJ.fmtSlot(peak.slot) : ''),
        stat('Clienti entrati', kpiValue(v.entrances[state.slot], VJ.fmtInt), VJ.fmtSlot(state.slot))),
      slotChart(v.queue, { line: VJ.THRESHOLDS.queueSlotMin, second: v.service }),
      h('div', { class: 'hx-comp-k' }, h('span', { class: 'queue' }, 'coda'), h('span', { class: 'service' }, 'servizio'), h('span', { class: 'line' }, 'soglia 1 min'))));
    if (sel) {
      out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, `Cassa ${sel.lane}`), h('small', null, 'whole day')),
        h('div', { class: 'hx-grid2' },
          stat('Quota dell’attesa', pct(sel.share), 'of all queue waiting'),
          stat('Persone in coda', sel.meanPeopleWaiting == null ? '—' : num(sel.meanPeopleWaiting), 'in media, 08–20'),
          stat('Attesa', `${Math.round(sel.waitingPm)} min`, 'person-minutes waiting'),
          stat('Attesa per sessione', sel.waitPerSessionMin == null ? h('span', { class: 'hx-na', title: 'queue_sessions is not reliable for this day' }, '—') : VJ.fmtDuration(sel.waitPerSessionMin), 'needs queue sessions'))));
    }
    if (v.lanes.reason) out.push(unavailable(v.lanes.reason));
    else out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Dove si aspetta'), h('small', null, 'share of waiting · day')),
      bars(lanes.map((l) => ({ label: `Cassa ${l.lane}`, value: l.share, split: l.waitingPm + l.transitPm ? l.waitingPm / (l.waitingPm + l.transitPm) : 0, on: sel?.lane === l.lane, onclick: () => select({ kind: 'lane', id: l.lane }, { fly: true }) })), (x) => pct(x), { color: 'var(--coral)' }),
      h('p', { class: 'hx-note' }, 'Bar = share of the day’s waiting time. Lane rows are shares of one total; the headline is per customer who entered. The two are different denominators.')));
    out.push(card('hx-cta-ops', h('b', null, 'Operational check'), h('p', null, 'Compare lane demand and staffing before moving a cashier. Waiting share shows where time is spent, not why.')), method(v.queue[state.slot]?.method));
    return out;
  }

  function inspectOpportunities(v) {
    const layer = state.layer.opportunities;
    if (layer === 'radar') {
      const r = state.radar;
      const list = r.list;
      return [h('div', { class: 'hx-kicker' }, 'PROFIT RADAR · CURRENT'), h('h2', null, 'Current recovery scenarios'),
        h('p', { class: 'hx-lead' }, 'Live modelled economics. Separate from the day’s Visitor Journey and from the historical floor.'),
        h('button', { type: 'button', class: 'hx-ghost wide', disabled: r.busy, onclick: loadRadar }, r.busy ? 'Checking…' : (r.stamp ? `Refresh (${r.stamp})` : 'Load current Profit Radar')),
        r.note ? h('p', { class: 'hx-note' }, r.note) : null,
        ...list.slice(0, 3).map((a, i) => card('gold', h('div', { class: 'hx-card-h' }, h('b', null, `${String.fromCharCode(65 + i)} · ${a.name}`), h('small', null, a.priced ? 'MODELLED GROSS MARGIN' : 'BEHAVIOUR ONLY')),
          a.priced ? h('strong', { class: 'hx-money' }, `€${Math.round(a.econ.range.conservative)}–${Math.round(a.econ.range.aggressive)} / day`) : h('p', null, 'No configured economics for this shelf, so no euro figure.'),
          h('p', { class: 'hx-note' }, `${a.ins.dataBasis.trackCount} current tracks. A scenario range, not realised profit.`)))];
    }
    const list = reviewCandidates();
    const selC = list.find((c) => state.sel && c.sel.kind === state.sel.kind && c.sel.id === state.sel.id) || list[0];
    const out = [h('div', { class: 'hx-kicker' }, 'SPATIAL REVIEW'), h('h2', null, selC ? selC.name : 'Nothing to review'),
      h('p', { class: 'hx-lead' }, 'Places where the day’s Visitor Journey numbers suggest a check. No euro figure: the day’s data has no sales.')];
    if (!selC) { out.push(card('', h('p', null, 'No department is crossed rather than worked, and no queue slot is above the line, in this slot.'))); return out; }
    out.push(card('gold', h('div', { class: 'hx-card-h' }, h('b', null, 'REVIEW CANDIDATE'), h('small', null, selC.kind === 'queue' ? 'service' : 'engagement')), ...selC.why.map((w) => h('p', null, w))),
      card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Possible experiment'), h('small', null, 'observe · test · verify')), h('p', null, selC.test), h('p', { class: 'hx-note' }, selC.verify)),
      card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Other places to review'), h('small', null, `${list.length}`)),
        bars(list.map((c, i) => ({ label: `${String.fromCharCode(65 + i)} · ${c.name}`, value: 0, on: c === selC, onclick: () => select(c.sel) })), () => "")),
      h('p', { class: 'hx-note' }, 'A review area is a reason to look, not a loss estimate. Results are checked on Visitor Journey on matched days.'));
    return out;
  }

  function inspectCompare(v) {
    const C = state.compare, i = info();
    const names = { morning: '07:00–11:00', midday: '11:00–15:00', afternoon: '15:00–19:00', evening: '19:00–22:00', h08_10: '08–10', h10_12: '10–12', h12_14: '12–14', h14_16: '14–16', h16_18: '16–18', h18_20: '18–20' };
    const opts = Object.keys(names).filter((k) => (i.live && api.hasSlice('h08_10')) || !k.startsWith('h'));
    const pick = (which) => h('select', { 'aria-label': `Window ${which}`, onchange: (e) => { C[which] = e.target.value; void renderCompare(); render(); } }, ...opts.map((k) => h('option', { value: k, selected: C[which] === k }, names[k])));
    const toSlot = (k) => (k.startsWith('h') ? `${k.slice(1, 3)}-${k.slice(4, 6)}` : null);
    const sa = toSlot(C.a), sb = toSlot(C.b);
    const kpiRow = (label, ser, fmt = VJ.fmtDuration) => h('tr', null, h('td', null, label), h('td', null, sa ? kpiValue(ser[sa], fmt) : '—'), h('td', null, sb ? kpiValue(ser[sb], fmt) : '—'));
    const matched = sa && sb && v;
    return [h('div', { class: 'hx-kicker' }, 'COMPARISON STUDIO'), h('h2', null, 'Two spatial windows'), h('p', { class: 'hx-lead' }, 'Same footprint, same scale. Movement comparison is not an intervention result.'),
      card('', h('small', { class: 'hx-cap' }, 'WINDOW A'), pick('a'), h('small', { class: 'hx-cap' }, 'WINDOW B'), pick('b'),
        h('p', { class: 'hx-note' }, i.live ? `Both windows from ${VJ.fmtDay(i.date)}.` : 'Sample pack: both windows from the bundled flow day.')),
      card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Matched Visitor Journey'), h('small', null, matched ? 'same slots' : 'not available')),
        matched ? h('table', { class: 'hx-table' }, h('tr', null, h('th'), h('th', null, sa.replace('-', '–')), h('th', null, sb.replace('-', '–'))),
          kpiRow('Clienti entrati', v.entrances, VJ.fmtInt), kpiRow('Tempo in negozio', v.visit), kpiRow('Attesa in coda', v.queue))
          : h('p', { class: 'hx-note' }, 'Visitor Journey is calculated in 2-hour slots from 08 to 20. These flow windows do not match those slots, so no KPI is placed beside them.')),
      h('p', { class: 'hx-note' }, 'Colour is each window’s share of activity, on one scale. A shift in share is a redistribution of movement. It does not show sales uplift or prove that a change worked.')];
  }

  function inspectLive() {
    const ranked = VJ.rankDepartments(state.vj.view, VJ.DAY, { includePackaged: false });
    const sel = state.sel?.kind === 'dept' ? state.sel.id : '';
    const canOpen = qs.has('liveLink');
    return [h('div', { class: 'hx-kicker' }, 'OPERATIONS / SENSOR TRACKING'), h('h2', null, 'Observe the store now'), h('p', { class: 'hx-lead' }, 'Anonymous current positions and short trails from the live reconciliation pipeline.'),
      card('hx-big', h('small', null, 'LIVE OCCUPANCY'), h('strong', null, '—'), h('p', null, 'Shown only with a verified connection to the current MQTT / Socket.IO feed. This view has none, so no number is shown.')),
      card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Tracking layer'), h('small', null, 'live')),
        h('dl', { class: 'hx-dl' }, h('dt', null, 'Identity'), h('dd', null, 'ephemeral'), h('dt', null, 'Trails'), h('dd', null, 'short, recent'), h('dt', null, 'View'), h('dd', null, 'anonymous 3D bodies'), h('dt', null, 'Historical KPIs'), h('dd', null, 'not from live ids'))),
      card('', h('small', { class: 'hx-cap' }, 'SELECT REGION'),
        h('select', { 'aria-label': 'Region', onchange: (e) => select(e.target.value ? { kind: 'dept', id: e.target.value } : null, { fly: true }) }, h('option', { value: '' }, 'Entire store'), ...ranked.map((r) => h('option', { value: r.id, selected: r.id === sel }, r.name))),
        h('button', { type: 'button', class: 'hx-cta', disabled: !canOpen, onclick: openLive }, h('div', null, h('b', null, 'Open Live tracks here'), h('p', null, canOpen ? 'Same area and camera focus, live bodies.' : 'Available inside the Hyperspace app, where the live feed is connected.')), h('i', { html: ICONS.arrow }))),
      h('p', { class: 'hx-note' }, 'Live ids break every few seconds. They are never stitched into journeys here; journeys come from the nightly reconstruction.')];
  }
  function openLive() {
    let c = null;
    if (state.sel) c = VJ.polygonCentre(state.sel.kind === 'dept' ? deptGeom(state.sel.id)?.area : laneGeom(state.sel.id)?.queue);
    const t = api.snapshot().target;
    window.parent.postMessage({ type: 'ff-open-live', x: c ? c.x : t[0], z: c ? c.z : t[2] }, location.origin);
  }

  function sourceSwitch() {
    return h('div', { class: 'hx-source', role: 'group', 'aria-label': 'KPI source' },
      h('button', { type: 'button', 'aria-pressed': String(state.source === 'vj'), onclick: () => setSource('vj') }, 'Visitor Journey', h('small', null, 'daily_kpi · 08–20')),
      h('button', { type: 'button', 'aria-pressed': String(state.source === 'exec'), onclick: () => setSource('exec') }, 'Executive report', h('small', null, 'customer journey · 00:00–23:30')));
  }
  function execBadge() {
    const st = state.exec.status;
    return h('span', { class: `hx-badge${st === 'calc' ? ' calc' : ''}` }, st === 'calc' ? 'REPORT CALCULATED' : 'ARCHIVED PDF SNAPSHOT');
  }
  function execUnavailable() {
    return state.exec.status === 'loading' ? card('', h('p', null, 'Loading the customer journey report…')) : card('hx-empty', h('b', null, 'Report unavailable'), h('p', null, state.exec.note), h('p', null, 'No number is shown in its place.'));
  }
  function inspectExecPulse(rep) {
    const top = execRanked('department', 'stoppingPct');
    const lanes = execRanked('queue', 'avgWaitSec');
    const d = top[0], q = lanes[0];
    const signals = h('div', { class: 'hx-signals' });
    if (d) signals.append(h('button', { type: 'button', class: 'hx-signal amber', onclick: () => { execSelect(d); setLens('engagement'); } }, h('i', { html: ICONS.up }),
      h('div', null, h('small', null, 'DEPARTMENT SIGNAL'), h('b', null, `${d.name} · ${EXEC_FMT.stoppingPct(d.row.stoppingPct)}`), h('p', null, 'Highest reported stopping among comparable mapped departments.'))));
    if (q) signals.append(h('button', { type: 'button', class: 'hx-signal coral', onclick: () => { execSelect(q); setLens('service'); } }, h('i', { html: ICONS.alert }),
      h('div', null, h('small', null, 'SERVICE SIGNAL'), h('b', null, `${q.name} · ${Math.round(q.row.avgWaitSec)} s`), h('p', null, `Longest average wait among the lanes in the ${state.exec.status === 'archived' ? 'archived' : 'calculated'} report.`))));
    signals.append(h('div', { class: 'hx-signal cyan' }, h('i', { html: ICONS.waves }), h('div', null, h('small', null, 'MOVEMENT CONTEXT'), h('b', null, 'Two-way aisle flow'), h('p', null, 'Streams show aggregate movement, not individual routes.'))));
    const r = d?.row;
    return [h('div', { class: 'hx-kicker' }, 'STORE SIGNALS'), h('h2', null, 'Store signals'), h('p', { class: 'hx-lead' }, `Customer journey report, ${rep.day}, ${rep.window}. The floor is a separate flow window.`), execBadge(), signals,
      r ? card('hx-kpis', h('div', { class: 'hx-card-h' }, h('b', null, 'Customer Journey KPIs'), h('small', null, 'report')),
        h('div', { class: 'hx-grid2' }, stat(`${d.name} dwell`, r.dwellSec == null ? '—' : EXEC_FMT.dwellSec(r.dwellSec), 'median category dwell'), stat(`${d.name} engagement`, r.engagementSec == null ? '—' : EXEC_FMT.engagementSec(r.engagementSec), 'median at the shelf face'),
          stat(`${top[1]?.name || '—'} stopping`, top[1] ? EXEC_FMT.stoppingPct(top[1].row.stoppingPct) : '—', 'reached the shelf face'), stat(`${d.name} crossings`, EXEC_FMT.crossings(r.crossings), 'zone entries, not shoppers'))) : null,
      h('button', { type: 'button', class: 'hx-cta', onclick: () => setLens('engagement') }, h('div', null, h('b', null, 'Explore the store'), h('p', null, 'Choose a department to focus the same spatial canvas.')), h('i', { html: ICONS.arrow }))];
  }
  function inspectExecEngagement(rep) {
    const key = state.execLayer.engagement;
    const ranked = execRanked('department', key);
    const all = execAreas().filter((a) => a.kind === 'department').map((a) => ({ ...a, row: reportRow(rep, a) }));
    const d = (state.sel?.kind === 'roi' && all.find((a) => a.key === state.sel.id)) || ranked.slice().sort((a, b) => b.row.stoppingPct - a.row.stoppingPct)[0];
    const r = d?.row;
    const out = [h('div', { class: 'hx-kicker' }, 'SELECTED CATEGORY'), h('h2', null, d ? d.name : 'No department'), h('p', { class: 'hx-lead' }, 'Audited shelf-frontage behaviour, overlaid on the digital twin.'), execBadge()];
    if (d && !r) out.push(card('', h('p', null, `${d.name} has no row in this report. No substitute metric is used.`)));
    if (r) {
      out.push(card('amber', hero('STOPPING RATE', r.stoppingPct == null ? '—' : EXEC_FMT.stoppingPct(r.stoppingPct), 'Share of category visits that reached the shelf face', 'amber'),
        h('div', { class: 'hx-grid3' }, stat('Category dwell', r.dwellSec == null ? '—' : EXEC_FMT.dwellSec(r.dwellSec), 'median, engaged visits'), stat('Engagement', r.engagementSec == null ? '—' : EXEC_FMT.engagementSec(r.engagementSec), 'median, shelf face'), stat('Crossings', EXEC_FMT.crossings(r.crossings), 'zone entries'))));
      if (r.crossings < 30) out.push(h('p', { class: 'hx-note' }, `Only ${r.crossings} crossing${r.crossings === 1 ? '' : 's'}: shown for completeness, excluded from the ranking.`));
    }
    const label = EXEC_LAYERS.engagement.find((x) => x[0] === key)[1];
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Department ranking'), h('small', null, label)),
      bars(ranked.map((a) => ({ label: a.name, value: a.row[key], on: d?.key === a.key, onclick: () => execSelect(a) })), EXEC_FMT[key], { color: 'var(--amber)' })),
      h('p', { class: 'hx-note' }, 'Stopping, category dwell and engagement are separate measures; engagement is nested inside dwell. Crossings are zone entries, not the stopping denominator. Only fresco departments with 30+ crossings rank.'),
      ...(rep.notes || []).map((n) => method(n)));
    return out;
  }
  function inspectExecService(rep) {
    const lanes = execRanked('queue', 'avgWaitSec');
    const all = execAreas().filter((a) => a.kind === 'queue').map((a) => ({ ...a, row: reportRow(rep, a) }));
    const sel = state.sel?.kind === 'roi' ? all.find((a) => a.key === state.sel.id) : null;
    const r = sel?.row;
    const ch = rep.checkout || {};
    const out = [h('div', { class: 'hx-kicker' }, 'CHECKOUT SERVICE'), h('h2', null, sel ? sel.name : 'Checkouts'), h('p', { class: 'hx-lead' }, 'Lane-level customer journey metrics, not flow-cell dwell estimates.'), execBadge()];
    if (sel && !r) out.push(card('', h('p', null, `${sel.name} is not published in this report. Not available, not zero.`)));
    out.push(card('coral', hero(sel && r ? 'AVERAGE WAIT · SELECTED LANE' : `AVERAGE WAIT · ${(ch.label || 'channel').toUpperCase()}`, r ? `${Math.round(r.avgWaitSec)} s` : Number.isFinite(ch.avgWaitSec) ? `${Math.round(ch.avgWaitSec)} s` : '—',
      r && Number.isFinite(ch.avgWaitSec) ? `${r.avgWaitSec > ch.avgWaitSec ? 'Above' : 'At or below'} the ${Math.round(ch.avgWaitSec)} s channel average in the same report` : 'Queue visits of at least 10 s', 'coral'),
      h('div', { class: 'hx-grid3' },
        stat(r ? 'Shoppers' : 'Sessions', r ? (Number.isFinite(r.shoppers) ? r.shoppers.toLocaleString('it-IT') : '—') : (Number.isFinite(ch.sessions) ? ch.sessions.toLocaleString('it-IT') : '—'), 'queue sessions, as the report labels them'),
        stat('Abandonment', r ? (Number.isFinite(r.abandonPct) ? `${num(r.abandonPct, 0)}%` : '—') : (Number.isFinite(ch.abandonPct) ? `${num(ch.abandonPct, 0)}%` : '—'), 'report calculation'),
        stat(r ? 'Channel avg' : 'Completed', r ? (Number.isFinite(ch.avgWaitSec) ? `${Math.round(ch.avgWaitSec)} s` : '—') : (Number.isFinite(ch.completed) ? ch.completed.toLocaleString('it-IT') : '—'), r ? 'same report' : 'sessions'))));
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Wait by lane'), h('small', null, 'seconds')),
      bars(lanes.map((a) => ({ label: a.name, value: a.row.avgWaitSec, on: sel?.key === a.key, onclick: () => execSelect(a, { fly: true }) })), EXEC_FMT.avgWaitSec, { color: 'var(--coral)' })),
      h('p', { class: 'hx-note' }, state.exec.status === 'archived' ? 'The archived PDF publishes six lanes. Other lanes are not available, not zero.' : 'All lanes calculated by the report service.'),
      card('hx-cta-ops', h('b', null, 'Operational check'), h('p', null, 'Compare lane demand and staffing before adjusting allocation.')));
    return out;
  }

  function renderInspector() {
    const v = state.vj.view;
    const L = state.lens;
    let body;
    if (isExec()) {
      const rep = state.exec.report;
      body = [sourceSwitch(), ...(!rep ? [h('h2', null, LENS[L].title), execUnavailable()] : L === 'pulse' ? inspectExecPulse(rep) : L === 'engagement' ? inspectExecEngagement(rep) : inspectExecService(rep))];
    } else if (L === 'flow') body = inspectFlow();
    else if (L === 'live') body = inspectLive();
    else if (!v) body = [h('div', { class: 'hx-kicker' }, LENS[L].kicker), h('h2', null, LENS[L].title), state.vj.origin === 'loading' ? card('', h('p', null, 'Loading Visitor Journey…')) : unavailable(state.vj.note)];
    else if (L === 'pulse') body = [sourceSwitch(), ...inspectPulse(v)];
    else if (L === 'engagement') body = [sourceSwitch(), ...inspectEngagement(v)];
    else if (L === 'service') body = [sourceSwitch(), ...inspectService(v)];
    else if (L === 'opportunities') body = inspectOpportunities(v);
    else if (L === 'compare') body = inspectCompare(v);
    const scroll = inspector.scrollTop;
    const keep = inspector.dataset.key === `${L}|${state.sel?.id}`;
    inspector.replaceChildren(...body.filter(Boolean));
    inspector.dataset.key = `${L}|${state.sel?.id}`;
    if (keep) inspector.scrollTop = scroll;
  }

  function renderLegend() {
    const L = state.lens, layer = state.layer[L];
    const items = {
      pulse: [['stream', 'Movement'], layer === 'areas' ? ['amber', 'Minutes per customer'] : null],
      engagement: isExec() ? [['amber', `Mapped frontage · ${EXEC_LAYERS.engagement.find((x) => x[0] === state.execLayer.engagement)[1].toLowerCase()}`]] : [['amber', layer === 'choice' ? 'Choice index' : 'Minutes per customer'], layer !== 'area' ? ['banco', 'At the shelf (≤1 m)'] : null],
      service: isExec() ? [['coral', 'Average wait per lane']] : [['coral', layer === 'transit' ? 'Walk-through time' : 'Share of waiting time'], ['svc', 'Service position']],
      opportunities: [['gold', 'Review area']],
      live: [['green', 'Selected region']],
    }[L];
    legend.hidden = !items;
    legend.replaceChildren(...(items || []).filter(Boolean).map(([c, t]) => h('span', null, h('i', { class: c }), t)));
  }

  function render() {
    renderChrome();
    renderStageControls();
    renderInspector();
    renderLegend();
    compareBox.hidden = state.lens !== 'compare';
    view.style.visibility = state.lens === 'compare' ? 'hidden' : '';
    api.suspend(state.lens === 'compare');
    overlayKey = '';
  }

  window.addEventListener('ff-analysis-update', () => { if (!state.busy) renderStageControls(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleLab(false); root.classList.remove('hx-sheet-open'); } });

  // ------------------------------------------------------------------ boot
  (async () => {
    state.areas = await VJ.loadAreas();
    let i = info();
    if (!i.live && i.days.length) { try { await api.ensureLive(); } catch { /* sample pack stays */ } i = info(); }
    if (i.live && api.hasSlice('trading')) { try { await api.slice('trading'); } catch { /* keep 07–22 */ } }
    await loadVJ();
    if (state.source === 'exec') await loadExec();
    await applyRenderer(true);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) api.pause(true);
    render();
  })();
  render();
}
