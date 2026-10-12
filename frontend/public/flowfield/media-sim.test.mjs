// node media-sim.test.mjs — plain assertions on a tiny synthetic sim.json
import assert from 'node:assert/strict';
import { simulate, daysFor, weekdayProfile } from './media-sim.js';

const NH = 2;
const S = {
  days: ['2026-09-14', '2026-09-26'], weekdays: [0, 5], h0: 10, h1: 12, depts: ['A', 'B'],
  spots: [{ id: 'T1', reach: [0.5, 0.1], index: [3, 0.5] }],
  profiles: {
    aud: [[[[100, 40, 4500, 500], [200, 80, 9000, 1000]]], [[[300, 120, 13500, 1500], [100, 40, 4500, 500]]]],
    traffic: [[[1000, 1000], [10, 10]], [[2000, 2000], [10, 10]]],
  },
  catalog: [{ sku: 'X', dept: 'A', price: 2, units_day: 300 }],
  messages: [{ id: 'promo', lift: 0.1, lo: 0.05, hi: 0.2 }],
  params: { loop_s: 60, calibration: 0.5, baseCpm: 6 },
};
assert.deepEqual(daysFor(S, 0), { idx: [0], measured: true });
assert.deepEqual(daysFor(S, 2), { idx: [0], measured: false });   // Wednesday → the measured weekday
assert.deepEqual(daysFor(S, 6), { idx: [0, 1], measured: false }); // no Sunday, no other Sunday → all days
assert.equal(weekdayProfile(S, 0, 0, 5).audience[0][0], 300);

const r = simulate(S, { spot: 'T1', sku: 'X', msg: 'promo', days: [0], hours: [10, 11], spotSec: 15, weeks: 1 });
// time in view 5 s → seen = (5+15)/60 of impressions; in-target = qualified × that × reach 0.5 × calibration 0.5
assert.equal(Math.round(r.seen), Math.round(300 / 3));
assert.ok(Math.abs(r.inTarget - 120 / 3 * 0.25) < 1e-9);
// conversion = 300 units / average daily traffic 3000 = 0.1 per passer
assert.ok(Math.abs(r.extraUnits.mid - r.inTarget * 0.1 * 0.1) < 1e-9);
assert.equal(r.estimated.length, 0);
assert.ok(r.price > 0 && r.cpm > 0 && r.inTargetCpm > r.cpm);
const r2 = simulate(S, { spot: 'T1', sku: 'X', msg: 'promo', days: [2], hours: [10], weeks: 2 });
assert.deepEqual(r2.estimated, ['Wed']);
console.log('media-sim ok');
