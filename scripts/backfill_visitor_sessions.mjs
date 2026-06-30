#!/usr/bin/env node
/**
 * Backfill visitor_session_id on zone_visits using entrance-anchored stitching.
 * Usage: node scripts/backfill_visitor_sessions.mjs [dbPath] [venueId] [days]
 */
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ensureRoiCategoryLabels } from '../backend/services/executive/roiCategorySync.js';
import {
  backfillVisitorSessionIds,
  resolveVenueRoiContext,
} from '../backend/services/VisitSessionStitcher.js';
import { loadExecutiveVisitSessionConfig, buildRoiToCategoryMap } from '../backend/services/executive/ExecutiveSessionAnalytics.js';
import { loadClassifiedRois } from '../backend/services/executive/ExecutiveZoneTaxonomy.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const Database = require(join(__dirname, '..', 'backend', 'node_modules', 'better-sqlite3'));

const dbPath = process.argv[2] || process.env.DB_PATH || '/data/db/hyperspace.db';
const venueId = process.argv[3] || '55fdd53b-3298-4355-97c0-b4e789b11d06';
const days = Number(process.argv[4] || 7);

const db = new Database(dbPath);
const end = Date.now();
const start = end - days * 86400000;

console.log(`Backfill visitor_session_id: venue=${venueId} window=${days}d`);
const labels = ensureRoiCategoryLabels(db, venueId);
console.log(`ROI category labels synced: ${labels}`);

const classified = loadClassifiedRois(db, venueId);
const roiToCategory = buildRoiToCategoryMap(classified);
const roiContext = resolveVenueRoiContext(db, venueId);
const config = loadExecutiveVisitSessionConfig(db, venueId);

const updated = backfillVisitorSessionIds(db, venueId, start, end, config, roiContext, roiToCategory);
console.log(`Updated ${updated} zone_visits with visitor_session_id`);
db.close();
