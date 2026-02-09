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
import { CashierAgent, CASHIER_STATE } from './cashieragent.js';
import { IDConfusionManager } from './idconfusion.js';

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
    
    // Agents (customers)
    this.agents = [];
    this.nextAgentId = 1;
    
    // Cashier agents
    this.cashierAgents = [];
    this.nextCashierId = 1;
    
    // Lane open/close state (ground truth)
    this.laneStates = [];
    
    // ID confusion manager (optional LiDAR tracking errors)
    this.idConfusion = new IDConfusionManager(this.rng);
    
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
    
    // Spawn cashiers if enabled
    if (this.config.ENABLE_CASHIER_AGENTS) {
      this.spawnCashiers();
      // Pass lane states to queue manager so it knows which lanes are open
      this.queueManager.setLaneStates(this.laneStates);
    }
    
    this.initialized = true;
    console.log('[SimV2] Initialization complete');
    console.log('[SimV2] NavGrid zones:', this.navGrid.zoneBounds);
  }
  
  // Spawn cashier agents for each lane
  spawnCashiers() {
    const cfg = this.config.cashierBehavior;
    if (!cfg || cfg.cashiersPerLane === 0) return;
    
    const cashiers = this.navGrid.cashiers || [];
    console.log(`[SimV2] Spawning cashiers for ${cashiers.length} lanes`);
    
    // Initialize lane states
    this.laneStates = cashiers.map((_, i) => ({
      laneId: i,
      isOpen: false,
      openSince: null,
      closedSince: null,
      cashierAgentId: null,
    }));
    
    for (let i = 0; i < cashiers.length; i++) {
      if (cfg.cashiersPerLane > 0) {
        const cashierAgent = new CashierAgent(
          this.nextCashierId++,
          i,  // laneId
          cashiers[i],  // cashier position {x, z}
          this.navGrid,
          this.pathPlanner,
          this.rng
        );
        
        this.cashierAgents.push(cashierAgent);
        this.laneStates[i].cashierAgentId = cashierAgent.id;
      }
    }
    
    console.log(`[SimV2] Spawned ${this.cashierAgents.length} cashier agents`);
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
    
    // Update all customer agents
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
    
    // Update cashier agents
    if (this.config.ENABLE_CASHIER_AGENTS) {
      for (const cashier of this.cashierAgents) {
        cashier.update(dt, this.cashierAgents);
        
        // Update lane open/close state
        if (cashier.laneId < this.laneStates.length) {
          const laneState = this.laneStates[cashier.laneId];
          const wasOpen = laneState.isOpen;
          laneState.isOpen = cashier.isLaneOpen();
          
          if (!wasOpen && laneState.isOpen) {
            laneState.openSince = Date.now();
            laneState.closedSince = null;
            console.log(`[SimV2] Lane ${cashier.laneId} OPENED`);
          } else if (wasOpen && !laneState.isOpen) {
            laneState.closedSince = Date.now();
            console.log(`[SimV2] Lane ${cashier.laneId} CLOSED`);
          }
        }
        
        // Update heatmap for cashiers too
        if (this.heatmap && cashier.spawned && cashier.state !== CASHIER_STATE.DONE) {
          const hx = Math.floor(cashier.x / this.config.heatmapResolution);
          const hz = Math.floor(cashier.z / this.config.heatmapResolution);
          if (hx >= 0 && hx < this.heatmapWidth && hz >= 0 && hz < this.heatmapDepth) {
            this.heatmap[hz * this.heatmapWidth + hx] += dt;
          }
        }
      }
    }
    
    // Update ID confusion simulation
    if (this.config.ENABLE_ID_CONFUSION) {
      this.idConfusion.update(
        this.getActiveAgents(),
        this.getActiveCashiers(),
        dt
      );
    }
    
    // Clean up old data periodically
    if (Math.random() < 0.01) {
      this.antiGlitch.clearOldData();
      this.gateManager.clearOldViolations();
    }
  }
  
  // Get active (spawned, not done) customer agents
  getActiveAgents() {
    return this.agents.filter(a => a.spawned && a.state !== STATE.DONE);
  }
  
  // Get active cashier agents
  getActiveCashiers() {
    return this.cashierAgents.filter(c => c.spawned && c.state !== CASHIER_STATE.DONE);
  }
  
  // Get all active agents (customers + cashiers)
  getAllActiveAgents() {
    const customers = this.getActiveAgents();
    const cashiers = this.getActiveCashiers();
    return [...customers, ...cashiers];
  }
  
  // Get count of active customer agents
  getActiveCount() {
    return this.agents.filter(a => a.spawned && a.state !== STATE.DONE).length;
  }
  
  // Get lane states (for external systems to know which lanes are open)
  getLaneStates() {
    return this.laneStates;
  }
  
  // Check if a specific lane is open
  isLaneOpen(laneId) {
    if (laneId < 0 || laneId >= this.laneStates.length) return false;
    return this.laneStates[laneId].isOpen;
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
      activeCashiers: this.getActiveCashiers().length,
      totalSpawned: this.stats.totalSpawned,
      totalExited: this.stats.totalExited,
      antiGlitch: antiGlitchDiag,
      gateViolations: gateViolations.length,
      laneStates: this.laneStates.map(ls => ({
        laneId: ls.laneId,
        isOpen: ls.isOpen,
      })),
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
    this.cashierAgents = [];
    this.nextCashierId = 1;
    this.laneStates = [];
    this.stats = { totalSpawned: 0, totalExited: 0, stuckEvents: 0, gateViolations: 0 };
    if (this.heatmap) this.heatmap.fill(0);
    this.rng = new SeededRandom(this.config.seed);
    this.idConfusion.reset();
    
    // Re-spawn cashiers if enabled
    if (this.config.ENABLE_CASHIER_AGENTS && this.initialized) {
      this.spawnCashiers();
    }
  }
  
  // Get all track messages (with optional ID confusion applied)
  getTrackMessages(deviceId, venueId) {
    const messages = [];
    
    // Customer tracks
    for (const agent of this.getActiveAgents()) {
      let msg = agent.toMessage(deviceId, venueId);
      
      // Apply ID confusion if enabled
      if (this.config.ENABLE_ID_CONFUSION) {
        msg = this.idConfusion.applyToMessage(msg);
      }
      
      if (msg) messages.push(msg);
    }
    
    // Cashier tracks
    for (const cashier of this.getActiveCashiers()) {
      let msg = cashier.toMessage(deviceId, venueId);
      
      // Apply ID confusion if enabled
      if (this.config.ENABLE_ID_CONFUSION) {
        msg = this.idConfusion.applyToMessage(msg);
      }
      
      if (msg) messages.push(msg);
    }
    
    return messages;
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
