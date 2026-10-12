import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contourSegments, observedCells, inRings, closedPockets } from './retail-geometry.js';

test('selection excludes ROI holes and keeps disjoint mapped components',()=>{
  const rings=[{outer:[[0,0],[4,0],[4,4],[0,4]],holes:[[[1,1],[3,1],[3,3],[1,3]]]}, {outer:[[6,0],[7,0],[7,1],[6,1]]}];
  assert.equal(inRings(.5,.5,rings),true);assert.equal(inRings(2,2,rings),false);
  assert.equal(inRings(5,0.5,rings),false);assert.equal(inRings(6.5,.5,rings),true);
});
test('contours follow scalar levels and never bridge unobserved grid vertices',()=>{
  const values=[0,1,2,0,1,2,0,1,2],mask=new Uint8Array(9).fill(1);
  const lines=contourSegments(values,mask,3,3,[.5,1.5]);assert.ok(lines.length>0);
  for(const s of lines){assert.equal(s.a[0],s.level);assert.equal(s.b[0],s.level);}
  mask[1]=mask[4]=mask[7]=0;assert.equal(contourSegments(values,mask,3,3,[.5,1.5]).length,0);
});
test('raw coverage is not the blurred or dilated support mask',()=>{
  const f={NX:3,NY:2,i0:7,j0:8,cells:[{i:7,j:8,k:1,t:0},{i:8,j:9,k:0,t:2},{i:9,j:8,k:0,t:0}]};
  assert.deepEqual([...observedCells(f)],[1,0,0,0,1,0]);
});
test('fixture placements retain exact CAD vertices and mapped Frutta shelf IDs',()=>{
  const read=n=>JSON.parse(fs.readFileSync(new URL(n,import.meta.url)));
  const manifest=read('./retail/manifest.json'),layout=read('./layout_prod.json'),rois=read('./layers_pack.json').rois;
  const frutta=manifest.fixtures.filter(f=>f.category==='Frutta');assert.equal(frutta.length,3);
  for(const f of manifest.fixtures)assert.deepEqual(f.polygon,layout.polys[f.cadIndex]);
  for(const f of frutta){assert.ok(rois.some(r=>r.category==='Frutta' && r.shelf_id===f.shelfId));assert.equal(f.fronts.length,2);}
  for(const f of manifest.fixtures.filter(f=>f.asset==='checkout')){
    const n=16;
    for(let i=0;i<=n;i++)for(let j=0;j<=n;j++){
      const x=f.x+(i/n-.5)*f.length,z=f.z+(j/n-.5)*f.width;
      assert.ok(inRings(x,z,[{outer:f.polygon}]),`Checkout ${f.lane} crossed CAD outline`);
    }
  }
});

test('closedPockets finds floor fenced in by a ring of fixtures, not the open floor', () => {
  // Open room with a 10 x 6 ring of four thin shelves; inside the ring is closed, outside is not.
  const bar = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const polys = [bar(0, 0, 30, 0.3), bar(10, 10, 20, 10.5), bar(10, 15.5, 20, 16), bar(10, 10, 10.5, 16), bar(19.5, 10, 20, 16)];
  const P = closedPockets(polys);
  assert.equal(P.at(15, 13), true);
  assert.equal(P.at(5, 5), false);
  assert.equal(P.at(25, 13), false);
  assert.ok(P.pockets[0].area_m2 > 40 && P.pockets[0].area_m2 < 50);
  // Open one side: no longer closed.
  const open = closedPockets(polys.slice(0, 4).concat([bar(19.5, 10, 20, 12)]));
  assert.equal(open.at(15, 13), false);
});
