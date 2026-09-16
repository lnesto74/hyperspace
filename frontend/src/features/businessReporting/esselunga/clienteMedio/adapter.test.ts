// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { DailyKpiPayload } from '../../dailyKpi/types';
import fixture from './fixtures/daily_kpi_2026-09-14.json';
import { KPI_EPOCH, buildClienteMedioView, enumerateDays, yesterdayRome } from './adapter';

const payload = fixture as unknown as DailyKpiPayload;

describe('cliente medio adapter 2026-09-14', () => {
  const view = buildClienteMedioView(payload);

  it('formats the six headline tiles to the canvas numbers', () => {
    const byId = Object.fromEntries(view.tiles.map((t) => [t.id, t]));
    expect(byId.entrances.value).toBe('2.177');
    expect(byId.visit_min.value).toBe('23,5');
    expect(byId.visit_min.unit).toBe('min');
    expect(byId.people_mean.value).toBe('71');
    expect(byId.people_mean.note).toMatch(/117/);
    expect(byId.queue_wait.value).toBe('0,6');
    expect(byId.queue_wait.note).toMatch(/18[-–]20/);
    expect(byId.queue_wait.note).toMatch(/0,90/);
    expect(byId.checkout_passages.value).toBe('2.292');
    expect(Number(byId.aisle_share.value.replace(',', '.'))).toBeGreaterThanOrEqual(67);
  });

  it('keeps Verdura / Corsie / Frutta first-department and the zero callout', () => {
    expect(view.minutes.Verdura.giorno).toBeCloseTo(0.60, 2);
    expect(view.minutes['Corsie / fuori zona'].giorno).toBeCloseTo(15.97, 2);
    expect(view.firstAfter[0].dept).toBe('Frutta');
    const tot = view.firstAfter.reduce((a, b) => a + b.n, 0);
    expect(view.firstAfter[0].n / tot).toBeGreaterThanOrEqual(0.90);
    expect(new Set(view.zeroDepts)).toEqual(new Set(['Pane', 'Salumi', 'Gastronomia']));
  });

  it('replaces track-life and link-count quality tiles with checks and clean share', () => {
    const labels = view.qualityTiles.map((t) => t.label);
    expect(labels.some((l) => /vita media|ricuciture/i.test(l))).toBe(false);
    expect(labels).toContain('controlli del giorno superati');
    expect(labels).toContain('quota osservazioni pulite');
    expect(view.qualityTiles.find((t) => t.id === 'checks')?.value).toMatch(/\/6$/);
  });

  it('does not invent a visit duration when the row is unreliable', () => {
    const broken: DailyKpiPayload = {
      ...payload,
      kpis: payload.kpis.map((k) => (
        k.kpi_id === 'visit_min' && k.slot === 'giorno'
          ? { ...k, status: 'unreliable', status_reason: 'check_failed:visit_range', value: 23.5 }
          : k
      )),
    };
    const tiles = buildClienteMedioView(broken).tiles;
    expect(tiles.find((t) => t.id === 'visit_min')?.value).toBe('—');
    expect(tiles.find((t) => t.id === 'visit_min')?.tip).toMatch(/visit_range/);
  });

  it('lists every calendar day from the KPI epoch', () => {
    expect(KPI_EPOCH).toBe('2026-09-14');
    expect(enumerateDays(KPI_EPOCH, '2026-09-16')).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
    ]);
    const noon = new Date('2026-09-16T12:00:00+02:00');
    expect(yesterdayRome(noon)).toBe('2026-09-15');
  });
});
