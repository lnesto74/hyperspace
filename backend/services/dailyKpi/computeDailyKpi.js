import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { persistDailyKpi, loadDailyKpi } from './store.js';
import { ensureDailyKpiTables } from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../..');
const JL_DIR = path.join(REPO_ROOT, 'analysis/journey_lab');
const SCRIPT = path.join(REPO_ROOT, 'scripts/daily-customer-kpi.py');
const TREVIGLIO = '55fdd53b-3298-4355-97c0-b4e789b11d06';

const DEFAULT_REPORT_DIR = process.env.DAILY_KPI_REPORT || '/data/hyperspace/reports/daily-kpi';
const DEFAULT_PARQUET_DIR = process.env.DAILY_KPI_PARQUET_DIR || '/data/hyperspace/raw';

function pythonBin() {
  return process.env.DAILY_KPI_PYTHON || process.env.JL_PYTHON || 'python3';
}

function defaultParquet(day) {
  return path.join(DEFAULT_PARQUET_DIR, `hyperspace-raw-${day}.parquet`);
}

function defaultLabOut(day) {
  return path.join(JL_DIR, 'out', day);
}

function exportVenueGeometry(db, venueId, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const rois = db.prepare(
    `SELECT id, name, vertices, metadata_json FROM regions_of_interest WHERE venue_id = ?`,
  ).all(venueId);
  const objects = db.prepare(
    `SELECT id, type, name, position_x, position_y, position_z, rotation_x, rotation_y, rotation_z,
            scale_x, scale_y, scale_z, metadata_json
     FROM venue_objects WHERE venue_id = ?`,
  ).all(venueId);

  const roiHeader = 'id,name,vertices,metadata_json\n';
  const roiBody = rois.map((r) => {
    const verts = JSON.stringify(typeof r.vertices === 'string' ? JSON.parse(r.vertices) : r.vertices);
    const meta = r.metadata_json || '{}';
    return `${csv(r.id)},${csv(r.name)},${csv(verts)},${csv(meta)}`;
  }).join('\n');
  fs.writeFileSync(path.join(destDir, 'regions_of_interest.csv'), roiHeader + roiBody + (roiBody ? '\n' : ''));

  const objHeader = 'id,type,name,position_x,position_y,position_z,rotation_x,rotation_y,rotation_z,scale_x,scale_y,scale_z,metadata_json\n';
  const objBody = objects.map((o) => [
    csv(o.id), csv(o.type), csv(o.name),
    o.position_x, o.position_y, o.position_z,
    o.rotation_x, o.rotation_y, o.rotation_z,
    o.scale_x, o.scale_y, o.scale_z,
    csv(o.metadata_json || '{}'),
  ].join(',')).join('\n');
  fs.writeFileSync(path.join(destDir, 'venue_objects.csv'), objHeader + objBody + (objBody ? '\n' : ''));
  return { rois: rois.length, objects: objects.length };
}

function csv(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function runPython(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), [SCRIPT, ...args], {
      env: { ...process.env, ...env },
      cwd: REPO_ROOT,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { stderr += d; process.stderr.write(d); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`daily-customer-kpi.py exited ${code}\n${stderr}`));
    });
  });
}

/**
 * Compute (or assemble) one venue/day and persist to SQLite + JSON.
 * assembleOnly: reuse Journey Lab JSON already on disk (tests, backfill of a lab day).
 */
export async function computeDailyKpi({
  db,
  venueId = TREVIGLIO,
  day,
  parquetPath,
  assembleOnly = false,
  labOut,
  reportDir = DEFAULT_REPORT_DIR,
  exportGeometry = true,
} = {}) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`invalid day: ${day}`);
  }
  ensureDailyKpiTables(db);

  const parquet = parquetPath || defaultParquet(day);
  const labDir = labOut || defaultLabOut(day);
  const haveLab = fs.existsSync(path.join(labDir, '110_average_journey.json'))
    && fs.existsSync(path.join(labDir, '150_queue_wait.json'));
  const haveParquet = fs.existsSync(parquet);
  const shouldAssemble = assembleOnly || (haveLab && !haveParquet);

  if (exportGeometry && db && !shouldAssemble) {
    const dataDay = path.join(JL_DIR, 'data', day);
    try {
      exportVenueGeometry(db, venueId, dataDay);
    } catch (err) {
      console.warn('[daily-kpi] geometry export skipped:', err.message);
    }
  }

  const args = [
    '--day', day,
    '--venue', venueId,
    '--report', reportDir,
    '--cfg', path.join(JL_DIR, 'config/treviglio.json'),
    '--lab-out', labDir,
  ];
  if (shouldAssemble) args.push('--assemble-only');
  else {
    args.push('--compute');
    if (haveParquet) args.push('--parquet', parquet);
  }

  const env = {
    JL_ROOT: JL_DIR,
    JL_CFG: path.join(JL_DIR, 'config/treviglio.json'),
    JL_OUT: path.dirname(labDir),
    DAILY_KPI_REPORT: reportDir,
  };
  if (haveParquet) env.JL_PARQUET = parquet;

  await runPython(args, env);

  const jsonPath = path.join(reportDir, venueId, `${day}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`daily kpi JSON missing after run: ${jsonPath}`);
  }
  const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  persistDailyKpi(db, payload);
  return payload;
}

export async function computeDailyKpiRange({ db, venueId = TREVIGLIO, from, to, ...rest }) {
  const days = enumerateDays(from, to);
  const results = [];
  for (const day of days) {
    results.push(await computeDailyKpi({ db, venueId, day, ...rest }));
  }
  return results;
}

export function enumerateDays(from, to) {
  const out = [];
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export { loadDailyKpi, TREVIGLIO, DEFAULT_REPORT_DIR };
