/**
 * Local MQTT capture for edge replay files.
 * Format: one line per message — "topic {json}\n" (ReplayService-compatible).
 */
import fs from 'fs';
import path from 'path';
import mqtt from 'mqtt';

/** Topics for replay-compatible captures (post-adapter trajectories). */
export const REPLAY_TOPICS = ['hyperspace/trajectories/#'];
const DEFAULT_TOPICS = REPLAY_TOPICS;

/** Keep at most this many completed files on the edge (synced files should be deleted). */
const MAX_LOCAL_FILES = Number(process.env.EDGE_RECORD_MAX_FILES) || 3;
/** Soft cap — refuse new recordings when local dir exceeds this. */
const MAX_LOCAL_BYTES = Number(process.env.EDGE_RECORD_MAX_BYTES) || 2 * 1024 * 1024 * 1024;

function sanitizeName(name) {
  return String(name || 'capture')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'capture';
}

function parseDurationMinutes(value) {
  if (value == null || value === '') return null;
  const mins = Number(value);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return Math.min(720, Math.round(mins));
}

export class MqttRecorder {
  constructor({ recordDir, brokerUrl } = {}) {
    this.recordDir = recordDir;
    this.brokerUrl = brokerUrl;
    this.client = null;
    this.writeStream = null;
    this.state = this._emptyState();
    this._autoStopTimer = null;
    fs.mkdirSync(this.recordDir, { recursive: true });
  }

  _emptyState() {
    return {
      recording: false,
      file: null,
      filePath: null,
      bytesWritten: 0,
      messagesRecorded: 0,
      startedAt: null,
      lastMessageAt: null,
      topics: DEFAULT_TOPICS,
      brokerUrl: this.brokerUrl,
      error: null,
      durationMinutes: null,
      stopsAt: null,
      autoStop: false,
    };
  }

  _syncFileSize() {
    if (!this.state.filePath) return;
    try {
      const st = fs.statSync(this.state.filePath);
      this.state.bytesWritten = Math.max(this.state.bytesWritten, st.size);
    } catch { /* file may not exist yet */ }
  }

  _clearAutoStopTimer() {
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }
  }

  _scheduleAutoStop(durationMinutes) {
    this._clearAutoStopTimer();
    if (!durationMinutes) return;
    const durationMs = durationMinutes * 60 * 1000;
    this._autoStopTimer = setTimeout(() => {
      this._autoStopTimer = null;
      if (!this.state.recording) return;
      console.log(`[MqttRecorder] Auto-stop after ${durationMinutes} min`);
      this.stop({ autoStop: true }).catch((err) => {
        console.error('[MqttRecorder] Auto-stop failed:', err.message);
      });
    }, durationMs);
  }

  getLocalUsage() {
    const files = this.listFiles();
    const totalBytes = files.reduce((sum, f) => sum + (f.size || 0), 0);
    return { fileCount: files.length, totalBytes, maxFiles: MAX_LOCAL_FILES, maxBytes: MAX_LOCAL_BYTES };
  }

  getStatus() {
    if (this.state.recording) this._syncFileSize();
    const usage = this.getLocalUsage();
    const remainingMs = this.state.stopsAt
      ? Math.max(0, this.state.stopsAt - Date.now())
      : null;
    return { ...this.state, remainingMs, usage };
  }

  listFiles() {
    try {
      return fs.readdirSync(this.recordDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(name => {
          const fp = path.join(this.recordDir, name);
          let size = 0;
          let mtimeMs = 0;
          try {
            const st = fs.statSync(fp);
            size = st.size;
            mtimeMs = st.mtimeMs;
          } catch { /* ignore */ }
          return { name, size, mtimeMs, path: fp };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
      return [];
    }
  }

  /** Delete oldest files until within retention limits (never deletes active recording). */
  pruneLocal({ keepFile } = {}) {
    const active = this.state.recording ? this.state.file : null;
    const keep = new Set([active, keepFile].filter(Boolean));
    let files = this.listFiles().filter(f => !keep.has(f.name));
    let totalBytes = files.reduce((s, f) => s + f.size, 0) + (active ? this.state.bytesWritten : 0);
    const deleted = [];

    while (files.length > MAX_LOCAL_FILES || totalBytes > MAX_LOCAL_BYTES) {
      const oldest = files.pop();
      if (!oldest) break;
      try {
        fs.unlinkSync(oldest.path);
        deleted.push(oldest.name);
        totalBytes -= oldest.size;
      } catch (err) {
        console.error('[MqttRecorder] prune delete failed:', err.message);
        break;
      }
    }
    return { deleted, usage: this.getLocalUsage() };
  }

  deleteFile(name) {
    const fp = this.resolveFile(name);
    if (this.state.recording && this.state.file === path.basename(name)) {
      throw new Error('Cannot delete the active recording');
    }
    fs.unlinkSync(fp);
    return { deleted: path.basename(name) };
  }

  probe({ topics = DEFAULT_TOPICS, durationMs = 3000, detailed = false } = {}) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      let count = 0;
      let lastAt = null;
      let firstAt = null;
      const gaps = [];
      const bridgeLatencies = [];
      const ingestLatencies = [];
      const client = mqtt.connect(this.brokerUrl, { reconnectPeriod: 0, connectTimeout: 5000 });

      const finish = (result, err) => {
        try { client.end(true); } catch { /* ignore */ }
        if (err) reject(err);
        else resolve(result);
      };

      const summarize = (values) => {
        if (!values.length) return { samples: 0, p50: null, p95: null, max: null };
        const sorted = [...values].sort((a, b) => a - b);
        const p = (pct) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * pct / 100))];
        return {
          samples: sorted.length,
          p50: Math.round(p(50)),
          p95: Math.round(p(95)),
          max: Math.round(sorted[sorted.length - 1]),
        };
      };

      const timer = setTimeout(() => {
        const elapsed = Math.max(1, Date.now() - started);
        const base = {
          ok: true,
          brokerUrl: this.brokerUrl,
          topics,
          durationMs: elapsed,
          messageCount: count,
          messagesPerSecond: count / (elapsed / 1000),
          lastMessageAt: lastAt,
          firstMessageAt: firstAt,
          transmitting: count > 0,
        };
        if (detailed) {
          base.interArrivalMs = summarize(gaps);
          base.bridgeLatencyMs = summarize(bridgeLatencies);
          base.ingestLatencyMs = summarize(ingestLatencies);
        }
        finish(base);
      }, durationMs);

      client.on('connect', () => {
        for (const t of topics) client.subscribe(t, { qos: 0 });
      });

      client.on('message', (_topic, payloadBuf) => {
        const now = Date.now();
        if (lastAt != null) gaps.push(now - lastAt);
        count++;
        lastAt = now;
        if (!firstAt) firstAt = now;

        if (!detailed) return;
        try {
          const payload = JSON.parse(payloadBuf.toString());
          const ts = payload.timestamp;
          if (typeof ts === 'number' && ts > 0) {
            const ingest = now - ts;
            if (ingest >= -5000 && ingest <= 60000) ingestLatencies.push(ingest);
          }
          const pub = payload.publishedAt;
          if (typeof pub === 'number' && pub > 0) {
            const bridge = now - pub;
            if (bridge >= 0 && bridge <= 60000) bridgeLatencies.push(bridge);
          }
        } catch { /* ignore */ }
      });

      client.on('error', (err) => {
        clearTimeout(timer);
        finish(null, err);
      });
    });
  }

  start({ topics = DEFAULT_TOPICS, label, durationMinutes } = {}) {
    if (this.state.recording) {
      throw new Error('Recording already in progress');
    }

    const usage = this.getLocalUsage();
    if (usage.totalBytes >= MAX_LOCAL_BYTES) {
      this.pruneLocal();
      const after = this.getLocalUsage();
      if (after.totalBytes >= MAX_LOCAL_BYTES) {
        throw new Error('Edge recording disk cap reached — sync or delete old captures first');
      }
    }

    const mins = parseDurationMinutes(durationMinutes);
    const startedAt = Date.now();
    const stopsAt = mins ? startedAt + mins * 60 * 1000 : null;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${sanitizeName(label)}_${stamp}.jsonl`;
    const filePath = path.join(this.recordDir, file);

    this.writeStream = fs.createWriteStream(filePath, { flags: 'a' });
    this._clearAutoStopTimer();
    this.state = {
      ...this._emptyState(),
      recording: true,
      file,
      filePath,
      startedAt,
      stopsAt,
      durationMinutes: mins,
      topics,
      brokerUrl: this.brokerUrl,
    };

    this._scheduleAutoStop(mins);

    this.client = mqtt.connect(this.brokerUrl, { reconnectPeriod: 2000, connectTimeout: 8000 });

    this.client.on('connect', () => {
      for (const t of topics) this.client.subscribe(t, { qos: 0 });
      console.log(`[MqttRecorder] Recording ${topics.join(', ')} → ${file}`);
    });

    this.client.on('message', (topic, payload) => {
      const line = `${topic} ${payload.toString('utf8')}\n`;
      this.writeStream.write(line);
      this.state.messagesRecorded++;
      this.state.bytesWritten += Buffer.byteLength(line);
      this.state.lastMessageAt = Date.now();
    });

    this.client.on('error', (err) => {
      console.error('[MqttRecorder] MQTT error:', err.message);
      this.state.error = err.message;
    });

    return this.getStatus();
  }

  stop({ autoStop = false } = {}) {
    if (!this.state.recording) {
      return Promise.resolve(this.getStatus());
    }

    this._clearAutoStopTimer();
    this.state = { ...this.state, recording: false };

    return new Promise((resolve) => {
      try { this.client?.end(true); } catch { /* ignore */ }
      this.client = null;

      const finalize = () => {
        this.writeStream = null;
        this._syncFileSize();
        const result = {
          ...this.state,
          recording: false,
          stoppedAt: Date.now(),
          autoStop: !!autoStop,
          remainingMs: 0,
        };
        this.state = { ...result, recording: false };
        console.log(`[MqttRecorder] Stopped — ${result.file} (${result.bytesWritten} bytes, ${result.messagesRecorded} msgs)`);
        resolve(result);
      };

      if (this.writeStream) {
        this.writeStream.end(finalize);
      } else {
        finalize();
      }
    });
  }

  resolveFile(name) {
    const base = path.basename(String(name || ''));
    if (!base || base !== name || !base.endsWith('.jsonl')) {
      throw new Error('Invalid recording filename');
    }
    const fp = path.join(this.recordDir, base);
    if (!fs.existsSync(fp)) throw new Error('Recording not found');
    return fp;
  }
}

export default MqttRecorder;
