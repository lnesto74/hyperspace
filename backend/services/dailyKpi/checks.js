/**
 * Consistency checks and the check → KPI status dependency map.
 * A failed check sets status='unreliable' on every KPI listed here.
 */

export const CHECK_DEPENDENCIES = {
  little: ['visit_min', 'minutes_per_customer_by_dept', 'people_mean'],
  visit_range: ['visit_min', 'people_mean'],
  phantom_share: ['quality', 'entrances', 'people_mean', 'people_max', 'presence_per_minute'],
  zero_observation: ['minutes_per_customer_by_dept', 'zero_observation_rois'],
  fixed_queue: ['queue_wait_min_per_entrance', 'queue_decomposition_per_lane', 'service_min_per_entrance'],
  stream_gap: ['quality', 'presence_per_minute', 'people_max', 'people_mean', 'entrances'],
};

export const DEFAULT_CHECK_THRESHOLDS = {
  little_max_rel_err: 0.01,
  visit_min_lo: 10,
  visit_min_hi: 60,
  phantom_share_lo: 0.10,
  phantom_share_hi: 0.35,
  fixed_queue_share_max: 0.05,
  max_gap_s: 60,
};

/** |sum(dept minutes including Corsie) − visit_min| / visit_min per slot. */
export function littleRelError(deptMinutes, visitMin) {
  if (visitMin == null || visitMin === 0) return null;
  const parts = Object.entries(deptMinutes || {})
    .filter(([k]) => k !== 'TOTALE (Little)')
    .reduce((s, [, v]) => s + (Number(v) || 0), 0);
  return Math.abs(parts - visitMin) / visitMin;
}

export function evaluateChecks(input, thresholds = DEFAULT_CHECK_THRESHOLDS) {
  const t = { ...DEFAULT_CHECK_THRESHOLDS, ...thresholds };
  const checks = [];

  let littleOk = true;
  const littleSlots = [];
  for (const [slot, depts] of Object.entries(input.minutesBySlot || {})) {
    const visit = (input.visitBySlot || {})[slot] ?? depts['TOTALE (Little)'];
    const err = littleRelError(depts, visit);
    if (err == null) continue;
    littleSlots.push({ slot, rel_err: err });
    if (err >= t.little_max_rel_err) littleOk = false;
  }
  checks.push({
    check_id: 'little',
    passed: littleOk,
    detail: JSON.stringify({ max_rel_err: t.little_max_rel_err, slots: littleSlots }),
  });

  const visitDay = input.visitMin;
  const visitOk = visitDay != null && visitDay >= t.visit_min_lo && visitDay <= t.visit_min_hi;
  checks.push({
    check_id: 'visit_range',
    passed: visitOk,
    detail: `visit_min=${visitDay} (allowed ${t.visit_min_lo}–${t.visit_min_hi})`,
  });

  const ph = input.phantomRowsPct;
  const phOk = ph != null && ph >= t.phantom_share_lo && ph <= t.phantom_share_hi;
  checks.push({
    check_id: 'phantom_share',
    passed: phOk,
    detail: `phantom_rows_pct=${ph} (allowed ${t.phantom_share_lo}–${t.phantom_share_hi})`,
  });

  const known = new Set(input.knownUncoveredRois || []);
  const zero = input.zeroObservationRois || [];
  const unexpected = zero.filter((z) => !known.has(z));
  checks.push({
    check_id: 'zero_observation',
    passed: unexpected.length === 0,
    detail: JSON.stringify({ zero, known: [...known], unexpected }),
  });

  const leftover = input.fixedLeftoverInKpi ?? 0;
  checks.push({
    check_id: 'fixed_queue',
    passed: leftover < t.fixed_queue_share_max,
    detail: JSON.stringify({
      raw_fixed_share: input.rawFixedShare ?? null,
      leftover_in_kpi: leftover,
      threshold: t.fixed_queue_share_max,
    }),
  });

  if (input.maxGapS == null && input.streamGapSkipped) {
    checks.push({
      check_id: 'stream_gap',
      passed: true,
      detail: `skipped (${t.max_gap_s}s threshold)`,
    });
  } else {
    const gap = input.maxGapS;
    checks.push({
      check_id: 'stream_gap',
      passed: gap != null && gap <= t.max_gap_s,
      detail: `max_gap_s=${gap} (allowed <= ${t.max_gap_s})`,
    });
  }

  return checks;
}

export function applyCheckStatus(kpis, checks) {
  const failed = new Set();
  const reasons = {};
  for (const c of checks) {
    if (c.passed) continue;
    for (const kid of CHECK_DEPENDENCIES[c.check_id] || []) {
      failed.add(kid);
      (reasons[kid] ||= []).push(c.check_id);
    }
  }
  return (kpis || []).map((row) => {
    if (!failed.has(row.kpi_id) || row.status !== 'ok') return { ...row };
    return {
      ...row,
      status: 'unreliable',
      status_reason: `check_failed:${reasons[row.kpi_id].join(',')}`,
    };
  });
}
