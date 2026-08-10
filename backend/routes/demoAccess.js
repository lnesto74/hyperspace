import { Router } from 'express';
import { randomBytes } from 'crypto';
import { requireAuth, requireSuperadmin } from '../middleware/auth.js';
import { createMapperProjectForToken } from './shelfMapper.js';

const VALID_LINK_TYPES = new Set(['story', 'dashboard', 'mapper', 'custom-dashboard']);
const VALID_WIDGET_IDS = new Set([
  'ops-hero-kpi-strip',
  'ops-alerts-panel',
  'reporting-kpi-strip',
  'reporting-insights-panel',
  'exec-store-health-pillars',
  'exec-highlight-chips',
  'category-visits-panel',
  'zone-performance-map',
  'peble-screen-campaign-map',
  'campaign-ranking-table',
  'exec-header-headline',
  'exec-action-insights',
  'activity-timeline-chart',
  'floor-visual-toggle',
  'journey-signals-panel',
  'fresco-department-cards',
  'aisle-stat-stack',
  'checkout-panel',
  'media-ring-gauges',
]);
const VALID_COL_SPANS = new Set([3, 4, 6, 8, 12]);
const VALID_ROW_SPANS = new Set([1, 2, 3]);
const MAX_PAYLOAD_CHARS = 80_000;

/**
 * Demo access tokens.
 *
 * A superadmin mints shareable links from the UI. Opening the app with
 * `?demo=<token>` validates the token here (public endpoint) and, if valid,
 * the frontend skips the Google login. Story links auto-start the guided tour;
 * dashboard links open the Esselunga Executive reporting view;
 * custom-dashboard links open a published My-dashboards board (view-only);
 * mapper links open the shelf-mapping tool at /m/<token>.
 */
export default function demoAccessRoutes(db) {
  const router = Router();

  function normalizeLinkType(raw) {
    if (raw === 'dashboard') return 'dashboard';
    if (raw === 'mapper') return 'mapper';
    if (raw === 'custom-dashboard') return 'custom-dashboard';
    return 'story';
  }

  function sanitizeLayout(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!Array.isArray(raw.items)) return null;
    const items = [];
    for (const it of raw.items.slice(0, 40)) {
      if (!it || typeof it !== 'object') continue;
      const widgetId = String(it.widgetId || '');
      if (!VALID_WIDGET_IDS.has(widgetId)) continue;
      const colSpan = Number(it.colSpan);
      const rowSpan = Number(it.rowSpan);
      if (!VALID_COL_SPANS.has(colSpan) || !VALID_ROW_SPANS.has(rowSpan)) continue;
      items.push({
        instanceId: String(it.instanceId || `${widgetId}-${items.length}`).slice(0, 80),
        widgetId,
        colSpan,
        rowSpan,
      });
    }
    return {
      id: String(raw.id || `dash-${Date.now().toString(36)}`).slice(0, 80),
      name: String(raw.name || 'Shared dashboard').slice(0, 120),
      updatedAt: Number(raw.updatedAt) || Date.now(),
      items,
    };
  }

  function parsePayload(raw) {
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  }

  function formatRow(row) {
    const expired = !!row.expires_at && new Date(row.expires_at).getTime() < Date.now();
    const linkType = normalizeLinkType(row.link_type);
    const payload = parsePayload(row.payload);
    return {
      token: row.token,
      label: row.label,
      venueId: row.venue_id,
      linkType,
      layoutName: payload?.layout?.name || null,
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

      try {
        db.prepare(
          "UPDATE demo_tokens SET use_count = use_count + 1, last_used_at = datetime('now') WHERE token = ?",
        ).run(token);
      } catch {
        /* non-fatal */
      }

      const linkType = normalizeLinkType(row.link_type);
      const payload = parsePayload(row.payload);
      const body = {
        valid: true,
        venueId: row.venue_id || null,
        label: row.label || null,
        linkType,
      };
      if (linkType === 'custom-dashboard' && payload?.layout) {
        body.layout = payload.layout;
      }
      res.json(body);
    } catch (error) {
      console.error('[DemoAccess] validate error:', error);
      res.status(500).json({ valid: false, error: 'Validation failed' });
    }
  });

  router.use(requireAuth);
  router.use(requireSuperadmin);

  router.get('/tokens', (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM demo_tokens ORDER BY created_at DESC').all();
      res.json(rows.map(formatRow));
    } catch (error) {
      console.error('[DemoAccess] list error:', error);
      res.status(500).json({ error: 'Failed to list demo tokens' });
    }
  });

  router.post('/tokens', (req, res) => {
    try {
      const { label, venueId, expiresInDays, linkType: rawLinkType, layout: rawLayout } = req.body || {};
      const linkType = VALID_LINK_TYPES.has(rawLinkType) ? rawLinkType : 'story';
      if ((linkType === 'dashboard' || linkType === 'custom-dashboard') && !venueId) {
        return res.status(400).json({ error: 'venueId is required for dashboard public links' });
      }

      let payloadJson = null;
      if (linkType === 'custom-dashboard') {
        const layout = sanitizeLayout(rawLayout);
        if (!layout || layout.items.length === 0) {
          return res.status(400).json({ error: 'layout with at least one widget is required' });
        }
        payloadJson = JSON.stringify({ layout });
        if (payloadJson.length > MAX_PAYLOAD_CHARS) {
          return res.status(400).json({ error: 'layout payload too large' });
        }
      }

      const token = randomBytes(18).toString('hex');

      let expiresAt = null;
      const days = Number(expiresInDays);
      if (Number.isFinite(days) && days > 0) {
        expiresAt = new Date(Date.now() + days * 86400000).toISOString();
      }

      db.prepare(`
        INSERT INTO demo_tokens (token, label, venue_id, created_by, expires_at, link_type, payload)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        token,
        (label && String(label).trim()) || null,
        venueId || null,
        req.user?.email || null,
        expiresAt,
        linkType,
        payloadJson,
      );

      if (linkType === 'mapper') {
        createMapperProjectForToken(db, {
          shareToken: token,
          label: (label && String(label).trim()) || null,
          venueId: venueId || null,
        });
      }

      const row = db.prepare('SELECT * FROM demo_tokens WHERE token = ?').get(token);
      res.status(201).json(formatRow(row));
    } catch (error) {
      console.error('[DemoAccess] create error:', error);
      res.status(500).json({ error: 'Failed to create demo token' });
    }
  });

  router.delete('/tokens/:token', (req, res) => {
    try {
      const result = db.prepare('UPDATE demo_tokens SET revoked = 1 WHERE token = ?').run(req.params.token);
      if (result.changes === 0) return res.status(404).json({ error: 'Token not found' });
      res.json({ ok: true });
    } catch (error) {
      console.error('[DemoAccess] revoke error:', error);
      res.status(500).json({ error: 'Failed to revoke token' });
    }
  });

  return router;
}
