import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoi } from '../services/executive/ExecutiveZoneTaxonomy.js';

describe('ExecutiveZoneTaxonomy fresco', () => {
  it('classifies shelf engagement with Pesce category as fresco not aisles', () => {
    const roi = {
      name: 'MURETTO PES - Engagement (Right)',
      metadata_json: JSON.stringify({
        type: 'smart-kpi',
        template: 'shelf-engagement',
        zoneType: 'right',
        shelfId: 'x',
      }),
    };
    const c = classifyRoi(roi, null, { categoryLabel: 'Pesce', objectType: null });
    assert.equal(c.group, 'fresco');
    assert.equal(c.categoryLabel, 'Pesce');
  });

  it('classifies Verdura shelf as fresco', () => {
    const roi = {
      name: 'Shelf 3 - Engagement (Front)',
      metadata_json: JSON.stringify({ type: 'smart-kpi', template: 'shelf-engagement' }),
    };
    const c = classifyRoi(roi, null, { categoryLabel: 'Verdura', objectType: null });
    assert.equal(c.group, 'fresco');
  });

  it('keeps non-fresco shelf as aisles', () => {
    const roi = {
      name: 'Shelf 2 - Engagement (Front)',
      metadata_json: JSON.stringify({ type: 'smart-kpi', template: 'shelf-engagement' }),
    };
    const c = classifyRoi(roi, null, { categoryLabel: 'Surgelati', objectType: null });
    assert.equal(c.group, 'aisles');
  });
});
