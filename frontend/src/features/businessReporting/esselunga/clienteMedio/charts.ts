/** Canvas chart helpers from treviglio_kpi.html — SVG strings, viewBox 520-wide. */

export function fmt(v: number, d = 1): string {
  return v.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fint(v: number): string {
  return Math.round(v).toLocaleString('it-IT');
}

export function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

export function niceMax(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return n * p;
}

export type BarItem = { l: string; v: number };

export type SeriesDef = { key: string; label: string };

export function table(head: string[], rows: string[][]): string {
  return `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c, i) => `<td>${i ? c : esc(c)}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
}

export function columns(
  items: BarItem[],
  { unit = '', dec = 0, color = 'var(--seq-5)', h = 240, tipf }: {
    unit?: string; dec?: number; color?: string; h?: number; tipf?: (it: BarItem) => string;
  } = {},
): string {
  const W = 520, L = 36, R = 12, T = 28, B = 34, n = items.length;
  const iw = (W - L - R) / Math.max(n, 1);
  const bw = Math.min(52, iw * 0.62);
  const max = niceMax(Math.max(0, ...items.map((i) => i.v)) * 1.08);
  const y = (v: number) => T + (h - T - B) * (1 - v / max);
  let g = '<g class="grid">';
  for (let k = 0; k <= 4; k++) {
    const v = max * k / 4;
    const yy = y(v);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="muted" x="${L - 6}" y="${yy + 4}" text-anchor="end">${fmt(v, dec)}</text>`;
  }
  g += '</g>';
  let bars = '';
  items.forEach((it, i) => {
    const x = L + iw * i + (iw - bw) / 2;
    const yy = y(it.v);
    const hh = h - B - yy;
    const tip = esc(tipf ? tipf(it) : `${it.l}: ${fmt(it.v, dec)}${unit}`);
    bars += `<rect class="bar" x="${x}" y="${yy}" width="${bw}" height="${Math.max(hh, 0)}" fill="${color}"/>`
      + `<text class="val" x="${x + bw / 2}" y="${yy - 6}" text-anchor="middle">${fmt(it.v, dec)}${unit}</text>`
      + `<text class="lab" x="${x + bw / 2}" y="${h - B + 18}" text-anchor="middle">${esc(it.l)}</text>`
      + `<rect class="hit" x="${L + iw * i}" y="${T}" width="${iw}" height="${h - T - B}" data-tip="${tip}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" role="img">${g}<line class="axis" x1="${L}" x2="${W - R}" y1="${h - B}" y2="${h - B}"/>${bars}</svg>`;
}

export function hbars(
  items: BarItem[],
  { unit = '', dec = 2, h, colorf, tipf, labelw = 150 }: {
    unit?: string; dec?: number; h?: number; colorf?: (it: BarItem, i: number) => string;
    tipf?: (it: BarItem) => string; labelw?: number;
  } = {},
): string {
  const W = 520, L = labelw, R = 80, T = 6, rh = 26, gap = 6;
  const H = h || T + items.length * (rh + gap) + 8;
  const max = Math.max(0.001, ...items.map((i) => i.v));
  const x = (v: number) => L + (W - L - R) * (v / max);
  let s = '';
  items.forEach((it, i) => {
    const yy = T + i * (rh + gap);
    const c = colorf ? colorf(it, i) : 'var(--seq-5)';
    const tip = esc(tipf ? tipf(it) : `${it.l}: ${fmt(it.v, dec)}${unit}`);
    s += `<text class="lab" x="${L - 8}" y="${yy + rh / 2 + 4}" text-anchor="end">${esc(it.l)}</text>`
      + `<rect class="bar" x="${L}" y="${yy}" width="${Math.max(x(it.v) - L, 1)}" height="${rh - 6}" fill="${c}"/>`
      + `<text class="val" x="${x(it.v) + 6}" y="${yy + rh / 2 + 3}">${fmt(it.v, dec)}${unit}</text>`
      + `<rect class="hit" x="0" y="${yy - 2}" width="${W}" height="${rh + 2}" data-tip="${tip}"/>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}

export function heat(
  rows: string[],
  cols: string[],
  get: (r: string, c: string) => number,
  { dec = 2, unit = '' }: { dec?: number; unit?: string } = {},
): string {
  const W = 520, L = 156, T = 24, cw = (W - L - 8) / Math.max(cols.length, 1), ch = 24;
  const H = T + rows.length * ch + 8;
  const vals = rows.flatMap((r) => cols.map((c) => get(r, c)));
  const max = Math.max(0.001, ...vals);
  const ramp = ['--seq-1', '--seq-2', '--seq-3', '--seq-4', '--seq-5', '--seq-6', '--seq-7'];
  let s = cols.map((c, j) => `<text class="muted" x="${L + cw * j + cw / 2}" y="${T - 8}" text-anchor="middle">${esc(c)}</text>`).join('');
  rows.forEach((r, i) => {
    s += `<text class="lab" x="${L - 8}" y="${T + i * ch + ch / 2 + 4}" text-anchor="end">${esc(r)}</text>`;
    cols.forEach((c, j) => {
      const v = get(r, c);
      const k = Math.min(6, Math.floor(6 * Math.sqrt(v / max) + 0.001));
      const dark = k >= 4;
      s += `<rect x="${L + cw * j + 1}" y="${T + i * ch + 1}" width="${cw - 2}" height="${ch - 2}" rx="3" fill="var(${ramp[k]})" data-tip="${esc(`${r} · ${c}: ${fmt(v, dec)}${unit}`)}"/>`
        + `<text x="${L + cw * j + cw / 2}" y="${T + i * ch + ch / 2 + 4}" text-anchor="middle" style="fill:${dark ? '#fff' : 'var(--ink)'};font-size:11px;pointer-events:none">${fmt(v, dec)}</text>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}

export function stackedH(
  rows: string[],
  series: SeriesDef[],
  get: (r: string, key: string) => number,
  { labelw = 160, rh = 22, W = 520 }: { labelw?: number; rh?: number; W?: number } = {},
): string {
  const L = labelw, R = 12, T = 4, gap = 8;
  const H = T + rows.length * (rh + gap) + 4;
  const x = (v: number) => L + (W - L - R) * v;
  let s = '';
  rows.forEach((r, i) => {
    const yy = T + i * (rh + gap);
    let acc = 0;
    s += `<text class="lab" x="${L - 8}" y="${yy + rh / 2 + 4}" text-anchor="end">${esc(r)}</text>`;
    series.forEach((sr, k) => {
      const v = get(r, sr.key) || 0;
      if (v <= 0) return;
      const x0 = x(acc), x1 = x(acc + v);
      s += `<rect x="${x0 + (acc > 0 ? 1 : 0)}" y="${yy}" width="${Math.max(x1 - x0 - 1, 0)}" height="${rh - 4}" rx="3" fill="var(--c${k + 1})" data-tip="${esc(`${r} · ${sr.label}: ${fmt(100 * v, 0)} %`)}"/>`;
      if (v >= 0.12) {
        s += `<text x="${(x0 + x1) / 2}" y="${yy + rh / 2 + 2}" text-anchor="middle" style="fill:#fff;font-size:11px;font-weight:600;pointer-events:none">${fmt(100 * v, 0)}%</text>`;
      }
      acc += v;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img">${s}</svg>`;
}

export function stackedV(
  cols: string[],
  series: SeriesDef[],
  get: (c: string, key: string) => number,
): string {
  const W = 520, L = 36, R = 12, T = 10, B = 30, h = 250;
  const n = cols.length;
  const iw = (W - L - R) / Math.max(n, 1);
  const bw = Math.min(56, iw * 0.6);
  const y = (v: number) => T + (h - T - B) * (1 - v);
  let g = '<g class="grid">';
  for (let k = 0; k <= 4; k++) {
    const yy = y(k / 4);
    g += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text class="muted" x="${L - 6}" y="${yy + 4}" text-anchor="end">${k * 25}%</text>`;
  }
  g += '</g>';
  let s = '';
  cols.forEach((c, i) => {
    const x = L + iw * i + (iw - bw) / 2;
    let acc = 0;
    series.forEach((sr, k) => {
      const v = get(c, sr.key) || 0;
      if (v <= 0) return;
      const y1 = y(acc), y0 = y(acc + v);
      s += `<rect x="${x}" y="${y0 + 1}" width="${bw}" height="${Math.max(y1 - y0 - 2, 0)}" rx="3" fill="var(--c${k + 1})" data-tip="${esc(`${c} · ${sr.label}: ${fmt(100 * v, 0)} %`)}"/>`;
      if (v >= 0.1) {
        s += `<text x="${x + bw / 2}" y="${(y0 + y1) / 2 + 4}" text-anchor="middle" style="fill:#fff;font-size:11px;font-weight:600;pointer-events:none">${fmt(100 * v, 0)}%</text>`;
      }
      acc += v;
    });
    s += `<text class="lab" x="${x + bw / 2}" y="${h - B + 18}" text-anchor="middle">${esc(c)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${h}" role="img">${g}<line class="axis" x1="${L}" x2="${W - R}" y1="${h - B}" y2="${h - B}"/>${s}</svg>`;
}

export function legend(series: SeriesDef[]): string {
  return `<div class="cm-legend">${series.map((s, k) => `<span><i style="background:var(--c${k + 1})"></i>${esc(s.label)}</span>`).join('')}</div>`;
}
