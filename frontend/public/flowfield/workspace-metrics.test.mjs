import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseCells } from './workspace-metrics.js';

test('raw dwell sums, speed and headings are step-weighted, not cell-weighted', () => {
  const summary = summariseCells([
    { d: 10, e: 40, k: 2, s: 1, t: 90, r: [100, 0] },
    { d: 20, e: 60, k: 6, s: 2, t: 90, r: [0, 100] },
  ], 2);
  assert.equal(summary.dwell, 30);
  assert.equal(summary.slowShare, .3);
  assert.equal(summary.speed, 1.75);
  assert.deepEqual(summary.rose, [.25, .75]);
  assert.equal('footfall' in summary, false, 'cell track counts must not become unique people');
});
test('missing presence and empty selections are unavailable, not zero activity', () => {
  assert.equal(summariseCells([{ d: 3, k: 0 }]).slowShare, null);
  const empty = summariseCells([]);
  assert.equal(empty.speed, null);
  assert.equal(empty.presence, null);
  assert.equal(empty.supported, 0);
});
test('opposing directions survive; stationary presence adds no heading', () => {
  const summary = summariseCells([
    { d: 0, e: 10, k: 2, s: 1, r: [50, 0, 50, 0] },
    { d: 40, e: 40, k: 0, s: 0, r: [0, 0, 0, 0] },
  ], 4);
  assert.deepEqual(summary.rose, [.5, 0, .5, 0]);
  assert.equal(summary.speed, 1);
  assert.equal(summary.slowShare, .8);
});
