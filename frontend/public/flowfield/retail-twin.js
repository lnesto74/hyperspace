import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { inRings, ringBounds } from './retail-geometry.js';

const HEIGHT = 2.8; // Visual selection height, NEVER customer dwell.
function shape(ring) {
  const s=new THREE.Shape(ring.outer.map(([x,z])=>new THREE.Vector2(x,-z)));
  for(const h of ring.holes || []) s.holes.push(new THREE.Path(h.map(([x,z])=>new THREE.Vector2(x,-z))));
  return s;
}
function dispose(group) {
  group.traverse(o=>{o.geometry?.dispose(); if(o.material) for(const m of [].concat(o.material))m.dispose();});
  group.clear();
}
function line(points,color,opacity=1) {
  return new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({color,transparent:true,opacity,depthWrite:false}));
}

export async function createRetailTwin({ scene, camera, renderer, layout, fly, home, top }) {
  const response=await fetch('./retail/manifest.json');
  if(!response.ok)throw new Error('Retail fixture manifest unavailable');
  const manifest=await response.json();
  if(manifest.venueId!==layout.venue.id)throw new Error('Retail fixture venue mismatch');
  // Reject stale/misaligned manifest geometry before showing any category asset.
  for(const f of manifest.fixtures) if(JSON.stringify(f.polygon)!==JSON.stringify(layout.polys[f.cadIndex]))throw new Error('Retail CAD manifest needs regeneration');
  const root=new THREE.Group();root.name='Retail digital twin';scene.add(root);
  const architecture=new THREE.Group();root.add(architecture);
  const detailRoot=new THREE.Group();root.add(detailRoot);
  const cage=new THREE.Group();cage.name='Exact mapped ROI · visual height 2.8 m';root.add(cage);
  const fronts=new THREE.Group();root.add(fronts);
  const laneSigns=new THREE.Group();laneSigns.name='Mapped checkout lane numbers';root.add(laneSigns);
  for(const f of manifest.fixtures.filter(f=>f.lane)) {
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
    const context=canvas.getContext('2d');context.fillStyle='#17232a';context.fillRect(0,0,128,64);context.fillStyle='#e1eaf0';context.font='500 42px sans-serif';context.textAlign='center';context.textBaseline='middle';context.fillText(String(f.lane),64,33);
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    const sign=new THREE.Mesh(new THREE.PlaneGeometry(.42*f.width/1.7,.25),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:false}));
    const point=new THREE.Vector3(-.60*f.width/1.7,2.22,-1.185*f.length/2.6).applyAxisAngle(new THREE.Vector3(0,1,0),f.yaw);
    sign.position.copy(point).add(new THREE.Vector3(f.x,0,f.z));sign.rotation.y=f.yaw;sign.userData.category=f.category;laneSigns.add(sign);
  }
  const meshByCategory=new Map(),cache=new Map(),loaded=new Map(),states=new Map(),overview=new Map(),overviewStates=new Map();
  const fixturesByCategory=new Map();
  for(const f of manifest.fixtures){if(!fixturesByCategory.has(f.category))fixturesByCategory.set(f.category,[]);fixturesByCategory.get(f.category).push(f);}
  const fidelity=new Map(),assetGeometry=new Map();let loadTick=0,disposed=false;
  const baseColors=new Map();const color=new THREE.Color();
  const state={mode:'3d',selection:null,focus:false,reduced:false,frontage:true,context:'pulse',error:null};
  let envelope=0,dim=1,revision=0,hidden=false;
  const notify=()=>window.dispatchEvent(new CustomEvent('ff-twin-update'));

  // Exact CAD polygons, batched by category. No AABB replacement of irregular CAD.
  const mapped=new Map(manifest.fixtures.map(f=>[f.cadIndex,f]));
  const batches=new Map();
  for(let i=0;i<layout.polys.length;i++) {
    const p=layout.polys[i];if(p.length<3)continue;
    const b=ringBounds([{outer:p}]);if(!b || b.span<.3 || b.span>34)continue;
    const name=mapped.get(i)?.category || 'architecture';
    const height=mapped.has(i)? .82 : Math.min(b.maxX-b.minX,b.maxZ-b.minZ)<.15 ? .42 : 1.15;
    const g=new THREE.ExtrudeGeometry(shape({outer:p}),{depth:height,bevelEnabled:false,steps:1});
    g.rotateX(-Math.PI/2);g.deleteAttribute('uv');
    if(!batches.has(name))batches.set(name,[]);batches.get(name).push(g);
  }
  for(const [name,geoms] of batches) {
    const g=mergeGeometries(geoms);geoms.forEach(g=>g.dispose());if(!g)continue;
    const mat=new THREE.MeshStandardMaterial({color:name==='architecture'?0x566369:0x778080,roughness:.82,metalness:.12});
    baseColors.set(mat,mat.color.clone());
    const m=new THREE.Mesh(g,mat);m.name='CAD '+name;m.castShadow=true;m.receiveShadow=true;architecture.add(m);meshByCategory.set(name,m);
  }
  const b=layout.bbox;
  const floor=new THREE.Mesh(new THREE.BoxGeometry(b.maxX-b.minX,.16,b.maxZ-b.minZ),new THREE.MeshStandardMaterial({color:0x232e35,roughness:.96,metalness:.08}));
  floor.position.set((b.minX+b.maxX)/2,-.13,(b.minZ+b.maxZ)/2);floor.receiveShadow=true;floor.name='Venue datum';root.add(floor);
  const hemi=new THREE.HemisphereLight(0xe0edff,0x293234,1.15);root.add(hemi);
  const light=new THREE.DirectionalLight(0xffefd9,2.0);light.position.set(15,45,20);light.target.position.set(35,0,35);
  light.castShadow=true;light.shadow.mapSize.set(2048,2048);Object.assign(light.shadow.camera,{left:-48,right:48,top:48,bottom:-48,near:1,far:110});light.shadow.bias=-.0003;light.shadow.normalBias=.05;
  root.add(light,light.target);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;

  function category(sel) {return sel?.category || sel?.name || '';}
  function rings(sel) {return sel?.rings || (sel?.polygons || (sel?.vertices?[sel.vertices]:[])).map(outer=>({outer,holes:[]}));}
  function tint() {return state.context==='opportunities'?0xe4bb74:state.selection?.alert?0xf49b90:0x9fdaee;}
  function rebuildCage() {
    dispose(cage);dispose(fronts);
    const sel=state.selection;if(!sel)return;
    const edges=[],guides=[],walls=[],rs=rings(sel),c=tint();
    for(const r of rs) {
      const projection=new THREE.ShapeGeometry(shape(r));projection.rotateX(-Math.PI/2);
      const floor=new THREE.Mesh(projection,new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.045,depthWrite:false,side:THREE.DoubleSide}));floor.position.y=.055;cage.add(floor);
      for(const path of [r.outer,...r.holes || []]) {
        let last=null;
        for(let i=0;i<path.length;i++) {
          const a=path[i],b=path[(i+1)%path.length];
          for(const y of [.065,HEIGHT])edges.push(a[0],y,a[1],b[0],y,b[1]);
          walls.push(a[0],.07,a[1],b[0],.07,b[1],b[0],HEIGHT,b[1],a[0],.07,a[1],b[0],HEIGHT,b[1],a[0],HEIGHT,a[1]);
          if(!last || Math.hypot(a[0]-last[0],a[1]-last[1])>1.8){guides.push(a[0],.07,a[1],a[0],HEIGHT,a[1]);last=a;}
        }
      }
    }
    cage.add(line(edges,c,.75),line(guides,c,.28));
    const wall=new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(walls,3)),new THREE.MeshBasicMaterial({color:c,transparent:true,opacity:.028,depthWrite:false,side:THREE.DoubleSide}));
    wall.name='Glass walls following every ROI boundary and hole';cage.add(wall);
    if(sel.zones?.service) {
      const pts=[];
      for(const r of sel.zones.service){
        const geometry=new THREE.ShapeGeometry(shape(r));geometry.rotateX(-Math.PI/2);
        const projection=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color:0xd6e1e7,transparent:true,opacity:.09,depthWrite:false,side:THREE.DoubleSide}));projection.position.y=.08;projection.name='Mapped service area';cage.add(projection);
        for(let i=0;i<r.outer.length;i++){const a=r.outer[i],b=r.outer[(i+1)%r.outer.length];for(const y of [.09,1.65])pts.push(a[0],y,a[1],b[0],y,b[1]);}
      }
      const service=line(pts,0xd6e1e7,.75);service.name='Service boundary · separate from waiting';cage.add(service);
    }
    const pts=[];
    for(const f of manifest.fixtures.filter(f=>f.category===category(sel)))for(const [a,b] of f.fronts)pts.push(a[0],1.1,a[1],b[0],1.1,b[1]);
    fronts.add(line(pts,c,.95));fronts.visible=state.frontage;
  }

  async function loadCategory(name,level='detail') {
    const low=level==='overview',groups=low?overview:loaded,status=low?overviewStates:states;
    if(disposed || groups.has(name) || status.get(name)==='loading' || status.get(name)==='unavailable')return;
    const fixtures=fixturesByCategory.get(name)||[];if(!fixtures.length)return;
    status.set(name,'loading');notify();
    const group=new THREE.Group();group.name=name+' · illustrative category assets';
    try {
      for(const asset of new Set(fixtures.map(f=>f.asset))) {
        const spec=manifest.assets[asset];
        const url=low?spec.overviewUrl:spec.url;
        if(!cache.has(url))cache.set(url,new GLTFLoader().loadAsync(url).catch(e=>{cache.delete(url);throw e;}));
        const gltf=await cache.get(url);if(disposed)return;gltf.scene.updateMatrixWorld(true);
        const bounds=new THREE.Box3().setFromObject(gltf.scene),size=bounds.getSize(new THREE.Vector3());
        if(Math.abs(size.x-spec.width)>.06 || Math.abs(size.z-spec.length)>.06 || Math.abs(bounds.min.y)>.035 || size.y>2.5)throw new Error('Asset scale/orientation validation failed: '+asset);
        const transforms=[];
        for(const f of fixtures.filter(f=>f.asset===asset)) {
          const n=f.tile===false?1:Math.max(1,Math.round(f.length/spec.length)),length=f.length/n;
          for(let j=0;j<n;j++) {
            const offset=(j-(n-1)/2)*length;
            const o=new THREE.Object3D();o.position.set(f.x+Math.sin(f.yaw)*offset,0,f.z+Math.cos(f.yaw)*offset);
            o.rotation.y=f.yaw;o.scale.set(f.width/spec.width,1,length/spec.length);o.updateMatrix();transforms.push(o.matrix.clone());
          }
        }
        gltf.scene.traverse(o=>{
          if(!o.isMesh)return;
          const geometryKey=url+':'+o.uuid;
          if(!assetGeometry.has(geometryKey))assetGeometry.set(geometryKey,o.geometry.clone().applyMatrix4(o.matrixWorld));
          const g=assetGeometry.get(geometryKey),m=o.material.clone();baseColors.set(m,m.color.clone());
          if(m.transparent){m.depthWrite=false;m.opacity=Math.min(m.opacity,.18);}
          const mesh=new THREE.InstancedMesh(g,m,transforms.length);mesh.name=o.name;mesh.userData.detail=o.name.includes('_detail_');
          mesh.userData.micro=o.name.includes('_micro_');
          transforms.forEach((t,i)=>mesh.setMatrixAt(i,t));mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();group.add(mesh);
        });
      }
      groups.set(name,group);detailRoot.add(group);status.set(name,'ready');
      if(meshByCategory.has(name))meshByCategory.get(name).visible=fixtures.some(f=>f.retainCad);
      renderer.shadowMap.needsUpdate=true;notify();
    }catch(e){group.traverse(o=>{if(o.material){baseColors.delete(o.material);o.material.dispose();}});group.clear();status.set(name,'unavailable');state.error=e.message;console.warn('Retail category unavailable',name,level,e);notify();}
  }

  function frameSelection() {
    const selected=state.selection;
    const fixtures=fixturesByCategory.get(category(selected))||[];
    const b=ringBounds([...rings(selected),...(selected?.zones?.service||[]),...category(selected)==='Frutta'?[]:fixtures.map(f=>({outer:f.polygon}))]);
    if(b)fly(b,state.mode,{preset:fixtures[0]?.camera || 'gondola',fixtures,category:category(selected)});else home();
  }
  const api={
    state,manifest,root,
    get bounds(){return ringBounds(rings(state.selection));},
    get assetStatus(){return states.get(category(state.selection)) || 'CAD';},
    select(sel,{animate=true}={}) {
      const changed=state.selection?.id!==sel?.id;
      state.selection=sel;state.focus=!!sel;revision++;
      if(changed)envelope=0;
      rebuildCage();if(sel){void loadCategory(category(sel));if(animate && changed)frameSelection();}
      renderer.shadowMap.needsUpdate=true;notify();
    },
    context(name){if(state.context===name)return;state.context=name;rebuildCage();},
    alert(on){if(state.selection && state.selection.alert!==on){state.selection.alert=on;rebuildCage();}},
    mode(mode){state.mode=mode;state.focus=!!state.selection;document.documentElement.dataset.twinMode=mode;if(state.selection)frameSelection();else if(mode==='top')top();else home();notify();},
    focus(){state.focus=!!state.selection;if(state.selection)frameSelection();notify();},
    returnToStore(){api.select(null);if(state.mode==='top')top();else home();},
    reduced(on){state.reduced=on;renderer.setPixelRatio(Math.min(devicePixelRatio,on?1:2));light.castShadow=!on;renderer.shadowMap.needsUpdate=true;notify();},
    frontage(on){state.frontage=on;fronts.visible=on;notify();},
    hide(on){hidden=on;root.visible=!on;},
    pick(x,z){return manifest.fixtures.find(f=>inRings(x,z,[{outer:f.polygon}]))?.category || null;},
    update(dt){
      if(hidden)return;
      const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
      envelope=reducedMotion?1:Math.min(1,envelope+dt*2.2);
      cage.visible=!!state.selection;cage.scale.y=state.mode==='top'?.025:Math.max(.015,1-Math.pow(1-envelope,3));
      const target=state.focus?.52:1;
      dim+= (target-dim)*Math.min(1,dt*6);
      for(const [name,m] of meshByCategory){const factor=name===category(state.selection)?1:dim;m.material.color.copy(baseColors.get(m.material)).multiplyScalar(factor);}
      for(const sign of laneSigns.children)sign.material.color.setScalar(sign.userData.category===category(state.selection)?1:dim);
      loadTick+=dt;const mayLoad=loadTick>.6;if(mayLoad)loadTick=0;
      let pending=[...states.values()].filter(v=>v==='loading').length;
      for(const [name,fixtures] of fixturesByCategory){
        const selected=name===category(state.selection);
        const near=state.mode!=='top' && fixtures.some(f=>Math.hypot(camera.position.x-f.x,camera.position.y,camera.position.z-f.z)<24);
        const level=state.reduced?0:selected?2:near?1:0;
        fidelity.set(name,level);
        if(level>0 && mayLoad && pending<2 && !states.has(name)){void loadCategory(name);pending++;}
        const full=loaded.get(name),low=overview.get(name),showFull=!!full && level>0;
        if(full)full.visible=showFull;
        if(low)low.visible=!showFull;
        const cad=meshByCategory.get(name);
        if(cad)cad.visible=(!showFull && !low)||fixtures.some(f=>f.retainCad);
        for(const group of [full,low])if(group)for(const m of group.children){
          m.visible=!m.userData.micro || level===2;
          m.material.color.copy(baseColors.get(m.material)).multiplyScalar(selected?1:dim);
        }
      }
    },
    diagnostics(){return {loaded:[...loaded.keys()],states:Object.fromEntries(states),overviewReady:overview.size,overviewStates:Object.fromEntries(overviewStates),fidelity:Object.fromEntries(fidelity),cachedAssets:cache.size,cageHeight:HEIGHT,mode:state.mode,selection:state.selection?.id,fixtureCount:manifest.fixtures.length,revision,error:state.error};},
    dispose(){disposed=true;scene.remove(root);const geometries=new Set(),materials=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const m of [].concat(o.material||[]))materials.add(m);});for(const g of assetGeometry.values())geometries.add(g);geometries.forEach(g=>g.dispose());materials.forEach(m=>{m.map?.dispose();m.dispose();});for(const p of cache.values())p.then(g=>dispose(g.scene)).catch(()=>{});root.clear();cache.clear();assetGeometry.clear();baseColors.clear();},
  };
  document.documentElement.dataset.twinMode='3d';
  // Lightweight store fixtures load progressively; full merchandise is requested only nearby or on selection.
  void (async()=>{for(const name of fixturesByCategory.keys()){if(disposed)break;await loadCategory(name,'overview');}})();
  return api;
}
