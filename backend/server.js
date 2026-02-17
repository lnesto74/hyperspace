import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { initDatabase } from './database/schema.js';
import { TailscaleService } from './services/TailscaleService.js';
import { LidarConnectionManager } from './services/LidarConnectionManager.js';
import { TrackAggregator } from './services/TrackAggregator.js';
import { MockLidarGenerator } from './services/MockLidarGenerator.js';
import MqttTrajectoryService from './services/MqttTrajectoryService.js';
import { TrajectoryStorageService } from './services/TrajectoryStorageService.js';
import { KPICalculator } from './services/KPICalculator.js';

import discoveryRoutes from './routes/discovery.js';
import venuesRoutes from './routes/venues.js';
import lidarsRoutes from './routes/lidars.js';
import modelsRoutes from './routes/models.js';
import createRoiRoutes from './routes/roi.js';
import createKpiRoutes from './routes/kpi.js';
import createZoneSettingsRoutes from './routes/zoneSettings.js';
import createWhiteLabelRoutes from './routes/whiteLabel.js';
import createSmartKpiRoutes from './routes/smartKpi.js';
import createPlanogramRoutes from './routes/planogram.js';
import createDwgImportRoutes from './routes/dwgImport.js';
import lidarPlannerRoutes from './routes/lidarPlanner.js';
import edgeCommissioningRoutes, { setupPointCloudWebSocket } from './routes/edgeCommissioning.js';
import doohRoutes from './routes/dooh.js';
import doohAttributionRoutes from './routes/doohAttribution.js';
import createBusinessReportingRoutes from './routes/businessReporting.js';
import narratorRoutes from './routes/narrator.js';
import narrator2Routes from './routes/narrator2Routes.js';

const PORT = process.env.PORT || 3001;
const MOCK_LIDAR = process.env.MOCK_LIDAR === 'true';
const MQTT_ENABLED = process.env.MQTT_ENABLED === 'true'; // Disabled by default, enable with MQTT_ENABLED=true

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from uploads directory (for DOOH videos)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Initialize HTTP server and Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Initialize database
const db = initDatabase();

// Initialize services
const tailscaleService = new TailscaleService();
const lidarConnectionManager = new LidarConnectionManager();
const trackAggregator = new TrackAggregator();

// Initialize trajectory storage and KPI services
const trajectoryStorage = new TrajectoryStorageService(db);
const kpiCalculator = new KPICalculator(db);
trajectoryStorage.start();
console.log('📊 KPI tracking services initialized');

// Pre-load zone links and open lanes for all venues at startup
const venues = db.prepare('SELECT DISTINCT id FROM venues').all();
venues.forEach(v => {
  trajectoryStorage.loadZoneLinks(v.id);
  trajectoryStorage.loadOpenLanes(v.id);
});
console.log(`📊 Pre-loaded zone links and open lanes for ${venues.length} venues`);

// Mock generator for testing
let mockGenerator = null;
if (MOCK_LIDAR) {
  mockGenerator = new MockLidarGenerator();
  console.log('🔧 Mock LiDAR mode enabled');
}

// MQTT trajectory service for receiving trajectories from edge devices
let mqttService = null;
if (MQTT_ENABLED) {
  mqttService = new MqttTrajectoryService(io);
  mqttService.setTrackAggregator(trackAggregator);
  mqttService.connect();
  console.log('📡 MQTT trajectory service enabled');
}

// Wire up services
lidarConnectionManager.on('track', (track) => {
  trackAggregator.addTrack(track);
});

lidarConnectionManager.on('status', (status) => {
  io.of('/tracking').emit('lidar_status', status);
});

if (mockGenerator) {
  mockGenerator.on('track', (track) => {
    trackAggregator.addTrack(track);
  });
}

// Track last occupancy recording time per venue
const lastOccupancyRecordTime = new Map();
// Cache ROIs to avoid DB query on every track update
const roiCache = new Map();
const ROI_CACHE_TTL_MS = 5000; // Refresh ROI cache every 5 seconds

function getCachedRois(venueId) {
  const cached = roiCache.get(venueId);
  const now = Date.now();
  if (cached && now - cached.timestamp < ROI_CACHE_TTL_MS) {
    return cached.rois;
  }
  const rois = db.prepare(`SELECT id, name, vertices, color FROM regions_of_interest WHERE venue_id = ?`).all(venueId);
  const parsedRois = rois.map(r => ({ ...r, vertices: JSON.parse(r.vertices) }));
  roiCache.set(venueId, { rois: parsedRois, timestamp: now });
  return parsedRois;
}

trackAggregator.on('tracks', (data) => {
  // CRITICAL: Emit tracks FIRST, don't block with KPI recording
  io.of('/tracking').to(`venue:${data.venueId}`).emit('tracks', data);
  
  // Record KPI data asynchronously using setImmediate to not block track emission
  setImmediate(() => {
    const parsedRois = getCachedRois(data.venueId);
    
    // Debug: log ROI count and queue zone check once
    if (!global._roiDebugLogged) {
      const queueZones = parsedRois.filter(r => r.name?.includes('Queue'));
      console.log(`📊 DEBUG: Loaded ${parsedRois.length} ROIs, ${queueZones.length} queue zones`);
      if (queueZones.length > 0) {
        console.log(`📊 DEBUG: Queue zone example: ${queueZones[0].name} at ${JSON.stringify(queueZones[0].vertices[0])}`);
      }
      global._roiDebugLogged = true;
    }
    
    for (const track of data.tracks) {
      trajectoryStorage.recordTrackPosition(data.venueId, track, parsedRois);
    }
    
    // Record occupancy snapshot every 2 seconds
    const now = Date.now();
    const lastRecord = lastOccupancyRecordTime.get(data.venueId) || 0;
    if (now - lastRecord >= 2000) {
      lastOccupancyRecordTime.set(data.venueId, now);
      const tracksMap = new Map(data.tracks.map(t => [t.trackKey, t]));
      trajectoryStorage.recordOccupancy(data.venueId, parsedRois, tracksMap);
    }
  });
});

trackAggregator.on('track_removed', (data) => {
  io.of('/tracking').emit('track_removed', data);
  
  // End any active sessions for this track
  trajectoryStorage.endTrackSessions(data.trackKey);
});

// Socket.IO tracking namespace
const trackingNamespace = io.of('/tracking');

trackingNamespace.on('connection', (socket) => {
  console.log(`📡 Tracking client connected: ${socket.id}`);

  socket.on('subscribe', ({ venueId }) => {
    socket.join(`venue:${venueId}`);
    console.log(`📺 Client ${socket.id} subscribed to venue ${venueId}`);
    
    // Load queue→service zone links for queue theory tracking
    trajectoryStorage.loadZoneLinks(venueId);
    
    // Load which lanes are open for queue tracking
    trajectoryStorage.loadOpenLanes(venueId);
    
    // Load ROIs for zone occupancy tracking
    const rois = db.prepare('SELECT id, name, vertices FROM regions_of_interest WHERE venue_id = ?').all(venueId);
    trackAggregator.setRois(rois);
    
    // Start track aggregator
    trackAggregator.start(venueId);
    
    // Start mock generator if enabled
    if (mockGenerator && !mockGenerator.isRunning()) {
      mockGenerator.start(venueId);
    }
  });

  socket.on('unsubscribe', ({ venueId }) => {
    socket.leave(`venue:${venueId}`);
    console.log(`📺 Client ${socket.id} unsubscribed from venue ${venueId}`);
  });

  socket.on('disconnect', () => {
    console.log(`📡 Tracking client disconnected: ${socket.id}`);
  });
});

// Serve static model files (for GLTF textures)
// Custom middleware to handle texture paths - fallback if textures/ subfolder doesn't exist
app.use('/api/models-static', (req, res, next) => {
  const requestedPath = path.join(__dirname, 'models', req.path);
  
  // If file exists at requested path, serve it
  if (fs.existsSync(requestedPath)) {
    return res.sendFile(requestedPath);
  }
  
  // Fallback: if path contains "textures/", try without it
  if (req.path.includes('/textures/')) {
    const fallbackPath = path.join(__dirname, 'models', req.path.replace('/textures/', '/'));
    if (fs.existsSync(fallbackPath)) {
      return res.sendFile(fallbackPath);
    }
  }
  
  next();
}, express.static(path.join(__dirname, 'models')));

// Mount routes
app.use('/api/discovery', discoveryRoutes(tailscaleService, mockGenerator));
app.use('/api/venues', venuesRoutes(db));
app.use('/api/lidars', lidarsRoutes(lidarConnectionManager, tailscaleService, mockGenerator));
app.use('/api/models', modelsRoutes(db));
app.use('/api', createRoiRoutes(db));
app.use('/api', createKpiRoutes(db, kpiCalculator, trajectoryStorage));
app.use('/api', createZoneSettingsRoutes(db, trajectoryStorage));
app.use('/api', createWhiteLabelRoutes(db));
app.use('/api/smart-kpi', createSmartKpiRoutes(db));
app.use('/api/planogram', createPlanogramRoutes(db));
app.use('/api/dwg', createDwgImportRoutes(db));

// LiDAR Planner routes (feature-flagged)
app.set('db', db); // Make db available to lidarPlanner routes
app.use('/api/lidar', lidarPlannerRoutes);

// Edge Commissioning Portal routes (NEW - separate from legacy LiDAR routes)
app.use('/api/edge-commissioning', edgeCommissioningRoutes);

// DOOH Analytics routes (feature-flagged: FEATURE_DOOH_KPIS=true)
app.use('/api/dooh', doohRoutes);

// PEBLE™ DOOH Attribution routes (feature-flagged: FEATURE_DOOH_ATTRIBUTION=true)
app.use('/api/dooh-attribution', doohAttributionRoutes);

// Business Reporting routes (feature-flagged: FEATURE_BUSINESS_REPORTING=true)
app.use('/api/reporting', createBusinessReportingRoutes(db, trajectoryStorage, trackAggregator));

// AI Narrator routes (additive layer - does not modify existing functionality)
app.use('/api/narrator', narratorRoutes);

// Narrator2 routes (ViewPack-based KPI storytelling - parallel subsystem)
app.use('/api/narrator2', narrator2Routes);

// Serve uploaded logos
app.use('/api/uploads/logos', express.static(path.join(__dirname, 'uploads', 'logos')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mockMode: MOCK_LIDAR,
    timestamp: new Date().toISOString(),
  });
});

// Edge Simulator Control (via Tailscale)
const EDGE_SERVER_URL = process.env.EDGE_SERVER_URL || 'http://100.78.174.103:8080';

app.get('/api/edge-simulator/status', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/status`, { timeout: 5000 });
    const data = await response.json();
    res.json({ connected: true, ...data });
  } catch (err) {
    res.json({ connected: false, isRunning: false, error: err.message });
  }
});

app.post('/api/edge-simulator/start', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/start`, { method: 'POST' });
    const data = await response.json();
    console.log('🎯 Edge simulator started:', data);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('❌ Failed to start edge simulator:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/edge-simulator/stop', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/stop`, { method: 'POST' });
    const data = await response.json();
    console.log('🛑 Edge simulator stopped:', data);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('❌ Failed to stop edge simulator:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/edge-simulator/config', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/config`);
    const data = await response.json();
    res.json({ connected: true, ...data });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.post('/api/edge-simulator/config', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log('⚙️ Edge simulator config updated:', req.body);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('❌ Failed to update edge config:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/edge-simulator/diagnostics', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/diagnostics`);
    const data = await response.json();
    res.json({ connected: true, ...data });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.get('/api/edge-simulator/debug/agents', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/debug/agents`);
    const data = await response.json();
    res.json({ connected: true, ...data });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

// Checkout Manager API proxies
// Use laneId from edge simulator directly for "Lane 1", "Lane 2" naming
app.get('/api/edge-simulator/checkout/status', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/checkout/status`);
    const data = await response.json();
    
    // Simply use laneId from edge simulator for naming
    if (data.lanes && Array.isArray(data.lanes)) {
      data.lanes = data.lanes.map((lane, index) => {
        const laneNum = lane.laneId ?? (index + 1);
        return {
          ...lane,
          laneId: laneNum,
          name: `Lane ${laneNum}`
        };
      });
    }
    
    res.json({ connected: true, ...data });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.post('/api/edge-simulator/checkout/set_lane_state', async (req, res) => {
  try {
    let { laneId, state, queueZoneId } = req.body;
    const venueId = '1f6c779c-5f09-445f-ae4b-1ce6abc20e9f';
    
    // Forward to edge server
    const response = await fetch(`${EDGE_SERVER_URL}/api/checkout/set_lane_state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log('🛒 Checkout lane state changed:', req.body);
    
    // Look up queueZoneId from database if not provided
    // laneId is 1-indexed (Lane 1, Lane 2), but lane_number in DB is 0-indexed
    if (!queueZoneId && laneId) {
      const laneNumber = laneId - 1; // Convert to 0-indexed
      const row = db.prepare('SELECT roi_id FROM zone_settings WHERE venue_id = ? AND lane_number = ?').get(venueId, laneNumber);
      if (row) {
        queueZoneId = row.roi_id;
        console.log(`📊 Resolved laneId ${laneId} to queueZoneId ${queueZoneId.substring(0, 8)}`);
      }
    }
    
    // Sync ALL lane states from edge simulator to ensure consistency
    try {
      const syncResponse = await fetch(`${EDGE_SERVER_URL}/api/checkout/status`);
      const syncData = await syncResponse.json();
      if (syncData.lanes && Array.isArray(syncData.lanes)) {
        for (const lane of syncData.lanes) {
          if (lane.laneId === null || lane.laneId === undefined) continue;
          const laneNum = lane.laneId - 1;
          const isOpenVal = (lane.status === 'OPEN' || lane.status === 'OPENING') ? 1 : 0;
          db.prepare('UPDATE zone_settings SET is_open = ? WHERE venue_id = ? AND lane_number = ?')
            .run(isOpenVal, venueId, laneNum);
        }
        trajectoryStorage.loadOpenLanes(venueId);
        console.log(`📊 Synced all ${syncData.lanes.length} lane states from edge simulator`);
      }
    } catch (syncErr) {
      console.error('⚠️ Failed to sync lane states:', syncErr.message);
    }
    
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('❌ Failed to set lane state:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sync ALL lane states from edge simulator to database
app.post('/api/edge-simulator/checkout/sync-lane-states', async (req, res) => {
  const venueId = '1f6c779c-5f09-445f-ae4b-1ce6abc20e9f';
  try {
    // Get lane statuses from edge simulator
    const response = await fetch(`${EDGE_SERVER_URL}/api/checkout/status`);
    const data = await response.json();
    
    if (!data.lanes || !Array.isArray(data.lanes)) {
      return res.status(400).json({ error: 'No lane data from edge simulator' });
    }
    
    // Update each lane's is_open state in database
    let synced = 0;
    for (const lane of data.lanes) {
      if (lane.laneId === null || lane.laneId === undefined) continue;
      
      const laneNumber = lane.laneId - 1; // Convert 1-indexed to 0-indexed
      const isOpen = (lane.status === 'OPEN' || lane.status === 'OPENING') ? 1 : 0;
      
      const result = db.prepare('UPDATE zone_settings SET is_open = ? WHERE venue_id = ? AND lane_number = ?')
        .run(isOpen, venueId, laneNumber);
      
      if (result.changes > 0) {
        synced++;
        console.log(`📊 Synced lane ${lane.laneId} (lane_number=${laneNumber}) to is_open=${isOpen}`);
      }
    }
    
    // Reload open lanes for queue tracking
    trajectoryStorage.loadOpenLanes(venueId);
    
    res.json({ success: true, synced, message: `Synced ${synced} lanes` });
  } catch (err) {
    console.error('❌ Failed to sync lane states:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/edge-simulator/checkout/thresholds', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/checkout/thresholds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log('⚙️ Checkout thresholds updated:', req.body);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('❌ Failed to update thresholds:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ========== LIVE CHECKOUT STATUS API ==========
// Get live checkout status from ROI occupancy data
// Uses queueZoneId (UUID) as single source of truth, sorted by X position for consistent Lane 1, 2, 3 numbering
app.get('/api/venues/:venueId/checkout/live-status', (req, res) => {
  const { venueId } = req.params;
  
  try {
    // Get all ROIs for this venue with vertices for sorting by position (synchronous better-sqlite3)
    const rois = db.prepare('SELECT id, name, vertices FROM regions_of_interest WHERE venue_id = ?').all(venueId);
    
    // Find Queue and Service ROI pairs
    const queueRois = rois.filter(r => r.name && r.name.includes('- Queue'));
    const serviceRois = rois.filter(r => r.name && r.name.includes('- Service'));
    
    // Calculate center X for each queue ROI for sorting
    const getCenter = (roi) => {
      try {
        const vertices = JSON.parse(roi.vertices || '[]');
        if (vertices.length === 0) return { x: 0, z: 0 };
        const sumX = vertices.reduce((s, v) => s + (v.x || 0), 0);
        const sumZ = vertices.reduce((s, v) => s + (v.z || 0), 0);
        return { x: sumX / vertices.length, z: sumZ / vertices.length };
      } catch (e) { return { x: 0, z: 0 }; }
    };
    
    // Sort queue ROIs by X position for consistent Lane 1, 2, 3 numbering
    const sortedQueueRois = queueRois.map(r => ({ ...r, center: getCenter(r) }))
      .sort((a, b) => a.center.x - b.center.x);
    
    // Build lane status from ROI pairs
    const lanes = [];
    let totalQueueCount = 0;
    
    sortedQueueRois.forEach((queueRoi, index) => {
      const prefix = queueRoi.name.replace('- Queue', '').trim();
      const serviceRoi = serviceRois.find(s => s.name.replace('- Service', '').trim() === prefix);
      
      // Get current occupancy for the queue ROI
      const queueCount = trackAggregator.getZoneOccupancy(queueRoi.id) || 0;
      const serviceOccupied = serviceRoi ? (trackAggregator.getZoneOccupancy(serviceRoi.id) || 0) > 0 : false;
      
      totalQueueCount += queueCount;
      
      const displayIndex = index + 1;
      lanes.push({
        laneId: displayIndex,           // For backward compatibility with UI
        queueZoneId: queueRoi.id,       // UUID - the single source of truth
        serviceZoneId: serviceRoi?.id,  // UUID
        displayIndex,
        displayName: `Lane ${displayIndex}`,
        name: prefix,
        desiredState: 'open', // In live mode, lanes are always "open" (no manual control)
        status: serviceOccupied ? 'OPEN' : 'CLOSED',
        queueCount: queueCount,
        cashierAgentId: null
      });
    });
    
    const openLaneCount = lanes.filter(l => l.status === 'OPEN').length;
    const closedLaneCount = lanes.filter(l => l.status === 'CLOSED').length;
    const avgQueuePerLane = openLaneCount > 0 ? totalQueueCount / openLaneCount : 0;
    const queuePressureThreshold = 5; // Default threshold
    
    const closedLane = lanes.find(l => l.status === 'CLOSED');
    
    res.json({
      lanes,
      pressure: {
        totalQueueCount,
        openLaneCount,
        closedLaneCount,
        avgQueuePerLane: Math.round(avgQueuePerLane * 10) / 10,
        pressureThreshold: queuePressureThreshold,
        shouldOpenMore: avgQueuePerLane > queuePressureThreshold && closedLaneCount > 0,
        suggestedLaneToOpen: closedLane?.displayIndex || null,
        suggestedQueueZoneId: closedLane?.queueZoneId || null
      },
      thresholds: {
        queuePressureThreshold,
        inflowRateThreshold: 10
      },
      source: 'live'
    });
  } catch (err) {
    console.error('❌ Failed to get live checkout status:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== SET LANE OPEN/CLOSED STATE ==========
// Toggle whether a lane is accepting queue sessions
app.post('/api/venues/:venueId/checkout/set-lane-state', (req, res) => {
  const { venueId } = req.params;
  const { queueZoneId, isOpen } = req.body;
  
  try {
    trajectoryStorage.setLaneOpen(venueId, queueZoneId, isOpen);
    res.json({ success: true, queueZoneId, isOpen });
  } catch (err) {
    console.error('❌ Failed to set lane state:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== LIVE ACTIVE QUEUE SESSIONS (DEBUG) ==========
// Returns people currently in queue zones with live dwell timer
app.get('/api/venues/:venueId/checkout/active-sessions', (req, res) => {
  const { venueId } = req.params;
  
  try {
    const activeSessions = trajectoryStorage.getActiveQueueSessions();
    
    // Get all queue zones sorted by name for consistent Lane 1, 2, 3 numbering
    const queueRois = db.prepare(`
      SELECT r.id, r.name, zs.is_open
      FROM regions_of_interest r
      LEFT JOIN zone_settings zs ON r.id = zs.roi_id AND zs.venue_id = r.venue_id
      WHERE r.venue_id = ?
      ORDER BY r.name
    `).all(venueId);
    
    // Map: roi_id -> "Lane X" (index-based)
    const laneInfo = new Map();
    queueRois.forEach((roi, index) => {
      laneInfo.set(roi.id, { name: `Lane ${index + 1}`, isOpen: roi.is_open === 1 });
    });
    
    // Add lane name and open status to each session
    const sessionsWithLane = activeSessions.map(s => {
      const info = laneInfo.get(s.queueZoneId);
      return {
        ...s,
        laneName: info?.name || `Lane ?`,
        isLaneOpen: info?.isOpen ?? true
      };
    });
    
    res.json({
      timestamp: Date.now(),
      timestampStr: new Date().toLocaleTimeString(),
      activeCount: sessionsWithLane.length,
      sessions: sessionsWithLane
    });
  } catch (err) {
    console.error('❌ Failed to get active sessions:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ========== REAL-TIME LANE KPI SNAPSHOT ==========
// Returns live lane KPIs from database - auto-refresh every 15 sec from frontend
app.get('/api/venues/:venueId/checkout/kpi-snapshot', (req, res) => {
  const { venueId } = req.params;
  const { period } = req.query; // 'hour', 'day', 'week'
  
  try {
    const now = Date.now();
    let startTs = now - 60 * 60 * 1000; // Default: last hour
    if (period === 'day') startTs = now - 24 * 60 * 60 * 1000;
    if (period === 'week') startTs = now - 7 * 24 * 60 * 60 * 1000;
    
    // Get all ROIs sorted by name for consistent Lane 1, 2, 3 numbering
    const queueRois = db.prepare(`
      SELECT id, name FROM regions_of_interest 
      WHERE venue_id = ?
      ORDER BY name
    `).all(venueId);
    
    // Map: queue_zone_id -> "Lane X" (index-based)
    const laneNameMap = new Map();
    queueRois.forEach((roi, index) => {
      laneNameMap.set(roi.id, `Lane ${index + 1}`);
    });
    
    // Get queue session stats
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as totalSessions,
        SUM(CASE WHEN is_abandoned = 0 THEN 1 ELSE 0 END) as completedSessions,
        SUM(CASE WHEN is_abandoned = 1 THEN 1 ELSE 0 END) as abandonedSessions,
        ROUND(AVG(waiting_time_ms) / 1000.0, 1) as avgWaitSec,
        ROUND(MAX(waiting_time_ms) / 1000.0, 1) as maxWaitSec,
        COUNT(DISTINCT queue_zone_id) as lanesUsed
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ?
    `).get(venueId, startTs);
    
    // Get per-lane breakdown (raw data, we'll add lane names in JS)
    const perLaneRaw = db.prepare(`
      SELECT 
        queue_zone_id,
        COUNT(*) as sessions,
        SUM(CASE WHEN is_abandoned = 0 THEN 1 ELSE 0 END) as completed,
        ROUND(AVG(waiting_time_ms) / 1000.0, 1) as avgWaitSec
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ?
      GROUP BY queue_zone_id
    `).all(venueId, startTs);
    
    // Apply lane names from ROI names
    const perLane = perLaneRaw.map(row => ({
      laneId: laneNameMap.get(row.queue_zone_id) || row.queue_zone_id.substring(0, 8),
      sessions: row.sessions,
      completed: row.completed,
      avgWaitSec: row.avgWaitSec
    })).sort((a, b) => a.laneId.localeCompare(b.laneId));
    
    // Get recent sessions (last 2 minutes)
    const recentSessionsRaw = db.prepare(`
      SELECT 
        track_key as personId,
        datetime(queue_entry_time/1000, 'unixepoch', 'localtime') as entryTime,
        datetime(queue_exit_time/1000, 'unixepoch', 'localtime') as exitTime,
        ROUND(waiting_time_ms / 1000.0, 1) as dwellSec,
        is_abandoned as abandoned,
        queue_zone_id
      FROM queue_sessions
      WHERE venue_id = ? AND queue_entry_time >= ?
      ORDER BY queue_entry_time DESC
      LIMIT 20
    `).all(venueId, now - 120000);
    
    // Apply lane names
    const recentSessions = recentSessionsRaw.map(row => ({
      personId: row.personId,
      entryTime: row.entryTime,
      exitTime: row.exitTime,
      dwellSec: row.dwellSec,
      abandoned: row.abandoned,
      laneId: laneNameMap.get(row.queue_zone_id) || row.queue_zone_id.substring(0, 8)
    }));
    
    // Calculate KPIs
    const abandonmentRate = stats.totalSessions > 0 
      ? Math.round((stats.abandonedSessions / stats.totalSessions) * 100) 
      : 0;
    const throughputPerHour = stats.completedSessions > 0
      ? Math.round(stats.completedSessions / ((now - startTs) / 3600000) * 10) / 10
      : 0;
    
    res.json({
      timestamp: new Date().toISOString(),
      period: period || 'hour',
      kpis: {
        totalSessions: stats.totalSessions || 0,
        completedSessions: stats.completedSessions || 0,
        abandonedSessions: stats.abandonedSessions || 0,
        abandonmentRate,
        avgWaitSec: stats.avgWaitSec || 0,
        maxWaitSec: stats.maxWaitSec || 0,
        throughputPerHour,
        lanesUsed: stats.lanesUsed || 0
      },
      perLane,
      recentSessions
    });
  } catch (err) {
    console.error('❌ Failed to get KPI snapshot:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Setup point cloud WebSocket proxy
setupPointCloudWebSocket(httpServer);

// Start server
httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   🚀 Hyperspace Backend Server                       ║
║                                                      ║
║   Port: ${PORT}                                        ║
║   Mock Mode: ${MOCK_LIDAR ? 'ENABLED' : 'DISABLED'}                               ║
║   MQTT: ${MQTT_ENABLED ? 'ENABLED' : 'DISABLED'}                                  ║
║                                                      ║
║   Endpoints:                                         ║
║   - GET  /api/health                                 ║
║   - GET  /api/discovery/scan                         ║
║   - GET  /api/discovery/status                       ║
║   - CRUD /api/venues                                 ║
║   - GET  /api/lidars                                 ║
║   - POST /api/lidars/:id/connect                     ║
║   - POST /api/lidars/:id/disconnect                  ║
║   - CRUD /api/models                                 ║
║                                                      ║
║   WebSocket: /tracking, /ws/pcl                      ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  tailscaleService.stopPolling();
  lidarConnectionManager.disconnectAll();
  if (mockGenerator) mockGenerator.stop();
  // if (mqttService) mqttService.disconnect();
  trackAggregator.stop();
  trajectoryStorage.stop();
  db.close();
  process.exit(0);
});
