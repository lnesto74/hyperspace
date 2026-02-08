// Random Walk Agent - Original simulation behavior
// Simulates people walking randomly around the venue

export class RandomWalkAgent {
  constructor(id, deviceId, venueWidth, venueDepth) {
    this.id = id
    this.trackKey = `${deviceId}-person-${id}`
    this.deviceId = deviceId
    
    // Venue bounds
    this.venueWidth = venueWidth
    this.venueDepth = venueDepth
    
    // Random starting position
    this.x = Math.random() * venueWidth
    this.z = Math.random() * venueDepth
    this.y = 0
    
    // Random target position
    this.targetX = Math.random() * venueWidth
    this.targetZ = Math.random() * venueDepth
    
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
    this.vx = (nx + (Math.random() - 0.5) * wobble) * this.speed
    this.vz = (nz + (Math.random() - 0.5) * wobble) * this.speed

    // Update position
    this.x += this.vx * deltaTime
    this.z += this.vz * deltaTime

    // Keep within bounds
    this.x = Math.max(0.5, Math.min(this.venueWidth - 0.5, this.x))
    this.z = Math.max(0.5, Math.min(this.venueDepth - 0.5, this.z))
    
    return true  // Always keep alive
  }

  pickNewTarget() {
    this.targetX = 1 + Math.random() * (this.venueWidth - 2)
    this.targetZ = 1 + Math.random() * (this.venueDepth - 2)
    this.speed = 0.8 + Math.random() * 0.7
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
