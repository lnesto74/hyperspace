/** Build readable Y-axis tick values for bar charts (max → 0). */
export function buildYAxisTicks(maxVal: number): number[] {
  const max = Math.max(1, Math.ceil(maxVal));
  if (max <= 3) return [max, 0];

  const roughStep = max / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const step = Math.max(1, Math.ceil(roughStep / magnitude) * magnitude);
  const top = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let v = top; v >= 0; v -= step) ticks.push(v);
  if (ticks[ticks.length - 1] !== 0) ticks.push(0);
  return ticks;
}
