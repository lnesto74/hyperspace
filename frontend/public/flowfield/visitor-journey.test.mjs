// Parity with Visitor Journey (daily_kpi, 14 Sep 2026) and the Journey Lab outputs it is built from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVisitorView, rankDepartments, visitComposition, queuePeak, entrancePeak, fmtDuration, cell } from './visitor-journey.js';

const payload = JSON.parse(readFileSync(new URL('./visitor-journey-snapshot.json', import.meta.url)));
const view = buildVisitorView(payload, { venueId: '55fdd53b-3298-4355-97c0-b4e789b11d06', day: '2026-09-14' });

test('headline matches the audited acceptance set', () => {
  assert.equal(view.entrances.giorno.value, 1948);
  assert.ok(Math.abs(view.visit.giorno.value - 17.62) < 0.01);
  assert.equal(view.queue.giorno.value, 0.641);
  assert.equal(view.queue['18-20'].value, 1.01);
});

test('department minutes are the 199 two-layer areas', () => {
  const r = rankDepartments(view);
  assert.deepEqual(r.slice(0, 3).map((d) => d.id), ['Frutta', 'Surgelati', 'Latticini']);
  assert.equal(r[0].area.value, 1.63);
  assert.equal(r[0].banco.value, 0.6);
  const verdura = r.find((d) => d.id === 'Verdura');
  assert.equal(verdura.choice, 'worked');
  assert.equal(r.find((d) => d.id === 'Pesce').choice, 'passed');
});

test('visit composition sums back to the visit', () => {
  const c = visitComposition(view);
  const sum = c.segments.reduce((s, x) => s + x.minutes, 0);
  assert.ok(Math.abs(sum - c.visit) < 1e-9);
});

test('checkout lanes rank by waiting person-minutes (5, 7, 13), never by the retired PDF', () => {
  assert.deepEqual(view.lanes.list.slice(0, 3).map((l) => l.lane), [5, 7, 13]);
  assert.ok(Math.abs(view.lanes.list.reduce((s, l) => s + l.share, 0) - 1) < 1e-9);
  assert.equal(queuePeak(view).peak.slot, '18-20');
  assert.equal(queuePeak(view).over.slot, '18-20');
  assert.equal(entrancePeak(view).slot, '16-18');
});

test('a row that failed a check is unavailable, not a softer number', () => {
  const c = cell({ kpi_id: 'x', slot: 'giorno', value: 12, status: 'unreliable', status_reason: 'check_failed:little' });
  assert.equal(c.value, null);
  assert.match(c.reason, /little/);
  assert.equal(view.lanes.list[0].sessions, null, 'queue_sessions is unreliable in this payload, so no per-session wait');
});

test('venue and day mismatches fail closed', () => {
  assert.throws(() => buildVisitorView(payload, { venueId: 'other' }));
  assert.throws(() => buildVisitorView(payload, { day: '2026-09-15' }));
});

test('durations read like Visitor Journey', () => {
  assert.equal(fmtDuration(0.641), '38 s');
  assert.equal(fmtDuration(17.623), '17 min 37 s');
});
