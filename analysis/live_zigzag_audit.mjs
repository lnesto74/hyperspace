#!/usr/bin/env node
/**
 * Live zig-zag audit — is the shudder on the canvas the supplier's or ours?
 *
 * Usage (on the prod backend container):
 *   node analysis/live_zigzag_audit.mjs [venueId] [durationSec]
 *
 * Watching the 3D canvas, a track that snaps back and forth over a short segment
 * has two possible authors. Either the supplier's own feed is oscillating and we
 * are faithfully drawing it, or re-ID is handing one stable id to two people
 * standing near each other and the drawn position flips between them. Those need
 * opposite fixes, and no amount of looking at the canvas separates them.
 *
 * So both streams are measured over the same frames: the supplier's perception
 * ids exactly as published, and the reconciler's stable ids as the canvas
 * receives them. A reversal is three consecutive samples where the person walks
 * out and comes back along the same line — both legs short, both quick, and the
 * turn sharper than 120 degrees. Real shoppers do turn around, which is why the
 * number that matters is not the count but the ratio between the two streams.
 *
 * Env: MQTT_URL / MQTT_BROKER_URL, DB_PATH
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, '..', 'backend');

function requirePkg(name) {
  for (const base of [join(backendRoot, 'node_modules'), '/app/node_modules']) {
    try {
      return require(join(base, name));
    } catch { /* try next */ }
  }
  throw new Error(`Cannot resolve package: ${name}`);
}

const Database = requirePkg('better-sqlite3');
const mqtt = requirePkg('mqtt');

import {
  TrajectoryReconciler,
  normalizeReconcilerConfig,
} from '../backend/services/TrajectoryReconciler.js';
import { getDefaultLiveReconcilerConfig } from '../backend/config/liveReconcilePresets.js';
import {
  applyTransformToPoint,
  applyTransformToVelocity,
  normalizePerceptionTransform,
  perceptionToFloor,
  IDENTITY_TRANSFORM,
} from '../backend/services/PerceptionTransform.js';

const argv = process.argv.slice(2);
const VENUE_ID = argv[0] || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const DURATION_SEC = Number(argv[1] || 120);
const MQTT_URL = process.env.MQTT_URL || process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const DB_PATH = process.env.DB_PATH || '/data/db/hyperspace.db';

// A reversal has to be a walk-out-and-back, not sensor noise on a standing
// person (too short) and not a genuine turn at the end of an aisle (too long,
// too slow). These bounds are what "zig-zag" means for the rest of this file.
const MIN_LEG_M = 0.15;
const MAX_LEG_M = 2.0;
const MAX_LEG_MS = 1500;
const REVERSAL_COS = -0.5;      // sharper than 120 degrees
const TELEPORT_SPEED = 4.0;     // m/s — faster than anyone walks

function cosine(ax, az, bx, bz) {
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < 1e-6 || lb < 1e-6) return 1;
  return (ax * bx + az * bz) / (la * lb);
}

/** Counts reversals and teleports for one stream of identified positions. */
class ShudderMeter {
  constructor(label) {
    this.label = label;
    this.tracks = new Map();
    this.reversals = 0;
    this.teleports = 0;
    this.samples = 0;
    this.pathM = 0;
    this.observedMs = 0;
    this.ids = new Set();
    this.worst = [];
  }

  add(id, x, z, t) {
    this.ids.add(id);
    this.samples++;
    let tr = this.tracks.get(id);
    if (!tr) {
      this.tracks.set(id, { prev: { x, z, t }, leg: null, firstT: t, lastT: t, reversals: 0 });
      return;
    }

    const dt = t - tr.prev.t;
    if (dt <= 0) return;
    const dx = x - tr.prev.x;
    const dz = z - tr.prev.z;
    const len = Math.hypot(dx, dz);

    this.observedMs += dt;
    this.pathM += len;
    tr.lastT = t;

    if (len / (dt / 1000) > TELEPORT_SPEED && len > 1.0) this.teleports++;

    const usable = len >= MIN_LEG_M && len <= MAX_LEG_M && dt <= MAX_LEG_MS;
    if (usable && tr.leg) {
      if (cosine(tr.leg.dx, tr.leg.dz, dx, dz) < REVERSAL_COS) {
        this.reversals++;
        tr.reversals++;
      }
    }
    tr.leg = usable ? { dx, dz } : null;
    tr.prev = { x, z, t };
  }

  summary() {
    const minutes = this.observedMs / 60000;
    const worst = [...this.tracks.entries()]
      .filter(([, t]) => t.reversals > 0)
      .sort((a, b) => b[1].reversals - a[1].reversals)
      .slice(0, 5)
      .map(([id, t]) => ({
        id: String(id).slice(0, 24),
        reversals: t.reversals,
        seconds: Math.round((t.lastT - t.firstT) / 1000),
      }));
    return {
      stream: this.label,
      ids: this.ids.size,
      samples: this.samples,
      trackMinutes: Math.round(minutes * 10) / 10,
      pathM: Math.round(this.pathM),
      reversals: this.reversals,
      reversalsPerTrackMinute: minutes > 0 ? Math.round((this.reversals / minutes) * 100) / 100 : 0,
      teleports: this.teleports,
      worstTracks: worst,
    };
  }
}

function loadVenue(db, venueId) {
  const row = db.prepare('SELECT id, name, dwg_transform_json FROM venues WHERE id = ?').get(venueId);
  if (!row) throw new Error(`Venue not found: ${venueId}`);
  const parsed = JSON.parse(row.dwg_transform_json || '{}');
  const reconciler = normalizeReconcilerConfig(parsed.reconciler || getDefaultLiveReconcilerConfig());
  const transform = normalizePerceptionTransform(parsed.perceptionTransform || IDENTITY_TRANSFORM);
  return { ...row, reconciler, transform };
}

function toIncoming(deviceId, venueId, data, transform) {
  const inputFrame = transform.input_frame || 'legacy';
  const floorPos = perceptionToFloor(inputFrame, data.position || { x: 0, y: 0, z: 0 });
  const floorVel = perceptionToFloor(inputFrame, data.velocity || { x: 0, y: 0, z: 0 });
  return {
    id: data.id,
    trackKey: `${data.deviceId || deviceId}:${data.id}`,
    deviceId: data.deviceId || deviceId,
    venueId,
    timestamp: data.timestamp || Date.now(),
    position: floorPos,
    venuePosition: applyTransformToPoint(transform, floorPos),
    velocity: applyTransformToVelocity(transform, floorVel),
    objectType: data.objectType || 'person',
  };
}

/**
 * Candidate gate settings, all fed the same frames in the same process. Running
 * them one after another would compare different two-minute slices of the shop
 * floor and prove nothing; the only honest comparison is simultaneous.
 */
function buildVariants(live) {
  return [
    { label: 'live (as deployed)', cfg: live },
    {
      label: 'churn 500ms',
      cfg: normalizeReconcilerConfig({ ...live, reid_churn_active_ms: 500, reid_stale_active_ms: 500 }),
    },
    {
      label: 'exclusive bindings (one id per stable track)',
      cfg: normalizeReconcilerConfig({ ...live, reid_exclusive_bindings: true }),
    },
    {
      label: 'exclusive bindings + churn 500ms',
      cfg: normalizeReconcilerConfig({
        ...live,
        reid_exclusive_bindings: true,
        reid_churn_active_ms: 500,
        reid_stale_active_ms: 500,
      }),
    },
    {
      label: 'no active-track re-ID (lost tracks only)',
      cfg: normalizeReconcilerConfig({
        ...live,
        reid_churn_active_ms: 999999,
        reid_stale_active_ms: 999999,
      }),
    },
  ];
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });
  const venue = loadVenue(db, VENUE_ID);
  const live = venue.reconciler;

  const raw = new ShudderMeter('supplier (perception ids, as published)');
  const variants = buildVariants(live).map(v => {
    const reconciler = new TrajectoryReconciler(() => v.cfg);
    reconciler.setVenueConfig(VENUE_ID, v.cfg);
    return { ...v, reconciler, meter: new ShudderMeter(v.label), dropped: 0 };
  });

  console.log(`[zigzag] ${venue.name} · ${DURATION_SEC}s · live gates: churn=${live.reid_churn_active_ms}ms`
    + ` stale=${live.reid_stale_active_ms}ms dist=${live.reid_max_distance_m}m`
    + ` speed=${live.reid_max_implied_speed_m_s}m/s alpha=${live.smoothing_alpha}`
    + ` promoteAfter=${live.ghost_min_promotion_lifetime_ms}ms/${live.ghost_min_promotion_displacement_m}m`);

  const client = mqtt.connect(MQTT_URL, { clientId: `zigzag-${Date.now()}`, clean: true });
  let lastSweep = Date.now();

  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, DURATION_SEC * 1000);
    client.on('error', (e) => { clearTimeout(timer); reject(e); });
    client.on('connect', () => client.subscribe('hyperspace/trajectories/+'));
    client.on('message', (topic, buf) => {
      try {
        const data = JSON.parse(buf.toString());
        if (!data.position || data.tracks) return;
        if (data.venueId && data.venueId !== VENUE_ID) return;
        if (data.objectType && data.objectType !== 'person') return;

        const incoming = toIncoming(topic.split('/').pop(), VENUE_ID, data, venue.transform);
        const now = Date.now();
        const sweeping = now - lastSweep >= 250;
        if (sweeping) lastSweep = now;

        raw.add(incoming.trackKey, incoming.venuePosition.x, incoming.venuePosition.z, now);

        for (const v of variants) {
          if (sweeping) v.reconciler.sweep(now);
          // process() mutates the track it is given, so each variant needs its
          // own copy or the first one to run decides for all of them.
          const out = v.reconciler.process({ ...incoming });
          if (!out) { v.dropped++; continue; }
          const p = out.venuePosition || out.position;
          v.meter.add(out.stableId || out.trackKey, p.x, p.z, now);
        }
      } catch { /* malformed frame */ }
    });
  });

  client.end(true);

  const r = raw.summary();
  const ratioTo = (c) => (r.reversalsPerTrackMinute > 0
    ? Math.round((c.reversalsPerTrackMinute / r.reversalsPerTrackMinute) * 100) / 100
    : null);

  console.log(JSON.stringify({
    venue: venue.name,
    durationSec: DURATION_SEC,
    supplier: r,
    variants: variants.map(v => {
      const s = v.meter.summary();
      return {
        ...s,
        gates: {
          churnActiveMs: v.cfg.reid_churn_active_ms,
          staleActiveMs: v.cfg.reid_stale_active_ms,
          maxDistanceM: v.cfg.reid_max_distance_m,
        },
        droppedByGhostFilter: v.dropped,
        // Path the supplier never published. The reconciler cannot create
        // distance unless one stable id is being fed two people at once.
        pathInflationVsSupplier: r.pathM > 0 ? Math.round((s.pathM / r.pathM) * 100) / 100 : null,
        reversalsVsSupplier: ratioTo(s),
      };
    }),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
