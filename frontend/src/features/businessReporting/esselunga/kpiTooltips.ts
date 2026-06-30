/** Plain-language KPI explanations for customer-facing executive dashboard */

export const HERO_KPI_TOOLTIPS: Record<string, string> = {
  'Entrants': 'People whose live walking trail crossed the Entrance 1121 gate perimeter (at least one side of the rectangle). Counts every crossing — no dwell filter, no ID merging.',
  'Visitors': 'Legacy estimated unique visitors (zone-inside + proximity recovery). Shown for comparison with the perimeter entrant count.',
  'In store now': 'Live count from the perception frame — shoppers currently detected in the store right now. Updates every 10 seconds.',
  'Avg dwell': 'Median time in shopping zones per stitched store visit (sessions with 3–90 min total dwell at shelves). p25–p75 shown when available.',
  'Aisle reach': 'Share of visitors who had at least one dwell visit in a shelf aisle during the period.',
  'Aisle stopping': 'Share of aisle zone crossings where the shopper stayed long enough to count as a stop (dwell threshold).',
  'Checkout': 'Completed checkout queue sessions detected at mapped till zones.',
  'Avg ticket': 'Average transaction value from uploaded POS/ERP data for this period.',
  'SPI': 'Store Productivity Index — revenue per square metre per hour of shopper dwell (requires ERP upload).',
};

export const FRESCO_TOOLTIPS = {
  stopping: 'Percentage of zone crossings where the shopper stayed at least the stopping threshold (e.g. 20s) inside this counter zone.',
  crossings: 'How many times a LiDAR track entered this department zone. One person walking the counter may generate multiple crossings.',
  dwellVisits: 'Crossings that exceeded the stopping threshold — counted as a stop at this counter.',
  avgDwell: 'Average time spent in the zone among dwell visits only (not pass-throughs).',
  passThrough: 'Crossed the zone but left before reaching the stopping threshold — walked past without stopping.',
  queue: 'Share of visits detected in the queue zone vs browsing at the service counter.',
  abandon: 'Queue sessions where the shopper left before being served.',
};

export const JOURNEY_SIGNAL_TOOLTIPS = {
  Entrants: 'Live perimeter crossings at Entrance 1121 — the walking trail must cross the gate rectangle border. One count per crossing event.',
  'Shelf engagement': 'Among all aisle zone crossings, what percentage became dwell visits (stopped at shelves). Not a conversion rate from visitors.',
  Checkout: 'Queue sessions at mapped checkout lanes — completed, average wait, and abandon rate.',
};

export const SECTION_TOOLTIPS = {
  heatmap: 'Live 3D heatmap of where shoppers walk and dwell. Warmer colours = more visits or dwell time. Drag to rotate the floorplan.',
  timeline: 'Store rhythm over the selected period — when footfall and stopping activity peak.',
};

export const PULSE_TOOLTIPS = {
  storeRhythm:
    'When the store is busiest. Compare entrants at the gate (cyan) with aisle stops (amber) per hour or day. These are independent LiDAR signals — not a conversion funnel.',
  footfall:
    'Entrance 1121 perimeter crossings in each time bucket. A crossing is counted when the live trail crosses the gate rectangle edge.',
  stops:
    'Aisle zone crossings where the shopper met the dwell (stopping) threshold — paused at shelves long enough to count as engaged.',
  topCategories:
    'Zone crossings by mapped shelf category. Each LiDAR track entry into a tagged ROI counts; one shopper can generate multiple crossings. Click a row to highlight it on the heatmap.',
  inStoreNow:
    'Shoppers currently detected inside the store from the live perception frame. Updates every 10 seconds on Store Director view.',
};
