/**
 * DOOH KPI Aggregator
 * 
 * Computes aggregated KPI buckets from exposure events.
 * 
 * Feature flag: FEATURE_DOOH_KPIS
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Calculate percentile of an array
 */
function percentile(arr, p) {
  if (!arr || arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export class DoohKpiAggregator {
  constructor(db) {
    this.db = db;
  }

  /**
   * Get screen parameters
   */
  getScreenParams(screenId) {
    const row = this.db.prepare(`
      SELECT params_json FROM dooh_screens WHERE id = ?
    `).get(screenId);
    
    if (!row) return null;
    return JSON.parse(row.params_json);
  }

  /**
   * Get exposure events for a screen and time range
   */
  getEventsForBucket(screenId, bucketStartTs, bucketEndTs) {
    return this.db.prepare(`
      SELECT * FROM dooh_exposure_events
      WHERE screen_id = ? AND start_ts >= ? AND start_ts < ?
      ORDER BY start_ts
    `).all(screenId, bucketStartTs, bucketEndTs);
  }

  /**
   * Compute unique visitors using sessionization
   */
  computeUniqueVisitors(events, visitorResetMinutes) {
    const resetMs = visitorResetMinutes * 60 * 1000;
    const sessions = new Map(); // trackKey -> last seen timestamp

    const uniqueVisitors = new Set();

    for (const event of events) {
      const lastSeen = sessions.get(event.track_key);
      
      if (!lastSeen || (event.start_ts - lastSeen) > resetMs) {
        // New session
        uniqueVisitors.add(`${event.track_key}_${event.start_ts}`);
      }
      
      sessions.set(event.track_key, event.end_ts);
    }

    // Count unique track keys that had at least one event
    const uniqueTrackKeys = new Set(events.map(e => e.track_key));
    return uniqueTrackKeys.size;
  }

  /**
   * Compute frequency average (exposures per unique visitor)
   */
  computeFrequencyAvg(events, uniqueVisitors) {
    if (uniqueVisitors === 0) return 0;
    return events.length / uniqueVisitors;
  }

  /**
   * Compute context breakdown
   */
  computeContextBreakdown(events) {
    const breakdown = {};

    for (const event of events) {
      let context;
      try {
        context = event.context_json ? JSON.parse(event.context_json) : null;
      } catch {
        context = null;
      }

      const phase = context?.phase || 'unknown';
      
      if (!breakdown[phase]) {
        breakdown[phase] = {
          impressions: 0,
          qualified: 0,
          premium: 0,
          totalAttentionS: 0,
        };
      }

      breakdown[phase].impressions++;
      if (event.tier === 'qualified' || event.tier === 'premium') {
        breakdown[phase].qualified++;
        breakdown[phase].totalAttentionS += event.effective_dwell_s || 0;
      }
      if (event.tier === 'premium') {
        breakdown[phase].premium++;
      }
    }

    return breakdown;
  }

  /**
   * Aggregate KPIs for a single bucket
   */
  aggregateBucket(screenId, bucketStartTs, bucketMinutes, params) {
    const bucketEndTs = bucketStartTs + bucketMinutes * 60 * 1000;
    const events = this.getEventsForBucket(screenId, bucketStartTs, bucketEndTs);

    if (events.length === 0) {
      return null;
    }

    const visitorResetMinutes = params?.visitor_reset_minutes || 45;

    // Calculate metrics
    const impressions = events.length;
    const qualifiedEvents = events.filter(e => e.tier === 'qualified' || e.tier === 'premium');
    const premiumEvents = events.filter(e => e.tier === 'premium');
    
    const qualifiedImpressions = qualifiedEvents.length;
    const premiumImpressions = premiumEvents.length;

    const aqsValues = events.map(e => e.aqs);
    const avgAqs = aqsValues.length > 0 
      ? aqsValues.reduce((a, b) => a + b, 0) / aqsValues.length 
      : null;
    const p75Aqs = percentile(aqsValues, 75);

    const totalAttentionS = qualifiedEvents.reduce((sum, e) => sum + (e.effective_dwell_s || 0), 0);
    const avgAttentionS = qualifiedImpressions > 0 ? totalAttentionS / qualifiedImpressions : null;

    const uniqueVisitors = this.computeUniqueVisitors(events, visitorResetMinutes);
    const freqAvg = this.computeFrequencyAvg(events, uniqueVisitors);
    const contextBreakdown = this.computeContextBreakdown(events);

    // Use deterministic ID so buckets get replaced on re-computation
    const bucketId = `${screenId}_${bucketStartTs}_${bucketMinutes}`;
    
    return {
      id: bucketId,
      screenId,
      bucketStartTs,
      bucketMinutes,
      impressions,
      qualifiedImpressions,
      premiumImpressions,
      uniqueVisitors,
      avgAqs,
      p75Aqs,
      totalAttentionS,
      avgAttentionS,
      freqAvg,
      contextBreakdown,
    };
  }

  /**
   * Store a KPI bucket (upsert)
   */
  storeBucket(venueId, bucket) {
    this.db.prepare(`
      INSERT OR REPLACE INTO dooh_kpi_buckets (
        id, venue_id, screen_id, bucket_start_ts, bucket_minutes,
        impressions, qualified_impressions, premium_impressions,
        unique_visitors, avg_aqs, p75_aqs,
        total_attention_s, avg_attention_s, freq_avg,
        context_breakdown_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      bucket.id, venueId, bucket.screenId, bucket.bucketStartTs, bucket.bucketMinutes,
      bucket.impressions, bucket.qualifiedImpressions, bucket.premiumImpressions,
      bucket.uniqueVisitors, bucket.avgAqs, bucket.p75Aqs,
      bucket.totalAttentionS, bucket.avgAttentionS, bucket.freqAvg,
      JSON.stringify(bucket.contextBreakdown)
    );
  }

  /**
   * Aggregate all buckets for a screen and time range
   */
  aggregateForScreen(venueId, screenId, startTs, endTs, bucketMinutes = 15) {
    const params = this.getScreenParams(screenId);
    const effectiveBucketMinutes = params?.report_interval_minutes || bucketMinutes;
    const bucketMs = effectiveBucketMinutes * 60 * 1000;

    // Align to bucket boundaries
    const alignedStart = Math.floor(startTs / bucketMs) * bucketMs;
    const alignedEnd = Math.ceil(endTs / bucketMs) * bucketMs;

    const buckets = [];
    let current = alignedStart;

    while (current < alignedEnd) {
      const bucket = this.aggregateBucket(screenId, current, effectiveBucketMinutes, params);
      if (bucket) {
        this.storeBucket(venueId, bucket);
        buckets.push(bucket);
      }
      current += bucketMs;
    }

    return buckets;
  }

  /**
   * Get stored buckets for a screen and time range
   */
  getBuckets(screenId, startTs, endTs, bucketMinutes = null) {
    let query = `
      SELECT * FROM dooh_kpi_buckets
      WHERE screen_id = ? AND bucket_start_ts >= ? AND bucket_start_ts < ?
    `;
    const params = [screenId, startTs, endTs];

    if (bucketMinutes) {
      query += ' AND bucket_minutes = ?';
      params.push(bucketMinutes);
    }

    query += ' ORDER BY bucket_start_ts';

    const rows = this.db.prepare(query).all(...params);

    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      screenId: row.screen_id,
      bucketStartTs: row.bucket_start_ts,
      bucketMinutes: row.bucket_minutes,
      impressions: row.impressions,
      qualifiedImpressions: row.qualified_impressions,
      premiumImpressions: row.premium_impressions,
      uniqueVisitors: row.unique_visitors,
      avgAqs: row.avg_aqs,
      p75Aqs: row.p75_aqs,
      totalAttentionS: row.total_attention_s,
      avgAttentionS: row.avg_attention_s,
      freqAvg: row.freq_avg,
      contextBreakdown: row.context_breakdown_json ? JSON.parse(row.context_breakdown_json) : null,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get buckets grouped by context phase
   */
  getBucketsGroupedByContext(screenId, startTs, endTs) {
    const buckets = this.getBuckets(screenId, startTs, endTs);
    
    // Aggregate context breakdown across all buckets
    const contextAggregates = {};

    for (const bucket of buckets) {
      if (!bucket.contextBreakdown) continue;

      for (const [phase, data] of Object.entries(bucket.contextBreakdown)) {
        if (!contextAggregates[phase]) {
          contextAggregates[phase] = {
            impressions: 0,
            qualified: 0,
            premium: 0,
            totalAttentionS: 0,
            bucketCount: 0,
          };
        }
        contextAggregates[phase].impressions += data.impressions || 0;
        contextAggregates[phase].qualified += data.qualified || 0;
        contextAggregates[phase].premium += data.premium || 0;
        contextAggregates[phase].totalAttentionS += data.totalAttentionS || 0;
        contextAggregates[phase].bucketCount++;
      }
    }

    return contextAggregates;
  }
}

export default DoohKpiAggregator;
