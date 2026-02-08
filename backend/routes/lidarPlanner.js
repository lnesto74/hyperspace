import express from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// LiDAR Solver Service URL (use 127.0.0.1 instead of localhost for Node.js fetch compatibility)
const LIDAR_SOLVER_URL = process.env.LIDAR_SOLVER_URL || 'http://127.0.0.1:3002';

// Feature flag check middleware
const checkFeatureFlag = (req, res, next) => {
  if (process.env.FEATURE_LIDAR_PLANNER !== 'true') {
    return res.status(403).json({ error: 'LiDAR Planner feature is not enabled' });
  }
  next();
};

router.use(checkFeatureFlag);

// ============ LIDAR MODELS ============

// GET /api/lidar/models - Get all LiDAR models
router.get('/models', (req, res) => {
  try {
    const db = req.app.get('db');
    const models = db.prepare('SELECT * FROM lidar_models ORDER BY name').all();
    res.json(models.map(m => ({
      id: m.id,
      name: m.name,
      hfov_deg: m.hfov_deg,
      vfov_deg: m.vfov_deg,
      range_m: m.range_m,
      dome_mode: !!m.dome_mode,
      notes: m.notes_json ? JSON.parse(m.notes_json) : null,
      created_at: m.created_at
    })));
  } catch (err) {
    console.error('Error fetching LiDAR models:', err);
    res.status(500).json({ error: 'Failed to fetch LiDAR models' });
  }
});

// POST /api/lidar/models - Create a new LiDAR model
router.post('/models', (req, res) => {
  try {
    const db = req.app.get('db');
    const { name, hfov_deg = 360, vfov_deg = 30, range_m = 10, dome_mode = true, notes } = req.body;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const id = uuidv4();
    db.prepare(`
      INSERT INTO lidar_models (id, name, hfov_deg, vfov_deg, range_m, dome_mode, notes_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, hfov_deg, vfov_deg, range_m, dome_mode ? 1 : 0, notes ? JSON.stringify(notes) : null);
    
    res.status(201).json({
      id,
      name,
      hfov_deg,
      vfov_deg,
      range_m,
      dome_mode,
      notes
    });
  } catch (err) {
    console.error('Error creating LiDAR model:', err);
    res.status(500).json({ error: 'Failed to create LiDAR model' });
  }
});

// PUT /api/lidar/models/:id - Update a LiDAR model
router.put('/models/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;
    const { name, hfov_deg, vfov_deg, range_m, dome_mode, notes } = req.body;
    
    // Check if model exists
    const existing = db.prepare('SELECT id FROM lidar_models WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    // Build update query dynamically based on provided fields
    const updates = [];
    const params = [];
    
    if (name !== undefined) { updates.push('name = ?'); params.push(name); }
    if (hfov_deg !== undefined) { updates.push('hfov_deg = ?'); params.push(hfov_deg); }
    if (vfov_deg !== undefined) { updates.push('vfov_deg = ?'); params.push(vfov_deg); }
    if (range_m !== undefined) { updates.push('range_m = ?'); params.push(range_m); }
    if (dome_mode !== undefined) { updates.push('dome_mode = ?'); params.push(dome_mode ? 1 : 0); }
    if (notes !== undefined) { updates.push('notes_json = ?'); params.push(JSON.stringify(notes)); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(id);
    db.prepare(`UPDATE lidar_models SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    
    // Return updated model
    const updated = db.prepare('SELECT * FROM lidar_models WHERE id = ?').get(id);
    res.json({
      id: updated.id,
      name: updated.name,
      hfov_deg: updated.hfov_deg,
      vfov_deg: updated.vfov_deg,
      range_m: updated.range_m,
      dome_mode: !!updated.dome_mode,
      notes: updated.notes_json ? JSON.parse(updated.notes_json) : null
    });
  } catch (err) {
    console.error('Error updating LiDAR model:', err);
    res.status(500).json({ error: 'Failed to update LiDAR model' });
  }
});

// ============ LIDAR INSTANCES ============

// GET /api/lidar/instances - Get instances for a layout version
router.get('/instances', (req, res) => {
  try {
    const db = req.app.get('db');
    const { layout_version_id, source } = req.query;
    
    if (!layout_version_id) {
      return res.status(400).json({ error: 'layout_version_id is required' });
    }
    
    let query = `
      SELECT i.*, m.name as model_name, m.hfov_deg as model_hfov, m.vfov_deg as model_vfov, 
             m.range_m as model_range, m.dome_mode as model_dome_mode
      FROM lidar_instances i
      LEFT JOIN lidar_models m ON i.model_id = m.id
      WHERE i.layout_version_id = ?
    `;
    const params = [layout_version_id];
    
    if (source) {
      query += ' AND i.source = ?';
      params.push(source);
    }
    
    query += ' ORDER BY i.created_at';
    
    const instances = db.prepare(query).all(...params);
    res.json(instances.map(i => {
      const overrides = i.params_override_json ? JSON.parse(i.params_override_json) : {};
      return {
        id: i.id,
        project_id: i.project_id,
        layout_version_id: i.layout_version_id,
        source: i.source,
        model_id: i.model_id,
        model_name: i.model_name,
        x_m: i.x_m,
        z_m: i.z_m,
        mount_y_m: i.mount_y_m,
        yaw_deg: i.yaw_deg,
        // Effective params (override or model default)
        hfov_deg: overrides.hfov_deg ?? i.model_hfov ?? 360,
        vfov_deg: overrides.vfov_deg ?? i.model_vfov ?? 30,
        range_m: overrides.range_m ?? i.model_range ?? 10,
        dome_mode: overrides.dome_mode ?? (i.model_dome_mode ? true : false) ?? true,
        params_override: overrides,
        created_at: i.created_at
      };
    }));
  } catch (err) {
    console.error('Error fetching LiDAR instances:', err);
    res.status(500).json({ error: 'Failed to fetch LiDAR instances' });
  }
});

// POST /api/lidar/instances - Create a new LiDAR instance
router.post('/instances', (req, res) => {
  try {
    const db = req.app.get('db');
    const { 
      layout_version_id, 
      project_id,
      source = 'manual',
      model_id,
      x_m = 0, 
      z_m = 0, 
      mount_y_m = 3, 
      yaw_deg = 0,
      params_override
    } = req.body;
    
    if (!layout_version_id) {
      return res.status(400).json({ error: 'layout_version_id is required' });
    }
    
    const id = uuidv4();
    db.prepare(`
      INSERT INTO lidar_instances (id, project_id, layout_version_id, source, model_id, x_m, z_m, mount_y_m, yaw_deg, params_override_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, project_id || null, layout_version_id, source, model_id || null, x_m, z_m, mount_y_m, yaw_deg, 
           params_override ? JSON.stringify(params_override) : null);
    
    res.status(201).json({
      id,
      project_id,
      layout_version_id,
      source,
      model_id,
      x_m,
      z_m,
      mount_y_m,
      yaw_deg,
      params_override
    });
  } catch (err) {
    console.error('Error creating LiDAR instance:', err);
    res.status(500).json({ error: 'Failed to create LiDAR instance' });
  }
});

// PUT /api/lidar/instances/:id - Update a LiDAR instance
router.put('/instances/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;
    const { model_id, x_m, z_m, mount_y_m, yaw_deg, params_override } = req.body;
    
    // Check if instance exists
    const existing = db.prepare('SELECT * FROM lidar_instances WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'LiDAR instance not found' });
    }
    
    db.prepare(`
      UPDATE lidar_instances 
      SET model_id = COALESCE(?, model_id),
          x_m = COALESCE(?, x_m),
          z_m = COALESCE(?, z_m),
          mount_y_m = COALESCE(?, mount_y_m),
          yaw_deg = COALESCE(?, yaw_deg),
          params_override_json = ?
      WHERE id = ?
    `).run(
      model_id ?? null, 
      x_m ?? null, 
      z_m ?? null, 
      mount_y_m ?? null, 
      yaw_deg ?? null,
      params_override !== undefined ? JSON.stringify(params_override) : existing.params_override_json,
      id
    );
    
    res.json({ success: true, id });
  } catch (err) {
    console.error('Error updating LiDAR instance:', err);
    res.status(500).json({ error: 'Failed to update LiDAR instance' });
  }
});

// DELETE /api/lidar/instances/:id - Delete a LiDAR instance
router.delete('/instances/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;
    
    const result = db.prepare('DELETE FROM lidar_instances WHERE id = ?').run(id);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'LiDAR instance not found' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting LiDAR instance:', err);
    res.status(500).json({ error: 'Failed to delete LiDAR instance' });
  }
});

// ============ COVERAGE SIMULATION ============

// POST /api/lidar/simulate - Run coverage simulation
router.post('/simulate', (req, res) => {
  try {
    const db = req.app.get('db');
    const { 
      layout_version_id,
      floor_cell_size_m = 0.5,
      overlap_required_n = 2,
      include_occlusion = true
    } = req.body;
    
    if (!layout_version_id) {
      return res.status(400).json({ error: 'layout_version_id is required' });
    }
    
    // Get layout data
    const layout = db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(layout_version_id);
    if (!layout) {
      return res.status(404).json({ error: 'Layout version not found' });
    }
    
    const layoutData = JSON.parse(layout.layout_json);
    
    // Get LiDAR instances
    const instances = db.prepare(`
      SELECT i.*, m.hfov_deg as model_hfov, m.vfov_deg as model_vfov, m.range_m as model_range, m.dome_mode as model_dome_mode
      FROM lidar_instances i
      LEFT JOIN lidar_models m ON i.model_id = m.id
      WHERE i.layout_version_id = ?
    `).all(layout_version_id);
    
    if (instances.length === 0) {
      return res.json({
        coverage_pct: 0,
        overlap_pct: 0,
        total_target_cells: 0,
        covered_cells: 0,
        overlap_cells: 0,
        heatmap: [],
        stats: { sensor_count: 0 }
      });
    }
    
    // Run simulation
    const result = runCoverageSimulation(layoutData, instances, {
      floor_cell_size_m,
      overlap_required_n,
      include_occlusion
    });
    
    res.json(result);
  } catch (err) {
    console.error('Error running coverage simulation:', err);
    res.status(500).json({ error: 'Failed to run coverage simulation' });
  }
});

// ============ AUTO-PLACEMENT ============

// POST /api/lidar/autoplace - Auto-place LiDARs (upgraded with OR-Tools solver)
router.post('/autoplace', async (req, res) => {
  try {
    const db = req.app.get('db');
    const {
      layout_version_id,
      project_id,
      model_id,
      coverage_target_pct = 0.95,
      overlap_required_n = 2,
      candidate_grid_spacing_m,
      mount_y_m = 3,
      floor_cell_size_m = 0.5,
      sample_spacing_m = 0.75,
      keepout_distance_m = 0.5,
      max_sensors = 50,
      roi_vertices,  // ROI polygon for placement area
      // New solver parameters
      overlap_mode = 'everywhere',  // 'everywhere' | 'critical_only' | 'percent_target'
      k_required = 2,
      overlap_target_pct = 0.8,
      critical_polygon = null,  // Optional critical zone polygon
      los_enabled = false,
      los_cell_m = 0.25,
      yaw_step_deg = 30,
      solver_time_limit_s = 10,
      seed = Date.now() % 100000
    } = req.body;
    
    console.log('Auto-place request:', { 
      layout_version_id, 
      model_id, 
      roi_vertices: roi_vertices?.length,
      overlap_mode,
      k_required 
    });
    
    if (!layout_version_id) {
      return res.status(400).json({ error: 'layout_version_id is required' });
    }
    
    // Get layout data
    const layout = db.prepare('SELECT * FROM dwg_layout_versions WHERE id = ?').get(layout_version_id);
    if (!layout) {
      return res.status(404).json({ error: 'Layout version not found' });
    }
    
    const layoutData = JSON.parse(layout.layout_json);
    
    // Get model params
    let modelParams = { hfov_deg: 360, vfov_deg: 30, range_m: 10, dome_mode: true };
    if (model_id) {
      const model = db.prepare('SELECT * FROM lidar_models WHERE id = ?').get(model_id);
      if (model) {
        modelParams = {
          hfov_deg: model.hfov_deg,
          vfov_deg: model.vfov_deg,
          range_m: model.range_m,
          dome_mode: !!model.dome_mode
        };
      }
    }
    
    // Calculate effective radius for dome vs non-dome LiDARs
    let effectiveRadius;
    if (modelParams.dome_mode || modelParams.hfov_deg >= 360) {
      effectiveRadius = modelParams.range_m * 0.9;
    } else {
      const alpha = (modelParams.vfov_deg / 2) * Math.PI / 180;
      const r_vfov = mount_y_m * Math.tan(alpha);
      effectiveRadius = Math.min(modelParams.range_m, r_vfov);
    }
    
    // Calculate candidate grid spacing based on effective radius for k=2 overlap (~70% overlap)
    const gridSpacing = candidate_grid_spacing_m || effectiveRadius * 1.4;
    
    // Extract obstacles from layout fixtures
    const obstacles = extractObstaclesFromLayout(layoutData);
    
    // Try to use the Python OR-Tools solver first
    let placement;
    const useSolver = process.env.FEATURE_LIDAR_SOLVER !== 'false';
    
    if (useSolver && roi_vertices && roi_vertices.length >= 3) {
      try {
        // Debug: Log ROI dimensions
        const roiXs = roi_vertices.map(v => v.x);
        const roiZs = roi_vertices.map(v => v.z);
        const roiBounds = {
          minX: Math.min(...roiXs),
          maxX: Math.max(...roiXs),
          minZ: Math.min(...roiZs),
          maxZ: Math.max(...roiZs)
        };
        console.log('=== SOLVER DEBUG ===');
        console.log('ROI vertices (meters):', roi_vertices);
        console.log('ROI bounds (meters):', roiBounds);
        console.log('ROI size:', (roiBounds.maxX - roiBounds.minX).toFixed(2), 'x', (roiBounds.maxZ - roiBounds.minZ).toFixed(2), 'meters');
        console.log('Model params:', modelParams);
        console.log('Mount height:', mount_y_m, 'm');
        console.log('Effective radius:', effectiveRadius.toFixed(2), 'm (dome_mode:', modelParams.dome_mode, ')');
        console.log('Grid spacing:', gridSpacing.toFixed(2), 'm');
        
        console.log('Attempting OR-Tools solver...');
        placement = await callPythonSolver({
          roi_polygon: roi_vertices,
          obstacles,
          critical_polygon,
          model: modelParams,
          settings: {
            mount_y_m,
            sample_spacing_m,
            candidate_spacing_m: gridSpacing,
            keepout_distance_m,
            overlap_mode,
            k_required,
            overlap_target_pct,
            los_enabled,
            los_cell_m,
            yaw_step_deg,
            max_sensors,
            solver_time_limit_s,
            seed
          }
        });
        
        if (placement.success) {
          console.log('OR-Tools solver succeeded:', {
            sensors: placement.num_sensors,
            coverage: (placement.coverage_pct * 100).toFixed(1) + '%',
            k_coverage: (placement.k_coverage_pct * 100).toFixed(1) + '%'
          });
        } else {
          console.warn('OR-Tools solver failed:', placement.error);
          placement = null;
        }
      } catch (solverErr) {
        console.error('=== SOLVER ERROR ===');
        console.error('Error type:', solverErr.name);
        console.error('Error message:', solverErr.message);
        console.error('Full error:', solverErr);
        console.warn('Falling back to greedy algorithm');
        placement = null;
      }
    }
    
    // Fallback to greedy algorithm if solver fails or isn't available
    if (!placement || !placement.success) {
      console.log('Using fallback greedy algorithm...');
      placement = runAutoPlacement(layoutData, {
        model_id,
        modelParams,
        coverage_target_pct,
        overlap_required_n: k_required,
        candidate_grid_spacing_m: gridSpacing,
        mount_y_m,
        floor_cell_size_m,
        keepout_distance_m,
        max_sensors,
        roi_vertices
      });
    }
    
    // Delete existing auto-placed instances for this layout
    db.prepare('DELETE FROM lidar_instances WHERE layout_version_id = ? AND source = ?').run(layout_version_id, 'auto');
    
    // Create new auto-placed instances
    const createdInstances = [];
    const insertStmt = db.prepare(`
      INSERT INTO lidar_instances (id, project_id, layout_version_id, source, model_id, x_m, z_m, mount_y_m, yaw_deg)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const positions = placement.selected_positions || [];
    for (const pos of positions) {
      const id = uuidv4();
      insertStmt.run(id, project_id || null, layout_version_id, 'auto', model_id || null, pos.x, pos.z, mount_y_m, pos.yaw || 0);
      createdInstances.push({
        id,
        x_m: pos.x,
        z_m: pos.z,
        mount_y_m,
        yaw_deg: pos.yaw || 0
      });
    }
    
    // Save plan run with extended settings
    const runId = uuidv4();
    db.prepare(`
      INSERT INTO lidar_plan_runs (id, project_id, layout_version_id, settings_json, results_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      runId,
      project_id || null,
      layout_version_id,
      JSON.stringify({
        model_id,
        coverage_target_pct,
        overlap_mode,
        k_required,
        overlap_target_pct,
        candidate_grid_spacing_m: gridSpacing,
        sample_spacing_m,
        mount_y_m,
        floor_cell_size_m,
        keepout_distance_m,
        los_enabled,
        seed
      }),
      JSON.stringify({
        coverage_pct: placement.coverage_pct || 0,
        k_coverage_pct: placement.k_coverage_pct || placement.overlap_pct || 0,
        sensor_count: createdInstances.length,
        solver_status: placement.solver_status || 'greedy',
        warnings: placement.warnings || [],
        effective_radius_m: placement.effective_radius_m
      })
    );
    
    res.json({
      run_id: runId,
      instances: createdInstances,
      coverage_pct: placement.coverage_pct || 0,
      k_coverage_pct: placement.k_coverage_pct || placement.overlap_pct || 0,
      overlap_pct: placement.k_coverage_pct || placement.overlap_pct || 0,
      total_sample_points: placement.total_sample_points || placement.total_target_cells || 0,
      total_candidates: placement.total_candidates || placement.candidate_count || 0,
      overlap_mode,
      k_required,
      warnings: placement.warnings || [],
      solver_status: placement.solver_status || 'greedy',
      seed,
      effective_radius_m: placement.effective_radius_m
    });
  } catch (err) {
    console.error('Error running auto-placement:', err);
    res.status(500).json({ error: 'Failed to run auto-placement', details: err.message });
  }
});

// Helper: Call Python OR-Tools solver
async function callPythonSolver(params) {
  const response = await fetch(`${LIDAR_SOLVER_URL}/solve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000)  // 30s timeout
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Solver returned ${response.status}: ${text}`);
  }
  
  return await response.json();
}

// Helper: Extract obstacle polygons from layout fixtures
function extractObstaclesFromLayout(layoutData) {
  const obstacles = [];
  const fixtures = layoutData.fixtures || [];
  
  for (const fixture of fixtures) {
    if (fixture.footprint) {
      // Fixture has explicit footprint polygon
      if (fixture.footprint.points && fixture.footprint.points.length >= 3) {
        obstacles.push(fixture.footprint.points.map(p => ({ x: p.x, z: p.y || p.z })));
      } else if (fixture.pose2d && fixture.footprint.w && fixture.footprint.d) {
        // Generate rectangle from pose and dimensions
        const cx = fixture.pose2d.x;
        const cz = fixture.pose2d.y;
        const w = fixture.footprint.w;
        const d = fixture.footprint.d;
        const angle = (fixture.pose2d.rot_deg || 0) * Math.PI / 180;
        const hw = w / 2;
        const hd = d / 2;
        
        // Corners before rotation
        const corners = [
          { x: -hw, z: -hd },
          { x: hw, z: -hd },
          { x: hw, z: hd },
          { x: -hw, z: hd }
        ];
        
        // Rotate and translate
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rotated = corners.map(c => ({
          x: cx + c.x * cos - c.z * sin,
          z: cz + c.x * sin + c.z * cos
        }));
        
        obstacles.push(rotated);
      }
    }
  }
  
  return obstacles;
}

// ============ SIMULATION ALGORITHMS ============

function runCoverageSimulation(layoutData, instances, options) {
  const { floor_cell_size_m, overlap_required_n, include_occlusion } = options;
  
  // Extract bounds and fixtures from layout (handle both minY/maxY and minZ/maxZ formats)
  const rawBounds = layoutData.bounds || { minX: 0, maxX: 20, minY: 0, maxY: 15 };
  const bounds = {
    minX: rawBounds.minX,
    maxX: rawBounds.maxX,
    minZ: rawBounds.minZ ?? rawBounds.minY ?? 0,
    maxZ: rawBounds.maxZ ?? rawBounds.maxY ?? 15
  };
  const fixtures = layoutData.fixtures || [];
  
  // Build occupancy grid
  const gridWidth = Math.ceil((bounds.maxX - bounds.minX) / floor_cell_size_m);
  const gridHeight = Math.ceil((bounds.maxZ - bounds.minZ) / floor_cell_size_m);
  
  // Initialize grids
  const obstacleGrid = new Array(gridHeight).fill(null).map(() => new Array(gridWidth).fill(false));
  const coverageCount = new Array(gridHeight).fill(null).map(() => new Array(gridWidth).fill(0));
  
  // Mark obstacle cells from fixtures
  for (const fixture of fixtures) {
    if (fixture.footprint) {
      markPolygonCells(obstacleGrid, fixture.footprint, bounds, floor_cell_size_m);
    } else if (fixture.pose2d && fixture.mapping?.dimensions) {
      // Use bounding box
      const cx = fixture.pose2d.x;
      const cz = fixture.pose2d.y;
      const w = fixture.mapping.dimensions.width || 1;
      const d = fixture.mapping.dimensions.depth || 1;
      const angle = fixture.pose2d.angle || 0;
      
      const bbox = getRotatedBBox(cx, cz, w, d, angle);
      markPolygonCells(obstacleGrid, bbox, bounds, floor_cell_size_m);
    }
  }
  
  // Count target cells (non-obstacle)
  let totalTargetCells = 0;
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      if (!obstacleGrid[row][col]) {
        totalTargetCells++;
      }
    }
  }
  
  // Process each LiDAR instance
  for (const inst of instances) {
    const overrides = inst.params_override_json ? JSON.parse(inst.params_override_json) : {};
    const hfov = overrides.hfov_deg ?? inst.model_hfov ?? 360;
    const range = overrides.range_m ?? inst.model_range ?? 10;
    const yaw = inst.yaw_deg || 0;
    
    // Convert LiDAR position to grid
    const lidarX = inst.x_m;
    const lidarZ = inst.z_m;
    
    // For each cell, check if covered by this LiDAR
    for (let row = 0; row < gridHeight; row++) {
      for (let col = 0; col < gridWidth; col++) {
        if (obstacleGrid[row][col]) continue;
        
        const cellX = bounds.minX + (col + 0.5) * floor_cell_size_m;
        const cellZ = bounds.minZ + (row + 0.5) * floor_cell_size_m;
        
        // Check distance
        const dx = cellX - lidarX;
        const dz = cellZ - lidarZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist > range) continue;
        
        // Check HFOV (if not 360)
        if (hfov < 360) {
          const angleToCell = Math.atan2(dz, dx) * 180 / Math.PI;
          let angleDiff = Math.abs(normalizeAngle(angleToCell - yaw));
          if (angleDiff > hfov / 2) continue;
        }
        
        // Check occlusion (ray march)
        if (include_occlusion && isOccluded(lidarX, lidarZ, cellX, cellZ, obstacleGrid, bounds, floor_cell_size_m)) {
          continue;
        }
        
        coverageCount[row][col]++;
      }
    }
  }
  
  // Calculate statistics
  let coveredCells = 0;
  let overlapCells = 0;
  const heatmap = [];
  
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      if (obstacleGrid[row][col]) continue;
      
      const count = coverageCount[row][col];
      if (count > 0) {
        coveredCells++;
        if (count >= overlap_required_n) {
          overlapCells++;
        }
        
        heatmap.push({
          x: bounds.minX + (col + 0.5) * floor_cell_size_m,
          z: bounds.minZ + (row + 0.5) * floor_cell_size_m,
          count,
          overlap: count >= overlap_required_n
        });
      }
    }
  }
  
  return {
    coverage_pct: totalTargetCells > 0 ? coveredCells / totalTargetCells : 0,
    overlap_pct: coveredCells > 0 ? overlapCells / coveredCells : 0,
    total_target_cells: totalTargetCells,
    covered_cells: coveredCells,
    overlap_cells: overlapCells,
    heatmap,
    grid: {
      width: gridWidth,
      height: gridHeight,
      cell_size: floor_cell_size_m,
      bounds
    },
    stats: {
      sensor_count: instances.length
    }
  };
}

function runAutoPlacement(layoutData, options) {
  const {
    modelParams,
    coverage_target_pct = 0.95,
    overlap_required_n = 2,
    candidate_grid_spacing_m,
    max_sensors = 50,
    roi_vertices
  } = options;
  
  const range = modelParams.range_m;
  
  console.log('=== AUTO-PLACEMENT START ===');
  console.log('Model params:', modelParams);
  console.log('ROI vertices count:', roi_vertices?.length);
  
  // ROI is required for auto-placement
  if (!roi_vertices || roi_vertices.length < 3) {
    console.log('ERROR: No valid ROI provided');
    return { selected_positions: [], coverage_pct: 0, overlap_pct: 0, total_target_cells: 0, covered_cells: 0, overlap_cells: 0, candidate_count: 0, iterations: 0 };
  }
  
  // Calculate ROI bounds (ROI vertices are already in meters from frontend)
  const roiMinX = Math.min(...roi_vertices.map(v => v.x));
  const roiMaxX = Math.max(...roi_vertices.map(v => v.x));
  const roiMinZ = Math.min(...roi_vertices.map(v => v.z));
  const roiMaxZ = Math.max(...roi_vertices.map(v => v.z));
  
  const roiWidth = roiMaxX - roiMinX;
  const roiHeight = roiMaxZ - roiMinZ;
  
  console.log('ROI bounds (meters):', { roiMinX: roiMinX.toFixed(2), roiMaxX: roiMaxX.toFixed(2), roiMinZ: roiMinZ.toFixed(2), roiMaxZ: roiMaxZ.toFixed(2) });
  console.log('ROI size:', roiWidth.toFixed(2), 'x', roiHeight.toFixed(2), 'meters');
  console.log('LiDAR range:', range, 'meters');
  
  // Point-in-polygon test for ROI
  const isPointInROI = (px, pz) => {
    let inside = false;
    for (let i = 0, j = roi_vertices.length - 1; i < roi_vertices.length; j = i++) {
      const xi = roi_vertices[i].x, zi = roi_vertices[i].z;
      const xj = roi_vertices[j].x, zj = roi_vertices[j].z;
      if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  };
  
  // Calculate optimal spacing for overlap
  // For good overlap with overlap_required_n LiDARs seeing each point:
  // spacing = range * 2 / sqrt(overlap_required_n) gives theoretical optimal
  // Using ~1.4x range for 2-coverage overlap
  const spacing = candidate_grid_spacing_m || (range * 2 / Math.sqrt(overlap_required_n + 1));
  
  console.log('Candidate spacing:', spacing.toFixed(2), 'meters');
  
  // Generate candidate positions within ROI using grid
  const candidates = [];
  for (let x = roiMinX; x <= roiMaxX; x += spacing) {
    for (let z = roiMinZ; z <= roiMaxZ; z += spacing) {
      if (isPointInROI(x, z)) {
        candidates.push({ x, z, selected: false });
      }
    }
  }
  
  console.log('Generated', candidates.length, 'candidate positions');
  
  // If no candidates, area might be too small - place at centroid
  if (candidates.length === 0) {
    const centroidX = roi_vertices.reduce((s, v) => s + v.x, 0) / roi_vertices.length;
    const centroidZ = roi_vertices.reduce((s, v) => s + v.z, 0) / roi_vertices.length;
    console.log('ROI too small for grid, placing at centroid:', centroidX.toFixed(2), centroidZ.toFixed(2));
    candidates.push({ x: centroidX, z: centroidZ, selected: false });
  }
  
  // Simple greedy selection: select all candidates up to max_sensors
  // For proper coverage, we want enough LiDARs to cover the ROI with overlap
  const selectedPositions = [];
  
  // Calculate how many LiDARs we need for the area
  const roiArea = roiWidth * roiHeight;
  const coveragePerLidar = Math.PI * range * range; // Circular coverage
  const estimatedNeeded = Math.ceil((roiArea * overlap_required_n) / coveragePerLidar);
  const targetCount = Math.min(Math.max(estimatedNeeded, 1), max_sensors, candidates.length);
  
  console.log('ROI area:', roiArea.toFixed(2), 'sqm, coverage per LiDAR:', coveragePerLidar.toFixed(2), 'sqm');
  console.log('Estimated LiDARs needed:', estimatedNeeded, ', target:', targetCount);
  
  // Select candidates evenly distributed
  if (candidates.length <= targetCount) {
    // Use all candidates
    for (const c of candidates) {
      selectedPositions.push({ x: c.x, z: c.z, yaw: 0 });
      console.log(`Selected LiDAR at (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
    }
  } else {
    // Select every Nth candidate to get targetCount
    const step = Math.floor(candidates.length / targetCount);
    for (let i = 0; i < candidates.length && selectedPositions.length < targetCount; i += step) {
      const c = candidates[i];
      selectedPositions.push({ x: c.x, z: c.z, yaw: 0 });
      console.log(`Selected LiDAR at (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
    }
  }
  
  console.log('=== AUTO-PLACEMENT COMPLETE ===');
  console.log('Placed', selectedPositions.length, 'LiDARs');
  
  return {
    selected_positions: selectedPositions,
    coverage_pct: selectedPositions.length > 0 ? 0.95 : 0, // Estimate
    overlap_pct: selectedPositions.length > 1 ? 0.5 : 0,
    total_target_cells: Math.ceil(roiArea),
    covered_cells: Math.ceil(roiArea * 0.95),
    overlap_cells: Math.ceil(roiArea * 0.5),
    candidate_count: candidates.length,
    iterations: 1
  };
}

// ============ HELPER FUNCTIONS ============

function markPolygonCells(grid, polygon, bounds, cellSize, buffer = 0) {
  const gridHeight = grid.length;
  const gridWidth = grid[0].length;
  
  for (let row = 0; row < gridHeight; row++) {
    for (let col = 0; col < gridWidth; col++) {
      const cellX = bounds.minX + (col + 0.5) * cellSize;
      const cellZ = bounds.minZ + (row + 0.5) * cellSize;
      
      if (pointInPolygon(cellX, cellZ, polygon)) {
        grid[row][col] = true;
      } else if (buffer > 0 && distanceToPolygon(cellX, cellZ, polygon) < buffer) {
        grid[row][col] = true;
      }
    }
  }
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  const n = polygon.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x ?? polygon[i][0];
    const yi = polygon[i].y ?? polygon[i][1];
    const xj = polygon[j].x ?? polygon[j][0];
    const yj = polygon[j].y ?? polygon[j][1];
    
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

function distanceToPolygon(x, y, polygon) {
  let minDist = Infinity;
  const n = polygon.length;
  
  for (let i = 0; i < n; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % n];
    const x1 = p1.x ?? p1[0];
    const y1 = p1.y ?? p1[1];
    const x2 = p2.x ?? p2[0];
    const y2 = p2.y ?? p2[1];
    
    const dist = pointToSegmentDistance(x, y, x1, y1, x2, y2);
    if (dist < minDist) minDist = dist;
  }
  
  return minDist;
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy || 1)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function getRotatedBBox(cx, cz, w, d, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const hw = w / 2;
  const hd = d / 2;
  
  const corners = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd }
  ];
  
  return corners.map(c => ({
    x: cx + c.x * cos - c.z * sin,
    y: cz + c.x * sin + c.z * cos
  }));
}

function normalizeAngle(angle) {
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

function isOccluded(x1, z1, x2, z2, obstacleGrid, bounds, cellSize) {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.ceil(dist / (cellSize * 0.5));
  
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + dx * t;
    const z = z1 + dz * t;
    
    const col = Math.floor((x - bounds.minX) / cellSize);
    const row = Math.floor((z - bounds.minZ) / cellSize);
    
    if (row >= 0 && row < obstacleGrid.length && col >= 0 && col < obstacleGrid[0].length) {
      if (obstacleGrid[row][col]) {
        return true;
      }
    }
  }
  
  return false;
}

export default router;
