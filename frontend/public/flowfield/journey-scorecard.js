const fmt=(n,d=1)=>Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:d}):'Not reported';
export const REPORT_METRICS={stoppingPct:{label:'Stopping',unit:'%',max:100},dwellSec:{label:'Category dwell',unit:'s'},engagementSec:{label:'Engagement',unit:'s'},crossings:{label:'Crossings',unit:''},avgWaitSec:{label:'Avg wait',unit:'s'}};
export function reportRow(report,area){
 if(!report||!area)return null;
 const lane=Number(area.name?.match(/(?:Checkout|Cassa)\s*(\d+)/i)?.[1]);
 const ids=(area.rois || []).map(r=>r.id);
 return (lane?report.lanes:report.departments).find(r=>r.roiIds?.some(id=>ids.includes(id))) || (lane?report.lanes.find(l=>l.lane===lane):report.departments.find(d=>d.name===area.name||(area.category&&d.name===area.category))) || null;
}
export function reportValue(row,key){return Number.isFinite(row?.[key])?`${fmt(row[key])}${REPORT_METRICS[key]?.unit || ''}`:'Not reported';}
export function rankReportAreas(areas,report,mode,key='stoppingPct'){
 const field=mode==='queues'?'avgWaitSec':mode==='moved'?'crossings':mode==='stopped'?'dwellSec':key;
 return areas.map(a=>({...a,report:reportRow(report,a)})).filter(a=>a.report && Number.isFinite(a.report[field]) && (mode==='queues'||a.report.section==='fresco'&&a.report.crossings>=30)).sort((a,b)=>b.report[field]-a.report[field]);
}
export function journeyItems(report,area){
 if(!report)return [];
 if(!area)return [['Entrants',fmt(report.overview.entrants,0),'People crossing the entrance line'],['Stopping power',`${fmt(report.overview.stoppingPct)}%`,`Aisle crossings with a pause ≥${report.thresholds?.dwellSec ?? 5}s`],['Shopping dwell',`${fmt(report.overview.shoppingDwellMin)} min`,'Median time in tracked zones per visit'],['Checkout wait',`${fmt(report.overview.avgWaitSec)}s`,'Average queue time across lanes']];
 if(area.kind==='queue-summary')return [['Avg wait',reportValue(report.checkout,'avgWaitSec'),'Traditional checkouts'],['Queue sessions',fmt(report.checkout.sessions,0),'Report window'],['Completed',fmt(report.checkout.completed,0),'Report completion definition'],['Abandon',Number.isFinite(report.checkout.abandonPct)?`${fmt(report.checkout.abandonPct)}%`:'Not reported','Report window']];
 const row=reportRow(report,area);
 const queue=/Checkout|Cassa/i.test(area.name||'');
 if(queue)return [['Avg wait',reportValue(row,'avgWaitSec'),`Queue visits ≥${report.thresholds?.queueFloorSec ?? 10} seconds`],['Shoppers',row?fmt(row.shoppers,0):'Not reported','Queue sessions in the report'],['Abandon',Number.isFinite(row?.abandonPct)?`${fmt(row.abandonPct)}%`:'Not reported','Report calculation · same window'],['Channel average',reportValue({avgWaitSec:row?.channelAvgWaitSec ?? report.checkout.avgWaitSec},'avgWaitSec'),'Same report window']];
 return [['Stopping',row?reportValue(row,'stoppingPct'):'Not reported',row?.section==='category'?'Category table · pause ≥5s':`Reached shelf face within ${report.geometry?.engagementRadiusM ?? .5} m`],[row?.section==='category'?'Avg dwell':'Category dwell',row?reportValue(row,'dwellSec'):'Not reported',row?.section==='category'?'Average in the category table':`Median within ${report.geometry?.categoryDwellRadiusM ?? 2} m among stops`],['Engagement',row?reportValue(row,'engagementSec'):'Not reported','Median time at the shelf face'],['Crossings',row?fmt(row.crossings,0):'Not reported','Zone entries lasting ≥300 ms']];
}
export function renderJourneyScorecard(host,report,area,el){
 host.replaceChildren();if(!report)return;
 host.append(el('div',`EXECUTIVE REPORT · ${report.day}`,'analysis-kicker'),el('p',`${report.window} · ${report.schema==='executive-service-v1'?'Calculated by report service':'Archived PDF · pages 1–2'}`,'journey-basis'));
 const row=reportRow(report,area);
 if(area&&!row){host.append(el('p',`${area.name} has no available KPI in this report. Select a reported department or lane; no substitute metric is used.`));return;}
 const items=journeyItems(report,area),grid=el('div',null,'zone-kpi-grid');host.append(grid);
 for(const [label,value,help] of items){const card=el('div',null,'zone-kpi');card.append(el('span',label),el('strong',value),el('small',help));grid.append(card);}
 if(row?.crossings<30)host.append(el('p',`Only ${row.crossings} crossing${row.crossings===1?'':'s'} in this report. Displayed for completeness; excluded from the performance ranking.`,'report-caution'));
 if(row?.section==='fresco'){
  host.append(el('p',`${fmt(row.stops,0)} stops reported. Stopping, dwell and engagement are separate measures; engagement is nested inside category dwell.`));
  const details=el('details');details.append(el('summary','How the report calculates these KPIs'),el('p','Stopping uses category visits reaching the shelf face, not the crossings column as denominator. Crossings count zone entries. Dwell is median category time among engaged visits; engagement is median shelf-face time. The report service reconstructs episodes, applies sample gates and selects its supported measurement method. Missing values are never replaced by slow-time share.'));host.append(details);
 }
 if(row?.lane){const average=row.channelAvgWaitSec ?? report.checkout.avgWaitSec;if(Number.isFinite(average)&&Number.isFinite(row.avgWaitSec))host.append(el('p',`${row.avgWaitSec>average?'Above':'At or below'} the ${average}s channel average. Compare lane demand and staffing before changing allocation.`));}
}
