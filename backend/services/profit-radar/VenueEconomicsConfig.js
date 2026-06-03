/**
 * VenueEconomicsConfig
 *
 * Per-venue economics used to ground Profit Radar's € impact estimates in the
 * client's real numbers instead of a hardcoded band. Persisted as a JSON blob
 * on venues.economics_config_json (created lazily, mirrors checkout_alert_config_json).
 *
 * Model:
 *   dailyGrossMargin = avgBasketValue * dailyTransactions * grossMarginPct/100
 *   An insight's recoverable € band = a severity-based fraction of dailyGrossMargin.
 * When the venue is not configured, we fall back to the legacy fixed bands so
 * nothing breaks for venues without economics.
 */

const DEFAULT_CURRENCY = '€';

// Recoverable share of DAILY gross margin attributable to fixing one issue.
const RECOVERABLE_FRACTION = {
  high: [0.015, 0.04],
  medium: [0.004, 0.015],
  low: [0.001, 0.004],
};

// Legacy fixed bands (used when economics is not configured).
const DEFAULT_BAND = {
  high: { min: 500, max: 2000 },
  medium: { min: 100, max: 500 },
  low: { min: 20, max: 100 },
};

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeEconomics(input = {}) {
  const cfg = input || {};
  const avgBasketValue = Math.max(0, num(cfg.avgBasketValue, 0));
  const grossMarginPct = Math.min(100, Math.max(0, num(cfg.grossMarginPct, 0)));
  const dailyTransactions = Math.max(0, num(cfg.dailyTransactions, 0));
  const tradingDaysPerWeekRaw = num(cfg.tradingDaysPerWeek, 7);
  const tradingDaysPerWeek = Math.min(7, Math.max(1, tradingDaysPerWeekRaw || 7));
  const currency = typeof cfg.currency === 'string' && cfg.currency.trim() ? cfg.currency.trim() : DEFAULT_CURRENCY;

  const configured = avgBasketValue > 0 && dailyTransactions > 0 && grossMarginPct > 0;
  const dailyRevenue = avgBasketValue * dailyTransactions;
  const dailyGrossMargin = dailyRevenue * (grossMarginPct / 100);

  return {
    avgBasketValue,
    grossMarginPct,
    dailyTransactions,
    tradingDaysPerWeek,
    currency,
    source: cfg.source === 'import' ? 'import' : 'manual',
    importedFileName: cfg.importedFileName || null,
    updatedAt: cfg.updatedAt || null,
    // derived (read-only)
    configured,
    dailyRevenue: Math.round(dailyRevenue),
    dailyGrossMargin: Math.round(dailyGrossMargin),
  };
}

/**
 * € impact band for an insight, grounded in venue economics when available.
 * @returns {{ min:number, max:number, currency:string, basis:'economics'|'default' }}
 */
export function computeImpactBand(severity, economics) {
  const sev = RECOVERABLE_FRACTION[severity] ? severity : 'medium';
  const econ = economics && economics.configured ? economics : null;

  if (econ) {
    const [fMin, fMax] = RECOVERABLE_FRACTION[sev];
    const margin = econ.dailyGrossMargin || 0;
    const min = Math.max(1, Math.round(margin * fMin));
    const max = Math.max(min + 1, Math.round(margin * fMax));
    return { min, max, currency: econ.currency || DEFAULT_CURRENCY, basis: 'economics' };
  }

  const band = DEFAULT_BAND[sev];
  return { min: band.min, max: band.max, currency: DEFAULT_CURRENCY, basis: 'default' };
}

// ─── Persistence ───

function ensureColumn(db) {
  try {
    const cols = db.prepare('PRAGMA table_info(venues)').all();
    if (!cols.some(c => c.name === 'economics_config_json')) {
      db.exec("ALTER TABLE venues ADD COLUMN economics_config_json TEXT DEFAULT NULL");
    }
  } catch (err) {
    console.warn('[VenueEconomics] ensureColumn failed:', err.message);
  }
}

export function getVenueEconomics(db, venueId) {
  if (!db || !venueId) return normalizeEconomics({});
  ensureColumn(db);
  try {
    const row = db.prepare('SELECT economics_config_json FROM venues WHERE id = ?').get(venueId);
    if (!row || !row.economics_config_json) return normalizeEconomics({});
    return normalizeEconomics(JSON.parse(row.economics_config_json));
  } catch (err) {
    console.warn('[VenueEconomics] read failed:', err.message);
    return normalizeEconomics({});
  }
}

export function saveVenueEconomics(db, venueId, input) {
  ensureColumn(db);
  const normalized = normalizeEconomics(input);
  const payload = {
    avgBasketValue: normalized.avgBasketValue,
    grossMarginPct: normalized.grossMarginPct,
    dailyTransactions: normalized.dailyTransactions,
    tradingDaysPerWeek: normalized.tradingDaysPerWeek,
    currency: normalized.currency,
    source: normalized.source,
    importedFileName: normalized.importedFileName,
    updatedAt: new Date().toISOString(),
  };
  db.prepare(`UPDATE venues SET economics_config_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(payload), venueId);
  return normalizeEconomics(payload);
}

// ─── Sales-file (XLS/CSV) derivation ───

const HEADER_KEYS = {
  revenue: ['revenue', 'sales', 'net sales', 'gross sales', 'amount', 'total', 'turnover', 'importo', 'vendite', 'incasso', 'fatturato'],
  transactions: ['transactions', 'transaction', 'receipts', 'tickets', 'orders', 'baskets', 'count', 'scontrini', 'num_tx', 'n_transazioni'],
  cost: ['cost', 'cogs', 'cost of goods', 'costo', 'costi'],
  margin: ['margin', 'margine', 'gross margin', 'margin pct', 'margin %'],
  basket: ['basket', 'avg basket', 'average basket', 'aov', 'scontrino medio', 'basket value'],
  date: ['date', 'day', 'data', 'giorno', 'period'],
};

function matchColumn(headers, kind) {
  const keys = HEADER_KEYS[kind];
  for (const h of headers) {
    const lower = String(h).toLowerCase().trim();
    if (keys.some(k => lower === k || lower.includes(k))) return h;
  }
  return null;
}

/** Parse a numeric cell that may carry currency symbols and EU/US separators. */
export function parseNumericCell(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  let s = String(value).replace(/[^0-9.,\-]/g, '').trim();
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Assume the last separator is the decimal one.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // Single comma → treat as decimal if it looks like one (e.g. 12,50), else thousands.
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) s = s.replace(',', '.');
    else s = s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Derive economics inputs from parsed sheet rows (array of header→value objects).
 * Returns suggested values + parse metadata; does NOT persist.
 */
export function deriveEconomicsFromRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'No rows found in file.' };
  }
  const headers = Object.keys(rows[0] || {});
  const col = {
    revenue: matchColumn(headers, 'revenue'),
    transactions: matchColumn(headers, 'transactions'),
    cost: matchColumn(headers, 'cost'),
    margin: matchColumn(headers, 'margin'),
    basket: matchColumn(headers, 'basket'),
    date: matchColumn(headers, 'date'),
  };

  let totalRevenue = 0, totalCost = 0, totalTx = 0;
  let basketSum = 0, basketCount = 0, marginSum = 0, marginCount = 0;
  const days = new Set();

  for (const row of rows) {
    if (col.revenue) { const v = parseNumericCell(row[col.revenue]); if (Number.isFinite(v)) totalRevenue += v; }
    if (col.cost) { const v = parseNumericCell(row[col.cost]); if (Number.isFinite(v)) totalCost += v; }
    if (col.transactions) { const v = parseNumericCell(row[col.transactions]); if (Number.isFinite(v)) totalTx += v; }
    if (col.basket) { const v = parseNumericCell(row[col.basket]); if (Number.isFinite(v)) { basketSum += v; basketCount++; } }
    if (col.margin) { const v = parseNumericCell(row[col.margin]); if (Number.isFinite(v)) { marginSum += v; marginCount++; } }
    if (col.date && row[col.date] != null && String(row[col.date]).trim()) days.add(String(row[col.date]).trim());
  }

  // If no explicit transaction column, count rows as transactions (one row = one receipt).
  if (!col.transactions && col.revenue) totalTx = rows.length;
  const dayCount = days.size > 0 ? days.size : 1;

  const avgBasketValue = basketCount > 0
    ? basketSum / basketCount
    : (totalTx > 0 ? totalRevenue / totalTx : 0);

  let grossMarginPct = 0;
  if (marginCount > 0) {
    grossMarginPct = marginSum / marginCount; // assume already a percentage
  } else if (col.cost && totalRevenue > 0) {
    grossMarginPct = ((totalRevenue - totalCost) / totalRevenue) * 100;
  }

  const dailyTransactions = totalTx / dayCount;

  return {
    ok: true,
    derived: {
      avgBasketValue: +avgBasketValue.toFixed(2),
      grossMarginPct: +grossMarginPct.toFixed(1),
      dailyTransactions: Math.round(dailyTransactions),
      tradingDaysPerWeek: 7,
    },
    meta: {
      rowCount: rows.length,
      dayCount,
      detectedColumns: col,
      totals: {
        revenue: +totalRevenue.toFixed(2),
        cost: +totalCost.toFixed(2),
        transactions: Math.round(totalTx),
      },
    },
  };
}

export { RECOVERABLE_FRACTION, DEFAULT_BAND };
