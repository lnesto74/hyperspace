import { EventEmitter } from 'events';
import { createConnection } from 'net';

const LIDAR_PORT = parseInt(process.env.LIDAR_PORT) || 17161;
const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;

export class LidarConnectionManager extends EventEmitter {
  constructor() {
    super();
    this.connections = new Map(); // deviceId -> { socket, buffer, reconnectAttempts, reconnectTimeout }
  }

  async connect(deviceId, ipAddress) {
    if (this.connections.has(deviceId)) {
      const existing = this.connections.get(deviceId);
      if (existing.socket && !existing.socket.destroyed) {
        console.log(`⚠️ Already connected to ${deviceId}`);
        return { success: true, message: 'Already connected' };
      }
    }

    return new Promise((resolve) => {
      console.log(`🔌 Connecting to LiDAR ${deviceId} at ${ipAddress}:${LIDAR_PORT}`);

      const socket = createConnection({ host: ipAddress, port: LIDAR_PORT });
      
      const connectionState = {
        socket,
        buffer: '',
        reconnectAttempts: 0,
        reconnectTimeout: null,
        ipAddress,
      };

      socket.setKeepAlive(true, 10000);
      socket.setTimeout(30000);

      socket.on('connect', () => {
        console.log(`✅ Connected to LiDAR ${deviceId}`);
        connectionState.reconnectAttempts = 0;
        
        this.emit('status', {
          deviceId,
          status: 'online',
          message: 'Connected',
        });

        resolve({ success: true, message: 'Connected' });
      });

      socket.on('data', (data) => {
        connectionState.buffer += data.toString();
        this.processBuffer(deviceId, connectionState);
      });

      socket.on('error', (error) => {
        console.error(`❌ LiDAR ${deviceId} connection error:`, error.message);
        
        this.emit('status', {
          deviceId,
          status: 'error',
          message: error.message,
        });

        resolve({ success: false, message: error.message });
      });

      socket.on('close', () => {
        console.log(`🔌 LiDAR ${deviceId} disconnected`);
        
        this.emit('status', {
          deviceId,
          status: 'offline',
          message: 'Disconnected',
        });

        // Attempt reconnection with exponential backoff
        this.scheduleReconnect(deviceId, connectionState);
      });

      socket.on('timeout', () => {
        console.log(`⏰ LiDAR ${deviceId} connection timeout`);
        socket.destroy();
      });

      this.connections.set(deviceId, connectionState);
    });
  }

  processBuffer(deviceId, state) {
    const lines = state.buffer.split('\n');
    state.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const data = JSON.parse(line);
        
        // Normalize track data
        const track = {
          id: data.id || data.trackId || `${deviceId}-${Date.now()}`,
          deviceId,
          timestamp: data.timestamp || Date.now(),
          position: {
            x: data.position?.x ?? data.x ?? 0,
            y: data.position?.y ?? data.y ?? 0,
            z: data.position?.z ?? data.z ?? 0,
          },
          velocity: {
            x: data.velocity?.x ?? data.vx ?? 0,
            y: data.velocity?.y ?? data.vy ?? 0,
            z: data.velocity?.z ?? data.vz ?? 0,
          },
          objectType: data.objectType || data.type || 'unknown',
        };

        this.emit('track', track);
      } catch (error) {
        // Skip malformed JSON
        console.warn(`⚠️ Invalid JSON from ${deviceId}:`, line.substring(0, 50));
      }
    }
  }

  scheduleReconnect(deviceId, state) {
    if (state.reconnectTimeout) {
      clearTimeout(state.reconnectTimeout);
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(RECONNECT_MULTIPLIER, state.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );

    console.log(`🔄 Reconnecting to ${deviceId} in ${delay}ms (attempt ${state.reconnectAttempts + 1})`);

    state.reconnectTimeout = setTimeout(() => {
      state.reconnectAttempts++;
      this.connect(deviceId, state.ipAddress);
    }, delay);
  }

  disconnect(deviceId) {
    const state = this.connections.get(deviceId);
    if (!state) return { success: false, message: 'Not connected' };

    if (state.reconnectTimeout) {
      clearTimeout(state.reconnectTimeout);
    }

    if (state.socket && !state.socket.destroyed) {
      state.socket.destroy();
    }

    this.connections.delete(deviceId);
    
    console.log(`🔌 Disconnected from LiDAR ${deviceId}`);
    
    this.emit('status', {
      deviceId,
      status: 'offline',
      message: 'Manually disconnected',
    });

    return { success: true, message: 'Disconnected' };
  }

  disconnectAll() {
    for (const deviceId of this.connections.keys()) {
      this.disconnect(deviceId);
    }
  }

  getStatus(deviceId) {
    const state = this.connections.get(deviceId);
    if (!state) {
      return { connected: false, status: 'offline' };
    }

    return {
      connected: state.socket && !state.socket.destroyed,
      status: state.socket && !state.socket.destroyed ? 'online' : 'offline',
      reconnectAttempts: state.reconnectAttempts,
    };
  }

  getConnectedDevices() {
    const connected = [];
    for (const [deviceId, state] of this.connections) {
      if (state.socket && !state.socket.destroyed) {
        connected.push(deviceId);
      }
    }
    return connected;
  }
}
