import { describe, it, expect } from 'vitest';
import { tracksLinkedByReid, trackKeysEquivalent } from '../services/dooh_attribution/TrackIdentityMatcher.js';

describe('TrackIdentityMatcher', () => {
  it('tracksLinkedByReid links fragmented segments within gap and distance', () => {
    const posA = [
      { x: 10, z: 20, timestamp: 1000 },
      { x: 10.5, z: 20.5, timestamp: 2000 },
    ];
    const posB = [
      { x: 11, z: 21, timestamp: 3500 },
    ];
    expect(tracksLinkedByReid(posA, posB, { maxGapMs: 5000, maxDistanceM: 4 })).toBe(true);
  });

  it('tracksLinkedByReid rejects when gap too large', () => {
    const posA = [{ x: 0, z: 0, timestamp: 1000 }];
    const posB = [{ x: 1, z: 1, timestamp: 20000 }];
    expect(tracksLinkedByReid(posA, posB, { maxGapMs: 5000, maxDistanceM: 4 })).toBe(false);
  });

  it('trackKeysEquivalent matches suffix alias', () => {
    expect(trackKeysEquivalent('a:person-1', 'b:person-1', 'suffix_alias')).toBe(true);
    expect(trackKeysEquivalent('a:person-1', 'b:person-2', 'suffix_alias')).toBe(false);
  });
});
