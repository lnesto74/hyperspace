/**
 * Shared checkout alert thresholds — used by Checkout Operations Center
 * and Neural Dashboard alerts so both surfaces stay in sync.
 */

export const DEFAULT_CHECKOUT_ALERT_CONFIG = {
  waitTimeWarningMin: 2,
  waitTimeCriticalMin: 5,
  queueLengthWarning: 2,
  queueLengthCritical: 5,
  queueLengthActivity: 3,
  occupancyWarning: 70,
  occupancyCritical: 90,
  queuePressureThreshold: 5,
  inflowRateThreshold: 10,
};

export const DEFAULT_CHECKOUT_ALERT_RULES = [
  { id: '1', name: 'Wait Time Warning', type: 'wait_time', operator: '>', threshold: 2, severity: 'warning', enabled: true },
  { id: '2', name: 'Wait Time Critical', type: 'wait_time', operator: '>', threshold: 5, severity: 'critical', enabled: true },
  { id: '3', name: 'Queue Length Warning', type: 'queue_length', operator: '>', threshold: 2, severity: 'warning', enabled: true },
  { id: '4', name: 'Queue Length Critical', type: 'queue_length', operator: '>', threshold: 5, severity: 'critical', enabled: true },
];

export function parseCheckoutAlertConfig(raw) {
  if (!raw) return { ...DEFAULT_CHECKOUT_ALERT_CONFIG, rules: [...DEFAULT_CHECKOUT_ALERT_RULES] };
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      ...DEFAULT_CHECKOUT_ALERT_CONFIG,
      ...parsed,
      rules: Array.isArray(parsed.rules) && parsed.rules.length > 0
        ? parsed.rules
        : [...DEFAULT_CHECKOUT_ALERT_RULES],
    };
  } catch {
    return { ...DEFAULT_CHECKOUT_ALERT_CONFIG, rules: [...DEFAULT_CHECKOUT_ALERT_RULES] };
  }
}

export function getCheckoutAlertConfig(db, venueId) {
  const row = db.prepare(
    'SELECT checkout_alert_config_json FROM venues WHERE id = ?'
  ).get(venueId);
  return parseCheckoutAlertConfig(row?.checkout_alert_config_json);
}

export function saveCheckoutAlertConfig(db, venueId, config) {
  const payload = {
    ...DEFAULT_CHECKOUT_ALERT_CONFIG,
    ...config,
    rules: Array.isArray(config?.rules) ? config.rules : DEFAULT_CHECKOUT_ALERT_RULES,
  };
  db.prepare(`
    UPDATE venues
    SET checkout_alert_config_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(payload), venueId);
  return payload;
}

function compareValue(value, operator, threshold) {
  switch (operator) {
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '<': return value < threshold;
    case '>':
    default:
      return value > threshold;
  }
}

/**
 * Evaluate checkout lanes against alert rules (same logic as Checkout Operations Center).
 */
export function evaluateCheckoutLaneAlerts(lanes, config, now = Date.now()) {
  const alerts = [];
  const rules = (config.rules || DEFAULT_CHECKOUT_ALERT_RULES).filter(r => r.enabled !== false);
  const openLanes = lanes.filter(l => l.status === 'OPEN');

  for (const lane of openLanes) {
    for (const rule of rules) {
      let value = 0;
      if (rule.type === 'wait_time') {
        if (lane.avgWaitTimeSec == null) continue;
        value = lane.avgWaitTimeSec / 60;
      } else if (rule.type === 'queue_length') {
        value = lane.queueCount ?? 0;
      } else if (rule.type === 'occupancy') {
        if (lane.occupancyRate == null) continue;
        value = lane.occupancyRate;
      } else {
        continue;
      }

      if (!compareValue(value, rule.operator || '>', rule.threshold)) continue;

      const severity = rule.severity === 'critical' ? 'high' : rule.severity === 'warning' ? 'medium' : 'low';
      alerts.push({
        id: `checkout-${lane.laneId}-${rule.id}-${Math.floor(now / 60000)}`,
        type: 'queue_risk',
        severity,
        title: rule.severity === 'critical' ? 'QUEUE BUILDUP' : rule.severity === 'warning' ? 'QUEUE BUILDUP' : 'QUEUE ACTIVITY',
        message: `${lane.displayName || `Lane ${lane.laneId}`}: ${rule.name} (${Math.round(value * 10) / 10} vs ${rule.threshold})`,
        action: rule.severity === 'critical'
          ? 'Open additional register immediately'
          : rule.severity === 'warning'
            ? 'Consider opening another register'
            : 'Monitor — no action needed yet',
        timestamp: now,
        zoneId: lane.queueZoneId,
        laneId: lane.laneId,
        source: 'checkout_ops',
      });
    }
  }

  return alerts;
}
