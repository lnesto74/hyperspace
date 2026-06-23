/**
 * Executive value ledger — daily and cumulative € from ops-dispatch tasks.
 * Uses projectedPerWeek when stored at dispatch time, else impact band × 7.
 */

const DEFAULT_TZ = 'Europe/Rome';

function dayKey(iso, tz = DEFAULT_TZ) {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function todayKey(tz = DEFAULT_TZ) {
  return dayKey(new Date().toISOString(), tz);
}

export function taskProjectedWeekly(task) {
  const p = task.payload || {};
  const direct = Number(p.projectedPerWeek);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const imp = p.impact;
  if (imp) {
    const mid = ((Number(imp.min) || 0) + (Number(imp.max) || 0)) / 2;
    return mid * 7;
  }
  return 0;
}

export function taskProjectedDaily(task) {
  return taskProjectedWeekly(task) / 7;
}

/** € credited when a task is verified with a positive outcome. */
export function taskAchievedWeekly(task) {
  if (task.status !== 'verified') return 0;
  if (task.verification?.verdict !== 'improved') return 0;
  return taskProjectedWeekly(task);
}

export function taskAchievedDaily(task) {
  return taskAchievedWeekly(task) / 7;
}

function taskCurrency(task) {
  const c = task.payload?.impact?.currency;
  if (c === 'EUR') return '€';
  return c || '€';
}

function isDispatched(task) {
  return task.status !== 'open';
}

function isInPipeline(task) {
  return isDispatched(task) && task.status !== 'verified';
}

/**
 * @param {import('./OpsStore.js').OpsStore} store
 * @param {string} venueId
 * @param {{ liveUnveiledDaily?: number, timezone?: string }} opts
 */
export function buildValueLedger(store, venueId, opts = {}) {
  const tz = opts.timezone || DEFAULT_TZ;
  const today = todayKey(tz);
  const tasks = store.listTasks(venueId, 500);
  let currency = '€';

  let dispatchedToday = 0;
  let verifiedToday = 0;
  let pipelineToday = 0;
  let dispatchedCountToday = 0;
  let verifiedCountToday = 0;
  let pipelineCountToday = 0;

  let cumulativeDispatchedDaily = 0;
  let cumulativeVerifiedDaily = 0;
  let cumulativeDispatchedWeekly = 0;
  let cumulativeVerifiedWeekly = 0;

  const insightIdsDispatchedToday = new Set();

  for (const task of tasks) {
    currency = taskCurrency(task) || currency;
    const daily = taskProjectedDaily(task);
    const achievedDaily = taskAchievedDaily(task);
    const weekly = taskProjectedWeekly(task);
    const achievedWeekly = taskAchievedWeekly(task);
    const createdToday = dayKey(task.createdAt, tz) === today;
    const verifiedTodayFlag = dayKey(task.verifiedAt, tz) === today;

    if (isDispatched(task)) {
      cumulativeDispatchedDaily += daily;
      cumulativeDispatchedWeekly += weekly;
    }
    if (achievedDaily > 0) {
      cumulativeVerifiedDaily += achievedDaily;
      cumulativeVerifiedWeekly += achievedWeekly;
    }

    if (createdToday && isDispatched(task)) {
      dispatchedToday += daily;
      dispatchedCountToday += 1;
      if (task.insightId) insightIdsDispatchedToday.add(task.insightId);
      if (isInPipeline(task)) {
        pipelineToday += daily;
        pipelineCountToday += 1;
      }
    }
    if (verifiedTodayFlag && achievedDaily > 0) {
      verifiedToday += achievedDaily;
      verifiedCountToday += 1;
    }
  }

  const liveUnveiled = Number(opts.liveUnveiledDaily);
  const discoveredLive = Number.isFinite(liveUnveiled) && liveUnveiled >= 0 ? liveUnveiled : null;

  return {
    currency,
    timezone: tz,
    date: today,
    today: {
      discoveredLive,
      dispatchedDaily: Math.round(dispatchedToday),
      verifiedDaily: Math.round(verifiedToday),
      pipelineDaily: Math.round(pipelineToday),
      cumulativeDaily: Math.round(dispatchedToday + verifiedToday),
      counts: {
        dispatched: dispatchedCountToday,
        verified: verifiedCountToday,
        pipeline: pipelineCountToday,
        insightsDispatched: insightIdsDispatchedToday.size,
      },
    },
    cumulative: {
      dispatchedDaily: Math.round(cumulativeDispatchedDaily),
      verifiedDaily: Math.round(cumulativeVerifiedDaily),
      dispatchedWeekly: Math.round(cumulativeDispatchedWeekly),
      verifiedWeekly: Math.round(cumulativeVerifiedWeekly),
    },
  };
}

export { dayKey, todayKey, DEFAULT_TZ };
