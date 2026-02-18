#!/usr/bin/env node
/**
 * Hyperspace SimTracker - Standalone Trajectory Publisher
 * 
 * A minimal simulation tracker that publishes mock trajectories to MQTT.
 * Designed to test the DEB → Docker Conversion Service pipeline.
 * 
 * Environment Variables:
 *   MQTT_BROKER  - MQTT broker URL (default: mqtt://localhost:1883)
 *   MQTT_TOPIC   - Base topic (default: hyperspace/trajectories)
 *   EDGE_ID      - Edge device ID (default: test-edge-001)
 *   VENUE_ID     - Venue ID (default: test-venue-001)
 *   CONFIG_FILE  - Path to deployment.json config (optional)
 */

const mqtt = require('mqtt');
const fs = require('fs');

// Configuration from environment or defaults
let config = {
  mqttBroker: process.env.MQTT_BROKER || 'mqtt://localhost:1883',
  mqttTopic: process.env.MQTT_TOPIC || 'hyperspace/trajectories',
  edgeId: process.env.EDGE_ID || 'test-edge-001',
  venueId: process.env.VENUE_ID || 'test-venue-001',
  publishInterval: 100, // ms between publishes
  maxAgents: 5,
  venueWidth: 20,
  venueDepth: 15,
};

// Load config from file if provided
const configFile = process.env.CONFIG_FILE;
if (configFile && fs.existsSync(configFile)) {
  try {
    const fileConfig = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    config.edgeId = fileConfig.edgeId || config.edgeId;
    config.venueId = fileConfig.venueId || config.venueId;
    if (fileConfig.mqtt) {
      config.mqttBroker = fileConfig.mqtt.broker || config.mqttBroker;
    }
    console.log('[SimTracker] Loaded config from', configFile);
  } catch (err) {
    console.error('[SimTracker] Failed to load config:', err.message);
  }
}

// Build full topic with edge ID
const fullTopic = `${config.mqttTopic}/${config.edgeId}`;

console.log('[SimTracker] ========================================');
console.log('[SimTracker] Hyperspace SimTracker v1.0.0');
console.log('[SimTracker] ========================================');
console.log('[SimTracker] MQTT Broker:', config.mqttBroker);
console.log('[SimTracker] Topic:', fullTopic);
console.log('[SimTracker] Edge ID:', config.edgeId);
console.log('[SimTracker] Venue ID:', config.venueId);
console.log('[SimTracker] ========================================');

// Simple agent simulation
class Agent {
  constructor(id) {
    this.id = id;
    this.x = Math.random() * config.venueWidth;
    this.y = 0; // ground level
    this.z = Math.random() * config.venueDepth;
    this.vx = (Math.random() - 0.5) * 2;
    this.vz = (Math.random() - 0.5) * 2;
    this.createdAt = Date.now();
  }

  update(dt) {
    // Simple random walk with bounds checking
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Bounce off walls
    if (this.x < 0 || this.x > config.venueWidth) {
      this.vx *= -1;
      this.x = Math.max(0, Math.min(config.venueWidth, this.x));
    }
    if (this.z < 0 || this.z > config.venueDepth) {
      this.vz *= -1;
      this.z = Math.max(0, Math.min(config.venueDepth, this.z));
    }

    // Random direction changes
    if (Math.random() < 0.02) {
      this.vx = (Math.random() - 0.5) * 2;
      this.vz = (Math.random() - 0.5) * 2;
    }
  }

  toMessage() {
    return {
      trackId: this.id,
      timestamp: Date.now(),
      position: {
        x: parseFloat(this.x.toFixed(3)),
        y: parseFloat(this.y.toFixed(3)),
        z: parseFloat(this.z.toFixed(3)),
      },
      velocity: {
        x: parseFloat(this.vx.toFixed(3)),
        y: 0,
        z: parseFloat(this.vz.toFixed(3)),
      },
      confidence: 0.95,
      classification: 'person',
      edgeId: config.edgeId,
      venueId: config.venueId,
      source: 'sim-tracker',
    };
  }
}

// Agent pool
const agents = [];
let nextAgentId = 1;

function spawnAgent() {
  if (agents.length < config.maxAgents) {
    agents.push(new Agent(`agent-${nextAgentId++}`));
  }
}

function removeOldAgents() {
  const now = Date.now();
  const maxAge = 30000; // 30 seconds
  for (let i = agents.length - 1; i >= 0; i--) {
    if (now - agents[i].createdAt > maxAge && Math.random() < 0.1) {
      agents.splice(i, 1);
    }
  }
}

// MQTT Connection
let client = null;
let stats = { published: 0, errors: 0 };

function connect() {
  console.log('[SimTracker] Connecting to MQTT broker...');
  
  client = mqtt.connect(config.mqttBroker, {
    clientId: `sim-tracker-${config.edgeId}-${Date.now()}`,
    clean: true,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => {
    console.log('[SimTracker] Connected to MQTT broker');
    startSimulation();
  });

  client.on('error', (err) => {
    console.error('[SimTracker] MQTT Error:', err.message);
    stats.errors++;
  });

  client.on('close', () => {
    console.log('[SimTracker] MQTT connection closed');
  });

  client.on('reconnect', () => {
    console.log('[SimTracker] Reconnecting to MQTT...');
  });
}

// Simulation loop
let lastUpdate = Date.now();
let simulationInterval = null;

function startSimulation() {
  console.log('[SimTracker] Starting simulation...');
  
  // Spawn initial agents
  for (let i = 0; i < 3; i++) {
    spawnAgent();
  }

  simulationInterval = setInterval(() => {
    const now = Date.now();
    const dt = (now - lastUpdate) / 1000;
    lastUpdate = now;

    // Spawn/remove agents occasionally
    if (Math.random() < 0.05) spawnAgent();
    if (Math.random() < 0.02) removeOldAgents();

    // Update and publish each agent
    for (const agent of agents) {
      agent.update(dt);
      
      const message = agent.toMessage();
      client.publish(fullTopic, JSON.stringify(message), { qos: 1 }, (err) => {
        if (err) {
          stats.errors++;
        } else {
          stats.published++;
        }
      });
    }

    // Log stats periodically
    if (stats.published % 100 === 0 && stats.published > 0) {
      console.log(`[SimTracker] Published: ${stats.published}, Agents: ${agents.length}, Errors: ${stats.errors}`);
    }
  }, config.publishInterval);
}

// Graceful shutdown
function shutdown() {
  console.log('[SimTracker] Shutting down...');
  if (simulationInterval) {
    clearInterval(simulationInterval);
  }
  if (client) {
    client.end(true, () => {
      console.log('[SimTracker] Disconnected from MQTT');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
connect();
