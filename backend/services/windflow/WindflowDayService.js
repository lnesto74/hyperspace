/**
 * Windflow day packs — everything the spatial workspace draws for one day, computed on the server
 * from the raw 10 Hz LiDAR archive (never the 3 s track_positions table):
 *   flow       movement field packs (all slices), FlowFieldDailyService.aggregatePositions on per-second rows
 *              exported by analysis/journey_lab/230_flow_rows.py
 *   kinetic    movement states (Behaviour lens): 220_kinetic_states.py + 221_kinetic_export.py
 *   checkouts  checkouts minute by minute (Service lens): 211_checkout_replay.py
 * Prerequisites (160/199/150 Journey Lab outputs) come from the daily KPI job, run first when missing.
 *
 * One job per venue+day, one job at a time (the box is small and the scripts are memory-heavy),
 * FIFO queue with positions so the UI can say "queued, 2 before you". Results are cached on disk;
 * a ready day is served immediately.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const TREVIGLIO = '55fdd53b-3298-4355-97c0-b4e789b11d06';
const KINDS = ['flow', 'kinetic', 'checkouts'];
// Rough durations on the production droplet, for the loader. Refined from real runs (see lastRunS).
const ETA = { prereq: 600, flow: 150, kinetic: 420, checkouts: 60 };

const env = (k, d) => process.env[k] || d;
const repoRoot = () => env('HYPERSPACE_ROOT', path.resolve(__dirname, '../../..'));
const jlDir = () => path.join(repoRoot(), 'analysis/journey_lab');
const pythonBin = () => env('WINDFLOW_PYTHON', env('DAILY_KPI_PYTHON', 'python3'));
const parquetDir = () => env('DAILY_KPI_PARQUET_DIR', '/data/hyperspace/raw');
const labRoot = () => env('DAILY_KPI_LAB_OUT', path.join(jlDir(), 'out'));
const outRoot = () => env('WINDFLOW_DIR', path.join(path.dirname(env('DAILY_KPI_REPORT', '/data/reports/daily-kpi')), 'windflow'));
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));

function loadAnchor() {
  const p = env('FLOWFIELD_LAYOUT_PATH', path.join(__dirname, '../../assets/flowfield/layout_anchor.json'));
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export class WindflowDayService {
  constructor(db, { log = console } = {}) {
    this.db = db;
    this.log = log;
    this.anchor = loadAnchor();
    this.jobs = new Map(); // key -> job
    this.queue = []; // keys waiting
    this.running = null;
    this.lastRunS = {};
  }

  dayDir(venueId, day) { return path.join(outRoot(), venueId, day); }
  file(venueId, day, kind, slice) {
    const d = this.dayDir(venueId, day);
    if (kind === 'flow') return path.join(d, 'flow', `field_${slice || 'trading'}.json`);
    return path.join(d, `${kind}.json`);
  }
  parquet(day) { return path.join(parquetDir(), `hyperspace-raw-${day}.parquet`); }
  hasRaw(day) { return fs.existsSync(this.parquet(day)); }
  ready(venueId, day) {
    return Object.fromEntries(KINDS.map((k) => [k, fs.existsSync(this.file(venueId, day, k))]));
  }

  /** Status of one day: ready parts, raw availability, and the job if any. */
  status(venueId, day) {
    const ready = this.ready(venueId, day);
    const all = KINDS.every((k) => ready[k]);
    const job = this.jobs.get(`${venueId}|${day}`) || null;
    let j = null;
    if (job) {
      const pos = job.status === 'queued' ? this.queue.indexOf(job.key) + 1 : 0;
      const etaOwn = this._etaOf(job);
      const ahead = job.status === 'queued' ? this.queue.slice(0, pos - 1).reduce((s, k) => s + this._etaOf(this.jobs.get(k)), 0) + (this.running ? this._etaLeft(this.running) : 0) : 0;
      j = { status: job.status, stage: job.stage, position: pos, ahead: Math.max(0, pos - 1) + (job.status === 'queued' && this.running ? 1 : 0),
        eta_s: Math.round(job.status === 'running' ? this._etaLeft(job) : ahead + etaOwn), started_at: job.startedAt, error: job.error, notes: job.notes };
    }
    return { day, raw: this.hasRaw(day), ready, complete: all, job: j };
  }

  _etaOf(job) {
    if (!job) return 0;
    const st = job.todo || KINDS;
    return (job.needPrereq ? ETA.prereq : 0) + st.reduce((s, k) => s + (this.lastRunS[k] || ETA[k]), 0);
  }
  _etaLeft(job) {
    const el = (Date.now() - (job.startedAt || Date.now())) / 1000;
    return Math.max(15, this._etaOf(job) - el);
  }

  /** Queue the missing parts of each day that has raw data. Idempotent. */
  ensure(venueId, days) {
    for (const day of days) {
      if (!isDay(day)) continue;
      const key = `${venueId}|${day}`;
      const ready = this.ready(venueId, day);
      const todo = KINDS.filter((k) => !ready[k]);
      if (!todo.length || !this.hasRaw(day)) continue;
      const cur = this.jobs.get(key);
      if (cur && (cur.status === 'queued' || cur.status === 'running')) continue;
      const job = { key, venueId, day, todo, status: 'queued', stage: 'queued', startedAt: null, error: null, notes: [], needPrereq: !this._prereqOk(day) };
      this.jobs.set(key, job);
      this.queue.push(key);
    }
    this._pump();
    return days.filter(isDay).map((d) => this.status(venueId, d));
  }

  _prereqOk(day) {
    const d = path.join(labRoot(), day);
    return ['160_staff.json', '199_department_areas.json', '150_queue_wait.json'].every((f) => fs.existsSync(path.join(d, f)))
      && fs.existsSync(path.join(jlDir(), 'data', day, 'regions_of_interest.csv'));
  }

  _pump() {
    if (this.running || !this.queue.length) return;
    const key = this.queue.shift();
    const job = this.jobs.get(key);
    if (!job) return this._pump();
    this.running = job;
    job.status = 'running'; job.startedAt = Date.now();
    this._run(job)
      .then(() => { job.status = 'done'; job.stage = 'done'; setTimeout(() => { if (this.jobs.get(key) === job) this.jobs.delete(key); }, 60000); })
      .catch((err) => { job.status = 'error'; job.error = err.message.slice(0, 400); this.log.error?.('[windflow] job failed', key, err.message); })
      .finally(() => { this.running = null; this._pump(); });
  }

  async _run(job) {
    const { venueId, day } = job;
    const dir = this.dayDir(venueId, day);
    fs.mkdirSync(path.join(dir, 'flow'), { recursive: true });
    const work = path.join(dir, 'work'); fs.mkdirSync(work, { recursive: true });
    const pyEnv = {
      JL_ROOT: jlDir(), JL_CFG: path.join(jlDir(), 'config/treviglio.json'), JL_OUT: labRoot(), JL_DATA: path.join(jlDir(), 'data'),
      JL_PARQUET: this.parquet(day), JL_TMP: path.join(work, 'tmp'), JL_WORK: work, KIN_TMP: path.join(work, 'tmp'), KIN_DB: path.join(work, `kin_${day}.duckdb`),
      JL_MEM: env('WINDFLOW_MEM', '2000MB'), JL_THREADS: env('WINDFLOW_THREADS', '2'),
    };
    const timed = async (kind, fn) => { const t = Date.now(); job.stage = kind; await fn(); this.lastRunS[kind] = Math.round((Date.now() - t) / 1000); };

    if (!this._prereqOk(day) && (job.todo.includes('kinetic') || job.todo.includes('checkouts'))) {
      await timed('prereq', async () => {
        const { computeDailyKpi } = await import('../dailyKpi/computeDailyKpi.js');
        await computeDailyKpi({ db: this.db, venueId, day });
      });
      if (!this._prereqOk(day)) job.notes.push('Journey Lab prerequisites still missing after the daily KPI job');
    }
    if (job.todo.includes('flow')) {
      await timed('flow', async () => {
        const rowsFile = path.join(work, 'flow_rows.csv.gz');
        await this._py('230_flow_rows.py', [day, rowsFile], pyEnv);
        const anchorPath = env('FLOWFIELD_LAYOUT_PATH', path.join(__dirname, '../../assets/flowfield/layout_anchor.json'));
        await this._node(path.join(__dirname, 'flowPackWorker.js'), [day, venueId, rowsFile, path.join(dir, 'flow'), anchorPath]);
        fs.rmSync(rowsFile, { force: true });
      });
    }
    if (job.todo.includes('checkouts')) {
      await timed('checkouts', async () => {
        const site = path.join(work, 'checkouts');
        await this._py('211_checkout_replay.py', [day], { ...pyEnv, JL_SITE: site });
        fs.renameSync(path.join(site, `${day}.json`), this.file(venueId, day, 'checkouts'));
      });
    }
    if (job.todo.includes('kinetic')) {
      await timed('kinetic', async () => {
        await this._py('220_kinetic_states.py', [day], pyEnv);
        const dest = path.join(work, 'kinetic.json');
        await this._py('221_kinetic_export.py', [day], { ...pyEnv, KIN_DEST: dest });
        fs.renameSync(dest, this.file(venueId, day, 'kinetic'));
      });
    }
    fs.rmSync(work, { recursive: true, force: true });
    const missing = KINDS.filter((k) => !fs.existsSync(this.file(venueId, day, k)));
    if (missing.length) throw new Error(`not produced: ${missing.join(', ')}${job.notes.length ? ` (${job.notes.join('; ')})` : ''}`);
  }

  _py(script, args, extraEnv) {
    return new Promise((resolve, reject) => {
      const child = spawn(pythonBin(), [path.join(jlDir(), script), ...args], { cwd: jlDir(), env: { ...process.env, ...extraEnv } });
      let err = '';
      child.stdout.on('data', (d) => process.stdout.write(`[windflow ${script}] ${d}`));
      child.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
    });
  }

  _node(script, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--max-old-space-size=2500', script, ...args], { env: process.env });
      let err = '';
      child.stdout.on('data', (d) => process.stdout.write(`[windflow flow] ${d}`));
      child.stderr.on('data', (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`flow packs exited ${code}: ${err.trim().split('\n').slice(-3).join(' | ')}`))));
    });
  }

  /** Days with a ready movement field, for the date catalogue. */
  readyDays(venueId) {
    const root = path.join(outRoot(), venueId);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).filter((d) => isDay(d) && fs.existsSync(this.file(venueId, d, 'flow'))).sort().reverse();
  }
}

function writeAtomic(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, s);
  fs.renameSync(`${p}.tmp`, p);
}
