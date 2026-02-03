import express from 'express';
import cors from 'cors';
import mqtt from 'mqtt';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(join(__dirname, '../frontend/dist')));

// Use data folder for persistent storage (mounted as Docker volume)
const DATA_DIR = join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const CONFIG_FILE = join(DATA_DIR, 'config.json');

// Default configuration
const defaultConfig = {
  mqttBroker: 'mqtt://localhost:1883',
  deviceId: 'lidar-edge-001',
  venueId: 'default-venue',
  frequencyHz: 10,
  personCount: 5,
  venueWidth: 20,
  venueDepth: 15,
};

// Load config from file or use defaults
let config = { ...defaultConfig };
try {
  if (fs.existsSync(CONFIG_FILE)) {
    config = { ...defaultConfig, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')) };
  }
} catch (err) {
  console.error('Failed to load config:', err.message);
}

// Save config to file
const saveConfig = () => {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error('Failed to save config:', err.message);
  }
};

// Simulation state
let isRunning = false;
let mqttClient = null;
let simulationInterval = null;
let people = [];
let stats = {
  tracksSent: 0,
  startTime: null,
  lastError: null,
  mqttConnected: false,
};

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

class Person {
  constructor(id, venueWidth, venueDepth) {
    this.id = id;
    this.venueWidth = venueWidth;
    this.venueDepth = venueDepth;
    this.x = Math.random() * venueWidth;
    this.z = Math.random() * venueDepth;
    this.targetX = Math.random() * venueWidth;
    this.targetZ = Math.random() * venueDepth;
    this.speed = 0.5 + Math.random() * 1.5;
    this.color = COLORS[id % COLORS.length];
    this.width = 0.4 + Math.random() * 0.2;
    this.height = 1.5 + Math.random() * 0.4;
  }

  update(dt) {
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.5) {
      this.targetX = Math.random() * this.venueWidth;
      this.targetZ = Math.random() * this.venueDepth;
      this.speed = 0.5 + Math.random() * 1.5;
    } else {
      const vx = (dx / dist) * this.speed;
      const vz = (dz / dist) * this.speed;
      this.x += vx * dt;
      this.z += vz * dt;
      this.vx = vx;
      this.vz = vz;
    }
  }

  toMessage(deviceId, venueId) {
    return {
      id: `person-${this.id}`,
      deviceId,
      venueId,
      timestamp: Date.now(),
      position: { x: this.x, y: 0, z: this.z },
      velocity: { x: this.vx || 0, y: 0, z: this.vz || 0 },
      objectType: 'person',
      color: this.color,
      boundingBox: { width: this.width, height: this.height, depth: this.width },
    };
  }
}

// Initialize people
const initializePeople = () => {
  people = [];
  for (let i = 0; i < config.personCount; i++) {
    people.push(new Person(i, config.venueWidth, config.venueDepth));
  }
};

// Connect to MQTT
const connectMqtt = () => {
  return new Promise((resolve, reject) => {
    if (mqttClient) {
      mqttClient.end(true);
    }

    console.log(`Connecting to MQTT broker: ${config.mqttBroker}`);
    mqttClient = mqtt.connect(config.mqttBroker, {
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    mqttClient.on('connect', () => {
      console.log('Connected to MQTT broker');
      stats.mqttConnected = true;
      stats.lastError = null;
      resolve();
    });

    mqttClient.on('error', (err) => {
      console.error('MQTT Error:', err.message);
      stats.lastError = err.message;
      stats.mqttConnected = false;
      reject(err);
    });

    mqttClient.on('close', () => {
      stats.mqttConnected = false;
    });

    mqttClient.on('reconnect', () => {
      console.log('Reconnecting to MQTT broker...');
    });
  });
};

// Start simulation
const startSimulation = async () => {
  if (isRunning) return { success: false, error: 'Already running' };

  try {
    await connectMqtt();
    initializePeople();
    
    stats.tracksSent = 0;
    stats.startTime = Date.now();
    stats.lastError = null;

    const intervalMs = 1000 / config.frequencyHz;
    const dt = 1 / config.frequencyHz;

    simulationInterval = setInterval(() => {
      if (!mqttClient || !stats.mqttConnected) return;

      people.forEach((person) => {
        person.update(dt);
        const message = person.toMessage(config.deviceId, config.venueId);
        mqttClient.publish(
          `hyperspace/trajectories/${config.deviceId}`,
          JSON.stringify(message)
        );
        stats.tracksSent++;
      });
    }, intervalMs);

    isRunning = true;
    console.log(`Simulation started: ${config.personCount} people at ${config.frequencyHz}Hz`);
    return { success: true };
  } catch (err) {
    stats.lastError = err.message;
    return { success: false, error: err.message };
  }
};

// Stop simulation
const stopSimulation = () => {
  if (simulationInterval) {
    clearInterval(simulationInterval);
    simulationInterval = null;
  }
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }
  isRunning = false;
  stats.mqttConnected = false;
  console.log('Simulation stopped');
  return { success: true };
};

// API Routes
app.get('/api/config', (req, res) => {
  res.json(config);
});

app.post('/api/config', (req, res) => {
  const wasRunning = isRunning;
  if (wasRunning) stopSimulation();

  config = { ...config, ...req.body };
  saveConfig();

  res.json({ success: true, config });
});

app.get('/api/status', (req, res) => {
  res.json({
    isRunning,
    mqttConnected: stats.mqttConnected,
    tracksSent: stats.tracksSent,
    uptime: stats.startTime ? Math.floor((Date.now() - stats.startTime) / 1000) : 0,
    lastError: stats.lastError,
    config,
  });
});

app.post('/api/start', async (req, res) => {
  const result = await startSimulation();
  res.json(result);
});

app.post('/api/stop', (req, res) => {
  const result = stopSimulation();
  res.json(result);
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../frontend/dist/index.html'));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   🎯 Edge LiDAR Server                               ║
║                                                      ║
║   Web UI: http://localhost:${PORT}                     ║
║   API:    http://localhost:${PORT}/api                 ║
║                                                      ║
║   Endpoints:                                         ║
║   - GET  /api/config    Get configuration            ║
║   - POST /api/config    Update configuration         ║
║   - GET  /api/status    Get simulation status        ║
║   - POST /api/start     Start simulation             ║
║   - POST /api/stop      Stop simulation              ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
});
