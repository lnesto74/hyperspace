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
      
      // Combine generated ROIs with custom zones if provided
      // Custom zones need to be PROPAGATED to all fixtures of the same type
      let allRois = [...result.generatedRois];
      if (options.customZones && Array.isArray(options.customZones) && options.customZones.length > 0) {
        // Group generated ROIs by fixture (e.g., "Cashier 1", "Cashier 2")
        const fixtureGroups = {};
        result.generatedRois.forEach(roi => {
          const nameParts = roi.name.split(' - ');
          if (nameParts.length > 1) {
            const fixtureName = nameParts.slice(0, -1).join(' - ');
            if (!fixtureGroups[fixtureName]) {
              fixtureGroups[fixtureName] = [];
            }
            fixtureGroups[fixtureName].push(roi);
          }
        });
        
        const fixtureNames = Object.keys(fixtureGroups);
        if (fixtureNames.length > 0) {
          const refFixtureName = fixtureNames[0];
          const refRois = fixtureGroups[refFixtureName];
          
          let refCenterX = 0, refCenterZ = 0;
          refRois.forEach(roi => {
            const centerX = roi.vertices.reduce((sum, v) => sum + v.x, 0) / roi.vertices.length;
            const centerZ = roi.vertices.reduce((sum, v) => sum + v.z, 0) / roi.vertices.length;
            refCenterX += centerX;
            refCenterZ += centerZ;
          });
          refCenterX /= refRois.length;
          refCenterZ /= refRois.length;
          
          options.customZones.forEach((cz, czIdx) => {
            fixtureNames.forEach((fixtureName, fIdx) => {
              const fixtureRois = fixtureGroups[fixtureName];
              
              let fixCenterX = 0, fixCenterZ = 0;
              fixtureRois.forEach(roi => {
                const centerX = roi.vertices.reduce((sum, v) => sum + v.x, 0) / roi.vertices.length;
                const centerZ = roi.vertices.reduce((sum, v) => sum + v.z, 0) / roi.vertices.length;
                fixCenterX += centerX;
                fixCenterZ += centerZ;
              });
              fixCenterX /= fixtureRois.length;
              fixCenterZ /= fixtureRois.length;
              
              const offsetX = fixCenterX - refCenterX;
              const offsetZ = fixCenterZ - refCenterZ;
              
              const propagatedVertices = cz.vertices.map(v => ({
                x: v.x + offsetX,
                z: v.z + offsetZ,
              }));
              
              allRois.push({
                id: `custom-${Date.now()}-${czIdx}-${fIdx}`,
                name: `${fixtureName} - ${cz.name || `Custom ${czIdx + 1}`}`,
                vertices: propagatedVertices,
                color: '#10b981',
                opacity: 0.4,
                roiType: 'custom',
              });
            });
          });
          
          console.log(`[SmartKPI] Propagated ${options.customZones.length} custom zones to ${fixtureNames.length} fixtures`);
        }
      }
      
      // Save to database (this will delete existing zones for this template first)
      const savedRois = smartKpiService.saveRois(venueId, allRois, templateId);
      
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
      
      // Combine generated ROIs with custom zones if provided
      // Custom zones need to be PROPAGATED to all fixtures of the same type
      let allRois = [...result.generatedRois];
      if (options.customZones && Array.isArray(options.customZones) && options.customZones.length > 0) {
        // Group generated ROIs by fixture (e.g., "Cashier 1", "Cashier 2")
        // ROI names follow pattern: "Cashier 1 - Service", "Cashier 1 - Queue"
        const fixtureGroups = {};
        result.generatedRois.forEach(roi => {
          const nameParts = roi.name.split(' - ');
          if (nameParts.length > 1) {
            const fixtureName = nameParts.slice(0, -1).join(' - '); // e.g., "Cashier 1"
            if (!fixtureGroups[fixtureName]) {
              fixtureGroups[fixtureName] = [];
            }
            fixtureGroups[fixtureName].push(roi);
          }
        });
        
        const fixtureNames = Object.keys(fixtureGroups);
        if (fixtureNames.length > 0) {
          // Get reference fixture (first one) to calculate offsets
          const refFixtureName = fixtureNames[0];
          const refRois = fixtureGroups[refFixtureName];
          
          // Calculate reference center (average of first fixture's ROI centers)
          let refCenterX = 0, refCenterZ = 0;
          refRois.forEach(roi => {
            const centerX = roi.vertices.reduce((sum, v) => sum + v.x, 0) / roi.vertices.length;
            const centerZ = roi.vertices.reduce((sum, v) => sum + v.z, 0) / roi.vertices.length;
            refCenterX += centerX;
            refCenterZ += centerZ;
          });
          refCenterX /= refRois.length;
          refCenterZ /= refRois.length;
          
          console.log(`[SmartKPI DWG] Reference fixture: ${refFixtureName} at (${refCenterX.toFixed(2)}, ${refCenterZ.toFixed(2)})`);
          
          // Propagate each custom zone to all fixtures
          options.customZones.forEach((cz, czIdx) => {
            fixtureNames.forEach((fixtureName, fIdx) => {
              const fixtureRois = fixtureGroups[fixtureName];
              
              // Calculate this fixture's center
              let fixCenterX = 0, fixCenterZ = 0;
              fixtureRois.forEach(roi => {
                const centerX = roi.vertices.reduce((sum, v) => sum + v.x, 0) / roi.vertices.length;
                const centerZ = roi.vertices.reduce((sum, v) => sum + v.z, 0) / roi.vertices.length;
                fixCenterX += centerX;
                fixCenterZ += centerZ;
              });
              fixCenterX /= fixtureRois.length;
              fixCenterZ /= fixtureRois.length;
              
              // Calculate offset from reference to this fixture
              const offsetX = fixCenterX - refCenterX;
              const offsetZ = fixCenterZ - refCenterZ;
              
              // Create propagated custom zone with offset applied
              const propagatedVertices = cz.vertices.map(v => ({
                x: v.x + offsetX,
                z: v.z + offsetZ,
              }));
              
              allRois.push({
                id: `custom-${Date.now()}-${czIdx}-${fIdx}`,
                name: `${fixtureName} - ${cz.name || `Custom ${czIdx + 1}`}`,
                vertices: propagatedVertices,
                color: '#10b981',
                opacity: 0.4,
                roiType: 'custom',
              });
            });
          });
          
          console.log(`[SmartKPI DWG] Propagated ${options.customZones.length} custom zones to ${fixtureNames.length} fixtures`);
        }
      }
      
      // Save to database with DWG layout ID for mode separation
      const savedRois = smartKpiService.saveRois(venueId, allRois, templateId, layoutId);
      
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
