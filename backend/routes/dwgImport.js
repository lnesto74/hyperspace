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
      w: blockBounds.w * scaleX,
      d: blockBounds.d * scaleY,
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
  
  return {
    units,
    unit_scale_to_m: unitScaleToM,
    bounds,
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
        JSON.stringify({ fixtures: parsed.fixtures, layers: parsed.layers }),
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
   * GET /api/dwg/imports - List all imports
   */
  router.get('/imports', (req, res) => {
    try {
      const imports = db.prepare(`
        SELECT id, venue_id, filename, units, status, created_at 
        FROM dwg_imports 
        ORDER BY created_at DESC
      `).all();
      
      res.json(imports.map(imp => ({
        import_id: imp.id,
        venue_id: imp.venue_id,
        filename: imp.filename,
        units: imp.units,
        status: imp.status,
        created_at: imp.created_at
      })));
      
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
      
      // Build import data
      const importData = {
        fixtures: rawData.fixtures || [],
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
      
      res.json({
        layout_version_id: layoutVersionId,
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
        name: l.import_filename || l.name,
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
      
      // Build catalog from existing object types + custom models
      const catalog = [
        { id: 'shelf', name: 'Shelf', type: 'shelf', hasCustomModel: false },
        { id: 'wall', name: 'Wall', type: 'wall', hasCustomModel: false },
        { id: 'checkout', name: 'Checkout', type: 'checkout', hasCustomModel: false },
        { id: 'entrance', name: 'Entrance', type: 'entrance', hasCustomModel: false },
        { id: 'pillar', name: 'Pillar', type: 'pillar', hasCustomModel: false },
        { id: 'digital_display', name: 'Digital Display', type: 'digital_display', hasCustomModel: false },
        { id: 'radio', name: 'Radio', type: 'radio', hasCustomModel: false },
        { id: 'custom', name: 'Custom', type: 'custom', hasCustomModel: false }
      ];
      
      // Mark which have custom models
      for (const model of customModels) {
        const item = catalog.find(c => c.type === model.object_type);
        if (item) {
          item.hasCustomModel = true;
          item.modelPath = model.file_path;
        }
      }
      
      res.json(catalog);
      
    } catch (err) {
      console.error('Get catalog error:', err);
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
      
      // Calculate bounds and center offset (EXACT same math as Layout3DPreview.tsx)
      console.log(`[DWG Bootstrap] unitScale=${unitScale}, scaleCorrection=${scaleCorrection}`);
      const effectiveScale = unitScale * scaleCorrection;
      
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
      
      // Also fetch ROI in DXF units from regions_of_interest (for spatial filtering)
      let roiDxfVertices = null;
      try {
        const roiRow = db.prepare('SELECT vertices FROM regions_of_interest WHERE dwg_layout_id = ? LIMIT 1').get(layoutVersionId);
        if (roiRow?.vertices) {
          const parsed = typeof roiRow.vertices === 'string' ? JSON.parse(roiRow.vertices) : roiRow.vertices;
          if (Array.isArray(parsed) && parsed.length >= 3) roiDxfVertices = parsed;
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
      
      // Calculate content bounds from fixtures (for venue sizing)
      let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity, fMaxY = -Infinity;
      fixtures.forEach(f => {
        const { footprint, pose2d } = f;
        const points = footprint?.points || [];
        if (points.length > 0) {
          points.forEach(pt => {
            fMinX = Math.min(fMinX, pt.x); fMaxX = Math.max(fMaxX, pt.x);
            fMinY = Math.min(fMinY, pt.y); fMaxY = Math.max(fMaxY, pt.y);
          });
        } else if (pose2d) {
          const hw = (footprint?.w || 1000) / 2;
          const hd = (footprint?.d || 1000) / 2;
          fMinX = Math.min(fMinX, pose2d.x - hw); fMaxX = Math.max(fMaxX, pose2d.x + hw);
          fMinY = Math.min(fMinY, pose2d.y - hd); fMaxY = Math.max(fMaxY, pose2d.y + hd);
        }
      });
      if (!isFinite(fMinX)) { fMinX = 0; fMaxX = 20000; fMinY = 0; fMaxY = 15000; }
      
      const padding = 4; // 4m padding on each side
      let venueWidth, venueDepth;
      
      if (roiVertices) {
        // Use ROI bounds for venue dimensions (tighter than all-fixture bounds)
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
      
      // Convert fixtures to VenueObjects
      // MATCH EXACTLY Layout3DPreview.tsx: positions = DXF * effectiveScale - centerX
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
          x = centroidX * effectiveScale - centerX;
          z = centroidY * effectiveScale - centerZ;
          
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
          x = (pose2d?.x || 0) * effectiveScale - centerX;
          z = (pose2d?.y || 0) * effectiveScale - centerZ;
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
          color: null, // Will use default color from VenueContext
          metadata: {
            source: 'dwg',
            dwg_bootstrap_version: 4, // v4: fixed scaleCorrection from layout DB
            dwg_fixture_id: fixtureId,
            dwg_layout_version_id: layoutVersionId,
            // Store DWG polygon footprint for 3D rendering (extruded shapes + wireframes)
            dwg_footprint_points: points.length >= 3 ? points.map(pt => ({
              x: pt.x * effectiveScale - centerX + shiftX,
              z: pt.y * effectiveScale - centerZ + shiftZ
            })) : null,
            dwg_center_x: finalX,
            dwg_center_z: finalZ,
          }
        };
      });
      
      // Convert LiDAR instances to LidarPlacement format
      const lidarDraft = lidarInstances.map(inst => {
        const model = modelMap.get(inst.model_id);
        
        // LiDAR positions are in meters — apply center offset (same as Layout3DPreview) + shift
        const x = inst.x_m - centerX + shiftX;
        const z = inst.z_m - centerZ + shiftZ;
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
