// === OUTCOMES STEP LOGIC ===
var cfgO3dScene,cfgO3dCamera,cfgO3dRenderer,cfgO3dControls;
var cfgO3dInit=false,cfgO3dPeople=[],cfgO3dOvMeshes=[];
var cfgOutcomesLastVenue=null;

function cfgInitOutcomesStep(){
  var t=CFG.venueType||'retail',oc=OUTCOMES_REGISTRY[t]||OUTCOMES_REGISTRY.retail;
  var w=cfgToMeters(CFG.width),l=cfgToMeters(CFG.length),a=w*l;
  var tl=t.charAt(0).toUpperCase()+t.slice(1);
  document.getElementById('cfgSummaryBar3').innerHTML='<div class="cfg-sb-item"><strong>'+w.toFixed(0)+'m × '+l.toFixed(0)+'m</strong> ('+a.toFixed(0)+' sqm)</div><div class="cfg-sb-item">Type: <strong>'+tl+'</strong></div><div class="cfg-sb-item">LiDARs: <strong>'+CFG.lidars.length+'</strong></div>';
  // Reset outcomes if venue type changed
  if(cfgOutcomesLastVenue!==t){CFG.selectedOutcomes.clear();cfgOutcomesLastVenue=t;}
  if(!CFG.selectedOutcomes.size) oc.forEach(function(o){if(o.defaultOn)CFG.selectedOutcomes.add(o.id);});
  cfgRenderOC(oc); cfgUpdateTier();
  if(typeof THREE!=='undefined') cfgInitO3D(); else cfgLoad3D();
}

function cfgRenderOC(oc){
  var h='';
  oc.forEach(function(o){
    var act=CFG.selectedOutcomes.has(o.id)?' active':'';
    h+='<div class="cfg-outcome-card'+act+'" data-oid="'+o.id+'" onclick="cfgToggleOutcome(\''+o.id+'\')">';
    h+='<div class="cfg-oc-check">✓</div><span class="cfg-oc-badge '+o.tier+'">'+(o.tier==='base'?'Included':'Advanced')+'</span>';
    h+='<div class="cfg-oc-icon"><i data-lucide="'+o.icon+'" style="width:20px;height:20px;"></i></div><div class="cfg-oc-label">'+o.label+'</div><div class="cfg-oc-desc">'+o.desc+'</div></div>';
  });
  document.getElementById('cfgOutcomesGrid').innerHTML=h;
  lucide.createIcons();
}

function cfgToggleOutcome(id){
  if(CFG.selectedOutcomes.has(id))CFG.selectedOutcomes.delete(id);else CFG.selectedOutcomes.add(id);
  document.querySelectorAll('.cfg-outcome-card').forEach(function(c){c.classList.toggle('active',CFG.selectedOutcomes.has(c.dataset.oid));});
  cfgUpdateTier(); cfgUpdateOv();
}

function cfgOutcomesReset(){
  var t=CFG.venueType||'retail',oc=OUTCOMES_REGISTRY[t]||OUTCOMES_REGISTRY.retail;
  CFG.selectedOutcomes.clear();
  oc.forEach(function(o){if(o.defaultOn)CFG.selectedOutcomes.add(o.id);});
  cfgRenderOC(oc); cfgUpdateTier(); cfgUpdateOv();
}

function cfgUpdateTier(){
  var t=CFG.venueType||'retail',oc=OUTCOMES_REGISTRY[t]||OUTCOMES_REGISTRY.retail;
  var adv=0;
  oc.forEach(function(o){if(CFG.selectedOutcomes.has(o.id)&&o.tier==='advanced')adv++;});
  CFG.recommendedTier=adv>=2?'pro':'core';
  var el=document.getElementById('cfgTierLabel');
  el.className='cfg-tier-label '+CFG.recommendedTier;
  el.textContent=CFG.recommendedTier==='pro'?'Pro Plan':'Core Plan';
}

// === OUTCOMES 3D VIEWPORT ===
function cfgInitO3D(){
  if(typeof THREE==='undefined')return;
  var ct=document.getElementById('cfgOutcomes3d');
  if(!ct)return;
  var cw=ct.clientWidth||400,ch=ct.clientHeight||300;
  if(!cfgO3dInit){
    cfgO3dScene=new THREE.Scene();
    cfgO3dScene.background=new THREE.Color(0x0f0f14);
    cfgO3dCamera=new THREE.PerspectiveCamera(55,cw/ch,0.1,500);
    cfgO3dRenderer=new THREE.WebGLRenderer({antialias:true});
    cfgO3dRenderer.setSize(cw,ch);
    cfgO3dRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    var old=ct.querySelector('canvas'); if(old)old.remove();
    ct.insertBefore(cfgO3dRenderer.domElement,ct.firstChild);
    cfgO3dControls=new THREE.OrbitControls(cfgO3dCamera,cfgO3dRenderer.domElement);
    cfgO3dControls.enableDamping=true;cfgO3dControls.dampingFactor=0.05;
    cfgO3dControls.maxPolarAngle=Math.PI/2.1;
    cfgO3dScene.add(new THREE.AmbientLight(0xffffff,0.6));
    var dl=new THREE.DirectionalLight(0xffffff,0.8);dl.position.set(5,10,5);cfgO3dScene.add(dl);
    cfgO3dInit=true;
    (function anim(){
      requestAnimationFrame(anim);
      cfgO3dControls.update();
      var vw2=cfgToMeters(CFG.width),vl2=cfgToMeters(CFG.length);
      cfgO3dPeople.forEach(function(p){cfgUpdatePerson(p,vw2,vl2);});
      cfgO3dOvMeshes.forEach(function(m){
        if(m.userData.at==='flow')m.material.dashOffset-=0.03;
        if(m.userData.at==='pulse')m.material.opacity=0.12+0.08*Math.sin(Date.now()*0.003);
      });
      cfgO3dRenderer.render(cfgO3dScene,cfgO3dCamera);
    })();
    new ResizeObserver(function(){var w2=ct.clientWidth,h2=ct.clientHeight;if(w2&&h2){cfgO3dCamera.aspect=w2/h2;cfgO3dCamera.updateProjectionMatrix();cfgO3dRenderer.setSize(w2,h2);}}).observe(ct);
  }
  cfgBuildOScene(); cfgUpdateOv();
}

function cfgBuildOScene(){
  if(!cfgO3dScene)return;
  var kp=[];cfgO3dScene.traverse(function(c){if(c.isLight)kp.push(c);});
  while(cfgO3dScene.children.length)cfgO3dScene.remove(cfgO3dScene.children[0]);
  kp.forEach(function(l){cfgO3dScene.add(l);});
  cfgO3dPeople=[]; cfgO3dOvMeshes=[];
  var vw=cfgToMeters(CFG.width),vl=cfgToMeters(CFG.length),vh=cfgToMeters(CFG.height);
  cfgO3dCamera.position.set(vw*0.7,Math.max(vw,vl)*0.65,vl*0.7);
  cfgO3dControls.target.set(vw/2,0,vl/2);
  // Floor
  var fl=new THREE.Mesh(new THREE.PlaneGeometry(vw,vl),new THREE.MeshStandardMaterial({color:0x1a1a24,roughness:0.9}));
  fl.rotation.x=-Math.PI/2;fl.position.set(vw/2,0,vl/2);cfgO3dScene.add(fl);
  // Grid
  var gr=new THREE.GridHelper(Math.max(vw,vl)*1.2,Math.max(vw,vl)*1.2,0x333344,0x222233);
  gr.position.set(vw/2,0.01,vl/2);cfgO3dScene.add(gr);
  // Walls
  var wm=new THREE.MeshStandardMaterial({color:0x64748b,transparent:true,opacity:0.2,side:THREE.DoubleSide});
  [[vw,vh,0.1,vw/2,vh/2,0],[vw,vh,0.1,vw/2,vh/2,vl],[0.1,vh,vl,0,vh/2,vl/2],[0.1,vh,vl,vw,vh/2,vl/2]].forEach(function(d){
    var m=new THREE.Mesh(new THREE.BoxGeometry(d[0],d[1],d[2]),wm);m.position.set(d[3],d[4],d[5]);cfgO3dScene.add(m);
  });
  // LiDARs
  CFG.lidars.forEach(function(lid){
    var m=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.2,12),new THREE.MeshStandardMaterial({color:0x22c55e,emissive:0x0a2210}));
    m.position.set(lid.x,vh-0.1,lid.z);cfgO3dScene.add(m);
  });
  // Synthetic people
  var TC=[0x3b82f6,0x8b5cf6,0x06b6d4,0x10b981,0xf59e0b,0xef4444,0xec4899,0x6366f1];
  var np=Math.min(Math.max(4,Math.floor(vw*vl/60)),16);
  for(var i=0;i<np;i++){
    var pH=1.5+Math.random()*0.4,pR=0.2+Math.random()*0.05;
    var c=TC[i%TC.length],px=Math.random()*(vw-1)+0.5,pz=Math.random()*(vl-1)+0.5;
    var g=new THREE.Group();
    var pcPos=cfgGenCapsulePoints(pR,pH,200);
    var pcGeo=new THREE.BufferGeometry();pcGeo.setAttribute('position',new THREE.BufferAttribute(pcPos,3));
    var pc=new THREE.Points(pcGeo,new THREE.PointsMaterial({color:c,size:0.04,transparent:true,opacity:0.85,sizeAttenuation:true,depthWrite:false}));
    pc.userData.basePositions=new Float32Array(pcPos);
    g.add(pc);
    var eg=new THREE.EdgesGeometry(new THREE.BoxGeometry(pR*2,pH,pR*2));
    g.add(new THREE.LineSegments(eg,new THREE.LineBasicMaterial({color:c,transparent:true,opacity:0.5})));
    g.position.set(px,pH/2,pz);cfgO3dScene.add(g);
    var tl=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:c,transparent:true,opacity:0.4}));
    cfgO3dScene.add(tl);
    cfgO3dPeople.push({group:g,pointCloud:pc,trail:tl,trailPts:[{x:px,z:pz}],h:pH,r:pR,color:c,x:px,z:pz,tx:Math.random()*vw,tz:Math.random()*vl,speed:0.008+Math.random()*0.006,pause:0});
  }
}

// === OVERLAY RENDERERS ===
function cfgUpdateOv(){
  if(!cfgO3dScene)return;
  cfgO3dOvMeshes.forEach(function(m){cfgO3dScene.remove(m);});
  cfgO3dOvMeshes=[];
  var t=CFG.venueType||'retail',oc=OUTCOMES_REGISTRY[t]||OUTCOMES_REGISTRY.retail;
  var active=new Set();
  oc.forEach(function(o){if(CFG.selectedOutcomes.has(o.id))active.add(o.overlay);});
  var vw=cfgToMeters(CFG.width),vl=cfgToMeters(CFG.length);
  if(active.has('heatmap'))cfgOvHeatmap(vw,vl);
  if(active.has('flow'))cfgOvFlow(vw,vl);
  if(active.has('counters'))cfgOvCounters(vw,vl);
  if(active.has('queue'))cfgOvQueue(vw,vl);
  if(active.has('density'))cfgOvDensity(vw,vl);
  var badge=document.getElementById('cfgO3dBadge');
  if(badge)badge.textContent=active.size>0?active.size+' overlay'+(active.size>1?'s':'')+' active — drag to rotate':'Toggle outcomes to see overlays update live';
}

// HEATMAP: colored floor zones
function cfgOvHeatmap(vw,vl){
  var cols=6,rows=Math.max(3,Math.round(6*vl/vw));
  var cw=vw/cols,cl=vl/rows;
  for(var r=0;r<rows;r++){for(var c=0;c<cols;c++){
    var intensity=Math.random();
    var color=new THREE.Color();color.setHSL(0.0+intensity*0.12,0.9,0.45+intensity*0.15);
    var geo=new THREE.PlaneGeometry(cw*0.88,cl*0.88);
    var mat=new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:0.08+intensity*0.14,side:THREE.DoubleSide});
    var m=new THREE.Mesh(geo,mat);m.rotation.x=-Math.PI/2;
    m.position.set(cw*0.5+c*cw,0.03,cl*0.5+r*cl);
    cfgO3dScene.add(m);cfgO3dOvMeshes.push(m);
  }}
}

// FLOW: animated dashed streamlines
function cfgOvFlow(vw,vl){
  for(var i=0;i<8;i++){
    var pts=[];var cx=Math.random()*vw,cz=Math.random()*vl;
    for(var s=0;s<12;s++){
      cx+=(Math.random()-0.5)*vw*0.2;
      cz+=(Math.random()-0.3)*vl*0.15;
      cx=Math.max(0.5,Math.min(vw-0.5,cx));
      cz=Math.max(0.5,Math.min(vl-0.5,cz));
      pts.push(new THREE.Vector3(cx,0.05,cz));
    }
    if(pts.length<2)continue;
    var curve=new THREE.CatmullRomCurve3(pts);
    var geo=new THREE.BufferGeometry().setFromPoints(curve.getPoints(60));
    var hue=0.55+Math.random()*0.15;
    var col=new THREE.Color();col.setHSL(hue,0.8,0.6);
    var mat=new THREE.LineDashedMaterial({color:col,dashSize:0.4,gapSize:0.2,transparent:true,opacity:0.5});
    var line=new THREE.Line(geo,mat);line.computeLineDistances();
    line.userData.at='flow';
    cfgO3dScene.add(line);cfgO3dOvMeshes.push(line);
  }
}

// COUNTERS: floating number sprites per zone
function cfgOvCounters(vw,vl){
  var zones=[[vw*0.25,vl*0.25],[vw*0.75,vl*0.25],[vw*0.25,vl*0.75],[vw*0.75,vl*0.75],[vw*0.5,vl*0.5]];
  zones.forEach(function(z){
    var canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;
    var ctx=canvas.getContext('2d');
    ctx.fillStyle='rgba(0,0,0,0.65)';
    ctx.beginPath();
    if(ctx.roundRect){ctx.roundRect(4,4,120,56,12);}else{ctx.rect(4,4,120,56);}
    ctx.fill();
    ctx.font='bold 26px sans-serif';ctx.fillStyle='#22c55e';ctx.textAlign='center';
    ctx.fillText(Math.floor(Math.random()*80+10),64,36);
    ctx.font='10px sans-serif';ctx.fillStyle='#94a3b8';ctx.fillText('people',64,52);
    var tex=new THREE.CanvasTexture(canvas);
    var mat=new THREE.SpriteMaterial({map:tex,transparent:true,opacity:0.9});
    var sprite=new THREE.Sprite(mat);sprite.scale.set(2.5,1.25,1);
    sprite.position.set(z[0],2.5,z[1]);
    cfgO3dScene.add(sprite);cfgO3dOvMeshes.push(sprite);
  });
}

// QUEUE: pulsing highlight zones at front edge
function cfgOvQueue(vw,vl){
  var qz=[[vw*0.25,vl*0.92],[vw*0.5,vl*0.92],[vw*0.75,vl*0.92]];
  qz.forEach(function(z){
    var geo=new THREE.PlaneGeometry(vw*0.18,vl*0.08);
    var mat=new THREE.MeshBasicMaterial({color:0xf59e0b,transparent:true,opacity:0.15,side:THREE.DoubleSide});
    var m=new THREE.Mesh(geo,mat);m.rotation.x=-Math.PI/2;
    m.position.set(z[0],0.04,z[1]);
    m.userData.at='pulse';
    cfgO3dScene.add(m);cfgO3dOvMeshes.push(m);
    // Border ring
    var ring=new THREE.Mesh(new THREE.RingGeometry(vw*0.08,vw*0.09,32),new THREE.MeshBasicMaterial({color:0xf59e0b,transparent:true,opacity:0.3,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2;ring.position.set(z[0],0.05,z[1]);
    ring.userData.at='pulse';
    cfgO3dScene.add(ring);cfgO3dOvMeshes.push(ring);
  });
}

// DENSITY: color-coded moving dots for two groups
function cfgOvDensity(vw,vl){
  var groupA=0x3b82f6,groupB=0xef4444;
  for(var i=0;i<30;i++){
    var isB=i>20;
    var geo=new THREE.SphereGeometry(0.12,8,8);
    var mat=new THREE.MeshBasicMaterial({color:isB?groupB:groupA,transparent:true,opacity:0.6});
    var dot=new THREE.Mesh(geo,mat);
    dot.position.set(Math.random()*(vw-1)+0.5,0.12,Math.random()*(vl-1)+0.5);
    cfgO3dScene.add(dot);cfgO3dOvMeshes.push(dot);
  }
}
