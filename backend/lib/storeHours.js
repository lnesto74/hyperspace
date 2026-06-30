/**
 * Store opening hours helpers for footfall KPIs.
 */

export const DEFAULT_VENUE_TIMEZONE = 'Europe/Rome';

/** Local hour (0–23) for a UTC epoch-ms timestamp in the venue timezone. */
export function venueLocalHour(tsMs, timeZone = DEFAULT_VENUE_TIMEZONE) {
  return Number(new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(new Date(tsMs)));
}

/** YYYY-MM-DD in the venue timezone (for daily buckets). */
export function venueLocalDateKey(tsMs, timeZone = DEFAULT_VENUE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(tsMs));
}

export function isTsWithinStoreHours(tsMs, openingHour, closingHour, timeZone = DEFAULT_VENUE_TIMEZONE) {
  return isHourWithinStoreHours(venueLocalHour(tsMs, timeZone), openingHour, closingHour);
}

/**
 * Sum row counts (or weighted values) into venue-local hour buckets, filtered to store hours.
 * @param {object[]} rows
 * @param {(row: object) => number} getTsMs
 * @param {(row: object) => number} [getWeight] defaults to 1
 */
export function aggregateByVenueLocalHour(
  rows,
  getTsMs,
  getWeight,
  openingHour,
  closingHour,
  timeZone = DEFAULT_VENUE_TIMEZONE,
  onlyDateKey = null,
) {
  const weightFn = getWeight || (() => 1);
  const map = new Map();
  for (const row of rows) {
    const ts = getTsMs(row);
    if (!Number.isFinite(ts)) continue;
    if (onlyDateKey && venueLocalDateKey(ts, timeZone) !== onlyDateKey) continue;
    if (!isTsWithinStoreHours(ts, openingHour, closingHour, timeZone)) continue;
    const h = venueLocalHour(ts, timeZone);
    map.set(h, (map.get(h) || 0) + weightFn(row));
  }
  return map;
}

/** Store-open hour indices for today only, capped at the current venue-local hour. */
export function venueHourBucketsForToday(
  endTsMs,
  openingHour = 8,
  closingHour = 20,
  timeZone = DEFAULT_VENUE_TIMEZONE,
) {
  const nowHour = venueLocalHour(endTsMs, timeZone);
  const close = Number(closingHour);
  const all = storeHourBucketIndices(openingHour, closingHour);
  if (!all.length) return [];
  const lastOpenHour = all[all.length - 1];
  const cap = nowHour < close ? Math.min(nowHour, lastOpenHour) : lastOpenHour;
  return all.filter(h => h <= cap);
}

export function isHourWithinStoreHours(hour, openingHour = 8, closingHour = 20) {
  const h = Number(hour);
  const open = Number(openingHour);
  const close = Number(closingHour);
  if (!Number.isFinite(h) || h < 0 || h > 23) return false;
  if (!Number.isFinite(open) || !Number.isFinite(close)) return true;
  if (open === close) return true; // 24h
  if (open < close) return h >= open && h < close;
  return h >= open || h < close; // overnight (e.g. 22 → 06)
}

export function countOpenHoursPerDay(openingHour = 8, closingHour = 20) {
  const open = Number(openingHour);
  const close = Number(closingHour);
  if (open === close) return 24;
  if (open < close) return close - open;
  return (24 - open) + close;
}

export function formatHourLabel(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return '--:--';
  return `${String(h).padStart(2, '0')}:00`;
}

export function formatStoreHoursRange(openingHour, closingHour) {
  return `${formatHourLabel(openingHour)} – ${formatHourLabel(closingHour)}`;
}

/** @param {{ hour: string, visits: number }[]} visitsByHour */
export function computeStoreFootfallFromHourly(visitsByHour, openingHour = 8, closingHour = 20) {
  const hourly = (visitsByHour || []).map(row => {
    const hourNum = parseInt(row.hour, 10);
    return {
      hour: row.hour,
      visits: row.visits || 0,
      isOpen: isHourWithinStoreHours(hourNum, openingHour, closingHour),
    };
  });

  let totalVisitsOpenHours = 0;
  let openHourBuckets = 0;
  let peakOpenHour = null;
  let peakOpenHourVisits = 0;

  for (const row of hourly) {
    if (!row.isOpen) continue;
    openHourBuckets++;
    totalVisitsOpenHours += row.visits;
    if (row.visits > peakOpenHourVisits) {
      peakOpenHourVisits = row.visits;
      peakOpenHour = row.hour;
    }
  }

  const openHoursPerDay = countOpenHoursPerDay(openingHour, closingHour);

  return {
    openingHour,
    closingHour,
    hoursLabel: formatStoreHoursRange(openingHour, closingHour),
    openHoursPerDay,
    totalVisitsOpenHours,
    avgVisitsPerOpenHour: openHourBuckets > 0
      ? Math.round((totalVisitsOpenHours / openHourBuckets) * 10) / 10
      : 0,
    peakOpenHour,
    peakOpenHourVisits,
    visitsByHour: hourly,
  };
}

export function isTrafficZoneName(name) {
  return /entrance|entry|exit|door|gate|traffic|ingress|ingresso|uscita/i.test(name || '');
}

/** Hour indices (0–23) when the store is open. */
export function storeHourBucketIndices(openingHour = 8, closingHour = 20) {
  const out = [];
  for (let h = 0; h < 24; h++) {
    if (isHourWithinStoreHours(h, openingHour, closingHour)) out.push(h);
  }
  return out;
}

/** SQLite filter: event local hour within store opening window. */
export function buildStoreHourSqlFilter(timeExpr, openingHour = 8, closingHour = 20) {
  const open = Number(openingHour);
  const close = Number(closingHour);
  const h = `CAST(strftime('%H', ${timeExpr}) AS INTEGER)`;
  if (!Number.isFinite(open) || !Number.isFinite(close) || open === close) return '1=1';
  if (open < close) return `${h} >= ${open} AND ${h} < ${close}`;
  return `(${h} >= ${open} OR ${h} < ${close})`;
}
