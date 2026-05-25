#!/usr/bin/env node
/**
 * Audit object → category → ROI → KPI chain for a venue.
 * Run inside backend container:
 *   DB_PATH=/data/db/hyperspace.db node /app/audit_roi_categories.cjs <venueId>
 */
const Database = require('better-sqlite3');

const VENUE = process.argv[2] || process.env.VENUE_ID;
const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';

if (!VENUE) {
  console.error('Usage: node audit_roi_categories.cjs <venueId>');
  process.exit(1);
}

const db = new Database(DB_PATH, { readonly: true });

function parseJson(s) {
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

console.log('\n========== 1. COMPANY RETAIL CATEGORIES ==========');
const venue = db.prepare('SELECT id, name, company_id FROM venues WHERE id = ?').get(VENUE);
console.log('Venue:', venue?.name, '| company_id:', venue?.company_id);
if (venue?.company_id) {
  console.table(
    db.prepare(
      'SELECT id, name, slug, color FROM company_categories WHERE company_id = ? ORDER BY sort_order'
    ).all(venue.company_id)
  );
}

console.log('\n========== 2. VENUE OBJECTS (fixtures) + DWG CATEGORY ==========');
const objs = db.prepare(
  'SELECT id, type, name, metadata_json FROM venue_objects WHERE venue_id = ? ORDER BY name'
).all(VENUE);
console.table(objs.map((o) => {
  const m = parseJson(o.metadata_json);
  return {
    object_id: o.id.slice(0, 8) + '…',
    type: o.type,
    name: o.name,
    category: m.business_category_label || m.business_category || '(none)',
    category_slug: m.business_category || '',
  };
}));

console.log('\n========== 3. SHELF ROIs → OBJECT → CATEGORY ==========');
const rois = db.prepare(
  `SELECT id, name, metadata_json FROM regions_of_interest
   WHERE venue_id = ? AND metadata_json LIKE '%shelf-engagement%' ORDER BY name`
).all(VENUE);

const getObject = db.prepare('SELECT name, type, metadata_json FROM venue_objects WHERE id = ?');
const roiRows = rois.map((r) => {
  const m = parseJson(r.metadata_json);
  const obj = m.shelfId ? getObject.get(m.shelfId) : null;
  const om = parseJson(obj?.metadata_json);
  return {
    roi_name: r.name,
    zone: m.zoneType || '',
    object_name: obj?.name || '(missing)',
    object_type: obj?.type || '',
    object_category: om.business_category_label || om.business_category || '(none)',
    roi_category: m.business_category_label || m.business_category || '(none on ROI)',
  };
});
console.table(roiRows);

console.log('\n========== 4. Shelf 3 detail ==========');
for (const row of roiRows.filter((r) => /shelf 3/i.test(r.roi_name))) {
  console.log(row);
}

console.log('\n========== 5. KPI ROLLUP BY OBJECT CATEGORY (last hour) ==========');
const since = Date.now() - 3600000;
const visitStats = db.prepare(
  'SELECT COUNT(*) AS n, COUNT(DISTINCT track_key) AS u FROM zone_visits WHERE roi_id = ? AND start_time > ?'
);
const rollup = {};
for (const r of rois) {
  const m = parseJson(r.metadata_json);
  if (!m.shelfId) continue;
  const obj = db.prepare('SELECT metadata_json FROM venue_objects WHERE id = ?').get(m.shelfId);
  const om = parseJson(obj?.metadata_json);
  const cat = om.business_category_label || om.business_category || '(uncategorized)';
  const kpi = visitStats.get(r.id, since);
  if (!rollup[cat]) rollup[cat] = { visits: 0, unique: 0, rois: 0 };
  rollup[cat].visits += kpi.n;
  rollup[cat].unique += kpi.u;
  rollup[cat].rois += 1;
}
console.table(
  Object.entries(rollup).map(([category, v]) => ({ category, ...v })).sort((a, b) => b.visits - a.visits)
);

console.log('\n========== GAP ==========');
const withObj = roiRows.filter((r) => r.object_category !== '(none)').length;
const withRoi = roiRows.filter((r) => r.roi_category !== '(none on ROI)').length;
console.log('Objects have category on', withObj, '/', roiRows.length, 'ROI rows');
console.log('ROIs have category metadata:', withRoi, '/', roiRows.length);
console.log('Neural/popup use planogram SKUs unless we copy object category to ROI.');

db.close();
