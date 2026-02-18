/**
 * SIMPLE Queue System
 * 
 * Each checkout has:
 * - SERVICE ZONE (green) - where 1 person gets served (15 sec)
 * - QUEUE ZONE (red) - where people wait in line
 * 
 * Logic:
 * - Pick random queue
 * - If service zone empty -> go directly to service zone
 * - If service zone occupied -> wait in queue behind last person
 * - Keep 40cm distance between people
 * - Move forward when person in front moves
 */

import { SIM_CONFIG } from './simconfig.js';

export const QUEUE_STATE = {
  NONE: 'NONE',
  WALKING_TO_QUEUE: 'WALKING_TO_QUEUE',
  IN_QUEUE: 'IN_QUEUE',
  IN_SERVICE: 'IN_SERVICE',
  DONE: 'DONE',
};

const SPACING = 0.6; // 60cm between people (40cm + body width)
const SERVICE_TIME = 15; // 15 seconds service

export class CheckoutQueueSubsystem {
  constructor(navGrid, rng) {
    this.navGrid = navGrid;
    this.rng = rng;
    
    // Each queue: { serviceAgent: null, queueAgents: [] }
    this.queues = [];
    
    // Agent data: { queueIdx, state, serviceTimer, targetPos }
    this.agents = new Map();
    
    // Reference to lane states (set by simulator)
    this.laneStates = null;
    
    // Reference to all agents (set by simulator for position-based counting)
    this.allAgents = null;
  }
  
  // Set reference to all agents for position-based queue counting
  setAllAgents(agents) {
    this.allAgents = agents;
  }
  
  // Point-in-polygon test (ray casting algorithm)
  isPointInPolygon(x, z, vertices) {
    if (!vertices || vertices.length < 3) return false;
    
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const xi = vertices[i].x, zi = vertices[i].z || vertices[i].y;
      const xj = vertices[j].x, zj = vertices[j].z || vertices[j].y;
      
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
        inside = !inside;
      }
    }
    return inside;
  }
  
  // Set lane states reference (called by simulator)
  setLaneStates(laneStates) {
    this.laneStates = laneStates;
  }
  
  // Check if a lane is open (cashier present and confirmed)
  isLaneOpen(queueIdx) {
    if (!this.laneStates || queueIdx >= this.laneStates.length) {
      return true; // Default to open if no lane state info
    }
    return this.laneStates[queueIdx].isOpen;
  }
  
  // Get list of open lanes
  getOpenLanes() {
    if (!this.laneStates) {
      // No lane state info - all lanes are open
      return this.queues.map((_, i) => i);
    }
    return this.laneStates
      .filter(ls => ls.isOpen)
      .map(ls => ls.laneId);
  }

  init(checkoutZones = null) {
    this.queues = [];
    
    // Use checkoutZones (ROI-based, sorted by X position) if available
    // Otherwise fall back to navGrid.cashiers
    let cashierPositions = [];
    
    if (checkoutZones && checkoutZones.length > 0) {
      // Use ROI-based checkout zones (already sorted by X position)
      console.log(`[Queue] Using ${checkoutZones.length} ROI-based checkout zones`);
      cashierPositions = checkoutZones.map(zone => ({
        x: zone.queueCenter?.x || zone.serviceCenter?.x || 0,
        z: zone.queueCenter?.z || zone.serviceCenter?.z || 0,
        queueZoneId: zone.queueZoneId,
        displayIndex: zone.displayIndex,
      }));
    } else {
      // Fall back to navGrid.cashiers
      const navCashiers = this.navGrid.cashiers || [];
      console.log(`[Queue] Using ${navCashiers.length} navGrid cashiers (fallback)`);
      cashierPositions = navCashiers.map((pos, i) => ({
        x: pos.x,
        z: pos.z,
        queueZoneId: `lane-${i}`,
        displayIndex: i + 1,
      }));
    }
    
    // DEBUG: Log zone bounds
    console.log(`[Queue DEBUG] Zone bounds:`);
    console.log(`  cashierLineZ = ${this.navGrid.zoneBounds.cashierLineZ}`);
    console.log(`  shoppingMinZ = ${this.navGrid.zoneBounds.shoppingMinZ}`);
    console.log(`  shoppingMaxZ = ${this.navGrid.zoneBounds.shoppingMaxZ}`);
    console.log(`  checkoutMinX = ${this.navGrid.zoneBounds.checkoutMinX}`);
    console.log(`  checkoutMaxX = ${this.navGrid.zoneBounds.checkoutMaxX}`);
    
    for (let i = 0; i < cashierPositions.length; i++) {
      const pos = cashierPositions[i];
      this.queues.push({
        cashierX: pos.x,
        cashierZ: pos.z,
        queueZoneId: pos.queueZoneId,
        displayIndex: pos.displayIndex,
        serviceAgent: null,
        queueAgents: [],
      });
      console.log(`[Queue DEBUG] Lane ${pos.displayIndex}: X=${pos.x.toFixed(1)}, Z=${pos.z.toFixed(1)} (${pos.queueZoneId.substring(0,8)})`);
    }
    
    // Calculate service and queue zones
    const cashierZ = this.navGrid.zoneBounds.cashierLineZ || 7;
    console.log(`[Queue DEBUG] Calculated zones:`);
    console.log(`  Service zone Z = ${cashierZ + 1.5} (cashierZ + 1.5)`);
    console.log(`  Queue start Z = ${cashierZ + 3} (cashierZ + 3)`);
    
    console.log(`[Queue] Initialized ${cashierPositions.length} checkout queues`);
  }

  /**
   * Agent wants to join a queue - pick from open lanes (or random if all closed)
   */
  startQueueDecision(agentId, agent) {
    if (this.queues.length === 0) return null;
    
    // Get open lanes
    const openLanes = this.getOpenLanes();
    
    let queueIdx;
    if (openLanes.length > 0) {
      // Pick random open lane
      queueIdx = openLanes[Math.floor(this.rng.next() * openLanes.length)];
    } else {
      // No open lanes - pick random queue anyway (customers might queue hoping lane opens)
      queueIdx = Math.floor(this.rng.next() * this.queues.length);
      console.log(`[Queue] No open lanes, agent ${agentId} picking closed lane ${queueIdx}`);
    }
    const queue = this.queues[queueIdx];
    
    // Determine where agent should go
    let state, targetPos;
    const cashierZ = this.navGrid.zoneBounds.cashierLineZ || 7;
    const serviceZ = cashierZ + 1.5; // Service zone: 1.5m from cashier line
    const queueStartZ = cashierZ + 3; // Queue starts 3m from cashier
    
    if (queue.serviceAgent === null && queue.queueAgents.length === 0) {
      // Service zone empty, no queue - go directly to service
      state = QUEUE_STATE.WALKING_TO_QUEUE; // Will transition to service when arrives
      targetPos = { x: queue.cashierX, z: serviceZ };
      queue.serviceAgent = agentId;
    } else {
      // Someone in service or queue - join queue
      state = QUEUE_STATE.WALKING_TO_QUEUE;
      const posInQueue = queue.queueAgents.length;
      targetPos = { 
        x: queue.cashierX, 
        z: queueStartZ + posInQueue * SPACING 
      };
      queue.queueAgents.push(agentId);
    }
    
    this.agents.set(agentId, {
      queueIdx,
      state,
      serviceTimer: 0,
      targetPos,
      isInService: queue.serviceAgent === agentId,
    });
    
    console.log(`[Queue DEBUG] Agent ${agentId} DECISION:`);
    console.log(`  Current pos: (${agent.x.toFixed(1)}, ${agent.z.toFixed(1)})`);
    console.log(`  Chosen queue: ${queueIdx}, cashierX=${queue.cashierX.toFixed(1)}`);
    console.log(`  Target pos: (${targetPos.x.toFixed(1)}, ${targetPos.z.toFixed(1)})`);
    console.log(`  Is in service: ${queue.serviceAgent === agentId}`);
    console.log(`  Queue length: ${queue.queueAgents.length}`);
    
    return this.agents.get(agentId);
  }

  /**
   * Get where agent should walk/stand
   */
  getQueueTargetPosition(agentId) {
    const data = this.agents.get(agentId);
    if (!data) return null;
    
    const queue = this.queues[data.queueIdx];
    const cashierZ = this.navGrid.zoneBounds.cashierLineZ || 7;
    const serviceZ = cashierZ + 1.5;
    const queueStartZ = cashierZ + 3;
    
    let targetPos;
    
    if (data.isInService || queue.serviceAgent === agentId) {
      data.isInService = true;
      targetPos = { x: queue.cashierX, z: serviceZ };
    } else {
      const posInQueue = queue.queueAgents.indexOf(agentId);
      if (posInQueue < 0) {
        targetPos = data.targetPos;
      } else {
        targetPos = { 
          x: queue.cashierX, 
          z: queueStartZ + posInQueue * SPACING 
        };
        data.targetPos = targetPos;
      }
    }
    
    // DEBUG: Log every 60 frames (roughly every second at 60fps)
    if (!data.logCounter) data.logCounter = 0;
    data.logCounter++;
    if (data.logCounter % 60 === 0) {
      console.log(`[Queue DEBUG] Agent ${agentId} target: (${targetPos.x.toFixed(1)}, ${targetPos.z.toFixed(1)}), inService=${data.isInService}, queuePos=${queue.queueAgents.indexOf(agentId)}`);
    }
    
    return targetPos;
  }

  /**
   * Check if agent is at front of queue (can enter service when it's free)
   */
  isAtFront(agentId) {
    const data = this.agents.get(agentId);
    if (!data) return false;
    
    // Already in service
    if (data.isInService) return true;
    
    const queue = this.queues[data.queueIdx];
    
    // Check if service is empty AND agent is first in queue
    if (queue.serviceAgent === null && queue.queueAgents[0] === agentId) {
      // Move to service!
      queue.queueAgents.shift(); // Remove from queue
      queue.serviceAgent = agentId;
      data.isInService = true;
      console.log(`[Queue] Agent ${agentId} entering service zone`);
      return true;
    }
    
    return false;
  }

  /**
   * Mark agent as arrived at queue position (called when agent transitions to IN_QUEUE state)
   */
  setAgentInQueue(agentId) {
    const data = this.agents.get(agentId);
    if (data && data.state === QUEUE_STATE.WALKING_TO_QUEUE) {
      data.state = QUEUE_STATE.IN_QUEUE;
      console.log(`[Queue] Agent ${agentId} arrived at queue position (lane ${data.queueIdx})`);
    }
  }

  /**
   * Start service timer
   */
  startService(agentId, agent) {
    const data = this.agents.get(agentId);
    if (data) {
      data.state = QUEUE_STATE.IN_SERVICE;
      data.serviceTimer = 0;
      data.isInService = true;
      // Don't snap position - let agent walk there naturally
    }
  }

  /**
   * Update service - returns true when done (15 seconds)
   */
  updateService(agentId, dt) {
    const data = this.agents.get(agentId);
    if (!data) return true;
    
    data.serviceTimer += dt;
    return data.serviceTimer >= SERVICE_TIME;
  }

  /**
   * Complete service - free the service zone
   */
  completeService(agentId) {
    const data = this.agents.get(agentId);
    if (!data) return null;
    
    const queue = this.queues[data.queueIdx];
    
    // Free service zone
    if (queue.serviceAgent === agentId) {
      queue.serviceAgent = null;
      console.log(`[Queue] Agent ${agentId} finished service, zone now free`);
    }
    
    data.state = QUEUE_STATE.DONE;
    
    // Return exit position
    return {
      x: queue.cashierX,
      z: 2, // Toward entrance
    };
  }

  /**
   * Remove agent from system
   */
  removeAgent(agentId) {
    const data = this.agents.get(agentId);
    if (data) {
      const queue = this.queues[data.queueIdx];
      
      // Remove from service
      if (queue.serviceAgent === agentId) {
        queue.serviceAgent = null;
      }
      
      // Remove from queue
      const idx = queue.queueAgents.indexOf(agentId);
      if (idx >= 0) {
        queue.queueAgents.splice(idx, 1);
      }
    }
    this.agents.delete(agentId);
  }

  // Compatibility stubs
  getQueueState(agentId) { 
    return this.agents.get(agentId)?.state || QUEUE_STATE.NONE; 
  }
  setQueueState(agentId, state) { 
    const data = this.agents.get(agentId);
    if (data) data.state = state;
  }
  getAgentData(agentId) { return this.agents.get(agentId); }
  chooseLane(agentId) { return this.agents.get(agentId)?.queueIdx ?? -1; }
  getBufferPoint(agentId) { return this.getQueueTargetPosition(agentId); }
  joinTail() { return true; }
  getSlotPosition(agentId) { return this.getQueueTargetPosition(agentId); }
  getServicePosition(agentId) { return this.getQueueTargetPosition(agentId); }
  canAdvance() { return false; }
  advanceSlot() {}
  isAtServicePosition(agentId) { return this.agents.get(agentId)?.isInService || false; }
  updateTimers() {}
  isDecisionComplete() { return true; }
  getExitSpeedMultiplier() { return 1.5; }
  update(dt) { /* passive */ }
  
  getDiagnostics() {
    return {
      queueCount: this.queues.length,
      queues: this.queues.map((q, i) => ({ 
        cashier: i, 
        inService: q.serviceAgent !== null,
        queueLength: q.queueAgents.length 
      })),
    };
  }
  
  /**
   * Get queue info for a specific lane - REALISTIC counting
   * Only counts agents that have actually arrived at queue/service position
   * @param {number} laneId - Lane index
   * @returns {Array|null} Array of agent IDs physically in queue/service area
   */
  getQueueInfo(laneId) {
    if (laneId < 0 || laneId >= this.queues.length) return null;
    
    const queue = this.queues[laneId];
    const agentsInZone = [];
    
    // Count agents that are IN_QUEUE or SERVICE state for THIS lane
    // These states mean the agent has physically arrived at the queue position
    for (const [agentId, agentData] of this.agents.entries()) {
      if (agentData.queueIdx !== laneId) continue;
      
      // Only count if agent has arrived (IN_QUEUE or IN_SERVICE state)
      if (agentData.state === QUEUE_STATE.IN_QUEUE || 
          agentData.state === QUEUE_STATE.IN_SERVICE) {
        agentsInZone.push(agentId);
      }
    }
    
    return agentsInZone;
  }
  
  /**
   * Get total queue count across all lanes - POSITION-BASED
   */
  getTotalQueueCount() {
    let total = 0;
    for (let i = 0; i < this.queues.length; i++) {
      const info = this.getQueueInfo(i);
      total += info ? info.length : 0;
    }
    return total;
  }
}

export default CheckoutQueueSubsystem;
