/**
 * OpsStore
 *
 * SQLite persistence for ops-dispatch subscribers, round-robin pools and tasks.
 * Mirrors PDUMind's ops_teams JSON store, but uses the main Hyperspace DB so it
 * is multi-venue and queryable. Tables are created lazily on first use.
 */

import crypto from 'crypto';
import { ROLES, ROLE_LABELS } from './OpsDispatchConfig.js';

function nowIso() {
  return new Date().toISOString();
}

export class OpsStore {
  constructor(db) {
    this.db = db;
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ops_subscribers (
        id TEXT PRIMARY KEY,
        venue_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        telegram_chat_id TEXT,
        telegram_user_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        sort_order INTEGER NOT NULL DEFAULT 0,
        source TEXT DEFAULT 'telegram',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ops_subscribers_venue ON ops_subscribers(venue_id);

      CREATE TABLE IF NOT EXISTS ops_pools (
        venue_id TEXT NOT NULL,
        role TEXT NOT NULL,
        cursor INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (venue_id, role)
      );

      CREATE TABLE IF NOT EXISTS ops_tasks (
        token TEXT PRIMARY KEY,
        venue_id TEXT NOT NULL,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT,
        body TEXT,
        payload_json TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        assigned_subscriber_id TEXT,
        assigned_name TEXT,
        escalation_level INTEGER NOT NULL DEFAULT 0,
        last_notify_at TEXT,
        ledger_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        acknowledged_at TEXT,
        resolved_at TEXT,
        insight_id TEXT,
        proof_json TEXT,
        verification_json TEXT,
        completed_at TEXT,
        verified_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ops_tasks_venue ON ops_tasks(venue_id);
    `);
    // Lazy migration for DBs created before proof/verification columns existed.
    this._ensureColumns('ops_tasks', {
      insight_id: 'TEXT',
      proof_json: 'TEXT',
      verification_json: 'TEXT',
      completed_at: 'TEXT',
      verified_at: 'TEXT',
    });
  }

  _ensureColumns(table, cols) {
    try {
      const existing = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
      for (const [name, type] of Object.entries(cols)) {
        if (!existing.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type} DEFAULT NULL`);
      }
    } catch (err) {
      console.warn(`[OpsStore] ensureColumns(${table}) failed:`, err.message);
    }
  }

  // ─── Subscribers ───

  listSubscribers(venueId) {
    return this.db.prepare(
      'SELECT * FROM ops_subscribers WHERE venue_id = ? ORDER BY role, sort_order, created_at'
    ).all(venueId).map(this._mapSubscriber);
  }

  _mapSubscriber(row) {
    if (!row) return null;
    return {
      id: row.id,
      venueId: row.venue_id,
      displayName: row.display_name,
      role: row.role,
      roleLabel: ROLE_LABELS[row.role] || row.role,
      telegramChatId: row.telegram_chat_id,
      telegramUserId: row.telegram_user_id,
      status: row.status,
      sortOrder: row.sort_order,
      source: row.source,
      telegramLinked: !!row.telegram_chat_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  findByChat(chatId) {
    const row = this.db.prepare('SELECT * FROM ops_subscribers WHERE telegram_chat_id = ?').get(String(chatId));
    return this._mapSubscriber(row);
  }

  upsertSubscriberFromTelegram({ venueId, chatId, userId, displayName, role }) {
    const existing = this.db.prepare('SELECT * FROM ops_subscribers WHERE telegram_chat_id = ? AND venue_id = ?')
      .get(String(chatId), venueId);
    const now = nowIso();
    if (existing) {
      this.db.prepare(`UPDATE ops_subscribers SET display_name = ?, role = ?, status = 'active', updated_at = ? WHERE id = ?`)
        .run(displayName, role, now, existing.id);
      return this._mapSubscriber(this.db.prepare('SELECT * FROM ops_subscribers WHERE id = ?').get(existing.id));
    }
    const id = `sub_${crypto.randomBytes(6).toString('hex')}`;
    const maxOrder = this.db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM ops_subscribers WHERE venue_id = ? AND role = ?')
      .get(venueId, role).m;
    this.db.prepare(`
      INSERT INTO ops_subscribers (id, venue_id, display_name, role, telegram_chat_id, telegram_user_id, status, sort_order, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, 'telegram', ?, ?)
    `).run(id, venueId, displayName, role, String(chatId), String(userId || chatId), (maxOrder || 0) + 1, now, now);
    return this._mapSubscriber(this.db.prepare('SELECT * FROM ops_subscribers WHERE id = ?').get(id));
  }

  setPoolOrder(venueId, role, orderedIds) {
    const tx = this.db.transaction(() => {
      orderedIds.forEach((id, idx) => {
        this.db.prepare('UPDATE ops_subscribers SET sort_order = ? WHERE id = ? AND venue_id = ? AND role = ?')
          .run(idx + 1, id, venueId, role);
      });
    });
    tx();
  }

  removeSubscriber(venueId, id) {
    this.db.prepare('DELETE FROM ops_subscribers WHERE id = ? AND venue_id = ?').run(id, venueId);
  }

  /** Round-robin: pick the next live (telegram-linked, active) subscriber for a role. */
  pickPrimary(venueId, role) {
    const members = this.db.prepare(
      "SELECT * FROM ops_subscribers WHERE venue_id = ? AND role = ? AND status = 'active' AND telegram_chat_id IS NOT NULL ORDER BY sort_order, created_at"
    ).all(venueId, role);
    if (members.length === 0) return null;
    const poolRow = this.db.prepare('SELECT cursor FROM ops_pools WHERE venue_id = ? AND role = ?').get(venueId, role);
    const cursor = poolRow ? poolRow.cursor : 0;
    const idx = ((cursor % members.length) + members.length) % members.length;
    const next = members[idx];
    // advance cursor
    this.db.prepare(`
      INSERT INTO ops_pools (venue_id, role, cursor) VALUES (?, ?, ?)
      ON CONFLICT(venue_id, role) DO UPDATE SET cursor = excluded.cursor
    `).run(venueId, role, idx + 1);
    return this._mapSubscriber(next);
  }

  poolsDashboard(venueId) {
    const subs = this.listSubscribers(venueId);
    return ROLES.map((role) => {
      const members = subs.filter((s) => s.role === role);
      const live = members.filter((s) => s.telegramLinked && s.status === 'active');
      const poolRow = this.db.prepare('SELECT cursor FROM ops_pools WHERE venue_id = ? AND role = ?').get(venueId, role);
      const cursor = poolRow ? poolRow.cursor : 0;
      const nextPrimary = live.length ? live[((cursor % live.length) + live.length) % live.length] : null;
      return {
        id: role,
        label: ROLE_LABELS[role],
        count: members.length,
        liveCount: live.length,
        nextPrimaryId: nextPrimary ? nextPrimary.id : null,
        nextPrimaryName: nextPrimary ? nextPrimary.displayName : null,
        memberIds: members.map((m) => m.id),
      };
    });
  }

  // ─── Tasks ───

  createTask(task) {
    const now = nowIso();
    const token = crypto.randomBytes(16).toString('hex');
    const ledger = [{ ts: now, step: 'CREATED', detail: task.body || task.title || 'Task created', actor: 'hyperspace' }];
    this.db.prepare(`
      INSERT INTO ops_tasks (token, venue_id, role, kind, title, body, payload_json, status, assigned_subscriber_id, assigned_name, escalation_level, last_notify_at, ledger_json, created_at, updated_at, insight_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `).run(
      token,
      task.venueId,
      task.role,
      task.kind,
      task.title || null,
      task.body || null,
      JSON.stringify(task.payload || {}),
      task.status || 'open',
      task.assignedSubscriberId || null,
      task.assignedName || null,
      task.lastNotifyAt || null,
      JSON.stringify(ledger),
      now,
      now,
      task.insightId || task.payload?.insightId || null,
    );
    return this.getTask(token);
  }

  getTask(token) {
    const row = this.db.prepare('SELECT * FROM ops_tasks WHERE token = ?').get(token);
    return this._mapTask(row);
  }

  _mapTask(row) {
    if (!row) return null;
    let payload = {};
    let ledger = [];
    let proof = null;
    let verification = null;
    try { payload = row.payload_json ? JSON.parse(row.payload_json) : {}; } catch { payload = {}; }
    try { ledger = row.ledger_json ? JSON.parse(row.ledger_json) : []; } catch { ledger = []; }
    try { proof = row.proof_json ? JSON.parse(row.proof_json) : null; } catch { proof = null; }
    try { verification = row.verification_json ? JSON.parse(row.verification_json) : null; } catch { verification = null; }
    return {
      token: row.token,
      venueId: row.venue_id,
      role: row.role,
      roleLabel: ROLE_LABELS[row.role] || row.role,
      kind: row.kind,
      title: row.title,
      body: row.body,
      payload,
      status: row.status,
      assignedSubscriberId: row.assigned_subscriber_id,
      assignedName: row.assigned_name,
      escalationLevel: row.escalation_level,
      lastNotifyAt: row.last_notify_at,
      ledger,
      insightId: row.insight_id,
      proof,
      verification,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      acknowledgedAt: row.acknowledged_at,
      resolvedAt: row.resolved_at,
      completedAt: row.completed_at,
      verifiedAt: row.verified_at,
    };
  }

  appendLedger(token, step, detail, actor = 'system', meta = {}) {
    const task = this.getTask(token);
    if (!task) return null;
    const ledger = task.ledger || [];
    ledger.push({ ts: nowIso(), step, detail, actor, meta });
    this.db.prepare("UPDATE ops_tasks SET ledger_json = ?, updated_at = ? WHERE token = ?")
      .run(JSON.stringify(ledger), nowIso(), token);
    return this.getTask(token);
  }

  updateTask(token, fields) {
    const allowed = ['status', 'assigned_subscriber_id', 'assigned_name', 'escalation_level', 'last_notify_at', 'acknowledged_at', 'resolved_at', 'completed_at', 'verified_at'];
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(fields)) {
      if (allowed.includes(k)) { sets.push(`${k} = ?`); vals.push(v); }
    }
    if (!sets.length) return this.getTask(token);
    sets.push('updated_at = ?'); vals.push(nowIso());
    vals.push(token);
    this.db.prepare(`UPDATE ops_tasks SET ${sets.join(', ')} WHERE token = ?`).run(...vals);
    return this.getTask(token);
  }

  setProof(token, proof) {
    this.db.prepare('UPDATE ops_tasks SET proof_json = ?, updated_at = ? WHERE token = ?')
      .run(JSON.stringify(proof || {}), nowIso(), token);
    return this.getTask(token);
  }

  setVerification(token, verification) {
    this.db.prepare("UPDATE ops_tasks SET verification_json = ?, status = 'verified', verified_at = ?, updated_at = ? WHERE token = ?")
      .run(JSON.stringify(verification || {}), nowIso(), nowIso(), token);
    return this.getTask(token);
  }

  listTasks(venueId, limit = 50) {
    return this.db.prepare('SELECT * FROM ops_tasks WHERE venue_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(venueId, limit).map((r) => this._mapTask(r));
  }

  /** Tasks still awaiting team acknowledgement (escalation candidates). */
  openTasks() {
    return this.db.prepare("SELECT * FROM ops_tasks WHERE status IN ('notified')").all().map((r) => this._mapTask(r));
  }

  /** Completed-by-team tasks not yet system-verified. */
  completedAwaitingVerification() {
    return this.db.prepare("SELECT * FROM ops_tasks WHERE status = 'completed'").all().map((r) => this._mapTask(r));
  }

  /** Execution roll-up for a venue's dispatch ledger. */
  summary(venueId) {
    const tasks = this.listTasks(venueId, 200);
    const count = (s) => tasks.filter((t) => t.status === s).length;
    const dispatched = tasks.filter((t) => t.status !== 'open').length;
    const acknowledged = tasks.filter((t) => ['acknowledged', 'completed', 'verified'].includes(t.status)).length;
    const completed = tasks.filter((t) => ['completed', 'verified'].includes(t.status)).length;
    const verified = count('verified');
    // € recoverable actioned = sum of weekly impact of dispatched tasks (best-effort).
    let weeklyActioned = 0;
    let currency = '€';
    for (const t of tasks) {
      if (t.status === 'open') continue;
      const imp = t.payload?.impact;
      if (imp) {
        weeklyActioned += ((Number(imp.min) || 0) + (Number(imp.max) || 0)) / 2 * 7;
        if (imp.currency) currency = imp.currency === 'EUR' ? '€' : imp.currency;
      }
    }
    return {
      total: tasks.length,
      dispatched,
      acknowledged,
      completed,
      verified,
      weeklyActioned: Math.round(weeklyActioned),
      currency,
    };
  }
}

export default OpsStore;
