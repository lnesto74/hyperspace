import { DASHBOARD_TEMPLATES } from '../templates';
import { layoutNeedsDailyKpi, personasNeededForLayout } from '../sources';

describe('personasNeededForLayout', () => {
  it('Store Director v2 does not fetch the live Esselunga summary', () => {
    const tpl = DASHBOARD_TEMPLATES.find((t) => t.id === 'tpl-store-director');
    expect(personasNeededForLayout(tpl as never)).toEqual([]);
    expect(layoutNeedsDailyKpi(tpl as never)).toBe(true);
  });

  it('Ops day board needs Pulse + Executive, not Esselunga', () => {
    const tpl = DASHBOARD_TEMPLATES.find((t) => t.id === 'tpl-ops-day');
    const needed = personasNeededForLayout(tpl as never);
    expect(needed.sort()).toEqual(['executive', 'store-manager']);
  });

  it('empty board fetches nothing', () => {
    expect(personasNeededForLayout({ id: 'x', name: 'Blank', updatedAt: 0, items: [] })).toEqual([]);
  });
});
