// Continuous envelope / interpolated occlusion boundary. Rendering is independent
// of the 25 cm accounting grid: never expose square cells as the visible boundary.
import { screenFaces, toWorld, evaluateViewer } from './media-visibility-geometry.js';
import { inPolygon } from './retail-geometry.js';

export function buildVisibilitySurface(pose,screen,c,proxies,bounds) {
  const step=.25,r=Math.min(c.maxDistance,c.legibilityDistance??Infinity)+screen.frontZ;
  const near=proxies.filter(p=>p.maxX>=pose.x-r&&p.minX<=pose.x+r&&p.maxZ>=pose.z-r&&p.minZ<=pose.z+r);
  const faces=screenFaces(pose,c).map(f=>({...f,center:toWorld(f,0,screen.centerY,screen.frontZ)}));
  const sh=Math.sin(c.horizontal*Math.PI/360),ch=Math.cos(c.horizontal*Math.PI/360);
  const sv=Math.sin(c.vertical*Math.PI/360),cv=Math.cos(c.vertical*Math.PI/360);
  function sample(p){
    let eligible=-Infinity;
    for(const f of faces){
      const dx=p[0]-f.center.x,dy=p[1]-f.center.y,dz=p[2]-f.center.z;
      const forward=dx*Math.sin(f.yaw)+dz*Math.cos(f.yaw),lateral=dx*Math.cos(f.yaw)-dz*Math.sin(f.yaw),distance=Math.hypot(dx,dy,dz);
      eligible=Math.max(eligible,Math.min(forward,forward*sh-Math.abs(lateral)*ch,Math.hypot(dx,dz)*sv-Math.abs(dy)*cv,distance-c.minDistance,Math.min(c.maxDistance,c.legibilityDistance??Infinity)-distance));
    }
    if(bounds)eligible=Math.min(eligible,p[0]-bounds.minX,bounds.maxX-p[0],p[2]-bounds.minZ,bounds.maxZ-p[2]);
    const interior=near.some(b=>p[0]>=b.minX&&p[0]<=b.maxX&&p[2]>=b.minZ&&p[2]<=b.maxZ&&inPolygon(p[0],p[2],b.polygon));
    if(interior)return {p,e:-step,v:-step,fraction:0,blocked:true};
    if(eligible<=0)return {p,e:eligible,v:eligible,fraction:0,blocked:false};
    const result=evaluateViewer({x:p[0],y:p[1],z:p[2]},pose,screen,c,near);
    return {p,e:eligible,v:result.visible?eligible:-step,fraction:result.fraction,blocked:!result.visible};
  }
  const edges=new Map();
  function crossing(a,b,key){
    const cacheKey=`${key}:${a.p.join(',')}:${b.p.join(',')}`;
    if(edges.has(cacheKey))return edges.get(cacheKey);
    let t=a[key]/(a[key]-b[key]);
    // Occlusion is discontinuous: locate the actual change instead of rounding
    // or blurring through a shelf. Analytic angle/range boundaries interpolate.
    if(a.blocked||b.blocked){let lo=0,hi=1;for(let i=0;i<7;i++){const mid=(lo+hi)/2,p=a.p.map((v,k)=>v+(b.p[k]-v)*mid),v=sample(p)[key];if((v>0)===(a[key]>0))lo=mid;else hi=mid;}t=(lo+hi)/2;}
    const result={p:a.p.map((v,i)=>v+(b.p[i]-v)*t),e:0,v:0,fraction:a.fraction+(b.fraction-a.fraction)*t};
    edges.set(cacheKey,result);return result;
  }
  function clip(tri,key){const out=[];for(let i=0;i<3;i++){const a=tri[i],b=tri[(i+1)%3];if(a[key]>0)out.push(a);if((a[key]>0)!==(b[key]>0))out.push(crossing(a,b,key));}return out;}
  function fan(out,poly){for(let i=1;i+1<poly.length;i++)out.push(...poly[0].p,...poly[i].p,...poly[i+1].p);}
  const x0=Math.floor((pose.x-r-step)/step)*step,z0=Math.floor((pose.z-r-step)/step)*step;
  const nx=Math.ceil((pose.x+r+step-x0)/step)+1,nz=Math.ceil((pose.z+r+step-z0)/step)+1;
  const planeCache=new Map();
  function plane(y){if(planeCache.has(y))return planeCache.get(y);const nodes=[];for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)nodes.push(sample([x0+x*step,y,z0+z*step]));planeCache.set(y,nodes);return nodes;}
  const floor=[],partial=[],eligible=[],volume=[],outline=[];
  function floorAt(y,outputY,visibleOut,partialOut=null,eligibleOut=null,edgeOut=null){
    const nodes=plane(y);
    for(let z=0;z<nz-1;z++)for(let x=0;x<nx-1;x++){
      const i=z*nx+x;
      for(const tri of [[nodes[i],nodes[i+1],nodes[i+nx+1]],[nodes[i],nodes[i+nx+1],nodes[i+nx]]]){
        const polygon=clip(tri,'v'),visible=polygon.map(n=>({...n,p:[n.p[0],outputY,n.p[2]]}));
        const target=partialOut&&tri.some(n=>n.v>0&&n.fraction<1)?partialOut:visibleOut;fan(target,visible);
        if(eligibleOut)fan(eligibleOut,clip(tri,'e').map(n=>({...n,p:[n.p[0],outputY-.002,n.p[2]]})));
        if(edgeOut){const cuts=[];for(let k=0;k<3;k++){const a=tri[k],b=tri[(k+1)%3];if((a.v>0)!==(b.v>0)){const n=crossing(a,b,'v');cuts.push(n.p[0],outputY+.003,n.p[2]);}}if(cuts.length===6)edgeOut.push(...cuts);}
      }
    }
  }
  floorAt(c.eyeHeight,.11,floor,partial,eligible,outline);
  if(c.eyeMax>c.eyeMin){
    const count=Math.max(1,Math.ceil((c.eyeMax-c.eyeMin)/.15)),ys=Array.from({length:count+1},(_,i)=>c.eyeMin+(c.eyeMax-c.eyeMin)*i/count);
    floorAt(c.eyeMin,c.eyeMin,volume,null,null,outline);floorAt(c.eyeMax,c.eyeMax,volume,null,null,outline);
    // Matching tetrahedral splits prevent cracks between neighbouring cells.
    const tets=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
    for(let layer=0;layer<count;layer++){
      const lo=plane(ys[layer]),hi=plane(ys[layer+1]);
      for(let z=0;z<nz-1;z++)for(let x=0;x<nx-1;x++){
        const i=z*nx+x,n=[lo[i],lo[i+1],lo[i+nx+1],lo[i+nx],hi[i],hi[i+1],hi[i+nx+1],hi[i+nx]];
        if(n.every(v=>v.v>0)||n.every(v=>v.v<=0))continue;
        for(const indices of tets){const ins=indices.map(i=>n[i]).filter(v=>v.v>0),outs=indices.map(i=>n[i]).filter(v=>v.v<=0);if(!ins.length||!outs.length)continue;
          if(ins.length===1)fan(volume,outs.map(b=>crossing(ins[0],b,'v')));
          else if(outs.length===1)fan(volume,ins.map(a=>crossing(a,outs[0],'v')));
          else {const [a,b]=ins,[d,e]=outs;fan(volume,[crossing(a,d,'v'),crossing(a,e,'v'),crossing(b,e,'v'),crossing(b,d,'v')]);}
        }
      }
    }
  }
  return {floor,partial,eligible,volume,outline,method:'continuous-envelope / refined-occlusion isosurface',step};
}
