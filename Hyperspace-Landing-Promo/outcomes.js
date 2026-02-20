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
      var now=Date.now();
      cfgO3dOvMeshes.forEach(function(m){
        if(m.userData.at==='flow'&&m.material&&m.material.dashOffset!==undefined)m.material.dashOffset-=0.03;
        if(m.userData.at==='pulse'&&m.material)m.material.opacity=0.12+0.08*Math.sin(now*0.003);
        if(m.userData.at==='arrow'&&m.userData.curve){
          var t=(m.userData.baseT+(now*m.userData.speed))%1;
          var pos=m.userData.curve.getPoint(t);
          var tan=m.userData.curve.getTangent(t);
          m.position.set(pos.x,0.2,pos.z);
          var angle=Math.atan2(tan.x,tan.z);
          m.rotation.set(0,angle,Math.PI/2);
        }
        if(m.userData.at==='dwell_ring'){
          var phase=(now*0.001+m.userData.ringIdx*0.8)%3;
          var sc=m.userData.baseScale+phase*0.15;
          m.scale.set(sc/m.userData.baseScale,1,sc/m.userData.baseScale);
          m.material.opacity=Math.max(0.02,0.2-phase*0.06);
        }
        if(m.userData.at==='alarm_ring'){
          var ap=(now*0.002)%1;
          var asc=0.5+ap*0.6;
          m.scale.set(asc/0.5,1,asc/0.5);
          m.material.opacity=0.3*(1-ap);
        }
        if(m.userData.at==='gravity_ring'){
          m.material.opacity=0.12+0.06*Math.sin(now*0.002+m.userData.baseY*10);
        }
        // Jitter mini-person point clouds
        if(m.userData.at==='jitter'&&m.userData.basePositions){
          cfgJitterPointCloud(m,0.02);
        }
        // Also jitter children of groups (for _ovMiniPerson inside groups)
        if(m.isGroup){m.traverse(function(ch){
          if(ch.userData&&ch.userData.at==='jitter'&&ch.userData.basePositions)cfgJitterPointCloud(ch,0.02);
        });}
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
var cfgOvDispatch={
  gate_counters:cfgOvGateCounters, heatmap3d:cfgOvHeatmap3D, dwell_rings:cfgOvDwellRings,
  funnel:cfgOvFunnel, queue_people:cfgOvQueuePeople, split_compare:cfgOvSplitCompare,
  directed_flow:cfgOvDirectedFlow, gravity_wells:cfgOvGravityWells, two_groups:cfgOvTwoGroups,
  zone_polygons:cfgOvZonePolygons, bottleneck:cfgOvBottleneck, density_alert:cfgOvDensityAlert,
  capacity_bars:cfgOvCapacityBars, spotlight:cfgOvSpotlight, thermal:cfgOvThermal, thick_paths:cfgOvThickPaths
};

function cfgUpdateOv(){
  if(!cfgO3dScene)return;
  cfgO3dOvMeshes.forEach(function(m){cfgO3dScene.remove(m);});
  cfgO3dOvMeshes=[];
  var t=CFG.venueType||'retail',oc=OUTCOMES_REGISTRY[t]||OUTCOMES_REGISTRY.retail;
  var active=new Set();
  oc.forEach(function(o){if(CFG.selectedOutcomes.has(o.id))active.add(o.overlay);});
  var vw=cfgToMeters(CFG.width),vl=cfgToMeters(CFG.length);
  active.forEach(function(k){if(cfgOvDispatch[k])cfgOvDispatch[k](vw,vl);});
  var badge=document.getElementById('cfgO3dBadge');
  if(badge)badge.textContent=active.size>0?active.size+' overlay'+(active.size>1?'s':'')+' active — drag to rotate':'Toggle outcomes to see overlays update live';
}

// Helper: add mesh to scene + overlay list
function _ov(m){cfgO3dScene.add(m);cfgO3dOvMeshes.push(m);return m;}

// Helper: make a canvas sprite label
function _ovSprite(text,subtext,color,x,y,z,scale){
  var c=document.createElement('canvas');c.width=256;c.height=128;
  var ctx=c.getContext('2d');
  ctx.fillStyle='rgba(0,0,0,0.75)';
  ctx.beginPath();if(ctx.roundRect)ctx.roundRect(4,4,248,120,16);else ctx.rect(4,4,248,120);ctx.fill();
  ctx.strokeStyle=color;ctx.lineWidth=2;
  ctx.beginPath();if(ctx.roundRect)ctx.roundRect(4,4,248,120,16);else ctx.rect(4,4,248,120);ctx.stroke();
  ctx.font='bold 42px system-ui,sans-serif';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(text,128,60);
  if(subtext){ctx.font='18px system-ui,sans-serif';ctx.fillStyle='#94a3b8';ctx.fillText(subtext,128,95);}
  var tex=new THREE.CanvasTexture(c);
  var mat=new THREE.SpriteMaterial({map:tex,transparent:true,opacity:0.95,depthTest:false});
  var s=new THREE.Sprite(mat);s.scale.set(scale||2,scale?scale*0.5:1,1);
  s.position.set(x,y,z);return _ov(s);
}

// Helper: ROI-style polygon outline + fill on floor
function _ovZonePoly(pts,fillColor,fillOpacity,lineColor){
  var g=new THREE.Group();
  var verts=[];var inds=[];
  pts.forEach(function(p){verts.push(p.x,0.03,p.z);});
  for(var j=1;j<pts.length-1;j++)inds.push(0,j,j+1);
  var geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
  geo.setIndex(inds);geo.computeVertexNormals();
  g.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:fillColor,transparent:true,opacity:fillOpacity,side:THREE.DoubleSide,depthWrite:false})));
  var lp=pts.map(function(p){return new THREE.Vector3(p.x,0.04,p.z);});
  lp.push(lp[0].clone());
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lp),new THREE.LineBasicMaterial({color:lineColor||fillColor,transparent:true,opacity:0.7})));
  return _ov(g);
}

// Helper: small point-cloud person (queue figure)
function _ovMiniPerson(x,z,color,h){
  h=h||1.4;var r=0.15;
  var g=new THREE.Group();
  var pcPos=cfgGenCapsulePoints(r,h,120);
  var pcGeo=new THREE.BufferGeometry();pcGeo.setAttribute('position',new THREE.BufferAttribute(pcPos,3));
  var pc=new THREE.Points(pcGeo,new THREE.PointsMaterial({color:color,size:0.035,transparent:true,opacity:0.8,sizeAttenuation:true,depthWrite:false}));
  pc.userData.basePositions=new Float32Array(pcPos);pc.userData.at='jitter';
  g.add(pc);
  var eg=new THREE.EdgesGeometry(new THREE.BoxGeometry(r*2,h,r*2));
  g.add(new THREE.LineSegments(eg,new THREE.LineBasicMaterial({color:color,transparent:true,opacity:0.4})));
  g.position.set(x,h/2,z);return g;
}

// ─── 1. GATE COUNTERS ───
function cfgOvGateCounters(vw,vl){
  var gates=[[vw*0.3,vl*0.02],[vw*0.7,vl*0.02]];
  if(vw>12)gates.push([vw*0.5,vl*0.02]);
  var vh=cfgToMeters(CFG.height);
  gates.forEach(function(g,i){
    var gx=g[0],gz=g[1];
    // Arch pillars
    var pillarMat=new THREE.MeshStandardMaterial({color:0x22c55e,emissive:0x0a3d1a,emissiveIntensity:0.4,transparent:true,opacity:0.6});
    var lp=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,vh*0.7,8),pillarMat);
    lp.position.set(gx-0.8,vh*0.35,gz);_ov(lp);
    var rp=new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,vh*0.7,8),pillarMat);
    rp.position.set(gx+0.8,vh*0.35,gz);_ov(rp);
    // Arch top bar
    var bar=new THREE.Mesh(new THREE.BoxGeometry(1.7,0.08,0.08),pillarMat);
    bar.position.set(gx,vh*0.7,gz);_ov(bar);
    // Scanning beam on floor
    var beam=new THREE.Mesh(new THREE.PlaneGeometry(1.6,0.6),new THREE.MeshBasicMaterial({color:0x22c55e,transparent:true,opacity:0.12,side:THREE.DoubleSide,depthWrite:false}));
    beam.rotation.x=-Math.PI/2;beam.position.set(gx,0.02,gz+0.3);
    beam.userData.at='pulse';_ov(beam);
    // Counter sprite
    var count=Math.floor(Math.random()*200+40);
    _ovSprite(String(count),'visitors / hr','#22c55e',gx,vh*0.7+0.8,gz,1.8);
    // Direction arrows on floor
    for(var a=-0.4;a<=0.4;a+=0.4){
      var arrowPts=[new THREE.Vector3(gx+a,0.03,gz-0.1),new THREE.Vector3(gx+a,0.03,gz+0.8)];
      var arrowGeo=new THREE.BufferGeometry().setFromPoints(arrowPts);
      var arrow=new THREE.Line(arrowGeo,new THREE.LineBasicMaterial({color:0x22c55e,transparent:true,opacity:0.4}));
      _ov(arrow);
      // Arrowhead triangle
      var triGeo=new THREE.BufferGeometry();
      triGeo.setAttribute('position',new THREE.Float32BufferAttribute([gx+a-0.12,0.03,gz+0.6, gx+a+0.12,0.03,gz+0.6, gx+a,0.03,gz+0.85],3));
      triGeo.setIndex([0,1,2]);
      _ov(new THREE.Mesh(triGeo,new THREE.MeshBasicMaterial({color:0x22c55e,transparent:true,opacity:0.35,side:THREE.DoubleSide,depthWrite:false})));
    }
  });
}

// ─── 2. HEATMAP 3D (extruded bars) ───
function cfgOvHeatmap3D(vw,vl){
  var cols=Math.max(4,Math.round(vw/1.5)),rows=Math.max(3,Math.round(vl/1.5));
  var cw=vw/cols,cl=vl/rows;
  var maxH=Math.min(vw,vl)*0.15;
  for(var r=0;r<rows;r++){for(var c=0;c<cols;c++){
    var intensity=Math.pow(Math.random(),0.7);
    // Gaussian-like hotspot bias toward center
    var cx=(c+0.5)/cols-0.5,cz=(r+0.5)/rows-0.5;
    var distFromCenter=Math.sqrt(cx*cx+cz*cz)*2;
    intensity=Math.max(0.05,intensity*(1-distFromCenter*0.5));
    var h=0.02+intensity*maxH;
    var color=new THREE.Color();
    // Blue→Cyan→Green→Yellow→Red gradient
    if(intensity<0.25)color.setHSL(0.6-intensity*0.8,0.85,0.4+intensity*0.3);
    else if(intensity<0.5)color.setHSL(0.4-(intensity-0.25)*1.2,0.85,0.45+intensity*0.15);
    else if(intensity<0.75)color.setHSL(0.15-(intensity-0.5)*0.4,0.9,0.5);
    else color.setHSL(0.0,0.9,0.45+intensity*0.1);
    var geo=new THREE.BoxGeometry(cw*0.85,h,cl*0.85);
    var mat=new THREE.MeshStandardMaterial({color:color,emissive:color,emissiveIntensity:0.3,transparent:true,opacity:0.7,depthWrite:false});
    var m=new THREE.Mesh(geo,mat);
    m.position.set(cw*0.5+c*cw,h/2,cl*0.5+r*cl);
    _ov(m);
  }}
}

// ─── 3. DWELL RINGS (pulsing radar ripples) ───
function cfgOvDwellRings(vw,vl){
  var spots=[[vw*0.25,vl*0.3],[vw*0.7,vl*0.25],[vw*0.5,vl*0.6],[vw*0.3,vl*0.8],[vw*0.75,vl*0.75]];
  var RING_COLORS=[0x06b6d4,0x14b8a6,0x22d3ee,0x0ea5e9,0x06b6d4];
  spots.forEach(function(s,idx){
    var dwell=Math.random()*40+10;
    var maxR=0.8+dwell*0.03;
    var col=RING_COLORS[idx%RING_COLORS.length];
    for(var ri=0;ri<3;ri++){
      var ring=new THREE.Mesh(
        new THREE.RingGeometry(maxR*(0.3+ri*0.3)-0.04,maxR*(0.3+ri*0.3),48),
        new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.2-ri*0.05,side:THREE.DoubleSide,depthWrite:false})
      );
      ring.rotation.x=-Math.PI/2;ring.position.set(s[0],0.03,s[1]);
      ring.userData.at='dwell_ring';ring.userData.ringIdx=ri;ring.userData.maxR=maxR;ring.userData.baseScale=0.3+ri*0.3;
      _ov(ring);
    }
    // Center dot
    var dot=new THREE.Mesh(new THREE.CircleGeometry(0.15,24),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.6,side:THREE.DoubleSide,depthWrite:false}));
    dot.rotation.x=-Math.PI/2;dot.position.set(s[0],0.04,s[1]);_ov(dot);
    // Dwell label
    _ovSprite(dwell.toFixed(0)+'s','avg dwell','#06b6d4',s[0],1.5,s[1],1.4);
  });
}

// ─── 4. FUNNEL (conversion visualization) ───
function cfgOvFunnel(vw,vl){
  // Entry zone — wide translucent zone at entrance
  var entryW=vw*0.5,entryD=vl*0.12;
  var entryZone=new THREE.Mesh(
    new THREE.BoxGeometry(entryW,0.3,entryD),
    new THREE.MeshStandardMaterial({color:0x3b82f6,emissive:0x3b82f6,emissiveIntensity:0.2,transparent:true,opacity:0.2,depthWrite:false})
  );
  entryZone.position.set(vw/2,0.15,vl*0.08);_ov(entryZone);
  // Entry outline
  var eEdge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(entryW,0.3,entryD)),new THREE.LineBasicMaterial({color:0x3b82f6,transparent:true,opacity:0.5}));
  eEdge.position.copy(entryZone.position);_ov(eEdge);
  _ovSprite('348','entries','#3b82f6',vw/2,1.2,vl*0.08,1.5);

  // Target conversion zone — smaller, deeper in venue
  var targW=vw*0.2,targD=vl*0.1;
  var targZone=new THREE.Mesh(
    new THREE.BoxGeometry(targW,0.5,targD),
    new THREE.MeshStandardMaterial({color:0x22c55e,emissive:0x22c55e,emissiveIntensity:0.3,transparent:true,opacity:0.25,depthWrite:false})
  );
  targZone.position.set(vw*0.55,0.25,vl*0.65);_ov(targZone);
  var tEdge=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(targW,0.5,targD)),new THREE.LineBasicMaterial({color:0x22c55e,transparent:true,opacity:0.6}));
  tEdge.position.copy(targZone.position);_ov(tEdge);
  _ovSprite('112','engaged','#22c55e',vw*0.55,1.5,vl*0.65,1.5);

  // Connecting flow arrows
  var funnelPts=[
    new THREE.Vector3(vw/2,0.06,vl*0.15),
    new THREE.Vector3(vw*0.48,0.06,vl*0.3),
    new THREE.Vector3(vw*0.52,0.06,vl*0.45),
    new THREE.Vector3(vw*0.55,0.06,vl*0.58)
  ];
  var curve=new THREE.CatmullRomCurve3(funnelPts);
  var fGeo=new THREE.BufferGeometry().setFromPoints(curve.getPoints(40));
  var fLine=new THREE.Line(fGeo,new THREE.LineDashedMaterial({color:0xf59e0b,dashSize:0.35,gapSize:0.15,transparent:true,opacity:0.6}));
  fLine.computeLineDistances();fLine.userData.at='flow';_ov(fLine);
  // Second path
  var funnelPts2=[
    new THREE.Vector3(vw*0.4,0.06,vl*0.15),
    new THREE.Vector3(vw*0.42,0.06,vl*0.35),
    new THREE.Vector3(vw*0.5,0.06,vl*0.5),
    new THREE.Vector3(vw*0.55,0.06,vl*0.58)
  ];
  var curve2=new THREE.CatmullRomCurve3(funnelPts2);
  var fGeo2=new THREE.BufferGeometry().setFromPoints(curve2.getPoints(40));
  var fLine2=new THREE.Line(fGeo2,new THREE.LineDashedMaterial({color:0xf59e0b,dashSize:0.35,gapSize:0.15,transparent:true,opacity:0.45}));
  fLine2.computeLineDistances();fLine2.userData.at='flow';_ov(fLine2);

  // Conversion rate badge
  _ovSprite('32%','conversion','#f59e0b',vw*0.52,2.5,vl*0.4,2.2);
}

// ─── 5. QUEUE PEOPLE (point-cloud figures in line) ───
function cfgOvQueuePeople(vw,vl){
  var queueZones=[[vw*0.25,vl*0.88],[vw*0.5,vl*0.88],[vw*0.75,vl*0.88]];
  var QUEUE_COLORS=[0xf59e0b,0xef4444,0xf59e0b];
  queueZones.forEach(function(qz,qi){
    var numPeople=3+Math.floor(Math.random()*3);
    var qColor=QUEUE_COLORS[qi];
    // Queue boundary ring
    var ringR=numPeople*0.25+0.3;
    var ring=new THREE.Mesh(
      new THREE.RingGeometry(ringR-0.04,ringR,48),
      new THREE.MeshBasicMaterial({color:qColor,transparent:true,opacity:0.25,side:THREE.DoubleSide,depthWrite:false})
    );
    ring.rotation.x=-Math.PI/2;ring.position.set(qz[0],0.03,qz[1]);
    ring.userData.at='pulse';_ov(ring);
    // Queue fill
    var fill=new THREE.Mesh(
      new THREE.CircleGeometry(ringR-0.04,48),
      new THREE.MeshBasicMaterial({color:qColor,transparent:true,opacity:0.06,side:THREE.DoubleSide,depthWrite:false})
    );
    fill.rotation.x=-Math.PI/2;fill.position.set(qz[0],0.02,qz[1]);_ov(fill);
    // People in queue
    for(var p=0;p<numPeople;p++){
      var px=qz[0]-numPeople*0.22+p*0.45;
      var pz=qz[1]+0.05*(p%2);
      var person=_ovMiniPerson(px,pz,qColor,1.2+Math.random()*0.3);
      _ov(person);
    }
    // Wait time label
    var wait=Math.floor(Math.random()*4+1);
    _ovSprite(wait+'m '+Math.floor(Math.random()*50)+'s','est. wait',qi===1?'#ef4444':'#f59e0b',qz[0],2.2,qz[1],1.6);
  });
}

// ─── 6. SPLIT COMPARE (before/after campaign) ───
function cfgOvSplitCompare(vw,vl){
  // Vertical divider plane
  var divH=cfgToMeters(CFG.height)*0.6;
  var divider=new THREE.Mesh(
    new THREE.PlaneGeometry(0.02,divH),
    new THREE.MeshBasicMaterial({color:0xf59e0b,transparent:true,opacity:0.5,side:THREE.DoubleSide})
  );
  divider.position.set(vw/2,divH/2,vl/2);_ov(divider);
  // Divider floor line
  var floorLine=new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(vw/2,0.05,0),new THREE.Vector3(vw/2,0.05,vl)]),
    new THREE.LineBasicMaterial({color:0xf59e0b,transparent:true,opacity:0.6})
  );
  _ov(floorLine);

  // "Before" label
  _ovSprite('Before','baseline','#3b82f6',vw*0.25,divH+0.5,vl*0.1,1.8);
  // "After" label
  _ovSprite('After','campaign','#22c55e',vw*0.75,divH+0.5,vl*0.1,1.8);

  // Before side — sparse blue people
  for(var i=0;i<4;i++){
    var bx=Math.random()*(vw*0.4-1)+0.5;
    var bz=Math.random()*(vl-2)+1;
    var bp=_ovMiniPerson(bx,bz,0x3b82f6,1.3+Math.random()*0.3);
    _ov(bp);
  }
  // After side — dense green people
  for(var i=0;i<8;i++){
    var ax=vw*0.5+Math.random()*(vw*0.4-1)+0.5;
    var az=Math.random()*(vl-2)+1;
    var ap=_ovMiniPerson(ax,az,0x22c55e,1.3+Math.random()*0.3);
    _ov(ap);
  }
  // Lift badge
  _ovSprite('↑ 48%','traffic lift','#22c55e',vw*0.5,divH+1.2,vl*0.5,2.5);
}

// ─── 7. DIRECTED FLOW — no additional 3D overlay (people trails are enough) ───
function cfgOvDirectedFlow(vw,vl){}

// ─── 8. GRAVITY WELLS (zone attraction) ───
function cfgOvGravityWells(vw,vl){
  var wells=[[vw*0.2,vl*0.3,0.8],[vw*0.5,vl*0.5,1.0],[vw*0.8,vl*0.35,0.6],[vw*0.35,vl*0.75,0.7],[vw*0.7,vl*0.7,0.5]];
  var WELL_COLORS=[0x8b5cf6,0x6366f1,0xa855f7,0x7c3aed,0x9333ea];
  wells.forEach(function(w,idx){
    var wx=w[0],wz=w[1],strength=w[2];
    var col=WELL_COLORS[idx%WELL_COLORS.length];
    var radius=strength*1.5;
    // Funnel rings (concentric, descending)
    for(var ri=0;ri<4;ri++){
      var rr=radius*(1-ri*0.2);
      var ry=-ri*0.08;
      var ring=new THREE.Mesh(
        new THREE.RingGeometry(rr-0.05,rr,48),
        new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.2-ri*0.04,side:THREE.DoubleSide,depthWrite:false})
      );
      ring.rotation.x=-Math.PI/2;ring.position.set(wx,0.03+ry,wz);
      ring.userData.at='gravity_ring';ring.userData.baseY=0.03+ry;
      _ov(ring);
    }
    // Attraction lines from surrounding area
    for(var li=0;li<6;li++){
      var la=li/6*Math.PI*2;
      var lr=radius*1.5;
      var lpts=[
        new THREE.Vector3(wx+Math.cos(la)*lr,0.04,wz+Math.sin(la)*lr),
        new THREE.Vector3(wx+Math.cos(la)*radius*0.6,0.04,wz+Math.sin(la)*radius*0.6),
        new THREE.Vector3(wx,0.04,wz)
      ];
      var lGeo=new THREE.BufferGeometry().setFromPoints(lpts);
      var ln=new THREE.Line(lGeo,new THREE.LineDashedMaterial({color:col,dashSize:0.2,gapSize:0.1,transparent:true,opacity:0.35}));
      ln.computeLineDistances();ln.userData.at='flow';
      _ov(ln);
    }
    // Strength label
    _ovSprite((strength*100).toFixed(0)+'%','attraction',idx<2?'#8b5cf6':'#a855f7',wx,1.8,wz,1.4);
  });
}

// ─── 9. TWO GROUPS (staff vs guests) ───
function cfgOvTwoGroups(vw,vl){
  var staffColor=0x22c55e,guestColor=0x3b82f6;
  // Staff cluster (fewer, distributed)
  for(var i=0;i<4;i++){
    var sx=Math.random()*(vw-2)+1,sz=Math.random()*(vl-2)+1;
    var sp=_ovMiniPerson(sx,sz,staffColor,1.5);
    _ov(sp);
    // Staff ring marker above head
    var ring=new THREE.Mesh(new THREE.RingGeometry(0.18,0.22,16),new THREE.MeshBasicMaterial({color:staffColor,transparent:true,opacity:0.7,side:THREE.DoubleSide}));
    ring.rotation.x=-Math.PI/2;ring.position.set(sx,1.75,sz);_ov(ring);
  }
  // Guest cluster (more, random)
  for(var i=0;i<8;i++){
    var gx=Math.random()*(vw-2)+1,gz=Math.random()*(vl-2)+1;
    var gp=_ovMiniPerson(gx,gz,guestColor,1.3+Math.random()*0.3);
    _ov(gp);
  }
  // Legend
  _ovSprite('4 Staff','','#22c55e',vw*0.2,cfgToMeters(CFG.height)*0.6,vl*0.05,1.6);
  _ovSprite('8 Guests','','#3b82f6',vw*0.8,cfgToMeters(CFG.height)*0.6,vl*0.05,1.6);
}

// ─── 10. ZONE POLYGONS (ROI-style occupancy zones) ───
function cfgOvZonePolygons(vw,vl){
  var ZONE_COLORS=[0xf59e0b,0x3b82f6,0x22c55e,0xef4444,0x8b5cf6];
  var zones=[
    {cx:vw*0.25,cz:vl*0.3,w:vw*0.3,d:vl*0.25,count:Math.floor(Math.random()*30+5)},
    {cx:vw*0.75,cz:vl*0.3,w:vw*0.25,d:vl*0.3,count:Math.floor(Math.random()*30+5)},
    {cx:vw*0.5,cz:vl*0.7,w:vw*0.35,d:vl*0.2,count:Math.floor(Math.random()*30+5)},
    {cx:vw*0.25,cz:vl*0.75,w:vw*0.2,d:vl*0.2,count:Math.floor(Math.random()*30+5)},
  ];
  zones.forEach(function(z,i){
    var hw=z.w/2,hd=z.d/2;
    var col=ZONE_COLORS[i%ZONE_COLORS.length];
    var occ=z.count/40;
    var pts=[{x:z.cx-hw,z:z.cz-hd},{x:z.cx+hw,z:z.cz-hd},{x:z.cx+hw,z:z.cz+hd},{x:z.cx-hw,z:z.cz+hd}];
    _ovZonePoly(pts,col,0.08+occ*0.1,col);
    // Count label
    _ovSprite(String(z.count),'people',new THREE.Color(col).getStyle(),z.cx,1.8,z.cz,1.5);
  });
}

// ─── 11. BOTTLENECK (pinch-point markers) ───
function cfgOvBottleneck(vw,vl){
  var chokes=[[vw*0.35,vl*0.4],[vw*0.65,vl*0.6]];
  chokes.forEach(function(ch){
    var cx=ch[0],cz=ch[1];
    // Warning triangle
    var triGeo=new THREE.BufferGeometry();
    triGeo.setAttribute('position',new THREE.Float32BufferAttribute([cx,1.5,cz-0.3, cx-0.25,1.1,cz+0.15, cx+0.25,1.1,cz+0.15],3));
    triGeo.setIndex([0,1,2]);triGeo.computeVertexNormals();
    var tri=new THREE.Mesh(triGeo,new THREE.MeshBasicMaterial({color:0xef4444,transparent:true,opacity:0.7,side:THREE.DoubleSide}));
    tri.userData.at='pulse';_ov(tri);
    // Warning outline
    var triLine=new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx,1.5,cz-0.3),new THREE.Vector3(cx-0.25,1.1,cz+0.15),new THREE.Vector3(cx+0.25,1.1,cz+0.15),new THREE.Vector3(cx,1.5,cz-0.3)]),
      new THREE.LineBasicMaterial({color:0xfca5a5,transparent:true,opacity:0.8})
    );
    _ov(triLine);
    // Pulsing red ring on floor
    var ring=new THREE.Mesh(new THREE.RingGeometry(0.8,0.88,48),new THREE.MeshBasicMaterial({color:0xef4444,transparent:true,opacity:0.25,side:THREE.DoubleSide,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.set(cx,0.03,cz);ring.userData.at='pulse';_ov(ring);
    // Converging arrows from both sides
    var arrowLen=1.5;
    [[-1,0],[1,0],[0,-1],[0,1]].forEach(function(d){
      var pts=[new THREE.Vector3(cx+d[0]*arrowLen,0.05,cz+d[1]*arrowLen),new THREE.Vector3(cx+d[0]*0.4,0.05,cz+d[1]*0.4)];
      var aLine=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:0xef4444,dashSize:0.15,gapSize:0.08,transparent:true,opacity:0.5}));
      aLine.computeLineDistances();aLine.userData.at='flow';_ov(aLine);
    });
    // Label
    _ovSprite('Bottleneck','congestion alert','#ef4444',cx,2.2,cz,1.8);
  });
}

// ─── 12. DENSITY ALERT (graduated zones with alarm) ───
function cfgOvDensityAlert(vw,vl){
  var zones=[
    {cx:vw*0.3,cz:vl*0.4,r:1.5,level:0.4},
    {cx:vw*0.6,cz:vl*0.5,r:1.8,level:0.85},
    {cx:vw*0.5,cz:vl*0.8,r:1.2,level:0.6},
  ];
  zones.forEach(function(z){
    var col=new THREE.Color();
    if(z.level<0.5)col.setHSL(0.3,0.8,0.45);
    else if(z.level<0.7)col.setHSL(0.12,0.9,0.5);
    else col.setHSL(0.0,0.9,0.5);
    // Filled circle
    var fill=new THREE.Mesh(new THREE.CircleGeometry(z.r,48),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.1+z.level*0.12,side:THREE.DoubleSide,depthWrite:false}));
    fill.rotation.x=-Math.PI/2;fill.position.set(z.cx,0.02,z.cz);_ov(fill);
    // Border ring
    var ring=new THREE.Mesh(new THREE.RingGeometry(z.r-0.04,z.r,48),new THREE.MeshBasicMaterial({color:col,transparent:true,opacity:0.4,side:THREE.DoubleSide,depthWrite:false}));
    ring.rotation.x=-Math.PI/2;ring.position.set(z.cx,0.03,z.cz);_ov(ring);
    // Alarm expanding ring on high-density zone
    if(z.level>0.7){
      var alarm=new THREE.Mesh(new THREE.RingGeometry(z.r*0.5,z.r*0.55,48),new THREE.MeshBasicMaterial({color:0xef4444,transparent:true,opacity:0.3,side:THREE.DoubleSide,depthWrite:false}));
      alarm.rotation.x=-Math.PI/2;alarm.position.set(z.cx,0.04,z.cz);
      alarm.userData.at='alarm_ring';alarm.userData.baseR=z.r;
      _ov(alarm);
    }
    // Density label
    var lvlText=z.level>0.7?'HIGH':z.level>0.5?'MEDIUM':'LOW';
    var lvlCol=z.level>0.7?'#ef4444':z.level>0.5?'#f59e0b':'#22c55e';
    _ovSprite(lvlText,(z.level*100).toFixed(0)+'% capacity',lvlCol,z.cx,1.6,z.cz,1.5);
  });
}

// ─── 13. CAPACITY BARS (3D progress bars) ───
function cfgOvCapacityBars(vw,vl){
  var zones=[
    {cx:vw*0.2,cz:vl*0.3,label:'Meeting A',util:0.72},
    {cx:vw*0.5,cz:vl*0.3,label:'Open Plan',util:0.45},
    {cx:vw*0.8,cz:vl*0.3,label:'Meeting B',util:0.91},
    {cx:vw*0.35,cz:vl*0.7,label:'Lounge',util:0.28},
    {cx:vw*0.65,cz:vl*0.7,label:'Focus',util:0.65},
  ];
  var barW=vw*0.08,barD=0.3,maxH=2.0;
  zones.forEach(function(z){
    var fillH=z.util*maxH;
    var col=new THREE.Color();
    if(z.util<0.5)col.setHSL(0.35,0.8,0.45);
    else if(z.util<0.75)col.setHSL(0.12,0.9,0.5);
    else col.setHSL(0.0,0.9,0.5);
    // Background bar (gray)
    var bgGeo=new THREE.BoxGeometry(barW,maxH,barD);
    var bgMat=new THREE.MeshStandardMaterial({color:0x334155,transparent:true,opacity:0.15,depthWrite:false});
    var bg=new THREE.Mesh(bgGeo,bgMat);bg.position.set(z.cx,maxH/2,z.cz);_ov(bg);
    var bgEdge=new THREE.LineSegments(new THREE.EdgesGeometry(bgGeo),new THREE.LineBasicMaterial({color:0x475569,transparent:true,opacity:0.3}));
    bgEdge.position.copy(bg.position);_ov(bgEdge);
    // Fill bar
    var fillGeo=new THREE.BoxGeometry(barW*0.9,fillH,barD*0.9);
    var fillMat=new THREE.MeshStandardMaterial({color:col,emissive:col,emissiveIntensity:0.3,transparent:true,opacity:0.7,depthWrite:false});
    var fill=new THREE.Mesh(fillGeo,fillMat);fill.position.set(z.cx,fillH/2,z.cz);_ov(fill);
    // Label
    _ovSprite((z.util*100).toFixed(0)+'%',z.label,col.getStyle(),z.cx,maxH+0.6,z.cz,1.4);
  });
}

// ─── 14. SPOTLIGHT (anomaly detection beams) ───
function cfgOvSpotlight(vw,vl){
  var vh=cfgToMeters(CFG.height);
  var spots=[[vw*0.3,vl*0.35],[vw*0.7,vl*0.6]];
  spots.forEach(function(s){
    var sx=s[0],sz=s[1];
    // Cone beam from ceiling
    var coneH=vh*0.8;
    var coneR=0.8;
    var cone=new THREE.Mesh(
      new THREE.ConeGeometry(coneR,coneH,24,1,true),
      new THREE.MeshBasicMaterial({color:0xef4444,transparent:true,opacity:0.08,side:THREE.DoubleSide,depthWrite:false})
    );
    cone.position.set(sx,vh-coneH/2,sz);_ov(cone);
    // Cone edge wireframe
    var coneEdge=new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.ConeGeometry(coneR,coneH,12,1,true)),
      new THREE.LineBasicMaterial({color:0xef4444,transparent:true,opacity:0.3})
    );
    coneEdge.position.copy(cone.position);_ov(coneEdge);
    // Floor impact circle
    var impact=new THREE.Mesh(new THREE.CircleGeometry(coneR,32),new THREE.MeshBasicMaterial({color:0xef4444,transparent:true,opacity:0.15,side:THREE.DoubleSide,depthWrite:false}));
    impact.rotation.x=-Math.PI/2;impact.position.set(sx,0.03,sz);
    impact.userData.at='pulse';_ov(impact);
    // Warning label
    _ovSprite('Anomaly','unusual pattern','#ef4444',sx,vh*0.5,sz,1.8);
  });
}

// ─── 15. THERMAL (energy proxy gradient) ───
function cfgOvThermal(vw,vl){
  var cols=Math.max(4,Math.round(vw/2)),rows=Math.max(3,Math.round(vl/2));
  var cw=vw/cols,cl=vl/rows;
  for(var r=0;r<rows;r++){for(var c=0;c<cols;c++){
    var occupied=Math.random();
    // Cool blue (empty) → Warm orange (occupied)
    var color=new THREE.Color();
    if(occupied<0.3)color.setHSL(0.6,0.7,0.35);
    else if(occupied<0.6)color.setHSL(0.45,0.6,0.4);
    else if(occupied<0.8)color.setHSL(0.1,0.8,0.5);
    else color.setHSL(0.05,0.9,0.5);
    var geo=new THREE.PlaneGeometry(cw*0.92,cl*0.92);
    var mat=new THREE.MeshBasicMaterial({color:color,transparent:true,opacity:0.1+occupied*0.12,side:THREE.DoubleSide,depthWrite:false});
    var m=new THREE.Mesh(geo,mat);m.rotation.x=-Math.PI/2;
    m.position.set(cw*0.5+c*cw,0.02,cl*0.5+r*cl);_ov(m);
    // Small energy icon on high-use zones
    if(occupied>0.75){
      var spark=new THREE.Mesh(new THREE.SphereGeometry(0.08,8,8),new THREE.MeshBasicMaterial({color:0xf59e0b,emissive:0xf59e0b,emissiveIntensity:0.5,transparent:true,opacity:0.7}));
      spark.position.set(cw*0.5+c*cw,0.3,cl*0.5+r*cl);
      spark.userData.at='pulse';_ov(spark);
    }
  }}
  // Legend
  _ovSprite('Cool → Warm','energy usage proxy','#f59e0b',vw/2,cfgToMeters(CFG.height)*0.5,vl*0.02,2);
}

// ─── 16. THICK PATHS (path preference / popularity) ───
function cfgOvThickPaths(vw,vl){
  var paths=[
    {popularity:1.0,color:0x06b6d4,waypoints:[[0.15,0.05],[0.2,0.3],[0.35,0.5],[0.5,0.6],[0.7,0.7],[0.85,0.9]]},
    {popularity:0.7,color:0x3b82f6,waypoints:[[0.1,0.1],[0.25,0.25],[0.5,0.35],[0.75,0.5],[0.8,0.8]]},
    {popularity:0.4,color:0x6366f1,waypoints:[[0.85,0.05],[0.7,0.2],[0.6,0.45],[0.4,0.7],[0.2,0.9]]},
    {popularity:0.2,color:0x8b5cf6,waypoints:[[0.5,0.05],[0.55,0.2],[0.45,0.4],[0.3,0.55],[0.15,0.85]]},
  ];
  paths.forEach(function(p){
    var pts=p.waypoints.map(function(w){return new THREE.Vector3(w[0]*vw,0.05,w[1]*vl);});
    var curve=new THREE.CatmullRomCurve3(pts);
    var curvePoints=curve.getPoints(80);
    // Main path line
    var lineGeo=new THREE.BufferGeometry().setFromPoints(curvePoints);
    var line=new THREE.Line(lineGeo,new THREE.LineBasicMaterial({color:p.color,transparent:true,opacity:0.3+p.popularity*0.5}));
    _ov(line);
    // Thicker tube for popular paths
    if(p.popularity>0.5){
      var tubeGeo=new THREE.TubeGeometry(curve,40,0.03+p.popularity*0.06,6,false);
      var tube=new THREE.Mesh(tubeGeo,new THREE.MeshStandardMaterial({color:p.color,emissive:p.color,emissiveIntensity:0.3,transparent:true,opacity:0.35+p.popularity*0.2}));
      _ov(tube);
    }
    // Direction arrows
    for(var a=0;a<2;a++){
      var t=(a+1)/3;
      var pos=curve.getPoint(t);
      var tan=curve.getTangent(t);
      var cone=new THREE.Mesh(new THREE.ConeGeometry(0.1,0.25,6),new THREE.MeshStandardMaterial({color:p.color,emissive:p.color,emissiveIntensity:0.3,transparent:true,opacity:0.7}));
      cone.position.set(pos.x,0.15,pos.z);
      var angle=Math.atan2(tan.x,tan.z);
      cone.rotation.set(0,angle,Math.PI/2);
      cone.userData.at='arrow';cone.userData.curve=curve;cone.userData.baseT=t;cone.userData.speed=0.0004;
      _ov(cone);
    }
    // Popularity label on most popular
    if(p.popularity>=0.9){
      var mid=curve.getPoint(0.5);
      _ovSprite('★ Popular','most-used route','#06b6d4',mid.x,1.5,mid.z,1.6);
    }
  });
}
