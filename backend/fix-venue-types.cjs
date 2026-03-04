#!/usr/bin/env node
/**
 * Fix venue objects — delete stale custom-only venue_objects and re-create
 * with correct types from dwg_mappings + layout_json.
 *
 * Uses the SAME coordinate math as as-venue-bootstrap endpoint.
 */

const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './database/hyperspace.db';
const db = new Database(path.resolve(DB_PATH));

// Find latest DWG venue
const venue = db.prepare(`
  SELECT id, name, width, depth, dwg_layout_version_id FROM venues 
  WHERE scene_source = 'dwg' 
  ORDER BY created_at DESC LIMIT 1
`).get();

if (!venue) { console.error('No DWG venue found'); process.exit(1); }
console.log(`\nVenue: "${venue.name}" (${venue.id})`);
console.log(`Layout: ${venue.dwg_layout_version_id}`);

const layout = db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(venue.dwg_layout_version_id);
if (!layout) { console.error('Layout not found'); process.exit(1); }
console.log(`Import: ${layout.import_id}`);

// Get live mappings
const mappingRow = db.prepare('SELECT mapping_json FROM dwg_mappings WHERE import_id = ?').get(layout.import_id);
const groupMappings = mappingRow ? (JSON.parse(mappingRow.mapping_json).group_mappings || {}) : {};
console.log(`Mappings: ${Object.keys(groupMappings).length} groups`);

// Parse layout JSON and overlay live mappings
const layoutData = JSON.parse(layout.layout_json || '{}');
let fixtures = layoutData.fixtures || [];
const unitScale = layoutData.unit_scale_to_m || 0.001;
const bounds = layoutData.bounds || { minX: 0, minY: 0, maxX: 1, maxY: 1 };

// Overlay live dwg_mappings onto fixtures
fixtures = fixtures.map(f => {
  const liveMapping = groupMappings[f.group_id];
  if (liveMapping) return { ...f, mapping: liveMapping };
  return f;
});

// Count types after overlay
const typeCounts = {};
fixtures.forEach(f => {
  const t = (f.mapping?.type) || 'custom';
  typeCounts[t] = (typeCounts[t] || 0) + 1;
});
console.log('Types after overlay:', typeCounts);

// ── Coordinate math (SAME as as-venue-bootstrap) ──
const scaleCorrection = 1.0; // default
const effectiveScale = unitScale * scaleCorrection;
const centerX = (bounds.minX + bounds.maxX) / 2 * effectiveScale;
const centerZ = (bounds.minY + bounds.maxY) / 2 * effectiveScale;

// Compute content bounds for venue floor centering
let cMinX = Infinity, cMaxX = -Infinity, cMinZ = Infinity, cMaxZ = -Infinity;
fixtures.forEach(f => {
  const pts = f.footprint?.points || [];
  if (pts.length >= 3) {
    pts.forEach(pt => {
      const x = pt.x * effectiveScale - centerX;
      const z = pt.y * effectiveScale - centerZ;
      if (x < cMinX) cMinX = x; if (x > cMaxX) cMaxX = x;
      if (z < cMinZ) cMinZ = z; if (z > cMaxZ) cMaxZ = z;
    });
  } else {
    const x = (f.pose2d?.x || 0) * effectiveScale - centerX;
    const z = (f.pose2d?.y || 0) * effectiveScale - centerZ;
    const hw = ((f.footprint?.w || 1000) * effectiveScale) / 2;
    const hd = ((f.footprint?.d || 1000) * effectiveScale) / 2;
    if (x - hw < cMinX) cMinX = x - hw; if (x + hw > cMaxX) cMaxX = x + hw;
    if (z - hd < cMinZ) cMinZ = z - hd; if (z + hd > cMaxZ) cMaxZ = z + hd;
  }
});

const contentCX = (cMinX + cMaxX) / 2;
const contentCZ = (cMinZ + cMaxZ) / 2;
// MUST match as-venue-bootstrap: center objects on venue floor at (venueWidth/2, venueDepth/2)
// because MainViewport places grid/floor/camera at that center
const venueFloorCX = venue.width / 2;
const venueFloorCZ = venue.depth / 2;
const shiftX = venueFloorCX - contentCX;
const shiftZ = venueFloorCZ - contentCZ;

console.log(`effectiveScale=${effectiveScale}, center=(${centerX.toFixed(2)}, ${centerZ.toFixed(2)})`);
console.log(`content center=(${contentCX.toFixed(2)}, ${contentCZ.toFixed(2)}), shift=(${shiftX.toFixed(2)}, ${shiftZ.toFixed(2)})`);

// ── Build new venue objects ──
const insertStmt = db.prepare(`
  INSERT INTO venue_objects (id, venue_id, type, name, position_x, position_y, position_z,
    rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, color)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const txn = db.transaction(() => {
  // Delete old objects
  const deleted = db.prepare('DELETE FROM venue_objects WHERE venue_id = ?').run(venue.id);
  console.log(`\nDeleted ${deleted.changes} old venue_objects`);

  let created = 0;
  const newTypeCounts = {};

  fixtures.forEach((fixture, idx) => {
    const { pose2d, footprint, mapping, source, id: fixtureId } = fixture;
    const points = footprint?.points || [];

    let x, z, width, depth, rotationY;

    if (points.length >= 3) {
      const sumX = points.reduce((s, pt) => s + pt.x, 0);
      const sumY = points.reduce((s, pt) => s + pt.y, 0);
      x = (sumX / points.length) * effectiveScale - centerX;
      z = (sumY / points.length) * effectiveScale - centerZ;
      const p0 = points[0], p1 = points[1];
      rotationY = -Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const minPtX = Math.min(...points.map(p => p.x));
      const maxPtX = Math.max(...points.map(p => p.x));
      const minPtY = Math.min(...points.map(p => p.y));
      const maxPtY = Math.max(...points.map(p => p.y));
      width = (maxPtX - minPtX) * effectiveScale;
      depth = (maxPtY - minPtY) * effectiveScale;
    } else {
      x = (pose2d?.x || 0) * effectiveScale - centerX;
      z = (pose2d?.y || 0) * effectiveScale - centerZ;
      rotationY = -((pose2d?.rot_deg || 0) * Math.PI / 180);
      width = (footprint?.w || 1000) * effectiveScale;
      depth = (footprint?.d || 1000) * effectiveScale;
    }

    if (width < 0.1) width = 1;
    if (depth < 0.1) depth = 1;
    const height = fixture.customHeight || mapping?.height || Math.max(0.5, Math.min(width, depth) * 0.5);

    const type = mapping?.type || 'custom';
    const finalX = x + shiftX;
    const finalZ = z + shiftZ;
    const objId = crypto.randomUUID();
    const name = fixture.name || source?.layer || `${type} ${idx + 1}`;

    newTypeCounts[type] = (newTypeCounts[type] || 0) + 1;

    insertStmt.run(
      objId, venue.id, type, name,
      finalX, 0, finalZ,
      0, rotationY, 0,
      width, height, depth,
      null
    );
    created++;
  });

  console.log(`Created ${created} new venue_objects`);
  console.log('Type distribution:', newTypeCounts);

  // Also bake correct types into layout_json so future reads are correct
  layoutData.fixtures = fixtures;
  db.prepare('UPDATE dwg_layout_versions SET layout_json = ? WHERE id = ?')
    .run(JSON.stringify(layoutData), venue.dwg_layout_version_id);
  console.log('Layout JSON updated with correct types');
});

txn();

// Verify
const verify = {};
db.prepare('SELECT type, COUNT(*) as cnt FROM venue_objects WHERE venue_id = ? GROUP BY type').all(venue.id)
  .forEach(r => { verify[r.type] = r.cnt; });
console.log('\n✅ Verified DB types:', verify);
console.log('\nDone! Refresh MainViewport (select another venue then back) to see correct colors.');

db.close();
