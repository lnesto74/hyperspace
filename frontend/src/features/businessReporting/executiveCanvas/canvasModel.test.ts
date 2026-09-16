import { describe, expect, it } from 'vitest';
import type { DailyKpiPayload } from '../dailyKpi/types';
import { buildExecutiveCanvas } from './canvasModel';

function row(kpi_id: string, slot: string, value: number | null, extra: Record<string, unknown> = {}) {
  return {
    kpi_id, slot, value, unit: 'min', label: 'ESTIMATED' as const, method: 'test',
    status: 'ok' as const, status_reason: null, payload: null, ...extra,
  };
}

const payload = {
  venue_id: 'v',
  day: '2026-09-14',
  kpis: [
    row('entrances', 'giorno', 2177, { unit: 'count', label: 'MEASURED' }),
    row('entrances', '18-20', 410, { unit: 'count', label: 'MEASURED' }),
    row('entrances', '10-12', 424, { unit: 'count', label: 'MEASURED' }),
    row('visit_min', 'giorno', 23.5),
    row('people_mean', 'giorno', 71, { unit: 'people', label: 'MEASURED' }),
    row('queue_wait_min_per_entrance', 'giorno', 0.59),
    row('queue_wait_min_per_entrance', '18-20', 0.9),
    row('service_min_per_entrance', 'giorno', 0.36),
    row('minutes_per_customer_by_dept', 'giorno', 23.5, {
      payload: {
        Frutta: 0.58, Verdura: 0.6, 'Corsie / fuori zona': 15.97,
        'Coda cassa': 0.71, 'Cassa (servizio)': 0.37, Surgelati: 0.57,
      },
    }),
    row('first_department_after_entrance', 'giorno', 0.91, {
      payload: [{ dst: 'Frutta', n: 910, share: 0.91 }],
    }),
    row('queue_decomposition_per_lane', 'giorno', null, {
      payload: [
        { lane: 5, roi_group: 'CHECKOUT_QUEUE', WAITING: 12 },
        { lane: 7, roi_group: 'CHECKOUT_QUEUE', WAITING: 9 },
        { lane: 13, roi_group: 'CHECKOUT_QUEUE', WAITING: 8 },
      ],
    }),
    row('zero_observation_rois', 'giorno', 3, { label: 'MEASURED', payload: ['Pane', 'Salumi', 'Gastronomia'] }),
  ],
  checks: [],
} as unknown as DailyKpiPayload;

describe('executive canvas model', () => {
  const model = buildExecutiveCanvas(payload, [], 'Treviglio');

  it('keeps the four pulse numbers from daily_kpi', () => {
    expect(model.pulse.map((p) => p.display)).toEqual(['2.177', '23,5', '71', '0,59']);
    expect(model.pulse.every((p) => p.deltaPct == null)).toBe(true);
  });

  it('does not invent a comparison or a fake confidence score', () => {
    expect(model.dayLabel).toBe('14 September 2026');
    expect(model.journey[0].primary).toBe('2.177');
    expect(model.journey[1].primary).toBe('91%');
    expect(model.journey[1].secondary).toMatch(/Frutta/);
  });

  it('groups minutes without using zero-observation departments', () => {
    const byId = Object.fromEntries(model.allocation.map((b) => [b.id, b.minutes]));
    expect(byId.aisles).toBeCloseTo(15.97, 2);
    expect(byId.fresh).toBeCloseTo(1.18, 2);
    expect(byId.checkout).toBeCloseTo(1.08, 2);
    expect(byId.other).toBeCloseTo(0.57, 2);
    expect(model.allocation.some((b) => b.label === 'Pane')).toBe(false);
  });

  it('builds at most three signals from measured facts', () => {
    expect(model.signals.length).toBeLessThanOrEqual(3);
    expect(model.signals[0].body).toMatch(/91%/);
    expect(model.checkout.busiest).toEqual(['#5', '#7', '#13']);
    expect(model.checkout.healthy).toBe(true);
    expect(model.checkout.peakSlot).toBe('18-20');
    expect(model.peakSlot).toBe('10-12');
  });
});
