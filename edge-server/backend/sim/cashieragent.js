/**
 * CashierAgent - Simulates cashier behavior at checkout lanes
 * 
 * State machine:
 * - OFFSHIFT: Not present (before arrival or after leaving)
 * - ARRIVE: Walking to service area from staff exit point
 * - WORKING: Quasi-stationary in service area with micro-movements
 * - BREAK: Walking away for break
 * - RETURN: Walking back from break
 * - LEAVE: Walking away at end of shift
 * - DONE: Agent complete (can be removed)
 */

import { SIM_CONFIG } from './simconfig.js';

export const CASHIER_STATE = {
  OFFSHIFT: 'OFFSHIFT',
  ARRIVE: 'ARRIVE',
  WORKING: 'WORKING',
  BREAK: 'BREAK',
  RETURN: 'RETURN',
  LEAVE: 'LEAVE',
  DONE: 'DONE',
};

export class CashierAgent {
  constructor(id, laneId, cashierPos, navGrid, pathPlanner, rng) {
    this.id = id;
    this.laneId = laneId;
    this.agentType = 'cashier';
    this.navGrid = navGrid;
    this.pathPlanner = pathPlanner;
    this.rng = rng;
    
    const cfg = SIM_CONFIG.cashierBehavior;
    
    // Service area (synthetic rectangle)
    this.anchorPoint = {
      x: cashierPos.x,
      z: cashierPos.z + cfg.serviceAreaOffsetZ,
    };
    
    // Service area bounds
    const halfW = cfg.serviceAreaWidth / 2;
    const halfD = cfg.serviceAreaDepth / 2;
    this.serviceArea = {
      minX: this.anchorPoint.x - halfW,
      maxX: this.anchorPoint.x + halfW,
      minZ: this.anchorPoint.z - halfD,
      maxZ: this.anchorPoint.z + halfD,
    };
    
    // Staff exit point (behind checkout)
    this.staffExitPoint = {
      x: cashierPos.x,
      z: cashierPos.z + cfg.staffExitOffsetZ,
    };
    
    // Current position (start at staff exit)
    this.x = this.staffExitPoint.x;
    this.z = this.staffExitPoint.z;
    this.vx = 0;
    this.vz = 0;
    
    // State machine
    this.state = CASHIER_STATE.OFFSHIFT;
    this.stateTime = 0;
    this.totalTime = 0;
    
    // Schedule
    this.shiftDuration = rng.range(cfg.shiftDurationMin[0], cfg.shiftDurationMin[1]) * 60; // to seconds
    this.shiftStartDelay = rng.range(cfg.staggeredStartSec[0], cfg.staggeredStartSec[1]);
    this.arrivalDuration = rng.range(cfg.arrivalTransitionSec[0], cfg.arrivalTransitionSec[1]);
    this.leaveDuration = rng.range(cfg.leaveTransitionSec[0], cfg.leaveTransitionSec[1]);
    
    // Break tracking
    this.breakCheckTimer = 0;
    this.breakDuration = 0;
    this.isOnBreak = false;
    
    // Micro-shift tracking
    this.microShiftTimer = rng.range(cfg.microShiftIntervalSec[0], cfg.microShiftIntervalSec[1]);
    this.microShiftTarget = null;
    this.microShiftRemaining = 0;
    
    // Walking
    this.walkSpeed = rng.range(cfg.walkSpeed[0], cfg.walkSpeed[1]);
    this.path = [];
    this.currentPathIndex = 0;
    this.targetX = this.x;
    this.targetZ = this.z;
    
    // Track time in service area (for lane open detection)
    this.timeInServiceArea = 0;
    this.timeOutsideServiceArea = 0;
    
    // Spawned flag (matches AgentV2 interface)
    this.spawned = false;
    
    // Visual properties
    this.color = '#ef4444'; // Red for cashiers
    this.width = 0.5;
    this.height = 1.7;
    
    console.log(`[CashierAgent ${id}] Created for lane ${laneId}, anchor=(${this.anchorPoint.x.toFixed(1)}, ${this.anchorPoint.z.toFixed(1)})`);
  }
  
  /**
   * Main update loop
   */
  update(dt, allAgents = []) {
    if (this.state === CASHIER_STATE.DONE) return false;
    
    this.totalTime += dt;
    this.stateTime += dt;
    
    // Handle initial spawn delay
    if (!this.spawned) {
      if (this.totalTime >= this.shiftStartDelay) {
        this.spawned = true;
        this.transitionTo(CASHIER_STATE.ARRIVE);
      }
      return true;
    }
    
    // Update based on state
    switch (this.state) {
      case CASHIER_STATE.ARRIVE:
        this.updateArrive(dt);
        break;
      case CASHIER_STATE.WORKING:
        this.updateWorking(dt);
        break;
      case CASHIER_STATE.BREAK:
        this.updateBreak(dt);
        break;
      case CASHIER_STATE.RETURN:
        this.updateReturn(dt);
        break;
      case CASHIER_STATE.LEAVE:
        this.updateLeave(dt);
        break;
    }
    
    // Track time in/out of service area
    if (this.isInServiceArea()) {
      this.timeInServiceArea += dt;
      this.timeOutsideServiceArea = 0;
    } else {
      this.timeOutsideServiceArea += dt;
      // Don't reset timeInServiceArea - keep for hysteresis
    }
    
    return true;
  }
  
  /**
   * State transitions
   */
  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.stateTime = 0;
    
    console.log(`[CashierAgent ${this.id}] ${oldState} -> ${newState}`);
    
    switch (newState) {
      case CASHIER_STATE.ARRIVE:
        this.planPathTo(this.anchorPoint.x, this.anchorPoint.z);
        break;
        
      case CASHIER_STATE.WORKING:
        // Snap to anchor initially
        this.x = this.anchorPoint.x;
        this.z = this.anchorPoint.z;
        this.vx = 0;
        this.vz = 0;
        this.resetMicroShiftTimer();
        break;
        
      case CASHIER_STATE.BREAK:
        this.isOnBreak = true;
        const cfg = SIM_CONFIG.cashierBehavior;
        this.breakDuration = this.rng.range(cfg.breakDurationMin[0], cfg.breakDurationMin[1]) * 60;
        this.planPathTo(this.staffExitPoint.x, this.staffExitPoint.z);
        break;
        
      case CASHIER_STATE.RETURN:
        this.planPathTo(this.anchorPoint.x, this.anchorPoint.z);
        break;
        
      case CASHIER_STATE.LEAVE:
        this.planPathTo(this.staffExitPoint.x, this.staffExitPoint.z);
        break;
        
      case CASHIER_STATE.DONE:
        this.spawned = false;
        break;
    }
  }
  
  /**
   * ARRIVE: Walk from staff exit to service area
   */
  updateArrive(dt) {
    if (this.followPath(dt)) {
      this.transitionTo(CASHIER_STATE.WORKING);
    }
  }
  
  /**
   * WORKING: Quasi-stationary with micro-movements
   */
  updateWorking(dt) {
    const cfg = SIM_CONFIG.cashierBehavior;
    
    // Check for shift end
    if (this.stateTime >= this.shiftDuration) {
      this.transitionTo(CASHIER_STATE.LEAVE);
      return;
    }
    
    // Check for break
    this.breakCheckTimer += dt;
    if (this.breakCheckTimer >= cfg.breakCheckIntervalSec) {
      this.breakCheckTimer = 0;
      const breakProb = cfg.breakProbabilityPerHour / 60; // per minute
      if (this.rng.next() < breakProb) {
        this.transitionTo(CASHIER_STATE.BREAK);
        return;
      }
    }
    
    // Micro-shift logic
    this.microShiftTimer -= dt;
    
    if (this.microShiftTarget) {
      // Moving toward micro-shift target
      this.microShiftRemaining -= dt;
      
      if (this.microShiftRemaining <= 0) {
        // Micro-shift complete
        this.microShiftTarget = null;
        this.resetMicroShiftTimer();
      } else {
        // Move toward target
        const dx = this.microShiftTarget.x - this.x;
        const dz = this.microShiftTarget.z - this.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        
        if (dist > 0.02) {
          const step = Math.min(cfg.microShiftSpeed * dt, dist);
          this.x += (dx / dist) * step;
          this.z += (dz / dist) * step;
        }
      }
    } else if (this.microShiftTimer <= 0) {
      // Start new micro-shift
      const angle = this.rng.next() * Math.PI * 2;
      const radius = this.rng.range(0.05, cfg.microShiftRadius);
      this.microShiftTarget = {
        x: this.anchorPoint.x + Math.cos(angle) * radius,
        z: this.anchorPoint.z + Math.sin(angle) * radius,
      };
      this.microShiftRemaining = this.rng.range(cfg.microShiftDurationSec[0], cfg.microShiftDurationSec[1]);
    }
    
    // Always apply small jitter
    this.x += this.rng.gaussian(0, cfg.jitterSigma);
    this.z += this.rng.gaussian(0, cfg.jitterSigma);
    
    // Clamp to service area
    this.clampToServiceArea();
    
    // Zero velocity when working
    this.vx = 0;
    this.vz = 0;
  }
  
  /**
   * BREAK: Walk away, wait, then return
   */
  updateBreak(dt) {
    if (this.followPath(dt)) {
      // Reached staff exit - wait for break duration
      if (this.stateTime >= this.breakDuration) {
        this.isOnBreak = false;
        this.transitionTo(CASHIER_STATE.RETURN);
      }
    }
  }
  
  /**
   * RETURN: Walk back to service area after break
   */
  updateReturn(dt) {
    if (this.followPath(dt)) {
      this.transitionTo(CASHIER_STATE.WORKING);
    }
  }
  
  /**
   * LEAVE: Walk to staff exit at end of shift
   */
  updateLeave(dt) {
    if (this.followPath(dt)) {
      this.transitionTo(CASHIER_STATE.DONE);
    }
  }
  
  /**
   * Path planning and following
   */
  planPathTo(targetX, targetZ) {
    // Simple direct path for cashiers (short distances)
    this.path = [{ x: targetX, z: targetZ }];
    this.currentPathIndex = 0;
    this.setNextTarget();
  }
  
  setNextTarget() {
    if (this.path && this.currentPathIndex < this.path.length) {
      this.targetX = this.path[this.currentPathIndex].x;
      this.targetZ = this.path[this.currentPathIndex].z;
    }
  }
  
  followPath(dt) {
    if (!this.path || this.path.length === 0) return true;
    
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    
    if (dist < 0.2) {
      this.currentPathIndex++;
      if (this.currentPathIndex >= this.path.length) {
        this.vx = 0;
        this.vz = 0;
        return true; // Path complete
      }
      this.setNextTarget();
      return false;
    }
    
    // Move toward target
    const step = Math.min(this.walkSpeed * dt, dist);
    this.vx = (dx / dist) * this.walkSpeed;
    this.vz = (dz / dist) * this.walkSpeed;
    this.x += (dx / dist) * step;
    this.z += (dz / dist) * step;
    
    return false;
  }
  
  /**
   * Helper methods
   */
  resetMicroShiftTimer() {
    const cfg = SIM_CONFIG.cashierBehavior;
    this.microShiftTimer = this.rng.range(cfg.microShiftIntervalSec[0], cfg.microShiftIntervalSec[1]);
  }
  
  clampToServiceArea() {
    this.x = Math.max(this.serviceArea.minX, Math.min(this.serviceArea.maxX, this.x));
    this.z = Math.max(this.serviceArea.minZ, Math.min(this.serviceArea.maxZ, this.z));
  }
  
  isInServiceArea() {
    return (
      this.x >= this.serviceArea.minX &&
      this.x <= this.serviceArea.maxX &&
      this.z >= this.serviceArea.minZ &&
      this.z <= this.serviceArea.maxZ
    );
  }
  
  /**
   * Check if lane should be considered "open" (for customer queue logic)
   */
  isLaneOpen() {
    const cfg = SIM_CONFIG.laneOpenClose;
    
    if (this.state === CASHIER_STATE.WORKING && this.isInServiceArea()) {
      return this.timeInServiceArea >= cfg.openConfirmWindowSec;
    }
    
    // Grace period after leaving
    if (this.timeOutsideServiceArea < cfg.closeGraceWindowSec) {
      return this.timeInServiceArea >= cfg.openConfirmWindowSec;
    }
    
    return false;
  }
  
  /**
   * Output track message (matches AgentV2 interface)
   */
  toMessage(deviceId, venueId) {
    const cfg = SIM_CONFIG.cashierBehavior;
    const noiseX = cfg.measurementNoiseSigma * this.rng.gaussian(0, 1);
    const noiseZ = cfg.measurementNoiseSigma * this.rng.gaussian(0, 1);
    
    return {
      id: `cashier-${this.id}`,
      deviceId,
      venueId,
      timestamp: Date.now(),
      position: { x: this.x + noiseX, y: 0, z: this.z + noiseZ },
      velocity: { x: this.vx || 0, y: 0, z: this.vz || 0 },
      objectType: 'person',
      color: this.color,
      boundingBox: { width: this.width, height: this.height, depth: this.width },
      metadata: {
        agentType: 'cashier',
        laneId: this.laneId,
        state: this.state,
      },
    };
  }
  
  /**
   * Debug info
   */
  getDebugInfo() {
    return {
      id: this.id,
      laneId: this.laneId,
      state: this.state,
      position: { x: this.x, z: this.z },
      anchor: this.anchorPoint,
      serviceArea: this.serviceArea,
      isInServiceArea: this.isInServiceArea(),
      isLaneOpen: this.isLaneOpen(),
      timeInServiceArea: this.timeInServiceArea,
      timeOutsideServiceArea: this.timeOutsideServiceArea,
      shiftRemaining: Math.max(0, this.shiftDuration - this.stateTime),
    };
  }
}

export default CashierAgent;
