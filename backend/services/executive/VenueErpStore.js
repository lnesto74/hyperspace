/**
 * ERP / POS CSV storage for Esselunga executive KPIs (demo via CSV upload).
 */

import { v4 as uuidv4 } from 'uuid';
import XLSX from 'xlsx';

const HEADER_ALIASES = {
  date: ['date', 'data', 'giorno', 'day'],
  category: ['category', 'categoria', 'department', 'reparto', 'dept'],
  revenue: ['revenue', 'ricavi', 'sales', 'vendite', 'turnover', 'fatturato', 'amount', 'importo'],
  transactions: ['transactions', 'transazioni', 'tickets', 'scontrini', 'receipts', 'count'],
  avgTicket: ['avg_ticket', 'avg ticket', 'scontrino_medio', 'scontrino medio', 'average_ticket', 'ticket_avg'],
  areaSqm: ['area_sqm', 'area', 'sqm', 'm2', 'square_meters'],
};

function normKey(k) {
  return String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolveColumn(row, aliases) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const target = normKey(alias);
    const match = keys.find(k => normKey(k) === target || normKey(k).includes(target));
    if (match != null && row[match] != null && row[match] !== '') return row[match];
  }
  return null;
}

function parseDate(val) {
  if (val == null) return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return val.toISOString().slice(0, 10);
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parseNum(val) {
  if (val == null || val === '') return null;
  const n = Number(String(val).replace(/[€$,\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function ensureErpTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS venue_erp_daily (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      date TEXT NOT NULL,
      category TEXT,
      revenue REAL,
      transactions INTEGER,
      avg_ticket REAL,
      area_sqm REAL,
      uploaded_at TEXT NOT NULL,
      UNIQUE(venue_id, date, category)
    );
    CREATE INDEX IF NOT EXISTS idx_venue_erp_daily_venue_date
      ON venue_erp_daily(venue_id, date);
  `);
}

/**
 * Parse CSV/XLSX buffer into normalized ERP rows.
 * @returns {{ rows: object[], errors: string[] }}
 */
export function parseErpFile(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheet = workbook.SheetNames[0];
  if (!sheet) return { rows: [], errors: ['Spreadsheet has no sheets'] };

  const raw = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: null });
  const rows = [];
  const errors = [];

  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    const date = parseDate(resolveColumn(row, HEADER_ALIASES.date));
    if (!date) {
      errors.push(`Row ${i + 2}: missing or invalid date`);
      continue;
    }
    const category = resolveColumn(row, HEADER_ALIASES.category);
    const revenue = parseNum(resolveColumn(row, HEADER_ALIASES.revenue));
    const transactions = parseNum(resolveColumn(row, HEADER_ALIASES.transactions));
    let avgTicket = parseNum(resolveColumn(row, HEADER_ALIASES.avgTicket));
    const areaSqm = parseNum(resolveColumn(row, HEADER_ALIASES.areaSqm));

    if (revenue == null && transactions == null && avgTicket == null) {
      errors.push(`Row ${i + 2}: no revenue, transactions, or avg ticket`);
      continue;
    }
    if (avgTicket == null && revenue != null && transactions != null && transactions > 0) {
      avgTicket = Math.round((revenue / transactions) * 100) / 100;
    }

    rows.push({
      date,
      category: category ? String(category).trim() : null,
      revenue,
      transactions: transactions != null ? Math.round(transactions) : null,
      avgTicket,
      areaSqm,
    });
  }

  return { rows, errors };
}

export function upsertErpRows(db, venueId, rows) {
  ensureErpTable(db);
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO venue_erp_daily (id, venue_id, date, category, revenue, transactions, avg_ticket, area_sqm, uploaded_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(venue_id, date, category) DO UPDATE SET
      revenue = excluded.revenue,
      transactions = excluded.transactions,
      avg_ticket = excluded.avg_ticket,
      area_sqm = excluded.area_sqm,
      uploaded_at = excluded.uploaded_at
  `);

  let upserted = 0;
  const tx = db.transaction((items) => {
    for (const r of items) {
      stmt.run(
        uuidv4(),
        venueId,
        r.date,
        r.category,
        r.revenue,
        r.transactions,
        r.avgTicket,
        r.areaSqm,
        now,
      );
      upserted += 1;
    }
  });
  tx(rows);
  return upserted;
}

export function fetchErpForRange(db, venueId, startTs, endTs) {
  ensureErpTable(db);
  const startDate = new Date(startTs).toISOString().slice(0, 10);
  const endDate = new Date(endTs).toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT date, category, revenue, transactions, avg_ticket, area_sqm, uploaded_at
    FROM venue_erp_daily
    WHERE venue_id = ? AND date >= ? AND date <= ?
    ORDER BY date, category
  `).all(venueId, startDate, endDate);

  const storeRows = rows.filter(r => !r.category);
  const categoryRows = rows.filter(r => r.category);

  const totalRevenue = storeRows.reduce((s, r) => s + (r.revenue || 0), 0)
    || categoryRows.reduce((s, r) => s + (r.revenue || 0), 0);
  const totalTransactions = storeRows.reduce((s, r) => s + (r.transactions || 0), 0)
    || categoryRows.reduce((s, r) => s + (r.transactions || 0), 0);

  let avgTicket = null;
  if (storeRows.length) {
    const tickets = storeRows.filter(r => r.avg_ticket != null).map(r => r.avg_ticket);
    if (tickets.length) avgTicket = tickets.reduce((a, b) => a + b, 0) / tickets.length;
  }
  if (avgTicket == null && totalRevenue > 0 && totalTransactions > 0) {
    avgTicket = Math.round((totalRevenue / totalTransactions) * 100) / 100;
  }

  const byCategory = new Map();
  for (const r of categoryRows) {
    const key = r.category;
    const prev = byCategory.get(key) || { revenue: 0, transactions: 0 };
    prev.revenue += r.revenue || 0;
    prev.transactions += r.transactions || 0;
    byCategory.set(key, prev);
  }

  const lastUpload = rows.length
    ? rows.reduce((max, r) => (r.uploaded_at > max ? r.uploaded_at : max), rows[0].uploaded_at)
    : null;

  return {
    hasData: rows.length > 0,
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    totalTransactions,
    avgTicket: avgTicket != null ? Math.round(avgTicket * 100) / 100 : null,
    byCategory: [...byCategory.entries()].map(([category, v]) => ({
      category,
      revenue: Math.round(v.revenue * 100) / 100,
      transactions: v.transactions,
    })),
    rowCount: rows.length,
    lastUpload,
  };
}
