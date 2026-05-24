#!/usr/bin/env node
/**
 * Benchmark Protocol v1 — one command → scorecard + report.
 *
 * Usage (on DO):
 *   node analysis/run_benchmark.mjs \
 *     --file /opt/hyperspace/replay/raw_tracks_trimmed.jsonl \
 *     --capture-id baseline_v0_overnight_2026-05-23 \
 *     --meta analysis/runs/baseline_v0_overnight_2026-05-23/meta.json
 *
 * Scope A (full file) streams the entire capture — RAM-safe, disk-heavy.
 * Expect hours on a 7 GB file.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { detectPrimaryVenue, parseWhen } from './lib/load_jsonl.mjs';
import { buildScorecard, writeScorecard } from './lib/scorecard.mjs';
import { writeReport } from './lib/report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const out = {
    file: null,
    captureId: null,
    meta: null,
    runsDir: path.join(__dirname, 'runs'),
    skipSpatial: false,
    skipVerify: false,
    skipExplore: false,
    after: null,
    before: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file' || a === '-f') out.file = argv[++i];
    else if (a === '--capture-id') out.captureId = argv[++i];
    else if (a === '--meta') out.meta = argv[++i];
    else if (a === '--runs-dir') out.runsDir = argv[++i];
    else if (a === '--after') out.after = argv[++i];
    else if (a === '--before') out.before = argv[++i];
    else if (a === '--skip-spatial') out.skipSpatial = true;
    else if (a === '--skip-verify') out.skipVerify = true;
    else if (a === '--skip-explore') out.skipExplore = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node analysis/run_benchmark.mjs --file CAPTURE.jsonl --capture-id ID [--meta meta.json]`);
      process.exit(0);
    }
  }
  if (!out.file || !out.captureId) {
    console.error('Required: --file and --capture-id');
    process.exit(1);
  }
  return out;
}

function run(cmd, cmdArgs, env = {}) {
  console.log(`\n▶ ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) {
    const killed = r.status == null ? ' (process killed — likely OOM or signal)' : '';
    const err = r.error ? ` ${r.error.message}` : '';
    throw new Error(`Command failed (${r.status})${killed}${err}: ${cmd} ${cmdArgs.join(' ')}`);
  }
}

function loadMeta(args) {
  const runDir = path.join(args.runsDir, args.captureId);
  const metaPath = args.meta
    ? path.resolve(args.meta)
    : path.join(runDir, 'meta.json');

  let meta;
  if (fs.existsSync(metaPath)) {
    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } else {
    meta = {
      capture_id: args.captureId,
      source_file: path.basename(args.file),
      venue_id: null,
      perception_version: null,
      reconciler_at_capture: null,
      notes: null,
    };
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    console.log(`Created template meta: ${metaPath} — edit before comparing runs.`);
  }

  meta.capture_id = args.captureId;
  meta.source_file = path.basename(args.file);
  meta.scope = args.after || args.before ? 'window' : 'full';
  return { meta, metaPath, runDir };
}

async function main() {
  const args = parseArgs(process.argv);
  const filePath = path.resolve(args.file);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  const { meta, runDir } = loadMeta(args);
  const artifactsDir = path.join(runDir, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });

  const afterMs = parseWhen(args.after);
  const beforeMs = parseWhen(args.before);
  const venueId = meta.venue_id || await detectPrimaryVenue(filePath, { afterMs, beforeMs });
  if (venueId && !meta.venue_id) {
    meta.venue_id = venueId;
    fs.writeFileSync(path.join(runDir, 'meta.json'), JSON.stringify(meta, null, 2));
  }

  console.log(`\nBenchmark: ${args.captureId}`);
  console.log(`File:      ${filePath} (${(fs.statSync(filePath).size / 1024 ** 3).toFixed(2)} GB)`);
  console.log(`Venue:     ${venueId}`);
  console.log(`Output:    ${runDir}`);

  const py = process.env.PYTHON || 'python3';
  const exploreArgs = [
    path.join(__dirname, '01_explore.py'),
    '--file', filePath,
    '--out-dir', artifactsDir,
  ];
  if (venueId) exploreArgs.push('--venue-id', venueId);
  if (args.after) exploreArgs.push('--after', args.after);
  if (args.before) exploreArgs.push('--before', args.before);

  const parquetPath = path.join(artifactsDir, 'messages.parquet');
  const statsPath = path.join(artifactsDir, 'per_id_stats.parquet');
  const hasExploreArtifacts = fs.existsSync(parquetPath) && fs.existsSync(statsPath);

  if (args.skipExplore) {
    if (!hasExploreArtifacts) {
      console.error(`--skip-explore but missing ${parquetPath} or ${statsPath}`);
      process.exit(1);
    }
    console.log('\n⏭ Skipping 01_explore (using existing parquet artifacts)');
  } else {
    run(py, exploreArgs);
  }

  if (!args.skipSpatial) {
    run(py, [path.join(__dirname, '02_spatial_motion.py')], { ANALYSIS_OUT_DIR: artifactsDir });
    run(py, [path.join(__dirname, '05_forensic.py')], { ANALYSIS_OUT_DIR: artifactsDir });
  }

  let verifyRows = [];
  if (!args.skipVerify) {
    const verifyArgs = [
      path.join(__dirname, '06_verify.mjs'),
      '--file', filePath,
      '--out-dir', artifactsDir,
    ];
    if (venueId) verifyArgs.push('--venue-id', venueId);
    if (args.after) verifyArgs.push('--after', args.after);
    if (args.before) verifyArgs.push('--before', args.before);
    run(process.execPath, verifyArgs);
    verifyRows = JSON.parse(fs.readFileSync(path.join(artifactsDir, '06_verify.json'), 'utf8'));
  }

  const finishedAt = new Date().toISOString();
  const scorecard = buildScorecard({
    meta,
    artifactsDir,
    verifyRows,
    startedAt,
    finishedAt,
  });
  const scorecardPath = writeScorecard(runDir, scorecard);
  const reportPath = writeReport(runDir, scorecard);

  console.log(`\n✓ Scorecard: ${scorecardPath}`);
  console.log(`✓ Report:    ${reportPath}`);
  console.log(`✓ Artifacts: ${artifactsDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
