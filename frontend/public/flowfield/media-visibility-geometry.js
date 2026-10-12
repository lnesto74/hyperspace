// Venue metres, Y up. Pure geometry: no flow particles, gaze or audience inference.
import { inPolygon } from './retail-geometry.js';

export const DEFAULT_VISIBILITY = Object.freeze({ sides:1, horizontal:120, vertical:100, minDistance:.5, maxDistance:8, eyeMin:1.2, eyeMax:1.8, eyeHeight:1.6, resolution:.25, occlusion:true, legibilityDistance:null });
export function visibilitySettings(input={}) {
  const c={...DEFAULT_VISIBILITY,...input};
  for(const k of ['horizontal','vertical','minDistance','maxDistance','eyeMin','eyeMax','eyeHeight','resolution']) if(!Number.isFinite(c[k])) throw new Error('Invalid visibility setting: '+k);
  if(c.horizontal<=0||c.horizontal>=180||c.vertical<=0||c.vertical>=180||c.minDistance<0||c.maxDistance<=c.minDistance||c.maxDistance>30||c.eyeMin<.3||c.eyeMax<c.eyeMin||c.eyeHeight<c.eyeMin||c.eyeHeight>c.eyeMax||c.resolution<.1||c.resolution>1) throw new Error('Visibility assumptions outside supported range');
  if(![1,2].includes(c.sides))throw new Error('Screen sides must be one or two');
  if(c.legibilityDistance!==null&&(!Number.isFinite(c.legibilityDistance)||c.legibilityDistance<=0))throw new Error('Invalid legibility distance');
  return c;
}
export function toWorld(pose,x,y,z) {
  const c=Math.cos(pose.yaw),s=Math.sin(pose.yaw);
  return {x:pose.x+c*x+s*z,y:y+(pose.y||0),z:pose.z-s*x+c*z};
}
export function screenSamples(pose,screen) {
  const points=[];
  // Inset nine surface samples avoid frame edges; partial visibility is a sample fraction.
  for(const u of [-.44,0,.44])for(const v of [-.44,0,.44]) points.push(toWorld(pose,u*screen.width,screen.centerY+v*screen.height,screen.frontZ));
  return points;
}
export function proxy(polygon,height,id) {
  return {polygon,height,id,minX:Math.min(...polygon.map(p=>p[0])),maxX:Math.max(...polygon.map(p=>p[0])),minZ:Math.min(...polygon.map(p=>p[1])),maxZ:Math.max(...polygon.map(p=>p[1]))};
}
// Include edge crossings as well as containment (two thin rectangles can cross
// without either polygon containing a vertex of the other).
export function polygonsOverlap(a,b) {
  if(a.some(([x,z])=>inPolygon(x,z,b))||b.some(([x,z])=>inPolygon(x,z,a)))return true;
  const cross=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    if(Math.max(p[0],q[0])<Math.min(r[0],s[0])||Math.max(r[0],s[0])<Math.min(p[0],q[0])||Math.max(p[1],q[1])<Math.min(r[1],s[1])||Math.max(r[1],s[1])<Math.min(p[1],q[1]))continue;
    if(cross(p,q,r)*cross(p,q,s)<=0&&cross(r,s,p)*cross(r,s,q)<=0)return true;
  }
  return false;
}
// Exact segment intersection with a vertical extrusion of an arbitrary simple CAD polygon.
// Interval testing supports non-convex outlines and rays beginning inside a proxy.
export function intersectPrism(a,b,p) {
  if(Math.max(a.x,b.x)<p.minX||Math.min(a.x,b.x)>p.maxX||Math.max(a.z,b.z)<p.minZ||Math.min(a.z,b.z)>p.maxZ||Math.min(a.y,b.y)>p.height||Math.max(a.y,b.y)<0)return null;
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,ts=[0,1];
  if(Math.abs(dy)>1e-12)for(const y of [0,p.height]){const t=(y-a.y)/dy;if(t>0&&t<1)ts.push(t);}
  for(let i=0;i<p.polygon.length;i++){
    const u=p.polygon[i],v=p.polygon[(i+1)%p.polygon.length],ex=v[0]-u[0],ez=v[1]-u[1],det=dx*ez-dz*ex;
    if(Math.abs(det)<1e-12)continue;
    const qx=u[0]-a.x,qz=u[1]-a.z,t=(qx*ez-qz*ex)/det,w=(qx*dz-qz*dx)/det;
    if(t>0&&t<1&&w>=0&&w<=1)ts.push(t);
  }
  ts.sort((x,y)=>x-y);
  for(let i=1;i<ts.length;i++){
    if(ts[i]-ts[i-1]<1e-10)continue;
    const t=(ts[i]+ts[i-1])/2,y=a.y+dy*t;
    if(y>=0&&y<=p.height&&inPolygon(a.x+dx*t,a.z+dz*t,p.polygon))return Math.max(0,ts[i-1]);
  }
  return null;
}
export function nearestBlock(a,b,proxies) {
  let best=null;
  for(const p of proxies){const t=intersectPrism(a,b,p);if(t!==null&&t<.999999&&(!best||t<best.t))best={id:p.id,t,point:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t}};}
  return best;
}
export function screenFaces(pose,settings) {
  return [{...pose,face:'front'},...(settings.sides===2?[{...pose,yaw:pose.yaw+Math.PI,face:'rear'}]:[])];
}
export function evaluateViewer(viewer,pose,screen,settings,proxies=[]) {
  const faces=screenFaces(pose,settings).map(face=>({...evaluateFace(viewer,face,screen,settings,proxies),face:face.face}));
  return faces.find(f=>f.visible)||faces.find(f=>f.eligible)||faces[0];
}
function evaluateFace(viewer,pose,screen,settings,proxies=[]) {
  const c=settings,center=toWorld(pose,0,screen.centerY,screen.frontZ);
  const dx=viewer.x-center.x,dz=viewer.z-center.z,dy=viewer.y-center.y;
  const forward=dx*Math.sin(pose.yaw)+dz*Math.cos(pose.yaw),lateral=dx*Math.cos(pose.yaw)-dz*Math.sin(pose.yaw),distance=Math.hypot(dx,dy,dz);
  let reason=null;
  if(![viewer.x,viewer.y,viewer.z].every(Number.isFinite))reason='invalid position';
  else if(viewer.y<c.eyeMin||viewer.y>c.eyeMax)reason='outside assumed eye heights';
  else if(forward<=0)reason='behind screen';
  else if(distance<c.minDistance||distance>Math.min(c.maxDistance,c.legibilityDistance??Infinity))reason='outside distance';
  else if(Math.abs(Math.atan2(lateral,forward))*180/Math.PI>c.horizontal/2)reason='outside horizontal envelope';
  else if(Math.abs(Math.atan2(dy,Math.hypot(dx,dz)))*180/Math.PI>c.vertical/2)reason='outside vertical envelope';
  const samples=screenSamples(pose,screen);
  if(reason)return {eligible:false,visible:false,fraction:0,reason,distance,rays:[]};
  const rays=samples.map(target=>({target,block:c.occlusion?nearestBlock(viewer,target,proxies):null}));
  const clear=rays.filter(r=>!r.block).length;
  return {eligible:true,visible:clear>0,fraction:clear/rays.length,clear,total:rays.length,reason:clear===9?'unobstructed':clear?'partly obstructed':'obstructed',distance,rays};
}
export function sampleFootprint(pose,screen,settings,proxies,bounds) {
  const c=visibilitySettings(settings),r=c.maxDistance,step=c.resolution,cells=[];
  let eligible=0,visible=0,partial=0;
  // Broad-phase once per placement: decorative mesh count never enters ray testing.
  const nearby=proxies.filter(p=>p.maxX>=pose.x-r&&p.minX<=pose.x+r&&p.maxZ>=pose.z-r&&p.minZ<=pose.z+r);
  for(let x=Math.ceil((pose.x-r)/step)*step+step/2;x<pose.x+r;x+=step)for(let z=Math.ceil((pose.z-r)/step)*step+step/2;z<pose.z+r;z+=step){
    if(bounds&&(x-step/2<bounds.minX||x+step/2>bounds.maxX||z-step/2<bounds.minZ||z+step/2>bounds.maxZ))continue;
    // Floor footprint excludes fixture interiors, even with occlusion disabled.
    if(nearby.some(p=>x>=p.minX&&x<=p.maxX&&z>=p.minZ&&z<=p.maxZ&&inPolygon(x,z,p.polygon)))continue;
    const result=evaluateViewer({x,y:c.eyeHeight,z},pose,screen,c,nearby);
    if(!result.eligible)continue;
    eligible++;if(result.visible)visible++;if(result.fraction>0&&result.fraction<1)partial++;
    cells.push({x,z,fraction:result.fraction});
  }
  return {cells,eligibleArea:eligible*step*step,visibleArea:visible*step*step,partialArea:partial*step*step,resolution:step,eyeHeight:c.eyeHeight,proxies:nearby.length};
}
// Explicit quality-gated positions only. Counts samples, never people/impressions/events.
export function observedPositions(samples,source,pose,screen,settings,proxies) {
  if(!source?.validated||!source.venueMatched||!Array.isArray(source.window)||source.window.length!==2||!source.window.every(Number.isFinite)||source.window[1]<=source.window[0]||!source.name)return {available:false,reason:'No validated venue-matched trajectory window connected'};
  let accepted=0,visible=0,rejected=0;
  for(const p of samples){
    if(p.quality!=='valid'||!Number.isFinite(p.timestamp)||p.timestamp<source.window[0]||p.timestamp>source.window[1]||!Number.isFinite(p.x)||!Number.isFinite(p.z)){rejected++;continue;}
    accepted++;if(evaluateViewer({x:p.x,z:p.z,y:settings.eyeHeight},pose,screen,settings,proxies).visible)visible++;
  }
  return {available:true,accepted,visible,rejected,source:source.name,window:source.window,unit:'position samples',eyeHeightAssumed:settings.eyeHeight,attentionMeasured:false};
}
