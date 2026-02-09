/**
 * LaneStateController - Manages manual open/close commands for checkout lanes
 * Works alongside automatic cashier shift scheduling
 * 
 * Features:
 * - Manual lane open/close via API commands
 * - Graceful close (cashier finishes serving then leaves)
 * - Queue pressure metrics and suggestions
 * - Idempotent command handling
 */

import { CASHIER_STATE } from './cashieragent.js';

export const LANE_COMMAND = {
  OPEN: 'open',
  CLOSE: 'closed',
};

export const LANE_STATUS = {
  CLOSED: 'CLOSED',
  OPENING: 'OPENING',
  OPEN: 'OPEN',
  CLOSING: 'CLOSING',
};

export class LaneStateController {
  constructor(simulatorV2, config = {}) {
    this.simulator = simulatorV2;
    
    // Configuration with defaults
    this.config = {
      // Queue pressure thresholds (parametric)
      queuePressureThreshold: config.queuePressureThreshold || 5, // avg queue per open lane
      inflowRateThreshold: config.inflowRateThreshold || 10, // customers/min
      inflowWindowSec: config.inflowWindowSec || 120, // rolling window for inflow calc
      
      // Timing
      openConfirmWindowSec: config.openConfirmWindowSec || 10,
      closeGraceWindowSec: config.closeGraceWindowSec || 30,
      
      ...config,
    };
    
    // Desired state per lane (set by commands)
    // null = automatic mode, 'open'/'closed' = manual override
    this.desiredStates = new Map();
    
    // Command history for debugging
    this.commandHistory = [];
    this.maxHistorySize = 100;
    
    // Queue metrics tracking
    this.queueMetrics = new Map(); // laneId -> { count, inflowHistory }
    this.lastMetricsUpdate = Date.now();
    
    // Inflow tracking (rolling window)
    this.inflowEvents = []; // { timestamp, laneId }
    
    console.log('[LaneStateController] Initialized with config:', this.config);
  }
  
  /**
   * Set desired state for a lane (manual command)
   * @param {number} laneId 
   * @param {string} desiredState - 'open' or 'closed'
   * @param {string} reason - 'manual' or 'auto'
   * @returns {object} result with applied state
   */
  setLaneState(laneId, desiredState, reason = 'manual') {
    const laneStates = this.simulator.getLaneStates();
    
    if (laneId < 0 || laneId >= laneStates.length) {
      return { ok: false, error: `Invalid laneId: ${laneId}` };
    }
    
    const cashierAgent = this.getCashierForLane(laneId);
    if (!cashierAgent) {
      return { ok: false, error: `No cashier agent for lane ${laneId}` };
    }
    
    const currentState = laneStates[laneId];
    const timestamp = Date.now();
    
    // Record command
    this.commandHistory.push({
      timestamp,
      laneId,
      desiredState,
      reason,
      previousState: currentState.isOpen ? 'open' : 'closed',
      cashierState: cashierAgent.state,
    });
    
    // Trim history
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory.shift();
    }
    
    // Store desired state
    this.desiredStates.set(laneId, desiredState);
    
    // Apply command to cashier agent
    if (desiredState === LANE_COMMAND.OPEN) {
      return this.openLane(laneId, cashierAgent, reason);
    } else {
      return this.closeLane(laneId, cashierAgent, reason);
    }
  }
  
  /**
   * Open a lane - spawn cashier if needed
   */
  openLane(laneId, cashierAgent, reason) {
    const currentState = cashierAgent.state;
    
    // Already open or arriving - idempotent
    if (currentState === CASHIER_STATE.WORKING || 
        currentState === CASHIER_STATE.ARRIVE ||
        currentState === CASHIER_STATE.RETURN) {
      console.log(`[LaneStateController] Lane ${laneId} already open/opening (${currentState})`);
      return {
        ok: true,
        laneId,
        appliedState: 'open',
        status: this.getLaneStatus(laneId),
        cashierTrackId: `cashier-${cashierAgent.id}`,
        idempotent: true,
      };
    }
    
    // Cashier is leaving or on break - recall them
    if (currentState === CASHIER_STATE.LEAVE || 
        currentState === CASHIER_STATE.BREAK) {
      console.log(`[LaneStateController] Lane ${laneId}: Recalling cashier from ${currentState}`);
      cashierAgent.transitionTo(CASHIER_STATE.RETURN);
    }
    // Cashier is off shift - bring them in
    else if (currentState === CASHIER_STATE.OFFSHIFT || 
             currentState === CASHIER_STATE.DONE) {
      console.log(`[LaneStateController] Lane ${laneId}: Spawning cashier`);
      // Reset and spawn
      cashierAgent.spawned = true;
      cashierAgent.state = CASHIER_STATE.OFFSHIFT;
      cashierAgent.transitionTo(CASHIER_STATE.ARRIVE);
    }
    
    return {
      ok: true,
      laneId,
      appliedState: 'open',
      status: LANE_STATUS.OPENING,
      cashierTrackId: `cashier-${cashierAgent.id}`,
      reason,
    };
  }
  
  /**
   * Close a lane - graceful close (finish serving then leave)
   */
  closeLane(laneId, cashierAgent, reason) {
    const currentState = cashierAgent.state;
    
    // Already closed or leaving - idempotent
    if (currentState === CASHIER_STATE.OFFSHIFT || 
        currentState === CASHIER_STATE.LEAVE ||
        currentState === CASHIER_STATE.DONE) {
      console.log(`[LaneStateController] Lane ${laneId} already closed/closing (${currentState})`);
      return {
        ok: true,
        laneId,
        appliedState: 'closed',
        status: this.getLaneStatus(laneId),
        cashierTrackId: `cashier-${cashierAgent.id}`,
        idempotent: true,
      };
    }
    
    // Mark for graceful close
    // The cashier will finish current work then leave
    if (currentState === CASHIER_STATE.WORKING) {
      console.log(`[LaneStateController] Lane ${laneId}: Marking for graceful close`);
      // Set a flag for graceful close - cashier will transition to LEAVE
      // after completing current service
      cashierAgent.pendingClose = true;
      cashierAgent.transitionTo(CASHIER_STATE.LEAVE);
    }
    // Arriving or returning - just turn around and leave
    else if (currentState === CASHIER_STATE.ARRIVE || 
             currentState === CASHIER_STATE.RETURN) {
      console.log(`[LaneStateController] Lane ${laneId}: Aborting arrival, leaving`);
      cashierAgent.transitionTo(CASHIER_STATE.LEAVE);
    }
    // On break - just don't return
    else if (currentState === CASHIER_STATE.BREAK) {
      console.log(`[LaneStateController] Lane ${laneId}: Ending break, not returning`);
      cashierAgent.transitionTo(CASHIER_STATE.DONE);
    }
    
    return {
      ok: true,
      laneId,
      appliedState: 'closed',
      status: LANE_STATUS.CLOSING,
      cashierTrackId: `cashier-${cashierAgent.id}`,
      reason,
    };
  }
  
  /**
   * Get cashier agent for a lane
   */
  getCashierForLane(laneId) {
    return this.simulator.cashierAgents.find(c => c.laneId === laneId);
  }
  
  /**
   * Get current status for a lane
   */
  getLaneStatus(laneId) {
    const laneStates = this.simulator.getLaneStates();
    if (laneId < 0 || laneId >= laneStates.length) return LANE_STATUS.CLOSED;
    
    const cashier = this.getCashierForLane(laneId);
    if (!cashier) return LANE_STATUS.CLOSED;
    
    const state = cashier.state;
    const isInServiceArea = cashier.isInServiceArea();
    
    if (state === CASHIER_STATE.WORKING && isInServiceArea) {
      return LANE_STATUS.OPEN;
    } else if (state === CASHIER_STATE.ARRIVE || state === CASHIER_STATE.RETURN) {
      return LANE_STATUS.OPENING;
    } else if (state === CASHIER_STATE.LEAVE) {
      return LANE_STATUS.CLOSING;
    } else {
      return LANE_STATUS.CLOSED;
    }
  }
  
  /**
   * Update queue metrics (call each simulation tick)
   */
  updateMetrics(dt) {
    const now = Date.now();
    
    // Clean old inflow events
    const windowStart = now - (this.config.inflowWindowSec * 1000);
    this.inflowEvents = this.inflowEvents.filter(e => e.timestamp >= windowStart);
    
    this.lastMetricsUpdate = now;
  }
  
  /**
   * Record a customer entering a queue
   */
  recordQueueEntry(laneId) {
    this.inflowEvents.push({
      timestamp: Date.now(),
      laneId,
    });
  }
  
  /**
   * Get queue count for a lane from the queue manager
   */
  getQueueCount(laneId) {
    const queueManager = this.simulator.queueManager;
    if (!queueManager) return 0;
    
    const queue = queueManager.queues?.get(laneId);
    return queue ? queue.length : 0;
  }
  
  /**
   * Get inflow rate (customers/min) for a lane
   */
  getInflowRate(laneId) {
    const windowMs = this.config.inflowWindowSec * 1000;
    const windowStart = Date.now() - windowMs;
    
    const events = this.inflowEvents.filter(
      e => e.laneId === laneId && e.timestamp >= windowStart
    );
    
    // Convert to per-minute rate
    const windowMin = this.config.inflowWindowSec / 60;
    return events.length / windowMin;
  }
  
  /**
   * Get total inflow rate across all lanes
   */
  getTotalInflowRate() {
    const windowMs = this.config.inflowWindowSec * 1000;
    const windowStart = Date.now() - windowMs;
    
    const events = this.inflowEvents.filter(e => e.timestamp >= windowStart);
    
    const windowMin = this.config.inflowWindowSec / 60;
    return events.length / windowMin;
  }
  
  /**
   * Get full checkout status for all lanes
   */
  getCheckoutStatus() {
    const laneStates = this.simulator.getLaneStates();
    
    const lanes = laneStates.map((ls, idx) => {
      const cashier = this.getCashierForLane(idx);
      const desiredState = this.desiredStates.get(idx);
      
      return {
        laneId: idx,
        desiredState: desiredState || 'auto',
        appliedState: ls.isOpen ? 'open' : 'closed',
        status: this.getLaneStatus(idx),
        cashierPresent: cashier ? cashier.spawned && cashier.state !== CASHIER_STATE.DONE : false,
        cashierTrackId: cashier ? `cashier-${cashier.id}` : null,
        cashierState: cashier ? cashier.state : null,
        queueCount: this.getQueueCount(idx),
        inflowRate: Math.round(this.getInflowRate(idx) * 10) / 10,
        lastChangeTs: ls.openSince || ls.closedSince || null,
      };
    });
    
    // Aggregate metrics
    const openLanes = lanes.filter(l => l.appliedState === 'open');
    const totalQueueCount = lanes.reduce((sum, l) => sum + l.queueCount, 0);
    const totalInflowRate = this.getTotalInflowRate();
    
    // Queue pressure calculation
    const avgQueuePerLane = openLanes.length > 0 
      ? totalQueueCount / openLanes.length 
      : totalQueueCount;
    
    // Suggestion logic
    let suggestion = null;
    const closedLanes = lanes.filter(l => l.status === LANE_STATUS.CLOSED);
    
    if (closedLanes.length > 0) {
      if (avgQueuePerLane > this.config.queuePressureThreshold) {
        suggestion = {
          type: 'OPEN_LANE',
          message: `High queue pressure (${avgQueuePerLane.toFixed(1)} avg/lane) - consider opening lane ${closedLanes[0].laneId}`,
          suggestedLaneId: closedLanes[0].laneId,
          reason: 'queue_pressure',
        };
      } else if (totalInflowRate > this.config.inflowRateThreshold) {
        suggestion = {
          type: 'OPEN_LANE',
          message: `High inflow rate (${totalInflowRate.toFixed(1)}/min) - consider opening lane ${closedLanes[0].laneId}`,
          suggestedLaneId: closedLanes[0].laneId,
          reason: 'inflow_rate',
        };
      }
    }
    
    return {
      lanes,
      aggregate: {
        totalLanes: lanes.length,
        openLanes: openLanes.length,
        totalQueueCount,
        totalInflowRate: Math.round(totalInflowRate * 10) / 10,
        avgQueuePerLane: Math.round(avgQueuePerLane * 10) / 10,
      },
      thresholds: {
        queuePressure: this.config.queuePressureThreshold,
        inflowRate: this.config.inflowRateThreshold,
      },
      suggestion,
    };
  }
  
  /**
   * Update thresholds (parametric configuration)
   */
  updateThresholds(thresholds) {
    if (thresholds.queuePressureThreshold !== undefined) {
      this.config.queuePressureThreshold = thresholds.queuePressureThreshold;
    }
    if (thresholds.inflowRateThreshold !== undefined) {
      this.config.inflowRateThreshold = thresholds.inflowRateThreshold;
    }
    console.log('[LaneStateController] Updated thresholds:', this.config);
  }
  
  /**
   * Clear manual override for a lane (return to auto mode)
   */
  clearManualOverride(laneId) {
    this.desiredStates.delete(laneId);
    console.log(`[LaneStateController] Cleared manual override for lane ${laneId}`);
  }
  
  /**
   * Clear all manual overrides
   */
  clearAllOverrides() {
    this.desiredStates.clear();
    console.log('[LaneStateController] Cleared all manual overrides');
  }
}

export default LaneStateController;
