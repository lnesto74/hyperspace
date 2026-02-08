/**
 * CheckoutQueueSubsystem - Realistic grocery store checkout queue behavior
 * 
 * Implements multi-phase, stop-and-go queue progression:
 * 1) Pre-queue evaluation (QUEUE_DECISION)
 * 2) Buffer wait before joining tail (QUEUE_BUFFER_WAIT)
 * 3) Join tail slot (QUEUE_JOIN_TAIL)
 * 4) Stop-and-go progression (QUEUE_ADVANCE)
 * 5) Service at P0 (SERVICE)
 * 6) Fast directional exit (EXIT_FAST)
 */

import { SIM_CONFIG } from './simconfig.js';

// Queue-specific states (extend agent STATE)
export const QUEUE_STATE = {
  NONE: 'NONE',
  QUEUE_DECISION: 'QUEUE_DECISION',
  QUEUE_BUFFER_WAIT: 'QUEUE_BUFFER_WAIT',
  QUEUE_JOIN_TAIL: 'QUEUE_JOIN_TAIL',
  QUEUE_ADVANCE: 'QUEUE_ADVANCE',
  SERVICE: 'SERVICE',
  EXIT_FAST: 'EXIT_FAST',
};

/**
 * Represents a single checkout lane with queue slots
 */
class CheckoutLane {
  constructor(id, cashierPos, laneDirection, config) {
    this.id = id;
    this.cashierPos = cashierPos; // { x, z }
    this.laneDirection = laneDirection; // unit vector pointing into queue (away from cashier)
    this.config = config;
    
    const qb = SIM_CONFIG.queueBehavior;
    const slotSpacing = (qb.personalSpaceM[0] + qb.personalSpaceM[1]) / 2 + 0.3;
    
    // Generate queue slots: P0 is service position, P1..Pk are queue positions
    this.slots = [];
    for (let i = 0; i < qb.maxQueueSlots; i++) {
      const dist = 1.5 + i * slotSpacing; // P0 at 1.5m from cashier, then spaced
      this.slots.push({
        index: i,
        pos: {
          x: cashierPos.x + laneDirection.x * dist,
          z: cashierPos.z + laneDirection.z * dist,
        },
        occupantId: null,
      });
    }
    
    // Buffer point: fixed position in queue zone (not deep in shopping)
    // Place it at Z = cashierZ + 5 (middle of queue zone)
    this.bufferPoint = {
      x: cashierPos.x,
      z: cashierPos.z + 5, // ~Z=13, in queue zone
    };
    
    // Exit point: in front of cashier (opposite direction)
    this.exitPoint = {
      x: cashierPos.x - laneDirection.x * 2.5,
      z: cashierPos.z - laneDirection.z * 2.5,
    };
    
    // Service position (P0)
    this.servicePos = this.slots[0].pos;
    
    // Tracking for "line is moving" heuristic
    this.lastAdvanceTime = 0;
    
    // Stats
    this.serviceSkipAttempts = 0;
  }
  
  getQueueLength() {
    return this.slots.filter(s => s.occupantId !== null).length;
  }
  
  getFirstFreeSlotIndex() {
    // Find the first free slot from the back (tail)
    for (let i = this.slots.length - 1; i >= 0; i--) {
      if (this.slots[i].occupantId === null) {
        // Check if there's someone in front (slot i-1 must be occupied for i to be valid tail)
        if (i === 0 || this.slots[i - 1].occupantId !== null) {
          return i;
        }
      }
    }
    return -1; // Queue is full
  }
  
  getTailSlotIndex() {
    // Get the index of the last occupied slot (or -1 if empty)
    // Search from FRONT to find highest occupied slot
    let highest = -1;
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].occupantId !== null) {
        highest = i;
      }
    }
    return highest;
  }
  
  isSlotFree(index) {
    return index >= 0 && index < this.slots.length && this.slots[index].occupantId === null;
  }
  
  occupySlot(index, agentId) {
    if (index >= 0 && index < this.slots.length) {
      this.slots[index].occupantId = agentId;
    }
  }
  
  freeSlot(index) {
    if (index >= 0 && index < this.slots.length) {
      this.slots[index].occupantId = null;
    }
  }
  
  getAgentSlotIndex(agentId) {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].occupantId === agentId) return i;
    }
    return -1;
  }
  
  removeAgent(agentId) {
    for (let i = 0; i < this.slots.length; i++) {
      if (this.slots[i].occupantId === agentId) {
        this.slots[i].occupantId = null;
        return i;
      }
    }
    return -1;
  }
  
  recordAdvance(time) {
    this.lastAdvanceTime = time;
  }
  
  hasAdvancedRecently(currentTime) {
    return (currentTime - this.lastAdvanceTime) < SIM_CONFIG.queueBehavior.movingLaneWindowSec;
  }
}

/**
 * Main queue subsystem that manages all checkout lanes
 */
export class CheckoutQueueSubsystem {
  constructor(navGrid, rng) {
    this.navGrid = navGrid;
    this.rng = rng;
    this.lanes = [];
    this.agentQueueData = new Map(); // agentId -> queue state data
    this.currentTime = 0;
    this.initialized = false;
  }
  
  /**
   * Initialize lanes from cashier positions
   */
  init() {
    if (!this.navGrid.cashiers || this.navGrid.cashiers.length === 0) {
      console.warn('[CheckoutQueue] No cashiers found');
      return;
    }
    
    this.lanes = [];
    
    // Lane direction: +Z (into queue zone, between cashiers and shopping)
    const laneDir = { x: 0, z: 1 };
    
    for (let i = 0; i < this.navGrid.cashiers.length; i++) {
      const cashier = this.navGrid.cashiers[i];
      const cashierPos = {
        x: cashier.x,
        z: this.navGrid.zoneBounds.cashierLineZ + 1,
      };
      
      const lane = new CheckoutLane(i, cashierPos, laneDir, SIM_CONFIG.queueBehavior);
      this.lanes.push(lane);
      console.log(`[CheckoutQueue] Lane ${i} at x=${cashier.x.toFixed(2)}, bufferZ=${lane.bufferPoint.z.toFixed(2)}`);
    }
    
    this.initialized = true;
    console.log(`[CheckoutQueue] Initialized ${this.lanes.length} checkout lanes from ${this.navGrid.cashiers.length} cashiers`);
  }
  
  /**
   * Update the subsystem (call once per simulation tick)
   */
  update(dt) {
    this.currentTime += dt;
  }
  
  /**
   * Initialize queue data for an agent entering the queue decision phase
   */
  initAgentQueueData(agentId, agent) {
    const qb = SIM_CONFIG.queueBehavior;
    
    // Determine basket size
    const basketRoll = this.rng.next();
    let basketSize = 'medium';
    if (basketRoll < qb.basketSizeWeights[0]) {
      basketSize = 'small';
    } else if (basketRoll < qb.basketSizeWeights[0] + qb.basketSizeWeights[1]) {
      basketSize = 'medium';
    } else {
      basketSize = 'large';
    }
    
    // Personal space for this agent
    const personalSpace = this.rng.range(qb.personalSpaceM[0], qb.personalSpaceM[1]);
    
    this.agentQueueData.set(agentId, {
      queueState: QUEUE_STATE.NONE,
      chosenLaneId: -1,
      slotIndex: -1,
      targetSlotIndex: -1,
      
      // Timers
      decisionTimer: 0,
      decisionDuration: this.rng.range(qb.decisionDwellSec[0], qb.decisionDwellSec[1]),
      reactionTimer: 0,
      reactionDelay: this.rng.range(qb.reactionDelaySec[0], qb.reactionDelaySec[1]),
      stallTimer: 0,
      serviceTimer: 0,
      serviceDuration: 0,
      
      // Movement
      stepTarget: null,
      isMovingStep: false,
      lastPosition: { x: agent.x, z: agent.z },
      
      // Config
      basketSize,
      personalSpace,
      excludedLanes: new Set(),
      commitTimestamp: 0,
    });
    
    return this.agentQueueData.get(agentId);
  }
  
  /**
   * Get or create agent queue data
   */
  getAgentData(agentId, agent) {
    if (!this.agentQueueData.has(agentId)) {
      return this.initAgentQueueData(agentId, agent);
    }
    return this.agentQueueData.get(agentId);
  }
  
  /**
   * Start queue decision phase for an agent
   */
  startQueueDecision(agentId, agent) {
    const data = this.getAgentData(agentId, agent);
    const qb = SIM_CONFIG.queueBehavior;
    
    data.queueState = QUEUE_STATE.QUEUE_DECISION;
    data.decisionTimer = 0;
    data.decisionDuration = data.excludedLanes.size > 0
      ? this.rng.range(qb.redecisionDwellSec[0], qb.redecisionDwellSec[1])
      : this.rng.range(qb.decisionDwellSec[0], qb.decisionDwellSec[1]);
    
    console.log(`[Queue] Agent ${agentId} starting decision at pos (${agent.x.toFixed(1)}, ${agent.z.toFixed(1)}), ${this.lanes.length} lanes available`);
    return data;
  }
  
  /**
   * Evaluate lanes and choose one - SIMPLE: pick shortest queue with randomness
   */
  chooseLane(agentId, agent) {
    const data = this.getAgentData(agentId, agent);
    
    if (this.lanes.length === 0) return -1;
    
    // Find all non-full lanes with their queue lengths
    const available = [];
    for (let i = 0; i < this.lanes.length; i++) {
      if (data.excludedLanes.has(i)) continue;
      const len = this.lanes[i].getQueueLength();
      if (len < SIM_CONFIG.queueBehavior.maxQueueSlots) {
        available.push({ id: i, len });
      }
    }
    
    if (available.length === 0) return -1;
    
    // Sort by length, then pick randomly from lanes with same/similar length
    available.sort((a, b) => a.len - b.len);
    const minLen = available[0].len;
    const best = available.filter(l => l.len <= minLen + 1); // Allow +1 difference
    
    // Random pick from best options
    const chosen = best[Math.floor(this.rng.next() * best.length)];
    
    data.chosenLaneId = chosen.id;
    data.commitTimestamp = this.currentTime;
    data.stallTimer = 0;
    
    const lane = this.lanes[chosen.id];
    console.log(`[Queue] Agent ${agentId} chose lane ${chosen.id} at X=${lane.cashierPos.x.toFixed(1)} (queueLen=${chosen.len}, options=${best.length}/${available.length})`);
    return chosen.id;
  }
  
  /**
   * Get buffer point for agent's chosen lane
   */
  getBufferPoint(agentId) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0) return null;
    return this.lanes[data.chosenLaneId].bufferPoint;
  }
  
  /**
   * Check if agent can join the queue tail
   */
  canJoinTail(agentId, agent) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0) return false;
    
    const lane = this.lanes[data.chosenLaneId];
    const tailIndex = lane.getTailSlotIndex();
    
    // If queue is empty, can join at P0? No - should join at back
    // Actually for empty queue, first person goes to slot 0 (will be first in line)
    if (tailIndex === -1) {
      // Queue empty - can join at last slot (will advance forward)
      return lane.isSlotFree(lane.slots.length - 1);
    }
    
    // Check if next slot after tail is free
    const nextSlotIndex = tailIndex + 1;
    if (nextSlotIndex >= lane.slots.length) return false; // Queue full
    
    if (!lane.isSlotFree(nextSlotIndex)) return false;
    
    // Check distance to tail occupant
    const tailSlot = lane.slots[tailIndex];
    const dist = Math.sqrt(
      Math.pow(agent.x - tailSlot.pos.x, 2) +
      Math.pow(agent.z - tailSlot.pos.z, 2)
    );
    
    return dist >= data.personalSpace;
  }
  
  /**
   * Join the tail of the queue - find proper slot position
   */
  joinTail(agentId, agent) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0) return false;
    
    // Check if already in a slot
    if (data.slotIndex >= 0) return true;
    
    const lane = this.lanes[data.chosenLaneId];
    
    // Find the correct slot: first free slot after the last occupied one
    let slotIndex = -1;
    const tailIdx = lane.getTailSlotIndex();
    
    if (tailIdx < 0) {
      // Queue empty - take slot 0 (front)
      slotIndex = 0;
    } else {
      // Take slot after tail
      slotIndex = tailIdx + 1;
      if (slotIndex >= lane.slots.length) {
        return false; // Queue full
      }
    }
    
    if (!lane.isSlotFree(slotIndex)) {
      return false; // Slot taken
    }
    
    lane.occupySlot(slotIndex, agentId);
    data.slotIndex = slotIndex;
    data.targetSlotIndex = slotIndex;
    data.queueState = QUEUE_STATE.QUEUE_ADVANCE;
    data.reactionTimer = 0;
    
    const slotPos = lane.slots[slotIndex].pos;
    console.log(`[Queue] Agent ${agentId} joined lane ${data.chosenLaneId} at slot ${slotIndex}, pos (${slotPos.x.toFixed(1)}, ${slotPos.z.toFixed(1)})`);
    return true;
  }
  
  /**
   * Get the position agent should move to
   */
  getSlotPosition(agentId) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0 || data.slotIndex < 0) return null;
    
    const lane = this.lanes[data.chosenLaneId];
    return lane.slots[data.slotIndex].pos;
  }
  
  /**
   * Get service position (P0) for agent's lane
   */
  getServicePosition(agentId) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0) return null;
    
    const lane = this.lanes[data.chosenLaneId];
    return lane.servicePos;
  }
  
  /**
   * Check if agent can advance in queue
   */
  canAdvance(agentId, agent) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0 || data.slotIndex < 0) return false;
    
    const lane = this.lanes[data.chosenLaneId];
    const currentSlot = data.slotIndex;
    
    // Already at front (P0)?
    if (currentSlot === 0) return false;
    
    // Check if slot in front is free
    const frontSlotIndex = currentSlot - 1;
    if (!lane.isSlotFree(frontSlotIndex)) return false;
    
    // Small reaction delay (0.5s)
    if (data.reactionTimer < 0.5) return false;
    
    return true;
  }
  
  /**
   * Advance agent one slot forward
   */
  advanceSlot(agentId) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0 || data.slotIndex <= 0) return false;
    
    const lane = this.lanes[data.chosenLaneId];
    const oldSlot = data.slotIndex;
    const newSlot = oldSlot - 1;
    
    // Free old slot, occupy new
    lane.freeSlot(oldSlot);
    lane.occupySlot(newSlot, agentId);
    
    data.slotIndex = newSlot;
    data.targetSlotIndex = newSlot;
    
    // Reset reaction timer for next advance
    data.reactionTimer = 0;
    data.reactionDelay = this.rng.range(
      SIM_CONFIG.queueBehavior.reactionDelaySec[0],
      SIM_CONFIG.queueBehavior.reactionDelaySec[1]
    );
    
    // Reset stall timer (we made progress)
    data.stallTimer = 0;
    data.lastPosition = { ...this.getSlotPosition(agentId) };
    
    // Record advance for "line is moving" heuristic
    lane.recordAdvance(this.currentTime);
    
    return true;
  }
  
  /**
   * Check if agent is at service position (P0)
   */
  isAtServicePosition(agentId) {
    const data = this.agentQueueData.get(agentId);
    return data && data.slotIndex === 0;
  }
  
  /**
   * Start service at P0
   */
  startService(agentId, agent) {
    const data = this.agentQueueData.get(agentId);
    if (!data) return;
    
    const qb = SIM_CONFIG.queueBehavior;
    const basketTimes = qb.serviceTimeByBasket[data.basketSize];
    
    // Sample service time with optional friction event
    let serviceTime = this.rng.range(basketTimes[0], basketTimes[1]);
    
    if (this.rng.next() < qb.frictionEventProb) {
      serviceTime += this.rng.range(qb.frictionTimeSec[0], qb.frictionTimeSec[1]);
    }
    
    data.queueState = QUEUE_STATE.SERVICE;
    data.serviceTimer = 0;
    data.serviceDuration = serviceTime;
    
    // Lock position
    const lane = this.lanes[data.chosenLaneId];
    agent.x = lane.servicePos.x;
    agent.z = lane.servicePos.z;
  }
  
  /**
   * Update service timer
   */
  updateService(agentId, dt) {
    const data = this.agentQueueData.get(agentId);
    if (!data) return false;
    
    data.serviceTimer += dt;
    return data.serviceTimer >= data.serviceDuration;
  }
  
  /**
   * Complete service and transition to exit
   */
  completeService(agentId) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0) return null;
    
    const lane = this.lanes[data.chosenLaneId];
    
    // Free the service slot
    lane.freeSlot(0);
    
    data.queueState = QUEUE_STATE.EXIT_FAST;
    data.slotIndex = -1;
    
    return lane.exitPoint;
  }
  
  /**
   * Get exit speed multiplier
   */
  getExitSpeedMultiplier() {
    const qb = SIM_CONFIG.queueBehavior;
    return this.rng.range(qb.exitSpeedMultiplier[0], qb.exitSpeedMultiplier[1]);
  }
  
  /**
   * Check if agent is trying to skip service (walk through P0 without SERVICE state)
   */
  checkServiceSkipAttempt(agentId, agent) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0) return false;
    if (data.queueState === QUEUE_STATE.SERVICE || data.queueState === QUEUE_STATE.EXIT_FAST) {
      return false;
    }
    
    const lane = this.lanes[data.chosenLaneId];
    const servicePos = lane.servicePos;
    const dist = Math.sqrt(
      Math.pow(agent.x - servicePos.x, 2) +
      Math.pow(agent.z - servicePos.z, 2)
    );
    
    if (dist < SIM_CONFIG.queueBehavior.serviceZoneRadius && data.slotIndex !== 0) {
      lane.serviceSkipAttempts++;
      return true;
    }
    
    return false;
  }
  
  /**
   * Check if agent should consider switching lanes
   */
  shouldConsiderLaneSwitch(agentId, agent, dt) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0) return false;
    
    const qb = SIM_CONFIG.queueBehavior;
    
    // Update stall timer
    const moved = Math.sqrt(
      Math.pow(agent.x - data.lastPosition.x, 2) +
      Math.pow(agent.z - data.lastPosition.z, 2)
    );
    
    if (moved < 0.1) {
      data.stallTimer += dt;
    } else {
      data.stallTimer = 0;
      data.lastPosition = { x: agent.x, z: agent.z };
    }
    
    // Check if stalled long enough
    if (data.stallTimer < qb.stallThresholdSec) return false;
    
    // Probability check
    return this.rng.next() < qb.laneSwitchProbability;
  }
  
  /**
   * Switch to a different lane
   */
  switchLane(agentId) {
    const data = this.agentQueueData.get(agentId);
    if (!data || data.chosenLaneId < 0) return;
    
    // Free current slot
    const currentLane = this.lanes[data.chosenLaneId];
    currentLane.removeAgent(agentId);
    
    // Exclude current lane temporarily
    data.excludedLanes.add(data.chosenLaneId);
    
    // Reset to decision state
    data.queueState = QUEUE_STATE.QUEUE_DECISION;
    data.chosenLaneId = -1;
    data.slotIndex = -1;
    data.targetSlotIndex = -1;
    data.stallTimer = 0;
  }
  
  /**
   * Remove agent from queue entirely
   */
  removeAgent(agentId) {
    const data = this.agentQueueData.get(agentId);
    if (data && data.chosenLaneId >= 0) {
      this.lanes[data.chosenLaneId].removeAgent(agentId);
    }
    this.agentQueueData.delete(agentId);
  }
  
  /**
   * Update agent queue timers
   */
  updateTimers(agentId, dt) {
    const data = this.agentQueueData.get(agentId);
    if (!data) return;
    
    data.decisionTimer += dt;
    data.reactionTimer += dt;
  }
  
  /**
   * Check if decision dwell is complete
   */
  isDecisionComplete(agentId) {
    const data = this.agentQueueData.get(agentId);
    return data && data.decisionTimer >= data.decisionDuration;
  }
  
  /**
   * Get queue state for agent
   */
  getQueueState(agentId) {
    const data = this.agentQueueData.get(agentId);
    return data ? data.queueState : QUEUE_STATE.NONE;
  }
  
  /**
   * Set queue state for agent
   */
  setQueueState(agentId, state) {
    const data = this.agentQueueData.get(agentId);
    if (data) data.queueState = state;
  }
  
  /**
   * Get step distance for discrete movement
   */
  getStepDistance() {
    const qb = SIM_CONFIG.queueBehavior;
    return this.rng.range(qb.stepDistanceM[0], qb.stepDistanceM[1]);
  }
  
  /**
   * Get diagnostic info
   */
  getDiagnostics() {
    return {
      laneCount: this.lanes.length,
      lanes: this.lanes.map(lane => ({
        id: lane.id,
        queueLength: lane.getQueueLength(),
        slots: lane.slots.map(s => s.occupantId),
        serviceSkipAttempts: lane.serviceSkipAttempts,
      })),
      agentCount: this.agentQueueData.size,
    };
  }
}

export default CheckoutQueueSubsystem;
