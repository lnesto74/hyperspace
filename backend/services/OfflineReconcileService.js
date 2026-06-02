/**
 * OfflineReconcileService — job queue for post-processing MQTT captures.
 * Does NOT touch live MQTT pipeline.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getOfflinePreset, listOfflinePresets } from '../config/offlineReconcilePresets.js';
import { runBatchReconciliationToFile } from './offline/BatchTrajectoryReconciler.js';
import { runReconcileV2ToFile } from './offline/reconcileV2/reconcileV2.js';
import { normalizePerceptionTransform, IDENTITY_TRANSFORM } from './PerceptionTransform.js';
import { venueQueries } from '../database/schema.js';
import { readStoriesFile, storiesPathForArtifact } from './offline/storyBuilder.js';

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
  if (phase === 'write') return Math.min(0.995, progress ?? 0.9);
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
    this._recoverInterruptedJobs();
    this._recoverTimedOutJobs();
    this._rehealJobsFromDiskArtifacts();
    this._recoverOrphanedCompleteJobs();
  }

  /**
   * Artifacts on disk are the source of truth — re-link DB after deploy/restart
   * so completed post-process jobs stay in the Replay panel dropdown.
   */
  _rehealJobsFromDiskArtifacts() {
    let names = [];
    try {
      names = fs.readdirSync(this.artifactDir)
        .filter(f => f.endsWith('.reconciled.jsonl'));
    } catch {
      return;
    }

    for (const name of names) {
      const m = name.match(/^(.+)__(.+)\.reconciled\.jsonl$/);
      if (!m) continue;
      const sourceFile = `${m[1]}.jsonl`;
      const presetId = m[2];
      const artifactPath = path.join(this.artifactDir, name);
      try {
        if (!fs.existsSync(artifactPath) || fs.statSync(artifactPath).size === 0) continue;
      } catch {
        continue;
      }

      const preset = getOfflinePreset(presetId);
      const presetLabel = preset?.label || presetId;

      const existing = this.db.prepare(`
        SELECT id, status FROM offline_reconcile_jobs
        WHERE source_file = ? AND preset_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(sourceFile, presetId);

      if (existing?.status === 'complete') continue;

      const finished = new Date().toISOString();
      if (existing) {
        this.db.prepare(`
          UPDATE offline_reconcile_jobs
          SET status = 'complete', progress = 1, error = NULL,
              artifact_path = ?, finished_at = COALESCE(finished_at, ?)
          WHERE id = ?
        `).run(artifactPath, finished, existing.id);
        console.log(`[OfflineReconcile] Re-healed job ${existing.id} from disk artifact ${name}`);
      } else {
        const id = randomUUID();
        this.db.prepare(`
          INSERT INTO offline_reconcile_jobs
            (id, venue_id, source_file, preset_id, preset_label, status, artifact_path, progress, created_at, finished_at)
          VALUES (?, NULL, ?, ?, ?, 'complete', ?, 1, ?, ?)
        `).run(id, sourceFile, presetId, presetLabel, artifactPath, finished, finished);
        console.log(`[OfflineReconcile] Registered disk artifact ${name} as job ${id}`);
      }
    }
  }

  /** Jobs left running/pending in DB have no in-process worker after restart. */
  _recoverInterruptedJobs() {
    const rows = this.db.prepare(`
      SELECT id, progress, status FROM offline_reconcile_jobs
      WHERE status IN ('running', 'pending')
    `).all();
    for (const row of rows) {
      const pct = Math.round((row.progress || 0) * 100);
      this.db.prepare(`
        UPDATE offline_reconcile_jobs
        SET status = 'failed',
            error = ?,
            finished_at = ?
        WHERE id = ?
      `).run(
        `interrupted — backend restarted (was ${pct}%, no worker). Cancel and re-run post-process.`,
        new Date().toISOString(),
        row.id,
      );
      console.warn(`[OfflineReconcile] Recovered interrupted job ${row.id} (${row.status} @ ${pct}%)`);
    }
  }

  _recoverTimedOutJobs() {
    const staleMs = 45 * 60 * 1000;
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = this.db.prepare(`
      SELECT id, progress FROM offline_reconcile_jobs
      WHERE status = 'running' AND started_at < ?
    `).all(cutoff);
    for (const row of rows) {
      this.db.prepare(`
        UPDATE offline_reconcile_jobs
        SET status = 'failed',
            error = ?,
            finished_at = ?
        WHERE id = ?
      `).run(
        `stale — no completion after 45m (last progress ${Math.round((row.progress || 0) * 100)}%)`,
        new Date().toISOString(),
        row.id,
      );
      console.warn(`[OfflineReconcile] Recovered stale job ${row.id}`);
    }
  }

  /** DB says complete but artifact file is missing (deleted, volume loss, bad path). */
  _recoverOrphanedCompleteJobs() {
    const rows = this.db.prepare(`
      SELECT id, artifact_path FROM offline_reconcile_jobs WHERE status = 'complete'
    `).all();
    for (const row of rows) {
      const artifactPath = row.artifact_path;
      const artifactName = artifactPath ? path.basename(artifactPath) : null;
      if (this._resolveExistingArtifactPath({ artifactPath, artifactName })) continue;
      this.db.prepare(`
        UPDATE offline_reconcile_jobs
        SET status = 'failed',
            error = ?,
            finished_at = ?
        WHERE id = ?
      `).run(
        'artifact missing on disk — re-run post-process for this capture',
        new Date().toISOString(),
        row.id,
      );
      console.warn(`[OfflineReconcile] Recovered orphaned complete job ${row.id} (artifact missing)`);
    }
  }

  _artifactCandidates(artifactPath, artifactName) {
    const names = new Set();
    if (artifactName) names.add(path.basename(String(artifactName)));
    if (artifactPath) names.add(path.basename(String(artifactPath)));
    const candidates = [];
    for (const name of names) {
      candidates.push(path.join(this.artifactDir, name));
    }
    if (artifactPath) {
      const p = String(artifactPath);
      candidates.unshift(p);
      if (!path.isAbsolute(p)) {
        candidates.push(path.join(this.replayDir, p));
      }
    }
    return [...new Set(candidates)];
  }

  _resolveExistingArtifactPath({ artifactPath, artifactName } = {}) {
    for (const candidate of this._artifactCandidates(artifactPath, artifactName)) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0) return candidate;
      } catch { /* ignore */ }
    }
    return null;
  }

  listPresets() {
    return listOfflinePresets();
  }

  _sourceFileFilter(sourceFile) {
    let base = path.basename(String(sourceFile));
    if (base.endsWith('.reconciled.jsonl')) {
      const m = base.match(/^(.+)__.+\.reconciled\.jsonl$/);
      if (m) base = `${m[1]}.jsonl`;
    }
    return base;
  }

  listJobs({ sourceFile } = {}) {
    let sql = 'SELECT * FROM offline_reconcile_jobs ORDER BY created_at DESC LIMIT 100';
    let rows;
    if (sourceFile) {
      rows = this.db.prepare(
        'SELECT * FROM offline_reconcile_jobs WHERE source_file = ? ORDER BY created_at DESC LIMIT 50'
      ).all(this._sourceFileFilter(sourceFile));
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

  deleteJob(id) {
    const job = this.getJob(id);
    if (!job) throw new Error('Job not found');
    if (job.status === 'pending' || job.status === 'running') {
      throw new Error('Cannot delete an active job — cancel it first');
    }
    this._removeArtifactIfIncomplete(job);
    this.db.prepare('DELETE FROM offline_reconcile_jobs WHERE id = ?').run(id);
    console.log(`[OfflineReconcile] Deleted job ${id}`);
    return { deleted: id };
  }

  clearFailedJobs(sourceFile) {
    const base = path.basename(String(sourceFile));
    const rows = this.db.prepare(`
      SELECT id, artifact_path, status FROM offline_reconcile_jobs
      WHERE source_file = ? AND status = 'failed'
    `).all(base);
    for (const row of rows) {
      this._removeArtifactIfIncomplete({
        artifactPath: row.artifact_path,
        status: row.status,
      });
    }
    const result = this.db.prepare(`
      DELETE FROM offline_reconcile_jobs WHERE source_file = ? AND status = 'failed'
    `).run(base);
    console.log(`[OfflineReconcile] Cleared ${result.changes} failed job(s) for ${base}`);
    return { deleted: result.changes };
  }

  _removeArtifactIfIncomplete(job) {
    if (!job?.artifactPath || job.status === 'complete') return;
    try {
      if (fs.existsSync(job.artifactPath)) fs.unlinkSync(job.artifactPath);
    } catch { /* ignore */ }
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

      const engine = ctx.preset.config?.engine || ctx.preset.engine || 'v1';
      console.log(`[OfflineReconcile] Start ${id} preset=${ctx.preset.id} engine=${engine} file=${ctx.base}`);

      const jobMeta = {
        jobId: id,
        sourceFile: ctx.base,
        presetId: ctx.preset.id,
        presetLabel: ctx.preset.label,
        venueId: ctx.venueId,
      };
      const onProgress = (payload) => {
        if (this._isCancelled(id)) throw new Error('cancelled');
        const p = mapProgress(payload);
        this.db.prepare('UPDATE offline_reconcile_jobs SET progress = ? WHERE id = ?').run(p, id);
        if (payload.phase === 'merge') {
          console.log(`[OfflineReconcile] ${id} merge (${payload.fragments} fragments)`);
        } else if (payload.phase === 'write' && payload.batches) {
          console.log(`[OfflineReconcile] ${id} writing batches (${payload.batches})`);
          this.db.prepare(`UPDATE offline_reconcile_jobs SET progress = ?, error = NULL WHERE id = ?`).run(mapProgress(payload), id);
        } else if (payload.phase === 'write' && payload.progress >= 0.995) {
          console.log(`[OfflineReconcile] ${id} finalizing artifact (${payload.batches ?? '?'} batches)`);
        }
      };

      let result;
      if (engine === 'v2') {
        const walkabilityCachePath = path.join(this.replayDir, `walkability_${ctx.venueId || 'default'}.json`);
        result = await runReconcileV2ToFile({
          filePath: ctx.fullPath,
          artifactPath: ctx.artifactPath,
          venueId: ctx.venueId,
          transform,
          configOverrides: { ...ctx.preset.config, walkabilityCachePath },
          meta: jobMeta,
          onProgress,
          db: this.db,
        });
      } else {
        result = await runBatchReconciliationToFile({
          filePath: ctx.fullPath,
          artifactPath: ctx.artifactPath,
          venueId: ctx.venueId,
          transform,
          configOverrides: ctx.preset.config,
          meta: jobMeta,
          onProgress,
        });
      }

      if (this._isCancelled(id)) throw new Error('cancelled');

      if (!this._resolveExistingArtifactPath({ artifactPath: ctx.artifactPath, artifactName: path.basename(ctx.artifactPath) })) {
        throw new Error('Artifact file missing after reconcile write — check disk space and replay volume mount');
      }

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
      // Failed writes (e.g. ENOSPC at ~98%) leave a huge partial artifact — remove it.
      this._removeArtifactIfIncomplete({ artifactPath: ctx.artifactPath, status: 'failed' });
      if (msg !== 'cancelled') {
        const hint = /ENOSPC|no space left/i.test(msg)
          ? `${msg} — freed partial artifact; check df -h on replay volume (/opt/hyperspace/replay). Reconcile a trimmed capture if the raw file is multi-GB.`
          : msg;
        this.db.prepare(`
          UPDATE offline_reconcile_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?
        `).run(hint, new Date().toISOString(), id);
      }
      throw err;
    } finally {
      this._cancelledJobs.delete(id);
      if (this._runningJobId === id) this._runningJobId = null;
    }
  }

  resolveArtifactPath(jobOrPath) {
    if (!jobOrPath) return null;
    if (typeof jobOrPath === 'string' && jobOrPath.includes('.reconciled.jsonl')) {
      return this._resolveExistingArtifactPath({
        artifactPath: jobOrPath,
        artifactName: path.basename(jobOrPath),
      });
    }
    const job = typeof jobOrPath === 'string' ? this.getJob(jobOrPath) : jobOrPath;
    if (!job?.artifactPath || job.status !== 'complete') return null;
    return this._resolveExistingArtifactPath({
      artifactPath: job.artifactPath,
      artifactName: job.artifactName,
    });
  }

  getStoriesForJob(jobId) {
    const job = this.getJob(jobId);
    if (!job || job.status !== 'complete') return null;
    const artifact = this.resolveArtifactPath(job);
    if (!artifact) return null;
    const storiesPath = storiesPathForArtifact(artifact);
    const doc = readStoriesFile(storiesPath);
    if (!doc) return null;
    return { ...doc, jobId: job.id, storiesPath };
  }

  listArtifactsForSource(sourceFile) {
    const base = path.basename(String(sourceFile));
    return this.listJobs({ sourceFile: base }).filter(j => j.status === 'complete' && this.resolveArtifactPath(j));
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
