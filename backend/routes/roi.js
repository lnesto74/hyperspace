import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { roiQueries } from '../database/schema.js';

export default function createRoiRoutes(db) {
  const router = Router();

  // Get all ROIs for a venue (manual mode - dwg_layout_id IS NULL)
  router.get('/venues/:venueId/roi', (req, res) => {
    try {
      // If ?all=true, return all ROIs regardless of dwgLayoutId
      if (req.query.all === 'true') {
        const rois = db.prepare(`
          SELECT * FROM regions_of_interest WHERE venue_id = ?
        `).all(req.params.venueId).map(row => ({
          id: row.id,
          venueId: row.venue_id,
          dwgLayoutId: row.dwg_layout_id,
          name: row.name,
          vertices: JSON.parse(row.vertices),
          color: row.color,
          opacity: row.opacity,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
        return res.json(rois);
      }
      const rois = roiQueries.getByVenueId(db, req.params.venueId);
      res.json(rois);
    } catch (err) {
      console.error('Failed to get ROIs:', err);
      res.status(500).json({ error: 'Failed to get ROIs' });
    }
  });

  // Get all ROIs for a DWG layout
  // Query params:
  //   ?units=meters — convert vertices from DXF units to meters (for 3D views)
  //   (default) — return raw DXF units (for 2D LaunchPad views)
  router.get('/venues/:venueId/dwg/:dwgLayoutId/roi', (req, res) => {
    try {
      const { dwgLayoutId } = req.params;
      const wantMeters = req.query.units === 'meters';
      const rois = roiQueries.getByDwgLayoutId(db, req.params.venueId, dwgLayoutId);
      
      // No conversion needed - ROIs are stored in their native units:
      // - Smart KPI ROIs: stored in meters
      // - User-created ROIs from RoiPanel: stored in meters  
      // - LaunchPad ROIs: stored in meters (lidar_roi_json handles sizing)
      // The ?units=meters param is kept for API compatibility but does nothing now
      
      res.json(rois);
    } catch (err) {
      console.error('Failed to get DWG ROIs:', err);
      res.status(500).json({ error: 'Failed to get DWG ROIs' });
    }
  });

  // Get a single ROI
  router.get('/roi/:id', (req, res) => {
    try {
      const roi = roiQueries.getById(db, req.params.id);
      if (!roi) {
        return res.status(404).json({ error: 'ROI not found' });
      }
      res.json(roi);
    } catch (err) {
      console.error('Failed to get ROI:', err);
      res.status(500).json({ error: 'Failed to get ROI' });
    }
  });

  // Create a new ROI (manual mode - no dwgLayoutId)
  router.post('/venues/:venueId/roi', (req, res) => {
    try {
      const { name, vertices, color, opacity, metadata } = req.body;
      
      if (!name || !vertices || vertices.length < 3) {
        return res.status(400).json({ error: 'Name and at least 3 vertices required' });
      }

      const now = new Date().toISOString();
      const roi = {
        id: uuidv4(),
        venueId: req.params.venueId,
        dwgLayoutId: null,  // Manual mode
        name,
        vertices,
        color: color || '#f59e0b',
        opacity: opacity ?? 0.5,
        metadata: metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };

      roiQueries.create(db, roi);
      res.status(201).json(roi);
    } catch (err) {
      console.error('Failed to create ROI:', err);
      res.status(500).json({ error: 'Failed to create ROI' });
    }
  });

  // Create a new ROI for DWG layout
  router.post('/venues/:venueId/dwg/:dwgLayoutId/roi', (req, res) => {
    try {
      const { name, vertices, color, opacity, metadata } = req.body;
      const { dwgLayoutId } = req.params;
      
      if (!name || !vertices || vertices.length < 3) {
        return res.status(400).json({ error: 'Name and at least 3 vertices required' });
      }

      const now = new Date().toISOString();
      const roi = {
        id: uuidv4(),
        venueId: req.params.venueId,
        dwgLayoutId,  // DWG mode
        name,
        vertices,
        color: color || '#f59e0b',
        opacity: opacity ?? 0.5,
        metadata: metadata ?? null,
        createdAt: now,
        updatedAt: now,
      };

      roiQueries.create(db, roi);
      
      // ── CRITICAL FIX: Also write to lidar_roi_json in METERS ──
      // RoiDrawingModal sends vertices in DXF units (e.g., mm).
      // as-venue-bootstrap reads lidar_roi_json for venue sizing and expects METERS.
      // Without this, LaunchPad venues get wrong dimensions.
      try {
        // Get unit scale from dwg_layout_versions → dwg_imports
        const layoutRow = db.prepare(`
          SELECT lv.import_id, di.unit_scale_to_m, lv.scale_correction
          FROM dwg_layout_versions lv
          LEFT JOIN dwg_imports di ON lv.import_id = di.id
          WHERE lv.id = ?
        `).get(dwgLayoutId);
        
        if (layoutRow) {
          const unitScale = layoutRow.unit_scale_to_m || 0.001; // default mm→m
          const scaleCorrection = layoutRow.scale_correction || 1.0;
          const effectiveScale = unitScale * scaleCorrection;
          
          // Convert DXF vertices {x, z} to meters
          // Vertices come as {x, z} where z is the DXF Y coordinate
          const roiMeters = vertices.map(v => ({
            x: (v.x || 0) * effectiveScale,
            z: (v.z || v.y || 0) * effectiveScale,
          }));
          
          // Write to lidar_roi_json
          db.prepare('UPDATE dwg_layout_versions SET lidar_roi_json = ? WHERE id = ?')
            .run(JSON.stringify(roiMeters), dwgLayoutId);
          
          console.log(`[ROI] Wrote lidar_roi_json (${roiMeters.length} vertices) to layout ${dwgLayoutId.substring(0,8)} in METERS (scale=${effectiveScale})`);
          
          // Log bounds for debugging
          const xs = roiMeters.map(v => v.x);
          const zs = roiMeters.map(v => v.z);
          console.log(`[ROI] Bounds: X[${Math.min(...xs).toFixed(1)}, ${Math.max(...xs).toFixed(1)}] Z[${Math.min(...zs).toFixed(1)}, ${Math.max(...zs).toFixed(1)}] meters`);
        }
      } catch (e) {
        console.warn('[ROI] Failed to write lidar_roi_json:', e.message);
        // Non-fatal — ROI is still saved to regions_of_interest
      }
      
      res.status(201).json(roi);
    } catch (err) {
      console.error('Failed to create DWG ROI:', err);
      res.status(500).json({ error: 'Failed to create DWG ROI' });
    }
  });

  // Update an ROI
  router.put('/roi/:id', (req, res) => {
    try {
      const existing = roiQueries.getById(db, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'ROI not found' });
      }

      const { name, vertices, color, opacity, metadata } = req.body;
      
      const updated = {
        name: name ?? existing.name,
        vertices: vertices ?? existing.vertices,
        color: color ?? existing.color,
        opacity: opacity ?? existing.opacity,
        metadata: metadata !== undefined ? metadata : existing.metadata,
      };

      if (updated.vertices.length < 3) {
        return res.status(400).json({ error: 'At least 3 vertices required' });
      }

      roiQueries.update(db, req.params.id, updated);
      
      const roi = roiQueries.getById(db, req.params.id);
      res.json(roi);
    } catch (err) {
      console.error('Failed to update ROI:', err);
      res.status(500).json({ error: 'Failed to update ROI' });
    }
  });

  // Delete an ROI
  router.delete('/roi/:id', (req, res) => {
    try {
      const existing = roiQueries.getById(db, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'ROI not found' });
      }

      roiQueries.delete(db, req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('Failed to delete ROI:', err);
      res.status(500).json({ error: 'Failed to delete ROI' });
    }
  });

  return router;
}
