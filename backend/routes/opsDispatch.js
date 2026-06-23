/**
 * Ops-dispatch routes — Telegram team onboarding, config, and turning Profit
 * Radar fixes / checkout alerts into role-routed tasks. Public (no-auth) endpoints
 * power the mobile task page the team opens from Telegram.
 */

import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  getOpsConfig,
  updateOpsConfig,
  publicConfig,
  ROLES,
  ROLE_LABELS,
} from '../services/ops-dispatch/OpsDispatchConfig.js';

export default function createOpsDispatchRoutes(db, service, opts = {}) {
  const router = Router();

  const proofsDir = path.join(opts.uploadsDir || path.join(process.cwd(), 'uploads'), 'ops-proofs');
  try { fs.mkdirSync(proofsDir, { recursive: true }); } catch { /* ignore */ }
  const proofUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, proofsDir),
      filename: (_req, file, cb) => {
        const ext = (file.originalname.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0];
        cb(null, `${crypto.randomBytes(10).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: 12 * 1024 * 1024 },
  });

  function teamsPayload(venueId) {
    const cfg = getOpsConfig(db, venueId);
    return {
      config: publicConfig(cfg, process.env.PUBLIC_APP_URL || ''),
      inviteLink: service.inviteLink(cfg),
      subscribers: service.store.listSubscribers(venueId),
      pools: service.store.poolsDashboard(venueId),
      roles: ROLES.map((id) => ({ id, label: ROLE_LABELS[id] })),
    };
  }

  // ── Config ──
  router.get('/config', (req, res) => {
    const venueId = req.query.venueId;
    if (!venueId) return res.status(400).json({ error: 'venueId required' });
    const cfg = getOpsConfig(db, venueId);
    res.json({ config: publicConfig(cfg, process.env.PUBLIC_APP_URL || ''), inviteLink: service.inviteLink(cfg) });
  });

  router.put('/config', async (req, res) => {
    try {
      const { venueId, ...payload } = req.body || {};
      if (!venueId) return res.status(400).json({ error: 'venueId required' });
      const exists = db.prepare('SELECT id FROM venues WHERE id = ?').get(venueId);
      if (!exists) return res.status(404).json({ error: 'Venue not found' });
      const prevCfg = getOpsConfig(db, venueId);
      const result = updateOpsConfig(db, venueId, payload);
      if (result.error) return res.status(400).json(result);
      await service.refreshBotMeta(venueId);
      if (!prevCfg.autoDispatchEnabled && payload.autoDispatchEnabled === true) {
        service.processAutoDispatch().catch((e) => {
          console.warn('[OpsDispatch] immediate auto-dispatch after enable failed:', e.message);
        });
      }
      res.json(teamsPayload(venueId));
    } catch (err) {
      console.error('[OpsDispatch] PUT config error:', err.message);
      res.status(500).json({ error: 'Failed to save config' });
    }
  });

  router.post('/trigger-auto', async (req, res) => {
    try {
      const { venueId } = req.body || {};
      if (venueId) {
        const r = await service.autoDispatchForVenue(venueId);
        return res.json({ results: [r] });
      }
      const results = await service.processAutoDispatch();
      res.json({ results });
    } catch (err) {
      console.error('[OpsDispatch] trigger-auto error:', err.message);
      res.status(500).json({ error: 'Failed to trigger auto-dispatch' });
    }
  });

  // ── Teams / roster ──
  router.get('/teams', (req, res) => {
    const venueId = req.query.venueId;
    if (!venueId) return res.status(400).json({ error: 'venueId required' });
    res.json(teamsPayload(venueId));
  });

  router.put('/pools', (req, res) => {
    const { venueId, role, memberIds } = req.body || {};
    if (!venueId || !role || !Array.isArray(memberIds)) return res.status(400).json({ error: 'venueId, role, memberIds required' });
    service.store.setPoolOrder(venueId, role, memberIds);
    res.json(teamsPayload(venueId));
  });

  router.delete('/subscribers/:id', (req, res) => {
    const venueId = req.query.venueId;
    if (!venueId) return res.status(400).json({ error: 'venueId required' });
    service.store.removeSubscriber(venueId, req.params.id);
    res.json(teamsPayload(venueId));
  });

  // ── Dispatch a fix/alert as a task ──
  router.post('/dispatch', async (req, res) => {
    try {
      const { venueId, role, kind, title, body, payload } = req.body || {};
      if (!venueId) return res.status(400).json({ error: 'venueId required' });
      const result = await service.dispatch({ venueId, role, kind, title, body, payload });
      if (result.error) return res.status(400).json(result);
      res.json(result);
    } catch (err) {
      console.error('[OpsDispatch] dispatch error:', err.message);
      res.status(500).json({ error: 'Failed to dispatch' });
    }
  });

  // Send a sample task to the next merchandiser (admin "send test").
  router.post('/test', async (req, res) => {
    try {
      const { venueId } = req.body || {};
      if (!venueId) return res.status(400).json({ error: 'venueId required' });
      const sample = service.pickSampleRoi(venueId);
      const result = await service.dispatch({
        venueId,
        role: 'merchandiser',
        kind: 'test',
        title: `Test task${sample ? ` — ${sample.zoneName}` : ''}`,
        body: 'This is a Hyperspace dispatch test — reposition the highlighted shelf.',
        payload: {
          type: 'underperforming_zone',
          zoneName: sample?.zoneName || 'Sample shelf',
          roiId: sample?.roiId || null,
          suggestedFix: 'Reposition high-demand products to create a "speed bump" effect.',
          impact: { min: 100, max: 500, currency: 'EUR' },
        },
      });
      res.json(result);
    } catch (err) {
      console.error('[OpsDispatch] test error:', err.message);
      res.status(500).json({ error: 'Failed to send test' });
    }
  });

  // ── Feed / ledger + execution summary ──
  router.get('/feed', (req, res) => {
    const venueId = req.query.venueId;
    if (!venueId) return res.status(400).json({ error: 'venueId required' });
    res.json({ tasks: service.store.listTasks(venueId, 50), summary: service.store.summary(venueId) });
  });

  router.get('/summary', (req, res) => {
    const venueId = req.query.venueId;
    if (!venueId) return res.status(400).json({ error: 'venueId required' });
    res.json(service.store.summary(venueId));
  });

  /** Executive value ledger — daily + cumulative € from dispatch → verify pipeline. */
  router.get('/value-ledger', (req, res) => {
    const venueId = req.query.venueId;
    if (!venueId) return res.status(400).json({ error: 'venueId required' });
    const liveUnveiledDaily = req.query.liveUnveiledDaily != null
      ? Number(req.query.liveUnveiledDaily)
      : undefined;
    res.json(service.valueLedger(venueId, {
      liveUnveiledDaily: Number.isFinite(liveUnveiledDaily) ? liveUnveiledDaily : undefined,
      timezone: req.query.timezone || undefined,
    }));
  });

  // ── Public mobile task page (no auth) ──
  router.get('/public/task/:token', (req, res) => {
    const snap = service.buildTaskSnapshot(req.params.token);
    if (snap.error) return res.status(404).json(snap);
    res.json(snap);
  });

  router.post('/public/task/:token/ack', async (req, res) => {
    const r = await service.handleAck(req.params.token, null, null);
    if (r.error) return res.status(404).json(r);
    res.json(r);
  });

  router.post('/public/task/:token/resolve', async (req, res) => {
    const r = await service.handleResolve(req.params.token, null, null);
    if (r.error) return res.status(404).json(r);
    res.json(r);
  });

  // Completion proof: optional photo (multipart 'photo') + note. Marks the task done too.
  router.post('/public/task/:token/proof', proofUpload.single('photo'), async (req, res) => {
    const token = req.params.token;
    const note = (req.body?.note || '').toString().slice(0, 500);
    const photoUrl = req.file ? `/uploads/ops-proofs/${req.file.filename}` : null;
    const proof = { note: note || null, photoUrl, at: new Date().toISOString() };
    const pr = await service.recordProof(token, proof);
    if (pr.error) return res.status(404).json(pr);
    // proof implies completion
    await service.handleResolve(token, null, null);
    res.json({ ok: true, task: service.store.getTask(token) });
  });

  return router;
}
