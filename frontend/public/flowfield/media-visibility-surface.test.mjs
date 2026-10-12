import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVisibilitySurface} from './media-visibility-surface.js';
import {visibilitySettings,proxy} from './media-visibility-geometry.js';
const pose={x:0,z:0,yaw:0},screen={width:.685,height:1.218,centerY:1.25,frontZ:.096};
function area(vertices){let a=0;for(let i=0;i<vertices.length;i+=9)a+=Math.abs((vertices[i+3]-vertices[i])*(vertices[i+8]-vertices[i+2])-(vertices[i+6]-vertices[i])*(vertices[i+5]-vertices[i+2]))/2;return a;}
test('continuous floor follows the circular envelope instead of square grid edges',()=>{
  const c=visibilitySettings({occlusion:false}),mesh=buildVisibilitySurface(pose,screen,c,[],null);
  const expected=(c.horizontal*Math.PI/180)/2*(c.maxDistance**2-c.minDistance**2);
  assert(Math.abs(area(mesh.floor)-expected)<.1);
  assert(mesh.volume.length>0&&mesh.volume.every(Number.isFinite));
  let offGrid=0;
  for(let i=0;i<mesh.outline.length;i+=3){const [x,y,z]=mesh.outline.slice(i,i+3);assert(Math.hypot(x,c.eyeHeight-screen.centerY,z-screen.frontZ)<8.02);if(Math.abs(x/.25-Math.round(x/.25))>1e-5&&Math.abs(z/.25-Math.round(z/.25))>1e-5)offGrid++;}
  assert(offGrid>30,'Contour vertices are interpolated, not rounded to cell corners');
});
test('rear field mirrors the front envelope and rotates with the device',()=>{
  const c=visibilitySettings({maxDistance:4,occlusion:false}),single=buildVisibilitySurface(pose,screen,c,[],null),double=buildVisibilitySurface(pose,screen,{...c,sides:2},[],null);
  assert(Math.abs(area(double.floor)-2*area(single.floor))<.08);
  assert(double.volume.some((v,i)=>i%3===2&&v<-.5));
  const rotated=buildVisibilitySurface({...pose,yaw:Math.PI/2},screen,c,[],null);
  assert(Math.abs(area(rotated.floor)-area(single.floor))<.08);
});
test('smoothing preserves shelf cutouts and real occlusion rather than filling through them',()=>{
  const c=visibilitySettings({maxDistance:4}),shelf=proxy([[-2,1],[2,1],[2,2],[-2,2]],2,'shelf');
  const clear=buildVisibilitySurface(pose,screen,c,[],null),blocked=buildVisibilitySurface(pose,screen,c,[shelf],null);
  assert(area(blocked.floor)<area(clear.floor)*.5);
  for(let i=0;i<blocked.floor.length;i+=9){const x=(blocked.floor[i]+blocked.floor[i+3]+blocked.floor[i+6])/3,z=(blocked.floor[i+2]+blocked.floor[i+5]+blocked.floor[i+8])/3;assert(!(Math.abs(x)<.5&&z>2&&z<3.8),'The blocked central shadow remains empty');}
});
