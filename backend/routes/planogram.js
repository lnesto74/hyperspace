import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { skuCatalogQueries, skuItemQueries, planogramQueries, shelfPlanogramQueries } from '../database/schema.js';
import { placeSkusOnShelf, computeShelfSlots } from '../services/PlacementService.js';

const upload = multer({ storage: multer.memoryStorage() });

export default function createPlanogramRoutes(db) {
  const router = Router();

  // ==================== SKU CATALOG ROUTES ====================

  // Get all SKU catalogs
  router.get('/sku-catalogs', (req, res) => {
    try {
      const catalogs = skuCatalogQueries.getAll(db);
      res.json(catalogs);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single SKU catalog with items
  router.get('/sku-catalogs/:id', (req, res) => {
    try {
      const catalog = skuCatalogQueries.getById(db, req.params.id);
      if (!catalog) {
        return res.status(404).json({ error: 'Catalog not found' });
      }
      const items = skuItemQueries.getByCatalogId(db, req.params.id);
      const categories = skuItemQueries.getCategories(db, req.params.id).map(r => r.category);
      const brands = skuItemQueries.getBrands(db, req.params.id).map(r => r.brand);
      res.json({ ...catalog, items, categories, brands });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import SKU catalog from Excel/CSV
  router.post('/sku-catalogs/import', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { name, description } = req.body;
      console.log('=== SKU IMPORT START ===');
      console.log('File:', req.file.originalname, 'Size:', req.file.buffer.length);
      
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      console.log('Sheets found:', workbook.SheetNames);
      
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      
      // Always read as raw array first to see actual data
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
      console.log('Raw rows count:', rawRows.length);
      console.log('First 3 raw rows:', JSON.stringify(rawRows.slice(0, 3)));
      
      // Check if first row looks like headers or data
      const firstRow = rawRows[0];
      const firstCell = firstRow ? String(firstRow[0] || '') : '';
      console.log('First cell value:', firstCell);
      
      // If first cell looks like a SKU code (ESS-, PRD-, etc), it's headerless
      const isHeaderless = /^[A-Z]{2,5}[-_]?\d+/.test(firstCell);
      console.log('Detected as headerless:', isHeaderless);
      
      let rows;
      if (isHeaderless) {
        // Use raw array data directly
        rows = rawRows;
        console.log(`Using headerless mode, ${rows.length} rows`);
      } else {
        // Has headers - use object format
        rows = XLSX.utils.sheet_to_json(sheet);
        console.log(`Using header mode, ${rows.length} rows`);
        console.log('Header keys:', rows[0] ? Object.keys(rows[0]) : 'none');
      }

      if (rows.length === 0) {
        return res.status(400).json({ error: 'File contains no data' });
      }

      // Create catalog
      const catalogId = uuidv4();
      const now = new Date().toISOString();
      skuCatalogQueries.create(db, {
        id: catalogId,
        name: name || req.file.originalname.replace(/\.[^/.]+$/, ''),
        description: description || `Imported from ${req.file.originalname}`,
        createdAt: now,
        updatedAt: now,
      });

      // Parse and insert SKU items - handle both object and array formats
      const items = rows.map((row, index) => {
        // If row is an array (headerless), map by position
        // Expected: [skuCode, name, brand, category, subcategory, size, price/margin]
        if (Array.isArray(row)) {
          // Skip empty rows
          if (!row[0] && !row[1]) return null;
          
          return {
            id: uuidv4(),
            catalogId,
            skuCode: String(row[0] || `SKU-${index + 1}`),
            name: String(row[1] || `Item ${index + 1}`),
            brand: row[2] ? String(row[2]) : null,
            category: row[3] ? String(row[3]) : null,
            subcategory: row[4] ? String(row[4]) : null,
            size: row[5] ? String(row[5]) : null,
            widthM: null,
            heightM: null,
            depthM: null,
            price: parseFloat(row[6]) || null,
            margin: parseFloat(row[7]) || null,
            imageUrl: row[8] ? String(row[8]) : null,
            meta: null,
          };
        }
        
        // Object format (has headers)
        return {
          id: uuidv4(),
          catalogId,
          skuCode: row.sku_code || row.SKU || row.sku_id || row.code || row.sku || row.Code || row.SKU_CODE || `SKU-${index + 1}`,
          name: row.name || row.Name || row.product_name || row.description || row.Description || row.NAME || row.PRODUCT || `Item ${index + 1}`,
          brand: row.brand || row.Brand || row.BRAND || row.manufacturer || null,
          category: row.category || row.Category || row.CATEGORY || row.dept || row.Department || null,
          subcategory: row.subcategory || row.Subcategory || row.sub_category || row.SubCategory || null,
          size: row.size || row.Size || row.SIZE || row.pack_size || row.PackSize || null,
          widthM: parseFloat(row.width_m || row.width || row.Width || 0) || null,
          heightM: parseFloat(row.height_m || row.height || row.Height || 0) || null,
          depthM: parseFloat(row.depth_m || row.depth || row.Depth || 0) || null,
          price: parseFloat(row.price || row.Price || row.PRICE || 0) || null,
          margin: parseFloat(row.margin || row.Margin || row.MARGIN || 0) || null,
          imageUrl: row.image_url || row.image || row.Image || row.IMAGE_URL || null,
          meta: null,
        };
      }).filter(Boolean); // Remove null entries from empty rows
      
      console.log(`Parsed ${items.length} SKU items`);

      skuItemQueries.bulkCreate(db, items);

      const categories = [...new Set(items.map(i => i.category).filter(Boolean))];
      const brands = [...new Set(items.map(i => i.brand).filter(Boolean))];

      res.json({
        id: catalogId,
        name: name || req.file.originalname,
        itemCount: items.length,
        categories,
        brands,
      });
    } catch (err) {
      console.error('Import error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Delete SKU catalog
  router.delete('/sku-catalogs/:id', (req, res) => {
    try {
      skuItemQueries.deleteByCatalogId(db, req.params.id);
      skuCatalogQueries.delete(db, req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== PLANOGRAM ROUTES ====================

  // Get planograms for a venue
  router.get('/venues/:venueId/planograms', (req, res) => {
    try {
      const planograms = planogramQueries.getByVenueId(db, req.params.venueId);
      res.json(planograms);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create new planogram
  router.post('/venues/:venueId/planograms', (req, res) => {
    try {
      const { name } = req.body;
      const version = planogramQueries.getNextVersion(db, req.params.venueId);
      const now = new Date().toISOString();
      const planogram = {
        id: uuidv4(),
        venueId: req.params.venueId,
        name: name || `Planogram v${version}`,
        version,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };
      planogramQueries.create(db, planogram);
      res.json(planogram);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single planogram with shelf data
  router.get('/planograms/:id', (req, res) => {
    try {
      const planogram = planogramQueries.getById(db, req.params.id);
      if (!planogram) {
        return res.status(404).json({ error: 'Planogram not found' });
      }
      const shelfPlanograms = shelfPlanogramQueries.getByPlanogramId(db, req.params.id);
      console.log('📦 Load planogram:', req.params.id, 'shelves:', shelfPlanograms.length);
      shelfPlanograms.forEach(sp => {
        const slotsCount = sp.slots?.levels?.reduce((acc, l) => acc + (l.slots?.filter(s => s.skuItemId)?.length || 0), 0) || 0;
        console.log('  📦 Shelf:', sp.shelfId, 'slots with SKUs:', slotsCount);
      });
      res.json({ ...planogram, shelves: shelfPlanograms });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update planogram metadata
  router.put('/planograms/:id', (req, res) => {
    try {
      const { name, status } = req.body;
      planogramQueries.update(db, req.params.id, { name, status });
      const planogram = planogramQueries.getById(db, req.params.id);
      res.json(planogram);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Duplicate planogram
  router.post('/planograms/:id/duplicate', (req, res) => {
    try {
      const original = planogramQueries.getById(db, req.params.id);
      if (!original) {
        return res.status(404).json({ error: 'Planogram not found' });
      }

      const version = planogramQueries.getNextVersion(db, original.venueId);
      const now = new Date().toISOString();
      const newPlanogram = {
        id: uuidv4(),
        venueId: original.venueId,
        name: `${original.name} (copy)`,
        version,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      };
      planogramQueries.create(db, newPlanogram);

      // Copy shelf planograms
      const shelfPlanograms = shelfPlanogramQueries.getByPlanogramId(db, req.params.id);
      for (const sp of shelfPlanograms) {
        shelfPlanogramQueries.upsert(db, {
          id: uuidv4(),
          planogramId: newPlanogram.id,
          shelfId: sp.shelfId,
          numLevels: sp.numLevels,
          slotWidthM: sp.slotWidthM,
          levelHeightM: sp.levelHeightM,
          slots: sp.slots,
          createdAt: now,
          updatedAt: now,
        });
      }

      res.json(newPlanogram);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete planogram
  router.delete('/planograms/:id', (req, res) => {
    try {
      shelfPlanogramQueries.deleteByPlanogramId(db, req.params.id);
      planogramQueries.delete(db, req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Export planogram as JSON
  router.get('/planograms/:id/export', (req, res) => {
    try {
      const planogram = planogramQueries.getById(db, req.params.id);
      if (!planogram) {
        return res.status(404).json({ error: 'Planogram not found' });
      }
      const shelfPlanograms = shelfPlanogramQueries.getByPlanogramId(db, req.params.id);
      
      // Get SKU details for all placed items
      const skuIds = new Set();
      shelfPlanograms.forEach(sp => {
        sp.slots.levels?.forEach(level => {
          level.slots?.forEach(slot => {
            if (slot.skuItemId) skuIds.add(slot.skuItemId);
          });
        });
      });
      
      const skuDetails = {};
      skuIds.forEach(id => {
        const item = skuItemQueries.getById(db, id);
        if (item) skuDetails[id] = item;
      });

      res.json({
        planogram,
        shelves: shelfPlanograms,
        skuDetails,
        exportedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== SHELF PLANOGRAM ROUTES ====================

  // Get shelf planogram for a specific shelf
  router.get('/planograms/:planogramId/shelves/:shelfId', (req, res) => {
    try {
      const { planogramId, shelfId } = req.params;
      const shelfPlanogram = shelfPlanogramQueries.getByShelfId(db, planogramId, shelfId);
      res.json(shelfPlanogram || { slots: { levels: [] }, numLevels: 4, slotWidthM: 0.1 });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update shelf planogram (save slot assignments)
  router.put('/planograms/:planogramId/shelves/:shelfId', (req, res) => {
    try {
      const { planogramId, shelfId } = req.params;
      const { numLevels, slotWidthM, levelHeightM, slotFacings, slots } = req.body;
      const now = new Date().toISOString();

      shelfPlanogramQueries.upsert(db, {
        id: uuidv4(),
        planogramId,
        shelfId,
        numLevels: numLevels || 4,
        slotWidthM: slotWidthM || 0.1,
        levelHeightM: levelHeightM || null,
        slotFacings: slotFacings || [],
        slots: slots || { levels: [] },
        createdAt: now,
        updatedAt: now,
      });

      const updated = shelfPlanogramQueries.getByShelfId(db, planogramId, shelfId);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Place SKUs on shelf (uses placement logic)
  router.post('/planograms/:planogramId/shelves/:shelfId/place', (req, res) => {
    try {
      const { planogramId, shelfId } = req.params;
      const { skuItemIds, dropTarget, shelfWidth, options } = req.body;

      console.log('📦 Place SKUs request:', { planogramId, shelfId, skuItemIds, dropTarget, shelfWidth, options });

      // Get current shelf planogram or create default
      let shelfPlanogram = shelfPlanogramQueries.getByShelfId(db, planogramId, shelfId);
      console.log('📦 Existing shelf planogram:', shelfPlanogram ? 'found' : 'not found');
      
      if (!shelfPlanogram) {
        shelfPlanogram = {
          numLevels: 4,
          slotWidthM: 0.1,
          slots: { levels: [] },
        };
      }

      // Compute placement
      const result = placeSkusOnShelf({
        shelfWidth: shelfWidth || 2.0,
        numLevels: shelfPlanogram.numLevels,
        slotWidthM: shelfPlanogram.slotWidthM,
        existingSlots: shelfPlanogram.slots,
        dropTarget,
        skuItemIds,
        options: options || {},
      });

      console.log('📦 Placement result:', { 
        placedCount: result.placedSkuIds?.length, 
        overflowCount: result.overflowSkuIds?.length,
        levelsCount: result.updatedSlots?.levels?.length 
      });

      // Save updated slots
      const now = new Date().toISOString();
      const upsertResult = shelfPlanogramQueries.upsert(db, {
        id: uuidv4(),
        planogramId,
        shelfId,
        numLevels: shelfPlanogram.numLevels,
        slotWidthM: shelfPlanogram.slotWidthM,
        levelHeightM: shelfPlanogram.levelHeightM,
        slotFacings: shelfPlanogram.slotFacings || [],
        slots: result.updatedSlots,
        createdAt: now,
        updatedAt: now,
      });

      console.log('📦 Upsert result:', upsertResult);

      res.json(result);
    } catch (err) {
      console.error('📦 Place SKUs error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-fill shelf with category
  router.post('/planograms/:planogramId/shelves/:shelfId/auto-fill', (req, res) => {
    try {
      const { planogramId, shelfId } = req.params;
      const { catalogId, category, subcategory, distribution, shelfWidth } = req.body;

      // Get SKUs matching filter
      let items = skuItemQueries.getByCatalogId(db, catalogId);
      if (category) {
        items = items.filter(i => i.category === category);
      }
      if (subcategory) {
        items = items.filter(i => i.subcategory === subcategory);
      }

      if (items.length === 0) {
        return res.status(400).json({ error: 'No SKUs match the filter' });
      }

      // Get or create shelf planogram
      let shelfPlanogram = shelfPlanogramQueries.getByShelfId(db, planogramId, shelfId);
      if (!shelfPlanogram) {
        shelfPlanogram = {
          numLevels: 4,
          slotWidthM: 0.1,
          slots: { levels: [] },
        };
      }

      // Compute total slots
      const slotsPerLevel = Math.floor((shelfWidth || 2.0) / shelfPlanogram.slotWidthM);
      const totalSlots = slotsPerLevel * shelfPlanogram.numLevels;

      // Distribute SKUs based on strategy
      let skuDistribution = [];
      if (distribution === 'equal') {
        const facingsPerSku = Math.floor(totalSlots / items.length);
        items.forEach(item => {
          for (let i = 0; i < facingsPerSku; i++) {
            skuDistribution.push(item.id);
          }
        });
      } else if (distribution === 'weighted' && items[0]?.margin) {
        const totalMargin = items.reduce((sum, i) => sum + (i.margin || 1), 0);
        items.forEach(item => {
          const facings = Math.round((item.margin || 1) / totalMargin * totalSlots);
          for (let i = 0; i < facings; i++) {
            skuDistribution.push(item.id);
          }
        });
      } else {
        // Sequential - one facing per SKU
        skuDistribution = items.map(i => i.id);
      }

      // Place SKUs
      const result = placeSkusOnShelf({
        shelfWidth: shelfWidth || 2.0,
        numLevels: shelfPlanogram.numLevels,
        slotWidthM: shelfPlanogram.slotWidthM,
        existingSlots: { levels: [] }, // Clear existing for auto-fill
        dropTarget: { type: 'shelf' },
        skuItemIds: skuDistribution,
        options: { fillOrder: 'sequential', compact: true },
      });

      // Save
      const now = new Date().toISOString();
      shelfPlanogramQueries.upsert(db, {
        id: uuidv4(),
        planogramId,
        shelfId,
        numLevels: shelfPlanogram.numLevels,
        slotWidthM: shelfPlanogram.slotWidthM,
        levelHeightM: shelfPlanogram.levelHeightM,
        slotFacings: shelfPlanogram.slotFacings || [],
        slots: result.updatedSlots,
        createdAt: now,
        updatedAt: now,
      });

      res.json({
        ...result,
        itemsPlaced: skuDistribution.length - (result.overflowSkuIds?.length || 0),
        totalItems: items.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get categories for a shelf (from its planogram SKUs)
  router.get('/shelves/:shelfId/categories', (req, res) => {
    try {
      const { shelfId } = req.params;
      
      // Get shelf planogram
      const shelfPlanogram = db.prepare(`
        SELECT sp.slots_json 
        FROM shelf_planograms sp 
        WHERE sp.shelf_id = ?
      `).get(shelfId);
      
      if (!shelfPlanogram || !shelfPlanogram.slots_json) {
        return res.json({ categories: [], shelfId });
      }
      
      // Parse slots and collect SKU IDs
      const slots = JSON.parse(shelfPlanogram.slots_json);
      const skuIds = new Set();
      
      slots.levels?.forEach(level => {
        level.slots?.forEach(slot => {
          if (slot.skuItemId) {
            skuIds.add(slot.skuItemId);
          }
        });
      });
      
      if (skuIds.size === 0) {
        return res.json({ categories: [], shelfId });
      }
      
      // Get categories for these SKUs
      const placeholders = Array.from(skuIds).map(() => '?').join(',');
      const categories = db.prepare(`
        SELECT DISTINCT category, COUNT(*) as count
        FROM sku_items 
        WHERE id IN (${placeholders}) AND category IS NOT NULL
        GROUP BY category
        ORDER BY count DESC
      `).all(...skuIds);
      
      res.json({
        shelfId,
        categories: categories.map(c => c.category),
        categoryCounts: categories
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
