/**
 * DOOH Analytics API Routes
 * 
 * All routes are behind FEATURE_DOOH_KPIS feature flag.
 * 
 * Endpoints:
 * - GET/POST/PUT/DELETE /api/dooh/screens
 * - POST /api/dooh/run
 * - GET /api/dooh/kpis
 * - GET /api/dooh/kpis/context
 * - GET /api/dooh/events
 */

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { DoohKpiEngine, DEFAULT_PARAMS } from '../services/dooh/DoohKpiEngine.js';
import { ContextResolver } from '../services/dooh/ContextResolver.js';
import { DoohKpiAggregator } from '../services/dooh/DoohKpiAggregator.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for video uploads
const VIDEOS_DIR = path.join(__dirname, '../../uploads/dooh-videos');
if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

const videoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, VIDEOS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  }
});

const videoUpload = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only MP4, WebM, OGG, and MOV are allowed.'));
    }
  }
});

const router = Router();

// Feature flag check middleware
const checkFeatureFlag = (req, res, next) => {
  if (process.env.FEATURE_DOOH_KPIS !== 'true') {
    return res.status(404).json({ error: 'DOOH KPI feature not enabled' });
  }
  next();
};

router.use(checkFeatureFlag);

// ============================================
// HELPER: Calculate viewing cone SEZ polygon
// ============================================

/**
 * Generate a viewing cone trapezoid polygon based on screen position and yaw.
 * yaw 0° = facing +Z, 90° = facing +X
 * 
 * @param {Object} position - { x, y, z }
 * @param {number} yawDeg - Yaw angle in degrees
 * @param {Object} options - Optional parameters
 * @returns {Array<{x: number, z: number}>} - Array of polygon vertices
 */
function calculateViewingConeSEZ(position, yawDeg = 0, params = {}) {
  // Use params from screen settings, with sensible defaults
  const nearDist = 0.5;  // Always start 0.5m in front of screen
  const farDist = params.sez_reach_m || 15;           // How far the cone extends
  const nearWidth = params.sez_near_width_m || 2.0;   // Width at near edge
  const farWidth = params.sez_far_width_m || 12.0;    // Width at far edge (cone spread)
  
  const yawRad = (yawDeg || 0) * Math.PI / 180;
  const px = position.x;
  const pz = position.z;
  
  // Direction vector (facing direction)
  const dirX = Math.sin(yawRad);
  const dirZ = Math.cos(yawRad);
  
  // Perpendicular vector (left/right)
  const perpX = Math.cos(yawRad);
  const perpZ = -Math.sin(yawRad);
  
  // Generate trapezoid points (near-left, near-right, far-right, far-left)
  return [
    { x: px + dirX * nearDist - perpX * nearWidth/2, z: pz + dirZ * nearDist - perpZ * nearWidth/2 },
    { x: px + dirX * nearDist + perpX * nearWidth/2, z: pz + dirZ * nearDist + perpZ * nearWidth/2 },
    { x: px + dirX * farDist + perpX * farWidth/2, z: pz + dirZ * farDist + perpZ * farWidth/2 },
    { x: px + dirX * farDist - perpX * farWidth/2, z: pz + dirZ * farDist - perpZ * farWidth/2 },
  ];
}

// ============================================
// SCREENS ENDPOINTS
// ============================================

/**
 * GET /api/dooh/screens - List screens for a venue
 */
router.get('/screens', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    const rows = db.prepare(`
      SELECT * FROM dooh_screens WHERE venue_id = ? ORDER BY name
    `).all(venueId);

    const screens = rows.map(row => {
      const params = JSON.parse(row.params_json);
      console.log('📤 Loading screen:', row.name, 'SEZ params:', { 
        sez_reach_m: params.sez_reach_m, 
        sez_near_width_m: params.sez_near_width_m, 
        sez_far_width_m: params.sez_far_width_m 
      });
      return {
        id: row.id,
        venueId: row.venue_id,
        objectId: row.object_id,
        name: row.name,
        position: JSON.parse(row.position_json),
        yawDeg: row.yaw_deg,
        mountHeightM: row.mount_height_m,
        sezPolygon: JSON.parse(row.sez_polygon_json),
        azPolygon: row.az_polygon_json ? JSON.parse(row.az_polygon_json) : null,
        params,
        doubleSided: row.double_sided === 1,
        enabled: row.enabled === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });

    res.json({ screens, count: screens.length });
  } catch (err) {
    console.error('❌ Failed to fetch DOOH screens:', err.message);
    res.status(500).json({ error: 'Failed to fetch screens', message: err.message });
  }
});

/**
 * GET /api/dooh/screens/:id - Get a single screen
 */
router.get('/screens/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;

    const row = db.prepare('SELECT * FROM dooh_screens WHERE id = ?').get(id);

    if (!row) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    const screen = {
      id: row.id,
      venueId: row.venue_id,
      objectId: row.object_id,
      name: row.name,
      position: JSON.parse(row.position_json),
      yawDeg: row.yaw_deg,
      mountHeightM: row.mount_height_m,
      sezPolygon: JSON.parse(row.sez_polygon_json),
      azPolygon: row.az_polygon_json ? JSON.parse(row.az_polygon_json) : null,
      params: JSON.parse(row.params_json),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    res.json(screen);
  } catch (err) {
    console.error('❌ Failed to fetch DOOH screen:', err.message);
    res.status(500).json({ error: 'Failed to fetch screen', message: err.message });
  }
});

/**
 * POST /api/dooh/screens - Create a new screen
 */
router.post('/screens', (req, res) => {
  try {
    const db = req.app.get('db');
    const {
      venueId,
      objectId,
      name,
      position,
      yawDeg = 0,
      mountHeightM = 2.5,
      sezPolygon,
      azPolygon = null,
      params = {},
      doubleSided = false,
      enabled = true,
    } = req.body;

    if (!venueId || !name || !position) {
      return res.status(400).json({ 
        error: 'venueId, name, and position are required' 
      });
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const mergedParams = { ...DEFAULT_PARAMS, ...params };

    // Auto-calculate SEZ if not provided, using the merged params for cone geometry
    const finalSezPolygon = sezPolygon || calculateViewingConeSEZ(position, yawDeg, mergedParams);

    db.prepare(`
      INSERT INTO dooh_screens (
        id, venue_id, object_id, name, position_json, yaw_deg, mount_height_m,
        sez_polygon_json, az_polygon_json, params_json, double_sided, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, venueId, objectId || null, name,
      JSON.stringify(position), yawDeg, mountHeightM,
      JSON.stringify(finalSezPolygon), azPolygon ? JSON.stringify(azPolygon) : null,
      JSON.stringify(mergedParams), doubleSided ? 1 : 0, enabled ? 1 : 0, now, now
    );

    res.status(201).json({
      success: true,
      screen: {
        id,
        venueId,
        objectId,
        name,
        position,
        yawDeg,
        mountHeightM,
        sezPolygon: finalSezPolygon,
        azPolygon,
        params: mergedParams,
        doubleSided,
        enabled,
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err) {
    console.error('❌ Failed to create DOOH screen:', err.message);
    res.status(500).json({ error: 'Failed to create screen', message: err.message });
  }
});

/**
 * PUT /api/dooh/screens/:id - Update a screen
 */
router.put('/screens/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;
    const {
      name,
      objectId,
      position,
      yawDeg,
      mountHeightM,
      sezPolygon,
      azPolygon,
      params,
      doubleSided,
      enabled,
    } = req.body;
    
    console.log('📥 PUT /screens/:id received:', { 
      id, 
      hasParams: params !== undefined,
      params: params,
      sezPolygonLength: sezPolygon?.length 
    });

    const existing = db.prepare('SELECT * FROM dooh_screens WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Screen not found' });
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (objectId !== undefined) {
      updates.push('object_id = ?');
      values.push(objectId);
    }
    if (position !== undefined) {
      updates.push('position_json = ?');
      values.push(JSON.stringify(position));
    }
    if (yawDeg !== undefined) {
      updates.push('yaw_deg = ?');
      values.push(yawDeg);
    }
    if (mountHeightM !== undefined) {
      updates.push('mount_height_m = ?');
      values.push(mountHeightM);
    }
    if (sezPolygon !== undefined) {
      updates.push('sez_polygon_json = ?');
      values.push(JSON.stringify(sezPolygon));
    }
    if (azPolygon !== undefined) {
      updates.push('az_polygon_json = ?');
      values.push(azPolygon ? JSON.stringify(azPolygon) : null);
    }
    if (params !== undefined) {
      const existingParams = JSON.parse(existing.params_json);
      const mergedParams = { ...existingParams, ...params };
      console.log('📝 Updating params:', { existingKeys: Object.keys(existingParams), newKeys: Object.keys(params), mergedKeys: Object.keys(mergedParams) });
      console.log('📝 SEZ params:', { sez_reach_m: mergedParams.sez_reach_m, sez_near_width_m: mergedParams.sez_near_width_m, sez_far_width_m: mergedParams.sez_far_width_m });
      updates.push('params_json = ?');
      values.push(JSON.stringify(mergedParams));
    }
    if (doubleSided !== undefined) {
      updates.push('double_sided = ?');
      values.push(doubleSided ? 1 : 0);
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(enabled ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    updates.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    db.prepare(`UPDATE dooh_screens SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true, id });
  } catch (err) {
    console.error('❌ Failed to update DOOH screen:', err.message);
    res.status(500).json({ error: 'Failed to update screen', message: err.message });
  }
});

/**
 * DELETE /api/dooh/screens/:id - Disable (soft delete) a screen
 */
router.delete('/screens/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;
    const { hard } = req.query;

    if (hard === 'true') {
      db.prepare('DELETE FROM dooh_screens WHERE id = ?').run(id);
    } else {
      db.prepare('UPDATE dooh_screens SET enabled = 0, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id);
    }

    res.json({ success: true, id });
  } catch (err) {
    console.error('❌ Failed to delete DOOH screen:', err.message);
    res.status(500).json({ error: 'Failed to delete screen', message: err.message });
  }
});

// ============================================
// RUN ENDPOINT
// ============================================

/**
 * POST /api/dooh/run - Compute exposure events for a time range
 */
router.post('/run', async (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, startTs, endTs, screenIds = null } = req.body;

    if (!venueId || !startTs || !endTs) {
      return res.status(400).json({ error: 'venueId, startTs, and endTs are required' });
    }

    const engine = new DoohKpiEngine(db);
    const contextResolver = new ContextResolver(db);
    const aggregator = new DoohKpiAggregator(db);

    // Run exposure detection
    const result = await engine.run(venueId, startTs, endTs, screenIds);

    // Resolve context for events
    const events = db.prepare(`
      SELECT * FROM dooh_exposure_events
      WHERE venue_id = ? AND start_ts >= ? AND start_ts <= ?
    `).all(venueId, startTs, endTs);

    for (const event of events) {
      // Get samples for context resolution
      const samples = db.prepare(`
        SELECT timestamp, x, z, speed FROM trajectory_samples
        WHERE venue_id = ? AND track_key = ? AND timestamp >= ? AND timestamp <= ?
      `).all(venueId, event.track_key, event.start_ts, event.end_ts);

      const eventWithSamples = { ...event, samples };
      const params = engine.getScreensForVenue(venueId)
        .find(s => s.id === event.screen_id)?.params || DEFAULT_PARAMS;

      const rois = contextResolver.loadRois(venueId);
      const context = contextResolver.resolveContext(eventWithSamples, rois, params);
      contextResolver.updateEventContext(event.id, context);
    }

    // Aggregate buckets
    const screens = engine.getScreensForVenue(venueId);
    const filteredScreens = screenIds 
      ? screens.filter(s => screenIds.includes(s.id))
      : screens;

    let totalBuckets = 0;
    for (const screen of filteredScreens) {
      const buckets = aggregator.aggregateForScreen(venueId, screen.id, startTs, endTs);
      totalBuckets += buckets.length;
    }

    res.json({
      success: true,
      screens: result.screens,
      tracks: result.tracks,
      events: result.events,
      buckets: totalBuckets,
    });
  } catch (err) {
    console.error('❌ Failed to run DOOH KPI computation:', err.message);
    res.status(500).json({ error: 'Failed to run computation', message: err.message });
  }
});

// ============================================
// KPIS ENDPOINTS
// ============================================

/**
 * GET /api/dooh/kpis - Get KPI buckets for a screen
 */
router.get('/kpis', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, screenId, startTs, endTs, bucketMinutes } = req.query;

    if (!screenId || !startTs || !endTs) {
      return res.status(400).json({ error: 'screenId, startTs, and endTs are required' });
    }

    const aggregator = new DoohKpiAggregator(db);
    const buckets = aggregator.getBuckets(
      screenId,
      parseInt(startTs),
      parseInt(endTs),
      bucketMinutes ? parseInt(bucketMinutes) : null
    );

    res.json({ buckets, count: buckets.length });
  } catch (err) {
    console.error('❌ Failed to fetch DOOH KPIs:', err.message);
    res.status(500).json({ error: 'Failed to fetch KPIs', message: err.message });
  }
});

/**
 * GET /api/dooh/kpis/context - Get KPIs grouped by context phase
 */
router.get('/kpis/context', (req, res) => {
  try {
    const db = req.app.get('db');
    const { screenId, startTs, endTs } = req.query;

    if (!screenId || !startTs || !endTs) {
      return res.status(400).json({ error: 'screenId, startTs, and endTs are required' });
    }

    const aggregator = new DoohKpiAggregator(db);
    const contextBreakdown = aggregator.getBucketsGroupedByContext(
      screenId,
      parseInt(startTs),
      parseInt(endTs)
    );

    res.json({ contextBreakdown });
  } catch (err) {
    console.error('❌ Failed to fetch DOOH KPIs by context:', err.message);
    res.status(500).json({ error: 'Failed to fetch KPIs', message: err.message });
  }
});

// ============================================
// EVENTS ENDPOINT
// ============================================

/**
 * GET /api/dooh/events - Get exposure events for debugging
 */
router.get('/events', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, screenId, startTs, endTs, tier, limit = 100 } = req.query;

    if (!screenId || !startTs || !endTs) {
      return res.status(400).json({ error: 'screenId, startTs, and endTs are required' });
    }

    let query = `
      SELECT * FROM dooh_exposure_events
      WHERE screen_id = ? AND start_ts >= ? AND start_ts <= ?
    `;
    const params = [screenId, parseInt(startTs), parseInt(endTs)];

    if (tier) {
      query += ' AND tier = ?';
      params.push(tier);
    }

    query += ` ORDER BY start_ts DESC LIMIT ?`;
    params.push(parseInt(limit));

    const rows = db.prepare(query).all(...params);

    const events = rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      screenId: row.screen_id,
      trackKey: row.track_key,
      startTs: row.start_ts,
      endTs: row.end_ts,
      durationS: row.duration_s,
      effectiveDwellS: row.effective_dwell_s,
      minDistanceM: row.min_distance_m,
      p10DistanceM: row.p10_distance_m,
      meanSpeedMps: row.mean_speed_mps,
      minSpeedMps: row.min_speed_mps,
      entrySpeedMps: row.entry_speed_mps,
      orientationScore: row.orientation_score,
      proximityScore: row.proximity_score,
      dwellScore: row.dwell_score,
      slowdownScore: row.slowdown_score,
      stabilityScore: row.stability_score,
      aqs: row.aqs,
      tier: row.tier,
      context: row.context_json ? JSON.parse(row.context_json) : null,
      createdAt: row.created_at,
    }));

    res.json({ events, count: events.length });
  } catch (err) {
    console.error('❌ Failed to fetch DOOH events:', err.message);
    res.status(500).json({ error: 'Failed to fetch events', message: err.message });
  }
});

/**
 * GET /api/dooh/params - Get default parameters schema
 */
router.get('/params', (req, res) => {
  res.json({ defaultParams: DEFAULT_PARAMS });
});

/**
 * GET /api/dooh/available-displays - Get digital display objects from venue that aren't yet configured as DOOH screens
 */
router.get('/available-displays', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    // Get all digital_display objects from venue_objects
    const allDisplays = db.prepare(`
      SELECT id, venue_id, type, name, position_x, position_y, position_z, rotation_y
      FROM venue_objects 
      WHERE venue_id = ? AND (type LIKE '%display%' OR type LIKE '%screen%' OR type = 'digital_display')
    `).all(venueId);

    // Get already configured screen object_ids
    const configuredIds = db.prepare(`
      SELECT object_id FROM dooh_screens WHERE venue_id = ? AND object_id IS NOT NULL
    `).all(venueId).map(r => r.object_id);

    // Filter to only unconfigured displays
    const availableDisplays = allDisplays
      .filter(d => !configuredIds.includes(d.id))
      .map(d => ({
        id: d.id,
        venueId: d.venue_id,
        type: d.type,
        name: d.name,
        position: { x: d.position_x, y: d.position_y, z: d.position_z },
        yawDeg: (d.rotation_y || 0) * (180 / Math.PI), // Convert radians to degrees
      }));

    res.json({ displays: availableDisplays, count: availableDisplays.length });
  } catch (err) {
    console.error('❌ Failed to fetch available displays:', err.message);
    res.status(500).json({ error: 'Failed to fetch displays', message: err.message });
  }
});

// ============================================
// PLAYLIST VIDEO ENDPOINTS
// ============================================

/**
 * GET /api/dooh/videos - List all videos for a venue
 */
router.get('/videos', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId } = req.query;

    if (!venueId) {
      return res.status(400).json({ error: 'venueId query parameter is required' });
    }

    const rows = db.prepare(`
      SELECT * FROM dooh_playlist_videos WHERE venue_id = ? ORDER BY created_at DESC
    `).all(venueId);

    const videos = rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      name: row.name,
      filename: row.filename,
      filePath: row.file_path,
      durationMs: row.duration_ms,
      fileSizeBytes: row.file_size_bytes,
      mimeType: row.mime_type,
      thumbnailPath: row.thumbnail_path,
      width: row.width,
      height: row.height,
      createdAt: row.created_at,
    }));

    res.json({ videos, count: videos.length });
  } catch (err) {
    console.error('❌ Failed to fetch DOOH videos:', err.message);
    res.status(500).json({ error: 'Failed to fetch videos', message: err.message });
  }
});

/**
 * POST /api/dooh/videos - Upload a new video
 */
router.post('/videos', videoUpload.single('video'), (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, name, durationMs } = req.body;

    if (!venueId || !req.file) {
      return res.status(400).json({ error: 'venueId and video file are required' });
    }

    const id = uuidv4();
    const filePath = `/uploads/dooh-videos/${req.file.filename}`;
    const videoName = name || path.parse(req.file.originalname).name;

    db.prepare(`
      INSERT INTO dooh_playlist_videos (
        id, venue_id, name, filename, file_path, duration_ms, file_size_bytes, mime_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, venueId, videoName, req.file.filename, filePath,
      parseInt(durationMs) || 0, req.file.size, req.file.mimetype
    );

    res.status(201).json({
      success: true,
      video: {
        id,
        venueId,
        name: videoName,
        filename: req.file.filename,
        filePath,
        durationMs: parseInt(durationMs) || 0,
        fileSizeBytes: req.file.size,
        mimeType: req.file.mimetype,
      },
    });
  } catch (err) {
    console.error('❌ Failed to upload DOOH video:', err.message);
    res.status(500).json({ error: 'Failed to upload video', message: err.message });
  }
});

/**
 * PUT /api/dooh/videos/:id - Update video metadata (name, duration)
 */
router.put('/videos/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;
    const { name, durationMs, width, height } = req.body;

    const existing = db.prepare('SELECT * FROM dooh_playlist_videos WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Video not found' });
    }

    const updates = [];
    const values = [];

    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (durationMs !== undefined) {
      updates.push('duration_ms = ?');
      values.push(parseInt(durationMs));
    }
    if (width !== undefined) {
      updates.push('width = ?');
      values.push(parseInt(width));
    }
    if (height !== undefined) {
      updates.push('height = ?');
      values.push(parseInt(height));
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    values.push(id);
    db.prepare(`UPDATE dooh_playlist_videos SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    res.json({ success: true, id });
  } catch (err) {
    console.error('❌ Failed to update DOOH video:', err.message);
    res.status(500).json({ error: 'Failed to update video', message: err.message });
  }
});

/**
 * DELETE /api/dooh/videos/:id - Delete a video
 */
router.delete('/videos/:id', (req, res) => {
  try {
    const db = req.app.get('db');
    const { id } = req.params;

    const video = db.prepare('SELECT * FROM dooh_playlist_videos WHERE id = ?').get(id);
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Delete file from disk
    const fullPath = path.join(VIDEOS_DIR, video.filename);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    // Delete from database (cascades to playlists)
    db.prepare('DELETE FROM dooh_playlist_videos WHERE id = ?').run(id);

    res.json({ success: true, id });
  } catch (err) {
    console.error('❌ Failed to delete DOOH video:', err.message);
    res.status(500).json({ error: 'Failed to delete video', message: err.message });
  }
});

// ============================================
// SCREEN PLAYLIST ENDPOINTS
// ============================================

/**
 * GET /api/dooh/screens/:screenId/playlist - Get playlist for a screen
 */
router.get('/screens/:screenId/playlist', (req, res) => {
  try {
    const db = req.app.get('db');
    const { screenId } = req.params;

    const rows = db.prepare(`
      SELECT sp.*, v.name as video_name, v.filename, v.file_path, v.duration_ms, v.mime_type
      FROM dooh_screen_playlist sp
      JOIN dooh_playlist_videos v ON sp.video_id = v.id
      WHERE sp.screen_id = ?
      ORDER BY sp.order_index ASC
    `).all(screenId);

    const playlist = rows.map(row => ({
      id: row.id,
      screenId: row.screen_id,
      videoId: row.video_id,
      orderIndex: row.order_index,
      enabled: row.enabled === 1,
      video: {
        id: row.video_id,
        name: row.video_name,
        filename: row.filename,
        filePath: row.file_path,
        durationMs: row.duration_ms,
        mimeType: row.mime_type,
      },
    }));

    res.json({ playlist, count: playlist.length });
  } catch (err) {
    console.error('❌ Failed to fetch screen playlist:', err.message);
    res.status(500).json({ error: 'Failed to fetch playlist', message: err.message });
  }
});

/**
 * POST /api/dooh/screens/:screenId/playlist - Add video to screen playlist
 */
router.post('/screens/:screenId/playlist', (req, res) => {
  try {
    const db = req.app.get('db');
    const { screenId } = req.params;
    const { videoId, orderIndex } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    // Get max order index if not provided
    let order = orderIndex;
    if (order === undefined) {
      const maxOrder = db.prepare(`
        SELECT MAX(order_index) as max_order FROM dooh_screen_playlist WHERE screen_id = ?
      `).get(screenId);
      order = (maxOrder?.max_order ?? -1) + 1;
    }

    const id = uuidv4();
    db.prepare(`
      INSERT INTO dooh_screen_playlist (id, screen_id, video_id, order_index, enabled)
      VALUES (?, ?, ?, ?, 1)
    `).run(id, screenId, videoId, order);

    res.status(201).json({ success: true, id, screenId, videoId, orderIndex: order });
  } catch (err) {
    console.error('❌ Failed to add video to playlist:', err.message);
    res.status(500).json({ error: 'Failed to add to playlist', message: err.message });
  }
});

/**
 * PUT /api/dooh/screens/:screenId/playlist - Update entire playlist order
 */
router.put('/screens/:screenId/playlist', (req, res) => {
  try {
    const db = req.app.get('db');
    const { screenId } = req.params;
    const { items } = req.body; // Array of { videoId, orderIndex, enabled }

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const updateStmt = db.prepare(`
      UPDATE dooh_screen_playlist SET order_index = ?, enabled = ? WHERE screen_id = ? AND video_id = ?
    `);

    const transaction = db.transaction(() => {
      for (const item of items) {
        updateStmt.run(item.orderIndex, item.enabled ? 1 : 0, screenId, item.videoId);
      }
    });
    transaction();

    res.json({ success: true, updated: items.length });
  } catch (err) {
    console.error('❌ Failed to update playlist order:', err.message);
    res.status(500).json({ error: 'Failed to update playlist', message: err.message });
  }
});

/**
 * DELETE /api/dooh/screens/:screenId/playlist/:videoId - Remove video from playlist
 */
router.delete('/screens/:screenId/playlist/:videoId', (req, res) => {
  try {
    const db = req.app.get('db');
    const { screenId, videoId } = req.params;

    db.prepare('DELETE FROM dooh_screen_playlist WHERE screen_id = ? AND video_id = ?')
      .run(screenId, videoId);

    res.json({ success: true, screenId, videoId });
  } catch (err) {
    console.error('❌ Failed to remove from playlist:', err.message);
    res.status(500).json({ error: 'Failed to remove from playlist', message: err.message });
  }
});

// ============================================
// PROOF OF PLAY ENDPOINTS
// ============================================

/**
 * POST /api/dooh/proof-of-play - Log a video play event
 */
router.post('/proof-of-play', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, screenId, videoId, startTs, endTs, loopIndex, playbackStatus, clientId } = req.body;

    if (!venueId || !screenId || !videoId || !startTs || !endTs) {
      return res.status(400).json({ 
        error: 'venueId, screenId, videoId, startTs, and endTs are required' 
      });
    }

    const durationMs = endTs - startTs;

    // Validate: minimum duration of 5 seconds to filter out invalid/duplicate events
    if (durationMs < 5000) {
      console.log(`⚠️ Proof of Play skipped: duration too short (${durationMs}ms)`);
      return res.status(200).json({ success: false, reason: 'duration_too_short', durationMs });
    }

    // Deduplication: check if a record with same screen, video, and startTs already exists
    const existing = db.prepare(`
      SELECT id FROM dooh_proof_of_play 
      WHERE screen_id = ? AND video_id = ? AND start_ts = ?
    `).get(screenId, videoId, startTs);

    if (existing) {
      console.log(`⚠️ Proof of Play skipped: duplicate entry`);
      return res.status(200).json({ success: false, reason: 'duplicate', existingId: existing.id });
    }

    const id = uuidv4();

    db.prepare(`
      INSERT INTO dooh_proof_of_play (
        id, venue_id, screen_id, video_id, start_ts, end_ts, duration_ms, 
        loop_index, playback_status, client_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, venueId, screenId, videoId, startTs, endTs, durationMs,
      loopIndex || 0, playbackStatus || 'completed', clientId || null
    );

    console.log(`📺 Proof of Play: screen=${screenId}, video=${videoId}, duration=${durationMs}ms`);

    res.status(201).json({ success: true, id, durationMs });
  } catch (err) {
    console.error('❌ Failed to log proof of play:', err.message);
    res.status(500).json({ error: 'Failed to log proof of play', message: err.message });
  }
});

/**
 * GET /api/dooh/proof-of-play - Get proof of play records
 */
router.get('/proof-of-play', (req, res) => {
  try {
    const db = req.app.get('db');
    const { venueId, screenId, videoId, startTs, endTs, limit = 100 } = req.query;

    if (!screenId) {
      return res.status(400).json({ error: 'screenId is required' });
    }

    let query = 'SELECT * FROM dooh_proof_of_play WHERE screen_id = ?';
    const params = [screenId];

    if (startTs) {
      query += ' AND start_ts >= ?';
      params.push(parseInt(startTs));
    }
    if (endTs) {
      query += ' AND end_ts <= ?';
      params.push(parseInt(endTs));
    }
    if (videoId) {
      query += ' AND video_id = ?';
      params.push(videoId);
    }

    query += ' ORDER BY start_ts DESC LIMIT ?';
    params.push(parseInt(limit));

    const rows = db.prepare(query).all(...params);

    const records = rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      screenId: row.screen_id,
      videoId: row.video_id,
      startTs: row.start_ts,
      endTs: row.end_ts,
      durationMs: row.duration_ms,
      loopIndex: row.loop_index,
      playbackStatus: row.playback_status,
      clientId: row.client_id,
      createdAt: row.created_at,
    }));

    res.json({ records, count: records.length });
  } catch (err) {
    console.error('❌ Failed to fetch proof of play:', err.message);
    res.status(500).json({ error: 'Failed to fetch proof of play', message: err.message });
  }
});

// ============================================
// PER-VIDEO KPI ENDPOINTS
// ============================================

/**
 * GET /api/dooh/kpis/video - Get KPIs aggregated by video
 */
router.get('/kpis/video', (req, res) => {
  try {
    const db = req.app.get('db');
    const { screenId, startTs, endTs } = req.query;

    if (!screenId || !startTs || !endTs) {
      return res.status(400).json({ error: 'screenId, startTs, and endTs are required' });
    }

    // Join proof-of-play with exposure events to calculate per-video KPIs
    const videoKpis = db.prepare(`
      SELECT 
        pop.video_id,
        v.name as video_name,
        v.duration_ms as video_duration_ms,
        COUNT(DISTINCT pop.id) as play_count,
        COUNT(DISTINCT e.track_key) as total_impressions,
        COUNT(DISTINCT CASE WHEN e.tier IN ('qualified', 'premium') THEN e.track_key END) as qualified_impressions,
        AVG(e.effective_dwell_s) as avg_dwell_s,
        AVG(e.aqs) as avg_aqs,
        SUM(pop.duration_ms) as total_play_duration_ms
      FROM dooh_proof_of_play pop
      LEFT JOIN dooh_playlist_videos v ON pop.video_id = v.id
      LEFT JOIN dooh_exposure_events e ON 
        e.screen_id = pop.screen_id 
        AND e.start_ts >= pop.start_ts 
        AND e.start_ts <= pop.end_ts
      WHERE pop.screen_id = ? 
        AND pop.start_ts >= ? 
        AND pop.end_ts <= ?
      GROUP BY pop.video_id, v.name, v.duration_ms
      ORDER BY play_count DESC
    `).all(screenId, parseInt(startTs), parseInt(endTs));

    res.json({ 
      videoKpis: videoKpis.map(row => ({
        videoId: row.video_id,
        videoName: row.video_name,
        videoDurationMs: row.video_duration_ms,
        playCount: row.play_count,
        totalImpressions: row.total_impressions || 0,
        qualifiedImpressions: row.qualified_impressions || 0,
        avgDwellS: row.avg_dwell_s,
        avgAqs: row.avg_aqs,
        totalPlayDurationMs: row.total_play_duration_ms,
      })),
      count: videoKpis.length 
    });
  } catch (err) {
    console.error('❌ Failed to fetch video KPIs:', err.message);
    res.status(500).json({ error: 'Failed to fetch video KPIs', message: err.message });
  }
});

/**
 * Serve video files statically
 */
router.get('/videos/file/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(VIDEOS_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video not found' });
  }
  
  res.sendFile(filePath);
});

export default router;
