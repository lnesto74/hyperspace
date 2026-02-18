/**
 * EpisodeRanker
 * 
 * Scores and selects top-N episodes per period.
 * Scoring based on: KPI delta magnitude, affected population, duration,
 * deviation from baseline, business relevance weight.
 */

// Business relevance weights by episode type
const RELEVANCE_WEIGHTS = {
  QUEUE_BUILDUP_SPIKE: 1.0,
  LANE_UNDERSUPPLY: 0.9,
  LANE_OVERSUPPLY: 0.6,
  ABANDONMENT_WAVE: 0.95,
  QUEUE_SWITCHING: 0.7,
  HIGH_PASSBY_LOW_BROWSE: 0.8,
  BROWSE_NO_CONVERT_PROXY: 0.75,
  PLACEMENT_PENALTY_CLUSTER: 0.7,
  BRAND_UNFAIRNESS: 0.65,
  CATEGORY_SPIKE_FROM_LAYOUT: 0.7,
  BOTTLENECK_CORRIDOR: 0.85,
  ROUTE_DETOUR: 0.7,
  STORE_VISIT_TIME_SHIFT: 0.6,
  EXPOSURE_TO_ACTION_WIN: 0.8,
  EXPOSURE_NO_FOLLOWTHROUGH: 0.75,
  ATTENTION_QUALITY_DROP: 0.7,
};

export class EpisodeRanker {
  /**
   * Score a single episode
   * @param {Object} episode - Raw detected episode
   * @returns {number} Composite score 0-1
   */
  scoreEpisode(episode) {
    const weights = {
      confidence: 0.25,
      kpiMagnitude: 0.25,
      population: 0.2,
      relevance: 0.15,
      duration: 0.15,
    };

    // Confidence score (already 0-1)
    const confidenceScore = episode.confidence || 0;

    // KPI delta magnitude (normalize across deltas)
    const kpiMagnitude = this._computeKpiMagnitude(episode.kpi_deltas);

    // Population score (how many tracks affected, saturates at 50)
    const trackCount = episode.features?.unique_tracks || episode.features?.exposed_count || 0;
    const populationScore = Math.min(1, trackCount / 50);

    // Business relevance weight
    const relevanceScore = RELEVANCE_WEIGHTS[episode.episode_type] || 0.5;

    // Duration score (longer episodes = more significant, saturates at 30 min)
    const durationMs = (episode.end_ts || 0) - (episode.start_ts || 0);
    const durationScore = Math.min(1, durationMs / (30 * 60 * 1000));

    const score =
      weights.confidence * confidenceScore +
      weights.kpiMagnitude * kpiMagnitude +
      weights.population * populationScore +
      weights.relevance * relevanceScore +
      weights.duration * durationScore;

    return Math.round(score * 1000) / 1000;
  }

  /**
   * Score and rank a list of episodes, return top N with type diversity.
   * Ensures each episode type gets representation, not just the most numerous.
   * @param {Array} episodes
   * @param {number} topN
   * @returns {Array} Scored and sorted episodes
   */
  rankAndSelect(episodes, topN = 10) {
    // Score each episode
    const scored = episodes.map(ep => ({
      ...ep,
      score: this.scoreEpisode(ep),
    }));

    // Deduplicate overlapping episodes of the same type
    const deduped = this._deduplicateOverlapping(scored);

    // Group by episode type
    const byType = new Map();
    for (const ep of deduped) {
      if (!byType.has(ep.episode_type)) byType.set(ep.episode_type, []);
      byType.get(ep.episode_type).push(ep);
    }

    // Sort each group by score
    for (const [, group] of byType) {
      group.sort((a, b) => b.score - a.score);
    }

    // Round-robin selection: pick top episode from each type, then second, etc.
    const selected = [];
    const maxPerType = Math.max(2, Math.ceil(topN / Math.max(1, byType.size)));
    let round = 0;

    while (selected.length < topN && round < maxPerType) {
      for (const [, group] of byType) {
        if (round < group.length && selected.length < topN) {
          selected.push(group[round]);
        }
      }
      round++;
    }

    // Final sort by score for display order
    selected.sort((a, b) => b.score - a.score);

    return selected;
  }

  /**
   * Compute normalized KPI delta magnitude
   */
  _computeKpiMagnitude(kpiDeltas) {
    if (!kpiDeltas || Object.keys(kpiDeltas).length === 0) return 0;

    let totalMagnitude = 0;
    let count = 0;

    for (const [, delta] of Object.entries(kpiDeltas)) {
      if (delta.value != null && delta.baseline != null && delta.baseline > 0) {
        // Percentage change from baseline
        const pctChange = Math.abs((delta.value - delta.baseline) / delta.baseline);
        totalMagnitude += Math.min(1, pctChange); // Cap at 100% change
        count++;
      } else if (delta.direction === 'up' || delta.direction === 'down') {
        totalMagnitude += 0.5; // Directional signal without baseline
        count++;
      }
    }

    return count > 0 ? totalMagnitude / count : 0;
  }

  /**
   * Remove overlapping episodes of the same type (keep highest score)
   */
  _deduplicateOverlapping(sortedEpisodes) {
    const selected = [];

    for (const ep of sortedEpisodes) {
      const overlaps = selected.some(s =>
        s.episode_type === ep.episode_type &&
        s.start_ts < ep.end_ts &&
        s.end_ts > ep.start_ts &&
        // Same scope entity
        JSON.stringify(s.entities) === JSON.stringify(ep.entities)
      );

      if (!overlaps) {
        selected.push(ep);
      }
    }

    return selected;
  }
}

export default EpisodeRanker;
