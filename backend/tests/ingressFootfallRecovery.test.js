import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterFootfallEvents,
  distM,
  hourInVenueLocal,
  roiCentroid,
} from '../lib/ingressFootfallRecovery.js';

describe('ingressFootfallRecovery', () => {
  it('clusters nearby events in time', () => {
    const events = [
      { t: 1000, x: 10, z: 20 },
      { t: 2000, x: 10.5, z: 20.5 },
      { t: 10000, x: 10, z: 20 },
    ];
    const clusters = clusterFootfallEvents(events, 3000, 1.2);
    assert.equal(clusters.length, 2);
  });

  it('computes roi centroid', () => {
    const c = roiCentroid([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }]);
    assert.equal(c.x, 2);
    assert.equal(c.z, 2);
  });

  it('distM is euclidean', () => {
    assert.equal(distM(0, 0, 3, 4), 5);
  });
});
