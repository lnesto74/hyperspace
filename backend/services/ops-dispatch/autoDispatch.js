/**
 * Server-side auto-dispatch — turns the top Profit Radar insight into a Telegram
 * task without requiring Pulse to be open.
 */

import { roleForInsightType } from './OpsDispatchConfig.js';
import { recoveryForLever, LEVER_BY_ID } from '../profit-radar/recoveryModel.js';
import { dayKey, todayKey, DEFAULT_TZ } from './valueLedger.js';

function rankInsights(insights) {
  return [...insights].sort((a, b) => {
    const scoreA = (a.impact?.max || 0) * (a.confidence || 0);
    const scoreB = (b.impact?.max || 0) * (b.confidence || 0);
    return scoreB - scoreA;
  });
}

function insightWeeklyEur(insight) {
  const econ = insight.economics;
  if (econ?.range?.expected != null) {
    const days = econ.tradingDaysPerWeek || 7;
    return Math.max(0, Number(econ.range.expected) * days);
  }
  if (econ) {
    try {
      const r = recoveryForLever(
        {
          exposedPerDay: econ.exposedPerDay,
          engagement: econ.engagement,
          conversionRate: econ.conversionRate,
          benchmark: econ.benchmark,
          winnable: econ.winnable,
          marginPerUnit: econ.marginPerUnit,
          baseAttachRate: econ.baseAttachRate ?? 1,
          axes: econ.axes || {},
          commitment: econ.commitment,
          tradingDaysPerWeek: econ.tradingDaysPerWeek || 7,
          isQueue: !!econ.isQueue,
        },
        econ.recommendedLeverId || 'layout',
        0.6,
        'expected',
      );
      return r.perWeek || 0;
    } catch { /* fall through */ }
  }
  const imp = insight.impact || {};
  return (((Number(imp.min) || 0) + (Number(imp.max) || 0)) / 2) * 7;
}

function roleForInsight(insight) {
  const leverId = insight.economics?.recommendedLeverId || 'layout';
  const lever = LEVER_BY_ID[leverId];
  if (lever?.role) return lever.role;
  return roleForInsightType(insight.type);
}

export function buildDispatchFromInsight(insight) {
  const roiId = insight.dataBasis?.roiId || null;
  const role = roleForInsight(insight);
  const leverId = insight.economics?.recommendedLeverId || 'layout';
  const lever = LEVER_BY_ID[leverId];
  const weekEur = insightWeeklyEur(insight);

  return {
    role,
    kind: role === 'cashier' ? 'checkout' : 'merchandising',
    title: insight.title,
    body: insight.suggestedFix,
    payload: {
      type: insight.type,
      zoneName: insight.dataBasis?.zone || insight.title,
      roiId,
      suggestedFix: insight.suggestedFix,
      impact: insight.impact,
      lever: lever ? { id: lever.id, label: lever.label } : undefined,
      projectedPerWeek: weekEur > 0 ? weekEur : undefined,
      insightId: insight.id,
    },
  };
}

export function wasDispatchedToday(store, venueId, insightId, tz = DEFAULT_TZ) {
  if (!insightId) return false;
  const today = todayKey(tz);
  const tasks = store.listTasks(venueId, 200);
  return tasks.some(
    (t) => t.insightId === insightId
      && t.status !== 'open'
      && dayKey(t.createdAt, tz) === today,
  );
}

export function pickInsightToDispatch(insights, store, venueId, tz = DEFAULT_TZ) {
  const ranked = rankInsights(insights || []);
  for (const ins of ranked) {
    if (!wasDispatchedToday(store, venueId, ins.id, tz)) return ins;
  }
  return null;
}
