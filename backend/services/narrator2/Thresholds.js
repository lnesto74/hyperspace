/**
 * Threshold Evaluation for ViewPack KPIs
 * 
 * Determines green/amber/red status based on KPI definitions.
 */

/**
 * Evaluate KPI status based on thresholds
 * @param {number|null} value - KPI value
 * @param {Object} [thresholds] - Threshold configuration
 * @param {number} [thresholds.green] - Green threshold
 * @param {number} [thresholds.amber] - Amber threshold
 * @param {'lower'|'higher'|'range'} [thresholds.direction] - Direction for good values
 * @returns {'green'|'amber'|'red'|'na'}
 */
export function evaluateStatus(value, thresholds) {
  if (value === null || value === undefined || !thresholds) {
    return 'na';
  }

  const { green, amber, direction } = thresholds;

  if (green === undefined || amber === undefined) {
    return 'na';
  }

  switch (direction) {
    case 'lower':
      // Lower is better (e.g., wait time, abandon rate)
      if (value <= green) return 'green';
      if (value <= amber) return 'amber';
      return 'red';

    case 'higher':
      // Higher is better (e.g., visitors, engagement rate)
      if (value >= green) return 'green';
      if (value >= amber) return 'amber';
      return 'red';

    case 'range':
      // Value should be within a range (green is target, amber is acceptable)
      const distFromGreen = Math.abs(value - green);
      const distFromAmber = Math.abs(value - amber);
      if (distFromGreen <= (Math.abs(amber - green) * 0.3)) return 'green';
      if (distFromGreen <= Math.abs(amber - green)) return 'amber';
      return 'red';

    default:
      return 'na';
  }
}

/**
 * Get status color CSS class
 * @param {'green'|'amber'|'red'|'na'} status
 * @returns {string}
 */
export function getStatusColor(status) {
  switch (status) {
    case 'green': return '#22c55e';
    case 'amber': return '#f59e0b';
    case 'red': return '#ef4444';
    default: return '#6b7280';
  }
}

/**
 * Get worst status from a list of KPIs
 * @param {Array<{status?: string}>} kpis
 * @returns {'green'|'amber'|'red'|'na'}
 */
export function getWorstStatus(kpis) {
  const statusPriority = { red: 3, amber: 2, green: 1, na: 0 };
  let worst = 'na';
  let worstPriority = 0;

  for (const kpi of kpis) {
    const status = kpi.status || 'na';
    const priority = statusPriority[status] || 0;
    if (priority > worstPriority) {
      worst = status;
      worstPriority = priority;
    }
  }

  return worst;
}

/**
 * Find the worst performing KPI
 * @param {Array<{id: string, status?: string, value?: number|null}>} kpis
 * @returns {{id: string, status: string, value: number|null}|null}
 */
export function findWorstKpi(kpis) {
  const statusPriority = { red: 3, amber: 2, green: 1, na: 0 };
  let worst = null;
  let worstPriority = 0;

  for (const kpi of kpis) {
    const status = kpi.status || 'na';
    const priority = statusPriority[status] || 0;
    if (priority > worstPriority) {
      worst = kpi;
      worstPriority = priority;
    }
  }

  return worst;
}

/**
 * Count KPIs by status
 * @param {Array<{status?: string}>} kpis
 * @returns {Record<string, number>}
 */
export function countByStatus(kpis) {
  const counts = { green: 0, amber: 0, red: 0, na: 0 };
  for (const kpi of kpis) {
    const status = kpi.status || 'na';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

export default {
  evaluateStatus,
  getStatusColor,
  getWorstStatus,
  findWorstKpi,
  countByStatus,
};
