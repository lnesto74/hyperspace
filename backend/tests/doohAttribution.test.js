/**
 * PEBLE™ DOOH Attribution Engine Tests
 * 
 * Unit and integration tests for:
 * - Target matching logic (category/brand/sku/slot)
 * - Control matching filters
 * - CES computation
 * - Attribution engine workflow
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { DoohAttributionEngine, DEFAULT_CAMPAIGN_PARAMS } from '../services/dooh_attribution/DoohAttributionEngine.js';
import { ShelfAnalyticsAdapter } from '../services/dooh_attribution/ShelfAnalyticsAdapter.js';

// Test database setup
let db;
let engine;
let adapter;

beforeAll(() => {
  // Create in-memory database
  db = new Database(':memory:');
  
  // Create necessary tables
  db.exec(`
    -- Venues
    CREATE TABLE venues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    -- Venue objects (shelves)
    CREATE TABLE venue_objects (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      position_x REAL DEFAULT 0,
      position_y REAL DEFAULT 0,
      position_z REAL DEFAULT 0,
      rotation_y REAL DEFAULT 0,
      scale_x REAL DEFAULT 1,
      scale_y REAL DEFAULT 1,
      scale_z REAL DEFAULT 1
    );

    -- Regions of interest
    CREATE TABLE regions_of_interest (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      vertices TEXT NOT NULL,
      color TEXT DEFAULT '#f59e0b',
      metadata_json TEXT
    );

    -- Zone visits
    CREATE TABLE zone_visits (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      roi_id TEXT NOT NULL,
      track_key TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      duration_ms INTEGER,
      is_dwell INTEGER DEFAULT 0,
      is_engagement INTEGER DEFAULT 0
    );

    -- Track positions
    CREATE TABLE track_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id TEXT NOT NULL,
      track_key TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      position_x REAL NOT NULL,
      position_z REAL NOT NULL,
      velocity_x REAL DEFAULT 0,
      velocity_z REAL DEFAULT 0,
      roi_id TEXT
    );

    -- DOOH Screens
    CREATE TABLE dooh_screens (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      object_id TEXT,
      name TEXT NOT NULL,
      position_json TEXT NOT NULL,
      yaw_deg REAL DEFAULT 0,
      mount_height_m REAL DEFAULT 2.5,
      sez_polygon_json TEXT NOT NULL,
      az_polygon_json TEXT,
      params_json TEXT NOT NULL,
      double_sided INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1
    );

    -- DOOH Exposure Events
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
      mean_speed_mps REAL NOT NULL,
      aqs REAL NOT NULL,
      tier TEXT NOT NULL,
      context_json TEXT
    );

    -- DOOH Campaigns
    CREATE TABLE dooh_campaigns (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      screen_ids_json TEXT NOT NULL,
      target_json TEXT NOT NULL,
      params_json TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- DOOH Attribution Events
    CREATE TABLE dooh_attribution_events (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      exposure_event_id TEXT,
      track_key TEXT NOT NULL,
      exposure_start_ts INTEGER NOT NULL,
      exposure_end_ts INTEGER NOT NULL,
      aqs REAL NOT NULL,
      tier TEXT NOT NULL,
      context_json TEXT,
      outcome_json TEXT,
      converted INTEGER DEFAULT 0,
      tta_s REAL,
      dci_value REAL,
      confidence REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- DOOH Control Matches
    CREATE TABLE dooh_control_matches (
      id TEXT PRIMARY KEY,
      attribution_event_id TEXT NOT NULL,
      control_track_key TEXT NOT NULL,
      pseudo_exposure_ts INTEGER NOT NULL,
      match_distance REAL NOT NULL,
      control_outcome_json TEXT,
      control_converted INTEGER DEFAULT 0,
      control_tta_s REAL,
      control_dci_value REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- DOOH Campaign KPIs
    CREATE TABLE dooh_campaign_kpis (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      bucket_start_ts INTEGER NOT NULL,
      bucket_minutes INTEGER NOT NULL,
      exposed_count INTEGER DEFAULT 0,
      controls_count INTEGER DEFAULT 0,
      p_exposed REAL,
      p_control REAL,
      lift_abs REAL,
      lift_rel REAL,
      median_tta_exposed REAL,
      median_tta_control REAL,
      tta_accel REAL,
      mean_engagement_dwell_exposed REAL,
      mean_engagement_dwell_control REAL,
      engagement_lift_s REAL,
      mean_aqs_exposed REAL,
      mean_dci_exposed REAL,
      mean_dci_control REAL,
      confidence_mean REAL,
      ces_score REAL,
      aar_score REAL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Planograms
    CREATE TABLE planograms (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      status TEXT DEFAULT 'draft'
    );

    -- Shelf planograms
    CREATE TABLE shelf_planograms (
      id TEXT PRIMARY KEY,
      planogram_id TEXT NOT NULL,
      shelf_id TEXT NOT NULL,
      num_levels INTEGER DEFAULT 4,
      slot_width_m REAL DEFAULT 0.1,
      slots_json TEXT NOT NULL
    );

    -- SKU catalogs
    CREATE TABLE sku_catalogs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    -- SKU items
    CREATE TABLE sku_items (
      id TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT
    );
  `);

  engine = new DoohAttributionEngine(db);
  adapter = new ShelfAnalyticsAdapter(db);
});

afterAll(() => {
  db.close();
});

beforeEach(() => {
  // Clear test data
  db.exec(`
    DELETE FROM dooh_attribution_events;
    DELETE FROM dooh_control_matches;
    DELETE FROM dooh_campaign_kpis;
    DELETE FROM dooh_exposure_events;
    DELETE FROM dooh_campaigns;
    DELETE FROM zone_visits;
    DELETE FROM track_positions;
  `);
});

// ============================================
// Target Matching Tests
// ============================================

describe('Target Matching Logic', () => {
  beforeEach(() => {
    // Setup test venue and shelf data
    db.exec(`
      INSERT OR REPLACE INTO venues (id, name) VALUES ('venue-1', 'Test Venue');
      
      INSERT OR REPLACE INTO venue_objects (id, venue_id, type, name, position_x, position_z, scale_x, scale_z)
      VALUES ('shelf-1', 'venue-1', 'shelf', 'Beverage Shelf', 5, 10, 2, 3);
      
      INSERT OR REPLACE INTO regions_of_interest (id, venue_id, name, vertices, metadata_json)
      VALUES ('roi-shelf-1', 'venue-1', 'Beverage Shelf Zone', 
        '[{"x":3,"z":8},{"x":7,"z":8},{"x":7,"z":12},{"x":3,"z":12}]',
        '{"template":"shelf-engagement","shelfId":"shelf-1","planogramId":"planogram-1"}');
      
      INSERT OR REPLACE INTO planograms (id, venue_id, name, status)
      VALUES ('planogram-1', 'venue-1', 'Test Planogram', 'active');
      
      INSERT OR REPLACE INTO sku_catalogs (id, name)
      VALUES ('catalog-1', 'Test Catalog');
      
      INSERT OR REPLACE INTO sku_items (id, catalog_id, sku_code, name, brand, category)
      VALUES 
        ('sku-1', 'catalog-1', 'SKU001', 'Coca-Cola 500ml', 'Coca-Cola', 'Beverages'),
        ('sku-2', 'catalog-1', 'SKU002', 'Pepsi 500ml', 'Pepsi', 'Beverages'),
        ('sku-3', 'catalog-1', 'SKU003', 'Chips Ahoy', 'Nabisco', 'Snacks');
      
      INSERT OR REPLACE INTO shelf_planograms (id, planogram_id, shelf_id, slots_json)
      VALUES ('sp-1', 'planogram-1', 'shelf-1', 
        '{"levels":[{"levelIndex":0,"slots":[{"slotIndex":0,"skuItemId":"sku-1"},{"slotIndex":1,"skuItemId":"sku-2"}]}]}');
    `);
  });

  it('should match shelf target correctly', () => {
    const target = { type: 'shelf', ids: ['shelf-1'] };
    const metadata = { template: 'shelf-engagement', shelfId: 'shelf-1' };
    
    const result = adapter.checkTargetMatch(target.type, target.ids, metadata, 'venue-1');
    
    expect(result).not.toBeNull();
    expect(result.matchType).toBe('shelf');
    expect(result.matchedId).toBe('shelf-1');
  });

  it('should match category target correctly', () => {
    const target = { type: 'category', ids: ['Beverages'] };
    const metadata = { template: 'shelf-engagement', shelfId: 'shelf-1', planogramId: 'planogram-1' };
    
    const result = adapter.checkTargetMatch(target.type, target.ids, metadata, 'venue-1');
    
    expect(result).not.toBeNull();
    expect(result.matchType).toBe('category');
    expect(result.categoryId).toBe('Beverages');
  });

  it('should match brand target correctly', () => {
    const target = { type: 'brand', ids: ['Coca-Cola'] };
    const metadata = { template: 'shelf-engagement', shelfId: 'shelf-1', planogramId: 'planogram-1' };
    
    const result = adapter.checkTargetMatch(target.type, target.ids, metadata, 'venue-1');
    
    expect(result).not.toBeNull();
    expect(result.matchType).toBe('brand');
    expect(result.brandId).toBe('Coca-Cola');
  });

  it('should match SKU target correctly', () => {
    const target = { type: 'sku', ids: ['sku-1'] };
    const metadata = { template: 'shelf-engagement', shelfId: 'shelf-1', planogramId: 'planogram-1' };
    
    const result = adapter.checkTargetMatch(target.type, target.ids, metadata, 'venue-1');
    
    expect(result).not.toBeNull();
    expect(result.matchType).toBe('sku');
    expect(result.skuId).toBe('sku-1');
  });

  it('should return null for non-matching target', () => {
    const target = { type: 'brand', ids: ['Unknown Brand'] };
    const metadata = { template: 'shelf-engagement', shelfId: 'shelf-1', planogramId: 'planogram-1' };
    
    const result = adapter.checkTargetMatch(target.type, target.ids, metadata, 'venue-1');
    
    expect(result).toBeNull();
  });
});

// ============================================
// Control Matching Tests
// ============================================

describe('Control Matching Filters', () => {
  it('should calculate heading bin correctly', () => {
    // Moving in +Z direction (heading 0)
    expect(engine.getHeadingBin(0, 1, 8)).toBe(0);
    
    // Moving in +X direction (heading 2 for 8 bins)
    expect(engine.getHeadingBin(1, 0, 8)).toBe(2);
    
    // Moving in -Z direction (heading 4)
    expect(engine.getHeadingBin(0, -1, 8)).toBe(4);
    
    // Moving in -X direction (heading 6)
    expect(engine.getHeadingBin(-1, 0, 8)).toBe(6);
  });

  it('should calculate mean speed correctly', () => {
    const samples = [
      { timestamp: 1000, x: 0, z: 0, vx: 1, vz: 0 },
      { timestamp: 2000, x: 1, z: 0, vx: 1, vz: 1 },
      { timestamp: 3000, x: 2, z: 1, vx: 0, vz: 2 },
    ];
    
    const meanSpeed = engine.calculateMeanSpeed(samples);
    
    // Expected: (1 + sqrt(2) + 2) / 3 ≈ 1.47
    expect(meanSpeed).toBeGreaterThan(1.4);
    expect(meanSpeed).toBeLessThan(1.5);
  });

  it('should get polygon center correctly', () => {
    const polygon = [
      { x: 0, z: 0 },
      { x: 4, z: 0 },
      { x: 4, z: 4 },
      { x: 0, z: 4 },
    ];
    
    const center = engine.getPolygonCenter(polygon);
    
    expect(center.x).toBe(2);
    expect(center.z).toBe(2);
  });
});

// ============================================
// CES Computation Tests
// ============================================

describe('CES (Campaign Effectiveness Score) Computation', () => {
  it('should calculate CES correctly with perfect lift', () => {
    // Setup: 100% exposed convert, 0% control convert
    const kpiData = {
      pExposed: 1.0,
      pControl: 0.0,
      liftRel: Infinity, // Will be clamped
      ttaAccel: 2.0, // 2x faster
      engagementLiftS: 10, // 10s more engagement
      confidenceMean: 1.0,
    };
    
    const sLift = Math.min(1, Math.max(0, 0.5 / 0.5)); // Capped at 1
    const sTta = 1 - Math.exp(-Math.max(kpiData.ttaAccel - 1, 0) / 1.0);
    const sEng = 1 - Math.exp(-Math.max(kpiData.engagementLiftS, 0) / 10.0);
    
    const ces = 100 * kpiData.confidenceMean * (0.55 * sLift + 0.25 * sTta + 0.20 * sEng);
    
    expect(ces).toBeGreaterThan(70);
    expect(ces).toBeLessThanOrEqual(100);
  });

  it('should calculate CES correctly with moderate lift', () => {
    // 25% lift relative to control
    const liftRel = 0.25;
    const ttaAccel = 1.5;
    const engagementLiftS = 5;
    const confidenceMean = 0.8;
    
    const sLift = Math.min(1, Math.max(0, liftRel / 0.5));
    const sTta = 1 - Math.exp(-Math.max(ttaAccel - 1, 0) / 1.0);
    const sEng = 1 - Math.exp(-Math.max(engagementLiftS, 0) / 10.0);
    
    const ces = 100 * confidenceMean * (0.55 * sLift + 0.25 * sTta + 0.20 * sEng);
    
    expect(ces).toBeGreaterThan(30);
    expect(ces).toBeLessThan(70);
  });

  it('should calculate CES as zero with no lift and low confidence', () => {
    const liftRel = 0;
    const ttaAccel = 1;
    const engagementLiftS = 0;
    const confidenceMean = 0;
    
    const sLift = Math.min(1, Math.max(0, liftRel / 0.5));
    const sTta = 1 - Math.exp(-Math.max(ttaAccel - 1, 0) / 1.0);
    const sEng = 1 - Math.exp(-Math.max(engagementLiftS, 0) / 10.0);
    
    const ces = 100 * confidenceMean * (0.55 * sLift + 0.25 * sTta + 0.20 * sEng);
    
    expect(ces).toBe(0);
  });
});

// ============================================
// DCI (Direction Change Index) Tests
// ============================================

describe('DCI (Direction Change Index) Calculation', () => {
  beforeEach(() => {
    db.exec(`
      INSERT OR REPLACE INTO venues (id, name) VALUES ('venue-1', 'Test Venue');
    `);
  });

  it('should calculate positive DCI when track turns toward target', () => {
    const now = Date.now();
    
    // Before exposure: moving away from target (0, 20)
    db.prepare(`
      INSERT INTO track_positions (venue_id, track_key, timestamp, position_x, position_z, velocity_x, velocity_z)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('venue-1', 'track-1', now - 5000, 10, 10, 1, 0);
    
    db.prepare(`
      INSERT INTO track_positions (venue_id, track_key, timestamp, position_x, position_z, velocity_x, velocity_z)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('venue-1', 'track-1', now - 1000, 14, 10, 1, 0);
    
    // After exposure: turning toward target
    db.prepare(`
      INSERT INTO track_positions (venue_id, track_key, timestamp, position_x, position_z, velocity_x, velocity_z)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('venue-1', 'track-1', now + 1000, 14, 10, -0.5, 0.5);
    
    db.prepare(`
      INSERT INTO track_positions (venue_id, track_key, timestamp, position_x, position_z, velocity_x, velocity_z)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('venue-1', 'track-1', now + 5000, 12, 14, -0.5, 1);
    
    const targetPosition = { x: 0, z: 20 };
    const dci = engine.calculateDCI('venue-1', 'track-1', now, targetPosition, 10);
    
    expect(dci).toBeGreaterThan(0);
  });
});

// ============================================
// Integration Tests
// ============================================

describe('Attribution Engine Integration', () => {
  beforeEach(() => {
    // Setup full test scenario
    db.exec(`
      INSERT OR REPLACE INTO venues (id, name) VALUES ('venue-1', 'Test Venue');
      
      INSERT OR REPLACE INTO dooh_screens (id, venue_id, name, position_json, sez_polygon_json, params_json)
      VALUES ('screen-1', 'venue-1', 'Test Screen', 
        '{"x":5,"y":2.5,"z":0}',
        '[{"x":0,"z":0},{"x":10,"z":0},{"x":10,"z":10},{"x":0,"z":10}]',
        '{}');
      
      INSERT OR REPLACE INTO venue_objects (id, venue_id, type, name, position_x, position_z)
      VALUES ('shelf-1', 'venue-1', 'shelf', 'Target Shelf', 5, 20);
      
      INSERT OR REPLACE INTO dooh_campaigns (id, venue_id, name, screen_ids_json, target_json, params_json)
      VALUES ('campaign-1', 'venue-1', 'Test Campaign',
        '["screen-1"]',
        '{"type":"shelf","ids":["shelf-1"]}',
        '{}');
    `);
  });

  it('should load campaign configuration correctly', () => {
    const campaign = engine.getCampaign('campaign-1');
    
    expect(campaign).not.toBeNull();
    expect(campaign.name).toBe('Test Campaign');
    expect(campaign.screenIds).toContain('screen-1');
    expect(campaign.target.type).toBe('shelf');
    expect(campaign.target.ids).toContain('shelf-1');
  });

  it('should get screen details correctly', () => {
    const screen = engine.getScreen('screen-1');
    
    expect(screen).not.toBeNull();
    expect(screen.name).toBe('Test Screen');
    expect(screen.position.x).toBe(5);
    expect(screen.sezPolygon).toHaveLength(4);
  });

  it('should calculate median correctly', () => {
    expect(engine.median([1, 2, 3, 4, 5])).toBe(3);
    expect(engine.median([1, 2, 3, 4])).toBe(2.5);
    expect(engine.median([5])).toBe(5);
    expect(engine.median([])).toBeNull();
  });

  it('should calculate mean correctly', () => {
    expect(engine.mean([1, 2, 3, 4, 5])).toBe(3);
    expect(engine.mean([10, 20])).toBe(15);
    expect(engine.mean([])).toBe(0);
  });
});

// ============================================
// Default Parameters Tests
// ============================================

describe('Default Campaign Parameters', () => {
  it('should have all required parameters', () => {
    expect(DEFAULT_CAMPAIGN_PARAMS.action_window_minutes).toBeDefined();
    expect(DEFAULT_CAMPAIGN_PARAMS.match_time_bucket_min).toBeDefined();
    expect(DEFAULT_CAMPAIGN_PARAMS.control_matches_M).toBeDefined();
    expect(DEFAULT_CAMPAIGN_PARAMS.min_controls_required).toBeDefined();
    expect(DEFAULT_CAMPAIGN_PARAMS.aqs_min_for_exposed).toBeDefined();
    expect(DEFAULT_CAMPAIGN_PARAMS.confidence_floor).toBeDefined();
  });

  it('should have sensible default values', () => {
    expect(DEFAULT_CAMPAIGN_PARAMS.action_window_minutes).toBe(10);
    expect(DEFAULT_CAMPAIGN_PARAMS.control_matches_M).toBe(5);
    expect(DEFAULT_CAMPAIGN_PARAMS.aqs_min_for_exposed).toBe(50);
    expect(DEFAULT_CAMPAIGN_PARAMS.confidence_floor).toBeGreaterThan(0);
    expect(DEFAULT_CAMPAIGN_PARAMS.confidence_floor).toBeLessThan(1);
  });
});

console.log('PEBLE™ Attribution Engine tests loaded');
