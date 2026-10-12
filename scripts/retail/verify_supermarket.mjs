import fs from 'node:fs';
import assert from 'node:assert/strict';
import { GLTFLoader } from '../../frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Vector3, Matrix4, Quaternion } from '../../frontend/node_modules/three/build/three.module.js';
import { inRings } from '../../frontend/public/flowfield/retail-geometry.js';
import { createHash } from 'node:crypto';
const publicRoot=new URL('../../frontend/public/flowfield/',import.meta.url);
const read=(p)=>JSON.parse(fs.readFileSync(new URL(p,publicRoot)));
const manifest=read('retail/manifest.json'),layout=read('layout_prod.json'),areas=read('visitor-areas.json');
const results={assets:{},fixtures:manifest.fixtures.length,departments:manifest.departments.length};
for(const [name,spec] of Object.entries(manifest.assets))for(const level of ['detail','overview']){
  const url=level==='detail'?spec.url:spec.overviewUrl,b=fs.readFileSync(new URL(url,publicRoot));
  const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  const bounds=new Box3().setFromObject(gltf.scene),size=bounds.getSize(new Vector3());
  assert.ok(Math.abs(size.x-spec.width)<.06 && Math.abs(size.z-spec.length)<.06 && Math.abs(bounds.min.y)<.035 && size.y<2.5,`${name}/${level} dimensions/origin: ${size.toArray()}`);
  let meshes=0,triangles=0;
  gltf.scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;assert.equal(o.material.map,null);}});
  results.assets[name+'/'+level]={bytes:b.length,meshes,triangles,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}};
  for(const f of manifest.fixtures.filter(f=>f.asset===name)){
    assert.deepEqual(f.polygon,layout.polys[f.cadIndex]);
    const n=f.tile===false?1:Math.max(1,Math.round(f.length/spec.length));
    for(let j=0;j<n;j++){
      const off=(j-(n-1)/2)*f.length/n;
      const matrix=new Matrix4().compose(new Vector3(f.x+Math.sin(f.yaw)*off,0,f.z+Math.cos(f.yaw)*off),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),f.yaw),new Vector3(f.width/spec.width,1,f.length/n/spec.length));
      // Grid covers concave source footprints too, not just their four corner values.
      for(let x=0;x<=10;x++)for(let z=0;z<=10;z++){
        const point=new Vector3((x/10-.5)*(size.x-.004),0,(z/10-.5)*(size.z-.004)).applyMatrix4(matrix);
        assert.ok(inRings(point.x,point.z,[{outer:f.polygon}]),`${name}/${level} CAD ${f.cadIndex} placement crossed outline`);
      }
    }
  }
}
assert.equal(new Set(manifest.fixtures.map(f=>f.cadIndex)).size,manifest.fixtures.length);
assert.equal(manifest.fixtures.filter(f=>f.category.startsWith('Checkout ')).length,13);
for(const lane of areas.lanes)assert.ok(manifest.fixtures.some(f=>f.lane===lane.lane));
for(const d of areas.departments)assert.ok(manifest.departments.some(f=>f.category===d.id));
const baseline=new URL('../../retail/baselines/frutta-v1/frontend/public/flowfield/retail/produce.glb',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(fs.readFileSync(baseline)),hash(fs.readFileSync(new URL('retail/produce.glb',publicRoot))),'Approved Frutta GLB must be byte-identical');
results.fruttaPreserved=true;
console.log(JSON.stringify(results,null,2));
