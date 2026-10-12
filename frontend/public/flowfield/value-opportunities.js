import {legacyValue} from './zone-kpis.js';
// Current commercial scenarios and historical flow screening have separate scopes.
export function screenAreas(areas) {
  const peers=areas.filter(a=>a.kind==='department' && a.stats.slowShare!=null && a.movement>0);
  if(!peers.length)return [];
  const typical=[...peers].sort((a,b)=>a.movement-b.movement)[Math.floor(peers.length/2)].movement;
  return peers.map(a=>({...a,screening:true,score:(a.movement/typical)*(1-a.stats.slowShare)}))
    .sort((a,b)=>b.score-a.score);
}
export function radarAreas(payload, venue, rois, now=Date.now()) {
  if(!venue || payload?.venueId!==venue) throw Error('Radar venue could not be matched to this store.');
  const byId=new Map();
  for(const ins of payload.insights || []) {
    const ev=ins.evidence, roi=rois.find(r=>r.id===ins.dataBasis?.roiId);
    if(!roi?.vertices?.length || ev?.source!=='observed' || !Number.isFinite(ev.observedAt) || now-ev.observedAt>120000 || ev.observedAt>now+5000 || !(ins.dataBasis.trackCount>0))continue;
    const econ=ins.economics;
    const priced=['shelf','economics'].includes(econ?.basis) && ['conservative','expected','aggressive'].every(k=>Number.isFinite(econ.range?.[k])&&econ.range[k]>=0);
    const key=roi.id, vertices=roi.vertices;
    const item={key,name:roi.name,x:vertices.reduce((s,p)=>s+p[0],0)/vertices.length,z:vertices.reduce((s,p)=>s+p[1],0)/vertices.length,
      polygons:[vertices],selection:{id:key,name:roi.name,vertices,businessKind:'opportunity'},ins,econ,priced,
      score:priced?econ.range.expected:0};
    if(!byId.has(key)||item.score>byId.get(key).score)byId.set(key,item);
  }
  return [...byId.values()].sort((a,b)=>b.score-a.score);
}
const signals=[['avoidance','Passing through'],['engagement_with_POI','Stopping near products'],['hesitation','Stop–start movement'],['confusion','Backtracking / turning'],['waiting_queueing','Waiting pattern']];
const actions={layout:'Test a clearer or more visible product placement.',pricing:'Test a clearer price or promotion; movement alone cannot establish a price objection.',wayfinding:'Check category signs and product findability.',crossmerch:'Test a complementary product pairing.',staffing:'Check lane capacity and service conditions before reallocating staff.'};
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
export function renderValuePanel(panel,{areas,selection,scope,note,busy,load,select,back,stamp,legacy}) {
  panel.replaceChildren();
  const add=(tag,text,cls)=>{const n=node(tag,text,cls);panel.append(n);return n;};
  const btn=(text,fn,parent=panel)=>{const b=node('button',text);b.onclick=fn;parent.append(b);return b;};
  add('div','PROFIT RADAR / VALUE OPPORTUNITIES','analysis-kicker');
  add('h2',scope==='current'?'Current recovery scenarios':'Where to investigate value');
  add('p',scope==='current'?`Current radar snapshot · ${stamp}. The flow map is historical context, not evidence for these scenarios.`:'Selected flow period · behavioural screening, not a profit estimate.','analysis-context');
  const controls=add('div',null,'value-scope');
  if(scope==='current')btn('Back to selected flow period',back,controls);
  btn(busy?'Checking current radar…':'Load current Profit Radar',load,controls).disabled=busy;
  if(note)add('p',note,'value-notice');
  const chosen=areas.find(a=>a.key===selection?.id);
  const a=chosen || areas[0];
  if(!a){add('h3','No verified opportunities available');add('p','Current observations must match this venue, be fresh, and locate a configured area. Synthetic examples are excluded.');return;}
  const card=add('div',null,'business-finding');
  card.append(node('span',a.screening?'FLOW EVIDENCE + LEGACY MARGIN MODEL':a.priced?'MODELLED GROSS MARGIN · NOT REALISED PROFIT':'BEHAVIOURAL EVIDENCE · FINANCIAL INPUTS MISSING','value-label'),node('h3',a.name));
  if(a.screening) {
    card.append(node('p',`${Math.round(a.stats.slowShare*100)}% of observed presence is slow. The remaining ${Math.round((1-a.stats.slowShare)*100)}% is not slow. Review this alongside the concentration of movement here.`));
    const estimate=legacy?legacyValue(a,legacy):null;
    if(estimate){add('strong',`€${Math.round(estimate.euroDay).toLocaleString()} / day`,'value-money');add('p','Original windflow margin scenario · strongest frontage in this department. Traffic × engagement gap × assumed category margin. This is an illustrative model, not measured lost profit.','value-notice');}
    add('p','Check visibility, availability and whether this is intended as a through-route. Low stopping alone does not establish missed sales.','value-notice');
  } else {
    if(a.priced){add('strong',money(a,a.econ.range.conservative)+'–'+money(a,a.econ.range.aggressive)+' / day','value-money');add('p',`Expected scenario ${money(a,a.econ.range.expected)} / day at 60% model effort. Scenario range, not a confidence interval.`);}
    const evidence=add('section',null,'value-signals');evidence.append(node('h3','Behaviour behind the opportunity'));
    signals.map(([key,label])=>({key,label,value:a.econ?.axes?.[key]})).filter(s=>Number.isFinite(s.value)).sort((a,b)=>b.value-a.value).slice(0,3).forEach(s=>{
      const row=node('div',null,'value-signal');row.append(node('span',s.label),node('strong',`${Math.round(s.value*100)}/100`));
      const meter=node('meter');meter.min=0;meter.max=1;meter.value=s.value;meter.setAttribute('aria-label',s.label);row.append(meter);evidence.append(row);
    });
    evidence.append(node('small',`${a.ins.dataBasis.trackCount} current tracks · movement-derived scores, not percentages of shoppers or confirmed intent.`));
    add('div','SUGGESTED EXPERIMENT','value-label');add('p',actions[a.econ?.recommendedLeverId] || 'Inspect the observed movement pattern before choosing an intervention.');
    if(a.priced && a.econ.levers?.length){
      const choices=add('details',null,'business-evidence');choices.append(node('summary','Compare action scenarios'));
      choices.append(node('p','Each action uses the same inputs and 60% model effort. Alternatives cannot be added together.'));
      a.econ.levers.filter(l=>Number.isFinite(l.perDay)&&l.perDay>=0).forEach(l=>{const row=node('p');row.append(node('strong',l.leverLabel || l.leverId),node('span',` · ${money(a,l.perDay)} / day modelled`));choices.append(row);});
    }
    if(a.priced){const d=add('details',null,'business-evidence');d.append(node('summary','How the estimate is built'));d.append(node('p',`${a.econ.exposedPerDay} estimated exposures/day × conversion-gap proxy × action capture × winnable share × ${money(a,a.econ.marginPerUnit)} margin/unit. Exposure and conversion remain modelled even with configured SKU margins.`));d.append(node('p','Alternative actions are mutually exclusive scenarios. Do not add their values or overlapping zone estimates. Test the action, then measure comparable before/after behaviour and commercial results.'));}
  }
  add('h3',chosen?'Other places to review':'Priority places');
  areas.slice(0,5).forEach((area,i)=>{const b=btn('',()=>select(area));b.className='business-place'+(chosen?.key===area.key?' selected':'');b.append(node('span',String(i+1),'business-number'),node('strong',area.name),node('small',area.screening?(legacy && legacyValue(area,legacy)?`€${Math.round(legacyValue(area,legacy).euroDay).toLocaleString()} / day · legacy model`:'Movement / stopping screening'):area.priced?`${money(area,area.econ.range.expected)} / day · modelled`:'Investigation · no financial estimate'));});
  add('p',scope==='current'?'One scenario per mapped area. This is a snapshot; refresh to check current conditions.':'Screening ranks movement per observed m² × share of presence not slow. It is a review order, not a loss or conversion metric.','value-notice');
}
function money(a,value){const cur=a.econ.currency==='€'?'EUR':a.econ.currency || 'EUR';try{return new Intl.NumberFormat('en',{style:'currency',currency:cur,maximumFractionDigits:0}).format(value);}catch{return `${Math.round(value)} ${cur}`;}}
