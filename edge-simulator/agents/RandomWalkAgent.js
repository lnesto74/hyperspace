// Random Walk Agent - Enhanced with obstacle avoidance
// Simulates people walking around the venue avoiding obstacles

export class RandomWalkAgent {
  constructor(id, deviceId, venueWidth, venueDepth, options = {}) {
    this.id = id
    this.trackKey = `${deviceId}-person-${id}`
    this.deviceId = deviceId
    
    // Venue bounds (can be offset for DWG scenes)
    this.venueWidth = venueWidth
    this.venueDepth = venueDepth
    this.boundsMinX = options.boundsMinX || 0
    this.boundsMinZ = options.boundsMinZ || 0
    this.boundsMaxX = options.boundsMaxX || venueWidth
    this.boundsMaxZ = options.boundsMaxZ || venueDepth
    
    // Obstacles (array of { x, z, width, depth } bounding boxes)
    this.obstacles = options.obstacles || []
    
    // Entrance/exit points
    this.entrances = options.entrances || []
    this.exits = options.exits || []
    
    // Spawn from entrance if available, otherwise random
    const spawnPoint = this.getSpawnPoint()
    this.x = spawnPoint.x
    this.z = spawnPoint.z
    this.y = 0
    
    // Random target position (avoiding obstacles)
    const target = this.findValidTarget()
    this.targetX = target.x
    this.targetZ = target.z
    
    // Walking speed (m/s)
    this.speed = 0.8 + Math.random() * 0.7
    
    // Velocity
    this.vx = 0
    this.vz = 0
    
    // Pausing behavior
    this.pauseTime = 0
    this.isPaused = false
    
    // Bounding box
    this.boundingBox = {
      width: 0.4 + Math.random() * 0.2,
      height: 1.5 + Math.random() * 0.4,
      depth: 0.4 + Math.random() * 0.2
    }
  }

  update(deltaTime) {
    // Handle pausing
    if (this.isPaused) {
      this.pauseTime -= deltaTime
      if (this.pauseTime <= 0) {
        this.isPaused = false
        this.pickNewTarget()
      }
      this.vx = 0
      this.vz = 0
      return true
    }

    // Calculate direction to target
    const dx = this.targetX - this.x
    const dz = this.targetZ - this.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    // If close to target, pick a new one or pause
    if (dist < 0.5) {
      if (Math.random() < 0.3) {
        this.isPaused = true
        this.pauseTime = 1 + Math.random() * 3
        this.vx = 0
        this.vz = 0
      } else {
        this.pickNewTarget()
      }
      return true
    }

    // Normalize direction and apply speed
    const nx = dx / dist
    const nz = dz / dist
    
    // Add some randomness
    const wobble = 0.1
    let vx = (nx + (Math.random() - 0.5) * wobble) * this.speed
    let vz = (nz + (Math.random() - 0.5) * wobble) * this.speed
    
    // Apply obstacle avoidance
    const adjusted = this.avoidObstacles(vx, vz, deltaTime)
    this.vx = adjusted.vx
    this.vz = adjusted.vz

    // Update position
    this.x += this.vx * deltaTime
    this.z += this.vz * deltaTime

    // Keep within bounds
    this.x = Math.max(this.boundsMinX + 0.5, Math.min(this.boundsMaxX - 0.5, this.x))
    this.z = Math.max(this.boundsMinZ + 0.5, Math.min(this.boundsMaxZ - 0.5, this.z))
    
    return true  // Always keep alive
  }

  pickNewTarget() {
    const target = this.findValidTarget()
    this.targetX = target.x
    this.targetZ = target.z
    this.speed = 0.8 + Math.random() * 0.7
  }
  
  getSpawnPoint() {
    // If entrances defined, spawn from one
    if (this.entrances.length > 0) {
      const entrance = this.entrances[Math.floor(Math.random() * this.entrances.length)]
      return {
        x: entrance.x + (Math.random() - 0.5) * (entrance.width || 2),
        z: entrance.z + (Math.random() - 0.5) * (entrance.depth || 2)
      }
    }
    // Otherwise spawn at edge of venue
    const edge = Math.floor(Math.random() * 4)
    switch (edge) {
      case 0: return { x: this.boundsMinX + 0.5, z: this.boundsMinZ + Math.random() * (this.boundsMaxZ - this.boundsMinZ) }
      case 1: return { x: this.boundsMaxX - 0.5, z: this.boundsMinZ + Math.random() * (this.boundsMaxZ - this.boundsMinZ) }
      case 2: return { x: this.boundsMinX + Math.random() * (this.boundsMaxX - this.boundsMinX), z: this.boundsMinZ + 0.5 }
      default: return { x: this.boundsMinX + Math.random() * (this.boundsMaxX - this.boundsMinX), z: this.boundsMaxZ - 0.5 }
    }
  }
  
  findValidTarget() {
    // Try to find a position not inside an obstacle
    for (let attempts = 0; attempts < 20; attempts++) {
      const x = this.boundsMinX + 1 + Math.random() * (this.boundsMaxX - this.boundsMinX - 2)
      const z = this.boundsMinZ + 1 + Math.random() * (this.boundsMaxZ - this.boundsMinZ - 2)
      
      if (!this.isInsideObstacle(x, z)) {
        return { x, z }
      }
    }
    // Fallback to center if can't find valid spot
    return {
      x: (this.boundsMinX + this.boundsMaxX) / 2,
      z: (this.boundsMinZ + this.boundsMaxZ) / 2
    }
  }
  
  isInsideObstacle(x, z, padding = 0.3) {
    for (const obs of this.obstacles) {
      const halfW = (obs.width || 1) / 2 + padding
      const halfD = (obs.depth || 1) / 2 + padding
      if (x >= obs.x - halfW && x <= obs.x + halfW &&
          z >= obs.z - halfD && z <= obs.z + halfD) {
        return true
      }
    }
    return false
  }
  
  avoidObstacles(vx, vz, deltaTime) {
    // Check if next position would be inside an obstacle
    const nextX = this.x + vx * deltaTime
    const nextZ = this.z + vz * deltaTime
    
    if (this.isInsideObstacle(nextX, nextZ)) {
      // Find nearest obstacle and steer away
      let nearestObs = null
      let nearestDist = Infinity
      
      for (const obs of this.obstacles) {
        const dx = nextX - obs.x
        const dz = nextZ - obs.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist < nearestDist) {
          nearestDist = dist
          nearestObs = obs
        }
      }
      
      if (nearestObs) {
        // Steer perpendicular to obstacle
        const awayX = this.x - nearestObs.x
        const awayZ = this.z - nearestObs.z
        const awayLen = Math.sqrt(awayX * awayX + awayZ * awayZ) || 1
        
        // Blend steering away with original velocity
        return {
          vx: (vx * 0.3 + (awayX / awayLen) * this.speed * 0.7),
          vz: (vz * 0.3 + (awayZ / awayLen) * this.speed * 0.7)
        }
      }
    }
    
    return { vx, vz }
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
      boundingBox: this.boundingBox
    }
  }
}
