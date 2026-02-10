import express from 'express';
import cors from 'cors';
import mqtt from 'mqtt';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

// V2 Simulation modules
import { SimulatorV2, SIM_CONFIG, STATE } from './sim/index.js';

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
  backendUrl: 'http://localhost:3001',
  deviceId: 'lidar-edge-001',
  venueId: 'default-venue',
  frequencyHz: 10,
  personCount: 5,
  targetPeopleCount: 20, // Target number of people in scene at any time
  avgStayTime: 5, // Average stay time in minutes
  venueWidth: 20,
  venueDepth: 15,
  simulationMode: 'random', // 'random', 'queue', 'mixed'
  queueSpawnInterval: 5, // seconds between new queue customers
  useSimV2: true, // Feature flag: use new V2 simulation with navgrid, pathfinding, anti-glitch
  // Cashier agent settings
  enableCashiers: true,
  cashierShiftMin: 60, // Average shift duration in minutes
  cashierBreakProb: 15, // Break probability per hour (%)
  laneOpenConfirmSec: 120, // Seconds cashier must be present before lane marked open
  enableIdConfusion: false, // Simulate LiDAR ID tracking errors
  // Checkout Manager settings
  enableCheckoutManager: false, // Manual lane control (false = auto cashier scheduling)
  queuePressureThreshold: 5, // Suggest opening lane when avg queue > this
  // Queue Pressure Controls (for KPI-driven simulation)
  checkoutProbMultiplier: 1.0, // Multiplier for checkout probability (1.0 = default, 2.0 = double checkout rate)
  browsingSpeedMultiplier: 1.0, // Multiplier for browsing speed (1.0 = default, 2.0 = finish browsing 2x faster)
  arrivalRateMultiplier: 1.0, // Multiplier for arrival rate (1.0 = default, 2.0 = double arrivals)
};

// SimulatorV2 instance
let simulatorV2 = null;

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

// Venue geometry (fetched from backend)
let venueGeometry = null;
let cashierZones = [];
let entranceObjects = []; // Entrance objects for spawning

const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// Fetch venue geometry from Hyperspace backend
const fetchVenueGeometry = async () => {
  try {
    console.log(`Fetching geometry from ${config.backendUrl}/api/venues/${config.venueId}`);
    
    const venueRes = await fetch(`${config.backendUrl}/api/venues/${config.venueId}`);
    if (!venueRes.ok) {
      console.error('Failed to fetch venue:', venueRes.status);
      return null;
    }
    const venueData = await venueRes.json();
    
    const roiRes = await fetch(`${config.backendUrl}/api/venues/${config.venueId}/roi`);
    if (!roiRes.ok) {
      console.error('Failed to fetch ROIs:', roiRes.status);
      return null;
    }
    const rois = await roiRes.json();
    
    console.log(`Loaded venue: ${venueData.venue?.name}, ${rois.length} ROIs`);
    return { venue: venueData.venue, objects: venueData.objects || [], rois };
  } catch (err) {
    console.error('Error fetching geometry:', err.message);
    return null;
  }
};

// Calculate zone center from vertices
const calculateZoneCenter = (vertices) => {
  if (!vertices || vertices.length === 0) return { x: 0, z: 0 };
  const sum = vertices.reduce((acc, v) => ({ x: acc.x + v.x, z: acc.z + v.z }), { x: 0, z: 0 });
  return { x: sum.x / vertices.length, z: sum.z / vertices.length };
};

// Store obstacles (venue objects that agents should avoid)
let obstacles = [];
const OBSTACLE_PADDING = 0.2; // 20cm minimum distance from objects

// Parse venue objects into obstacle boundaries
const parseObstacles = (geometry) => {
  const obs = [];
  const objects = geometry.objects || [];
  
  for (const obj of objects) {
    if (!obj.position) continue;
    
    // Get object dimensions (default to 1x1 if not specified)
    const width = obj.scale?.x || obj.width || 1;
    const depth = obj.scale?.z || obj.depth || 1;
    const rotation = obj.rotation?.y || 0;
    
    // Calculate bounding box with padding
    const halfW = (width / 2) + OBSTACLE_PADDING;
    const halfD = (depth / 2) + OBSTACLE_PADDING;
    
    // For rotated objects, use the larger dimension for a conservative bounding box
    const cosR = Math.abs(Math.cos(rotation));
    const sinR = Math.abs(Math.sin(rotation));
    const effectiveHalfW = halfW * cosR + halfD * sinR;
    const effectiveHalfD = halfW * sinR + halfD * cosR;
    
    obs.push({
      name: obj.name || 'object',
      x: obj.position.x,
      z: obj.position.z,
      minX: obj.position.x - effectiveHalfW,
      maxX: obj.position.x + effectiveHalfW,
      minZ: obj.position.z - effectiveHalfD,
      maxZ: obj.position.z + effectiveHalfD,
      radius: Math.max(effectiveHalfW, effectiveHalfD), // For circular collision
    });
  }
  
  console.log(`Parsed ${obs.length} obstacles for collision avoidance`);
  return obs;
};

// Parse entrance objects from venue geometry
const parseEntrances = (geometry) => {
  const entrances = [];
  const objects = geometry.objects || [];
  
  for (const obj of objects) {
    if (!obj.position) continue;
    
    // Check if object is an entrance (by name or type)
    const name = (obj.name || '').toLowerCase();
    const type = (obj.type || '').toLowerCase();
    
    if (name.includes('entrance') || name.includes('entry') || name.includes('door') || 
        type.includes('entrance') || type === 'door') {
      const width = obj.scale?.x || obj.width || 2;
      const depth = obj.scale?.z || obj.depth || 1;
      
      entrances.push({
        name: obj.name || 'entrance',
        x: obj.position.x,
        z: obj.position.z,
        width,
        depth,
        // Calculate spawn area around entrance
        minX: obj.position.x - width / 2,
        maxX: obj.position.x + width / 2,
        minZ: obj.position.z - depth / 2,
        maxZ: obj.position.z + depth / 2,
      });
    }
  }
  
  console.log(`Parsed ${entrances.length} entrance objects for spawning`);
  return entrances;
};

// Get a random spawn position from an entrance
const getEntranceSpawnPosition = () => {
  if (entranceObjects.length === 0) {
    // Fallback: spawn at edge of venue if no entrances defined
    return {
      x: config.venueWidth * (0.1 + Math.random() * 0.8),
      z: config.venueDepth - 0.5,
      entrance: null
    };
  }
  
  // Pick a random entrance
  const entrance = entranceObjects[Math.floor(Math.random() * entranceObjects.length)];
  
  // Spawn at random position within entrance area
  return {
    x: entrance.minX + Math.random() * entrance.width,
    z: entrance.minZ + Math.random() * entrance.depth,
    entrance
  };
};

// Check if a point is inside any obstacle
const isInsideObstacle = (x, z) => {
  for (const obs of obstacles) {
    if (x >= obs.minX && x <= obs.maxX && z >= obs.minZ && z <= obs.maxZ) {
      return obs;
    }
  }
  return null;
};

// Check if a position collides with any obstacle (simplified - just center point)
const checkCollision = (x, z) => {
  return isInsideObstacle(x, z);
};

// Get soft avoidance force from nearby obstacles
const getAvoidanceForce = (x, z) => {
  let forceX = 0;
  let forceZ = 0;
  const avoidanceRadius = 0.6; // Start avoiding at 60cm
  
  for (const obs of obstacles) {
    const dx = x - obs.x;
    const dz = z - obs.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    // Soft avoidance - just nudge away from obstacle centers
    if (dist < obs.radius + avoidanceRadius && dist > 0.01) {
      const strength = 1 - (dist / (obs.radius + avoidanceRadius));
      forceX += (dx / dist) * strength * 1.5;
      forceZ += (dz / dist) * strength * 1.5;
    }
  }
  
  return { x: forceX, z: forceZ };
};

// Find a valid position that's not inside an obstacle
const findValidPosition = (x, z, venueWidth, venueDepth) => {
  // If current position is valid, return it
  if (!isInsideObstacle(x, z)) return { x, z };
  
  // Try random positions nearby
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 1 + Math.random() * 2;
    const newX = Math.max(0.5, Math.min(venueWidth - 0.5, x + Math.cos(angle) * dist));
    const newZ = Math.max(0.5, Math.min(venueDepth - 0.5, z + Math.sin(angle) * dist));
    if (!isInsideObstacle(newX, newZ)) return { x: newX, z: newZ };
  }
  
  // Fallback: return original position
  return { x, z };
};

// Parse cashier zones from ROIs
const parseCashierZones = (geometry) => {
  const zones = [];
  const rois = geometry.rois || [];
  
  const queueZones = rois.filter(r => r.name.endsWith('- Queue'));
  const serviceZones = rois.filter(r => r.name.endsWith('- Service'));
  
  console.log(`Found ${queueZones.length} queue zones, ${serviceZones.length} service zones`);
  
  for (const queueZone of queueZones) {
    const cashierName = queueZone.name.replace('- Queue', '').trim();
    const serviceZone = serviceZones.find(s => s.name.replace('- Service', '').trim() === cashierName);
    
    if (serviceZone) {
      zones.push({
        name: cashierName,
        queueZone: { ...queueZone, center: calculateZoneCenter(queueZone.vertices) },
        serviceZone: { ...serviceZone, center: calculateZoneCenter(serviceZone.vertices) },
      });
      console.log(`Paired: ${cashierName}`);
    }
  }
  return zones;
};

// Store cashier gap boundaries (one-way zones)
let cashierGapZones = [];

// Parse cashier gaps from service zones (these are one-way: exit only)
const parseCashierGaps = (geometry) => {
  const gaps = [];
  const rois = geometry.rois || [];
  const serviceZones = rois.filter(r => r.name.endsWith('- Service'));
  
  for (const zone of serviceZones) {
    if (zone.vertices && zone.vertices.length >= 3) {
      const minX = Math.min(...zone.vertices.map(v => v.x));
      const maxX = Math.max(...zone.vertices.map(v => v.x));
      const minZ = Math.min(...zone.vertices.map(v => v.z));
      const maxZ = Math.max(...zone.vertices.map(v => v.z));
      gaps.push({ minX, maxX, minZ, maxZ, name: zone.name });
    }
  }
  console.log(`Parsed ${gaps.length} cashier gaps (one-way exit zones)`);
  return gaps;
};

// Check if position is in a cashier gap (exit-only zone)
const isInCashierGap = (x, z) => {
  for (const gap of cashierGapZones) {
    if (x >= gap.minX && x <= gap.maxX && z >= gap.minZ && z <= gap.maxZ) {
      return true;
    }
  }
  return false;
};

class Person {
  constructor(id, venueWidth, venueDepth, spawnDelay = 0) {
    this.id = id;
    this.venueWidth = venueWidth;
    this.venueDepth = venueDepth;
    
    // Spawn delay for staggered entry
    this.spawnDelay = spawnDelay;
    this.spawned = spawnDelay === 0;
    this.spawnTimer = 0;
    
    // Get spawn position from entrance object
    const spawnPos = getEntranceSpawnPosition();
    this.entranceX = spawnPos.x;
    this.entranceZ = spawnPos.z;
    this.spawnEntrance = spawnPos.entrance; // Store which entrance we spawned from
    
    // Start at entrance (or off-screen if delayed)
    this.x = this.spawned ? this.entranceX : -10;
    this.z = this.spawned ? this.entranceZ : -10;
    
    // Calculate target stay time based on config (with some variance)
    const baseStayTime = config.avgStayTime * 60; // Convert minutes to seconds
    this.targetStayTime = baseStayTime * (0.5 + Math.random()); // 50%-150% of avg
    
    // Generate waypoints based on stay time
    this.waypoints = this.generateWaypoints();
    this.currentWaypointIndex = 0;
    this.targetX = this.waypoints[0].x;
    this.targetZ = this.waypoints[0].z;
    
    // Movement properties
    this.baseSpeed = 0.8 + Math.random() * 0.4; // 0.8-1.2 m/s walking speed
    this.speed = this.baseSpeed;
    this.color = COLORS[id % COLORS.length];
    this.width = 0.4 + Math.random() * 0.2;
    this.height = 1.5 + Math.random() * 0.4;
    this.vx = 0;
    this.vz = 0;
    
    // Wobble for natural movement
    this.wobblePhase = Math.random() * Math.PI * 2;
    this.wobbleFreq = 1.5 + Math.random() * 1; // How fast they wobble
    this.wobbleAmount = 0.1 + Math.random() * 0.1; // How much they wobble
    
    // Stopping behavior
    this.isStopped = false;
    this.stopTimer = 0;
    this.stopDuration = 0;
    this.timeSinceLastStop = 0;
    this.nextStopTime = 10 + Math.random() * 30; // Stop every 10-40 seconds
    
    // Track total time and if done
    this.totalTime = 0;
    this.done = false;
    this.returning = false;
  }

  generateWaypoints() {
    const waypoints = [];
    
    // STORE LAYOUT CONSTANTS (based on actual venue geometry)
    const CASHIER_LINE_Z = 7;        // Cashiers are at z=7
    const SHOPPING_MIN_Z = 15;       // Shopping area starts at z=15
    const SHOPPING_MAX_Z = 32;       // Shopping area ends at z=32
    const SHOPPING_MIN_X = 8;        // Shopping area x range
    const SHOPPING_MAX_X = 28;
    const BYPASS_X = this.venueWidth - 2; // Right side bypass corridor (x=38)
    
    // PHASE 1: ENTRY - Walk around cashiers on the right side
    // From entrance, go right along front, then up past cashier line
    waypoints.push({ x: BYPASS_X, z: 3 });           // Walk right along front
    waypoints.push({ x: BYPASS_X, z: SHOPPING_MIN_Z }); // Walk up past cashiers
    
    // PHASE 2: SHOPPING - Generate waypoints in shopping area
    const targetWaypoints = Math.max(3, Math.floor(this.targetStayTime / 30));
    const shoppingWaypoints = Math.min(8, Math.max(2, targetWaypoints - 2));
    
    for (let i = 0; i < shoppingWaypoints; i++) {
      const wx = SHOPPING_MIN_X + Math.random() * (SHOPPING_MAX_X - SHOPPING_MIN_X);
      const wz = SHOPPING_MIN_Z + Math.random() * (SHOPPING_MAX_Z - SHOPPING_MIN_Z);
      const valid = findValidPosition(wx, wz, this.venueWidth, this.venueDepth);
      waypoints.push({ x: valid.x, z: valid.z });
    }
    
    // PHASE 3: EXIT - Go to queue, through cashier, back to entrance
    // Pick a random cashier x position for checkout
    const cashierXPositions = [9, 12, 15, 18, 21, 25, 28, 31, 34];
    const selectedCashierX = cashierXPositions[Math.floor(Math.random() * cashierXPositions.length)];
    
    // Approach queue area (just behind cashier)
    waypoints.push({ x: selectedCashierX, z: CASHIER_LINE_Z + 5 }); // Queue position
    waypoints.push({ x: selectedCashierX, z: CASHIER_LINE_Z });     // At cashier
    waypoints.push({ x: selectedCashierX, z: 3 });                   // Past cashier gap
    
    // Return to entrance (same as entry point)
    waypoints.push({ x: this.entranceX, z: this.entranceZ });
    
    return waypoints;
  }

  update(dt) {
    if (this.done) return false;
    
    // Handle spawn delay (staggered entry)
    if (!this.spawned) {
      this.spawnTimer += dt;
      if (this.spawnTimer >= this.spawnDelay) {
        this.spawned = true;
        this.x = this.entranceX;
        this.z = this.entranceZ;
      } else {
        return true; // Still waiting to spawn
      }
    }
    
    this.totalTime += dt;
    this.timeSinceLastStop += dt;
    
    // Check if should start stopping
    if (!this.isStopped && !this.returning && this.timeSinceLastStop > this.nextStopTime) {
      this.isStopped = true;
      this.stopDuration = 3 + Math.random() * 7; // Stop for 3-10 seconds
      this.stopTimer = 0;
      this.vx = 0;
      this.vz = 0;
    }
    
    // Handle stopped state
    if (this.isStopped) {
      this.stopTimer += dt;
      if (this.stopTimer >= this.stopDuration) {
        this.isStopped = false;
        this.timeSinceLastStop = 0;
        this.nextStopTime = 15 + Math.random() * 30;
      }
      // Small idle movement while stopped
      this.vx = (Math.random() - 0.5) * 0.05;
      this.vz = (Math.random() - 0.5) * 0.05;
      return true;
    }
    
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.5) {
      // Reached waypoint
      this.currentWaypointIndex++;
      
      if (this.currentWaypointIndex >= this.waypoints.length) {
        // Completed path, person exits
        this.done = true;
        return false;
      }
      
      // Check if this is the return waypoint
      if (this.currentWaypointIndex === this.waypoints.length - 1) {
        this.returning = true;
      }
      
      this.targetX = this.waypoints[this.currentWaypointIndex].x;
      this.targetZ = this.waypoints[this.currentWaypointIndex].z;
      this.speed = this.baseSpeed * (0.8 + Math.random() * 0.4);
    } else {
      // Update wobble phase
      this.wobblePhase += this.wobbleFreq * dt;
      
      // Base direction toward target
      const dirX = dx / dist;
      const dirZ = dz / dist;
      
      // Perpendicular direction for wobble
      const perpX = -dirZ;
      const perpZ = dirX;
      
      // Add sinusoidal wobble
      const wobble = Math.sin(this.wobblePhase) * this.wobbleAmount;
      
      // Base velocity with wobble
      let vx = (dirX + perpX * wobble) * this.speed;
      let vz = (dirZ + perpZ * wobble) * this.speed;
      
      // Add soft avoidance force from obstacles
      const avoidance = getAvoidanceForce(this.x, this.z);
      vx += avoidance.x * this.speed;
      vz += avoidance.z * this.speed;
      
      // Calculate new position
      let newX = this.x + vx * dt;
      let newZ = this.z + vz * dt;
      
      // Simple collision check - if inside obstacle, try to slide around
      const obstacle = checkCollision(newX, newZ);
      if (obstacle) {
        // Try sliding along X axis only
        if (!checkCollision(newX, this.z)) {
          newZ = this.z;
        } 
        // Try sliding along Z axis only
        else if (!checkCollision(this.x, newZ)) {
          newX = this.x;
        }
        // Both blocked - add random jitter to escape
        else {
          newX = this.x + (Math.random() - 0.5) * 0.3;
          newZ = this.z + (Math.random() - 0.5) * 0.3;
        }
      }
      
      // Clamp to venue bounds
      this.x = Math.max(0.5, Math.min(this.venueWidth - 0.5, newX));
      this.z = Math.max(0.5, Math.min(this.venueDepth - 0.5, newZ));
      this.vx = vx;
      this.vz = vz;
    }
    
    return true;
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

// Queue customer - simulates realistic queue behavior
class QueuePerson {
  constructor(id, queueZone, serviceZone) {
    this.id = id;
    this.queueZone = queueZone;
    this.serviceZone = serviceZone;
    this.state = 'approaching'; // approaching -> queuing -> serving -> leaving -> done
    this.stateTime = 0;
    
    // Calculate flow direction: from queue zone toward service zone
    const dx = serviceZone.center.x - queueZone.center.x;
    const dz = serviceZone.center.z - queueZone.center.z;
    const flowLength = Math.sqrt(dx * dx + dz * dz) || 1;
    
    // Normalized flow direction (queue -> service)
    this.flowDirX = dx / flowLength;
    this.flowDirZ = dz / flowLength;
    
    // Perpendicular direction (for side-to-side variation)
    this.perpDirX = -this.flowDirZ;
    this.perpDirZ = this.flowDirX;
    
    // Queue length (distance from queue center to service center)
    this.queueLength = flowLength;
    
    // Start BEHIND the queue zone (opposite of flow direction)
    const approachOffset = 6 + Math.random() * 4;
    const sideOffset = (Math.random() - 0.5) * 3;
    this.x = queueZone.center.x - this.flowDirX * approachOffset + this.perpDirX * sideOffset;
    this.z = queueZone.center.z - this.flowDirZ * approachOffset + this.perpDirZ * sideOffset;
    this.targetX = this.x;
    this.targetZ = this.z;
    
    this.speed = 1.0 + Math.random() * 0.4;
    this.vx = 0;
    this.vz = 0;
    
    this.targetWaitTime = 5 + Math.random() * 20;
    this.targetServiceTime = 3 + Math.random() * 8;
    
    this.color = '#f59e0b'; // Orange for queue customers
    this.width = 0.4 + Math.random() * 0.2;
    this.height = 1.5 + Math.random() * 0.4;
    this.done = false;
    
    this.setTargetForState();
  }

  setTargetForState() {
    const sideVariation = (Math.random() - 0.5) * 0.5;
    
    switch (this.state) {
      case 'approaching':
        // Target: back of queue zone
        this.targetX = this.queueZone.center.x + this.perpDirX * sideVariation;
        this.targetZ = this.queueZone.center.z + this.perpDirZ * sideVariation;
        break;
      case 'queuing':
        // Progress forward in queue toward service zone
        const queueProgress = this.stateTime / this.targetWaitTime;
        const progressDist = queueProgress * this.queueLength * 0.8;
        this.targetX = this.queueZone.center.x + this.flowDirX * progressDist + this.perpDirX * sideVariation * 0.3;
        this.targetZ = this.queueZone.center.z + this.flowDirZ * progressDist + this.perpDirZ * sideVariation * 0.3;
        break;
      case 'serving':
        // At the service zone (counter)
        this.targetX = this.serviceZone.center.x + this.perpDirX * sideVariation * 0.3;
        this.targetZ = this.serviceZone.center.z + this.perpDirZ * sideVariation * 0.3;
        break;
      case 'leaving':
        // Exit: continue past service zone in flow direction, then to the side
        const exitSide = Math.random() > 0.5 ? 1 : -1;
        this.targetX = this.serviceZone.center.x + this.flowDirX * 3 + this.perpDirX * exitSide * 4;
        this.targetZ = this.serviceZone.center.z + this.flowDirZ * 3 + this.perpDirZ * exitSide * 4;
        break;
    }
  }

  update(dt) {
    if (this.done) return false;
    
    this.stateTime += dt;
    const distToTarget = Math.sqrt(Math.pow(this.targetX - this.x, 2) + Math.pow(this.targetZ - this.z, 2));
    
    switch (this.state) {
      case 'approaching':
        if (distToTarget < 1.0) {
          this.state = 'queuing';
          this.stateTime = 0;
          this.setTargetForState();
        }
        break;
      case 'queuing':
        if (this.stateTime % 2 < dt) this.setTargetForState();
        if (this.stateTime >= this.targetWaitTime) {
          this.state = 'serving';
          this.stateTime = 0;
          this.setTargetForState();
        }
        break;
      case 'serving':
        if (this.stateTime >= this.targetServiceTime) {
          this.state = 'leaving';
          this.stateTime = 0;
          this.setTargetForState();
        }
        break;
      case 'leaving':
        if (distToTarget < 0.5 || this.stateTime > 5) {
          this.done = true;
          return false;
        }
        break;
    }
    
    // Movement with collision avoidance
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    if (dist > 0.1) {
      const effectiveSpeed = this.state === 'queuing' ? this.speed * 0.3 : this.speed;
      let vx = (dx / dist) * effectiveSpeed;
      let vz = (dz / dist) * effectiveSpeed;
      
      // Add soft avoidance force from obstacles
      const avoidance = getAvoidanceForce(this.x, this.z);
      vx += avoidance.x * effectiveSpeed;
      vz += avoidance.z * effectiveSpeed;
      
      // Calculate new position
      let newX = this.x + vx * dt;
      let newZ = this.z + vz * dt;
      
      // Simple collision check - if inside obstacle, try to slide around
      const obstacle = checkCollision(newX, newZ);
      if (obstacle) {
        // Try sliding along X axis only
        if (!checkCollision(newX, this.z)) {
          newZ = this.z;
        } 
        // Try sliding along Z axis only
        else if (!checkCollision(this.x, newZ)) {
          newX = this.x;
        }
        // Both blocked - add random jitter to escape
        else {
          newX = this.x + (Math.random() - 0.5) * 0.2;
          newZ = this.z + (Math.random() - 0.5) * 0.2;
        }
      }
      
      this.x = newX;
      this.z = newZ;
      this.vx = vx;
      this.vz = vz;
    } else {
      this.vx = 0;
      this.vz = 0;
    }
    
    return true;
  }

  toMessage(deviceId, venueId) {
    return {
      id: `queue-${this.id}`,
      deviceId,
      venueId,
      timestamp: Date.now(),
      position: { x: this.x, y: 0, z: this.z },
      velocity: { x: this.vx, y: 0, z: this.vz },
      objectType: 'person',
      color: this.color,
      boundingBox: { width: this.width, height: this.height, depth: this.width },
      metadata: { state: this.state }
    };
  }
}

let queuePeople = [];
let lastQueueSpawnTime = 0;
let nextQueueId = 1000;

// Initialize people with staggered spawning (max 5-6 per cluster)
const initializePeople = () => {
  people = [];
  const maxPerCluster = 5;
  const clusterInterval = 30; // 30 seconds between clusters
  const withinClusterDelay = 3; // 3 seconds between people in same cluster
  
  for (let i = 0; i < config.personCount; i++) {
    const clusterIndex = Math.floor(i / maxPerCluster);
    const positionInCluster = i % maxPerCluster;
    // Stagger spawn: cluster delay + within-cluster delay + small random offset
    const spawnDelay = (clusterIndex * clusterInterval) + (positionInCluster * withinClusterDelay) + (Math.random() * 2);
    people.push(new Person(i, config.venueWidth, config.venueDepth, spawnDelay));
  }
  console.log(`Initialized ${config.personCount} people with staggered spawning (${Math.ceil(config.personCount / maxPerCluster)} clusters)`);
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

// Spawn a new queue customer
const spawnQueuePerson = () => {
  if (cashierZones.length === 0) return;
  const zone = cashierZones[Math.floor(Math.random() * cashierZones.length)];
  const person = new QueuePerson(nextQueueId++, zone.queueZone, zone.serviceZone);
  queuePeople.push(person);
  console.log(`Spawned queue customer ${person.id} at ${zone.name}`);
};

// Start simulation
const startSimulation = async () => {
  if (isRunning) return { success: false, error: 'Already running' };

  try {
    await connectMqtt();
    
    // Reset state
    people = [];
    queuePeople = [];
    lastQueueSpawnTime = Date.now();
    stats.tracksSent = 0;
    stats.startTime = Date.now();
    stats.lastError = null;

    // Always fetch geometry for collision avoidance
    console.log('Fetching venue geometry...');
    venueGeometry = await fetchVenueGeometry();
    if (venueGeometry) {
      // Parse obstacles for collision avoidance (all modes)
      obstacles = parseObstacles(venueGeometry);
      
      // Update venue dimensions from geometry
      if (venueGeometry.venue) {
        config.venueWidth = venueGeometry.venue.width || config.venueWidth;
        config.venueDepth = venueGeometry.venue.depth || config.venueDepth;
      }
      
      // Parse cashier zones for queue modes
      if (config.simulationMode === 'queue' || config.simulationMode === 'mixed') {
        cashierZones = parseCashierZones(venueGeometry);
        if (cashierZones.length === 0) {
          console.warn('No cashier zones found! Run Smart KPI to generate zones.');
          if (config.simulationMode === 'queue') {
            return { success: false, error: 'No cashier zones found. Generate zones with Smart KPI first.' };
          }
        }
      }
      
      // Parse cashier gaps (one-way exit zones) for all modes
      cashierGapZones = parseCashierGaps(venueGeometry);
      
      // Parse entrance objects for spawning
      entranceObjects = parseEntrances(venueGeometry);
      if (entranceObjects.length === 0) {
        console.warn('No entrance objects found! People will spawn at venue edge.');
      }
      
      // Initialize SimulatorV2 if enabled
      if (config.useSimV2) {
        console.log('[SimV2] Initializing V2 simulation...');
        // Build SimV2 config from frontend config
        const simV2Config = {
          maxOccupancy: config.targetPeopleCount,
          seed: null, // Random seed
          // Cashier feature flags
          ENABLE_CASHIER_AGENTS: config.enableCashiers,
          ENABLE_ID_CONFUSION: config.enableIdConfusion,
          // Checkout Manager settings
          enableCheckoutManager: config.enableCheckoutManager,
          queuePressureThreshold: config.queuePressureThreshold || 5,
        };
        
        // Override cashier behavior settings if provided
        if (config.enableCashiers) {
          simV2Config.cashierBehavior = {
            cashiersPerLane: 1,
            spawnAtStart: true,
            shiftDurationMin: [config.cashierShiftMin * 0.5, config.cashierShiftMin * 1.5],
            breakProbabilityPerHour: config.cashierBreakProb / 100,
          };
          simV2Config.laneOpenClose = {
            openConfirmWindowSec: config.laneOpenConfirmSec,
            closeGraceWindowSec: 180,
          };
        }
        
        simulatorV2 = new SimulatorV2(config.venueWidth, config.venueDepth, simV2Config);
        simulatorV2.initFromScene(venueGeometry.objects || [], venueGeometry.rois || []);
        
        // Log cashier status
        const cashierCount = simulatorV2.cashierAgents?.length || 0;
        const laneCount = simulatorV2.laneStates?.length || 0;
        console.log(`[SimV2] Cashiers: ${cashierCount} agents spawned for ${laneCount} lanes`);
        console.log(`[SimV2] Cashier config: enabled=${config.enableCashiers}, shift=${config.cashierShiftMin}min, break=${config.cashierBreakProb}%`);
        
        if (cashierCount > 0) {
          for (const c of simulatorV2.cashierAgents) {
            console.log(`[SimV2] Cashier ${c.id}: lane=${c.laneId}, anchor=(${c.anchorPoint.x.toFixed(1)}, ${c.anchorPoint.z.toFixed(1)}), state=${c.state}`);
          }
        }
        
        // Bulk spawn initial agents to reach target quickly
        const initialSpawn = Math.min(config.targetPeopleCount, 50);
        console.log(`[SimV2] Bulk spawning ${initialSpawn} initial agents (target: ${config.targetPeopleCount})`);
        for (let i = 0; i < initialSpawn; i++) {
          simulatorV2.spawnAgent();
        }
        console.log(`[SimV2] Initialization complete, active: ${simulatorV2.getActiveCount()}`);
      }
    } else {
      obstacles = []; // Reset obstacles if no geometry
      cashierGapZones = [];
      entranceObjects = [];
      simulatorV2 = null;
      console.warn('Could not fetch venue geometry - collision avoidance disabled');
    }

    // Initialize random walkers if mode is random or mixed (V1 only)
    if (!config.useSimV2 && (config.simulationMode === 'random' || config.simulationMode === 'mixed')) {
      initializePeople();
    }

    // Spawn initial queue customers (V1 only)
    if (!config.useSimV2 && (config.simulationMode === 'queue' || config.simulationMode === 'mixed') && cashierZones.length > 0) {
      for (let i = 0; i < Math.min(3, cashierZones.length); i++) {
        spawnQueuePerson();
      }
    }

    const intervalMs = 1000 / config.frequencyHz;
    const dt = 1 / config.frequencyHz;
    
    // IMMEDIATE DEBUG LOG
    console.log('====== SIMULATION STARTING ======');
    console.log(`ENABLE_CASHIER_AGENTS: ${config.enableCashiers}`);
    if (simulatorV2) {
      console.log(`NavGrid cashiers detected: ${simulatorV2.navGrid?.cashiers?.length || 0}`);
      console.log(`CashierAgents array: ${simulatorV2.cashierAgents?.length || 0}`);
      console.log(`LaneStates array: ${simulatorV2.laneStates?.length || 0}`);
    }
    console.log('=================================');

    simulationInterval = setInterval(() => {
      if (!mqttClient || !stats.mqttConnected) return;

      const now = Date.now();

      // ========== V2 SIMULATION ==========
      if (config.useSimV2 && simulatorV2) {
        // Spawn new agents if below target (apply arrival rate multiplier)
        const activeCount = simulatorV2.getActiveCount();
        const arrivalMultiplier = config.arrivalRateMultiplier || 1.0;
        const effectiveTarget = Math.floor(config.targetPeopleCount * arrivalMultiplier);
        if (activeCount < effectiveTarget) {
          const spawnChance = Math.min(0.5, (effectiveTarget - activeCount) / effectiveTarget) * arrivalMultiplier;
          if (Math.random() < spawnChance * dt * 2) {
            simulatorV2.spawnAgent();
          }
        }
        
        // Update simulation
        simulatorV2.update(dt);
        
        // Publish active customer agents
        const agents = simulatorV2.getActiveAgents();
        for (const agent of agents) {
          const message = agent.toMessage(config.deviceId, config.venueId);
          mqttClient.publish(
            `hyperspace/trajectories/${config.deviceId}`,
            JSON.stringify(message)
          );
          stats.tracksSent++;
        }
        
        // Publish active cashier agents
        const cashiers = simulatorV2.getActiveCashiers();
        for (const cashier of cashiers) {
          const message = cashier.toMessage(config.deviceId, config.venueId);
          mqttClient.publish(
            `hyperspace/trajectories/${config.deviceId}`,
            JSON.stringify(message)
          );
          stats.tracksSent++;
        }
        
        // Debug log all cashiers every 5 seconds
        if (!global.lastCashierLog || Date.now() - global.lastCashierLog > 5000) {
          global.lastCashierLog = Date.now();
          const allCashiers = simulatorV2.cashierAgents || [];
          console.log(`[Cashier Debug] Total: ${allCashiers.length}, Active: ${cashiers.length}`);
          for (const c of allCashiers) {
            console.log(`  Cashier ${c.id}: state=${c.state}, spawned=${c.spawned}, pos=(${c.x.toFixed(1)}, ${c.z.toFixed(1)}), lane=${c.laneId}`);
          }
        }
        
        // Prune exited agents periodically
        if (Math.random() < 0.01) {
          simulatorV2.pruneExitedAgents();
        }
        
        return;
      }

      // ========== V1 SIMULATION (fallback) ==========
      // Spawn new queue customers periodically
      if ((config.simulationMode === 'queue' || config.simulationMode === 'mixed') && 
          cashierZones.length > 0 &&
          now - lastQueueSpawnTime > config.queueSpawnInterval * 1000) {
        spawnQueuePerson();
        lastQueueSpawnTime = now;
      }

      // Count active people in scene
      const activePeople = people.filter(p => p.spawned && !p.done).length;
      
      // Spawn new people if below target (with rate limiting)
      if (activePeople < config.targetPeopleCount && people.length < config.targetPeopleCount * 2) {
        // Spawn rate: roughly 1 person per 2-5 seconds when below target
        const spawnChance = Math.min(0.5, (config.targetPeopleCount - activePeople) / config.targetPeopleCount);
        if (Math.random() < spawnChance * dt) {
          const newId = people.length > 0 ? Math.max(...people.map(p => p.id)) + 1 : 0;
          const newPerson = new Person(newId, config.venueWidth, config.venueDepth, 0);
          people.push(newPerson);
        }
      }

      // Update and publish random walkers
      for (let i = people.length - 1; i >= 0; i--) {
        const person = people[i];
        const alive = person.update(dt);
        
        if (alive && person.spawned) {
          // Only publish if person has actually spawned (not waiting in delay)
          const message = person.toMessage(config.deviceId, config.venueId);
          mqttClient.publish(
            `hyperspace/trajectories/${config.deviceId}`,
            JSON.stringify(message)
          );
          stats.tracksSent++;
        } else if (!alive) {
          // Person exited - remove from array (will be replaced by dynamic spawning)
          console.log(`Person ${person.id} exited after ${Math.floor(person.totalTime)}s`);
          people.splice(i, 1);
        }
      }

      // Update and publish queue customers
      queuePeople = queuePeople.filter((person) => {
        const alive = person.update(dt);
        if (alive) {
          const message = person.toMessage(config.deviceId, config.venueId);
          mqttClient.publish(
            `hyperspace/trajectories/${config.deviceId}`,
            JSON.stringify(message)
          );
          stats.tracksSent++;
        }
        return alive;
      });
    }, intervalMs);

    isRunning = true;
    const simType = config.useSimV2 ? 'V2 (navgrid+pathfinding)' : 'V1 (legacy)';
    console.log(`Simulation started: ${simType}, mode=${config.simulationMode}, target=${config.targetPeopleCount} at ${config.frequencyHz}Hz`);
    return { success: true, cashierZones: cashierZones.length, simVersion: config.useSimV2 ? 'V2' : 'V1' };
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
  if (simulatorV2) {
    simulatorV2.reset();
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

app.post('/api/config', async (req, res) => {
  const wasRunning = isRunning;
  console.log(`[API] POST /api/config from ${req.ip} - wasRunning=${wasRunning}, changes:`, Object.keys(req.body));
  if (wasRunning) {
    console.log('[API] Stopping simulation due to config change');
    stopSimulation();
  }

  config = { ...config, ...req.body };
  saveConfig();

  // Auto-restart if was running
  if (wasRunning) {
    console.log('[API] Auto-restarting simulation with new config');
    await new Promise(r => setTimeout(r, 500)); // Brief delay for cleanup
    await startSimulation();
  }

  res.json({ success: true, config, restarted: wasRunning });
});

app.get('/api/status', (req, res) => {
  let activePeopleCount;
  let simDiagnostics = null;
  
  if (config.useSimV2 && simulatorV2) {
    activePeopleCount = simulatorV2.getActiveCount();
    simDiagnostics = simulatorV2.getDiagnostics();
  } else {
    activePeopleCount = people.filter(p => p.spawned && !p.done).length + queuePeople.length;
  }
  
  res.json({
    isRunning,
    mqttConnected: stats.mqttConnected,
    tracksSent: stats.tracksSent,
    uptime: stats.startTime ? Math.floor((Date.now() - stats.startTime) / 1000) : 0,
    lastError: stats.lastError,
    activePeopleCount,
    simVersion: config.useSimV2 ? 'V2' : 'V1',
    simDiagnostics,
    config,
  });
});

app.get('/api/diagnostics', (req, res) => {
  if (!config.useSimV2 || !simulatorV2) {
    return res.json({ error: 'SimV2 not enabled', simVersion: 'V1' });
  }
  
  res.json({
    diagnostics: simulatorV2.getDiagnostics(),
    heatmap: simulatorV2.getHeatmap(),
  });
});

// Debug endpoint: full journey analysis with wireframe
app.get('/api/debug/journey', (req, res) => {
  if (!config.useSimV2 || !simulatorV2) {
    return res.json({ error: 'SimV2 not enabled' });
  }
  
  const debug = simulatorV2.debugFullJourney();
  
  // If text format requested, return plain text
  if (req.query.format === 'text') {
    res.type('text/plain');
    return res.send(debug.textWireframe + '\n\n' + debug.asciiGrid);
  }
  
  res.json(debug);
});

// Debug endpoint: list all agents with positions for overlap detection
app.get('/api/debug/agents', (req, res) => {
  if (!config.useSimV2 || !simulatorV2) {
    return res.json({ error: 'SimV2 not enabled', simVersion: 'V1' });
  }
  
  const agents = simulatorV2.getActiveAgents();
  const agentData = agents.map(a => ({
    id: a.id,
    x: Math.round(a.x * 100) / 100,
    z: Math.round(a.z * 100) / 100,
    state: a.state,
    persona: a.persona,
    speed: Math.round(a.speed * 100) / 100,
    blocked: a.blockedFrames,
    nearbyAgents: a.nearbyAgentCount,
    queueState: a.queueSubState,
    isInQueue: a.isInQueueSystem,
  }));
  
  // Find overlapping agents (within 0.5m of each other)
  const overlaps = [];
  for (let i = 0; i < agentData.length; i++) {
    for (let j = i + 1; j < agentData.length; j++) {
      const a1 = agentData[i];
      const a2 = agentData[j];
      const dist = Math.sqrt(Math.pow(a1.x - a2.x, 2) + Math.pow(a1.z - a2.z, 2));
      if (dist < 0.5) {
        overlaps.push({
          agent1: a1.id,
          agent2: a2.id,
          distance: Math.round(dist * 100) / 100,
          pos1: { x: a1.x, z: a1.z },
          pos2: { x: a2.x, z: a2.z },
          states: [a1.state, a2.state],
        });
      }
    }
  }
  
  // Group agents by state
  const byState = {};
  for (const a of agentData) {
    byState[a.state] = (byState[a.state] || 0) + 1;
  }
  
  // Find stuck agents (high blocked frames)
  const stuckAgents = agentData.filter(a => a.blocked > 30);
  
  res.json({
    totalActive: agents.length,
    byState,
    overlaps,
    overlapCount: overlaps.length,
    stuckAgents,
    stuckCount: stuckAgents.length,
    agents: agentData,
  });
});

// ========== CHECKOUT MANAGER API ENDPOINTS ==========

// Get checkout lanes status
app.get('/api/checkout/status', (req, res) => {
  if (!config.useSimV2 || !simulatorV2) {
    return res.status(400).json({ error: 'SimV2 not enabled' });
  }
  
  if (!config.enableCheckoutManager) {
    return res.status(400).json({ error: 'Checkout Manager not enabled' });
  }
  
  const laneStateController = simulatorV2.laneStateController;
  if (!laneStateController) {
    return res.status(400).json({ error: 'LaneStateController not initialized' });
  }
  
  res.json({
    lanes: laneStateController.getAllLaneStatus(),
    pressure: laneStateController.getQueuePressure(),
    thresholds: {
      queuePressureThreshold: laneStateController.config.queuePressureThreshold,
      inflowRateThreshold: laneStateController.config.inflowRateThreshold,
    }
  });
});

// Set lane state (open/close)
app.post('/api/checkout/set_lane_state', (req, res) => {
  if (!config.useSimV2 || !simulatorV2) {
    return res.status(400).json({ error: 'SimV2 not enabled' });
  }
  
  if (!config.enableCheckoutManager) {
    return res.status(400).json({ error: 'Checkout Manager not enabled' });
  }
  
  const laneStateController = simulatorV2.laneStateController;
  if (!laneStateController) {
    return res.status(400).json({ error: 'LaneStateController not initialized' });
  }
  
  const { laneId, state } = req.body;
  if (laneId === undefined || !state) {
    return res.status(400).json({ error: 'laneId and state are required' });
  }
  
  console.log(`[Checkout Manager] Setting lane ${laneId} to ${state}`);
  const result = laneStateController.setLaneState(laneId, state);
  res.json(result);
});

// Update thresholds
app.post('/api/checkout/thresholds', (req, res) => {
  if (!config.useSimV2 || !simulatorV2) {
    return res.status(400).json({ error: 'SimV2 not enabled' });
  }
  
  if (!config.enableCheckoutManager) {
    return res.status(400).json({ error: 'Checkout Manager not enabled' });
  }
  
  const laneStateController = simulatorV2.laneStateController;
  if (!laneStateController) {
    return res.status(400).json({ error: 'LaneStateController not initialized' });
  }
  
  const { queuePressureThreshold, inflowRateThreshold } = req.body;
  laneStateController.updateThresholds({ queuePressureThreshold, inflowRateThreshold });
  
  // Also save to config
  if (queuePressureThreshold !== undefined) {
    config.queuePressureThreshold = queuePressureThreshold;
  }
  if (inflowRateThreshold !== undefined) {
    config.inflowRateThreshold = inflowRateThreshold;
  }
  saveConfig();
  
  res.json({ 
    success: true, 
    thresholds: {
      queuePressureThreshold: laneStateController.config.queuePressureThreshold,
      inflowRateThreshold: laneStateController.config.inflowRateThreshold,
    }
  });
});

// ========== END CHECKOUT MANAGER API ==========

app.post('/api/start', async (req, res) => {
  const result = await startSimulation();
  res.json(result);
});

app.post('/api/stop', (req, res) => {
  console.log(`[API] POST /api/stop from ${req.ip} - stopping simulation`);
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
