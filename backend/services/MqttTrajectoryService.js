import mqtt from 'mqtt'
import { v4 as uuidv4 } from 'uuid'
import {
  IDENTITY_TRANSFORM,
  normalizePerceptionTransform,
  applyTransformToPoint,
  applyTransformToVelocity,
  perceptionToFloor,
} from './PerceptionTransform.js'
import { TrajectoryReconciler, normalizeReconcilerConfig, DEFAULT_CONFIG as RECONCILER_DEFAULT } from './TrajectoryReconciler.js'

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

    // Per-venue perception → venue coordinate transforms.
    // Default = identity (no behavior change for venues without a saved transform).
    this.venueTransforms = new Map() // venueId -> normalized perceptionTransform

    // Per-venue reconciler configs (ghost filter + re-ID).
    this.venueReconcilerConfigs = new Map() // venueId -> reconciler config
    this.reconciler = new TrajectoryReconciler((vid) => this.venueReconcilerConfigs.get(vid) || RECONCILER_DEFAULT)
    // Periodic housekeeping (active → lost → expire)
    this.reconcilerSweepInterval = setInterval(() => {
      const events = this.reconciler.sweep()
      for (const { venueId, trackKey, reason } of events) {
        if (!trackKey) continue
        // Keep newly_lost tracks in the aggregator so they stay visible during re-ID gaps.
        // Only purge from the live snapshot on permanent removal.
        if (reason === 'expired' || reason === 'static_fixture') {
          if (this.trackAggregator && this.trackAggregator.tracks) {
            this.trackAggregator.tracks.delete(trackKey)
          }
          this.tracks.delete(trackKey)
        }
        // newly_lost is often temporary (perception gap → re-ID within seconds).
        // Emitting track_removed here causes visible flicker; the next full snapshot
        // (100ms) already drops the track. Only push immediate removal for permanent drops.
        if (reason !== 'newly_lost' && !trackKey.startsWith('replay-')) {
          this.io?.of('/tracking').to(`venue:${venueId}`).emit('track_removed', { trackKey })
        }
      }
    }, 250)

    // Stats tracking for validation
    this.stats = {
      messagesReceived: 0,
      tracksReceived: 0,
      lastMessageTs: null,
      connectedAt: null,
      venueStats: new Map() // venueId -> { tracksReceived, lastTrackTs }
    }

    /** Optional raw MQTT recorder (main-server JSONL capture). */
    this.mqttRecorder = null
  }

  setMqttRecorder(recorder) {
    this.mqttRecorder = recorder
  }

  /** Replace the transform used for a venue. Falsy value clears it. */
  setVenueTransform(venueId, transform) {
    if (!venueId) return
    if (!transform) {
      this.venueTransforms.delete(venueId)
      console.log(`[MQTT] Cleared perception transform for venue ${venueId}`)
      return
    }
    const normalized = normalizePerceptionTransform(transform)
    this.venueTransforms.set(venueId, normalized)
    console.log(`[MQTT] Updated perception transform for venue ${venueId}:`, normalized)
  }

  /** Bulk-load transforms at startup. Accepts an array of { venueId, transform }. */
  loadVenueTransforms(entries) {
    if (!Array.isArray(entries)) return
    for (const { venueId, transform } of entries) {
      if (venueId && transform) {
        this.venueTransforms.set(venueId, normalizePerceptionTransform(transform))
      }
    }
    console.log(`[MQTT] Loaded ${this.venueTransforms.size} venue perception transforms`)
  }

  getVenueTransform(venueId) {
    return this.venueTransforms.get(venueId) || IDENTITY_TRANSFORM
  }

  /** Replace the reconciler config for a venue. Falsy value clears (defaults). */
  setVenueReconcilerConfig(venueId, config) {
    if (!venueId) return
    if (!config) {
      this.venueReconcilerConfigs.delete(venueId)
    } else {
      this.venueReconcilerConfigs.set(venueId, normalizeReconcilerConfig(config))
    }
    this.reconciler.setVenueConfig(venueId, this.venueReconcilerConfigs.get(venueId) || RECONCILER_DEFAULT)
    console.log(`[Reconciler] Updated config for venue ${venueId}:`, this.venueReconcilerConfigs.get(venueId) || 'defaults')
  }

  loadVenueReconcilerConfigs(entries) {
    if (!Array.isArray(entries)) return
    for (const { venueId, config } of entries) {
      if (venueId && config) this.venueReconcilerConfigs.set(venueId, normalizeReconcilerConfig(config))
    }
    console.log(`[Reconciler] Loaded ${this.venueReconcilerConfigs.size} venue reconciler configs`)
  }

  getReconcilerStats(venueId = null) {
    return this.reconciler.getStats(venueId)
  }

  getVenueReconcilerConfig(venueId) {
    return this.venueReconcilerConfigs.get(venueId) || RECONCILER_DEFAULT
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
      this.stats.connectedAt = Date.now()
      
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
      const raw = message.toString()
      if (this.mqttRecorder?.isRecording()) {
        this.mqttRecorder.recordMessage(topic, raw)
      }

      const data = JSON.parse(raw)
      
      // Logging gated by env: DEBUG_MQTT=verbose logs every msg, DEBUG_MQTT=true samples every 10s
      if (process.env.DEBUG_MQTT === 'verbose') {
        console.log(`[MQTT] Received trajectory on ${topic}:`, JSON.stringify(data).slice(0, 200))
      } else if (process.env.DEBUG_MQTT === 'true') {
        this._mqttMsgCount = (this._mqttMsgCount || 0) + 1
        const now = Date.now()
        if (!this._lastMqttLog || now - this._lastMqttLog > 10000) {
          console.log(`[MQTT] ${this._mqttMsgCount} msgs in last ${this._lastMqttLog ? Math.round((now - this._lastMqttLog)/1000) + 's' : 'startup'}, latest on ${topic}`)
          this._mqttMsgCount = 0
          this._lastMqttLog = now
        }
      }
      
      // Expected format: hyperspace/trajectories/{deviceId}
      const topicParts = topic.split('/')
      const deviceId = topicParts[topicParts.length - 1]

      // Handle single track format from edge server
      // Message: { id, deviceId, venueId, position, velocity, objectType, color, boundingBox }
      if (data.position && !data.tracks) {
        const trackKey = `${data.deviceId || deviceId}:${data.id}`
        const color = data.color || this.getColorForTrack(trackKey)
        const venueId = data.venueId || 'default'

        // Perception → Three.js floor coords. The swap depends on the perception frame:
        //   legacy:     floor.z =  perc.y
        //   ros_rep103: floor.z = -perc.y  (ROS uses Y-left, Three.js uses Z-forward)
        // The frame is stored on the per-venue perceptionTransform.
        const transform = this.venueTransforms.get(venueId)
        const inputFrame = transform?.input_frame || 'legacy'
        const percPos = data.position || { x: 0, y: 0, z: 0 }
        const percVel = data.velocity || { x: 0, y: 0, z: 0 }
        const floorPos = perceptionToFloor(inputFrame, percPos)
        const floorVel = perceptionToFloor(inputFrame, percVel)

        // Apply per-venue perception → venue coordinate transform.
        // `position` keeps the raw perception value (used by the Matching UI for live preview),
        // `venuePosition` is what every downstream consumer (Socket.IO, KPIs, DB) renders.
        const venuePosition = transform
          ? applyTransformToPoint(transform, floorPos)
          : floorPos
        const venueVelocity = transform
          ? applyTransformToVelocity(transform, floorVel)
          : floorVel

        const incomingTrack = {
          id: data.id || uuidv4(),
          trackKey,
          deviceId: data.deviceId || deviceId,
          venueId,
          timestamp: data.timestamp || Date.now(),
          position: floorPos,
          venuePosition,
          velocity: venueVelocity,
          rawVelocity: floorVel,
          objectType: data.objectType || 'person',
          boundingBox: data.boundingBox || { width: 0.5, height: 1.7, depth: 0.5 },
          color
        }

        // Run through reconciler: ghost filter + re-ID + smoothing. Null = ghost / probation.
        const reconciled = this.reconciler.process(incomingTrack)
        if (!reconciled) {
          // Still update raw stats so users can see ingestion volume vs filtered ratio
          this.stats.messagesReceived++
          this.stats.lastMessageTs = Date.now()
          return
        }

        // Use the stable trackKey for downstream consumers
        const processedTrack = {
          ...reconciled,
          color: reconciled.color || color,
        }

        this.tracks.set(processedTrack.trackKey, processedTrack)

        // Update stats
        this.stats.messagesReceived++
        this.stats.tracksReceived++
        this.stats.lastMessageTs = Date.now()
        this._updateVenueStats(venueId, 1)

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
      const transform = this.venueTransforms.get(venueId)
      const processedTracks = []

      for (const track of data.tracks) {
        const trackKey = track.trackKey || `${deviceId}:${track.id}`
        const color = this.getColorForTrack(trackKey)

        // Perception → Three.js floor coords; frame-aware swap (see single-track path).
        const inputFrame = transform?.input_frame || 'legacy'
        const rp = track.position || { x: 0, y: 0, z: 0 }
        const rv = track.velocity || { x: 0, y: 0, z: 0 }
        const rawPosition = perceptionToFloor(inputFrame, rp)
        const rawVelocity = perceptionToFloor(inputFrame, rv)
        // Honor venuePosition if the publisher already supplied it; otherwise transform raw.
        const venuePosition = track.venuePosition
          || (transform ? applyTransformToPoint(transform, rawPosition) : rawPosition)
        const venueVelocity = track.venuePosition
          ? rawVelocity
          : (transform ? applyTransformToVelocity(transform, rawVelocity) : rawVelocity)

        const incomingTrack = {
          id: track.id || uuidv4(),
          trackKey,
          deviceId,
          venueId,
          timestamp: track.timestamp || Date.now(),
          position: rawPosition,
          venuePosition,
          velocity: venueVelocity,
          rawVelocity,
          objectType: track.objectType || 'person',
          boundingBox: track.boundingBox || {
            width: 0.5,  // 50cm diameter
            height: 1.7, // 1.7m tall
            depth: 0.5   // 50cm diameter
          },
          color
        }
        const reconciled = this.reconciler.process(incomingTrack)
        if (!reconciled) continue
        const processedTrack = { ...reconciled, color: reconciled.color || color }
        this.tracks.set(processedTrack.trackKey, processedTrack)
        processedTracks.push(processedTrack)
      }

      // Update stats
      this.stats.messagesReceived++
      this.stats.tracksReceived += processedTracks.length
      this.stats.lastMessageTs = Date.now()
      this._updateVenueStats(venueId, processedTracks.length)

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
  
  // Update per-venue stats
  _updateVenueStats(venueId, trackCount) {
    if (!this.stats.venueStats.has(venueId)) {
      this.stats.venueStats.set(venueId, { tracksReceived: 0, lastTrackTs: null, tracksLast10s: 0, windowStart: Date.now() })
    }
    const vs = this.stats.venueStats.get(venueId)
    vs.tracksReceived += trackCount
    vs.lastTrackTs = Date.now()
    
    // Track 10-second window
    const now = Date.now()
    if (now - vs.windowStart > 10000) {
      vs.tracksLast10s = trackCount
      vs.windowStart = now
    } else {
      vs.tracksLast10s += trackCount
    }
  }
  
  // Get status for validation endpoint
  getStatus(venueId = null) {
    const baseStatus = {
      connected: this.isConnected,
      brokerUrl: this.brokerUrl,
      topic: this.topic,
      connectedAt: this.stats.connectedAt,
      messagesReceived: this.stats.messagesReceived,
      tracksReceived: this.stats.tracksReceived,
      lastMessageTs: this.stats.lastMessageTs,
      activeTracksCount: this.tracks.size,
    }
    
    if (venueId) {
      const vs = this.stats.venueStats.get(venueId)
      if (vs) {
        return {
          ...baseStatus,
          venueId,
          venueTracksReceived: vs.tracksReceived,
          venueLastTrackTs: vs.lastTrackTs,
          venueTracksLast10s: vs.tracksLast10s,
        }
      } else {
        return {
          ...baseStatus,
          venueId,
          venueTracksReceived: 0,
          venueLastTrackTs: null,
          venueTracksLast10s: 0,
        }
      }
    }
    
    return baseStatus
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
    if (this.reconcilerSweepInterval) {
      clearInterval(this.reconcilerSweepInterval)
      this.reconcilerSweepInterval = null
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
