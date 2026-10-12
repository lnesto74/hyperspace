import {summariseCells} from './workspace-metrics.js';
import {durationLabel} from './business-analysis.js';
export function zoneKpis(cells,cellM,bins=8){
 const s=summariseCells(cells,bins);
 return {...s,area:s.supported*cellM*cellM,trackCells:cells.reduce((sum,c)=>sum+Math.max(0,Number(c.t)||0),0)};
}
export function kpiItems(s){return [
 ['Time in area',s.presence==null?'Unavailable':durationLabel(s.presence/60),'Accumulated person-time'],
 ['Time stopped / slow',durationLabel(s.dwell/60),'Accumulated person-time'],
 ['Slow-time share',s.slowShare==null?'Unavailable':`${Math.round(s.slowShare*100)}%`,'Slow time ÷ presence time'],
 ['Movement speed',s.speed==null?'Unavailable':`${s.speed.toFixed(2)} m/s`,'Weighted by movement steps'],
 ['Observed footprint',`${s.area.toFixed(1)} m²`,'Supported floor area'],
 ['Track-cell observations',Math.round(s.trackCells).toLocaleString(),'Repeated tracks across cells; not unique shoppers'],
];}
export function legacyValue(area,lookup){
 const candidates=(area.rois||[]).map(r=>lookup(r)).filter(s=>s&&Number.isFinite(s.euroDay));
 // Frontages can overlap. Show the strongest single frontage, never an invented department total.
 return candidates.sort((a,b)=>b.euroDay-a.euroDay)[0] || null;
}
