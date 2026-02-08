import { Router } from 'express';
import SmartKpiService from '../services/SmartKpiService.js';

export default function createSmartKpiRoutes(db) {
  const router = Router();
  const smartKpiService = new SmartKpiService(db);

  // Get all available smart KPI templates
  router.get('/templates', (req, res) => {
    try {
      const templates = SmartKpiService.getTemplates();
      res.json(templates);
    } catch (err) {
      console.error('Failed to get templates:', err);
      res.status(500).json({ error: 'Failed to get templates' });
    }
  });

  // Analyze venue and return available smart KPIs based on objects
  router.get('/venues/:venueId/analyze', (req, res) => {
    try {
      const analysis = smartKpiService.analyzeVenue(req.params.venueId);
      
      if (analysis.error) {
        return res.status(404).json({ error: analysis.error });
      }
      
      res.json(analysis);
    } catch (err) {
      console.error('Failed to analyze venue:', err);
      res.status(500).json({ error: 'Failed to analyze venue' });
    }
  });

  // Preview ROIs for a template (without saving)
  router.post('/venues/:venueId/preview/:templateId', (req, res) => {
    try {
      const { venueId, templateId } = req.params;
      const options = req.body || {};
      
      const result = smartKpiService.generateRoisForTemplate(venueId, templateId, options);
      
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({
        preview: true,
        ...result,
      });
    } catch (err) {
      console.error('Failed to preview ROIs:', err);
      res.status(500).json({ error: 'Failed to preview ROIs' });
    }
  });

  // Generate and save ROIs for a template
  router.post('/venues/:venueId/generate/:templateId', (req, res) => {
    try {
      const { venueId, templateId } = req.params;
      const options = req.body || {};
      
      // Generate ROIs
      const result = smartKpiService.generateRoisForTemplate(venueId, templateId, options);
      
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      
      // Save to database (this will delete existing zones for this template first)
      const savedRois = smartKpiService.saveRois(venueId, result.generatedRois, templateId);
      
      res.status(201).json({
        success: true,
        templateId,
        templateName: result.templateName,
        savedRois,
        kpis: result.kpis,
      });
    } catch (err) {
      console.error('Failed to generate ROIs:', err);
      res.status(500).json({ error: 'Failed to generate ROIs' });
    }
  });

  // ==================== DWG MODE ROUTES ====================

  // Analyze DWG layout and return available smart KPIs based on fixtures
  router.get('/dwg/:layoutId/venues/:venueId/analyze', (req, res) => {
    try {
      const { layoutId, venueId } = req.params;
      const analysis = smartKpiService.analyzeDwgLayout(layoutId, venueId);
      
      if (analysis.error) {
        return res.status(404).json({ error: analysis.error });
      }
      
      res.json(analysis);
    } catch (err) {
      console.error('Failed to analyze DWG layout:', err);
      res.status(500).json({ error: 'Failed to analyze DWG layout' });
    }
  });

  // Preview ROIs for a DWG template (without saving)
  router.post('/dwg/:layoutId/venues/:venueId/preview/:templateId', (req, res) => {
    try {
      const { layoutId, venueId, templateId } = req.params;
      const options = req.body || {};
      
      const result = smartKpiService.generateRoisForDwgTemplate(layoutId, venueId, templateId, options);
      
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json({
        preview: true,
        ...result,
      });
    } catch (err) {
      console.error('Failed to preview DWG ROIs:', err);
      res.status(500).json({ error: 'Failed to preview DWG ROIs' });
    }
  });

  // Generate and save ROIs for a DWG template
  router.post('/dwg/:layoutId/venues/:venueId/generate/:templateId', (req, res) => {
    try {
      const { layoutId, venueId, templateId } = req.params;
      const options = req.body || {};
      
      // Generate ROIs
      const result = smartKpiService.generateRoisForDwgTemplate(layoutId, venueId, templateId, options);
      
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      
      // Save to database with DWG layout ID for mode separation
      const savedRois = smartKpiService.saveRois(venueId, result.generatedRois, templateId, layoutId);
      
      res.status(201).json({
        success: true,
        templateId,
        templateName: result.templateName,
        savedRois,
        kpis: result.kpis,
        mode: 'dwg',
        dwgLayoutId: layoutId,
      });
    } catch (err) {
      console.error('Failed to generate DWG ROIs:', err);
      res.status(500).json({ error: 'Failed to generate DWG ROIs' });
    }
  });

  return router;
}
