/**
 * Venue-wide random SKU → shelf slot assignment for planogram magic fill.
 */

function shuffleArray(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeSlots(existingSlots, numLevels, slotsPerLevel) {
  const levels = [];
  for (let l = 0; l < numLevels; l++) {
    const existingLevel = existingSlots?.levels?.find((lvl) => lvl.levelIndex === l);
    const slots = [];
    for (let s = 0; s < slotsPerLevel; s++) {
      const existingSlot = existingLevel?.slots?.find((slot) => slot.slotIndex === s);
      slots.push(existingSlot
        ? { ...existingSlot }
        : { slotIndex: s, skuItemId: null, facingSpan: 1 });
    }
    levels.push({ levelIndex: l, slots });
  }
  return { levels };
}

/**
 * @param {object} params
 * @param {Array} params.catalogItems - sku_items rows with id, skuCode, name, imageUrl, ...
 * @param {Set<string>} params.placedSkuItemIds
 * @param {Array<{ shelfId, shelfWidth, numLevels?, slotWidthM?, existingSlots? }>} params.shelves
 * @param {boolean} [params.onlyUnplaced=true]
 */
export function computeMagicAssign({
  catalogItems,
  placedSkuItemIds,
  shelves,
  onlyUnplaced = true,
}) {
  const availableSkus = shuffleArray(
    onlyUnplaced
      ? catalogItems.filter((item) => !placedSkuItemIds.has(item.id))
      : [...catalogItems]
  );

  const emptySlots = [];
  const shelfSlotState = new Map();

  for (const shelf of shelves) {
    const numLevels = shelf.numLevels || 4;
    const slotWidthM = shelf.slotWidthM || 0.1;
    const shelfWidth = shelf.shelfWidth || 2.0;
    const slotsPerLevel = Math.max(1, Math.floor(shelfWidth / slotWidthM));
    const slots = normalizeSlots(shelf.existingSlots, numLevels, slotsPerLevel);
    shelfSlotState.set(shelf.shelfId, { numLevels, slotWidthM, shelfWidth, slots, slotsPerLevel });

    for (let l = 0; l < numLevels; l++) {
      for (let s = 0; s < slotsPerLevel; s++) {
        const slot = slots.levels[l].slots[s];
        if (!slot.skuItemId) {
          emptySlots.push({ shelfId: shelf.shelfId, levelIndex: l, slotIndex: s });
        }
      }
    }
  }

  const shuffledSlots = shuffleArray(emptySlots);
  const count = Math.min(availableSkus.length, shuffledSlots.length);
  const assignments = [];

  for (let i = 0; i < count; i++) {
    const slot = shuffledSlots[i];
    const sku = availableSkus[i];
    assignments.push({
      shelfId: slot.shelfId,
      levelIndex: slot.levelIndex,
      slotIndex: slot.slotIndex,
      skuItemId: sku.id,
      skuCode: sku.skuCode,
      name: sku.name,
      imageUrl: sku.imageUrl || null,
    });
  }

  return {
    assignments,
    totalPlaced: count,
    overflow: availableSkus.length - count,
    emptySlotCount: emptySlots.length,
    availableSkuCount: availableSkus.length,
    shelfSlotState,
  };
}

/**
 * Apply explicit assignments to shelf planograms.
 */
export function applyMagicAssignments(assignments, shelfSlotState) {
  for (const a of assignments) {
    const state = shelfSlotState.get(a.shelfId);
    if (!state) continue;
    const level = state.slots.levels[a.levelIndex];
    const slot = level?.slots?.[a.slotIndex];
    if (slot && !slot.skuItemId) {
      slot.skuItemId = a.skuItemId;
      slot.facingSpan = slot.facingSpan || 1;
    }
  }

  const shelfUpdates = [];
  for (const [shelfId, state] of shelfSlotState) {
    const placedOnShelf = assignments.filter((a) => a.shelfId === shelfId).length;
    if (placedOnShelf === 0) continue;
    shelfUpdates.push({
      shelfId,
      numLevels: state.numLevels,
      slotWidthM: state.slotWidthM,
      slots: state.slots,
    });
  }

  return shelfUpdates;
}

export default { computeMagicAssign, applyMagicAssignments };
