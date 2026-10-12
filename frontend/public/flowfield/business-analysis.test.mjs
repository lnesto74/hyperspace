import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyseAreas, rankAreas, headlineFor, durationLabel } from './business-analysis.js';
const contains=(x,z,vs)=>x>=vs[0][0]&&x<=vs[1][0]&&z>=vs[0][1]&&z<=vs[2][1];
const polygon=[[0,0],[2,0],[2,1],[0,1]];
const field={i0:0,j0:0,B:2,meta:{cell_m:1},cells:[
  {i:0,j:0,e:60,d:30,k:10,s:1,r:[100,0]},
  {i:1,j:0,e:60,d:0,k:20,s:1,r:[0,100]},
]};
const toVenue=(x,z)=>({x,z});
test('department frontages use polygon union, not double-counted observations',()=>{
 const areas=analyseAreas(field,[{id:'a',category:'Frutta',vertices:polygon},{id:'b',category:'Frutta',vertices:polygon}],toVenue,contains);
 assert.equal(areas.length,1);assert.equal(areas[0].stats.presence,120);assert.equal(areas[0].stats.dwell,30);
 assert.equal(areas[0].movement,15);assert.equal(areas[0].stats.slowShare,.25);
});
test('queue rankings exclude service and sensor regions',()=>{
 const areas=analyseAreas(field,[{id:'q',name:'Checkout 1 - Queue',vertices:polygon},{id:'s',name:'Checkout 1 - Service',vertices:polygon},{id:'lidar',name:'LiDAR',vertices:polygon}],toVenue,contains);
 assert.equal(areas.length,1);assert.equal(areas[0].name,'Checkout 1');assert.equal(areas[0].kind,'queue');
});
test('unsupported or absent presence cannot become a quiet department',()=>{
 const areas=analyseAreas({...field,cells:[{i:0,j:0,k:0,d:0}]},[{category:'Fish',vertices:polygon}],toVenue,contains);
 assert.equal(areas.length,0);assert.match(headlineFor([],'hot').title,/Not enough observations/);
});
test('balance is signed percentage points and ranks either direction',()=>{
 const areas=[.1,.5,.6].map((v,i)=>({key:i,kind:'department',movement:1,stats:{slowShare:v,dwell:1}}));
 const {ranked,baseline}=rankAreas(areas,'hot');assert.equal(baseline,.5);assert.equal(ranked[0].delta,-40);
 assert.equal(rankAreas(areas,'moved').ranked[0].movementRatio,1);
});
test('operational duration labels keep accumulated time readable',()=>{
 assert.equal(durationLabel(580),'9h 40m');assert.equal(durationLabel(.1),'Less than 1 min');assert.equal(durationLabel(0),'0 min');
});
