/**
 * Streaming JSONL loader for MQTT capture files (multi-GB safe).
 */
import fs from 'fs';
import readline from 'readline';

export function buildIncoming(d) {
  const p = d.position || { x: 0, y: 0, z: 0 };
  const v = d.velocity || { x: 0, y: 0, z: 0 };
  return {
    id: String(d.id),
    deviceId: d.deviceId || 'edge',
    venueId: d.venueId || 'default',
    timestamp: Number(d.timestamp) || Date.now(),
    position: { x: p.x, y: p.z, z: p.y },
    venuePosition: { x: p.x, y: p.z, z: p.y },
    velocity: { x: v.x, y: v.z, z: v.y },
    objectType: d.objectType || 'person',
    boundingBox: d.boundingBox || { width: 0.5, height: 1.7, depth: 0.5 },
  };
}

function parseLine(line) {
  const raw = line.trim();
  if (!raw || raw.startsWith('nohup:') || raw.startsWith('mosquitto_sub')) return null;
  const idx = raw.indexOf(' ');
  if (idx < 0) return null;
  try {
    const d = JSON.parse(raw.slice(idx + 1));
    if (!d?.position) return null;
    return buildIncoming(d);
  } catch {
    return null;
  }
}

/** Stream messages; optional venue + time window filters. */
export async function* streamMessages(filePath, { venueId, afterMs, beforeMs } = {}) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const m = parseLine(line);
    if (!m) continue;
    if (venueId && m.venueId !== venueId) continue;
    if (afterMs != null && m.timestamp < afterMs) continue;
    if (beforeMs != null && m.timestamp >= beforeMs) continue;
    yield m;
  }
}

/** First pass: count messages per venue (no RAM spike). */
export async function detectPrimaryVenue(filePath, { afterMs, beforeMs } = {}) {
  const counts = new Map();
  for await (const m of streamMessages(filePath, { afterMs, beforeMs })) {
    counts.set(m.venueId, (counts.get(m.venueId) || 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function parseWhen(s) {
  if (!s) return null;
  const t = Date.parse(String(s).replace(/(\.\d{3})\d+(Z)/, '$1$2'));
  return Number.isFinite(t) ? t : null;
}
