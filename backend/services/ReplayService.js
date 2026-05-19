/**
 * ReplayService
 * -------------
 * Streams a recorded MQTT capture (JSONL: "topic {json}\n" per line) back into
 * the live perception pipeline at a configurable speed. Each replayed message
 * has its deviceId prefixed with `replay-` so its trackKey can never collide
 * with a live perception track — the frontend can therefore keep showing live
 * tracks while replay is running.
 *
 * Two delivery modes:
 *   - direct injection (preferred): hand the parsed message straight to
 *     MqttTrajectoryService.handleMessage(). Bypasses the MQTT loopback +
 *     TCP framing entirely — keeps up at 10x speed without lag.
 *   - mqtt fallback: publish through the local broker. Useful when the service
 *     is not in-process (e.g. running the replay from a different host).
 */

import fs from 'fs';
import readline from 'readline';
import path from 'path';
import mqtt from 'mqtt';
import sharp from 'sharp';
import { perceptionToFloor, applyTransformToPoint, normalizePerceptionTransform } from './PerceptionTransform.js';

export default class ReplayService {
  constructor({ replayDir, mqttBrokerUrl, mqttService } = {}) {
    this.replayDir = replayDir || process.env.REPLAY_DIR || '/data/replay';
    this.brokerUrl = mqttBrokerUrl || process.env.MQTT_BROKER_URL || 'mqtt://mosquitto:1883';
    // When set, replay injects messages directly (no MQTT round-trip)
    this.mqttService = mqttService || null;
    this.client = null;
    this.state = {
      running: false,
      file: null,
      startedAt: null,
      speed: 1,
      rewriteTimestamps: true,
      messagesPublished: 0,
      progress: 0,
      currentTs: 0,
      lastError: null,
      delivery: this.mqttService ? 'direct' : 'mqtt',
    };
    this._abort = null;
  }

  ensureDir() {
    try { fs.mkdirSync(this.replayDir, { recursive: true }); } catch { /* ignore */ }
  }

  listFiles() {
    this.ensureDir();
    try {
      return fs.readdirSync(this.replayDir)
        .filter(f => f.toLowerCase().endsWith('.jsonl') || f.toLowerCase().endsWith('.jsonl.gz'))
        .map(name => {
          const fp = path.join(this.replayDir, name);
          let size = 0;
          try { size = fs.statSync(fp).size; } catch { /* ignore */ }
          return { name, size, path: fp };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      return [];
    }
  }

  status() {
    return { ...this.state };
  }

  async _ensureClient() {
    if (this.client && this.client.connected) return;
    this.client = mqtt.connect(this.brokerUrl, { reconnectPeriod: 5000 });
    await new Promise((resolve, reject) => {
      const ok = () => { this.client.off('error', err); resolve(); };
      const err = (e) => { this.client.off('connect', ok); reject(e); };
      this.client.once('connect', ok);
      this.client.once('error', err);
    });
  }

  async stop() {
    if (this._abort) this._abort.aborted = true;
    this.state.running = false;
  }

  /**
   * Start replaying. Returns a Promise that resolves when the playback ends
   * (EOF or explicit stop). Caller usually doesn't await — the HTTP endpoint
   * returns immediately and polls `status()` afterwards.
   */
  async start({ file, speed = 1, rewriteTimestamps = true, devicePrefix = 'replay-' } = {}) {
    if (this.state.running) throw new Error('Replay already running. Stop it first.');
    if (!file) throw new Error('file is required');
    const fullPath = path.isAbsolute(file) ? file : path.join(this.replayDir, file);
    if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);

    // Only establish MQTT if we have no direct service handle.
    if (!this.mqttService) await this._ensureClient();

    const abort = { aborted: false };
    this._abort = abort;
    const deliveryMode = this.mqttService ? 'direct' : 'mqtt';
    this.state = {
      running: true,
      file: path.basename(fullPath),
      startedAt: Date.now(),
      speed: Math.max(0.1, Math.min(50, Number(speed) || 1)),
      rewriteTimestamps: !!rewriteTimestamps,
      messagesPublished: 0,
      progress: 0,
      currentTs: 0,
      lastError: null,
      totalBytes: fs.statSync(fullPath).size,
      bytesRead: 0,
      delivery: deliveryMode,
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const rl = readline.createInterface({ input: fs.createReadStream(fullPath), crlfDelay: Infinity });

    let firstRecordedTs = null;
    let replayStartTs = Date.now();
    // Avoid awaiting setTimeout for every message — coalesce sleeps below this slack.
    const SLEEP_SLACK_MS = 5;
    let pending = 0;

    const inject = (topic, msg) => {
      if (this.mqttService) {
        // Direct call — bypass MQTT broker entirely.
        this.mqttService.handleMessage(topic, Buffer.from(JSON.stringify(msg)));
      } else {
        this.client.publish(topic, JSON.stringify(msg));
      }
    };

    try {
      for await (const line of rl) {
        if (abort.aborted) break;
        this.state.bytesRead += Buffer.byteLength(line) + 1;
        // Update progress at low frequency to avoid burning CPU on division
        pending++;
        if (pending >= 200) {
          this.state.progress = this.state.totalBytes > 0 ? this.state.bytesRead / this.state.totalBytes : 0;
          pending = 0;
        }

        const idx = line.indexOf(' ');
        if (idx < 0) continue;
        let topic = line.slice(0, idx);
        let msg;
        try { msg = JSON.parse(line.slice(idx + 1)); } catch { continue; }
        if (!msg.timestamp) continue;

        if (firstRecordedTs === null) {
          firstRecordedTs = msg.timestamp;
          replayStartTs = Date.now();
        }

        // Pace against wall clock; coalesce sub-slack waits so we don't yield
        // to setTimeout every 25-100ms.
        const recordedDelta = msg.timestamp - firstRecordedTs;
        const targetWallTime = replayStartTs + recordedDelta / this.state.speed;
        const waitMs = targetWallTime - Date.now();
        if (waitMs > SLEEP_SLACK_MS) await sleep(waitMs);
        if (abort.aborted) break;

        if (devicePrefix && typeof msg.deviceId === 'string' && !msg.deviceId.startsWith(devicePrefix)) {
          msg.deviceId = devicePrefix + msg.deviceId;
        }
        const parts = topic.split('/');
        parts[parts.length - 1] = msg.deviceId;
        topic = parts.join('/');

        msg.replay = true;
        if (this.state.rewriteTimestamps) msg.timestamp = Date.now();
        this.state.currentTs = msg.timestamp;

        inject(topic, msg);
        this.state.messagesPublished++;
      }
    } catch (err) {
      this.state.lastError = err.message;
      console.error('[Replay] Error:', err);
    } finally {
      this.state.running = false;
      this._abort = null;
      try { rl.close(); } catch {}
    }
  }

  /**
   * Render a static heatmap PNG of every detection in a JSONL capture,
   * projected through the supplied perceptionTransform (or identity).
   *
   * The PNG covers the venue floor exactly: width × height pixels mapped to
   * a venue (venueWidth × venueDepth) m bounding box anchored at (0,0).
   * The frontend overlays this image at the matching world coords so the
   * user can visually align it with the building outline.
   *
   * Cell intensity is log10(count + 1) → mapped to a warm gradient with
   * alpha so the building underneath stays visible.
   */
  async renderPreviewImage({ file, transform, venueWidth = 80, venueDepth = 80, pixelsPerMeter = 12 } = {}) {
    if (!file) throw new Error('file is required');
    const fullPath = path.isAbsolute(file) ? file : path.join(this.replayDir, file);
    if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);

    const t = normalizePerceptionTransform(transform || {});
    const W = Math.max(64, Math.min(4096, Math.round(venueWidth * pixelsPerMeter)));
    const H = Math.max(64, Math.min(4096, Math.round(venueDepth * pixelsPerMeter)));
    const counts = new Uint32Array(W * H);
    let maxCount = 0;
    let processed = 0;

    const rl = readline.createInterface({ input: fs.createReadStream(fullPath), crlfDelay: Infinity });
    for await (const line of rl) {
      const idx = line.indexOf(' ');
      if (idx < 0) continue;
      let msg;
      try { msg = JSON.parse(line.slice(idx + 1)); } catch { continue; }
      const pos = msg.position;
      if (!pos) continue;
      const floor = perceptionToFloor(t.input_frame, pos);
      const v = applyTransformToPoint(t, floor);
      const xPix = Math.round(v.x * pixelsPerMeter);
      const zPix = Math.round(v.z * pixelsPerMeter);
      if (xPix < 0 || xPix >= W || zPix < 0 || zPix >= H) continue;
      const cell = zPix * W + xPix;
      counts[cell] += 1;
      if (counts[cell] > maxCount) maxCount = counts[cell];
      processed++;
    }
    if (maxCount === 0) maxCount = 1;
    const logMax = Math.log10(maxCount + 1);

    // 4-channel RGBA buffer
    const rgba = Buffer.alloc(W * H * 4, 0);
    // Warm gradient (yellow→orange→red), alpha=0 in empty cells
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i];
      if (c === 0) continue;
      const intensity = Math.log10(c + 1) / logMax; // 0..1
      const r = Math.min(255, Math.round(80 + intensity * 175));
      const g = Math.min(255, Math.round(200 * (1 - intensity * 0.6)));
      const b = Math.min(255, Math.round(40 * (1 - intensity)));
      const a = Math.min(255, Math.round(60 + intensity * 195));
      const p = i * 4;
      rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = a;
    }

    // sharp wants origin top-left, and y grows down — Three.js Z grows "forward".
    // We flip vertically so that venue (0,0) is bottom-left of the PNG, matching
    // how the frontend overlays it on the floor.
    const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
      .flip()
      .png({ compressionLevel: 6 })
      .toBuffer();

    return {
      png,
      stats: {
        file: path.basename(fullPath),
        processed,
        maxCount,
        venueWidth, venueDepth, pixelsPerMeter,
        widthPx: W, heightPx: H,
      },
    };
  }
}
