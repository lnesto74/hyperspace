import { describe, expect, it } from 'vitest';
import { dailyKpiHeadlineUnreliable } from '../services/dailyKpi/renderDailyKpiPdf.js';

function payload(overrides = {}) {
  return {
    day: '2026-09-14',
    kpis: [
      { kpi_id: 'entrances', slot: 'giorno', value: 2177, status: 'ok', label: 'MEASURED' },
      { kpi_id: 'visit_min', slot: 'giorno', value: 23.5, status: 'ok', label: 'ESTIMATED' },
      { kpi_id: 'people_mean', slot: 'giorno', value: 71, status: 'ok', label: 'MEASURED' },
      { kpi_id: 'queue_wait_min_per_entrance', slot: 'giorno', value: 0.59, status: 'ok', label: 'ESTIMATED' },
    ],
    ...overrides,
  };
}

describe('dailyKpiHeadlineUnreliable', () => {
  it('passes when headline tiles are ok', () => {
    expect(dailyKpiHeadlineUnreliable(payload())).toBe(false);
  });

  it('fails when a headline tile is unreliable', () => {
    const p = payload();
    p.kpis[1].status = 'unreliable';
    expect(dailyKpiHeadlineUnreliable(p)).toBe(true);
  });
});
