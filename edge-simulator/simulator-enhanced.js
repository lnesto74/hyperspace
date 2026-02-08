import mqtt from 'mqtt'
import { QueueAgent, calculateZoneCenter } from './agents/QueueAgent.js'
import { RandomWalkAgent } from './agents/RandomWalkAgent.js'

// Configuration
const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001'
const DEVICE_ID = process.env.DEVICE_ID || 'lidar-ulisse'
const VENUE_ID = process.env.VENUE_ID || 'default'
const TOPIC = `hyperspace/trajectories/${DEVICE_ID}`

// Simulation settings
const UPDATE_INTERVAL_MS = parseInt(process.env.UPDATE_INTERVAL_MS) || 100
const SIMULATION_MODE = process.env.SIMULATION_MODE || 'mixed'  // 'random', 'queue', 'mixed'
const NUM_RANDOM_WALKERS = parseInt(process.env.NUM_RANDOM_WALKERS) || 3
const QUEUE_SPAWN_INTERVAL = parseInt(process.env.QUEUE_SPAWN_INTERVAL) || 5000  // ms between new queue customers

// Geometry cache
let venueGeometry = null
let cashierZones = []  // { queueZone, serviceZone, cashierPosition }

// Fetch venue geometry from backend
async function fetchVenueGeometry() {
  console.log(`[Simulator] Fetching geometry from ${BACKEND_URL}/api/venues/${VENUE_ID}`)
  
  try {
    // Fetch venue data
    const venueRes = await fetch(`${BACKEND_URL}/api/venues/${VENUE_ID}`)
    if (!venueRes.ok) {
      console.error('[Simulator] Failed to fetch venue:', venueRes.status)
      return null
    }
    const venueData = await venueRes.json()
    
    // Fetch ROIs
    const roiRes = await fetch(`${BACKEND_URL}/api/venues/${VENUE_ID}/roi`)
    if (!roiRes.ok) {
      console.error('[Simulator] Failed to fetch ROIs:', roiRes.status)
      return null
    }
    const rois = await roiRes.json()
    
    console.log(`[Simulator] Loaded venue: ${venueData.venue?.name || 'Unknown'}`)
    console.log(`[Simulator] Venue size: ${venueData.venue?.width}m x ${venueData.venue?.depth}m`)
    console.log(`[Simulator] Found ${rois.length} ROIs`)
    
    return {
      venue: venueData.venue,
      objects: venueData.objects || [],
      rois: rois
    }
  } catch (err) {
    console.error('[Simulator] Error fetching geometry:', err.message)
    return null
  }
}

// Parse ROIs to find cashier queue/service zone pairs
function parseCashierZones(geometry) {
  const zones = []
  const rois = geometry.rois || []
  
  // Find pairs of Queue and Service zones
  const queueZones = rois.filter(r => r.name.endsWith('- Queue'))
  const serviceZones = rois.filter(r => r.name.endsWith('- Service'))
  
  console.log(`[Simulator] Found ${queueZones.length} queue zones, ${serviceZones.length} service zones`)
  
  for (const queueZone of queueZones) {
    // Extract cashier name (e.g., "Cashier 1 - Queue" -> "Cashier 1")
    const cashierName = queueZone.name.replace('- Queue', '').trim()
    
    // Find matching service zone
    const serviceZone = serviceZones.find(s => 
      s.name.replace('- Service', '').trim() === cashierName
    )
    
    if (serviceZone) {
      // Find cashier object position
      const cashierObj = geometry.objects.find(o => 
        o.name.toLowerCase().includes(cashierName.toLowerCase()) ||
        o.name === cashierName
      )
      
      zones.push({
        name: cashierName,
        queueZone: {
          ...queueZone,
          center: calculateZoneCenter(queueZone.vertices)
        },
        serviceZone: {
          ...serviceZone,
          center: calculateZoneCenter(serviceZone.vertices)
        },
        cashierPosition: cashierObj?.position || serviceZone.center
      })
      
      console.log(`[Simulator] Paired: ${cashierName} (Queue + Service)`)
    }
  }
  
  return zones
}

// Main enhanced simulator
class EnhancedLidarSimulator {
  constructor() {
    this.client = null
    this.agents = []
    this.lastUpdateTime = Date.now()
    this.lastQueueSpawnTime = Date.now()
    this.isRunning = false
    this.nextAgentId = 1
    this.geometry = null
    this.mode = SIMULATION_MODE
  }

  async initialize() {
    console.log('[Simulator] Initializing enhanced simulator...')
    console.log(`[Simulator] Mode: ${this.mode}`)
    
    // Fetch geometry from backend
    this.geometry = await fetchVenueGeometry()
    
    if (this.geometry) {
      venueGeometry = this.geometry
      cashierZones = parseCashierZones(this.geometry)
      
      if (cashierZones.length === 0 && (this.mode === 'queue' || this.mode === 'mixed')) {
        console.warn('[Simulator] No cashier zones found! Run Smart KPI to generate queue zones.')
        console.warn('[Simulator] Falling back to random walk mode.')
        this.mode = 'random'
      }
    } else {
      console.warn('[Simulator] Could not fetch geometry, using defaults')
      this.geometry = {
        venue: { width: 20, depth: 15 },
        objects: [],
        rois: []
      }
      this.mode = 'random'
    }
    
    // Create initial random walkers
    if (this.mode === 'random' || this.mode === 'mixed') {
      for (let i = 0; i < NUM_RANDOM_WALKERS; i++) {
        this.spawnRandomWalker()
      }
    }
    
    // If queue mode, spawn initial queue agents
    if (this.mode === 'queue' || this.mode === 'mixed') {
      // Spawn a few initial customers
      for (let i = 0; i < Math.min(3, cashierZones.length); i++) {
        this.spawnQueueAgent()
      }
    }
  }

  spawnRandomWalker() {
    const agent = new RandomWalkAgent(
      this.nextAgentId++,
      DEVICE_ID,
      this.geometry.venue.width,
      this.geometry.venue.depth
    )
    this.agents.push(agent)
    console.log(`[Simulator] Spawned random walker ${agent.id}`)
  }

  spawnQueueAgent() {
    if (cashierZones.length === 0) return
    
    // Pick a random cashier
    const zoneIndex = Math.floor(Math.random() * cashierZones.length)
    const zone = cashierZones[zoneIndex]
    
    const agent = new QueueAgent(
      this.nextAgentId++,
      DEVICE_ID,
      zone.queueZone,
      zone.serviceZone,
      zone.cashierPosition
    )
    this.agents.push(agent)
    console.log(`[Simulator] Spawned queue agent ${agent.id} at ${zone.name}`)
  }

  connect() {
    console.log(`[Simulator] Connecting to MQTT broker: ${MQTT_BROKER}`)

    this.client = mqtt.connect(MQTT_BROKER, {
      clientId: `simulator-enhanced-${DEVICE_ID}-${Date.now()}`,
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
    console.log(`[Simulator] Active agents: ${this.agents.length}`)

    setInterval(() => {
      if (!this.isRunning) return

      const now = Date.now()
      const deltaTime = (now - this.lastUpdateTime) / 1000
      this.lastUpdateTime = now

      // Spawn new queue agents periodically
      if ((this.mode === 'queue' || this.mode === 'mixed') && 
          now - this.lastQueueSpawnTime > QUEUE_SPAWN_INTERVAL) {
        this.spawnQueueAgent()
        this.lastQueueSpawnTime = now
      }

      // Update all agents and remove completed ones
      this.agents = this.agents.filter(agent => agent.update(deltaTime))

      // Build message with all tracks
      if (this.agents.length > 0) {
        const message = {
          venueId: VENUE_ID,
          deviceId: DEVICE_ID,
          timestamp: now,
          tracks: this.agents.map(a => a.toTrackData())
        }

        this.client.publish(TOPIC, JSON.stringify(message), { qos: 0 })
      }

      // Log status occasionally
      if (Math.random() < 0.005) {
        const queueAgents = this.agents.filter(a => a.trackKey.includes('queue')).length
        const walkAgents = this.agents.filter(a => a.trackKey.includes('person')).length
        console.log(`[Simulator] Agents: ${this.agents.length} (${queueAgents} queue, ${walkAgents} random)`)
      }

    }, UPDATE_INTERVAL_MS)
  }

  // Reload geometry from backend
  async reloadGeometry() {
    console.log('[Simulator] Reloading geometry...')
    this.geometry = await fetchVenueGeometry()
    if (this.geometry) {
      venueGeometry = this.geometry
      cashierZones = parseCashierZones(this.geometry)
      console.log(`[Simulator] Reloaded: ${cashierZones.length} cashier zones`)
    }
  }
}

// Start the simulator
async function main() {
  const simulator = new EnhancedLidarSimulator()
  await simulator.initialize()
  simulator.connect()

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Simulator] Shutting down...')
    if (simulator.client) {
      simulator.client.end()
    }
    process.exit(0)
  })

  // CLI commands
  process.stdin.on('data', async (data) => {
    const cmd = data.toString().trim()
    
    if (cmd === 'q' || cmd === 'queue') {
      simulator.spawnQueueAgent()
    } else if (cmd === 'r' || cmd === 'random') {
      simulator.spawnRandomWalker()
    } else if (cmd === 'reload') {
      await simulator.reloadGeometry()
    } else if (cmd === 'status') {
      console.log(`[Simulator] Mode: ${simulator.mode}`)
      console.log(`[Simulator] Agents: ${simulator.agents.length}`)
      console.log(`[Simulator] Cashier zones: ${cashierZones.length}`)
    } else if (cmd === 'help') {
      console.log('Commands:')
      console.log('  q/queue  - Spawn queue customer')
      console.log('  r/random - Spawn random walker')
      console.log('  reload   - Reload geometry from backend')
      console.log('  status   - Show current status')
    }
  })

  console.log('[Simulator] Commands: q (queue), r (random), reload, status, help')
}

main().catch(console.error)
