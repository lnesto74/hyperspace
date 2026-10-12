import { sampleFootprint } from './media-visibility-geometry.js';
import { buildVisibilitySurface } from './media-visibility-surface.js';
let cached=null;
self.onmessage=({data:j})=>{
  const start=performance.now();
  try{
    const key=JSON.stringify([j.installed,j.screen,j.settings,j.proxies,j.bounds]);
    if(cached?.key!==key)cached={key,current:sampleFootprint(j.installed,j.screen,j.settings,j.proxies,j.bounds,j.proxies,j.bounds)};
    const result=j.scenario?sampleFootprint(j.pose,j.screen,j.settings,j.proxies,j.bounds):cached.current;
    const surface=buildVisibilitySurface(j.pose,j.screen,j.settings,j.proxies,j.bounds);
    self.postMessage({id:j.id,current:cached.current,result,surface,cpuMs:performance.now()-start});
  }catch(e){self.postMessage({id:j.id,error:e.message});}
};
