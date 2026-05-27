import { Router } from 'express';
import path from 'path';
import { venueQueries } from '../database/schema.js';

export default function replayRoutes({ replayService, mqttRecordService, mqttService, db, offlineReconcileService }) {
  const router = Router();

  router.get('/files', (_req, res) => {
    try {
      res.json({ files: replayService.listFiles(), replayDir: replayService.replayDir });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/status', (_req, res) => {
    res.json(replayService.status());
  });

  router.get('/meta', async (req, res) => {
    try {
      const { file } = req.query;
      if (!file) return res.status(400).json({ error: 'file query param required' });
      const meta = await replayService.getFileMeta(String(file));
      res.json(meta);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/start', async (req, res) => {
    const { file, speed, rewriteTimestamps, devicePrefix, startProgress, reconciled, jobId, artifactPath } = req.body || {};
    try {
      if (!file && !artifactPath && !jobId) return res.status(400).json({ error: 'file, artifactPath, or jobId is required' });

      let playFile = file ? path.basename(String(file)) : null;
      let playReconciled = !!reconciled;
      let resolvedArtifact = artifactPath ? String(artifactPath) : null;

      if (jobId && offlineReconcileService) {
        const job = offlineReconcileService.getJob(String(jobId));
        if (!job) {
          return res.status(400).json({ error: 'Reconciliation job not found' });
        }
        if (job.status !== 'complete') {
          return res.status(400).json({ error: 'Reconciliation job not complete — wait for post-process to finish' });
        }
        resolvedArtifact = offlineReconcileService.resolveArtifactPath(job);
        if (!resolvedArtifact) {
          return res.status(400).json({
            error: `Reconciled artifact missing on disk (${job.artifactName || job.sourceFile}). Re-run post-process for this capture.`,
          });
        }
        playReconciled = true;
        playFile = job.artifactName;
      }

      if (playReconciled || resolvedArtifact) {
        if (resolvedArtifact && offlineReconcileService) {
          const verified = offlineReconcileService.resolveArtifactPath(resolvedArtifact);
          if (!verified) {
            return res.status(400).json({
              error: `Reconciled artifact missing on disk (${path.basename(resolvedArtifact)}). Re-run post-process for this capture.`,
            });
          }
          resolvedArtifact = verified;
        }
        await replayService.stop();
        const playPromise = replayService.startReconciledArtifact({
          file: resolvedArtifact || playFile,
          speed,
          startProgress,
          rewriteTimestamps,
        });
        playPromise.catch((err) => { console.error('[Replay] reconciled playback failed:', err.message); });

        let status = replayService.status();
        for (let i = 0; i < 30 && !status.running; i++) {
          await new Promise(r => setTimeout(r, 100));
          status = replayService.status();
        }
        if (!status.running) {
          await playPromise.catch(() => {});
          status = replayService.status();
          return res.status(400).json({ error: status.lastError || 'Reconciled replay failed to start' });
        }
        return res.json({ success: true, status, reconciled: true });
      }

      if (!playFile) return res.status(400).json({ error: 'file is required' });
      const requested = playFile;
      try {
        replayService.validateCaptureFile(requested);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      await replayService.stop();

      replayService.start({ file: requested, speed, rewriteTimestamps, devicePrefix, startProgress })
        .catch((err) => { console.error('[Replay] playback failed:', err.message); });

      // Wait until the loop is actually reading the requested file.
      let status = replayService.status();
      for (let i = 0; i < 30 && (!status.running || status.file !== requested); i++) {
        await new Promise(r => setTimeout(r, 100));
        status = replayService.status();
      }
      if (!status.running || status.file !== requested) {
        let error = status.lastError;
        if (!error) {
          if (status.file === requested && (status.fileSize === 0 || status.messagesPublished === 0)) {
            error = `Capture "${requested}" has no playable data (empty or corrupt). Re-record after updating the server.`;
          } else if (status.file !== requested) {
            error = `Replay failed to start "${requested}" (server has "${status.file || 'none'}").`;
          } else {
            error = `Replay ended immediately for "${requested}". The capture may be empty or corrupt — re-record.`;
          }
        }
        return res.status(400).json({ error });
      }
      res.json({ success: true, status, requestedFile: requested });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/stop', async (_req, res) => {
    try {
      await replayService.stop();
      res.json({ success: true, status: replayService.status() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/seek', async (req, res) => {
    const { file, progress, speed } = req.body || {};
    try {
      const p = Number(progress);
      if (!Number.isFinite(p)) return res.status(400).json({ error: 'progress (0-1) is required' });
      const current = replayService.status();
      const requested = file ? path.basename(String(file)) : current.file;
      if (!requested) return res.status(400).json({ error: 'file is required' });

      await replayService.stop();
      replayService.start({
        file: requested,
        speed: speed ?? current.speed ?? 1,
        startProgress: p,
        rewriteTimestamps: true,
      }).catch((err) => { console.error('[Replay] seek failed:', err.message); });

      let status = replayService.status();
      for (let i = 0; i < 30 && !status.running; i++) {
        await new Promise(r => setTimeout(r, 100));
        status = replayService.status();
      }
      if (!status.running) {
        return res.status(400).json({ error: status.lastError || 'Seek failed to start playback' });
      }
      res.json({ success: true, status });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Record MQTT on main server (edge already bridges here) ----

  router.get('/record/status', (_req, res) => {
    try {
      if (!mqttRecordService) return res.status(503).json({ error: 'Recording not available' });
      res.json({ success: true, status: mqttRecordService.getStatus(mqttService) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/record/start', (req, res) => {
    try {
      if (!mqttRecordService) return res.status(503).json({ error: 'Recording not available' });
      const { label, durationMinutes } = req.body || {};
      mqttRecordService.start({ label: label || 'capture', durationMinutes });
      res.json({ success: true, status: mqttRecordService.getStatus(mqttService) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/record/stop', async (_req, res) => {
    try {
      if (!mqttRecordService) return res.status(503).json({ error: 'Recording not available' });
      const stopped = await mqttRecordService.stop();
      res.json({
        success: true,
        stopped,
        file: stopped.file ? { name: stopped.file, size: stopped.bytesWritten } : null,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Offline post-process reconciliation (full recording — not live canvas) ----

  router.get('/reconcile/presets', (_req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      res.json({ presets: offlineReconcileService.listPresets() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/reconcile/jobs', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const { sourceFile } = req.query;
      res.json({
        jobs: offlineReconcileService.listJobs({
          sourceFile: sourceFile ? String(sourceFile) : undefined,
        }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/reconcile/jobs/:id', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const job = offlineReconcileService.getJob(req.params.id);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      res.json({ job });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/reconcile/jobs', async (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const { sourceFile, presetId, venueId } = req.body || {};
      if (!sourceFile || !presetId) return res.status(400).json({ error: 'sourceFile and presetId are required' });
      const job = await offlineReconcileService.startJob({
        sourceFile: path.basename(String(sourceFile)),
        presetId: String(presetId),
        venueId: venueId ? String(venueId) : null,
      });
      res.json({ success: true, job });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/reconcile/jobs/clear-failed', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const { sourceFile } = req.body || {};
      if (!sourceFile) return res.status(400).json({ error: 'sourceFile is required' });
      const result = offlineReconcileService.clearFailedJobs(String(sourceFile));
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/reconcile/jobs/:id/cancel', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const job = offlineReconcileService.cancelJob(req.params.id);
      res.json({ success: true, job });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/reconcile/jobs/:id', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const result = offlineReconcileService.deleteJob(req.params.id);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/preview-image', async (req, res) => {
    try {
      const { file, venueId, t } = req.query;
      const pixelsPerMeter = Math.max(2, Math.min(40, Number(req.query.px) || 12));
      if (!file) return res.status(400).json({ error: 'file query param required' });
      let venueWidth = 80, venueDepth = 80, transform = null;
      if (venueId && db) {
        const venue = venueQueries.getById(db, String(venueId));
        if (!venue) return res.status(404).json({ error: 'Venue not found' });
        venueWidth = Number(venue.width) || 80;
        venueDepth = Number(venue.depth) || 80;
        try {
          const parsed = JSON.parse(venue.dwg_transform_json || '{}');
          transform = parsed.perceptionTransform || null;
        } catch { /* ignore */ }
      }
      if (typeof t === 'string' && t.length) {
        try { transform = JSON.parse(t); } catch { /* ignore */ }
      }
      const { png, stats } = await replayService.renderPreviewImage({
        file: String(file),
        transform,
        venueWidth,
        venueDepth,
        pixelsPerMeter,
      });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Replay-Preview-Stats', JSON.stringify(stats));
      res.send(png);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
