import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { venueQueries } from '../database/schema.js';

export default function replayRoutes({ replayService, mqttRecordService, edgeCaptureService, mqttService, db, offlineReconcileService, storyReplayService }) {
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
    const { file, speed, rewriteTimestamps, devicePrefix, startProgress, reconciled, jobId, artifactPath, venueId: bodyVenueId } = req.body || {};
    try {
      if (!file && !artifactPath && !jobId) return res.status(400).json({ error: 'file, artifactPath, or jobId is required' });

      let playFile = file ? path.basename(String(file)) : null;
      let playReconciled = !!reconciled;
      let resolvedArtifact = artifactPath ? String(artifactPath) : null;
      let playbackVenueId = bodyVenueId ? String(bodyVenueId) : null;
      let job = null;

      if (jobId && offlineReconcileService) {
        job = offlineReconcileService.getJob(String(jobId));
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
        playbackVenueId = playbackVenueId || job.venueId || null;
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
        const batchHint = job?.meta?.batchCount ?? job?.meta?.metrics?.batch_count ?? null;
        const playPromise = replayService.startReconciledArtifact({
          file: resolvedArtifact || playFile,
          speed,
          startProgress,
          rewriteTimestamps,
          venueId: playbackVenueId || replayService.trackAggregator?.venueId || null,
          totalBatchesHint: batchHint,
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
      // Ensure clients get a live-only track snapshot after replay-* keys are flushed.
      replayService.trackAggregator?.emitTracks?.();
      res.json({ success: true, status: replayService.status() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/seek', async (req, res) => {
    const { file, progress, speed, reconciled, jobId } = req.body || {};
    try {
      const p = Number(progress);
      if (!Number.isFinite(p)) return res.status(400).json({ error: 'progress (0-1) is required' });
      const current = replayService.status();
      const requested = file ? path.basename(String(file)) : current.file;
      if (!requested) return res.status(400).json({ error: 'file is required' });

      await replayService.stop();

      const wantReconciled = !!reconciled || !!jobId || current.reconciled
        || requested.endsWith('.reconciled.jsonl')
        || String(current.file || '').endsWith('.reconciled.jsonl');

      if (wantReconciled) {
        let resolvedArtifact = null;
        let batchHint = current.totalBatches ?? null;
        let playbackVenueId = null;

        if (jobId && offlineReconcileService) {
          const job = offlineReconcileService.getJob(String(jobId));
          if (!job || job.status !== 'complete') {
            return res.status(400).json({ error: 'Reconciliation job not complete' });
          }
          resolvedArtifact = offlineReconcileService.resolveArtifactPath(job);
          batchHint = job.meta?.batchCount ?? job.meta?.metrics?.batch_count ?? batchHint;
          playbackVenueId = job.venueId || null;
        } else if (requested.endsWith('.reconciled.jsonl')) {
          resolvedArtifact = path.join(replayService.replayDir, 'reconciled', requested);
        } else if (String(current.file || '').endsWith('.reconciled.jsonl')) {
          resolvedArtifact = path.join(replayService.replayDir, 'reconciled', current.file);
        }

        if (!resolvedArtifact || !fs.existsSync(resolvedArtifact)) {
          return res.status(400).json({ error: 'Reconciled artifact not found for seek' });
        }

        replayService.startReconciledArtifact({
          file: resolvedArtifact,
          speed: speed ?? current.speed ?? 1,
          startProgress: p,
          rewriteTimestamps: true,
          venueId: playbackVenueId || replayService.trackAggregator?.venueId || null,
          totalBatchesHint: batchHint,
        }).catch((err) => { console.error('[Replay] reconciled seek failed:', err.message); });
      } else {
        replayService.start({
          file: requested,
          speed: speed ?? current.speed ?? 1,
          startProgress: p,
          rewriteTimestamps: true,
        }).catch((err) => { console.error('[Replay] seek failed:', err.message); });
      }

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

  // ---- Record MQTT: edge slave (default) or cloud broker (legacy) ----

  const activeRecorder = () => (
    edgeCaptureService?.useEdgeRecording() ? edgeCaptureService : mqttRecordService
  );

  router.get('/record/status', (_req, res) => {
    try {
      const recorder = activeRecorder();
      if (!recorder) return res.status(503).json({ error: 'Recording not available' });
      res.json({ success: true, status: recorder.getStatus(mqttService) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/record/start', async (req, res) => {
    try {
      const recorder = activeRecorder();
      if (!recorder) return res.status(503).json({ error: 'Recording not available' });
      const { label, durationMinutes, edgeIp, venueId } = req.body || {};
      if (recorder === edgeCaptureService) {
        const status = await edgeCaptureService.start({ label: label || 'capture', durationMinutes, edgeIp, venueId });
        return res.json({ success: true, status });
      }
      mqttRecordService.start({ label: label || 'capture', durationMinutes });
      res.json({ success: true, status: mqttRecordService.getStatus(mqttService) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/record/stop', async (req, res) => {
    try {
      const recorder = activeRecorder();
      if (!recorder) return res.status(503).json({ error: 'Recording not available' });
      const { edgeIp, venueId } = req.body || {};
      let stopped;
      if (recorder === edgeCaptureService) {
        stopped = await edgeCaptureService.stop({ edgeIp, venueId });
      } else {
        stopped = await mqttRecordService.stop();
      }
      res.json({
        success: true,
        stopped,
        file: stopped.file ? { name: stopped.file, size: stopped.bytesWritten } : null,
      });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/record/harden-bridge', async (req, res) => {
    try {
      if (!edgeCaptureService) return res.status(503).json({ error: 'Edge capture not available' });
      const { edgeIp, venueId } = req.body || {};
      const result = await edgeCaptureService.hardenEdgeBridge({ edgeIp, venueId });
      res.json({ success: true, result });
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

  router.get('/reconcile/jobs/:id/stories', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const doc = offlineReconcileService.getStoriesForJob(String(req.params.id));
      if (!doc) {
        return res.status(404).json({
          error: 'Track stories not found — re-run post-process on this capture to generate stories.json',
        });
      }
      res.json({ success: true, stories: doc });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ---- Merge annotations (human labels for reconciliation tuning) ----

  router.get('/reconcile/annotations', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const { jobId, sourceFile } = req.query;
      res.json({
        annotations: offlineReconcileService.listAnnotations({
          jobId: jobId ? String(jobId) : undefined,
          sourceFile: sourceFile ? String(sourceFile) : undefined,
        }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/reconcile/annotations', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const annotation = offlineReconcileService.createAnnotation(req.body || {});
      res.json({ success: true, annotation });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.delete('/reconcile/annotations/:id', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      res.json({ success: true, ...offlineReconcileService.deleteAnnotation(req.params.id) });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/reconcile/graph', async (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const { sourceFile, presetId } = req.query;
      if (!sourceFile) return res.status(400).json({ error: 'sourceFile is required' });
      const full = String(req.query.full || '') === '1';
      const graph = presetId
        ? await offlineReconcileService.getGraphForSourcePreset(String(sourceFile), String(presetId), { full })
        : offlineReconcileService.getGraphForSource(String(sourceFile), { full });
      if (!graph) {
        return res.status(404).json({
          error: presetId
            ? `No reconciled artifact for "${presetId}" on this capture — run the post-process for that preset first.`
            : 'No graph for this capture yet — generate it (reconcile_graph) first.',
        });
      }
      res.json({ success: true, graph });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/reconcile/jobs/:id/graph', (req, res) => {
    try {
      if (!offlineReconcileService) return res.status(503).json({ error: 'Offline reconciliation not available' });
      const full = String(req.query.full || '') === '1';
      const graph = offlineReconcileService.getGraphForJob(String(req.params.id), { full });
      if (!graph) return res.status(404).json({ error: 'Graph sidecar not found — re-run v2 post-process on this capture.' });
      res.json({ success: true, graph });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/stories/status', (_req, res) => {
    try {
      if (!storyReplayService) return res.status(503).json({ error: 'Story replay not available' });
      res.json({ success: true, status: storyReplayService.status() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/stories/start', async (req, res) => {
    const { jobId, storyId, venueId, speed, startProgress } = req.body || {};
    try {
      if (!storyReplayService || !offlineReconcileService) {
        return res.status(503).json({ error: 'Story replay not available' });
      }
      if (!jobId || !storyId) return res.status(400).json({ error: 'jobId and storyId are required' });

      const doc = offlineReconcileService.getStoriesForJob(String(jobId));
      if (!doc?.stories?.length) {
        return res.status(404).json({ error: 'Track stories not found for this job' });
      }
      const story = doc.stories.find(s => s.id === storyId || s.stableId === storyId);
      if (!story) return res.status(404).json({ error: `Story not found: ${storyId}` });

      await replayService.stop();
      await storyReplayService.stop();

      const playVenue = venueId || doc.venueId || replayService.trackAggregator?.venueId || 'default';
      storyReplayService.start({
        story: { ...story, jobId: doc.jobId },
        venueId: playVenue,
        speed,
        startProgress,
      }).catch(err => console.error('[StoryReplay] failed:', err.message));

      let status = storyReplayService.status();
      for (let i = 0; i < 20 && !status.running; i++) {
        await new Promise(r => setTimeout(r, 50));
        status = storyReplayService.status();
      }
      res.json({ success: true, status, story: { id: story.id, label: story.label } });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/stories/stop', async (_req, res) => {
    try {
      if (!storyReplayService) return res.status(503).json({ error: 'Story replay not available' });
      await storyReplayService.stop();
      replayService.trackAggregator?.emitTracks?.();
      res.json({ success: true, status: storyReplayService.status() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/stories/seek', async (req, res) => {
    const { jobId, storyId, progress, speed, venueId } = req.body || {};
    try {
      if (!storyReplayService || !offlineReconcileService) {
        return res.status(503).json({ error: 'Story replay not available' });
      }
      const p = Number(progress);
      if (!Number.isFinite(p)) return res.status(400).json({ error: 'progress (0-1) required' });
      const doc = offlineReconcileService.getStoriesForJob(String(jobId));
      const story = doc?.stories?.find(s => s.id === storyId || s.stableId === storyId);
      if (!story) return res.status(404).json({ error: 'Story not found' });

      await storyReplayService.stop();
      const playVenue = venueId || doc.venueId || 'default';
      storyReplayService.start({
        story: { ...story, jobId: doc.jobId },
        venueId: playVenue,
        speed: speed ?? storyReplayService.status().speed ?? 1,
        startProgress: p,
      }).catch(err => console.error('[StoryReplay] seek failed:', err.message));

      res.json({ success: true, status: storyReplayService.status() });
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
