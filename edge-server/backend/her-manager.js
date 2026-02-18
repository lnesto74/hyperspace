/**
 * HER Manager - Hyperspace Edge Runtime Manager
 * 
 * Manages algorithm provider Docker containers on the edge device.
 * All providers MUST be Docker images - .deb packages are converted to Docker
 * images via the Conversion Service on the backend server, not installed on host.
 * 
 * Responsible for:
 * - Pulling provider Docker images
 * - Starting/stopping provider containers
 * - Monitoring container health
 * - Writing extrinsics config for providers
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

// Container configuration
const CONTAINER_NAME = 'her-provider';
const CONFIG_MOUNT_PATH = '/config';
const CONFIG_FILENAME = 'extrinsics.json';

// HER Manager state
let herState = {
  mode: 'simulator', // 'simulator' | 'her'
  containerRunning: false,
  containerStatus: null, // 'pulling' | 'starting' | 'running' | 'stopped' | 'error'
  lastError: null,
  providerModule: null, // { providerId, name, version, dockerImage }
  deploymentId: null,
  startedAt: null,
  lastHealthCheck: null,
};

// Data directory for config persistence
const DATA_DIR = process.env.HER_DATA_DIR || path.join(process.cwd(), 'data');
const HER_CONFIG_FILE = path.join(DATA_DIR, 'her-config.json');
const EXTRINSICS_FILE = path.join(DATA_DIR, CONFIG_FILENAME);

/**
 * Initialize HER Manager
 */
export function initHerManager() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  
  // Load persisted state
  try {
    if (fs.existsSync(HER_CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(HER_CONFIG_FILE, 'utf-8'));
      herState = { ...herState, ...saved };
      console.log('[HER] Loaded persisted state:', herState.mode, herState.containerStatus);
    }
  } catch (err) {
    console.error('[HER] Failed to load persisted state:', err.message);
  }
  
  // Check if container is actually running (in case of edge restart)
  checkContainerStatus().then(() => {
    console.log('[HER] Manager initialized, mode:', herState.mode);
  });
  
  // Start health check interval
  setInterval(healthCheck, 30000); // Check every 30 seconds
}

/**
 * Save HER state to disk
 */
function saveState() {
  try {
    fs.writeFileSync(HER_CONFIG_FILE, JSON.stringify(herState, null, 2));
  } catch (err) {
    console.error('[HER] Failed to save state:', err.message);
  }
}

/**
 * Check if Docker is available
 */
export async function checkDockerAvailable() {
  try {
    const { stdout } = await execAsync('docker --version');
    console.log('[HER] Docker available:', stdout.trim());
    return { available: true, version: stdout.trim() };
  } catch (err) {
    console.error('[HER] Docker not available:', err.message);
    return { available: false, error: err.message };
  }
}

/**
 * Check container status
 */
async function checkContainerStatus() {
  try {
    const { stdout } = await execAsync(`docker inspect --format='{{.State.Status}}' ${CONTAINER_NAME} 2>/dev/null || echo 'not_found'`);
    const status = stdout.trim();
    
    if (status === 'not_found' || status === '') {
      herState.containerRunning = false;
      herState.containerStatus = herState.mode === 'her' ? 'stopped' : null;
    } else if (status === 'running') {
      herState.containerRunning = true;
      herState.containerStatus = 'running';
    } else {
      herState.containerRunning = false;
      herState.containerStatus = status; // 'exited', 'created', etc.
    }
    
    herState.lastHealthCheck = new Date().toISOString();
    return herState.containerStatus;
  } catch (err) {
    console.error('[HER] Error checking container status:', err.message);
    return null;
  }
}

/**
 * Health check for HER container
 */
async function healthCheck() {
  if (herState.mode !== 'her') return;
  
  const previousStatus = herState.containerStatus;
  await checkContainerStatus();
  
  // If container was running but now stopped, mark as error
  if (previousStatus === 'running' && !herState.containerRunning) {
    herState.containerStatus = 'error';
    herState.lastError = 'Container stopped unexpectedly';
    console.error('[HER] Container stopped unexpectedly');
    saveState();
  }
}

/**
 * Pull Docker image
 */
async function pullImage(dockerImage) {
  console.log(`[HER] Pulling image: ${dockerImage}`);
  herState.containerStatus = 'pulling';
  saveState();
  
  try {
    const { stdout, stderr } = await execAsync(`docker pull ${dockerImage}`, {
      timeout: 300000, // 5 minute timeout for large images
    });
    console.log('[HER] Image pulled successfully');
    return { success: true, output: stdout };
  } catch (err) {
    console.error('[HER] Failed to pull image:', err.message);
    herState.containerStatus = 'error';
    herState.lastError = `Failed to pull image: ${err.message}`;
    saveState();
    return { success: false, error: err.message };
  }
}

/**
 * Stop and remove existing container
 */
async function stopContainer() {
  console.log('[HER] Stopping existing container...');
  
  try {
    // Stop container if running
    await execAsync(`docker stop ${CONTAINER_NAME} 2>/dev/null || true`);
    // Remove container
    await execAsync(`docker rm ${CONTAINER_NAME} 2>/dev/null || true`);
    
    herState.containerRunning = false;
    herState.containerStatus = 'stopped';
    console.log('[HER] Container stopped and removed');
    return { success: true };
  } catch (err) {
    console.error('[HER] Error stopping container:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Start provider container
 */
async function startContainer(dockerImage, envVars = {}) {
  console.log(`[HER] Starting container: ${dockerImage}`);
  herState.containerStatus = 'starting';
  saveState();
  
  try {
    // Build environment variable flags
    const envFlags = Object.entries(envVars)
      .map(([key, value]) => `-e ${key}="${value}"`)
      .join(' ');
    
    // Run container with:
    // - Host network (access to LiDARs on LAN and local MQTT)
    // - Config volume mounted
    // - Auto-restart disabled (we handle failures manually)
    const cmd = `docker run -d \
      --name ${CONTAINER_NAME} \
      --network host \
      -v ${DATA_DIR}:${CONFIG_MOUNT_PATH}:ro \
      ${envFlags} \
      ${dockerImage}`;
    
    console.log('[HER] Running:', cmd);
    const { stdout } = await execAsync(cmd);
    const containerId = stdout.trim();
    
    console.log(`[HER] Container started: ${containerId.substring(0, 12)}`);
    
    herState.containerRunning = true;
    herState.containerStatus = 'running';
    herState.startedAt = new Date().toISOString();
    herState.lastError = null;
    saveState();
    
    return { success: true, containerId };
  } catch (err) {
    console.error('[HER] Failed to start container:', err.message);
    herState.containerStatus = 'error';
    herState.lastError = `Failed to start container: ${err.message}`;
    saveState();
    return { success: false, error: err.message };
  }
}

/**
 * Write extrinsics config for provider
 */
function writeExtrinsicsConfig(deployment) {
  try {
    fs.writeFileSync(EXTRINSICS_FILE, JSON.stringify(deployment, null, 2));
    console.log('[HER] Extrinsics config written to:', EXTRINSICS_FILE);
    return { success: true };
  } catch (err) {
    console.error('[HER] Failed to write extrinsics config:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Deploy HER with provider module (Docker only)
 * 
 * All providers MUST be Docker images. If a vendor provides a .deb package,
 * use the Conversion Service on the backend to build a Docker image first.
 * 
 * @param {Object} payload - Deployment payload
 * @param {Object} payload.deployment - Extrinsics package
 * @param {Object} payload.providerModule - Provider module info (must have dockerImage)
 * @param {Function} onSimulatorStop - Callback to stop simulator
 * @returns {Object} Deploy result
 */
export async function deployHer(payload, onSimulatorStop) {
  const { deployment, providerModule } = payload;
  
  console.log('[HER] ========== HER DEPLOY START ==========');
  console.log('[HER] Deployment ID:', deployment.deploymentId);
  console.log('[HER] Provider:', providerModule.name, providerModule.version);
  console.log('[HER] Docker image:', providerModule.dockerImage);
  
  // Validate provider has Docker image
  if (!providerModule.dockerImage) {
    return {
      ok: false,
      error: 'Provider must have a Docker image',
      message: 'All providers must be Docker images. Use the Conversion Service to convert .deb packages.',
    };
  }
  
  // Check Docker availability
  const dockerCheck = await checkDockerAvailable();
  if (!dockerCheck.available) {
    return {
      ok: false,
      error: 'Docker not available on edge device',
      message: dockerCheck.error,
    };
  }
  
  // Step 1: Stop simulator
  console.log('[HER] Step 1: Stopping simulator...');
  if (onSimulatorStop) {
    try {
      onSimulatorStop();
      console.log('[HER] Simulator stopped');
    } catch (err) {
      console.error('[HER] Error stopping simulator:', err.message);
    }
  }
  
  // Step 2: Write extrinsics config
  console.log('[HER] Step 2: Writing extrinsics config...');
  const configResult = writeExtrinsicsConfig(deployment);
  if (!configResult.success) {
    return {
      ok: false,
      error: 'Failed to write extrinsics config',
      message: configResult.error,
    };
  }
  
  // Step 3: Stop existing container
  console.log('[HER] Step 3: Stopping existing container...');
  await stopContainer();
  
  // Step 4: Pull image
  console.log('[HER] Step 4: Pulling provider image...');
  const pullResult = await pullImage(providerModule.dockerImage);
  if (!pullResult.success) {
    return {
      ok: false,
      error: 'Failed to pull provider image',
      message: pullResult.error,
    };
  }
  
  // Step 5: Start container with environment variables
  console.log('[HER] Step 5: Starting provider container...');
  const envVars = {
    MQTT_BROKER: deployment.mqtt?.broker || 'mqtt://localhost:1883',
    MQTT_TOPIC: deployment.mqtt?.topic || `hyperspace/trajectories/${deployment.edgeId}`,
    MQTT_QOS: deployment.mqtt?.qos || 1,
    EDGE_ID: deployment.edgeId,
    VENUE_ID: deployment.venueId,
    CONFIG_FILE: `${CONFIG_MOUNT_PATH}/${CONFIG_FILENAME}`,
  };
  
  const startResult = await startContainer(providerModule.dockerImage, envVars);
  if (!startResult.success) {
    return {
      ok: false,
      error: 'Failed to start provider container',
      message: startResult.error,
    };
  }
  
  // Update state
  herState.mode = 'her';
  herState.providerModule = providerModule;
  herState.deploymentId = deployment.deploymentId;
  saveState();
  
  console.log('[HER] ========== HER DEPLOY SUCCESS ==========');
  
  return {
    ok: true,
    message: 'HER deployed successfully',
    moduleStatus: {
      containerRunning: true,
      imagePulled: true,
      containerId: startResult.containerId,
      provider: providerModule.name,
      version: providerModule.version,
    },
  };
}

/**
 * Stop HER and optionally resume simulator
 * 
 * @param {Function} onSimulatorResume - Callback to resume simulator
 * @returns {Object} Stop result
 */
export async function stopHer(onSimulatorResume) {
  console.log('[HER] ========== HER STOP ==========');
  
  // Stop Docker container
  console.log('[HER] Stopping Docker container...');
  await stopContainer();
  
  // Update state
  herState.mode = 'simulator';
  herState.containerStatus = null;
  herState.providerModule = null;
  herState.deploymentId = null;
  herState.startedAt = null;
  herState.lastError = null;
  saveState();
  
  // Resume simulator if callback provided
  if (onSimulatorResume) {
    console.log('[HER] Resuming simulator...');
    try {
      onSimulatorResume();
      console.log('[HER] Simulator resumed');
    } catch (err) {
      console.error('[HER] Error resuming simulator:', err.message);
    }
  }
  
  console.log('[HER] ========== HER STOPPED ==========');
  
  return {
    ok: true,
    message: 'HER stopped, simulator mode active',
    mode: 'simulator',
  };
}

/**
 * Get HER status
 */
export async function getHerStatus() {
  // Refresh container status
  await checkContainerStatus();
  
  // Get container logs (last 20 lines) if running
  let recentLogs = null;
  if (herState.mode === 'her') {
    try {
      const { stdout } = await execAsync(`docker logs --tail 20 ${CONTAINER_NAME} 2>&1 || echo ''`);
      recentLogs = stdout.trim();
    } catch (err) {
      recentLogs = null;
    }
  }
  
  // Calculate uptime
  let uptimeSeconds = null;
  if (herState.startedAt && herState.containerRunning) {
    uptimeSeconds = Math.floor((Date.now() - new Date(herState.startedAt).getTime()) / 1000);
  }
  
  return {
    mode: herState.mode,
    containerRunning: herState.containerRunning,
    containerStatus: herState.containerStatus,
    lastError: herState.lastError,
    providerModule: herState.providerModule,
    deploymentId: herState.deploymentId,
    startedAt: herState.startedAt,
    uptimeSeconds,
    lastHealthCheck: herState.lastHealthCheck,
    recentLogs,
  };
}

/**
 * Get current operational mode
 */
export function getMode() {
  return herState.mode;
}

/**
 * Check if HER is active (not simulator)
 */
export function isHerActive() {
  return herState.mode === 'her';
}

export default {
  initHerManager,
  checkDockerAvailable,
  deployHer,
  stopHer,
  getHerStatus,
  getMode,
  isHerActive,
};
