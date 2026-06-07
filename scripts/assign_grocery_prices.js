/**
 * One-off: assign realistic grocery prices + per-category gross margins to
 * sku_items that are missing them. Deterministic (stable per SKU id) so re-runs
 * are idempotent for unpriced rows and never clobber real prices.
 *
 * Run inside the backend container:
 *   docker compose -f docker-compose.prod.yml exec -T backend node - < assign_grocery_prices.js
 *
 * margin is stored as a PERCENT (e.g. 22 = 22% gross), matching recoveryModel's
 * marginPerUnit() which reads 1..100 as a percentage.
 */
const Database = require('better-sqlite3');
const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const db = new Database(DB_PATH);
db.pragma('busy_timeout = 15000');

// Stable pseudo-random in [0,1) from a string (FNV-1a).
function rng(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

// Italian supermarket (Esselunga-like) realistic price band (€) + gross margin %.
const CAT = {
  'Pantry':                 { min: 0.79, max: 4.50, margin: 22 },
  'Bakery & Breakfast':     { min: 1.00, max: 5.00, margin: 28 },
  'Dairy & Eggs':           { min: 0.89, max: 4.00, margin: 18 },
  'Beverages':              { min: 0.50, max: 6.00, margin: 20 },
  'Frozen & Ready Meals':   { min: 2.00, max: 8.00, margin: 26 },
  'Snacks & Confectionery': { min: 0.80, max: 4.00, margin: 35 },
  'Fresh Produce':          { min: 0.80, max: 5.00, margin: 30 },
  'Other':                  { min: 1.00, max: 6.00, margin: 24 },
};
const DEFAULT = { min: 1.00, max: 5.00, margin: 22 };

const rows = db.prepare('SELECT id, name, category, price FROM sku_items').all();
const upd = db.prepare('UPDATE sku_items SET price = ?, margin = ? WHERE id = ?');

let pricesAssigned = 0;
let marginsSet = 0;
const tx = db.transaction(() => {
  for (const r of rows) {
    const cfg = CAT[r.category] || DEFAULT;
    const hasPrice = r.price && r.price > 0;
    const price = hasPrice ? r.price : +(cfg.min + rng(r.id) * (cfg.max - cfg.min)).toFixed(2);
    if (!hasPrice) pricesAssigned++;
    // gross margin % with small deterministic jitter (±2pt), floored at 5%.
    const jitter = rng(r.id + 'm') * 4 - 2;
    const margin = Math.max(5, Math.round((cfg.margin + jitter) * 10) / 10);
    marginsSet++;
    upd.run(price, margin, r.id);
  }
});
tx();

console.log('rows:', rows.length, '| prices assigned:', pricesAssigned, '| margins set:', marginsSet);
console.log(db.prepare(
  "SELECT COALESCE(category,'(none)') cat, COUNT(*) c, ROUND(AVG(price),2) avgPrice, ROUND(AVG(margin),1) avgMarginPct FROM sku_items GROUP BY category ORDER BY c DESC"
).all());
db.close();
