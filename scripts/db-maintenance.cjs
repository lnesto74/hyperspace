/**
 * SQLite maintenance for the production analytics database.
 *
 * Two operations, deliberately separate because their risk profiles differ:
 *
 *   checkpoint  Fold the WAL back into the main database and truncate it.
 *               Safe to run with the backend live — SQLite is designed for
 *               concurrent access and this only needs a brief write lock.
 *
 *   vacuum      Rewrite the whole file to reclaim free pages. Takes an
 *               EXCLUSIVE lock for the duration, so the backend must be
 *               stopped first. Needs temporary free disk equal to the live
 *               data size.
 *
 * Usage:
 *   node scripts/db-maintenance.cjs status
 *   node scripts/db-maintenance.cjs checkpoint
 *   node scripts/db-maintenance.cjs vacuum
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const action = process.argv[2] || 'status';

const gb = (b) => `${(b / 1e9).toFixed(2)} GB`;
const sizeOf = (p) => (fs.existsSync(p) ? fs.statSync(p).size : 0);

function report(db, label) {
  const pageSize = db.pragma('page_size', { simple: true });
  const pageCount = db.pragma('page_count', { simple: true });
  const freelist = db.pragma('freelist_count', { simple: true });
  const live = (pageCount - freelist) * pageSize;
  console.log(`\n[${label}]`);
  console.log(`  main file     ${gb(sizeOf(DB_PATH))}`);
  console.log(`  wal           ${gb(sizeOf(`${DB_PATH}-wal`))}`);
  console.log(`  live data     ${gb(live)}`);
  console.log(`  free pages    ${freelist} of ${pageCount} (${((freelist / pageCount) * 100).toFixed(1)}%)`);
  console.log(`  reclaimable   ${gb(freelist * pageSize)}`);
  console.log(`  auto_vacuum   ${db.pragma('auto_vacuum', { simple: true })} (0=none 1=full 2=incremental)`);
  console.log(`  journal_mode  ${db.pragma('journal_mode', { simple: true })}`);
  return { live, reclaimable: freelist * pageSize };
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH}`);
  process.exit(1);
}

if (action === 'status') {
  const db = new Database(DB_PATH, { readonly: true });
  report(db, 'current');
  db.close();
  process.exit(0);
}

if (action === 'checkpoint') {
  const db = new Database(DB_PATH);
  report(db, 'before');
  const t0 = Date.now();
  // [busy, log_pages, checkpointed_pages]; busy != 0 means readers blocked it.
  const res = db.pragma('wal_checkpoint(TRUNCATE)');
  console.log(`\n  checkpoint result: ${JSON.stringify(res)}  (${Date.now() - t0} ms)`);
  report(db, 'after');
  db.close();
  process.exit(0);
}

if (action === 'vacuum') {
  const db = new Database(DB_PATH);
  const { live } = report(db, 'before');

  // VACUUM builds a full copy alongside the original before swapping.
  const dir = path.dirname(DB_PATH);
  let free = null;
  try {
    const st = fs.statfsSync(dir);
    free = st.bavail * st.bsize;
  } catch { /* statfs unavailable on this node build */ }
  if (free != null) {
    console.log(`\n  free disk on ${dir}: ${gb(free)}, need ~${gb(live * 1.2)}`);
    if (free < live * 1.2) {
      console.error('  ABORT: not enough free disk to VACUUM safely.');
      process.exit(2);
    }
  }

  console.log('\n  running VACUUM — this takes an exclusive lock...');
  const t0 = Date.now();
  db.exec('VACUUM');
  console.log(`  done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  report(db, 'after');
  db.close();
  process.exit(0);
}

console.error(`Unknown action: ${action}. Use status | checkpoint | vacuum.`);
process.exit(1);
