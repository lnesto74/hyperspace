/**
 * LaneStateController - Manual checkout lane control
 * 
 * Manages manual open/close state for checkout lanes.
 * Uses queue zone UUIDs as the single source of truth for lane identity.
 * displayIndex provides "Lane 1", "Lane 2" numbering based on X position.
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
    
    // Lane states indexed by queueZoneId (UUID)
    // { queueZoneId: { laneId, displayIndex, desiredState, status, cashierAgentId, queueCount, lastChangeTs } }
    this.lanes = new Map()
    
    // Track spawned cashiers by queueZoneId
    this.cashiersByLane = new Map()
    
    // Map displayIndex (1, 2, 3...) to queueZoneId for backward compatibility
    this.displayIndexToUuid = new Map()
    this.uuidToDisplayIndex = new Map()
  }

  /**
   * Initialize lanes from venue geometry checkout objects
   * @param {Array} checkoutObjects - Array of checkout lane definitions with queueZoneId (UUID)
   */
  initializeLanes(checkoutObjects) {
    this.lanes.clear()
    this.cashiersByLane.clear()
    this.displayIndexToUuid.clear()
    this.uuidToDisplayIndex.clear()
    
    if (!checkoutObjects || !Array.isArray(checkoutObjects)) {
      console.log('[LaneStateController] No checkout objects to initialize')
      return
    }

    // Sort by X position for consistent "Lane 1", "Lane 2" numbering
    const sortedCheckouts = [...checkoutObjects].sort((a, b) => {
      const aX = a.queueCenter?.x || a.serviceArea?.x || 0
      const bX = b.queueCenter?.x || b.serviceArea?.x || 0
      return aX - bX
    })

    sortedCheckouts.forEach((checkout, index) => {
      // Use queueZoneId (UUID) as primary key, fall back to laneId or index
      const queueZoneId = checkout.queueZoneId || checkout.laneId || checkout.id || `lane-${index}`
      const displayIndex = index + 1  // 1-indexed for display: "Lane 1", "Lane 2", etc.
      
      this.displayIndexToUuid.set(displayIndex, queueZoneId)
      this.uuidToDisplayIndex.set(queueZoneId, displayIndex)
      
      this.lanes.set(queueZoneId, {
        laneId: queueZoneId,  // UUID
        queueZoneId,          // UUID (explicit)
        displayIndex,         // Human-friendly: 1, 2, 3...
        displayName: `Lane ${displayIndex}`,
        desiredState: 'closed',  // Start all lanes closed in manual mode
        status: 'CLOSED',
        cashierAgentId: null,
        queueCount: 0,
        lastChangeTs: Date.now(),
        // Store geometry for cashier spawning
        serviceArea: checkout.serviceArea,
        queueArea: checkout.queueArea,
        queueCenter: checkout.queueCenter,
        serviceCenter: checkout.serviceCenter,
        standPoint: checkout.standPoint
      })
    })
    
    console.log(`[LaneStateController] Initialized ${this.lanes.size} lanes (all closed, sorted by X position)`)
  }

  /**
   * Get status of all lanes
   * @returns {Array} Array of lane status objects sorted by displayIndex
   */
  getAllLaneStatus() {
    const result = []
    for (const [queueZoneId, lane] of this.lanes) {
      // Get queue info with wait times from queueManager
      let avgWaitTimeSec = 0
      let queuedPeople = []
      
      if (this.simulator.queueManager) {
        // Try UUID first, then fall back to displayIndex-1 for legacy
        let queueInfo = this.simulator.queueManager.getQueueInfo(queueZoneId)
        if (!queueInfo) {
          queueInfo = this.simulator.queueManager.getQueueInfo(lane.displayIndex - 1)
        }
        if (queueInfo) {
          avgWaitTimeSec = queueInfo.avgWaitTimeSec || 0
          queuedPeople = queueInfo.queuedPeople || []
        }
      }
      
      result.push({
        laneId: lane.displayIndex,  // For backward compatibility with UI
        queueZoneId,                // UUID - the real identifier
        displayIndex: lane.displayIndex,
        displayName: lane.displayName,
        desiredState: lane.desiredState,
        status: lane.status,
        cashierAgentId: lane.cashierAgentId,
        queueCount: lane.queueCount,
        avgWaitTimeSec,
        queuedPeople,
        lastChangeTs: lane.lastChangeTs
      })
    }
    // Sort by displayIndex for consistent ordering
    return result.sort((a, b) => a.displayIndex - b.displayIndex)
  }

  /**
   * Get status of a specific lane by UUID or displayIndex
   * @param {string|number} laneIdOrIndex - UUID string or displayIndex number
   * @returns {Object|null} Lane status or null if not found
   */
  getLaneStatus(laneIdOrIndex) {
    // First try direct UUID lookup
    if (this.lanes.has(laneIdOrIndex)) {
      return this.lanes.get(laneIdOrIndex)
    }
    // If numeric, try displayIndex lookup
    if (typeof laneIdOrIndex === 'number') {
      const uuid = this.displayIndexToUuid.get(laneIdOrIndex)
      if (uuid) return this.lanes.get(uuid)
    }
    return null
  }

  /**
   * Set desired state for a lane (manual control)
   * @param {string|number} laneIdOrIndex - UUID string or displayIndex number
   * @param {string} desiredState - 'open' or 'closed'
   * @returns {Object} Result with success/error
   */
  setLaneState(laneIdOrIndex, desiredState) {
    // Resolve to UUID
    let queueZoneId = laneIdOrIndex
    if (typeof laneIdOrIndex === 'number') {
      queueZoneId = this.displayIndexToUuid.get(laneIdOrIndex)
    }
    
    const lane = this.lanes.get(queueZoneId)
    if (!lane) {
      return { success: false, error: `Lane ${laneIdOrIndex} not found` }
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
    
    // Check if we have an existing cashier for this lane (by UUID)
    let cashier = this.cashiersByLane.get(lane.queueZoneId)
    
    if (cashier && cashier.state !== 'DONE') {
      // Reactivate existing cashier
      cashier.setManualCommand('open')
      console.log(`[LaneStateController] Reactivating cashier for ${lane.displayName} (${lane.queueZoneId})`)
    } else {
      // Need to spawn new cashier via simulator - pass displayIndex for position lookup
      cashier = this.simulator.spawnCashierForLane(lane.displayIndex - 1, lane)
      if (cashier) {
        this.cashiersByLane.set(lane.queueZoneId, cashier)
        lane.cashierAgentId = cashier.id
        console.log(`[LaneStateController] Spawned new cashier ${cashier.id} for ${lane.displayName} (${lane.queueZoneId})`)
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
    
    const cashier = this.cashiersByLane.get(lane.queueZoneId)
    if (cashier) {
      cashier.setManualCommand('close')
      console.log(`[LaneStateController] Closing ${lane.displayName} (${lane.queueZoneId}), cashier will finish and leave`)
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
    for (const [queueZoneId, lane] of this.lanes) {
      const cashier = this.cashiersByLane.get(queueZoneId)
      
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
        // Try UUID first, then fall back to displayIndex-1 for legacy
        let queueInfo = this.simulator.queueManager.getQueueInfo(queueZoneId)
        if (!queueInfo) {
          queueInfo = this.simulator.queueManager.getQueueInfo(lane.displayIndex - 1)
        }
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

    for (const [queueZoneId, lane] of this.lanes) {
      totalQueueCount += lane.queueCount
      if (lane.status === 'OPEN') {
        openLaneCount++
      } else if (lane.status === 'CLOSED') {
        closedLanes.push({ queueZoneId, displayIndex: lane.displayIndex })
      }
    }

    const avgQueuePerLane = openLaneCount > 0 ? totalQueueCount / openLaneCount : 0
    const shouldOpenMore = avgQueuePerLane > this.config.queuePressureThreshold && closedLanes.length > 0

    // Sort closed lanes by displayIndex for consistent suggestions
    closedLanes.sort((a, b) => a.displayIndex - b.displayIndex)
    const suggested = closedLanes[0] || null
    
    return {
      totalQueueCount,
      openLaneCount,
      closedLaneCount: closedLanes.length,
      avgQueuePerLane: Math.round(avgQueuePerLane * 10) / 10,
      pressureThreshold: this.config.queuePressureThreshold,
      shouldOpenMore,
      suggestedLaneToOpen: suggested ? suggested.displayIndex : null,
      suggestedQueueZoneId: suggested ? suggested.queueZoneId : null
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
   * Get all open lane IDs (returns UUIDs)
   */
  getOpenLaneIds() {
    const ids = []
    for (const [queueZoneId, lane] of this.lanes) {
      if (lane.status === 'OPEN') {
        ids.push(queueZoneId)
      }
    }
    return ids
  }
  
  /**
   * Get all open lane displayIndexes (for legacy compatibility)
   */
  getOpenLaneIndexes() {
    const indexes = []
    for (const [queueZoneId, lane] of this.lanes) {
      if (lane.status === 'OPEN') {
        indexes.push(lane.displayIndex - 1)  // 0-indexed for simulator
      }
    }
    return indexes
  }
  
  /**
   * Resolve a laneId (UUID or displayIndex) to UUID
   */
  resolveToUuid(laneIdOrIndex) {
    if (this.lanes.has(laneIdOrIndex)) return laneIdOrIndex
    if (typeof laneIdOrIndex === 'number') {
      return this.displayIndexToUuid.get(laneIdOrIndex) || null
    }
    return null
  }
}

export default LaneStateController
