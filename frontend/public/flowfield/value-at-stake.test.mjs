// Value at stake = Profit Radar recovery model fed with audited Visitor Journey behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as front from './recovery-model.js';
import { buildVisitorView } from './visitor-journey.js';
import { valueAtStake, CATEGORY_MARGIN, defaultEconomics } from './value-at-stake.js';

const here = (p) => new URL(p, import.meta.url);
const view = buildVisitorView(JSON.parse(readFileSync(here('./visitor-journey-snapshot.json'))));

test('recovery model is the backend one, unchanged', async () => {
  const back = await import('../../../backend/services/profit-radar/recoveryModel.js');
  const inputs = { exposedPerDay: 400, engagement: 0.3, conversionRate: 0.17, benchmark: 0.45, winnable: 0.6, marginPerUnit: 2, axes: { avoidance: 0.4 }, tradingDaysPerWeek: 7 };
  assert.deepEqual(front.recoverySummary(inputs, 0.6), back.recoverySummary(inputs, 0.6));
  assert.equal(front.HEALTHY_ENGAGEMENT, back.HEALTHY_ENGAGEMENT);
});

test('category margins match layers.js', () => {
  const src = readFileSync(here('./layers.js'), 'utf8');
  for (const [k, v] of Object.entries(CATEGORY_MARGIN)) assert.match(src, new RegExp(`'?${k.replace(/[&]/g, '.')}'?: ${v}\\b`));
});

test('many areas, not one till; departments without a shelf reading are left out', () => {
  const items = valueAtStake(view);
  assert.ok(items.length >= 8);
  assert.ok(items.some((x) => x.kind === 'queue'));
  assert.ok(items.filter((x) => x.kind === 'dept').length >= 7);
  for (const id of ['Gastronomia', 'Salumi', 'Pane']) assert.ok(!items.some((x) => x.id === id), id);
  for (const x of items) assert.ok(x.summary.range.conservative <= x.summary.range.expected && x.summary.range.expected <= x.summary.range.aggressive);
});

test('assumptions move the money, not the behaviour', () => {
  const base = valueAtStake(view).find((x) => x.id === 'Carne');
  const econ = defaultEconomics(); econ.margins.Carne = base.inputs.marginPerUnit * 2;
  const twice = valueAtStake(view, 'giorno', econ).find((x) => x.id === 'Carne');
  assert.equal(twice.inputs.exposedPerDay, base.inputs.exposedPerDay);
  assert.ok(Math.abs(twice.summary.range.expected - 2 * base.summary.range.expected) <= 1);
});
