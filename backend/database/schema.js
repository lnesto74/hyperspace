import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

const DB_PATH = process.env.DB_PATH || './database/hyperspace.db';

export function initDatabase() {
  // Ensure database directory exists
  const dbDir = dirname(DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  
  // Disable foreign keys temporarily to debug persistence issue
  db.pragma('foreign_keys = OFF');
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');

  // Create tables
  db.exec(`
    -- Venues table
    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width REAL NOT NULL DEFAULT 20,
      depth REAL NOT NULL DEFAULT 15,
      height REAL NOT NULL DEFAULT 4,
      tile_size REAL NOT NULL DEFAULT 1,
      scene_source TEXT NOT NULL DEFAULT 'manual',
      dwg_layout_version_id TEXT DEFAULT NULL,
      dwg_transform_json TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (dwg_layout_version_id) REFERENCES dwg_layout_versions(id) ON DELETE SET NULL
    );

    -- Venue objects table
    CREATE TABLE IF NOT EXISTS venue_objects (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      position_z REAL NOT NULL DEFAULT 0,
      rotation_x REAL NOT NULL DEFAULT 0,
      rotation_y REAL NOT NULL DEFAULT 0,
      rotation_z REAL NOT NULL DEFAULT 0,
      scale_x REAL NOT NULL DEFAULT 1,
      scale_y REAL NOT NULL DEFAULT 1,
      scale_z REAL NOT NULL DEFAULT 1,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    -- LiDAR placements table
    CREATE TABLE IF NOT EXISTS lidar_placements (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      position_x REAL NOT NULL DEFAULT 0,
      position_y REAL NOT NULL DEFAULT 0,
      position_z REAL NOT NULL DEFAULT 0,
      rotation_x REAL NOT NULL DEFAULT 0,
      rotation_y REAL NOT NULL DEFAULT 0,
      rotation_z REAL NOT NULL DEFAULT 0,
      mount_height REAL NOT NULL DEFAULT 3,
      fov_horizontal REAL NOT NULL DEFAULT 120,
      fov_vertical REAL NOT NULL DEFAULT 30,
      range REAL NOT NULL DEFAULT 10,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    -- Custom 3D models for object types
    CREATE TABLE IF NOT EXISTS custom_models (
      object_type TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      original_name TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Regions of Interest (ROI) table
    -- dwg_layout_id: NULL = manual/venue mode, non-NULL = DWG mode (points to dwg_layout_versions.id)
    CREATE TABLE IF NOT EXISTS regions_of_interest (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      dwg_layout_id TEXT DEFAULT NULL,
      name TEXT NOT NULL,
      vertices TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#f59e0b',
      opacity REAL NOT NULL DEFAULT 0.5,
      metadata_json TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      FOREIGN KEY (dwg_layout_id) REFERENCES dwg_layout_versions(id) ON DELETE CASCADE
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_venue_objects_venue_id ON venue_objects(venue_id);
    CREATE INDEX IF NOT EXISTS idx_lidar_placements_venue_id ON lidar_placements(venue_id);
    CREATE INDEX IF NOT EXISTS idx_regions_of_interest_venue_id ON regions_of_interest(venue_id);

    -- SKU Catalog tables (for Planogram Builder)
    CREATE TABLE IF NOT EXISTS sku_catalogs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sku_items (
      id TEXT PRIMARY KEY,
      catalog_id TEXT NOT NULL,
      sku_code TEXT NOT NULL,
      name TEXT NOT NULL,
      brand TEXT,
      category TEXT,
      subcategory TEXT,
      size TEXT,
      width_m REAL,
      height_m REAL,
      depth_m REAL,
      price REAL,
      margin REAL,
      image_url TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (catalog_id) REFERENCES sku_catalogs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sku_items_catalog_id ON sku_items(catalog_id);
    CREATE INDEX IF NOT EXISTS idx_sku_items_category ON sku_items(category);
    CREATE INDEX IF NOT EXISTS idx_sku_items_brand ON sku_items(brand);

    -- Planogram tables
    CREATE TABLE IF NOT EXISTS planograms (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shelf_planograms (
      id TEXT PRIMARY KEY,
      planogram_id TEXT NOT NULL,
      shelf_id TEXT NOT NULL,
      num_levels INTEGER NOT NULL DEFAULT 4,
      slot_width_m REAL NOT NULL DEFAULT 0.1,
      level_height_m REAL,
      slot_facings TEXT DEFAULT NULL,
      slots_json TEXT NOT NULL DEFAULT '{"levels":[]}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (planogram_id) REFERENCES planograms(id) ON DELETE CASCADE,
      FOREIGN KEY (shelf_id) REFERENCES venue_objects(id) ON DELETE CASCADE,
      UNIQUE(planogram_id, shelf_id)
    );

    CREATE INDEX IF NOT EXISTS idx_planograms_venue_id ON planograms(venue_id);
    CREATE INDEX IF NOT EXISTS idx_shelf_planograms_planogram_id ON shelf_planograms(planogram_id);
    CREATE INDEX IF NOT EXISTS idx_shelf_planograms_shelf_id ON shelf_planograms(shelf_id);

    -- DWG Import tables
    CREATE TABLE IF NOT EXISTS dwg_imports (
      id TEXT PRIMARY KEY,
      venue_id TEXT,
      filename TEXT NOT NULL,
      units TEXT NOT NULL DEFAULT 'mm',
      unit_scale_to_m REAL NOT NULL DEFAULT 0.001,
      bounds_json TEXT,
      raw_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS dwg_groups (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      layer TEXT,
      block_name TEXT,
      count INTEGER NOT NULL DEFAULT 0,
      size_w REAL,
      size_d REAL,
      members_json TEXT,
      meta_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (import_id) REFERENCES dwg_imports(id) ON DELETE CASCADE,
      UNIQUE(import_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS dwg_mappings (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL,
      mapping_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (import_id) REFERENCES dwg_imports(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS dwg_layout_versions (
      id TEXT PRIMARY KEY,
      import_id TEXT NOT NULL,
      mapping_id TEXT,
      venue_id TEXT,
      name TEXT,
      layout_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (import_id) REFERENCES dwg_imports(id) ON DELETE CASCADE,
      FOREIGN KEY (mapping_id) REFERENCES dwg_mappings(id) ON DELETE SET NULL,
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dwg_imports_venue_id ON dwg_imports(venue_id);
    CREATE INDEX IF NOT EXISTS idx_dwg_groups_import_id ON dwg_groups(import_id);
    CREATE INDEX IF NOT EXISTS idx_dwg_mappings_import_id ON dwg_mappings(import_id);
    CREATE INDEX IF NOT EXISTS idx_dwg_layout_versions_import_id ON dwg_layout_versions(import_id);
    CREATE INDEX IF NOT EXISTS idx_dwg_layout_versions_venue_id ON dwg_layout_versions(venue_id);

    -- LiDAR Planner tables
    CREATE TABLE IF NOT EXISTS lidar_models (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hfov_deg REAL NOT NULL DEFAULT 360,
      vfov_deg REAL NOT NULL DEFAULT 30,
      range_m REAL NOT NULL DEFAULT 10,
      dome_mode INTEGER NOT NULL DEFAULT 1,
      notes_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lidar_instances (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      layout_version_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      model_id TEXT,
      x_m REAL NOT NULL DEFAULT 0,
      z_m REAL NOT NULL DEFAULT 0,
      mount_y_m REAL NOT NULL DEFAULT 3,
      yaw_deg REAL NOT NULL DEFAULT 0,
      params_override_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (layout_version_id) REFERENCES dwg_layout_versions(id) ON DELETE CASCADE,
      FOREIGN KEY (model_id) REFERENCES lidar_models(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS lidar_plan_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      layout_version_id TEXT NOT NULL,
      settings_json TEXT,
      results_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (layout_version_id) REFERENCES dwg_layout_versions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_lidar_instances_layout_version_id ON lidar_instances(layout_version_id);
    CREATE INDEX IF NOT EXISTS idx_lidar_instances_source ON lidar_instances(source);
    CREATE INDEX IF NOT EXISTS idx_lidar_plan_runs_layout_version_id ON lidar_plan_runs(layout_version_id);

    -- Edge Commissioning Portal tables
    CREATE TABLE IF NOT EXISTS edge_lidar_pairings (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      edge_tailscale_ip TEXT,
      placement_id TEXT NOT NULL,
      lidar_id TEXT NOT NULL,
      lidar_ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      UNIQUE(venue_id, placement_id)
    );

    CREATE TABLE IF NOT EXISTS edge_deploy_history (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      edge_tailscale_ip TEXT,
      config_hash TEXT NOT NULL,
      config_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      edge_response_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_edge_lidar_pairings_venue_id ON edge_lidar_pairings(venue_id);
    CREATE INDEX IF NOT EXISTS idx_edge_lidar_pairings_edge_id ON edge_lidar_pairings(edge_id);
    CREATE INDEX IF NOT EXISTS idx_edge_deploy_history_venue_id ON edge_deploy_history(venue_id);
    CREATE INDEX IF NOT EXISTS idx_edge_deploy_history_edge_id ON edge_deploy_history(edge_id);

    -- Commissioned LiDARs table (persists assigned IPs per venue)
    CREATE TABLE IF NOT EXISTS commissioned_lidars (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      assigned_ip TEXT NOT NULL,
      label TEXT,
      original_ip TEXT DEFAULT '192.168.1.200',
      vendor TEXT DEFAULT 'RoboSense',
      model TEXT,
      mac_address TEXT,
      commissioned_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      UNIQUE(venue_id, assigned_ip)
    );

    CREATE INDEX IF NOT EXISTS idx_commissioned_lidars_venue_id ON commissioned_lidars(venue_id);
    CREATE INDEX IF NOT EXISTS idx_commissioned_lidars_edge_id ON commissioned_lidars(edge_id);

    -- Edge devices table (stores custom display names for Tailscale edges)
    CREATE TABLE IF NOT EXISTS edge_devices (
      edge_id TEXT PRIMARY KEY,
      display_name TEXT,
      tailscale_ip TEXT,
      original_hostname TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Insert default LiDAR models if not exist
    INSERT OR IGNORE INTO lidar_models (id, name, hfov_deg, vfov_deg, range_m, dome_mode, notes_json) VALUES
      ('livox-mid360', 'Livox Mid-360', 360, 59, 40, 1, '{"manufacturer":"Livox","type":"solid-state"}'),
      ('ouster-os1-32', 'Ouster OS1-32', 360, 45, 120, 1, '{"manufacturer":"Ouster","type":"spinning","channels":32}'),
      ('velodyne-vlp16', 'Velodyne VLP-16', 360, 30, 100, 1, '{"manufacturer":"Velodyne","type":"spinning","channels":16}'),
      ('hesai-xt32', 'Hesai XT32', 360, 31, 120, 1, '{"manufacturer":"Hesai","type":"spinning","channels":32}');

    -- ============================================
    -- DOOH (Digital Out-Of-Home) Analytics Tables
    -- Feature flag: FEATURE_DOOH_KPIS
    -- ============================================

    -- DOOH Screens - Digital display screens with exposure zones
    CREATE TABLE IF NOT EXISTS dooh_screens (
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
      double_sided INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_screens_venue_id ON dooh_screens(venue_id);

    -- DOOH Exposure Events - Individual exposure events per track
    CREATE TABLE IF NOT EXISTS dooh_exposure_events (
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
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      FOREIGN KEY (screen_id) REFERENCES dooh_screens(id) ON DELETE CASCADE,
      UNIQUE(screen_id, track_key, start_ts)
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_exposure_events_venue_id ON dooh_exposure_events(venue_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_exposure_events_screen_id ON dooh_exposure_events(screen_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_exposure_events_start_ts ON dooh_exposure_events(start_ts);
    CREATE INDEX IF NOT EXISTS idx_dooh_exposure_events_tier ON dooh_exposure_events(tier);

    -- DOOH KPI Buckets - Aggregated metrics per screen per time bucket
    CREATE TABLE IF NOT EXISTS dooh_kpi_buckets (
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
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      FOREIGN KEY (screen_id) REFERENCES dooh_screens(id) ON DELETE CASCADE,
      UNIQUE(screen_id, bucket_start_ts, bucket_minutes)
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_kpi_buckets_venue_id ON dooh_kpi_buckets(venue_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_kpi_buckets_screen_id ON dooh_kpi_buckets(screen_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_kpi_buckets_bucket_start_ts ON dooh_kpi_buckets(bucket_start_ts);

    -- ============================================
    -- PEBLE™ DOOH Attribution Engine Tables
    -- Feature flag: FEATURE_DOOH_ATTRIBUTION
    -- Post-Exposure Behavioral Lift Engine
    -- ============================================

    -- DOOH Campaigns - Attribution campaign definitions
    CREATE TABLE IF NOT EXISTS dooh_campaigns (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      screen_ids_json TEXT NOT NULL,
      target_json TEXT NOT NULL,
      params_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_campaigns_venue_id ON dooh_campaigns(venue_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_campaigns_enabled ON dooh_campaigns(enabled);

    -- DOOH Attribution Events - Per exposure event attribution analysis
    CREATE TABLE IF NOT EXISTS dooh_attribution_events (
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
      converted INTEGER NOT NULL DEFAULT 0,
      tta_s REAL,
      dci_value REAL,
      confidence REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES dooh_campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (screen_id) REFERENCES dooh_screens(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_attribution_events_venue_id ON dooh_attribution_events(venue_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_attribution_events_campaign_id ON dooh_attribution_events(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_attribution_events_screen_id ON dooh_attribution_events(screen_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_attribution_events_exposure_ts ON dooh_attribution_events(exposure_end_ts);
    CREATE INDEX IF NOT EXISTS idx_dooh_attribution_events_track ON dooh_attribution_events(track_key);

    -- DOOH Control Matches - Matched control trajectories for attribution
    CREATE TABLE IF NOT EXISTS dooh_control_matches (
      id TEXT PRIMARY KEY,
      attribution_event_id TEXT NOT NULL,
      control_track_key TEXT NOT NULL,
      pseudo_exposure_ts INTEGER NOT NULL,
      match_distance REAL NOT NULL,
      control_outcome_json TEXT,
      control_converted INTEGER NOT NULL DEFAULT 0,
      control_tta_s REAL,
      control_dci_value REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (attribution_event_id) REFERENCES dooh_attribution_events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_control_matches_event_id ON dooh_control_matches(attribution_event_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_control_matches_track ON dooh_control_matches(control_track_key);

    -- DOOH Campaign KPIs - Aggregated attribution metrics per time bucket
    CREATE TABLE IF NOT EXISTS dooh_campaign_kpis (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      campaign_id TEXT NOT NULL,
      bucket_start_ts INTEGER NOT NULL,
      bucket_minutes INTEGER NOT NULL,
      exposed_count INTEGER NOT NULL DEFAULT 0,
      controls_count INTEGER NOT NULL DEFAULT 0,
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      FOREIGN KEY (campaign_id) REFERENCES dooh_campaigns(id) ON DELETE CASCADE,
      UNIQUE(campaign_id, bucket_start_ts, bucket_minutes)
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_campaign_kpis_venue_id ON dooh_campaign_kpis(venue_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_campaign_kpis_campaign_id ON dooh_campaign_kpis(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_campaign_kpis_bucket_ts ON dooh_campaign_kpis(bucket_start_ts);

    -- ============================================
    -- DOOH Playlist & Proof of Play Tables
    -- Feature: Video playlist management with proof-of-play tracking
    -- ============================================

    -- DOOH Playlist Videos - Individual video assets for screens
    CREATE TABLE IF NOT EXISTS dooh_playlist_videos (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      duration_ms INTEGER NOT NULL,
      file_size_bytes INTEGER,
      mime_type TEXT,
      thumbnail_path TEXT,
      width INTEGER,
      height INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_playlist_videos_venue_id ON dooh_playlist_videos(venue_id);

    -- DOOH Screen Playlist - Links videos to screens with ordering
    CREATE TABLE IF NOT EXISTS dooh_screen_playlist (
      id TEXT PRIMARY KEY,
      screen_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      order_index INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (screen_id) REFERENCES dooh_screens(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES dooh_playlist_videos(id) ON DELETE CASCADE,
      UNIQUE(screen_id, video_id)
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_screen_playlist_screen_id ON dooh_screen_playlist(screen_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_screen_playlist_video_id ON dooh_screen_playlist(video_id);

    -- DOOH Proof of Play - Records each video play event with timestamps
    CREATE TABLE IF NOT EXISTS dooh_proof_of_play (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      start_ts INTEGER NOT NULL,
      end_ts INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      loop_index INTEGER NOT NULL DEFAULT 0,
      playback_status TEXT NOT NULL DEFAULT 'completed',
      client_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      FOREIGN KEY (screen_id) REFERENCES dooh_screens(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES dooh_playlist_videos(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_proof_of_play_venue_id ON dooh_proof_of_play(venue_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_proof_of_play_screen_id ON dooh_proof_of_play(screen_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_proof_of_play_video_id ON dooh_proof_of_play(video_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_proof_of_play_start_ts ON dooh_proof_of_play(start_ts);
    CREATE INDEX IF NOT EXISTS idx_dooh_proof_of_play_end_ts ON dooh_proof_of_play(end_ts);
    CREATE INDEX IF NOT EXISTS idx_dooh_proof_of_play_screen_time ON dooh_proof_of_play(screen_id, start_ts, end_ts);
    CREATE INDEX IF NOT EXISTS idx_dooh_exposure_events_screen_time ON dooh_exposure_events(screen_id, start_ts);

    -- DOOH Video KPI Buckets - Aggregated metrics per video per time bucket
    CREATE TABLE IF NOT EXISTS dooh_video_kpi_buckets (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      screen_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      bucket_start_ts INTEGER NOT NULL,
      bucket_minutes INTEGER NOT NULL,
      play_count INTEGER NOT NULL DEFAULT 0,
      total_play_duration_ms INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      qualified_impressions INTEGER NOT NULL DEFAULT 0,
      unique_viewers INTEGER NOT NULL DEFAULT 0,
      avg_dwell_s REAL,
      completion_rate REAL,
      avg_aqs REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE,
      FOREIGN KEY (screen_id) REFERENCES dooh_screens(id) ON DELETE CASCADE,
      FOREIGN KEY (video_id) REFERENCES dooh_playlist_videos(id) ON DELETE CASCADE,
      UNIQUE(screen_id, video_id, bucket_start_ts, bucket_minutes)
    );

    CREATE INDEX IF NOT EXISTS idx_dooh_video_kpi_buckets_screen_id ON dooh_video_kpi_buckets(screen_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_video_kpi_buckets_video_id ON dooh_video_kpi_buckets(video_id);
    CREATE INDEX IF NOT EXISTS idx_dooh_video_kpi_buckets_bucket_ts ON dooh_video_kpi_buckets(bucket_start_ts);
  `);

  // Migration: Add DWG-related columns to venues table if they don't exist
  try {
    const venueColumns = db.prepare("PRAGMA table_info(venues)").all();
    const columnNames = venueColumns.map(c => c.name);
    
    if (!columnNames.includes('scene_source')) {
      db.exec("ALTER TABLE venues ADD COLUMN scene_source TEXT NOT NULL DEFAULT 'manual'");
      console.log('📦 Migration: Added scene_source column to venues');
    }
    if (!columnNames.includes('dwg_layout_version_id')) {
      db.exec("ALTER TABLE venues ADD COLUMN dwg_layout_version_id TEXT DEFAULT NULL");
      console.log('📦 Migration: Added dwg_layout_version_id column to venues');
    }
    if (!columnNames.includes('dwg_transform_json')) {
      db.exec("ALTER TABLE venues ADD COLUMN dwg_transform_json TEXT DEFAULT NULL");
      console.log('📦 Migration: Added dwg_transform_json column to venues');
    }
  } catch (migrationErr) {
    console.log('📦 Migration check completed (columns may already exist)');
  }

  // Migration for dooh_screens double_sided column
  try {
    const doohColumns = db.prepare("PRAGMA table_info(dooh_screens)").all();
    const doohColumnNames = doohColumns.map(c => c.name);
    if (doohColumnNames.length > 0 && !doohColumnNames.includes('double_sided')) {
      db.exec("ALTER TABLE dooh_screens ADD COLUMN double_sided INTEGER NOT NULL DEFAULT 0");
      console.log('📦 Migration: Added double_sided column to dooh_screens');
    }
  } catch (migrationErr) {
    // Table may not exist yet, that's fine
  }

  // Migration for shelf_planograms slot_facings column
  try {
    const shelfPlanogramColumns = db.prepare("PRAGMA table_info(shelf_planograms)").all();
    const shelfPlanogramColumnNames = shelfPlanogramColumns.map(c => c.name);
    
    // Check if we need to add slot_facings column
    if (shelfPlanogramColumnNames.length > 0 && !shelfPlanogramColumnNames.includes('slot_facings')) {
      db.exec("ALTER TABLE shelf_planograms ADD COLUMN slot_facings TEXT DEFAULT NULL");
      console.log('📦 Migration: Added slot_facings column to shelf_planograms');
      
      // Migrate old slot_facing data to slot_facings if it exists
      if (shelfPlanogramColumnNames.includes('slot_facing')) {
        db.exec("UPDATE shelf_planograms SET slot_facings = '[\"' || slot_facing || '\"]' WHERE slot_facing IS NOT NULL AND slot_facing != ''");
        console.log('📦 Migration: Migrated slot_facing to slot_facings');
      }
    }
  } catch (migrationErr) {
    console.error('Migration error:', migrationErr);
    // Table may not exist yet, that's fine
  }

  // Migration for regions_of_interest metadata_json column
  try {
    const roiColumns = db.prepare("PRAGMA table_info(regions_of_interest)").all();
    const roiColumnNames = roiColumns.map(c => c.name);
    
    if (roiColumnNames.length > 0 && !roiColumnNames.includes('metadata_json')) {
      db.exec("ALTER TABLE regions_of_interest ADD COLUMN metadata_json TEXT DEFAULT NULL");
      console.log('📦 Migration: Added metadata_json column to regions_of_interest');
    }
  } catch (migrationErr) {
    // Table may not exist yet, that's fine
  }

  console.log('📦 Database initialized');
  return db;
}

// Helper functions for venue operations
export const venueQueries = {
  getAll: (db) => db.prepare('SELECT * FROM venues ORDER BY updated_at DESC').all(),
  
  getById: (db, id) => db.prepare('SELECT * FROM venues WHERE id = ?').get(id),
  
  create: (db, venue) => {
    const stmt = db.prepare(`
      INSERT INTO venues (id, name, width, depth, height, tile_size, scene_source, dwg_layout_version_id, dwg_transform_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      venue.id,
      venue.name,
      venue.width,
      venue.depth,
      venue.height,
      venue.tileSize,
      venue.sceneSource || 'manual',
      venue.dwgLayoutVersionId || null,
      venue.dwgTransformJson ? JSON.stringify(venue.dwgTransformJson) : null,
      venue.createdAt,
      venue.updatedAt
    );
  },
  
  update: (db, id, venue) => {
    const stmt = db.prepare(`
      UPDATE venues SET name = ?, width = ?, depth = ?, height = ?, tile_size = ?, updated_at = ?
      WHERE id = ?
    `);
    return stmt.run(
      venue.name,
      venue.width,
      venue.depth,
      venue.height,
      venue.tileSize,
      new Date().toISOString(),
      id
    );
  },
  
  delete: (db, id) => db.prepare('DELETE FROM venues WHERE id = ?').run(id),
};

// Helper functions for venue objects
export const objectQueries = {
  getByVenueId: (db, venueId) => {
    const rows = db.prepare('SELECT * FROM venue_objects WHERE venue_id = ?').all(venueId);
    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      type: row.type,
      name: row.name,
      position: { x: row.position_x, y: row.position_y, z: row.position_z },
      rotation: { x: row.rotation_x, y: row.rotation_y, z: row.rotation_z },
      scale: { x: row.scale_x, y: row.scale_y, z: row.scale_z },
      color: row.color,
    }));
  },
  
  create: (db, obj) => {
    const stmt = db.prepare(`
      INSERT INTO venue_objects (id, venue_id, type, name, position_x, position_y, position_z, 
        rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      obj.id, obj.venueId, obj.type, obj.name,
      obj.position.x, obj.position.y, obj.position.z,
      obj.rotation.x, obj.rotation.y, obj.rotation.z,
      obj.scale.x, obj.scale.y, obj.scale.z,
      obj.color
    );
  },
  
  deleteByVenueId: (db, venueId) => {
    return db.prepare('DELETE FROM venue_objects WHERE venue_id = ?').run(venueId);
  },
};

// Helper functions for LiDAR placements
export const placementQueries = {
  getByVenueId: (db, venueId) => {
    const rows = db.prepare('SELECT * FROM lidar_placements WHERE venue_id = ?').all(venueId);
    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      deviceId: row.device_id,
      position: { x: row.position_x, y: row.position_y, z: row.position_z },
      rotation: { x: row.rotation_x, y: row.rotation_y, z: row.rotation_z },
      mountHeight: row.mount_height,
      fovHorizontal: row.fov_horizontal,
      fovVertical: row.fov_vertical,
      range: row.range,
      enabled: !!row.enabled,
    }));
  },
  
  create: (db, placement) => {
    const stmt = db.prepare(`
      INSERT INTO lidar_placements (id, venue_id, device_id, position_x, position_y, position_z,
        rotation_x, rotation_y, rotation_z, mount_height, fov_horizontal, fov_vertical, range, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      placement.id, placement.venueId, placement.deviceId,
      placement.position.x, placement.position.y, placement.position.z,
      placement.rotation.x, placement.rotation.y, placement.rotation.z,
      placement.mountHeight, placement.fovHorizontal, placement.fovVertical,
      placement.range, placement.enabled ? 1 : 0
    );
  },
  
  deleteByVenueId: (db, venueId) => {
    return db.prepare('DELETE FROM lidar_placements WHERE venue_id = ?').run(venueId);
  },
};

// Helper functions for Regions of Interest
export const roiQueries = {
  // Get ROIs for manual/venue mode (dwg_layout_id IS NULL)
  getByVenueId: (db, venueId) => {
    const rows = db.prepare('SELECT * FROM regions_of_interest WHERE venue_id = ? AND dwg_layout_id IS NULL').all(venueId);
    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      dwgLayoutId: row.dwg_layout_id,
      name: row.name,
      vertices: JSON.parse(row.vertices),
      color: row.color,
      opacity: row.opacity,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  // Get ROIs for DWG mode (specific dwg_layout_id)
  getByDwgLayoutId: (db, venueId, dwgLayoutId) => {
    const rows = db.prepare('SELECT * FROM regions_of_interest WHERE venue_id = ? AND dwg_layout_id = ?').all(venueId, dwgLayoutId);
    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      dwgLayoutId: row.dwg_layout_id,
      name: row.name,
      vertices: JSON.parse(row.vertices),
      color: row.color,
      opacity: row.opacity,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },
  
  getById: (db, id) => {
    const row = db.prepare('SELECT * FROM regions_of_interest WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      venueId: row.venue_id,
      dwgLayoutId: row.dwg_layout_id,
      name: row.name,
      vertices: JSON.parse(row.vertices),
      color: row.color,
      opacity: row.opacity,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
  
  create: (db, roi) => {
    const stmt = db.prepare(`
      INSERT INTO regions_of_interest (id, venue_id, dwg_layout_id, name, vertices, color, opacity, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      roi.id,
      roi.venueId,
      roi.dwgLayoutId || null,
      roi.name,
      JSON.stringify(roi.vertices),
      roi.color,
      roi.opacity,
      roi.metadata ? JSON.stringify(roi.metadata) : null,
      roi.createdAt,
      roi.updatedAt
    );
  },
  
  update: (db, id, roi) => {
    const stmt = db.prepare(`
      UPDATE regions_of_interest 
      SET name = ?, vertices = ?, color = ?, opacity = ?, metadata_json = ?, updated_at = ?
      WHERE id = ?
    `);
    return stmt.run(
      roi.name,
      JSON.stringify(roi.vertices),
      roi.color,
      roi.opacity,
      roi.metadata ? JSON.stringify(roi.metadata) : null,
      new Date().toISOString(),
      id
    );
  },
  
  delete: (db, id) => {
    return db.prepare('DELETE FROM regions_of_interest WHERE id = ?').run(id);
  },
  
  deleteByVenueId: (db, venueId) => {
    return db.prepare('DELETE FROM regions_of_interest WHERE venue_id = ?').run(venueId);
  },
};

// Helper functions for SKU Catalogs
export const skuCatalogQueries = {
  getAll: (db) => db.prepare('SELECT * FROM sku_catalogs ORDER BY updated_at DESC').all(),
  
  getById: (db, id) => db.prepare('SELECT * FROM sku_catalogs WHERE id = ?').get(id),
  
  create: (db, catalog) => {
    const stmt = db.prepare(`
      INSERT INTO sku_catalogs (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    return stmt.run(catalog.id, catalog.name, catalog.description, catalog.createdAt, catalog.updatedAt);
  },
  
  update: (db, id, catalog) => {
    const stmt = db.prepare(`UPDATE sku_catalogs SET name = ?, description = ?, updated_at = ? WHERE id = ?`);
    return stmt.run(catalog.name, catalog.description, new Date().toISOString(), id);
  },
  
  delete: (db, id) => db.prepare('DELETE FROM sku_catalogs WHERE id = ?').run(id),
};

// Helper functions for SKU Items
export const skuItemQueries = {
  getByCatalogId: (db, catalogId) => {
    const rows = db.prepare('SELECT * FROM sku_items WHERE catalog_id = ? ORDER BY category, name').all(catalogId);
    return rows.map(row => ({
      id: row.id,
      catalogId: row.catalog_id,
      skuCode: row.sku_code,
      name: row.name,
      brand: row.brand,
      category: row.category,
      subcategory: row.subcategory,
      size: row.size,
      widthM: row.width_m,
      heightM: row.height_m,
      depthM: row.depth_m,
      price: row.price,
      margin: row.margin,
      imageUrl: row.image_url,
      meta: row.meta_json ? JSON.parse(row.meta_json) : null,
    }));
  },
  
  getById: (db, id) => {
    const row = db.prepare('SELECT * FROM sku_items WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      catalogId: row.catalog_id,
      skuCode: row.sku_code,
      name: row.name,
      brand: row.brand,
      category: row.category,
      subcategory: row.subcategory,
      size: row.size,
      widthM: row.width_m,
      heightM: row.height_m,
      depthM: row.depth_m,
      price: row.price,
      margin: row.margin,
      imageUrl: row.image_url,
      meta: row.meta_json ? JSON.parse(row.meta_json) : null,
    };
  },
  
  create: (db, item) => {
    const stmt = db.prepare(`
      INSERT INTO sku_items (id, catalog_id, sku_code, name, brand, category, subcategory, size, 
        width_m, height_m, depth_m, price, margin, image_url, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      item.id, item.catalogId, item.skuCode, item.name, item.brand, item.category, item.subcategory,
      item.size, item.widthM, item.heightM, item.depthM, item.price, item.margin, item.imageUrl,
      item.meta ? JSON.stringify(item.meta) : null
    );
  },
  
  bulkCreate: (db, items) => {
    const stmt = db.prepare(`
      INSERT INTO sku_items (id, catalog_id, sku_code, name, brand, category, subcategory, size,
        width_m, height_m, depth_m, price, margin, image_url, meta_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMany = db.transaction((items) => {
      for (const item of items) {
        stmt.run(
          item.id, item.catalogId, item.skuCode, item.name, item.brand, item.category, item.subcategory,
          item.size, item.widthM, item.heightM, item.depthM, item.price, item.margin, item.imageUrl,
          item.meta ? JSON.stringify(item.meta) : null
        );
      }
    });
    return insertMany(items);
  },
  
  deleteByCatalogId: (db, catalogId) => db.prepare('DELETE FROM sku_items WHERE catalog_id = ?').run(catalogId),
  
  getCategories: (db, catalogId) => {
    return db.prepare('SELECT DISTINCT category FROM sku_items WHERE catalog_id = ? AND category IS NOT NULL ORDER BY category').all(catalogId);
  },
  
  getBrands: (db, catalogId) => {
    return db.prepare('SELECT DISTINCT brand FROM sku_items WHERE catalog_id = ? AND brand IS NOT NULL ORDER BY brand').all(catalogId);
  },
};

// Helper functions for Planograms
export const planogramQueries = {
  getByVenueId: (db, venueId) => {
    const rows = db.prepare('SELECT * FROM planograms WHERE venue_id = ? ORDER BY version DESC').all(venueId);
    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      name: row.name,
      version: row.version,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },
  
  getById: (db, id) => {
    const row = db.prepare('SELECT * FROM planograms WHERE id = ?').get(id);
    if (!row) return null;
    return {
      id: row.id,
      venueId: row.venue_id,
      name: row.name,
      version: row.version,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
  
  create: (db, planogram) => {
    const stmt = db.prepare(`
      INSERT INTO planograms (id, venue_id, name, version, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      planogram.id, planogram.venueId, planogram.name, planogram.version,
      planogram.status || 'draft', planogram.createdAt, planogram.updatedAt
    );
  },
  
  update: (db, id, planogram) => {
    const stmt = db.prepare(`UPDATE planograms SET name = ?, status = ?, updated_at = ? WHERE id = ?`);
    return stmt.run(planogram.name, planogram.status, new Date().toISOString(), id);
  },
  
  delete: (db, id) => db.prepare('DELETE FROM planograms WHERE id = ?').run(id),
  
  getNextVersion: (db, venueId) => {
    const row = db.prepare('SELECT MAX(version) as max_version FROM planograms WHERE venue_id = ?').get(venueId);
    return (row?.max_version || 0) + 1;
  },
};

// Helper functions for Shelf Planograms
export const shelfPlanogramQueries = {
  getByPlanogramId: (db, planogramId) => {
    const rows = db.prepare('SELECT * FROM shelf_planograms WHERE planogram_id = ?').all(planogramId);
    return rows.map(row => ({
      id: row.id,
      planogramId: row.planogram_id,
      shelfId: row.shelf_id,
      numLevels: row.num_levels,
      slotWidthM: row.slot_width_m,
      levelHeightM: row.level_height_m,
      slotFacings: row.slot_facings ? JSON.parse(row.slot_facings) : [],
      slots: JSON.parse(row.slots_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },
  
  getByShelfId: (db, planogramId, shelfId) => {
    const row = db.prepare('SELECT * FROM shelf_planograms WHERE planogram_id = ? AND shelf_id = ?').get(planogramId, shelfId);
    if (!row) return null;
    return {
      id: row.id,
      planogramId: row.planogram_id,
      shelfId: row.shelf_id,
      numLevels: row.num_levels,
      slotWidthM: row.slot_width_m,
      levelHeightM: row.level_height_m,
      slotFacings: row.slot_facings ? JSON.parse(row.slot_facings) : [],
      slots: JSON.parse(row.slots_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
  
  upsert: (db, shelfPlanogram) => {
    // Use INSERT OR REPLACE for simpler atomic upsert
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO shelf_planograms (id, planogram_id, shelf_id, num_levels, slot_width_m, level_height_m, slot_facings, slots_json, created_at, updated_at)
      VALUES (
        COALESCE((SELECT id FROM shelf_planograms WHERE planogram_id = ? AND shelf_id = ?), ?),
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
    
    const now = new Date().toISOString();
    const result = stmt.run(
      shelfPlanogram.planogramId, shelfPlanogram.shelfId, shelfPlanogram.id,
      shelfPlanogram.planogramId, shelfPlanogram.shelfId,
      shelfPlanogram.numLevels, shelfPlanogram.slotWidthM, shelfPlanogram.levelHeightM,
      shelfPlanogram.slotFacings ? JSON.stringify(shelfPlanogram.slotFacings) : null, 
      JSON.stringify(shelfPlanogram.slots), now, now
    );
    
    return result;
  },
  
  delete: (db, id) => db.prepare('DELETE FROM shelf_planograms WHERE id = ?').run(id),
  
  deleteByPlanogramId: (db, planogramId) => db.prepare('DELETE FROM shelf_planograms WHERE planogram_id = ?').run(planogramId),
};
