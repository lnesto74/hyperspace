/**
 * LaunchPad Session Routes
 * 
 * Persistence layer for LaunchPad commissioning wizard sessions.
 * Uses a SEPARATE SQLite database (launchpad_sessions.db) to guarantee
 * zero impact on the core hyperspace.db.
 * 
 * Endpoints:
 *   PUT  /sessions          — Save/upsert a session
 *   GET  /sessions/:id      — Get a session by ID
 *   GET  /sessions          — List sessions (optionally filtered by venue_id)
 *   DELETE /sessions/:id    — Delete a session
 */

import { Router } from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// ─── Separate Database ──────────────────────────────────────────

let lpDb = null;

function getLaunchPadDb() {
  if (lpDb) return lpDb;

  const dbPath = path.join(__dirname, '..', 'data', 'launchpad_sessions.db');
  lpDb = new Database(dbPath);
  lpDb.pragma('journal_mode = WAL');
  lpDb.pragma('foreign_keys = ON');

  // Create table if not exists
  lpDb.exec(`
    CREATE TABLE IF NOT EXISTS launchpad_sessions (
      id TEXT PRIMARY KEY,
      venue_id TEXT,
      venue_name TEXT,
      current_step_id TEXT NOT NULL DEFAULT 'select_dwg',
      is_complete INTEGER NOT NULL DEFAULT 0,
      session_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_lp_sessions_venue
      ON launchpad_sessions(venue_id);
  `);

  console.log('🚀 LaunchPad sessions database initialized');
  return lpDb;
}

// ─── PUT /sessions — Upsert a session ───────────────────────────

router.put('/sessions', (req, res) => {
  try {
    const session = req.body;
    if (!session || !session.id) {
      return res.status(400).json({ error: 'Session must have an id' });
    }

    const db = getLaunchPadDb();
    const stmt = db.prepare(`
      INSERT INTO launchpad_sessions (id, venue_id, venue_name, current_step_id, is_complete, session_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        venue_id = excluded.venue_id,
        venue_name = excluded.venue_name,
        current_step_id = excluded.current_step_id,
        is_complete = excluded.is_complete,
        session_json = excluded.session_json,
        updated_at = datetime('now')
    `);

    stmt.run(
      session.id,
      session.venueId || null,
      session.venueName || null,
      session.currentStepId || 'select_dwg',
      session.isComplete ? 1 : 0,
      JSON.stringify(session),
      session.createdAt || new Date().toISOString()
    );

    res.json({ ok: true, id: session.id });
  } catch (err) {
    console.error('[LaunchPad] Save session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /sessions/:id — Get a session ──────────────────────────

router.get('/sessions/:id', (req, res) => {
  try {
    const db = getLaunchPadDb();
    const row = db.prepare('SELECT session_json FROM launchpad_sessions WHERE id = ?').get(req.params.id);
    if (!row) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(JSON.parse(row.session_json));
  } catch (err) {
    console.error('[LaunchPad] Get session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /sessions — List sessions ──────────────────────────────

router.get('/sessions', (req, res) => {
  try {
    const db = getLaunchPadDb();
    const { venue_id, limit = 20 } = req.query;

    let query = 'SELECT id, venue_id, venue_name, current_step_id, is_complete, created_at, updated_at FROM launchpad_sessions';
    const params = [];

    if (venue_id) {
      query += ' WHERE venue_id = ?';
      params.push(venue_id);
    }

    query += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(parseInt(limit) || 20);

    const rows = db.prepare(query).all(...params);
    res.json({
      sessions: rows.map(r => ({
        id: r.id,
        venueId: r.venue_id,
        venueName: r.venue_name,
        currentStepId: r.current_step_id,
        isComplete: !!r.is_complete,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('[LaunchPad] List sessions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /sessions/:id — Delete a session ────────────────────

router.delete('/sessions/:id', (req, res) => {
  try {
    const db = getLaunchPadDb();
    const result = db.prepare('DELETE FROM launchpad_sessions WHERE id = ?').run(req.params.id);
    res.json({ ok: true, deleted: result.changes });
  } catch (err) {
    console.error('[LaunchPad] Delete session error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
