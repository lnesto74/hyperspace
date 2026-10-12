// Presentation adapter only. All population, duration and threshold calculations
// remain in ExecutiveJourneyService, the source of the customer journey report.
const number = value => Number.isFinite(value) ? value : null;
export function fromExecutiveJourney(journey, expected) {
  if (!journey || journey.venueId !== expected.venueId || journey.range?.startTs !== expected.startTs || journey.range?.endTs !== expected.endTs)
    throw Error('The report response does not match the requested venue and period.');
  const o=journey.overview, a=journey.aisles, c=journey.checkout;
  if (!o || !a || !Array.isArray(c?.channels) || !Array.isArray(journey.fresco?.departments)) throw Error('Incomplete customer journey response.');
  const channels=c.channels;
  const traditional=channels.find(ch=>ch.id==='traditional') || channels[0];
  return {
    schema:'executive-service-v1', venueId:journey.venueId, day:expected.day,
    window:expected.window, source:'Customer journey calculation service', generatedAt:journey.generatedAt,
    thresholds:journey.metricThresholds, geometry:journey.categoryPresence,
    overview:{entrants:number(o.perimeterEntrants),stoppingPct:number(a.stoppingPowerPct),shoppingDwellMin:o.avgStoreDwellReliable?number(o.avgStoreDwellMin):null,avgWaitSec:number(c.avgWaitSec),engagementPct:number(a.engagementRatePct),passThroughPct:number(a.passThroughPct),penetrationPct:number(a.penetrationPct),bypassPct:number(a.bypassPct),friction:number(c.frictionScore)},
    departments:[...journey.fresco.departments.map(d=>({name:d.label,section:'fresco',roiIds:d.roiIds,crossings:number(d.visits),stops:d.reportable?number(d.dwellVisits):null,stoppingPct:d.reportable?number(d.stoppingPct ?? d.browsingPct):null,dwellSec:d.dwellReliable?number(d.medianDwellSec):null,engagementSec:d.engagementReliable?number(d.medianEngagementSec):null,dwellMetric:d.dwellMetric,episodes:d.episodes,unavailableReason:d.dwellUnavailableReason})),...(a.categoryGroups || []).map(d=>({name:d.category,section:'category',crossings:number(d.visits),stoppingPct:number(d.stoppingPowerPct),dwellSec:number(d.avgDwellSec ?? (d.avgDwellMin == null?null:d.avgDwellMin*60)),engagementSec:null,engagementPct:number(d.engagementRatePct)}))],
    checkout:{label:traditional?.label,completed:number(traditional?.completed),sessions:number(traditional?.sessions),avgWaitSec:number(traditional?.avgWaitSec),abandonPct:number(traditional?.abandonPct)},
    lanes:channels.flatMap(ch=>(ch.lanes || []).map(l=>({lane:Number(l.label.match(/\d+/)?.[0]),name:l.label,roiIds:l.roiIds,channel:ch.label,channelAvgWaitSec:number(ch.avgWaitSec),shoppers:number(l.sessions),avgWaitSec:number(l.avgWaitSec ?? (l.avgWaitMin == null?null:l.avgWaitMin*60)),abandonPct:number(l.abandonPct)}))),
  };
}
export const ATTACHED_REPORT_RANGE={day:'2026-09-14',startTs:Date.parse('2026-09-14T00:00:00+02:00'),endTs:Date.parse('2026-09-14T23:30:00+02:00'),window:'00:00–23:30 Europe/Rome'};
export async function loadExecutiveReport(venueId, fetcher=fetch) {
  const expected={...ATTACHED_REPORT_RANGE,venueId};
  const query=new URLSearchParams({personaId:'esselunga-executive',venueId,startTs:String(expected.startTs),endTs:String(expected.endTs),variant:'hq',dwellThresholdSec:'5',engagementRankSec:'15',queueFloorSec:'10'});
  const response=await fetcher('/api/reporting/summary?'+query,{credentials:'include'});
  if(!response.ok)throw Error('Customer journey calculation service unavailable');
  const payload=await response.json();
  return fromExecutiveJourney(payload.supporting?.esselungaJourney,expected);
}
