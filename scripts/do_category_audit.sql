.mode column
.headers on

.print '=== Venue ==='
SELECT id, name, footfall_roi_id FROM venues WHERE id='55fdd53b-3298-4355-97c0-b4e789b11d06';

.print ''
.print '=== company_categories for this venue company ==='
SELECT cc.id, cc.name, cc.slug
FROM company_categories cc
JOIN venues v ON v.company_id = cc.company_id
WHERE v.id='55fdd53b-3298-4355-97c0-b4e789b11d06'
ORDER BY cc.sort_order, cc.name;

.print ''
.print '=== ROI categories from metadata (shelf/engagement zones) ==='
SELECT
  CASE
    WHEN json_extract(r.metadata_json,'$.business_category_label') IS NOT NULL
      THEN json_extract(r.metadata_json,'$.business_category_label')
    WHEN json_extract(r.metadata_json,'$.business_category') IS NOT NULL
      THEN json_extract(r.metadata_json,'$.business_category')
    ELSE 'Uncategorized'
  END as category,
  COUNT(*) as zone_count,
  GROUP_CONCAT(substr(r.name,1,40), ' | ') as sample_names
FROM regions_of_interest r
WHERE r.venue_id='55fdd53b-3298-4355-97c0-b4e789b11d06'
  AND r.name NOT LIKE '%Queue%'
  AND r.name NOT LIKE '%Checkout%'
  AND r.name NOT LIKE '%Service%'
  AND (r.name LIKE '%Engagement%' OR r.name LIKE '%Shelf%' OR r.name LIKE '%Category%')
GROUP BY category
ORDER BY zone_count DESC;

.print ''
.print '=== Visits by category (7d, same logic as API) ==='
SELECT category, COUNT(DISTINCT roi_id) zones, SUM(visits) total_visits, ROUND(SUM(dwell_ms)/60000.0,1) dwell_min
FROM (
  SELECT
    r.id as roi_id,
    COALESCE(json_extract(r.metadata_json,'$.business_category_label'),
             json_extract(r.metadata_json,'$.business_category'), 'Uncategorized') as category,
    COUNT(*) as visits,
    SUM(zv.duration_ms) as dwell_ms
  FROM regions_of_interest r
  LEFT JOIN zone_visits zv ON zv.roi_id=r.id
    AND zv.start_time >= (strftime('%s','now')*1000 - 7*86400000)
  WHERE r.venue_id='55fdd53b-3298-4355-97c0-b4e789b11d06'
    AND r.name NOT LIKE '%Queue%'
    AND r.name NOT LIKE '%Service%'
    AND r.name NOT LIKE '%Checkout%'
    AND (r.name LIKE '%Engagement%' OR r.name LIKE '%Shelf%' OR r.name LIKE '%Category%')
  GROUP BY r.id
)
GROUP BY category
ORDER BY total_visits DESC;

.print ''
.print '=== venue_objects with business_category_label ==='
SELECT json_extract(metadata_json,'$.business_category_label') as cat, COUNT(*) n
FROM venue_objects
WHERE venue_id='55fdd53b-3298-4355-97c0-b4e789b11d06'
  AND json_extract(metadata_json,'$.business_category_label') IS NOT NULL
GROUP BY cat ORDER BY n DESC LIMIT 20;

.print ''
.print '=== Ingress zone visits ever ==='
SELECT r.name, COUNT(*) visits, COUNT(DISTINCT zv.track_key) tracks
FROM regions_of_interest r
LEFT JOIN zone_visits zv ON zv.roi_id=r.id
WHERE r.venue_id='55fdd53b-3298-4355-97c0-b4e789b11d06'
  AND (r.name LIKE '%Traffic%' OR r.name LIKE '%Entrance%' OR r.name LIKE '%1121%')
GROUP BY r.id;
