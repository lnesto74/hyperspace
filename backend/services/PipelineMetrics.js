/**
 * Rolling-window metrics for live MQTT → aggregator → socket pipeline.
 * Enable structured logs with MQTT_PIPELINE_DIAG=1.
 */

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx];
}

function summarizeMs(values) {
  if (!values.length) {
    return { samples: 0, p50: null, p95: null, max: null, min: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    min: sorted[0],
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
  };
}

export class PipelineMetrics {
  constructor(windowMs = 10000) {
    this.windowMs = windowMs;
    this.lastSnapshot = null;
    this._resetWindow();
  }

  _resetWindow() {
    this.windowStart = Date.now();
    this.mqtt = {
      count: 0,
      gaps: [],
      bridgeLatencies: [],
      ingestLatencies: [],
      lastRecvAt: null,
      lastPayloadTs: null,
    };
    this.emit = {
      count: 0,
      gaps: [],
      trackCounts: [],
      lastEmitAt: null,
    };
  }

  _rollIfNeeded() {
    const elapsed = Date.now() - this.windowStart;
    if (elapsed < this.windowMs) return;
    this.lastSnapshot = this._buildSnapshot(elapsed);
    this._resetWindow();
  }

  recordMqttMessage({ payloadTs, publishedAt, recvAt = Date.now() } = {}) {
    if (this.mqtt.lastRecvAt != null) {
      this.mqtt.gaps.push(recvAt - this.mqtt.lastRecvAt);
    }
    this.mqtt.lastRecvAt = recvAt;
    this.mqtt.count += 1;
    if (payloadTs) {
      this.mqtt.lastPayloadTs = payloadTs;
      const ingest = recvAt - payloadTs;
      if (ingest >= -5000 && ingest <= 60000) {
        this.mqtt.ingestLatencies.push(ingest);
      }
    }
    if (publishedAt) {
      const bridge = recvAt - publishedAt;
      if (bridge >= 0 && bridge <= 60000) {
        this.mqtt.bridgeLatencies.push(bridge);
      }
    }
    this._rollIfNeeded();
  }

  recordSocketEmit({ trackCount = 0, emitAt = Date.now() } = {}) {
    if (this.emit.lastEmitAt != null) {
      this.emit.gaps.push(emitAt - this.emit.lastEmitAt);
    }
    this.emit.lastEmitAt = emitAt;
    this.emit.count += 1;
    if (trackCount > 0) this.emit.trackCounts.push(trackCount);
    this._rollIfNeeded();
  }

  _buildSnapshot(elapsedMs = this.windowMs) {
    const sec = Math.max(elapsedMs / 1000, 0.001);
    const mqttGap = summarizeMs(this.mqtt.gaps);
    const emitGap = summarizeMs(this.emit.gaps);
    const bridge = summarizeMs(this.mqtt.bridgeLatencies);
    const ingest = summarizeMs(this.mqtt.ingestLatencies);
    const avgTracks = this.emit.trackCounts.length
      ? this.emit.trackCounts.reduce((a, b) => a + b, 0) / this.emit.trackCounts.length
      : 0;

    return {
      windowMs: Math.round(elapsedMs),
      capturedAt: Date.now(),
      mqtt: {
        messages: this.mqtt.count,
        msgPerSec: this.mqtt.count / sec,
        interArrivalMs: mqttGap,
        bridgeLatencyMs: bridge,
        ingestLatencyMs: ingest,
        lastRecvAt: this.mqtt.lastRecvAt,
        lastPayloadTs: this.mqtt.lastPayloadTs,
      },
      socketEmit: {
        batches: this.emit.count,
        batchesPerSec: this.emit.count / sec,
        interEmitMs: emitGap,
        avgTracksPerBatch: Math.round(avgTracks * 10) / 10,
        lastEmitAt: this.emit.lastEmitAt,
      },
    };
  }

  getSnapshot() {
    this._rollIfNeeded();
    const current = this._buildSnapshot(Date.now() - this.windowStart);
    return {
      current,
      previous: this.lastSnapshot,
    };
  }

  diagnose(snapshot = this.getSnapshot().current) {
    const issues = [];
    const hints = [];

    const mqttGapP95 = snapshot.mqtt.interArrivalMs.p95;
    const emitGapP95 = snapshot.socketEmit.interEmitMs.p95;
    const bridgeP95 = snapshot.mqtt.bridgeLatencyMs.p95;

    if (snapshot.mqtt.messages === 0) {
      issues.push('no_mqtt_on_do');
      hints.push('No MQTT messages reached the DO backend broker/subscriber in the measurement window.');
    }
    if (mqttGapP95 != null && mqttGapP95 > 500) {
      issues.push('mqtt_burst_or_stall');
      hints.push(`DO MQTT inter-arrival p95=${Math.round(mqttGapP95)}ms — bursty delivery or bridge stalls (Tailscale/mosquitto bridge).`);
    }
    if (emitGapP95 != null && emitGapP95 > 250) {
      issues.push('aggregator_emit_irregular');
      hints.push(`Socket emit gap p95=${Math.round(emitGapP95)}ms — backend emit cadence irregular (expect ~100ms).`);
    }
    if (bridgeP95 != null && bridgeP95 > 300) {
      issues.push('edge_to_do_latency');
      hints.push(`Edge→DO bridge latency p95=${Math.round(bridgeP95)}ms — enable PIPELINE_DIAG=1 on edge for publishedAt stamps.`);
    }
    if (snapshot.mqtt.msgPerSec > 0 && snapshot.socketEmit.batchesPerSec < 5) {
      issues.push('emit_backpressure');
      hints.push('MQTT arriving but socket batches <5/s — check TrackAggregator / event loop load.');
    }

    const ingestP50 = snapshot.mqtt.ingestLatencyMs.p50;
    if (ingestP50 != null && Math.abs(ingestP50) > 5000) {
      issues.push('clock_skew');
      hints.push(
        `Payload timestamp vs DO clock offset ~${Math.round(Math.abs(ingestP50) / 1000)}s — fix NTP on edge `
        + '(chrony/systemd-timesyncd). This is NOT network latency; ignore ingestLatencyMs until clocks sync.',
      );
    }

    const mqttGapP50 = snapshot.mqtt.interArrivalMs.p50;
    if (mqttGapP50 === 0 && snapshot.mqtt.msgPerSec > 100) {
      hints.push(
        `MQTT arrives in micro-bursts (${Math.round(snapshot.mqtt.msgPerSec)} msg/s, p50 gap 0ms) — `
        + 'normal for per-track messages; socket emit is smoothed to ~10 batches/s.',
      );
    }

    if (issues.length === 0 && snapshot.mqtt.messages > 0) {
      hints.push('DO backend path looks healthy in this window. If UI still stutters, measure browser socket gaps (localStorage hyperspace-diag=1).');
    }

    return { issues, hints, replayControlNote: 'Raw JSONL replay bypasses Tailscale/MQTT bridge — if replay is smooth but live is not, suspect edge bridge or live MQTT delivery, not Chrome rendering.' };
  }
}

export default PipelineMetrics;
