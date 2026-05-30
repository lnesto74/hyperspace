import { describe, it, expect } from 'vitest';
import { computeMagicAssign, applyMagicAssignments } from '../services/MagicAssignService.js';

describe('MagicAssignService', () => {
  const catalogItems = [
    { id: 'a', skuCode: '001', name: 'Milk' },
    { id: 'b', skuCode: '002', name: 'Bread' },
    { id: 'c', skuCode: '003', name: 'Water' },
  ];

  it('assigns unplaced SKUs to empty slots across shelves', () => {
    const result = computeMagicAssign({
      catalogItems,
      placedSkuItemIds: new Set(['a']),
      shelves: [
        { shelfId: 's1', shelfWidth: 2.0, numLevels: 2, slotWidthM: 0.5 },
        { shelfId: 's2', shelfWidth: 1.0, numLevels: 2, slotWidthM: 0.5 },
      ],
    });

    expect(result.totalPlaced).toBe(2);
    expect(result.assignments).toHaveLength(2);
    expect(result.assignments.every((a) => a.skuItemId !== 'a')).toBe(true);
  });

  it('applyMagicAssignments writes sku ids into slot structures', () => {
    const preview = computeMagicAssign({
      catalogItems,
      placedSkuItemIds: new Set(),
      shelves: [{ shelfId: 's1', shelfWidth: 1.0, numLevels: 1, slotWidthM: 0.5 }],
    });

    const updates = applyMagicAssignments(preview.assignments, preview.shelfSlotState);
    expect(updates).toHaveLength(1);
    const filled = updates[0].slots.levels[0].slots.filter((s) => s.skuItemId);
    expect(filled.length).toBe(preview.totalPlaced);
  });
});
