// Validate the exported Blender GLBs in the application's installed Three.js.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { GLTFLoader } from '../../frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { Box3, Vector3, Matrix4, Quaternion } from '../../frontend/node_modules/three/build/three.module.js';
import { inRings } from '../../frontend/public/flowfield/retail-geometry.js';
const root=new URL('../../frontend/public/flowfield/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('retail/manifest.json',root)));
const result={};
for(const [name,spec] of Object.entries(manifest.assets)) {
  const b=fs.readFileSync(new URL(spec.url,root));
  const gltf=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');
  const bounds=new Box3().setFromObject(gltf.scene),size=bounds.getSize(new Vector3());
  assert.ok(Math.abs(size.x-spec.width)<.06 && Math.abs(size.z-spec.length)<.06 && Math.abs(bounds.min.y)<.035,name+' dimensions/origin');
  let triangles=0,meshes=0;
  gltf.scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count || o.geometry.attributes.position.count)/3;assert.equal(o.material.map,null,'No external texture requests');}});
  // Every placed module's XZ bounds stays on its source CAD outline.
  for(const f of manifest.fixtures.filter(f=>f.asset===name)) {
    const count=f.tile===false?1:Math.max(1,Math.round(f.length/spec.length));
    for(let i=0;i<count;i++) {
      const offset=(i-(count-1)/2)*f.length/count;
      const matrix=new Matrix4().compose(new Vector3(f.x+Math.sin(f.yaw)*offset,0,f.z+Math.cos(f.yaw)*offset),new Quaternion().setFromAxisAngle(new Vector3(0,1,0),f.yaw),new Vector3(f.width/spec.width,1,f.length/count/spec.length));
      for(const sx of [-1,1])for(const sz of [-1,1]) {
        // 1 mm interior tolerance for the export's float32 boundary values.
        const p=new Vector3(sx*(size.x/2-.001),0,sz*(size.z/2-.001)).applyMatrix4(matrix);
        assert.ok(inRings(p.x,p.z,[{outer:f.polygon}]),`${name} outside CAD ${f.cadIndex}`);
      }
    }
  }
  result[name]={bytes:b.length,meshes,triangles,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},textures:0};
}
console.log(JSON.stringify(result,null,2));
