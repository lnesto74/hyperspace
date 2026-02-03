import mqtt from 'mqtt'

// Configuration
const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'
const DEVICE_ID = process.env.DEVICE_ID || 'lidar-ulisse'
const VENUE_ID = process.env.VENUE_ID || 'default'
const TOPIC = `hyperspace/trajectories/${DEVICE_ID}`

// Venue bounds (meters)
const VENUE_WIDTH = parseFloat(process.env.VENUE_WIDTH) || 20
const VENUE_DEPTH = parseFloat(process.env.VENUE_DEPTH) || 15

// Simulation settings
const NUM_PEOPLE = parseInt(process.env.NUM_PEOPLE) || 5
const UPDATE_INTERVAL_MS = parseInt(process.env.UPDATE_INTERVAL_MS) || 100

// Person class to simulate walking behavior
class SimulatedPerson {
  constructor(id) {
    this.id = id
    this.trackKey = `${DEVICE_ID}-person-${id}`
    
    // Random starting position
    this.x = Math.random() * VENUE_WIDTH
    this.z = Math.random() * VENUE_DEPTH
    this.y = 0 // Floor level
    
    // Random target position
    this.targetX = Math.random() * VENUE_WIDTH
    this.targetZ = Math.random() * VENUE_DEPTH
    
    // Walking speed (m/s) - typical human walking speed 1.2-1.5 m/s
    this.speed = 0.8 + Math.random() * 0.7
    
    // Bounding box for person (cylinder dimensions)
    this.boundingBox = {
      width: 0.4 + Math.random() * 0.2,   // 40-60cm diameter
      height: 1.5 + Math.random() * 0.4,  // 1.5-1.9m tall
      depth: 0.4 + Math.random() * 0.2    // 40-60cm diameter
    }
    
    // Velocity
    this.vx = 0
    this.vz = 0
    
    // Time at current position (for pausing behavior)
    this.pauseTime = 0
    this.isPaused = false
  }

  update(deltaTime) {
    // Handle pausing (simulates stopping to look at something)
    if (this.isPaused) {
      this.pauseTime -= deltaTime
      if (this.pauseTime <= 0) {
        this.isPaused = false
        this.pickNewTarget()
      }
      this.vx = 0
      this.vz = 0
      return
    }

    // Calculate direction to target
    const dx = this.targetX - this.x
    const dz = this.targetZ - this.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    // If close to target, pick a new one or pause
    if (dist < 0.5) {
      if (Math.random() < 0.3) {
        // 30% chance to pause
        this.isPaused = true
        this.pauseTime = 1 + Math.random() * 3 // 1-4 seconds
        this.vx = 0
        this.vz = 0
      } else {
        this.pickNewTarget()
      }
      return
    }

    // Normalize direction and apply speed
    const nx = dx / dist
    const nz = dz / dist
    
    // Add some randomness to movement (wobble)
    const wobble = 0.1
    const wobbleX = (Math.random() - 0.5) * wobble
    const wobbleZ = (Math.random() - 0.5) * wobble

    this.vx = (nx + wobbleX) * this.speed
    this.vz = (nz + wobbleZ) * this.speed

    // Update position
    this.x += this.vx * deltaTime
    this.z += this.vz * deltaTime

    // Keep within bounds
    this.x = Math.max(0.5, Math.min(VENUE_WIDTH - 0.5, this.x))
    this.z = Math.max(0.5, Math.min(VENUE_DEPTH - 0.5, this.z))
  }

  pickNewTarget() {
    // Pick a random target, weighted towards areas of interest
    // For now, just random points with margin from walls
    this.targetX = 1 + Math.random() * (VENUE_WIDTH - 2)
    this.targetZ = 1 + Math.random() * (VENUE_DEPTH - 2)
    
    // Occasionally vary walking speed
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

// Main simulator
class LidarSimulator {
  constructor() {
    this.client = null
    this.people = []
    this.lastUpdateTime = Date.now()
    this.isRunning = false

    // Create simulated people
    for (let i = 0; i < NUM_PEOPLE; i++) {
      this.people.push(new SimulatedPerson(i + 1))
    }
  }

  connect() {
    console.log(`[Simulator] Connecting to MQTT broker: ${MQTT_BROKER}`)
    console.log(`[Simulator] Device ID: ${DEVICE_ID}`)
    console.log(`[Simulator] Venue: ${VENUE_WIDTH}m x ${VENUE_DEPTH}m`)
    console.log(`[Simulator] Simulating ${NUM_PEOPLE} people`)

    this.client = mqtt.connect(MQTT_BROKER, {
      clientId: `simulator-${DEVICE_ID}-${Date.now()}`,
      clean: true,
    })

    this.client.on('connect', () => {
      console.log('[Simulator] Connected to MQTT broker')
      this.isRunning = true
      this.startSimulation()
    })

    this.client.on('error', (err) => {
      console.error('[Simulator] MQTT error:', err)
    })

    this.client.on('close', () => {
      console.log('[Simulator] Disconnected from MQTT broker')
      this.isRunning = false
    })
  }

  startSimulation() {
    console.log(`[Simulator] Starting simulation, publishing to ${TOPIC}`)

    setInterval(() => {
      if (!this.isRunning) return

      const now = Date.now()
      const deltaTime = (now - this.lastUpdateTime) / 1000
      this.lastUpdateTime = now

      // Update all people
      for (const person of this.people) {
        person.update(deltaTime)
      }

      // Build message with all tracks
      const message = {
        venueId: VENUE_ID,
        deviceId: DEVICE_ID,
        timestamp: now,
        tracks: this.people.map(p => p.toTrackData())
      }

      // Publish to MQTT
      this.client.publish(TOPIC, JSON.stringify(message), { qos: 0 }, (err) => {
        if (err) {
          console.error('[Simulator] Publish error:', err)
        }
      })

      // Log status occasionally
      if (Math.random() < 0.01) {
        console.log(`[Simulator] Published ${this.people.length} tracks`)
      }

    }, UPDATE_INTERVAL_MS)
  }

  // Dynamically add a person
  addPerson() {
    const newId = this.people.length + 1
    const person = new SimulatedPerson(newId)
    this.people.push(person)
    console.log(`[Simulator] Added person ${newId}`)
  }

  // Dynamically remove a person
  removePerson() {
    if (this.people.length > 1) {
      const removed = this.people.pop()
      console.log(`[Simulator] Removed person ${removed.id}`)
    }
  }
}

// Start the simulator
const simulator = new LidarSimulator()
simulator.connect()

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Simulator] Shutting down...')
  if (simulator.client) {
    simulator.client.end()
  }
  process.exit(0)
})

// CLI commands for dynamic control
process.stdin.on('data', (data) => {
  const cmd = data.toString().trim()
  if (cmd === '+' || cmd === 'add') {
    simulator.addPerson()
  } else if (cmd === '-' || cmd === 'remove') {
    simulator.removePerson()
  } else if (cmd === 'status') {
    console.log(`[Simulator] ${simulator.people.length} people active`)
  }
})

console.log('[Simulator] Commands: + (add person), - (remove person), status')
