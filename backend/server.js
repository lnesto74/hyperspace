import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

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

const PORT = process.env.PORT || 3001;
const MOCK_LIDAR = process.env.MOCK_LIDAR === 'true';
const MQTT_ENABLED = process.env.MQTT_ENABLED === 'true'; // Disabled by default, enable with MQTT_ENABLED=true

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json());

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

trackAggregator.on('tracks', (data) => {
  io.of('/tracking').to(`venue:${data.venueId}`).emit('tracks', data);
  
  // Record trajectories for KPI calculation
  const rois = db.prepare(`SELECT id, name, vertices, color FROM regions_of_interest WHERE venue_id = ?`).all(data.venueId);
  const parsedRois = rois.map(r => ({ ...r, vertices: JSON.parse(r.vertices) }));
  
  for (const track of data.tracks) {
    trajectoryStorage.recordTrackPosition(data.venueId, track, parsedRois);
  }
  
  // Record occupancy snapshot every 2 seconds (reliable interval tracking)
  const now = Date.now();
  const lastRecord = lastOccupancyRecordTime.get(data.venueId) || 0;
  if (now - lastRecord >= 2000) {
    lastOccupancyRecordTime.set(data.venueId, now);
    const tracksMap = new Map(data.tracks.map(t => [t.trackKey, t]));
    trajectoryStorage.recordOccupancy(data.venueId, parsedRois, tracksMap);
  }
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
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// ========== CHECKOUT MANAGER PROXY ENDPOINTS ==========

// Get checkout status for all lanes
app.get('/api/edge-sim/checkout/status', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/sim/control/checkout/status`);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Set lane state (open/close)
app.post('/api/edge-sim/checkout/set_lane_state', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/sim/control/checkout/set_lane_state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log('🎯 Checkout lane state change:', req.body, '->', data);
    res.json(data);
  } catch (err) {
    console.error('❌ Failed to set lane state:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Update queue pressure thresholds
app.post('/api/edge-sim/checkout/thresholds', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/sim/control/checkout/thresholds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log('⚙️ Checkout thresholds updated:', req.body);
    res.json(data);
  } catch (err) {
    console.error('❌ Failed to update thresholds:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Clear manual override for a lane
app.post('/api/edge-sim/checkout/clear_override', async (req, res) => {
  try {
    const response = await fetch(`${EDGE_SERVER_URL}/api/sim/control/checkout/clear_override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ========== END CHECKOUT MANAGER PROXY ==========

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
║   WebSocket: /tracking                               ║
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
