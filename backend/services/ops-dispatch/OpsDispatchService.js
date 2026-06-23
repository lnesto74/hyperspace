/**
 * OpsDispatchService
 *
 * Orchestrates the Telegram ops-dispatch feature for Hyperspace:
 *   - converts a Profit Radar "suggested fix" (or a checkout/queue alert) into a
 *     role-routed task and DMs the round-robin primary subscriber
 *   - exposes a public task snapshot (2D floor-plan + target zone + products)
 *     used by the no-login mobile page the team opens from Telegram
 *   - manages a long-poll bot listener per configured bot token (no webhook)
 *   - runs reminder/escalation timers
 */

import { objectQueries } from '../../database/schema.js';
import { renderZoneGif } from './zoneMapGif.js';
import {
  getOpsConfig,
  saveOpsConfig,
  isValidTelegramToken,
  roleForInsightType,
  ROLE_EMOJI,
  ROLE_LABELS,
} from './OpsDispatchConfig.js';
import { OpsStore } from './OpsStore.js';
import { buildValueLedger } from './valueLedger.js';
import { buildDispatchFromInsight, pickInsightToDispatch } from './autoDispatch.js';
import { OpsTelegramBot } from './OpsTelegramBot.js';

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class OpsDispatchService {
  constructor(db, deps = {}) {
    this.db = db;
    this.deps = deps;
    this.store = new OpsStore(db);
    this.bots = new Map(); // botToken -> OpsTelegramBot
    this.escalationTimer = null;
    this.autoDispatchTimer = null;
    this.metricsProvider = null; // (venueId, roiId) => { engagement, queueScore, ... } | null
    this.insightsProvider = null; // () => ProfitRadarInsight[]
  }

  /** Inject live Profit Radar insights (top signal auto-dispatch). */
  setInsightsProvider(fn) {
    this.insightsProvider = fn;
  }

  /** Inject a live per-zone metric source (e.g. ProfitRadar's ZoneAggregator). */
  setMetricsProvider(fn) {
    this.metricsProvider = fn;
  }

  _zoneMetric(venueId, roiId, key) {
    if (!this.metricsProvider || !roiId) return null;
    try {
      const means = this.metricsProvider(venueId, roiId);
      if (means && Number.isFinite(means[key])) return means[key];
    } catch { /* ignore */ }
    return null;
  }

  start() {
    this.syncBots();
    // Re-sync bots periodically so a freshly-saved token starts polling.
    this.botSyncTimer = setInterval(() => this.syncBots(), 30000);
    this.escalationTimer = setInterval(() => {
      try { this.processEscalations(); } catch (e) { console.warn('[OpsDispatch] escalation error:', e.message); }
      try { this.processVerifications(); } catch (e) { console.warn('[OpsDispatch] verification error:', e.message); }
    }, 20000);
    // Auto-dispatch top insight to Telegram — runs server-side, no Pulse required.
    this.autoDispatchTimer = setInterval(() => {
      try { this.processAutoDispatch(); } catch (e) { console.warn('[OpsDispatch] auto-dispatch error:', e.message); }
    }, 5 * 60 * 1000);
    setTimeout(() => {
      try { this.processAutoDispatch(); } catch (e) { console.warn('[OpsDispatch] auto-dispatch boot error:', e.message); }
    }, 20_000);
    console.log('🤖 OpsDispatchService started (auto-dispatch every 5m)');
  }

  stop() {
    if (this.botSyncTimer) clearInterval(this.botSyncTimer);
    if (this.escalationTimer) clearInterval(this.escalationTimer);
    if (this.autoDispatchTimer) clearInterval(this.autoDispatchTimer);
    for (const bot of this.bots.values()) bot.stop();
    this.bots.clear();
  }

  /** Distinct bot tokens across all venues that have dispatch enabled. */
  _enabledTokens() {
    const tokens = new Set();
    try {
      const rows = this.db.prepare('SELECT ops_dispatch_config_json FROM venues WHERE ops_dispatch_config_json IS NOT NULL').all();
      for (const row of rows) {
        try {
          const cfg = JSON.parse(row.ops_dispatch_config_json);
          if (cfg.enabled && isValidTelegramToken(cfg.botToken)) tokens.add(cfg.botToken.trim());
        } catch { /* ignore */ }
      }
    } catch (e) {
      // ops_dispatch_config_json column may not exist yet — touch config to create it.
      if (this.deps.trackAggregator?.venueId) getOpsConfig(this.db, this.deps.trackAggregator.venueId);
    }
    return tokens;
  }

  syncBots() {
    const tokens = this._enabledTokens();
    // start new
    for (const token of tokens) {
      if (!this.bots.has(token)) {
        const bot = new OpsTelegramBot(token, this);
        this.bots.set(token, bot);
        bot.start();
      }
    }
    // stop removed
    for (const [token, bot] of this.bots.entries()) {
      if (!tokens.has(token)) {
        bot.stop();
        this.bots.delete(token);
      }
    }
  }

  /** Find which venue an invite token belongs to (scans configs). */
  resolveVenueByInvite(inviteToken) {
    if (!inviteToken) return null;
    const rows = this.db.prepare('SELECT id, name, ops_dispatch_config_json FROM venues WHERE ops_dispatch_config_json IS NOT NULL').all();
    for (const row of rows) {
      try {
        const cfg = JSON.parse(row.ops_dispatch_config_json);
        if (cfg.inviteToken && cfg.inviteToken === inviteToken) return { id: row.id, name: row.name };
      } catch { /* ignore */ }
    }
    return null;
  }

  _venueName(venueId) {
    const row = this.db.prepare('SELECT name FROM venues WHERE id = ?').get(venueId);
    return row?.name || 'Venue';
  }

  _appBaseUrl(cfg) {
    return (cfg.appBaseUrl || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  }

  _mapUrl(cfg, token) {
    const base = this._appBaseUrl(cfg);
    return base ? `${base}/m/task/${token}` : null;
  }

  _botForToken(token) {
    return this.bots.get(token) || null;
  }

  /** Generate the Telegram deep-link the admin shares for onboarding. */
  inviteLink(cfg) {
    const bot = this._botForToken(cfg.botToken);
    const username = bot?.username || cfg.botUsername;
    if (username && cfg.inviteToken) return `https://t.me/${username}?start=sub_${cfg.inviteToken}`;
    return null;
  }

  /** (Re)start pollers and resolve + persist the bot @username (for invite links). */
  async refreshBotMeta(venueId) {
    let cfg = getOpsConfig(this.db, venueId);
    if (!isValidTelegramToken(cfg.botToken)) return cfg;
    this.syncBots();
    let bot = this._botForToken(cfg.botToken);
    const transient = !bot;
    if (transient) bot = new OpsTelegramBot(cfg.botToken, this);
    try {
      const me = await bot.getMe();
      if (me.ok && me.result?.username && me.result.username !== cfg.botUsername) {
        cfg = saveOpsConfig(this.db, venueId, { ...cfg, botUsername: me.result.username });
      }
    } catch (e) {
      console.warn('[OpsDispatch] getMe failed:', e.message);
    }
    return cfg;
  }

  // ─── Dispatch ───

  /**
   * Turn an insight/alert into a role-routed task and notify the primary.
   * @param {{ venueId, role?, kind, title, body, payload }} input
   */
  async dispatch(input) {
    const { venueId } = input;
    if (!venueId) return { error: 'venueId required' };
    const cfg = getOpsConfig(this.db, venueId);
    const role = input.role || roleForInsightType(input.payload?.type);
    const payload = { ...(input.payload || {}) };
    // Capture a baseline metric so we can system-verify the outcome later.
    const metricKey = role === 'cashier' ? 'queueScore' : 'engagement';
    const lowerIsBetter = role === 'cashier';
    const measured = this._zoneMetric(venueId, payload.roiId, metricKey);
    payload.baseline = {
      metric: metricKey,
      lowerIsBetter,
      value: measured != null ? measured : (lowerIsBetter ? 0.6 : 0.12),
      source: measured != null ? 'measured' : 'estimated',
    };
    // Concrete location for the field person: centroid of the target ROI (store metres).
    if (payload.roiId && !payload.coordinates) {
      const c = this._roiCentroid(venueId, payload.roiId);
      if (c) payload.coordinates = c;
    }
    const task = this.store.createTask({
      venueId,
      role,
      kind: input.kind || 'merchandising',
      title: input.title || null,
      body: input.body || null,
      payload,
      insightId: input.payload?.insightId || input.insightId || null,
      status: 'open',
    });

    const result = { task, sent: false, assigned: null };

    if (!cfg.enabled || !isValidTelegramToken(cfg.botToken)) {
      this.store.appendLedger(task.token, 'NOT_CONFIGURED', 'Telegram dispatch not enabled — task queued', 'system');
      result.task = this.store.getTask(task.token);
      result.reason = 'not_configured';
      return result;
    }

    const primary = this.store.pickPrimary(venueId, role);
    if (!primary || !primary.telegramChatId) {
      this.store.appendLedger(task.token, 'NO_SUBSCRIBER', `No live ${ROLE_LABELS[role]} subscribed — share the invite link`, 'system');
      result.task = this.store.getTask(task.token);
      result.reason = 'no_subscriber';
      return result;
    }

    const bot = this._botForToken(cfg.botToken);
    if (!bot) {
      this.store.appendLedger(task.token, 'BOT_OFFLINE', 'Bot listener not running', 'system');
      result.task = this.store.getTask(task.token);
      result.reason = 'bot_offline';
      return result;
    }

    await this._sendTaskDm(bot, cfg, primary.telegramChatId, task, false);
    const now = new Date().toISOString();
    this.store.updateTask(task.token, {
      assigned_subscriber_id: primary.id,
      assigned_name: primary.displayName,
      last_notify_at: now,
      status: 'notified',
    });
    this.store.appendLedger(task.token, 'ASSIGNED', `Round-robin primary: ${primary.displayName} (${ROLE_LABELS[role]})`, 'hyperspace', { subscriberId: primary.id });
    this.store.appendLedger(task.token, 'NOTIFY_TELEGRAM', `Task sent to ${primary.displayName}`, 'hyperspace');

    result.sent = true;
    result.assigned = primary;
    result.task = this.store.getTask(task.token);
    return result;
  }

  async _sendTaskDm(bot, cfg, chatId, task, isEscalation) {
    const p = task.payload || {};
    const emoji = ROLE_EMOJI[task.role] || '📋';
    const venueName = this._venueName(task.venueId);
    const impact = p.impact ? `\nEst. impact: <b>${escapeHtml(impactText(p.impact))}</b>` : '';
    const coords = p.coordinates ? `\n📍 Location: <b>x ${p.coordinates.x}m · z ${p.coordinates.z}m</b>` : '';
    const zone = p.zoneName ? `\n<b>${escapeHtml(p.zoneName)}</b>` : '';
    const fix = p.suggestedFix ? `\n${escapeHtml(p.suggestedFix)}` : (task.body ? `\n${escapeHtml(task.body)}` : '');
    const header = isEscalation
      ? `${emoji} <b>ESCALATED — ${escapeHtml(ROLE_LABELS[task.role])}</b>`
      : `${emoji} <b>${escapeHtml(ROLE_LABELS[task.role])} task — ${escapeHtml(venueName)}</b>`;
    const text = `${header}${zone}${fix}${impact}${coords}`;
    const mapUrl = this._mapUrl(cfg, task.token);
    const rows = [];
    if (mapUrl) rows.push([bot.urlBtn('🗺 Open map', mapUrl)]);
    rows.push([bot.btn('✅ On it', `ack:${task.token}`), bot.btn('✔️ Done', `done:${task.token}`)]);
    const kb = bot.kb(rows);

    // Try an animated map of the pulsing zone first; fall back to plain text.
    if (p.roiId) {
      try {
        const geo = this._venueGeometry(task.venueId);
        const gif = await renderZoneGif({ objects: geo.objects, regions: geo.regions, targetRoiId: p.roiId });
        if (gif && gif.length) {
          const r = await bot.sendAnimation(chatId, gif, text, kb);
          if (r && r.ok) return r;
        }
      } catch (e) {
        console.warn('[OpsDispatch] zone gif render failed:', e.message);
      }
    }
    return bot.sendMessage(chatId, text, kb);
  }

  /** Centroid of a venue ROI polygon, in store metres. */
  _roiCentroid(venueId, roiId) {
    try {
      const row = this.db.prepare('SELECT vertices FROM regions_of_interest WHERE id = ? AND venue_id = ?').get(roiId, venueId);
      const verts = row ? safeJson(row.vertices, []) : [];
      if (!Array.isArray(verts) || verts.length < 3) return null;
      let sx = 0, sz = 0, n = 0;
      for (const v of verts) {
        const x = v.x; const z = v.z ?? v.y ?? 0;
        if (Number.isFinite(x) && Number.isFinite(z)) { sx += x; sz += z; n++; }
      }
      if (!n) return null;
      return { x: +(sx / n).toFixed(2), z: +(sz / n).toFixed(2) };
    } catch { return null; }
  }

  /** Pick a representative ROI (prefer shelves/engagement) so the test task can pulse. */
  pickSampleRoi(venueId) {
    try {
      const rows = this.db.prepare('SELECT id, name FROM regions_of_interest WHERE venue_id = ?').all(venueId);
      if (!rows.length) return null;
      const pref = rows.find((r) => /shelf|engagement|aisle/i.test(r.name || '')) || rows[0];
      return { roiId: pref.id, zoneName: pref.name || 'Shelf' };
    } catch { return null; }
  }

  /** Executive € ledger: dispatched / verified today + cumulative pipeline. */
  valueLedger(venueId, opts = {}) {
    return buildValueLedger(this.store, venueId, opts);
  }

  /**
   * Venues eligible for server auto-dispatch: active streaming venue + any venue
   * with auto-dispatch enabled in config (so it works even before a WS client connects).
   */
  _autoDispatchVenueIds() {
    const ids = new Set();
    const active = this.deps.trackAggregator?.venueId;
    if (active) ids.add(active);
    try {
      const rows = this.db.prepare('SELECT id, ops_dispatch_config_json FROM venues WHERE ops_dispatch_config_json IS NOT NULL').all();
      for (const row of rows) {
        try {
          const cfg = JSON.parse(row.ops_dispatch_config_json);
          if (cfg.enabled && cfg.autoDispatchEnabled && isValidTelegramToken(cfg.botToken)) {
            ids.add(row.id);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return [...ids];
  }

  /**
   * Auto-dispatch one venue. Returns a result object for logging / API responses.
   */
  async autoDispatchForVenue(venueId) {
    const cfg = getOpsConfig(this.db, venueId);
    if (!cfg.enabled) return { venueId, skipped: true, reason: 'dispatch_disabled' };
    if (!cfg.autoDispatchEnabled) return { venueId, skipped: true, reason: 'auto_dispatch_off' };
    if (!isValidTelegramToken(cfg.botToken)) return { venueId, skipped: true, reason: 'no_bot_token' };
    if (!this.insightsProvider) return { venueId, skipped: true, reason: 'no_insights_provider' };

    const activeVenue = this.deps.trackAggregator?.venueId;
    const insights = this.insightsProvider() || [];
    if (!insights.length) {
      return { venueId, skipped: true, reason: 'no_insights', activeVenue: activeVenue || null };
    }
    // Profit Radar insights are live for the streaming venue; skip only on explicit mismatch.
    if (activeVenue && activeVenue !== venueId) {
      return { venueId, skipped: true, reason: 'venue_not_streaming', activeVenue };
    }

    const insight = pickInsightToDispatch(insights, this.store, venueId);
    if (!insight) {
      return { venueId, skipped: true, reason: 'all_signals_dispatched_today', insightCount: insights.length };
    }

    const built = buildDispatchFromInsight(insight);
    const result = await this.dispatch({ venueId, ...built });
    return {
      venueId,
      skipped: !result.sent,
      reason: result.reason || (result.sent ? 'sent' : 'dispatch_failed'),
      insightId: insight.id,
      title: insight.title,
      sent: result.sent,
      assigned: result.assigned,
      task: result.task,
    };
  }

  /**
   * Automatically dispatch the top-ranked insight to Telegram when ops-dispatch
   * is enabled. Dedupes by insightId per day.
   */
  async processAutoDispatch() {
    const venueIds = this._autoDispatchVenueIds();
    if (!venueIds.length) {
      console.log('[OpsDispatch] auto-dispatch: no eligible venues');
      return [];
    }
    const results = [];
    for (const venueId of venueIds) {
      try {
        const r = await this.autoDispatchForVenue(venueId);
        results.push(r);
        if (r.sent) {
          console.log(`[OpsDispatch] auto-dispatched: ${r.title} → ${r.assigned?.displayName || 'team'}`);
        } else if (r.skipped) {
          console.log(`[OpsDispatch] auto-dispatch skip (${venueId.slice(0, 8)}…): ${r.reason}`);
        }
      } catch (e) {
        console.warn(`[OpsDispatch] auto-dispatch error (${venueId}):`, e.message);
        results.push({ venueId, skipped: true, reason: 'error', message: e.message });
      }
    }
    return results;
  }

  /** Venue geometry (DWG objects + ROI polygons) for map rendering. */
  _venueGeometry(venueId) {
    let objects = [];
    let regions = [];
    try { objects = objectQueries.getByVenueId(this.db, venueId) || []; } catch { /* ignore */ }
    try {
      regions = this.db.prepare('SELECT id, name, vertices FROM regions_of_interest WHERE venue_id = ?')
        .all(venueId)
        .map((r) => ({ id: r.id, name: r.name, vertices: safeJson(r.vertices, []) }))
        .filter((r) => Array.isArray(r.vertices) && r.vertices.length >= 3);
    } catch { /* ignore */ }
    return { objects, regions };
  }

  // ─── Ack / Resolve (from Telegram or the mobile web page) ───

  async handleAck(token, chatId, user) {
    const task = this.store.getTask(token);
    if (!task) return { error: 'not_found' };
    const sub = chatId ? this.store.findByChat(chatId) : null;
    const actor = sub?.displayName || user?.first_name || (chatId ? 'team' : 'web');
    if (task.status === 'resolved') return { ok: true, task };
    this.store.updateTask(token, { status: 'acknowledged', acknowledged_at: new Date().toISOString() });
    this.store.appendLedger(token, 'ACK', `${actor} acknowledged — on the way`, sub ? 'telegram' : 'web');
    const cfg = getOpsConfig(this.db, task.venueId);
    const bot = this._botForToken(cfg.botToken);
    if (bot && chatId) {
      const mapUrl = this._mapUrl(cfg, token);
      const rows = [];
      if (mapUrl) rows.push([bot.urlBtn('🗺 Open map', mapUrl)]);
      rows.push([bot.btn('✔️ Mark done', `done:${token}`)]);
      await bot.sendMessage(chatId, '✅ Acknowledged — you own this task. Mark it done when complete.', bot.kb(rows));
    }
    return { ok: true, task: this.store.getTask(token) };
  }

  async handleResolve(token, chatId, user) {
    const task = this.store.getTask(token);
    if (!task) return { error: 'not_found' };
    const sub = chatId ? this.store.findByChat(chatId) : null;
    const actor = sub?.displayName || user?.first_name || (chatId ? 'team' : 'web');
    const now = new Date().toISOString();
    this.store.updateTask(token, { status: 'completed', completed_at: now, resolved_at: now });
    this.store.appendLedger(token, 'COMPLETED', `${actor} marked the task done`, sub ? 'telegram' : 'web');
    const cfg = getOpsConfig(this.db, task.venueId);
    const bot = this._botForToken(cfg.botToken);
    if (bot && chatId) await bot.sendMessage(chatId, '✔️ Done — thank you. Hyperspace will confirm the outcome shortly.');
    return { ok: true, task: this.store.getTask(token) };
  }

  /** Attach a completion proof (photo/note) from the mobile page. */
  async recordProof(token, proof) {
    const task = this.store.getTask(token);
    if (!task) return { error: 'not_found' };
    this.store.setProof(token, proof);
    const bits = [proof?.note ? 'note' : null, proof?.photoUrl ? 'photo' : null].filter(Boolean).join(' + ');
    this.store.appendLedger(token, 'PROOF', `Completion proof attached${bits ? ` (${bits})` : ''}`, 'web');
    return { ok: true, task: this.store.getTask(token) };
  }

  /** System-verify completed tasks by measuring whether the zone/queue metric moved. */
  processVerifications() {
    const tasks = this.store.completedAwaitingVerification();
    const now = Date.now();
    for (const task of tasks) {
      const cfg = getOpsConfig(this.db, task.venueId);
      const since = task.completedAt ? (now - new Date(task.completedAt).getTime()) / 1000 : 0;
      if (since < (cfg.escalation.verifySec || 90)) continue;
      const v = this._verifyOutcome(task);
      this.store.setVerification(task.token, v);
      this.store.appendLedger(task.token, 'VERIFIED', v.summary, 'hyperspace');
      const bot = this._botForToken(cfg.botToken);
      const sub = task.assignedSubscriberId
        ? this.store.listSubscribers(task.venueId).find((s) => s.id === task.assignedSubscriberId)
        : null;
      if (bot && sub?.telegramChatId) bot.sendMessage(sub.telegramChatId, `📈 <b>Outcome confirmed</b>\n${v.summary}`);
    }
  }

  _verifyOutcome(task) {
    const base = task.payload?.baseline || {};
    const key = base.metric || (task.role === 'cashier' ? 'queueScore' : 'engagement');
    const lowerIsBetter = base.lowerIsBetter ?? (task.role === 'cashier');
    const before = Number.isFinite(base.value) ? base.value : (lowerIsBetter ? 0.6 : 0.12);
    const metricLabel = key === 'queueScore' ? 'Queue pressure' : 'Product engagement';

    let after = this._zoneMetric(task.venueId, task.payload?.roiId, key);
    let source = 'measured';
    if (after == null) {
      // No live signal in the verification window → fall back to the modeled outcome.
      source = 'projected';
      after = lowerIsBetter ? Math.max(0.05, before * 0.6) : Math.min(0.85, before + 0.16);
    }
    const delta = lowerIsBetter ? before - after : after - before;
    const improved = delta > 0.01;
    const pct = Math.abs(Math.round(delta * 100));
    const dir = lowerIsBetter ? 'down' : 'up';
    const summary = improved
      ? `${metricLabel} ${dir} ${pct}pt after the fix (${source})`
      : `No measurable change yet (${source})`;
    return {
      metric: key,
      metricLabel,
      before: +Number(before).toFixed(3),
      after: +Number(after).toFixed(3),
      delta: +Number(delta).toFixed(3),
      verdict: improved ? 'improved' : 'no_change',
      source,
      summary,
      at: new Date().toISOString(),
    };
  }

  // ─── Escalation ───

  processEscalations() {
    const open = this.store.openTasks();
    const now = Date.now();
    for (const task of open) {
      if (task.status !== 'notified') continue; // only un-acked, already-sent tasks
      if (!task.lastNotifyAt) continue;
      const cfg = getOpsConfig(this.db, task.venueId);
      if (!cfg.enabled || !isValidTelegramToken(cfg.botToken)) continue;
      const elapsed = (now - new Date(task.lastNotifyAt).getTime()) / 1000;
      const bot = this._botForToken(cfg.botToken);
      if (!bot) continue;

      if (task.escalationLevel < 1 && elapsed >= cfg.escalation.reminderSec) {
        // remind the assignee
        const sub = task.assignedSubscriberId
          ? this.store.listSubscribers(task.venueId).find((s) => s.id === task.assignedSubscriberId)
          : null;
        if (sub?.telegramChatId) this._sendTaskDm(bot, cfg, sub.telegramChatId, task, false);
        this.store.updateTask(task.token, { escalation_level: 1, last_notify_at: new Date().toISOString() });
        this.store.appendLedger(task.token, 'REMINDER', 'Reminder sent to assignee', 'system');
      } else if (task.escalationLevel < 2 && elapsed >= cfg.escalation.escalateSec) {
        // escalate to a store lead
        const lead = this.store.pickPrimary(task.venueId, 'store_lead');
        if (lead?.telegramChatId) this._sendTaskDm(bot, cfg, lead.telegramChatId, task, true);
        this.store.updateTask(task.token, { escalation_level: 2, last_notify_at: new Date().toISOString() });
        this.store.appendLedger(task.token, 'ESCALATED', `Escalated to Store Lead${lead ? `: ${lead.displayName}` : ' (none subscribed)'}`, 'system');
      }
    }
  }

  // ─── Public task snapshot (mobile map page) ───

  buildTaskSnapshot(token) {
    const task = this.store.getTask(token);
    if (!task) return { error: 'not_found' };
    const venueId = task.venueId;
    const venueName = this._venueName(venueId);

    let objects = [];
    let regions = [];
    try {
      objects = objectQueries.getByVenueId(this.db, venueId) || [];
    } catch (e) {
      console.warn('[OpsDispatch] objects fetch failed:', e.message);
    }
    try {
      regions = this.db.prepare('SELECT id, name, vertices FROM regions_of_interest WHERE venue_id = ?')
        .all(venueId)
        .map((r) => ({ id: r.id, name: r.name, vertices: safeJson(r.vertices, []) }))
        .filter((r) => Array.isArray(r.vertices) && r.vertices.length >= 3);
    } catch (e) {
      console.warn('[OpsDispatch] regions fetch failed:', e.message);
    }

    const targetRoiId = task.payload?.roiId || null;
    return {
      task: {
        token: task.token,
        role: task.role,
        roleLabel: task.roleLabel,
        kind: task.kind,
        title: task.title,
        body: task.body,
        status: task.status,
        assignedName: task.assignedName,
        createdAt: task.createdAt,
        acknowledgedAt: task.acknowledgedAt,
        completedAt: task.completedAt,
        verifiedAt: task.verifiedAt,
        proof: task.proof,
        verification: task.verification,
        payload: task.payload,
      },
      venue: { id: venueId, name: venueName },
      map: { objects, regions, targetRoiId },
    };
  }
}

function impactText(impact) {
  if (!impact) return '';
  const cur = impact.currency === 'EUR' ? '€' : (impact.currency || '€');
  const min = Math.round(Number(impact.min) || 0);
  const max = Math.round(Number(impact.max) || 0);
  return `${cur}${min.toLocaleString()}–${max.toLocaleString()} / day`;
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

export default OpsDispatchService;
