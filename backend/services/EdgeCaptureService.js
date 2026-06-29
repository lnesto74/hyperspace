/**
 * Record MQTT captures on the edge slave (pre-bridge, full 10 Hz), then sync to DO replay
 * storage and delete the local file so slave disk stays bounded.
 */
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const EDGE_PORT = Number(process.env.EDGE_PORT) || 8080;
const FETCH_TIMEOUT_MS = Number(process.env.EDGE_FETCH_TIMEOUT_MS) || 30000;
const SYNC_TIMEOUT_MS = Number(process.env.EDGE_SYNC_TIMEOUT_MS) || 600000;

function edgeBaseUrl(edgeIp) {
  const ip = String(edgeIp || '').trim();
  if (!ip) return null;
  if (ip.startsWith('http://') || ip.startsWith('https://')) return ip.replace(/\/$/, '');
  return `http://${ip}:${EDGE_PORT}`;
}

async function edgeFetch(url, { method = 'GET', body, timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const msg = data?.error || data?.message || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export default class EdgeCaptureService {
  constructor({ replayDir, db } = {}) {
    this.replayDir = replayDir || process.env.REPLAY_DIR || '/data/replay';
    this.db = db;
    this.state = this._emptyState();
    this._pollTimer = null;
    this._syncing = false;
    fs.mkdirSync(this.replayDir, { recursive: true });
  }

  _emptyState() {
    return {
      source: 'edge',
      recording: false,
      syncing: false,
      edgeUrl: null,
      edgeIp: null,
      file: null,
      edgeFile: null,
      bytesWritten: 0,
      messagesRecorded: 0,
      startedAt: null,
      lastMessageAt: null,
      stoppedAt: null,
      durationMinutes: null,
      stopsAt: null,
      remainingMs: null,
      error: null,
      lastSync: null,
    };
  }

  get mode() {
    return (process.env.REPLAY_RECORD_SOURCE || 'edge').toLowerCase();
  }

  useEdgeRecording() {
    return this.mode !== 'cloud';
  }

  resolveEdgeUrl({ edgeIp, venueId } = {}) {
    const fromArg = edgeBaseUrl(edgeIp);
    if (fromArg) return fromArg;

    const envUrl = process.env.EDGE_SERVER_URL?.trim();
    if (envUrl) return envUrl.replace(/\/$/, '');

    if (venueId && this.db) {
      try {
        const row = this.db.prepare(`
          SELECT edge_tailscale_ip FROM edge_lidar_pairings
          WHERE venue_id = ? AND edge_tailscale_ip IS NOT NULL AND edge_tailscale_ip != ''
          ORDER BY updated_at DESC LIMIT 1
        `).get(String(venueId));
        if (row?.edge_tailscale_ip) return edgeBaseUrl(row.edge_tailscale_ip);
      } catch { /* table may be empty */ }
    }

    return edgeBaseUrl('100.106.23.6');
  }

  getStatus(mqttService = null) {
    const remainingMs = this.state.stopsAt
      ? Math.max(0, this.state.stopsAt - Date.now())
      : null;
    const mqtt = mqttService?.getStatus?.() || null;
    return {
      ...this.state,
      remainingMs,
      source: this.useEdgeRecording() ? 'edge' : 'cloud',
      mqtt: mqtt ? {
        connected: mqtt.connected,
        lastMessageTs: mqtt.lastMessageTs,
        messagesReceived: mqtt.messagesReceived,
        active: mqtt.lastMessageTs && (Date.now() - mqtt.lastMessageTs) < 5000,
        ageMs: mqtt.lastMessageTs ? Date.now() - mqtt.lastMessageTs : null,
      } : null,
    };
  }

  async hardenEdgeBridge({ edgeIp, venueId } = {}) {
    const edgeUrl = this.resolveEdgeUrl({ edgeIp, venueId });
    return edgeFetch(`${edgeUrl}/api/mqtt-bridge/harden`, { method: 'POST', timeoutMs: 45000 });
  }

  _startPoll(edgeUrl) {
    this._stopPoll();
    this._pollTimer = setInterval(async () => {
      try {
        if (!this.state.recording || this._syncing) return;
        const data = await edgeFetch(`${edgeUrl}/api/edge/mqtt/record/status`, { timeoutMs: 8000 });
        const edgeStatus = data?.status;
        if (!edgeStatus) return;
        this.state.bytesWritten = edgeStatus.bytesWritten ?? this.state.bytesWritten;
        this.state.messagesRecorded = edgeStatus.messagesRecorded ?? this.state.messagesRecorded;
        this.state.lastMessageAt = edgeStatus.lastMessageAt ?? this.state.lastMessageAt;
        this.state.stopsAt = edgeStatus.stopsAt ?? this.state.stopsAt;
        if (!edgeStatus.recording && this.state.recording) {
          console.log('[EdgeCapture] Edge auto-stopped — starting sync');
          await this._syncFromEdge(edgeUrl, edgeStatus.file || this.state.edgeFile, { autoStop: true });
        }
      } catch (err) {
        console.warn('[EdgeCapture] poll failed:', err.message);
      }
    }, 2000);
  }

  _stopPoll() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  async start({ label, durationMinutes, edgeIp, venueId } = {}) {
    if (this.state.recording || this._syncing) {
      throw new Error('Edge capture already in progress');
    }

    const edgeUrl = this.resolveEdgeUrl({ edgeIp, venueId });
    this.state = {
      ...this._emptyState(),
      recording: true,
      edgeUrl,
      edgeIp: edgeIp || edgeUrl,
      startedAt: Date.now(),
      durationMinutes: durationMinutes ?? null,
      stopsAt: durationMinutes ? Date.now() + durationMinutes * 60 * 1000 : null,
    };

    try {
      await this.hardenEdgeBridge({ edgeIp, venueId }).catch((err) => {
        console.warn('[EdgeCapture] Bridge harden skipped:', err.message);
      });

      const data = await edgeFetch(`${edgeUrl}/api/edge/mqtt/record/start`, {
        method: 'POST',
        body: {
          label: label || 'capture',
          durationMinutes,
          topics: ['hyperspace/trajectories/#'],
        },
      });

      const st = data.status || {};
      this.state.edgeFile = st.file;
      this.state.file = st.file;
      this.state.bytesWritten = st.bytesWritten || 0;
      this.state.messagesRecorded = st.messagesRecorded || 0;
      this.state.lastMessageAt = st.lastMessageAt || null;
      this.state.stopsAt = st.stopsAt ?? this.state.stopsAt;
      this._startPoll(edgeUrl);
      console.log(`[EdgeCapture] Recording on edge ${edgeUrl} → ${st.file}`);
      return this.getStatus();
    } catch (err) {
      this.state = this._emptyState();
      throw err;
    }
  }

  async stop({ edgeIp, venueId } = {}) {
    const edgeUrl = this.resolveEdgeUrl({ edgeIp: edgeIp || this.state.edgeIp, venueId });
    this._stopPoll();

    if (this.state.recording) {
      const data = await edgeFetch(`${edgeUrl}/api/edge/mqtt/record/stop`, { method: 'POST' });
      const edgeFile = data.file || this.state.edgeFile;
      this.state.recording = false;
      this.state.stoppedAt = Date.now();
      return this._syncFromEdge(edgeUrl, edgeFile, { autoStop: !!data.autoStop });
    }

    if (this._syncing) {
      return this.getStatus();
    }

    return this.getStatus();
  }

  async _syncFromEdge(edgeUrl, edgeFile, { autoStop = false } = {}) {
    if (!edgeFile) throw new Error('No edge recording file to sync');
    if (this._syncing) return this.getStatus();

    this._syncing = true;
    this.state.syncing = true;
    this.state.recording = false;

    const destPath = path.join(this.replayDir, path.basename(edgeFile));
    const tmpPath = `${destPath}.partial`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(
          `${edgeUrl}/api/edge/mqtt/record/download/${encodeURIComponent(path.basename(edgeFile))}`,
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        throw new Error(`Edge download failed: HTTP ${res.status}`);
      }

      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmpPath));
      const stat = fs.statSync(tmpPath);
      if (stat.size === 0) {
        throw new Error('Synced file is empty — edge capture failed');
      }

      fs.renameSync(tmpPath, destPath);
      this.state.file = path.basename(destPath);
      this.state.bytesWritten = stat.size;
      this.state.lastSync = { at: Date.now(), bytes: stat.size, edgeFile };

      await edgeFetch(
        `${edgeUrl}/api/edge/mqtt/record/files/${encodeURIComponent(path.basename(edgeFile))}`,
        { method: 'DELETE', timeoutMs: 15000 },
      ).catch((err) => {
        console.warn('[EdgeCapture] Edge delete after sync failed (file on DO is OK):', err.message);
      });

      await edgeFetch(`${edgeUrl}/api/edge/mqtt/record/prune`, { method: 'POST', timeoutMs: 10000 }).catch(() => {});

      console.log(`[EdgeCapture] Synced ${edgeFile} → ${destPath} (${stat.size} bytes)${autoStop ? ' [auto-stop]' : ''}`);
      this.state.error = null;
    } catch (err) {
      this.state.error = err.message;
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
      throw err;
    } finally {
      this._syncing = false;
      this.state.syncing = false;
      this.state.stoppedAt = this.state.stoppedAt || Date.now();
      this.state.autoStop = !!autoStop;
    }

    return this.getStatus();
  }
}
