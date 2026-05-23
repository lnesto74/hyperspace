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

export default class MqttRecordService {
  constructor({ replayDir } = {}) {
    this.replayDir = replayDir || process.env.REPLAY_DIR || '/data/replay';
    this.writeStream = null;
    this.state = this._emptyState();
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
    };
  }

  isRecording() {
    return this.state.recording;
  }

  _syncFileSize() {
    if (!this.state.filePath) return;
    try {
      this.state.bytesWritten = fs.statSync(this.state.filePath).size;
    } catch { /* ignore */ }
  }

  getStatus(mqttService = null) {
    if (this.state.recording) this._syncFileSize();
    const mqtt = mqttService?.getStatus?.() || null;
    const mqttActive = mqtt?.lastMessageTs && (Date.now() - mqtt.lastMessageTs) < 5000;
    return {
      ...this.state,
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
      this.writeStream.write(line);
      this.state.messagesRecorded++;
      this.state.bytesWritten += Buffer.byteLength(line);
      this.state.lastMessageAt = Date.now();
    } catch (err) {
      console.error('[MqttRecord] write error:', err.message);
      this.state.error = err.message;
    }
  }

  start({ label } = {}) {
    if (this.state.recording) {
      throw new Error('Recording already in progress');
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${sanitizeName(label)}_${stamp}.jsonl`;
    const filePath = path.join(this.replayDir, file);

    this.writeStream = fs.createWriteStream(filePath, { flags: 'a' });
    this.state = {
      ...this._emptyState(),
      recording: true,
      file,
      filePath,
      startedAt: Date.now(),
    };

    console.log(`[MqttRecord] Started → ${filePath}`);
    return this.getStatus();
  }

  stop() {
    if (!this.state.recording) {
      return this.getStatus();
    }

    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }

    this._syncFileSize();
    const result = {
      ...this.state,
      recording: false,
      stoppedAt: Date.now(),
    };
    this.state = { ...result, recording: false };
    console.log(`[MqttRecord] Stopped — ${result.file} (${result.bytesWritten} bytes, ${result.messagesRecorded} msgs)`);
    return result;
  }
}
