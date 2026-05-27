/**
 * Records raw MQTT trajectory messages on the main server as they arrive.
 * Format: "topic {json}\n" — compatible with ReplayService playback.
 *
 * No edge changes required: the edge already bridges to this server's Mosquitto.
 */
import fs from 'fs';
import path from 'path';

function sanitizeName(name) {
  return String(name || 'capture')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80) || 'capture';
}

/** Max scheduled capture length (12 h). */
const MAX_DURATION_MINUTES = 720;

function parseDurationMinutes(value) {
  if (value == null || value === '') return null;
  const mins = Number(value);
  if (!Number.isFinite(mins) || mins <= 0) return null;
  return Math.min(MAX_DURATION_MINUTES, Math.round(mins));
}

export default class MqttRecordService {
  constructor({ replayDir } = {}) {
    this.replayDir = replayDir || process.env.REPLAY_DIR || '/data/replay';
    this.writeStream = null;
    this.state = this._emptyState();
    this._recordLines = [];
    this._recordFlushTimer = null;
    this._autoStopTimer = null;
    fs.mkdirSync(this.replayDir, { recursive: true });
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
      error: null,
      durationMinutes: null,
      stopsAt: null,
      autoStop: false,
    };
  }

  isRecording() {
    return this.state.recording;
  }

  _syncFileSize() {
    if (!this.state.filePath) return;
    try {
      const diskSize = fs.statSync(this.state.filePath).size;
      // WriteStream buffers — disk stat lags behind in-memory counter during recording.
      this.state.bytesWritten = Math.max(this.state.bytesWritten, diskSize);
    } catch { /* ignore */ }
  }

  getStatus(mqttService = null) {
    // Keep in-memory byte counter while recording; sync only picks up flushed bytes.
    if (this.state.recording) this._syncFileSize();
    const mqtt = mqttService?.getStatus?.() || null;
    const mqttActive = mqtt?.lastMessageTs && (Date.now() - mqtt.lastMessageTs) < 5000;
    const remainingMs = this.state.stopsAt
      ? Math.max(0, this.state.stopsAt - Date.now())
      : null;
    return {
      ...this.state,
      remainingMs,
      mqtt: mqtt ? {
        connected: mqtt.connected,
        lastMessageTs: mqtt.lastMessageTs,
        messagesReceived: mqtt.messagesReceived,
        active: mqttActive,
        ageMs: mqtt.lastMessageTs ? Date.now() - mqtt.lastMessageTs : null,
      } : null,
    };
  }

  /** Write one raw MQTT message (called from MqttTrajectoryService.handleMessage). */
  recordMessage(topic, payloadUtf8) {
    if (!this.state.recording || !this.writeStream) return;
    try {
      const line = `${topic} ${payloadUtf8}\n`;
      const lineBytes = Buffer.byteLength(line);
      this._recordLines.push(line);
      this.state.messagesRecorded++;
      this.state.bytesWritten += lineBytes;
      this.state.lastMessageAt = Date.now();
      this._scheduleRecordFlush();
    } catch (err) {
      console.error('[MqttRecord] write error:', err.message);
      this.state.error = err.message;
    }
  }

  _scheduleRecordFlush() {
    if (this._recordFlushTimer) return;
    this._recordFlushTimer = setTimeout(() => {
      this._recordFlushTimer = null;
      this._flushRecordBuffer();
    }, 100);
  }

  _flushRecordBuffer() {
    if (!this.writeStream || this._recordLines.length === 0) return;
    const chunk = this._recordLines.join('');
    this._recordLines = [];
    this.writeStream.write(chunk);
  }

  _clearRecordBuffer() {
    if (this._recordFlushTimer) {
      clearTimeout(this._recordFlushTimer);
      this._recordFlushTimer = null;
    }
    this._recordLines = [];
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
      console.log(`[MqttRecord] Auto-stop after ${durationMinutes} min`);
      this.stop({ autoStop: true }).catch((err) => {
        console.error('[MqttRecord] Auto-stop failed:', err.message);
      });
    }, durationMs);
  }

  start({ label, durationMinutes } = {}) {
    if (this.state.recording) {
      throw new Error('Recording already in progress');
    }

    const mins = parseDurationMinutes(durationMinutes);
    const startedAt = Date.now();
    const stopsAt = mins ? startedAt + mins * 60 * 1000 : null;

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${sanitizeName(label)}_${stamp}.jsonl`;
    const filePath = path.join(this.replayDir, file);

    this.writeStream = fs.createWriteStream(filePath, { flags: 'a' });
    this._clearRecordBuffer();
    this._clearAutoStopTimer();
    this.state = {
      ...this._emptyState(),
      recording: true,
      file,
      filePath,
      startedAt,
      durationMinutes: mins,
      stopsAt,
      autoStop: false,
    };

    this._scheduleAutoStop(mins);

    const durationNote = mins ? ` (auto-stop in ${mins} min)` : '';
    console.log(`[MqttRecord] Started → ${filePath}${durationNote}`);
    return this.getStatus();
  }

  stop({ autoStop = false } = {}) {
    if (!this.state.recording) {
      return Promise.resolve(this.getStatus());
    }

    this._clearAutoStopTimer();

    return new Promise((resolve) => {
      const finalize = () => {
        this._flushRecordBuffer();
        this._clearRecordBuffer();
        this.writeStream = null;
        this._syncFileSize();
        const result = {
          ...this.state,
          recording: false,
          stoppedAt: Date.now(),
          autoStop: !!autoStop,
          remainingMs: 0,
        };
        if (result.messagesRecorded > 0 && result.bytesWritten === 0) {
          result.error = 'Recording stopped but file is 0 bytes — discard this capture and record again after server restart.';
          console.error(`[MqttRecord] ${result.error} (${result.messagesRecorded} msgs counted)`);
        }
        this.state = { ...result, recording: false };
        console.log(`[MqttRecord] Stopped — ${result.file} (${result.bytesWritten} bytes, ${result.messagesRecorded} msgs)`);
        resolve(result);
      };

      if (this.writeStream) {
        this.writeStream.end(finalize);
      } else {
        finalize();
      }
    });
  }
}
