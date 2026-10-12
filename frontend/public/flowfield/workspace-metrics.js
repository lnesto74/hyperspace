/** Aggregate raw cells, never the display blur. Track counts are not additive. */
export function summariseCells(cells, bins = 8) {
  const rose = Array(bins).fill(0);
  let dwell = 0, presence = 0, weight = 0, speed = 0, supported = 0;
  let hasPresence = cells.length > 0;
  for (const c of cells) {
    const w = Math.max(0, Number(c.k) || 0);
    dwell += Math.max(0, Number(c.d) || 0);
    hasPresence &&= Number.isFinite(c.e);
    presence += Math.max(0, Number(c.e) || 0);
    weight += w;
    speed += (Number(c.s) || 0) * w;
    if (w > 0 || c.d > 0 || c.e > 0) supported++;
    for (let b = 0; b < bins; b++) rose[b] += (Number(c.r?.[b]) || 0) * w;
  }
  const totalRose = rose.reduce((a, b) => a + b, 0);
  return { dwell, presence: hasPresence ? presence : null, supported,
    speed: weight ? speed / weight : null,
    slowShare: hasPresence && presence > 0 ? dwell / presence : null,
    rose: rose.map(v => totalRose ? v / totalRose : 0), weight };
}
