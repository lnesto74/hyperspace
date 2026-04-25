import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { venueQueries, objectQueries, placementQueries } from '../database/schema.js';

const DEFAULT_GROCERY_CATEGORIES = [
  'Carne', 'Pesce', 'Verdura', 'Frutta', 'Acqua', 'Surgelati', 'Pane',
  'Latticini', 'Salumi', 'Dispensa', 'Bevande', 'Cura casa', 'Cura persona'
];

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function ensureDefaultCategories(db, companyId) {
  const existing = db.prepare('SELECT COUNT(*) as count FROM company_categories WHERE company_id = ?').get(companyId);
  if (existing?.count > 0) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO company_categories (id, company_id, name, slug, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const tx = db.transaction(() => {
    DEFAULT_GROCERY_CATEGORIES.forEach((name, index) => {
      insert.run(uuidv4(), companyId, name, slugify(name), index);
    });
  });
  tx();
}

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
        company_id: v.company_id || null,
        address: v.address || null,
        latitude: v.latitude || null,
        longitude: v.longitude || null,
        place_id: v.place_id || null,
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

      let objects = objectQueries.getByVenueId(db, req.params.id);
      const placements = placementQueries.getByVenueId(db, req.params.id);

      // ── LIVE TYPE OVERLAY ──
      // For DWG venues, overlay CURRENT dwg_mappings types onto stored venue_objects.
      // This ensures the 3D view always reflects the latest fixture classifications
      // from DWG Importer, even without re-bootstrapping the entire venue.
      if (venue.dwg_layout_version_id && objects.length > 0) {
        try {
          // Get the import_id from the layout
          const layout = db.prepare('SELECT import_id FROM dwg_layout_versions WHERE id = ?')
            .get(venue.dwg_layout_version_id);
          
          if (layout?.import_id) {
            // Get current dwg_mappings
            const mappingRow = db.prepare('SELECT mapping_json FROM dwg_mappings WHERE import_id = ?')
              .get(layout.import_id);
            
            if (mappingRow?.mapping_json) {
              const mappings = JSON.parse(mappingRow.mapping_json);
              const groupMappings = mappings.group_mappings || {};
              
              if (Object.keys(groupMappings).length > 0) {
                // Build a map: dwg_fixture_id → group_id from layout_json
                const layoutRow = db.prepare('SELECT layout_json FROM dwg_layout_versions WHERE id = ?')
                  .get(venue.dwg_layout_version_id);
                
                if (layoutRow?.layout_json) {
                  const layoutData = JSON.parse(layoutRow.layout_json);
                  const fixtureToGroup = new Map();
                  (layoutData.fixtures || []).forEach(f => {
                    if (f.id && f.group_id) fixtureToGroup.set(f.id, f.group_id);
                  });
                  
                  // Overlay types: match object's dwg_fixture_id → group_id → current mapping type
                  let overlayCount = 0;
                  objects = objects.map(obj => {
                    const dwgFixtureId = obj.metadata?.dwg_fixture_id;
                    if (!dwgFixtureId) return obj;
                    
                    const groupId = fixtureToGroup.get(dwgFixtureId);
                    if (!groupId) return obj;
                    
                    const liveMapping = groupMappings[groupId];
                    if (liveMapping?.type || liveMapping?.business_category) {
                      overlayCount++;
                      return {
                        ...obj,
                        type: liveMapping.type || obj.type,
                        metadata: {
                          ...(obj.metadata || {}),
                          business_category_id: liveMapping.business_category_id || null,
                          business_category: liveMapping.business_category || null,
                          business_category_label: liveMapping.business_category_label || null,
                        },
                      };
                    }
                    return obj;
                  });
                  
                  if (overlayCount > 0) {
                    console.log(`[Venues] Live type overlay: updated ${overlayCount} objects from dwg_mappings`);
                  }
                }
              }
            }
          }
        } catch (overlayErr) {
          console.warn('[Venues] Failed to overlay dwg_mappings:', overlayErr.message);
        }
      }

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
          company_id: venue.company_id || null,
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

  // Delete a single venue object
  router.delete('/:id/objects/:objectId', (req, res) => {
    try {
      const result = db.prepare('DELETE FROM venue_objects WHERE id = ? AND venue_id = ?')
        .run(req.params.objectId, req.params.id);
      if (result.changes === 0) {
        return res.status(404).json({ error: 'Object not found' });
      }
      res.json({ success: true });
    } catch (error) {
      console.error('Delete object error:', error);
      res.status(500).json({ error: 'Failed to delete object' });
    }
  });

  // Delete multiple venue objects
  router.post('/:id/objects/delete-batch', (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({ error: 'ids array required' });
      }
      const stmt = db.prepare('DELETE FROM venue_objects WHERE id = ? AND venue_id = ?');
      const deleteMany = db.transaction((objectIds) => {
        let deleted = 0;
        for (const objectId of objectIds) {
          deleted += stmt.run(objectId, req.params.id).changes;
        }
        return deleted;
      });
      const deleted = deleteMany(ids);
      res.json({ success: true, deleted });
    } catch (error) {
      console.error('Batch delete objects error:', error);
      res.status(500).json({ error: 'Failed to delete objects' });
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

  // Update venue address/location (Google Places data)
  router.patch('/:id/address', (req, res) => {
    try {
      const { address, latitude, longitude, place_id } = req.body;
      const venue = venueQueries.getById(db, req.params.id);
      if (!venue) {
        return res.status(404).json({ error: 'Venue not found' });
      }

      db.prepare(`
        UPDATE venues SET address = ?, latitude = ?, longitude = ?, place_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(address || null, latitude || null, longitude || null, place_id || null, req.params.id);

      res.json({ success: true });
    } catch (error) {
      console.error('Update venue address error:', error);
      res.status(500).json({ error: 'Failed to update venue address' });
    }
  });

  // Update venue company assignment
  router.patch('/:id/company', (req, res) => {
    try {
      const { company_id } = req.body;
      const venue = venueQueries.getById(db, req.params.id);
      if (!venue) {
        return res.status(404).json({ error: 'Venue not found' });
      }

      db.prepare("UPDATE venues SET company_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(company_id || null, req.params.id);

      res.json({ success: true });
    } catch (error) {
      console.error('Update venue company error:', error);
      res.status(500).json({ error: 'Failed to update venue company' });
    }
  });

  // Get company-level retail categories for the venue.
  // The DWG importer uses this to assign semantic grocery categories
  // independently from the 3D asset type.
  router.get('/:id/retail-categories', (req, res) => {
    try {
      const venue = venueQueries.getById(db, req.params.id);
      if (!venue) {
        return res.status(404).json({ error: 'Venue not found' });
      }

      if (!venue.company_id) {
        return res.json({
          company_id: null,
          categories: DEFAULT_GROCERY_CATEGORIES.map((name, index) => ({
            id: `default-${slugify(name)}`,
            company_id: null,
            name,
            slug: slugify(name),
            color: null,
            sort_order: index,
            is_default: true,
          })),
        });
      }

      ensureDefaultCategories(db, venue.company_id);
      const categories = db.prepare(`
        SELECT id, company_id, name, slug, color, sort_order, created_at, updated_at
        FROM company_categories
        WHERE company_id = ?
        ORDER BY sort_order ASC, name ASC
      `).all(venue.company_id);

      res.json({ company_id: venue.company_id, categories });
    } catch (error) {
      console.error('Get venue retail categories error:', error);
      res.status(500).json({ error: 'Failed to get retail categories' });
    }
  });

  // Add a retail category through a venue context. Requires the venue to be
  // assigned to a company so categories remain company-specific.
  router.post('/:id/retail-categories', (req, res) => {
    try {
      const venue = venueQueries.getById(db, req.params.id);
      if (!venue) {
        return res.status(404).json({ error: 'Venue not found' });
      }
      if (!venue.company_id) {
        return res.status(400).json({ error: 'Venue must be assigned to a company before adding categories' });
      }

      const { name, color } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Category name is required' });
      }

      const cleanName = String(name).trim();
      const slug = slugify(cleanName);
      const existing = db.prepare(`
        SELECT * FROM company_categories WHERE company_id = ? AND slug = ?
      `).get(venue.company_id, slug);
      if (existing) {
        return res.json(existing);
      }

      const nextOrder = db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order
        FROM company_categories WHERE company_id = ?
      `).get(venue.company_id)?.next_order || 0;

      const id = uuidv4();
      db.prepare(`
        INSERT INTO company_categories (id, company_id, name, slug, color, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(id, venue.company_id, cleanName, slug, color || null, nextOrder);

      const category = db.prepare('SELECT * FROM company_categories WHERE id = ?').get(id);
      res.status(201).json(category);
    } catch (error) {
      console.error('Create venue retail category error:', error);
      res.status(500).json({ error: 'Failed to create retail category' });
    }
  });

  // Link venue to a DWG layout version (called when layout is generated in DWG Importer)
  router.patch('/:id/dwg-layout', (req, res) => {
    try {
      const { dwg_layout_version_id } = req.body;
      const venue = venueQueries.getById(db, req.params.id);
      if (!venue) {
        return res.status(404).json({ error: 'Venue not found' });
      }
      db.prepare(`
        UPDATE venues SET dwg_layout_version_id = ?, scene_source = 'dwg', updated_at = datetime('now')
        WHERE id = ?
      `).run(dwg_layout_version_id || null, req.params.id);
      console.log(`🔗 Venue ${req.params.id} linked to DWG layout: ${dwg_layout_version_id}`);
      res.json({ success: true, dwg_layout_version_id });
    } catch (error) {
      console.error('Update venue DWG layout error:', error);
      res.status(500).json({ error: 'Failed to update venue DWG layout' });
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
