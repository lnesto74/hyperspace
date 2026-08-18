import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyCategoryPresenceIndex } from '../services/executive/CategoryPresenceIndex.js';

describe('emptyCategoryPresenceIndex', () => {
  it('returns a no-episode stub so 7d journeys can skip track_positions', () => {
    const idx = emptyCategoryPresenceIndex();
    const stats = idx.statsFor('ortofrutta');
    assert.equal(stats.dwell.episodes, 0);
    assert.equal(stats.engagement.episodes, 0);
    assert.equal(stats.stoppingEngPct, null);
    assert.equal(stats.reliable ?? stats.dwell.reliable, false);
  });
});
