import { Router } from 'express';
import { randomBytes, randomUUID } from 'crypto';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';

const TREVIGLIO_FLOORPLAN = '/floorplans/treviglio.png';
const TREVIGLIO_W = 2600;
const TREVIGLIO_H = 4188;

function formatProject(row, pinCount = 0) {
  return {
    id: row.id,
    name: row.name,
    floorplan_url: row.floorplan_url,
    image_w: row.image_w,
    image_h: row.image_h,
    share_token: row.share_token,
    owner_secret: row.owner_secret,
    submitted_at: row.submitted_at,
    locked: !!row.locked,
    created_at: row.created_at,
    pin_count: pinCount,
  };
}

function formatPin(row) {
  let categories = [];
  try {
    categories = JSON.parse(row.categories || '[]');
  } catch {
    categories = [];
  }
  return {
    id: row.id,
    project_id: row.project_id,
    number: row.number,
    x: row.x,
    y: row.y,
    label: row.label,
    categories,
    note: row.note,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function tokenGate(db, shareToken) {
  const project = db.prepare('SELECT * FROM shelf_mapper_projects WHERE share_token = ?').get(shareToken);
  if (!project) return { ok: false, status: 404, error: 'Project not found' };

  const demo = db.prepare('SELECT * FROM demo_tokens WHERE token = ?').get(shareToken);
  if (demo) {
    if (demo.revoked) return { ok: false, status: 401, error: 'Link revoked' };
    if (demo.expires_at && new Date(demo.expires_at).getTime() < Date.now()) {
      return { ok: false, status: 401, error: 'Link expired' };
    }
  }

  return { ok: true, project };
}

export function ensureShelfMapperSeed(db) {
  const existing = db.prepare('SELECT id FROM shelf_mapper_projects WHERE share_token = ?').get('treviglio-demo');
  if (existing) return;

  const id = randomUUID();
  db.prepare(`
    INSERT INTO shelf_mapper_projects (id, name, floorplan_url, image_w, image_h, share_token, owner_secret)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, 'Treviglio', TREVIGLIO_FLOORPLAN, TREVIGLIO_W, TREVIGLIO_H, 'treviglio-demo', 'treviglio-owner');
  console.log('📦 Seeded shelf-mapper Treviglio project (treviglio-demo)');
}

export function createMapperProjectForToken(db, { shareToken, label, venueId }) {
  const existing = db.prepare('SELECT id FROM shelf_mapper_projects WHERE share_token = ?').get(shareToken);
  if (existing) return existing.id;

  const id = randomUUID();
  const name = (label && String(label).trim()) || 'Mappatura scaffali';
  const ownerSecret = randomBytes(16).toString('hex');

  db.prepare(`
    INSERT INTO shelf_mapper_projects (id, name, floorplan_url, image_w, image_h, share_token, owner_secret)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, TREVIGLIO_FLOORPLAN, TREVIGLIO_W, TREVIGLIO_H, shareToken, ownerSecret);

  return id;
}

export default function shelfMapperRoutes(db) {
  const router = Router();

  ensureShelfMapperSeed(db);

  // ── PUBLIC: project + pins (token in path) ──
  router.get('/projects/:shareToken', (req, res) => {
    try {
      const gate = tokenGate(db, req.params.shareToken);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
      const pinCount = db.prepare(
        'SELECT COUNT(*) AS c FROM shelf_mapper_pins WHERE project_id = ?',
      ).get(gate.project.id).c;
      res.json(formatProject(gate.project, pinCount));
    } catch (error) {
      console.error('[ShelfMapper] get project:', error);
      res.status(500).json({ error: 'Failed to load project' });
    }
  });

  router.get('/projects/:shareToken/pins', (req, res) => {
    try {
      const gate = tokenGate(db, req.params.shareToken);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
      const rows = db.prepare(
        'SELECT * FROM shelf_mapper_pins WHERE project_id = ? ORDER BY number ASC',
      ).all(gate.project.id);
      res.json(rows.map(formatPin));
    } catch (error) {
      console.error('[ShelfMapper] list pins:', error);
      res.status(500).json({ error: 'Failed to load pins' });
    }
  });

  router.put('/projects/:shareToken/pins/:pinId', (req, res) => {
    try {
      const gate = tokenGate(db, req.params.shareToken);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
      if (gate.project.locked) return res.status(403).json({ error: 'Project locked' });

      const body = req.body || {};
      const categories = JSON.stringify(Array.isArray(body.categories) ? body.categories : []);
      const now = new Date().toISOString();

      const existing = db.prepare('SELECT id FROM shelf_mapper_pins WHERE id = ? AND project_id = ?')
        .get(req.params.pinId, gate.project.id);

      if (existing) {
        db.prepare(`
          UPDATE shelf_mapper_pins
          SET number = ?, x = ?, y = ?, label = ?, categories = ?, note = ?, updated_at = ?
          WHERE id = ? AND project_id = ?
        `).run(
          body.number,
          body.x,
          body.y,
          body.label ?? null,
          categories,
          body.note ?? null,
          now,
          req.params.pinId,
          gate.project.id,
        );
      } else {
        db.prepare(`
          INSERT INTO shelf_mapper_pins (id, project_id, number, x, y, label, categories, note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.params.pinId,
          gate.project.id,
          body.number,
          body.x,
          body.y,
          body.label ?? null,
          categories,
          body.note ?? null,
          body.created_at || now,
          now,
        );
      }

      const row = db.prepare('SELECT * FROM shelf_mapper_pins WHERE id = ?').get(req.params.pinId);
      res.json(formatPin(row));
    } catch (error) {
      console.error('[ShelfMapper] upsert pin:', error);
      res.status(500).json({ error: 'Failed to save pin' });
    }
  });

  router.delete('/projects/:shareToken/pins/:pinId', (req, res) => {
    try {
      const gate = tokenGate(db, req.params.shareToken);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
      if (gate.project.locked) return res.status(403).json({ error: 'Project locked' });

      db.prepare('DELETE FROM shelf_mapper_pins WHERE id = ? AND project_id = ?')
        .run(req.params.pinId, gate.project.id);
      res.json({ ok: true });
    } catch (error) {
      console.error('[ShelfMapper] delete pin:', error);
      res.status(500).json({ error: 'Failed to delete pin' });
    }
  });

  router.post('/projects/:shareToken/submit', (req, res) => {
    try {
      const gate = tokenGate(db, req.params.shareToken);
      if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
      const now = new Date().toISOString();
      db.prepare('UPDATE shelf_mapper_projects SET submitted_at = ? WHERE id = ?')
        .run(now, gate.project.id);
      res.json({ ok: true, submitted_at: now });
    } catch (error) {
      console.error('[ShelfMapper] submit:', error);
      res.status(500).json({ error: 'Failed to submit' });
    }
  });

  // ── Superadmin: list projects ──
  router.get('/projects', requireAuth, requireSuperadmin, (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM shelf_mapper_projects ORDER BY created_at DESC').all();
      const result = rows.map((row) => {
        const pinCount = db.prepare(
          'SELECT COUNT(*) AS c FROM shelf_mapper_pins WHERE project_id = ?',
        ).get(row.id).c;
        return formatProject(row, pinCount);
      });
      res.json(result);
    } catch (error) {
      console.error('[ShelfMapper] list projects:', error);
      res.status(500).json({ error: 'Failed to list projects' });
    }
  });

  return router;
}
