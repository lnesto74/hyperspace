// node frontend/public/flowfield/kinetic.test.mjs — checks the kinetic-state helpers on the bundled 14 Sep file.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import * as KN from './kinetic.js';
import { valueAtStake, defaultEconomics } from './value-at-stake.js';
import { buildVisitorView } from './visitor-journey.js';

const K = JSON.parse(fs.readFileSync(new URL('./kinetic.json', import.meta.url)));
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

t('six states, shares sum to 1 for store and every slot', () => {
  assert.equal(KN.STATES.length, 6);
  for (const m of [K.store, ...Object.values(K.by_slot)]) {
    const s = KN.shares(m); assert.ok(Math.abs(Object.values(s).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  }
});
t('validated against audited 199 and 150 (r >= 0.95)', () => {
  assert.ok(K.validation.choose_vs_al_banco_r >= 0.95);
  assert.ok(K.validation.wait_vs_queue_waiting_r >= 0.95);
});
t('fingerprint: Surgelati choose above store, served counters wait above store', () => {
  const s = KN.fingerprint(K, 'Surgelati'); assert.equal(s.signature, 'choose'); assert.ok(s.lift.choose > 1.5);
  for (const d of ['Carne', 'Pesce']) assert.equal(KN.fingerprint(K, d).signature, 'wait');
});
t('axes are 0..1 and avoidance is moving ÷ (moving + choosing)', () => {
  const a = KN.axesFor(K, 'Frutta'); const f = KN.fingerprint(K, 'Frutta');
  for (const v of Object.values(a)) assert.ok(v >= 0 && v <= 1);
  assert.ok(Math.abs(a.avoidance - (f.share.transit + f.share.browse) / (f.share.transit + f.share.browse + f.share.choose)) < 1e-9);
});
t('cell lookup: every cell maps back to itself and stateAt is in range', () => {
  const idx = KN.cellIndex(K, 'trading');
  for (const c of [...idx.map.values()].slice(0, 200)) {
    const p = idx.centre(c.i, c.j); assert.equal(idx.at(p.x, p.z), c);
    const k = KN.stateAt(idx, p.x, p.z, 0.999); assert.ok(k >= 0 && k < 6);
  }
  assert.equal(KN.stateAt(idx, -100, -100, 0.5), -1);
});
t('hotspots are spread out and above the store rate', () => {
  const hs = KN.hotspots(K, 'trading', { n: 6 });
  assert.ok(hs.length >= 3);
  for (const a of hs) { assert.ok(a.lift >= 1.5); for (const b of hs) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 3.2); }
});
t('value at stake uses measured axes when the kinetic file is given', () => {
  const snap = JSON.parse(fs.readFileSync(new URL('./visitor-journey-snapshot.json', import.meta.url)));
  const view = buildVisitorView(snap);
  const a = valueAtStake(view, 'giorno', defaultEconomics(), K).filter((x) => x.kind === 'dept');
  const b = valueAtStake(view, 'giorno', defaultEconomics()).filter((x) => x.kind === 'dept');
  assert.ok(a.length > 5 && a.every((x) => x.axesSource === 'measured' && x.movement));
  assert.ok(b.every((x) => x.axesSource === 'approx'));
});
console.log(`${n} kinetic tests passed`);

{ // mergeKinetic adds seconds and weights per-department rates by time
  const { mergeKinetic } = KN;
  const z = { transit: 0, browse: 0, choose: 0, pause: 0, hesitate: 0, wait: 0 };
  const A = { day: 'a', store: { ...z, browse: 10 }, by_dept: { F: { ...z, browse: 10 } }, uturns_per_min: { F: 1 }, speed_m_s: { F: 1 }, cells: { trading: [[1, 2, 0, 10, 0, 0, 0, 0]] }, windows: 1, person_hours: 1 };
  const B = { day: 'b', store: { ...z, wait: 30 }, by_dept: { F: { ...z, wait: 30 } }, uturns_per_min: { F: 3 }, speed_m_s: { F: 2 }, cells: { trading: [[1, 2, 0, 0, 0, 0, 0, 30], [3, 3, 5, 0, 0, 0, 0, 0]] }, windows: 2, person_hours: 2 };
  const M = mergeKinetic([A, B], 'p');
  assert.equal(M.day, 'p'); assert.deepEqual(M.days, ['a', 'b']);
  assert.equal(M.store.browse, 10); assert.equal(M.store.wait, 30);
  assert.equal(M.uturns_per_min.F, (1 * 10 + 3 * 30) / 40);
  assert.equal(M.cells.trading.length, 2);
  assert.deepEqual(M.cells.trading.find((r) => r[0] === 1), [1, 2, 0, 10, 0, 0, 0, 30]);
}
console.log('mergeKinetic ok');
