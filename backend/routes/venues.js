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
          createdAt: venue.created_at,
          updatedAt: venue.updated_at,
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

  return router;
}
