// Queue Agent - Simulates realistic queue behavior at cashiers
// Fetches geometry from backend and simulates people joining queues, waiting, being served

export class QueueAgent {
  constructor(id, deviceId, queueZone, serviceZone, cashierPosition) {
    this.id = id
    this.trackKey = `${deviceId}-queue-${id}`
    this.deviceId = deviceId
    
    // Zone geometry
    this.queueZone = queueZone         // { vertices, center, color }
    this.serviceZone = serviceZone     // { vertices, center, color }
    this.cashierPosition = cashierPosition
    
    // State machine: 'approaching' -> 'queuing' -> 'serving' -> 'leaving' -> 'done'
    this.state = 'approaching'
    
    // Position - start outside the queue
    const approachOffset = 8 + Math.random() * 4  // 8-12m away from queue
    this.x = queueZone.center.x + (Math.random() - 0.5) * 3
    this.z = queueZone.center.z + approachOffset
    this.y = 0
    
    // Target position (updated based on state)
    this.targetX = this.x
    this.targetZ = this.z
    
    // Walking speed
    this.speed = 1.0 + Math.random() * 0.4
    this.vx = 0
    this.vz = 0
    
    // Queue position (slot in line)
    this.queueSlot = 0
    this.waitTime = 0
    this.serviceTime = 0
    
    // Timing
    this.stateTime = 0
    this.targetWaitTime = 5 + Math.random() * 20     // 5-25 seconds in queue
    this.targetServiceTime = 3 + Math.random() * 8   // 3-11 seconds being served
    
    // Bounding box
    this.boundingBox = {
      width: 0.4 + Math.random() * 0.2,
      height: 1.5 + Math.random() * 0.4,
      depth: 0.4 + Math.random() * 0.2
    }
    
    // Set initial target
    this.setTargetForState()
  }

  setTargetForState() {
    switch (this.state) {
      case 'approaching':
        // Target: end of queue zone
        this.targetX = this.queueZone.center.x + (Math.random() - 0.5) * 0.5
        this.targetZ = this.queueZone.center.z + 1.5  // Near end of queue
        break
        
      case 'queuing':
        // Target: move forward in queue based on slot
        const queueProgress = 1 - (this.stateTime / this.targetWaitTime)
        const queueLength = Math.abs(this.serviceZone.center.z - this.queueZone.center.z)
        this.targetX = this.queueZone.center.x + (Math.random() - 0.5) * 0.3
        this.targetZ = this.queueZone.center.z - queueProgress * queueLength * 0.8
        break
        
      case 'serving':
        // Target: service zone center (at counter)
        this.targetX = this.serviceZone.center.x + (Math.random() - 0.5) * 0.3
        this.targetZ = this.serviceZone.center.z
        break
        
      case 'leaving':
        // Target: exit to the side or back
        const exitSide = Math.random() > 0.5 ? 1 : -1
        this.targetX = this.serviceZone.center.x + exitSide * 5
        this.targetZ = this.serviceZone.center.z - 2
        break
    }
  }

  update(deltaTime) {
    if (this.state === 'done') return false  // Signal removal
    
    this.stateTime += deltaTime
    
    // State transitions
    switch (this.state) {
      case 'approaching':
        if (this.isNearTarget(1.0)) {
          this.state = 'queuing'
          this.stateTime = 0
          this.setTargetForState()
        }
        break
        
      case 'queuing':
        // Gradually update target to move forward in queue
        if (this.stateTime % 2 < deltaTime) {
          this.setTargetForState()
        }
        if (this.stateTime >= this.targetWaitTime) {
          this.state = 'serving'
          this.stateTime = 0
          this.setTargetForState()
        }
        break
        
      case 'serving':
        if (this.stateTime >= this.targetServiceTime) {
          this.state = 'leaving'
          this.stateTime = 0
          this.setTargetForState()
        }
        break
        
      case 'leaving':
        if (this.isNearTarget(0.5) || this.stateTime > 5) {
          this.state = 'done'
          return false  // Remove this agent
        }
        break
    }
    
    // Movement
    this.moveTowardsTarget(deltaTime)
    
    return true  // Keep agent alive
  }

  moveTowardsTarget(deltaTime) {
    const dx = this.targetX - this.x
    const dz = this.targetZ - this.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    
    if (dist < 0.1) {
      this.vx = 0
      this.vz = 0
      return
    }
    
    // In queue, move slower
    const effectiveSpeed = this.state === 'queuing' ? this.speed * 0.3 : this.speed
    
    const nx = dx / dist
    const nz = dz / dist
    
    // Add slight wobble
    const wobble = this.state === 'queuing' ? 0.02 : 0.05
    this.vx = (nx + (Math.random() - 0.5) * wobble) * effectiveSpeed
    this.vz = (nz + (Math.random() - 0.5) * wobble) * effectiveSpeed
    
    this.x += this.vx * deltaTime
    this.z += this.vz * deltaTime
  }

  isNearTarget(threshold) {
    const dx = this.targetX - this.x
    const dz = this.targetZ - this.z
    return Math.sqrt(dx * dx + dz * dz) < threshold
  }

  toTrackData() {
    return {
      id: this.id.toString(),
      trackKey: this.trackKey,
      timestamp: Date.now(),
      position: { x: this.x, y: this.y, z: this.z },
      venuePosition: { x: this.x, y: this.y, z: this.z },
      velocity: { x: this.vx, y: 0, z: this.vz },
      objectType: 'person',
      boundingBox: this.boundingBox,
      // Extra metadata for debugging
      metadata: {
        agentType: 'queue',
        state: this.state,
        stateTime: this.stateTime
      }
    }
  }
}

// Helper to calculate zone center from vertices
export function calculateZoneCenter(vertices) {
  if (!vertices || vertices.length === 0) return { x: 0, z: 0 }
  
  const sum = vertices.reduce((acc, v) => ({
    x: acc.x + v.x,
    z: acc.z + v.z
  }), { x: 0, z: 0 })
  
  return {
    x: sum.x / vertices.length,
    z: sum.z / vertices.length
  }
}
