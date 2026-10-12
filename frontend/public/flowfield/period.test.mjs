// node --test frontend/public/flowfield/period.test.mjs — period picker data layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as PER from './period.js';
import * as VJ from './visitor-journey.js';

test('weeks are Monday–Sunday, months are calendar months', () => {
  assert.deepEqual(PER.weekOf('2026-09-17'), { from: '2026-09-14', to: '2026-09-20' });
  assert.deepEqual(PER.monthOf('2026-09-17'), { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(PER.periodFor('week', '2026-09-14').days.length, 7);
  assert.equal(PER.monthGrid('2026-09-01').length % 7, 0);
});

test('merged packs add counts and keep step-weighted speed', () => {
  const meta = { cell_m: 1.5, bins: 2, origin_m: { x: 1.5, y: 0 } };
  const a = { meta, cells: [{ i: 1, j: 1, t: 2, k: 10, p: 0.5, s: 1, d: 3, e: 4, r: [1, 2] }] };
  const b = { meta, cells: [{ i: 1, j: 1, t: 3, k: 30, p: 0.1, s: 2, d: 5, e: 6, r: [3, 4] }, { i: 2, j: 1, t: 1, k: 1, p: 1, s: 1, d: 0, e: 1, r: [1, 0] }] };
  const m = PER.mergeFieldPacks([a, b], { from: 'x', to: 'y', days: ['x', 'y'] });
  const c = m.cells.find((x) => x.i === 1);
  assert.equal(c.t, 5); assert.equal(c.k, 40); assert.equal(c.d, 8); assert.deepEqual(c.r, [4, 6]);
  assert.equal(c.s, 1.75); assert.equal(m.cells.length, 2); assert.equal(m.meta.range.combined, 2);
  assert.throws(() => PER.mergeFieldPacks([a, { meta: { ...meta, cell_m: 2 }, cells: a.cells }]));
});

test('two copies of a day combine to the same per-entrant numbers and twice the entrants', () => {
  const v = VJ.buildVisitorView(JSON.parse(fs.readFileSync(new URL('./visitor-journey-snapshot.json', import.meta.url))));
  const c = VJ.combineViews([v, v], { from: '2026-09-14', to: '2026-09-15' });
  assert.equal(c.entrances.giorno.value, 2 * v.entrances.giorno.value);
  for (const k of ['visit', 'queue']) assert.ok(Math.abs(c[k].giorno.value - v[k].giorno.value) < 1e-9);
  assert.ok(Math.abs(c.area.Frutta.giorno.value - v.area.Frutta.giorno.value) < 1e-9);
  assert.ok(Math.abs(c.lanes.list[0].share - v.lanes.list[0].share) < 1e-9);
  assert.equal(c.period.n, 2);
});

test('a day still calculating is polled until ready', async () => {
  let calls = 0;
  const fetcher = async () => (++calls < 3 ? { status: 202, ok: true, json: async () => ({ status: 'computing', eta_s: 60 }) } : { status: 200, ok: true, json: async () => ({ status: 'ok', day: '2026-09-26', kpis: [] }) });
  const seen = [];
  const r = await PER.loadDay({ venueId: 'v', day: '2026-09-26', fetcher, pollMs: 1, onUpdate: (u) => seen.push(u.state) });
  assert.equal(r.state, 'ready'); assert.equal(calls, 3); assert.ok(seen.includes('computing'));
});
