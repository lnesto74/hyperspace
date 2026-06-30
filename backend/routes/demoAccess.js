import { Router } from 'express';
import { randomBytes } from 'crypto';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';

const VALID_LINK_TYPES = new Set(['story', 'dashboard']);

/**
 * Demo access tokens.
 *
 * A superadmin mints shareable links from the UI. Opening the app with
 * `?demo=<token>` validates the token here (public endpoint) and, if valid,
 * the frontend skips the Google login. Story links auto-start the guided tour;
 * dashboard links open the Esselunga Executive reporting view.
 *
 * Token management (create / list / revoke) requires superadmin. Validation is
 * intentionally public so the demo gate can run before any login.
 */
export default function demoAccessRoutes(db) {
  const router = Router();

  function formatRow(row) {
    const expired = !!row.expires_at && new Date(row.expires_at).getTime() < Date.now();
    const linkType = row.link_type === 'dashboard' ? 'dashboard' : 'story';
    return {
      token: row.token,
      label: row.label,
      venueId: row.venue_id,
      linkType,
      createdBy: row.created_by,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revoked: !!row.revoked,
      useCount: row.use_count,
      lastUsedAt: row.last_used_at,
      status: row.revoked ? 'revoked' : expired ? 'expired' : 'active',
    };
  }

  // ── PUBLIC: validate a demo token (no auth — runs before login) ──
  router.get('/validate', (req, res) => {
    try {
      const token = String(req.query.token || '');
      if (!token) return res.status(400).json({ valid: false, error: 'Missing token' });

      const row = db.prepare('SELECT * FROM demo_tokens WHERE token = ?').get(token);
      if (!row || row.revoked) return res.status(401).json({ valid: false });
      if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
        return res.status(401).json({ valid: false, error: 'expired' });
      }

      // Best-effort usage tracking.
      try {
        db.prepare(
          "UPDATE demo_tokens SET use_count = use_count + 1, last_used_at = datetime('now') WHERE token = ?",
        ).run(token);
      } catch {
        /* non-fatal */
      }

      res.json({
        valid: true,
        venueId: row.venue_id || null,
        label: row.label || null,
        linkType: row.link_type === 'dashboard' ? 'dashboard' : 'story',
      });
    } catch (error) {
      console.error('[DemoAccess] validate error:', error);
      res.status(500).json({ valid: false, error: 'Validation failed' });
    }
  });

  // ── Everything below requires superadmin ──
  router.use(requireAuth);
  router.use(requireSuperadmin);

  // GET /api/demo-access/tokens — list all minted tokens
  router.get('/tokens', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM demo_tokens ORDER BY created_at DESC').all();
      res.json(rows.map(formatRow));
    } catch (error) {
      console.error('[DemoAccess] list error:', error);
      res.status(500).json({ error: 'Failed to list demo tokens' });
    }
  });

  // POST /api/demo-access/tokens — mint a new token
  router.post('/tokens', (req, res) => {
    try {
      const { label, venueId, expiresInDays, linkType: rawLinkType } = req.body || {};
      const linkType = VALID_LINK_TYPES.has(rawLinkType) ? rawLinkType : 'story';
      if (linkType === 'dashboard' && !venueId) {
        return res.status(400).json({ error: 'venueId is required for dashboard public links' });
      }

      const token = randomBytes(18).toString('hex');

      let expiresAt = null;
      const days = Number(expiresInDays);
      if (Number.isFinite(days) && days > 0) {
        expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      }

      db.prepare(`
        INSERT INTO demo_tokens (token, label, venue_id, created_by, expires_at, link_type)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        token,
        (label && String(label).trim()) || null,
        venueId || null,
        req.user?.email || null,
        expiresAt,
        linkType,
      );

      const row = db.prepare('SELECT * FROM demo_tokens WHERE token = ?').get(token);
      res.status(201).json(formatRow(row));
    } catch (error) {
      console.error('[DemoAccess] create error:', error);
      res.status(500).json({ error: 'Failed to create demo token' });
    }
  });

  // DELETE /api/demo-access/tokens/:token — revoke a token
  router.delete('/tokens/:token', (req, res) => {
    try {
      const result = db.prepare('UPDATE demo_tokens SET revoked = 1 WHERE token = ?').run(req.params.token);
      if (result.changes === 0) return res.status(404).json({ error: 'Token not found' });
      res.json({ ok: true });
    } catch (error) {
      console.error('[DemoAccess] revoke error:', error);
      res.status(500).json({ error: 'Failed to revoke demo token' });
    }
  });

  return router;
}
