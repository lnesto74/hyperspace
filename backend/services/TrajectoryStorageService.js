import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * TrajectoryStorageService
 * 
 * Optimized trajectory storage with buffered writes:
 * 1. Collects track positions in memory buffer
 * 2. Periodically flushes to JSON files (every 5 seconds)
 * 3. Background process syncs JSON files to SQLite database (every minute)
 * 
 * This approach prevents blocking the main tracking loop with DB writes
 */
export class TrajectoryStorageService extends EventEmitter {
  constructor(db) {
    super();
    this.db = db;
    this.buffer = new Map(); // venueId -> Map<trackKey, positions[]>
    this.visitSessions = new Map(); // trackKey -> { startTime, lastSeen, roiId, positions[] }
    this.queueSessions = new Map(); // trackKey -> { queueZoneId, queueEntryTime, ... }
    this.zoneLinks = new Map(); // queueZoneId -> serviceZoneId (loaded from DB)
    this.dataDir = path.join(__dirname, '../data/trajectories');
    this.flushInterval = null;
    this.syncInterval = null;
    this.isRunning = false;
    
    // Configuration
    this.BUFFER_FLUSH_MS = 5000;      // Flush buffer to JSON every 5 seconds
    this.DB_SYNC_MS = 60000;          // Sync JSON to DB every minute
    this.CLEANUP_MS = 15 * 60 * 1000; // Cleanup old data every 15 minutes
    this.POSITION_SAMPLE_MS = 1000;   // Sample position every 1 second (not every frame)
    this.VISIT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes visit timeout
    this.DWELL_THRESHOLD_MS = 10 * 1000;    // 10 seconds for dwell (was 60s)
    this.ENGAGEMENT_THRESHOLD_MS = 30 * 1000; // 30 seconds for engagement (was 120s)
    this.VISIT_END_GRACE_MS = 1000;       // 1 second grace period before ending visit
    this.MIN_VISIT_DURATION_MS = 1000;    // Minimum 1 second to count as a visit
    this.DATA_RETENTION_MS = 24 * 60 * 60 * 1000; // Keep only 24 hours of detailed data
    this.MAX_POSITIONS_PER_SESSION = 100; // Limit positions stored per visit session
    
    // Track last sample time per track to avoid over-sampling
    this.lastSampleTime = new Map();
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    
    // Initialize database tables
    this.initTables();
  }

  initTables() {
    this.db.exec(`
      -- Zone visits table (aggregated visit data)
      CREATE TABLE IF NOT EXISTS zone_visits (
        id TEXT PRIMARY KEY,
        venue_id TEXT NOT NULL,
        roi_id TEXT NOT NULL,
        track_key TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration_ms INTEGER,
        is_complete_track INTEGER DEFAULT 0,
        is_dwell INTEGER DEFAULT 0,
        is_engagement INTEGER DEFAULT 0,
        is_conversion INTEGER DEFAULT 0,
        entry_position_x REAL,
        entry_position_z REAL,
        exit_position_x REAL,
        exit_position_z REAL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (roi_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE
      );

      -- Zone occupancy snapshots (for peak/avg occupancy)
      CREATE TABLE IF NOT EXISTS zone_occupancy (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id TEXT NOT NULL,
        roi_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        occupancy_count INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (roi_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE
      );

      -- Track positions (sampled at 1Hz for detailed analysis)
      CREATE TABLE IF NOT EXISTS track_positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id TEXT NOT NULL,
        track_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        position_x REAL NOT NULL,
        position_z REAL NOT NULL,
        velocity_x REAL DEFAULT 0,
        velocity_z REAL DEFAULT 0,
        roi_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
      );

      -- Daily KPI aggregates (for fast querying - NEVER DELETE)
      CREATE TABLE IF NOT EXISTS zone_kpi_daily (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id TEXT NOT NULL,
        roi_id TEXT NOT NULL,
        date TEXT NOT NULL,
        visits INTEGER DEFAULT 0,
        time_spent_ms INTEGER DEFAULT 0,
        dwells_cumulative INTEGER DEFAULT 0,
        dwells_unique INTEGER DEFAULT 0,
        engagements_cumulative INTEGER DEFAULT 0,
        engagements_unique INTEGER DEFAULT 0,
        peak_occupancy INTEGER DEFAULT 0,
        total_occupancy_samples INTEGER DEFAULT 0,
        sum_occupancy INTEGER DEFAULT 0,
        draws INTEGER DEFAULT 0,
        exits_count INTEGER DEFAULT 0,
        bounces INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(venue_id, roi_id, date),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (roi_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE
      );

      -- Hourly KPI aggregates (for granular historical views - NEVER DELETE)
      CREATE TABLE IF NOT EXISTS zone_kpi_hourly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id TEXT NOT NULL,
        roi_id TEXT NOT NULL,
        date TEXT NOT NULL,
        hour INTEGER NOT NULL,
        visits INTEGER DEFAULT 0,
        time_spent_ms INTEGER DEFAULT 0,
        dwells INTEGER DEFAULT 0,
        engagements INTEGER DEFAULT 0,
        peak_occupancy INTEGER DEFAULT 0,
        avg_occupancy REAL DEFAULT 0,
        avg_waiting_time_ms INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(venue_id, roi_id, date, hour),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (roi_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE
      );

      -- Zone settings (per-zone KPI thresholds and configuration)
      CREATE TABLE IF NOT EXISTS zone_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roi_id TEXT NOT NULL UNIQUE,
        venue_id TEXT NOT NULL,
        dwell_threshold_sec INTEGER DEFAULT 60,
        engagement_threshold_sec INTEGER DEFAULT 120,
        max_occupancy INTEGER DEFAULT 50,
        alerts_enabled INTEGER DEFAULT 0,
        visit_end_grace_sec INTEGER DEFAULT 3,
        min_visit_duration_sec INTEGER DEFAULT 1,
        zone_type TEXT DEFAULT 'general',
        linked_service_zone_id TEXT,
        queue_warning_threshold_sec INTEGER DEFAULT 60,
        queue_critical_threshold_sec INTEGER DEFAULT 120,
        queue_ok_color TEXT DEFAULT '#22c55e',
        queue_warning_color TEXT DEFAULT '#f59e0b',
        queue_critical_color TEXT DEFAULT '#ef4444',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (roi_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE,
        FOREIGN KEY (linked_service_zone_id) REFERENCES regions_of_interest(id) ON DELETE SET NULL
      );

      -- Zone alert rules (customizable per zone)
      CREATE TABLE IF NOT EXISTS zone_alert_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        roi_id TEXT NOT NULL,
        venue_id TEXT NOT NULL,
        rule_name TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        metric TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold_value REAL NOT NULL,
        severity TEXT DEFAULT 'warning',
        enabled INTEGER DEFAULT 1,
        message_template TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (roi_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE
      );

      -- Activity ledger (records all triggered events)
      CREATE TABLE IF NOT EXISTS activity_ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id TEXT NOT NULL,
        roi_id TEXT,
        rule_id INTEGER,
        event_type TEXT NOT NULL,
        severity TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT,
        metric_name TEXT,
        metric_value REAL,
        threshold_value REAL,
        acknowledged INTEGER DEFAULT 0,
        acknowledged_at TEXT,
        acknowledged_by TEXT,
        timestamp INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (roi_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE,
        FOREIGN KEY (rule_id) REFERENCES zone_alert_rules(id) ON DELETE SET NULL
      );

      -- White label settings (per-venue branding)
      CREATE TABLE IF NOT EXISTS white_label_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        venue_id TEXT NOT NULL UNIQUE,
        logo_url TEXT,
        logo_width INTEGER DEFAULT 200,
        logo_opacity REAL DEFAULT 1,
        show_branding INTEGER DEFAULT 1,
        primary_color TEXT DEFAULT '#3b82f6',
        accent_color TEXT DEFAULT '#f59e0b',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
      );

      -- Queue sessions table (tracks queue→service transitions per queue theory)
      CREATE TABLE IF NOT EXISTS queue_sessions (
        id TEXT PRIMARY KEY,
        venue_id TEXT NOT NULL,
        track_key TEXT NOT NULL,
        queue_zone_id TEXT NOT NULL,
        service_zone_id TEXT,
        queue_entry_time INTEGER NOT NULL,
        queue_exit_time INTEGER,
        service_entry_time INTEGER,
        service_exit_time INTEGER,
        waiting_time_ms INTEGER,
        service_time_ms INTEGER,
        time_in_system_ms INTEGER,
        is_complete INTEGER DEFAULT 0,
        is_abandoned INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (queue_zone_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE,
        FOREIGN KEY (service_zone_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE
      );

      -- Create indexes for fast queries
      CREATE INDEX IF NOT EXISTS idx_queue_sessions_venue_time ON queue_sessions(venue_id, queue_entry_time);
      CREATE INDEX IF NOT EXISTS idx_queue_sessions_queue_zone ON queue_sessions(queue_zone_id, queue_entry_time);
      CREATE INDEX IF NOT EXISTS idx_zone_visits_roi_time ON zone_visits(roi_id, start_time);
      CREATE INDEX IF NOT EXISTS idx_zone_visits_venue_time ON zone_visits(venue_id, start_time);
      CREATE INDEX IF NOT EXISTS idx_zone_occupancy_roi_time ON zone_occupancy(roi_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_track_positions_venue_time ON track_positions(venue_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_track_positions_track ON track_positions(track_key, timestamp);
      CREATE INDEX IF NOT EXISTS idx_zone_kpi_daily_roi_date ON zone_kpi_daily(roi_id, date);
      CREATE INDEX IF NOT EXISTS idx_zone_settings_roi ON zone_settings(roi_id);
      CREATE INDEX IF NOT EXISTS idx_zone_alert_rules_roi ON zone_alert_rules(roi_id);
      CREATE INDEX IF NOT EXISTS idx_activity_ledger_venue_time ON activity_ledger(venue_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_activity_ledger_roi_time ON activity_ledger(roi_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_zone_kpi_hourly_roi_date ON zone_kpi_hourly(roi_id, date, hour);
    `);
    
    // Migration: Add queue-specific columns to zone_settings if they don't exist
    try {
      const cols = this.db.prepare("PRAGMA table_info(zone_settings)").all();
      const colNames = cols.map(c => c.name);
      if (!colNames.includes('queue_warning_threshold_sec')) {
        this.db.exec(`ALTER TABLE zone_settings ADD COLUMN queue_warning_threshold_sec INTEGER DEFAULT 60`);
      }
      if (!colNames.includes('queue_critical_threshold_sec')) {
        this.db.exec(`ALTER TABLE zone_settings ADD COLUMN queue_critical_threshold_sec INTEGER DEFAULT 120`);
      }
      if (!colNames.includes('queue_ok_color')) {
        this.db.exec(`ALTER TABLE zone_settings ADD COLUMN queue_ok_color TEXT DEFAULT '#22c55e'`);
      }
      if (!colNames.includes('queue_warning_color')) {
        this.db.exec(`ALTER TABLE zone_settings ADD COLUMN queue_warning_color TEXT DEFAULT '#f59e0b'`);
      }
      if (!colNames.includes('queue_critical_color')) {
        this.db.exec(`ALTER TABLE zone_settings ADD COLUMN queue_critical_color TEXT DEFAULT '#ef4444'`);
      }
      // Add lane_number for consistent Lane 1, 2, 3 display ordering (sorted by X position)
      if (!colNames.includes('lane_number')) {
        this.db.exec(`ALTER TABLE zone_settings ADD COLUMN lane_number INTEGER`);
        console.log('📊 Added lane_number column to zone_settings');
      }
      // Add is_open to track if lane is accepting queue sessions
      if (!colNames.includes('is_open')) {
        this.db.exec(`ALTER TABLE zone_settings ADD COLUMN is_open INTEGER DEFAULT 1`);
        console.log('📊 Added is_open column to zone_settings');
      }
    } catch (err) {
      console.log('Queue threshold columns migration:', err.message);
    }
    
    console.log('📊 Trajectory storage tables initialized');
  }

  /**
   * Load queue→service zone links from zone_settings
   * Queue zones (red) are linked to service zones (green) for waiting time calculation
   */
  loadZoneLinks(venueId) {
    try {
      // First try to load manually configured links
      const links = this.db.prepare(`
        SELECT zs.roi_id as queue_zone_id, zs.linked_service_zone_id as service_zone_id
        FROM zone_settings zs
        WHERE zs.venue_id = ? AND zs.linked_service_zone_id IS NOT NULL
      `).all(venueId);
      
      for (const link of links) {
        this.zoneLinks.set(link.queue_zone_id, link.service_zone_id);
      }
      
      // Auto-detect queue→service links based on zone names and colors
      if (links.length === 0) {
        this.autoDetectZoneLinks(venueId);
      }
      
      console.log(`📊 Loaded ${this.zoneLinks.size} queue→service zone links for venue ${venueId}`);
    } catch (err) {
      // Table might not have the column yet, try auto-detect
      console.log('📊 Zone links table not ready, trying auto-detect');
      this.autoDetectZoneLinks(venueId);
    }
  }

  /**
   * Auto-detect queue→service zone pairs based on naming convention
   * Pattern: "Checkout X - Queue" paired with "Checkout X - Service"
   * Also handles: "checkout-xxxx - Queue" paired with "checkout-xxxx - Service"
   * IMPORTANT: Persists links to zone_settings table for durability
   */
  autoDetectZoneLinks(venueId) {
    try {
      const zones = this.db.prepare(`
        SELECT id, name, color, vertices FROM regions_of_interest WHERE venue_id = ?
      `).all(venueId);
      
      const queueZones = new Map(); // key: checkout identifier, value: zone
      const serviceZones = new Map(); // key: checkout identifier, value: zone
      
      for (const zone of zones) {
        const name = zone.name || '';
        const nameLower = name.toLowerCase();
        
        // Pattern 1: "Checkout X - Queue" or "Checkout X - Service" (numeric)
        const numericMatch = name.match(/checkout\s*(\d+)/i);
        // Pattern 2: "checkout-xxxx - Queue" or "checkout-xxxx - Service" (alphanumeric)
        const alphaMatch = name.match(/checkout[_-]([a-f0-9]+)/i);
        
        const checkoutId = numericMatch ? numericMatch[1] : (alphaMatch ? alphaMatch[1] : null);
        
        if (checkoutId) {
          if (nameLower.includes('queue')) {
            queueZones.set(checkoutId, { ...zone, vertices: JSON.parse(zone.vertices || '[]') });
          } else if (nameLower.includes('service')) {
            serviceZones.set(checkoutId, { ...zone, vertices: JSON.parse(zone.vertices || '[]') });
          }
        }
      }
      
      // Prepare statement for upserting zone_settings
      const upsertStmt = this.db.prepare(`
        INSERT INTO zone_settings (roi_id, venue_id, linked_service_zone_id)
        VALUES (?, ?, ?)
        ON CONFLICT(roi_id) DO UPDATE SET 
          linked_service_zone_id = excluded.linked_service_zone_id,
          updated_at = datetime('now')
      `);
      
      let persistedCount = 0;
      
      // Link queue zones to their matching service zones
      for (const [checkoutId, queueZone] of queueZones) {
        const serviceZone = serviceZones.get(checkoutId);
        if (serviceZone) {
          // Store in memory for immediate use
          this.zoneLinks.set(queueZone.id, serviceZone.id);
          
          // Persist to database for durability
          try {
            upsertStmt.run(queueZone.id, venueId, serviceZone.id);
            persistedCount++;
            console.log(`📊 Linked & persisted: "${queueZone.name}" → "${serviceZone.name}"`);
          } catch (dbErr) {
            console.warn(`📊 Failed to persist link for ${queueZone.name}:`, dbErr.message);
          }
        }
      }
      
      console.log(`📊 Auto-linked ${this.zoneLinks.size} queue→service zone pairs (${persistedCount} persisted to DB)`);
    } catch (err) {
      console.error('Failed to auto-detect zone links:', err);
    }
  }

  /**
   * Get center point of a zone polygon
   */
  getZoneCenter(vertices) {
    if (!vertices || vertices.length === 0) return { x: 0, z: 0 };
    const sumX = vertices.reduce((sum, v) => sum + (v.x || 0), 0);
    const sumZ = vertices.reduce((sum, v) => sum + (v.z || 0), 0);
    return { x: sumX / vertices.length, z: sumZ / vertices.length };
  }

  /**
   * Load open lanes from database for a venue
   * Only open lanes will create queue sessions
   */
  loadOpenLanes(venueId) {
    try {
      const rows = this.db.prepare(`
        SELECT roi_id FROM zone_settings WHERE venue_id = ? AND is_open = 1
      `).all(venueId);
      this.openLanes = new Set(rows.map(r => r.roi_id));
      console.log(`📊 Loaded ${this.openLanes.size} open lanes for queue tracking`);
    } catch (err) {
      console.error('Failed to load open lanes:', err);
      this.openLanes = new Set();
    }
  }

  /**
   * Set a lane as open or closed
   */
  setLaneOpen(venueId, queueZoneId, isOpen) {
    try {
      this.db.prepare(`
        UPDATE zone_settings SET is_open = ? WHERE venue_id = ? AND roi_id = ?
      `).run(isOpen ? 1 : 0, venueId, queueZoneId);
      // Reload open lanes
      this.loadOpenLanes(venueId);
      console.log(`📊 Lane ${queueZoneId.substring(0, 8)} set to ${isOpen ? 'OPEN' : 'CLOSED'}`);
    } catch (err) {
      console.error('Failed to set lane state:', err);
    }
  }

  /**
   * Check if a queue zone is open (accepting queue sessions)
   */
  isLaneOpen(queueZoneId) {
    // If openLanes not loaded yet (undefined), assume all open (backward compat)
    // But if loaded and empty, that means all lanes are explicitly closed
    if (this.openLanes === undefined) return true;
    if (this.openLanes.size === 0) return false; // All lanes closed
    return this.openLanes.has(queueZoneId);
  }

  /**
   * Track queue session for a person (queue theory)
   * Called when a person enters or is in a queue zone
   * Only tracks sessions for OPEN lanes
   */
  updateQueueSession(venueId, trackKey, queueZoneId, currentRoiIds, timestamp) {
    const serviceZoneId = this.zoneLinks.get(queueZoneId);
    if (!serviceZoneId) return; // No linked service zone
    
    // Only track queue sessions for OPEN lanes
    if (!this.isLaneOpen(queueZoneId)) return;
    
    const sessionKey = `${trackKey}:${queueZoneId}`;
    const inServiceZone = currentRoiIds.includes(serviceZoneId);
    
    if (!this.queueSessions.has(sessionKey)) {
      // Person just entered queue zone - start new queue session
      this.queueSessions.set(sessionKey, {
        id: `qs-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        venueId,
        trackKey,
        queueZoneId,
        serviceZoneId,
        queueEntryTime: timestamp,
        queueExitTime: null,
        serviceEntryTime: null,
        serviceExitTime: null,
        lastSeenInQueue: timestamp,
        lastSeenInService: null,
      });
      console.log(`📊 Queue session started: ${trackKey} entered queue ${queueZoneId}`);
    }
    
    const session = this.queueSessions.get(sessionKey);
    
    // Check if person transitioned to service zone
    if (inServiceZone && !session.serviceEntryTime) {
      session.queueExitTime = timestamp;
      session.serviceEntryTime = timestamp;
      session.lastSeenInService = timestamp;
      console.log(`📊 Queue→Service transition: ${trackKey} (waited ${Math.round((timestamp - session.queueEntryTime) / 1000)}s)`);
    } else if (inServiceZone && session.serviceEntryTime) {
      // Still in service zone
      session.lastSeenInService = timestamp;
    } else if (!inServiceZone && !session.serviceEntryTime) {
      // Still in queue zone (not yet in service)
      session.lastSeenInQueue = timestamp;
    }
  }

  /**
   * Check if a track has any active queue sessions
   */
  hasActiveQueueSessions(trackKey) {
    for (const sessionKey of this.queueSessions.keys()) {
      if (sessionKey.startsWith(trackKey + ':')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all active queue sessions for debugging
   * Returns array of { personId, queueZoneId, entryTime, currentDwellMs }
   */
  getActiveQueueSessions() {
    const now = Date.now();
    const sessions = [];
    
    for (const [sessionKey, session] of this.queueSessions.entries()) {
      sessions.push({
        personId: session.trackKey,
        queueZoneId: session.queueZoneId,
        queueZoneShort: session.queueZoneId.substring(0, 8),
        entryTime: session.queueEntryTime,
        entryTimeStr: new Date(session.queueEntryTime).toLocaleTimeString(),
        currentDwellMs: now - session.queueEntryTime,
        currentDwellSec: Math.round((now - session.queueEntryTime) / 1000),
        inService: !!session.serviceEntryTime,
        serviceEntryTime: session.serviceEntryTime,
      });
    }
    
    // Sort by entry time (newest first)
    sessions.sort((a, b) => b.entryTime - a.entryTime);
    
    return sessions;
  }

  /**
   * Check if any queue sessions should be finalized
   * Logic: Exiting the queue zone = session complete (served)
   * Only mark as abandoned if dwell time < MIN_QUEUE_DWELL_MS (walk-through/bounce)
   */
  checkQueueSessionEnds(trackKey, currentRoiIds, timestamp) {
    const GRACE_MS = 1000; // 1 second grace period before finalizing
    const MIN_QUEUE_DWELL_MS = 5000; // 5 seconds minimum to count as real queue (not walk-through)
    
    for (const [sessionKey, session] of this.queueSessions.entries()) {
      if (!sessionKey.startsWith(trackKey + ':')) continue;
      
      const inQueueZone = currentRoiIds.includes(session.queueZoneId);
      const inServiceZone = currentRoiIds.includes(session.serviceZoneId);
      
      // Person left service zone after being served - complete session (precise tracking)
      if (session.serviceEntryTime && !inServiceZone) {
        const timeSinceService = timestamp - session.lastSeenInService;
        if (timeSinceService > GRACE_MS) {
          session.serviceExitTime = session.lastSeenInService;
          this.finalizeQueueSession(session);
          this.queueSessions.delete(sessionKey);
        }
      }
      // Person left queue zone (no service zone tracking needed)
      else if (!inQueueZone && !inServiceZone) {
        const timeSinceQueue = timestamp - session.lastSeenInQueue;
        if (timeSinceQueue > GRACE_MS) {
          session.queueExitTime = session.lastSeenInQueue;
          const dwellTime = session.queueExitTime - session.queueEntryTime;
          
          // Short dwell = walk-through/bounce (abandoned)
          // Longer dwell = completed queue session (served)
          session.isAbandoned = dwellTime < MIN_QUEUE_DWELL_MS;
          this.finalizeQueueSession(session);
          this.queueSessions.delete(sessionKey);
        }
      }
    }
  }

  /**
   * Finalize a queue session and save to database
   */
  finalizeQueueSession(session) {
    const waitingTimeMs = session.serviceEntryTime 
      ? session.serviceEntryTime - session.queueEntryTime 
      : (session.queueExitTime || Date.now()) - session.queueEntryTime;
    
    const serviceTimeMs = session.serviceEntryTime && session.serviceExitTime
      ? session.serviceExitTime - session.serviceEntryTime
      : null;
    
    const timeInSystemMs = session.serviceExitTime
      ? session.serviceExitTime - session.queueEntryTime
      : null;
    
    const isComplete = session.serviceEntryTime && session.serviceExitTime ? 1 : 0;
    const isAbandoned = session.isAbandoned ? 1 : 0;
    
    try {
      this.db.prepare(`
        INSERT INTO queue_sessions (id, venue_id, track_key, queue_zone_id, service_zone_id, 
          queue_entry_time, queue_exit_time, service_entry_time, service_exit_time,
          waiting_time_ms, service_time_ms, time_in_system_ms, is_complete, is_abandoned)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        session.id,
        session.venueId,
        session.trackKey,
        session.queueZoneId,
        session.serviceZoneId,
        session.queueEntryTime,
        session.queueExitTime,
        session.serviceEntryTime,
        session.serviceExitTime,
        waitingTimeMs,
        serviceTimeMs,
        timeInSystemMs,
        isComplete,
        isAbandoned
      );
      
      const status = isAbandoned ? 'ABANDONED' : (isComplete ? 'COMPLETE' : 'PARTIAL');
      console.log(`📊 Queue session ${status}: wait=${Math.round(waitingTimeMs/1000)}s, service=${serviceTimeMs ? Math.round(serviceTimeMs/1000) + 's' : 'N/A'}`);
      
      this.emit('queue_session_ended', {
        ...session,
        waitingTimeMs,
        serviceTimeMs,
        timeInSystemMs,
        isComplete,
        isAbandoned,
      });
    } catch (err) {
      console.error('Failed to save queue session:', err);
    }
  }

  /**
   * Get current real-time waiting time for people currently in ANY zone
   * Uses in-memory visit sessions (not database) for instant updates
   */
  getCurrentWaitingTimeMs(roiId) {
    const now = Date.now();
    let totalWaitMs = 0;
    let count = 0;
    
    // First check queue sessions for queue zones
    for (const [sessionKey, session] of this.queueSessions.entries()) {
      if (session.queueZoneId === roiId && !session.serviceEntryTime) {
        const waitSoFar = now - session.queueEntryTime;
        totalWaitMs += waitSoFar;
        count++;
      }
    }
    
    // If no queue sessions, check regular visit sessions
    if (count === 0) {
      for (const [sessionKey, session] of this.visitSessions.entries()) {
        if (session.roiId === roiId) {
          const waitSoFar = now - session.startTime;
          totalWaitMs += waitSoFar;
          count++;
        }
      }
    }
    
    return count > 0 ? totalWaitMs / count : 0;
  }

  /**
   * Get live stats for a zone from in-memory sessions
   */
  getLiveZoneStats(roiId) {
    const now = Date.now();
    let totalTimeMs = 0;
    let count = 0;
    let maxTimeMs = 0;
    
    for (const [sessionKey, session] of this.visitSessions.entries()) {
      if (session.roiId === roiId) {
        const timeInZone = now - session.startTime;
        totalTimeMs += timeInZone;
        maxTimeMs = Math.max(maxTimeMs, timeInZone);
        count++;
      }
    }
    
    return {
      currentOccupancy: count,
      avgTimeInZoneMs: count > 0 ? totalTimeMs / count : 0,
      maxTimeInZoneMs: maxTimeMs,
      avgTimeInZoneSec: count > 0 ? Math.round(totalTimeMs / count / 1000) : 0,
      avgTimeInZoneMin: count > 0 ? Math.round(totalTimeMs / count / 60000 * 10) / 10 : 0,
    };
  }

  /**
   * Get queue KPIs for a specific queue zone
   */
  getQueueKPIs(queueZoneId, startTime, endTime) {
    const result = this.db.prepare(`
      SELECT 
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN is_complete = 1 THEN 1 END) as completed_sessions,
        COUNT(CASE WHEN is_abandoned = 1 THEN 1 END) as abandoned_sessions,
        AVG(waiting_time_ms) as avg_waiting_time_ms,
        AVG(CASE WHEN is_complete = 1 THEN waiting_time_ms END) as avg_waiting_time_complete_ms,
        MAX(waiting_time_ms) as max_waiting_time_ms,
        AVG(service_time_ms) as avg_service_time_ms,
        AVG(time_in_system_ms) as avg_time_in_system_ms,
        COUNT(*) * 1.0 / NULLIF((? - ?) / 3600000.0, 0) as arrival_rate_per_hour
      FROM queue_sessions
      WHERE queue_zone_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
    `).get(endTime, startTime, queueZoneId, startTime, endTime);
    
    // Calculate percentiles
    const waitTimes = this.db.prepare(`
      SELECT waiting_time_ms FROM queue_sessions
      WHERE queue_zone_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
      ORDER BY waiting_time_ms
    `).all(queueZoneId, startTime, endTime);
    
    const p50 = this.percentile(waitTimes.map(r => r.waiting_time_ms), 50);
    const p90 = this.percentile(waitTimes.map(r => r.waiting_time_ms), 90);
    const p95 = this.percentile(waitTimes.map(r => r.waiting_time_ms), 95);
    
    // Get current real-time waiting time for people in queue NOW
    const currentWaitMs = this.getCurrentWaitingTimeMs(queueZoneId);
    
    // Use current wait time if we have active sessions, otherwise use historical average
    const effectiveWaitMs = currentWaitMs > 0 ? currentWaitMs : (result?.avg_waiting_time_ms || 0);
    
    return {
      totalSessions: result?.total_sessions || 0,
      completedSessions: result?.completed_sessions || 0,
      abandonedSessions: result?.abandoned_sessions || 0,
      abandonRate: result?.total_sessions > 0 
        ? ((result.abandoned_sessions || 0) / result.total_sessions) * 100 
        : 0,
      avgWaitingTimeMs: effectiveWaitMs,
      historicalAvgWaitMs: result?.avg_waiting_time_ms || 0,
      currentWaitMs: currentWaitMs,
      avgWaitingTimeCompleteMs: result?.avg_waiting_time_complete_ms || 0,
      maxWaitingTimeMs: result?.max_waiting_time_ms || 0,
      medianWaitingTimeMs: p50 || 0,
      p90WaitingTimeMs: p90 || 0,
      p95WaitingTimeMs: p95 || 0,
      avgServiceTimeMs: result?.avg_service_time_ms || 0,
      avgTimeInSystemMs: result?.avg_time_in_system_ms || 0,
      arrivalRatePerHour: result?.arrival_rate_per_hour || 0,
      // Formatted for display
      avgWaitingTimeSec: Math.round(effectiveWaitMs / 1000),
      avgWaitingTimeMin: Math.round(effectiveWaitMs / 60000 * 10) / 10,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  percentile(arr, p) {
    if (arr.length === 0) return 0;
    const idx = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, idx)];
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Start buffer flush interval
    this.flushInterval = setInterval(() => this.flushBuffer(), this.BUFFER_FLUSH_MS);
    
    // Start DB sync interval
    this.syncInterval = setInterval(() => this.syncToDatabase(), this.DB_SYNC_MS);
    
    // Start cleanup interval to prevent database bloat
    this.cleanupInterval = setInterval(() => this.cleanupOldData(), this.CLEANUP_MS);
    
    // Run initial cleanup
    setTimeout(() => this.cleanupOldData(), 10000);
    
    console.log('📊 Trajectory storage service started');
  }

  stop() {
    this.isRunning = false;
    
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Final flush before stopping
    this.flushBuffer();
    this.syncToDatabase();
    
    console.log('📊 Trajectory storage service stopped');
  }

  /**
   * Clean up old data to prevent database bloat
   * IMPORTANT: Aggregates data BEFORE deleting to preserve historical KPIs
   */
  cleanupOldData() {
    const cutoffTime = Date.now() - this.DATA_RETENTION_MS;
    
    try {
      // STEP 1: Aggregate hourly data BEFORE deleting raw data
      this.aggregateHourlyData(cutoffTime);
      
      // STEP 2: Update daily aggregates
      this.updateDailyAggregates();
      
      // STEP 3: Now safe to delete old raw data (aggregated data preserved)
      const posResult = this.db.prepare(`
        DELETE FROM track_positions WHERE timestamp < ?
      `).run(cutoffTime);
      
      // Delete old zone occupancy snapshots
      const occResult = this.db.prepare(`
        DELETE FROM zone_occupancy WHERE timestamp < ?
      `).run(cutoffTime);
      
      // Delete old activity ledger entries (keep 7 days)
      const ledgerCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const ledgerResult = this.db.prepare(`
        DELETE FROM activity_ledger WHERE timestamp < ? AND acknowledged = 1
      `).run(ledgerCutoff);
      
      // Clean up stale visit sessions in memory (older than 1 hour)
      const sessionCutoff = Date.now() - 60 * 60 * 1000;
      let staleSessions = 0;
      for (const [key, session] of this.visitSessions.entries()) {
        if (session.lastSeen < sessionCutoff) {
          this.visitSessions.delete(key);
          staleSessions++;
        }
      }
      
      // Clean up stale queue sessions
      let staleQueues = 0;
      for (const [key, session] of this.queueSessions.entries()) {
        const lastActivity = session.lastSeenInService || session.lastSeenInQueue || session.queueEntryTime;
        if (lastActivity < sessionCutoff) {
          this.queueSessions.delete(key);
          staleQueues++;
        }
      }
      
      // Clean up lastSampleTime map
      for (const [trackKey, time] of this.lastSampleTime.entries()) {
        if (time < sessionCutoff) {
          this.lastSampleTime.delete(trackKey);
        }
      }
      
      const totalDeleted = posResult.changes + occResult.changes + ledgerResult.changes;
      if (totalDeleted > 0 || staleSessions > 0 || staleQueues > 0) {
        console.log(`🧹 Cleanup: ${posResult.changes} positions, ${occResult.changes} occupancy, ${ledgerResult.changes} ledger, ${staleSessions} stale sessions, ${staleQueues} stale queues`);
      }
      
      // Run VACUUM periodically to reclaim space (every ~4 hours based on 15min interval)
      if (Math.random() < 0.0625) { // ~1/16 chance = every ~4 hours
        console.log('🧹 Running database VACUUM...');
        this.db.exec('VACUUM');
        console.log('🧹 VACUUM complete');
      }
    } catch (err) {
      console.error('Failed to cleanup old data:', err);
    }
  }

  /**
   * Record a track position (called from TrackAggregator)
   * Only samples at POSITION_SAMPLE_MS intervals to reduce data volume
   */
  recordTrackPosition(venueId, track, rois) {
    const now = Date.now();
    const lastSample = this.lastSampleTime.get(track.trackKey) || 0;
    
    // Only sample at specified interval
    if (now - lastSample < this.POSITION_SAMPLE_MS) {
      return;
    }
    this.lastSampleTime.set(track.trackKey, now);
    
    // Determine which ROI(s) this track is in
    const currentRois = this.findContainingRois(track.venuePosition, rois);
    
    // Initialize venue buffer if needed
    if (!this.buffer.has(venueId)) {
      this.buffer.set(venueId, []);
    }
    
    // Add position to buffer
    const positionData = {
      trackKey: track.trackKey,
      timestamp: now,
      x: track.venuePosition.x,
      z: track.venuePosition.z,
      vx: track.velocity?.x || 0,
      vz: track.velocity?.z || 0,
      roiIds: currentRois.map(r => r.id),
    };
    
    this.buffer.get(venueId).push(positionData);
    
    // Cache the ROI IDs to avoid repeated map() calls
    const currentRoiIds = currentRois.map(r => r.id);
    
    // Update visit sessions for each ROI
    for (const roi of currentRois) {
      this.updateVisitSession(venueId, track.trackKey, roi.id, positionData);
      
      // Track queue sessions for queue zones (per queue theory)
      // Only call if this ROI is a linked queue zone
      if (this.zoneLinks.has(roi.id)) {
        // Debug: log when someone enters a queue zone
        if (!this.queueSessions.has(`${track.trackKey}:${roi.id}`)) {
          const isOpen = this.isLaneOpen(roi.id);
          console.log(`📊 DEBUG: ${track.trackKey} in queue zone ${roi.id.substring(0,8)}, isOpen=${isOpen}, openLanes=${this.openLanes?.size || 'undefined'}`);
        }
        this.updateQueueSession(venueId, track.trackKey, roi.id, currentRoiIds, now);
      }
    }
    
    // Check for visit end in ROIs the track left
    this.checkVisitEnds(venueId, track.trackKey, currentRois);
    
    // Check for queue session ends (only if we have any active sessions for this track)
    if (this.hasActiveQueueSessions(track.trackKey)) {
      this.checkQueueSessionEnds(track.trackKey, currentRoiIds, now);
    }
  }

  /**
   * Check if a point is inside a polygon (ROI)
   */
  isPointInPolygon(point, vertices) {
    let inside = false;
    const n = vertices.length;
    
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = vertices[i].x, zi = vertices[i].z;
      const xj = vertices[j].x, zj = vertices[j].z;
      
      if (((zi > point.z) !== (zj > point.z)) &&
          (point.x < (xj - xi) * (point.z - zi) / (zj - zi) + xi)) {
        inside = !inside;
      }
    }
    
    return inside;
  }

  /**
   * Find all ROIs containing a position
   */
  findContainingRois(position, rois) {
    return rois.filter(roi => this.isPointInPolygon(position, roi.vertices));
  }

  /**
   * Update visit session for a track in an ROI
   */
  updateVisitSession(venueId, trackKey, roiId, positionData) {
    const sessionKey = `${trackKey}:${roiId}`;
    const now = Date.now();
    
    if (!this.visitSessions.has(sessionKey)) {
      // New visit session
      this.visitSessions.set(sessionKey, {
        venueId,
        trackKey,
        roiId,
        startTime: now,
        lastSeen: now,
        entryPosition: { x: positionData.x, z: positionData.z },
        positions: [positionData],
      });
    } else {
      // Update existing session (limit positions to prevent memory leak)
      const session = this.visitSessions.get(sessionKey);
      session.lastSeen = now;
      if (session.positions.length < this.MAX_POSITIONS_PER_SESSION) {
        session.positions.push(positionData);
      }
    }
  }

  /**
   * Check if any visits have ended (track left ROI or timed out)
   */
  checkVisitEnds(venueId, trackKey, currentRois) {
    const currentRoiIds = new Set(currentRois.map(r => r.id));
    const now = Date.now();
    
    // Check all sessions for this track
    for (const [sessionKey, session] of this.visitSessions.entries()) {
      if (!sessionKey.startsWith(trackKey + ':')) continue;
      
      const roiId = sessionKey.split(':')[1];
      const timeSinceLastSeen = now - session.lastSeen;
      const visitDuration = session.lastSeen - session.startTime;
      
      // Track is still in this ROI - update lastSeen and continue
      if (currentRoiIds.has(roiId)) {
        session.lastSeen = now;
        continue;
      }
      
      // Track left ROI - check if grace period has passed
      if (timeSinceLastSeen < this.VISIT_END_GRACE_MS) {
        // Still within grace period, don't end yet
        continue;
      }
      
      // Grace period passed - finalize if visit was long enough
      if (visitDuration >= this.MIN_VISIT_DURATION_MS) {
        this.finalizeVisit(session);
      }
      this.visitSessions.delete(sessionKey);
    }
  }

  /**
   * Finalize a visit and prepare it for database storage
   */
  finalizeVisit(session) {
    const duration = session.lastSeen - session.startTime;
    const lastPos = session.positions[session.positions.length - 1];
    
    const visit = {
      id: `visit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      venueId: session.venueId,
      roiId: session.roiId,
      trackKey: session.trackKey,
      startTime: session.startTime,
      endTime: session.lastSeen,
      durationMs: duration,
      isCompleteTrack: this.isCompleteTrack(session),
      isDwell: duration >= this.DWELL_THRESHOLD_MS,
      isEngagement: duration >= this.ENGAGEMENT_THRESHOLD_MS,
      entryPosition: session.entryPosition,
      exitPosition: { x: lastPos.x, z: lastPos.z },
    };
    
    // Write visit to pending file
    this.writeVisitToFile(visit);
    
    this.emit('visit_ended', visit);
  }

  /**
   * Check if a track started and ended outside the ROI (complete track)
   */
  isCompleteTrack(session) {
    // A complete track should have measurements both before entering and after exiting
    // For now, we consider it complete if the visit is substantial
    return session.positions.length > 5;
  }

  /**
   * Flush memory buffer to JSON files
   */
  flushBuffer() {
    if (this.buffer.size === 0) return;
    
    const timestamp = Date.now();
    
    for (const [venueId, positions] of this.buffer.entries()) {
      if (positions.length === 0) continue;
      
      const filename = `positions_${venueId}_${timestamp}.json`;
      const filepath = path.join(this.dataDir, filename);
      
      try {
        fs.writeFileSync(filepath, JSON.stringify({
          venueId,
          timestamp,
          positions,
        }));
        
        // Clear the buffer after successful write
        this.buffer.set(venueId, []);
      } catch (err) {
        console.error('Failed to flush trajectory buffer:', err);
      }
    }
  }

  /**
   * Write a finalized visit to a pending file (append mode - NDJSON format)
   * Uses newline-delimited JSON for efficient append without reading whole file
   */
  writeVisitToFile(visit) {
    const filename = `visits_pending.ndjson`;
    const filepath = path.join(this.dataDir, filename);
    
    try {
      // Append single line (NDJSON format - one JSON object per line)
      fs.appendFileSync(filepath, JSON.stringify(visit) + '\n');
    } catch (err) {
      console.error('Failed to write visit to file:', err);
    }
  }

  /**
   * Sync JSON files to SQLite database
   */
  syncToDatabase() {
    try {
      // Sync position files
      this.syncPositionFiles();
      
      // Sync visit files
      this.syncVisitFiles();
      
      // Update daily aggregates
      this.updateDailyAggregates();
      
    } catch (err) {
      console.error('Failed to sync to database:', err);
    }
  }

  /**
   * Sync position JSON files to database
   */
  syncPositionFiles() {
    const files = fs.readdirSync(this.dataDir).filter(f => f.startsWith('positions_'));
    
    const insertStmt = this.db.prepare(`
      INSERT INTO track_positions (venue_id, track_key, timestamp, position_x, position_z, velocity_x, velocity_z, roi_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((positions, venueId) => {
      for (const pos of positions) {
        insertStmt.run(
          venueId,
          pos.trackKey,
          pos.timestamp,
          pos.x,
          pos.z,
          pos.vx,
          pos.vz,
          pos.roiIds?.[0] || null
        );
      }
    });
    
    for (const file of files) {
      const filepath = path.join(this.dataDir, file);
      try {
        const content = fs.readFileSync(filepath, 'utf-8');
        const data = JSON.parse(content);
        
        insertMany(data.positions, data.venueId);
        
        // Delete processed file
        fs.unlinkSync(filepath);
      } catch (err) {
        console.error(`Failed to process position file ${file}:`, err);
      }
    }
  }

  /**
   * Sync visit files to database (supports both old JSON and new NDJSON formats)
   */
  syncVisitFiles() {
    // Try new NDJSON format first, then fall back to old JSON format
    const ndjsonPath = path.join(this.dataDir, 'visits_pending.ndjson');
    const jsonPath = path.join(this.dataDir, 'visits_pending.json');
    
    let filepath = null;
    let isNdjson = false;
    
    if (fs.existsSync(ndjsonPath)) {
      filepath = ndjsonPath;
      isNdjson = true;
    } else if (fs.existsSync(jsonPath)) {
      filepath = jsonPath;
      isNdjson = false;
    } else {
      return; // No files to sync
    }
    
    try {
      const stats = fs.statSync(filepath);
      console.log(`📊 Syncing ${isNdjson ? 'NDJSON' : 'JSON'} visits (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);
      
      const content = fs.readFileSync(filepath, 'utf-8');
      let visits;
      
      if (isNdjson) {
        // Parse NDJSON (one JSON object per line)
        visits = content.trim().split('\n').filter(line => line.trim()).map(line => {
          try {
            return JSON.parse(line);
          } catch (e) {
            console.error('Failed to parse NDJSON line:', line.substring(0, 100));
            return null;
          }
        }).filter(v => v !== null);
      } else {
        // Parse old JSON array format
        visits = JSON.parse(content);
      }
      
      console.log(`📊 Parsed ${visits.length} visits to sync`);
      
      if (visits.length === 0) {
        fs.unlinkSync(filepath);
        return;
      }
      
      const insertStmt = this.db.prepare(`
        INSERT OR IGNORE INTO zone_visits (id, venue_id, roi_id, track_key, start_time, end_time, duration_ms, is_complete_track, is_dwell, is_engagement, entry_position_x, entry_position_z, exit_position_x, exit_position_z)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      let insertedCount = 0;
      const insertMany = this.db.transaction((visits) => {
        for (const v of visits) {
          const result = insertStmt.run(
            v.id,
            v.venueId,
            v.roiId,
            v.trackKey,
            v.startTime,
            v.endTime,
            v.durationMs,
            v.isCompleteTrack ? 1 : 0,
            v.isDwell ? 1 : 0,
            v.isEngagement ? 1 : 0,
            v.entryPosition?.x,
            v.entryPosition?.z,
            v.exitPosition?.x,
            v.exitPosition?.z
          );
          if (result.changes > 0) insertedCount++;
        }
      });
      
      insertMany(visits);
      
      console.log(`📊 Inserted ${insertedCount} new visits (${visits.length - insertedCount} duplicates ignored)`);
      
      // Clear the file
      fs.unlinkSync(filepath);
      console.log('📊 visits_pending.json deleted after sync');
    } catch (err) {
      console.error('❌ Failed to sync visits to database:', err);
    }
  }

  /**
   * Aggregate hourly KPI data from raw tables before cleanup
   * This preserves historical granular data for day/week/month views
   */
  aggregateHourlyData(beforeTimestamp) {
    try {
      // Get distinct hours that have data to aggregate
      const hoursWithData = this.db.prepare(`
        SELECT DISTINCT 
          venue_id,
          roi_id,
          date(timestamp/1000, 'unixepoch', 'localtime') as date,
          strftime('%H', timestamp/1000, 'unixepoch', 'localtime') as hour
        FROM zone_occupancy
        WHERE timestamp < ?
        GROUP BY venue_id, roi_id, date, hour
      `).all(beforeTimestamp);
      
      if (hoursWithData.length === 0) return;
      
      const upsertHourly = this.db.prepare(`
        INSERT INTO zone_kpi_hourly (venue_id, roi_id, date, hour, visits, time_spent_ms, dwells, engagements, peak_occupancy, avg_occupancy, avg_waiting_time_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(venue_id, roi_id, date, hour) DO UPDATE SET
          visits = visits + excluded.visits,
          time_spent_ms = time_spent_ms + excluded.time_spent_ms,
          dwells = dwells + excluded.dwells,
          engagements = engagements + excluded.engagements,
          peak_occupancy = MAX(peak_occupancy, excluded.peak_occupancy),
          avg_occupancy = (avg_occupancy + excluded.avg_occupancy) / 2,
          avg_waiting_time_ms = (avg_waiting_time_ms + excluded.avg_waiting_time_ms) / 2,
          updated_at = datetime('now')
      `);
      
      let aggregatedCount = 0;
      for (const { venue_id, roi_id, date, hour } of hoursWithData) {
        const hourInt = parseInt(hour);
        const hourStart = new Date(`${date}T${hour.padStart(2, '0')}:00:00`).getTime();
        const hourEnd = hourStart + 60 * 60 * 1000;
        
        // Get visit stats for this hour
        const visitStats = this.db.prepare(`
          SELECT 
            COUNT(DISTINCT track_key) as visits,
            SUM(duration_ms) as time_spent_ms,
            SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END) as dwells,
            SUM(CASE WHEN is_engagement = 1 THEN 1 ELSE 0 END) as engagements
          FROM zone_visits
          WHERE roi_id = ? AND start_time >= ? AND start_time < ?
        `).get(roi_id, hourStart, hourEnd);
        
        // Get occupancy stats for this hour
        const occStats = this.db.prepare(`
          SELECT 
            MAX(occupancy_count) as peak,
            AVG(occupancy_count) as avg
          FROM zone_occupancy
          WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
        `).get(roi_id, hourStart, hourEnd);
        
        // Get queue waiting time stats
        const queueStats = this.db.prepare(`
          SELECT AVG(waiting_time_ms) as avg_wait
          FROM queue_sessions
          WHERE queue_zone_id = ? AND queue_entry_time >= ? AND queue_entry_time < ?
        `).get(roi_id, hourStart, hourEnd);
        
        upsertHourly.run(
          venue_id,
          roi_id,
          date,
          hourInt,
          visitStats?.visits || 0,
          visitStats?.time_spent_ms || 0,
          visitStats?.dwells || 0,
          visitStats?.engagements || 0,
          occStats?.peak || 0,
          occStats?.avg || 0,
          queueStats?.avg_wait || 0
        );
        aggregatedCount++;
      }
      
      if (aggregatedCount > 0) {
        console.log(`📊 Aggregated ${aggregatedCount} hourly KPI records`);
      }
    } catch (err) {
      console.error('Failed to aggregate hourly data:', err);
    }
  }

  /**
   * Update daily KPI aggregates
   */
  updateDailyAggregates() {
    const today = new Date().toISOString().split('T')[0];
    const startOfDay = new Date(today).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
    
    // Get all ROIs with visits today
    const roisWithVisits = this.db.prepare(`
      SELECT DISTINCT venue_id, roi_id FROM zone_visits
      WHERE start_time >= ? AND start_time < ?
    `).all(startOfDay, endOfDay);
    
    const upsertStmt = this.db.prepare(`
      INSERT INTO zone_kpi_daily (venue_id, roi_id, date, visits, time_spent_ms, dwells_cumulative, dwells_unique, engagements_cumulative, engagements_unique, peak_occupancy, total_occupancy_samples, sum_occupancy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(venue_id, roi_id, date) DO UPDATE SET
        visits = excluded.visits,
        time_spent_ms = excluded.time_spent_ms,
        dwells_cumulative = excluded.dwells_cumulative,
        dwells_unique = excluded.dwells_unique,
        engagements_cumulative = excluded.engagements_cumulative,
        engagements_unique = excluded.engagements_unique,
        peak_occupancy = excluded.peak_occupancy,
        total_occupancy_samples = excluded.total_occupancy_samples,
        sum_occupancy = excluded.sum_occupancy,
        updated_at = datetime('now')
    `);
    
    for (const { venue_id, roi_id } of roisWithVisits) {
      const stats = this.db.prepare(`
        SELECT 
          COUNT(DISTINCT track_key) as visits,
          SUM(duration_ms) as time_spent_ms,
          SUM(CASE WHEN is_dwell = 1 THEN 1 ELSE 0 END) as dwells_cumulative,
          COUNT(DISTINCT CASE WHEN is_dwell = 1 THEN track_key END) as dwells_unique,
          SUM(CASE WHEN is_engagement = 1 THEN 1 ELSE 0 END) as engagements_cumulative,
          COUNT(DISTINCT CASE WHEN is_engagement = 1 THEN track_key END) as engagements_unique
        FROM zone_visits
        WHERE roi_id = ? AND start_time >= ? AND start_time < ?
      `).get(roi_id, startOfDay, endOfDay);
      
      // Get peak occupancy
      const occupancy = this.db.prepare(`
        SELECT MAX(occupancy_count) as peak, COUNT(*) as samples, SUM(occupancy_count) as total
        FROM zone_occupancy
        WHERE roi_id = ? AND timestamp >= ? AND timestamp < ?
      `).get(roi_id, startOfDay, endOfDay);
      
      upsertStmt.run(
        venue_id,
        roi_id,
        today,
        stats.visits || 0,
        stats.time_spent_ms || 0,
        stats.dwells_cumulative || 0,
        stats.dwells_unique || 0,
        stats.engagements_cumulative || 0,
        stats.engagements_unique || 0,
        occupancy?.peak || 0,
        occupancy?.samples || 0,
        occupancy?.total || 0
      );
    }
  }

  /**
   * Record occupancy snapshot for ROIs and evaluate alert rules
   */
  recordOccupancy(venueId, rois, tracks) {
    const now = Date.now();
    
    const insertStmt = this.db.prepare(`
      INSERT INTO zone_occupancy (venue_id, roi_id, timestamp, occupancy_count)
      VALUES (?, ?, ?, ?)
    `);
    
    for (const roi of rois) {
      let count = 0;
      for (const track of tracks.values()) {
        if (this.isPointInPolygon(track.venuePosition, roi.vertices)) {
          count++;
        }
      }
      
      insertStmt.run(venueId, roi.id, now, count);
      
      // Evaluate alert rules for this ROI
      this.evaluateAlertRules(venueId, roi.id, roi.name, { occupancy: count });
    }
  }

  /**
   * Evaluate alert rules for a zone and log to activity ledger if triggered
   */
  evaluateAlertRules(venueId, roiId, roiName, metrics) {
    try {
      // Get zone settings to check if alerts are enabled
      const settings = this.db.prepare(`
        SELECT alerts_enabled FROM zone_settings WHERE roi_id = ?
      `).get(roiId);
      
      if (!settings || !settings.alerts_enabled) return;
      
      // Get enabled rules for this zone
      const rules = this.db.prepare(`
        SELECT * FROM zone_alert_rules WHERE roi_id = ? AND enabled = 1
      `).all(roiId);
      
      for (const rule of rules) {
        const metricValue = metrics[rule.metric];
        if (metricValue === undefined) continue;
        
        const triggered = this.evaluateCondition(metricValue, rule.operator, rule.threshold_value);
        
        if (triggered) {
          // Check cooldown - don't trigger same rule+threshold within 5 minutes
          // If threshold changed, allow new alert immediately
          const recentAlert = this.db.prepare(`
            SELECT id FROM activity_ledger 
            WHERE rule_id = ? AND threshold_value = ? AND timestamp > ?
          `).get(rule.id, rule.threshold_value, Date.now() - 5 * 60 * 1000);
          
          if (!recentAlert) {
            this.logAlertToLedger(venueId, roiId, rule, metricValue);
          }
        }
      }
    } catch (err) {
      console.error('Failed to evaluate alert rules:', err);
    }
  }

  /**
   * Evaluate a condition based on operator
   */
  evaluateCondition(value, operator, threshold) {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  /**
   * Log an alert to the activity ledger
   */
  logAlertToLedger(venueId, roiId, rule, metricValue) {
    try {
      const message = rule.message_template || 
        `${rule.metric} reached ${metricValue} (threshold: ${rule.threshold_value})`;
      
      this.db.prepare(`
        INSERT INTO activity_ledger (venue_id, roi_id, rule_id, event_type, severity, title, message, metric_name, metric_value, threshold_value, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        venueId,
        roiId,
        rule.id,
        'rule_triggered',
        rule.severity,
        rule.rule_name,
        message,
        rule.metric,
        metricValue,
        rule.threshold_value,
        Date.now()
      );
      
      console.log(`🔔 Alert triggered: ${rule.rule_name} - ${message}`);
      
      // Emit event for real-time notification
      this.emit('alert_triggered', {
        venueId,
        roiId,
        rule,
        metricValue,
        message,
      });
    } catch (err) {
      console.error('Failed to log alert to ledger:', err);
    }
  }

  /**
   * Force end all active sessions (e.g., when track disappears)
   */
  endTrackSessions(trackKey) {
    for (const [sessionKey, session] of this.visitSessions.entries()) {
      if (sessionKey.startsWith(trackKey + ':')) {
        this.finalizeVisit(session);
        this.visitSessions.delete(sessionKey);
      }
    }
  }
}

export default TrajectoryStorageService;
