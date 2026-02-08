/**
 * SimulatorV2 - Main simulation manager
 * Integrates NavGrid, AStar, Gates, AntiGlitch, and AgentV2
 */

import { SIM_CONFIG, SeededRandom } from './simconfig.js';
import NavGrid from './navgrid.js';
import AStar from './astar.js';
import GateManager from './gates.js';
import AntiGlitch from './antiglitch.js';
import { CheckoutQueueSubsystem } from './checkoutqueue.js';
import { AgentV2, STATE } from './agent.js';

export class SimulatorV2 {
  constructor(venueWidth, venueDepth, config = {}) {
    this.config = { ...SIM_CONFIG, ...config };
    this.rng = new SeededRandom(this.config.seed);
    
    this.venueWidth = venueWidth;
    this.venueDepth = venueDepth;
    
    // Core systems
    this.navGrid = new NavGrid(venueWidth, venueDepth, this.config.gridResolution);
    this.pathPlanner = new AStar(this.navGrid);
    this.gateManager = new GateManager(this.navGrid);
    this.antiGlitch = new AntiGlitch(this.navGrid);
    this.queueManager = new CheckoutQueueSubsystem(this.navGrid, this.rng);
    
    // Agents
    this.agents = [];
    this.nextAgentId = 1;
    
    // Stats
    this.stats = {
      totalSpawned: 0,
      totalExited: 0,
      stuckEvents: 0,
      gateViolations: 0,
    };
    
    // Heatmap
    this.heatmap = null;
    if (this.config.trackHeatmap) {
      const hRes = this.config.heatmapResolution;
      this.heatmapWidth = Math.ceil(venueWidth / hRes);
      this.heatmapDepth = Math.ceil(venueDepth / hRes);
      this.heatmap = new Float32Array(this.heatmapWidth * this.heatmapDepth);
    }
    
    this.initialized = false;
  }
  
  // Initialize from scene objects
  initFromScene(objects, rois = []) {
    console.log('[SimV2] Initializing from scene...');
    
    // Build navigation grid
    this.navGrid.buildFromScene(objects, rois);
    
    // Build directional gates
    this.gateManager.buildFromScene(objects);
    
    // Initialize queue manager
    this.queueManager.init();
    
    this.initialized = true;
    console.log('[SimV2] Initialization complete');
    console.log('[SimV2] NavGrid zones:', this.navGrid.zoneBounds);
  }
  
  // Spawn a new agent
  spawnAgent() {
    if (!this.initialized) return null;
    
    // Check max occupancy
    const activeCount = this.agents.filter(a => a.state !== STATE.DONE).length;
    if (activeCount >= this.config.maxOccupancy) {
      return null;
    }
    
    const agent = new AgentV2(
      this.nextAgentId++,
      this.navGrid,
      this.pathPlanner,
      this.gateManager,
      this.antiGlitch,
      this.queueManager,
      this.rng
    );
    
    this.agents.push(agent);
    this.stats.totalSpawned++;
    
    return agent;
  }
  
  // Update simulation
  update(dt) {
    if (!this.initialized) return;
    
    // Update queue subsystem
    this.queueManager.update(dt);
    
    // Update all agents
    for (const agent of this.agents) {
      const wasActive = agent.state !== STATE.DONE;
      agent.update(dt, this.agents);
      
      if (wasActive && agent.state === STATE.DONE) {
        this.stats.totalExited++;
      }
      
      // Update heatmap
      if (this.heatmap && agent.spawned && agent.state !== STATE.DONE) {
        const hx = Math.floor(agent.x / this.config.heatmapResolution);
        const hz = Math.floor(agent.z / this.config.heatmapResolution);
        if (hx >= 0 && hx < this.heatmapWidth && hz >= 0 && hz < this.heatmapDepth) {
          this.heatmap[hz * this.heatmapWidth + hx] += dt;
        }
      }
    }
    
    // Clean up old data periodically
    if (Math.random() < 0.01) {
      this.antiGlitch.clearOldData();
      this.gateManager.clearOldViolations();
    }
  }
  
  // Get active (spawned, not done) agents
  getActiveAgents() {
    return this.agents.filter(a => a.spawned && a.state !== STATE.DONE);
  }
  
  // Get count of active agents
  getActiveCount() {
    return this.agents.filter(a => a.spawned && a.state !== STATE.DONE).length;
  }
  
  // Remove exited agents (to free memory)
  pruneExitedAgents() {
    const before = this.agents.length;
    this.agents = this.agents.filter(a => a.state !== STATE.DONE);
    return before - this.agents.length;
  }
  
  // Get diagnostics
  getDiagnostics() {
    const antiGlitchDiag = this.antiGlitch.getDiagnostics();
    const gateViolations = this.gateManager.getViolations(Date.now() - 60000);
    
    return {
      activeAgents: this.getActiveCount(),
      totalSpawned: this.stats.totalSpawned,
      totalExited: this.stats.totalExited,
      antiGlitch: antiGlitchDiag,
      gateViolations: gateViolations.length,
      navGrid: {
        width: this.navGrid.gridWidth,
        depth: this.navGrid.gridDepth,
        cashiers: this.navGrid.cashiers.length,
        safeWaypoints: {
          entrance: this.navGrid.safeWaypoints.entrance.length,
          bypass: this.navGrid.safeWaypoints.bypass.length,
          shopping: this.navGrid.safeWaypoints.shopping.length,
          aisles: this.navGrid.safeWaypoints.aisles.length,
        },
      },
    };
  }
  
  // Get heatmap data
  getHeatmap() {
    if (!this.heatmap) return null;
    
    // Normalize and convert to array
    const max = Math.max(...this.heatmap) || 1;
    const normalized = [];
    
    for (let z = 0; z < this.heatmapDepth; z++) {
      const row = [];
      for (let x = 0; x < this.heatmapWidth; x++) {
        row.push(this.heatmap[z * this.heatmapWidth + x] / max);
      }
      normalized.push(row);
    }
    
    return {
      width: this.heatmapWidth,
      depth: this.heatmapDepth,
      resolution: this.config.heatmapResolution,
      data: normalized,
    };
  }
  
  // Reset simulation
  reset() {
    this.agents = [];
    this.nextAgentId = 1;
    this.stats = { totalSpawned: 0, totalExited: 0, stuckEvents: 0, gateViolations: 0 };
    if (this.heatmap) this.heatmap.fill(0);
    this.rng = new SeededRandom(this.config.seed);
  }
  
  // Debug: print navgrid
  printNavGrid() {
    console.log(this.navGrid.toAscii());
  }
  
  // Debug: generate full customer journey analysis
  debugFullJourney() {
    const debug = {
      venue: {
        width: this.venueWidth,
        depth: this.venueDepth,
        gridWidth: this.navGrid.gridWidth,
        gridDepth: this.navGrid.gridDepth,
        resolution: this.navGrid.resolution,
      },
      zones: this.navGrid.zoneBounds,
      entrance: this.navGrid.entrancePos,
      cashiers: this.navGrid.cashiers,
      blockedObjects: this.navGrid.getBlockedObjectsDebug(),
      wireframe: this.navGrid.toWireframe(),
      sampleJourney: null,
      collisions: [],
    };
    
    // Generate a sample complete journey
    const entrance = this.navGrid.entrancePos;
    const bypass = this.navGrid.zoneBounds.bypassCorridorX;
    const shopMinZ = this.navGrid.zoneBounds.shoppingMinZ;
    const shopMaxZ = this.navGrid.zoneBounds.shoppingMaxZ;
    const cashierZ = this.navGrid.zoneBounds.cashierLineZ;
    
    // Sample waypoints for a complete journey
    const journeyWaypoints = [];
    
    // 1. ENTRY: entrance -> bypass corridor
    journeyWaypoints.push({ phase: 'ENTRY_START', ...entrance });
    const bypassEntry = { x: bypass, z: 3 };
    journeyWaypoints.push({ phase: 'ENTRY_BYPASS', ...bypassEntry });
    
    // 2. ENTERING: bypass -> shopping zone
    const shopEntry = { x: bypass, z: shopMinZ };
    journeyWaypoints.push({ phase: 'ENTERING_SHOP', ...shopEntry });
    
    // 3. BROWSING: navigate through shopping area (sample 3 stops)
    const shopCenterX = (this.navGrid.zoneBounds.shoppingMinX + this.navGrid.zoneBounds.shoppingMaxX) / 2;
    journeyWaypoints.push({ phase: 'BROWSING_1', x: shopCenterX - 5, z: shopMinZ + 5 });
    journeyWaypoints.push({ phase: 'BROWSING_2', x: shopCenterX + 5, z: (shopMinZ + shopMaxZ) / 2 });
    journeyWaypoints.push({ phase: 'BROWSING_3', x: shopCenterX, z: shopMaxZ - 3 });
    
    // 4. QUEUING: go to cashier
    const cashier = this.navGrid.cashiers[0] || { x: this.venueWidth / 2 };
    const queuePos = { x: cashier.x, z: cashierZ + 3 };
    journeyWaypoints.push({ phase: 'QUEUING', ...queuePos });
    
    // 5. CHECKOUT: at cashier
    const checkoutPos = { x: cashier.x, z: cashierZ + 1 };
    journeyWaypoints.push({ phase: 'CHECKOUT', ...checkoutPos });
    
    // 6. EXITING: cashier -> entrance
    const exitPos = { x: cashier.x, z: cashierZ - 2 };
    journeyWaypoints.push({ phase: 'EXIT_PAST_CASHIER', ...exitPos });
    journeyWaypoints.push({ phase: 'EXIT_END', ...entrance });
    
    debug.sampleJourney = journeyWaypoints;
    
    // Now compute actual A* paths between waypoints and check for collisions
    const fullPath = [];
    const pathSegments = [];
    
    for (let i = 0; i < journeyWaypoints.length - 1; i++) {
      const from = journeyWaypoints[i];
      const to = journeyWaypoints[i + 1];
      
      const path = this.pathPlanner.findPath(from.x, from.z, to.x, to.z, { smooth: true });
      
      if (path) {
        // Check for collisions along this path
        const segmentCollisions = this.navGrid.tracePathCollisions(path);
        
        pathSegments.push({
          from: from.phase,
          to: to.phase,
          waypoints: path,
          waypointCount: path.length,
          collisions: segmentCollisions,
        });
        
        if (segmentCollisions.length > 0) {
          debug.collisions.push({
            segment: `${from.phase} -> ${to.phase}`,
            collisionCount: segmentCollisions.length,
            firstCollision: segmentCollisions[0],
          });
        }
        
        fullPath.push(...path);
      } else {
        pathSegments.push({
          from: from.phase,
          to: to.phase,
          error: 'NO_PATH_FOUND',
        });
      }
    }
    
    debug.pathSegments = pathSegments;
    debug.fullPathWaypointCount = fullPath.length;
    
    // Generate text wireframe
    debug.asciiGrid = this.navGrid.toAscii();
    
    // Generate text representation of journey with coordinates
    let textWireframe = '=== WIREFRAME JOURNEY ===\n\n';
    textWireframe += `Venue: ${this.venueWidth}m x ${this.venueDepth}m (grid: ${this.navGrid.gridWidth}x${this.navGrid.gridDepth} cells, res: ${this.navGrid.resolution}m)\n\n`;
    
    textWireframe += '--- BLOCKED OBJECTS (SHELVES/WALLS) ---\n';
    for (const obj of debug.blockedObjects) {
      textWireframe += `  ${obj.name} (${obj.type}):\n`;
      textWireframe += `    Center: (${obj.centerX.toFixed(2)}, ${obj.centerZ.toFixed(2)})\n`;
      textWireframe += `    Scale: ${obj.width.toFixed(2)} x ${obj.depth.toFixed(2)}, rot: ${(obj.rotation * 180 / Math.PI).toFixed(1)}°\n`;
      textWireframe += `    Bounds: X[${obj.minX.toFixed(2)}, ${obj.maxX.toFixed(2)}] Z[${obj.minZ.toFixed(2)}, ${obj.maxZ.toFixed(2)}]\n`;
      textWireframe += `    Cells blocked: ${obj.cellsBlocked}\n`;
    }
    
    textWireframe += '\n--- SAMPLE JOURNEY PATH ---\n';
    for (const seg of pathSegments) {
      textWireframe += `\n[${seg.from}] -> [${seg.to}]\n`;
      if (seg.error) {
        textWireframe += `  ERROR: ${seg.error}\n`;
      } else {
        textWireframe += `  Waypoints: ${seg.waypointCount}\n`;
        for (let w = 0; w < seg.waypoints.length; w++) {
          const wp = seg.waypoints[w];
          textWireframe += `    ${w}: (${wp.x.toFixed(2)}, ${wp.z.toFixed(2)})\n`;
        }
        if (seg.collisions.length > 0) {
          textWireframe += `  ⚠️ COLLISIONS: ${seg.collisions.length}\n`;
          for (const c of seg.collisions.slice(0, 3)) {
            textWireframe += `    @ (${c.x.toFixed(2)}, ${c.z.toFixed(2)})\n`;
          }
        }
      }
    }
    
    if (debug.collisions.length > 0) {
      textWireframe += '\n=== ⚠️ COLLISION SUMMARY ===\n';
      for (const c of debug.collisions) {
        textWireframe += `  ${c.segment}: ${c.collisionCount} collisions\n`;
      }
    } else {
      textWireframe += '\n=== ✅ NO COLLISIONS DETECTED ===\n';
    }
    
    debug.textWireframe = textWireframe;
    
    return debug;
  }
}

export default SimulatorV2;
