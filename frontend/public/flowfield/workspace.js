// Hyperspace Retail — spatial workspace. One living twin, eight lenses.
//
// Numbers: only Visitor Journey (daily_kpi) through visitor-journey.js. The flow field
// is movement context and never produces a KPI here.
// Geometry: visitor-areas.json = the exact 0.25 m department raster the minutes were
// measured on (scripts/daily_kpi/export_area_geometry.py), plus checkout lane ROIs.
// Renderer: main.js keeps every flow algorithm; this file picks lens, layer, camera.

import { LENSES, LENS, SLOT_TO_SLICE, ICONS } from './lenses.js?v=v3-13';
import * as VJ from './visitor-journey.js?v=v3-5';
import * as VAS from './value-at-stake.js?v=v3-5';
import * as KN from './kinetic.js?v=v3-5';
import * as G from './twin-graphics.js?v=v3-5';
import * as PER from './period.js?v=v3-5';
import { radarAreas } from './value-opportunities.js';
import { loadExecutiveReport } from './executive-report.js?v=lens-1';
import { reportRow } from './journey-scorecard.js?v=v3-5';
import { inRings } from './retail-geometry.js?v=v3-10';

// Two KPI contracts, never merged on one card:
//   vj   = Visitor Journey (daily_kpi, 08–20, 2-hour slots) — default.
//   exec = Esselunga executive customer-journey report (ExecutiveJourneyService, 00:00–23:30),
//          through Astra's executive-report.js adapter; archived PDF snapshot when the service is down.
const EXEC_LAYERS = { engagement: [['stoppingPct', 'Stopping'], ['dwellSec', 'Dwell'], ['engagementSec', 'Engagement'], ['crossings', 'Crossings']], service: [['avgWaitSec', 'Average wait']] };
const EXEC_FMT = { stoppingPct: (x) => `${num(x, 1)}%`, dwellSec: (x) => `${Math.round(x)} s`, engagementSec: (x) => `${Math.round(x)} s`, crossings: (x) => Math.round(x).toLocaleString('en-GB'), avgWaitSec: (x) => `${Math.round(x)} s` };
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
const num = (x, d = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));

function kpiValue(c, fmt = VJ.fmtDuration) {
  if (!c || c.value == null) return h('span', { class: 'hx-na', title: c?.reason || 'Not available' }, '—');
  return fmt(c.value);
}
function chip(label, cls = '') { return h('span', { class: `hx-chip ${cls}` }, label); }
function srcTag(c) {
  if (!c?.label) return null;
  return h('span', { class: `hx-src ${c.label === 'MEASURED' ? 'm' : 'e'}`, title: c.method || '' }, c.label === 'MEASURED' ? 'MEASURED' : 'ESTIMATED');
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
    compare: { a: 'h08_10', b: 'h18_20', packs: {}, note: '', active: 0, playing: false, timer: 0 },
    econ: VAS.defaultEconomics(),
    busy: false,
    source: qs.get('source') === 'exec' ? 'exec' : 'vj',
    exec: { report: null, status: 'idle', note: '' },
    execLayer: { engagement: 'stoppingPct', service: 'avgWaitSec' },
    // Measured movement states (Journey Lab 220, raw 10 Hz). Separate from Visitor Journey numbers.
    kin: { K: null, status: 'loading', note: 'Loading movement states…' },
    kfocus: null, // index into KN.STATES to isolate one state on the floor
    period: null, // { mode:'day'|'week'|'month', from, to, days:[…] } shown on screen
    periodJob: null, // a period being loaded / calculated
    eng: { iso: true, flow: false }, // Engagement overlays: measured isolines, movement context
    flowCell: null, // Flow Explorer · Direction: inspected cell "i,j"
    flowSpot: null, // Flow Explorer · Convergence: highlighted meeting / splitting place
    regFocus: null, // Flow Explorer · Path types: isolate one path type (regime id)
    replay: { day: null, data: null, status: 'idle', k: null, playing: false, timer: 0 }, // Service · minute by minute
    inspCollapsed: false,
    contours: false, // Astra: 3D scalar isolines on the twin floor (off by default; the v3 contours are drawn by twin-graphics)
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
  const paintCanvas = h('canvas', { class: 'hx-paint', 'aria-hidden': 'true' });
  const kpiStrip = h('div', { class: 'hx-kpistrip', hidden: true });
  const overlay = sv('svg', { class: 'hx-overlay' });
  const tags = h('div', { class: 'hx-tags' });
  const twinTag = h('div', { class: 'hx-twin-tag' }, h('i'), 'SPATIAL DIGITAL TWIN', h('span', null, '·'), 'TREVIGLIO / LEVEL 00');
  const layerSeg = h('div', { class: 'hx-seg hx-layer-seg', role: 'group', 'aria-label': 'Layers' });
  const legend = h('div', { class: 'hx-legend' });
  const bar = h('div', { class: 'hx-bar' });
  const compareBox = h('div', { class: 'hx-compare', hidden: true });
  const stageNote = h('div', { class: 'hx-stage-note', hidden: true });
  stage.append(paintCanvas, overlay, tags, twinTag, kpiStrip, layerSeg, legend, bar, compareBox, stageNote);
  const spatialTools = h('div', { class:'hx-spatial-tools' });
  const anchorCard = h('section', { class:'hx-anchor-card', hidden:true, 'aria-label':'Selected department metrics' });
  const anchorLeader=sv('svg',{class:'hx-anchor-leader','aria-hidden':'true'}),leaderLine=sv('line');
  anchorLeader.append(leaderLine);
  stage.append(spatialTools, anchorLeader, anchorCard);

  function renderSpatialTools() {
    if (!api.twin) { spatialTools.hidden=true; return; }
    const t=api.twin.state;
    spatialTools.hidden=state.lens==='compare';
    spatialTools.replaceChildren(...[
      h('label', null, h('span', null, 'INSPECT'), h('select', { 'aria-label':'Inspect department', onchange:e=> {
        if(!e.target.value)return;
        const value=e.target.value,area=isExec()?execAreas().find(a=>a.name===value):null;
        if(area)execSelect(area);
        else if(value.startsWith('Checkout '))select({kind:'lane',id:Number(value.split(' ')[1])});
        else select({kind:'dept',id:value});
      } },h('option',{value:''},'Choose department'),...(api.twin.manifest.departments || []).slice().sort((a,b)=>a.category.localeCompare(b.category,'it',{numeric:true})).map(d=>h('option',{value:d.category,selected:state.sel?.id===d.category || (state.sel?.kind==='lane' && d.category===`Checkout ${state.sel.id}`)},VJ.deptLabel(d.category))))),
      h('button',{type:'button','aria-pressed':String(t.frontage),onclick:()=>{api.twin.frontage(!t.frontage);renderSpatialTools();},title:'Calibrated shelf edges of the selected category'},'Shelf fronts'),
      false && h('button',{type:'button','aria-pressed':String(state.contours),disabled:!!api.scalarInfo()?.categorical,onclick:()=>{state.contours=!state.contours;api.contours(state.contours);renderSpatialTools();},title:'Scalar contours; raw observed support only'},'Isolines'),
      h('button',{type:'button','aria-pressed':String(t.reduced),onclick:()=>{api.twin.reduced(!t.reduced);renderSpatialTools();}},'Reduced detail')].filter(Boolean));
  }

  function renderAnchorCard() {
    const sel=state.sel;
    anchorCard.hidden=!sel || !api.twin?.bounds || state.lens==='compare';
    anchorLeader.style.display=anchorCard.hidden?'none':'';
    if(anchorCard.hidden)return;
    const rows=[];let title='',source='',reason='';
    const add=(label,value,why)=>rows.push(h('div',{title:why || ''},h('span',null,label),h('strong',null,value)));
    if(isExec() && sel.kind!=='roi') {
      title=sel.kind==='lane'?`Lane ${sel.id}`:VJ.deptLabel(sel.id);source='Customer Journey · 00:00–23:30';reason='This mapped fixture area has no matching Customer Journey report row.';add('Report metric','—');
    } else if(isExec()) {
      const area=execAreas().find(a=>a.key===sel.id),r=reportRow(state.exec.report,area);title=area?.name || 'Mapped region';
      source=`${state.exec.status==='archived'?'Archived PDF':'Customer Journey'} · ${state.exec.report?.day || '—'} · ${state.exec.report?.window || '00:00–23:30'}`;
      const usable=r && (area?.kind==='queue' || (r.section==='fresco' && r.crossings>=30));
      for(const [key,label] of area?.kind==='queue'?[['avgWaitSec','Average wait']]:[['stoppingPct','Stopping'],['dwellSec','Category dwell'],['engagementSec','At shelf']])add(label,usable && Number.isFinite(r[key])?EXEC_FMT[key](r[key]):'—');
      if(!usable)reason='Report unavailable or below the existing reporting gate.';
    } else {
      const v=state.vj.view;source=`Visitor Journey${state.vj.origin==='snapshot'?' · archived snapshot':''} · ${v?.day || '—'} · ${VJ.fmtSlot(state.slot)}`;
      if(sel.kind==='dept') {
        title=VJ.deptLabel(sel.id);
        const area=v?.area?.[sel.id]?.[state.slot],banco=v?.banco?.[sel.id]?.[state.slot];
        add('Time in area · per entrant',kpiValue(area),area?.reason);add('At the shelf',kpiValue(banco),banco?.reason);
        // The stored daily choice row has its own gate. Slot ratios are already exposed by the validated adapter.
        const choice=state.slot===VJ.DAY?v?.choice?.[sel.id]:null;
        const slotChoice=VJ.rankDepartments(v,state.slot).find(r=>r.id===sel.id)?.choiceShare;
        add('Choice index',state.slot===VJ.DAY?kpiValue(choice,num):num(slotChoice),choice?.reason);
        reason=[area,banco,...state.slot===VJ.DAY?[choice]:[]].find(c=>!c || c.value==null)?.reason || (!v?state.vj.note:'');
        if(!state.areas?.departments.some(d=>d.id===sel.id)){source='CAD fixture selection · no analytical ROI';reason='Representative merchandise. No validated department KPI binding exists for this fixture category.';}
      } else {
        title=`Lane ${sel.id}`;const l=v?.lanes?.list.find(l=>l.lane===sel.id);
        // Lane decomposition has a daily window even while the floor shows a slot.
        source=`Visitor Journey${state.vj.origin==='snapshot'?' · archived snapshot':''} · ${v?.day || '—'} · 08:00–20:00`;
        add('Wait / session',VJ.fmtDuration(l?.waitPerSessionMin));add('Service / session',VJ.fmtDuration(l?.servicePerSessionMin));
        reason=!l?(v?.lanes?.reason || 'No validated lane data'):'';
        if(l && (l.waitPerSessionMin==null || l.servicePerSessionMin==null))reason=v?.lanes?.reason || 'Per-session metrics unavailable under the existing daily reporting gate.';
        reason+=(reason?' · ':'')+'Waiting and service retain separate mapped boundaries. No transit ROI is configured.';
      }
    }
    anchorCard.replaceChildren(...[h('div',{class:'hx-anchor-head'},h('span',null,'SELECTED AREA'),h('button',{type:'button','aria-label':'Return to store',onclick:returnToStore},'×')),
      h('h3',null,title),h('p',{class:'hx-anchor-source'},source),h('div',{class:'hx-anchor-values'},...rows),
      (sel.kind==='lane'||api.twin.state.selection?.businessKind==='queue')?h('div',{class:'hx-queue-key'},h('span',{style:`color:${api.twin.state.selection?.alert?'#f49b90':'#9fdaee'}`},'□ Waiting'),h('span',{style:'color:#d6e1e7'},'□ Service')):null,
      reason?h('p',{class:'hx-anchor-reason'},reason):null,
      h('p',{class:'hx-anchor-provenance'},api.twin.assetStatus==='loading'?'Loading category assets…':api.twin.assetStatus==='unavailable'?'Category asset unavailable · calibrated CAD retained':'Calibrated footprint · illustrative fixtures & products')].filter(Boolean));
  }
  function returnToStore() { if(isExec())execSelect(null);else select(null);api.twin?.returnToStore();render(); }
  api.onFloorPick?.((x,z,fixtureCategory)=>{
    if(isExec()) {
      const a=execAreas().find(a=>a.name===fixtureCategory) || execAreas().find(a=>inRings(x,z,a.polygons.map(outer=>({outer}))));
      if(a){execSelect(a);return;}
      if(fixtureCategory){if(fixtureCategory.startsWith('Checkout '))select({kind:'lane',id:Number(fixtureCategory.split(' ')[1])});else select({kind:'dept',id:fixtureCategory});}return;
    }
    if(fixtureCategory?.startsWith('Checkout ')){select({kind:'lane',id:Number(fixtureCategory.split(' ')[1])});return;}
    const lane=state.areas?.lanes.find(l=>inRings(x,z,l.queue) || inRings(x,z,l.service));
    if(lane){select({kind:'lane',id:lane.lane});return;}
    const d=state.areas?.departments.find(d=>d.id===fixtureCategory) || state.areas?.departments.find(d=>inRings(x,z,d.area));
    if(d)select({kind:'dept',id:d.id});else if(fixtureCategory)select({kind:'dept',id:fixtureCategory});
  });

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
    if (state.vj.view?.day && !state.vj.view.period) state.period = PER.periodFor('day', state.vj.view.day);
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
      if (!groups.has(key)) groups.set(key, { key, name: queue ? roi.name.replace(/\s*-\s*Queue/i, '') : VJ.deptLabel(roi.category), category: queue ? null : roi.category, kind: queue ? 'queue' : 'department', rois: [], polygons: [] });
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
    if (area) {
      const lane=area.kind==='queue'?laneGeom(Number(area.name.match(/\d+/)?.[0])):null;
      api.select({ id: area.key, name: area.name, category:area.name, zones:lane?{queue:lane.queue,service:lane.service}:null, vertices: area.polygons[0], polygons: area.polygons, businessKind: area.kind, cx: area.x, cz: area.z }, { fly: !!opts.fly, span: area.kind === 'queue' ? 14 : 22 });
    }
    else api.select(null);
    render();
  }

  // ------------------------------------------------------------------ selection
  function deptGeom(id) {
    const measured=state.areas?.departments.find((d)=>d.id===id);if(measured)return measured;
    const fs=api.twin?.manifest.fixtures.filter(f=>f.category===id)||[];
    if(!fs.length)return null;
    const area=fs.map(f=>({outer:f.polygon,holes:[]})),c=VJ.polygonCentre(area);
    return {id,area,label:[c.x,c.z],displayOnly:true};
  }
  function laneGeom(n) { return state.areas?.lanes.find((l) => l.lane === n); }
  // The workspace draws selection itself (twin-graphics cage). The renderer's legacy selection
  // (thick stroke + dimmed streams) is only kept for the Behaviour lens, which was built on it.
  function select(sel, { fly = false } = {}) {
    state.sel = sel;
    if (!sel) { api.select(null); render(); return; }
    const g = sel.kind === 'dept' ? deptGeom(sel.id) : laneGeom(sel.id);
    const rings = sel.kind === 'dept' ? g?.area : g?.queue;
    if (rings?.length && state.lens !== 'behaviour') {
      api.select(null);
      const c = VJ.polygonCentre(rings);
      if (fly && c) api.flyTo(c.x, c.z, sel.kind === 'lane' ? 14 : 24);
    } else if (rings?.length) {
      const polys = rings.map((r) => r.outer);
      const c = VJ.polygonCentre(rings);
      api.select({ id: `${sel.kind}:${sel.id}`, name: sel.kind === 'dept' ? VJ.deptLabel(sel.id) : `Lane ${sel.id}`, category:sel.kind==='dept'?sel.id:`Checkout ${sel.id}`, zones:sel.kind==='lane'?{queue:g.queue,service:g.service}:null, alert:sel.kind==='lane' && state.vj.view?.queue?.[state.slot]?.value>VJ.THRESHOLDS.queueSlotMin, rings, vertices: polys[0], polygons: polys, businessKind: sel.kind === 'lane' ? 'queue' : 'department', cx: c.x, cz: c.z }, { fly, span: sel.kind === 'lane' ? 14 : 22 });
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
    if (state.sel?.kind === 'lane' && ['engagement', 'opportunities', 'behaviour'].includes(id)) select(null);
    if (state.sel?.kind === 'dept' && id === 'service') select(null);
    if (state.sel?.kind === 'roi') { const a = execAreas().find((x) => x.key === state.sel.id); if (a && ((a.kind === 'queue') !== (id === 'service'))) execSelect(null); }
    if (prev === 'behaviour' && id !== 'behaviour') api.select(null);
    // Engagement always has one department in focus (the pilot reads one place at a time).
    if (id === 'engagement' && !state.sel && !isExec()) { const top = VJ.rankDepartments(state.vj.view, state.slot)[0]; if (top) state.sel = { kind: 'dept', id: top.id }; }
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
        // v3: the floor never carries a colour-mapped scalar; each question is drawn as geometry on top.
        await api.lens({ base: 'moved', mode: 'moved', particles: 2400 });
      } else if (state.lens === 'pulse') {
        await api.lens({ base: 'moved', mode: 'moved', particles: 2400 });
      } else if (state.lens === 'live') {
        await api.lens({ base: layer === 'context' ? 'moved' : 'hot', mode: layer === 'context' ? 'moved' : 'hot', particles: 900 });
      } else if (state.lens === 'compare') {
        await api.lens({ base: 'moved', mode: 'moved' });
      } else if (state.lens === 'behaviour') {
        await api.lens({ base: 'moved', mode: 'moved', particles: 2400 });
      } else {
        await api.lens({ base: 'moved', mode: 'moved', particles: 2000 });
      }
      if (lensChanged || state.lens === 'flow') api.relief(false);
      api.streams?.(streamGainFor());
      api.contours?.(state.contours);
      applyTint();
      if (lensChanged) {
        if (state.lens === 'service') flyCheckout();
        else if (state.lens === 'flow') api.top();
        else if (state.sel && ['live', 'behaviour'].includes(state.lens)) focusSelection();
        else if (state.lens !== 'compare') api.overview();
      }
    } finally { state.busy = false; }
    if (state.lens === 'compare') void renderCompare();
  }

  /** How strong the movement streams are in each picture (rendering only). */
  function streamGainFor() {
    const L = state.lens, layer = state.layer[L];
    if (L === 'pulse') return layer === 'movement' ? 1 : layer === 'evidence' ? 0.45 : 0;
    if (L === 'flow') return { movement: 1, dwell: 0.3, footfall: 0.2, purity: 0.2, convergence: 0.15, regime: 0 }[layer] ?? 1;
    if (L === 'engagement') return state.eng.flow ? 0.4 : 0;
    if (L === 'service') return 0.2;
    if (L === 'opportunities') return 0.22;
    return 1; // behaviour, live, compare: unchanged
  }

  // ------------------------------------------------------------------ kinetic states on the floor
  async function loadKin() {
    try { state.kin = { K: await KN.loadKinetic(), status: 'ok', note: '' }; }
    catch (e) { state.kin = { K: null, status: 'none', note: `Movement states unavailable (${e.message})` }; }
    applyTint(); render();
  }
  const kinSlice = () => KN.SLOT_SLICE[state.slot] || 'trading';
  const kinDay = () => state.kin.K?.day || null;
  /** The kinetic file is one measured day; it is only shown next to that same day. */
  const kinMatches = () => !!state.kin.K && (!state.vj.view || state.vj.view.day === kinDay());
  const DIM = [0.10, 0.14, 0.18];
  // Motion presets per behaviour (rendering only): trail length, speed, how straight the heading stays.
  const STREAM_PRESET = {
    transit: { trail: 20, timeScale: 15, inertia: 0.9, kappa: 4, particles: 3000, dwellDrag: false },
    browse: { trail: 18, timeScale: 9, inertia: 0.7, kappa: 2.2, particles: 3000 },
    choose: { trail: 14, timeScale: 5, inertia: 0.55, kappa: 1.6, particles: 1500, dwellDrag: true },
    pause: { trail: 14, timeScale: 4.5, inertia: 0.5, kappa: 1.4, particles: 1400, dwellDrag: true },
    hesitate: { trail: 18, timeScale: 8, inertia: 0.3, kappa: 0.9, particles: 3000 },
    wait: { trail: 14, timeScale: 4.5, inertia: 0.6, kappa: 2, particles: 1300, dwellDrag: true },
  };
  let tintIdx = null;
  function applyTint() {
    const K = state.kin.K;
    if (state.lens !== 'behaviour' || !K) { if (tintIdx) api.focusStreams?.(null); api.tint?.(null); tintIdx = null; return; }
    tintIdx = KN.cellIndex(K, kinSlice()) || KN.cellIndex(K, 'trading');
    const focus = state.kfocus ?? (state.layer.behaviour === 'hotspots' ? KN.STATE.hesitate.k : null);
    const idx = tintIdx;
    if (state.kfocus != null && state.layer.behaviour === 'streams') {
      // Only this behaviour on the floor: streams are born where its person-time is, in its colour,
      // brighter where it dominates, with a motion preset that reads as the behaviour itself.
      const k = state.kfocus, st = KN.STATES[k];
      let top = 0; for (const c of idx.map.values()) top = Math.max(top, c.sec[k]);
      const weight = (x, z) => { const c = idx.at(x, z); return c && top ? Math.min(1, Math.pow(c.sec[k] / top, 0.55) * 1.6) : 0; };
      api.focusStreams?.({ weight, preset: STREAM_PRESET[st.id], head: { transit: 0.35, browse: 0.45, hesitate: 0.5 }[st.id] ?? 0.8 });
      // Slow states pile short trails on the same spot; additive blending would wash them to white.
      const gain = { transit: 1.15, browse: 0.9, hesitate: 0.9 }[st.id] ?? 0.85;
      api.tint?.((x, z) => { const w = weight(x, z); return w < 0.04 ? DIM : st.glow.map((v) => v * (0.45 + 0.55 * w)); }, gain);
      return;
    }
    api.focusStreams?.(null);
    api.tint?.((x, z, u) => {
      const k = KN.stateAt(idx, x, z, u);
      if (k < 0) return null;
      if (focus != null && k !== focus) return DIM;
      return KN.STATES[k].glow;
    }, focus != null ? 1.0 : 0.5);
  }
  function setFocus(k) { state.kfocus = state.kfocus === k ? null : k; applyTint(); render(); }
  /** Which department area (0.25 m raster rings) contains a point. */
  function deptAt(x, z) {
    for (const d of state.areas?.departments || []) {
      for (const r of d.area || []) {
        const p = r.outer; let inside = false;
        for (let a = 0, b = p.length - 1; a < p.length; b = a++) {
          if ((p[a][1] > z) !== (p[b][1] > z) && x < (p[b][0] - p[a][0]) * (z - p[a][1]) / (p[b][1] - p[a][1]) + p[a][0]) inside = !inside;
        }
        if (inside) return d.id;
      }
    }
    return null;
  }
  function donutSvg(sh, size = 46) {
    const r = 16, C = 2 * Math.PI * r;
    let off = 0, arcs = '';
    for (const st of KN.STATES) {
      const v = sh?.[st.id] || 0; if (v <= 0) continue;
      const len = Math.max(0, v * C - 1.2);
      arcs += `<circle r="${r}" cx="20" cy="20" fill="none" stroke="${st.color}" stroke-width="6" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 20 20)"/>`;
      off += v * C;
    }
    return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true"><circle r="${r}" cx="20" cy="20" fill="rgba(5,11,18,.82)" stroke="rgba(255,255,255,.06)" stroke-width="7"/>${arcs}</svg>`;
  }
  function mixBar(sh, opts = {}) {
    return h('div', { class: `hx-mix${opts.thin ? ' thin' : ''}`, role: 'img', 'aria-label': KN.STATES.map((st) => `${st.en} ${pct(sh?.[st.id])}`).join(', ') },
      ...KN.STATES.map((st) => h('i', { style: `flex:${(sh?.[st.id] || 0).toFixed(4)};background:${st.color}`, title: `${st.it} · ${pct(sh?.[st.id], 1)}` })));
  }

  // ------------------------------------------------------------------ Service · minute by minute (211_checkout_replay)
  const RP_TICK_MS = 100, RP_STEPS_PER_TICK = 4; // 15 s steps: the whole day plays in about 72 s
  const rpOn = () => state.lens === 'service' && state.layer.service === 'replay' && !isExec();
  function rpDay() {
    const d = state.vj.view?.day;
    if (typeof d === 'string') return d;
    if (d && d.from && d.from === d.to) return d.from;
    return d?.from || kinDay() || null;
  }
  async function loadReplay() {
    const day = rpDay(), R = state.replay;
    if (!day || (R.day === day && R.status !== 'idle')) return;
    R.day = day; R.status = 'loading'; R.data = null;
    try {
      const r = await fetch(`./checkouts/${day}.json`, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 404 ? 'none' : `HTTP ${r.status}`);
      R.data = await r.json(); R.status = 'ready';
      if (R.k == null || R.k >= R.data.q[R.data.lanes[0].key].length) R.k = Math.round((R.data.peak.from_s + 25 * 60) / R.data.step_s);
    } catch (e) { R.status = e.message === 'none' ? 'none' : 'error'; }
    overlayKey = ''; paintKey = ''; render();
  }
  const rpN = () => state.replay.data ? state.replay.data.q[state.replay.data.lanes[0].key].length : 0;
  const rpSec = (k = state.replay.k) => (state.replay.data ? k * state.replay.data.step_s : 0);
  function rpClock(sec) {
    const D = state.replay.data; if (!D) return '';
    return new Date(D.t0 + sec * 1000).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: D.tz || 'Europe/Rome' });
  }
  function rpNow(k = state.replay.k) {
    const D = state.replay.data; let q = 0, s = 0;
    if (D) for (const l of D.lanes) { q += D.q[l.key][k] || 0; s += D.s[l.key][k] || 0; }
    return { q, s };
  }
  function rpPlay(on = !state.replay.playing) {
    const R = state.replay; R.playing = on; clearInterval(R.timer);
    if (on) {
      if (R.k >= rpN() - 1) R.k = 0;
      R.timer = setInterval(() => {
        if (!rpOn()) return rpPlay(false);
        R.k = Math.min(rpN() - 1, R.k + RP_STEPS_PER_TICK);
        rpTick();
        if (R.k >= rpN() - 1) rpPlay(false);
      }, RP_TICK_MS);
    }
    rpTick();
  }
  function rpSeek(k) { state.replay.k = Math.max(0, Math.min(rpN() - 1, Math.round(k))); rpTick(); }
  let rpHour = -1;
  function rpTick() {
    paintKey = '';
    drawReplayStrip(); updateReplayClock();
    // The panel's lane rows follow the playhead in one-hour windows; rebuild only when the window moves.
    const hr = Math.floor(rpSec() / 1800);
    if (hr !== rpHour) { rpHour = hr; renderInspector(); } else updateReplayPanel();
  }
  function updateReplayClock() {
    const on = rpOn() && state.replay.status === 'ready';
    replayClock.hidden = !on; replayStrip.hidden = !on; root.classList.toggle('hx-rp-on', on);
    replayPlay.innerHTML = state.replay.playing ? ICONS.pause : ICONS.play;
    replayPlay.setAttribute('aria-label', state.replay.playing ? 'Pause' : 'Play the day');
    if (!on) return;
    const n = rpNow();
    replayClock.replaceChildren(h('small', null, `REPLAY · ${VJ.fmtDay(state.replay.day).toUpperCase()}`), h('b', null, rpClock(rpSec())),
      h('span', null, h('i', { class: 'q' }), `${n.q} queuing`, h('i', { class: 's' }), `${n.s} paying`));
  }
  function drawReplayStrip() {
    const D = state.replay.data; if (!D || replayStrip.hidden) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), cw = replayCanvas.clientWidth || 600, chh = replayCanvas.clientHeight || 64;
    if (replayCanvas.width !== Math.round(cw * dpr)) { replayCanvas.width = Math.round(cw * dpr); replayCanvas.height = Math.round(chh * dpr); }
    const c = replayCanvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, cw, chh);
    const S = D.series15, total = (D.t1 - D.t0) / 1000, top = 6, bot = chh - 14;
    const mx = Math.max(1, ...S.map(([, q, s]) => q + s)) * 1.1;
    const X = (sec) => (sec / total) * cw, Y = (v) => bot - (bot - top) * v / mx;
    c.fillStyle = 'rgba(229,142,146,.10)'; c.fillRect(X(D.peak.from_s), top - 4, X(D.peak.to_s) - X(D.peak.from_s), bot - top + 4);
    const area = (fn, fill, stroke) => {
      c.beginPath(); c.moveTo(0, bot);
      S.forEach(([t, q, s]) => c.lineTo(X(t + 450), Y(fn(q, s))));
      c.lineTo(cw, bot); c.closePath(); c.fillStyle = fill; c.fill();
      c.beginPath(); S.forEach(([t, q, s], i) => (i ? c.lineTo : c.moveTo).call(c, X(t + 450), Y(fn(q, s)))); c.strokeStyle = stroke; c.lineWidth = 1.4; c.stroke();
    };
    area((q, s) => q + s, 'rgba(243,199,120,.28)', '#F3C778');
    area((q) => q, 'rgba(229,142,146,.42)', '#E58E92');
    c.font = '10px Inter, system-ui, sans-serif'; c.fillStyle = 'rgba(141,163,179,.9)'; c.textAlign = 'center';
    for (let t = 0; t <= total; t += 7200) c.fillText(rpClock(t), Math.min(cw - 14, Math.max(14, X(t))), chh - 2);
    c.textAlign = 'left'; c.fillStyle = '#E58E92'; c.fillText(`peak ${rpClock(D.peak.from_s)}–${rpClock(D.peak.to_s)}`, X(D.peak.from_s) + 4, top + 8);
    const px = X(rpSec());
    c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.moveTo(px, top - 4); c.lineTo(px, bot); c.stroke();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(px, top - 2, 4, 0, Math.PI * 2); c.fill();
  }
  const rpBox = (rings) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const r of rings || []) for (const [x, z] of (r.outer || r)) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); } return Number.isFinite(a) ? { minX: a, maxX: b, minZ: c, maxZ: d } : null; };
  const rpLaneOf = (l) => { for (const n of l.lanes) { const g = laneGeom(n); if (g?.queue?.length || g?.service?.length) return g; } return null; };
  const rpCircle = (x, z, r) => Array.from({ length: 14 }, (_, i) => [x + Math.cos(i / 14 * Math.PI * 2) * r, z + Math.sin(i / 14 * Math.PI * 2) * r]);
  /** Items that change with the playhead: the queue comet, people in it, the lit till. */
  function replayDyn() {
    const D = state.replay.data, k = state.replay.k; if (!D || k == null) return [];
    const out = [];
    for (const l of D.lanes) {
      const g = rpLaneOf(l); if (!g) continue;
      const qb = rpBox(g.queue), sb = rpBox(g.service);
      const q = D.q[l.key][k] || 0, s = D.s[l.key][k] || 0;
      const till = sb ? sb.minX : qb?.maxX; if (till == null) continue;
      const zc = sb ? (sb.minZ + sb.maxZ) / 2 : (qb.minZ + qb.maxZ) / 2;
      const hw = Math.min(0.75, ((qb || sb).maxZ - (qb || sb).minZ) * 0.42);
      if (q > 0) {
        const L = Math.min(16, 1.2 + q * 1.25);
        for (let seg = 0; seg < 5; seg++) {
          const x0 = till - L * (seg + 1) / 5, x1 = till - L * seg / 5, w = hw * (1 - seg * 0.12);
          out.push({ t: 'ring', pts: [[x0, zc - w], [x1, zc - w], [x1, zc + w], [x0, zc + w]], color: 'rgba(0,0,0,0)', width: 0.01, fill: `rgba(229,142,146,${(0.62 - seg * 0.11).toFixed(2)})`, y: 0.06 });
        }
        for (let i = 0; i < q; i++) {
          const x = till - 0.6 - (i % 12) * 1.25, z = zc + (i >= 12 ? 0.35 : 0) * (i % 2 ? 1 : -1);
          out.push({ t: 'ring', pts: rpCircle(x, z, 0.26), color: '#FFD9DB', width: 1, fill: '#E58E92', y: 0.1 });
          out.push({ t: 'line', pts: [[x - 0.45, z], [x - 0.9, z]], color: '#E58E92', width: 1.6, alpha: 0.45, y: 0.1 });
        }
      }
      if (s > 0 && sb) {
        for (const r of g.service) out.push({ t: 'ring', pts: r.outer || r, color: '#F3C778', width: 1.6, fill: 'rgba(243,199,120,0.32)', glow: 10, y: 0.07 });
        for (let i = 0; i < s; i++) out.push({ t: 'ring', pts: rpCircle(sb.minX + 0.7 + i * 0.75, zc, 0.28), color: '#FFF1D2', width: 1, fill: '#F3C778', y: 0.12 });
      }
    }
    return out;
  }

  function flyCheckout() {
    const lanes = state.areas?.lanes || [];
    const pts = lanes.flatMap((l) => [...(l.queue || []), ...(l.service || [])].flatMap((r) => r.outer));
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    // Stable oblique view of the whole checkout line, a little context around it.
    api.fit?.('oblique', { minX: Math.min(...xs) - 6, maxX: Math.max(...xs) + 6, minZ: Math.min(...zs) - 4, maxZ: Math.max(...zs) + 4, margin: 0.8 });
  }
  function focusSelection() {
    if (!state.sel) { api.overview(); return; }
    if(api.twin){api.twin.focus();return;}
    if (state.sel.kind === 'roi') { const a = execAreas().find((x) => x.key === state.sel.id); if (a) api.flyTo(a.x, a.z, a.kind === 'queue' ? 14 : 22); return; }
    const g = state.sel.kind === 'dept' ? deptGeom(state.sel.id)?.area : laneGeom(state.sel.id)?.queue;
    const pts = (g || []).flatMap((r) => r.outer);
    if (!pts.length) return;
    // Frame the place with real context around it (8 m), same oblique grammar as the overview.
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]), pad = state.sel.kind === 'lane' ? 6 : 8;
    api.fit?.('oblique', { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad, margin: 0.8 });
  }

  async function setLayer(id) {
    state.layer[state.lens] = id;
    render();
    await applyRenderer(false);
    render();
  }

  async function setSlot(sl) {
    state.slot = sl;
    if(state.sel?.kind==='lane')api.twin?.alert(state.vj.view?.queue?.[sl]?.value>VJ.THRESHOLDS.queueSlotMin);
    render();
    const i = info();
    const slice = SLOT_TO_SLICE[sl];
    if (api.hasSlice(slice) && i.slice !== slice) {
      try { await api.slice(slice); } catch { /* flow stays on its window; the chip says so */ }
    }
    applyTint();
    render();
    if (state.lens === 'compare') void renderCompare();
  }

  // ------------------------------------------------------------------ header + title
  // ------------------------------------------------------------------ period picker (day / week / month)
  const periodUi = { open: false, mode: 'day', month: null, pick: null, hover: null, avail: {}, online: null, note: '' };
  const periodPop = h('div', { class: 'hx-period-pop', role: 'dialog', 'aria-label': 'Choose a period', hidden: true });
  const periodLoad = h('div', { class: 'hx-period-load', role: 'status', 'aria-live': 'polite', hidden: true });
  document.body.append(periodPop);
  stage.append(periodLoad);
  // Service · minute by minute: clock chip on the floor and the day's curve as the time scrubber.
  const replayClock = h('div', { class: 'hx-rp-clock', hidden: true });
  const replayStrip = h('div', { class: 'hx-rp-strip', hidden: true });
  const replayCanvas = h('canvas', { class: 'hx-rp-canvas', 'aria-label': 'People at the checkouts through the day. Drag to replay.' });
  const replayPlay = h('button', { type: 'button', class: 'hx-play', 'aria-label': 'Play the day' });
  replayStrip.append(replayPlay, h('div', { class: 'hx-rp-cw' }, h('small', null, 'PEOPLE AT THE CHECKOUTS · DRAG TO REPLAY'), replayCanvas));
  stage.append(replayClock, replayStrip);
  replayPlay.addEventListener('click', () => rpPlay());
  {
    let drag = false;
    const seekAt = (e) => { const r = replayCanvas.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; rpSeek(x * (rpN() - 1)); };
    replayCanvas.addEventListener('pointerdown', (e) => { drag = true; rpPlay(false); replayCanvas.setPointerCapture(e.pointerId); seekAt(e); });
    replayCanvas.addEventListener('pointermove', (e) => { if (drag) seekAt(e); });
    replayCanvas.addEventListener('pointerup', () => { drag = false; renderInspector(); });
  }
  document.addEventListener('click', (e) => { if (periodUi.open && !periodPop.contains(e.target)) { periodUi.open = false; renderPeriodPop(); renderChrome(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && periodUi.open) { periodUi.open = false; renderPeriodPop(); renderChrome(); } });
  const venueOf = () => info().venue || api.snapshot().field?.meta?.venue_id;
  const offlineDays = () => [state.vj.view?.period ? null : state.vj.view?.day].filter(Boolean);

  function togglePeriod() {
    periodUi.open = !periodUi.open;
    if (periodUi.open) {
      const cur = state.period || PER.periodFor('day', state.vj.view?.period?.to || kpiDay() || new Date().toISOString().slice(0, 10));
      periodUi.mode = cur.mode; periodUi.pick = cur.to; periodUi.month = PER.monthOf(cur.to).from;
      void loadAvailability();
    }
    renderPeriodPop(); renderChrome();
  }
  async function loadAvailability() {
    const m = periodUi.month; if (!m || periodUi.avail[m]) return;
    const { from, to } = PER.monthOf(m);
    // One extra week each side so a week that crosses the month edge is known too.
    const a = await PER.availability({ venueId: venueOf(), from: PER.addDays(from, -7), to: PER.addDays(to, 7), offlineDays: offlineDays() });
    periodUi.avail[m] = a.status; periodUi.online = a.online;
    periodUi.note = a.online ? '' : 'The Hyperspace server is not reachable from this page, so only the saved day can be shown. Start the backend to calculate other days.';
    renderPeriodPop();
  }
  const statusOf = (d) => { for (const st of Object.values(periodUi.avail)) if (st[d]) return st[d]; return 'unknown'; };
  function renderPeriodPop() {
    periodPop.hidden = !periodUi.open;
    if (!periodUi.open) return;
    const r = dayBox.getBoundingClientRect();
    periodPop.style.top = `${Math.round(r.bottom + 8)}px`;
    periodPop.style.right = `${Math.round(window.innerWidth - r.right)}px`;
    const sel = periodUi.pick ? PER.periodFor(periodUi.mode, periodUi.pick) : null;
    const hov = periodUi.hover && periodUi.mode !== 'day' ? PER.periodFor(periodUi.mode, periodUi.hover) : null;
    const inP = (p, d) => p && d >= p.from && d <= p.to;
    const grid = h('div', { class: 'hx-cal', role: 'grid' }, ...['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => h('span', { class: 'dow' }, w)),
      ...PER.monthGrid(periodUi.month).map((d) => {
        if (!d) return h('span', { class: 'pad' });
        const st = statusOf(d);
        return h('button', { type: 'button', class: `d ${st}${inP(sel, d) ? ' in' : ''}${sel && (d === sel.from || d === sel.to) ? ' edge' : ''}${inP(hov, d) ? ' hov' : ''}`,
          title: { ready: 'Calculated', computable: 'Raw data available: will be calculated', none: 'No data', unknown: 'Checking…' }[st],
          'data-day': d,
          // Hover only toggles classes: rebuilding the grid under the pointer would swallow the click.
          onmouseenter: () => { periodUi.hover = d; const hp = periodUi.mode !== 'day' ? PER.periodFor(periodUi.mode, d) : null;
            for (const b of periodPop.querySelectorAll('.hx-cal .d')) b.classList.toggle('hov', !!hp && b.dataset.day >= hp.from && b.dataset.day <= hp.to); },
          onclick: (e) => { e.stopPropagation(); periodUi.pick = d; renderPeriodPop(); } }, String(Number(d.slice(8))), h('i')); }));
    const days = sel?.days || [];
    const n = (st) => days.filter((d) => statusOf(d) === st).length;
    const ready = n('ready'), comp = n('computable'), none = n('none');
    const canShow = ready + comp > 0;
    const monthTitle = new Date(`${periodUi.month}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const nav = (k) => (e) => { e.stopPropagation(); const d = new Date(`${periodUi.month}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + k); periodUi.month = d.toISOString().slice(0, 8) + '01'; renderPeriodPop(); void loadAvailability(); };
    periodPop.replaceChildren(...[
      h('div', { class: 'hx-seg', role: 'group', 'aria-label': 'Period length' }, ...PER.MODES.map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String(periodUi.mode === k), onclick: (e) => { e.stopPropagation(); periodUi.mode = k; renderPeriodPop(); } }, t))),
      h('div', { class: 'hx-cal-head' }, h('button', { type: 'button', 'aria-label': 'Previous month', onclick: nav(-1) }, '‹'), h('b', null, monthTitle), h('button', { type: 'button', 'aria-label': 'Next month', onclick: nav(1) }, '›')),
      grid,
      h('div', { class: 'hx-cal-key' }, h('span', { class: 'ready' }, h('i'), 'Calculated'), h('span', { class: 'computable' }, h('i'), 'Can be calculated'), h('span', { class: 'none' }, h('i'), 'No data')),
      sel ? h('div', { class: 'hx-cal-sum' }, h('b', null, PER.periodLabel(sel)),
        h('span', null, `${days.length} day${days.length > 1 ? 's' : ''} · ${ready} calculated${comp ? ` · ${comp} to calculate (about ${comp * 10} min on the server)` : ''}${none ? ` · ${none} without data` : ''}`)) : null,
      periodUi.note ? h('p', { class: 'hx-cal-note' }, periodUi.note) : null,
      h('div', { class: 'hx-cal-actions' },
        h('button', { type: 'button', class: 'hx-ghost', onclick: (e) => { e.stopPropagation(); periodUi.open = false; renderPeriodPop(); renderChrome(); } }, 'Cancel'),
        h('button', { type: 'button', class: 'hx-primary', disabled: !canShow, onclick: (e) => { e.stopPropagation(); periodUi.open = false; renderPeriodPop(); void applyPeriod(sel); } },
          comp ? 'Calculate and show' : 'Show'))].filter(Boolean));
  }

  function renderPeriodLoad() {
    const J = state.periodJob;
    periodLoad.hidden = !J;
    if (!J) return;
    const rows = J.days.map((d) => J.status[d] || { state: 'queued' });
    const done = rows.filter((r) => ['ready', 'none', 'error'].includes(r.state)).length;
    const calc = rows.filter((r) => r.state === 'computing');
    const left = calc.reduce((a, r) => Math.max(a, (r.eta_s || 0) - (r.waited_s || 0)), 0);
    const chip = (r) => ({ queued: 'Waiting', loading: 'Loading…', computing: `Calculating${r.eta_s ? ` · ~${Math.max(1, Math.ceil(Math.max(0, r.eta_s - (r.waited_s || 0)) / 60))} min` : '…'}`, ready: 'Ready', none: 'No data', error: r.note || 'Failed' }[r.state]);
    periodLoad.replaceChildren(h('div', { class: 'hx-pl-card' },
      h('small', null, calc.length ? 'CALCULATING ON THE SERVER' : 'LOADING'),
      h('b', null, PER.periodLabel(J.period)),
      h('div', { class: 'hx-pl-bar' }, h('i', { style: `width:${(100 * done / rows.length).toFixed(1)}%` })),
      h('p', null, `${done} of ${rows.length} day${rows.length > 1 ? 's' : ''} done${calc.length ? ` · ${calc.length} being calculated from the raw 10 Hz data${left > 0 ? `, about ${Math.ceil(left / 60)} min left` : ''}` : ''}.`),
      rows.length > 1 || calc.length ? h('ul', null, ...J.days.map((d, k) => h('li', { class: rows[k].state }, h('span', null, VJ.fmtDay(d)), h('em', null, chip(rows[k]))))) : null,
      h('p', { class: 'hx-pl-note' }, 'The current view stays on screen until the new period is ready.'),
      h('button', { type: 'button', class: 'hx-ghost', onclick: () => J.abort.abort() }, 'Cancel')));
  }

  /** Load (and if needed calculate) every day of the period, combine, then move numbers and floor together. */
  async function applyPeriod(p) {
    if (!p || state.periodJob) return;
    const abort = new AbortController();
    const J = { period: p, days: p.days.filter((d) => statusOf(d) !== 'none'), status: {}, abort };
    if (!J.days.length) J.days = p.days;
    state.periodJob = J; renderPeriodLoad(); renderChrome();
    const venueId = venueOf();
    try {
      const res = await PER.loadDays({ venueId, days: J.days, signal: abort.signal, concurrency: 2,
        onUpdate: (u) => { J.status[u.day] = u; renderPeriodLoad(); } });
      const views = [];
      for (const r of res) {
        if (r.state !== 'ready') continue;
        try { views.push(VJ.buildVisitorView(r.payload, { venueId, day: r.day })); } catch (e) { J.status[r.day] = { state: 'error', note: e.message }; }
      }
      // Preview without a server: the saved snapshot day still works.
      if (!views.length && VJ.isPreviewHost?.() && p.days.includes(offlineDays()[0])) views.push(state.vj.view);
      if (!views.length) {
        J.failed = 'No day in this period could be loaded.';
        renderPeriodLoad();
        await new Promise((r) => setTimeout(r, 2200));
        return;
      }
      const used = views.map((v) => v.day).sort();
      const view = p.days.length > 1 ? VJ.combineViews(views, { from: p.from, to: p.to }) : views[0];
      if (view.period) view.period.days = used;
      state.vj = { view, origin: 'api', note: p.days.length > 1 ? `daily_kpi · ${used.length} of ${p.days.length} days combined` : 'daily_kpi · Visitor Journey' };
      state.period = p;
      // Floor: the same days. A single day switches the dated pack; a period merges the packs.
      const flowHave = new Set(api.flowDays?.() || []);
      const flowDays = used.filter((d) => flowHave.has(d));
      if (p.days.length === 1) { if (flowHave.has(used[0])) await api.setDate(used[0]); }
      else if (flowDays.length) await api.setRange({ from: p.from, to: p.to, days: flowDays });
      state.floorNote = p.days.length > 1 ? (flowDays.length ? `floor combines ${flowDays.length} day${flowDays.length > 1 ? 's' : ''}` : 'no movement pack for these days') : '';
    } catch (e) {
      if (e.name !== 'AbortError') console.error('Period load failed', e);
    } finally {
      state.periodJob = null;
      renderPeriodLoad();
      render();
      if (state.lens === 'compare') void renderCompare();
    }
  }

  function renderChrome() {
    const lens = LENS[state.lens];
    root.style.setProperty('--hx-accent', lens.accent);
    root.dataset.lens = state.lens;
    for (const b of document.querySelectorAll('.hx-tabs button, .hx-rail button[data-lens]')) b.setAttribute('aria-pressed', String(b.dataset.lens === state.lens));

    // Day: one picker drives both the floor and the numbers when live days exist.
    const i = info();
    dayBox.replaceChildren();
    const vjDay = kpiDay();
    // One period picker (day / week / month) drives the numbers and the floor together.
    dayBox.append(h('button', { type: 'button', class: 'hx-period-btn', 'aria-haspopup': 'dialog', 'aria-expanded': String(!!periodUi.open), disabled: !!state.periodJob,
      onclick: (e) => { e.stopPropagation(); togglePeriod(); } },
      h('i', { html: ICONS.calendar }), h('span', null, state.period ? PER.periodLabel(state.period) : (vjDay ? VJ.fmtDay(vjDay) : 'Choose a day')),
      state.period && state.period.mode !== 'day' ? h('small', null, `${state.vj.view?.period?.n || 0} of ${state.period.days.length} days`) : null,
      h('b', { class: 'caret' }, '▾')));

    // Title row with explicit source chips.
    const vj = state.vj;
    const flowLabel = state.period && state.period.mode !== 'day' && state.floorNote
      ? `${i.sliceLabel} · ${PER.periodLabel(state.period)} · ${state.floorNote}`
      : `${i.sliceLabel}${i.date || i.localDate ? ` · ${VJ.fmtDay(i.date || i.localDate)}` : ''}${i.live ? '' : ' · bundled'}`;
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
            state.lens === 'behaviour' ? h('span', { class: `hx-pill kin ${state.kin.status}`, title: 'Journey Lab 220 · kinetic states from the raw 10 Hz tracks' }, h('i'), 'Movement states ',
              h('b', null, state.kin.K ? `${VJ.fmtSlot(state.slot)} · ${VJ.fmtDay(kinDay())} · 10 Hz` : state.kin.status === 'loading' ? 'loading…' : 'unavailable')) : null,
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
    // Engagement overlays are independent switches, not layers.
    if (state.lens === 'engagement' && !isExec()) {
      layerSeg.append(h('span', { class: 'hx-seg-gap' }),
        h('button', { type: 'button', class: 'tog', 'aria-pressed': String(state.eng.iso), title: kinMatches() ? 'Measured 10 Hz choosing time inside the department' : 'Flow-field slow presence inside the department', onclick: () => { state.eng.iso = !state.eng.iso; render(); } }, 'Isolines'),
        h('button', { type: 'button', class: 'tog', 'aria-pressed': String(state.eng.flow), onclick: () => { state.eng.flow = !state.eng.flow; api.streams?.(streamGainFor()); render(); } }, 'Movement'));
    }

    bar.replaceChildren();
    const paused = api.snapshot().paused;
    if (state.lens === 'compare') {
      if (state.layer.compare === 'day') {
        const W = compareWindows();
        bar.append(h('button', { type: 'button', class: 'hx-play', 'aria-label': state.compare.playing ? 'Pause the day' : 'Play the day', html: state.compare.playing ? ICONS.pause : ICONS.play, onclick: () => togglePlay() }),
          h('div', { class: 'hx-seg hx-slots', role: 'group', 'aria-label': 'Slot' }, ...W.map((w, k) => h('button', { type: 'button', 'aria-pressed': String(k === state.compare.active), onclick: () => { togglePlay(false); setActive(k); renderStageControls(); } }, w.label))),
          h('span', { class: 'hx-bar-note' }, state.compare.playing ? 'Playing the day…' : 'Play walks the day slot by slot'));
      } else bar.append(h('span', { class: 'hx-bar-note' }, 'Windows are chosen in the inspector. Both maps share grid, scale and orientation (top view).'));
    } else if (state.lens === 'live') {
      bar.append(h('button', { type: 'button', class: 'hx-play', 'aria-label': paused ? 'Play' : 'Pause', html: paused ? ICONS.play : ICONS.pause, onclick: () => { api.pause(!api.snapshot().paused); renderStageControls(); } }));
      bar.append(h('span', { class: 'hx-now' }, h('i'), 'NOW'), h('span', { class: 'hx-bar-note' }, 'Europe/Rome · live positions appear only with a verified feed'));
    }
    if (state.lens !== 'compare' && state.lens !== 'live' && !rpOn()) bar.append(h('button', { type: 'button', class: 'hx-play', 'aria-label': paused ? 'Play' : 'Pause', html: paused ? ICONS.play : ICONS.pause, onclick: () => { api.pause(!api.snapshot().paused); renderStageControls(); } }));
    if (state.lens === 'opportunities' && state.layer.opportunities === 'value') {
      bar.append(h('span', { class: 'hx-bar-note' }, 'Scenarios use the whole trading day (08–20). Time slots apply to the other views.'));
    } else if (state.lens === 'compare' || state.lens === 'live') { /* handled above */ } else if (rpOn()) {
      const R = state.replay;
      bar.append(h('span', { class: 'hx-bar-note' }, R.status === 'ready' ? `Replay of ${VJ.fmtDay(R.day)} · drag the curve or press play · 15 s steps` : R.status === 'loading' ? 'Loading the checkout replay…' : 'No checkout replay for this day yet'));
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
        slots.append(h('button', { type: 'button', 'aria-pressed': String(state.slot === sl), title: v != null ? `${VJ.fmtInt(v)} entrants` : '', onclick: () => setSlot(sl) }, sl === VJ.DAY ? 'Whole day' : sl.replace('-', '–')));
      }
      const i = info();
      const moved = i.slice === SLOT_TO_SLICE[state.slot];
      bar.append(slots, h('span', { class: 'hx-bar-note', title: 'Visitor Journey always uses the slot you pick. The floor follows when a dated pack has that slot.' },
        moved ? `Floor and numbers: ${VJ.fmtSlot(state.slot)}` : `Numbers ${VJ.fmtSlot(state.slot)} · floor ${i.sliceLabel}`));
    }
    const cam = h('div', { class: 'hx-seg hx-cam', role: 'group', 'aria-label': 'Camera' },
      h('button', { type: 'button', onclick: () => api.top() }, 'Top'),
      h('button', { type: 'button', onclick: () => api.overview() }, '3D'),
      h('button', { type: 'button', onclick: () => focusSelection(), disabled: !state.sel && state.lens !== 'service' }, 'Focus'));
    if(state.sel)cam.append(h('button',{type:'button',onclick:returnToStore},'Store'));
    if (state.lens === 'service' && !state.sel) cam.lastChild.onclick = () => flyCheckout();
    cam.append(h('button', { type: 'button', class: 'hx-panelbtn', 'aria-pressed': String(!state.inspCollapsed), title: state.inspCollapsed ? 'Show the panel' : 'Hide the panel, larger canvas', onclick: () => toggleInspector() }, state.inspCollapsed ? 'Panel ‹' : 'Panel ›'));
    if (state.lens !== 'compare') bar.append(cam);
    else bar.append(h('div', { class: 'hx-seg hx-cam' }, cam.lastChild));
  }
  function toggleInspector(on = !state.inspCollapsed) {
    state.inspCollapsed = on;
    root.classList.toggle('hx-insp-off', on);
    // The renderer listens to window resize; refit after the layout settles, selection kept.
    setTimeout(() => { window.dispatchEvent(new Event('resize')); paintKey = ''; if (state.lens !== 'compare') { if (state.sel && state.lens !== 'flow') focusSelection(); else state.lens === 'flow' ? api.top() : state.lens === 'service' ? flyCheckout() : api.overview(); } else void renderCompare(); }, 260);
    renderStageControls();
  }

  // ------------------------------------------------------------------ map overlay (v3: geometry first)
  // Three layers over the WebGL twin, all in the registered venue-metre frame:
  //   paint canvas  line work (cages, outlines, shelf edges, isolines, glyphs), redrawn only when the camera moves
  //   SVG           invisible hit targets (click a department / lane), plus the Behaviour lens fills
  //   tags          HTML callouts anchored to venue points
  let shapes = []; // {poly: SVGPolygonElement, pts:[[x,z]...]}
  let pins = []; // {el, x, z}
  let items = []; // paint items (twin-graphics.js)
  let overlayKey = '', paintKey = '';

  function addShape(rings, cls, onClick, style = '') {
    for (const r of rings || []) {
      const poly = sv('polygon', { class: cls });
      if (style) poly.setAttribute('style', style);
      if (onClick) { poly.addEventListener('click', onClick); poly.classList.add('hit'); }
      overlay.append(poly);
      shapes.push({ poly, pts: r.outer || r });
    }
  }
  /** Invisible click target with a hover hairline. */
  function addHit(rings, onClick, title = '') {
    for (const r of rings || []) {
      const poly = sv('polygon', { class: 'hitzone' });
      if (title) { const t = sv('title'); t.textContent = title; poly.append(t); }
      poly.addEventListener('click', onClick);
      overlay.append(poly);
      shapes.push({ poly, pts: r.outer || r });
    }
  }
  function addPin(x, z, el) { tags.append(el); pins.push({ el, x, z }); }
  /** Spatial callout: anchor dot on the venue point, thin leader, one scoped value. */
  function callout(x, z, title, value, { tone = '', onclick = null, lead = false, side = 'r' } = {}) {
    const el = h(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: `hx-call ${tone}${lead ? ' lead' : ''} ${side}`, onclick },
      h('i', { class: 'dot' }), h('i', { class: 'leg' }), h('span', null, h('b', null, title), value != null ? h('small', null, value) : null));
    addPin(x, z, el);
    return el;
  }

  // ---- geometry cache (simplified rings, corners, shelf frontage) from visitor-areas.json + layout_prod.json
  const geo = { dept: new Map(), lane: new Map(), fix: null };
  const ringsOf = (rs, tol = 0.3) => (rs || []).map((r) => G.simplifyRing(r.outer, tol)).filter((r) => r.length >= 3);
  function deptShape(id) {
    if (geo.dept.has(id)) return geo.dept.get(id);
    const g = deptGeom(id); if (!g) return null;
    const rings = ringsOf(g.area);
    const main = rings.slice().sort((a, b) => G.ringArea(b) - G.ringArea(a))[0];
    const out = { id, rings, main, corners: main ? G.cornerIndices(main, 6) : [], band: ringsOf(g.banco, 0.15),
      front: geo.fix ? G.frontageEdges(g.banco, geo.fix) : null, label: g.label, area: g.area };
    if (geo.fix) geo.dept.set(id, out);
    return out;
  }
  function laneShape(n) {
    if (geo.lane.has(n)) return geo.lane.get(n);
    const g = laneGeom(n); if (!g) return null;
    const queue = ringsOf(g.queue, 0.12), service = ringsOf(g.service, 0.12);
    const main = queue.slice().sort((a, b) => G.ringArea(b) - G.ringArea(a))[0];
    const out = { lane: n, queue, service, main, corners: main ? G.cornerIndices(main, 4) : [], raw: g };
    geo.lane.set(n, out);
    return out;
  }
  const cageOf = (s, color = G.TOKENS.selection, extra = {}) => (api.twin && s && state.sel && String(state.sel.id) === String(s.id) ? [] : (s?.rings || [])).map((r) => (r === s.main
    ? { t: 'cage', ring: r, corners: s.corners, height: 3.2, color, width: 1.8, fill: 'rgba(169,181,238,0.05)', ...extra }
    : { t: 'ring', pts: r, color, width: 1.4, alpha: 0.85 }));
  const outlineOf = (rings, color = G.TOKENS.muted, o = {}) => (rings || []).map((r) => ({ t: 'ring', pts: r, color, width: o.width || 1, alpha: o.alpha ?? 1, dash: o.dash }));
  function frontageOf(s, alpha = 1) {
    if (!s) return [];
    const out = outlineOf(s.band, 'rgba(225,240,247,0.55)', { width: 0.8, dash: [3, 4], alpha: 0.7 * alpha });
    if (s.front?.length) {
      for (const l of s.front) out.push({ t: 'line', pts: l, color: G.TOKENS.frontage, width: 2.2, alpha, y: 0.07, glow: 4 });
      out.push({ t: 'brackets', lines: s.front, color: G.TOKENS.frontage, alpha });
    }
    return out;
  }

  // ---- isolines (marching squares on measured cells only; cached per source)
  const contourCache = new Map();
  const fieldIds = new WeakMap(); let fieldSeq = 0;
  const fid = (f) => { if (!fieldIds.has(f)) fieldIds.set(f, ++fieldSeq); return fieldIds.get(f); };
  /** Field-pack scalar (e.g. dwell, divergence) → contour paint items in venue metres. */
  function fieldContours(name, { scope = null, sign = 1, color = G.TOKENS.contour, ps } = {}) {
    const f = api.snapshot().field; if (!f?.[name]) return { items: [], levels: [], maxima: [] };
    const key = `f|${fid(f)}|${name}|${sign}|${scope || ''}|${(ps || []).join(',')}`;
    if (contourCache.has(key)) return contourCache.get(key);
    const arr = f[name];
    const inScope = scope ? (gx, gy) => { const v = api.toVenue(gx, gy); return G.inRings(v.x, v.z, deptGeom(scope)?.area); } : null;
    const grid = G.smoothSupported(f.NX, f.NY, (k) => sign * arr[k], (k) => f.support[k] > 0, 0);
    const vals = [];
    for (let k = 0; k < grid.length; k++) { if (!Number.isFinite(grid[k])) continue; if (inScope && !inScope((k % f.NX) + 0.5, Math.floor(k / f.NX) + 0.5)) continue; vals.push(grid[k]); }
    const levels = G.levelsFor(vals, ps);
    const cs = G.contours(f.NX, f.NY, grid, levels, { keep: inScope });
    const toV = (p) => { const v = api.toVenue(p[0], p[1]); return [v.x, v.z]; };
    const its = [];
    cs.forEach((c, n) => { for (const l of c.lines) its.push({ t: 'line', pts: G.chaikin(l, 2).map(toV), color, width: 0.8 + 0.25 * n, alpha: 0.35 + 0.6 * (n / Math.max(1, cs.length - 1)) }); });
    let maxGrid = grid;
    if (inScope) { maxGrid = grid.slice(); for (let k = 0; k < grid.length; k++) if (!inScope((k % f.NX) + 0.5, Math.floor(k / f.NX) + 0.5)) maxGrid[k] = NaN; }
    const maxima = G.localMaxima(f.NX, f.NY, maxGrid, { n: 3, minSep: 5 }).map((m) => { const v = api.toVenue(m.i + 0.5, m.j + 0.5); return { x: v.x, z: v.z, v: sign * m.v }; });
    const out = { items: its, levels: levels.map((x) => sign * x), maxima };
    contourCache.set(key, out);
    return out;
  }
  /** Measured 10 Hz "choosing at the shelf" seconds per 1.5 m cell → contours, optionally inside one department. */
  function chooseContours(scope = null) {
    const K = state.kin.K; if (!K || !kinMatches()) return null;
    const slice = kinSlice();
    const key = `k|choose|${slice}|${scope || ''}`;
    if (contourCache.has(key)) return contourCache.get(key);
    const rows = K.cells[slice] || K.cells.trading; const { cell_m: cell, origin_m: o } = K.grid;
    let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
    for (const r of rows) { i0 = Math.min(i0, r[0]); j0 = Math.min(j0, r[1]); i1 = Math.max(i1, r[0]); j1 = Math.max(j1, r[1]); }
    const NX = i1 - i0 + 3, NY = j1 - j0 + 3; // one empty cell of margin
    const vals = new Float32Array(NX * NY).fill(NaN);
    const C = KN.STATE.choose.k;
    for (const r of rows) vals[(r[1] - j0 + 1) * NX + (r[0] - i0 + 1)] = r[2 + C];
    const toV = (gx, gy) => [o.x + (gx + i0 - 1) * cell, o.y + (gy + j0 - 1) * cell];
    const inScope = scope ? (gx, gy) => { const v = toV(gx, gy); return G.inRings(v[0], v[1], deptGeom(scope)?.area); } : null;
    const grid = G.smoothSupported(NX, NY, (k) => vals[k], (k) => Number.isFinite(vals[k]), 1);
    const pool = [];
    for (let k = 0; k < grid.length; k++) { if (!Number.isFinite(grid[k])) continue; if (inScope && !inScope((k % NX) + 0.5, Math.floor(k / NX) + 0.5)) continue; pool.push(grid[k]); }
    const levels = G.levelsFor(pool, [0.35, 0.55, 0.72, 0.86, 0.95]);
    const cs = G.contours(NX, NY, grid, levels, { keep: inScope });
    const its = [];
    cs.forEach((c, n) => { for (const l of c.lines) its.push({ t: 'line', pts: G.chaikin(l, 2).map((p) => toV(p[0], p[1])), color: G.TOKENS.contour, width: 0.8 + 0.3 * n, alpha: 0.35 + 0.6 * (n / Math.max(1, cs.length - 1)) }); });
    const out = { items: its, levels, unit: 'person-s choosing per 1.5 m cell' };
    contourCache.set(key, out);
    return out;
  }

  function buildOverlay() {
    const view = state.vj.view, A = state.areas;
    const f = api.snapshot().field;
    const key = [fid(f), !!geo.fix, state.eng.iso, state.eng.flow, state.flowCell, state.kfocus, state.regFocus, state.flowSpot, state.kin.status, state.lens, state.econ.effort, JSON.stringify(state.econ.margins), state.econ.basketMargin, state.source, state.execLayer[state.lens], !!state.exec.report, state.layer[state.lens], state.slot, state.sel?.kind, state.sel?.id, !!view, !!A, state.radar.list.length, state.radar.stamp].join('|');
    if (key === overlayKey) return;
    overlayKey = key; paintKey = '';
    overlay.replaceChildren(); tags.replaceChildren(); shapes = []; pins = []; items = [];
    kpiStrip.hidden = true;
    if (!A || state.lens === 'compare') return;
    const L = state.lens, layer = state.layer[L];
    if (L === 'behaviour') { buildBehaviourOverlay(layer); return; }
    if (L === 'flow') { buildFlowOverlay(layer, f); return; }
    if (isExec()) { buildExecOverlay(L); return; }
    const ranked = VJ.rankDepartments(view, state.slot);
    const selDept = state.sel?.kind === 'dept' ? state.sel.id : null;
    const allDepts = (A.departments || []).map((d) => d.id);
    const hitDepts = (lens) => { for (const id of allDepts) { const s = deptShape(id); if (s) addHit(s.rings, () => { select({ kind: 'dept', id }); if (lens) setLens(lens); }, VJ.deptLabel(id)); } };

    if (L === 'pulse') {
      renderKpiStrip(view);
      const lead = (selDept && ranked.find((r) => r.id === selDept)) || ranked[0];
      if (layer === 'clean') for (const id of allDepts) items.push(...outlineOf(deptShape(id)?.rings, G.TOKENS.muted, { alpha: 0.9 }));
      if (layer === 'evidence') {
        items.push(...fieldContours('dwell', { ps: [0.6, 0.8, 0.92, 0.98] }).items.map((it) => ({ ...it, alpha: it.alpha * 0.55 })));
        for (const l of A.lanes || []) items.push(...outlineOf(laneShape(l.lane)?.queue, G.TOKENS.queue, { alpha: 0.6 }));
      }
      if (lead) {
        const s = deptShape(lead.id);
        items.push(...cageOf(s));
        if (layer === 'evidence') items.push(...frontageOf(s, 0.8));
      }
      hitDepts();
      ranked.slice(0, 3).forEach((r, i) => {
        // With the 3D twin, the selected department is labelled by its anchored card instead.
        if (api.twin && state.sel?.kind === 'dept' && state.sel.id === r.id) return;
        const g = deptGeom(r.id); if (!g?.label) return;
        callout(g.label[0], g.label[1], r.name, `${VJ.fmtDuration(r.area.value)} / entrant`, { tone: r.id === lead?.id ? 'sel' : '', lead: r.id === lead?.id, onclick: () => select({ kind: 'dept', id: r.id }) });
      });
      const qc = VJ.polygonCentre(A.lanes.flatMap((l) => l.queue));
      if (qc) callout(qc.x, qc.z, 'Checkouts', view ? `${VJ.fmtDuration(view.queue[state.slot]?.value)} queue / entrant` : null, { tone: 'coral', onclick: () => setLens('service') });
      return;
    }

    if (L === 'live') {
      if (selDept) items.push(...cageOf(deptShape(selDept)));
      hitDepts();
      return;
    }

    if (L === 'engagement') {
      const d = (selDept && ranked.find((r) => r.id === selDept)) || ranked[0] || null;
      for (const r of ranked) {
        if (d && r.id === d.id) continue;
        const s = deptShape(r.id); if (!s) continue;
        if (layer === 'choice') {
          // Line style carries the class, so it reads without colour: worked solid, intermediate dashed, crossed dotted.
          const dash = r.choice === 'worked' ? null : r.choice === 'mixed' ? [6, 4] : [1.5, 4];
          items.push(...outlineOf(s.rings, 'rgba(193,215,232,0.75)', { width: 1.2, dash }));
        } else items.push(...outlineOf(s.rings, G.TOKENS.muted));
      }
      if (d) {
        const s = deptShape(d.id);
        items.push(...cageOf(s));
        if (layer !== 'area') items.push(...frontageOf(s));
        if (state.eng.iso) {
          const c = chooseContours(d.id) || fieldContours('dwell', { scope: d.id });
          items.push(...c.items);
        }
        if (s?.label) {
          const v = layer === 'choice' ? (d.choiceShare == null ? '—' : num(d.choiceShare)) : layer === 'shelf' ? `${VJ.fmtDuration(d.banco?.value)} at the shelf` : `${VJ.fmtDuration(d.area.value)} in area`;
          callout(s.label[0], s.label[1], d.name, v, { tone: 'sel', lead: true });
        }
      }
      hitDepts();
      ranked.filter((r) => r.id !== d?.id).slice(0, 3).forEach((r) => {
        const g = deptGeom(r.id); if (!g?.label) return;
        const v = layer === 'choice' ? (r.choiceShare == null ? '—' : num(r.choiceShare)) : VJ.fmtDuration(layer === 'shelf' ? r.banco?.value : r.area.value);
        callout(g.label[0], g.label[1], r.name, v, { tone: 'quiet', onclick: () => select({ kind: 'dept', id: r.id }) });
      });
      return;
    }

    if (L === 'service' && layer === 'replay') {
      void loadReplay();
      const D = state.replay.data;
      for (const g of A.lanes || []) {
        const s = laneShape(g.lane); if (!s) continue;
        items.push(...outlineOf(s.service, G.TOKENS.service, { width: 1, dash: [4, 4], alpha: 0.45 }));
        items.push(...outlineOf(s.queue, G.TOKENS.queue, { width: 0.8, alpha: 0.28 }));
      }
      if (D) {
        // One pin per lane (or overlapping pair); closed lanes stay dim.
        for (const l of D.lanes) {
          const g = rpLaneOf(l); if (!g) continue;
          const b = rpBox(g.service) || rpBox(g.queue);
          const sel = state.sel?.kind === 'lane' && l.lanes.includes(state.sel.id);
          addPin(b.maxX + 0.9, (b.minZ + b.maxZ) / 2, h('button', { type: 'button', class: `hx-lane${sel ? ' on' : ''}${l.sessions ? '' : ' none'}`, onclick: () => select({ kind: 'lane', id: l.lanes[0] }), title: l.sessions ? `${l.label}: ${l.sessions} payments, median ${Math.round(l.median_s)} s` : `${l.label}: no payment this day` }, l.key.replace('-', '–')));
        }
        const ce = D.coverage_east_m || 67;
        items.push({ t: 'line', pts: [[ce, 12], [ce, 52]], color: '#E05A5A', width: 1.4, dash: [6, 5], alpha: 0.85, y: 0.05 });
        callout(ce, 13, 'Sensor coverage ends', 'nothing is seen east of here', { tone: 'coral' });
      }
      return;
    }

    if (L === 'service') {
      const lanes = view?.lanes.list || [];
      const sel = state.sel?.kind === 'lane' ? state.sel.id : lanes[0]?.lane;
      const maxV = Math.max(1e-6, ...lanes.map((l) => (layer === 'transit' ? l.transitPm : l.waitingPm)));
      for (const g of A.lanes) {
        const s = laneShape(g.lane); if (!s) continue;
        const l = lanes.find((x) => x.lane === g.lane);
        const v = l ? (layer === 'transit' ? l.transitPm : l.waitingPm) / maxV : 0;
        items.push(...outlineOf(s.service, G.TOKENS.service, { width: 1, dash: [4, 4], alpha: g.lane === sel ? 0.9 : 0.4 }));
        if (g.lane === sel) items.push(...(s.queue.map((r) => (r === s.main ? { t: 'cage', ring: r, corners: s.corners, height: 1.2, color: G.TOKENS.queue, width: 2, fill: 'rgba(229,142,146,0.07)' } : { t: 'ring', pts: r, color: G.TOKENS.queue, width: 1.6 }))));
        else items.push(...outlineOf(s.queue, G.TOKENS.queue, { width: 0.8 + 1.2 * v, alpha: l ? 0.35 + 0.45 * v : 0.2, dash: l ? null : [2, 4] }));
        addHit(s.queue, () => select({ kind: 'lane', id: g.lane }), `Lane ${g.lane}`);
        const c = VJ.polygonCentre(g.queue); if (!c) continue;
        addPin(c.x, c.z, h('button', { type: 'button', class: `hx-lane${g.lane === sel ? ' on' : ''}${l ? '' : ' none'}`, onclick: () => select({ kind: 'lane', id: g.lane }), title: l ? `${pct(l.share)} of the day’s waiting` : 'No reading for this lane' }, String(g.lane)));
      }
      return;
    }

    if (L === 'opportunities') {
      if (layer === 'radar') {
        state.radar.list.slice(0, 3).forEach((c, i) => {
          for (const p of c.polygons || []) items.push({ t: 'ring', pts: p, color: G.TOKENS.scenario, width: 1.4 });
          if (Number.isFinite(c.x)) callout(c.x, c.z, `${String.fromCharCode(65 + i)} · ${c.name}`, null, { tone: 'gold' });
        });
        return;
      }
      const list = valueItems();
      const sel = list.find((c) => state.sel && c.sel.kind === state.sel.kind && c.sel.id === state.sel.id) || list[0];
      list.slice(0, 6).forEach((c, i) => {
        const letter = String.fromCharCode(65 + i);
        const on = c === sel;
        if (on) {
          if (c.kind === 'dept') items.push(...cageOf(deptShape(c.id), G.TOKENS.scenario, { fill: 'rgba(194,168,127,0.06)' }));
          else { const s = laneShape(c.sel.id); items.push(...(s?.queue || []).map((r) => ({ t: 'cage', ring: r, corners: G.cornerIndices(r, 4), height: 1.2, color: G.TOKENS.scenario, width: 1.8 }))); }
        }
        if (c.rings) addHit(c.rings, () => select(c.sel), c.name);
        if (Number.isFinite(c.x)) addPin(c.x, c.z, h('button', { type: 'button', class: `hx-opp${on ? ' on' : ''}`, onclick: () => select(c.sel), title: c.name }, h('b', null, letter), on ? h('span', null, c.name) : null));
      });
    }
  }

  // ---- Flow Explorer: one picture per question
  function buildFlowOverlay(layer, f) {
    if (!f) return;
    const NX = f.NX, NY = f.NY, at = (i, j) => api.toVenue(i + 0.5, j + 0.5);
    const cellM = f.meta?.cell_m || 1.5;
    if (layer === 'dwell') {
      const c = fieldContours('dwell');
      items.push(...c.items);
      c.maxima.forEach((m, n) => callout(m.x, m.z, `Peak ${n + 1}`, `${Math.round(m.v)} s slow presence`, { tone: 'contour' }));
    } else if (layer === 'footfall') {
      // Answer one question: where is the floor busiest? Only the busiest quarter is drawn;
      // the top 10 % gets one closed outline and the five busiest spots are named.
      const A = activityField(f);
      for (const c of A.cells) items.push({ t: 'rect', x: c.x, z: c.z, s: cellM * (c.top ? 0.62 : 0.38), color: c.top ? 'rgba(87,187,208,0.85)' : 'rgba(87,187,208,0.42)' });
      for (const l of A.outline) items.push({ t: 'line', pts: l, color: '#9fe3f0', width: 1.6, alpha: 0.9 });
      A.peaks.forEach((pk, n) => callout(pk.x, pk.z, `${n + 1} · ${pk.place}`, `${Math.round(pk.v).toLocaleString('en-GB')} track keys`, { tone: n ? '' : 'sel', lead: !n }));
    } else if (layer === 'purity') {
      // Answer: which way do people go? One-way corridors become continuous arrowed lines;
      // busy two-way aisles get a quiet double tick; everything else stays clean.
      const D = directionField(f);
      for (const t of D.twoWay) items.push(
        { t: 'line', pts: [[t.x - t.dx * 0.65 - t.nx, t.z - t.dz * 0.65 - t.nz], [t.x + t.dx * 0.65 - t.nx, t.z + t.dz * 0.65 - t.nz]], color: G.TOKENS.contour, width: 1.5, alpha: 0.8 },
        { t: 'line', pts: [[t.x - t.dx * 0.65 + t.nx, t.z - t.dz * 0.65 + t.nz], [t.x + t.dx * 0.65 + t.nx, t.z + t.dz * 0.65 + t.nz]], color: G.TOKENS.contour, width: 1.5, alpha: 0.8 });
      for (const c of D.corridors) {
        const on = state.flowSpot === c.id;
        items.push({ t: 'line', pts: c.pts, color: on ? '#ffffff' : G.TOKENS.cyan, width: 1.6 + 2.4 * c.rel, alpha: 0.95 });
        for (const a of c.heads) items.push({ t: 'arrow', x: a.x, z: a.z, dx: a.dx, dz: a.dz, len: 1.1, color: on ? '#ffffff' : '#9fe3f0', alpha: 1, width: 1.8 + 1.2 * c.rel });
      }
      D.corridors.slice(0, 4).forEach((c) => addPin(c.mid.x, c.mid.z, h('button', { type: 'button', class: `hx-flowspot source${state.flowSpot === c.id ? ' on' : ''}`, title: `One-way · ${c.from} → ${c.to} · ${Math.round(c.len)} m`,
        onclick: () => { state.flowSpot = state.flowSpot === c.id ? null : c.id; render(); } }, h('b', null, c.label))));
      // Inspectable cells: busiest one-way and two-way cells, far apart.
      for (const c of D.probes) {
        const v = at(c.i, c.j), k = `${c.i},${c.j}`;
        addPin(v.x, v.z, h('button', { type: 'button', class: `hx-probe${state.flowCell === k ? ' on' : ''}`, title: `${c.kind} · purity ${num(c.p)}`, onclick: () => { state.flowCell = state.flowCell === k ? null : k; render(); } }, h('i')));
      }
      if (state.flowCell) { const [i, j] = state.flowCell.split(',').map(Number); const v = at(i, j); items.push({ t: 'ring', pts: [[v.x - cellM / 2, v.z - cellM / 2], [v.x + cellM / 2, v.z - cellM / 2], [v.x + cellM / 2, v.z + cellM / 2], [v.x - cellM / 2, v.z + cellM / 2]], color: G.TOKENS.selection, width: 1.6 }); }
    } else if (layer === 'convergence') {
      // Places, not broken lines: each sink / source is one closed outline (half its peak), with
      // inward arrows where people's net flow meets and outward arrows where it splits. A faint
      // net-flow arrow field underneath shows where the flow comes from.
      const C = convergenceField(f);
      for (const v of C.arrows) items.push({ t: 'arrow', x: v.x - v.dx * 0.4, z: v.z - v.dz * 0.4, dx: v.dx, dz: v.dz, len: 0.8, color: G.TOKENS.contour, alpha: 0.18 + 0.4 * v.m, width: 1 });
      for (const spot of [...C.sinks, ...C.sources]) {
        const col = spot.kind === 'sink' ? G.TOKENS.queue : G.TOKENS.cyan;
        for (const l of spot.outline) items.push({ t: 'line', pts: l, color: col, width: 1.5, alpha: 0.85 });
        const r = 1 + 1.4 * spot.rel, n = 6;
        for (let a = 0; a < n; a++) {
          const ang = (a / n) * Math.PI * 2 + 0.3, ux = Math.cos(ang), uz = Math.sin(ang);
          // sink: from the rim towards the centre; source: from near the centre outwards
          if (spot.kind === 'sink') items.push({ t: 'arrow', x: spot.x + ux * (r + 0.9), z: spot.z + uz * (r + 0.9), dx: -ux, dz: -uz, len: 0.8, color: col, alpha: 0.9, width: 1.4 });
          else items.push({ t: 'arrow', x: spot.x + ux * r, z: spot.z + uz * r, dx: ux, dz: uz, len: 0.8, color: col, alpha: 0.9, width: 1.4 });
        }
        addPin(spot.x, spot.z, h('button', { type: 'button', class: `hx-flowspot ${spot.kind}${state.flowSpot === spot.id ? ' on' : ''}`, title: `${spot.kind === 'sink' ? 'Streams meet' : 'Streams split'} · ${spot.place} · strength ${Math.round(spot.rel * 100)}`,
          onclick: () => { state.flowSpot = state.flowSpot === spot.id ? null : spot.id; api.flyTo(spot.x, spot.z, 16); render(); } }, h('b', null, spot.label)));
      }
    } else if (layer === 'regime') {
      // Answer one question: what is each part of the floor used for? Each path type is a flat
      // coloured patch of the cells it covers, with one outline; two-way aisles (the common case)
      // stay a quiet background. Nothing moves. The biggest places of the rare types are named.
      const R = regimeField(f), foc = state.regFocus;
      for (const T of REGIMES) {
        if (T.id === 0) continue;
        const dim = foc != null && foc !== T.id;
        if (dim && T.id === 4) continue;
        const a = dim ? 0.07 : (foc === T.id ? Math.min(0.85, T.fill * 1.5) : T.fill);
        for (const k of R.cells[T.id]) { const i = k % NX, j = (k - i) / NX, v = at(i, j); items.push({ t: 'rect', x: v.x, z: v.z, s: cellM * 0.92, color: T.color, alpha: a }); }
        if (dim || T.id === 4) continue;
        for (const ring of R.outlines[T.id]) items.push({ t: 'ring', pts: ring, color: T.color, width: foc === T.id ? 1.8 : 1.2, alpha: 0.9 });
      }
      for (const T of REGIMES) {
        if (!T.named || (foc != null && foc !== T.id)) continue;
        R.groups[T.id].filter((g) => g.n >= 3).slice(0, foc === T.id ? 5 : 2).forEach((g, n) => {
          if (T.id === 3 && g.dir) items.push({ t: 'arrow', x: g.x - g.dir[0] * 1.2, z: g.z - g.dir[1] * 1.2, dx: g.dir[0], dz: g.dir[1], len: 2.4, color: '#EEF2FF', alpha: 0.95, width: 2 });
          callout(g.x, g.z, `${T.short} · ${g.place}`, `${Math.round(g.n * cellM * cellM)} m²`, { tone: T.tone, onclick: () => api.flyTo(g.x, g.z, 18), side: n % 2 ? 'l' : 'r' });
        });
      }
    }
  }
  /** Department, lane or 'Aisle' at a venue point — names places in the Flow Explorer. */
  function placeOf(x, z) {
    const lane = state.areas?.lanes?.find((l) => G.inRings(x, z, l.queue) || G.inRings(x, z, l.service));
    if (lane) return `Lane ${lane.lane}`;
    const d = deptAt(x, z); if (d) return VJ.deptLabel(d);
    // Outside every mapped area: name the nearest department within 6 m.
    let best = null, bd = 6;
    for (const g of state.areas?.departments || []) { if (!g.label) continue; const dd = Math.hypot(g.label[0] - x, g.label[1] - z); if (dd < bd) { bd = dd; best = g.id; } }
    return best ? `Aisle by ${VJ.deptLabel(best)}` : 'Aisle';
  }
  /** Closed outline(s) of a cell mask: padded binary marching squares, so the loop always closes. */
  function maskOutline(f, inMask, smooth = 3) {
    const NX = f.NX, NY = f.NY, PX = NX + 2, PY = NY + 2, bin = new Float32Array(PX * PY);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) bin[(j + 1) * PX + i + 1] = inMask(i, j) ? 1 : 0;
    const lines = G.contours(PX, PY, bin, [0.5])[0]?.lines || [];
    return lines.filter((l) => l.length > 4).map((l) => G.chaikin(l, smooth).map(([x, y]) => { const v = api.toVenue(x - 1, y - 1); return [v.x, v.z]; }));
  }
  const cellAreaOf = (f) => (f.meta?.cell_m || 1.5) ** 2;
  const pctile = (vals, p) => { const v = vals.slice().sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0; };

  /** Path types (field.js regime ids): plain names, colours and how strongly each is painted. */
  const REGIMES = [
    { id: 2, name: 'Where people stop', short: 'Stop', tech: 'Dwell node', color: '#F3C778', fill: 0.5, named: true, tone: 'gold',
      rule: 'Slow presence in the top 5 % of the floor. Counters, shelves people study, queues.' },
    { id: 1, name: 'Walked through without stopping', short: 'Pass-through', tech: 'Through-route', color: '#57BBD0', fill: 0.42, named: true, tone: '',
      rule: 'At least 20 steps and almost no slow presence (bottom 30 %). People cross here on the way to somewhere else.' },
    { id: 3, name: 'Walked mostly one way', short: 'One-way', tech: 'One-way spine', color: '#A9B5EE', fill: 0.5, named: true, tone: 'sel',
      rule: 'At least 10 steps and more than 55 % of them in one direction. The arrow shows which way.' },
    { id: 4, name: 'Walked both ways', short: 'Two-way', tech: 'Two-way aisle', color: '#7CCBA7', fill: 0.16, named: false,
      rule: 'At least 10 steps, no direction above 25 %. The normal aisle: shown as a quiet background.' },
    { id: 0, name: 'Mixed or quiet', short: 'Mixed', tech: 'Mixed / quiet', color: '#516674', fill: 0, named: false,
      rule: 'Measured, but fits none of the above (too few steps, or in between).' },
  ];
  const regCache = new Map();
  function regimeField(f) {
    const key = fid(f);
    if (regCache.has(key)) return regCache.get(key);
    const NX = f.NX, NY = f.NY, N = NX * NY;
    const cells = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    for (let k = 0; k < N; k++) if (f.support[k] > 0) cells[f.regime[k] | 0]?.push(k);
    const outlines = {}, groups = {};
    for (const T of REGIMES) {
      const on = new Uint8Array(N); for (const k of cells[T.id]) on[k] = 1;
      outlines[T.id] = T.id === 0 || T.id === 4 ? [] : maskOutline(f, (i, j) => on[f.idx(i, j)] === 1, 1);
      // Connected places (8-neighbour), biggest first, named by department / aisle.
      const seen = new Uint8Array(N), out = [];
      for (const k0 of cells[T.id]) {
        if (seen[k0]) continue;
        const stack = [k0]; seen[k0] = 1; const comp = [];
        while (stack.length) {
          const k = stack.pop(); comp.push(k); const i = k % NX, j = (k - i) / NX;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= NX || jj >= NY) continue;
            const kk = jj * NX + ii; if (on[kk] && !seen[kk]) { seen[kk] = 1; stack.push(kk); }
          }
        }
        if (comp.length < 2) continue;
        let w = 0, x = 0, z = 0, dx = 0, dz = 0;
        for (const k of comp) { const i = k % NX, j = (k - i) / NX, v = api.toVenue(i + 0.5, j + 0.5), ww = Math.max(1, f.steps[k]); w += ww; x += v.x * ww; z += v.z * ww; dx += f.meanX[k] * ww; dz += f.meanY[k] * ww; }
        x /= w; z /= w;
        // field grid → venue direction (rotation-aware)
        const o = api.toVenue(0, 0), e = api.toVenue(1, 0), n = api.toVenue(0, 1);
        const vx = dx * (e.x - o.x) + dz * (n.x - o.x), vz = dx * (e.z - o.z) + dz * (n.z - o.z), L = Math.hypot(vx, vz);
        // Label at the cell nearest the weighted centre, so the pin sits on the patch.
        let best = comp[0], bd = Infinity;
        for (const k of comp) { const i = k % NX, j = (k - i) / NX, v = api.toVenue(i + 0.5, j + 0.5), d = Math.hypot(v.x - x, v.z - z); if (d < bd) { bd = d; best = k; } }
        const bi = best % NX, bv = api.toVenue(bi + 0.5, (best - bi) / NX + 0.5);
        out.push({ n: comp.length, x: bv.x, z: bv.z, place: placeOf(bv.x, bv.z), dir: L > 1e-6 ? [vx / L, vz / L] : null });
      }
      groups[T.id] = out.sort((a, b) => b.n - a.n);
    }
    const R = { cells, outlines, groups, sup: Object.values(cells).reduce((a, c) => a + c.length, 0) };
    regCache.set(key, R);
    return R;
  }
  function setRegFocus(id) { state.regFocus = state.regFocus === id ? null : id; render(); }

  /** Activity: busiest quarter of the measured floor, the top-10 % outline, five named peaks, concentration. */
  const actCache = new Map();
  function activityField(f) {
    const key = fid(f); if (actCache.has(key)) return actCache.get(key);
    const NX = f.NX, NY = f.NY, at = (i, j) => api.toVenue(i + 0.5, j + 0.5);
    const grid = G.smoothSupported(NX, NY, (k) => f.traffic[k], (k) => f.support[k] > 0, 1);
    const sup = []; for (let k = 0; k < NX * NY; k++) if (Number.isFinite(grid[k])) sup.push(grid[k]);
    const p75 = pctile(sup, 0.75), p90 = pctile(sup, 0.9);
    const cells = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const v = grid[j * NX + i]; if (v >= p75) { const c = at(i, j); cells.push({ x: c.x, z: c.z, top: v >= p90 }); } }
    const outline = maskOutline(f, (i, j) => grid[j * NX + i] >= p90, 2);
    const peaks = G.localMaxima(NX, NY, grid, { n: 5, minSep: 6 }).map((p) => { const c = at(p.i, p.j); return { x: c.x, z: c.z, v: f.traffic[f.idx(p.i, p.j)], place: placeOf(c.x, c.z) }; });
    // Concentration: share of all track keys carried by the busiest 10 % of measured cells.
    const raw = []; let tot = 0; for (let k = 0; k < NX * NY; k++) if (f.support[k] > 0) { raw.push(f.traffic[k]); tot += f.traffic[k]; }
    raw.sort((a, b) => b - a);
    const n10 = Math.max(1, Math.round(raw.length * 0.1));
    const top10 = tot ? raw.slice(0, n10).reduce((a, b) => a + b, 0) / tot : 0;
    const out = { cells, outline, peaks, top10, p75, p90, measured: raw.length };
    actCache.set(key, out); return out;
  }

  /** Direction: one-way corridors traced as streamlines, quiet ticks on busy two-way aisles. */
  const dirCache = new Map();
  function directionField(f) {
    const key = fid(f); if (dirCache.has(key)) return dirCache.get(key);
    const NX = f.NX, NY = f.NY, B = f.B, at = (i, j) => api.toVenue(i + 0.5, j + 0.5);
    const ok = (i, j) => i >= 0 && j >= 0 && i < NX && j < NY && f.support[f.idx(i, j)] > 0;
    const steps = []; for (let k = 0; k < NX * NY; k++) if (f.support[k] > 0) steps.push(f.steps[k]);
    const busy = pctile(steps, 0.6), seedMin = pctile(steps, 0.4);
    // Busy cells only: share of one-way vs two-way where people actually walk.
    let nBusy = 0, nOne = 0, nTwo = 0;
    for (let k = 0; k < NX * NY; k++) if (f.support[k] > 0 && f.steps[k] >= busy) { nBusy++; if (f.purity[k] >= 0.55) nOne++; else if (f.purity[k] <= 0.25) nTwo++; }
    const twoWay = [];
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      if ((i + j) % 2) continue;
      const k = f.idx(i, j); if (!(f.support[k] > 0) || f.steps[k] < busy || f.purity[k] > 0.25) continue;
      let axis = 0, best = -1; for (let b = 0; b < B / 2; b++) { const w = f.rose[k * B + b] + f.rose[k * B + b + B / 2]; if (w > best) { best = w; axis = b; } }
      const a = (axis / B) * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), c = at(i, j);
      twoWay.push({ x: c.x, z: c.z, dx, dz, nx: -dz * 0.2, nz: dx * 0.2 });
    }
    // Streamlines through one-way cells, strongest first; a cell feeds one line only.
    const used = new Uint8Array(NX * NY);
    const seeds = [];
    for (let k = 0; k < NX * NY; k++) if (f.support[k] > 0 && f.purity[k] >= 0.4 && f.steps[k] >= seedMin) seeds.push(k);
    seeds.sort((a, b) => f.steps[b] * f.purity[b] - f.steps[a] * f.purity[a]);
    const trace = (gx, gy, dir) => {
      const pts = []; let x = gx, y = gy, last = -1;
      for (let n = 0; n < 80; n++) {
        const i = Math.floor(x), j = Math.floor(y); if (!ok(i, j)) break;
        const k = f.idx(i, j); if (f.purity[k] < 0.3) break;
        // Half-cell steps often stay in the same cell; stop only when entering a cell another line owns.
        if (k !== last && n > 0 && used[k] === 2) break;
        last = k;
        pts.push([x, y]); used[k] = 2;
        const m = Math.hypot(f.meanX[k], f.meanY[k]) || 1;
        x += dir * 0.5 * f.meanX[k] / m; y += dir * 0.5 * f.meanY[k] / m;
      }
      return pts;
    };
    const lines = [];
    for (const k of seeds) {
      if (used[k]) continue;
      const i = k % NX, j = Math.floor(k / NX);
      const back = trace(i + 0.5, j + 0.5, -1).reverse(); used[k] = 0;
      const fwd = trace(i + 0.5, j + 0.5, 1);
      const pts = back.concat(fwd.slice(1));
      if (pts.length < 8) continue; // ≥ 4 cells ≈ 6 m
      let w = 0; for (const [x, y] of pts) w += f.steps[f.idx(Math.floor(x), Math.floor(y))];
      lines.push({ g: pts, w: w / pts.length, len: (pts.length - 1) * 0.5 * (f.meta?.cell_m || 1.5) });
      if (lines.length >= 12) break;
    }
    const wMax = Math.max(1e-6, ...lines.map((l) => l.w));
    const corridors = lines.sort((a, b) => b.w * b.len - a.w * a.len).map((l, n) => {
      const pts = G.chaikin(l.g, 2).map(([x, y]) => { const v = api.toVenue(x, y); return [v.x, v.z]; });
      const heads = []; let acc = 0;
      for (let q = 1; q < pts.length; q++) {
        const dx = pts[q][0] - pts[q - 1][0], dz = pts[q][1] - pts[q - 1][1], d = Math.hypot(dx, dz); acc += d;
        if (acc >= 4 || q === pts.length - 1) { heads.push({ x: pts[q][0] - dx / d * 0.6, z: pts[q][1] - dz / d * 0.6, dx: dx / d, dz: dz / d }); acc = 0; }
      }
      const a = pts[0], b = pts[pts.length - 1], mid = pts[Math.floor(pts.length / 2)];
      return { id: `dir${n}`, label: `D${n + 1}`, pts, heads, len: l.len, rel: l.w / wMax, from: placeOf(a[0], a[1]), to: placeOf(b[0], b[1]), mid: { x: mid[0], z: mid[1] } };
    });
    // Inspectable cells (busiest one-way and two-way, far apart).
    const cand = (pred) => { const out = []; const arr = []; for (let k = 0; k < NX * NY; k++) if (f.support[k] > 0 && pred(k)) arr.push(k);
      arr.sort((a, b) => f.steps[b] - f.steps[a]);
      for (const k of arr) { const i = k % NX, j = Math.floor(k / NX); if (out.every((o) => Math.hypot(o.i - i, o.j - j) > 6)) out.push({ i, j, k, p: f.purity[k], kind: f.purity[k] >= 0.55 ? 'one-way' : 'two-way' }); if (out.length >= 3) break; }
      return out; };
    const probes = [...cand((k) => f.purity[k] >= 0.55), ...cand((k) => f.purity[k] <= 0.25)];
    const out = { corridors, twoWay, probes, busyShare: { busy: nBusy, one: nOne / Math.max(1, nBusy), two: nTwo / Math.max(1, nBusy) } };
    dirCache.set(key, out); return out;
  }

  /**
   * Net-flow convergence, cached per field.
   * Net flow per cell F = accepted steps × mean heading (people-steps that do not cancel out).
   * Convergence = −div F with central differences, one-sided at the edge of coverage, nothing across
   * unmeasured floor; then a 2-pass smoothing over measured cells (≈ 3 m), so a junction reads as one place.
   * Two-way aisles cancel to ≈ 0 by construction: they are not sinks.
   */
  const convCache = new Map();
  function convergenceField(f) {
    const key = fid(f);
    if (convCache.has(key)) return convCache.get(key);
    const NX = f.NX, NY = f.NY, ok = (i, j) => i >= 0 && j >= 0 && i < NX && j < NY && f.support[f.idx(i, j)] > 0;
    const Fx = new Float32Array(NX * NY), Fy = new Float32Array(NX * NY);
    for (let k = 0; k < NX * NY; k++) { const w = f.support[k] > 0 ? f.steps[k] : 0; Fx[k] = w * f.meanX[k]; Fy[k] = w * f.meanY[k]; }
    const d1 = (arr, i, j, di, dj) => {
      const a = ok(i - di, j - dj), b = ok(i + di, j + dj);
      if (a && b) return (arr[f.idx(i + di, j + dj)] - arr[f.idx(i - di, j - dj)]) / 2;
      if (b) return arr[f.idx(i + di, j + dj)] - arr[f.idx(i, j)];
      if (a) return arr[f.idx(i, j)] - arr[f.idx(i - di, j - dj)];
      return 0;
    };
    const raw = new Float32Array(NX * NY).fill(NaN);
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) if (ok(i, j)) raw[f.idx(i, j)] = -(d1(Fx, i, j, 1, 0) + d1(Fy, i, j, 0, 1));
    const grid = G.smoothSupported(NX, NY, (k) => raw[k], (k) => Number.isFinite(raw[k]), 2);
    const at = (i, j) => api.toVenue(i + 0.5, j + 0.5);
    const spots = (sign, kind) => {
      const g = grid.map((v) => (Number.isFinite(v) ? sign * v : NaN));
      const peaks = G.localMaxima(NX, NY, g, { n: 5, minSep: 6 });
      const top = peaks[0]?.v || 0;
      return peaks.filter((p) => p.v >= 0.2 * top).map((p, n) => {
        // Region: cells connected to the peak at ≥ half its value → one closed outline.
        const inR = new Uint8Array(NX * NY), q = [[p.i, p.j]]; inR[p.j * NX + p.i] = 1; let cells = 0;
        while (q.length && cells < 400) {
          const [i, j] = q.pop(); cells++;
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di, jj = j + dj, kk = jj * NX + ii;
            if (ii < 0 || jj < 0 || ii >= NX || jj >= NY || inR[kk] || !(g[kk] >= 0.5 * p.v)) continue;
            inR[kk] = 1; q.push([ii, jj]);
          }
        }
        // Binary field padded by one cell, so marching squares always closes the loop.
        const PX = NX + 2, PY = NY + 2, bin = new Float32Array(PX * PY);
        for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) bin[(j + 1) * PX + i + 1] = inR[j * NX + i];
        const lines = G.contours(PX, PY, bin, [0.5])[0]?.lines || [];
        const outline = lines.map((l) => G.chaikin(l, 3).map(([x, y]) => { const v = api.toVenue(x - 1, y - 1); return [v.x, v.z]; }));
        const c = at(p.i, p.j);
        return { id: `${kind}${n}`, kind, label: `${kind === 'sink' ? 'M' : 'S'}${n + 1}`, x: c.x, z: c.z, v: p.v, rel: top ? p.v / top : 0, cells, outline, place: placeOf(c.x, c.z) };
      });
    };
    const sinks = spots(1, 'sink'), sources = spots(-1, 'source');
    // Context: net-flow arrows on every other measured cell with enough net flow.
    const mags = []; for (let k = 0; k < NX * NY; k++) if (f.support[k] > 0) mags.push(Math.hypot(Fx[k], Fy[k]));
    mags.sort((a, b) => a - b);
    const lo = mags[Math.floor(mags.length * 0.4)] || 0, hi = mags[Math.floor(mags.length * 0.97)] || 1;
    const arrows = [];
    for (let j = 0; j < NY; j += 2) for (let i = (j / 2) % 2; i < NX; i += 2) {
      const k = f.idx(i, j); if (!(f.support[k] > 0)) continue;
      const m = Math.hypot(Fx[k], Fy[k]); if (m < lo) continue;
      const c = at(i, j); arrows.push({ x: c.x, z: c.z, dx: Fx[k] / m, dz: Fy[k] / m, m: Math.min(1, (m - lo) / Math.max(1e-6, hi - lo)) });
    }
    const out = { sinks, sources, arrows };
    convCache.set(key, out);
    return out;
  }
  const circle = (x, z, r, n = 14) => Array.from({ length: n }, (_, i) => [x + r * Math.cos((i / n) * Math.PI * 2), z + r * Math.sin((i / n) * Math.PI * 2)]);

  function renderKpiStrip(v) {
    if (!v || state.lens !== 'pulse' || isExec()) { kpiStrip.hidden = true; return; }
    const sl = state.slot;
    kpiStrip.replaceChildren(
      ...[['Entrants', kpiValue(v.entrances[sl], VJ.fmtInt)], ['Time in store', kpiValue(v.visit[sl])], ['Queue / entrant', kpiValue(v.queue[sl])], ['People in store', kpiValue(v.peopleMean[sl], (x) => num(x, 0))]]
        .map(([k, val]) => h('div', null, h('b', null, val), h('small', null, k))),
      h('p', null, `Visitor Journey · ${VJ.fmtSlot(sl)} · ${VJ.fmtDay(v.day)}`));
    kpiStrip.hidden = false;
  }

  function buildBehaviourOverlay(layer) {
    const K = state.kin.K; if (!K || !kinMatches()) return;
    const slot = state.slot;
    const fps = KN.departments(K, slot).filter((f) => deptGeom(f.dept)?.label);
    const selId = state.sel?.kind === 'dept' ? state.sel.id : null;
    if (layer === 'fingerprint') {
      // Department floor tinted by its signature state: the state it does more than the store does.
      for (const f of fps) {
        const st = KN.STATE[f.signature] || KN.STATE[f.dominant];
        addShape(deptGeom(f.dept).area, `dept kin${selId === f.dept ? ' sel' : ''}`, () => select({ kind: 'dept', id: f.dept }), `--k:${st.color};--a:${(0.10 + 0.22 * Math.min(1, (f.lift[f.signature] || 1) / 2.5)).toFixed(3)}`);
      }
    } else if (selId) addShape(deptGeom(selId)?.area, 'dept kin sel', null, `--k:${KN.STATES[0].color};--a:0`);
    if (layer !== 'hotspots') {
      for (const f of fps) {
        const g = deptGeom(f.dept);
        const big = layer === 'fingerprint' || selId === f.dept;
        const st = KN.STATE[f.signature] || KN.STATE[f.dominant];
        addPin(g.label[0], g.label[1], h('button', { type: 'button', class: `hx-donut${big ? '' : ' mini'}${selId === f.dept ? ' on' : ''}`, onclick: () => select({ kind: 'dept', id: f.dept }), title: `${VJ.deptLabel(f.dept)} · ${KN.STATES.map((x) => `${x.it} ${pct(f.share[x.id])}`).join(' · ')}` },
          h('span', { class: 'ring', html: donutSvg(f.share, big ? 50 : 30) }),
          big ? h('span', { class: 'cap' }, h('b', null, (f.dept === VJ.PACKAGED ? 'PACKAGED' : VJ.deptLabel(f.dept)).toUpperCase()), h('small', { style: `color:${st.color}` }, `${st.it} ×${num(f.lift[st.id] || 1, 1)}`)) : null));
      }
    }
    const spots = KN.hotspots(K, kinSlice(), { n: layer === 'hotspots' ? 6 : 3 });
    spots.forEach((p, n) => {
      const d = deptAt(p.x, p.z);
      addPin(p.x, p.z, h('button', { type: 'button', class: `hx-hot${layer === 'hotspots' ? '' : ' quiet'}`, title: `Hesitation ×${num(p.lift, 1)} the store rate`, onclick: () => { if (d) select({ kind: 'dept', id: d }); else api.flyTo(p.x, p.z, 14); } },
        h('i'), layer === 'hotspots' ? h('span', null, h('b', null, `${n + 1}`), ` ${d ? VJ.deptLabel(d) : 'Aisle'} · ×${num(p.lift, 1)}`) : null));
    });
  }


  // Executive report: same geometry grammar on the report's own mapped ROIs.
  const execRing = (a) => a.polygons.map((p) => p.map(([x, z]) => [x, z]));
  function buildExecOverlay(L) {
    if (!state.exec.report) return;
    if (L === 'service') {
      const ranked = execRanked('queue', 'avgWaitSec');
      const max = Math.max(1, ...ranked.map((a) => a.row.avgWaitSec));
      for (const a of execAreas().filter((x) => x.kind === 'queue')) {
        const r = ranked.find((x) => x.key === a.key);
        const on = state.sel?.id === a.key;
        if (on) items.push(...execRing(a).map((p) => ({ t: 'cage', ring: p, corners: G.cornerIndices(p, 4), height: 1.2, color: G.TOKENS.queue, width: 2 })));
        else items.push(...execRing(a).map((p) => ({ t: 'ring', pts: p, color: G.TOKENS.queue, width: r ? 0.8 + 1.2 * r.row.avgWaitSec / max : 0.8, alpha: r ? 0.4 + 0.4 * r.row.avgWaitSec / max : 0.2, dash: r ? null : [2, 4] })));
        addHit(a.polygons.map((p) => ({ outer: p })), () => execSelect(a), a.name);
      }
      (state.sel ? ranked.filter((a) => a.key === state.sel.id) : ranked.slice(0, 3)).forEach((a) => callout(a.x, a.z, a.name, `${Math.round(a.row.avgWaitSec)} s avg wait`, { tone: 'coral', lead: state.sel?.id === a.key, onclick: () => execSelect(a) }));
      return;
    }
    const key = L === 'engagement' ? state.execLayer.engagement : 'stoppingPct';
    const ranked = execRanked('department', key);
    const max = Math.max(1e-9, ...ranked.map((a) => a.row[key]));
    for (const a of execAreas().filter((x) => x.kind === 'department')) {
      const r = ranked.find((x) => x.key === a.key);
      const on = state.sel?.id === a.key;
      if (on) items.push(...execRing(a).map((p, n) => (n === 0 ? { t: 'cage', ring: p, corners: G.cornerIndices(p, 5), height: 2.2, color: G.TOKENS.selection, width: 1.8 } : { t: 'ring', pts: p, color: G.TOKENS.selection, width: 1.4 })));
      else items.push(...execRing(a).map((p) => ({ t: 'ring', pts: p, color: r ? 'rgba(193,215,232,1)' : G.TOKENS.muted, width: r ? 0.8 + 0.8 * r.row[key] / max : 0.8, alpha: r ? 0.3 + 0.5 * r.row[key] / max : 0.6 })));
      addHit(a.polygons.map((p) => ({ outer: p })), () => { execSelect(a); }, a.name);
    }
    (state.sel ? ranked.filter((a) => a.key === state.sel.id) : ranked.slice(0, 3)).forEach((a) => callout(a.x, a.z, a.name, EXEC_FMT[key](a.row[key]), { tone: state.sel?.id === a.key ? 'sel' : '', lead: state.sel?.id === a.key, onclick: () => { execSelect(a); if (L === 'pulse') setLens('engagement'); } }));
    if (L === 'pulse') {
      const q = execRanked('queue', 'avgWaitSec')[0];
      if (q) callout(q.x, q.z, q.name, `${Math.round(q.row.avgWaitSec)} s avg wait`, { tone: 'coral', onclick: () => { execSelect(q); setLens('service'); } });
    }
  }

  api.onFrame(() => {
    buildOverlay();
    const r = view.getBoundingClientRect();
    if(api.twin && state.sel && !anchorCard.hidden) {
      const b=api.twin.bounds;
      const p=b && api.project3D(b.maxX,api.twin.state.mode==='top'?.15:2.8,b.z);
      anchorCard.style.visibility=p?'':'hidden';
      anchorLeader.style.visibility=p?'':'hidden';
      if(p){
        const lane=api.twin.state.selection?.businessKind==='queue';
        const cw=anchorCard.offsetWidth, ch=anchorCard.offsetHeight; // read before any write (no layout thrash)
        const x=lane?18:Math.max(12,Math.min(r.width-cw-16,p.sx+28));
        const y=Math.max(98,Math.min(r.height-ch-80,p.sy-ch-28));
        anchorCard.style.transform=`translate(${x}px,${y}px)`;
        anchorLeader.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);
        for(const [k,v] of Object.entries({x1:p.sx,y1:p.sy,x2:x+12,y2:y+ch}))leaderLine.setAttribute(k,String(v));
      }
    }
    const P = api.projector();
    const rp = rpOn() && state.replay.data;
    const PK = rp ? `${P.key}|rp${state.replay.k}` : P.key;
    if (PK === paintKey) {
      // Camera at rest: resolve callout overlaps once (DOM measuring every moving frame made orbiting stutter).
      if (collidePending) { collidePending = false; resolveCollisions(); }
      return;
    }
    paintKey = PK;
    collidePending = true;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(P.w * dpr), H = Math.round(P.h * dpr);
    if (paintCanvas.width !== W || paintCanvas.height !== H) { paintCanvas.width = W; paintCanvas.height = H; }
    const ctx = paintCanvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    if (items.length) G.paint(ctx, P, items, dpr);
    if (rp) G.paint(ctx, P, replayDyn(), dpr);
    overlay.setAttribute('viewBox', `0 0 ${P.w} ${P.h}`);
    for (const s of shapes) {
      let ok = true;
      const pts = s.pts.map(([x, z]) => { const p = P.at(x, 0.3, z); if (!p) ok = false; return p ? `${p[0].toFixed(1)},${p[1].toFixed(1)}` : ''; });
      s.poly.setAttribute('points', ok ? pts.join(' ') : '');
    }
    for (const p of pins) {
      const s = P.at(p.x, 0.3, p.z);
      p.el.hidden = !s || s[0] < -40 || s[1] < -40 || s[0] > P.w + 40 || s[1] > P.h + 40;
      if (s) p.el.style.transform = `translate(${s[0].toFixed(1)}px, ${s[1].toFixed(1)}px)`;
    }
  });
  let collidePending = false;
  function resolveCollisions() {
    // Callouts never sit under the floating controls or on top of each other: the first pin
    // (highest priority) wins, a later one that collides is hidden until the camera moves.
    const pad = 4, hit = (a, b) => a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
    const blocks = [kpiStrip, legend, layerSeg, bar].filter((el) => el && !el.hidden && el.offsetParent).map((el) => el.getBoundingClientRect());
    const placed = [];
    // The Behaviour lens keeps its own ring layout untouched.
    for (const p of state.lens === 'behaviour' ? [] : pins) {
      if (p.el.hidden) continue;
      // Union of the anchor and its label: callout labels are offset children of the anchor.
      const r = [p.el, ...p.el.querySelectorAll('*')].map((el) => el.getBoundingClientRect()).filter((b) => b.width || b.height)
        .reduce((u, b) => ({ left: Math.min(u.left, b.left), right: Math.max(u.right, b.right), top: Math.min(u.top, b.top), bottom: Math.max(u.bottom, b.bottom) }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
      if (blocks.some((b) => hit(r, b)) || placed.some((b) => hit(r, b))) { p.el.hidden = true; continue; }
      placed.push(r);
    }
  }

  // Mouse and trackpad: the twin canvas owns rotate / pan / zoom. Wheel or pinch over a callout,
  // card or outline is handed to the canvas instead of scrolling or zooming the whole page.
  stage.addEventListener('wheel', (e) => {
    const canvas = view.querySelector('canvas');
    if (!canvas || e.target === canvas || e.target.closest?.('.hx-compare, .hx-anchor-card select')) return;
    e.preventDefault();
    canvas.dispatchEvent(new WheelEvent('wheel', e));
  }, { passive: false });


  // ------------------------------------------------------------------ opportunities: value at stake
  function valueItems() {
    const view = state.vj.view; if (!view || !state.areas) return [];
    // Value is a per-day scenario, so it always uses the whole trading day (08–20).
    // For a week or month the scenario stays per day: the average day of the period (entrants ÷ days).
    const nDays = view.period?.days?.length || 1;
    const dayView = nDays > 1 ? { ...view, entrances: { ...view.entrances, [VJ.DAY]: { ...view.entrances[VJ.DAY], value: view.entrances[VJ.DAY]?.value / nDays } } } : view;
    return VAS.valueAtStake(dayView, VJ.DAY, state.econ, kinMatches() ? state.kin.K : null).map((it) => {
      const rings = it.kind === 'dept' ? deptGeom(it.id)?.area : laneGeom(it.sel.id)?.queue;
      const g = it.kind === 'dept' ? deptGeom(it.id) : null;
      const c = g?.label ? { x: g.label[0], z: g.label[1] } : VJ.polygonCentre(rings);
      return { ...it, rings, x: c?.x, z: c?.z };
    });
  }
  const eur = (x) => `€${Math.round(x).toLocaleString('en-GB')}`;
  function reviewCandidates() {
    const view = state.vj.view; if (!view || !state.areas) return [];
    const out = [];
    const { over } = VJ.queuePeak(view);
    if (over && view.lanes.list[0]) {
      const l = view.lanes.list[0]; const c = VJ.polygonCentre(laneGeom(l.lane)?.queue);
      out.push({ kind: 'queue', name: `Lane ${l.lane} · ${VJ.fmtSlot(over.slot)}`, sel: { kind: 'lane', id: l.lane }, rings: laneGeom(l.lane)?.queue, x: c?.x, z: c?.z,
        why: [`Queue wait ${VJ.fmtDuration(over.value)} per customer at ${VJ.fmtSlot(over.slot)}, above the 1-minute line.`, `Lane ${l.lane} carries ${pct(l.share)} of the day’s waiting time.`],
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
      state.radar.stamp = new Date().toLocaleTimeString('en-GB');
      state.radar.note = list.length ? 'Fresh, observed, mapped findings only.' : 'No fresh observed finding passed the evidence checks. Demo entries are excluded.';
    } catch (e) { state.radar.list = []; state.radar.note = e.message; }
    finally { state.radar.busy = false; render(); }
  }

  // ------------------------------------------------------------------ compare (2D, matched)
  let layoutPolys = null;
  function compareWindows() {
    const hasSlots = VJ.SLOTS.every((sl) => api.hasSlice(SLOT_TO_SLICE[sl]));
    return hasSlots
      ? VJ.SLOTS.map((sl) => ({ slice: SLOT_TO_SLICE[sl], slot: sl, label: sl.replace('-', '–') }))
      : [['morning', '07–11'], ['midday', '11–15'], ['afternoon', '15–19'], ['evening', '19–22']].map(([slice, label]) => ({ slice, slot: null, label }));
  }
  const sharesOf = (pack, key) => {
    const m = new Map(); let sum = 0;
    for (const c of pack?.cells || []) { const v = Number(c[key] || 0); sum += v; m.set(`${c.i},${c.j}`, v); }
    for (const [k, v] of m) m.set(k, sum ? v / sum : 0);
    return m;
  };
  function setActive(i) {
    const W = compareWindows();
    state.compare.active = ((i % W.length) + W.length) % W.length;
    if (state.lens === 'compare' && state.layer.compare === 'day') void renderCompare();
    renderInspector();
    renderStageControls();
  }
  function togglePlay(on = !state.compare.playing) {
    state.compare.playing = on;
    clearInterval(state.compare.timer);
    if (on) state.compare.timer = setInterval(() => { if (state.lens !== 'compare' || state.layer.compare !== 'day') return togglePlay(false); setActive(state.compare.active + 1); }, 1800);
    renderStageControls();
  }

  async function renderCompare() {
    compareBox.hidden = state.lens !== 'compare';
    if (state.lens !== 'compare') { if (state.compare.playing) togglePlay(false); return; }
    const C = state.compare;
    const mode = state.layer.compare;
    const kin = C.metric === 'k' && kinMatches();
    const key = C.metric === 'd' ? 'd' : 't';
    const kinCells = (slice) => (kin ? KN.dominantCells(state.kin.K, slice) : null);
    layoutPolys ||= await fetch('./layout_prod.json').then((r) => r.json()).then((j) => j.polys).catch(() => []);
    const load = async (slice) => (C.packs[slice] ||= await api.sliceField(slice).catch(() => null));
    const f = api.snapshot().field;
    const metricName = kin ? 'movement state' : key === 'd' ? 'slow presence' : 'movement';
    compareBox.replaceChildren();
    if (mode === 'day') {
      const W = compareWindows();
      const packs = await Promise.all(W.map((w) => load(w.slice)));
      const shares = packs.map((p) => sharesOf(p, key));
      let max = 1e-9;
      for (const m of shares) for (const v of m.values()) max = Math.max(max, v);
      const v = state.vj.view;
      // One large map for the active slot, the six slots as a filmstrip underneath (same scale for all).
      const act = Math.min(C.active, W.length - 1), w0 = W[act];
      const big = h('canvas', { width: 1100, height: 1100, role: 'img', 'aria-label': `Store ${w0.label}` });
      const kc0 = kinCells(w0.slice);
      const main = h('figure', { class: 'hx-cmp-main' },
        h('figcaption', null, h('small', null, 'SLOT'), h('b', null, w0.label),
          w0.slot && v ? h('small', null, `${VJ.fmtInt(v.entrances?.[w0.slot]?.value)} entrants · ${VJ.fmtDuration(v.queue?.[w0.slot]?.value)} queue / entrant`) : null),
        big);
      const strip = h('div', { class: `hx-cmp-strip n${W.length}` });
      W.forEach((w, k) => {
        const canvas = h('canvas', { width: 300, height: 300, role: 'img', 'aria-label': `Store ${w.label}` });
        const kc = kinCells(w.slice);
        strip.append(h('button', { type: 'button', class: k === act ? 'active' : '', 'aria-pressed': String(k === act), onclick: () => { togglePlay(false); setActive(k); } }, canvas, h('span', null, w.label),
          (kin ? !kc?.length : !packs[k]) ? h('em', null, 'no data') : null));
        drawCompare(canvas, f, kin ? kc : shares[k], max, null, kin ? 'kin' : key === 'd' ? 'dwell' : 'activity', { labels: false, thin: true });
      });
      drawCompare(big, f, kin ? kc0 : shares[act], max, null, kin ? 'kin' : key === 'd' ? 'dwell' : 'activity');
      if (kin ? !kc0?.length : !packs[act]) main.append(h('p', { class: 'hx-cmp-warn' }, 'No data for this slot'));
      compareBox.append(h('div', { class: 'hx-cmp-day' }, main, strip), h('p', { class: 'hx-cmp-note' }, kin
        ? 'Each cell takes the colour of the movement state people spent most time in there, measured on the raw 10 Hz tracks of that slot. Brighter = more person-time.'
        : `Same floor, same ${f.meta.cell_m} m grid and one colour scale for every slot. Brighter = a bigger share of that slot’s ${metricName}. This is movement, not sales. Press play to walk the day.`));
      return;
    }
    const W = compareWindows();
    const names = Object.fromEntries([...W.map((w) => [w.slice, w.label]), ['morning', '07–11'], ['evening', '19–22'], ['midday', '11–15'], ['afternoon', '15–19']]);
    const okWin = (k) => W.some((w) => w.slice === k) && (!kin || !!state.kin.K?.cells?.[k]);
    if (!okWin(C.a)) C.a = W[0].slice;
    if (!okWin(C.b)) C.b = W[W.length - 1].slice;
    const [pa, pb] = await Promise.all([load(C.a), load(C.b)]);
    const A = sharesOf(pa, key), B = sharesOf(pb, key);
    let max = 1e-9;
    for (const m of [A, B]) for (const x of m.values()) max = Math.max(max, x);
    const boxes = mode === 'diff' ? [['Difference', `${names[C.b]} minus ${names[C.a]}`, null]] : [['Window A', names[C.a], A], ['Window B', names[C.b], B]];
    const wrap = h('div', { class: `hx-cmp-grid n${boxes.length}` });
    for (const [title, sub, data] of boxes) {
      const canvas = h('canvas', { width: 900, height: 900, role: 'img', 'aria-label': `${title} ${sub}` });
      wrap.append(h('figure', null, h('figcaption', null, h('small', null, title.toUpperCase()), h('b', null, sub)), canvas));
      if (kin) {
        const ka = kinCells(C.a), kb = kinCells(C.b);
        const d = mode === 'diff' ? (kb || []).map((c) => { const o = (ka || []).find((x) => x.i === c.i && x.j === c.j); return { ...c, weight: o && o.k !== c.k ? c.weight : 0 }; }) : (data === A ? ka : kb);
        drawCompare(canvas, f, d || [], 1, null, 'kin');
      } else drawCompare(canvas, f, data, max, mode === 'diff' ? { A, B } : null, key === 'd' ? 'dwell' : 'activity', { other: data === A ? B : data === B ? A : null });
    }
    compareBox.append(wrap, h('p', { class: 'hx-cmp-note' }, kin ? (mode === 'diff' ? `Only cells whose main movement state changed, coloured by the state in ${names[C.b]}.` : 'Each cell takes the colour of its main movement state in that window (raw 10 Hz). Brighter = more person-time.') : mode === 'diff'
      ? `Cyan: ${names[C.b]} takes a bigger share of ${metricName} there. Coral: ${names[C.a]} does. A shift in share is a redistribution, not a sales result.`
      : `Same floor, same grid, same colour scale: each window’s share of ${metricName}. Gold squares: clearly more of it in this window than in the other (at least 1.5×). The list on the right names where it moved.`));
    if (!pa || !pb) compareBox.append(h('p', { class: 'hx-cmp-warn' }, 'One window could not be loaded. Nothing is compared.'));
    renderInspector(); // the change lists need both packs, which have just loaded
  }

  function drawCompare(canvas, f, data, max, diff, metric, opts = {}) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height, pad = 30;
    const bx = [4.5, 72], bz = [2.5, 74.5];
    const s = Math.min((W - 2 * pad) / (bx[1] - bx[0]), (H - 2 * pad) / (bz[1] - bz[0]));
    const X = (x) => pad + (x - bx[0]) * s, Z = (z) => pad + (z - bz[0]) * s;
    ctx.fillStyle = '#050B12'; ctx.fillRect(0, 0, W, H);
    const cell = f.meta.cell_m;
    if (metric === 'kin') {
      const kc = state.kin.K.grid.cell_m;
      for (const c of data || []) {
        if (!(c.weight > 0)) continue;
        const col = KN.STATES[c.k].rgb.map((x) => Math.round(x * 255)).join(',');
        ctx.fillStyle = `rgba(${col},${(0.12 + 0.85 * Math.sqrt(c.weight)).toFixed(3)})`;
        ctx.fillRect(X(c.x - kc / 2), Z(c.z - kc / 2), kc * s + 0.6, kc * s + 0.6);
      }
    }
    const cells = metric === 'kin' ? new Set() : new Set([...(diff ? [...diff.A.keys(), ...diff.B.keys()] : data.keys())]);
    for (const k of cells) {
      const [i, j] = k.split(',').map(Number);
      const p = api.toVenue(i - f.i0 + 0.5, j - f.j0 + 0.5);
      let fill;
      if (diff) {
        const d = (diff.B.get(k) || 0) - (diff.A.get(k) || 0);
        const t = Math.min(1, Math.abs(d) / (max * 0.35));
        fill = d >= 0 ? `rgba(87,187,208,${0.08 + 0.8 * t})` : `rgba(229,142,146,${0.08 + 0.8 * t})`;
      } else {
        const t = Math.sqrt((data.get(k) || 0) / max);
        fill = metric === 'dwell' ? `rgba(193,215,232,${0.05 + 0.9 * t})` : `rgba(87,187,208,${0.05 + 0.9 * t})`;
      }
      ctx.fillStyle = fill;
      ctx.fillRect(X(p.x - cell / 2), Z(p.z - cell / 2), cell * s + 0.6, cell * s + 0.6);
      if (opts.other && !diff) {
        const a = data.get(k) || 0, b = opts.other.get(k) || 0;
        if (a >= max * 0.12 && a >= 1.5 * b) {
          ctx.strokeStyle = 'rgba(243,199,120,.95)'; ctx.lineWidth = 2;
          ctx.strokeRect(X(p.x - cell / 2) + 1.5, Z(p.z - cell / 2) + 1.5, cell * s - 3, cell * s - 3);
        }
      }
    }
    ctx.strokeStyle = 'rgba(160,190,210,.28)'; ctx.lineWidth = 1;
    for (const poly of layoutPolys || []) {
      ctx.beginPath(); poly.forEach(([x, z], n) => (n ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z)))); ctx.closePath(); ctx.stroke();
    }
    ctx.font = '600 15px Inter, system-ui, sans-serif'; ctx.fillStyle = 'rgba(238,248,255,.75)';
    if (opts.labels !== false) for (const d of (state.areas?.departments || []).filter((d) => d.area_m2 > 60 && d.id !== VJ.PACKAGED)) ctx.fillText(VJ.deptLabel(d.id).toUpperCase(), X(d.label[0]) - 24, Z(d.label[1]));
  }

  // ------------------------------------------------------------------ inspector
  function card(cls, ...kids) { return h('section', { class: `hx-card ${cls || ''}` }, ...kids); }
  function hero(label, value, note, cls = '') { return h('div', { class: `hx-hero ${cls}` }, h('small', null, label), h('strong', null, value), note ? h('p', null, note) : null); }
  function stat(label, value, note, src) { return h('div', { class: 'hx-stat' }, h('small', null, label, src || ''), h('b', null, value), note ? h('span', null, note) : null); }
  function method(text) { return text ? h('p', { class: 'hx-method ops-only' }, text) : null; }
  function bars(rows, fmt, opts = {}) {
    const max = Math.max(1e-9, ...rows.map((r) => r.value || 0));
    return h('div', { class: 'hx-bars' }, ...rows.map((r) => h('button', { type: 'button', class: `hx-barrow${r.on ? ' on' : ''}`, onclick: r.onclick, disabled: !r.onclick },
      h('span', null, r.label), h('b', null, fmt(r.value)), h('i', { style: `--w:${((r.value || 0) / max * 100).toFixed(1)}%;${r.color || opts.color ? `--c:${r.color || opts.color}` : ''}` }, r.split != null ? h('em', { style: `--s:${(r.split * 100).toFixed(1)}%` }) : null))));
  }
  function slotChart(series, { line = null, second = null, fmt = VJ.fmtDuration } = {}) {
    const vals = VJ.SLOTS.map((sl) => series[sl]?.value);
    const vals2 = second ? VJ.SLOTS.map((sl) => second[sl]?.value) : [];
    const max = Math.max(line || 0, ...vals.filter(Number.isFinite), ...vals2.filter(Number.isFinite), 1e-9);
    const el = h('div', { class: 'hx-slots-chart' });
    if (line) el.append(h('i', { class: 'hx-line', style: `--y:${(line / max * 100).toFixed(1)}` }, h('small', null, '1 min')));
    VJ.SLOTS.forEach((sl, k) => {
      const v = vals[k], v2 = vals2[k];
      el.append(h('button', { type: 'button', class: `hx-col${state.slot === sl ? ' on' : ''}${line && v > line ? ' over' : ''}`, onclick: () => setSlot(sl), title: `${sl}: ${fmt(v)}` },
        h('i', { style: `--h:${v == null ? 0 : (v / max * 100).toFixed(1)}%` }), second ? h('i', { class: 'b', style: `--h:${v2 == null ? 0 : (v2 / max * 100).toFixed(1)}%` }) : null, h('small', null, sl.slice(0, 2) + 'h')));
    });
    return el;
  }
  function unavailable(msg) { return card('hx-empty', h('b', null, 'Visitor Journey unavailable'), h('p', null, msg), h('p', null, 'No number is shown in its place. The floor below is movement context only.')); }

  // ---- v3 inspector skeleton: pinned head (lens · place · source · lead number), then evidence.
  function srcBadge(text, title = '', tone = 'kpi') { return h('span', { class: `hx-srcb ${tone}`, title }, h('i'), text); }
  function ihead(kicker, title, { badge = null, lead = null, sub = null } = {}) {
    return h('section', { class: 'hx-ihead' }, h('div', { class: 'hx-kicker' }, kicker), h('h2', null, title), badge, sub ? h('p', { class: 'hx-lead' }, sub) : null, lead);
  }
  function leadKpi(label, value, note, tone = '') { return h('div', { class: `hx-leadkpi ${tone}` }, h('small', null, label), h('strong', null, value), note ? h('p', null, note) : null); }
  function reading(text) { return text ? h('p', { class: 'hx-reading' }, text) : null; }
  function evidence(...kids) { return h('details', { class: 'hx-ev' }, h('summary', null, 'Evidence & method'), ...kids.filter(Boolean)); }
  function action(label, sub, onclick) { return h('button', { type: 'button', class: 'hx-cta', onclick }, h('div', null, h('b', null, label), sub ? h('p', null, sub) : null), h('i', { html: ICONS.arrow })); }
  const vjBadge = (v, sl = state.slot) => srcBadge(`Visitor Journey · ${VJ.fmtSlot(sl)} · ${VJ.fmtDay(v.day)}`, `${state.vj.note}. daily_kpi contract, 08–20, 2-hour slots.`);

  function inspectPulse(v) {
    const ranked = VJ.rankDepartments(v, state.slot);
    const lead = (state.sel?.kind === 'dept' && ranked.find((r) => r.id === state.sel.id)) || ranked[0];
    const { peak, over } = VJ.queuePeak(v);
    const comp = VJ.visitComposition(v, state.slot);
    const signals = h('div', { class: 'hx-signals' });
    if (lead) signals.append(h('button', { type: 'button', class: 'hx-signal violet', onclick: () => { select({ kind: 'dept', id: lead.id }); setLens('engagement'); } },
      h('i', { html: ICONS.up }), h('div', null, h('small', null, `DEPARTMENT · ${VJ.fmtSlot(state.slot)}`), h('b', null, `${lead.name} · ${VJ.fmtDuration(lead.area.value)} per entrant`), h('p', null, `${state.sel ? 'Selected department' : 'Most time per entrant of any department'}; ${VJ.fmtDuration(lead.banco?.value)} of it at the shelf.`))));
    const qs = over || peak;
    if (qs) {
      const elsewhere = qs.slot !== state.slot;
      signals.append(h('div', { class: `hx-signal ${over ? 'coral' : 'green'}` },
        h('i', { html: over ? ICONS.alert : ICONS.cart }), h('div', null, h('small', null, `CHECKOUTS · ${VJ.fmtSlot(qs.slot)}${elsewhere ? ' (not the slot on screen)' : ''}`), h('b', null, `${VJ.fmtDuration(qs.value)} queue per entrant`),
          h('p', null, over ? 'Above the 1-minute line in that slot.' : 'Busiest queue slot of the day, within the 1-minute line.'),
          h('span', { class: 'hx-sig-acts' }, elsewhere ? h('button', { type: 'button', class: 'hx-link', onclick: () => setSlot(qs.slot) }, `Go to ${VJ.fmtSlot(qs.slot)}`) : null, h('button', { type: 'button', class: 'hx-link', onclick: () => setLens('service') }, 'Open Service')))));
    }
    const hs = kinMatches() ? KN.hotspots(state.kin.K, kinSlice(), { n: 1 })[0] : null;
    if (hs) {
      const d = deptAt(hs.x, hs.z);
      signals.append(h('button', { type: 'button', class: 'hx-signal pink', onclick: () => { state.layer.behaviour = 'hotspots'; if (d) select({ kind: 'dept', id: d }); setLens('behaviour'); } },
        h('i', { html: ICONS.motion }), h('div', null, h('small', null, `MOVEMENT · ${VJ.fmtSlot(state.slot)} · 10 Hz`), h('b', null, `Hesitation ×${num(hs.lift, 1)} · ${d ? VJ.deptLabel(d) : 'aisle'}`),
          h('p', null, 'People turn back or circle there more than anywhere else in the store.'))));
    }
    const out = [ihead('01 · STORE PULSE', 'Where attention concentrates', { badge: vjBadge(v) }), signals];
    if (comp) {
      const segs = comp.segments.filter((s) => s.minutes > 0);
      out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'How the visit is spent'), h('small', null, `${VJ.fmtDuration(comp.visit)} per entrant`)),
        h('div', { class: 'hx-comp' }, ...segs.map((s) => h('i', { class: s.id, style: `flex:${s.minutes}`, title: `${s.label} ${VJ.fmtDuration(s.minutes)}` }))),
        h('div', { class: 'hx-comp-k' }, ...segs.map((s) => h('span', { class: s.id }, `${s.label} ${VJ.fmtDuration(s.minutes)}`)))));
    }
    out.push(lead ? action(`Inspect ${lead.name}`, 'Same twin, focused on the department: area, shelf edge, measured isolines.', () => { select({ kind: 'dept', id: lead.id }); setLens('engagement'); }) : null,
      evidence(h('p', null, 'Numbers on the canvas and here: Visitor Journey (daily_kpi), the selected 2-hour slot, per entrant. Streams: the aggregated 8-direction movement field for the same slot, not individual shoppers.'),
        h('div', { class: 'hx-grid2' }, stat('Entrants', kpiValue(v.entrances[state.slot], VJ.fmtInt), null, srcTag(v.entrances[state.slot])), stat('Time in store', kpiValue(v.visit[state.slot]), 'per entrant', srcTag(v.visit[state.slot]))),
        method(v.visit[state.slot]?.method)));
    return out;
  }

  const FLOW_COPY = {
    movement: ['Movement', 'Where people walked. Two-way aisles keep both directions as separate streams.'],
    dwell: ['Where motion slows', 'Thin contour lines over the cells the sensors measured. Nothing is drawn on floor without coverage.'],
    footfall: ['Where the floor is busiest', 'Only the busiest quarter of the floor is drawn, with the top 10 % outlined and the five busiest spots named.'],
    purity: ['Which way people walk', 'Arrowed lines: stretches walked one way. Quiet double ticks: busy aisles walked both ways.'],
    convergence: ['Where flows meet or split', 'Coral places (M): more people’s net flow comes in than goes out — tills, counters, busy junctions. Cyan places (S): the flow spreads out — entrances, aisle ends.'],
    regime: ['How the floor is used', 'Each measured 1.5 m cell is painted by what people do there: stop, pass through, walk one way or both ways. Shares are of floor, not of customers.'],
  };
  function fieldStats(f) {
    let sup = 0; const reg = [0, 0, 0, 0, 0]; let one = 0, two = 0;
    for (let k = 0; k < f.NX * f.NY; k++) {
      if (!(f.support[k] > 0)) continue; sup++; reg[f.regime[k] | 0]++;
      if (f.steps[k] >= 10) { if (f.purity[k] >= 0.55) one++; else if (f.purity[k] <= 0.25) two++; }
    }
    return { sup, reg, one, two };
  }
  function roseSvg(f, k) {
    const B = f.B, vals = Array.from({ length: B }, (_, b) => f.rose[k * B + b]);
    const max = Math.max(1e-9, ...vals);
    const petals = vals.map((v, b) => {
      // grid heading b·45° (x right, z down in the plan) → SVG angle
      const a = (b / B) * Math.PI * 2, r = 8 + 38 * v / max, w = Math.PI / B * 0.8;
      const p = (ang, rr) => `${(50 + rr * Math.cos(ang)).toFixed(1)},${(50 + rr * Math.sin(ang)).toFixed(1)}`;
      return `<path d="M50,50 L${p(a - w, r)} A${r},${r} 0 0 1 ${p(a + w, r)} Z" fill="rgba(87,187,208,${(0.25 + 0.6 * v / max).toFixed(2)})" stroke="#57BBD0" stroke-width=".6"/>`;
    }).join('');
    return `<svg viewBox="0 0 100 100" width="132" height="132" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="none" stroke="rgba(193,215,232,.18)"/><circle cx="50" cy="50" r="24" fill="none" stroke="rgba(193,215,232,.12)"/>${petals}</svg>`;
  }
  function inspectFlow() {
    const i = info(), layer = state.layer.flow, f = api.snapshot().field;
    const [title, lead] = FLOW_COPY[layer] || FLOW_COPY.movement;
    const badge = srcBadge(`Flow field · ${i.sliceLabel}${i.date || i.localDate ? ` · ${VJ.fmtDay(i.date || i.localDate)}` : ''}${i.live ? '' : ' · bundled pack'}`, 'track_positions aggregated on 1.5 m cells, 8-direction rose. Not shopper counts, not Visitor Journey KPIs.', 'flow');
    const out = [ihead('02 · FLOW EXPLORER', title, { badge, sub: lead })];
    const st = f ? fieldStats(f) : null;
    const pctOf = (n) => (st?.sup ? pct(n / st.sup) : '—');
    if (layer === 'movement' && st) out.push(card('', h('div', { class: 'hx-grid2' }, stat('Measured cells', st.sup.toLocaleString('en-GB'), `${num(st.sup * 2.25 / 1000, 1)}k m² of floor`), stat('Two-way cells', pctOf(st.two), 'busy cells, both directions'))),
      h('p', { class: 'hx-note' }, 'Streams are samples of the direction distribution in each cell. They show where movement goes, never a single customer’s route.'));
    if (layer === 'dwell') {
      const c = fieldContours('dwell');
      out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Contour levels'), h('small', null, 'slow presence · s per 1.5 m cell')),
        h('div', { class: 'hx-levels' }, ...c.levels.map((l, n) => h('span', { style: `--o:${(0.35 + 0.6 * n / Math.max(1, c.levels.length - 1)).toFixed(2)}` }, h('i'), `${Math.round(l)} s`))),
        h('p', { class: 'hx-note' }, 'Levels are the 50th–98th percentiles of the measured cells in this window. Peaks marked on the floor are the three strongest local maxima.')),
        h('p', { class: 'hx-note' }, 'Slow presence is time below 0.25 m/s in the cell. It is not the audited minutes per entrant (Engagement) nor the Executive report’s median dwell.'));
    }
    if (layer === 'footfall' && f) {
      const A = activityField(f);
      out.push(leadKpi('BUSIEST 10 % OF THE FLOOR', pct(A.top10), `of all activity happens on one tenth of the measured floor (outlined on the map).`, 'cyan'),
        card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Busiest spots'), h('small', null, 'track keys per 1.5 m cell')),
          bars(A.peaks.map((pk, n) => ({ label: `${n + 1} · ${pk.place}`, value: pk.v, onclick: () => api.flyTo(pk.x, pk.z, 16) })), (x) => Math.round(x).toLocaleString('en-GB'), { color: 'var(--cyan)' })),
        h('p', { class: 'hx-note' }, 'Only the busiest quarter of the floor is drawn: big squares are the top 10 %, small ones the next 15 %. A track key is a sensor id, not a person: someone who loses their id counts twice, so this is activity, not shoppers.'));
    }
    if (layer === 'purity' && f) {
      const k = state.flowCell ? (() => { const [a, b] = state.flowCell.split(',').map(Number); return f.idx(a, b); })() : null;
      const D = directionField(f);
      out.push(leadKpi('BUSY FLOOR THAT IS TWO-WAY', pct(D.busyShare.two), `People walk both ways in most busy aisles. Only ${pct(D.busyShare.one)} of the busy floor is clearly one-way; the arrowed lines follow the stretches where one direction wins.`, 'contour'),
        card('', h('div', { class: 'hx-card-h' }, h('b', null, 'One-way stretches'), h('small', null, 'strongest first')),
          D.corridors.length ? bars(D.corridors.slice(0, 6).map((c) => ({ label: `${c.label} · ${c.from} → ${c.to}`, value: c.len, on: state.flowSpot === c.id, onclick: () => { state.flowSpot = c.id; api.flyTo(c.mid.x, c.mid.z, 18); render(); } })), (x) => `${Math.round(x)} m`, { color: 'var(--cyan)' })
            : h('p', { class: 'hx-note' }, 'No clear one-way stretch in this window: the store is walked both ways.')));
      if (k != null) out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Selected aisle cell'), h('small', null, `purity ${num(f.purity[k])}`)),
        h('div', { class: 'hx-rose', html: roseSvg(f, k) }), h('p', { class: 'hx-note' }, f.purity[k] >= 0.55 ? 'Mostly one direction: a spine or an entrance flow.' : f.purity[k] <= 0.25 ? 'Both directions share this aisle.' : 'Mixed directions.')));
      else out.push(h('p', { class: 'hx-note' }, 'Double ticks = busy aisles walked both ways. Click a round marker on the floor to read the full 8-direction rose of that aisle: two opposite streams are kept apart, never averaged into one arrow.'));
    }
    if (layer === 'convergence' && f) {
      const C = convergenceField(f);
      const list = (arr, color, title, sub) => card('', h('div', { class: 'hx-card-h' }, h('b', null, title), h('small', null, sub)),
        arr.length ? bars(arr.map((sp) => ({ label: `${sp.label} · ${sp.place}`, value: sp.rel, on: state.flowSpot === sp.id, onclick: () => { state.flowSpot = sp.id; api.flyTo(sp.x, sp.z, 16); render(); } })), (x) => String(Math.round(x * 100)), { color })
          : h('p', { class: 'hx-note' }, 'No clear place in this window.'));
      out.push(list(C.sinks, 'var(--coral)', 'Where streams meet', 'strength, strongest = 100'),
        list(C.sources, 'var(--cyan)', 'Where streams split', 'strength, strongest = 100'),
        h('p', { class: 'hx-note' }, 'Built from the net flow in each 1.5 m cell: walking steps times their average direction. Where more net flow enters than leaves, streams meet (tills, counters, a busy junction); where more leaves, they split (the entrance, the end of an aisle). Two-way aisles cancel out, so they never show as a meeting point. This is the shape of the flow, not a queue or a sale.'));
    }
    if (layer === 'regime' && f) {
      const R = regimeField(f), foc = state.regFocus;
      out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'How the floor is used'), h('small', null, 'share of measured floor · tap to isolate')),
        bars(REGIMES.map((T) => ({ label: T.name, value: R.sup ? R.cells[T.id].length / R.sup : 0, color: T.color, on: foc === T.id, onclick: () => setRegFocus(T.id) })), (x) => pct(x))));
      const T = REGIMES.find((r) => r.id === foc);
      if (T) {
        out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, T.name), h('small', null, T.tech)), h('p', { class: 'hx-note' }, T.rule),
          T.named ? bars(R.groups[T.id].slice(0, 6).map((g) => ({ label: g.place, value: g.n * cellAreaOf(f), onclick: () => api.flyTo(g.x, g.z, 18) })), (x) => `${Math.round(x)} m²`, { color: T.color }) : null));
      } else {
        out.push(h('p', { class: 'hx-note' }, 'Most of the floor is two-way aisle (quiet green). The coloured patches are the exceptions worth a look: where people stop (gold), cross without stopping (cyan) and walk one way (lilac). Tap a row to see only that type and where it is.'));
      }
    }
    out.push(evidence(h('dl', { class: 'hx-dl' },
      h('dt', null, 'Window'), h('dd', null, i.live ? `${i.sliceLabel} · ${VJ.fmtDay(i.date)}` : `Bundled pack · ${i.sliceLabel}`),
      h('dt', null, 'Cell'), h('dd', null, `${i.cell || 1.5} m`), h('dt', null, 'Mask'), h('dd', null, 'measured cells only'),
      h('dt', null, 'Heading model'), h('dd', null, '8-bin rose, κ 2.8')),
      h('button', { type: 'button', class: 'hx-ghost wide', onclick: () => toggleLab(true) }, 'Open Lab · rendering controls')));
    return out;
  }

  function readingFor(f) {
    // One plain sentence: what this area does most above the store, and what it does least.
    const top = KN.STATES.filter((st) => f.share[st.id] >= 0.03 && f.lift[st.id] != null).sort((a, b) => f.lift[b.id] - f.lift[a.id]);
    const hi = top[0], lo = top[top.length - 1];
    if (!hi) return '';
    const name = f.dept === VJ.PACKAGED ? 'the packaged aisles' : f.dept === 'Corsie' ? 'the aisles outside the departments' : VJ.deptLabel(f.dept);
    const verb = {
      choose: 'people stop at the shelf and choose', wait: 'people wait to be served', pause: 'people stand in the aisle, away from the shelves',
      hesitate: 'people turn back or circle', browse: 'people move slowly and look around', transit: 'people walk straight through',
    };
    const lessVerb = { choose: 'stop at the shelf', wait: 'wait', pause: 'stand in the aisle', hesitate: 'hesitate', browse: 'browse', transit: 'walk straight through' };
    const less = lo && lo !== hi && f.lift[lo.id] < 0.8 ? `, and ${lessVerb[lo.id]} less (×${num(f.lift[lo.id], 1)})` : '';
    return `In ${name} ${verb[hi.id]} ${num(f.lift[hi.id], 1)}× as often as in the store overall${less}.`;
  }

  function inspectBehaviour(v) {
    const K = state.kin.K;
    const head = [h('div', { class: 'hx-kicker' }, 'BEHAVIOURAL FINGERPRINT · MEASURED')];
    if (!K) return [...head, h('h2', null, 'How people move'), state.kin.status === 'loading' ? card('', h('p', null, 'Loading movement states…')) : card('hx-empty', h('b', null, 'Movement states unavailable'), h('p', null, state.kin.note), h('p', null, 'No state is guessed in its place.'))];
    if (!kinMatches()) return [...head, h('h2', null, 'How people move'), card('hx-empty', h('b', null, `Measured for ${VJ.fmtDay(kinDay())} only`), h('p', null, `The movement states come from the raw 10 Hz tracks of ${VJ.fmtDay(kinDay())}. The day on screen is ${VJ.fmtDay(v?.day)}, so nothing is drawn for it.`), h('p', null, 'Pick that day, or run the nightly job for this one.'))];
    const slot = state.slot;
    const store = KN.shares(KN.mixOf(K, null, slot));
    const fps = KN.departments(K, slot);
    const selF = state.sel?.kind === 'dept' ? KN.fingerprint(K, state.sel.id, slot) : null;
    const out = [...head, h('h2', null, selF ? VJ.deptLabel(selF.dept) : 'How people move'),
      h('p', { class: 'hx-lead' }, selF ? readingFor(selF) : `Every 5 seconds of every track, ${VJ.fmtSlot(slot)}, read as one of six movement states. The streams on the floor take the colour of the state measured where they pass.`)];
    const base = selF ? selF.share : store;
    const legendRows = h('div', { class: 'hx-states' }, ...KN.STATES.map((st, k) => h('button', { type: 'button', class: `hx-state${state.kfocus === k ? ' on' : ''}`, style: `--c:${st.color}`, onclick: () => setFocus(k), title: st.note },
      h('i'), h('span', null, h('b', null, st.it), h('small', null, st.en)), h('em', null, pct(base?.[st.id], 0)),
      selF ? h('small', { class: `lift${selF.lift[st.id] >= 1.25 ? ' up' : selF.lift[st.id] <= 0.8 ? ' down' : ''}` }, selF.lift[st.id] == null ? '' : `×${num(selF.lift[st.id], 1)}`) : null)));
    if (selF) {
      out.push(card('kin', h('div', { class: 'hx-card-h' }, h('b', null, 'Fingerprint vs store'), h('small', null, `${Math.round(selF.personMin).toLocaleString('en-GB')} person-min`)),
        h('div', { class: 'hx-fp' }, h('span', { class: 'ring', html: donutSvg(selF.share, 92) }),
          h('div', null, h('small', null, 'This area'), mixBar(selF.share), h('small', null, 'Whole store'), mixBar(selF.store, { thin: true }))),
        legendRows,
        h('div', { class: 'hx-grid3' },
          stat('U-turns', selF.uturnsPerMin == null ? '—' : num(selF.uturnsPerMin, 2), 'U-turns per minute'),
          stat('Speed', selF.speed == null ? '—' : `${num(selF.speed, 2)} m/s`, 'mean, all states'),
          stat('Signature', KN.STATE[selF.signature]?.it || '—', `×${num(selF.lift[selF.signature] || 1, 1)} vs store`))));
      const ser = Object.fromEntries(VJ.SLOTS.map((sl) => [sl, KN.shares(KN.mixOf(K, selF.dept, sl))]));
      out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Through the day'), h('small', null, 'share of time per state')), slotStack(ser)));
      const vjRow = v ? VJ.rankDepartments(v, slot, { includePackaged: true }).find((r) => r.id === selF.dept) : null;
      if (vjRow) out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Audited minutes'), h('small', null, 'Visitor Journey')),
        h('div', { class: 'hx-grid2' }, stat('Time in area', VJ.fmtDuration(vjRow.area.value), `per entrant · ${VJ.fmtSlot(slot)}`), stat('At the shelf', kpiValue(vjRow.banco), `choice index ${num(vjRow.choiceShare)}`)),
        h('button', { type: 'button', class: 'hx-ghost wide', onclick: () => setLens('engagement') }, 'Open in Engagement')));
    } else {
      out.push(card('kin', h('div', { class: 'hx-card-h' }, h('b', null, 'Store mix'), h('small', null, `${VJ.fmtSlot(slot)} · person-time`)), mixBar(store), legendRows,
        h('p', { class: 'hx-note' }, 'Click a state to isolate it on the floor; click it again to see all six.')));
      const ser = Object.fromEntries(VJ.SLOTS.map((sl) => [sl, KN.shares(KN.mixOf(K, null, sl))]));
      out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Through the day'), h('small', null, 'store, share of time')), slotStack(ser)));
    }
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Departments'), h('small', null, 'signature state · vs store')),
      h('div', { class: 'hx-fplist' }, ...fps.map((f) => h('button', { type: 'button', class: `hx-fprow${selF?.dept === f.dept ? ' on' : ''}`, onclick: () => select({ kind: 'dept', id: f.dept }, { fly: true }) },
        h('span', null, VJ.deptLabel(f.dept)), mixBar(f.share, { thin: true }),
        h('small', { style: `color:${KN.STATE[f.signature].color}` }, `${KN.STATE[f.signature].it} ×${num(f.lift[f.signature], 1)}`))))));
    const spots = KN.hotspots(K, kinSlice(), { n: 6 });
    if (spots.length) out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Hesitation spots'), h('small', null, 'turn back or circle')),
      bars(spots.map((p, n) => { const d = deptAt(p.x, p.z); return { label: `${n + 1} · ${d ? VJ.deptLabel(d) : 'Aisle'}`, value: p.lift, onclick: () => { state.layer.behaviour = 'hotspots'; applyTint(); render(); api.flyTo(p.x, p.z, 16); } }; }), (x) => `×${num(x, 1)}`, { color: KN.STATE.hesitate.color }),
      h('p', { class: 'hx-note' }, 'Times the store’s hesitation rate, in 1,5 m cells with at least 10 person-minutes. Hesitating is not bad by itself: it can be choice, a missing product or poor signage. Check on the floor.')));
    const modes = v?.behaviour;
    if (modes?.share) {
      out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Visit modes'), h('small', null, 'journey clusters · estimated')),
        h('div', { class: 'hx-mix' }, ...VJ.BEHAVIOUR_MODES.map((b) => h('i', { style: `flex:${(modes.share[b.id] || 0).toFixed(4)};background:${b.color}`, title: `${b.id} ${pct(modes.share[b.id])}` }))),
        h('div', { class: 'hx-comp-k' }, ...VJ.BEHAVIOUR_MODES.filter((b) => modes.share[b.id] > 0.01).map((b) => h('span', { style: `--c:${b.color}` }, `${b.en} ${pct(modes.share[b.id])}`))),
        h('p', { class: 'hx-note' }, 'A second, coarser reading: journey segments of 20 s or more grouped into seven modes (Visitor Journey, nightly).')));
    }
    const val = K.validation;
    out.push(card('kin-val', h('div', { class: 'hx-card-h' }, h('b', null, 'Checked against the audited numbers'), h('small', null, VJ.fmtDay(K.day))),
      h('div', { class: 'hx-grid2' },
        stat('Choosing + waiting vs at the shelf', `r ${num(val.choose_vs_al_banco_r, 3)}`, 'per department'),
        stat('Waiting vs queue waiting', `r ${num(val.wait_vs_queue_waiting_r, 3)}`, 'per lane')),
      h('p', { class: 'hx-note' }, `${Math.round(K.person_hours).toLocaleString('en-GB')} person-hours in ${K.windows.toLocaleString('en-GB')} windows of 5 s. Units are person-time, not shoppers. Audited minutes and queue times stay on Engagement and Service.`),
      method(K.method)));
    return out;
  }
  function slotStack(ser) {
    const el = h('div', { class: 'hx-slots-chart stack' });
    for (const sl of VJ.SLOTS) {
      const sh = ser[sl];
      el.append(h('button', { type: 'button', class: `hx-col${state.slot === sl ? ' on' : ''}`, onclick: () => setSlot(sl), title: sh ? KN.STATES.map((st) => `${st.it} ${pct(sh[st.id])}`).join(' · ') : 'no data' },
        h('span', { class: 'stk' }, ...KN.STATES.map((st) => h('i', { style: `flex:${(sh?.[st.id] || 0).toFixed(4)};background:${st.color}` }))), h('small', null, sl.slice(0, 2) + 'h')));
    }
    return el;
  }

  function inspectEngagement(v) {
    const ranked = VJ.rankDepartments(v, state.slot);
    const d = (state.sel?.kind === 'dept' && ranked.find((r) => r.id === state.sel.id)) || ranked[0];
    const layer = state.layer.engagement;
    if (!d) return [ihead('04 · ENGAGEMENT', 'No department reading', { badge: vjBadge(v) }), card('', h('p', null, 'Visitor Journey has no department minutes for this slot.'))];
    const g = deptGeom(d.id);
    const metricOf = (r) => (layer === 'shelf' ? r.banco?.value : layer === 'choice' ? r.choiceShare : r.area.value);
    const fmtM = layer === 'choice' ? (x) => num(x) : VJ.fmtDuration;
    const lead = layer === 'shelf'
      ? leadKpi('AT THE SHELF · PER ENTRANT', kpiValue(d.banco), `Within 1 m of the shelf face, slower than 0.4 m/s · ${VJ.fmtSlot(state.slot)}.`, 'violet')
      : layer === 'choice'
        ? leadKpi('CHOICE INDEX', d.choiceShare == null ? '—' : num(d.choiceShare), `${VJ.CHOICE_LABEL[d.choice]} · time at the shelf ÷ time in area. Under 0.25 crossed, 0.40 or more worked.`, 'violet')
        : leadKpi('TIME IN AREA · PER ENTRANT', kpiValue(d.area), `Floor within 3 m of the department’s fixtures · ${VJ.fmtSlot(state.slot)}.`, 'violet');
    const out = [ihead(`04 · ENGAGEMENT · ${d.name.toUpperCase()}`, d.name, { badge: vjBadge(v), lead })];
    const second = [
      layer !== 'area' ? stat('Time in area', kpiValue(d.area), 'per entrant') : null,
      layer !== 'shelf' ? stat('At the shelf', kpiValue(d.banco), 'per entrant') : null,
      layer !== 'choice' ? stat('Choice index', d.choiceShare == null ? '—' : num(d.choiceShare), VJ.CHOICE_LABEL[d.choice]) : null,
      stat('Measured area', g ? `${Math.round(g.area_m2)} m²` : '—', 'within 3 m'),
    ].filter(Boolean);
    out.push(card('', h('div', { class: 'hx-grid3' }, ...second.slice(0, 3))));
    const shelfShare = d.choiceShare;
    out.push(reading(layer === 'choice'
      ? `${d.name}: ${shelfShare == null ? 'no shelf reading' : `${pct(shelfShare)} of the time in the area is spent at the shelf`}, so the department is ${VJ.CHOICE_LABEL[d.choice]}.`
      : layer === 'shelf'
        ? `Each entrant spends ${VJ.fmtDuration(d.banco?.value)} at ${d.name}'s shelf face in ${VJ.fmtSlot(state.slot)}. The white line on the floor is that face; the dashed band is the 1 m zone measured.`
        : `Each entrant spends ${VJ.fmtDuration(d.area.value)} in ${d.name}'s area in ${VJ.fmtSlot(state.slot)}, ${VJ.fmtDuration(d.banco?.value)} of it at the shelf.`));
    const ratio = Object.fromEntries(VJ.SLOTS.map((sl) => { const a = v.area[d.id]?.[sl]?.value, b = v.banco[d.id]?.[sl]?.value; return [sl, { value: a > 0 && b != null ? b / a : null }]; }));
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Through the day'), h('small', null, layer === 'choice' ? 'choice index' : 'per entrant')),
      layer === 'choice' ? slotChart(ratio, { fmt: (x) => num(x) }) : slotChart(v.area[d.id], { second: v.banco[d.id] }),
      layer === 'choice' ? null : h('div', { class: 'hx-comp-k' }, h('span', { class: 'fresh' }, 'time in area'), h('span', { class: 'banco' }, 'at the shelf'))));
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'All departments'), h('small', null, { area: 'time in area', shelf: 'at the shelf', choice: 'choice index' }[layer])),
      bars(ranked.slice().sort((a, b) => (metricOf(b) || 0) - (metricOf(a) || 0)).map((r) => ({ label: r.name, value: metricOf(r), on: r.id === d.id, onclick: () => select({ kind: 'dept', id: r.id }) })), fmtM, { color: 'var(--sel)' })));
    const mf = kinMatches() ? KN.fingerprint(state.kin.K, d.id, state.slot) : null;
    if (mf) out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'How people move here'), h('small', null, 'measured · 10 Hz')), mixBar(mf.share), h('p', { class: 'hx-note' }, readingFor(mf)),
      h('button', { type: 'button', class: 'hx-ghost wide', onclick: () => setLens('behaviour') }, 'Open the fingerprint')));
    const nx = VJ.nextDepartments(v, d.id);
    if (nx?.list.length) out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Next department'), h('small', null, `${nx.total.toLocaleString('en-GB')} hops · whole day`)),
      bars(nx.list.slice(0, 3).map((x) => ({ label: VJ.deptLabel(x.id), value: x.share, onclick: () => select({ kind: 'dept', id: x.id }) })), (x) => pct(x), { color: 'var(--contour)' }),
      h('p', { class: 'hx-note' }, `Share of the adjacent hops leaving ${d.name} on reconstructed journeys that passed the reconstruction check${v.reconRecall?.value != null ? ` (recall ${pct(v.reconRecall.value)}, so some hops are missed)` : ''}. Whole day; not available per slot.`)));
    const iso = kinMatches() ? 'measured 10 Hz choosing at the shelf, person-seconds per 1.5 m cell' : 'flow-field slow presence, seconds per 1.5 m cell';
    out.push(evidence(
      h('p', null, `Isolines inside ${d.name}: ${iso}. Levels are percentiles inside the department; lines stop where the sensors did not see.`),
      h('p', null, 'Source safety: these are Visitor Journey minutes per entrant. They are not the Executive report’s median category dwell or stopping percentage.'),
      method(v.area[d.id]?.[state.slot]?.method)));
    return out;
  }

  // ---- Service · minute by minute: right now, the peak hour, lane by lane, how long people pay
  const rpUi = { lead: null, rows: [], win: [0, 0] };
  function inspectReplay(v) {
    const R = state.replay, D = R.data;
    if (R.status !== 'ready' || !D) {
      return [ihead('05 · CHECKOUT SERVICE', 'The checkouts, minute by minute', { badge: srcBadge('Raw 10 Hz · checkout replay', '', 'flow') }),
        card('hx-empty', h('b', null, R.status === 'loading' ? 'Loading…' : 'No replay for this day'),
          h('p', null, R.status === 'loading' ? 'Reading the minute-by-minute checkout file.' : `The replay is calculated from the raw 10 Hz tracks of one day (analysis/journey_lab/211_checkout_replay.py). It is not available for ${R.day ? VJ.fmtDay(R.day) : 'this period'} yet. The audited queue numbers are in “Waiting time”.`)),
        h('button', { type: 'button', class: 'hx-ghost wide', onclick: () => setLayer('waiting') }, 'Open Waiting time')];
    }
    const sec = rpSec(), n = rpNow();
    const peakS = D.sessions.filter(([, t]) => t >= D.peak.from_s && t < D.peak.to_s);
    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
    rpUi.lead = h('div', { class: 'hx-rp-now' }, h('b', null, `${n.q}`), h('span', null, 'queuing'), h('b', { class: 's' }, `${n.s}`), h('span', null, 'paying'));
    const out = [ihead('05 · CHECKOUT SERVICE', `The checkouts at ${rpClock(sec)}`, { badge: srcBadge(`Measured · raw 10 Hz · ${VJ.fmtDay(D.day)}`, 'Positions read 10 times a second; a person counts as queuing or paying when standing still (under 0.5 m/s) in that zone.', 'flow'),
      lead: h('div', { class: 'hx-leadkpi coral' }, rpUi.now = h('small', null, `RIGHT NOW · ${rpClock(sec)}`), rpUi.lead) })];
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, `Peak hour ${rpClock(D.peak.from_s)}–${rpClock(D.peak.to_s)}`), h('small', null, 'most people at the checkouts')),
      h('div', { class: 'hx-grid3' },
        stat('Payments', String(peakS.length), 'at the tills'),
        stat('Time paying', `${Math.round(med(peakS.map((x) => x[2])) || 0)} s`, 'median'),
        stat('People at once', num(D.peak.mean_people, 1), 'on average')),
      h('button', { type: 'button', class: 'hx-ghost wide', onclick: () => { rpPlay(false); rpSeek(D.peak.from_s / D.step_s); renderInspector(); } }, 'Jump to the peak')));
    // Lane by lane: the hour around the playhead, one tick per payment, width = time paying.
    const w0 = Math.max(0, Math.min((D.t1 - D.t0) / 1000 - 3600, Math.floor(sec / 1800) * 1800 - 1800)), w1 = w0 + 3600;
    rpUi.win = [w0, w1]; rpUi.rows = [];
    const rows = D.lanes.filter((l) => l.sessions > 0).map((l) => {
      const cv = h('canvas', { class: 'hx-rp-bar', width: 600, height: 44 });
      const ss = D.sessions.filter(([k, t, d]) => k === l.key && t + d >= w0 && t < w1);
      rpUi.rows.push({ cv, ss });
      const sel = state.sel?.kind === 'lane' && l.lanes.includes(state.sel.id);
      return h('button', { type: 'button', class: `hx-rp-row${sel ? ' on' : ''}`, onclick: () => { select({ kind: 'lane', id: l.lanes[0] }); focusSelection(); } },
        h('b', null, l.key.replace('-', '–')), cv, h('small', null, ss.length ? `${ss.length} · ${Math.round(med(ss.map((x) => x[2])))} s` : '—'));
    });
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Lane by lane'), h('small', null, `${rpClock(w0)}–${rpClock(w1)} · one tick per payment`)),
      h('div', { class: 'hx-rp-rows' }, ...rows),
      h('p', { class: 'hx-note' }, h('span', { class: 'hx-rp-k a' }), 'up to 1 minute ', h('span', { class: 'hx-rp-k c' }, ''), 'longer than 1 minute · count · median time paying')));
    // How long people pay (whole day).
    const hc = h('canvas', { class: 'hx-rp-hist', width: 680, height: 230 });
    out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'How long people pay'), h('small', null, `${D.n_sessions} payments · whole day`)), hc));
    requestAnimationFrame(() => { drawHist(hc, D); updateReplayPanel(); });
    out.push(card('hx-rp-warn', h('p', null, D.pairs_note.replace('2-3, 5-6 and 7-8', '2–3, 5–6 and 7–8'), ' Redrawing them in the twin splits the numbers.')),
      v ? h('p', { class: 'hx-note' }, `Audited reference (Visitor Journey): ${VJ.fmtDuration(v.queue[VJ.DAY]?.value)} queue time per entrant over the whole day. The replay shows where and when it happened.`) : null,
      evidence(h('p', null, D.definition), h('p', null, `Steps of ${D.step_s} s from ${rpClock(0)} to ${rpClock((D.t1 - D.t0) / 1000)}. Counts are people standing in each zone at that instant, not unique customers.`),
        h('p', null, `Coverage ends at x ≈ ${D.coverage_east_m} m: tracks are not followed past the tills towards the exit.`), h('p', null, `Source: ${D.source}.`)));
    return out;
  }
  function updateReplayPanel() {
    const D = state.replay.data; if (!D || !rpOn()) return;
    const n = rpNow();
    if (rpUi.lead?.isConnected) { const b = rpUi.lead.querySelectorAll('b'); b[0].textContent = n.q; b[1].textContent = n.s; }
    if (rpUi.now?.isConnected) rpUi.now.textContent = `RIGHT NOW · ${rpClock(rpSec())}`;
    const h2 = inspector?.querySelector?.('.hx-ihead h2'); if (h2) h2.textContent = `The checkouts at ${rpClock(rpSec())}`;
    const [w0, w1] = rpUi.win, sec = rpSec();
    for (const { cv, ss } of rpUi.rows) {
      const c = cv.getContext('2d'), W = cv.width, H = cv.height; c.clearRect(0, 0, W, H);
      c.fillStyle = 'rgba(101,222,240,.06)'; c.fillRect(0, 6, W, H - 12);
      for (const [, t, d] of ss) {
        const x = (t - w0) / 3600 * W, w = Math.max(2, d / 3600 * W);
        c.fillStyle = d > 60 ? '#E58E92' : '#F3C778'; c.globalAlpha = t <= sec ? 0.95 : 0.35; c.fillRect(x, 9, w, H - 18);
      }
      c.globalAlpha = 1;
      if (sec >= w0 && sec <= w1) { const x = (sec - w0) / 3600 * W; c.fillStyle = '#fff'; c.fillRect(x - 1.5, 0, 3, H); }
    }
  }
  function drawHist(cv, D) {
    const c = cv.getContext('2d'), W = cv.width, H = cv.height, n = D.hist.counts.length, mx = Math.max(...D.hist.counts);
    const labs = ['10–20 s', '20–30', '30–45', '45–60', '1–1.5 min', '1.5–2', '2–3', '3–4', '4+'];
    const bw = (W - 20) / n, base = H - 34;
    c.font = '20px Inter, system-ui, sans-serif'; c.textAlign = 'center';
    D.hist.counts.forEach((v, i) => {
      const x = 10 + i * bw, hh = (base - 30) * v / mx;
      c.fillStyle = D.hist.edges_s[i] >= 60 ? '#E58E92' : '#F3C778'; c.fillRect(x + 5, base - hh, bw - 10, hh);
      c.fillStyle = '#EEF8FF'; c.fillText(String(v), x + bw / 2, base - hh - 6);
      c.fillStyle = '#8DA3B3'; c.font = '17px Inter, system-ui, sans-serif'; c.fillText(labs[i] || '', x + bw / 2, H - 8); c.font = '20px Inter, system-ui, sans-serif';
    });
    // median marker (edges: 10,20,30,45 ...)
    const m = D.median_s, e = D.hist.edges_s; let i = e.findIndex((x, j) => m >= x && (j === e.length - 1 || m < e[j + 1])); if (i < 0) i = 0;
    const frac = i < e.length - 1 ? (m - e[i]) / (e[i + 1] - e[i]) : 0.5, mxp = 10 + (i + frac) * bw;
    c.strokeStyle = '#fff'; c.setLineDash([5, 5]); c.lineWidth = 2; c.beginPath(); c.moveTo(mxp, 8); c.lineTo(mxp, base); c.stroke(); c.setLineDash([]);
    c.fillStyle = '#fff'; c.textAlign = 'left'; c.fillText(`median ${Math.round(m)} s`, mxp + 8, 24);
  }

  function inspectService(v) {
    const lanes = v.lanes.list;
    const sel = (state.sel?.kind === 'lane' ? lanes.find((l) => l.lane === state.sel.id) : null) || lanes[0] || null;
    const { peak, over } = VJ.queuePeak(v);
    const out = [ihead('05 · CHECKOUT SERVICE', sel ? `Lane ${sel.lane}` : 'Checkouts', { badge: vjBadge(v),
      lead: leadKpi('QUEUE WAIT · PER ENTRANT · WHOLE STORE', kpiValue(v.queue[state.slot]), `Queue person-minutes ÷ entrants, ${VJ.fmtSlot(state.slot)}. Not the average wait of one lane.`, 'coral') })];
    out.push(card('', h('div', { class: 'hx-grid3' },
      stat('Service at the till', kpiValue(v.service[state.slot]), 'per entrant'),
      stat('Peak slot', peak ? VJ.fmtDuration(peak.value) : '—', peak ? VJ.fmtSlot(peak.slot) : ''),
      stat('Entrants', kpiValue(v.entrances[state.slot], VJ.fmtInt), VJ.fmtSlot(state.slot))),
      slotChart(v.queue, { line: VJ.THRESHOLDS.queueSlotMin, second: v.service }),
      h('div', { class: 'hx-comp-k' }, h('span', { class: 'queue' }, 'queue'), h('span', { class: 'service' }, 'service'), h('span', { class: 'line' }, '1-minute line'))));
    if (over && over.slot !== state.slot) out.push(h('button', { type: 'button', class: 'hx-ghost wide', onclick: () => setSlot(over.slot) }, `Open the peak window ${VJ.fmtSlot(over.slot)}`));
    if (sel) {
      const measured = kinMatches() ? state.kin.K.by_lane?.[sel.lane] : null;
      out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, `Lane ${sel.lane}`), h('small', null, 'whole day 08–20')),
        h('div', { class: 'hx-grid2' },
          stat('Share of all waiting', pct(sel.share), 'one total, split by lane'),
          stat('People queuing', sel.meanPeopleWaiting == null ? '—' : num(sel.meanPeopleWaiting), 'on average'),
          stat('Waiting', `${Math.round(sel.waitingPm)} min`, 'person-minutes'),
          stat('Wait per session', sel.waitPerSessionMin == null ? h('span', { class: 'hx-na', title: 'Queue sessions are not reliable for this day' }, '—') : VJ.fmtDuration(sel.waitPerSessionMin), 'needs queue sessions')),
        measured ? h('p', { class: 'hx-note' }, `Measured on the raw 10 Hz tracks: ${Math.round((measured.wait || 0) / 60)} person-minutes waiting in this lane (agrees with the audited split, r 0.99).`) : null));
    }
    if (v.lanes.reason) out.push(unavailable(v.lanes.reason));
    else out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Where the waiting happens'), h('small', null, 'share of the day’s waiting')),
      bars(lanes.map((l) => ({ label: `Lane ${l.lane}`, value: l.share, split: l.waitingPm + l.transitPm ? l.waitingPm / (l.waitingPm + l.transitPm) : 0, on: sel?.lane === l.lane, onclick: () => select({ kind: 'lane', id: l.lane }) })), (x) => pct(x), { color: 'var(--queue)' })));
    out.push(evidence(h('p', null, 'On the floor: coral outline = queue area, dashed outline = till / service band. Walk-through and objects parked at the till are removed before any minute is counted.'),
      h('p', null, 'Lane rows are shares of one total; the lead number is per entrant. Different denominators, never mixed.'), method(v.queue[state.slot]?.method)));
    return out;
  }

  // Plain hypotheses per lever. The scenario engine picks the lever; nothing here claims a cause.
  const HYPOTHESIS = {
    layout: ['People pass this frontage without stopping.', 'The products are not where people look.', 'Move a high-interest line to the first metre of the frontage for two matched weeks.'],
    pricing: ['People stop here, but shelf time does not grow into choice.', 'Something at the shelf holds them back: price, range or availability.', 'A clear promotion on the top sellers, two matched weeks.'],
    wayfinding: ['People turn back here more than in the store overall.', 'They do not find what they look for.', 'Clearer signage at the entrance of the department.'],
    crossmerch: ['People hesitate here.', 'They are choosing between alternatives.', 'A pairing or bundle at the shelf.'],
    staffing: ['Queue time per entrant passes 1 minute at the peak.', 'Open lanes do not match arrivals in that slot.', 'Open one more lane at the start of the peak slot on matched weekdays.'],
  };
  function inspectOpportunities(v) {
    const layer = state.layer.opportunities;
    if (layer === 'radar') {
      const r = state.radar;
      return [ihead('06 · PROFIT RADAR · CURRENT', 'Current scenarios', { badge: srcBadge('Profit Radar · live model', 'Separate from the day’s Visitor Journey and from the historical floor.', 'scenario') }),
        h('button', { type: 'button', class: 'hx-ghost wide', disabled: r.busy, onclick: loadRadar }, r.busy ? 'Checking…' : (r.stamp ? `Refresh (${r.stamp})` : 'Load current Profit Radar')),
        r.note ? h('p', { class: 'hx-note' }, r.note) : null,
        ...r.list.slice(0, 3).map((a, i) => card('', h('div', { class: 'hx-card-h' }, h('b', null, `${String.fromCharCode(65 + i)} · ${a.name}`), h('small', null, a.priced ? 'MODELLED' : 'BEHAVIOUR ONLY')),
          a.priced ? h('strong', { class: 'hx-money' }, `€${Math.round(a.econ.range.conservative)}–${Math.round(a.econ.range.aggressive)} / day`) : h('p', null, 'No store economics for this shelf, so no euro figure.'),
          h('p', { class: 'hx-note' }, `${a.ins.dataBasis.trackCount} current tracks. A modelled range, not realised profit.`)))];
    }
    const list = valueItems();
    const sel = list.find((c) => state.sel && c.sel.kind === state.sel.kind && c.sel.id === state.sel.id) || list[0];
    if (!sel) return [ihead('06 · OPPORTUNITIES', 'Nothing to screen', { badge: vjBadge(v, VJ.DAY) }), card('', h('p', null, 'Visitor Journey has no usable department or queue reading for this day.'))];
    const r = sel.summary.range, rec = sel.summary.recommended, inp = sel.inputs, ax = inp.axes || {};
    const [obs, hyp, test] = HYPOTHESIS[rec.leverId] || HYPOTHESIS.layout;
    const observed = sel.kind === 'dept'
      ? [['Time in area', `${VJ.fmtDuration(sel.evidence.area)} per entrant`], ['At the shelf', `${VJ.fmtDuration(sel.evidence.banco)} per entrant`], ['Choice index', num(sel.evidence.choice)],
        ...(sel.axesSource === 'measured' ? [['Moving past (10 Hz)', pct(ax.avoidance)], ['Hesitation vs store', `×${num(2 * ax.hesitation, 1)}`], ['U-turns vs store', `×${num(2 * ax.confusion, 1)}`]] : [])]
      : [['Peak queue per entrant', `${VJ.fmtDuration(sel.evidence.peak.value)} at ${VJ.fmtSlot(sel.evidence.peak.slot)}`], [`Lane ${sel.evidence.lane} share of waiting`, pct(sel.evidence.laneShare)]];
    const out = [ihead('06 · OPPORTUNITIES', sel.name, { badge: vjBadge(v, VJ.DAY) })];
    out.push(card('obs', h('div', { class: 'hx-step' }, h('b', null, '1'), h('span', null, 'OBSERVED')), h('p', { class: 'hx-strong' }, obs),
      h('dl', { class: 'hx-dl' }, ...observed.flatMap(([k, val]) => [h('dt', null, k), h('dd', null, val)])),
      sel.movement ? mixBar(sel.movement.share, { thin: true }) : null),
      card('', h('div', { class: 'hx-step' }, h('b', null, '2'), h('span', null, 'HYPOTHESIS · NOT MEASURED')), h('p', null, hyp)),
      card('gold', h('div', { class: 'hx-step' }, h('b', null, '3'), h('span', null, 'MODELLED SCENARIO')),
        h('strong', { class: 'hx-money big' }, `${eur(r.conservative)}–${eur(r.aggressive)}`, h('small', null, ' / day')),
        h('p', null, `If the hypothesis holds and “${rec.leverLabel}” works at ${Math.round(state.econ.effort * 100)}% effort, the recovery model gives about ${eur(r.expected)} a day of gross margin. Not measured, not realised.`),
        h('span', { class: 'hx-badge' }, state.econ.configured ? 'STORE ECONOMICS' : 'DEFAULT ECONOMICS — ASSUMED'),
        h('details', { class: 'hx-ev' }, h('summary', null, 'Assumptions'),
          h('dl', { class: 'hx-dl' }, h('dt', null, 'Entrants (day)'), h('dd', null, VJ.fmtInt(sel.evidence.shoppers)), ...(sel.kind === 'dept' ? [h('dt', null, 'Reaching the area / day'), h('dd', null, VJ.fmtInt(inp.exposedPerDay)), h('dt', null, 'Gap to 0.45 benchmark'), h('dd', null, num(rec.gap))] : []), h('dt', null, 'Share recoverable'), h('dd', null, pct(rec.capture * (inp.winnable || 1), 1))),
          h('label', { class: 'hx-field' }, h('span', null, sel.kind === 'dept' ? `Margin per item, ${sel.name} (€)` : 'Margin per basket (€)'),
            h('input', { type: 'number', min: '0.1', step: '0.1', value: String(sel.kind === 'dept' ? inp.marginPerUnit : state.econ.basketMargin), 'aria-label': 'Margin',
              onchange: (e) => { const x = Number(e.target.value); if (!(x > 0)) return; if (sel.kind === 'dept') state.econ.margins = { ...state.econ.margins, [sel.id]: x }; else state.econ.basketMargin = x; state.econ.configured = true; render(); } })),
          h('label', { class: 'hx-field' }, h('span', null, `Effort ${Math.round(state.econ.effort * 100)}%`), h('input', { type: 'range', min: '0.2', max: '1', step: '0.1', value: String(state.econ.effort), 'aria-label': 'Effort', onchange: (e) => { state.econ.effort = Number(e.target.value); render(); } })),
          h('button', { type: 'button', class: 'hx-ghost wide', onclick: () => { state.econ = VAS.defaultEconomics(); render(); } }, 'Reset to defaults'))),
      card('', h('div', { class: 'hx-step' }, h('b', null, '4'), h('span', null, 'TEST')), h('p', null, test)),
      card('', h('div', { class: 'hx-step' }, h('b', null, '5'), h('span', null, 'VERIFY')), h('p', null, sel.kind === 'dept' ? `Choice index and time at the shelf for ${sel.name} in Visitor Journey, same slots, before and after. Then the till data for the category.` : 'Queue minutes per entrant in that slot, same weekday, before and after.')),
      card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Other places to screen'), h('small', null, 'modelled € / day')),
        bars(list.map((c, i) => ({ label: `${String.fromCharCode(65 + Math.min(i, 25))} · ${c.name}`, value: c.summary.range.expected, on: c === sel, onclick: () => select(c.sel) })), (x) => eur(x), { color: 'var(--scenario)' }),
        h('p', { class: 'hx-note' }, 'Alternatives, not a total: places overlap and are never added up. Served counters without a shelf reading are left out.')));
    return out;
  }

  function inspectCompare(v) {
    const C = state.compare, mode = state.layer.compare;
    const metricSeg = h('div', { class: 'hx-seg', role: 'group', 'aria-label': 'Measure' },
      ...[['t', 'Movement'], ['d', 'Slow presence'], ...(kinMatches() ? [['k', 'Behaviour']] : [])].map(([k, t]) => h('button', { type: 'button', 'aria-pressed': String((C.metric || 't') === k), onclick: () => { C.metric = k; void renderCompare(); render(); } }, t)));
    if (mode === 'day') {
      const W = compareWindows(), w = W[C.active] || W[0];
      const sl = w.slot;
      const out = [ihead('07 · THE DAY', `${w.label}${v ? ` · ${VJ.fmtDay(v.day)}` : ''}`, { badge: v && sl ? vjBadge(v, sl) : srcBadge('Flow field only', '', 'flow'), sub: 'One large map for the slot in focus; the strip below walks the day.' }), metricSeg];
      if (C.metric === 'k' && sl && kinMatches()) {
        const sh = KN.shares(KN.mixOf(state.kin.K, null, sl));
        out.push(card('kin', h('div', { class: 'hx-card-h' }, h('b', null, 'How the store moves'), h('small', null, `slot ${w.label} · measured`)), mixBar(sh),
          h('div', { class: 'hx-comp-k' }, ...KN.STATES.map((st) => h('span', { style: `--c:${st.color}` }, `${st.it} ${pct(sh?.[st.id])}`)))));
      }
      if (sl && v) {
        const ranked = VJ.rankDepartments(v, sl).slice(0, 4);
        const prev = W[C.active - 1]?.slot;
        const delta = (ser) => (prev && ser[sl]?.value != null && ser[prev]?.value != null ? ser[sl].value - ser[prev].value : null);
        const arrow = (d, fmt) => (d == null ? null : h('span', null, `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))} vs ${prev.replace('-', '–')}`));
        out.push(card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Visitor Journey'), h('small', null, `slot ${w.label}`)),
          h('div', { class: 'hx-grid2' },
            stat('Entrants', kpiValue(v.entrances[sl], VJ.fmtInt), arrow(delta(v.entrances), VJ.fmtInt)),
            stat('Time in store', kpiValue(v.visit[sl]), arrow(delta(v.visit), VJ.fmtDuration)),
            stat('Queue wait', kpiValue(v.queue[sl]), arrow(delta(v.queue), VJ.fmtDuration)),
            stat('People in store', kpiValue(v.peopleMean[sl], (x) => num(x, 0)), 'on average'))),
          card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Where time goes'), h('small', null, 'per entrant')),
            bars(ranked.map((r) => ({ label: r.name, value: r.area.value, onclick: () => { select({ kind: 'dept', id: r.id }); setLens('engagement'); void setSlot(sl); } })), VJ.fmtDuration, { color: 'var(--sel)' })),
          action(`Open ${w.label} on the 3D floor`, 'Same slot, streams and numbers together.', () => { togglePlay(false); setLens('pulse'); void setSlot(sl); }));
      } else out.push(h('p', { class: 'hx-note' }, 'These flow windows do not match the Visitor Journey 2-hour slots, so no KPI is placed beside them.'));
      out.push(h('p', { class: 'hx-note' }, 'Maps compare where movement went, as a share of each slot. They do not show sales, and a change between slots is not proof that something worked.'));
      return out;
    }
    const W = compareWindows();
    const opts = W.map((w) => [w.slice, w.label]);
    const pick = (which) => h('select', { 'aria-label': `Window ${which}`, onchange: (e) => { C[which] = e.target.value; void renderCompare(); render(); } }, ...opts.map(([k, l]) => h('option', { value: k, selected: C[which] === k }, l)));
    const toSlot = (k) => W.find((w) => w.slice === k)?.slot || null;
    const sa = toSlot(C.a), sb = toSlot(C.b);
    const kpiRow = (label, ser, fmt = VJ.fmtDuration) => h('tr', null, h('td', null, label), h('td', null, sa ? kpiValue(ser[sa], fmt) : '—'), h('td', null, sb ? kpiValue(ser[sb], fmt) : '—'));
    const matched = sa && sb && v;
    const la = W.find((w) => w.slice === C.a)?.label || C.a, lb = W.find((w) => w.slice === C.b)?.label || C.b;
    const changes = compareChanges(la, lb);
    return [ihead('07 · COMPARE', `${la} vs ${lb}`, { badge: srcBadge('Flow field · same frame and scale', '', 'flow'), sub: 'Same footprint, same scale. A movement comparison is not an intervention result.' }), metricSeg,
      card('', h('small', { class: 'hx-cap' }, 'WINDOW A'), pick('a'), h('small', { class: 'hx-cap' }, 'WINDOW B'), pick('b')),
      card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Matched Visitor Journey'), h('small', null, matched ? 'same slots' : 'not available')),
        matched ? h('table', { class: 'hx-table' }, h('tr', null, h('th'), h('th', null, sa.replace('-', '–')), h('th', null, sb.replace('-', '–'))),
          kpiRow('Entrants', v.entrances, VJ.fmtInt), kpiRow('Time in store', v.visit), kpiRow('Queue wait', v.queue))
          : h('p', { class: 'hx-note' }, 'Visitor Journey is calculated in 2-hour slots from 08 to 20. These windows do not match, so no KPI is placed beside them.')),
      ...changes];
  }

  /** What actually changed between window A and B: places that gained or lost share, or (Behaviour) the state mix. */
  function compareChanges(la, lb) {
    const C = state.compare, f = api.snapshot().field;
    if (C.metric === 'k' && kinMatches()) {
      const K = state.kin.K, sa = KN.SLICE_SLOT[C.a], sb = KN.SLICE_SLOT[C.b];
      const A = KN.shares(KN.mixOf(K, null, sa)), B = KN.shares(KN.mixOf(K, null, sb));
      if (!A || !B) return [h('p', { class: 'hx-note' }, 'Behaviour is measured in the 2-hour slots only.')];
      const rows = KN.STATES.map((st) => ({ st, d: B[st.id] - A[st.id] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
      // Departments whose main state differs between the two windows.
      const flips = [];
      for (const d of KN.departments(K, sb)) {
        const fa = KN.fingerprint(K, d.dept, sa); if (!fa) continue;
        if (fa.dominant !== d.dominant) flips.push({ dept: d.dept, from: KN.STATE[fa.dominant], to: KN.STATE[d.dominant] });
      }
      return [card('kin', h('div', { class: 'hx-card-h' }, h('b', null, 'How the store moves'), h('small', null, 'share of person-time')),
        h('small', { class: 'hx-cap' }, la), mixBar(A), h('small', { class: 'hx-cap' }, lb), mixBar(B),
        bars(rows.slice(0, 4).map((r) => ({ label: `${r.st.it} ${r.d >= 0 ? 'up' : 'down'} in ${lb}`, value: Math.abs(r.d), color: r.st.color })), (x) => `${(x * 100).toFixed(1)} pts`)),
        flips.length ? card('', h('div', { class: 'hx-card-h' }, h('b', null, 'Departments that changed behaviour'), h('small', null, 'main state')),
          ...flips.slice(0, 5).map((x) => h('p', { class: 'hx-note' }, `${VJ.deptLabel(x.dept)}: ${x.from.it.toLowerCase()} in ${la} → ${x.to.it.toLowerCase()} in ${lb}`)))
          : h('p', { class: 'hx-note' }, 'No department changes its main movement state between these two windows; the shift is in the mix shown above.')];
    }
    const key = C.metric === 'd' ? 'd' : 't';
    const pa = C.packs[C.a], pb = C.packs[C.b];
    if (!pa || !pb || !f) return [];
    const A = sharesOf(pa, key), B = sharesOf(pb, key);
    const by = new Map();
    for (const k of new Set([...A.keys(), ...B.keys()])) {
      const [i, j] = k.split(',').map(Number), p = api.toVenue(i - f.i0 + 0.5, j - f.j0 + 0.5);
      const place = placeOf(p.x, p.z).replace(/^Aisle by /, '');
      const r = by.get(place) || { place, a: 0, b: 0, x: 0, z: 0, w: 0 };
      r.a += A.get(k) || 0; r.b += B.get(k) || 0;
      const w = (A.get(k) || 0) + (B.get(k) || 0); r.x += p.x * w; r.z += p.z * w; r.w += w;
      by.set(place, r);
    }
    const rows = [...by.values()].filter((r) => r.place !== 'Aisle').map((r) => ({ ...r, d: r.b - r.a, x: r.w ? r.x / r.w : 0, z: r.w ? r.z / r.w : 0 }));
    const what = key === 'd' ? 'slow presence' : 'movement';
    const list = (arr, title, color) => card('', h('div', { class: 'hx-card-h' }, h('b', null, title), h('small', null, `share of ${what} · points`)),
      arr.length ? bars(arr.map((r) => ({ label: r.place, value: Math.abs(r.d), color, onclick: () => { setLens('pulse'); api.flyTo(r.x, r.z, 18); } })), (x) => `${(x * 100).toFixed(1)} pts`)
        : h('p', { class: 'hx-note' }, 'No place stands out.'));
    return [list(rows.filter((r) => r.d > 0.004).sort((x, y) => y.d - x.d).slice(0, 5), `More in ${lb}`, 'var(--cyan)'),
      list(rows.filter((r) => r.d < -0.004).sort((x, y) => x.d - y.d).slice(0, 5), `More in ${la}`, 'var(--coral)'),
      h('p', { class: 'hx-note' }, `Each window is turned into shares that add up to 100 %, so a quieter window does not look emptier. A point is one percent of that window’s ${what}.`)];
  }

  function inspectLive() {
    const ranked = VJ.rankDepartments(state.vj.view, VJ.DAY, { includePackaged: false });
    const sel = state.sel?.kind === 'dept' ? state.sel.id : '';
    const canOpen = qs.has('liveLink');
    return [ihead('08 · LIVE', 'The store now', { badge: srcBadge('Live feed · not connected here', '', 'coral'), sub: 'Anonymous current positions and short trails from the live pipeline.' }),
      card('hx-big', h('small', null, 'PEOPLE IN STORE NOW'), h('strong', null, '—'), h('p', null, 'Shown only with a verified connection to the live feed. This view has none, so no number is shown.')),
      card('', h('small', { class: 'hx-cap' }, 'FOCUS AREA'),
        h('select', { 'aria-label': 'Region', onchange: (e) => select(e.target.value ? { kind: 'dept', id: e.target.value } : null, { fly: true }) }, h('option', { value: '' }, 'Entire store'), ...ranked.map((r) => h('option', { value: r.id, selected: r.id === sel }, r.name))),
        h('button', { type: 'button', class: 'hx-cta', disabled: !canOpen, onclick: openLive }, h('div', null, h('b', null, 'Open live tracks here'), h('p', null, canOpen ? 'Same area and camera focus, live bodies.' : 'Available inside the Hyperspace app, where the live feed is connected.')), h('i', { html: ICONS.arrow }))),
      evidence(h('dl', { class: 'hx-dl' }, h('dt', null, 'Identity'), h('dd', null, 'ephemeral'), h('dt', null, 'Trails'), h('dd', null, 'short, recent'), h('dt', null, 'Historical KPIs'), h('dd', null, 'never from live ids')),
        h('p', null, 'Live ids break every few seconds. They are never stitched into journeys here; journeys come from the nightly reconstruction.'))];
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
        stat(r ? 'Shoppers' : 'Sessions', r ? (Number.isFinite(r.shoppers) ? r.shoppers.toLocaleString('en-GB') : '—') : (Number.isFinite(ch.sessions) ? ch.sessions.toLocaleString('en-GB') : '—'), 'queue sessions, as the report labels them'),
        stat('Abandonment', r ? (Number.isFinite(r.abandonPct) ? `${num(r.abandonPct, 0)}%` : '—') : (Number.isFinite(ch.abandonPct) ? `${num(ch.abandonPct, 0)}%` : '—'), 'report calculation'),
        stat(r ? 'Channel avg' : 'Completed', r ? (Number.isFinite(ch.avgWaitSec) ? `${Math.round(ch.avgWaitSec)} s` : '—') : (Number.isFinite(ch.completed) ? ch.completed.toLocaleString('en-GB') : '—'), r ? 'same report' : 'sessions'))));
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
    else if (L === 'behaviour') body = inspectBehaviour(v);
    else if (L === 'live') body = inspectLive();
    else if (!v) body = [h('div', { class: 'hx-kicker' }, LENS[L].kicker), h('h2', null, LENS[L].title), state.vj.origin === 'loading' ? card('', h('p', null, 'Loading Visitor Journey…')) : unavailable(state.vj.note)];
    else if (L === 'pulse') body = [sourceSwitch(), ...inspectPulse(v)];
    else if (L === 'engagement') body = [sourceSwitch(), ...inspectEngagement(v)];
    else if (L === 'service' && rpOn()) body = [sourceSwitch(), ...inspectReplay(v)];
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
    if (L === 'behaviour') {
      legend.hidden = !state.kin.K;
      legend.replaceChildren(...KN.STATES.map((st, k) => h('button', { type: 'button', class: `hx-lchip${state.kfocus === k ? ' on' : ''}${state.kfocus != null && state.kfocus !== k ? ' off' : ''}`, style: `--c:${st.color}`, onclick: () => setFocus(k), title: st.note }, h('i'), st.it)),
        h('span', { class: 'hx-lhot' }, h('i'), 'Hesitation spot'));
      return;
    }
    if (L === 'flow' && layer === 'regime') {
      legend.hidden = false;
      legend.replaceChildren(...REGIMES.filter((T) => T.id !== 0).map((T) => h('button', { type: 'button', class: `hx-lchip${state.regFocus === T.id ? ' on' : ''}${state.regFocus != null && state.regFocus !== T.id ? ' off' : ''}`, style: `--c:${T.color}`, onclick: () => setRegFocus(T.id), title: T.rule }, h('i'), T.name)));
      return;
    }
    // Every legend entry is a line style: what the shape is, never a colour ramp.
    const sel = ['sel', 'Selected area · outline only'];
    const items = {
      pulse: [layer !== 'clean' ? ['stream', 'Movement streams (aggregated)'] : null, sel, layer === 'evidence' ? ['contour', 'Slow presence · isolines'] : null, layer === 'evidence' ? ['queue', 'Queue areas'] : null, layer === 'clean' ? ['muted', 'Department outlines'] : null],
      flow: { movement: [['stream', 'Movement streams']], dwell: [['contour', 'Slow presence isolines'], ['stream', 'Movement (dimmed)']], footfall: [['dots', 'Busiest quarter (big = top 10 %)'], ['contour', 'Top-10 % outline']],
        purity: [['arrow', 'One-way stretch (D1…)'], ['pair', 'Busy two-way aisle'], ['probe', 'Open the direction rose']], convergence: [['queue', 'Streams meet (M)'], ['stream', 'Streams split (S)'], ['contour', 'Net flow direction']],
        regime: null }[layer],
      engagement: isExec() ? [sel, ['contour', 'Mapped frontage · line weight = value']] : [sel, layer !== 'area' ? ['front', 'Shelf face (CAD)'] : null, layer !== 'area' ? ['band', '1 m band measured'] : null,
        layer === 'choice' ? ['dash3', 'Worked · in between · crossed'] : ['muted', 'Other departments'], state.eng.iso ? ['contour', kinMatches() ? 'Choosing at the shelf · isolines' : 'Slow presence · isolines'] : null],
      service: isExec() ? [['queue', 'Lane queue · weight = avg wait']] : [['queue', layer === 'transit' ? 'Queue area · weight = walk-through' : 'Queue area · weight = waiting share'], ['svcd', 'Till / service band']],
      opportunities: [['scenario', 'Place under review'], ['letter', 'Other places to screen']],
      live: [sel],
    }[L];
        legend.hidden = !items;
    legend.replaceChildren(...(items || []).filter(Boolean).map(([c, t]) => h('span', null, h('i', { class: c }), t)));
  }

  function render() {
    if (!rpOn() && state.replay.playing) rpPlay(false);
    renderChrome();
    renderStageControls();
    renderInspector();
    renderLegend();
    api.twin?.context(state.lens);
    root.dataset.twinFocus=String(!!state.sel);
    renderSpatialTools();renderAnchorCard();
    updateReplayClock(); requestAnimationFrame(drawReplayStrip);
    compareBox.hidden = state.lens !== 'compare';
    view.style.visibility = state.lens === 'compare' ? 'hidden' : '';
    api.suspend(state.lens === 'compare');
    overlayKey = '';
  }

  window.addEventListener('ff-analysis-update', () => { if (!state.busy) renderStageControls(); });
  window.addEventListener('ff-twin-update', () => { renderSpatialTools();renderAnchorCard(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleLab(false); root.classList.remove('hx-sheet-open'); } });

  // ------------------------------------------------------------------ boot
  (async () => {
    state.areas = await VJ.loadAreas();
    try { layoutPolys ||= await fetch('./layout_prod.json').then((r) => r.json()).then((j) => j.polys); geo.fix = G.fixtureIndex(layoutPolys); geo.dept.clear(); } catch { /* frontage stays unavailable; outlines still draw */ }
    let i = info();
    if (!i.live && i.days.length) { try { await api.ensureLive(); } catch { /* sample pack stays */ } i = info(); }
    if (api.hasSlice('trading')) { try { await api.slice('trading'); } catch { /* keep 07–22 */ } }
    await Promise.all([loadVJ(), loadKin()]);
    if (state.source === 'exec') await loadExec();
    await applyRenderer(true);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) api.pause(true);
    render();
  })();
  render();
}
