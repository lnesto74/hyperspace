import mqtt from 'mqtt'
import { v4 as uuidv4 } from 'uuid'

// Color palette for different tracks
const TRACK_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#a855f7', '#10b981', '#6366f1', '#eab308', '#f43f5e'
]

class MqttTrajectoryService {
  constructor(io) {
    this.io = io
    this.client = null
    this.isConnected = false
    this.tracks = new Map() // trackKey -> track data
    this.trackColors = new Map() // trackKey -> color
    this.colorIndex = 0
    this.brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883'
    this.topic = process.env.MQTT_TRAJECTORY_TOPIC || 'hyperspace/trajectories/#'
    this.cleanupInterval = null
    this.CLEANUP_INTERVAL_MS = 10000 // Clean stale tracks every 10 seconds
    this.TRACK_TTL_MS = 30000 // Tracks older than 30 seconds are stale
  }

  getColorForTrack(trackKey) {
    if (!this.trackColors.has(trackKey)) {
      this.trackColors.set(trackKey, TRACK_COLORS[this.colorIndex % TRACK_COLORS.length])
      this.colorIndex++
    }
    return this.trackColors.get(trackKey)
  }

  connect() {
    console.log(`[MQTT] Connecting to broker: ${this.brokerUrl}`)
    
    this.client = mqtt.connect(this.brokerUrl, {
      clientId: `hyperspace-server-${uuidv4().slice(0, 8)}`,
      clean: true,
      reconnectPeriod: 5000,
    })

    this.client.on('connect', () => {
      console.log('[MQTT] Connected to broker')
      this.isConnected = true
      
      // Subscribe to trajectory topics
      this.client.subscribe(this.topic, (err) => {
        if (err) {
          console.error('[MQTT] Subscribe error:', err)
        } else {
          console.log(`[MQTT] Subscribed to: ${this.topic}`)
        }
      })
      
      // Start cleanup interval to prevent memory leaks
      if (!this.cleanupInterval) {
        this.cleanupInterval = setInterval(() => {
          this.cleanupStaleTracks(this.TRACK_TTL_MS)
        }, this.CLEANUP_INTERVAL_MS)
        console.log('[MQTT] Started track cleanup interval')
      }
    })

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message)
    })

    this.client.on('error', (err) => {
      console.error('[MQTT] Error:', err)
    })

    this.client.on('close', () => {
      console.log('[MQTT] Connection closed')
      this.isConnected = false
    })

    this.client.on('reconnect', () => {
      console.log('[MQTT] Reconnecting...')
    })
  }

  handleMessage(topic, message) {
    try {
      const data = JSON.parse(message.toString())
      console.log(`[MQTT] Received trajectory on ${topic}:`, JSON.stringify(data).slice(0, 200))
      
      // Expected format: hyperspace/trajectories/{deviceId}
      const topicParts = topic.split('/')
      const deviceId = topicParts[topicParts.length - 1]

      // Handle single track format from edge server
      // Message: { id, deviceId, venueId, position, velocity, objectType, color, boundingBox }
      if (data.position && !data.tracks) {
        const trackKey = `${data.deviceId || deviceId}-${data.id}`
        const color = data.color || this.getColorForTrack(trackKey)
        const venueId = data.venueId || 'default'
        
        const processedTrack = {
          id: data.id || uuidv4(),
          trackKey,
          deviceId: data.deviceId || deviceId,
          timestamp: data.timestamp || Date.now(),
          position: data.position,
          venuePosition: data.position,
          velocity: data.velocity || { x: 0, y: 0, z: 0 },
          objectType: data.objectType || 'person',
          boundingBox: data.boundingBox || { width: 0.5, height: 1.7, depth: 0.5 },
          color
        }

        this.tracks.set(trackKey, processedTrack)

        // Emit to TrackAggregator pattern
        if (this.trackAggregator) {
          this.trackAggregator.addTrack(processedTrack)
        } else {
          // Direct emit to clients
          this.io.of('/tracking').to(`venue:${venueId}`).emit('tracks', {
            venueId,
            tracks: [processedTrack]
          })
        }
        return
      }

      // Handle batch format: { tracks: [...], venueId: string }
      if (!data.tracks || !Array.isArray(data.tracks)) {
        console.warn('[MQTT] Invalid message format:', data)
        return
      }

      const venueId = data.venueId || 'default'
      const processedTracks = []

      for (const track of data.tracks) {
        const trackKey = track.trackKey || `${deviceId}-${track.id}`
        const color = this.getColorForTrack(trackKey)
        
        const processedTrack = {
          id: track.id || uuidv4(),
          trackKey,
          deviceId,
          timestamp: track.timestamp || Date.now(),
          position: track.position || { x: 0, y: 0, z: 0 },
          venuePosition: track.venuePosition || track.position || { x: 0, y: 0, z: 0 },
          velocity: track.velocity || { x: 0, y: 0, z: 0 },
          objectType: track.objectType || 'person',
          boundingBox: track.boundingBox || {
            width: 0.5,  // 50cm diameter
            height: 1.7, // 1.7m tall
            depth: 0.5   // 50cm diameter
          },
          color
        }

        this.tracks.set(trackKey, processedTrack)
        processedTracks.push(processedTrack)
      }

      // Emit to all connected clients subscribed to this venue
      this.io.of('/tracking').to(`venue:${venueId}`).emit('tracks', {
        venueId,
        tracks: processedTracks
      })

    } catch (err) {
      console.error('[MQTT] Error parsing message:', err)
    }
  }
  
  setTrackAggregator(aggregator) {
    this.trackAggregator = aggregator
  }

  // Clean up stale tracks (older than TTL)
  cleanupStaleTracks(ttlMs = 5000) {
    const now = Date.now()
    for (const [trackKey, track] of this.tracks) {
      if (now - track.timestamp > ttlMs) {
        this.tracks.delete(trackKey)
        this.trackColors.delete(trackKey)
      }
    }
  }

  disconnect() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    if (this.client) {
      this.client.end()
      this.client = null
      this.isConnected = false
    }
    // Clear maps to free memory
    this.tracks.clear()
    this.trackColors.clear()
  }
}

export default MqttTrajectoryService
