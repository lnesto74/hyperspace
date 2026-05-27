#!/usr/bin/env node
/**
 * Diagnose offline reconcile jobs stuck at 99%.
 *
 * Run on DO (inside backend container — backend dir is mounted ro):
 *   docker compose -f docker-compose.prod.yml exec backend \
 *     node /opt/hyperspace/backend/scripts/diagnose-offline-reconcile.mjs status
 *
 *   docker compose -f docker-compose.prod.yml exec backend \
 *     node /opt/hyperspace/backend/scripts/diagnose-offline-reconcile.mjs watch --source grocery_capture_....jsonl
 *
 *   docker compose -f docker-compose.prod.yml exec backend \
 *     node /opt/hyperspace/backend/scripts/diagnose-offline-reconcile.mjs probe --source grocery_capture_....jsonl
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import Database from 'better-sqlite3';
import { getOfflinePreset } from '../config/offlineReconcilePresets.js';
import { runBatchReconciliationToFile } from '../services/offline/BatchTrajectoryReconciler.js';
import { venueQueries } from '../database/schema.js';

const REPLAY_DIR = process.env.REPLAY_DIR || '/data/replay';
const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';
const VENUE_DEFAULT = '55fdd53b-3298-4355-97c0-b4e789b11d06';

function mem() {
  const m = process.memoryUsage();
  return {
    heapMB: Math.round(m.heapUsed / 1024 / 1024),
    rssMB: Math.round(m.rss / 1024 / 1024),
  };
}

function parseArgs(argv) {
  const args = { mode: 'status', source: null, preset: 'GROCERY_BALANCED', venue: VENUE_DEFAULT, lines: 80_000, interval: 5, jobId: null };
  const rest = [...argv];
  if (rest[0] && !rest[0].startsWith('-')) {
    args.mode = rest.shift();
  }
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--source' || a === '-s') args.source = rest[++i];
    else if (a === '--preset' || a === '-p') args.preset = rest[++i];
    else if (a === '--venue' || a === '-v') args.venue = rest[++i];
    else if (a === '--lines' || a === '-n') args.lines = Number(rest[++i]) || args.lines;
    else if (a === '--interval') args.interval = Number(rest[++i]) || args.interval;
    else if (a === '--job' || a === '-j') args.jobId = rest[++i];
  }
  return args;
}

function fmtTs(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString();
}

function listJobs(db, sourceFile) {
  if (sourceFile) {
    return db.prepare(`
      SELECT * FROM offline_reconcile_jobs WHERE source_file = ? ORDER BY created_at DESC LIMIT 10
    `).all(path.basename(sourceFile));
  }
  return db.prepare(`
    SELECT * FROM offline_reconcile_jobs ORDER BY created_at DESC LIMIT 10
  `).all();
}

function printJob(row) {
  const pct = Math.round((row.progress || 0) * 100);
  console.log(`  id:       ${row.id}`);
  console.log(`  preset:   ${row.preset_id} (${row.preset_label})`);
  console.log(`  status:   ${row.status}  progress: ${pct}%`);
  console.log(`  source:   ${row.source_file}`);
  console.log(`  artifact: ${row.artifact_path || '—'}`);
  console.log(`  error:    ${row.error || '—'}`);
  console.log(`  started:  ${fmtTs(row.started_at)}`);
  console.log(`  finished: ${fmtTs(row.finished_at)}`);
  if (row.artifact_path && fs.existsSync(row.artifact_path)) {
    const st = fs.statSync(row.artifact_path);
    console.log(`  artifact size: ${(st.size / 1024 / 1024).toFixed(2)} MB  mtime: ${st.mtime.toISOString()}`);
  } else if (row.artifact_path) {
    console.log(`  artifact size: (file missing)`);
  }
}

async function countLines(filePath, maxLines = Infinity) {
  let n = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim() && !line.startsWith('nohup:')) n++;
    if (n >= maxLines) break;
  }
  return n;
}

async function cmdStatus(args) {
  console.log('=== Offline reconcile status ===');
  console.log(`DB: ${DB_PATH}  REPLAY_DIR: ${REPLAY_DIR}  mem:`, mem());
  const db = new Database(DB_PATH, { readonly: true });
  const rows = listJobs(db, args.source);
  if (!rows.length) {
    console.log('No jobs found.');
    db.close();
    return;
  }
  const active = rows.find(r => r.status === 'running' || r.status === 'pending');
  const target = args.jobId
    ? rows.find(r => r.id === args.jobId)
    : active || rows[0];
  console.log('\n--- Target job ---');
  if (target) printJob(target);
  console.log('\n--- Recent jobs ---');
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.status.padEnd(8)} ${Math.round((r.progress || 0) * 100).toString().padStart(3)}%  ${r.preset_id.padEnd(18)}  ${r.id.slice(0, 8)}…  ${r.error ? 'ERR' : ''}`);
  }
  db.close();
}

async function cmdWatch(args) {
  console.log(`Watching every ${args.interval}s (Ctrl+C to stop)…`);
  for (let i = 0; i < 120; i++) {
    console.log(`\n--- tick ${i + 1} ${new Date().toISOString()} mem=${JSON.stringify(mem())} ---`);
    await cmdStatus(args);
    const db = new Database(DB_PATH, { readonly: true });
    const rows = listJobs(db, args.source);
    const job = rows.find(r => r.status === 'running') || rows[0];
    db.close();
    if (job?.artifact_path && fs.existsSync(job.artifact_path)) {
      const st = fs.statSync(job.artifact_path);
      console.log(`  artifact growing?: ${st.size} bytes @ ${st.mtime.toISOString()}`);
    }
    if (job?.status === 'complete' || job?.status === 'failed') {
      console.log(`Job terminal: ${job.status}`);
      break;
    }
    await new Promise(r => setTimeout(r, args.interval * 1000));
  }
}

async function cmdProbe(args) {
  const base = path.basename(String(args.source || ''));
  if (!base) {
    console.error('Usage: probe --source CAPTURE.jsonl');
    process.exit(1);
  }
  const fullPath = path.join(REPLAY_DIR, base);
  console.log('=== Capture probe ===');
  if (!fs.existsSync(fullPath)) {
    console.error(`Missing capture: ${fullPath}`);
    process.exit(1);
  }
  const st = fs.statSync(fullPath);
  console.log(`File: ${fullPath}`);
  console.log(`Size: ${(st.size / 1024 / 1024).toFixed(2)} MB`);
  console.log('Counting lines (may take ~30s on 300MB)…');
  const lines = await countLines(fullPath, 2_000_000);
  console.log(`Lines (position samples): ~${lines.toLocaleString()}`);
  const preset = getOfflinePreset(args.preset);
  console.log(`Preset: ${args.preset} ${preset ? 'OK' : 'MISSING'}`);
  const artifactDir = path.join(REPLAY_DIR, 'reconciled');
  console.log(`Reconciled dir: ${artifactDir}`);
  try {
    const files = fs.readdirSync(artifactDir).filter(f => f.includes(base.replace('.jsonl', '')));
    for (const f of files) {
      const p = path.join(artifactDir, f);
      const a = fs.statSync(p);
      console.log(`  ${f}  ${(a.size / 1024 / 1024).toFixed(2)} MB  ${a.mtime.toISOString()}`);
    }
    if (!files.length) console.log('  (no matching artifacts)');
  } catch (e) {
    console.log(`  reconciled dir error: ${e.message}`);
  }
}

async function cmdRunSample(args) {
  const base = path.basename(String(args.source || ''));
  if (!base) {
    console.error('Usage: run-sample --source CAPTURE.jsonl [--lines 80000]');
    process.exit(1);
  }
  const fullPath = path.join(REPLAY_DIR, base);
  const samplePath = `/tmp/reconcile-sample-${Date.now()}.jsonl`;
  const outPath = `/tmp/reconcile-sample-out-${Date.now()}.jsonl`;
  console.log(`=== Sample run (${args.lines} lines) === mem:`, mem());

  console.log(`Head ${args.lines} lines → ${samplePath}`);
  const rl = readline.createInterface({ input: fs.createReadStream(fullPath), crlfDelay: Infinity });
  const ws = fs.createWriteStream(samplePath);
  let n = 0;
  for await (const line of rl) {
    if (!line.trim() || line.startsWith('nohup:')) continue;
    ws.write(`${line}\n`);
    n++;
    if (n >= args.lines) break;
  }
  await new Promise((res, rej) => { ws.end(res); ws.on('error', rej); });
  console.log(`Sample lines: ${n}  mem:`, mem());

  const db = new Database(DB_PATH, { readonly: true });
  const venue = venueQueries.getById(db, args.venue);
  db.close();
  let transform = {};
  if (venue?.dwg_transform_json) {
    try {
      transform = JSON.parse(venue.dwg_transform_json).perceptionTransform || {};
    } catch { /* ignore */ }
  }
  const preset = getOfflinePreset(args.preset);
  if (!preset) throw new Error(`Unknown preset ${args.preset}`);

  const t0 = Date.now();
  let lastPhase = '';
  const result = await runBatchReconciliationToFile({
    filePath: samplePath,
    artifactPath: outPath,
    venueId: args.venue,
    transform,
    configOverrides: preset.config,
    meta: { diagnostic: true, sampleLines: n },
    onProgress: (p) => {
      const line = `[${((Date.now() - t0) / 1000).toFixed(1)}s] phase=${p.phase} ${JSON.stringify({ ...p, phase: undefined })} mem=${JSON.stringify(mem())}`;
      if (p.phase !== lastPhase || p.batches || p.messages) {
        console.log(line);
        lastPhase = p.phase;
      }
    },
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const outSize = fs.statSync(outPath).size;
  console.log(`\nDone in ${elapsed}s  out=${outPath}  size=${(outSize / 1024 / 1024).toFixed(2)} MB`);
  console.log('Metrics:', result.metrics);
  try { fs.unlinkSync(samplePath); } catch { /* ignore */ }
}

const args = parseArgs(process.argv.slice(2));

try {
  switch (args.mode) {
    case 'status':
      await cmdStatus(args);
      break;
    case 'watch':
      await cmdWatch(args);
      break;
    case 'probe':
      await cmdProbe(args);
      break;
    case 'run-sample':
      await cmdRunSample(args);
      break;
    default:
      console.log(`Unknown mode: ${args.mode}`);
      console.log('Modes: status | watch | probe | run-sample');
      process.exit(1);
  }
} catch (err) {
  console.error('FATAL:', err);
  process.exit(1);
}
