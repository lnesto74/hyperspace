import { summariseCells } from './workspace-metrics.js';

export const BUSINESS_VIEWS = {
  value: {label:"Value opportunities", title:"Where should we intervene first?", colour:"#edc979", visual:"Gold markers identify places to review. Flow lines remain movement context; they do not represent money lost.", action:"Inspect the evidence, choose an experiment, then measure its result.", method:"Behavioural screening and current Profit Radar scenarios are separate evidence scopes."},
  moved: { label: 'Store movement', title: 'Where does activity concentrate?', colour: '#64d9ec',
    visual: 'Luminous streams summarise where movement was observed. Numbered places link the map to the findings.',
    action: 'Inspect the busiest observed frontages for aisle clearance and replenishment access.',
    measure: 'Movement per observed m²', method: 'Customer journey report: zone crossings. Animated movement is separate spatial context.' },
  stopped: { label: 'Browsing & stops', title: 'Where do people spend time stopped?', colour: '#f6bc73',
    visual: 'Amber relief reveals concentrations of slow presence. Higher areas contain more accumulated slow time.',
    action: 'Check whether stops correspond to browsing, a service counter or an obstruction.',
    measure: 'Time spent slow', method: 'Customer journey report: median category dwell among stops and median shelf-face engagement, in seconds.' },
  queues: { label: 'Checkout pressure', title: 'Which checkout lanes need a closer look?', colour: '#ff927e',
    visual: 'Only checkout queue areas are highlighted. The rest of the store recedes.',
    action: 'Check the leading lane and its staffing context before changing checkout allocation.',
    measure: 'Total time stopped or moving slowly', method: 'Customer journey report: average queue wait, queue sessions and abandonment, with its queue duration threshold.' },
  hot: { label: 'Department comparison', title: 'Where does stopping behaviour differ?', colour: '#a9b9ff',
    visual: 'Amber means more time slow; blue means less, relative to the median observed department frontage.',
    action: 'Compare the department with a similar frontage and inspect the offer, availability and access.',
    measure: 'Difference from department median', method: 'Compare the report’s stopping percentage, category dwell, engagement and crossings. Mean category dwell is not ranked with department medians.' },
  change: { label: 'Before & after', title: 'What changed between the two periods?', colour: '#92d5bd',
    visual: 'Compare the same place and time window on two dates. A difference alone does not establish cause.',
    action: 'Check equivalent trading hours, data coverage and other store changes before attributing a result.',
    measure: 'Change in slow-time share', method: 'Difference in the proportion of observed presence spent slow. The floor’s traffic-share difference is a separate measurement.' },
};
export function median(values) {
  const xs = values.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!xs.length) return null;
  return (xs[Math.floor((xs.length-1)/2)] + xs[Math.floor(xs.length/2)]) / 2;
}

/** Union frontages within a category: overlapping polygons never duplicate cells. */
export function analyseAreas(field, rois, toVenue, contains) {
  const groups = new Map();
  for (const roi of rois || []) {
    if (!roi.vertices?.length) continue;
    const queue = /checkout.*queue|cassa.*coda/i.test(roi.name || '');
    if (!queue && !roi.category) continue;
    const key = queue ? roi.id : `department:${roi.category}`;
    if (!groups.has(key)) groups.set(key, { key, name: queue ? roi.name.replace(/\s*-\s*Queue/i,'') : roi.category,
      kind: queue ? 'queue' : 'department', rois: [], polygons: [] });
    const group = groups.get(key); group.rois.push(roi); group.polygons.push(roi.vertices);
  }
  const positioned = field.cells.map(c => ({ c, p: toVenue(c.i-field.i0+.5,c.j-field.j0+.5) }));
  const result = [];
  for (const group of groups.values()) {
    const matched = positioned.filter(({p})=>group.polygons.some(poly=>contains(p.x,p.z,poly)));
    const cells = matched.map(({c})=>c);
    const stats = summariseCells(cells,field.B);
    // Suppress unsupported frontages, not zero activity. This is an observation gate, not a quality certification.
    if (!stats.supported || stats.presence == null || stats.presence < 30) continue;
    const anchor = matched.reduce((best,cur)=>(cur.c.e || 0) > (best?.c.e || 0) ? cur : best, null);
    const observedArea = stats.supported * field.meta.cell_m ** 2;
    result.push({ ...group, stats, cells, x:anchor.p.x,z:anchor.p.z,
      movement: stats.weight / observedArea,
      selection: { id:group.key, name:group.name, vertices:group.polygons[0], polygons:group.polygons, businessKind:group.kind } });
  }
  return result;
}
export function rankAreas(areas, mode) {
  const peers = areas.filter(a=>a.kind === (mode === 'queues' ? 'queue' : 'department'));
  const baseline = median(peers.map(a=>a.stats.slowShare));
  const movementMedian = median(peers.map(a=>a.movement));
  const ranked = peers.map(a=>({ ...a, delta: baseline == null || a.stats.slowShare == null ? null : (a.stats.slowShare-baseline)*100,
    movementRatio: movementMedian > 0 ? a.movement/movementMedian : null }));
  ranked.sort((a,b)=>mode === 'moved' ? b.movement-a.movement : mode === 'queues' ? b.stats.dwell-a.stats.dwell
    : mode === 'hot' ? Math.abs(b.delta || 0)-Math.abs(a.delta || 0) : (b.stats.slowShare || 0)-(a.stats.slowShare || 0));
  return { ranked, baseline, movementMedian };
}
export function durationLabel(minutes) {
  if (!Number.isFinite(minutes)) return 'Unavailable';
  if (minutes > 0 && minutes < 1) return 'Less than 1 min';
  const total=Math.round(minutes), h=Math.floor(total/60), m=total%60;
  return h ? `${h}h ${String(m).padStart(2,'0')}m` : `${m} min`;
}
export function areaValue(area, mode) {
  const n = (x,d=0)=>x.toLocaleString(undefined,{maximumFractionDigits:d});
  if (mode === 'moved') return area.movementRatio == null ? 'No peer baseline' : `${n(area.movementRatio,1)}× typical frontage`;
  if (mode === 'queues') return `${durationLabel(area.stats.dwell/60)} accumulated`;
  if (mode === 'hot') return area.delta == null ? 'No peer baseline' : `${n(Math.abs(area.delta))} points ${area.delta>=0?'above':'below'} department median`;
  return area.stats.slowShare == null ? 'Unavailable' : `${n(area.stats.slowShare*100)}% of time slow`;
}
export function headlineFor(ranked, mode) {
  const top = ranked[0];
  if (!top) return { title:'Not enough observations to rank these areas', detail:'Try a different period. Areas without usable observations are not classified as quiet.' };
  if (mode === 'queues') return { title:`Start with ${top.name}`, detail:`It has the most time stopped or moving slowly among ${ranked.length} observed queue areas in this window. This is accumulated time across observations, not one person’s wait.` };
  if (mode === 'moved') return { title:`Movement is strongest near ${top.name}`, detail:`${areaValue(top,mode)} by movement per observed square metre. Inspect this frontage for through-traffic and access.` };
  if (mode === 'hot') return { title:`${top.name} differs most from the department median`, detail:`${Math.round(top.stats.slowShare*100)}% of observed time is spent slow, compared with ${Math.round(top.stats.slowShare*100-top.delta)}% at the median department. ${top.stats.slowShare === 0 ? 'No stopping was recorded in these frontages. Check coverage and area boundaries before interpreting this as low engagement.' : 'Use a comparable frontage to investigate why.'}` };
  return { title:`Stopping is most prevalent near ${top.name}`, detail:`${areaValue(top,mode)} across its observed frontages. Browsing, service and obstruction remain different possible explanations.` };
}
