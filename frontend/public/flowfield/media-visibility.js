import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { DEFAULT_VISIBILITY, visibilitySettings, toWorld, proxy, evaluateViewer, observedPositions, polygonsOverlap, screenFaces } from './media-visibility-geometry.js';

const CYAN=0x9edce7, BLOCKED=0x647786;
const xyz=p=>[p.x,p.y,p.z];
function clear(group){group.traverse(o=>{o.geometry?.dispose();for(const m of [].concat(o.material||[]))m.dispose();});group.clear();}
function lines(vertices,color=CYAN,opacity=.6){return new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)),new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));}
function surface(vertices,color,opacity){const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));return new THREE.Mesh(g,new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthWrite:false,side:THREE.DoubleSide}));}
function el(tag,text,attrs={}){const e=document.createElement(tag);if(text)e.textContent=text;for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);return e;}

export async function createMediaVisibility({scene,layout,renderer,fly,setFlow,getFlow,setContext}) {
  const [config,metadata,gltf,doubleGltf]=await Promise.all([fetch('./retail/totem/config.json').then(r=>r.json()),fetch('./retail/totem/occluders.json').then(r=>r.json()),new GLTFLoader().loadAsync('./retail/totem/digital-totem.glb'),new GLTFLoader().loadAsync('./retail/totem/digital-totem-double.glb')]);
  const root=new THREE.Group();root.name='Media visibility · geometric opportunity only';scene.add(root);
  const devices=new THREE.Group(),field=new THREE.Group(),rays=new THREE.Group(),debug=new THREE.Group();root.add(devices,field,rays,debug);
  const models=new Map(),screenMaterials=[],sideCounts=new Map(config.devices.map(d=>[d.id,d.screenSides??1]));
  for(const d of config.devices){
    if(JSON.stringify(layout.polys[d.cadIndex])!==JSON.stringify(d.originalPolygon))throw new Error('Totem CAD identity mismatch');
    const group=new THREE.Group();group.name=d.name;group.position.set(d.x,0,d.z);group.rotation.y=d.yaw;group.userData.deviceId=d.id;
    for(const [index,asset]of [gltf,doubleGltf].entries()){
      const model=asset.scene.clone(true);model.userData.sides=index+1;model.visible=sideCounts.get(d.id)===index+1;
      model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;o.userData.deviceId=d.id;o.material=o.material.clone();if(o.name.startsWith('CampaignScreen')){screenMaterials.push(o.material);o.material.emissiveIntensity=.65;}}});group.add(model);
    }
    devices.add(group);models.set(d.id,group);
  }
  const proxies=metadata.filter(m=>layout.polys[m.cadIndex]?.length>=3).map(m=>proxy(layout.polys[m.cadIndex],m.height,m.id));
  const state={selected:null,settings:{...DEFAULT_VISIBILITY,...config.visibility},volume:true,flow:false,lab:false,compact:true,showProxies:false,eye:null,moveEye:false,scenario:null,campaign:'Fresh every day · original demo',data:null,result:null,current:null,calculationMs:0,error:null};
  let disposed=false,timer=null,ghost=null,texture=null,video=null,mediaURL=null,savedFlow=null,job=0;
  const worker=new Worker(new URL('./media-visibility-worker.js',import.meta.url),{type:'module'});
  const pending=new Map();worker.onmessage=({data})=>{pending.get(data.id)?.(data);pending.delete(data.id);};
  worker.onerror=()=>{for(const [id,resolve]of pending)resolve({id,error:'Visibility worker unavailable'});pending.clear();};
  const panel=el('section','',{class:'media-inspector','aria-label':'Media Visibility inspector',hidden:''});
  const mount=()=>{if(document.querySelector('.hx-stage')&&!panel.isConnected)document.body.append(panel);};mount();
  const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});
  const active=()=>config.devices.find(d=>d.id===state.selected);
  const pose=()=>state.scenario||active();
  function deviceProxy(d){const q=config.dimensions;return proxy([[-q.baseWidth/2,-q.baseDepth/2],[q.baseWidth/2,-q.baseDepth/2],[q.baseWidth/2,q.baseDepth/2],[-q.baseWidth/2,q.baseDepth/2]].map(([x,z])=>{const p=toWorld(d,x,0,z);return[p.x,p.z];}),q.height,d.id);}
  function blockers(){return [...proxies,...config.devices.filter(d=>d.id!==state.selected).map(deviceProxy)];}
  function collision(p){const q=deviceProxy(p);return blockers().filter(b=>polygonsOverlap(q.polygon,b.polygon)).map(b=>b.id);}
  async function calculate(){
    if(!active()||disposed)return;
    let c;try{c=visibilitySettings(state.settings);}catch(e){state.error=e.message;state.busy=false;render();return;}
    const start=performance.now(),p=pose(),obs=blockers();state.settings=c;state.error=null;state.data=null;
    const id=++job;state.busy=true;render();
    const computed=await new Promise(resolve=>{pending.set(id,resolve);worker.postMessage({id,installed:active(),pose:p,scenario:!!state.scenario,screen:config.screen,settings:c,proxies:obs,bounds:layout.bbox});});
    if(id!==job||disposed||!active())return;
    state.busy=false;if(computed.error){state.error=computed.error;render();return;}
    state.current=computed.current;state.result=computed.result;state.workerMs=computed.cpuMs;
    clear(field);clear(debug);
    const mesh=computed.surface;
    field.add(surface(mesh.eligible,BLOCKED,.08),surface(mesh.floor,CYAN,.22),surface(mesh.partial,0x5495ae,.21));
    const shell=surface(mesh.volume,CYAN,.075);shell.name='Potential visibility · continuous boundary';field.add(shell,lines(mesh.outline,CYAN,.35));
    state.surfaceMethod=mesh.method;state.surfaceTriangles=mesh.volume.length/9;
    const edge=[];
    for(const face of screenFaces(p,c)){
      for(const r of [2,4,6,8,10,12].filter(r=>r<=Math.min(c.maxDistance,c.legibilityDistance??Infinity)))for(let i=0;i<120;i++){
        const a=(-c.horizontal/2+c.horizontal*i/120)*Math.PI/180,b=(-c.horizontal/2+c.horizontal*(i+1)/120)*Math.PI/180;
        edge.push(...xyz(toWorld(face,Math.sin(a)*r,.13,config.screen.frontZ+Math.cos(a)*r)),...xyz(toWorld(face,Math.sin(b)*r,.13,config.screen.frontZ+Math.cos(b)*r)));
      }
    }
    field.add(lines(edge,CYAN,.22));
    for(const b of obs.filter(b=>Math.hypot((b.minX+b.maxX)/2-p.x,(b.minZ+b.maxZ)/2-p.z)<c.maxDistance+3)){
      const pts=[];for(let i=0;i<b.polygon.length;i++){const a=b.polygon[i],n=b.polygon[(i+1)%b.polygon.length];pts.push(a[0],b.height,a[1],n[0],b.height,n[1],a[0],0,a[1],a[0],b.height,a[1]);}debug.add(lines(pts,0xd6b685,.35));
    }
    state.collisions=collision(p);state.calculationMs=performance.now()-start;drawEye();render();renderer.shadowMap.needsUpdate=true;
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(calculate,80);}
  function drawEye(){
    clear(rays);if(!state.eye||!active())return;
    const v={...state.eye,y:state.settings.eyeHeight};state.eye=v;state.eyeResult=evaluateViewer(v,pose(),config.screen,state.settings,blockers());
    const ball=new THREE.Mesh(new THREE.SphereGeometry(.09,12,8),new THREE.MeshBasicMaterial({color:state.eyeResult.visible?CYAN:0xd3a58f}));ball.position.set(v.x,v.y,v.z);rays.add(ball);
    rays.add(lines([v.x,0,v.z,v.x,v.y,v.z],0xe0d9ca,.7));
    for(const ray of state.eyeResult.rays){rays.add(lines([...xyz(v),...xyz(ray.block?.point||ray.target)],ray.block?0xd3a58f:CYAN,.8));if(ray.block){const dot=new THREE.Mesh(new THREE.SphereGeometry(.045,8,6),new THREE.MeshBasicMaterial({color:0xefb493}));dot.position.set(...xyz(ray.block.point));rays.add(dot);}}
  }
  function button(text,fn,pressed){const b=el('button',text,{type:'button'});if(pressed!==undefined)b.setAttribute('aria-pressed',String(pressed));b.onclick=fn;return b;}
  function number(label,value,min,max,step,fn){const wrap=el('label',label),input=el('input','',{type:'number',min,max,step,value:Number(value.toFixed(4)),'aria-label':label});input.onchange=()=>{const n=Number(input.value);if(input.validity.valid&&Number.isFinite(n)){fn(n);schedule();}};wrap.append(input);return wrap;}
  function row(label,value){const r=el('div','',{class:'media-stat'});r.append(el('span',label),el('strong',value));return r;}
  function focus(kind='context'){
    const p=pose();if(!p)return;
    const f=kind==='rear'?{...p,yaw:p.yaw+Math.PI}:p,close=['close','rear'].includes(kind);
    const center=toWorld(f,0,1.1,close?0:state.settings.sides===2?0:2.3),at=kind==='top'?{x:center.x,y:17,z:center.z+.01}:toWorld(f,close?2.3:7,close?2.1:7,close?3.8:11);
    fly(at,center);
  }
  function ghostUpdate(){
    if(ghost){root.remove(ghost);clear(ghost);ghost=null;}
    if(!state.scenario)return;
    ghost=new THREE.Group();const q=config.dimensions;
    const box=new THREE.BoxGeometry(q.width,q.height,q.depth),mesh=new THREE.Mesh(box,new THREE.MeshBasicMaterial({color:0xe4c28b,wireframe:true,transparent:true,opacity:.75}));mesh.position.y=q.height/2;ghost.add(mesh);ghost.position.set(state.scenario.x,0,state.scenario.z);ghost.rotation.y=state.scenario.yaw;root.add(ghost);
  }
  async function campaign(file){
    if(!file)return;if(!/^(image|video)\//.test(file.type)){state.error='Choose an image or video file.';render();return;}
    if(mediaURL)URL.revokeObjectURL(mediaURL);video?.pause();texture?.dispose();mediaURL=URL.createObjectURL(file);
    try{if(file.type.startsWith('video/')){video=document.createElement('video');video.src=mediaURL;video.muted=true;video.loop=true;video.playsInline=true;await video.play();texture=new THREE.VideoTexture(video);}else texture=await new THREE.TextureLoader().loadAsync(mediaURL);
      texture.colorSpace=THREE.SRGBColorSpace;texture.flipY=false;for(const m of screenMaterials){m.map=texture;m.emissiveMap=texture;m.needsUpdate=true;}state.campaign=file.name+' · local preview';state.error=null;
    }catch(e){state.error='Campaign could not be decoded: '+e.message;}render();
  }
  function render(){
    document.documentElement.classList.toggle('hx-media-active',!!state.selected);panel.hidden=!state.selected;panel.classList.toggle('is-compact',state.compact);document.documentElement.classList.toggle('hx-media-compact',state.compact);field.visible=!!state.selected&&state.volume;debug.visible=!!state.selected&&state.lab&&state.showProxies;rays.visible=!!state.selected;
    if(!state.selected)return;
    const d=active(),p=pose(),c=state.settings;panel.replaceChildren();
    const head=el('div','',{class:'media-head'}),closeButton=button('×',()=>api.close());closeButton.setAttribute('aria-label','Close media visibility');const compactButton=button(state.compact?'Show controls':'Minimise',()=>{state.compact=!state.compact;render();panel.scrollTop=0;});compactButton.className='media-compact-toggle';head.append(el('small','IN-STORE MEDIA'),compactButton,closeButton);panel.append(head,el('h2','Where the screen is visible'),el('p','Geometric opportunity to see. Attention is not measured.',{class:'media-subtitle'}));
    const select=el('select','',{'aria-label':'Digital totem'});for(const x of config.devices){const o=el('option',x.name,{value:x.id});o.selected=x.id===state.selected;select.append(o);}select.onchange=()=>api.open(select.value);panel.append(select,el('p',`${d.id.slice(0,8)} · X ${d.x.toFixed(2)} / Z ${d.z.toFixed(2)} m · source yaw ${(d.yaw*180/Math.PI).toFixed(0)}°`,{class:'media-note'}));
    const sideLabel=el('label','Screen configuration (preview)'),sideSelect=el('select','',{'aria-label':'Screen configuration'});
    for(const [value,label]of [[1,'Single-sided · front screen'],[2,'Double-sided · front + rear']]){const o=el('option',label,{value});o.selected=c.sides===value;sideSelect.append(o);}
    sideSelect.onchange=()=>{c.sides=Number(sideSelect.value);sideCounts.set(d.id,c.sides);for(const model of models.get(d.id).children)model.visible=model.userData.sides===c.sides;calculate();};sideLabel.append(sideSelect);panel.append(sideLabel,el('p',c.sides===2?'Two opposite faces · combined coverage counts each position once. Hardware option is a preview.':'One front-facing screen. Installed hardware specification awaits confirmation.',{class:'media-note'}));
    const nav=el('div','',{class:'media-buttons'});nav.append(button('Business',()=>{state.lab=false;render();},!state.lab),button('Operations / Lab',()=>{state.lab=true;render();},state.lab));panel.append(nav);
    const views=el('div','',{class:'media-buttons'});views.append(button('Close-up',()=>focus('close')),button('Rear',()=>focus('rear')),button('Context',()=>focus()),button('Top',()=>focus('top')));panel.append(views);
    const toggles=el('div','',{class:'media-buttons'});toggles.append(button('3D visibility',()=>{state.volume=!state.volume;render();},state.volume),button('Occlusion',()=>{c.occlusion=!c.occlusion;calculate();},c.occlusion),button('Flow context',()=>{state.flow=!state.flow;setFlow(state.flow);render();},state.flow));panel.append(toggles);
    const settings=el('div','',{class:'media-grid'});settings.append(number('Horizontal angle °',c.horizontal,30,170,5,n=>c.horizontal=n),number('Maximum distance m',c.maxDistance,1,12,.5,n=>c.maxDistance=n));panel.append(settings);
    if(state.busy)panel.append(el('p','Recalculating geometry…',{class:'media-note',role:'status'}));
    if(state.result&&!state.busy){panel.append(row('Viewable floor ≈',state.result.visibleArea.toFixed(1)+' m²'),row('Blocked floor ≈',(state.result.eligibleArea-state.result.visibleArea).toFixed(1)+' m²'),el('p',`Sampled at ${c.eyeHeight.toFixed(2)} m eye height · ${c.resolution} m grid. Any of 9 rays per eligible face clear; partial visibility included. Smooth boundary; area remains grid-estimated. Range arcs: 2 m.`,{class:'media-note'}));}
    if(!c.occlusion)panel.append(el('p','Occlusion disabled: coverage is an angle/distance envelope only.',{class:'media-warning'}));
    const eye=el('div','',{class:'media-buttons'});eye.append(button(state.moveEye?'Click floor to place eye':'Move test viewer',()=>{state.moveEye=!state.moveEye;render();},state.moveEye),button('Clear sight line',()=>demoEye(true)),button('Blocked sight line',()=>demoEye(false)));panel.append(eye);
    panel.append(el('p',state.eyeResult?`TEST VIEWER · ${state.eyeResult.face} face · ${state.eyeResult.reason} · ${state.eyeResult.clear??0}/9 screen rays clear${state.eyeResult.rays.find(r=>r.block)?' · '+(metadata.find(m=>m.id===state.eyeResult.rays.find(r=>r.block).block.id)?.name||'fixture'):''}`:'Test viewer is a movable demonstration marker, not a tracked customer.',{class:'media-note','data-media-eye':''}));
    if(state.lab){const lab=el('div','',{class:'media-grid'});lab.append(number('Vertical angle °',c.vertical,20,170,5,n=>c.vertical=n),number('Lowest eye height m',c.eyeMin,.6,c.eyeMax,.05,n=>{c.eyeMin=n;c.eyeHeight=Math.max(n,c.eyeHeight);}),number('Highest eye height m',c.eyeMax,c.eyeMin,2.2,.05,n=>{c.eyeMax=n;c.eyeHeight=Math.min(n,c.eyeHeight);}),number('Eye height m',c.eyeHeight,c.eyeMin,c.eyeMax,.05,n=>{c.eyeHeight=n;drawEye();}),number('Minimum distance m',c.minDistance,0,Math.min(c.maxDistance-.1,2),.1,n=>c.minDistance=n),number('Legibility limit m (0 = off)',c.legibilityDistance||0,0,12,.5,n=>c.legibilityDistance=n||null));panel.append(lab,button('Occlusion proxies',()=>{state.showProxies=!state.showProxies;render();},state.showProxies),el('p',`Eye envelope ${c.eyeMin}–${c.eyeMax} m · +Z display front · ${state.result?.proxies??0} nearby CAD proxies · recompute ${state.calculationMs.toFixed(0)} ms`,{class:'media-note'}));}
    const scenario=el('details');scenario.append(el('summary','What-if placement · hypothetical'));scenario.open=!!state.scenario;
    scenario.append(button(state.scenario?'Discard proposed placement':'Create ghost placement',()=>{state.scenario=state.scenario?null:{...d};ghostUpdate();calculate();}));
    if(state.scenario){scenario.append(number('Proposed X m',p.x,layout.bbox.minX,layout.bbox.maxX,'any',n=>{p.x=n;ghostUpdate();}),number('Proposed Z m',p.z,layout.bbox.minZ,layout.bbox.maxZ,'any',n=>{p.z=n;ghostUpdate();}),number('Proposed yaw °',p.yaw*180/Math.PI,-360,360,5,n=>{p.yaw=n*Math.PI/180;ghostUpdate();}),row('Current → proposed',`${state.current?.visibleArea.toFixed(1)} → ${state.result?.visibleArea.toFixed(1)} m²`),el('p','Installed position unchanged. Same assumptions; geometric coverage only.',{class:'media-note'}));}panel.append(scenario);
    if(state.collisions?.length)panel.append(el('p',`Placement intersects ${state.collisions.length} illustrative obstruction proxies. Confirm dimensions/calibration on site.`,{class:'media-warning'}));
    const assets=el('details');assets.append(el('summary','Campaign & evidence'),el('p',state.campaign));const upload=el('input','',{type:'file',accept:'image/*,video/*','aria-label':'Preview campaign image or video'});upload.onchange=()=>campaign(upload.files[0]);assets.append(upload,el('p','Campaign files stay in this browser. Double-sided preview uses the same campaign on both faces.',{class:'media-note'}),el('p','Source: registered venue CAD. Heights, 55-inch enclosure, front direction, angles and eye heights require site/manufacturer confirmation. Grid coverage is approximate; unknown transparent fixtures are treated as solid.',{class:'media-note'}));panel.append(assets);
    panel.append(el('p',state.data?.available?`${state.data.visible} validated position samples within visibility · ${state.data.source}`:'Observed positions: unavailable · no validated trajectory window connected.',{class:'media-note'}),el('p','Potential exposure events: unavailable. Flow particles are context, never shoppers, gaze or impressions.',{class:'media-note'}));
    if(state.error)panel.append(el('p',state.error,{class:'media-warning'}));
    panel.dataset.mediaDiagnostics=JSON.stringify({device:d.id,pose:p,settings:c,currentArea:state.current?.visibleArea,proposedArea:state.result?.visibleArea,calculationMs:state.calculationMs,workerMs:state.workerMs,surfaceMethod:state.surfaceMethod,surfaceTriangles:state.surfaceTriangles,busy:state.busy,collisionIds:state.collisions,eye:state.eye,eyeResult:state.eyeResult?{face:state.eyeResult.face,reason:state.eyeResult.reason,clear:state.eyeResult.clear}:null});
  }
  function demoEye(visible){if(state.busy)return;const candidates=state.result?.cells.filter(v=>visible?v.fraction===1:v.fraction===0)||[];const p=pose();candidates.sort((a,b)=>Math.hypot(a.x-p.x,a.z-p.z)-Math.hypot(b.x-p.x,b.z-p.z));const hit=candidates[Math.min(20,candidates.length-1)];if(hit){state.error=null;state.eye={x:hit.x,z:hit.z,y:state.settings.eyeHeight};drawEye();}else state.error='No '+(visible?'clear':'blocked')+' sample found under these assumptions.';render();}
  const api={state,config,root,models,
    open(id=config.devices[0].id){if(!config.devices.some(d=>d.id===id))return;state.selected=id;state.settings.sides=sideCounts.get(id);state.scenario=null;state.eye=null;state.eyeResult=null;state.error=null;state.data=null;state.current=null;state.result=null;if(savedFlow===null){savedFlow=getFlow();setFlow(false);}ghostUpdate();calculate();focus();panel.scrollTop=0;},
    close(){job++;state.selected=null;state.scenario=null;state.moveEye=false;ghostUpdate();if(savedFlow!==null)setFlow(savedFlow);savedFlow=null;setContext?.(false);render();},
    pick(raycaster,x,z){if(state.selected&&state.moveEye){state.eye={x,z,y:state.settings.eyeHeight};state.moveEye=false;drawEye();render();return true;}const hit=raycaster.intersectObjects(devices.children,true)[0];if(hit){api.open(hit.object.userData.deviceId);return true;}return false;},
    update(){root.visible=!!document.documentElement.classList.contains('hx');if(state.selected){setFlow(state.flow);setContext?.(true);}},
    ingestPositions(samples,source){if(active()){state.data=observedPositions(samples,source,pose(),config.screen,state.settings,blockers());render();}},
    dispose(){disposed=true;worker.terminate();pending.clear();clearTimeout(timer);observer.disconnect();panel.remove();scene.remove(root);video?.pause();texture?.dispose();if(mediaURL)URL.revokeObjectURL(mediaURL);clear(root);}
  };
  renderer.shadowMap.needsUpdate=true;return api;
}
