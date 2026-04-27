import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { execSync, exec } from 'child_process';
import DxfParser from 'dxf-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads directory exists
const UPLOADS_BASE = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const uploadDir = path.join(UPLOADS_BASE, 'dwg');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Ensure floorplan uploads directory exists
const floorplanUploadDir = path.join(UPLOADS_BASE, 'floorplans');
if (!fs.existsSync(floorplanUploadDir)) {
  fs.mkdirSync(floorplanUploadDir, { recursive: true });
}

// Configure multer for floorplan image uploads
const floorplanStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, floorplanUploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '_')}`)
});

const floorplanUpload = multer({
  storage: floorplanStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (PNG, JPG, GIF, BMP, WebP, SVG) are allowed'));
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

/**
 * Check if a command exists on the system
 */
function commandExists(cmd) {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert DWG to DXF using available tools
 * Tries: dwg2dxf (LibreDWG), ODAFileConverter, TeighaFileConverter
 */
async function convertDwgToDxf(dwgPath) {
  const dxfPath = dwgPath.replace(/\.dwg$/i, '.dxf');
  
  // Try LibreDWG's dwg2dxf (open source)
  if (commandExists('dwg2dxf')) {
    try {
      execSync(`dwg2dxf "${dwgPath}" -o "${dxfPath}"`, { stdio: 'pipe' });
      if (fs.existsSync(dxfPath)) {
        return dxfPath;
      }
    } catch (err) {
      console.log('dwg2dxf failed:', err.message);
    }
  }
  
  // Try ODA File Converter (free, cross-platform)
  const odaConverters = [
    '/usr/bin/ODAFileConverter',
    '/opt/ODAFileConverter/ODAFileConverter',
    '/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter',
    'C:\\Program Files\\ODA\\ODAFileConverter\\ODAFileConverter.exe'
  ];
  
  for (const odaPath of odaConverters) {
    if (fs.existsSync(odaPath)) {
      try {
        const inputDir = path.dirname(dwgPath);
        const outputDir = inputDir;
        const filename = path.basename(dwgPath);
        // ODA syntax: ODAFileConverter <input> <output> <version> <type> <recurse> <audit>
        execSync(`"${odaPath}" "${inputDir}" "${outputDir}" "ACAD2018" "DXF" "0" "1" "${filename}"`, { stdio: 'pipe' });
        if (fs.existsSync(dxfPath)) {
          return dxfPath;
        }
      } catch (err) {
        console.log('ODAFileConverter failed:', err.message);
      }
    }
  }
  
  // Try dwgread + manual conversion via libredwg
  if (commandExists('dwgread')) {
    try {
      execSync(`dwgread -O DXF "${dwgPath}" > "${dxfPath}"`, { stdio: 'pipe', shell: true });
      if (fs.existsSync(dxfPath) && fs.statSync(dxfPath).size > 0) {
        return dxfPath;
      }
    } catch (err) {
      console.log('dwgread failed:', err.message);
    }
  }

  return null;
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.dxf' || ext === '.dwg') {
      cb(null, true);
    } else {
      cb(new Error('Only .dxf and .dwg files are allowed'));
    }
  },
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// DXF Units mapping (based on $INSUNITS header)
const DXF_UNITS = {
  0: { name: 'unitless', scale: 1 },
  1: { name: 'inches', scale: 0.0254 },
  2: { name: 'feet', scale: 0.3048 },
  3: { name: 'miles', scale: 1609.344 },
  4: { name: 'mm', scale: 0.001 },
  5: { name: 'cm', scale: 0.01 },
  6: { name: 'm', scale: 1 },
  7: { name: 'km', scale: 1000 },
  8: { name: 'microinches', scale: 0.0000000254 },
  9: { name: 'mils', scale: 0.0000254 },
  10: { name: 'yards', scale: 0.9144 },
  11: { name: 'angstroms', scale: 1e-10 },
  12: { name: 'nanometers', scale: 1e-9 },
  13: { name: 'microns', scale: 1e-6 },
  14: { name: 'decimeters', scale: 0.1 },
  15: { name: 'decameters', scale: 10 },
  16: { name: 'hectometers', scale: 100 },
  17: { name: 'gigameters', scale: 1e9 },
  18: { name: 'astronomical', scale: 1.496e11 },
  19: { name: 'lightyears', scale: 9.461e15 },
  20: { name: 'parsecs', scale: 3.086e16 }
};

// Grouping tolerance in mm
const GROUPING_TOLERANCE_MM = 25;

// ─── Geometric Prefilter Configuration ──────────────────────────────
// Calibrated against real grocery-store DWGs (TREVIGLIO Schematico.dwg,
// 3500 m², 8071 raw fixtures across 1024 groups). The largest legitimate
// in-store fixture is a checkout row / freezer island ≈ 10 m long; any
// closed polyline or block reference larger than this is almost always
// CAD background (walls, building elevations, parcel outlines, sheet
// borders, georeferenced markers).

const PREFILTER_DEFAULTS = {
  // Drop fixtures whose max(w, d) in METRES exceeds this.
  // Set to "truly nothing in a retail space is this big" — 60 m covers even
  // the longest imaginable hypermarket gondola run / freezer wall. The real
  // fine-grained work is done by `relativeSizeOutlier` which adapts to the
  // drawing's own population.
  maxFixtureSizeM: 60,

  // Drop polyline-only (no block) singletons (count == 1) whose max(w, d)
  // in METRES exceeds this. The threshold must be high enough that real
  // shelf runs (which can be 5–30 m and each a unique length) survive.
  // Only truly massive lone polylines (site boundaries, sheet borders)
  // get caught. The relative-size filter handles the medium range.
  maxPolylineSingletonSizeM: 50,

  // ── Relative-size outlier filter ────────────────────────────────
  // Targets the "giant rectangle" problem: sheet borders, site-plan
  // boundaries, and viewport rectangles that are MUCH larger than any
  // real fixture — without nuking legitimate large shelves. We compute
  // the Pth percentile fixture size (default P95) and drop anything
  // whose size exceeds `relativeSizeMultiplier × P95`.
  //
  //  • If the fixture population is ~1-4 m and P95 ≈ 4 m, anything
  //    > 8×4 = 32 m is almost certainly CAD background.
  //  • If the store has legitimate 25 m gondola runs (rare but possible),
  //    they sit inside the population and pass through cleanly.
  //
  // This filter is scale-adaptive — the user never has to pick a number
  // that works for THEIR drawing, and a 30 m shelf won't be punished
  // just because most other stores have 3 m shelves.
  relativeSizePercentile: 95,
  relativeSizeMultiplier: 8,
  // Safety: never drop more than this fraction in one pass.
  relativeSizeMaxDropFraction: 0.3,

  // Iterative MAD (Median Absolute Deviation) coordinate filter. Each pass
  // recomputes median + MAD on survivors and drops anything outside
  // `madSpread × MAD` from the median (per axis). Iterating with shrinking
  // spread converges to the densest cluster — essential when a DXF contains
  // multiple stacked floor-plan sheets (a common Italian CAD convention).
  // Pass 1 removes extreme geo-reference outliers (km-scale).
  // Pass 2 tightens around the main building.
  // Pass 3 isolates the densest sheet/floor.
  madSpreads: [20, 15, 12],

  // Safety: if iterative MAD would drop more than this fraction of fixtures
  // in a single pass, that pass is skipped (protects clean single-cluster
  // imports from being over-filtered).
  madMaxDropFraction: 0.5,

  // Primary-cluster detection (sliding window). Scans for the densest axis-
  // aligned window of `clusterWindowM` metres on each axis independently,
  // then keeps only fixtures that fall inside both windows (with margin).
  // This is what isolates ONE floor plan from a DXF that contains multiple
  // stacked sheets (very common in Italian architectural sets that include
  // Pianta Piano Terra, Piano 1, Pianta Copertura, sezioni... in one file).
  // Set clusterWindowM = 0 to disable.
  clusterWindowM: 1000,
  clusterMarginM: 200,
  // Skip cluster picking if it would keep less than this fraction of fixtures
  // (protects single-cluster imports — if the densest window already contains
  // most fixtures, we don't need to crop).
  clusterMinKeepFraction: 0.25,

  // Skip degenerate fixtures (w or d below this in METRES). 1 mm.
  minFixtureSizeM: 0.001,

  // Layer name regex blocklist — CONSERVATIVE by default.
  // Only block layers that are definitely CAD system / non-plottable junk.
  // Architectural layers (walls, partitions, doors) are NOT blocked by
  // default — they often contain the store's perimeter and fixtures.
  // The Prefilter Studio shows per-layer item counts so the user can
  // enable additional patterns after visually inspecting the preview.
  layerBlocklist: [
    /^defpoints$/i,
    /nonplott|non[-_ ]?plott/i,
    /^viewport(s)?$/i,
    /^title[-_ ]?block$/i,
    /^cartiglio/i,
    /^border$/i,
    /^sheet$/i,
  ],
};


/**
 * Parse DXF file and extract fixture candidates
 */
function parseDxfFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parser = new DxfParser();
  
  let dxf;
  try {
    dxf = parser.parseSync(content);
  } catch (err) {
    throw new Error(`Failed to parse DXF: ${err.message}`);
  }
  
  // Determine units from header
  let units = 'mm';
  let unitScaleToM = 0.001;
  
  if (dxf.header && dxf.header.$INSUNITS !== undefined) {
    const unitCode = dxf.header.$INSUNITS;
    const unitInfo = DXF_UNITS[unitCode];
    if (unitInfo) {
      units = unitInfo.name;
      unitScaleToM = unitInfo.scale;
    }
  }
  
  const fixtures = [];
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  
  // Process entities
  if (dxf.entities) {
    for (const entity of dxf.entities) {
      // Skip text, dimensions, hatches by default
      if (['TEXT', 'MTEXT', 'DIMENSION', 'HATCH', 'LEADER'].includes(entity.type)) {
        continue;
      }
      
      // Process INSERT entities (block references)
      if (entity.type === 'INSERT') {
        const fixture = processInsertEntity(entity, dxf.blocks);
        if (fixture) {
          fixtures.push(fixture);
          updateBounds(bounds, fixture);
        }
      }
      
      // Process closed polylines
      if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        const fixture = processPolylineEntity(entity);
        if (fixture) {
          fixtures.push(fixture);
          updateBounds(bounds, fixture);
        }
      }
      
      // Process LINE entities that might form closed shapes
      if (entity.type === 'LINE') {
        const fixture = processLineEntity(entity);
        if (fixture) {
          fixtures.push(fixture);
          updateBounds(bounds, fixture);
        }
      }
    }
  }
  
  return {
    units,
    unitScaleToM,
    bounds: {
      minX: bounds.minX === Infinity ? 0 : bounds.minX,
      minY: bounds.minY === Infinity ? 0 : bounds.minY,
      maxX: bounds.maxX === -Infinity ? 0 : bounds.maxX,
      maxY: bounds.maxY === -Infinity ? 0 : bounds.maxY
    },
    fixtures,
    header: dxf.header || {},
    layers: Object.keys(dxf.tables?.layer?.layers || {})
  };
}

/**
 * Process INSERT entity (block reference)
 */
function processInsertEntity(entity, blocks) {
  const blockName = entity.name;
  const block = blocks?.[blockName];
  
  // Get block bounds
  let blockBounds = { w: 1, d: 1 };
  if (block && block.entities) {
    const bbox = calculateBlockBounds(block.entities);
    blockBounds = {
      w: Math.abs(bbox.maxX - bbox.minX),
      d: Math.abs(bbox.maxY - bbox.minY)
    };
  }
  
  // Apply scale
  const scaleX = entity.xScale || 1;
  const scaleY = entity.yScale || 1;
  
  return {
    id: `fx_${uuidv4().slice(0, 8)}`,
    source: {
      layer: entity.layer || 'default',
      block: blockName,
      entity_type: 'INSERT'
    },
    pose2d: {
      x: entity.position?.x || 0,
      y: entity.position?.y || 0,
      rot_deg: entity.rotation || 0
    },
    footprint: {
      kind: 'rect',
      w: Math.abs(blockBounds.w * scaleX),
      d: Math.abs(blockBounds.d * scaleY),
      points: []
    }
  };
}

/**
 * Process LWPOLYLINE/POLYLINE entity
 */
function processPolylineEntity(entity) {
  const vertices = entity.vertices || [];
  if (vertices.length < 3) return null;
  
  // Check if closed
  const isClosed = entity.shape || 
    (vertices.length > 2 && 
     Math.abs(vertices[0].x - vertices[vertices.length-1].x) < 0.01 &&
     Math.abs(vertices[0].y - vertices[vertices.length-1].y) < 0.01);
  
  if (!isClosed) return null;
  
  // Calculate bounding box and centroid
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let sumX = 0, sumY = 0;
  
  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    sumX += v.x;
    sumY += v.y;
  }
  
  const centroidX = sumX / vertices.length;
  const centroidY = sumY / vertices.length;
  const width = maxX - minX;
  const depth = maxY - minY;
  
  // Calculate rotation from longest edge
  const rotation = calculatePolylineRotation(vertices);
  
  return {
    id: `fx_${uuidv4().slice(0, 8)}`,
    source: {
      layer: entity.layer || 'default',
      block: null,
      entity_type: entity.type
    },
    pose2d: {
      x: centroidX,
      y: centroidY,
      rot_deg: rotation
    },
    footprint: {
      kind: 'poly',
      w: width,
      d: depth,
      points: vertices.map(v => ({ x: v.x, y: v.y }))
    }
  };
}

/**
 * Process LINE entity
 */
function processLineEntity(entity) {
  // Single lines aren't fixtures, skip
  return null;
}

/**
 * Calculate bounds from block entities
 */
function calculateBlockBounds(entities) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  
  for (const entity of entities) {
    if (entity.vertices) {
      for (const v of entity.vertices) {
        minX = Math.min(minX, v.x || 0);
        minY = Math.min(minY, v.y || 0);
        maxX = Math.max(maxX, v.x || 0);
        maxY = Math.max(maxY, v.y || 0);
      }
    }
    if (entity.position) {
      minX = Math.min(minX, entity.position.x || 0);
      minY = Math.min(minY, entity.position.y || 0);
      maxX = Math.max(maxX, entity.position.x || 0);
      maxY = Math.max(maxY, entity.position.y || 0);
    }
    if (entity.type === 'LINE') {
      if (entity.start) {
        minX = Math.min(minX, entity.start.x || 0);
        minY = Math.min(minY, entity.start.y || 0);
        maxX = Math.max(maxX, entity.start.x || 0);
        maxY = Math.max(maxY, entity.start.y || 0);
      }
      if (entity.end) {
        minX = Math.min(minX, entity.end.x || 0);
        minY = Math.min(minY, entity.end.y || 0);
        maxX = Math.max(maxX, entity.end.x || 0);
        maxY = Math.max(maxY, entity.end.y || 0);
      }
    }
  }
  
  return {
    minX: minX === Infinity ? 0 : minX,
    minY: minY === Infinity ? 0 : minY,
    maxX: maxX === -Infinity ? 0 : maxX,
    maxY: maxY === -Infinity ? 0 : maxY
  };
}

/**
 * Calculate rotation from polyline's longest edge
 */
function calculatePolylineRotation(vertices) {
  if (vertices.length < 2) return 0;
  
  let maxLength = 0;
  let longestEdgeAngle = 0;
  
  for (let i = 0; i < vertices.length; i++) {
    const v1 = vertices[i];
    const v2 = vertices[(i + 1) % vertices.length];
    const dx = v2.x - v1.x;
    const dy = v2.y - v1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length > maxLength) {
      maxLength = length;
      longestEdgeAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    }
  }
  
  return longestEdgeAngle;
}

/**
 * Update bounds with fixture
 */
function updateBounds(bounds, fixture) {
  const { x, y } = fixture.pose2d;
  const halfW = fixture.footprint.w / 2;
  const halfD = fixture.footprint.d / 2;
  
  bounds.minX = Math.min(bounds.minX, x - halfW);
  bounds.minY = Math.min(bounds.minY, y - halfD);
  bounds.maxX = Math.max(bounds.maxX, x + halfW);
  bounds.maxY = Math.max(bounds.maxY, y + halfD);
}

/**
 * Group fixtures by similarity
 */
function groupFixtures(fixtures, toleranceMm = GROUPING_TOLERANCE_MM) {
  const groups = new Map();
  
  for (const fixture of fixtures) {
    const groupKey = generateGroupKey(fixture, toleranceMm);
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        group_id: `grp_${uuidv4().slice(0, 6)}`,
        layer: fixture.source.layer,
        block: fixture.source.block,
        size: {
          w: fixture.footprint.w,
          d: fixture.footprint.d
        },
        members: [],
        count: 0
      });
    }
    
    const group = groups.get(groupKey);
    group.members.push(fixture.id);
    group.count++;
    
    // Assign group_id to fixture
    fixture.group_id = group.group_id;
  }
  
  return Array.from(groups.values());
}

/**
 * Generate group key for fixture
 */
function generateGroupKey(fixture, toleranceMm) {
  // Priority 1: Block name (for INSERT entities)
  if (fixture.source.block) {
    return `block:${fixture.source.block}`;
  }
  
  // Priority 2: Layer + normalized size
  const w = Math.round(fixture.footprint.w / toleranceMm) * toleranceMm;
  const d = Math.round(fixture.footprint.d / toleranceMm) * toleranceMm;
  const normalizedW = Math.max(w, d);
  const normalizedD = Math.min(w, d);
  
  return `layer:${fixture.source.layer}:${normalizedW}x${normalizedD}`;
}

/**
 * Geometric prefilter — remove CAD artifacts before they become fixture groups.
 *
 * Pipeline (each step removes a different class of noise):
 *   1. Layer blocklist        → architectural drafting layers (walls, elevations…)
 *   2. Degenerate fixtures    → zero/near-zero footprint
 *   3. Absolute size cap      → entities larger than any real in-store fixture
 *   4. Polyline singletons    → unique large closed polylines (boundaries)
 *   5. MAD coordinate cluster → entities placed kilometres from the floor plan
 *
 * Returns { fixtures, bounds, stats } where stats reports per-step removals.
 */
function prefilterFixtures(fixtures, unitScaleToM, opts = {}) {
  const cfg = { ...PREFILTER_DEFAULTS, ...opts };
  // Step enable flags (all default ON — a step is only skipped when
  // explicitly disabled by the UI).
  const enable = {
    layerBlock: opts.enableLayerBlock !== false,
    degenerate: opts.enableDegenerate !== false,
    sizeCap: opts.enableSizeCap !== false,
    relativeSizeOutlier: opts.enableRelativeSizeOutlier !== false,
    polylineSingleton: opts.enablePolylineSingleton !== false,
    madOutlier: opts.enableMadOutlier !== false,
    clusterPicker: opts.enableClusterPicker !== false,
  };
  const u = unitScaleToM || 0.001;
  const stats = {
    input: fixtures.length,
    droppedByLayer: 0,
    droppedByDegenerate: 0,
    droppedBySize: 0,
    droppedByRelativeSize: 0,
    droppedByPolylineSingleton: 0,
    droppedByCoordinateOutlier: 0,
    droppedByCluster: 0,
    kept: 0,
    droppedSamples: { layer: [], size: [], relativeSize: [], polylineSingleton: [], coordinateOutlier: [] },
    relativeSize: null,
    // Per-layer hit counts for the UI:
    //   layerHits[<pattern source>][<layer name>] = count
    // so the Prefilter Studio can show "rule /muratur/i caught 412 items
    // across layer X, Y, Z".
    layerHits: {},
    // Per-layer totals (what the file actually contains, before any filter)
    layerTotals: {},
  };

  const sample = (bucket, item) => {
    const arr = stats.droppedSamples[bucket];
    if (arr.length < 5) arr.push(item);
  };

  const sizeM = f => Math.max(f.footprint.w || 0, f.footprint.d || 0) * u;
  const minDimM = f => Math.min(f.footprint.w || 0, f.footprint.d || 0) * u;

  // Count per-layer totals from the input set (for UI display)
  for (const f of fixtures) {
    const layer = f.source?.layer || '(no-layer)';
    stats.layerTotals[layer] = (stats.layerTotals[layer] || 0) + 1;
  }

  // Normalise layer blocklist — accept strings from the API and compile them
  // into RegExp objects. We also keep the original source string so we can
  // emit it back in `layerHits` for the UI.
  const compiledBlocklist = (cfg.layerBlocklist || []).map(rx => {
    if (rx instanceof RegExp) return { re: rx, src: rx.source, flags: rx.flags };
    if (typeof rx === 'string') {
      try { return { re: new RegExp(rx, 'i'), src: rx, flags: 'i' }; }
      catch { return null; }
    }
    if (rx && typeof rx === 'object' && typeof rx.pattern === 'string') {
      try {
        return { re: new RegExp(rx.pattern, rx.flags || 'i'), src: rx.pattern, flags: rx.flags || 'i' };
      } catch { return null; }
    }
    return null;
  }).filter(Boolean);

  // Step 1: Layer name blocklist
  let kept = fixtures.filter(f => {
    if (!enable.layerBlock) return true;
    const layer = f.source?.layer || '';
    const hit = compiledBlocklist.find(p => p.re.test(layer));
    if (hit) {
      stats.droppedByLayer++;
      const src = hit.src;
      stats.layerHits[src] = stats.layerHits[src] || {};
      stats.layerHits[src][layer] = (stats.layerHits[src][layer] || 0) + 1;
      sample('layer', { layer, block: f.source?.block || null, w_m: +(sizeM(f)).toFixed(2) });
      return false;
    }
    return true;
  });

  // Step 2: Degenerate (zero / near-zero) footprints
  kept = kept.filter(f => {
    if (!enable.degenerate) return true;
    if (sizeM(f) < cfg.minFixtureSizeM || minDimM(f) < cfg.minFixtureSizeM) {
      stats.droppedByDegenerate++;
      return false;
    }
    return true;
  });

  // Step 3: Absolute size cap (any dimension over maxFixtureSizeM)
  kept = kept.filter(f => {
    if (!enable.sizeCap) return true;
    if (sizeM(f) > cfg.maxFixtureSizeM) {
      stats.droppedBySize++;
      sample('size', {
        layer: f.source?.layer,
        block: f.source?.block || null,
        w_m: +(f.footprint.w * u).toFixed(2),
        d_m: +(f.footprint.d * u).toFixed(2),
      });
      return false;
    }
    return true;
  });

  // Step 3.5: Relative-size outlier — scale-adaptive "massive rectangle" filter.
  // Computes the Pth percentile size of the surviving population and drops
  // anything more than `relativeSizeMultiplier ×` that percentile. Works
  // whether the store has 1 m baskets or 30 m gondola runs.
  if (enable.relativeSizeOutlier && kept.length >= 20) {
    const sizes = kept.map(sizeM).sort((a, b) => a - b);
    const pct = Math.min(99, Math.max(50, cfg.relativeSizePercentile));
    const p = sizes[Math.floor(sizes.length * (pct / 100))] || 0;
    const threshold = p * cfg.relativeSizeMultiplier;

    if (p > 0 && threshold > 0) {
      const candidates = kept.filter(f => sizeM(f) > threshold);
      const dropFraction = candidates.length / kept.length;

      stats.relativeSize = {
        percentile: pct,
        p_m: +p.toFixed(3),
        multiplier: cfg.relativeSizeMultiplier,
        threshold_m: +threshold.toFixed(2),
        candidates: candidates.length,
        dropFraction: +dropFraction.toFixed(3),
        skipped: false,
      };

      if (dropFraction > cfg.relativeSizeMaxDropFraction) {
        // Too many "outliers" → likely this threshold is wrong for this
        // drawing (maybe an almost-uniform population). Skip for safety.
        stats.relativeSize.skipped = true;
      } else {
        const toDrop = new Set(candidates.map(f => f.id));
        kept = kept.filter(f => {
          if (!toDrop.has(f.id)) return true;
          stats.droppedByRelativeSize++;
          sample('relativeSize', {
            layer: f.source?.layer,
            block: f.source?.block || null,
            w_m: +(f.footprint.w * u).toFixed(2),
            d_m: +(f.footprint.d * u).toFixed(2),
            max_m: +(sizeM(f)).toFixed(2),
            threshold_m: +threshold.toFixed(2),
          });
          return false;
        });
      }
    }
  }

  // Step 4: Polyline-only singletons (no block, count==1, oversized)
  // Build a count of polyline fixtures per (layer + rounded size) key first.
  const polyKey = f => {
    const wKey = Math.round((f.footprint.w || 0) / 25) * 25;
    const dKey = Math.round((f.footprint.d || 0) / 25) * 25;
    return `${f.source?.layer}|${wKey}x${dKey}`;
  };
  const polyCount = new Map();
  for (const f of kept) {
    if (f.source?.block) continue;
    const k = polyKey(f);
    polyCount.set(k, (polyCount.get(k) || 0) + 1);
  }
  kept = kept.filter(f => {
    if (!enable.polylineSingleton) return true;
    if (f.source?.block) return true;
    if (sizeM(f) <= cfg.maxPolylineSingletonSizeM) return true;
    if ((polyCount.get(polyKey(f)) || 0) <= 1) {
      stats.droppedByPolylineSingleton++;
      sample('polylineSingleton', {
        layer: f.source?.layer,
        w_m: +(f.footprint.w * u).toFixed(2),
        d_m: +(f.footprint.d * u).toFixed(2),
      });
      return false;
    }
    return true;
  });

  // Step 5: Iterative MAD coordinate filter — converges to densest cluster.
  // Critical for multi-sheet DXFs (site plan + floor plans stacked along Y).
  const spreads = Array.isArray(cfg.madSpreads) ? cfg.madSpreads
    : (typeof cfg.madSpread === 'number' ? [cfg.madSpread] : []);
  if (enable.madOutlier && kept.length >= 20 && spreads.length > 0) {
    const passInfo = [];
    for (let pass = 0; pass < spreads.length; pass++) {
      if (kept.length < 20) break;
      const spread = spreads[pass];
      const mid = arr => arr[Math.floor(arr.length / 2)];
      const xs = kept.map(f => f.pose2d?.x ?? 0).slice().sort((a, b) => a - b);
      const ys = kept.map(f => f.pose2d?.y ?? 0).slice().sort((a, b) => a - b);
      const medianX = mid(xs);
      const medianY = mid(ys);
      const devX = kept.map(f => Math.abs((f.pose2d?.x ?? 0) - medianX)).sort((a, b) => a - b);
      const devY = kept.map(f => Math.abs((f.pose2d?.y ?? 0) - medianY)).sort((a, b) => a - b);
      const madX = Math.max(mid(devX), 1);
      const madY = Math.max(mid(devY), 1);
      const limitX = spread * madX;
      const limitY = spread * madY;

      const candidate = [];
      const removed = [];
      for (const f of kept) {
        const dx = Math.abs((f.pose2d?.x ?? 0) - medianX);
        const dy = Math.abs((f.pose2d?.y ?? 0) - medianY);
        if (dx > limitX || dy > limitY) removed.push(f);
        else candidate.push(f);
      }
      const dropFrac = removed.length / kept.length;
      // Safety: skip pass if it would over-prune (single-cluster file already converged)
      if (dropFrac > cfg.madMaxDropFraction) {
        passInfo.push({ pass: pass + 1, spread, skipped: true, wouldDrop: removed.length });
        continue;
      }
      stats.droppedByCoordinateOutlier += removed.length;
      for (const f of removed.slice(0, 5)) {
        sample('coordinateOutlier', {
          layer: f.source?.layer,
          block: f.source?.block || null,
          x_m: +((f.pose2d?.x ?? 0) * u).toFixed(1),
          y_m: +((f.pose2d?.y ?? 0) * u).toFixed(1),
          pass: pass + 1,
        });
      }
      passInfo.push({
        pass: pass + 1, spread,
        dropped: removed.length,
        kept: candidate.length,
        median_m: { x: +(medianX * u).toFixed(1), y: +(medianY * u).toFixed(1) },
        mad_m: { x: +(madX * u).toFixed(2), y: +(madY * u).toFixed(2) },
      });
      kept = candidate;
    }
    stats.madPasses = passInfo;
  }

  // Step 6: Primary-cluster detection — densest window on each axis.
  // Finds the densest 1D window of `clusterWindowM` along X and Y separately,
  // then keeps only fixtures inside BOTH windows (plus margin).
  if (enable.clusterPicker && cfg.clusterWindowM > 0 && kept.length >= 50) {
    const winSize = cfg.clusterWindowM / u; // back to DXF units
    const margin = cfg.clusterMarginM / u;

    // Find densest 1D window of size `winSize` for an axis (returns [lo, hi])
    const densestWindow = (vals) => {
      const sorted = vals.slice().sort((a, b) => a - b);
      let bestStart = sorted[0], bestCount = 0, j = 0;
      for (let i = 0; i < sorted.length; i++) {
        if (j < i) j = i;
        while (j < sorted.length && sorted[j] - sorted[i] <= winSize) j++;
        const count = j - i;
        if (count > bestCount) { bestCount = count; bestStart = sorted[i]; }
      }
      return { lo: bestStart - margin, hi: bestStart + winSize + margin, count: bestCount };
    };

    const xs = kept.map(f => f.pose2d?.x ?? 0);
    const ys = kept.map(f => f.pose2d?.y ?? 0);
    const wx = densestWindow(xs);
    const wy = densestWindow(ys);

    const inside = kept.filter(f => {
      const x = f.pose2d?.x ?? 0;
      const y = f.pose2d?.y ?? 0;
      return x >= wx.lo && x <= wx.hi && y >= wy.lo && y <= wy.hi;
    });

    const keepFrac = inside.length / kept.length;
    stats.cluster = {
      windowM: cfg.clusterWindowM,
      marginM: cfg.clusterMarginM,
      window_x_m: { lo: +(wx.lo * u).toFixed(1), hi: +(wx.hi * u).toFixed(1) },
      window_y_m: { lo: +(wy.lo * u).toFixed(1), hi: +(wy.hi * u).toFixed(1) },
      droppedOutside: kept.length - inside.length,
      kept: inside.length,
      keepFraction: +keepFrac.toFixed(3),
    };
    if (keepFrac >= cfg.clusterMinKeepFraction) {
      stats.droppedByCluster = kept.length - inside.length;
      kept = inside;
    } else {
      stats.cluster.skipped = true;
      stats.droppedByCluster = 0;
    }
  } else {
    stats.droppedByCluster = 0;
  }

  // Recompute bounds from survivors
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const f of kept) {
    const x = f.pose2d?.x ?? 0;
    const y = f.pose2d?.y ?? 0;
    const hw = (f.footprint?.w || 0) / 2;
    const hd = (f.footprint?.d || 0) / 2;
    bounds.minX = Math.min(bounds.minX, x - hw);
    bounds.minY = Math.min(bounds.minY, y - hd);
    bounds.maxX = Math.max(bounds.maxX, x + hw);
    bounds.maxY = Math.max(bounds.maxY, y + hd);
  }
  if (bounds.minX === Infinity) {
    bounds.minX = 0; bounds.minY = 0; bounds.maxX = 0; bounds.maxY = 0;
  }

  stats.kept = kept.length;
  stats.boundsM = {
    width: +((bounds.maxX - bounds.minX) * u).toFixed(2),
    depth: +((bounds.maxY - bounds.minY) * u).toFixed(2),
  };

  return { fixtures: kept, bounds, stats };
}

/**
 * Generate layout JSON from fixtures and mapping
 */
function generateLayoutJson(importData, mapping) {
  const { fixtures, units, unitScaleToM, bounds, groups } = importData;
  const groupMappings = mapping.group_mappings || {};
  
  // Build a map of group sizes
  const groupSizeMap = {};
  groups.forEach(g => {
    groupSizeMap[g.group_id] = g.size || { w: 0, d: 0 };
  });

  // Include ALL fixtures — mapped ones get their mapping, unmapped get type 'custom'
  // This ensures the layout (and resulting venue) always shows every DWG fixture
  const layoutFixtures = fixtures.map(fixture => {
      const groupMapping = groupMappings[fixture.group_id] || null;
      const groupSize = groupSizeMap[fixture.group_id] || { w: 0, d: 0 };
      
      // Use group size if fixture footprint is empty
      const footprint = (fixture.footprint && fixture.footprint.w > 0 && fixture.footprint.d > 0)
        ? fixture.footprint
        : { ...(fixture.footprint || {}), w: groupSize.w || 1000, d: groupSize.d || 1000 };
      
      return {
        id: fixture.id,
        group_id: fixture.group_id,
        source: fixture.source,
        pose2d: fixture.pose2d,
        footprint: footprint,
        group_size: groupSize,
        mapping: groupMapping || { type: 'custom' }
      };
    });
  
  // Count paired (explicitly mapped with catalog_asset_id) vs total
  const pairedCount = layoutFixtures.filter(f => f.mapping?.catalog_asset_id).length;
  const totalCount = fixtures.length;
  
  // Recalculate bounds from FILTERED fixtures (not original DWG bounds which may include deleted artifacts)
  let filteredBounds = bounds;
  if (fixtures.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of fixtures) {
      const x = f.pose2d?.x || 0;
      const y = f.pose2d?.y || 0;
      const hw = (f.footprint?.w || 0) / 2;
      const hd = (f.footprint?.d || 0) / 2;
      minX = Math.min(minX, x - hw);
      maxX = Math.max(maxX, x + hw);
      minY = Math.min(minY, y - hd);
      maxY = Math.max(maxY, y + hd);
    }
    if (minX !== Infinity) {
      filteredBounds = { minX, maxX, minY, maxY };
      console.log(`[generateLayoutJson] Recalculated bounds from ${fixtures.length} fixtures: ${JSON.stringify(filteredBounds)}`);
    }
  }
  
  return {
    units,
    unit_scale_to_m: unitScaleToM,
    bounds: filteredBounds,
    fixtures: layoutFixtures,
    paired_count: pairedCount,
    total_count: totalCount,
    groups: groups.map(g => ({
      group_id: g.group_id,
      count: g.count,
      layer: g.layer,
      block: g.block,
      size: g.size,
      members: g.members,
      mapping: groupMappings[g.group_id] || null,
      is_paired: !!(groupMappings[g.group_id]?.catalog_asset_id)
    }))
  };
}

/**
 * Create DWG import routes
 */
export default function createDwgImportRoutes(db) {
  const router = express.Router();
  
  // Feature flag middleware
  const featureGuard = (req, res, next) => {
    if (process.env.FEATURE_DWG_IMPORTER !== 'true') {
      return res.status(404).json({ error: 'DWG Importer feature is disabled' });
    }
    next();
  };
  
  router.use(featureGuard);
  
  /**
   * POST /api/dwg/import - Upload and parse DWG/DXF file
   */
  router.post('/import', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      
      const ext = path.extname(req.file.originalname).toLowerCase();
      let filePath = req.file.path;
      let convertedFromDwg = false;
      
      // Handle DWG files - convert to DXF first
      if (ext === '.dwg') {
        console.log('Converting DWG to DXF...');
        const dxfPath = await convertDwgToDxf(req.file.path);
        
        if (!dxfPath) {
          return res.status(400).json({ 
            error: 'DWG conversion failed. Please install LibreDWG (brew install libredwg) or ODA File Converter, or export as DXF from your CAD software.',
            hint: 'Install: brew install libredwg (macOS) or apt install libredwg (Linux)'
          });
        }
        
        filePath = dxfPath;
        convertedFromDwg = true;
        console.log('DWG converted successfully to:', dxfPath);
      }
      
      // Parse DXF
      const parsed = parseDxfFile(filePath);

      // Always preserve the ORIGINAL (pre-filter) fixture list so the
      // Prefilter Studio UI can re-run the filter with different thresholds
      // without needing to re-parse or re-upload the DXF.
      const originalFixtures = parsed.fixtures.slice();
      const originalBounds = { ...parsed.bounds };

      // Geometric prefilter — strip CAD artifacts (walls, elevations, sheet
      // borders, geo-reference markers) before they pollute groups + bounds.
      // Skipped via ?nofilter=1 query param or { prefilter: false } body flag.
      const skipPrefilter = req.query.nofilter === '1' || req.body?.prefilter === false;
      let prefilterStats = null;
      if (!skipPrefilter) {
        const before = {
          count: parsed.fixtures.length,
          width: ((parsed.bounds.maxX - parsed.bounds.minX) * parsed.unitScaleToM).toFixed(1),
          depth: ((parsed.bounds.maxY - parsed.bounds.minY) * parsed.unitScaleToM).toFixed(1),
        };
        const result = prefilterFixtures(parsed.fixtures, parsed.unitScaleToM);
        parsed.fixtures = result.fixtures;
        parsed.bounds = result.bounds;
        prefilterStats = result.stats;
        console.log(
          `[DWG Prefilter] ${before.count} → ${result.fixtures.length} fixtures ` +
          `(layer:${result.stats.droppedByLayer}, ` +
          `degen:${result.stats.droppedByDegenerate}, ` +
          `size:${result.stats.droppedBySize}, ` +
          `polySingleton:${result.stats.droppedByPolylineSingleton}, ` +
          `coordOutlier:${result.stats.droppedByCoordinateOutlier}, ` +
          `cluster:${result.stats.droppedByCluster})`
        );
        console.log(
          `[DWG Prefilter] bounds ${before.width}m × ${before.depth}m → ` +
          `${result.stats.boundsM.width}m × ${result.stats.boundsM.depth}m`
        );
      }

      // Group fixtures
      const groups = groupFixtures(parsed.fixtures);
      
      // Create import record
      const importId = uuidv4();
      const now = new Date().toISOString();
      
      db.prepare(`
        INSERT INTO dwg_imports (id, venue_id, filename, units, unit_scale_to_m, bounds_json, raw_json, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        importId,
        req.body.venue_id || null,
        req.file.originalname,
        parsed.units,
        parsed.unitScaleToM,
        JSON.stringify(parsed.bounds),
        JSON.stringify({
          fixtures: parsed.fixtures,
          originalFixtures,
          originalBounds,
          layers: parsed.layers,
          prefilter: prefilterStats,
        }),
        'parsed',
        now,
        now
      );
      
      // Store groups
      const insertGroup = db.prepare(`
        INSERT INTO dwg_groups (id, import_id, group_id, layer, block_name, count, size_w, size_d, members_json, meta_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const group of groups) {
        insertGroup.run(
          uuidv4(),
          importId,
          group.group_id,
          group.layer,
          group.block,
          group.count,
          group.size.w,
          group.size.d,
          JSON.stringify(group.members),
          JSON.stringify({}),
          now
        );
      }
      
      res.json({
        import_id: importId,
        filename: req.file.originalname,
        units: parsed.units,
        unit_scale_to_m: parsed.unitScaleToM,
        bounds: parsed.bounds,
        fixture_count: parsed.fixtures.length,
        group_count: groups.length,
        layers: parsed.layers,
        prefilter: prefilterStats,
        groups: groups.map(g => ({
          group_id: g.group_id,
          layer: g.layer,
          block: g.block,
          count: g.count,
          size: g.size
        }))
      });
      
    } catch (err) {
      console.error('DWG import error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * GET /api/dwg/import/:import_id - Get import details
   */
  router.get('/import/:import_id', (req, res) => {
    try {
      const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(req.params.import_id);
      
      if (!imp) {
        return res.status(404).json({ error: 'Import not found' });
      }
      
      const groups = db.prepare('SELECT * FROM dwg_groups WHERE import_id = ?').all(req.params.import_id);
      const rawData = JSON.parse(imp.raw_json || '{}');
      
      res.json({
        import_id: imp.id,
        venue_id: imp.venue_id,
        filename: imp.filename,
        units: imp.units,
        unit_scale_to_m: imp.unit_scale_to_m,
        bounds: JSON.parse(imp.bounds_json || '{}'),
        status: imp.status,
        created_at: imp.created_at,
        fixtures: rawData.fixtures || [],
        layers: rawData.layers || [],
        groups: groups.map(g => ({
          group_id: g.group_id,
          layer: g.layer,
          block: g.block_name,
          count: g.count,
          size: { w: g.size_w, d: g.size_d },
          members: JSON.parse(g.members_json || '[]')
        }))
      });
      
    } catch (err) {
      console.error('Get import error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * GET /api/dwg/import/:import_id/prefilter-defaults
   * Returns the default prefilter configuration + the list of layers present
   * in the import (with per-layer totals). Used by the Prefilter Studio UI
   * to render sliders and the editable layer-blocklist.
   */
  router.get('/import/:import_id/prefilter-defaults', (req, res) => {
    try {
      const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(req.params.import_id);
      if (!imp) return res.status(404).json({ error: 'Import not found' });
      const rawData = JSON.parse(imp.raw_json || '{}');
      const originalFixtures = rawData.originalFixtures || rawData.fixtures || [];

      const layerTotals = {};
      for (const f of originalFixtures) {
        const layer = f.source?.layer || '(no-layer)';
        layerTotals[layer] = (layerTotals[layer] || 0) + 1;
      }

      res.json({
        import_id: req.params.import_id,
        unit_scale_to_m: imp.unit_scale_to_m,
        has_original_fixtures: !!rawData.originalFixtures,
        original_fixture_count: originalFixtures.length,
        defaults: {
          maxFixtureSizeM: PREFILTER_DEFAULTS.maxFixtureSizeM,
          maxPolylineSingletonSizeM: PREFILTER_DEFAULTS.maxPolylineSingletonSizeM,
          relativeSizePercentile: PREFILTER_DEFAULTS.relativeSizePercentile,
          relativeSizeMultiplier: PREFILTER_DEFAULTS.relativeSizeMultiplier,
          relativeSizeMaxDropFraction: PREFILTER_DEFAULTS.relativeSizeMaxDropFraction,
          madSpreads: PREFILTER_DEFAULTS.madSpreads,
          madMaxDropFraction: PREFILTER_DEFAULTS.madMaxDropFraction,
          clusterWindowM: PREFILTER_DEFAULTS.clusterWindowM,
          clusterMarginM: PREFILTER_DEFAULTS.clusterMarginM,
          clusterMinKeepFraction: PREFILTER_DEFAULTS.clusterMinKeepFraction,
          minFixtureSizeM: PREFILTER_DEFAULTS.minFixtureSizeM,
          layerBlocklist: PREFILTER_DEFAULTS.layerBlocklist.map(rx => ({
            pattern: rx.source,
            flags: rx.flags || 'i',
          })),
        },
        // Patterns that are NOT active by default but the Studio can
        // offer as one-click additions for aggressive cleanup.
        suggestedBlocklist: [
          { pattern: 'muratur', flags: 'i', label: 'Walls (murature)' },
          { pattern: 'pilastr', flags: 'i', label: 'Columns (pilastri)' },
          { pattern: 'tavolat', flags: 'i', label: 'Partitions (tavolati)' },
          { pattern: 'serrament', flags: 'i', label: 'Doors/Windows (serramenti)' },
          { pattern: '^0s-?epdm', flags: 'i', label: 'Roofing (EPDM)' },
          { pattern: 'prospetto', flags: 'i', label: 'Elevations (prospetto)' },
          { pattern: 'proiezion', flags: 'i', label: 'Projections (proiezioni)' },
          { pattern: 'contorno[-_ ]?retin', flags: 'i', label: 'Hatching borders' },
          { pattern: '^retini', flags: 'i', label: 'Hatching fills' },
          { pattern: 'segnaletica', flags: 'i', label: 'Signage' },
          { pattern: 'poligoni', flags: 'i', label: 'Polygon dumps' },
          { pattern: 'pavimentazion', flags: 'i', label: 'Paving' },
          { pattern: 'cordoli', flags: 'i', label: 'Curbs' },
          { pattern: 'parapett', flags: 'i', label: 'Railings' },
          { pattern: 'struttura[-_ ]?cement', flags: 'i', label: 'Structural concrete' },
          { pattern: 'sigillatur', flags: 'i', label: 'Sealants' },
          { pattern: 'viteri', flags: 'i', label: 'Hardware/fittings' },
          { pattern: 'caditoi', flags: 'i', label: 'Drains' },
          { pattern: 'confin', flags: 'i', label: 'Boundaries' },
          { pattern: 'riferiment', flags: 'i', label: 'Reference markers' },
          { pattern: 'catastal', flags: 'i', label: 'Cadastral' },
          { pattern: 'parcheggi', flags: 'i', label: 'Parking' },
          { pattern: 'cespugl', flags: 'i', label: 'Bushes/landscaping' },
          { pattern: 'alber', flags: 'i', label: 'Trees' },
        ],
        layer_totals: layerTotals,
      });
    } catch (err) {
      console.error('Prefilter defaults error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/dwg/import/:import_id/reprefilter — Re-run the geometric prefilter
   * on an existing import's raw fixtures (no re-upload required).
   *
   * Body (all optional):
   *   dryRun: boolean                       — compute only, don't write
   *   reset: boolean                        — restore originalFixtures AS-IS
   *                                           (all steps disabled, no filtering)
   *   maxFixtureSizeM, maxPolylineSingletonSizeM, minFixtureSizeM,
   *   madSpreads (array), madMaxDropFraction,
   *   clusterWindowM, clusterMarginM, clusterMinKeepFraction
   *   layerBlocklist: [{ pattern: string, flags?: string }, ...]
   *                                         — replaces the default blocklist
   *   enableLayerBlock, enableDegenerate, enableSizeCap,
   *   enablePolylineSingleton, enableMadOutlier, enableClusterPicker
   *                                         — per-step toggles (default true)
   */
  router.post('/import/:import_id/reprefilter', (req, res) => {
    try {
      const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(req.params.import_id);
      if (!imp) return res.status(404).json({ error: 'Import not found' });

      const rawData = JSON.parse(imp.raw_json || '{}');
      const rawFixtures = rawData.originalFixtures || rawData.fixtures || [];
      if (!Array.isArray(rawFixtures) || rawFixtures.length === 0) {
        return res.status(400).json({ error: 'No fixtures stored for this import' });
      }

      const dryRun = req.body?.dryRun === true;
      const reset = req.body?.reset === true;

      // Build prefilter options from the request body. Numeric fields and
      // array fields are passed through; step-toggles stay as booleans.
      const opts = {};
      for (const k of [
        'maxFixtureSizeM', 'maxPolylineSingletonSizeM', 'minFixtureSizeM',
        'madMaxDropFraction', 'clusterWindowM', 'clusterMarginM',
        'clusterMinKeepFraction',
        'relativeSizePercentile', 'relativeSizeMultiplier', 'relativeSizeMaxDropFraction',
      ]) {
        if (typeof req.body?.[k] === 'number') opts[k] = req.body[k];
      }
      if (Array.isArray(req.body?.madSpreads)) opts.madSpreads = req.body.madSpreads;
      if (Array.isArray(req.body?.layerBlocklist)) opts.layerBlocklist = req.body.layerBlocklist;
      for (const k of [
        'enableLayerBlock', 'enableDegenerate', 'enableSizeCap',
        'enableRelativeSizeOutlier',
        'enablePolylineSingleton', 'enableMadOutlier', 'enableClusterPicker',
      ]) {
        if (typeof req.body?.[k] === 'boolean') opts[k] = req.body[k];
      }

      // Reset mode disables every filter step → returns the full original set.
      if (reset) {
        opts.enableLayerBlock = false;
        opts.enableDegenerate = false;
        opts.enableSizeCap = false;
        opts.enableRelativeSizeOutlier = false;
        opts.enablePolylineSingleton = false;
        opts.enableMadOutlier = false;
        opts.enableClusterPicker = false;
      }

      const result = prefilterFixtures(rawFixtures, imp.unit_scale_to_m, opts);
      const groups = groupFixtures(result.fixtures);

      console.log(
        `[DWG Reprefilter ${req.params.import_id}] ` +
        `${rawFixtures.length} → ${result.fixtures.length} fixtures, ` +
        `${groups.length} groups (dryRun=${dryRun}, reset=${reset})`
      );

      if (!dryRun) {
        const newRaw = {
          ...rawData,
          originalFixtures: rawFixtures,
          originalBounds: rawData.originalBounds || null,
          fixtures: result.fixtures,
          prefilter: result.stats,
          prefilterOpts: {
            ...opts,
            reset: reset || undefined,
          },
        };
        const now = new Date().toISOString();

        const tx = db.transaction(() => {
          db.prepare(`
            UPDATE dwg_imports
            SET bounds_json = ?, raw_json = ?, updated_at = ?
            WHERE id = ?
          `).run(
            JSON.stringify(result.bounds),
            JSON.stringify(newRaw),
            now,
            req.params.import_id
          );

          db.prepare('DELETE FROM dwg_groups WHERE import_id = ?').run(req.params.import_id);
          const insertGroup = db.prepare(`
            INSERT INTO dwg_groups (id, import_id, group_id, layer, block_name, count, size_w, size_d, members_json, meta_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const g of groups) {
            insertGroup.run(
              uuidv4(), req.params.import_id, g.group_id,
              g.layer, g.block, g.count, g.size.w, g.size.d,
              JSON.stringify(g.members), JSON.stringify({}), now
            );
          }
        });
        tx();
      }

      // On dryRun also return the kept fixture IDs so the canvas can
      // render a diff (fixtures not in this set get the "dropped" style).
      const keptIds = dryRun ? result.fixtures.map(f => f.id) : null;

      res.json({
        import_id: req.params.import_id,
        dry_run: dryRun,
        reset,
        fixture_count: result.fixtures.length,
        group_count: groups.length,
        bounds: result.bounds,
        prefilter: result.stats,
        kept_fixture_ids: keptIds,
      });
    } catch (err) {
      console.error('Reprefilter error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/dwg/imports - List all imports
   */
  router.get('/imports', (req, res) => {
    try {
      // Get all imports
      const imports = db.prepare(`
        SELECT 
          di.id, di.venue_id, di.filename, di.units, di.status, di.created_at
        FROM dwg_imports di
        ORDER BY di.created_at DESC
      `).all();
      
      // Get all layouts with linked venue names
      const layouts = db.prepare(`
        SELECT 
          lv.id, lv.import_id, lv.name, lv.is_active, lv.created_at,
          v.id as venue_id, v.name as venue_name
        FROM dwg_layout_versions lv
        LEFT JOIN venues v ON v.dwg_layout_version_id = lv.id
        ORDER BY lv.created_at DESC
      `).all();
      
      // Group layouts by import_id
      const layoutsByImport = {};
      for (const lv of layouts) {
        if (!layoutsByImport[lv.import_id]) {
          layoutsByImport[lv.import_id] = [];
        }
        layoutsByImport[lv.import_id].push({
          id: lv.id,
          name: lv.name,
          venue_name: lv.venue_name || null,
          display_name: lv.venue_name || lv.name,
          is_active: !!lv.is_active,
          created_at: lv.created_at
        });
      }
      
      res.json(imports.map(imp => {
        const impLayouts = layoutsByImport[imp.id] || [];
        const activeLayout = impLayouts.find(l => l.is_active) || impLayouts[0] || null;
        return {
          import_id: imp.id,
          venue_id: imp.venue_id,
          filename: imp.filename,
          units: imp.units,
          status: imp.status,
          created_at: imp.created_at,
          layout_count: impLayouts.length,
          layouts: impLayouts,
          latest_layout_id: activeLayout?.id || null,
          latest_layout_name: activeLayout?.display_name || null,
          latest_layout_date: activeLayout?.created_at || null
        };
      }));
      
    } catch (err) {
      console.error('List imports error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * PUT /api/dwg/import/:import_id/mapping - Save mapping configuration
   */
  router.put('/import/:import_id/mapping', (req, res) => {
    try {
      const imp = db.prepare('SELECT id FROM dwg_imports WHERE id = ?').get(req.params.import_id);
      
      if (!imp) {
        return res.status(404).json({ error: 'Import not found' });
      }
      
      const mappingId = uuidv4();
      const now = new Date().toISOString();
      
      // Check if mapping exists
      const existingMapping = db.prepare('SELECT id FROM dwg_mappings WHERE import_id = ?').get(req.params.import_id);
      
      if (existingMapping) {
        db.prepare(`
          UPDATE dwg_mappings SET mapping_json = ?, updated_at = ? WHERE import_id = ?
        `).run(JSON.stringify(req.body), now, req.params.import_id);
      } else {
        db.prepare(`
          INSERT INTO dwg_mappings (id, import_id, mapping_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(mappingId, req.params.import_id, JSON.stringify(req.body), now, now);
      }
      
      res.json({ success: true, mapping_id: existingMapping?.id || mappingId });
      
    } catch (err) {
      console.error('Save mapping error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * GET /api/dwg/import/:import_id/mapping - Get mapping configuration
   */
  router.get('/import/:import_id/mapping', (req, res) => {
    try {
      const mapping = db.prepare('SELECT * FROM dwg_mappings WHERE import_id = ?').get(req.params.import_id);
      
      if (!mapping) {
        return res.json({ group_mappings: {} });
      }
      
      res.json(JSON.parse(mapping.mapping_json || '{}'));
      
    } catch (err) {
      console.error('Get mapping error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * POST /api/dwg/import/:import_id/generate - Generate layout
   */
  router.post('/import/:import_id/generate', (req, res) => {
    try {
      const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(req.params.import_id);
      
      if (!imp) {
        return res.status(404).json({ error: 'Import not found' });
      }
      
      const groups = db.prepare('SELECT * FROM dwg_groups WHERE import_id = ?').all(req.params.import_id);
      const mappingRow = db.prepare('SELECT * FROM dwg_mappings WHERE import_id = ?').get(req.params.import_id);
      
      const rawData = JSON.parse(imp.raw_json || '{}');
      const mapping = mappingRow ? JSON.parse(mappingRow.mapping_json || '{}') : { group_mappings: {} };
      
      // Get deleted fixture IDs and filter them out
      const deletedIds = new Set(JSON.parse(imp.deleted_fixture_ids_json || '[]'));
      const filteredFixtures = (rawData.fixtures || []).filter(f => !deletedIds.has(f.id));
      
      // Build import data with FILTERED fixtures (not raw)
      const importData = {
        fixtures: filteredFixtures,
        units: imp.units,
        unitScaleToM: imp.unit_scale_to_m,
        bounds: JSON.parse(imp.bounds_json || '{}'),
        groups: groups.map(g => ({
          group_id: g.group_id,
          layer: g.layer,
          block: g.block_name,
          count: g.count,
          size: { w: g.size_w, d: g.size_d },
          members: JSON.parse(g.members_json || '[]')
        }))
      };
      
      // Generate layout JSON
      const layoutJson = generateLayoutJson(importData, mapping);
      
      // ── SINGLE SOURCE OF TRUTH ──
      // Find ALL existing layout versions for this import.
      // Instead of creating a new layout each time (which splits enrichment data),
      // UPDATE the most recent one in-place so lidar_roi_json, camera views,
      // LiDAR instances, and ROIs all stay on the same row/ID.
      const allLayouts = db.prepare(
        'SELECT id, lidar_roi_json, camera_view_json, camera_view_2d_json FROM dwg_layout_versions WHERE import_id = ? ORDER BY created_at DESC'
      ).all(req.params.import_id);
      
      let layoutVersionId;
      const now = new Date().toISOString();
      
      if (allLayouts.length > 0) {
        // UPDATE the most recent layout in-place — preserves enrichment + keeps same ID
        const target = allLayouts[0];
        layoutVersionId = target.id;
        
        db.prepare(`
          UPDATE dwg_layout_versions 
          SET layout_json = ?, mapping_id = ?, venue_id = COALESCE(?, venue_id),
              name = COALESCE(?, name), is_active = 1
          WHERE id = ?
        `).run(
          JSON.stringify(layoutJson),
          mappingRow?.id || null,
          req.body.venue_id || imp.venue_id,
          req.body.name || null,
          target.id
        );
        console.log(`📦 Updated layout ${layoutVersionId.substring(0,8)} in-place (single source of truth)`);
        
        // Consolidate orphaned data from any older duplicate layouts
        const olderLayouts = allLayouts.slice(1);
        for (const old of olderLayouts) {
          // Migrate LiDAR instances
          const ml = db.prepare('UPDATE lidar_instances SET layout_version_id = ? WHERE layout_version_id = ?')
            .run(layoutVersionId, old.id);
          if (ml.changes > 0) console.log(`📦 Consolidated ${ml.changes} LiDAR instances from ${old.id.substring(0,8)}`);
          
          // Migrate ROIs
          const mr = db.prepare('UPDATE regions_of_interest SET dwg_layout_id = ? WHERE dwg_layout_id = ?')
            .run(layoutVersionId, old.id);
          if (mr.changes > 0) console.log(`📦 Consolidated ${mr.changes} ROIs from ${old.id.substring(0,8)}`);
          
          // Copy enrichment if target is missing it
          if (!target.lidar_roi_json && old.lidar_roi_json) {
            db.prepare('UPDATE dwg_layout_versions SET lidar_roi_json = ? WHERE id = ?').run(old.lidar_roi_json, layoutVersionId);
            target.lidar_roi_json = old.lidar_roi_json;
            console.log(`📦 Recovered lidar_roi_json from ${old.id.substring(0,8)}`);
          }
          if (!target.camera_view_json && old.camera_view_json) {
            db.prepare('UPDATE dwg_layout_versions SET camera_view_json = ? WHERE id = ?').run(old.camera_view_json, layoutVersionId);
            target.camera_view_json = old.camera_view_json;
          }
          if (!target.camera_view_2d_json && old.camera_view_2d_json) {
            db.prepare('UPDATE dwg_layout_versions SET camera_view_2d_json = ? WHERE id = ?').run(old.camera_view_2d_json, layoutVersionId);
            target.camera_view_2d_json = old.camera_view_2d_json;
          }
          
          // Deactivate old duplicate
          db.prepare('UPDATE dwg_layout_versions SET is_active = 0 WHERE id = ?').run(old.id);
        }
      } else {
        // First time — INSERT new layout version
        layoutVersionId = uuidv4();
        const sc = parseFloat(req.body.scale_correction) || 1.0;
        db.prepare(`
          INSERT INTO dwg_layout_versions (id, import_id, mapping_id, venue_id, name, layout_json, scale_correction, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          layoutVersionId,
          req.params.import_id,
          mappingRow?.id || null,
          req.body.venue_id || imp.venue_id,
          req.body.name || `Layout ${now}`,
          JSON.stringify(layoutJson),
          sc,
          1,
          now
        );
      }
      
      // Update import status
      db.prepare('UPDATE dwg_imports SET status = ?, updated_at = ? WHERE id = ?').run('generated', now, req.params.import_id);
      const updatedLayout = db.prepare('SELECT venue_id FROM dwg_layout_versions WHERE id = ?').get(layoutVersionId);
      
      res.json({
        layout_version_id: layoutVersionId,
        venue_id: updatedLayout?.venue_id || req.body.venue_id || imp.venue_id || null,
        previous_layout_id: allLayouts.length > 1 ? allLayouts[1].id : null,
        layout: layoutJson
      });
      
    } catch (err) {
      console.error('Generate layout error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * GET /api/dwg/layout/:layout_version_id - Get layout version
   */
  router.get('/layout/:layout_version_id', (req, res) => {
    try {
      const layout = db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(req.params.layout_version_id);
      
      if (!layout) {
        return res.status(404).json({ error: 'Layout version not found' });
      }
      
      const mapping = layout.mapping_id 
        ? db.prepare('SELECT mapping_json FROM dwg_mappings WHERE id = ?').get(layout.mapping_id)
        : null;
      
      const layoutData = JSON.parse(layout.layout_json || '{}');
      
      // Overlay CURRENT dwg_mappings on layout fixtures so 3D preview shows latest types
      if (layout.import_id && layoutData.fixtures?.length) {
        const liveMappingRow = db.prepare('SELECT mapping_json FROM dwg_mappings WHERE import_id = ?').get(layout.import_id);
        if (liveMappingRow?.mapping_json) {
          try {
            const liveMappings = JSON.parse(liveMappingRow.mapping_json);
            const groupMappings = liveMappings.group_mappings || {};
            if (Object.keys(groupMappings).length > 0) {
              layoutData.fixtures = layoutData.fixtures.map(f => {
                const liveMapping = groupMappings[f.group_id];
                if (liveMapping) {
                  return { ...f, mapping: liveMapping };
                }
                return f;
              });
            }
          } catch (e) { /* ignore parse errors */ }
        }
      }
      
      // Use stored_bounds if available (preserves original center for LiDAR positioning)
      if (layoutData.stored_bounds) {
        const sb = layoutData.stored_bounds;
        layoutData.bounds = {
          minX: sb.minX / layoutData.unit_scale_to_m,
          maxX: sb.maxX / layoutData.unit_scale_to_m,
          minY: sb.minY / layoutData.unit_scale_to_m,
          maxY: sb.maxY / layoutData.unit_scale_to_m
        };
        console.log('[DWG API] Using stored_bounds for center calculation');
      }
      
      // Also fetch ROI from regions_of_interest (DXF units — canonical source)
      let roiDxfVertices = null;
      try {
        const roiRow = db.prepare('SELECT vertices FROM regions_of_interest WHERE dwg_layout_id = ? LIMIT 1').get(layout.id);
        if (roiRow?.vertices) {
          roiDxfVertices = JSON.parse(roiRow.vertices);
        }
      } catch (e) { /* ignore */ }
      
      res.json({
        layout_version_id: layout.id,
        import_id: layout.import_id,
        venue_id: layout.venue_id,
        name: layout.name,
        is_active: !!layout.is_active,
        created_at: layout.created_at,
        layout: layoutData,
        mapping: mapping ? JSON.parse(mapping.mapping_json || '{}') : {},
        camera_view: layout.camera_view_json ? JSON.parse(layout.camera_view_json) : null,
        camera_view_2d: layout.camera_view_2d_json ? JSON.parse(layout.camera_view_2d_json) : null,
        lidar_roi: layout.lidar_roi_json ? JSON.parse(layout.lidar_roi_json) : null,
        lidar_roi_dxf: roiDxfVertices,
      });
      
    } catch (err) {
      console.error('Get layout error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * PATCH /api/dwg/layout/:layout_version_id - Rename a layout
   */
  router.patch('/layout/:layout_version_id', (req, res) => {
    try {
      const { name } = req.body;
      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
      }
      
      const layout = db.prepare('SELECT id FROM dwg_layout_versions WHERE id = ?').get(req.params.layout_version_id);
      if (!layout) {
        return res.status(404).json({ error: 'Layout not found' });
      }
      
      db.prepare('UPDATE dwg_layout_versions SET name = ? WHERE id = ?').run(name.trim(), req.params.layout_version_id);
      
      res.json({ success: true, name: name.trim() });
    } catch (err) {
      console.error('Rename layout error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * PATCH /api/dwg/layout/:layout_version_id/view - Save camera view / LiDAR ROI to DB
   */
  router.patch('/layout/:layout_version_id/view', (req, res) => {
    try {
      const { camera_view, camera_view_2d, lidar_roi, scale_correction } = req.body;
      const updates = [];
      const params = [];
      
      if (camera_view !== undefined) {
        updates.push('camera_view_json = ?');
        params.push(camera_view ? JSON.stringify(camera_view) : null);
      }
      if (camera_view_2d !== undefined) {
        updates.push('camera_view_2d_json = ?');
        params.push(camera_view_2d ? JSON.stringify(camera_view_2d) : null);
      }
      if (lidar_roi !== undefined) {
        updates.push('lidar_roi_json = ?');
        params.push(lidar_roi ? JSON.stringify(lidar_roi) : null);
      }
      if (scale_correction !== undefined && typeof scale_correction === 'number') {
        updates.push('scale_correction = ?');
        params.push(scale_correction);
        console.log(`[DWG View] Saving scale_correction=${scale_correction} for layout ${req.params.layout_version_id}`);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No view data provided' });
      }
      
      params.push(req.params.layout_version_id);
      db.prepare(`UPDATE dwg_layout_versions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      
      res.json({ success: true });
    } catch (err) {
      console.error('Save view error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/dwg/import/:import_id/layouts - List layouts for an import
   * Auto-consolidates duplicate layouts: migrates LiDAR instances, ROIs,
   * and enrichment columns to the most recent layout, deactivates the rest.
   */
  router.get('/import/:import_id/layouts', (req, res) => {
    try {
      const layouts = db.prepare(`
        SELECT id, import_id, venue_id, name, is_active, created_at,
               lidar_roi_json, camera_view_json, camera_view_2d_json
        FROM dwg_layout_versions 
        WHERE import_id = ?
        ORDER BY created_at DESC
      `).all(req.params.import_id);
      
      // Auto-consolidate if duplicate layouts exist
      if (layouts.length > 1) {
        const target = layouts[0];
        const others = layouts.slice(1);
        let consolidated = false;
        
        for (const old of others) {
          // Migrate LiDAR instances from old → target
          const ml = db.prepare('UPDATE lidar_instances SET layout_version_id = ? WHERE layout_version_id = ?')
            .run(target.id, old.id);
          if (ml.changes > 0) {
            console.log(`🔄 Auto-consolidated ${ml.changes} LiDAR instances from ${old.id.substring(0,8)} → ${target.id.substring(0,8)}`);
            consolidated = true;
          }
          
          // Migrate ROIs from old → target
          const mr = db.prepare('UPDATE regions_of_interest SET dwg_layout_id = ? WHERE dwg_layout_id = ?')
            .run(target.id, old.id);
          if (mr.changes > 0) {
            console.log(`🔄 Auto-consolidated ${mr.changes} ROIs from ${old.id.substring(0,8)} → ${target.id.substring(0,8)}`);
            consolidated = true;
          }
          
          // Copy enrichment columns if target is missing them
          if (!target.lidar_roi_json && old.lidar_roi_json) {
            db.prepare('UPDATE dwg_layout_versions SET lidar_roi_json = ? WHERE id = ?').run(old.lidar_roi_json, target.id);
            target.lidar_roi_json = old.lidar_roi_json;
            console.log(`🔄 Recovered lidar_roi_json from ${old.id.substring(0,8)}`);
            consolidated = true;
          }
          if (!target.camera_view_json && old.camera_view_json) {
            db.prepare('UPDATE dwg_layout_versions SET camera_view_json = ? WHERE id = ?').run(old.camera_view_json, target.id);
            target.camera_view_json = old.camera_view_json;
            consolidated = true;
          }
          if (!target.camera_view_2d_json && old.camera_view_2d_json) {
            db.prepare('UPDATE dwg_layout_versions SET camera_view_2d_json = ? WHERE id = ?').run(old.camera_view_2d_json, target.id);
            target.camera_view_2d_json = old.camera_view_2d_json;
            consolidated = true;
          }
          
          // Deactivate old duplicate
          if (old.is_active) {
            db.prepare('UPDATE dwg_layout_versions SET is_active = 0 WHERE id = ?').run(old.id);
          }
        }
        
        // Ensure target is active
        if (!target.is_active) {
          db.prepare('UPDATE dwg_layout_versions SET is_active = 1 WHERE id = ?').run(target.id);
        }
        
        if (consolidated) {
          console.log(`🔄 Layout consolidation complete for import ${req.params.import_id.substring(0,8)}: ${layouts.length} → 1 active layout`);
        }
      }
      
      res.json(layouts.map(l => ({
        id: l.id,
        import_id: l.import_id,
        venue_id: l.venue_id,
        name: l.name,
        is_active: !!l.is_active,
        created_at: l.created_at
      })));
      
    } catch (err) {
      console.error('List import layouts error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/dwg/layouts - List layout versions for venue
   */
  router.get('/layouts', (req, res) => {
    try {
      const { venue_id } = req.query;
      
      let layouts;
      if (venue_id) {
        layouts = db.prepare(`
          SELECT lv.id, lv.import_id, lv.venue_id, lv.name, lv.is_active, lv.created_at,
                 di.filename as import_filename
          FROM dwg_layout_versions lv
          LEFT JOIN dwg_imports di ON lv.import_id = di.id
          WHERE lv.venue_id = ?
          ORDER BY lv.created_at DESC
        `).all(venue_id);
      } else {
        layouts = db.prepare(`
          SELECT lv.id, lv.import_id, lv.venue_id, lv.name, lv.is_active, lv.created_at,
                 di.filename as import_filename
          FROM dwg_layout_versions lv
          LEFT JOIN dwg_imports di ON lv.import_id = di.id
          ORDER BY lv.created_at DESC
        `).all();
      }
      
      res.json(layouts.map(l => ({
        id: l.id,
        layout_version_id: l.id,
        import_id: l.import_id,
        venue_id: l.venue_id,
        name: l.name,
        dwg_filename: l.import_filename || null,
        is_active: !!l.is_active,
        created_at: l.created_at
      })));
      
    } catch (err) {
      console.error('List layouts error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * PATCH /api/dwg/import/:import_id - Update import metadata (filename)
   */
  router.patch('/import/:import_id', (req, res) => {
    try {
      const { filename } = req.body;
      
      if (!filename || !filename.trim()) {
        return res.status(400).json({ error: 'Filename is required' });
      }
      
      const now = new Date().toISOString();
      const result = db.prepare('UPDATE dwg_imports SET filename = ?, updated_at = ? WHERE id = ?')
        .run(filename.trim(), now, req.params.import_id);
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Import not found' });
      }
      
      res.json({ success: true, filename: filename.trim() });
      
    } catch (err) {
      console.error('Update import error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * DELETE /api/dwg/import/:import_id - Delete import
   */
  router.delete('/import/:import_id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM dwg_imports WHERE id = ?').run(req.params.import_id);
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Import not found' });
      }
      
      res.json({ success: true });
      
    } catch (err) {
      console.error('Delete import error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * GET /api/dwg/import/:import_id/deleted-fixtures - Get deleted fixture IDs
   */
  router.get('/import/:import_id/deleted-fixtures', (req, res) => {
    try {
      const row = db.prepare('SELECT deleted_fixture_ids_json, custom_names_json FROM dwg_imports WHERE id = ?').get(req.params.import_id);
      if (!row) {
        return res.status(404).json({ error: 'Import not found' });
      }
      res.json({
        deleted_fixture_ids: JSON.parse(row.deleted_fixture_ids_json || '[]'),
        custom_names: JSON.parse(row.custom_names_json || '{}')
      });
    } catch (err) {
      console.error('Get deleted fixtures error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/dwg/import/:import_id/deleted-fixtures - Save deleted fixture IDs
   */
  router.put('/import/:import_id/deleted-fixtures', (req, res) => {
    try {
      const { deleted_fixture_ids, custom_names } = req.body;
      
      const updates = [];
      const params = [];
      
      if (deleted_fixture_ids !== undefined) {
        updates.push('deleted_fixture_ids_json = ?');
        params.push(JSON.stringify(deleted_fixture_ids));
      }
      if (custom_names !== undefined) {
        updates.push('custom_names_json = ?');
        params.push(JSON.stringify(custom_names));
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ error: 'No data to update' });
      }
      
      params.push(req.params.import_id);
      const result = db.prepare(`UPDATE dwg_imports SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Import not found' });
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error('Save deleted fixtures error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/dwg/layout/:layout_version_id - Delete layout version
   */
  router.delete('/layout/:layout_version_id', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM dwg_layout_versions WHERE id = ?').run(req.params.layout_version_id);
      
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Layout version not found' });
      }
      
      res.json({ success: true });
      
    } catch (err) {
      console.error('Delete layout error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * GET /api/dwg/catalog - Get available catalog assets
   */
  router.get('/catalog', (req, res) => {
    try {
      // Get custom models from existing system
      const customModels = db.prepare('SELECT * FROM custom_models').all();
      const userAssets = db.prepare(`
        SELECT id, name, type, color, created_at, updated_at
        FROM dwg_catalog_assets
        ORDER BY name ASC
      `).all();
      
      // Build catalog from existing object types + custom models
      const catalog = [
        { id: 'shelf', name: 'Shelf', type: 'shelf', color: '#6366f1', hasCustomModel: false },
        { id: 'fridge', name: 'Fridge', type: 'fridge', color: '#22d3ee', hasCustomModel: false },
        { id: 'wall', name: 'Wall', type: 'wall', color: '#64748b', hasCustomModel: false },
        { id: 'checkout', name: 'Checkout', type: 'checkout', color: '#22c55e', hasCustomModel: false },
        { id: 'entrance', name: 'Entrance', type: 'entrance', color: '#f59e0b', hasCustomModel: false },
        { id: 'pillar', name: 'Pillar', type: 'pillar', color: '#78716c', hasCustomModel: false },
        { id: 'digital_display', name: 'Digital Display', type: 'digital_display', color: '#3b82f6', hasCustomModel: false },
        { id: 'radio', name: 'Radio', type: 'radio', color: '#ef4444', hasCustomModel: false },
        { id: 'custom', name: 'Custom', type: 'custom', color: '#8b5cf6', hasCustomModel: false }
      ];

      for (const asset of userAssets) {
        const existing = catalog.find(c => c.type === asset.type);
        if (existing) {
          if (asset.color) existing.color = asset.color;
        } else {
          catalog.push({
            id: asset.type,
            name: asset.name,
            type: asset.type,
            color: asset.color || '#8b5cf6',
            hasCustomModel: false,
            isUserAsset: true,
          });
        }
      }
      
      // Mark which have custom models and include model-only custom types.
      for (const model of customModels) {
        const item = catalog.find(c => c.type === model.object_type);
        if (item) {
          item.hasCustomModel = true;
          item.modelPath = model.file_path;
        } else {
          catalog.push({
            id: model.object_type,
            name: model.object_type.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            type: model.object_type,
            color: '#8b5cf6',
            hasCustomModel: true,
            modelPath: model.file_path,
            isUserAsset: true,
          });
        }
      }

      res.json(catalog.sort((a, b) => a.name.localeCompare(b.name)));
      
    } catch (err) {
      console.error('Get catalog error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * POST /api/dwg/catalog - Create a globally available 3D asset type
   */
  router.post('/catalog', (req, res) => {
    try {
      const { name, type, color } = req.body || {};
      const cleanName = String(name || '').trim();
      const cleanType = String(type || cleanName)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

      if (!cleanName || !cleanType) {
        return res.status(400).json({ error: 'Asset name is required' });
      }

      const builtInTypes = new Set(['shelf', 'fridge', 'wall', 'checkout', 'entrance', 'pillar', 'digital_display', 'radio', 'custom']);
      if (!builtInTypes.has(cleanType)) {
        db.prepare(`
          INSERT INTO dwg_catalog_assets (id, name, type, color, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(type) DO UPDATE SET
            name = excluded.name,
            color = COALESCE(excluded.color, dwg_catalog_assets.color),
            updated_at = datetime('now')
        `).run(cleanType, cleanName, cleanType, color || null);
      }

      const customModel = db.prepare('SELECT * FROM custom_models WHERE object_type = ?').get(cleanType);
      res.status(201).json({
        id: cleanType,
        name: cleanName,
        type: cleanType,
        color: color || '#8b5cf6',
        hasCustomModel: !!customModel,
        modelPath: customModel?.file_path,
        isUserAsset: !builtInTypes.has(cleanType),
      });
    } catch (err) {
      console.error('Create catalog asset error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PATCH /api/dwg/catalog/:type - Update catalog asset display settings
   */
  router.patch('/catalog/:type', (req, res) => {
    try {
      const cleanType = String(req.params.type || '').trim().toLowerCase();
      const { color, name } = req.body || {};
      const cleanName = String(name || cleanType).trim();

      if (!cleanType) {
        return res.status(400).json({ error: 'Asset type is required' });
      }
      if (color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(String(color))) {
        return res.status(400).json({ error: 'Color must be a hex value like #22c55e' });
      }

      db.prepare(`
        INSERT INTO dwg_catalog_assets (id, name, type, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(type) DO UPDATE SET
          name = COALESCE(excluded.name, dwg_catalog_assets.name),
          color = COALESCE(excluded.color, dwg_catalog_assets.color),
          updated_at = datetime('now')
      `).run(cleanType, cleanName, cleanType, color || null);

      const customModel = db.prepare('SELECT * FROM custom_models WHERE object_type = ?').get(cleanType);
      res.json({
        id: cleanType,
        name: cleanName,
        type: cleanType,
        color: color || null,
        hasCustomModel: !!customModel,
        modelPath: customModel?.file_path,
        isUserAsset: true,
      });
    } catch (err) {
      console.error('Update catalog asset error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * PATCH /api/dwg/layout/:layoutId/fixture/:fixtureId - Update fixture properties
   * Supports: position (x, z), dimensions (width, depth, height), rotation, name, type
   */
  router.patch('/layout/:layoutId/fixture/:fixtureId', (req, res) => {
    try {
      const { layoutId, fixtureId } = req.params;
      const updates = req.body;
      
      // Get the layout
      const layout = db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(layoutId);
      if (!layout) {
        return res.status(404).json({ error: 'Layout not found' });
      }
      
      const layoutData = JSON.parse(layout.layout_json);
      const unitScale = layoutData.unit_scale_to_m;
      
      // Calculate center offset (same as MainViewport)
      let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity, fMaxY = -Infinity;
      layoutData.fixtures.forEach(f => {
        const { footprint, pose2d } = f;
        const points = footprint?.points || [];
        if (points.length > 0) {
          points.forEach(pt => {
            fMinX = Math.min(fMinX, pt.x);
            fMaxX = Math.max(fMaxX, pt.x);
            fMinY = Math.min(fMinY, pt.y);
            fMaxY = Math.max(fMaxY, pt.y);
          });
        } else if (pose2d) {
          const hw = (footprint?.w || 1000) / 2;
          const hd = (footprint?.d || 1000) / 2;
          fMinX = Math.min(fMinX, pose2d.x - hw);
          fMaxX = Math.max(fMaxX, pose2d.x + hw);
          fMinY = Math.min(fMinY, pose2d.y - hd);
          fMaxY = Math.max(fMaxY, pose2d.y + hd);
        }
      });
      const centerX = ((fMinX + fMaxX) / 2) * unitScale;
      const centerZ = ((fMinY + fMaxY) / 2) * unitScale;
      
      // Find the fixture
      const fixtureIndex = layoutData.fixtures.findIndex(f => f.id === fixtureId);
      if (fixtureIndex === -1) {
        return res.status(404).json({ error: 'Fixture not found' });
      }
      
      const fixture = layoutData.fixtures[fixtureIndex];
      
      // Apply updates
      if (updates.position) {
        // Position update from RightPanel - need to handle polygon fixtures
        const newDwgX = (updates.position.x + centerX) / unitScale;
        const newDwgY = (updates.position.z + centerZ) / unitScale;
        
        if (fixture.footprint.points && fixture.footprint.points.length > 0) {
          // For polygon fixtures, calculate current center and shift all points
          const pts = fixture.footprint.points;
          const oldCenterX = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
          const oldCenterY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
          const dx = newDwgX - oldCenterX;
          const dy = newDwgY - oldCenterY;
          
          // Shift all points
          fixture.footprint.points = pts.map(p => ({
            x: p.x + dx,
            y: p.y + dy
          }));
          console.log(`[DWG API] Position edit: Shifted ${pts.length} points by (${dx.toFixed(0)}, ${dy.toFixed(0)})`);
        }
        
        // Also update pose2d for consistency
        fixture.pose2d.x = newDwgX;
        fixture.pose2d.y = newDwgY;
      }
      
      if (updates.x !== undefined && updates.z !== undefined) {
        // Position update from drag - need to handle polygon fixtures
        const newDwgX = (updates.x + centerX) / unitScale;
        const newDwgY = (updates.z + centerZ) / unitScale;
        
        if (fixture.footprint.points && fixture.footprint.points.length > 0) {
          // For polygon fixtures, calculate current center and shift all points
          const pts = fixture.footprint.points;
          const oldCenterX = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
          const oldCenterY = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
          const dx = newDwgX - oldCenterX;
          const dy = newDwgY - oldCenterY;
          
          // Shift all points
          fixture.footprint.points = pts.map(p => ({
            x: p.x + dx,
            y: p.y + dy
          }));
          console.log(`[DWG API] Shifted ${pts.length} points by (${dx.toFixed(0)}, ${dy.toFixed(0)})`);
        }
        
        // Also update pose2d for consistency
        fixture.pose2d.x = newDwgX;
        fixture.pose2d.y = newDwgY;
      }
      
      if (updates.width !== undefined) {
        fixture.footprint.w = updates.width / unitScale;
        // Clear points so renderer uses w/d instead
        if (fixture.footprint.points) {
          delete fixture.footprint.points;
          fixture.footprint.kind = 'rect';
        }
      }
      
      if (updates.depth !== undefined) {
        fixture.footprint.d = updates.depth / unitScale;
        // Clear points so renderer uses w/d instead
        if (fixture.footprint.points) {
          delete fixture.footprint.points;
          fixture.footprint.kind = 'rect';
        }
      }
      
      if (updates.height !== undefined) {
        // Height is derived, store as custom property
        fixture.customHeight = updates.height;
      }
      
      if (updates.rotation !== undefined) {
        // Convert radians to degrees
        fixture.pose2d.rot_deg = updates.rotation * 180 / Math.PI;
      }
      
      if (updates.name !== undefined) {
        fixture.name = updates.name;
      }
      
      if (updates.type !== undefined) {
        if (!fixture.mapping) fixture.mapping = {};
        fixture.mapping.type = updates.type;
      }
      
      // Save back to database
      db.prepare('UPDATE dwg_layout_versions SET layout_json = ? WHERE id = ?')
        .run(JSON.stringify(layoutData), layoutId);
      
      res.json({ 
        success: true, 
        fixtureId,
        updates
      });
      
    } catch (err) {
      console.error('Update fixture error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/dwg/layout/:layoutVersionId/as-venue-bootstrap - Convert DWG layout to venue-ready payload
   * This is a STATELESS endpoint - it does NOT create venues or save objects.
   * It only converts DWG data into standard VenueObject format.
   */
  router.get('/layout/:layoutVersionId/as-venue-bootstrap', (req, res) => {
    try {
      const { layoutVersionId } = req.params;
      
      // Get the layout
      const layout = db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(layoutVersionId);
      if (!layout) {
        return res.status(404).json({ error: 'Layout version not found' });
      }
      
      // Read scaleCorrection: DB (authoritative) > query param (fallback) > 1.0 (default)
      const dbScaleCorrection = layout.scale_correction;
      const queryScaleCorrection = parseFloat(req.query.scaleCorrection) || 1.0;
      const scaleCorrection = (dbScaleCorrection && dbScaleCorrection !== 1.0) ? dbScaleCorrection : queryScaleCorrection;
      console.log(`[DWG Bootstrap] scaleCorrection: db=${dbScaleCorrection}, query=${queryScaleCorrection}, using=${scaleCorrection}`);
      
      // Write back used scaleCorrection to layout DB if it differs (self-healing)
      if (scaleCorrection !== 1.0 && scaleCorrection !== dbScaleCorrection) {
        db.prepare('UPDATE dwg_layout_versions SET scale_correction = ? WHERE id = ?').run(scaleCorrection, layoutVersionId);
        console.log(`[DWG Bootstrap] Wrote back scale_correction=${scaleCorrection} to layout ${layoutVersionId}`);
      }
      
      const layoutData = JSON.parse(layout.layout_json || '{}');
      let fixtures = layoutData.fixtures || [];
      const unitScale = layoutData.unit_scale_to_m || 0.001;
      
      // Overlay CURRENT dwg_mappings on top of stale layout_json fixture types
      // This ensures bootstrap always uses the latest classifications from DWG Importer
      if (layout.import_id) {
        const mappingRow = db.prepare('SELECT mapping_json FROM dwg_mappings WHERE import_id = ?').get(layout.import_id);
        if (mappingRow?.mapping_json) {
          try {
            const currentMappings = JSON.parse(mappingRow.mapping_json);
            const groupMappings = currentMappings.group_mappings || {};
            if (Object.keys(groupMappings).length > 0) {
              fixtures = fixtures.map(f => {
                const liveMapping = groupMappings[f.group_id];
                if (liveMapping) {
                  return { ...f, mapping: liveMapping };
                }
                return f;
              });
              console.log(`[DWG Bootstrap] Overlaid ${Object.keys(groupMappings).length} live dwg_mappings on ${fixtures.length} fixtures`);
            }
          } catch (e) {
            console.warn('[DWG Bootstrap] Failed to parse dwg_mappings:', e.message);
          }
        }
      }
      
      // Get LiDAR instances for this layout
      const lidarInstances = db.prepare('SELECT * FROM lidar_instances WHERE layout_version_id = ?').all(layoutVersionId);
      const lidarModels = db.prepare('SELECT * FROM lidar_models').all();
      const modelMap = new Map(lidarModels.map(m => [m.id, m]));
      const defaultTypeColors = {
        shelf: '#6366f1',
        fridge: '#22d3ee',
        wall: '#64748b',
        checkout: '#22c55e',
        entrance: '#f59e0b',
        pillar: '#78716c',
        digital_display: '#3b82f6',
        radio: '#ef4444',
        custom: '#8b5cf6',
      };
      const catalogColorRows = db.prepare('SELECT type, color FROM dwg_catalog_assets WHERE color IS NOT NULL').all();
      const catalogColors = new Map(Object.entries(defaultTypeColors));
      catalogColorRows.forEach(row => catalogColors.set(row.type, row.color));
      
      // Venue geometry must stay in real meters. The LiDAR/autoplace scale correction
      // is kept separate so it cannot make manual venue objects appear 10x too small.
      console.log(`[DWG Bootstrap] unitScale=${unitScale}, scaleCorrection=${scaleCorrection} (geometry uses unitScale)`);
      const effectiveScale = unitScale;
      const lidarScaleCorrection = scaleCorrection || 1.0;
      
      // Use RAW DWG bounds for center offset (SAME as Layout3DPreview)
      const rawBounds = layoutData.bounds || { minX: 0, maxX: 20000, minY: 0, maxY: 15000 };
      const centerX = ((rawBounds.minX + rawBounds.maxX) / 2) * effectiveScale;
      const centerZ = ((rawBounds.minY + rawBounds.maxY) / 2) * effectiveScale;
      
      console.log(`[DWG Bootstrap] Raw bounds: minX=${rawBounds.minX}, maxX=${rawBounds.maxX}, minY=${rawBounds.minY}, maxY=${rawBounds.maxY}`);
      console.log(`[DWG Bootstrap] Center offset: ${centerX.toFixed(3)}, ${centerZ.toFixed(3)}`);
      
      // ── ROI-AWARE VENUE SIZING + SPATIAL FILTER ──
      const roiJson = layout.lidar_roi_json;
      let roiVertices = null;
      if (roiJson) {
        try {
          roiVertices = typeof roiJson === 'string' ? JSON.parse(roiJson) : roiJson;
          if (!Array.isArray(roiVertices) || roiVertices.length < 3) roiVertices = null;
        } catch (e) { roiVertices = null; }
      }
      
      // DEBUG: Log ROI source for debugging LaunchPad issues
      if (roiVertices) {
        const xs = roiVertices.map(v => v.x);
        const zs = roiVertices.map(v => v.z);
        console.log(`[DWG Bootstrap] ✓ lidar_roi_json found: ${roiVertices.length} vertices, bounds X[${Math.min(...xs).toFixed(1)}, ${Math.max(...xs).toFixed(1)}] Z[${Math.min(...zs).toFixed(1)}, ${Math.max(...zs).toFixed(1)}] METERS`);
      } else {
        console.log(`[DWG Bootstrap] ✗ lidar_roi_json is NULL — will fall back to fixture bounds for venue sizing`);
      }
      
      // Also fetch ROI in DXF units from regions_of_interest (for spatial filtering)
      let roiDxfVertices = null;
      try {
        const roiRow = db.prepare('SELECT vertices FROM regions_of_interest WHERE dwg_layout_id = ? LIMIT 1').get(layoutVersionId);
        if (roiRow?.vertices) {
          const parsed = typeof roiRow.vertices === 'string' ? JSON.parse(roiRow.vertices) : roiRow.vertices;
          if (Array.isArray(parsed) && parsed.length >= 3) {
            roiDxfVertices = parsed;
            // DEBUG: Log DXF ROI bounds
            const xs = roiDxfVertices.map(v => v.x);
            const zs = roiDxfVertices.map(v => v.z || v.y || 0);
            console.log(`[DWG Bootstrap] ✓ regions_of_interest found: ${roiDxfVertices.length} vertices, bounds X[${Math.min(...xs).toFixed(0)}, ${Math.max(...xs).toFixed(0)}] Z[${Math.min(...zs).toFixed(0)}, ${Math.max(...zs).toFixed(0)}] DXF UNITS`);
          }
        }
      } catch (e) { /* ignore */ }
      
      // Point-in-polygon test for ROI spatial filtering
      function pointInPolygon(px, py, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const xi = polygon[i].x, yi = polygon[i].z || polygon[i].y || 0;
          const xj = polygon[j].x, yj = polygon[j].z || polygon[j].y || 0;
          if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
            inside = !inside;
          }
        }
        return inside;
      }
      
      // Spatial ROI filter: keep only fixtures inside the ROI polygon
      if (roiDxfVertices && roiDxfVertices.length >= 3) {
        const beforeFilter = fixtures.length;
        fixtures = fixtures.filter(f => {
          const points = f.footprint?.points || [];
          let fx, fy;
          if (points.length >= 3) {
            fx = points.reduce((s, p) => s + p.x, 0) / points.length;
            fy = points.reduce((s, p) => s + p.y, 0) / points.length;
          } else if (f.pose2d) {
            fx = f.pose2d.x;
            fy = f.pose2d.y;
          } else {
            return false;
          }
          return pointInPolygon(fx, fy, roiDxfVertices);
        });
        console.log(`[DWG Bootstrap] ROI spatial filter: ${beforeFilter} → ${fixtures.length} fixtures (inside ROI polygon)`);
      } else if (roiVertices) {
        // Fallback: filter using meter-space ROI vertices
        const beforeFilter = fixtures.length;
        fixtures = fixtures.filter(f => {
          const points = f.footprint?.points || [];
          let fx, fy;
          if (points.length >= 3) {
            fx = points.reduce((s, p) => s + p.x, 0) / points.length * effectiveScale;
            fy = points.reduce((s, p) => s + p.y, 0) / points.length * effectiveScale;
          } else if (f.pose2d) {
            fx = f.pose2d.x * effectiveScale;
            fy = f.pose2d.y * effectiveScale;
          } else {
            return false;
          }
          // roiVertices are {x, z} in meters
          return pointInPolygon(fx, fy, roiVertices.map(v => ({ x: v.x, z: v.z })));
        });
        console.log(`[DWG Bootstrap] ROI spatial filter (meters): ${beforeFilter} → ${fixtures.length} fixtures`);
      }
      
      // Calculate content bounds from fixtures using P1/P99 percentile (robust to outliers)
      const allXs = [];
      const allYs = [];
      fixtures.forEach(f => {
        const { footprint, pose2d } = f;
        const points = footprint?.points || [];
        if (points.length > 0) {
          points.forEach(pt => { allXs.push(pt.x); allYs.push(pt.y); });
        } else if (pose2d) {
          const hw = (footprint?.w || 1000) / 2;
          const hd = (footprint?.d || 1000) / 2;
          allXs.push(pose2d.x - hw, pose2d.x + hw);
          allYs.push(pose2d.y - hd, pose2d.y + hd);
        }
      });
      let fMinX, fMaxX, fMinY, fMaxY;
      if (allXs.length === 0) {
        fMinX = 0; fMaxX = 20000; fMinY = 0; fMaxY = 15000;
      } else {
        allXs.sort((a, b) => a - b);
        allYs.sort((a, b) => a - b);
        const n = allXs.length;
        const loIdx = Math.floor(n * 0.01);
        const hiIdx = Math.min(n - 1, Math.floor(n * 0.99));
        fMinX = allXs[loIdx]; fMaxX = allXs[hiIdx];
        fMinY = allYs[loIdx]; fMaxY = allYs[hiIdx];
        console.log(`[DWG Bootstrap] Percentile bounds P1/P99 (n=${n}): X [${fMinX.toFixed(1)}, ${fMaxX.toFixed(1)}] Y [${fMinY.toFixed(1)}, ${fMaxY.toFixed(1)}]`);
      }
      
      const padding = 4; // 4m padding on each side
      let venueWidth, venueDepth;
      
      if (roiDxfVertices && roiDxfVertices.length >= 3) {
        // Use DXF ROI bounds converted with geometry scale. lidar_roi_json may have
        // been saved with LiDAR scale correction and can be 10x too large.
        const roiXs = roiDxfVertices.map(v => v.x * effectiveScale);
        const roiZs = roiDxfVertices.map(v => (v.z || v.y || 0) * effectiveScale);
        const roiWidth = Math.max(...roiXs) - Math.min(...roiXs);
        const roiDepth = Math.max(...roiZs) - Math.min(...roiZs);
        venueWidth = Math.ceil(roiWidth + padding * 2);
        venueDepth = Math.ceil(roiDepth + padding * 2);
        console.log(`[DWG Bootstrap] Using DXF ROI bounds: ${roiWidth.toFixed(1)}m × ${roiDepth.toFixed(1)}m → venue ${venueWidth}m × ${venueDepth}m`);
      } else if (roiVertices) {
        // Fallback for older layouts that only have meter-space ROI vertices.
        const roiXs = roiVertices.map(v => v.x);
        const roiZs = roiVertices.map(v => v.z);
        const roiWidth = Math.max(...roiXs) - Math.min(...roiXs);
        const roiDepth = Math.max(...roiZs) - Math.min(...roiZs);
        venueWidth = Math.ceil(roiWidth + padding * 2);
        venueDepth = Math.ceil(roiDepth + padding * 2);
        console.log(`[DWG Bootstrap] Using ROI bounds: ${roiWidth.toFixed(1)}m × ${roiDepth.toFixed(1)}m → venue ${venueWidth}m × ${venueDepth}m`);
      } else {
        // Fallback: compute from filtered fixture bounds
        const contentWidth = (fMaxX - fMinX) * effectiveScale;
        const contentDepth = (fMaxY - fMinY) * effectiveScale;
        venueWidth = Math.ceil(contentWidth + padding * 2);
        venueDepth = Math.ceil(contentDepth + padding * 2);
        console.log(`[DWG Bootstrap] No ROI — using fixture bounds: ${contentWidth.toFixed(1)}m × ${contentDepth.toFixed(1)}m → venue ${venueWidth}m × ${venueDepth}m`);
      }
      
      // Content center offset (where objects are centered after DWG transform)
      // MUST match Layout3DPreview.tsx: positions = DXF * effectiveScale - centerX
      const contentCenterX = ((fMinX + fMaxX) / 2) * effectiveScale - centerX;
      const contentCenterZ = ((fMinY + fMaxY) / 2) * effectiveScale - centerZ;
      
      // ── TYPE-BASED FILTERING ──
      // Remove noise fixture types that clutter the 3D scene (same as Layout3DPreview)
      const HIDDEN_TYPES = new Set(['pillar', 'entrance']);
      const HIDDEN_GROUPS = new Set(['grp_8c6e7b', 'grp_1867a6', 'grp_915c41', 'grp_aba5ea']);
      const beforeTypeFilter = fixtures.length;
      fixtures = fixtures.filter(f => {
        const type = f.mapping?.type;
        if (type && HIDDEN_TYPES.has(type)) return false;
        if (f.group_id && HIDDEN_GROUPS.has(f.group_id)) return false;
        return true;
      });
      if (beforeTypeFilter !== fixtures.length) {
        console.log(`[DWG Bootstrap] Type filter: ${beforeTypeFilter} → ${fixtures.length} fixtures (removed pillar/entrance/oversized)`);
      }

      // NOTE: No junk filter — match Layout3DPreview behavior exactly.
      // Layout3DPreview renders all non-hidden fixtures without area/name filtering.

      // Venue floor center and shift to position objects correctly
      const venueFloorCenterX = venueWidth / 2;
      const venueFloorCenterZ = venueDepth / 2;
      const shiftX = venueFloorCenterX - contentCenterX;
      const shiftZ = venueFloorCenterZ - contentCenterZ;
      
      console.log(`[DWG Bootstrap] Content center: (${contentCenterX.toFixed(2)}, ${contentCenterZ.toFixed(2)})`);
      console.log(`[DWG Bootstrap] Venue floor center: (${venueFloorCenterX.toFixed(2)}, ${venueFloorCenterZ.toFixed(2)})`);
      console.log(`[DWG Bootstrap] Shift offset: (${shiftX.toFixed(2)}, ${shiftZ.toFixed(2)})`);

      // Convert DWG floor-plane coordinates to venue/world coordinates.
      // X keeps the same sign. DWG Y must be flipped into Three.js Z so the
      // 3D venue matches the 2-D preview orientation exactly.
      const dxfToVenueWorld = (xDxf, yDxf) => ({
        x: venueFloorCenterX + ((xDxf * effectiveScale - centerX) - contentCenterX),
        z: venueFloorCenterZ - ((yDxf * effectiveScale - centerZ) - contentCenterZ),
      });
      
      // Convert fixtures to VenueObjects
      // Keep scale/dimensions unchanged; only floor-plane Y -> Z orientation is flipped.
      const objectsDraft = fixtures.map((fixture, idx) => {
        const { pose2d, footprint, mapping, source, id: fixtureId } = fixture;
        const points = footprint?.points || [];
        
        let x, z, width, depth, rotationY;
        
        // MATCH EXACTLY Layout3DPreview.tsx logic
        if (points.length >= 3) {
          const sumX = points.reduce((sum, pt) => sum + pt.x, 0);
          const sumY = points.reduce((sum, pt) => sum + pt.y, 0);
          const centroidX = sumX / points.length;
          const centroidY = sumY / points.length;
          const world = dxfToVenueWorld(centroidX, centroidY);
          x = world.x - shiftX;
          z = world.z - shiftZ;
          
          const p0 = points[0];
          const p1 = points[1];
          const edgeDx = p1.x - p0.x;
          const edgeDy = p1.y - p0.y;
          rotationY = -Math.atan2(edgeDy, edgeDx);
          
          // Calculate bounding box for dimensions
          const minPtX = Math.min(...points.map(p => p.x));
          const maxPtX = Math.max(...points.map(p => p.x));
          const minPtY = Math.min(...points.map(p => p.y));
          const maxPtY = Math.max(...points.map(p => p.y));
          width = (maxPtX - minPtX) * effectiveScale;
          depth = (maxPtY - minPtY) * effectiveScale;
        } else {
          // Fallback to pose2d and footprint dimensions
          const world = dxfToVenueWorld(pose2d?.x || 0, pose2d?.y || 0);
          x = world.x - shiftX;
          z = world.z - shiftZ;
          rotationY = -((pose2d?.rot_deg || 0) * Math.PI / 180);
          width = (footprint?.w || 1000) * effectiveScale;
          depth = (footprint?.d || 1000) * effectiveScale;
        }
        
        // Determine object type from mapping
        const type = mapping?.type || 'custom';
        
        // Ensure minimum size (generic fallback only)
        if (width < 0.1) width = 0.1;
        if (depth < 0.1) depth = 0.1;
        
        const height = fixture.customHeight || mapping?.height || Math.max(0.5, Math.min(width, depth) * 0.5);
        
        // Generate NEW UUID for VenueObject (never reuse DWG fixture ID)
        const venueObjectId = uuidv4();
        
        if (idx < 5) {
          console.log(`[DWG Bootstrap] Fixture #${idx} "${fixtureId}":`);
          console.log(`  - Raw pose2d: x=${pose2d?.x}, y=${pose2d?.y}, rot=${pose2d?.rot_deg}°`);
          console.log(`  - Raw footprint: w=${footprint?.w}, d=${footprint?.d}, points=${points.length}`);
          console.log(`  - Computed position: x=${x.toFixed(3)}, z=${z.toFixed(3)} (before shift)`);
          console.log(`  - Final position: x=${(x + shiftX).toFixed(3)}, z=${(z + shiftZ).toFixed(3)} (after shift)`);
          console.log(`  - Computed scale: width=${width.toFixed(3)}, height=${height.toFixed(3)}, depth=${depth.toFixed(3)}`);
          console.log(`  - Computed rotation: ${(rotationY * 180 / Math.PI).toFixed(1)}°`);
        }
        // Checkout diagnostic — compare with Layout3DPreview console output
        if (type === 'checkout') {
          console.log(`%c[DWG Bootstrap] CHECKOUT #${idx}: ${fixtureId}  →  W=${width.toFixed(3)}m  D=${depth.toFixed(3)}m  H=${height.toFixed(3)}m  pos=(${(x + shiftX).toFixed(2)}, ${(z + shiftZ).toFixed(2)})`, 'color:green;font-weight:bold');
        }
        
        // Apply shift to center objects on venue floor
        const finalX = x + shiftX;
        const finalZ = z + shiftZ;
        
        return {
          id: venueObjectId,
          venueId: '', // Will be set when venue is created
          type: type,
          name: fixture.name || source?.layer || `${type} ${idx + 1}`,
          position: { x: finalX, y: 0, z: finalZ },
          rotation: { x: 0, y: rotationY, z: 0 },
          scale: { x: width, y: height, z: depth },
          color: catalogColors.get(type) || defaultTypeColors.custom,
          metadata: {
            source: 'dwg',
            dwg_bootstrap_version: 6, // v6: keep venue geometry in real meters; LiDAR scale correction is separate
            dwg_fixture_id: fixtureId,
            dwg_layout_version_id: layoutVersionId,
            business_category_id: mapping?.business_category_id || null,
            business_category: mapping?.business_category || null,
            business_category_label: mapping?.business_category_label || null,
            // Store DWG polygon footprint for 3D rendering (extruded shapes + wireframes)
            dwg_footprint_points: points.length >= 3 ? points.map(pt => dxfToVenueWorld(pt.x, pt.y)) : null,
            dwg_center_x: finalX,
            dwg_center_z: finalZ,
          }
        };
      });
      
      // Convert LiDAR instances to LidarPlacement format
      const lidarDraft = lidarInstances.map(inst => {
        const model = modelMap.get(inst.model_id);
        
        // LiDAR positions may have been saved with the LiDAR/autoplace correction.
        // Convert them back to geometry meters before placing in the venue scene.
        const lidarX = inst.x_m / lidarScaleCorrection;
        const lidarZ = inst.z_m / lidarScaleCorrection;
        
        // Flip Z consistently with fixtures so placements match the venue orientation.
        const x = lidarX - centerX + shiftX;
        const z = venueFloorCenterZ - ((lidarZ - centerZ) - contentCenterZ);
        const mountHeight = inst.mount_y_m || 3;
        
        return {
          id: uuidv4(), // Generate new ID
          venueId: '', // Will be set when venue is created
          deviceId: inst.id, // Reference to original
          position: { x, y: mountHeight, z },
          rotation: { x: 0, y: (inst.yaw_deg * Math.PI) / 180, z: 0 },
          mountHeight: mountHeight,
          fovHorizontal: model?.hfov_deg || 360,
          fovVertical: model?.vfov_deg || 30,
          range: inst.range_m || model?.range_m || 10,
          enabled: true,
          metadata: {
            source: 'dwg',
            dwg_lidar_instance_id: inst.id,
            dwg_layout_version_id: layoutVersionId,
            model_id: inst.model_id
          }
        };
      });
      
      // Build response (MANDATORY SHAPE per spec)
      res.json({
        venueDefaults: {
          width: venueWidth,
          depth: venueDepth,
          height: 4,
          tileSize: 1
        },
        objectsDraft,
        lidarDraft,
        transform: {
          effectiveScale,
          scaleCorrection,
          lidarScaleCorrection,
          centerOffset: { x: centerX, z: centerZ },
          shift: { x: shiftX, z: shiftZ },
          venueSize: { width: venueWidth, depth: venueDepth }
        },
        dwgMetadata: {
          layoutVersionId,
          importId: layout.import_id,
          layoutName: layout.name
        }
      });
      
    } catch (err) {
      console.error('DWG venue bootstrap error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PATCH /api/dwg/layout/:layoutVersionId/link-venue - Link a layout version to a venue
   * Updates venue_id on dwg_layout_versions AND on dwg_imports
   */
  router.patch('/layout/:layoutVersionId/link-venue', (req, res) => {
    try {
      const { layoutVersionId } = req.params;
      const { venue_id } = req.body;

      const layout = db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(layoutVersionId);
      if (!layout) {
        return res.status(404).json({ error: 'Layout version not found' });
      }

      db.prepare('UPDATE dwg_layout_versions SET venue_id = ? WHERE id = ?').run(venue_id || null, layoutVersionId);

      // Also update the parent import's venue_id
      if (layout.import_id) {
        db.prepare('UPDATE dwg_imports SET venue_id = ? WHERE id = ?').run(venue_id || null, layout.import_id);
      }

      console.log(`🔗 Layout ${layoutVersionId} linked to venue: ${venue_id}`);
      res.json({ success: true, venue_id });
    } catch (err) {
      console.error('Link venue error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // ============ FLOOR PLAN IMAGE OVERLAY ENDPOINTS ============

  /**
   * POST /api/dwg/import/:import_id/floorplan - Upload a floor plan image
   */
  router.post('/import/:import_id/floorplan', floorplanUpload.single('image'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded' });
      }

      const { import_id } = req.params;

      // Verify import exists
      const imp = db.prepare('SELECT id FROM dwg_imports WHERE id = ?').get(import_id);
      if (!imp) {
        // Clean up uploaded file
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Import not found' });
      }

      // Delete any existing floorplan for this import (one-to-one)
      const existing = db.prepare('SELECT file_path FROM dwg_floorplan_images WHERE import_id = ?').get(import_id);
      if (existing) {
        try { fs.unlinkSync(existing.file_path); } catch (e) { /* ignore */ }
        db.prepare('DELETE FROM dwg_floorplan_images WHERE import_id = ?').run(import_id);
      }

      const id = uuidv4();
      const now = new Date().toISOString();
      const ext = path.extname(req.file.originalname).toLowerCase();
      const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

      db.prepare(`
        INSERT INTO dwg_floorplan_images (id, import_id, original_filename, file_path, mime_type, transform_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        import_id,
        req.file.originalname,
        req.file.path,
        mimeMap[ext] || 'image/png',
        JSON.stringify({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 }),
        now,
        now
      );

      res.json({
        id,
        import_id,
        original_filename: req.file.originalname,
        mime_type: mimeMap[ext] || 'image/png',
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 },
        calibration: null,
        created_at: now
      });
    } catch (err) {
      console.error('Floorplan upload error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/dwg/import/:import_id/floorplan - Get floorplan metadata for an import
   */
  router.get('/import/:import_id/floorplan', (req, res) => {
    try {
      const row = db.prepare('SELECT * FROM dwg_floorplan_images WHERE import_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.import_id);
      if (!row) {
        return res.json({ floorplan: null });
      }

      const transformData = JSON.parse(row.transform_json);
      const { cropRect, ...transform } = transformData;
      res.json({
        floorplan: {
          id: row.id,
          import_id: row.import_id,
          original_filename: row.original_filename,
          mime_type: row.mime_type,
          image_width: row.image_width,
          image_height: row.image_height,
          transform,
          calibration: row.calibration_json ? JSON.parse(row.calibration_json) : null,
          cropRect: cropRect || null,
          created_at: row.created_at,
          updated_at: row.updated_at
        }
      });
    } catch (err) {
      console.error('Floorplan fetch error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/dwg/import/:import_id/floorplan/image - Serve the actual image file
   */
  router.get('/import/:import_id/floorplan/image', (req, res) => {
    try {
      const row = db.prepare('SELECT file_path, mime_type FROM dwg_floorplan_images WHERE import_id = ? ORDER BY created_at DESC LIMIT 1').get(req.params.import_id);
      if (!row || !fs.existsSync(row.file_path)) {
        return res.status(404).json({ error: 'Floorplan image not found' });
      }

      res.setHeader('Content-Type', row.mime_type);
      res.sendFile(path.resolve(row.file_path));
    } catch (err) {
      console.error('Floorplan image serve error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * PUT /api/dwg/import/:import_id/floorplan/transform - Update transform (position, scale, rotation, opacity)
   */
  router.put('/import/:import_id/floorplan/transform', (req, res) => {
    try {
      const { transform, calibration, cropRect } = req.body;
      const now = new Date().toISOString();

      const row = db.prepare('SELECT id, transform_json FROM dwg_floorplan_images WHERE import_id = ?').get(req.params.import_id);
      if (!row) {
        return res.status(404).json({ error: 'No floorplan found for this import' });
      }

      const updates = [];
      const params = [];

      if (transform !== undefined) {
        // Merge cropRect into the transform JSON if provided
        const transformData = { ...transform };
        if (cropRect !== undefined) {
          transformData.cropRect = cropRect;
        } else {
          // Preserve existing cropRect if not explicitly changed
          try {
            const existing = JSON.parse(row.transform_json || '{}');
            if (existing.cropRect) transformData.cropRect = existing.cropRect;
          } catch {}
        }
        updates.push('transform_json = ?');
        params.push(JSON.stringify(transformData));
      } else if (cropRect !== undefined) {
        // Only cropRect changed, merge into existing transform
        try {
          const existing = JSON.parse(row.transform_json || '{}');
          existing.cropRect = cropRect;
          updates.push('transform_json = ?');
          params.push(JSON.stringify(existing));
        } catch {
          updates.push('transform_json = ?');
          params.push(JSON.stringify({ cropRect }));
        }
      }
      if (calibration !== undefined) {
        updates.push('calibration_json = ?');
        params.push(calibration ? JSON.stringify(calibration) : null);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      updates.push('updated_at = ?');
      params.push(now);
      params.push(row.id);

      db.prepare(`UPDATE dwg_floorplan_images SET ${updates.join(', ')} WHERE id = ?`).run(...params);

      res.json({ success: true, updated_at: now });
    } catch (err) {
      console.error('Floorplan transform update error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/dwg/import/:import_id/floorplan - Delete floorplan image
   */
  router.delete('/import/:import_id/floorplan', (req, res) => {
    try {
      const row = db.prepare('SELECT id, file_path FROM dwg_floorplan_images WHERE import_id = ?').get(req.params.import_id);
      if (!row) {
        return res.status(404).json({ error: 'No floorplan found' });
      }

      // Delete file from disk
      try { fs.unlinkSync(row.file_path); } catch (e) { /* ignore */ }

      db.prepare('DELETE FROM dwg_floorplan_images WHERE id = ?').run(row.id);

      res.json({ success: true });
    } catch (err) {
      console.error('Floorplan delete error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/dwg/feature-status - Check if feature is enabled
   */
  router.get('/feature-status', (req, res) => {
    // Check DWG conversion tools availability
    const hasDwg2dxf = commandExists('dwg2dxf');
    const hasDwgread = commandExists('dwgread');
    const hasOdaConverter = [
      '/usr/bin/ODAFileConverter',
      '/opt/ODAFileConverter/ODAFileConverter',
      '/Applications/ODAFileConverter.app/Contents/MacOS/ODAFileConverter'
    ].some(p => fs.existsSync(p));
    
    const dwgSupported = hasDwg2dxf || hasDwgread || hasOdaConverter;
    
    res.json({ 
      enabled: process.env.FEATURE_DWG_IMPORTER === 'true',
      version: '1.0.0',
      dwg_supported: dwgSupported,
      dwg_converters: {
        dwg2dxf: hasDwg2dxf,
        dwgread: hasDwgread,
        oda_converter: hasOdaConverter
      },
      install_hint: !dwgSupported ? 'Install LibreDWG: brew install libredwg (macOS) or apt install libredwg (Linux)' : null
    });
  });
  
  return router;
}
