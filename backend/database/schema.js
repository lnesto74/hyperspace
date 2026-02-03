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
  
  // Enable foreign keys
  db.pragma('foreign_keys = ON');

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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    CREATE TABLE IF NOT EXISTS regions_of_interest (
      id TEXT PRIMARY KEY,
      venue_id TEXT NOT NULL,
      name TEXT NOT NULL,
      vertices TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#f59e0b',
      opacity REAL NOT NULL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_venue_objects_venue_id ON venue_objects(venue_id);
    CREATE INDEX IF NOT EXISTS idx_lidar_placements_venue_id ON lidar_placements(venue_id);
    CREATE INDEX IF NOT EXISTS idx_regions_of_interest_venue_id ON regions_of_interest(venue_id);
  `);

  console.log('📦 Database initialized');
  return db;
}

// Helper functions for venue operations
export const venueQueries = {
  getAll: (db) => db.prepare('SELECT * FROM venues ORDER BY updated_at DESC').all(),
  
  getById: (db, id) => db.prepare('SELECT * FROM venues WHERE id = ?').get(id),
  
  create: (db, venue) => {
    const stmt = db.prepare(`
      INSERT INTO venues (id, name, width, depth, height, tile_size, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      venue.id,
      venue.name,
      venue.width,
      venue.depth,
      venue.height,
      venue.tileSize,
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
  getByVenueId: (db, venueId) => {
    const rows = db.prepare('SELECT * FROM regions_of_interest WHERE venue_id = ?').all(venueId);
    return rows.map(row => ({
      id: row.id,
      venueId: row.venue_id,
      name: row.name,
      vertices: JSON.parse(row.vertices),
      color: row.color,
      opacity: row.opacity,
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
      name: row.name,
      vertices: JSON.parse(row.vertices),
      color: row.color,
      opacity: row.opacity,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },
  
  create: (db, roi) => {
    const stmt = db.prepare(`
      INSERT INTO regions_of_interest (id, venue_id, name, vertices, color, opacity, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      roi.id,
      roi.venueId,
      roi.name,
      JSON.stringify(roi.vertices),
      roi.color,
      roi.opacity,
      roi.createdAt,
      roi.updatedAt
    );
  },
  
  update: (db, id, roi) => {
    const stmt = db.prepare(`
      UPDATE regions_of_interest 
      SET name = ?, vertices = ?, color = ?, opacity = ?, updated_at = ?
      WHERE id = ?
    `);
    return stmt.run(
      roi.name,
      JSON.stringify(roi.vertices),
      roi.color,
      roi.opacity,
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
