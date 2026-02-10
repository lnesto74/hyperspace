/**
 * AgentV2 - State machine based agent
 */

import { SIM_CONFIG, selectPersona } from './simconfig.js';
import { QUEUE_STATE } from './checkoutqueue.js';

export const STATE = {
  SPAWN: 'SPAWN',
  ENTERING: 'ENTERING',
  BROWSING: 'BROWSING',
  // Simple queue states
  WALKING_TO_QUEUE: 'WALKING_TO_QUEUE',  // Walking to queue position
  IN_QUEUE: 'IN_QUEUE',                   // Waiting in queue
  SERVICE: 'SERVICE',                      // Being served
  // Legacy states (kept for compatibility)
  QUEUE_DECISION: 'QUEUE_DECISION',
  QUEUE_BUFFER_WAIT: 'QUEUE_BUFFER_WAIT', 
  QUEUE_JOIN_TAIL: 'QUEUE_JOIN_TAIL',
  QUEUE_ADVANCE: 'QUEUE_ADVANCE',
  EXIT_FAST: 'EXIT_FAST',
  QUEUING: 'QUEUING',
  CHECKOUT: 'CHECKOUT',
  EXITING: 'EXITING',
  DONE: 'DONE',
};

// Re-export QUEUE_STATE for convenience
export { QUEUE_STATE };

export class AgentV2 {
  constructor(id, navGrid, pathPlanner, gateManager, antiGlitch, queueManager, rng, pressureConfig = {}) {
    this.id = id;
    this.navGrid = navGrid;
    this.pathPlanner = pathPlanner;
    this.gateManager = gateManager;
    this.antiGlitch = antiGlitch;
    this.queueManager = queueManager;
    this.rng = rng;
    
    // Queue pressure multipliers (for KPI-driven simulation)
    const checkoutProbMult = pressureConfig.checkoutProbMultiplier || 1.0;
    const browsingSpeedMult = pressureConfig.browsingSpeedMultiplier || 1.0;
    
    this.persona = selectPersona(rng);
    const cfg = SIM_CONFIG.personas[this.persona];
    
    this.baseSpeed = rng.range(cfg.speedRange[0], cfg.speedRange[1]);
    this.numStops = rng.rangeInt(cfg.stopsRange[0], cfg.stopsRange[1]);
    // Apply browsing speed multiplier: higher = less time browsing = faster to checkout
    this.targetStayTime = rng.range(cfg.stayTimeMinRange[0], cfg.stayTimeMinRange[1]) * 60 / browsingSpeedMult;
    // Apply checkout probability multiplier: higher = more likely to checkout
    const adjustedCheckoutProb = Math.min(1.0, cfg.checkoutProb * checkoutProbMult);
    this.willCheckout = rng.next() < adjustedCheckoutProb;
    
    this.x = navGrid.entrancePos.x;
    this.z = navGrid.entrancePos.z;
    this.vx = 0;
    this.vz = 0;
    this.speed = this.baseSpeed;
    this.heading = 0;
    
    this.state = STATE.SPAWN;
    this.stateTime = 0;
    this.totalTime = 0;
    
    this.path = [];
    this.currentPathIndex = 0;
    this.targetX = this.x;
    this.targetZ = this.z;
    
    this.browsingTargets = [];
    this.currentBrowsingIndex = 0;
    
    this.dwellTimer = 0;
    this.dwellDuration = 0;
    this.isDwelling = false;
    this.selectedCashier = 0;
    
    this.personalSpaceRadius = SIM_CONFIG.personalSpaceRadius;
    this.personalSpaceMultiplier = 1.0;
    this.personalSpaceRestoreTime = 0;
    
    this.wobblePhase = rng.next() * Math.PI * 2;
    this.wobbleFreq = 1.5 + rng.next();
    this.wobbleAmount = 0.08;
    
    this.color = this.getPersonaColor();
    this.width = 0.4 + rng.next() * 0.2;
    this.height = 1.6 + rng.next() * 0.3;
    
    this.spawnDelay = rng.next() * 2;
    this.spawned = false;
    
    // Queue behavior state
    this.queueSubState = QUEUE_STATE.NONE;
    this.isInQueueSystem = false;
    this.exitSpeedMultiplier = 1.0;
    
    // Stuck detection
    this.blockedFrames = 0;
    this.agentBlockedFrames = 0;
    this.nearbyAgentCount = 0;
    
    antiGlitch.initAgent(id);
  }
  
  getPersonaColor() {
    const c = { fastBuyer: '#22c55e', browser: '#3b82f6', family: '#f59e0b', staff: '#8b5cf6' };
    return c[this.persona] || '#6b7280';
  }
  
  update(dt, allAgents) {
    if (this.state === STATE.DONE) return false;
    
    this.totalTime += dt;
    this.stateTime += dt;
    
    if (!this.spawned) {
      this.spawnDelay -= dt;
      if (this.spawnDelay <= 0) {
        this.spawned = true;
        this.transitionTo(STATE.ENTERING);
      }
      return true;
    }
    
    if (this.personalSpaceRestoreTime > 0) {
      this.personalSpaceRestoreTime -= dt;
      if (this.personalSpaceRestoreTime <= 0) this.personalSpaceMultiplier = 1.0;
    }
    
    switch (this.state) {
      case STATE.ENTERING: this.updateEntering(dt, allAgents); break;
      case STATE.BROWSING: this.updateBrowsing(dt, allAgents); break;
      // Simple queue states
      case STATE.WALKING_TO_QUEUE: this.updateWalkingToQueue(dt, allAgents); break;
      case STATE.IN_QUEUE: this.updateInQueue(dt, allAgents); break;
      case STATE.SERVICE: this.updateService(dt, allAgents); break;
      // Legacy - redirect to simple system
      case STATE.QUEUE_DECISION:
      case STATE.QUEUE_BUFFER_WAIT:
      case STATE.QUEUE_JOIN_TAIL:
      case STATE.QUEUE_ADVANCE:
      case STATE.QUEUING:
        this.transitionTo(STATE.WALKING_TO_QUEUE);
        break;
      case STATE.EXIT_FAST:
      case STATE.CHECKOUT:
      case STATE.EXITING: 
        this.updateExiting(dt, allAgents); 
        break;
    }
    
    const recovery = this.antiGlitch.update(this, dt);
    if (recovery) {
      const replan = this.antiGlitch.applyRecovery(this, recovery, this.rng);
      if (replan) this.replanPath();
    }
    
    return true;
  }
  
  transitionTo(newState) {
    this.state = newState;
    this.stateTime = 0;
    
    switch (newState) {
      case STATE.ENTERING: this.planEntryPath(); break;
      case STATE.BROWSING: this.selectBrowsingTargets(); this.planNextBrowsingPath(); break;
      
      // Simple queue states
      case STATE.WALKING_TO_QUEUE:
        this.isInQueueSystem = true;
        this.queueManager.startQueueDecision(this.id, this);
        this.planPathToQueue();
        break;
        
      case STATE.IN_QUEUE:
        // Notify queue subsystem that agent has arrived at queue position
        this.queueManager.setAgentInQueue(this.id);
        this.speed = 0;
        break;
        
      case STATE.SERVICE:
        console.log(`[Agent ${this.id}] ENTERING SERVICE at pos (${this.x.toFixed(1)}, ${this.z.toFixed(1)})`);
        this.queueManager.startService(this.id, this);
        this.speed = 0;
        this.vx = 0;
        this.vz = 0;
        break;
      
      // Legacy states - redirect
      case STATE.QUEUING:
      case STATE.QUEUE_DECISION:
        this.transitionTo(STATE.WALKING_TO_QUEUE);
        return;
      case STATE.CHECKOUT: this.startCheckout(); break;
      case STATE.EXITING: 
      case STATE.EXIT_FAST:
        console.log(`[Agent ${this.id}] EXITING from pos (${this.x.toFixed(1)}, ${this.z.toFixed(1)})`);
        this.queueManager.removeAgent(this.id);
        this.isInQueueSystem = false;
        this.planExitPath();
        console.log(`[Agent ${this.id}] Exit path planned, first target: ${this.path && this.path[0] ? `(${this.path[0].x.toFixed(1)}, ${this.path[0].z.toFixed(1)})` : 'NONE'}`);
        break;
      case STATE.DONE: 
        this.queueManager.removeAgent(this.id);
        this.isInQueueSystem = false;
        this.antiGlitch.removeAgent(this.id); 
        break;
    }
  }
  
  planEntryPath() {
    const bypass = this.navGrid.zoneBounds.bypassCorridorX;
    const shopZ = this.navGrid.zoneBounds.shoppingMinZ;
    const p1 = this.pathPlanner.findPath(this.x, this.z, bypass, 3);
    const p2 = this.pathPlanner.findPath(bypass, 3, bypass, shopZ);
    this.path = p1 && p2 ? [...p1, ...p2.slice(1)] : [{ x: bypass, z: 3 }, { x: bypass, z: shopZ }];
    this.currentPathIndex = 0;
    this.setNextTarget();
  }
  
  selectBrowsingTargets() {
    this.browsingTargets = [];
    const wp = [...this.navGrid.safeWaypoints.shopping, ...this.navGrid.safeWaypoints.aisles];
    const shuffled = wp.sort(() => this.rng.next() - 0.5);
    for (let i = 0; i < Math.min(this.numStops, shuffled.length); i++) {
      this.browsingTargets.push(shuffled[i]);
    }
    this.currentBrowsingIndex = 0;
  }
  
  planNextBrowsingPath() {
    if (this.currentBrowsingIndex >= this.browsingTargets.length) {
      this.transitionTo(this.willCheckout ? STATE.WALKING_TO_QUEUE : STATE.EXITING);
      return;
    }
    const t = this.browsingTargets[this.currentBrowsingIndex];
    this.path = this.pathPlanner.findPath(this.x, this.z, t.x, t.z);
    if (!this.path || this.path.length === 0) {
      console.warn(`[Agent ${this.id}] BROWSE PATH FAILED: from (${this.x.toFixed(1)}, ${this.z.toFixed(1)}) to (${t.x.toFixed(1)}, ${t.z.toFixed(1)}) - target walkable: ${this.navGrid.isWalkableWorld(t.x, t.z)}`);
      // Skip this target instead of using direct path through obstacles
      this.currentBrowsingIndex++;
      this.planNextBrowsingPath();
      return;
    }
    this.currentPathIndex = 0;
    this.setNextTarget();
  }
  
  selectQueue() {
    // Legacy method - redirect to new queue system
    // This should not be called anymore, but handle gracefully
    console.warn('[Agent] Legacy selectQueue called, redirecting to QUEUE_DECISION');
    this.transitionTo(STATE.QUEUE_DECISION);
  }
  
  planQueuePath() {
    // Legacy method - redirect to new queue system
    console.warn('[Agent] Legacy planQueuePath called, redirecting to buffer path');
    this.planBufferPath();
  }
  
  // Plan path to queue approach area (before decision point)
  planQueueApproachPath() {
    // Navigate to queue zone - target Z between cashier line and shopping
    const cashierZ = this.navGrid.zoneBounds.cashierLineZ || 7;
    const targetZ = cashierZ + 5; // Z≈12, in queue zone
    
    // Target X: somewhere in the middle of checkout area
    const minX = this.navGrid.zoneBounds.checkoutMinX || 7;
    const maxX = this.navGrid.zoneBounds.checkoutMaxX || 36;
    const targetX = minX + this.rng.next() * (maxX - minX);
    
    console.log(`[Agent ${this.id}] Queue approach: from (${this.x.toFixed(1)}, ${this.z.toFixed(1)}) to (${targetX.toFixed(1)}, ${targetZ.toFixed(1)})`);
    
    this.path = this.pathPlanner.findPath(this.x, this.z, targetX, targetZ);
    if (!this.path || this.path.length === 0) {
      // Fallback: just go straight to target
      console.warn(`[Agent ${this.id}] No path to queue approach, using fallback`);
      this.path = [{ x: targetX, z: targetZ }];
    }
    this.currentPathIndex = 0;
    this.setNextTarget();
    this.speed = this.baseSpeed;
  }
  
  startCheckout() {
    this.dwellDuration = this.rng.range(SIM_CONFIG.serviceTimeSec[0], SIM_CONFIG.serviceTimeSec[1]);
    this.dwellTimer = 0;
    this.isDwelling = true;
  }
  
  planExitPath() {
    const ent = this.navGrid.entrancePos;
    const cashierZ = this.navGrid.zoneBounds.cashierLineZ || 7;
    const exitCorridorZ = 3; // Safe corridor between cashiers and entrance
    
    console.log(`[Agent ${this.id}] EXIT: from (${this.x.toFixed(1)}, ${this.z.toFixed(1)}) -> entrance (${ent.x.toFixed(1)}, ${ent.z.toFixed(1)})`);
    
    // Step 1: Move to exit corridor first (same X, lower Z) - avoid crossing other cashiers
    const corridorPoint = { x: this.x, z: exitCorridorZ };
    const path1 = this.pathPlanner.findPath(this.x, this.z, corridorPoint.x, corridorPoint.z);
    
    // Step 2: From corridor to entrance
    const path2 = this.pathPlanner.findPath(corridorPoint.x, corridorPoint.z, ent.x, ent.z);
    
    // Combine paths
    if (path1 && path1.length > 0 && path2 && path2.length > 0) {
      this.path = [...path1, ...path2.slice(1)]; // Avoid duplicate waypoint
    } else if (path1 && path1.length > 0) {
      this.path = [...path1, { x: ent.x, z: ent.z }];
    } else {
      // Fallback: direct waypoints
      console.warn(`[Agent ${this.id}] EXIT PATH using fallback waypoints`);
      this.path = [corridorPoint, { x: ent.x, z: ent.z }];
    }
    
    console.log(`[Agent ${this.id}] Exit path: ${this.path.length} waypoints, first: (${this.path[0].x.toFixed(1)}, ${this.path[0].z.toFixed(1)})`);
    
    this.currentPathIndex = 0;
    this.setNextTarget();
    this.speed = this.baseSpeed * 1.5;
  }
  
  replanPath() {
    switch (this.state) {
      case STATE.ENTERING: this.planEntryPath(); break;
      case STATE.BROWSING: 
        if (this.browsingTargets && this.currentBrowsingIndex < this.browsingTargets.length) {
          const t = this.browsingTargets[this.currentBrowsingIndex];
          this.path = this.pathPlanner.findPath(this.x, this.z, t.x, t.z) || [t];
          this.currentPathIndex = 0;
          this.setNextTarget();
        }
        break;
      case STATE.WALKING_TO_QUEUE: this.planPathToQueue(); break;
      case STATE.IN_QUEUE:
      case STATE.SERVICE:
        // Don't replan while in queue or service
        break;
      case STATE.EXITING: 
      case STATE.EXIT_FAST:
        this.planExitPath(); 
        break;
    }
  }
  
  setNextTarget() {
    if (this.path && this.currentPathIndex < this.path.length) {
      this.targetX = this.path[this.currentPathIndex].x;
      this.targetZ = this.path[this.currentPathIndex].z;
    }
  }
  
  updateEntering(dt, agents) { if (this.followPath(dt, agents)) this.transitionTo(STATE.BROWSING); }
  
  updateBrowsing(dt, agents) {
    if (this.isDwelling) {
      this.dwellTimer += dt;
      if (this.dwellTimer >= this.dwellDuration) {
        this.isDwelling = false;
        this.currentBrowsingIndex++;
        this.planNextBrowsingPath();
      }
    } else if (this.followPath(dt, agents)) {
      this.isDwelling = true;
      this.dwellTimer = 0;
      this.dwellDuration = this.rng.range(SIM_CONFIG.browsingDwellSec[0], SIM_CONFIG.browsingDwellSec[1]);
    }
    if (this.totalTime > this.targetStayTime) {
      this.isDwelling = false;
      // Use simple queue system
      this.transitionTo(this.willCheckout ? STATE.WALKING_TO_QUEUE : STATE.EXITING);
    }
  }
  
  // ========== SIMPLE QUEUE METHODS ==========
  
  /**
   * Plan path to queue position
   */
  planPathToQueue() {
    const targetPos = this.queueManager.getQueueTargetPosition(this.id);
    if (!targetPos) {
      console.warn(`[Agent ${this.id}] No queue target, exiting`);
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    console.log(`[Agent ${this.id}] Walking to queue at (${targetPos.x.toFixed(1)}, ${targetPos.z.toFixed(1)})`);
    
    this.path = this.pathPlanner.findPath(this.x, this.z, targetPos.x, targetPos.z);
    if (!this.path || this.path.length === 0) {
      console.warn(`[Agent ${this.id}] QUEUE PATH FAILED: from (${this.x.toFixed(1)}, ${this.z.toFixed(1)}) to (${targetPos.x.toFixed(1)}, ${targetPos.z.toFixed(1)}) - target walkable: ${this.navGrid.isWalkableWorld(targetPos.x, targetPos.z)}`);
      // Still need to get there - use direct but followPath will block at obstacles
      this.path = [targetPos];
    }
    this.currentPathIndex = 0;
    this.setNextTarget();
    this.speed = this.baseSpeed;
  }
  
  /**
   * WALKING_TO_QUEUE: Follow path to queue position
   */
  updateWalkingToQueue(dt, agents) {
    // Timeout
    if (this.stateTime > 30) {
      console.warn(`[Agent ${this.id}] Queue walk timeout, exiting`);
      this.queueManager.removeAgent(this.id);
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    // Update target position (queue may have moved as others exit)
    const targetPos = this.queueManager.getQueueTargetPosition(this.id);
    if (!targetPos) {
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    // Check if close to target
    const dx = targetPos.x - this.x;
    const dz = targetPos.z - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    if (dist < 0.5) {
      // Arrived at queue position
      this.transitionTo(STATE.IN_QUEUE);
      return;
    }
    
    // Follow path
    if (this.followPath(dt, agents)) {
      // Path complete but not at target - replan
      this.path = [targetPos];
      this.currentPathIndex = 0;
      this.setNextTarget();
    }
  }
  
  /**
   * IN_QUEUE: Wait in queue, advance when service is free
   */
  updateInQueue(dt, agents) {
    // Timeout
    if (this.stateTime > 120) {
      console.warn(`[Agent ${this.id}] Queue wait timeout, exiting`);
      this.queueManager.removeAgent(this.id);
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    // Check if can enter service (front of queue + service empty)
    if (this.queueManager.isAtFront(this.id)) {
      this.transitionTo(STATE.SERVICE);
      return;
    }
    
    // Get target position (recalculated based on queue position)
    const targetPos = this.queueManager.getQueueTargetPosition(this.id);
    if (targetPos) {
      const dx = targetPos.x - this.x;
      const dz = targetPos.z - this.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist > 0.1) {
        // Check for agents blocking our path (agent-to-agent collision)
        const minAgentDist = SIM_CONFIG.personalSpaceRadius || 0.5;
        let blockedByAgent = false;
        
        for (const other of agents) {
          if (other.id === this.id || other.state === STATE.DONE || !other.spawned) continue;
          
          const odx = other.x - this.x;
          const odz = other.z - this.z;
          const oDist = Math.sqrt(odx * odx + odz * odz);
          
          // Check if other agent is in front of us (toward our target) and too close
          if (oDist < minAgentDist) {
            // Dot product to check if agent is in direction of movement
            const dotProduct = (dx * odx + dz * odz) / (dist * oDist);
            if (dotProduct > 0.3) { // Agent is roughly in front of us
              blockedByAgent = true;
              break;
            }
          }
        }
        
        if (!blockedByAgent) {
          // Move toward target using normal movement (respects obstacles)
          const moveSpeed = 1.0;
          const step = Math.min(moveSpeed * dt, dist);
          const nx = this.x + (dx / dist) * step;
          const nz = this.z + (dz / dist) * step;
          
          // Check walkability with agent radius buffer (same as followPath)
          const r = SIM_CONFIG.agentRadius;
          const isNewPosWalkable = (
            this.navGrid.isWalkableWorld(nx, nz) &&
            this.navGrid.isWalkableWorld(nx + r, nz) &&
            this.navGrid.isWalkableWorld(nx - r, nz) &&
            this.navGrid.isWalkableWorld(nx, nz + r) &&
            this.navGrid.isWalkableWorld(nx, nz - r)
          );
          
          if (isNewPosWalkable) {
            this.x = nx;
            this.z = nz;
          }
        }
        
        this.heading = Math.atan2(dx, dz);
      }
    }
    
    this.speed = 0;
    this.vx = 0;
    this.vz = 0;
  }
  
  // ========== LEGACY QUEUE STATE UPDATES (kept for compatibility) ==========
  
  /**
   * QUEUE_DECISION: Legacy - redirect to simple system
   */
  updateQueueDecision(dt, agents) {
    this.transitionTo(STATE.WALKING_TO_QUEUE);
  }
  
  /**
   * QUEUE_BUFFER_WAIT: Navigate to buffer point, then join queue
   */
  updateQueueBufferWait(dt, agents) {
    // Timeout fallback
    if (this.stateTime > 30) {
      this.queueManager.removeAgent(this.id);
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    // Navigate to buffer point
    if (this.followPath(dt, agents)) {
      // Arrived - try to join queue directly
      this.transitionTo(STATE.QUEUE_JOIN_TAIL);
    } else {
      this.speed = this.baseSpeed;
    }
  }
  
  /**
   * QUEUE_JOIN_TAIL: Join the tail slot of the queue
   */
  updateQueueJoinTail(dt, agents) {
    // Timeout - if can't join after a few seconds, just exit
    if (this.stateTime > 10) {
      this.queueManager.removeAgent(this.id);
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    if (this.queueManager.joinTail(this.id, this)) {
      this.transitionTo(STATE.QUEUE_ADVANCE);
    }
    // Keep trying until timeout
  }
  
  /**
   * QUEUE_ADVANCE: Walk to service position using pathfinding
   */
  updateQueueAdvance(dt, agents) {
    // Timeout fallback - max 30 seconds
    if (this.stateTime > 30) {
      this.queueManager.removeAgent(this.id);
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    // Get service position for this lane
    const servicePos = this.queueManager.getServicePosition(this.id);
    if (!servicePos) {
      this.queueManager.removeAgent(this.id);
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    // Check if we have a path to service position
    if (!this.queuePath) {
      this.queuePath = this.pathPlanner.findPath(this.x, this.z, servicePos.x, servicePos.z);
      if (!this.queuePath) {
        this.queuePath = [servicePos]; // Direct fallback
      }
      this.queuePathIndex = 0;
    }
    
    // Follow path to service position
    if (this.queuePathIndex < this.queuePath.length) {
      const target = this.queuePath[this.queuePathIndex];
      const dx = target.x - this.x;
      const dz = target.z - this.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      
      if (dist < 0.3) {
        this.queuePathIndex++;
      } else {
        // Check for agents blocking our path (agent-to-agent collision)
        const minAgentDist = SIM_CONFIG.personalSpaceRadius || 0.5;
        let blockedByAgent = false;
        
        for (const other of agents) {
          if (other.id === this.id || other.state === STATE.DONE || !other.spawned) continue;
          
          const odx = other.x - this.x;
          const odz = other.z - this.z;
          const oDist = Math.sqrt(odx * odx + odz * odz);
          
          // Check if other agent is in front of us and too close
          if (oDist < minAgentDist) {
            const dotProduct = (dx * odx + dz * odz) / (dist * oDist);
            if (dotProduct > 0.3) {
              blockedByAgent = true;
              break;
            }
          }
        }
        
        if (!blockedByAgent) {
          // Move toward target with obstacle check
          const moveSpeed = 0.8;
          const nx = this.x + (dx / dist) * moveSpeed * dt;
          const nz = this.z + (dz / dist) * moveSpeed * dt;
          
          // Check walkability with agent radius buffer
          const r = SIM_CONFIG.agentRadius;
          const isNewPosWalkable = (
            this.navGrid.isWalkableWorld(nx, nz) &&
            this.navGrid.isWalkableWorld(nx + r, nz) &&
            this.navGrid.isWalkableWorld(nx - r, nz) &&
            this.navGrid.isWalkableWorld(nx, nz + r) &&
            this.navGrid.isWalkableWorld(nx, nz - r)
          );
          
          if (isNewPosWalkable) {
            this.x = nx;
            this.z = nz;
          }
        }
        this.heading = Math.atan2(dx, dz);
      }
    }
    
    // Check if arrived at service position
    const dxS = servicePos.x - this.x;
    const dzS = servicePos.z - this.z;
    const distToService = Math.sqrt(dxS * dxS + dzS * dzS);
    
    if (distToService < 0.5) {
      this.transitionTo(STATE.SERVICE);
      return;
    }
    
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
  }
  
  /**
   * SERVICE: Dwell at checkout, then exit
   */
  updateService(dt, agents) {
    // Timeout fallback - max 60s service
    if (this.stateTime > 60) {
      this.queueManager.removeAgent(this.id);
      this.transitionTo(STATE.EXITING);
      return;
    }
    
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;
    
    // Update service timer
    if (this.queueManager.updateService(this.id, dt)) {
      // Service complete
      this.queueManager.completeService(this.id);
      this.transitionTo(STATE.EXITING); // Use regular exit, simpler
    }
  }
  
  /**
   * EXIT_FAST: Fast directional exit, no backward movement
   */
  updateExitFast(dt, agents) {
    // Move faster during exit
    this.speed = this.baseSpeed * this.exitSpeedMultiplier;
    
    // Follow exit path
    if (this.followPath(dt, agents)) {
      // Reached exit point, transition to normal exiting
      this.transitionTo(STATE.EXITING);
    }
    
    // Prevent backward movement (Z should only decrease toward exit)
    if (this.vz > 0.1) {
      this.vz = 0;
    }
  }
  
  /**
   * Plan path to buffer point for chosen lane
   */
  planBufferPath() {
    const bp = this.queueManager.getBufferPoint(this.id);
    if (!bp) {
      console.warn(`[Agent ${this.id}] No buffer point found, exiting`);
      this.transitionTo(STATE.EXITING);
      return;
    }
    console.log(`[Agent ${this.id}] Planning path to buffer point x=${bp.x.toFixed(2)}, z=${bp.z.toFixed(2)}`);
    this.path = this.pathPlanner.findPath(this.x, this.z, bp.x, bp.z) || [bp];
    this.currentPathIndex = 0;
    this.setNextTarget();
    this.speed = this.baseSpeed;
  }
  
  /**
   * Plan path from checkout to exit gate
   */
  planExitFromCheckout() {
    const data = this.queueManager.agentQueueData.get(this.id);
    if (!data || data.chosenLaneId < 0) {
      this.planExitPath();
      return;
    }
    
    const lane = this.queueManager.lanes[data.chosenLaneId];
    const exitPoint = lane.exitPoint;
    
    this.path = this.pathPlanner.findPath(this.x, this.z, exitPoint.x, exitPoint.z) || [exitPoint];
    this.currentPathIndex = 0;
    this.setNextTarget();
  }
  
  // ========== END REALISTIC QUEUE STATES ==========
  
  updateQueuing(dt, agents) {
    // Check if our queue position changed (someone ahead left)
    const currentTarget = this.queueManager.getAgentQueueTarget(this.id);
    if (currentTarget) {
      const distToTarget = Math.sqrt(
        Math.pow(this.targetX - currentTarget.x, 2) + 
        Math.pow(this.targetZ - currentTarget.z, 2)
      );
      // If target position changed significantly, replan
      if (distToTarget > 0.5) {
        this.planQueuePath();
      }
    }
    
    // Follow path to our queue slot
    if (this.followPath(dt, agents)) {
      // Reached our queue slot - check if we're at front
      if (this.queueManager.isAtFront(this.id)) {
        // We're at front, can proceed to checkout
        this.queueManager.leaveQueue(this.id);
        this.transitionTo(STATE.CHECKOUT);
      } else {
        // Wait in position, but keep checking for queue movement
        // Stay still at current position
      }
    }
  }
  
  updateCheckout(dt) {
    this.dwellTimer += dt;
    if (this.dwellTimer >= this.dwellDuration) this.transitionTo(STATE.EXITING);
  }
  
  updateExiting(dt, agents) { if (this.followPath(dt, agents)) this.transitionTo(STATE.DONE); }
  
  followPath(dt, agents) {
    if (!this.path || this.path.length === 0) return true;
    const dx = this.targetX - this.x, dz = this.targetZ - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < SIM_CONFIG.waypointReachThreshold) {
      this.currentPathIndex++;
      if (this.currentPathIndex >= this.path.length) return true;
      this.setNextTarget();
      return false;
    }
    const dirX = dx / dist, dirZ = dz / dist;
    this.wobblePhase += this.wobbleFreq * dt;
    const wobble = Math.sin(this.wobblePhase) * this.wobbleAmount;
    let vx = (dirX - dirZ * wobble) * this.speed;
    let vz = (dirZ + dirX * wobble) * this.speed;
    const av = this.calcAvoidance(agents);
    vx += av.x; vz += av.z;
    let nx = this.x + vx * dt, nz = this.z + vz * dt;
    const gc = this.gateManager.enforceGates(this, nx, nz);
    if (!gc.allowed) { nx = gc.x; nz = gc.z; }
    
    // Check walkability with agent radius buffer (check 4 corners + center)
    const r = SIM_CONFIG.agentRadius;
    const isNewPosWalkable = (
      this.navGrid.isWalkableWorld(nx, nz) &&
      this.navGrid.isWalkableWorld(nx + r, nz) &&
      this.navGrid.isWalkableWorld(nx - r, nz) &&
      this.navGrid.isWalkableWorld(nx, nz + r) &&
      this.navGrid.isWalkableWorld(nx, nz - r)
    );
    
    if (!isNewPosWalkable) {
      // Try sliding along one axis
      const canSlideX = this.navGrid.isWalkableWorld(nx, this.z) && 
                        this.navGrid.isWalkableWorld(nx + r, this.z) && 
                        this.navGrid.isWalkableWorld(nx - r, this.z);
      const canSlideZ = this.navGrid.isWalkableWorld(this.x, nz) && 
                        this.navGrid.isWalkableWorld(this.x, nz + r) && 
                        this.navGrid.isWalkableWorld(this.x, nz - r);
      
      if (canSlideX) {
        nz = this.z;
        this.blockedFrames = 0;
      } else if (canSlideZ) {
        nx = this.x;
        this.blockedFrames = 0;
      } else {
        // Completely blocked - stay in place but track it
        nx = this.x;
        nz = this.z;
        
        // If blocked by other agents (not obstacle), don't count as blocked
        // Just wait for them to move
        if (this.nearbyAgentCount > 0) {
          this.blockedFrames = 0;
          this.agentBlockedFrames = (this.agentBlockedFrames || 0) + 1;
          
          // If blocked by agents too long, try to find alternate route
          if (this.agentBlockedFrames > 30) {
            this.agentBlockedFrames = 0;
            this.replanPath();
          }
        } else {
          this.blockedFrames = (this.blockedFrames || 0) + 1;
          this.agentBlockedFrames = 0;
          
          // If blocked by obstacle for too long, replan
          if (this.blockedFrames > 10) {
            this.blockedFrames = 0;
            this.replanPath();
            return false;
          }
        }
      }
    } else {
      this.blockedFrames = 0;
    }
    this.x = Math.max(0.5, Math.min(this.navGrid.worldWidth - 0.5, nx));
    this.z = Math.max(0.5, Math.min(this.navGrid.worldDepth - 0.5, nz));
    this.vx = vx; this.vz = vz;
    if (Math.abs(vx) > 0.01 || Math.abs(vz) > 0.01) this.heading = Math.atan2(vx, vz);
    return false;
  }
  
  calcAvoidance(agents) {
    let ax = 0, az = 0;
    let nearbyCount = 0;
    const myR = this.personalSpaceRadius * this.personalSpaceMultiplier;
    
    for (const o of agents) {
      if (o.id === this.id || o.state === STATE.DONE || !o.spawned) continue;
      const dx = this.x - o.x, dz = this.z - o.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const minD = myR + (o.personalSpaceRadius || 0.5);
      
      if (d < minD && d > 0.01) {
        nearbyCount++;
        // Stronger avoidance with exponential falloff for close agents
        const s = (minD - d) / minD;
        // Stronger push when very close (0.5 base, up to 1.5 when overlapping)
        const strength = 0.5 + s * 1.0;
        ax += (dx / d) * s * strength;
        az += (dz / d) * s * strength;
      }
    }
    
    // Store nearby count for deadlock detection
    this.nearbyAgentCount = nearbyCount;
    
    // Smooth avoidance to prevent zig-zag (blend with previous)
    const smoothing = 0.5;
    this.smoothAvoidX = (this.smoothAvoidX || 0) * smoothing + ax * (1 - smoothing);
    this.smoothAvoidZ = (this.smoothAvoidZ || 0) * smoothing + az * (1 - smoothing);
    
    // Even when surrounded, apply reduced avoidance to prevent overlapping
    if (nearbyCount >= 3) {
      // Reduce but don't eliminate avoidance when crowded
      return { x: this.smoothAvoidX * 0.3, z: this.smoothAvoidZ * 0.3 };
    }
    
    return { x: this.smoothAvoidX, z: this.smoothAvoidZ };
  }
  
  toMessage(deviceId, venueId) {
    const noiseX = SIM_CONFIG.addMeasurementNoise ? (Math.random() - 0.5) * SIM_CONFIG.noiseStdDev * 2 : 0;
    const noiseZ = SIM_CONFIG.addMeasurementNoise ? (Math.random() - 0.5) * SIM_CONFIG.noiseStdDev * 2 : 0;
    return {
      id: `person-${this.id}`,
      deviceId,
      venueId,
      timestamp: Date.now(),
      position: { x: this.x + noiseX, y: 0, z: this.z + noiseZ },
      velocity: { x: this.vx || 0, y: 0, z: this.vz || 0 },
      objectType: 'person',
      color: this.color,
      boundingBox: { width: this.width, height: this.height, depth: this.width },
      metadata: { state: this.state, persona: this.persona },
    };
  }
}

export default AgentV2;
