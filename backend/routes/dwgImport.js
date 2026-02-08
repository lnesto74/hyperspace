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
const uploadDir = path.join(__dirname, '..', 'uploads', 'dwg');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

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

  // Only include fixtures that have a mapping (are paired)
  const layoutFixtures = fixtures
    .filter(fixture => {
      const groupMapping = groupMappings[fixture.group_id];
      return groupMapping && groupMapping.catalog_asset_id;
    })
    .map(fixture => {
      const groupMapping = groupMappings[fixture.group_id];
      const groupSize = groupSizeMap[fixture.group_id] || { w: 0, d: 0 };
      
      // Use group size if fixture footprint is empty
      const footprint = (fixture.footprint.w > 0 && fixture.footprint.d > 0)
        ? fixture.footprint
        : { ...fixture.footprint, w: groupSize.w, d: groupSize.d };
      
      return {
        id: fixture.id,
        group_id: fixture.group_id,
        source: fixture.source,
        pose2d: fixture.pose2d,
        footprint: footprint,
        group_size: groupSize,
        mapping: groupMapping
      };
    });
  
  // Count paired vs unpaired
  const pairedCount = layoutFixtures.length;
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
      
      // Create layout version
      const layoutVersionId = uuidv4();
      const now = new Date().toISOString();
      
      db.prepare(`
        INSERT INTO dwg_layout_versions (id, import_id, mapping_id, venue_id, name, layout_json, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        layoutVersionId,
        req.params.import_id,
        mappingRow?.id || null,
        req.body.venue_id || imp.venue_id,
        req.body.name || `Layout ${now}`,
        JSON.stringify(layoutJson),
        1,
        now
      );
      
      // Update import status
      db.prepare('UPDATE dwg_imports SET status = ?, updated_at = ? WHERE id = ?').run('generated', now, req.params.import_id);
      
      res.json({
        layout_version_id: layoutVersionId,
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
      
      res.json({
        layout_version_id: layout.id,
        import_id: layout.import_id,
        venue_id: layout.venue_id,
        name: layout.name,
        is_active: !!layout.is_active,
        created_at: layout.created_at,
        layout: layoutData,
        mapping: mapping ? JSON.parse(mapping.mapping_json || '{}') : {}
      });
      
    } catch (err) {
      console.error('Get layout error:', err);
      res.status(500).json({ error: err.message });
    }
  });
  
  /**
   * GET /api/dwg/import/:import_id/layouts - List layouts for an import
   */
  router.get('/import/:import_id/layouts', (req, res) => {
    try {
      const layouts = db.prepare(`
        SELECT id, import_id, venue_id, name, is_active, created_at 
        FROM dwg_layout_versions 
        WHERE import_id = ?
        ORDER BY created_at DESC
      `).all(req.params.import_id);
      
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
