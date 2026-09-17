import { describe, it, expect } from 'vitest';
import { applyStaffRemoval, choiceIndex, choiceLabel, areasSumEqualsLittle } from '../services/dailyKpi/departmentAreas.js';
import { stepAlert, CounterAlertTracker, DEFAULT_COUNTER_ALERT } from '../services/dailyKpi/counterAlerts.js';
import { evaluateChecks, applyCheckStatus } from '../services/dailyKpi/checks.js';

describe('department areas staff removal and choice index', () => {
  it('subtracts staff from Corsie first, remainder from Scaffali', () => {
    const { table } = applyStaffRemoval(
      { Frutta: 100, 'Scaffali senza categoria': 200, 'Corsie / fuori zona': 80, 'Ingresso, casse, retro banchi': 40 },
      { Frutta: 40, 'Scaffali senza categoria': 80 },
      100,
      10,
    );
    expect(table['Corsie / fuori zona']).toBe(0);
    expect(table['Scaffali senza categoria'].area).toBe(18);
    expect(table['Scaffali senza categoria'].al_banco).toBe(7.2);
    expect(table.Frutta.area).toBe(10);
    expect(table.Frutta.al_banco).toBe(4);
    expect(table.TOTALE).toBe(32);
    expect(areasSumEqualsLittle(table, 32).passed).toBe(true);
  });

  it('labels choice_index as attraversato / intermedio / lavorato', () => {
    expect(choiceIndex(0.1, 1)).toBe(0.1);
    expect(choiceLabel(0.1)).toBe('reparto attraversato');
    expect(choiceLabel(0.3)).toBe('intermedio');
    expect(choiceLabel(0.48)).toBe('lavorato');
  });
});

describe('counter alert state machine', () => {
  const t0 = 1_000_000;

  it('fires after N people held for M minutes and clears after 1 minute below', () => {
    let st = { since: null, lastAbove: null, lastBelow: null, active: false, people: 0 };
    st = stepAlert(st, 3, t0, DEFAULT_COUNTER_ALERT);
    expect(st.active).toBe(false);
    st = stepAlert(st, 4, t0 + 2 * 60_000, DEFAULT_COUNTER_ALERT);
    expect(st.active).toBe(true);
    st = stepAlert(st, 1, t0 + 2 * 60_000 + 10_000, DEFAULT_COUNTER_ALERT);
    expect(st.active).toBe(true);
    st = stepAlert(st, 1, t0 + 3 * 60_000 + 10_000, DEFAULT_COUNTER_ALERT);
    expect(st.active).toBe(false);
  });

  it('tracks counters and checkout lanes independently', () => {
    let now = t0;
    const tracker = new CounterAlertTracker({ now: () => now });
    tracker.updateCounters('v', { Pesce: 4 });
    expect(tracker.active('v')).toHaveLength(0);
    now += 2 * 60_000;
    tracker.updateCounters('v', { Pesce: 4 });
    const alerts = tracker.active('v');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].type).toBe('counter_queue_alert');
    expect(alerts[0].counter).toBe('Pesce');
    now += 60_000;
    tracker.updateLanes('v', { 'Cassa 5': 4 });
    expect(tracker.active('v').some((a) => a.type === 'queue_wait')).toBe(false);
    now += 3 * 60_000;
    tracker.updateLanes('v', { 'Cassa 5': 5 });
    expect(tracker.active('v').some((a) => a.lane === 'Cassa 5')).toBe(true);
  });
});

describe('recon_gate', () => {
  it('marks per-person KPIs unreliable below the published gates', () => {
    const checks = evaluateChecks({
      minutesBySlot: { giorno: { Frutta: 1, 'Corsie / fuori zona': 1, 'TOTALE (Little)': 2 } },
      visitBySlot: { giorno: 2 },
      visitMin: 20,
      phantomRowsPct: 0.2,
      zeroObservationRois: ['Pane'],
      knownUncoveredRois: ['Pane', 'Salumi', 'Gastronomia'],
      fixedLeftoverInKpi: 0,
      streamGapSkipped: true,
      reconPrecision: 0.80,
      reconVendor: 0.40,
    });
    const byId = Object.fromEntries(checks.map((c) => [c.check_id, c.passed]));
    expect(byId.recon_gate).toBe(false);
    const stamped = applyCheckStatus([
      { kpi_id: 'dept_stay_per_person', slot: 'giorno', status: 'ok', value: 1 },
      { kpi_id: 'entrances', slot: 'giorno', status: 'ok', value: 10 },
    ], checks);
    expect(stamped.find((k) => k.kpi_id === 'dept_stay_per_person').status).toBe('unreliable');
    expect(stamped.find((k) => k.kpi_id === 'entrances').status).toBe('ok');
  });
});

describe('synthetic adjacency hops', () => {
  it('counts only consecutive ≥3 s stays on different areas', () => {
    const journeys = [
      [{ dept: 'Frutta', s: 8 }, { dept: 'Verdura', s: 6 }, { dept: 'Latticini', s: 2 }],
      [{ dept: 'Carne', s: 11 }, { dept: 'Pesce', s: 9 }],
      [{ dept: 'Frutta', s: 4 }],
    ];
    const counts = {};
    let n = 0;
    for (const stays of journeys) {
      const kept = stays.filter((s) => s.s >= 3);
      for (let i = 1; i < kept.length; i++) {
        if (kept[i].dept === kept[i - 1].dept) continue;
        const key = `${kept[i - 1].dept}>${kept[i].dept}`;
        counts[key] = (counts[key] || 0) + 1;
        n += 1;
      }
    }
    expect(n).toBe(2);
    expect(counts['Frutta>Verdura']).toBe(1);
    expect(counts['Carne>Pesce']).toBe(1);
    expect(counts['Verdura>Latticini']).toBeUndefined();
  });
});
