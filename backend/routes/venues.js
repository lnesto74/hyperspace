import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { venueQueries, objectQueries, placementQueries } from '../database/schema.js';

export default function venuesRoutes(db) {
  const router = Router();

  // Get all venues
  router.get('/', (req, res) => {
    try {
      const venues = venueQueries.getAll(db);
      res.json(venues.map(v => ({
        id: v.id,
        name: v.name,
        width: v.width,
        depth: v.depth,
        height: v.height,
        tileSize: v.tile_size,
        createdAt: v.created_at,
        updatedAt: v.updated_at,
      })));
    } catch (error) {
      console.error('Get venues error:', error);
      res.status(500).json({ error: 'Failed to get venues' });
    }
  });

  // Get single venue with objects and placements
  router.get('/:id', (req, res) => {
    try {
      const venue = venueQueries.getById(db, req.params.id);
      if (!venue) {
        return res.status(404).json({ error: 'Venue not found' });
      }

      const objects = objectQueries.getByVenueId(db, req.params.id);
      const placements = placementQueries.getByVenueId(db, req.params.id);

      res.json({
        venue: {
          id: venue.id,
          name: venue.name,
          width: venue.width,
          depth: venue.depth,
          height: venue.height,
          tileSize: venue.tile_size,
          maxCapacity: venue.max_capacity || 300,
          defaultDwellThresholdSec: venue.default_dwell_threshold_sec || 60,
          defaultEngagementThresholdSec: venue.default_engagement_threshold_sec || 120,
          createdAt: venue.created_at,
          updatedAt: venue.updated_at,
          scene_source: venue.scene_source,
          dwg_layout_version_id: venue.dwg_layout_version_id,
        },
        objects,
        placements,
      });
    } catch (error) {
      console.error('Get venue error:', error);
      res.status(500).json({ error: 'Failed to get venue' });
    }
  });

  // Create venue
  router.post('/', (req, res) => {
    try {
      const { name, width, depth, height, tileSize } = req.body;
      
      const venue = {
        id: uuidv4(),
        name: name || 'New Venue',
        width: width || 20,
        depth: depth || 15,
        height: height || 4,
        tileSize: tileSize || 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      venueQueries.create(db, venue);
      res.status(201).json(venue);
    } catch (error) {
      console.error('Create venue error:', error);
      res.status(500).json({ error: 'Failed to create venue' });
    }
  });

  // Update venue with objects and placements (upsert)
  router.put('/:id', (req, res) => {
    try {
      const { venue, objects, placements } = req.body;
      const venueId = req.params.id;
      
      // Check if venue exists, if not create it (upsert)
      const existingVenue = venueQueries.getById(db, venueId);
      
      if (!existingVenue) {
        // Create the venue first
        if (venue) {
          venueQueries.create(db, {
            id: venueId,
            name: venue.name || 'New Venue',
            width: venue.width || 20,
            depth: venue.depth || 15,
            height: venue.height || 4,
            tileSize: venue.tileSize || 1,
            sceneSource: venue.scene_source || 'manual',
            dwgLayoutVersionId: venue.dwg_layout_version_id || null,
            dwgTransformJson: venue.dwg_transform_json || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        } else {
          // No venue data provided for a new venue
          return res.status(400).json({ error: 'Venue data required for new venues' });
        }
      } else if (venue) {
        // Update existing venue
        venueQueries.update(db, venueId, venue);
      }

      // Replace objects
      if (objects) {
        objectQueries.deleteByVenueId(db, venueId);
        for (const obj of objects) {
          objectQueries.create(db, { ...obj, venueId });
        }
      }

      // Replace placements
      if (placements) {
        placementQueries.deleteByVenueId(db, venueId);
        for (const placement of placements) {
          placementQueries.create(db, { ...placement, venueId });
        }
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Update venue error:', error);
      res.status(500).json({ error: 'Failed to update venue', details: error.message });
    }
  });

  // Delete venue
  router.delete('/:id', (req, res) => {
    try {
      venueQueries.delete(db, req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Delete venue error:', error);
      res.status(500).json({ error: 'Failed to delete venue' });
    }
  });

  // Export venue as JSON
  router.get('/:id/export', (req, res) => {
    try {
      const venue = venueQueries.getById(db, req.params.id);
      if (!venue) {
        return res.status(404).json({ error: 'Venue not found' });
      }

      const objects = objectQueries.getByVenueId(db, req.params.id);
      const placements = placementQueries.getByVenueId(db, req.params.id);

      const exportData = {
        venue: {
          name: venue.name,
          width: venue.width,
          depth: venue.depth,
          height: venue.height,
          tileSize: venue.tile_size,
        },
        objects,
        placements,
        exportedAt: new Date().toISOString(),
        version: '1.0',
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${venue.name}.json"`);
      res.json(exportData);
    } catch (error) {
      console.error('Export venue error:', error);
      res.status(500).json({ error: 'Failed to export venue' });
    }
  });

  // Import venue from JSON
  router.post('/import', (req, res) => {
    try {
      const { venue, objects, placements } = req.body;
      
      if (!venue) {
        return res.status(400).json({ error: 'Invalid import data' });
      }

      const newVenue = {
        id: uuidv4(),
        name: venue.name || 'Imported Venue',
        width: venue.width || 20,
        depth: venue.depth || 15,
        height: venue.height || 4,
        tileSize: venue.tileSize || 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      venueQueries.create(db, newVenue);

      // Import objects with new IDs
      if (objects) {
        for (const obj of objects) {
          objectQueries.create(db, {
            ...obj,
            id: uuidv4(),
            venueId: newVenue.id,
          });
        }
      }

      // Import placements with new IDs
      if (placements) {
        for (const placement of placements) {
          placementQueries.create(db, {
            ...placement,
            id: uuidv4(),
            venueId: newVenue.id,
          });
        }
      }

      res.status(201).json(newVenue);
    } catch (error) {
      console.error('Import venue error:', error);
      res.status(500).json({ error: 'Failed to import venue' });
    }
  });

  // ============================================
  // Venue Settings - Capacity and Defaults
  // ============================================

  // Update venue settings (capacity, thresholds)
  router.patch('/:venueId/settings', (req, res) => {
    try {
      const { venueId } = req.params;
      const { maxCapacity, defaultDwellThresholdSec, defaultEngagementThresholdSec } = req.body;

      const updates = [];
      const params = [];

      if (maxCapacity !== undefined) {
        updates.push('max_capacity = ?');
        params.push(maxCapacity);
      }
      if (defaultDwellThresholdSec !== undefined) {
        updates.push('default_dwell_threshold_sec = ?');
        params.push(defaultDwellThresholdSec);
      }
      if (defaultEngagementThresholdSec !== undefined) {
        updates.push('default_engagement_threshold_sec = ?');
        params.push(defaultEngagementThresholdSec);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No settings to update' });
      }

      updates.push("updated_at = datetime('now')");
      params.push(venueId);

      db.prepare(`
        UPDATE venues SET ${updates.join(', ')} WHERE id = ?
      `).run(...params);

      res.json({ success: true, updated: updates.length - 1 });
    } catch (error) {
      console.error('Update venue settings error:', error);
      res.status(500).json({ error: 'Failed to update venue settings' });
    }
  });

  // ============================================
  // Venue KPI Thresholds - Narrator settings
  // ============================================

  // Get all KPI thresholds for a venue
  router.get('/:venueId/kpi-thresholds', (req, res) => {
    try {
      const { venueId } = req.params;
      const thresholds = db.prepare(`
        SELECT kpi_id, green_threshold, amber_threshold, direction, updated_at
        FROM venue_kpi_thresholds
        WHERE venue_id = ?
      `).all(venueId);

      // Return as object keyed by kpi_id for easy lookup
      const thresholdMap = {};
      for (const t of thresholds) {
        thresholdMap[t.kpi_id] = {
          green: t.green_threshold,
          amber: t.amber_threshold,
          direction: t.direction,
          updatedAt: t.updated_at,
        };
      }

      res.json({ venueId, thresholds: thresholdMap });
    } catch (error) {
      console.error('Get KPI thresholds error:', error);
      res.status(500).json({ error: 'Failed to get KPI thresholds' });
    }
  });

  // Update KPI thresholds for a venue (bulk upsert)
  router.put('/:venueId/kpi-thresholds', (req, res) => {
    try {
      const { venueId } = req.params;
      const { thresholds } = req.body;

      if (!thresholds || typeof thresholds !== 'object') {
        return res.status(400).json({ error: 'thresholds object is required' });
      }

      const upsertStmt = db.prepare(`
        INSERT INTO venue_kpi_thresholds (venue_id, kpi_id, green_threshold, amber_threshold, direction, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(venue_id, kpi_id) DO UPDATE SET
          green_threshold = excluded.green_threshold,
          amber_threshold = excluded.amber_threshold,
          direction = excluded.direction,
          updated_at = datetime('now')
      `);

      const upsertMany = db.transaction((items) => {
        for (const [kpiId, config] of Object.entries(items)) {
          upsertStmt.run(
            venueId,
            kpiId,
            config.green,
            config.amber,
            config.direction || 'higher'
          );
        }
      });

      upsertMany(thresholds);

      res.json({ success: true, updated: Object.keys(thresholds).length });
    } catch (error) {
      console.error('Update KPI thresholds error:', error);
      res.status(500).json({ error: 'Failed to update KPI thresholds' });
    }
  });

  // Delete a specific KPI threshold (reset to default)
  router.delete('/:venueId/kpi-thresholds/:kpiId', (req, res) => {
    try {
      const { venueId, kpiId } = req.params;
      
      const result = db.prepare(`
        DELETE FROM venue_kpi_thresholds
        WHERE venue_id = ? AND kpi_id = ?
      `).run(venueId, kpiId);

      res.json({ success: true, deleted: result.changes });
    } catch (error) {
      console.error('Delete KPI threshold error:', error);
      res.status(500).json({ error: 'Failed to delete KPI threshold' });
    }
  });

  return router;
}
