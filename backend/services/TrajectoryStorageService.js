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
    this.dataDir = path.join(__dirname, '../data/trajectories');
    this.flushInterval = null;
    this.syncInterval = null;
    this.isRunning = false;
    
    // Configuration
    this.BUFFER_FLUSH_MS = 5000;      // Flush buffer to JSON every 5 seconds
    this.DB_SYNC_MS = 60000;          // Sync JSON to DB every minute
    this.POSITION_SAMPLE_MS = 1000;   // Sample position every 1 second (not every frame)
    this.VISIT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes visit timeout
    this.DWELL_THRESHOLD_MS = 10 * 1000;    // 10 seconds for dwell (was 60s)
    this.ENGAGEMENT_THRESHOLD_MS = 30 * 1000; // 30 seconds for engagement (was 120s)
    this.VISIT_END_GRACE_MS = 3000;       // 3 seconds grace period before ending visit
    this.MIN_VISIT_DURATION_MS = 1000;    // Minimum 1 second to count as a visit
    
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

      -- Daily KPI aggregates (for fast querying)
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
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
        FOREIGN KEY (roi_id) REFERENCES regions_of_interest(id) ON DELETE CASCADE
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

      -- Create indexes for fast queries
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
    `);
    
    console.log('📊 Trajectory storage tables initialized');
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    // Start buffer flush interval
    this.flushInterval = setInterval(() => this.flushBuffer(), this.BUFFER_FLUSH_MS);
    
    // Start DB sync interval
    this.syncInterval = setInterval(() => this.syncToDatabase(), this.DB_SYNC_MS);
    
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
    
    // Final flush before stopping
    this.flushBuffer();
    this.syncToDatabase();
    
    console.log('📊 Trajectory storage service stopped');
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
    
    // Update visit sessions for each ROI
    for (const roi of currentRois) {
      this.updateVisitSession(venueId, track.trackKey, roi.id, positionData);
    }
    
    // Check for visit end in ROIs the track left
    this.checkVisitEnds(venueId, track.trackKey, currentRois);
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
      // Update existing session
      const session = this.visitSessions.get(sessionKey);
      session.lastSeen = now;
      session.positions.push(positionData);
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
   * Write a finalized visit to a pending file
   */
  writeVisitToFile(visit) {
    const filename = `visits_pending.json`;
    const filepath = path.join(this.dataDir, filename);
    
    try {
      let visits = [];
      if (fs.existsSync(filepath)) {
        const content = fs.readFileSync(filepath, 'utf-8');
        visits = JSON.parse(content);
      }
      visits.push(visit);
      fs.writeFileSync(filepath, JSON.stringify(visits, null, 2));
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
   * Sync visit JSON files to database
   */
  syncVisitFiles() {
    const filepath = path.join(this.dataDir, 'visits_pending.json');
    if (!fs.existsSync(filepath)) return;
    
    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const visits = JSON.parse(content);
      
      const insertStmt = this.db.prepare(`
        INSERT OR IGNORE INTO zone_visits (id, venue_id, roi_id, track_key, start_time, end_time, duration_ms, is_complete_track, is_dwell, is_engagement, entry_position_x, entry_position_z, exit_position_x, exit_position_z)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const insertMany = this.db.transaction((visits) => {
        for (const v of visits) {
          insertStmt.run(
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
        }
      });
      
      insertMany(visits);
      
      // Clear the file
      fs.unlinkSync(filepath);
    } catch (err) {
      console.error('Failed to sync visits to database:', err);
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
