import {test} from 'node:test';
import assert from 'node:assert/strict';
import {radarAreas,screenAreas} from './value-opportunities.js';
const now=1000000,rois=[{id:'a',name:'Shelf A',vertices:[[0,0],[1,0],[1,1]]}];
const insight=(changes={})=>({dataBasis:{roiId:'a',trackCount:3},evidence:{source:'observed',observedAt:now},economics:{basis:'shelf',range:{conservative:2,expected:4,aggressive:6}},...changes});
test('rejects wrong venue and excludes synthetic, stale, unmapped and unknown provenance',()=>{
 assert.throws(()=>radarAreas({venueId:'other'},'v',rois,now));
 const xs=[insight({evidence:{source:'synthetic',observedAt:now}}),insight({evidence:{source:'observed',observedAt:now-130000}}),insight({evidence:null}),insight({dataBasis:{roiId:'missing',trackCount:4}})];
 assert.equal(radarAreas({venueId:'v',insights:xs},'v',rois,now).length,0);
});
test('one scenario per ROI; defaults never become priced opportunities',()=>{
 const xs=[insight(),insight({economics:{basis:'shelf',range:{conservative:5,expected:8,aggressive:10}}})];
 const out=radarAreas({venueId:'v',insights:xs},'v',rois,now);assert.equal(out.length,1);assert.equal(out[0].score,8);
 const defaults=radarAreas({venueId:'v',insights:[insight({economics:{basis:'default',range:{conservative:2,expected:4,aggressive:6}}})]},'v',rois,now);assert.equal(defaults[0].priced,false);
});
test('flow screening excludes queues and absent observations; does not manufacture economics',()=>{
 const xs=screenAreas([{kind:'queue',movement:10,stats:{slowShare:.1}},{kind:'department',movement:10,stats:{slowShare:null}},{kind:'department',movement:2,stats:{slowShare:.1}}]);
 assert.equal(xs.length,1);assert.equal(xs[0].screening,true);assert.equal(xs[0].econ,undefined);
});
import {ProfitRadarEngine} from '../../../backend/services/profit-radar/profitRadarEngine.js';
test('engine marks generated shelf fillers synthetic and observed rules timestamped',()=>{
 const zone={roiId:'a',roiName:'A',trackCount:4,observedAt:now,means:{hesitation:.5,commitment:.1,avoidance:.6,engagement_with_POI:.1}};
 const engine=new ProfitRadarEngine({getZoneFieldArray:()=>[zone]},{getClusters:()=>[]});
 engine.setProductZonesProvider(()=>[{roiId:'b',roiName:'B',productCount:2}]);engine.tick();
 assert.ok(engine.insights.some(i=>i.evidence.source==='synthetic'));
 assert.ok(engine.insights.some(i=>i.evidence.source==='observed'&&i.evidence.observedAt===now));
});
test('zero recovery stays zero instead of a forced positive impact band',()=>{
 const zone={roiId:'a',trackCount:2,observedAt:now,means:{engagement_with_POI:1,commitment:1}};
 const engine=new ProfitRadarEngine({},{}),ins={id:'real',type:'underperforming_zone',dataBasis:{roiId:'a',trackCount:2}};
 engine._enrichEconomics([ins],[zone],null);assert.equal(ins.impact.min,0);assert.equal(ins.impact.max,0);
});
