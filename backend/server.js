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
import replayRoutes from './routes/replay.js';
import ReplayService from './services/ReplayService.js';
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
import algorithmProvidersRoutes from './routes/algorithmProviders.js';
import { seedProviders } from './data/algorithmProviders.js';
import createReplayInsightRoutes from './routes/replayInsight.js';
import { EpisodeDetectorOrchestrator } from './services/replay-insight/index.js';
import authRoutes from './routes/auth.js';
import companiesRoutes from './routes/companies.js';
import { IntentScorer, ZoneAggregator, BehaviorClusterer, ProfitRadarEngine } from './services/profit-radar/index.js';
import launchpadRoutes from './routes/launchpad.js';
import createAiClassifyRoutes from './routes/aiClassify.js';
import createAiSmartFilterRoutes from './routes/aiSmartFilter.js';
import createNeuralRoutes from './routes/neural.js';

const PORT = process.env.PORT || 3001;
const MOCK_LIDAR = process.env.MOCK_LIDAR === 'true';
const MQTT_ENABLED = process.env.MQTT_ENABLED === 'true'; // Disabled by default, enable with MQTT_ENABLED=true

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Memory monitor — log heap every 30s to identify OOM sources
setInterval(() => {
  const mem = process.memoryUsage();
  const heapMB = (mem.heapUsed / 1024 / 1024).toFixed(0);
  const rssMB = (mem.rss / 1024 / 1024).toFixed(0);
  if (mem.heapUsed > 500 * 1024 * 1024) { // Only log when >500MB
    console.warn(`🧠 MEMORY: heap=${heapMB}MB rss=${rssMB}MB`);
  }
}, 30000);

// Per-request memory tracking for heavy endpoints
app.use((req, res, next) => {
  const before = process.memoryUsage().heapUsed;
  res.on('finish', () => {
    const delta = process.memoryUsage().heapUsed - before;
    if (delta > 10 * 1024 * 1024) { // >10MB growth
      console.warn(`🧠 HEAVY REQUEST: ${req.method} ${req.originalUrl} +${(delta / 1024 / 1024).toFixed(1)}MB`);
    }
  });
  next();
});

// Serve static files from uploads directory (for DOOH videos)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '../uploads');
const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, 'models');
app.use('/uploads', express.static(UPLOADS_DIR));

// Initialize HTTP server and Socket.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 30000,  // 30s (default 20s) — tolerate event-loop stalls from SQLite without disconnecting
  pingInterval: 25000, // 25s heartbeat interval
});

// Initialize database
const _startupT0 = Date.now();
const db = initDatabase();
console.log(`⏱️ STARTUP: initDatabase ${Date.now() - _startupT0}ms`);

// Seed algorithm providers
const _startupT1 = Date.now();
seedProviders(db);
console.log(`⏱️ STARTUP: seedProviders ${Date.now() - _startupT1}ms`);

// Initialize services
const tailscaleService = new TailscaleService();
const lidarConnectionManager = new LidarConnectionManager();
const trackAggregator = new TrackAggregator();

// Initialize trajectory storage and KPI services
const trajectoryStorage = new TrajectoryStorageService(db);
const kpiCalculator = new KPICalculator(db);
const _startupT2 = Date.now();
trajectoryStorage.start();
console.log(`⏱️ STARTUP: trajectoryStorage.start ${Date.now() - _startupT2}ms`);
console.log('📊 KPI tracking services initialized');

// Initialize Profit Radar services (additive — no impact on existing functionality)
const intentScorer = new IntentScorer(trackAggregator);
const zoneAggregator = new ZoneAggregator(intentScorer);
const behaviorClusterer = new BehaviorClusterer(intentScorer);
const profitRadarEngine = new ProfitRadarEngine(zoneAggregator, behaviorClusterer);
console.log(`⏱️ STARTUP: profit radar init +${Date.now() - _startupT0}ms`);

// Pre-load zone links and open lanes for all venues at startup
const venues = db.prepare('SELECT DISTINCT id FROM venues').all();
venues.forEach(v => {
  trajectoryStorage.loadZoneLinks(v.id);
  trajectoryStorage.loadOpenLanes(v.id);
});
console.log(`⏱️ STARTUP: zone links preload +${Date.now() - _startupT0}ms (${venues.length} venues)`);

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

  // Load saved perceptionTransforms from venues.dwg_transform_json so live tracks are
  // remapped from the very first MQTT message (no UI interaction required).
  try {
    const rows = db.prepare(
      "SELECT id, dwg_transform_json FROM venues WHERE dwg_transform_json IS NOT NULL"
    ).all();
    const entries = [];
    const reconcilerEntries = [];
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.dwg_transform_json || '{}');
        if (parsed?.perceptionTransform) entries.push({ venueId: r.id, transform: parsed.perceptionTransform });
        if (parsed?.reconciler) reconcilerEntries.push({ venueId: r.id, config: parsed.reconciler });
      } catch { /* ignore malformed json */ }
    }
    if (entries.length) mqttService.loadVenueTransforms(entries);
    if (reconcilerEntries.length) mqttService.loadVenueReconcilerConfigs(reconcilerEntries);
  } catch (err) {
    console.warn('[MQTT] Failed to preload venue perception transforms:', err.message);
  }

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

let diagLastEmitTs = 0;
let diagEmitCount = 0;
const KPI_RECORD_INTERVAL_MS = 5000; // Only run heavy KPI recording every 5s
const lastKpiRecordTime = new Map();

trackAggregator.on('tracks', (data) => {
  const now = Date.now();
  diagEmitCount++;
  const gap = diagLastEmitTs ? now - diagLastEmitTs : 0;
  diagLastEmitTs = now;
  if (gap > 2000 || diagEmitCount % 600 === 0) {
    console.log(`[DIAG] emit tracks  n=${data.tracks.length}  gap=${gap}ms  emit#=${diagEmitCount}  t=${now}`);
  }

  // Socket emission is always immediate — never block this
  io.of('/tracking').to(`venue:${data.venueId}`).emit('tracks', data);
  
  // Throttle KPI recording: only process every 2s instead of every 50ms emission.
  // This reduces event loop load from ~20 heavy batches/s to ~0.5/s.
  const lastKpi = lastKpiRecordTime.get(data.venueId) || 0;
  if (now - lastKpi < KPI_RECORD_INTERVAL_MS) return;
  lastKpiRecordTime.set(data.venueId, now);

  setImmediate(() => {
    const _t0 = Date.now();
    const parsedRois = getCachedRois(data.venueId);
    
    for (const track of data.tracks) {
      trajectoryStorage.recordTrackPosition(data.venueId, track, parsedRois);
    }
    
    const kpiElapsed = Date.now() - _t0;
    if (kpiElapsed > 100) {
      console.warn(`[DIAG] KPI recording SLOW  ${kpiElapsed}ms  tracks=${data.tracks.length}  t=${Date.now()}`);
    }

    const now2 = Date.now();
    const lastRecord = lastOccupancyRecordTime.get(data.venueId) || 0;
    if (now2 - lastRecord >= 10000) {
      lastOccupancyRecordTime.set(data.venueId, now2);
      const tracksMap = new Map(data.tracks.map(t => [t.trackKey, t]));
      trajectoryStorage.recordOccupancy(data.venueId, parsedRois, tracksMap);
    }
    const _elapsed = Date.now() - _t0;
    if (_elapsed > 50) console.warn(`⏱️ KPI batch took ${_elapsed}ms (${data.tracks.length} tracks, ${parsedRois.length} ROIs)`);
  });
});

trackAggregator.on('track_removed', (data) => {
  io.of('/tracking').emit('track_removed', data);
  
  // End any active sessions for this track
  trajectoryStorage.endTrackSessions(data.trackKey);
});

trackAggregator.on('tracks_cleared', () => {
  io.of('/tracking').emit('tracks_cleared');
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
    
    // Start Profit Radar pipeline (additive)
    const profitRois = db.prepare('SELECT id, name, vertices, color FROM regions_of_interest WHERE venue_id = ?').all(venueId);
    zoneAggregator.setRois(profitRois);
    behaviorClusterer.setRois(profitRois);
    intentScorer.start();
    zoneAggregator.start();
    behaviorClusterer.start();
    profitRadarEngine.start();
    
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
  const requestedPath = path.join(MODELS_DIR, req.path);
  
  // If file exists at requested path, serve it
  if (fs.existsSync(requestedPath)) {
    return res.sendFile(requestedPath);
  }
  
  // Fallback: if path contains "textures/", try without it
  if (req.path.includes('/textures/')) {
    const fallbackPath = path.join(MODELS_DIR, req.path.replace('/textures/', '/'));
    if (fs.existsSync(fallbackPath)) {
      return res.sendFile(fallbackPath);
    }
  }
  
  next();
}, express.static(MODELS_DIR));

// Mount routes
app.use('/api/auth', authRoutes(db));
app.use('/api/companies', companiesRoutes(db));
app.use('/api/discovery', discoveryRoutes(tailscaleService, mockGenerator));
app.use('/api/venues', venuesRoutes(db, { mqttService, io }));
const replayService = new ReplayService({ mqttService });
app.use('/api/replay', replayRoutes({ replayService }));
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

// Algorithm Providers routes (HER Provider Registry + DEB→Docker Conversion Service)
app.use('/api/algorithm-providers', algorithmProvidersRoutes);

// LaunchPad Commissioning Wizard routes (separate DB — zero impact on core)
app.use('/api/launchpad', launchpadRoutes);

// AI Fixture Classification routes (GPT-4o Vision — optional, needs OPENAI_API_KEY)
app.use('/api/dwg', createAiClassifyRoutes(db));

// AI Smart Filter routes (GPT-4o Text — multi-language analysis + filtering)
app.use('/api/dwg', createAiSmartFilterRoutes(db));

// Neural Dashboard routes (funnel, transitions, alerts, media summary)
app.use('/api/neural', createNeuralRoutes(db));

// Replay Insight routes (parallel, read-only behavior episode system)
console.log(`⏱️ STARTUP: pre-routes +${Date.now() - _startupT0}ms`);
const replayInsightOrchestrator = new EpisodeDetectorOrchestrator();
replayInsightOrchestrator.start();
app.use('/api/replay-insights', createReplayInsightRoutes(replayInsightOrchestrator));
console.log(`⏱️ STARTUP: post-replay-insight +${Date.now() - _startupT0}ms`);

// Serve uploaded logos
app.use('/api/uploads/logos', express.static(path.join(UPLOADS_DIR, 'logos')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mockMode: MOCK_LIDAR,
    timestamp: new Date().toISOString(),
  });
});

// Edge Simulator Control (via Tailscale)
const DEFAULT_EDGE_SERVER_URL = process.env.EDGE_SERVER_URL || 'http://100.78.174.103:8080';
const EDGE_PORT = 8080;

// Helper: Get edge URL from request query param or use default
function getEdgeUrl(req) {
  const edgeIp = req.query.edgeIp || req.body?.edgeIp;
  if (edgeIp) {
    // Validate it looks like an IP
    if (/^[0-9.]+$/.test(edgeIp) || /^[0-9a-f:]+$/i.test(edgeIp)) {
      return `http://${edgeIp}:${EDGE_PORT}`;
    }
  }
  return DEFAULT_EDGE_SERVER_URL;
}

app.get('/api/edge-simulator/status', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    const response = await fetch(`${edgeUrl}/api/status`, { timeout: 5000 });
    const data = await response.json();
    res.json({ connected: true, edgeUrl, ...data });
  } catch (err) {
    res.json({ connected: false, isRunning: false, edgeUrl, error: err.message });
  }
});

app.post('/api/edge-simulator/start', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    const response = await fetch(`${edgeUrl}/api/start`, { method: 'POST' });
    const data = await response.json();
    console.log('🎯 Edge simulator started on', edgeUrl, ':', data);
    res.json({ success: true, edgeUrl, ...data });
  } catch (err) {
    console.error('❌ Failed to start edge simulator:', err.message);
    res.status(500).json({ success: false, edgeUrl, error: err.message });
  }
});

app.post('/api/edge-simulator/stop', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    const response = await fetch(`${edgeUrl}/api/stop`, { method: 'POST' });
    const data = await response.json();
    console.log('🛑 Edge simulator stopped on', edgeUrl, ':', data);
    // Immediately flush all tracks so clients clear visuals instantly
    trackAggregator.flushTracks();
    res.json({ success: true, edgeUrl, ...data });
  } catch (err) {
    console.error('❌ Failed to stop edge simulator:', err.message);
    res.status(500).json({ success: false, edgeUrl, error: err.message });
  }
});

app.get('/api/edge-simulator/config', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    const response = await fetch(`${edgeUrl}/api/config`);
    const data = await response.json();
    res.json({ connected: true, edgeUrl, ...data });
  } catch (err) {
    res.json({ connected: false, edgeUrl, error: err.message });
  }
});

app.post('/api/edge-simulator/config', async (req, res) => {
  try {
    // Always inject correct backendUrl and mqttBroker based on this server's Tailscale IP
    // This prevents stale Tailscale IPs from breaking the simulator
    const os = await import('os');
    const nets = os.networkInterfaces();
    let tailscaleIp = null;
    
    // Find Tailscale interface (utun* on macOS, tailscale* on Linux)
    for (const [name, addrs] of Object.entries(nets)) {
      if (name.startsWith('utun') || name.startsWith('tailscale')) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && addr.address.startsWith('100.')) {
            tailscaleIp = addr.address;
            break;
          }
        }
      }
      if (tailscaleIp) break;
    }
    
    // Fallback: search all interfaces for 100.x.x.x
    if (!tailscaleIp) {
      for (const addrs of Object.values(nets)) {
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && addr.address.startsWith('100.')) {
            tailscaleIp = addr.address;
            break;
          }
        }
        if (tailscaleIp) break;
      }
    }
    
    // Only inject backendUrl (so edge can reach this server)
    // NEVER override mqttBroker - edge devices have their own local MQTT broker
    // that bridges to production. Overriding would break the local broker setup.
    const configWithUrls = { ...req.body };
    
    if (tailscaleIp) {
      // Use Tailscale IP for backend connectivity
      configWithUrls.backendUrl = `http://${tailscaleIp}:${PORT}`;
    } else if (process.env.BACKEND_PUBLIC_URL) {
      // Production: use explicit public URL
      const publicHost = new URL(process.env.BACKEND_PUBLIC_URL).hostname;
      configWithUrls.backendUrl = `http://${publicHost}:${PORT}`;
    }
    // mqttBroker is NOT set here - edge server manages its own MQTT config
    
    const edgeUrl = getEdgeUrl(req);
    const response = await fetch(`${edgeUrl}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configWithUrls),
    });
    const data = await response.json();
    console.log('⚙️ Edge simulator config updated on', edgeUrl, ':', configWithUrls);
    res.json({ success: true, edgeUrl, ...data });
  } catch (err) {
    console.error('❌ Failed to update edge config:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/edge-simulator/diagnostics', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    const response = await fetch(`${edgeUrl}/api/diagnostics`);
    const data = await response.json();
    res.json({ connected: true, edgeUrl, ...data });
  } catch (err) {
    res.json({ connected: false, edgeUrl, error: err.message });
  }
});

app.get('/api/edge-simulator/debug/agents', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    const response = await fetch(`${edgeUrl}/api/debug/agents`);
    const data = await response.json();
    res.json({ connected: true, edgeUrl, ...data });
  } catch (err) {
    res.json({ connected: false, edgeUrl, error: err.message });
  }
});

// Checkout Manager API proxies
// Merges: lane status from edge simulator + queueCount from MQTT trajectories (source of truth)
app.get('/api/edge-simulator/checkout/status', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    const response = await fetch(`${edgeUrl}/api/checkout/status`);
    const data = await response.json();
    
    // Get trajectory-based queue counts (MQTT source of truth)
    const activeSessions = trajectoryStorage.getActiveQueueSessions();
    
    // Count people per queue zone from trajectories
    const trajectoryQueueCounts = new Map();
    const trajectoryQueuedPeople = new Map();
    for (const session of activeSessions) {
      const zoneId = session.queueZoneId;
      if (!trajectoryQueueCounts.has(zoneId)) {
        trajectoryQueueCounts.set(zoneId, 0);
        trajectoryQueuedPeople.set(zoneId, []);
      }
      trajectoryQueueCounts.set(zoneId, trajectoryQueueCounts.get(zoneId) + 1);
      trajectoryQueuedPeople.get(zoneId).push({
        personId: session.personId,
        waitTimeSec: session.currentDwellSec,
        entryTime: session.entryTime
      });
    }
    
    // Merge: lane status from simulator + queueCount from trajectories
    if (data.lanes && Array.isArray(data.lanes)) {
      data.lanes = data.lanes.map((lane, index) => {
        const laneNum = lane.laneId ?? (index + 1);
        const queueZoneId = lane.queueZoneId;
        
        // Use trajectory-based queue count (source of truth)
        const trajectoryCount = queueZoneId ? (trajectoryQueueCounts.get(queueZoneId) || 0) : 0;
        const queuedPeople = queueZoneId ? (trajectoryQueuedPeople.get(queueZoneId) || []) : [];
        
        return {
          ...lane,
          laneId: laneNum,
          name: `Lane ${laneNum}`,
          // Override with trajectory-based data (source of truth)
          queueCount: trajectoryCount,
          queuedPeople: queuedPeople
        };
      });
      
      // Recalculate pressure with trajectory-based counts
      const totalQueueCount = data.lanes.reduce((sum, l) => sum + l.queueCount, 0);
      const openLaneCount = data.lanes.filter(l => l.status === 'OPEN').length;
      if (data.pressure) {
        data.pressure.totalQueueCount = totalQueueCount;
        data.pressure.avgQueuePerLane = openLaneCount > 0 ? totalQueueCount / openLaneCount : 0;
      }
    }
    
    res.json({ connected: true, ...data });
  } catch (err) {
    res.json({ connected: false, error: err.message });
  }
});

app.post('/api/edge-simulator/checkout/set_lane_state', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    let { laneId, state, queueZoneId } = req.body;
    
    // Get venueId dynamically from edge server config
    let venueId;
    try {
      const cfgRes = await fetch(`${edgeUrl}/api/config`);
      const cfg = await cfgRes.json();
      venueId = cfg.venueId;
    } catch (e) {
      console.error('⚠️ Could not fetch edge config for venueId');
    }
    if (!venueId) {
      return res.status(400).json({ success: false, error: 'Could not determine venueId from edge server' });
    }
    
    // Forward to edge server
    const response = await fetch(`${edgeUrl}/api/checkout/set_lane_state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log('🛒 Checkout lane state changed:', req.body, 'venueId:', venueId);
    
    // Sync ALL lane states from edge simulator to ensure consistency
    // Uses queueZoneId (UUID) to match zone_settings rows (lane_number may be NULL)
    try {
      const syncResponse = await fetch(`${edgeUrl}/api/checkout/status`);
      const syncData = await syncResponse.json();
      if (syncData.lanes && Array.isArray(syncData.lanes)) {
        for (const lane of syncData.lanes) {
          const zoneId = lane.queueZoneId;
          if (!zoneId) continue;
          const isOpenVal = (lane.status === 'OPEN' || lane.status === 'OPENING') ? 1 : 0;
          // Update by queueZoneId (UUID) — the reliable identifier
          const result = db.prepare('UPDATE zone_settings SET is_open = ? WHERE roi_id = ? AND venue_id = ?')
            .run(isOpenVal, zoneId, venueId);
          if (result.changes === 0) {
            // No zone_settings row for this UUID — try matching by ROI name
            const roi = db.prepare('SELECT id, name FROM regions_of_interest WHERE id = ?').get(zoneId);
            if (roi) {
              const byName = db.prepare(`
                UPDATE zone_settings SET is_open = ? 
                WHERE venue_id = ? AND roi_id IN (
                  SELECT id FROM regions_of_interest WHERE venue_id = ? AND name = ?
                )
              `).run(isOpenVal, venueId, venueId, roi.name);
              if (byName.changes > 0) {
                console.log(`📊 Synced lane by name "${roi.name}" to is_open=${isOpenVal}`);
              }
            }
          }
        }
        trajectoryStorage.loadOpenLanes(venueId);
        trajectoryStorage.loadZoneLinks(venueId);
        console.log(`📊 Synced all ${syncData.lanes.length} lane states from edge simulator for venue ${venueId.substring(0,8)}`);
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
  const edgeUrl = getEdgeUrl(req);
  try {
    // Get venueId dynamically from edge server config
    let venueId;
    try {
      const cfgRes = await fetch(`${edgeUrl}/api/config`);
      const cfg = await cfgRes.json();
      venueId = cfg.venueId;
    } catch (e) {
      console.error('⚠️ Could not fetch edge config for venueId');
    }
    if (!venueId) {
      return res.status(400).json({ error: 'Could not determine venueId from edge server' });
    }
    
    // Get lane statuses from edge simulator
    const response = await fetch(`${edgeUrl}/api/checkout/status`);
    const data = await response.json();
    
    if (!data.lanes || !Array.isArray(data.lanes)) {
      return res.status(400).json({ error: 'No lane data from edge simulator' });
    }
    
    // Update each lane's is_open state in database using queueZoneId (UUID)
    let synced = 0;
    for (const lane of data.lanes) {
      const zoneId = lane.queueZoneId;
      if (!zoneId) continue;
      
      const isOpen = (lane.status === 'OPEN' || lane.status === 'OPENING') ? 1 : 0;
      
      const result = db.prepare('UPDATE zone_settings SET is_open = ? WHERE roi_id = ? AND venue_id = ?')
        .run(isOpen, zoneId, venueId);
      
      if (result.changes > 0) {
        synced++;
        console.log(`📊 Synced lane ${lane.displayName || lane.laneId} (${zoneId.substring(0,8)}) to is_open=${isOpen}`);
      }
    }
    
    // Reload open lanes for queue tracking
    trajectoryStorage.loadOpenLanes(venueId);
    
    res.json({ success: true, synced, venueId, message: `Synced ${synced} lanes for venue ${venueId.substring(0,8)}` });
  } catch (err) {
    console.error('❌ Failed to sync lane states:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/edge-simulator/checkout/thresholds', async (req, res) => {
  const edgeUrl = getEdgeUrl(req);
  try {
    const response = await fetch(`${edgeUrl}/api/checkout/thresholds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    console.log('⚙️ Checkout thresholds updated:', req.body);
    res.json({ success: true, edgeUrl, ...data });
  } catch (err) {
    console.error('❌ Failed to update thresholds:', err.message);
    res.status(500).json({ success: false, edgeUrl, error: err.message });
  }
});

// ========== TRACKING STATUS API ==========
// Get MQTT and tracking status for stream validation
app.get('/api/tracking/venue/:venueId/status', (req, res) => {
  const { venueId } = req.params;
  
  try {
    // Get MQTT service status
    const mqttStatus = mqttService ? mqttService.getStatus(venueId) : {
      connected: false,
      error: 'MQTT service not initialized',
    };
    
    res.json({
      success: true,
      venueId,
      mqtt: mqttStatus,
      // Summary fields for easy validation
      connected: mqttStatus.connected,
      lastTrackTs: mqttStatus.venueLastTrackTs || mqttStatus.lastMessageTs,
      tracksLast10s: mqttStatus.venueTracksLast10s || 0,
      totalTracksReceived: mqttStatus.venueTracksReceived || 0,
    });
  } catch (err) {
    console.error('❌ Failed to get tracking status:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Global MQTT status (all venues)
app.get('/api/tracking/status', (req, res) => {
  try {
    const mqttStatus = mqttService ? mqttService.getStatus() : {
      connected: false,
      error: 'MQTT service not initialized',
    };
    
    res.json({
      success: true,
      mqtt: mqttStatus,
    });
  } catch (err) {
    console.error('❌ Failed to get tracking status:', err.message);
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
    
    // Find Queue and Service ROI pairs, deduplicating by name
    // (Old stale ROIs may coexist with new ones after ROI recreation)
    const dedupeByName = (list) => {
      const byName = new Map();
      for (const r of list) byName.set(r.name, r); // last one wins (newest)
      return [...byName.values()];
    };
    const queueRois = dedupeByName(rois.filter(r => r.name && r.name.includes('- Queue')));
    const serviceRois = dedupeByName(rois.filter(r => r.name && r.name.includes('- Service')));
    
    // Build open/closed map from zone_settings, keyed by ROI NAME (not ID)
    // This handles the case where zone_settings has old ROI IDs but live-status uses new deduped IDs
    const zoneSettingsRows = db.prepare(`
      SELECT r.name, zs.is_open 
      FROM zone_settings zs 
      JOIN regions_of_interest r ON r.id = zs.roi_id 
      WHERE zs.venue_id = ?
    `).all(venueId);
    const openByName = new Map();
    for (const row of zoneSettingsRows) {
      openByName.set(row.name, row.is_open === 1);
    }
    
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
      
      // Look up open/closed state by ROI name (resilient to stale ROI IDs in zone_settings)
      const isOpen = openByName.has(queueRoi.name) ? openByName.get(queueRoi.name) : true;
      
      if (isOpen) totalQueueCount += queueCount;
      
      const displayIndex = index + 1;
      lanes.push({
        laneId: displayIndex,           // For backward compatibility with UI
        queueZoneId: queueRoi.id,       // UUID - the single source of truth
        serviceZoneId: serviceRoi?.id,  // UUID
        displayIndex,
        displayName: `Lane ${displayIndex}`,
        name: prefix,
        desiredState: isOpen ? 'open' : 'closed',
        status: isOpen ? 'OPEN' : 'CLOSED',
        queueCount: isOpen ? queueCount : 0,
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
    
    // Get queue zones with lane numbers from zone_settings
    const queueRois = db.prepare(`
      SELECT zs.roi_id, zs.lane_number, zs.is_open, r.name
      FROM zone_settings zs
      JOIN regions_of_interest r ON r.id = zs.roi_id
      WHERE zs.venue_id = ?
      ORDER BY zs.lane_number
    `).all(venueId);
    
    // Map: roi_id -> "Lane X" (using lane_number + 1 for 1-indexed display)
    const laneInfo = new Map();
    queueRois.forEach(row => {
      laneInfo.set(row.roi_id, { name: `Lane ${row.lane_number + 1}`, isOpen: row.is_open === 1 });
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

// ========== QUEUE TRACKING DEBUG ==========
// Returns diagnostic info about queue tracking state
app.get('/api/venues/:venueId/checkout/debug', (req, res) => {
  const { venueId } = req.params;
  
  try {
    // Force reload zone links and open lanes
    trajectoryStorage.loadZoneLinks(venueId);
    trajectoryStorage.loadOpenLanes(venueId);
    
    // Get zoneLinks Map contents
    const zoneLinks = [];
    for (const [queueId, serviceId] of trajectoryStorage.zoneLinks.entries()) {
      zoneLinks.push({ queueZoneId: queueId, serviceZoneId: serviceId });
    }
    
    // Get openLanes Set contents
    const openLanes = trajectoryStorage.openLanes ? Array.from(trajectoryStorage.openLanes) : [];
    
    // Get all ROIs for the venue
    const rois = db.prepare(`
      SELECT id, name, color FROM regions_of_interest WHERE venue_id = ?
    `).all(venueId);
    
    // Get zone_settings
    const zoneSettings = db.prepare(`
      SELECT roi_id, lane_number, is_open, linked_service_zone_id 
      FROM zone_settings WHERE venue_id = ?
    `).all(venueId);
    
    // Get active queue sessions
    const activeSessions = trajectoryStorage.getActiveQueueSessions();
    
    res.json({
      venueId,
      timestamp: new Date().toISOString(),
      zoneLinksCount: zoneLinks.length,
      zoneLinks,
      openLanesCount: openLanes.length,
      openLanes,
      roisCount: rois.length,
      rois: rois.map(r => ({ id: r.id.substring(0, 8), name: r.name, color: r.color })),
      zoneSettingsCount: zoneSettings.length,
      zoneSettings,
      activeSessionsCount: activeSessions.length,
      activeSessions
    });
  } catch (err) {
    console.error('❌ Queue debug failed:', err.message);
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
    
    // Get queue zones with lane numbers from zone_settings
    const queueRois = db.prepare(`
      SELECT zs.roi_id, zs.lane_number, r.name
      FROM zone_settings zs
      JOIN regions_of_interest r ON r.id = zs.roi_id
      WHERE zs.venue_id = ?
      ORDER BY zs.lane_number
    `).all(venueId);
    
    // Map: queue_zone_id -> "Lane X" (using lane_number + 1 for 1-indexed display)
    const laneNameMap = new Map();
    queueRois.forEach(row => {
      laneNameMap.set(row.roi_id, `Lane ${row.lane_number + 1}`);
    });
    
    // Get queue session stats - ONLY ≥5s dwell (sessions exist only if lane was open when recorded)
    const stats = db.prepare(`
      SELECT 
        COUNT(*) as totalSessions,
        SUM(CASE WHEN is_abandoned = 0 THEN 1 ELSE 0 END) as completedSessions,
        SUM(CASE WHEN is_abandoned = 1 THEN 1 ELSE 0 END) as abandonedSessions,
        ROUND(AVG(waiting_time_ms) / 1000.0, 1) as avgWaitSec,
        ROUND(MAX(waiting_time_ms) / 1000.0, 1) as maxWaitSec,
        COUNT(DISTINCT queue_zone_id) as lanesUsed
      FROM queue_sessions
      WHERE venue_id = ? 
        AND queue_entry_time >= ?
        AND waiting_time_ms >= 5000
    `).get(venueId, startTs);
    
    // Get per-lane breakdown - ONLY ≥5s dwell (sessions exist only if lane was open when recorded)
    const perLaneRaw = db.prepare(`
      SELECT 
        queue_zone_id,
        COUNT(*) as sessions,
        SUM(CASE WHEN is_abandoned = 0 THEN 1 ELSE 0 END) as completed,
        ROUND(AVG(waiting_time_ms) / 1000.0, 1) as avgWaitSec
      FROM queue_sessions
      WHERE venue_id = ? 
        AND queue_entry_time >= ?
        AND waiting_time_ms >= 5000
      GROUP BY queue_zone_id
    `).all(venueId, startTs);
    
    // Apply lane names from ROI names
    const perLane = perLaneRaw.map(row => ({
      laneId: laneNameMap.get(row.queue_zone_id) || row.queue_zone_id.substring(0, 8),
      sessions: row.sessions,
      completed: row.completed,
      avgWaitSec: row.avgWaitSec
    })).sort((a, b) => a.laneId.localeCompare(b.laneId));
    
    // Get recent sessions - ONLY ≥5s dwell (sessions exist only if lane was open when recorded)
    const recentSessionsRaw = db.prepare(`
      SELECT 
        track_key as personId,
        datetime(queue_entry_time/1000, 'unixepoch', 'localtime') as entryTime,
        datetime(queue_exit_time/1000, 'unixepoch', 'localtime') as exitTime,
        waiting_time_ms as waitMs,
        queue_zone_id as queueZoneId,
        is_abandoned as isAbandoned
      FROM queue_sessions
      WHERE venue_id = ? 
        AND queue_entry_time >= ?
        AND waiting_time_ms >= 5000
      ORDER BY queue_entry_time DESC
      LIMIT 50
    `).all(venueId, startTs);
    
    // Apply lane names
    const recentSessions = recentSessionsRaw.map(row => ({
      personId: row.personId,
      entryTime: row.entryTime,
      exitTime: row.exitTime,
      dwellSec: row.waitMs / 1000,
      abandoned: row.isAbandoned,
      laneId: laneNameMap.get(row.queueZoneId) || row.queueZoneId.substring(0, 8)
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

// --- Profit Radar socket events (additive, no impact on existing) ---
setInterval(() => {
  const venueId = trackAggregator.venueId;
  if (!venueId) return;
  const axes = intentScorer.getAxesArray();
  if (axes.length > 0) {
    io.of('/tracking').to(`venue:${venueId}`).emit('semantics:trackAxes', { venueId, tracks: axes, timestamp: Date.now() });
  }
}, 1000); // 1Hz

setInterval(() => {
  const venueId = trackAggregator.venueId;
  if (!venueId) return;
  const zoneField = zoneAggregator.getZoneFieldArray();
  const clusters = behaviorClusterer.getClusters();
  if (zoneField.length > 0 || clusters.length > 0) {
    io.of('/tracking').to(`venue:${venueId}`).emit('semantics:zoneField', { venueId, zones: zoneField, clusters, timestamp: Date.now() });
  }
}, 2000); // 0.5Hz

setInterval(() => {
  const venueId = trackAggregator.venueId;
  if (!venueId) return;
  const insights = profitRadarEngine.getInsights();
  if (insights.length > 0) {
    io.of('/tracking').to(`venue:${venueId}`).emit('profitRadar:insights', { venueId, insights, timestamp: Date.now() });
  }
}, 30000); // 30s

// Profit Radar REST endpoint (for initial load / polling fallback)
app.get('/api/profit-radar/insights', (req, res) => {
  res.json({ insights: profitRadarEngine.getInsights(), zones: zoneAggregator.getZoneFieldArray(), clusters: behaviorClusterer.getClusters() });
});

// Setup point cloud WebSocket proxy
setupPointCloudWebSocket(httpServer);

// ========== BACKGROUND DOOH EXPOSURE + ATTRIBUTION ==========
// Periodically generates exposure events and attribution analysis
// for venues with active campaigns and fresh tracking data.
if (process.env.FEATURE_DOOH_ATTRIBUTION === 'true') {
  const DOOH_BG_INTERVAL = 5 * 60 * 1000; // 5 minutes
  const DOOH_LOOKBACK_MS = 10 * 60 * 1000; // process last 10 min each cycle
  let _doohBgRunning = false;

  const runDoohBackground = async () => {
    if (_doohBgRunning) return;
    _doohBgRunning = true;
    const t0 = Date.now();
    try {
      const venues = db.prepare(`
        SELECT DISTINCT dc.venue_id
        FROM dooh_campaigns dc
        JOIN dooh_screens ds ON ds.venue_id = dc.venue_id AND ds.enabled = 1
        WHERE dc.enabled = 1
      `).all();

      const { DoohKpiEngine } = await import('./services/dooh/DoohKpiEngine.js');
      const { DoohAttributionEngine } = await import('./services/dooh_attribution/DoohAttributionEngine.js');

      for (const { venue_id } of venues) {
        const hasRecentTracks = db.prepare(
          `SELECT 1 FROM track_positions WHERE venue_id = ? AND timestamp > ? LIMIT 1`
        ).get(venue_id, t0 - DOOH_LOOKBACK_MS);
        if (!hasRecentTracks) continue;

        // Yield to event loop between venues
        await new Promise(r => setImmediate(r));

        const now = Date.now();
        const startTs = now - DOOH_LOOKBACK_MS;

        // 1. Exposure detection
        const kpiEngine = new DoohKpiEngine(db);
        const expResult = await kpiEngine.run(venue_id, startTs, now);
        if (expResult.events > 0) {
          console.log(`[DOOH-BG] ${venue_id.substring(0,8)}: ${expResult.events} new exposure events`);
        }

        // Yield again before attribution (heavy)
        await new Promise(r => setImmediate(r));

        // 2. Attribution analysis for each active campaign
        const attrEngine = new DoohAttributionEngine(db);
        const campaigns = db.prepare(
          'SELECT id FROM dooh_campaigns WHERE venue_id = ? AND enabled = 1'
        ).all(venue_id);

        for (const camp of campaigns) {
          try {
            await new Promise(r => setImmediate(r));
            const attrResult = await attrEngine.run(venue_id, camp.id, startTs, now);
            if (attrResult.attributionEvents > 0) {
              attrEngine.aggregateKPIs(venue_id, camp.id, startTs, now);
              console.log(`[DOOH-BG] Campaign ${camp.id.substring(0,8)}: ${attrResult.attributionEvents} attr events, ${attrResult.converted} conversions`);
            }
          } catch (e) {
            if (!e.message?.includes('No exposure events')) {
              console.warn(`[DOOH-BG] Attribution error for campaign ${camp.id.substring(0,8)}:`, e.message);
            }
          }
        }
      }
    } catch (e) {
      console.error('[DOOH-BG] Error:', e.message);
    } finally {
      _doohBgRunning = false;
      const elapsed = Date.now() - t0;
      if (elapsed > 5000) console.log(`[DOOH-BG] Cycle took ${(elapsed/1000).toFixed(1)}s`);
    }
  };

  // First run after 30s startup delay, then every 5 minutes
  setTimeout(runDoohBackground, 30000);
  setInterval(runDoohBackground, DOOH_BG_INTERVAL);
  console.log('📊 DOOH background processing enabled (5min cycle)');
}

// Diagnostic: when does the event loop first become available?
const _syncSetupDone = Date.now();
console.log(`⏱️ STARTUP: all sync setup done in ${_syncSetupDone - _startupT0}ms`);
setImmediate(() => {
  console.log(`⏱️ STARTUP: first event loop tick at +${Date.now() - _syncSetupDone}ms after sync setup`);
});

// Start server
httpServer.listen(PORT, async () => {
  // Auto-configure edge simulator backendUrl so SimV2 can fetch zone data
  if (process.env.BACKEND_PUBLIC_URL && DEFAULT_EDGE_SERVER_URL) {
    try {
      const configRes = await fetch(`${DEFAULT_EDGE_SERVER_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backendUrl: process.env.BACKEND_PUBLIC_URL }),
      });
      const configData = await configRes.json();
      console.log(`🔗 Edge simulator backendUrl set to ${process.env.BACKEND_PUBLIC_URL}`);
    } catch (err) {
      console.warn('⚠️ Could not auto-configure edge simulator:', err.message);
    }
  }

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
// Prevent uncaught errors from crashing the backend
process.on('uncaughtException', (err) => {
  console.error(`⚠️ [${new Date().toISOString()}] Uncaught exception (process kept alive):`, err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error(`⚠️ [${new Date().toISOString()}] Unhandled rejection (process kept alive):`, reason);
  if (reason instanceof Error) console.error(reason.stack);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  tailscaleService.stopPolling();
  lidarConnectionManager.disconnectAll();
  if (mockGenerator) mockGenerator.stop();
  // if (mqttService) mqttService.disconnect();
  trackAggregator.stop();
  intentScorer.stop();
  zoneAggregator.stop();
  behaviorClusterer.stop();
  profitRadarEngine.stop();
  trajectoryStorage.stop();
  db.close();
  process.exit(0);
});
