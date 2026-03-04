#!/usr/bin/env node
/**
 * Fix venue dimensions + object types for the latest DWG venue.
 * Uses ROI bounds for venue sizing, scaleCorrection=10, and applies dwg_mappings.
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
console.log(`Current dimensions: ${venue.width}m × ${venue.depth}m`);

const layout = db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(venue.dwg_layout_version_id);
if (!layout) { console.error('Layout not found'); process.exit(1); }

// Parse ROI
let roiVertices = null;
if (layout.lidar_roi_json) {
  try {
    roiVertices = JSON.parse(layout.lidar_roi_json);
    if (!Array.isArray(roiVertices) || roiVertices.length < 3) roiVertices = null;
  } catch { roiVertices = null; }
}
if (!roiVertices) { console.error('No valid ROI found on layout'); process.exit(1); }

const roiXs = roiVertices.map(v => v.x);
const roiZs = roiVertices.map(v => v.z);
const roiMinX = Math.min(...roiXs), roiMaxX = Math.max(...roiXs);
const roiMinZ = Math.min(...roiZs), roiMaxZ = Math.max(...roiZs);
const roiWidth = roiMaxX - roiMinX;
const roiDepth = roiMaxZ - roiMinZ;
const roiCenterX = (roiMinX + roiMaxX) / 2;
const roiCenterZ = (roiMinZ + roiMaxZ) / 2;
console.log(`\nROI: ${roiWidth.toFixed(1)}m × ${roiDepth.toFixed(1)}m`);
console.log(`ROI center: (${roiCenterX.toFixed(2)}, ${roiCenterZ.toFixed(2)})`);

// Venue dimensions from ROI + padding
const padding = 4;
const newWidth = Math.ceil(roiWidth + padding * 2);
const newDepth = Math.ceil(roiDepth + padding * 2);
console.log(`New venue dimensions: ${newWidth}m × ${newDepth}m`);

// Shift to center objects on venue floor
const venueFloorCX = newWidth / 2;
const venueFloorCZ = newDepth / 2;
const shiftX = venueFloorCX - roiCenterX;
const shiftZ = venueFloorCZ - roiCenterZ;
console.log(`Shift: (${shiftX.toFixed(2)}, ${shiftZ.toFixed(2)})`);

// Scale: 0.001 * 10 = 0.01 (matching user's scaleCorrection=10)
const layoutData = JSON.parse(layout.layout_json || '{}');
const unitScale = layoutData.unit_scale_to_m || 0.001;
const scaleCorrection = 10;
const effectiveScale = unitScale * scaleCorrection;
console.log(`effectiveScale: ${effectiveScale} (${unitScale} × ${scaleCorrection})`);

// Get live mappings
const mappingRow = db.prepare('SELECT mapping_json FROM dwg_mappings WHERE import_id = ?').get(layout.import_id);
const groupMappings = mappingRow ? (JSON.parse(mappingRow.mapping_json).group_mappings || {}) : {};
console.log(`Mappings: ${Object.keys(groupMappings).length} groups`);

// Parse fixtures and overlay mappings
let fixtures = (layoutData.fixtures || []).map(f => {
  const liveMapping = groupMappings[f.group_id];
  return liveMapping ? { ...f, mapping: liveMapping } : f;
});

// Filter to ROI area
const margin = 5;
const beforeCount = fixtures.length;
fixtures = fixtures.filter(f => {
  const fx = (f.pose2d?.x || 0) * effectiveScale;
  const fz = (f.pose2d?.y || 0) * effectiveScale;
  return fx >= roiMinX - margin && fx <= roiMaxX + margin &&
         fz >= roiMinZ - margin && fz <= roiMaxZ + margin;
});
console.log(`Fixtures: ${beforeCount} total → ${fixtures.length} inside ROI`);

// Count types
const typeCounts = {};
fixtures.forEach(f => {
  const t = f.mapping?.type || 'custom';
  typeCounts[t] = (typeCounts[t] || 0) + 1;
});
console.log('Types:', typeCounts);

// Build venue objects
const insertStmt = db.prepare(`
  INSERT INTO venue_objects (id, venue_id, type, name, position_x, position_y, position_z,
    rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, color)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const txn = db.transaction(() => {
  // Update venue dimensions
  db.prepare('UPDATE venues SET width = ?, depth = ? WHERE id = ?').run(newWidth, newDepth, venue.id);
  console.log(`\n✅ Updated venue dimensions: ${newWidth}m × ${newDepth}m`);

  // Delete old objects
  const deleted = db.prepare('DELETE FROM venue_objects WHERE venue_id = ?').run(venue.id);
  console.log(`Deleted ${deleted.changes} old venue_objects`);

  let created = 0;
  fixtures.forEach((fixture, idx) => {
    const { pose2d, footprint, mapping, source } = fixture;
    const points = footprint?.points || [];
    let x, z, width, depth, rotationY;

    if (points.length >= 3) {
      const sumX = points.reduce((s, pt) => s + pt.x, 0);
      const sumY = points.reduce((s, pt) => s + pt.y, 0);
      x = (sumX / points.length) * effectiveScale;
      z = (sumY / points.length) * effectiveScale;
      const p0 = points[0], p1 = points[1];
      rotationY = -Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const minPtX = Math.min(...points.map(p => p.x));
      const maxPtX = Math.max(...points.map(p => p.x));
      const minPtY = Math.min(...points.map(p => p.y));
      const maxPtY = Math.max(...points.map(p => p.y));
      width = (maxPtX - minPtX) * effectiveScale;
      depth = (maxPtY - minPtY) * effectiveScale;
    } else {
      x = (pose2d?.x || 0) * effectiveScale;
      z = (pose2d?.y || 0) * effectiveScale;
      rotationY = -((pose2d?.rot_deg || 0) * Math.PI / 180);
      width = (footprint?.w || 1000) * effectiveScale;
      depth = (footprint?.d || 1000) * effectiveScale;
    }

    if (width < 0.1) width = 1;
    if (depth < 0.1) depth = 1;
    const height = mapping?.height || Math.max(0.5, Math.min(width, depth) * 0.5);
    const type = mapping?.type || 'custom';
    const finalX = x + shiftX;
    const finalZ = z + shiftZ;
    const name = fixture.name || source?.layer || `${type} ${idx + 1}`;

    insertStmt.run(
      crypto.randomUUID(), venue.id, type, name,
      finalX, 0, finalZ,
      0, rotationY, 0,
      width, height, depth,
      null
    );
    created++;
  });

  console.log(`Created ${created} new venue_objects`);
});
txn();

// Verify
const verify = {};
db.prepare('SELECT type, COUNT(*) as cnt FROM venue_objects WHERE venue_id = ? GROUP BY type').all(venue.id)
  .forEach(r => { verify[r.type] = r.cnt; });
console.log('\n✅ Verified DB types:', verify);

// Verify position ranges
const posRange = db.prepare('SELECT MIN(position_x) as minX, MAX(position_x) as maxX, MIN(position_z) as minZ, MAX(position_z) as maxZ FROM venue_objects WHERE venue_id = ?').get(venue.id);
console.log(`Position range: X ${posRange.minX.toFixed(1)} to ${posRange.maxX.toFixed(1)}, Z ${posRange.minZ.toFixed(1)} to ${posRange.maxZ.toFixed(1)}`);
console.log(`Venue: ${newWidth}m × ${newDepth}m (floor center: ${venueFloorCX.toFixed(1)}, ${venueFloorCZ.toFixed(1)})`);

db.close();
console.log('\nDone! Refresh MainViewport to see correct view.');
