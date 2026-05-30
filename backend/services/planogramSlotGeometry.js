/**
 * Planogram slot geometry — shared with frontend planogramSlotGeometry.ts.
 * 2D floor-plane (X/Z) with shelf rotation applied.
 */

export function getSlotFacings(width, depth, storedFacings = []) {
  if (storedFacings?.length > 0) return storedFacings;
  return width >= depth ? ['front'] : ['left'];
}

export function getFaceParams(facing, width, _height, depth) {
  switch (facing) {
    case 'front':
      return {
        slotSpan: width,
        slotOffset: { x: -width / 2, z: depth / 2 + 0.02 },
        slotDirection: 'x',
      };
    case 'back':
      return {
        slotSpan: width,
        slotOffset: { x: -width / 2, z: -depth / 2 - 0.02 },
        slotDirection: 'x',
      };
    case 'left':
      return {
        slotSpan: depth,
        slotOffset: { x: -width / 2 - 0.02, z: -depth / 2 },
        slotDirection: 'z',
      };
    case 'right':
      return {
        slotSpan: depth,
        slotOffset: { x: width / 2 + 0.02, z: -depth / 2 },
        slotDirection: 'z',
      };
    default:
      return {
        slotSpan: width,
        slotOffset: { x: -width / 2, z: depth / 2 + 0.02 },
        slotDirection: 'x',
      };
  }
}

export function getSlotLocalPosition(
  shelfWidth,
  shelfHeight,
  shelfDepth,
  planogramData,
  levelIndex,
  slotIndex,
) {
  const numLevels = planogramData?.numLevels || 4;
  const slotWidthM = planogramData?.slotWidthM || 0.1;
  const levelHeight = shelfHeight / numLevels;
  const facings = getSlotFacings(shelfWidth, shelfDepth, planogramData?.slotFacings || []);
  const facing = facings[0];
  const faceParams = getFaceParams(facing, shelfWidth, shelfHeight, shelfDepth);

  if (levelIndex < 0 || levelIndex >= numLevels) return null;

  if (faceParams.slotDirection === 'x') {
    return {
      x: faceParams.slotOffset.x + slotIndex * slotWidthM + slotWidthM / 2,
      z: faceParams.slotOffset.z + 0.01,
    };
  }

  return {
    x: faceParams.slotOffset.x + (facing === 'left' ? -0.01 : 0.01),
    z: faceParams.slotOffset.z + slotIndex * slotWidthM + slotWidthM / 2,
  };
}

/** World → shelf-local (inverse rotation around shelf center). */
export function worldToShelfLocal(worldX, worldZ, shelf) {
  const dx = worldX - shelf.positionX;
  const dz = worldZ - shelf.positionZ;
  const rot = -(shelf.rotationY || 0);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

/** Shelf-local → world (rotation around shelf center). */
export function shelfLocalToWorld(localX, localZ, shelf) {
  const rot = shelf.rotationY || 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return {
    x: shelf.positionX + localX * cos - localZ * sin,
    z: shelf.positionZ + localX * sin + localZ * cos,
  };
}

/** Distance from person to nearest point on shelf footprint (axis-aligned in shelf-local space). */
export function distanceToShelfFootprint(worldX, worldZ, shelf) {
  const local = worldToShelfLocal(worldX, worldZ, shelf);
  const hw = (shelf.width || 1) / 2;
  const hd = (shelf.depth || 1) / 2;
  const clampX = Math.max(-hw, Math.min(hw, local.x));
  const clampZ = Math.max(-hd, Math.min(hd, local.z));
  const dx = local.x - clampX;
  const dz = local.z - clampZ;
  return Math.sqrt(dx * dx + dz * dz);
}

export function distance2D(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function speed2D(vx, vz) {
  return Math.sqrt((vx || 0) ** 2 + (vz || 0) ** 2);
}

/**
 * Build shelf model + filled slot world positions from a DB row.
 */
export function parseShelfRow(row) {
  const slots = JSON.parse(row.slots_json || '{}');
  const storedFacings = JSON.parse(row.slot_facings || '[]');
  const width = row.scale_x || 1;
  const depth = row.scale_z || 1;
  const height = row.scale_y || 1.5;

  const shelf = {
    id: row.id,
    name: row.name || row.id,
    positionX: row.position_x,
    positionZ: row.position_z,
    rotationY: row.rotation_y || 0,
    width,
    depth,
    height,
    slotWidthM: row.slot_width_m || 0.1,
    numLevels: row.num_levels || 4,
    slotFacings: storedFacings,
    planogramId: row.planogram_id,
  };

  const planogramData = {
    numLevels: shelf.numLevels,
    slotWidthM: shelf.slotWidthM,
    slotFacings: storedFacings,
  };

  const slotPositions = [];
  for (const level of slots.levels || []) {
    for (const slot of level.slots || []) {
      if (!slot.skuItemId) continue;
      const local = getSlotLocalPosition(
        width, height, depth, planogramData, level.levelIndex, slot.slotIndex,
      );
      if (!local) continue;
      const world = shelfLocalToWorld(local.x, local.z, shelf);
      slotPositions.push({
        shelfId: shelf.id,
        shelfName: shelf.name,
        levelIndex: level.levelIndex,
        slotIndex: slot.slotIndex,
        skuItemId: slot.skuItemId,
        worldX: world.x,
        worldZ: world.z,
      });
    }
  }

  return { shelf, slotPositions };
}

export function loadVenueSkuSlots(db, venueId) {
  const rows = db.prepare(`
    SELECT
      vo.id, vo.name, vo.position_x, vo.position_z, vo.rotation_y,
      vo.scale_x, vo.scale_y, vo.scale_z,
      sp.planogram_id, sp.slot_width_m, sp.num_levels, sp.slots_json, sp.slot_facings
    FROM venue_objects vo
    JOIN shelf_planograms sp ON vo.id = sp.shelf_id
    WHERE vo.venue_id = ?
      AND (vo.type = 'shelf' OR vo.type LIKE '%gondola%' OR vo.type LIKE '%rack%')
  `).all(venueId);

  const shelves = [];
  const slots = [];
  const skuIds = new Set();

  for (const row of rows) {
    const parsed = parseShelfRow(row);
    if (parsed.slotPositions.length === 0) continue;
    shelves.push(parsed.shelf);
    for (const sp of parsed.slotPositions) {
      slots.push(sp);
      skuIds.add(sp.skuItemId);
    }
  }

  const skuMap = new Map();
  if (skuIds.size > 0) {
    const ph = [...skuIds].map(() => '?').join(',');
    const items = db.prepare(`SELECT * FROM sku_items WHERE id IN (${ph})`).all(...skuIds);
    for (const item of items) {
      skuMap.set(item.id, item);
    }
  }

  for (const slot of slots) {
    const sku = skuMap.get(slot.skuItemId);
    if (sku) {
      slot.skuCode = sku.sku_code;
      slot.name = sku.name;
      slot.brand = sku.brand;
      slot.imageUrl = sku.image_url;
      slot.price = sku.price;
    }
  }

  return { shelves, slots };
}

/**
 * Real-time SKU detection at a person position (used by sku-detection debug API).
 */
export function detectSkusAtPosition(px, pz, { shelves, slots, dAttract = 1.5, dSlot = 2.0 }) {
  let closestShelf = null;
  let minShelfDist = Infinity;

  for (const shelf of shelves) {
    const d = distanceToShelfFootprint(px, pz, shelf);
    if (d < minShelfDist) {
      minShelfDist = d;
      closestShelf = shelf;
    }
  }

  if (!closestShelf || minShelfDist > dAttract) {
    return {
      detectedSkus: [],
      debug: { closestShelfDistance: minShelfDist, engagementThreshold: dAttract },
    };
  }

  const detected = [];
  for (const slot of slots) {
    if (slot.shelfId !== closestShelf.id) continue;
    const dist = distance2D(px, pz, slot.worldX, slot.worldZ);
    if (dist > dSlot) continue;

    const attentionScore = Math.max(0, 1 - dist / dSlot);
    let positionScore = 0.5;
    if (slot.levelIndex === 1 || slot.levelIndex === 2) positionScore = 1.0;
    else if (slot.levelIndex === 0) positionScore = 0.6;
    else positionScore = 0.4;

    detected.push({
      skuId: slot.skuItemId,
      skuCode: slot.skuCode,
      name: slot.name,
      brand: slot.brand,
      category: null,
      price: slot.price,
      shelfId: slot.shelfId,
      shelfName: slot.shelfName,
      shelfPosition: { x: closestShelf.positionX, z: closestShelf.positionZ },
      shelfRotation: closestShelf.rotationY,
      slotWorldPosition: { x: slot.worldX, z: slot.worldZ },
      levelIndex: slot.levelIndex,
      slotIndex: slot.slotIndex,
      positionScore,
      attentionScore,
      distanceToShelf: minShelfDist,
      distanceToSlot: dist,
    });
  }

  detected.sort((a, b) => b.attentionScore - a.attentionScore);

  return {
    detectedSkus: detected.slice(0, 3),
    debug: {
      closestShelfId: closestShelf.id,
      closestShelfPosition: { x: closestShelf.positionX, z: closestShelf.positionZ },
      distanceToShelf: minShelfDist,
      nearestSlotIndex: detected[0]?.slotIndex ?? null,
      totalSkusFound: detected.length,
    },
  };
}

export default {
  getSlotLocalPosition,
  worldToShelfLocal,
  shelfLocalToWorld,
  distanceToShelfFootprint,
  distance2D,
  speed2D,
  parseShelfRow,
  loadVenueSkuSlots,
};
