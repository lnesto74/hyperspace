/**
 * Hardened Mosquitto bridge snippet for edge → DO trajectory forwarding.
 * Applied on bridge updates and via POST /api/mqtt-bridge/harden.
 */

export const BRIDGE_PRODUCTION_ADDRESS = '100.76.196.2:1883';

export function buildBridgeSection(address = BRIDGE_PRODUCTION_ADDRESS, connectionName = 'hyperspace-prod') {
  return `# ============================================
# Bridge to Production (DigitalOcean)
# ============================================
connection ${connectionName}
address ${address}

# Bridge trajectory topics to production (QoS 1 — at-least-once over Tailscale)
topic hyperspace/trajectories/# out 1

# Keep bridge session state across reconnects — cleansession true caused 5s message loss bursts.
cleansession false
try_private false
restart_timeout 2
bridge_attempt_unsubscribe false
notifications false

# Faster keepalive helps detect Tailscale/DERP stalls before long silent gaps.
keepalive_interval 10
`;
}

/** Replace or append the bridge block in a full mosquitto.conf. */
export function applyHardenedBridge(conf, address, connectionName = 'hyperspace-prod') {
  const bridgeBlock = buildBridgeSection(address, connectionName);
  const marker = '# ============================================\n# Bridge to Production';
  const idx = conf.indexOf(marker);
  if (idx >= 0) {
    return conf.slice(0, idx) + bridgeBlock;
  }
  return `${conf.trim()}\n\n${bridgeBlock}\n`;
}

/** Ensure local broker can queue while bridge is down. */
export function ensureBrokerQueueSettings(conf) {
  let next = conf;
  const replacements = [
    [/^max_queued_messages\s+.+$/m, 'max_queued_messages 100000'],
    [/^max_inflight_messages\s+.+$/m, 'max_inflight_messages 200'],
  ];
  for (const [re, line] of replacements) {
    if (re.test(next)) next = next.replace(re, line);
    else next = next.replace(/^(persistence_location\s+.+)$/m, `$1\n${line}`);
  }
  if (!/^max_packet_size\s+/m.test(next)) {
    next = next.replace(/^(max_inflight_messages\s+.+)$/m, `$1\nmax_packet_size 10485760`);
  }
  return next;
}
