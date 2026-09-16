import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(
  __dirname,
  '../../frontend/src/features/businessReporting/esselunga/clienteMedio/fixtures/daily_kpi_2026-09-14.json',
);

const fmt = (v, d = 1) => v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const fint = (v) => Math.round(v).toLocaleString('it-IT');

describe('cliente medio tiles from the 2026-09-14 daily_kpi fixture', () => {
  const payload = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const pick = (id, slot = 'giorno') => payload.kpis.find((k) => k.kpi_id === id && k.slot === slot);

  it('has the six headline scalars the canvas shows', () => {
    expect(pick('entrances').value).toBe(2177);
    expect(pick('visit_min').value).toBeCloseTo(23.5, 1);
    expect(pick('people_mean').value).toBeCloseTo(71, 0);
    expect(pick('people_max').value).toBe(117);
    expect(pick('queue_wait_min_per_entrance').value).toBeCloseTo(0.59, 2);
    expect(pick('queue_wait_min_per_entrance', '18-20').value).toBeCloseTo(0.90, 2);
    expect(pick('checkout_passages').value).toBe(2292);
    expect(pick('minutes_per_customer_by_dept', 'giorno|Verdura').value).toBeCloseTo(0.60, 2);
    expect(pick('minutes_per_customer_by_dept', 'giorno|Corsie / fuori zona').value).toBeCloseTo(15.97, 2);
    expect(pick('first_department_after_entrance').payload[0].dst).toBe('Frutta');
    expect(pick('first_department_after_entrance').value).toBeGreaterThanOrEqual(0.90);
    expect(new Set(pick('zero_observation_rois').payload)).toEqual(new Set(['Pane', 'Salumi', 'Gastronomia']));
  });

  it('formats those scalars the way the page prints them', () => {
    expect(fint(pick('entrances').value)).toBe('2.177');
    expect(fmt(pick('visit_min').value, 1)).toBe('23,5');
    expect(fint(pick('people_mean').value)).toBe('71');
    expect(fmt(pick('queue_wait_min_per_entrance').value, 1)).toBe('0,6');
    expect(fint(pick('checkout_passages').value)).toBe('2.292');
    const corsie = pick('minutes_per_customer_by_dept', 'giorno|Corsie / fuori zona').value;
    const visit = pick('visit_min').value;
    expect(fmt(100 * corsie / visit, 0)).toMatch(/6[78]/);
  });

  it('keeps behaviour payload for the stacked cards', () => {
    const beh = pick('behaviour_share');
    expect(beh.status).toBe('ok');
    expect(beh.payload.segments).toBe(43699);
    expect(Array.isArray(beh.payload.cluster_profiles)).toBe(true);
  });
});
