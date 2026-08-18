import { DASHBOARD_TEMPLATES } from '../templates';
import { personasNeededForLayout } from '../sources';

describe('personasNeededForLayout', () => {
  it('Store Director only needs the Esselunga journey', () => {
    const tpl = DASHBOARD_TEMPLATES.find((t) => t.id === 'tpl-store-director');
    expect(personasNeededForLayout(tpl as never)).toEqual(['esselunga-executive']);
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
