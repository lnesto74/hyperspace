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
