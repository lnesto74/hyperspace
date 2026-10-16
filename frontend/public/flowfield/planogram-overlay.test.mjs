import test from 'node:test';
import assert from 'node:assert/strict';
import { MACRO_COLORS, macroColor, macroLegend, qualityLegend, loadPlanogramSections } from './planogram-overlay.js';

const sections = [
  { quality: 'ok', fronts: [{ macro: 'Surgelati' }, { macro: 'Cura persona' }, { macro: 'Surgelati' }] },
  { quality: 'fuori', fronts: [{ macro: 'Nuova macro' }] },
  { quality: 'da_verificare', fronts: [] },
];

test('macro colours follow the reference palette and unknown macros stay stable', () => {
  assert.equal(macroColor('Cura persona'), MACRO_COLORS['Cura persona']);
  assert.equal(macroColor('Nuova macro'), macroColor('Nuova macro'));
  assert.ok(/^#[0-9a-f]{6}$/i.test(macroColor('Nuova macro')));
});

test('legends count fronts per macro in palette order and sections per quality', () => {
  assert.deepEqual(macroLegend(sections).map((r) => [r.macro, r.fronts]), [['Cura persona', 1], ['Surgelati', 2], ['Nuova macro', 1]]);
  assert.deepEqual(qualityLegend(sections).map((r) => [r.quality, r.count]), [['ok', 1], ['da_verificare', 1], ['fuori', 1]]);
});

test('a failed request is reported, not turned into an empty planogram silently', async () => {
  const r = await loadPlanogramSections('v1', async () => ({ ok: false, status: 500 }));
  assert.equal(r.sections.length, 0);
  assert.match(r.note, /unavailable/);
});
