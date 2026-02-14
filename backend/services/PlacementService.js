/**
 * PlacementService - Core placement logic for SKU planogram assignments
 * 
 * All SKU placements are discrete slot assignments (level_index, slot_index)
 * Never allows free-floating placement - always snaps to valid slots
 */

/**
 * Compute shelf slot structure from shelf geometry
 * @param {Object} params
 * @param {number} params.shelfWidth - Shelf width in meters
 * @param {number} params.shelfHeight - Shelf height in meters (optional)
 * @param {number} params.numLevels - Number of vertical levels
 * @param {number} params.slotWidthM - Width of each slot in meters
 * @returns {Object} Slot structure with computed values
 */
export function computeShelfSlots({ shelfWidth, shelfHeight, numLevels, slotWidthM }) {
  const slotsPerLevel = Math.floor(shelfWidth / slotWidthM);
  const levelHeightM = shelfHeight ? shelfHeight / numLevels : null;
  
  return {
    slotsPerLevel,
    totalSlots: slotsPerLevel * numLevels,
    levelHeightM,
    slotWidthM,
    numLevels,
  };
}

/**
 * Initialize empty slots structure
 * @param {number} numLevels 
 * @param {number} slotsPerLevel 
 * @returns {Object} Empty slots structure
 */
export function initializeSlots(numLevels, slotsPerLevel) {
  const levels = [];
  for (let l = 0; l < numLevels; l++) {
    const slots = [];
    for (let s = 0; s < slotsPerLevel; s++) {
      slots.push({ slotIndex: s, skuItemId: null, facingSpan: 1 });
    }
    levels.push({ levelIndex: l, slots });
  }
  return { levels };
}

/**
 * Ensure slots structure has all required levels and slots
 * @param {Object} existingSlots 
 * @param {number} numLevels 
 * @param {number} slotsPerLevel 
 * @returns {Object} Normalized slots structure
 */
function normalizeSlots(existingSlots, numLevels, slotsPerLevel) {
  const levels = [];
  
  for (let l = 0; l < numLevels; l++) {
    const existingLevel = existingSlots?.levels?.find(lvl => lvl.levelIndex === l);
    const slots = [];
    
    for (let s = 0; s < slotsPerLevel; s++) {
      const existingSlot = existingLevel?.slots?.find(slot => slot.slotIndex === s);
      if (existingSlot) {
        slots.push({ ...existingSlot });
      } else {
        slots.push({ slotIndex: s, skuItemId: null, facingSpan: 1 });
      }
    }
    
    levels.push({ levelIndex: l, slots });
  }
  
  return { levels };
}

/**
 * Find next available slot starting from a position
 * @param {Object} slots - Current slots structure
 * @param {number} startLevel - Starting level index
 * @param {number} startSlot - Starting slot index
 * @param {number} slotsPerLevel - Slots per level
 * @returns {Object|null} { levelIndex, slotIndex } or null if no slots available
 */
function findNextAvailableSlot(slots, startLevel, startSlot, slotsPerLevel) {
  const numLevels = slots.levels.length;
  
  // Start from the given position
  let levelIdx = startLevel;
  let slotIdx = startSlot;
  
  while (levelIdx < numLevels) {
    const level = slots.levels[levelIdx];
    
    while (slotIdx < slotsPerLevel) {
      const slot = level.slots[slotIdx];
      if (!slot.skuItemId) {
        return { levelIndex: levelIdx, slotIndex: slotIdx };
      }
      slotIdx++;
    }
    
    // Move to next level
    levelIdx++;
    slotIdx = 0;
  }
  
  return null; // No available slots
}

/**
 * Find all available slots in the shelf
 * @param {Object} slots - Current slots structure
 * @param {number} slotsPerLevel - Slots per level
 * @returns {Array} Array of { levelIndex, slotIndex }
 */
function findAllAvailableSlots(slots, slotsPerLevel) {
  const available = [];
  
  for (const level of slots.levels) {
    for (let s = 0; s < slotsPerLevel; s++) {
      const slot = level.slots[s];
      if (!slot.skuItemId) {
        available.push({ levelIndex: level.levelIndex, slotIndex: s });
      }
    }
  }
  
  return available;
}

/**
 * Shuffle array using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array (mutates original)
 */
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * Place SKUs on shelf with snap-to-slot behavior
 * 
 * @param {Object} params
 * @param {number} params.shelfWidth - Shelf width in meters
 * @param {number} params.numLevels - Number of vertical levels
 * @param {number} params.slotWidthM - Slot width in meters
 * @param {Object} params.existingSlots - Current slot assignments
 * @param {Object} params.dropTarget - Where to place { type: 'slot'|'level'|'shelf', levelIndex?, slotIndex? }
 * @param {string[]} params.skuItemIds - Array of SKU item IDs to place
 * @param {Object} params.options - Placement options
 * @param {string} params.options.fillOrder - 'sequential' (default), 'random', or 'compact'
 * @param {boolean} params.options.compact - Compact after placement
 * @param {string} params.options.overflowPolicy - 'skip' (default), 'overwrite', or 'error'
 * @returns {Object} { updatedSlots, overflowSkuIds, warnings }
 */
export function placeSkusOnShelf({
  shelfWidth,
  numLevels,
  slotWidthM,
  existingSlots,
  dropTarget,
  skuItemIds,
  options = {},
}) {
  const { fillOrder = 'sequential', compact = false, overflowPolicy = 'skip' } = options;
  const slotsPerLevel = Math.floor(shelfWidth / slotWidthM);
  
  // Normalize existing slots to ensure structure
  const slots = normalizeSlots(existingSlots, numLevels, slotsPerLevel);
  
  const overflowSkuIds = [];
  const warnings = [];
  
  // Handle random fill order - distribute items randomly across free slots
  if (fillOrder === 'random') {
    // Find all available slots and shuffle them
    const availableSlots = findAllAvailableSlots(slots, slotsPerLevel);
    shuffleArray(availableSlots);
    
    // Place each SKU in a random available slot
    for (let i = 0; i < skuItemIds.length; i++) {
      const skuId = skuItemIds[i];
      
      if (i >= availableSlots.length) {
        // No more slots available
        if (overflowPolicy === 'error') {
          warnings.push(`No slot available for SKU ${skuId}`);
        }
        overflowSkuIds.push(skuId);
        continue;
      }
      
      const targetSlot = availableSlots[i];
      const level = slots.levels[targetSlot.levelIndex];
      const slot = level.slots[targetSlot.slotIndex];
      slot.skuItemId = skuId;
      slot.facingSpan = 1;
    }
  } else {
    // Sequential fill order
    // Determine starting position based on drop target
    let startLevel = 0;
    let startSlot = 0;
    
    if (dropTarget.type === 'slot') {
      startLevel = dropTarget.levelIndex ?? 0;
      startSlot = dropTarget.slotIndex ?? 0;
    } else if (dropTarget.type === 'level') {
      startLevel = dropTarget.levelIndex ?? 0;
      startSlot = 0;
    }
    // type === 'shelf' uses default (0, 0)
    
    // Place each SKU
    let currentLevel = startLevel;
    let currentSlot = startSlot;
    
    for (const skuId of skuItemIds) {
      // Find next available slot
      const available = findNextAvailableSlot(slots, currentLevel, currentSlot, slotsPerLevel);
      
      if (!available) {
        // No more slots available
        if (overflowPolicy === 'error') {
          warnings.push(`No slot available for SKU ${skuId}`);
        }
        overflowSkuIds.push(skuId);
        continue;
      }
      
      // Place the SKU
      const level = slots.levels[available.levelIndex];
      const slot = level.slots[available.slotIndex];
      slot.skuItemId = skuId;
      slot.facingSpan = 1;
      
      // Move to next position
      currentLevel = available.levelIndex;
      currentSlot = available.slotIndex + 1;
      
      // Wrap to next level if needed
      if (currentSlot >= slotsPerLevel) {
        currentLevel++;
        currentSlot = 0;
      }
    }
  }
  
  // Compact if requested (remove gaps)
  let finalSlots = slots;
  if (compact) {
    finalSlots = compactSlots(slots, slotsPerLevel);
  }
  
  // Add overflow warning if any
  if (overflowSkuIds.length > 0) {
    warnings.push(`${overflowSkuIds.length} SKU(s) could not be placed (overflow)`);
  }
  
  return {
    updatedSlots: finalSlots,
    overflowSkuIds,
    warnings,
    placed: skuItemIds.length - overflowSkuIds.length,
  };
}

/**
 * Compact slots by removing gaps (shift left)
 * @param {Object} slots - Current slots structure
 * @param {number} slotsPerLevel - Slots per level
 * @returns {Object} Compacted slots structure
 */
export function compactSlots(slots, slotsPerLevel) {
  const compacted = { levels: [] };
  
  for (const level of slots.levels) {
    // Collect all placed SKUs in order
    const placedSkus = level.slots
      .filter(s => s.skuItemId)
      .map(s => ({ skuItemId: s.skuItemId, facingSpan: s.facingSpan }));
    
    // Rebuild slots with SKUs shifted left
    const newSlots = [];
    let skuIdx = 0;
    
    for (let s = 0; s < slotsPerLevel; s++) {
      if (skuIdx < placedSkus.length) {
        newSlots.push({
          slotIndex: s,
          skuItemId: placedSkus[skuIdx].skuItemId,
          facingSpan: placedSkus[skuIdx].facingSpan,
        });
        skuIdx++;
      } else {
        newSlots.push({ slotIndex: s, skuItemId: null, facingSpan: 1 });
      }
    }
    
    compacted.levels.push({ levelIndex: level.levelIndex, slots: newSlots });
  }
  
  return compacted;
}

/**
 * Remove SKU from a specific slot
 * @param {Object} slots - Current slots structure
 * @param {number} levelIndex - Level index
 * @param {number} slotIndex - Slot index
 * @returns {Object} Updated slots structure
 */
export function removeSkuFromSlot(slots, levelIndex, slotIndex) {
  const updated = JSON.parse(JSON.stringify(slots)); // Deep clone
  
  const level = updated.levels.find(l => l.levelIndex === levelIndex);
  if (level) {
    const slot = level.slots.find(s => s.slotIndex === slotIndex);
    if (slot) {
      slot.skuItemId = null;
      slot.facingSpan = 1;
    }
  }
  
  return updated;
}

/**
 * Move SKU within shelf (reorder)
 * @param {Object} slots - Current slots structure
 * @param {Object} from - { levelIndex, slotIndex }
 * @param {Object} to - { levelIndex, slotIndex }
 * @returns {Object} Updated slots structure
 */
export function moveSkuInShelf(slots, from, to) {
  const updated = JSON.parse(JSON.stringify(slots)); // Deep clone
  
  const fromLevel = updated.levels.find(l => l.levelIndex === from.levelIndex);
  const toLevel = updated.levels.find(l => l.levelIndex === to.levelIndex);
  
  if (!fromLevel || !toLevel) return updated;
  
  const fromSlot = fromLevel.slots.find(s => s.slotIndex === from.slotIndex);
  const toSlot = toLevel.slots.find(s => s.slotIndex === to.slotIndex);
  
  if (!fromSlot || !toSlot) return updated;
  
  // Swap
  const tempSkuId = fromSlot.skuItemId;
  const tempSpan = fromSlot.facingSpan;
  
  fromSlot.skuItemId = toSlot.skuItemId;
  fromSlot.facingSpan = toSlot.facingSpan;
  
  toSlot.skuItemId = tempSkuId;
  toSlot.facingSpan = tempSpan;
  
  return updated;
}

/**
 * Increase facing span for a SKU (merge adjacent slots)
 * @param {Object} slots - Current slots structure
 * @param {number} levelIndex - Level index
 * @param {number} slotIndex - Starting slot index
 * @returns {Object} Updated slots structure
 */
export function increaseFacing(slots, levelIndex, slotIndex) {
  const updated = JSON.parse(JSON.stringify(slots));
  
  const level = updated.levels.find(l => l.levelIndex === levelIndex);
  if (!level) return updated;
  
  const slot = level.slots.find(s => s.slotIndex === slotIndex);
  if (!slot || !slot.skuItemId) return updated;
  
  // Find next slot
  const nextSlot = level.slots.find(s => s.slotIndex === slotIndex + slot.facingSpan);
  if (!nextSlot || nextSlot.skuItemId) return updated; // Can't extend if occupied
  
  // Extend facing
  slot.facingSpan += 1;
  nextSlot.skuItemId = null; // Mark as part of facing
  
  return updated;
}

/**
 * Decrease facing span for a SKU
 * @param {Object} slots - Current slots structure
 * @param {number} levelIndex - Level index
 * @param {number} slotIndex - Starting slot index
 * @returns {Object} Updated slots structure
 */
export function decreaseFacing(slots, levelIndex, slotIndex) {
  const updated = JSON.parse(JSON.stringify(slots));
  
  const level = updated.levels.find(l => l.levelIndex === levelIndex);
  if (!level) return updated;
  
  const slot = level.slots.find(s => s.slotIndex === slotIndex);
  if (!slot || !slot.skuItemId || slot.facingSpan <= 1) return updated;
  
  // Reduce facing
  slot.facingSpan -= 1;
  
  return updated;
}

/**
 * Convert world coordinates to shelf slot indices
 * @param {Object} params
 * @param {Object} params.worldPoint - { x, y, z } world coordinates
 * @param {Object} params.shelfTransform - Shelf position and rotation
 * @param {Object} params.shelfDimensions - { width, height, depth }
 * @param {number} params.numLevels - Number of levels
 * @param {number} params.slotWidthM - Slot width
 * @returns {Object} { levelIndex, slotIndex, valid }
 */
export function worldToShelfSlot({
  worldPoint,
  shelfTransform,
  shelfDimensions,
  numLevels,
  slotWidthM,
}) {
  // Transform world point to shelf local coordinates
  const localX = worldPoint.x - shelfTransform.position.x;
  const localY = worldPoint.y - shelfTransform.position.y;
  const localZ = worldPoint.z - shelfTransform.position.z;
  
  // Apply inverse rotation (simplified - assumes Y-axis rotation only)
  const rotY = shelfTransform.rotation?.y || 0;
  const cos = Math.cos(-rotY);
  const sin = Math.sin(-rotY);
  const rotatedX = localX * cos - localZ * sin;
  const rotatedZ = localX * sin + localZ * cos;
  
  // Check if point is within shelf bounds
  const halfWidth = shelfDimensions.width / 2;
  const halfDepth = shelfDimensions.depth / 2;
  
  if (Math.abs(rotatedX) > halfWidth || Math.abs(rotatedZ) > halfDepth) {
    return { levelIndex: -1, slotIndex: -1, valid: false };
  }
  
  // Compute slot index (left to right)
  const normalizedX = (rotatedX + halfWidth) / shelfDimensions.width; // 0 to 1
  const slotsPerLevel = Math.floor(shelfDimensions.width / slotWidthM);
  const slotIndex = Math.min(Math.floor(normalizedX * slotsPerLevel), slotsPerLevel - 1);
  
  // Compute level index (bottom to top)
  const levelHeight = shelfDimensions.height / numLevels;
  const levelIndex = Math.min(Math.floor(localY / levelHeight), numLevels - 1);
  
  return {
    levelIndex: Math.max(0, levelIndex),
    slotIndex: Math.max(0, slotIndex),
    valid: true,
  };
}

export default {
  computeShelfSlots,
  initializeSlots,
  placeSkusOnShelf,
  compactSlots,
  removeSkuFromSlot,
  moveSkuInShelf,
  increaseFacing,
  decreaseFacing,
  worldToShelfSlot,
};
