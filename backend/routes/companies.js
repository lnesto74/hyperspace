import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';

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

export default function companiesRoutes(db) {
  const router = Router();

  // All company routes require auth + superadmin
  router.use(requireAuth);
  router.use(requireSuperadmin);

  // GET /api/companies — list all companies
  router.get('/', (req, res) => {
    try {
      const companies = db.prepare(`
        SELECT c.*, 
          (SELECT COUNT(*) FROM venues WHERE company_id = c.id) as venue_count
        FROM companies c 
        ORDER BY c.name ASC
      `).all();
      res.json(companies);
    } catch (error) {
      console.error('[Companies] Get all error:', error);
      res.status(500).json({ error: 'Failed to get companies' });
    }
  });

  // GET /api/companies/:id — get single company with its venues
  router.get('/:id', (req, res) => {
    try {
      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const venues = db.prepare(`
        SELECT id, name, width, depth, height, address, latitude, longitude, created_at, updated_at
        FROM venues WHERE company_id = ?
        ORDER BY name ASC
      `).all(req.params.id);

      res.json({ ...company, venues });
    } catch (error) {
      console.error('[Companies] Get by id error:', error);
      res.status(500).json({ error: 'Failed to get company' });
    }
  });

  // POST /api/companies — create new company
  router.post('/', (req, res) => {
    try {
      const { name, logo_url } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Company name is required' });
      }

      const id = uuidv4();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      // Check slug uniqueness
      const existing = db.prepare('SELECT id FROM companies WHERE slug = ?').get(slug);
      const finalSlug = existing ? `${slug}-${id.slice(0, 8)}` : slug;

      db.prepare(`
        INSERT INTO companies (id, name, slug, logo_url, created_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(id, name.trim(), finalSlug, logo_url || null);

      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(id);
      res.status(201).json(company);
    } catch (error) {
      console.error('[Companies] Create error:', error);
      res.status(500).json({ error: 'Failed to create company' });
    }
  });

  // PUT /api/companies/:id — update company
  router.put('/:id', (req, res) => {
    try {
      const { name, logo_url } = req.body;
      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const updates = [];
      const params = [];

      if (name !== undefined) {
        updates.push('name = ?');
        params.push(name.trim());
        const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        updates.push('slug = ?');
        params.push(slug);
      }
      if (logo_url !== undefined) {
        updates.push('logo_url = ?');
        params.push(logo_url);
      }

      if (updates.length === 0) {
        return res.json(company);
      }

      updates.push("updated_at = datetime('now')");
      params.push(req.params.id);

      db.prepare(`UPDATE companies SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      const updated = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
      res.json(updated);
    } catch (error) {
      console.error('[Companies] Update error:', error);
      res.status(500).json({ error: 'Failed to update company' });
    }
  });

  // GET /api/companies/:id/categories — grocery/business categories for mapping
  router.get('/:id/categories', (req, res) => {
    try {
      const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(req.params.id);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      ensureDefaultCategories(db, req.params.id);
      const categories = db.prepare(`
        SELECT id, company_id, name, slug, color, sort_order, created_at, updated_at
        FROM company_categories
        WHERE company_id = ?
        ORDER BY sort_order ASC, name ASC
      `).all(req.params.id);

      res.json({ categories });
    } catch (error) {
      console.error('[Companies] Get categories error:', error);
      res.status(500).json({ error: 'Failed to get company categories' });
    }
  });

  // POST /api/companies/:id/categories — add category for a company
  router.post('/:id/categories', (req, res) => {
    try {
      const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(req.params.id);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      const { name, color } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Category name is required' });
      }

      const cleanName = String(name).trim();
      const slug = slugify(cleanName);
      const existing = db.prepare(`
        SELECT * FROM company_categories WHERE company_id = ? AND slug = ?
      `).get(req.params.id, slug);
      if (existing) {
        return res.json(existing);
      }

      const nextOrder = db.prepare(`
        SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order
        FROM company_categories WHERE company_id = ?
      `).get(req.params.id)?.next_order || 0;

      const id = uuidv4();
      db.prepare(`
        INSERT INTO company_categories (id, company_id, name, slug, color, sort_order, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).run(id, req.params.id, cleanName, slug, color || null, nextOrder);

      const category = db.prepare('SELECT * FROM company_categories WHERE id = ?').get(id);
      res.status(201).json(category);
    } catch (error) {
      console.error('[Companies] Create category error:', error);
      res.status(500).json({ error: 'Failed to create company category' });
    }
  });

  // DELETE /api/companies/:id — delete company (venues become unassigned)
  router.delete('/:id', (req, res) => {
    try {
      const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      // Unassign venues first
      db.prepare('UPDATE venues SET company_id = NULL WHERE company_id = ?').run(req.params.id);
      db.prepare('DELETE FROM companies WHERE id = ?').run(req.params.id);

      res.json({ success: true });
    } catch (error) {
      console.error('[Companies] Delete error:', error);
      res.status(500).json({ error: 'Failed to delete company' });
    }
  });

  // PATCH /api/companies/:id/assign-venue — assign a venue to this company
  router.patch('/:id/assign-venue', (req, res) => {
    try {
      const { venue_id } = req.body;
      if (!venue_id) {
        return res.status(400).json({ error: 'venue_id is required' });
      }

      const company = db.prepare('SELECT id FROM companies WHERE id = ?').get(req.params.id);
      if (!company) {
        return res.status(404).json({ error: 'Company not found' });
      }

      db.prepare("UPDATE venues SET company_id = ?, updated_at = datetime('now') WHERE id = ?")
        .run(req.params.id, venue_id);

      res.json({ success: true });
    } catch (error) {
      console.error('[Companies] Assign venue error:', error);
      res.status(500).json({ error: 'Failed to assign venue' });
    }
  });

  // PATCH /api/companies/unassign-venue — remove venue from any company
  router.patch('/unassign-venue', (req, res) => {
    try {
      const { venue_id } = req.body;
      if (!venue_id) {
        return res.status(400).json({ error: 'venue_id is required' });
      }

      db.prepare("UPDATE venues SET company_id = NULL, updated_at = datetime('now') WHERE id = ?")
        .run(venue_id);

      res.json({ success: true });
    } catch (error) {
      console.error('[Companies] Unassign venue error:', error);
      res.status(500).json({ error: 'Failed to unassign venue' });
    }
  });

  return router;
}
