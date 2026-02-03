import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { roiQueries } from '../database/schema.js';

export default function createRoiRoutes(db) {
  const router = Router();

  // Get all ROIs for a venue
  router.get('/venues/:venueId/roi', (req, res) => {
    try {
      const rois = roiQueries.getByVenueId(db, req.params.venueId);
      res.json(rois);
    } catch (err) {
      console.error('Failed to get ROIs:', err);
      res.status(500).json({ error: 'Failed to get ROIs' });
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

  // Create a new ROI
  router.post('/venues/:venueId/roi', (req, res) => {
    try {
      const { name, vertices, color, opacity } = req.body;
      
      if (!name || !vertices || vertices.length < 3) {
        return res.status(400).json({ error: 'Name and at least 3 vertices required' });
      }

      const now = new Date().toISOString();
      const roi = {
        id: uuidv4(),
        venueId: req.params.venueId,
        name,
        vertices,
        color: color || '#f59e0b',
        opacity: opacity ?? 0.5,
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

  // Update an ROI
  router.put('/roi/:id', (req, res) => {
    try {
      const existing = roiQueries.getById(db, req.params.id);
      if (!existing) {
        return res.status(404).json({ error: 'ROI not found' });
      }

      const { name, vertices, color, opacity } = req.body;
      
      const updated = {
        name: name ?? existing.name,
        vertices: vertices ?? existing.vertices,
        color: color ?? existing.color,
        opacity: opacity ?? existing.opacity,
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
