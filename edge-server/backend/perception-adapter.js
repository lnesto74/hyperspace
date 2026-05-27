import mqtt from 'mqtt';

const DEFAULT_COLOR = '#22c55e';
const COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// Deterministic color per person ID so each track has a stable color
const colorForId = (id) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
};

export class PerceptionAdapter {
  constructor() {
    this.client = null;
    this.running = false;
    this.stats = {
      framesReceived: 0,
      tracksForwarded: 0,
      lastFrameTime: null,
      lastPeopleCount: 0,
      fps: 0,
      errors: 0,
      lastError: null,
      startTime: null,
    };
    this._fpsWindow = [];
  }

  start(brokerUrl, inputTopic, outputTopicPattern, deviceId, venueId) {
    if (this.running) return { success: false, error: 'Adapter already running' };

    this.inputTopic = inputTopic;
    this.outputTopicPattern = outputTopicPattern;
    this.deviceId = deviceId;
    this.venueId = venueId;
    this._resetStats();

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(brokerUrl, {
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        clientId: `perception-adapter-${Date.now()}`,
      });

      this.client.on('connect', () => {
        console.log(`[PerceptionAdapter] Connected to ${brokerUrl}`);
        this.client.subscribe(this.inputTopic, { qos: 0 }, (err) => {
          if (err) {
            console.error(`[PerceptionAdapter] Subscribe error:`, err.message);
            this.stats.lastError = err.message;
            reject(err);
            return;
          }
          console.log(`[PerceptionAdapter] Subscribed to ${this.inputTopic}`);
          this.running = true;
          this.stats.startTime = Date.now();
          resolve({ success: true });
        });
      });

      this.client.on('message', (topic, payload) => {
        this._handleMessage(topic, payload);
      });

      this.client.on('error', (err) => {
        console.error(`[PerceptionAdapter] MQTT error:`, err.message);
        this.stats.lastError = err.message;
        this.stats.errors++;
      });

      this.client.on('close', () => {
        if (this.running) {
          console.warn('[PerceptionAdapter] Connection closed, will reconnect');
        }
      });
    });
  }

  stop() {
    this.running = false;
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    console.log('[PerceptionAdapter] Stopped');
    return { success: true };
  }

  getStats() {
    return {
      ...this.stats,
      uptime: this.stats.startTime ? Math.floor((Date.now() - this.stats.startTime) / 1000) : 0,
      mqttConnected: this.running && this.client?.connected,
    };
  }

  _resetStats() {
    this.stats = {
      framesReceived: 0,
      tracksForwarded: 0,
      lastFrameTime: null,
      lastPeopleCount: 0,
      fps: 0,
      errors: 0,
      lastError: null,
      startTime: null,
    };
    this._fpsWindow = [];
  }

  _handleMessage(_topic, payload) {
    try {
      const frame = JSON.parse(payload.toString());
      if (!frame.objects || !Array.isArray(frame.objects)) return;

      this.stats.framesReceived++;
      this.stats.lastFrameTime = Date.now();
      this.stats.lastPeopleCount = frame.objects.length;

      // FPS calculation (sliding window of last 2 seconds)
      const now = Date.now();
      this._fpsWindow.push(now);
      const cutoff = now - 2000;
      this._fpsWindow = this._fpsWindow.filter(t => t > cutoff);
      this.stats.fps = Math.round((this._fpsWindow.length / 2) * 10) / 10;

      // Always use configured Hyperspace IDs — perception frames have arbitrary defaults
      const deviceId = this.deviceId;
      const venueId = this.venueId;
      const timestamp = frame.timestamp || Date.now();
      const outTopic = this.outputTopicPattern.replace('{deviceId}', deviceId);

      for (const obj of frame.objects) {
        const message = {
          id: obj.id,
          deviceId,
          venueId,
          timestamp,
          position: obj.position,
          velocity: obj.velocity || { x: 0, y: 0, z: 0 },
          objectType: obj.objectType || 'person',
          color: colorForId(obj.id || 'unknown'),
          boundingBox: obj.boundingBox || { width: 0.5, height: 1.7, depth: 0.5 },
        };
        if (process.env.PIPELINE_DIAG === '1') {
          message.publishedAt = Date.now();
        }

        this.client.publish(outTopic, JSON.stringify(message), { qos: 0 });
        this.stats.tracksForwarded++;
      }
    } catch (err) {
      this.stats.errors++;
      this.stats.lastError = err.message;
      if (this.stats.errors <= 5) {
        console.error('[PerceptionAdapter] Frame parse error:', err.message);
      }
    }
  }
}

export default PerceptionAdapter;
