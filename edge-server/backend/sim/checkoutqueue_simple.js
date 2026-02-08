/**
 * Simple Checkout Queue System
 * Dead simple: pick cashier -> walk to it -> wait -> exit
 */

import { SIM_CONFIG } from './simconfig.js';

export const QUEUE_STATE = {
  NONE: 'NONE',
  WALKING_TO_CHECKOUT: 'WALKING_TO_CHECKOUT',
  SERVICE: 'SERVICE',
  EXITING: 'EXITING',
};

export class SimpleCheckoutQueue {
  constructor(navGrid, rng) {
    this.navGrid = navGrid;
    this.rng = rng;
    this.agentData = new Map();
    this.cashierQueues = new Map(); // cashierIndex -> [agentIds in order]
  }

  init() {
    // Initialize empty queues for each cashier
    const cashiers = this.navGrid.cashiers || [];
    for (let i = 0; i < cashiers.length; i++) {
      this.cashierQueues.set(i, []);
    }
    console.log(`[SimpleQueue] Initialized ${cashiers.length} cashiers`);
  }

  /**
   * Pick a cashier for an agent (shortest queue)
   */
  pickCashier(agentId) {
    const cashiers = this.navGrid.cashiers || [];
    if (cashiers.length === 0) return null;

    // Find cashiers with shortest queues
    let minLen = Infinity;
    let candidates = [];
    
    for (let i = 0; i < cashiers.length; i++) {
      const queueLen = this.cashierQueues.get(i)?.length || 0;
      if (queueLen < minLen) {
        minLen = queueLen;
        candidates = [i];
      } else if (queueLen === minLen) {
        candidates.push(i);
      }
    }

    // Random pick from shortest queues
    const chosen = candidates[Math.floor(this.rng.next() * candidates.length)];
    
    // Add agent to queue
    this.cashierQueues.get(chosen).push(agentId);
    
    // Store agent data
    this.agentData.set(agentId, {
      cashierIndex: chosen,
      state: QUEUE_STATE.WALKING_TO_CHECKOUT,
      serviceTime: 0,
      serviceDuration: this.rng.range(
        SIM_CONFIG.queueBehavior.serviceTimeByBasket.medium[0],
        SIM_CONFIG.queueBehavior.serviceTimeByBasket.medium[1]
      ),
    });

    const cashier = cashiers[chosen];
    console.log(`[SimpleQueue] Agent ${agentId} -> cashier ${chosen} at (${cashier.x.toFixed(1)}, queue=${minLen})`);
    
    return chosen;
  }

  /**
   * Get the target position for an agent
   */
  getTargetPosition(agentId) {
    const data = this.agentData.get(agentId);
    if (!data) return null;

    const cashiers = this.navGrid.cashiers || [];
    const cashier = cashiers[data.cashierIndex];
    if (!cashier) return null;

    // Get position in queue
    const queue = this.cashierQueues.get(data.cashierIndex) || [];
    const posInQueue = queue.indexOf(agentId);
    
    // Service position is 2m in front of cashier (in +Z direction)
    // Each position in queue is 1.5m further back
    const baseZ = (this.navGrid.zoneBounds.cashierLineZ || 7) + 2;
    const spacing = 1.5;
    
    return {
      x: cashier.x,
      z: baseZ + posInQueue * spacing,
    };
  }

  /**
   * Check if agent is at front of queue (can be served)
   */
  isAtFront(agentId) {
    const data = this.agentData.get(agentId);
    if (!data) return false;

    const queue = this.cashierQueues.get(data.cashierIndex) || [];
    return queue[0] === agentId;
  }

  /**
   * Start service for agent
   */
  startService(agentId) {
    const data = this.agentData.get(agentId);
    if (data) {
      data.state = QUEUE_STATE.SERVICE;
      data.serviceTime = 0;
    }
  }

  /**
   * Update service timer, returns true when done
   */
  updateService(agentId, dt) {
    const data = this.agentData.get(agentId);
    if (!data) return true;

    data.serviceTime += dt;
    return data.serviceTime >= data.serviceDuration;
  }

  /**
   * Remove agent from queue
   */
  removeAgent(agentId) {
    const data = this.agentData.get(agentId);
    if (data) {
      const queue = this.cashierQueues.get(data.cashierIndex);
      if (queue) {
        const idx = queue.indexOf(agentId);
        if (idx >= 0) queue.splice(idx, 1);
      }
      this.agentData.delete(agentId);
    }
  }

  /**
   * Get exit position (toward entrance)
   */
  getExitPosition(agentId) {
    const data = this.agentData.get(agentId);
    if (!data) return { x: this.navGrid.entrancePos.x, z: 0 };

    const cashiers = this.navGrid.cashiers || [];
    const cashier = cashiers[data.cashierIndex];
    
    // Exit toward entrance
    return {
      x: cashier ? cashier.x : this.navGrid.entrancePos.x,
      z: 2, // Near entrance
    };
  }

  // Stub methods for compatibility
  getAgentData() { return null; }
  initAgentQueueData() {}
  startQueueDecision() {}
  chooseLane() { return 0; }
  getBufferPoint() { return null; }
  joinTail() { return true; }
  getSlotPosition() { return null; }
  getServicePosition() { return null; }
  canAdvance() { return false; }
  advanceSlot() {}
  isAtServicePosition() { return false; }
  updateTimers() {}
  setQueueState() {}
  getExitSpeedMultiplier() { return 1.5; }
}
