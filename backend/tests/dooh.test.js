/**
 * DOOH KPI Engine Tests
 * 
 * Unit and integration tests for the DOOH analytics module.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { 
  DoohKpiEngine, 
  DEFAULT_PARAMS, 
  pointInPolygon, 
  distance2D 
} from '../services/dooh/DoohKpiEngine.js';
import { ContextResolver } from '../services/dooh/ContextResolver.js';
import { DoohKpiAggregator } from '../services/dooh/DoohKpiAggregator.js';

// Test database
let db;
let engine;
let contextResolver;
let aggregator;

// Test data
const TEST_VENUE_ID = 'test-venue-dooh';
const TEST_SCREEN_ID = 'test-screen-1';

beforeAll(() => {
  // Create in-memory test database
  db = new Database(':memory:');
  
  // Create required tables
  db.exec(`
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    
    CREATE TABLE dooh_screens (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      object_id TEXT,
      name TEXT NOT NULL,
      position_json TEXT NOT NULL,
      yaw_deg REAL NOT NULL DEFAULT 0,
      mount_height_m REAL NOT NULL DEFAULT 2.5,
      sez_polygon_json TEXT NOT NULL,
      az_polygon_json TEXT,
      params_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    
    CREATE TABLE dooh_exposure_events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      track_key TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      duration_s REAL NOT NULL,
      effective_dwell_s REAL NOT NULL,
      min_distance_m REAL NOT NULL,
      p10_distance_m REAL,
      mean_speed_mps REAL NOT NULL,
      min_speed_mps REAL NOT NULL,
      entry_speed_mps REAL,
      orientation_score REAL NOT NULL,
      proximity_score REAL NOT NULL,
      dwell_score REAL NOT NULL,
      slowdown_score REAL NOT NULL,
      stability_score REAL NOT NULL,
      aqs REAL NOT NULL,
      tier TEXT NOT NULL,
      context_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(screen_id, track_key, start_ts)
    );
    
    CREATE TABLE dooh_kpi_buckets (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      bucket_start_ts INTEGER NOT NULL,
      bucket_minutes INTEGER NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      qualified_impressions INTEGER NOT NULL DEFAULT 0,
      premium_impressions INTEGER NOT NULL DEFAULT 0,
      unique_visitors INTEGER NOT NULL DEFAULT 0,
      avg_aqs REAL,
      p75_aqs REAL,
      total_attention_s REAL NOT NULL DEFAULT 0,
      avg_attention_s REAL,
      freq_avg REAL,
      context_breakdown_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(screen_id, bucket_start_ts, bucket_minutes)
    );
    
    CREATE TABLE trajectory_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id TEXT NOT NULL,
      track_key TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      x REAL NOT NULL,
      z REAL NOT NULL,
      speed REAL
    );
    
    CREATE TABLE regions_of_interest (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      vertices TEXT NOT NULL
    );
  `);
  
  // Insert test venue
  db.prepare('INSERT INTO venues (id, name) VALUES (?, ?)').run(TEST_VENUE_ID, 'Test Venue');
  
  // Insert test screen with SEZ polygon
  const sezPolygon = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 4 },
    { x: 0, z: 4 },
  ];
  
  db.prepare(`
    INSERT INTO dooh_screens (id, venue_id, name, position_json, yaw_deg, mount_height_m, sez_polygon_json, params_json, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    TEST_SCREEN_ID,
    TEST_VENUE_ID,
    'Test Screen',
    JSON.stringify({ x: 2, y: 2.5, z: 2 }),
    0,
    2.5,
    JSON.stringify(sezPolygon),
    JSON.stringify(DEFAULT_PARAMS),
    1
  );
  
  // Insert test ROI for context resolution
  db.prepare(`
    INSERT INTO regions_of_interest (id, venue_id, name, vertices)
    VALUES (?, ?, ?, ?)
  `).run(
    'roi-queue-1',
    TEST_VENUE_ID,
    'Queue Zone',
    JSON.stringify([{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }])
  );
  
  // Initialize services
  engine = new DoohKpiEngine(db);
  contextResolver = new ContextResolver(db);
  aggregator = new DoohKpiAggregator(db);
});

afterAll(() => {
  db.close();
});

// ============================================
// Point-in-Polygon Tests
// ============================================

describe('pointInPolygon', () => {
  const square = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
    { x: 4, z: 4 },
    { x: 0, z: 4 },
  ];
  
  it('should return true for point inside polygon', () => {
    expect(pointInPolygon(2, 2, square)).toBe(true);
    expect(pointInPolygon(1, 1, square)).toBe(true);
    expect(pointInPolygon(3.5, 3.5, square)).toBe(true);
  });
  
  it('should return false for point outside polygon', () => {
    expect(pointInPolygon(-1, 2, square)).toBe(false);
    expect(pointInPolygon(5, 2, square)).toBe(false);
    expect(pointInPolygon(2, -1, square)).toBe(false);
    expect(pointInPolygon(2, 5, square)).toBe(false);
  });
  
  it('should handle edge cases', () => {
    expect(pointInPolygon(0, 0, square)).toBe(false); // On vertex
    expect(pointInPolygon(2, 0, square)).toBe(false); // On edge
  });
  
  it('should handle complex polygons', () => {
    const lShape = [
      { x: 0, z: 0 },
      { x: 2, z: 0 },
      { x: 2, z: 1 },
      { x: 1, z: 1 },
      { x: 1, z: 2 },
      { x: 0, z: 2 },
    ];
    expect(pointInPolygon(0.5, 0.5, lShape)).toBe(true);
    expect(pointInPolygon(1.5, 0.5, lShape)).toBe(true);
    expect(pointInPolygon(1.5, 1.5, lShape)).toBe(false); // Outside the L
    expect(pointInPolygon(0.5, 1.5, lShape)).toBe(true);
  });
  
  it('should return false for empty or invalid polygons', () => {
    expect(pointInPolygon(1, 1, [])).toBe(false);
    expect(pointInPolygon(1, 1, null)).toBe(false);
    expect(pointInPolygon(1, 1, [{ x: 0, z: 0 }])).toBe(false); // Single point
    expect(pointInPolygon(1, 1, [{ x: 0, z: 0 }, { x: 1, z: 1 }])).toBe(false); // Line
  });
});

// ============================================
// Distance Calculation Tests
// ============================================

describe('distance2D', () => {
  it('should calculate correct distance', () => {
    expect(distance2D(0, 0, 3, 4)).toBeCloseTo(5);
    expect(distance2D(0, 0, 0, 0)).toBe(0);
    expect(distance2D(1, 1, 2, 2)).toBeCloseTo(Math.sqrt(2));
  });
  
  it('should handle negative coordinates', () => {
    expect(distance2D(-1, -1, 2, 3)).toBeCloseTo(5);
  });
});

// ============================================
// Exposure Segmentation Tests
// ============================================

describe('DoohKpiEngine - Exposure Detection', () => {
  it('should detect exposure when track enters SEZ', () => {
    const screen = engine.getScreensForVenue(TEST_VENUE_ID)[0];
    
    // Track that enters and stays in SEZ
    const samples = [
      { timestamp: 1000, x: 2, z: 2, speed: 0.5 },
      { timestamp: 2000, x: 2.1, z: 2.1, speed: 0.3 },
      { timestamp: 3000, x: 2.2, z: 2.2, speed: 0.2 },
    ];
    
    const events = engine.computeExposureForTrack(screen, 'track-1', samples);
    
    expect(events.length).toBe(1);
    expect(events[0].durationS).toBeCloseTo(2);
    expect(events[0].tier).toBeDefined();
  });
  
  it('should filter out short exposures below T_min', () => {
    const screen = engine.getScreensForVenue(TEST_VENUE_ID)[0];
    
    // Very short track
    const samples = [
      { timestamp: 1000, x: 2, z: 2, speed: 0.5 },
      { timestamp: 1200, x: 2.1, z: 2.1, speed: 0.3 },
    ];
    
    const events = engine.computeExposureForTrack(screen, 'track-short', samples);
    
    expect(events.length).toBe(0); // Duration 0.2s < T_min 0.7s
  });
  
  it('should merge segments with gaps within max_gap_seconds', () => {
    const screen = engine.getScreensForVenue(TEST_VENUE_ID)[0];
    
    // Track with gap
    const samples = [
      { timestamp: 1000, x: 2, z: 2, speed: 0.5 },
      { timestamp: 2000, x: 2.1, z: 2.1, speed: 0.3 },
      // Gap of 1 second (within max_gap_seconds = 1.5)
      { timestamp: 3000, x: 2.2, z: 2.2, speed: 0.2 },
      { timestamp: 4000, x: 2.3, z: 2.3, speed: 0.1 },
    ];
    
    const events = engine.computeExposureForTrack(screen, 'track-gap', samples);
    
    expect(events.length).toBe(1); // Should merge into one event
    expect(events[0].durationS).toBeCloseTo(3);
  });
  
  it('should create separate events for gaps exceeding max_gap_seconds', () => {
    const screen = engine.getScreensForVenue(TEST_VENUE_ID)[0];
    
    // Track with large gap
    const samples = [
      { timestamp: 1000, x: 2, z: 2, speed: 0.5 },
      { timestamp: 2000, x: 2.1, z: 2.1, speed: 0.3 },
      // Gap of 3 seconds (exceeds max_gap_seconds = 1.5)
      { timestamp: 5000, x: 2.2, z: 2.2, speed: 0.2 },
      { timestamp: 6000, x: 2.3, z: 2.3, speed: 0.1 },
      { timestamp: 7000, x: 2.4, z: 2.4, speed: 0.1 },
    ];
    
    const events = engine.computeExposureForTrack(screen, 'track-large-gap', samples);
    
    // First segment (1s) is below T_min, second segment (2s) is valid
    expect(events.length).toBe(1);
  });
});

// ============================================
// AQS Calculation Tests
// ============================================

describe('DoohKpiEngine - AQS Calculation', () => {
  it('should calculate AQS components correctly', () => {
    const screen = engine.getScreensForVenue(TEST_VENUE_ID)[0];
    
    // Stationary track close to screen
    const samples = [
      { timestamp: 1000, x: 2, z: 2, speed: 0.1 },
      { timestamp: 2000, x: 2, z: 2, speed: 0.1 },
      { timestamp: 3000, x: 2, z: 2, speed: 0.1 },
      { timestamp: 4000, x: 2, z: 2, speed: 0.1 },
    ];
    
    const events = engine.computeExposureForTrack(screen, 'track-stationary', samples);
    
    expect(events.length).toBe(1);
    const event = events[0];
    
    // Should have high scores for stationary, close track
    expect(event.dwellScore).toBeGreaterThan(0.5);
    expect(event.proximityScore).toBe(1); // Distance 0, should max out
    expect(event.stabilityScore).toBeGreaterThan(0.7);
    expect(event.aqs).toBeGreaterThan(50);
  });
  
  it('should assign correct tier based on AQS', () => {
    const screen = engine.getScreensForVenue(TEST_VENUE_ID)[0];
    
    // High quality exposure
    const highQualitySamples = [
      { timestamp: 1000, x: 2, z: 2, speed: 0.1 },
      { timestamp: 2000, x: 2, z: 2, speed: 0.1 },
      { timestamp: 3000, x: 2, z: 2, speed: 0.1 },
      { timestamp: 4000, x: 2, z: 2, speed: 0.1 },
      { timestamp: 5000, x: 2, z: 2, speed: 0.1 },
    ];
    
    const events = engine.computeExposureForTrack(screen, 'track-premium', highQualitySamples);
    
    expect(events.length).toBe(1);
    // With 4 seconds of stationary time at 0 distance, should be premium
    expect(['qualified', 'premium']).toContain(events[0].tier);
  });
  
  it('should assign low tier to fast pass-by', () => {
    const screen = engine.getScreensForVenue(TEST_VENUE_ID)[0];
    
    // Fast moving track
    const fastSamples = [
      { timestamp: 1000, x: 1, z: 2, speed: 2.5 },
      { timestamp: 2000, x: 3, z: 2, speed: 2.5 },
    ];
    
    const events = engine.computeExposureForTrack(screen, 'track-fast', fastSamples);
    
    // Should either have no events or low tier
    if (events.length > 0) {
      expect(events[0].tier).toBe('low');
    }
  });
});

// ============================================
// Context Resolution Tests
// ============================================

describe('ContextResolver', () => {
  it('should load ROIs for venue', () => {
    const rois = contextResolver.loadRois(TEST_VENUE_ID);
    expect(rois.length).toBeGreaterThan(0);
    expect(rois[0].name).toBe('Queue Zone');
  });
  
  it('should resolve context with priority', () => {
    const rois = contextResolver.loadRois(TEST_VENUE_ID);
    
    const mockEvent = {
      venueId: TEST_VENUE_ID,
      trackKey: 'test-track',
      startTs: 1000,
      endTs: 4000,
      samples: [
        { timestamp: 1000, x: 2, z: 2, speed: 0.5 },
        { timestamp: 2000, x: 2, z: 2, speed: 0.3 },
        { timestamp: 3000, x: 2, z: 2, speed: 0.2 },
      ],
    };
    
    const context = contextResolver.resolveContext(mockEvent, rois, DEFAULT_PARAMS);
    
    expect(context.phase).toBe('queue'); // Should match Queue Zone
    expect(context.confidence).toBeGreaterThan(0);
  });
  
  it('should return "other" when no ROI matches', () => {
    const rois = contextResolver.loadRois(TEST_VENUE_ID);
    
    const mockEvent = {
      venueId: TEST_VENUE_ID,
      trackKey: 'test-track',
      startTs: 1000,
      endTs: 4000,
      samples: [
        { timestamp: 1000, x: 100, z: 100, speed: 0.5 }, // Far outside any ROI
      ],
    };
    
    const context = contextResolver.resolveContext(mockEvent, rois, DEFAULT_PARAMS);
    
    expect(context.phase).toBe('other');
  });
});

// ============================================
// Aggregator Tests
// ============================================

describe('DoohKpiAggregator', () => {
  beforeAll(() => {
    // Insert test exposure events
    const now = Date.now();
    const events = [
      { id: uuidv4(), tier: 'premium', aqs: 80, effectiveDwell: 5, trackKey: 'track-1' },
      { id: uuidv4(), tier: 'qualified', aqs: 55, effectiveDwell: 3, trackKey: 'track-2' },
      { id: uuidv4(), tier: 'low', aqs: 25, effectiveDwell: 1, trackKey: 'track-3' },
      { id: uuidv4(), tier: 'premium', aqs: 85, effectiveDwell: 6, trackKey: 'track-1' },
    ];
    
    const stmt = db.prepare(`
      INSERT INTO dooh_exposure_events (
        id, venue_id, screen_id, track_key, start_ts, end_ts,
        duration_s, effective_dwell_s, min_distance_m, p10_distance_m,
        mean_speed_mps, min_speed_mps, entry_speed_mps,
        orientation_score, proximity_score, dwell_score, slowdown_score, stability_score,
        aqs, tier, context_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const startTs = now - 3600000 + (i * 60000); // Spread across last hour
      stmt.run(
        e.id, TEST_VENUE_ID, TEST_SCREEN_ID, e.trackKey,
        startTs, startTs + (e.effectiveDwell * 1000),
        e.effectiveDwell, e.effectiveDwell, 1.5, 1.5,
        0.5, 0.1, 0.8,
        0.7, 0.8, 0.6, 0.5, 0.7,
        e.aqs, e.tier, JSON.stringify({ phase: 'queue' })
      );
    }
  });
  
  it('should aggregate events into buckets', () => {
    const now = Date.now();
    const buckets = aggregator.aggregateForScreen(
      TEST_VENUE_ID,
      TEST_SCREEN_ID,
      now - 7200000, // 2 hours ago
      now,
      15
    );
    
    expect(buckets.length).toBeGreaterThan(0);
  });
  
  it('should calculate correct impression counts', () => {
    const now = Date.now();
    const buckets = aggregator.getBuckets(TEST_SCREEN_ID, now - 7200000, now);
    
    const totalImpressions = buckets.reduce((sum, b) => sum + b.impressions, 0);
    expect(totalImpressions).toBe(4); // We inserted 4 events
  });
  
  it('should calculate correct tier counts', () => {
    const now = Date.now();
    const buckets = aggregator.getBuckets(TEST_SCREEN_ID, now - 7200000, now);
    
    const totalQualified = buckets.reduce((sum, b) => sum + b.qualifiedImpressions, 0);
    const totalPremium = buckets.reduce((sum, b) => sum + b.premiumImpressions, 0);
    
    expect(totalQualified).toBe(3); // 2 premium + 1 qualified
    expect(totalPremium).toBe(2);
  });
  
  it('should count unique visitors correctly', () => {
    const now = Date.now();
    const buckets = aggregator.getBuckets(TEST_SCREEN_ID, now - 7200000, now);
    
    const uniqueVisitors = buckets.reduce((sum, b) => sum + b.uniqueVisitors, 0);
    // We have 3 unique track keys, but may be counted multiple times across buckets
    expect(uniqueVisitors).toBeGreaterThanOrEqual(3);
  });
});

// ============================================
// Integration Test
// ============================================

describe('Integration - Full Pipeline', () => {
  it('should run full KPI computation pipeline', async () => {
    // Insert synthetic trajectory
    const now = Date.now();
    const trajectoryStmt = db.prepare(`
      INSERT INTO trajectory_samples (venue_id, track_key, timestamp, x, z, speed)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    // Simulate a person stopping in front of screen
    for (let i = 0; i < 10; i++) {
      trajectoryStmt.run(
        TEST_VENUE_ID,
        'integration-track-1',
        now - 60000 + (i * 1000),
        2 + (i * 0.01),
        2 + (i * 0.01),
        0.2
      );
    }
    
    // Run the engine
    const result = await engine.run(TEST_VENUE_ID, now - 120000, now);
    
    expect(result.screens).toBe(1);
    expect(result.tracks).toBeGreaterThan(0);
  });
});

console.log('DOOH KPI Engine tests loaded');
