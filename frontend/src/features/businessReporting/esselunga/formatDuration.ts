/**
 * Durations are shown to the second. Rounding to a tenth of a minute buckets
 * every zone into six-second steps, which makes genuinely different zones read
 * as identical and looks like sensor quantisation when it is only arithmetic.
 */
export function formatDwellDuration(avgDwellSec?: number, avgDwellMin?: number): string {
  const sec = avgDwellSec ?? Math.round((avgDwellMin ?? 0) * 60);
  if (sec <= 0) return '—';
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
