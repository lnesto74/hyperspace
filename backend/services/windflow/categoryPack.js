// Data of the Windflow "Categories" lens (analysis/journey_lab/250_category_pack.py), one folder per venue:
// sections.json (planogram geometry), <day>.json (category KPIs copied from daily_kpi + stops per module), index.json.
// Folder: CATEGORY_PACK_DIR/<venue>; else next to the daily KPI reports (production: /data/reports/categories/<venue>);
// locally, without /data/reports, the static folder of the workspace.
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = () => process.env.HYPERSPACE_ROOT || path.resolve(__dirname, '../../..');
const SCRIPT = 'analysis/journey_lab/250_category_pack.py';
export const CATEGORY_FILE = /^(index|sections|reach|\d{4}-\d{2}-\d{2})\.json$/;

export function categoryPackDir(venueId) {
  if (process.env.CATEGORY_PACK_DIR) return path.join(process.env.CATEGORY_PACK_DIR, venueId);
  if (process.env.DAILY_KPI_REPORT) return path.join(path.dirname(process.env.DAILY_KPI_REPORT), 'categories', venueId);
  if (fs.existsSync('/data/reports')) return path.join('/data/reports/categories', venueId);
  return path.join(repoRoot(), 'frontend/public/flowfield/categories');
}

function run(args, env) {
  const py = process.env.DAILY_KPI_PYTHON || process.env.JL_PYTHON || 'python3';
  return new Promise((resolve, reject) => {
    const child = spawn(py, [path.join(repoRoot(), SCRIPT), ...args], { cwd: repoRoot(), env: { ...process.env, ...env } });
    let err = '';
    child.stdout.on('data', (d) => process.stdout.write(`[categories] ${d}`));
    child.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`250_category_pack.py exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
  });
}

/**
 * Write the lens file of one day, only when daily_kpi holds ok category rows for it. sections.json is built
 * first if the folder has none. rows = per-second positions (230_flow_rows.py) for the stops per module.
 * Never throws: the lens is optional, the day is not.
 */
export async function buildCategoryDay({ db, venueId, day, rows = null, runner = run }) {
  try {
    if (!db?.name) return { skipped: 'no sqlite file' };
    const ok = db.prepare(
      "SELECT 1 FROM daily_kpi WHERE venue_id = ? AND day = ? AND kpi_id LIKE 'category_kpi_%' AND status = 'ok' LIMIT 1",
    ).get(venueId, day);
    if (!ok) return { skipped: 'no ok category rows' };
    const dir = categoryPackDir(venueId);
    fs.mkdirSync(dir, { recursive: true });
    const env = { CAT_SITE: dir };
    if (!fs.existsSync(path.join(dir, 'sections.json'))) await runner(['sections'], env);
    const args = ['day', day, '--db', db.name];
    if (rows && fs.existsSync(rows)) args.push('--rows', rows);
    await runner(args, env);
    return { dir, modules: args.includes('--rows') };
  } catch (err) {
    console.warn('[categories] lens pack skipped:', err.message);
    return { error: err.message };
  }
}
