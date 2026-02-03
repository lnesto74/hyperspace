import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

const EMIT_INTERVAL_MS = 100; // 10 Hz for smoother movement
const MIN_TRACKS = 3;
const MAX_TRACKS = 8;
const TRACK_LIFETIME_MS = 15000;
const TRACK_SPAWN_CHANCE = 0.03;

// Color palette for different tracks
const TRACK_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
  '#a855f7', '#10b981', '#6366f1', '#eab308', '#f43f5e'
];

export class MockLidarGenerator extends EventEmitter {
  constructor() {
    super();
    this.tracks = new Map();
    this.emitInterval = null;
    this.venueWidth = 20;
    this.venueDepth = 15;
    this.running = false;
    this.colorIndex = 0;
  }

  start(venueId, width = 20, depth = 15) {
    if (this.running) return;
    
    this.venueId = venueId;
    this.venueWidth = width;
    this.venueDepth = depth;
    this.running = true;

    // Spawn initial tracks
    for (let i = 0; i < MIN_TRACKS; i++) {
      this.spawnTrack();
    }

    this.emitInterval = setInterval(() => {
      this.updateTracks();
    }, EMIT_INTERVAL_MS);

    console.log(`🎭 Mock LiDAR generator started (${MIN_TRACKS}-${MAX_TRACKS} tracks)`);
  }

  stop() {
    if (this.emitInterval) {
      clearInterval(this.emitInterval);
      this.emitInterval = null;
    }
    this.tracks.clear();
    this.running = false;
    console.log('🎭 Mock LiDAR generator stopped');
  }

  isRunning() {
    return this.running;
  }

  spawnTrack() {
    const id = `mock-${uuidv4().substring(0, 8)}`;
    const objectType = Math.random() > 0.7 ? 'cart' : 'person';
    
    // Random spawn point along edges
    const edge = Math.floor(Math.random() * 4);
    let x, z;
    
    switch (edge) {
      case 0: // Top
        x = Math.random() * this.venueWidth;
        z = 0;
        break;
      case 1: // Right
        x = this.venueWidth;
        z = Math.random() * this.venueDepth;
        break;
      case 2: // Bottom
        x = Math.random() * this.venueWidth;
        z = this.venueDepth;
        break;
      case 3: // Left
        x = 0;
        z = Math.random() * this.venueDepth;
        break;
    }

    // Random target inside venue
    const targetX = 2 + Math.random() * (this.venueWidth - 4);
    const targetZ = 2 + Math.random() * (this.venueDepth - 4);

    // Assign unique color
    const color = TRACK_COLORS[this.colorIndex % TRACK_COLORS.length];
    this.colorIndex++;

    // Random bounding box for person
    const boundingBox = {
      width: 0.4 + Math.random() * 0.2,   // 40-60cm diameter
      height: 1.5 + Math.random() * 0.4,  // 1.5-1.9m tall
      depth: 0.4 + Math.random() * 0.2    // 40-60cm diameter
    };

    const track = {
      id,
      trackKey: `mock-${id}`,
      deviceId: 'mock-lidar-001',
      objectType,
      position: { x, y: 0, z },
      velocity: { x: 0, y: 0, z: 0 },
      target: { x: targetX, z: targetZ },
      speed: objectType === 'cart' ? 0.5 + Math.random() * 0.5 : 0.8 + Math.random() * 0.7,
      spawnTime: Date.now(),
      state: 'moving', // moving, browsing, leaving
      browseTime: 0,
      maxBrowseTime: 2000 + Math.random() * 5000,
      color,
      boundingBox,
    };

    this.tracks.set(id, track);
  }

  updateTracks() {
    const now = Date.now();

    // Maybe spawn new track
    if (this.tracks.size < MAX_TRACKS && Math.random() < TRACK_SPAWN_CHANCE) {
      this.spawnTrack();
    }

    // Update each track
    for (const [id, track] of this.tracks) {
      // Check if track should despawn
      if (now - track.spawnTime > TRACK_LIFETIME_MS) {
        this.tracks.delete(id);
        continue;
      }

      const dt = EMIT_INTERVAL_MS / 1000;

      if (track.state === 'moving') {
        // Move towards target
        const dx = track.target.x - track.position.x;
        const dz = track.target.z - track.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.5) {
          // Reached target, start browsing
          track.state = 'browsing';
          track.browseTime = 0;
          track.velocity = { x: 0, y: 0, z: 0 };
        } else {
          // Continue moving
          const vx = (dx / dist) * track.speed;
          const vz = (dz / dist) * track.speed;
          
          track.velocity = { x: vx, y: 0, z: vz };
          track.position.x += vx * dt;
          track.position.z += vz * dt;
        }
      } else if (track.state === 'browsing') {
        track.browseTime += EMIT_INTERVAL_MS;
        
        // Small random movement while browsing
        track.position.x += (Math.random() - 0.5) * 0.05;
        track.position.z += (Math.random() - 0.5) * 0.05;
        track.velocity = { x: 0, y: 0, z: 0 };

        if (track.browseTime > track.maxBrowseTime) {
          // Pick new target or leave
          if (Math.random() > 0.3) {
            track.target = {
              x: 2 + Math.random() * (this.venueWidth - 4),
              z: 2 + Math.random() * (this.venueDepth - 4),
            };
            track.state = 'moving';
          } else {
            track.state = 'leaving';
            // Pick exit point
            const edge = Math.floor(Math.random() * 4);
            switch (edge) {
              case 0: track.target = { x: track.position.x, z: -2 }; break;
              case 1: track.target = { x: this.venueWidth + 2, z: track.position.z }; break;
              case 2: track.target = { x: track.position.x, z: this.venueDepth + 2 }; break;
              case 3: track.target = { x: -2, z: track.position.z }; break;
            }
          }
        }
      } else if (track.state === 'leaving') {
        const dx = track.target.x - track.position.x;
        const dz = track.target.z - track.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.5) {
          // Left the venue
          this.tracks.delete(id);
          continue;
        }

        const vx = (dx / dist) * track.speed * 1.2;
        const vz = (dz / dist) * track.speed * 1.2;
        
        track.velocity = { x: vx, y: 0, z: vz };
        track.position.x += vx * dt;
        track.position.z += vz * dt;
      }

      // Emit track event with all fields for cylinder rendering
      this.emit('track', {
        id: track.id,
        trackKey: track.trackKey,
        deviceId: track.deviceId,
        timestamp: now,
        position: { ...track.position },
        venuePosition: { ...track.position },
        velocity: { ...track.velocity },
        objectType: track.objectType,
        color: track.color,
        boundingBox: track.boundingBox,
      });
    }

    // Ensure minimum tracks
    while (this.tracks.size < MIN_TRACKS) {
      this.spawnTrack();
    }
  }
}
