import { KpiFormat, KpiThresholds } from '../personas';

export function formatKpiValue(value: number | null | undefined, format: KpiFormat): string {
  if (value === null || value === undefined) return '—';
  switch (format) {
    case 'percent': return `${value.toFixed(1)}%`;
    case 'seconds': return `${Math.round(value)}s`;
    case 'minutes': return `${value.toFixed(1)}m`;
    case 'int': return Math.round(value).toLocaleString();
    case 'float': return value.toFixed(1);
    case 'score': return value.toFixed(1);
    case 'currency': return `$${value.toFixed(2)}`;
    default: return String(value);
  }
}

export function getThresholdState(
  value: number | null | undefined,
  thresholds?: KpiThresholds,
): 'good' | 'warn' | 'bad' | 'neutral' {
  if (value === null || value === undefined || !thresholds) return 'neutral';
  const { good, warn, direction } = thresholds;
  if (direction === 'lower') {
    if (value <= good) return 'good';
    if (value <= warn) return 'warn';
    return 'bad';
  }
  if (value >= good) return 'good';
  if (value >= warn) return 'warn';
  return 'bad';
}

export const STATE_TEXT: Record<string, string> = {
  good: 'text-green-400',
  warn: 'text-white',
  bad: 'text-red-400',
  neutral: 'text-white',
};

export const STATE_BG: Record<string, string> = {
  good: 'border-green-500/20 bg-green-500/5',
  warn: 'border-gray-700/80 bg-gray-800/60',
  bad: 'border-red-500/20 bg-red-500/5',
  neutral: 'border-gray-700/80 bg-gray-800/60',
};
