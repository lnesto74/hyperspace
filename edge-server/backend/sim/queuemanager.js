/**
 * QueueManager - Manages ordered checkout queues
 * Ensures proper queue behavior: no jumping, ordered flow, one-behind-another
 */

import { SIM_CONFIG } from './simconfig.js';

export class QueueManager {
  constructor(navGrid) {
    this.navGrid = navGrid;
    
    // Queue for each cashier: array of agent IDs in order (index 0 = front)
    this.queues = [];
    
    // Map of agentId -> { cashierId, position }
    this.agentQueueInfo = new Map();
    
    // Spacing between people in queue
    this.queueSpacing = SIM_CONFIG.queueSpacing || 1.0;
    
    // Direction queues face (toward cashier = negative Z typically)
    this.queueDirection = { x: 0, z: -1 };
  }
  
  // Initialize queues for cashiers
  init() {
    this.queues = [];
    for (let i = 0; i < this.navGrid.cashiers.length; i++) {
      this.queues.push([]);
    }
    this.agentQueueInfo.clear();
    console.log(`[QueueManager] Initialized ${this.queues.length} queues`);
  }
  
  // Get the shortest queue (fewest people)
  getShortestQueue() {
    if (this.queues.length === 0) return 0;
    
    let minLen = Infinity;
    let minIdx = 0;
    
    for (let i = 0; i < this.queues.length; i++) {
      if (this.queues[i].length < minLen) {
        minLen = this.queues[i].length;
        minIdx = i;
      }
    }
    
    return minIdx;
  }
  
  // Join a queue - returns queue position info
  joinQueue(agentId, cashierId = null) {
    // If already in a queue, return existing position
    if (this.agentQueueInfo.has(agentId)) {
      return this.agentQueueInfo.get(agentId);
    }
    
    // Auto-select shortest queue if not specified
    if (cashierId === null) {
      cashierId = this.getShortestQueue();
    }
    
    // Clamp to valid range
    cashierId = Math.max(0, Math.min(cashierId, this.queues.length - 1));
    
    // Add to back of queue
    const position = this.queues[cashierId].length;
    this.queues[cashierId].push(agentId);
    
    const info = { cashierId, position, joinedAt: Date.now() };
    this.agentQueueInfo.set(agentId, info);
    
    console.log(`[QueueManager] Agent ${agentId} joined queue ${cashierId} at position ${position}`);
    
    return info;
  }
  
  // Leave queue (when done with checkout or exiting)
  leaveQueue(agentId) {
    const info = this.agentQueueInfo.get(agentId);
    if (!info) return;
    
    const queue = this.queues[info.cashierId];
    const idx = queue.indexOf(agentId);
    
    if (idx !== -1) {
      queue.splice(idx, 1);
      
      // Update positions of everyone behind
      for (let i = idx; i < queue.length; i++) {
        const otherId = queue[i];
        const otherInfo = this.agentQueueInfo.get(otherId);
        if (otherInfo) {
          otherInfo.position = i;
        }
      }
    }
    
    this.agentQueueInfo.delete(agentId);
    console.log(`[QueueManager] Agent ${agentId} left queue ${info.cashierId}`);
  }
  
  // Get current queue position for agent
  getQueuePosition(agentId) {
    const info = this.agentQueueInfo.get(agentId);
    if (!info) return null;
    
    // Recalculate position (may have changed if someone left)
    const queue = this.queues[info.cashierId];
    const actualPos = queue.indexOf(agentId);
    if (actualPos !== -1) {
      info.position = actualPos;
    }
    
    return info;
  }
  
  // Check if agent is at front of queue (can proceed to checkout)
  isAtFront(agentId) {
    const info = this.agentQueueInfo.get(agentId);
    if (!info) return false;
    
    const queue = this.queues[info.cashierId];
    return queue.length > 0 && queue[0] === agentId;
  }
  
  // Get world position for queue slot
  getQueueSlotPosition(cashierId, slotIndex) {
    if (cashierId >= this.navGrid.cashiers.length) return null;
    
    const cashier = this.navGrid.cashiers[cashierId];
    const cashierZ = this.navGrid.zoneBounds.cashierLineZ;
    
    // Queue forms behind cashier (higher Z = further back in store)
    // Slot 0 is right at the cashier, slot 1 is one spacing back, etc.
    const queueStartZ = cashierZ + 1.5; // Start queue 1.5m behind cashier line
    
    return {
      x: cashier.x,
      z: queueStartZ + (slotIndex * this.queueSpacing),
    };
  }
  
  // Get the target position for an agent in queue
  getAgentQueueTarget(agentId) {
    const info = this.agentQueueInfo.get(agentId);
    if (!info) return null;
    
    // Get actual position in queue
    const queue = this.queues[info.cashierId];
    const actualPos = queue.indexOf(agentId);
    if (actualPos === -1) return null;
    
    return this.getQueueSlotPosition(info.cashierId, actualPos);
  }
  
  // Get the agent directly ahead in queue (to follow)
  getAgentAhead(agentId) {
    const info = this.agentQueueInfo.get(agentId);
    if (!info) return null;
    
    const queue = this.queues[info.cashierId];
    const myPos = queue.indexOf(agentId);
    
    if (myPos <= 0) return null; // At front or not in queue
    
    return queue[myPos - 1];
  }
  
  // Get queue length for a cashier
  getQueueLength(cashierId) {
    if (cashierId >= this.queues.length) return 0;
    return this.queues[cashierId].length;
  }
  
  // Get total people queuing
  getTotalQueuing() {
    return this.queues.reduce((sum, q) => sum + q.length, 0);
  }
  
  // Debug: print queue state
  printQueues() {
    for (let i = 0; i < this.queues.length; i++) {
      console.log(`Queue ${i}: [${this.queues[i].join(', ')}]`);
    }
  }
}

  // Get detailed queue info for a lane (for checkout alerts)
  getQueueInfo(laneId) {
    const cashierId = typeof laneId === 'number' ? laneId : parseInt(laneId);
    if (isNaN(cashierId) || cashierId >= this.queues.length || cashierId < 0) return null;
    
    const queue = this.queues[cashierId];
    const now = Date.now();
    
    const queuedPeople = queue.map(agentId => {
      const info = this.agentQueueInfo.get(agentId);
      const joinedAt = info?.joinedAt || now;
      return {
        id: String(agentId),
        waitTimeSec: Math.floor((now - joinedAt) / 1000)
      };
    });
    
    const avgWaitTimeSec = queuedPeople.length > 0 
      ? queuedPeople.reduce((sum, p) => sum + p.waitTimeSec, 0) / queuedPeople.length 
      : 0;
    
    return {
      length: queue.length,
      queuedPeople,
      avgWaitTimeSec
    };
  }
}

export default QueueManager;
