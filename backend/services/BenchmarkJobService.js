import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default class BenchmarkJobService {
  constructor({
    runsDir,
    replayDir,
    hyperspaceRoot,
  } = {}) {
    this.runsDir = runsDir
      || process.env.BENCHMARK_RUNS_DIR
      || path.join(__dirname, '../../analysis/runs');
    this.replayDir = replayDir || process.env.REPLAY_DIR || '/data/replay';
    this.hyperspaceRoot = hyperspaceRoot
      || process.env.HYPERSPACE_ROOT
      || path.join(__dirname, '../..');
    this.analysisDir = path.join(this.hyperspaceRoot, 'analysis');
    this.runnerScript = path.join(this.analysisDir, 'run_benchmark.mjs');
    this._proc = null;
    this._job = null;
  }

  getStatus() {
    if (this._job) return { ...this._job };
    const disk = this._readDiskJob();
    return disk || { status: 'idle' };
  }

  _readDiskJob() {
    const p = path.join(this.runsDir, 'job_status.json');
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  }

  _writeDiskJob(job) {
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.writeFileSync(path.join(this.runsDir, 'job_status.json'), JSON.stringify(job, null, 2));
  }

  _resolveCaptureFile(file) {
    const base = path.basename(String(file));
    if (!base || base.includes('..') || !base.endsWith('.jsonl')) {
      throw new Error(`Invalid capture file: ${file}`);
    }
    const full = path.join(this.replayDir, base);
    if (!fs.existsSync(full)) throw new Error(`Capture not found: ${base} (in ${this.replayDir})`);
    return { base, full };
  }

  _sanitizeCaptureId(id) {
    const s = String(id || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
    if (!s) throw new Error('capture_id is required');
    return s;
  }

  start({
    captureId,
    file,
    after,
    before,
    skipSpatial = false,
    skipVerify = false,
  } = {}) {
    if (this._proc) {
      throw new Error(`Benchmark already running (${this._job?.captureId})`);
    }
    if (!fs.existsSync(this.runnerScript)) {
      throw new Error(
        `Benchmark runner not found at ${this.runnerScript}. `
        + 'Mount /opt/hyperspace/analysis into the backend container (see docker-compose.prod.yml).',
      );
    }

    const id = this._sanitizeCaptureId(captureId);
    const { base, full } = this._resolveCaptureFile(file);
    const runDir = path.join(this.runsDir, id);
    fs.mkdirSync(runDir, { recursive: true });

    const logPath = path.join(runDir, 'job.log');
    const logFd = fs.openSync(logPath, 'a');
    const startedAt = new Date().toISOString();

    const args = [
      this.runnerScript,
      '--file', full,
      '--capture-id', id,
      '--runs-dir', this.runsDir,
      '--meta', path.join(runDir, 'meta.json'),
    ];
    if (after) args.push('--after', after);
    if (before) args.push('--before', before);
    if (skipSpatial) args.push('--skip-spatial');
    if (skipVerify) args.push('--skip-verify');

    this._job = {
      status: 'running',
      stage: 'starting',
      captureId: id,
      sourceFile: base,
      startedAt,
      finishedAt: null,
      error: null,
      logPath,
      pid: null,
    };
    this._writeDiskJob(this._job);

    const child = spawn(process.execPath, args, {
      cwd: this.hyperspaceRoot,
      env: {
        ...process.env,
        BENCHMARK_RUNS_DIR: this.runsDir,
        PYTHON: process.env.PYTHON || 'python3',
      },
      detached: false,
      stdio: ['ignore', logFd, logFd],
    });

    this._proc = child;
    this._job.pid = child.pid;
    this._writeDiskJob(this._job);

    child.on('exit', (code) => {
      const finishedAt = new Date().toISOString();
      this._job = {
        ...this._job,
        status: code === 0 ? 'completed' : 'failed',
        stage: code === 0 ? 'done' : 'failed',
        finishedAt,
        error: code === 0 ? null : `Process exited with code ${code}`,
        pid: null,
      };
      this._writeDiskJob(this._job);
      this._proc = null;
      try { fs.closeSync(logFd); } catch { /* ignore */ }
    });

    child.on('error', (err) => {
      this._job = {
        ...this._job,
        status: 'failed',
        stage: 'failed',
        finishedAt: new Date().toISOString(),
        error: err.message,
        pid: null,
      };
      this._writeDiskJob(this._job);
      this._proc = null;
      try { fs.closeSync(logFd); } catch { /* ignore */ }
    });

    return this.getStatus();
  }

  getLogTail(captureId, lines = 80) {
    const id = captureId || this._job?.captureId;
    if (!id) return '';
    const logPath = path.join(this.runsDir, id, 'job.log');
    if (!fs.existsSync(logPath)) return '';
    const content = fs.readFileSync(logPath, 'utf8');
    return content.split('\n').slice(-lines).join('\n');
  }

  /** Infer stage from log tail for UI progress. */
  getProgress() {
    const job = this.getStatus();
    if (job.status !== 'running') return job;
    const tail = this.getLogTail(job.captureId, 40);
    let stage = 'running';
    if (tail.includes('06_verify')) stage = 'reconciler_sweep';
    else if (tail.includes('05_forensic')) stage = 'spatial_forensics';
    else if (tail.includes('02_spatial')) stage = 'spatial_motion';
    else if (tail.includes('01_explore') || tail.includes('Streaming')) stage = 'raw_explore';
    else if (tail.includes('▶')) stage = 'pipeline';
    return { ...job, stage };
  }
}
