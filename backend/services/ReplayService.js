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
    /** Resolves when the active playback loop exits (used to serialize stop → start). */
    this._playbackDone = null;
    // In-memory cache of parsed point sets — keyed by absolute file path.
    // Eliminates the multi-second re-parse on every preview render.
    this._pointCache = new Map();
  }

  /**
   * Lazily parse a JSONL into typed arrays of raw perception coordinates and
   * cache them. Subsequent calls return the cached arrays as long as the
   * file's mtime hasn't changed.
   */
  async _loadPoints(fullPath) {
    const stat = fs.statSync(fullPath);
    const cached = this._pointCache.get(fullPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached;

    const t0 = Date.now();
    const rl = readline.createInterface({ input: fs.createReadStream(fullPath), crlfDelay: Infinity });
    const xs = [], ys = [], zs = [];
    for await (const line of rl) {
      const idx = line.indexOf(' ');
      if (idx < 0) continue;
      let msg;
      try { msg = JSON.parse(line.slice(idx + 1)); } catch { continue; }
      const p = msg.position;
      if (!p) continue;
      xs.push(Number(p.x) || 0);
      ys.push(Number(p.y) || 0);
      zs.push(Number(p.z) || 0);
    }
    const entry = {
      x: new Float32Array(xs),
      y: new Float32Array(ys),
      z: new Float32Array(zs),
      n: xs.length,
      mtimeMs: stat.mtimeMs,
    };
    this._pointCache.set(fullPath, entry);
    console.log(`[Replay] Cached ${entry.n.toLocaleString()} points from ${path.basename(fullPath)} in ${Date.now() - t0}ms`);
    return entry;
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
          let mtimeMs = 0;
          try {
            const st = fs.statSync(fp);
            size = st.size;
            mtimeMs = st.mtimeMs;
          } catch { /* ignore */ }
          return { name, size, path: fp, mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name));
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
    if (this._playbackDone) {
      await this._playbackDone;
      this._playbackDone = null;
    }
  }

  /**
   * Start replaying. Returns a Promise that resolves when the playback ends
   * (EOF or explicit stop). Caller usually doesn't await — the HTTP endpoint
   * returns immediately and polls `status()` afterwards.
   */
  async start({ file, speed = 1, rewriteTimestamps = true, devicePrefix = 'replay-' } = {}) {
    if (this.state.running || this._playbackDone) {
      await this.stop();
    }
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

    console.log(`[Replay] Starting ${path.basename(fullPath)} (${this.state.totalBytes} bytes) at ${this.state.speed}×`);

    let resolvePlayback;
    this._playbackDone = new Promise((resolve) => { resolvePlayback = resolve; });

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
      resolvePlayback?.();
      if (this._playbackDone) this._playbackDone = null;
    }

    console.log(`[Replay] Finished ${path.basename(fullPath)} — ${this.state.messagesPublished} msgs`);
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
  async renderPreviewImage({ file, transform, venueWidth = 80, venueDepth = 80, pixelsPerMeter = 10, maxSamples = 200000 } = {}) {
    if (!file) throw new Error('file is required');
    const fullPath = path.isAbsolute(file) ? file : path.join(this.replayDir, file);
    if (!fs.existsSync(fullPath)) throw new Error(`File not found: ${fullPath}`);

    const t = normalizePerceptionTransform(transform || {});
    const W = Math.max(64, Math.min(4096, Math.round(venueWidth * pixelsPerMeter)));
    const H = Math.max(64, Math.min(4096, Math.round(venueDepth * pixelsPerMeter)));
    const counts = new Uint32Array(W * H);
    let maxCount = 0;

    const tStart = Date.now();
    const cache = await this._loadPoints(fullPath);
    const tParse = Date.now() - tStart;

    // Stride to limit point count for sub-second renders even on huge captures
    const stride = Math.max(1, Math.floor(cache.n / maxSamples));

    // Inline transform math for speed (avoid function call overhead per point)
    const rad = (t.rotation_deg * Math.PI) / 180;
    const cosR = Math.cos(rad), sinR = Math.sin(rad);
    const signX = t.axis_sign.x;
    const signZ = t.axis_sign.z;
    const scale = t.scale;
    const ox = t.origin_m.x;
    const oz = t.origin_m.z;
    const swapX = t.axis_map.px === 'z';
    const swapZ = t.axis_map.py === 'x';
    const ySign = t.input_frame === 'ros_rep103' ? -1 : 1;

    const xArr = cache.x, yArr = cache.y, zArr = cache.z;
    const tProj0 = Date.now();
    let processed = 0;
    for (let i = 0; i < cache.n; i += stride) {
      const px = xArr[i];
      const pyPerc = yArr[i]; // perception Y (floor)
      // Note: perception Z (height) is discarded for the heatmap

      // Y/Z swap with optional sign flip for ros_rep103
      const fx = px;
      const fz = ySign * pyPerc;

      // axis_map remap (rare, but supported)
      const ax = swapX ? fz : fx;
      const az = swapZ ? fx : fz;

      const sx = ax * scale;
      const sz = az * scale;
      // rotation + mirror in venue frame (matches applyTransformToPoint)
      let rx = sx * cosR - sz * sinR;
      let rzv = sx * sinR + sz * cosR;
      rx *= signX;
      rzv *= signZ;
      const vx = rx + ox;
      const vz = rzv + oz;

      const xPix = (vx * pixelsPerMeter) | 0;
      const zPix = (vz * pixelsPerMeter) | 0;
      if (xPix < 0 || xPix >= W || zPix < 0 || zPix >= H) continue;
      const cell = zPix * W + xPix;
      counts[cell]++;
      if (counts[cell] > maxCount) maxCount = counts[cell];
      processed++;
    }
    const tProj = Date.now() - tProj0;
    if (maxCount === 0) maxCount = 1;
    const logMax = Math.log10(maxCount + 1);

    const rgba = Buffer.alloc(W * H * 4, 0);
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i];
      if (c === 0) continue;
      const intensity = Math.log10(c + 1) / logMax;
      const r = Math.min(255, Math.round(80 + intensity * 175));
      const g = Math.min(255, Math.round(200 * (1 - intensity * 0.6)));
      const b = Math.min(255, Math.round(40 * (1 - intensity)));
      const a = Math.min(255, Math.round(60 + intensity * 195));
      const p = i * 4;
      rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; rgba[p + 3] = a;
    }

    const tEnc0 = Date.now();
    const png = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
      .flip()
      .png({ compressionLevel: 3 }) // lower compression = faster encode
      .toBuffer();
    const tEnc = Date.now() - tEnc0;

    return {
      png,
      stats: {
        file: path.basename(fullPath),
        processed,
        sampled_from: cache.n,
        stride,
        maxCount,
        venueWidth, venueDepth, pixelsPerMeter,
        widthPx: W, heightPx: H,
        ms: { parse: tParse, project: tProj, encode: tEnc, total: Date.now() - tStart },
      },
    };
  }
}
