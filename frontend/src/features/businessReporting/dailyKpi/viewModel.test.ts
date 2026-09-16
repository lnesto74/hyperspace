import { describe, expect, it } from 'vitest';
import type { DailyKpiPayload } from './types';
import { buildHeadline, buildHeadlineKpis, buildInsights, departmentMinutes, pickKpi } from './viewModel';

function row(kpi_id: string, slot: string, value: number | null, extra: Partial<DailyKpiPayload['kpis'][0]> = {}) {
  return {
    kpi_id, slot, value, unit: 'min', label: 'ESTIMATED' as const, method: 'test',
    status: 'ok' as const, status_reason: null, ...extra,
  };
}

const payload: DailyKpiPayload = {
  venue_id: '55fdd53b-3298-4355-97c0-b4e789b11d06',
  day: '2026-09-14',
  kpis: [
    row('entrances', 'giorno', 2177, { unit: 'count', label: 'MEASURED' }),
    row('visit_min', 'giorno', 23.5),
    row('people_mean', 'giorno', 71, { unit: 'people', label: 'MEASURED' }),
    row('people_max', 'giorno', 117, { unit: 'people', label: 'MEASURED' }),
    row('queue_wait_min_per_entrance', 'giorno', 0.59),
    row('queue_wait_min_per_entrance', '18-20', 0.9),
    row('minutes_per_customer_by_dept', 'giorno', 23.5, {
      payload: { Frutta: 0.53, Verdura: 0.6, Pane: 0, 'Corsie / fuori zona': 15.97 },
    }),
    row('zero_observation_rois', 'giorno', 3, { label: 'MEASURED', payload: ['Pane', 'Salumi', 'Gastronomia'] }),
  ],
  checks: [{ check_id: 'little', passed: true, detail: 'ok' }],
};

describe('daily kpi view model', () => {
  it('builds four headline tiles with MEASURED/ESTIMATED chips and no week delta', () => {
    const kpis = buildHeadlineKpis(payload);
    expect(kpis).toHaveLength(4);
    expect(kpis[0].display).toBe('2.177');
    expect(kpis[0].measureLabel).toBe('MEASURED');
    expect(kpis[0].deltaPct).toBeNull();
    expect(kpis[0].noCompareReason).toMatch(/7 giorni/);
    expect(kpis[1].measureLabel).toBe('ESTIMATED');
    expect(kpis[2].display).toContain('max');
  });

  it('marks tone bad when a slot wait exceeds 1.5 min', () => {
    const hot = {
      ...payload,
      kpis: [...payload.kpis, row('queue_wait_min_per_entrance', '12-14', 1.8)],
    };
    expect(buildHeadline(hot).tone).toBe('bad');
  });

  it('surfaces zero-observation and high-queue insights', () => {
    const cards = buildInsights(payload);
    expect(cards.some((c) => c.id === 'zero-roi')).toBe(true);
    expect(cards.find((c) => c.id === 'zero-roi')?.message).toMatch(/Pane/);
  });

  it('renders Pane as nessuna osservazione instead of a number', () => {
    const rows = departmentMinutes(payload);
    const pane = rows.find((r) => r.dept === 'Pane');
    expect(pane?.zeroObservation).toBe(true);
    expect(pane?.minutes).toBeNull();
    expect(pickKpi(payload, 'entrances')?.value).toBe(2177);
  });
});
