/**
 * Store opening hours helpers for footfall KPIs.
 */

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
