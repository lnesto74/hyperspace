/**
 * LaneStateController - Manual checkout lane control
 * 
 * Manages manual open/close state for checkout lanes.
 * Only active when config.enableCheckoutManager = true.
 * Does NOT interfere with existing auto-scheduling when disabled.
 */

export class LaneStateController {
  constructor(simulator, config = {}) {
    this.simulator = simulator
    this.config = {
      queuePressureThreshold: config.queuePressureThreshold || 5,
      inflowRateThreshold: config.inflowRateThreshold || 10,
      ...config
    }
    
    // Lane states indexed by laneId
    // { laneId: { desiredState, status, cashierAgentId, queueCount, lastChangeTs } }
    this.lanes = new Map()
    
    // Track spawned cashiers by lane
    this.cashiersByLane = new Map()
  }

  /**
   * Initialize lanes from venue geometry checkout objects
   * @param {Array} checkoutObjects - Array of checkout lane definitions from venue
   */
  initializeLanes(checkoutObjects) {
    this.lanes.clear()
    this.cashiersByLane.clear()
    
    if (!checkoutObjects || !Array.isArray(checkoutObjects)) {
      console.log('[LaneStateController] No checkout objects to initialize')
      return
    }

    for (const checkout of checkoutObjects) {
      const laneId = checkout.laneId || checkout.id
      this.lanes.set(laneId, {
        laneId,
        desiredState: 'closed',  // Start all lanes closed in manual mode
        status: 'CLOSED',
        cashierAgentId: null,
        queueCount: 0,
        lastChangeTs: Date.now(),
        // Store geometry for cashier spawning
        serviceArea: checkout.serviceArea,
        queueArea: checkout.queueArea,
        standPoint: checkout.standPoint
      })
    }
    
    console.log(`[LaneStateController] Initialized ${this.lanes.size} lanes (all closed)`)
  }

  /**
   * Get status of all lanes
   * @returns {Array} Array of lane status objects
   */
  getAllLaneStatus() {
    const result = []
    for (const [laneId, lane] of this.lanes) {
      // Get queue info with wait times from queueManager
      let avgWaitTimeSec = 0
      let queuedPeople = []
      
      if (this.simulator.queueManager) {
        const queueInfo = this.simulator.queueManager.getQueueInfo(laneId)
        if (queueInfo) {
          avgWaitTimeSec = queueInfo.avgWaitTimeSec || 0
          queuedPeople = queueInfo.queuedPeople || []
        }
      }
      
      result.push({
        laneId,
        desiredState: lane.desiredState,
        status: lane.status,
        cashierAgentId: lane.cashierAgentId,
        queueCount: lane.queueCount,
        avgWaitTimeSec,
        queuedPeople,
        lastChangeTs: lane.lastChangeTs
      })
    }
    return result
  }

  /**
   * Get status of a specific lane
   * @param {string|number} laneId 
   * @returns {Object|null} Lane status or null if not found
   */
  getLaneStatus(laneId) {
    return this.lanes.get(laneId) || null
  }

  /**
   * Set desired state for a lane (manual control)
   * @param {string|number} laneId 
   * @param {string} desiredState - 'open' or 'closed'
   * @returns {Object} Result with success/error
   */
  setLaneState(laneId, desiredState) {
    const lane = this.lanes.get(laneId)
    if (!lane) {
      return { success: false, error: `Lane ${laneId} not found` }
    }

    if (desiredState !== 'open' && desiredState !== 'closed') {
      return { success: false, error: `Invalid state: ${desiredState}` }
    }

    // No-op if already in desired state
    if (lane.desiredState === desiredState) {
      return { success: true, status: lane.status, message: 'Already in desired state' }
    }

    lane.desiredState = desiredState
    lane.lastChangeTs = Date.now()

    if (desiredState === 'open') {
      return this._openLane(lane)
    } else {
      return this._closeLane(lane)
    }
  }

  /**
   * Open a lane - spawn or reactivate cashier
   * @private
   */
  _openLane(lane) {
    lane.status = 'OPENING'
    
    // Check if we have an existing cashier for this lane
    let cashier = this.cashiersByLane.get(lane.laneId)
    
    if (cashier && cashier.state !== 'DONE') {
      // Reactivate existing cashier
      cashier.setManualCommand('open')
      console.log(`[LaneStateController] Reactivating cashier for lane ${lane.laneId}`)
    } else {
      // Need to spawn new cashier via simulator
      cashier = this.simulator.spawnCashierForLane(lane.laneId, lane)
      if (cashier) {
        this.cashiersByLane.set(lane.laneId, cashier)
        lane.cashierAgentId = cashier.id
        console.log(`[LaneStateController] Spawned new cashier ${cashier.id} for lane ${lane.laneId}`)
      } else {
        lane.status = 'CLOSED'
        lane.desiredState = 'closed'
        return { success: false, error: 'Failed to spawn cashier' }
      }
    }

    return { success: true, status: lane.status }
  }

  /**
   * Close a lane - tell cashier to finish and leave
   * @private
   */
  _closeLane(lane) {
    lane.status = 'CLOSING'
    
    const cashier = this.cashiersByLane.get(lane.laneId)
    if (cashier) {
      cashier.setManualCommand('close')
      console.log(`[LaneStateController] Closing lane ${lane.laneId}, cashier will finish and leave`)
    } else {
      // No cashier, just mark as closed
      lane.status = 'CLOSED'
    }

    return { success: true, status: lane.status }
  }

  /**
   * Update lane statuses based on cashier states
   * Called each simulation tick
   */
  update() {
    for (const [laneId, lane] of this.lanes) {
      const cashier = this.cashiersByLane.get(laneId)
      
      if (!cashier) {
        if (lane.status !== 'CLOSED') {
          lane.status = 'CLOSED'
        }
        continue
      }

      // Update status based on cashier state
      const cashierState = cashier.state
      
      if (lane.desiredState === 'open') {
        if (cashierState === 'WORKING') {
          lane.status = 'OPEN'
        } else if (cashierState === 'ARRIVE') {
          lane.status = 'OPENING'
        }
      } else if (lane.desiredState === 'closed') {
        if (cashierState === 'OFFSHIFT' || cashierState === 'DONE') {
          lane.status = 'CLOSED'
        } else if (cashierState === 'LEAVE') {
          lane.status = 'CLOSING'
        } else if (cashierState === 'WORKING') {
          // Still serving customer, will close after
          lane.status = 'CLOSING'
        }
      }

      // Update queue count from simulator's queue manager
      if (this.simulator.queueManager) {
        const queueInfo = this.simulator.queueManager.getQueueInfo(laneId)
        lane.queueCount = queueInfo ? queueInfo.length : 0
      }
    }
  }

  /**
   * Calculate queue pressure metrics
   * @returns {Object} Pressure metrics and suggestions
   */
  getQueuePressure() {
    let totalQueueCount = 0
    let openLaneCount = 0
    const closedLanes = []

    for (const [laneId, lane] of this.lanes) {
      totalQueueCount += lane.queueCount
      if (lane.status === 'OPEN') {
        openLaneCount++
      } else if (lane.status === 'CLOSED') {
        closedLanes.push(laneId)
      }
    }

    const avgQueuePerLane = openLaneCount > 0 ? totalQueueCount / openLaneCount : 0
    const shouldOpenMore = avgQueuePerLane > this.config.queuePressureThreshold && closedLanes.length > 0

    return {
      totalQueueCount,
      openLaneCount,
      closedLaneCount: closedLanes.length,
      avgQueuePerLane: Math.round(avgQueuePerLane * 10) / 10,
      pressureThreshold: this.config.queuePressureThreshold,
      shouldOpenMore,
      suggestedLaneToOpen: shouldOpenMore ? closedLanes[0] : null
    }
  }

  /**
   * Update thresholds
   * @param {Object} thresholds 
   */
  updateThresholds(thresholds) {
    if (thresholds.queuePressureThreshold !== undefined) {
      this.config.queuePressureThreshold = thresholds.queuePressureThreshold
    }
    if (thresholds.inflowRateThreshold !== undefined) {
      this.config.inflowRateThreshold = thresholds.inflowRateThreshold
    }
    console.log('[LaneStateController] Updated thresholds:', this.config)
  }

  /**
   * Get open lane count
   */
  getOpenLaneCount() {
    let count = 0
    for (const lane of this.lanes.values()) {
      if (lane.status === 'OPEN' || lane.status === 'OPENING') {
        count++
      }
    }
    return count
  }

  /**
   * Get all open lane IDs
   */
  getOpenLaneIds() {
    const ids = []
    for (const [laneId, lane] of this.lanes) {
      if (lane.status === 'OPEN') {
        ids.push(laneId)
      }
    }
    return ids
  }
}

export default LaneStateController
