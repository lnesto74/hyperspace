/**
 * Zone dwell measured in episodes rather than tracker fragments.
 *
 * The perception feed publishes an identity with a median life of about
 * thirteen seconds. A shopper who stands at the bread counter for a minute is
 * therefore emitted as four or five separate zone_visits under four or five
 * track keys, and any statistic built on a single row measures how long the
 * tracker held an ID, not how long the person stayed. Measured that way every
 * counter in the store reports the same twelve-to-fifteen seconds, because that
 * is the half-life of the tracker and nothing to do with bread.
 *
 * This rebuilds the underlying visit. Consecutive fragments in the same zone
 * are joined when the tracker plausibly lost and re-acquired the same body,
 * using the gate the visit stitcher already applies elsewhere: a gap no longer
 * than reidMaxGapMs, and a re-entry within reidMaxDistanceM of where the
 * previous fragment left off. The episode is then measured first-entry to
 * last-exit, so the blind interval counts as time in the zone — which it was.
 *
 * Measured against production over 24h the joined episodes run 1.6 to 2.0
 * fragments each and lift median dwell by 1.3x to 1.6x. The gate saturates:
 * widening it from 10s to 30s moves the episode count by under 3% in the busy
 * departments, so the join is recovering a real structural break rather than
 * tuning a knob until the answer looks better.
 *
 * Two caveats travel with every number this produces. Episodes are joined
 * within a zone, not across the several zones that make up a department, so a
 * shopper working along a counter still reads as more than one visit. And an
 * episode that is still open when its last fragment dies for good is censored
 * short, so these remain lower bounds.
 */

import { DEFAULT_VISIT_SESSION_CONFIG } from '../../config/visitSessionConfig.js';

/** Nothing in a grocery aisle is one person standing still for half an hour. */
const EPISODE_CAP_MS = 30 * 60 * 1000;

/**
 * Until 6 August 2026 the pipeline wrote zone durations snapped to whole
 * five-second steps: 5.01s, 10.02s, 15.02s and nothing in between. A median
 * taken over that data cannot land anywhere except on a step, which is why
 * every counter in the store reported exactly 15s over any window reaching
 * back into it — five departments agreeing to the second because the ruler had
 * only three markings, not because shoppers behaved identically.
 *
 * Free-running durations scatter across the interval, so the share of visits
 * sitting within a few milliseconds of a step separates the two regimes
 * cleanly: it runs 44-79% before the change and under 6% after.
 */
const QUANTISATION_TICK_MS = 5000;
const QUANTISATION_TOL_MS = 60;
const QUANTISATION_MAX_ON_TICK_PCT = 25;

/**
 * Is this window measured on the old five-second ruler? Cheap enough to run per
 * request, and it has to be per request because the answer depends entirely on
 * how far back the window reaches.
 */
function detectQuantisation(db, venueId, startTs, endTs) {
  try {
    const r = db.prepare(`
      SELECT COUNT(*) AS n,
             SUM(CASE WHEN duration_ms % ? <= ? OR duration_ms % ? >= ? - ?
                      THEN 1 ELSE 0 END) AS onTick
      FROM zone_visits
      WHERE venue_id = ? AND start_time >= ? AND start_time < ?
        AND duration_ms >= 1000
    `).get(QUANTISATION_TICK_MS, QUANTISATION_TOL_MS,
    QUANTISATION_TICK_MS, QUANTISATION_TICK_MS, QUANTISATION_TOL_MS,
    venueId, startTs, endTs);

    if (!r?.n) return { onTickPct: null, quantised: false, sampled: 0 };
    const onTickPct = Math.round((r.onTick / r.n) * 1000) / 10;
    return {
      onTickPct,
      quantised: onTickPct > QUANTISATION_MAX_ON_TICK_PCT,
      sampled: r.n,
      tickMs: QUANTISATION_TICK_MS,
    };
  } catch {
    return { onTickPct: null, quantised: false, sampled: 0 };
  }
}

/**
 * Below this an episode count is a handful of fragments off a barely-covered
 * fixture, and a median computed from it is noise wearing a number's clothes.
 */
export const MIN_EPISODES_FOR_DWELL = 30;

const EMPTY_EPISODE_STATS = Object.freeze({
  episodes: 0,
  fragments: 0,
  fragmentsPerEpisode: 0,
  stops: 0,
  stoppingPct: 0,
  medianStopSec: 0,
  p75StopSec: 0,
  meanStopSec: 0,
  reliable: false,
  unreliableReason: 'no_data',
});

/**
 * Percentile from a [second -> count] histogram. Working off bins rather than
 * a materialised list keeps this bounded no matter how wide the window is.
 */
function histPercentile(bins, q) {
  const total = [...bins.values()].reduce((s, b) => s + b.n, 0);
  if (!total) return 0;
  const target = total * q;
  let acc = 0;
  for (const sec of [...bins.keys()].sort((a, b) => a - b)) {
    acc += bins.get(sec).n;
    if (acc >= target) return sec;
  }
  return 0;
}

/**
 * One scan of zone_visits, joined into episodes by SQL window functions and
 * returned as a per-ROI histogram of episode length in whole seconds.
 *
 * The row-level join has to happen in SQL. Pulling the fragments into JS to
 * stitch them there would materialise millions of rows on a 30-day window,
 * which is exactly the cost the surrounding service was restructured to avoid.
 */
export function buildZoneEpisodeIndex(db, venueId, startTs, endTs, options = {}) {
  const gapMs = options.gapMs ?? DEFAULT_VISIT_SESSION_CONFIG.reidMaxGapMs;
  const maxDistM = options.maxDistM ?? DEFAULT_VISIT_SESSION_CONFIG.reidMaxDistanceM;
  const dwellMs = options.dwellMs ?? 5000;
  const dwellSec = dwellMs / 1000;
  const maxDistSq = maxDistM * maxDistM;

  // Rejoining fragments needs row-level access, so unlike the plain aggregates
  // it cannot be shared for free across the whole venue. Restricting the scan
  // to the zones that actually render episode metrics keeps a 7d request from
  // sorting every visit in the store.
  const scopeIds = options.roiIds?.length ? [...new Set(options.roiIds)] : null;
  const scopeClause = scopeIds ? `AND roi_id IN (${scopeIds.map(() => '?').join(',')})` : '';
  const scopeParams = scopeIds || [];

  const quantisation = detectQuantisation(db, venueId, startTs, endTs);
  const byRoi = new Map();
  let rows = [];
  try {
    rows = db.prepare(`
      WITH frags AS (
        SELECT roi_id, track_key, start_time,
               COALESCE(end_time, start_time + COALESCE(duration_ms, 0)) AS end_time,
               entry_position_x AS ex, entry_position_z AS ez,
               exit_position_x  AS xx, exit_position_z  AS xz
        FROM zone_visits
        WHERE venue_id = ? AND start_time >= ? AND start_time < ?
          AND track_key NOT LIKE '%cashier%'
          ${scopeClause}
      ),
      lagged AS (
        SELECT roi_id, track_key, start_time, end_time, ex, ez,
               MAX(end_time) OVER (
                 PARTITION BY roi_id ORDER BY start_time
                 ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
               ) AS prev_end,
               LAG(track_key) OVER (PARTITION BY roi_id ORDER BY start_time) AS prev_track,
               LAG(xx) OVER (PARTITION BY roi_id ORDER BY start_time) AS prev_xx,
               LAG(xz) OVER (PARTITION BY roi_id ORDER BY start_time) AS prev_xz
        FROM frags
      ),
      marked AS (
        SELECT roi_id, start_time, end_time,
          CASE
            WHEN prev_end IS NULL THEN 1
            WHEN start_time - prev_end > ? THEN 1
            WHEN track_key = prev_track THEN 0
            WHEN ex IS NULL OR prev_xx IS NULL THEN 1
            WHEN (ex - prev_xx) * (ex - prev_xx)
               + (ez - prev_xz) * (ez - prev_xz) <= ? THEN 0
            ELSE 1
          END AS is_new
        FROM lagged
      ),
      numbered AS (
        SELECT roi_id, start_time, end_time,
               SUM(is_new) OVER (
                 PARTITION BY roi_id ORDER BY start_time ROWS UNBOUNDED PRECEDING
               ) AS ep
        FROM marked
      ),
      spans AS (
        SELECT roi_id, COUNT(*) AS parts,
               MAX(end_time) - MIN(start_time) AS raw_span
        FROM numbered GROUP BY roi_id, ep
      ),
      capped AS (
        SELECT roi_id, parts,
               CASE WHEN raw_span < 0 THEN 0
                    WHEN raw_span > ? THEN ?
                    ELSE raw_span END AS span_ms
        FROM spans
      )
      SELECT roi_id,
             CAST(span_ms / 1000 AS INTEGER) AS sec,
             COUNT(*) AS n,
             SUM(parts) AS parts,
             SUM(span_ms) AS ms
      FROM capped
      GROUP BY roi_id, sec
    `).all(venueId, startTs, endTs, ...scopeParams,
    gapMs, maxDistSq, EPISODE_CAP_MS, EPISODE_CAP_MS);
  } catch (err) {
    // SQLite older than 3.25 has no window functions. Callers fall back to the
    // fragment-level figures rather than losing the section entirely.
    console.warn('[ZoneEpisodeIndex] episode reconstruction unavailable:', err.message);
    return {
      available: false, gapMs, maxDistM, quantisation,
      statsFor: () => ({ ...EMPTY_EPISODE_STATS }),
    };
  }

  for (const r of rows) {
    let bins = byRoi.get(r.roi_id);
    if (!bins) { bins = new Map(); byRoi.set(r.roi_id, bins); }
    bins.set(r.sec, { n: r.n || 0, parts: r.parts || 0, ms: r.ms || 0 });
  }

  return {
    available: true,
    gapMs,
    maxDistM,
    quantisation,
    statsFor(roiIds) {
      if (!roiIds?.length) return { ...EMPTY_EPISODE_STATS };

      const merged = new Map();
      let episodes = 0;
      let fragments = 0;
      for (const id of roiIds) {
        const bins = byRoi.get(id);
        if (!bins) continue;
        for (const [sec, b] of bins) {
          episodes += b.n;
          fragments += b.parts;
          const acc = merged.get(sec) || { n: 0, ms: 0 };
          acc.n += b.n;
          acc.ms += b.ms;
          merged.set(sec, acc);
        }
      }
      if (!episodes) return { ...EMPTY_EPISODE_STATS };

      const stopBins = new Map();
      let stops = 0;
      let stopMs = 0;
      for (const [sec, b] of merged) {
        if (sec < dwellSec) continue;
        stopBins.set(sec, b);
        stops += b.n;
        stopMs += b.ms;
      }

      return {
        episodes,
        fragments,
        fragmentsPerEpisode: Math.round((fragments / episodes) * 100) / 100,
        stops,
        stoppingPct: Math.round((stops / episodes) * 1000) / 10,
        medianStopSec: stops ? histPercentile(stopBins, 0.5) : 0,
        p75StopSec: stops ? histPercentile(stopBins, 0.75) : 0,
        meanStopSec: stops ? Math.round(stopMs / stops / 1000) : 0,
        reliable: episodes >= MIN_EPISODES_FOR_DWELL && stops > 0 && !quantisation.quantised,
        unreliableReason: quantisation.quantised
          ? 'quantised_durations'
          : (episodes < MIN_EPISODES_FOR_DWELL ? 'too_few_episodes' : null),
      };
    },
  };
}
