import fs from 'node:fs';
import assert from 'node:assert/strict';
import { GLTFLoader } from '../../frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { Box3,Vector3,Matrix3 } from '../../frontend/node_modules/three/build/three.module.js';
const base=new URL('../../frontend/public/flowfield/',import.meta.url),read=p=>JSON.parse(fs.readFileSync(new URL(p,base)));
const config=read('retail/totem/config.json'),manifest=read('retail/manifest.json'),layout=read('layout_prod.json');
const double=process.argv.includes('--double');
const b=fs.readFileSync(new URL('retail/totem/'+(double?'digital-totem-double.glb':'digital-totem.glb'),base));assert.equal(b.toString('ascii',0,4),'glTF');
const jsonLength=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+jsonLength)),bin=b.subarray(28+jsonLength);
assert(j.images.every(i=>i.bufferView!==undefined),'Campaign is self-contained');
assert(j.materials.some(m=>m.emissiveTexture),'Swappable emissive screen must retain its campaign');
const textureCount=j.images.length;
// Geometry-only parser in Node: inspect image embedding above; do not require a browser image decoder.
for(const m of j.materials){delete m.emissiveTexture;if(m.pbrMetallicRoughness)delete m.pbrMetallicRoughness.baseColorTexture;}
j.buffers[0].uri='data:application/octet-stream;base64,'+bin.toString('base64');
globalThis.ProgressEvent??=class{constructor(type,props){this.type=type;Object.assign(this,props);}};
const gltf=await new GLTFLoader().parseAsync(JSON.stringify(j),'');gltf.scene.updateMatrixWorld(true);
const bounds=new Box3().setFromObject(gltf.scene),size=bounds.getSize(new Vector3());
for(const [actual,expected]of [[size.x,config.dimensions.baseWidth],[size.y,config.dimensions.height],[size.z,config.dimensions.baseDepth],[bounds.min.y,0]])assert(Math.abs(actual-expected)<.002,`${actual} != ${expected}`);
let meshes=0,triangles=0,screen=null,rear=null;gltf.scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;if(o.name.startsWith('CampaignScreenRear'))rear=o;else if(o.name.startsWith('CampaignScreen'))screen=o;}});
assert(meshes<=8,'Material-batched GLB');assert(screen,'Dedicated screen mesh');
const screenBox=new Box3().setFromObject(screen),screenSize=screenBox.getSize(new Vector3());assert(Math.abs(screenSize.x/config.screen.width-1)<.001);assert(Math.abs(screenSize.y/config.screen.height-1)<.001);
const normal=new Vector3().fromBufferAttribute(screen.geometry.attributes.normal,0).applyMatrix3(new Matrix3().getNormalMatrix(screen.matrixWorld)).normalize();assert(normal.z>.999,'glTF screen front must be +Z');
if(double){assert(rear,'Second dedicated rear display');const rn=new Vector3().fromBufferAttribute(rear.geometry.attributes.normal,0).applyMatrix3(new Matrix3().getNormalMatrix(rear.matrixWorld)).normalize();assert(rn.z<-.999,'Rear screen must face -Z');const rb=new Box3().setFromObject(rear),rs=rb.getSize(new Vector3());assert(Math.abs(rb.getCenter(new Vector3()).z+config.screen.frontZ)<.001);assert(Math.abs(rs.x-config.screen.width)<.001&&Math.abs(rs.y-config.screen.height)<.001);}
for(const d of config.devices){const f=manifest.fixtures.find(f=>f.objectId===d.id);assert(f);assert.equal(d.x,f.x);assert.equal(d.z,f.z);assert.equal(d.cadIndex,f.cadIndex);assert.deepEqual(d.originalPolygon,layout.polys[d.cadIndex]);}
console.log(JSON.stringify({pass:true,sides:double?2:1,bytes:b.length,meshes,triangles,textures:textureCount,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},screenNormal:normal.toArray(),screenDiagonalInches:Math.hypot(config.screen.width,config.screen.height)/.0254,devicesPreserved:config.devices.map(d=>d.id)},null,2));
