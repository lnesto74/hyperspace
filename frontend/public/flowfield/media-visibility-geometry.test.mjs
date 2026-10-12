import test from 'node:test';
import assert from 'node:assert/strict';
import { visibilitySettings, toWorld, proxy, intersectPrism, evaluateViewer, sampleFootprint, observedPositions, polygonsOverlap } from './media-visibility-geometry.js';
const pose={x:0,z:0,yaw:0},screen={width:.685,height:1.218,centerY:1.24,frontZ:.091},c=visibilitySettings();
const box=(x0,z0,x1,z1,h,id='shelf')=>proxy([[x0,z0],[x1,z0],[x1,z1],[x0,z1]],h,id);
test('front/back, distance, angular and eye-height gates',()=>{
  assert.equal(evaluateViewer({x:0,y:1.6,z:4},pose,screen,c).fraction,1);
  for(const p of [{x:0,y:1.6,z:-4},{x:0,y:1.6,z:9},{x:7,y:1.6,z:1},{x:0,y:2,z:4}])assert.equal(evaluateViewer(p,pose,screen,c).eligible,false);
  assert.equal(evaluateViewer({x:0,y:1.6,z:4},pose,screen,visibilitySettings({legibilityDistance:3})).visible,false);
});
test('rotation and translation preserve visibility in venue coordinates',()=>{
  const rotated={x:22,z:60,yaw:Math.PI/2},v=toWorld(rotated,0,1.6,4);
  assert.equal(evaluateViewer(v,rotated,screen,c).fraction,1);
  assert.equal(evaluateViewer(toWorld(rotated,0,1.6,-4),rotated,screen,c).visible,false);
});
test('shelves block nine rays; low islands permit sight over their tops',()=>{
  const v={x:0,y:1.6,z:4};
  assert.equal(evaluateViewer(v,pose,screen,c,[box(-1,1,1,2,2)]).fraction,0);
  assert.equal(evaluateViewer(v,pose,screen,c,[box(-1,1,1,2,.4)]).fraction,1);
  const partial=evaluateViewer(v,pose,screen,c,[box(-1,1,1,2,1.2)]);
  assert(partial.fraction>0&&partial.fraction<1);
  assert.equal(evaluateViewer(v,pose,screen,{...c,occlusion:false},[box(-1,1,1,2,2)]).fraction,1);
});
test('non-convex prisms, vertical rays, starting inside and behind-target obstacles',()=>{
  const p=proxy([[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]],2,'L');
  assert.equal(intersectPrism({x:1.5,y:1,z:1.5},{x:1.5,y:1,z:3},p),null);
  assert.notEqual(intersectPrism({x:.5,y:3,z:.5},{x:.5,y:0,z:.5},p),null);
  assert.equal(intersectPrism({x:.5,y:1,z:.5},{x:3,y:1,z:.5},p),0);
  assert.equal(evaluateViewer({x:0,y:1.6,z:4},pose,screen,c,[box(-1,-2,1,-1,2)]).fraction,1);
});
test('footprint reports sampled areas, excludes fixture interiors and clips venue bounds',()=>{
  const b={minX:-4,maxX:4,minZ:-4,maxZ:5},p=box(-1,1,1,2,2);
  const a=sampleFootprint(pose,screen,{...c,maxDistance:4},[],b),blocked=sampleFootprint(pose,screen,{...c,maxDistance:4},[p],b);
  assert(a.visibleArea>blocked.visibleArea);
  assert(blocked.cells.every(v=>!(v.x>-1&&v.x<1&&v.z>1&&v.z<2)));
  assert.equal(a.visibleArea,a.cells.length*c.resolution**2);
});
test('invalid controls are rejected rather than producing misleading fields',()=>{
  for(const input of [{horizontal:180},{maxDistance:0},{eyeHeight:3},{resolution:0},{maxDistance:Infinity}])assert.throws(()=>visibilitySettings(input));
});
test('trajectory association requires validated metadata and reports only valid samples',()=>{
  const points=[{x:0,z:3,timestamp:5,quality:'valid'},{x:0,z:-3,timestamp:6,quality:'valid'},{x:0,z:3,timestamp:7,quality:'unreliable'}];
  assert.equal(observedPositions(points,{},pose,screen,c,[]).available,false);
  const result=observedPositions(points,{validated:true,venueMatched:true,name:'test fixture',window:[0,10]},pose,screen,c,[]);
  assert.equal(result.accepted,2);assert.equal(result.visible,1);assert.equal(result.rejected,1);assert.equal(result.unit,'position samples');assert.equal(result.attentionMeasured,false);
});

test('placement collision includes crossed thin footprints without contained vertices',()=>{
  const horizontal=[[-2,-.1],[2,-.1],[2,.1],[-2,.1]],vertical=[[-.1,-2],[.1,-2],[.1,2],[-.1,2]];
  assert.equal(polygonsOverlap(horizontal,vertical),true);
  assert.equal(polygonsOverlap(horizontal,vertical.map(([x,z])=>[x+3,z])),false);
});
test('malformed trajectory time windows cannot expose counts',()=>{
  for(const window of [[],[10,0],[0,0],[0,Infinity],['0','10']])assert.equal(observedPositions([],{validated:true,venueMatched:true,name:'fixture',window},pose,screen,c,[]).available,false);
});
test('double-sided displays use a separately oriented rear screen and count the union once',()=>{
  const double=visibilitySettings({sides:2}),behind={x:0,y:1.6,z:-4};
  assert.equal(evaluateViewer(behind,pose,screen,c).visible,false);
  const rear=evaluateViewer(behind,pose,screen,double);assert.equal(rear.visible,true);assert.equal(rear.face,'rear');
  assert(rear.rays.every(ray=>Math.abs(ray.target.z+screen.frontZ)<1e-10));
  const front=evaluateViewer({x:0,y:1.6,z:4},pose,screen,double);assert.equal(front.face,'front');
  const rotated={x:10,z:20,yaw:Math.PI/2};assert.equal(evaluateViewer(toWorld(rotated,0,1.6,-4),rotated,screen,double).face,'rear');
  const wall=box(-1,-2,1,-1,2);
  assert.equal(evaluateViewer(behind,pose,screen,double,[wall]).fraction,0);
  assert.equal(evaluateViewer({x:0,y:1.6,z:4},pose,screen,double,[wall]).fraction,1);
  const footprint=sampleFootprint(pose,screen,double,[],null),keys=footprint.cells.map(v=>`${v.x},${v.z}`);
  assert.equal(new Set(keys).size,keys.length);
  const samples=[{x:0,z:4,timestamp:1,quality:'valid'},{x:0,z:-4,timestamp:2,quality:'valid'}];
  assert.equal(observedPositions(samples,{validated:true,venueMatched:true,name:'fixture',window:[0,3]},pose,screen,double,[]).visible,2);
  assert.throws(()=>visibilitySettings({sides:3}));
});
