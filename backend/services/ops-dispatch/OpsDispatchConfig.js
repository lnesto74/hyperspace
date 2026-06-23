/**
 * OpsDispatchConfig
 *
 * Per-venue configuration for the Telegram ops-dispatch feature (the retail
 * equivalent of PDUMind's demo_integrations + ops_teams config). Persisted as a
 * JSON blob on venues.ops_dispatch_config_json (created lazily, mirrors
 * economics_config_json / checkout_alert_config_json).
 *
 * The admin pastes a bot token (from @BotFather), enables dispatch, and copies a
 * per-venue invite link. Onboarded team members are routed by ROLE:
 *   - Visual Merchandiser  → merchandising fixes (zones, products to reposition)
 *   - Cashier / Checkout    → queue / checkout actions
 *   - Store Lead            → escalation target
 */

import crypto from 'crypto';

export const ROLES = ['merchandiser', 'cashier', 'store_lead'];

export const ROLE_LABELS = {
  merchandiser: 'Visual Merchandiser',
  cashier: 'Cashier / Checkout',
  store_lead: 'Store Lead',
};

export const ROLE_EMOJI = {
  merchandiser: '🛒',
  cashier: '🧾',
  store_lead: '🧭',
};

const DEFAULT_ESCALATION = {
  reminderSec: 180,
  escalateSec: 360,
  verifySec: 90,
};

const TELEGRAM_TOKEN_RE = /^\d{8,}:[A-Za-z0-9_-]{20,}$/;
const INVALID_TOKEN_LITERALS = new Set(['demo', 'password', 'admin', 'test', 'token']);

export function isValidTelegramToken(token) {
  const t = (token || '').trim();
  if (!t || INVALID_TOKEN_LITERALS.has(t.toLowerCase())) return false;
  return TELEGRAM_TOKEN_RE.test(t);
}

/**
 * Route an insight / alert type to the responsible role.
 */
export function roleForInsightType(type) {
  switch (type) {
    case 'staff_misallocation':
    case 'queue':
    case 'checkout':
      return 'cashier';
    case 'underperforming_zone':
    case 'lost_sales':
    case 'layout_friction':
    default:
      return 'merchandiser';
  }
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeConfig(input = {}) {
  const cfg = input || {};
  const esc = cfg.escalation || {};
  return {
    enabled: !!cfg.enabled,
    autoDispatchEnabled: !!cfg.autoDispatchEnabled,
    botToken: typeof cfg.botToken === 'string' ? cfg.botToken.trim() : '',
    botUsername: cfg.botUsername || null,
    appBaseUrl: (cfg.appBaseUrl || '').trim().replace(/\/$/, ''),
    inviteToken: cfg.inviteToken || null,
    tokenSavedAt: cfg.tokenSavedAt || null,
    escalation: {
      reminderSec: Math.max(30, num(esc.reminderSec, DEFAULT_ESCALATION.reminderSec)),
      escalateSec: Math.max(60, num(esc.escalateSec, DEFAULT_ESCALATION.escalateSec)),
      verifySec: Math.max(15, num(esc.verifySec, DEFAULT_ESCALATION.verifySec)),
    },
  };
}

function maskToken(token) {
  if (!token) return '';
  if (token.length <= 8) return '••••••••';
  return `${'•'.repeat(token.length - 4)}${token.slice(-4)}`;
}

/** Public-safe view of the config (no raw bot token). */
export function publicConfig(cfg, base) {
  const c = normalizeConfig(cfg);
  return {
    enabled: c.enabled,
    autoDispatchEnabled: c.autoDispatchEnabled,
    configured: isValidTelegramToken(c.botToken),
    hasToken: isValidTelegramToken(c.botToken),
    tokenLast4: isValidTelegramToken(c.botToken) && c.botToken.length >= 4 ? c.botToken.slice(-4) : '',
    tokenMasked: maskToken(c.botToken),
    tokenSavedAt: c.tokenSavedAt,
    botUsername: c.botUsername,
    appBaseUrl: c.appBaseUrl || base || '',
    inviteToken: c.inviteToken,
    escalation: c.escalation,
    roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id] })),
  };
}

// ─── Persistence ───

function ensureColumn(db) {
  try {
    const cols = db.prepare('PRAGMA table_info(venues)').all();
    if (!cols.some((c) => c.name === 'ops_dispatch_config_json')) {
      db.exec('ALTER TABLE venues ADD COLUMN ops_dispatch_config_json TEXT DEFAULT NULL');
    }
  } catch (err) {
    console.warn('[OpsDispatchConfig] ensureColumn failed:', err.message);
  }
}

export function getOpsConfig(db, venueId) {
  if (!db || !venueId) return normalizeConfig({});
  ensureColumn(db);
  try {
    const row = db.prepare('SELECT ops_dispatch_config_json FROM venues WHERE id = ?').get(venueId);
    let parsed = {};
    if (row && row.ops_dispatch_config_json) {
      parsed = JSON.parse(row.ops_dispatch_config_json);
    }
    let cfg = normalizeConfig(parsed);
    // Lazily mint a stable invite token on first read.
    if (!cfg.inviteToken) {
      cfg.inviteToken = crypto.randomBytes(12).toString('hex');
      saveOpsConfig(db, venueId, cfg);
    }
    return cfg;
  } catch (err) {
    console.warn('[OpsDispatchConfig] read failed:', err.message);
    return normalizeConfig({});
  }
}

export function saveOpsConfig(db, venueId, input) {
  ensureColumn(db);
  const existing = (() => {
    try {
      const row = db.prepare('SELECT ops_dispatch_config_json FROM venues WHERE id = ?').get(venueId);
      return row && row.ops_dispatch_config_json ? JSON.parse(row.ops_dispatch_config_json) : {};
    } catch {
      return {};
    }
  })();
  const merged = normalizeConfig({ ...existing, ...input });
  // Keep an invite token across saves.
  if (!merged.inviteToken) merged.inviteToken = existing.inviteToken || crypto.randomBytes(12).toString('hex');
  db.prepare(`UPDATE venues SET ops_dispatch_config_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(merged), venueId);
  return merged;
}

/**
 * Partial update preserving the (sensitive) saved token unless a new valid one
 * is supplied. Returns the saved normalized config.
 */
export function updateOpsConfig(db, venueId, payload = {}) {
  const current = getOpsConfig(db, venueId);
  const next = { ...current };
  if (typeof payload.enabled === 'boolean') next.enabled = payload.enabled;
  if (typeof payload.autoDispatchEnabled === 'boolean') next.autoDispatchEnabled = payload.autoDispatchEnabled;
  if (typeof payload.appBaseUrl === 'string') next.appBaseUrl = payload.appBaseUrl.trim().replace(/\/$/, '');
  if (payload.escalation) {
    next.escalation = {
      reminderSec: Math.max(30, num(payload.escalation.reminderSec, current.escalation.reminderSec)),
      escalateSec: Math.max(60, num(payload.escalation.escalateSec, current.escalation.escalateSec)),
      verifySec: Math.max(15, num(payload.escalation.verifySec, current.escalation.verifySec)),
    };
  }
  if (typeof payload.botToken === 'string' && payload.botToken.trim()) {
    const raw = payload.botToken.trim();
    if (!isValidTelegramToken(raw)) {
      return { error: 'INVALID_BOT_TOKEN', message: 'Invalid Telegram bot token. Paste the full token from @BotFather (format 123456789:ABCdef…).' };
    }
    next.botToken = raw;
    next.botUsername = null; // re-resolve on next getMe
    next.tokenSavedAt = new Date().toISOString();
  }
  return saveOpsConfig(db, venueId, next);
}

export { DEFAULT_ESCALATION };
