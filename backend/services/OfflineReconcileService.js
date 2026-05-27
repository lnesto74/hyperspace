/**
 * OfflineReconcileService — job queue for post-processing MQTT captures.
 * Does NOT touch live MQTT pipeline.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getOfflinePreset, listOfflinePresets } from '../config/offlineReconcilePresets.js';
import { runBatchReconciliationToFile } from './offline/BatchTrajectoryReconciler.js';
import { normalizePerceptionTransform, IDENTITY_TRANSFORM } from './PerceptionTransform.js';
import { venueQueries } from '../database/schema.js';

function parseDwgTransform(json) {
  if (!json) return {};
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return {};
  }
}

function mapProgress({ phase, messages, fragments, merged, progress, batches }) {
  if (phase === 'forward') return 0.1 + Math.min(0.7, (messages || 0) / 2_000_000);
  if (phase === 'merge') return 0.82;
  if (phase === 'smooth') return 0.86;
  if (phase === 'write') return progress ?? 0.9;
  return 0.01;
}

export class OfflineReconcileService {
  constructor({ db, replayDir } = {}) {
    this.db = db;
    this.replayDir = replayDir || process.env.REPLAY_DIR || '/data/replay';
    this.artifactDir = path.join(this.replayDir, 'reconciled');
    this._runningJobId = null;
    this._cancelledJobs = new Set();
    fs.mkdirSync(this.artifactDir, { recursive: true });
    this._recoverStaleJobs();
  }

  _recoverStaleJobs() {
    const staleMs = 2 * 60 * 60 * 1000;
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = this.db.prepare(`
      SELECT id FROM offline_reconcile_jobs
      WHERE status = 'running' AND started_at < ?
    `).all(cutoff);
    for (const row of rows) {
      this.db.prepare(`
        UPDATE offline_reconcile_jobs
        SET status = 'failed', error = 'stale — exceeded 2h without completion', finished_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), row.id);
      console.warn(`[OfflineReconcile] Recovered stale job ${row.id}`);
    }
  }

  listPresets() {
    return listOfflinePresets();
  }

  listJobs({ sourceFile } = {}) {
    let sql = 'SELECT * FROM offline_reconcile_jobs ORDER BY created_at DESC LIMIT 100';
    let rows;
    if (sourceFile) {
      rows = this.db.prepare(
        'SELECT * FROM offline_reconcile_jobs WHERE source_file = ? ORDER BY created_at DESC LIMIT 50'
      ).all(path.basename(String(sourceFile)));
    } else {
      rows = this.db.prepare(sql).all();
    }
    return rows.map(r => this._rowToJob(r));
  }

  getJob(id) {
    const row = this.db.prepare('SELECT * FROM offline_reconcile_jobs WHERE id = ?').get(id);
    return row ? this._rowToJob(row) : null;
  }

  findCompleteJob(sourceFile, presetId) {
    const row = this.db.prepare(`
      SELECT * FROM offline_reconcile_jobs
      WHERE source_file = ? AND preset_id = ? AND status = 'complete'
      ORDER BY finished_at DESC LIMIT 1
    `).get(path.basename(String(sourceFile)), presetId);
    return row ? this._rowToJob(row) : null;
  }

  cancelJob(id) {
    const job = this.getJob(id);
    if (!job) throw new Error('Job not found');
    if (job.status !== 'pending' && job.status !== 'running') {
      throw new Error(`Job is ${job.status}, cannot cancel`);
    }
    this._cancelledJobs.add(id);
    this.db.prepare(`
      UPDATE offline_reconcile_jobs
      SET status = 'failed', error = 'cancelled', finished_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);
    if (this._runningJobId === id) this._runningJobId = null;
    console.log(`[OfflineReconcile] Cancelled ${id}`);
    return this.getJob(id);
  }

  async startJob({ sourceFile, presetId, venueId }) {
    const base = path.basename(String(sourceFile));
    const fullPath = path.join(this.replayDir, base);
    if (!fs.existsSync(fullPath)) throw new Error(`Capture not found: ${base}`);
    if (fs.statSync(fullPath).size === 0) throw new Error(`Capture is empty: ${base}`);

    const preset = getOfflinePreset(presetId);
    if (!preset) throw new Error(`Unknown preset: ${presetId}`);

    const existing = this.db.prepare(`
      SELECT id FROM offline_reconcile_jobs
      WHERE source_file = ? AND preset_id = ? AND status IN ('pending', 'running')
      LIMIT 1
    `).get(base, presetId);
    if (existing) throw new Error('Job already running for this capture + preset');

    const id = randomUUID();
    const artifactName = `${path.parse(base).name}__${presetId}.reconciled.jsonl`;
    const artifactPath = path.join(this.artifactDir, artifactName);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO offline_reconcile_jobs
        (id, venue_id, source_file, preset_id, preset_label, status, artifact_path, progress, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, ?)
    `).run(id, venueId || null, base, presetId, preset.label, artifactPath, now);

    this._runJob(id, { fullPath, base, preset, venueId, artifactPath }).catch(err => {
      console.error('[OfflineReconcile] Job failed:', err);
    });

    return this.getJob(id);
  }

  _isCancelled(id) {
    if (this._cancelledJobs.has(id)) return true;
    const row = this.db.prepare('SELECT status FROM offline_reconcile_jobs WHERE id = ?').get(id);
    return row?.status === 'failed';
  }

  async _runJob(id, ctx) {
    if (this._runningJobId) {
      await new Promise(r => setTimeout(r, 500));
    }
    this._runningJobId = id;
    const started = new Date().toISOString();
    this.db.prepare(`
      UPDATE offline_reconcile_jobs SET status = 'running', started_at = ?, progress = 0.01 WHERE id = ?
    `).run(started, id);

    try {
      let transform = IDENTITY_TRANSFORM;
      if (ctx.venueId && this.db) {
        const venue = venueQueries.getById(this.db, ctx.venueId);
        if (venue) {
          const parsed = parseDwgTransform(venue.dwg_transform_json);
          transform = normalizePerceptionTransform(parsed.perceptionTransform || IDENTITY_TRANSFORM);
        }
      }

      console.log(`[OfflineReconcile] Start ${id} preset=${ctx.preset.id} file=${ctx.base}`);

      const result = await runBatchReconciliationToFile({
        filePath: ctx.fullPath,
        artifactPath: ctx.artifactPath,
        venueId: ctx.venueId,
        transform,
        configOverrides: ctx.preset.config,
        meta: {
          jobId: id,
          sourceFile: ctx.base,
          presetId: ctx.preset.id,
          presetLabel: ctx.preset.label,
          venueId: ctx.venueId,
        },
        onProgress: (payload) => {
          if (this._isCancelled(id)) throw new Error('cancelled');
          const p = mapProgress(payload);
          this.db.prepare('UPDATE offline_reconcile_jobs SET progress = ? WHERE id = ?').run(p, id);
          if (payload.phase === 'merge') {
            console.log(`[OfflineReconcile] ${id} merge (${payload.fragments} fragments)`);
          } else if (payload.phase === 'write' && payload.batches) {
            console.log(`[OfflineReconcile] ${id} writing batches (${payload.batches})`);
          }
        },
      });

      if (this._isCancelled(id)) throw new Error('cancelled');

      const finished = new Date().toISOString();
      const metaJson = JSON.stringify({
        metrics: result.metrics,
        batchCount: result.metrics.batch_count,
      });
      this.db.prepare(`
        UPDATE offline_reconcile_jobs
        SET status = 'complete', progress = 1, finished_at = ?, meta_json = ?, error = NULL
        WHERE id = ?
      `).run(finished, metaJson, id);

      console.log(
        `[OfflineReconcile] Complete ${id} → ${ctx.artifactPath}`
        + ` (${result.metrics.merged_tracks} tracks, ${result.metrics.batch_count} batches)`,
      );
    } catch (err) {
      const msg = String(err.message || err);
      if (msg !== 'cancelled') {
        this.db.prepare(`
          UPDATE offline_reconcile_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?
        `).run(msg, new Date().toISOString(), id);
      }
      throw err;
    } finally {
      this._cancelledJobs.delete(id);
      if (this._runningJobId === id) this._runningJobId = null;
    }
  }

  resolveArtifactPath(jobOrPath) {
    if (!jobOrPath) return null;
    if (jobOrPath.includes('.reconciled.jsonl')) {
      const p = path.isAbsolute(jobOrPath) ? jobOrPath : path.join(this.artifactDir, path.basename(jobOrPath));
      return fs.existsSync(p) ? p : null;
    }
    const job = this.getJob(jobOrPath);
    if (!job?.artifactPath || job.status !== 'complete') return null;
    return fs.existsSync(job.artifactPath) ? job.artifactPath : null;
  }

  listArtifactsForSource(sourceFile) {
    const base = path.basename(String(sourceFile));
    return this.listJobs({ sourceFile: base }).filter(j => j.status === 'complete');
  }

  _rowToJob(row) {
    let meta = null;
    try { meta = row.meta_json ? JSON.parse(row.meta_json) : null; } catch { /* ignore */ }
    return {
      id: row.id,
      venueId: row.venue_id,
      sourceFile: row.source_file,
      presetId: row.preset_id,
      presetLabel: row.preset_label,
      status: row.status,
      progress: row.progress,
      artifactPath: row.artifact_path,
      artifactName: row.artifact_path ? path.basename(row.artifact_path) : null,
      meta,
      error: row.error,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }
}

export default OfflineReconcileService;
