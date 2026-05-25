import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TrajectoryStorageService } from './TrajectoryStorageService.js';
import { KPICalculator } from './KPICalculator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEMO_DB_PATH = process.env.DEMO_KPI_DB_PATH
  || path.join(__dirname, '../database/demo_kpi.db');

/**
 * Isolated KPI storage for JSONL/MQTT replay demos.
 * Replay tracks are recorded here instead of the production database.
 */
export class DemoSessionService {
  constructor(mainDb) {
    this.mainDb = mainDb;
    /** @type {Map<string, DemoSession>} */
    this.sessions = new Map();
    /** @type {Map<string, string>} venueId -> sessionId */
    this.venueSessions = new Map();

    this.demoDb = this._openDemoDb();
    this._bootstrapSchema();
  }

  _openDemoDb() {
    const dir = path.dirname(DEMO_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const db = new Database(DEMO_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = OFF');
    return db;
  }

  _bootstrapSchema() {
    // Trajectory tables (zone_visits, zone_occupancy, track_positions, zone_settings, …)
    const bootstrapStorage = new TrajectoryStorageService(this.demoDb, {
      dataDir: path.join(__dirname, '../data/demo-trajectories/_bootstrap'),
      quiet: true,
    });

    this.demoDb.exec(`
      CREATE TABLE IF NOT EXISTS regions_of_interest (
        id TEXT PRIMARY KEY,
        venue_id TEXT NOT NULL,
        dwg_layout_id TEXT DEFAULT NULL,
        name TEXT NOT NULL,
        vertices TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#f59e0b',
        opacity REAL NOT NULL DEFAULT 0.5,
        metadata_json TEXT DEFAULT NULL,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_demo_roi_venue ON regions_of_interest(venue_id);
    `);

    // Release bootstrap instance (no intervals started)
    bootstrapStorage.buffer?.clear?.();
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  getActiveSessionForVenue(venueId) {
    const sessionId = this.venueSessions.get(venueId);
    if (!sessionId) return null;
    return this.getSession(sessionId);
  }

  getTrajectoryStorage(venueId) {
    const session = this.getActiveSessionForVenue(venueId);
    return session?.trajectoryStorage || null;
  }

  startSession(venueId) {
    if (!venueId) throw new Error('venueId required');

    const existingId = this.venueSessions.get(venueId);
    if (existingId) this.stopSession(existingId);

    this._clearVenueKpiData(venueId);
    this._syncVenueConfig(venueId);

    const sessionId = crypto.randomUUID();
    const dataDir = path.join(__dirname, '../data/demo-trajectories', venueId);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const trajectoryStorage = new TrajectoryStorageService(this.demoDb, {
      dataDir,
      quiet: true,
    });
    trajectoryStorage.start();
    trajectoryStorage.loadZoneLinks(venueId);
    trajectoryStorage.loadOpenLanes(venueId);

    const kpiCalculator = new KPICalculator(this.demoDb);

    const session = {
      sessionId,
      venueId,
      startedAt: Date.now(),
      trajectoryStorage,
      kpiCalculator,
    };

    this.sessions.set(sessionId, session);
    this.venueSessions.set(venueId, sessionId);

    console.log(`[DemoSession] Started ${sessionId.slice(0, 8)}… for venue ${venueId.slice(0, 8)}…`);
    return { sessionId, venueId, startedAt: session.startedAt };
  }

  stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    try {
      session.trajectoryStorage.stop();
    } catch (err) {
      console.warn('[DemoSession] stop trajectory storage:', err.message);
    }

    this._clearVenueKpiData(session.venueId);
    this.sessions.delete(sessionId);
    if (this.venueSessions.get(session.venueId) === sessionId) {
      this.venueSessions.delete(session.venueId);
    }

    console.log(`[DemoSession] Stopped ${sessionId.slice(0, 8)}…`);
    return true;
  }

  stopSessionForVenue(venueId) {
    const sessionId = this.venueSessions.get(venueId);
    if (!sessionId) return false;
    return this.stopSession(sessionId);
  }

  _clearVenueKpiData(venueId) {
    const tables = ['zone_visits', 'zone_occupancy', 'track_positions', 'zone_kpi_hourly', 'zone_kpi_daily'];
    for (const table of tables) {
      try {
        this.demoDb.prepare(`DELETE FROM ${table} WHERE venue_id = ?`).run(venueId);
      } catch {
        /* table may not exist yet */
      }
    }
  }

  _syncVenueConfig(venueId) {
    this.demoDb.prepare('DELETE FROM regions_of_interest WHERE venue_id = ?').run(venueId);
    this.demoDb.prepare('DELETE FROM zone_settings WHERE venue_id = ?').run(venueId);

    const rois = this.mainDb.prepare(
      'SELECT id, venue_id, dwg_layout_id, name, vertices, color, opacity, metadata_json, created_at, updated_at FROM regions_of_interest WHERE venue_id = ?'
    ).all(venueId);

    const insertRoi = this.demoDb.prepare(`
      INSERT INTO regions_of_interest
        (id, venue_id, dwg_layout_id, name, vertices, color, opacity, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const roi of rois) {
      insertRoi.run(
        roi.id, roi.venue_id, roi.dwg_layout_id, roi.name, roi.vertices,
        roi.color, roi.opacity, roi.metadata_json, roi.created_at, roi.updated_at
      );
    }

    let settings = [];
    try {
      settings = this.mainDb.prepare('SELECT * FROM zone_settings WHERE venue_id = ?').all(venueId);
    } catch {
      return;
    }

    if (!settings.length) return;

    const cols = Object.keys(settings[0]).filter(c => c !== 'id');
    const placeholders = cols.map(() => '?').join(', ');
    const insertSettings = this.demoDb.prepare(
      `INSERT INTO zone_settings (${cols.join(', ')}) VALUES (${placeholders})`
    );
    for (const row of settings) {
      insertSettings.run(...cols.map(c => row[c]));
    }
  }
}

export default DemoSessionService;
