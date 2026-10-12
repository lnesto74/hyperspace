// node frontend/public/flowfield/twin-graphics.test.mjs — geometry primitives on the real Treviglio files.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as G from './twin-graphics.js';

const A = JSON.parse(fs.readFileSync(new URL('./visitor-areas.json', import.meta.url)));
const L = JSON.parse(fs.readFileSync(new URL('./layout_prod.json', import.meta.url)));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const frutta = A.departments.find((d) => d.id === 'Frutta');

t('simplified ring keeps the area within 4 % and drops the raster staircase', () => {
  const r = frutta.area[0].outer, s = G.simplifyRing(r, 0.3);
  assert.ok(s.length < r.length / 2, `${s.length} vs ${r.length}`);
  assert.ok(Math.abs(G.ringArea(s) - G.ringArea(r)) / G.ringArea(r) < 0.04);
});
t('corners are few and spread out', () => {
  const s = G.simplifyRing(frutta.area[0].outer, 0.3), c = G.cornerIndices(s, 6);
  assert.ok(c.length >= 3 && c.length <= 6);
});
t('frontage edges lie on CAD fixtures and are a fraction of the band outline', () => {
  const fix = G.fixtureIndex(L.polys);
  const e = G.frontageEdges(frutta.banco, fix);
  assert.ok(e.length >= 1);
  for (const line of e) for (const p of line) assert.ok(fix.near(p[0], p[1], 0.5));
  const len = (ls) => ls.reduce((s, l) => s + l.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - l[i][0], p[1] - l[i][1]), 0), 0);
  const band = len(frutta.banco.map((r) => [...r.outer, r.outer[0]]));
  assert.ok(len(e) < band * 0.8, `${len(e)} vs ${band}`);
});
t('contours never enter unsupported cells', () => {
  const NX = 20, NY = 20, val = (k) => { const i = k % NX, j = Math.floor(k / NX); return Math.exp(-((i - 10) ** 2 + (j - 10) ** 2) / 18); };
  const sup = (k) => (k % NX) < 14; // right part unmeasured
  const g = G.smoothSupported(NX, NY, val, sup, 1);
  const lv = G.levelsFor(Array.from(g));
  const cs = G.contours(NX, NY, g, lv);
  assert.ok(cs.some((c) => c.lines.length));
  for (const c of cs) for (const l of c.lines) for (const p of l) assert.ok(p[0] <= 13.5 + 1e-9, `x ${p[0]}`);
});
t('point in rings respects holes', () => {
  const ring = { outer: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [[[4, 4], [6, 4], [6, 6], [4, 6]]] };
  assert.equal(G.inRings(1, 1, [ring]), true); assert.equal(G.inRings(5, 5, [ring]), false);
});
console.log(`${n} geometry tests passed`);
