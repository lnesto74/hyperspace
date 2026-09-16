import { ensureDailyKpiTables } from './schema.js';

const HEADLINE_SCALARS = [
  'entrances',
  'visit_min',
  'people_mean',
  'people_max',
  'queue_wait_min_per_entrance',
  'service_min_per_entrance',
];

export function persistDailyKpi(db, payload) {
  ensureDailyKpiTables(db);
  const now = Date.now();
  const { venue_id: venueId, day } = payload;
  const upsertKpi = db.prepare(`
    INSERT INTO daily_kpi (
      venue_id, day, kpi_id, slot, value, unit, label, method, status, status_reason, payload_json, computed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(venue_id, day, kpi_id, slot) DO UPDATE SET
      value=excluded.value,
      unit=excluded.unit,
      label=excluded.label,
      method=excluded.method,
      status=excluded.status,
      status_reason=excluded.status_reason,
      payload_json=excluded.payload_json,
      computed_at=excluded.computed_at
  `);
  const upsertCheck = db.prepare(`
    INSERT INTO daily_kpi_checks (venue_id, day, check_id, passed, detail)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(venue_id, day, check_id) DO UPDATE SET
      passed=excluded.passed,
      detail=excluded.detail
  `);
  const wipeKpis = db.prepare('DELETE FROM daily_kpi WHERE venue_id = ? AND day = ?');
  const wipeChecks = db.prepare('DELETE FROM daily_kpi_checks WHERE venue_id = ? AND day = ?');

  const tx = db.transaction(() => {
    wipeKpis.run(venueId, day);
    wipeChecks.run(venueId, day);
    for (const row of payload.kpis || []) {
      upsertKpi.run(
        venueId,
        day,
        row.kpi_id,
        row.slot,
        row.value ?? null,
        row.unit ?? null,
        row.label,
        row.method ?? null,
        row.status,
        row.status_reason ?? null,
        row.payload != null ? JSON.stringify(row.payload) : null,
        now,
      );
    }
    upsertKpi.run(
      venueId, day, '_bundle', 'giorno', null, 'json', 'MEASURED',
      'full daily_kpi payload', 'ok', null, JSON.stringify(payload), now,
    );
    for (const c of payload.checks || []) {
      upsertCheck.run(venueId, day, c.check_id, c.passed ? 1 : 0, c.detail ?? null);
    }
  });
  tx();
  return { venueId, day, kpis: (payload.kpis || []).length, checks: (payload.checks || []).length };
}

export function loadDailyKpi(db, venueId, day) {
  ensureDailyKpiTables(db);
  const bundle = db.prepare(
    "SELECT payload_json FROM daily_kpi WHERE venue_id = ? AND day = ? AND kpi_id = '_bundle' AND slot = 'giorno'",
  ).get(venueId, day);
  if (bundle?.payload_json) {
    try {
      return JSON.parse(bundle.payload_json);
    } catch {
      // fall through and rebuild
    }
  }
  const kpis = db.prepare(
    "SELECT kpi_id, slot, value, unit, label, method, status, status_reason, payload_json FROM daily_kpi WHERE venue_id = ? AND day = ? AND kpi_id != '_bundle'",
  ).all(venueId, day);
  const checks = db.prepare(
    'SELECT check_id, passed, detail FROM daily_kpi_checks WHERE venue_id = ? AND day = ?',
  ).all(venueId, day);
  if (!kpis.length && !checks.length) return null;
  return {
    venue_id: venueId,
    day,
    kpis: kpis.map((r) => ({
      kpi_id: r.kpi_id,
      slot: r.slot,
      value: r.value,
      unit: r.unit,
      label: r.label,
      method: r.method,
      status: r.status,
      status_reason: r.status_reason,
      payload: r.payload_json ? JSON.parse(r.payload_json) : null,
    })),
    checks: checks.map((c) => ({
      check_id: c.check_id,
      passed: Boolean(c.passed),
      detail: c.detail,
    })),
  };
}

export function loadDailyKpiRange(db, venueId, fromDay, toDay) {
  ensureDailyKpiTables(db);
  const rows = db.prepare(`
    SELECT day, kpi_id, value, unit, label, status, status_reason
    FROM daily_kpi
    WHERE venue_id = ?
      AND day >= ?
      AND day <= ?
      AND slot = 'giorno'
      AND kpi_id IN (${HEADLINE_SCALARS.map(() => '?').join(',')})
    ORDER BY day, kpi_id
  `).all(venueId, fromDay, toDay, ...HEADLINE_SCALARS);

  const byDay = new Map();
  for (const r of rows) {
    const rec = byDay.get(r.day) || { day: r.day, venue_id: venueId };
    rec[r.kpi_id] = {
      value: r.value,
      unit: r.unit,
      label: r.label,
      status: r.status,
      status_reason: r.status_reason,
    };
    byDay.set(r.day, rec);
  }
  return [...byDay.values()];
}
