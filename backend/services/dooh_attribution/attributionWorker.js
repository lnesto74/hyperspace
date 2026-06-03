/**
 * Attribution Worker Thread
 * 
 * Runs PEBLE™ attribution in a separate thread so the main
 * event loop stays responsive (no browser/proxy timeouts).
 * 
 * Communicates progress and results back via parentPort.
 */

import { parentPort, workerData } from 'worker_threads';
import Database from 'better-sqlite3';
import { DoohAttributionEngine } from './DoohAttributionEngine.js';
import { getMatchingProfile } from './MatchingProfiles.js';

const { dbPath, venueId, campaignId, startTs, endTs, bucketMinutes, forceRecompute = false, profileId = null } = workerData;

try {
  // Open our own DB connection (worker threads can't share better-sqlite3 instances)
  const db = new Database(dbPath, { readonly: false });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = OFF');

  // Optional per-run matching profile (heavy profiles like journey-reachability run
  // here in the worker thread, never on the main event loop). Falls back to default.
  const matchingProfile = profileId ? getMatchingProfile(profileId) : undefined;
  const engine = new DoohAttributionEngine(db, matchingProfile ? { matchingProfile } : {});

  // Run with progress callback
  const result = engine.run(venueId, campaignId, startTs, endTs, (progress) => {
    parentPort.postMessage({ type: 'progress', ...progress });
  }, { forceRecompute }).then((result) => {
    // Aggregate KPIs (must happen on same DB connection)
    const kpis = engine.aggregateKPIs(venueId, campaignId, startTs, endTs, bucketMinutes || 15);
    const summary = engine.getSummaryKPIs(venueId, campaignId, startTs, endTs);

    parentPort.postMessage({
      type: 'done',
      result: {
        success: true,
        ...result,
        kpiBuckets: kpis.length,
        summary,
      },
    });

    db.close();
  }).catch((err) => {
    parentPort.postMessage({ type: 'error', message: err.message });
    db.close();
  });
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message });
}
