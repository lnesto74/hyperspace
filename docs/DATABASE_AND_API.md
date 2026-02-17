# Hyperspace Platform — Database & API Reference

> **Version:** 1.0 | **Last Updated:** February 2026

Hyperspace is a spatial analytics platform that transforms physical retail spaces into intelligent environments through LiDAR-based people tracking, planogram management, and Digital Out-of-Home (DOOH) advertising analytics.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Database Schema](#database-schema)
   - [Core Tables](#core-tables)
   - [LiDAR & Edge Tables](#lidar--edge-tables)
   - [Planogram Tables](#planogram-tables)
   - [DWG Import Tables](#dwg-import-tables)
   - [DOOH Analytics Tables](#dooh-analytics-tables)
   - [DOOH Attribution Tables](#dooh-attribution-tables)
3. [REST API Reference](#rest-api-reference)
   - [Venues API](#venues-api)
   - [Regions of Interest (ROI) API](#regions-of-interest-roi-api)
   - [KPI & Analytics API](#kpi--analytics-api)
   - [Planogram API](#planogram-api)
   - [DWG Import API](#dwg-import-api)
   - [LiDAR Planner API](#lidar-planner-api)
   - [Edge Commissioning API](#edge-commissioning-api)
   - [DOOH Analytics API](#dooh-analytics-api)
   - [DOOH Attribution API](#dooh-attribution-api)
   - [Business Reporting API](#business-reporting-api)
   - [AI Narrator API](#ai-narrator-api)
4. [WebSocket Events](#websocket-events)
5. [Feature Flags](#feature-flags)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HYPERSPACE PLATFORM                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Frontend   │    │   Backend    │    │   Edge       │                   │
│  │   (React)    │◄──►│   (Express)  │◄──►│   Devices    │                   │
│  └──────────────┘    └──────┬───────┘    └──────────────┘                   │
│                             │                                                │
│                    ┌────────▼────────┐                                       │
│                    │    SQLite DB    │                                       │
│                    │  (better-sqlite3)│                                      │
│                    └─────────────────┘                                       │
│                                                                              │
│  Feature Modules:                                                            │
│  ├── Venue Builder (3D spatial layout)                                       │
│  ├── DWG Importer (CAD floor plans)                                          │
│  ├── LiDAR Planner (sensor coverage optimization)                            │
│  ├── Planogram Builder (shelf product placement)                             │
│  ├── Edge Commissioning (LiDAR network setup)                                │
│  ├── DOOH Analytics (digital signage measurement)                            │
│  ├── PEBLE™ Attribution (post-exposure lift engine)                          │
│  └── Business Reporting (persona-based dashboards)                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Tech Stack:**
- **Database:** SQLite via `better-sqlite3`
- **Backend:** Node.js + Express
- **Real-time:** Socket.IO
- **Frontend:** React + TypeScript + Three.js
- **Edge Integration:** Tailscale VPN + MQTT

---

## Database Schema

### Core Tables

#### `venues`
Central table for physical retail locations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `name` | TEXT | Venue display name |
| `width` | REAL | Floor width in meters (default: 20) |
| `depth` | REAL | Floor depth in meters (default: 15) |
| `height` | REAL | Ceiling height in meters (default: 4) |
| `tile_size` | REAL | Grid tile size in meters (default: 1) |
| `scene_source` | TEXT | `manual` or `dwg` |
| `dwg_layout_version_id` | TEXT FK | Reference to active DWG layout |
| `dwg_transform_json` | TEXT | JSON transformation matrix |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `venue_objects`
3D objects placed within venues (shelves, displays, fixtures).

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `type` | TEXT | Object type (`shelf`, `digital_display`, `checkout`, etc.) |
| `name` | TEXT | Display name |
| `position_x/y/z` | REAL | 3D position in meters |
| `rotation_x/y/z` | REAL | Euler rotation in radians |
| `scale_x/y/z` | REAL | Scale multipliers |
| `color` | TEXT | Hex color code |
| `created_at` | TEXT | ISO timestamp |

#### `regions_of_interest`
Polygonal zones for spatial analytics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `dwg_layout_id` | TEXT FK | NULL = manual mode, otherwise DWG mode |
| `name` | TEXT | Zone name |
| `vertices` | TEXT | JSON array of `{x, z}` coordinates |
| `color` | TEXT | Hex color (default: `#f59e0b`) |
| `opacity` | REAL | 0.0–1.0 (default: 0.5) |
| `metadata_json` | TEXT | Optional metadata |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `custom_models`
Custom 3D model uploads for object types.

| Column | Type | Description |
|--------|------|-------------|
| `object_type` | TEXT PK | Object type identifier |
| `file_path` | TEXT | Server path to GLTF/GLB file |
| `original_name` | TEXT | Original upload filename |
| `uploaded_at` | TEXT | ISO timestamp |

---

### LiDAR & Edge Tables

#### `lidar_placements`
Virtual LiDAR sensor positions in venue design mode.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `device_id` | TEXT | Logical device identifier |
| `position_x/y/z` | REAL | 3D mount position |
| `rotation_x/y/z` | REAL | Sensor orientation |
| `mount_height` | REAL | Height in meters (default: 3) |
| `fov_horizontal` | REAL | Horizontal FOV degrees (default: 120) |
| `fov_vertical` | REAL | Vertical FOV degrees (default: 30) |
| `range` | REAL | Detection range in meters (default: 10) |
| `enabled` | INTEGER | 1 = enabled |
| `created_at` | TEXT | ISO timestamp |

#### `lidar_models`
Catalog of supported LiDAR sensor models.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Model slug (e.g., `livox-mid360`) |
| `name` | TEXT | Display name |
| `hfov_deg` | REAL | Horizontal FOV (default: 360) |
| `vfov_deg` | REAL | Vertical FOV (default: 30) |
| `range_m` | REAL | Max range in meters |
| `dome_mode` | INTEGER | 1 = dome visualization |
| `notes_json` | TEXT | Manufacturer metadata |
| `created_at` | TEXT | ISO timestamp |

**Pre-seeded models:** Livox Mid-360, Ouster OS1-32, Velodyne VLP-16, Hesai XT32

#### `lidar_instances`
LiDAR placements in LiDAR Planner mode.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `project_id` | TEXT | Optional project grouping |
| `layout_version_id` | TEXT FK | DWG layout version |
| `source` | TEXT | `manual` or `auto` |
| `model_id` | TEXT FK | Reference to lidar_models |
| `x_m` / `z_m` | REAL | Floor position |
| `mount_y_m` | REAL | Mount height (default: 3) |
| `yaw_deg` | REAL | Rotation in degrees |
| `params_override_json` | TEXT | Override model defaults |
| `created_at` | TEXT | ISO timestamp |

#### `edge_devices`
Registered edge computing devices.

| Column | Type | Description |
|--------|------|-------------|
| `edge_id` | TEXT PK | Tailscale node ID |
| `display_name` | TEXT | Custom name |
| `tailscale_ip` | TEXT | VPN IP address |
| `original_hostname` | TEXT | Tailscale hostname |
| `notes` | TEXT | Admin notes |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `commissioned_lidars`
LiDAR sensors assigned to edge devices.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `edge_id` | TEXT | Edge device ID |
| `assigned_ip` | TEXT | Network IP |
| `label` | TEXT | Human label |
| `original_ip` | TEXT | Factory default IP |
| `vendor` | TEXT | Manufacturer |
| `model` | TEXT | Model name |
| `mac_address` | TEXT | MAC address |
| `commissioned_at` | TEXT | ISO timestamp |
| `last_seen_at` | TEXT | Last heartbeat |
| `status` | TEXT | `active`, `offline` |

---

### Planogram Tables

#### `sku_catalogs`
Product catalog containers.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `name` | TEXT | Catalog name |
| `description` | TEXT | Description |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `sku_items`
Individual products in catalogs.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `catalog_id` | TEXT FK | Parent catalog |
| `sku_code` | TEXT | Product SKU |
| `name` | TEXT | Product name |
| `brand` | TEXT | Brand name |
| `category` | TEXT | Category |
| `subcategory` | TEXT | Subcategory |
| `size` | TEXT | Pack size |
| `width_m` / `height_m` / `depth_m` | REAL | Product dimensions |
| `price` | REAL | Price |
| `margin` | REAL | Profit margin |
| `image_url` | TEXT | Product image |
| `meta_json` | TEXT | Additional metadata |
| `created_at` | TEXT | ISO timestamp |

#### `planograms`
Planogram versions per venue.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `name` | TEXT | Planogram name |
| `version` | INTEGER | Auto-increment version |
| `status` | TEXT | `draft`, `active`, `archived` |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `shelf_planograms`
Product placement configuration per shelf.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `planogram_id` | TEXT FK | Parent planogram |
| `shelf_id` | TEXT FK | Reference to venue_objects |
| `num_levels` | INTEGER | Number of shelf levels (default: 4) |
| `slot_width_m` | REAL | Slot width (default: 0.1) |
| `level_height_m` | REAL | Level height |
| `slot_facings` | TEXT | JSON array of facing directions |
| `slots_json` | TEXT | JSON slot assignments |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

---

### DWG Import Tables

#### `dwg_imports`
Uploaded CAD files.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Target venue |
| `filename` | TEXT | Original filename |
| `units` | TEXT | Source units (default: `mm`) |
| `unit_scale_to_m` | REAL | Scale factor to meters |
| `bounds_json` | TEXT | Bounding box |
| `raw_json` | TEXT | Parsed DXF data |
| `status` | TEXT | `pending`, `processed`, `error` |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `dwg_groups`
Grouped fixtures detected from CAD.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `import_id` | TEXT FK | Parent import |
| `group_id` | TEXT | Logical group ID |
| `layer` | TEXT | DXF layer name |
| `block_name` | TEXT | DXF block name |
| `count` | INTEGER | Instance count |
| `size_w` / `size_d` | REAL | Dimensions |
| `members_json` | TEXT | Group member positions |
| `meta_json` | TEXT | Additional metadata |
| `created_at` | TEXT | ISO timestamp |

#### `dwg_mappings`
Fixture type mappings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `import_id` | TEXT FK | Parent import |
| `mapping_json` | TEXT | Group → object type mapping |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `dwg_layout_versions`
Saved layout versions from DWG imports.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `import_id` | TEXT FK | Source import |
| `mapping_id` | TEXT FK | Applied mapping |
| `venue_id` | TEXT FK | Target venue |
| `name` | TEXT | Version name |
| `layout_json` | TEXT | Complete layout data |
| `is_active` | INTEGER | 1 = current active |
| `created_at` | TEXT | ISO timestamp |

---

### DOOH Analytics Tables

#### `dooh_screens`
Digital display screens with exposure zones.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `object_id` | TEXT | Link to venue_objects |
| `name` | TEXT | Screen name |
| `position_json` | TEXT | JSON `{x, y, z}` |
| `yaw_deg` | REAL | Facing direction |
| `mount_height_m` | REAL | Height in meters |
| `sez_polygon_json` | TEXT | Standard Exposure Zone polygon |
| `az_polygon_json` | TEXT | Optional Attention Zone |
| `params_json` | TEXT | AQS scoring parameters |
| `double_sided` | INTEGER | 1 = double-sided screen |
| `enabled` | INTEGER | 1 = active |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

#### `dooh_exposure_events`
Individual visitor exposure events.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `screen_id` | TEXT FK | Screen reference |
| `track_key` | TEXT | Visitor track ID |
| `start_ts` / `end_ts` | INTEGER | Unix timestamps (ms) |
| `duration_s` | REAL | Total duration |
| `effective_dwell_s` | REAL | Quality-weighted dwell |
| `min_distance_m` | REAL | Closest approach |
| `p10_distance_m` | REAL | 10th percentile distance |
| `mean_speed_mps` / `min_speed_mps` | REAL | Movement speeds |
| `entry_speed_mps` | REAL | Speed at zone entry |
| `orientation_score` | REAL | 0–1 facing score |
| `proximity_score` | REAL | 0–1 distance score |
| `dwell_score` | REAL | 0–1 time score |
| `slowdown_score` | REAL | 0–1 deceleration score |
| `stability_score` | REAL | 0–1 stability score |
| `aqs` | REAL | Attention Quality Score (0–100) |
| `tier` | TEXT | `premium`, `standard`, `glance` |
| `context_json` | TEXT | Behavioral context |
| `created_at` | TEXT | ISO timestamp |

#### `dooh_kpi_buckets`
Time-aggregated screen metrics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `screen_id` | TEXT FK | Screen reference |
| `bucket_start_ts` | INTEGER | Bucket start (Unix ms) |
| `bucket_minutes` | INTEGER | Bucket size (15, 60, etc.) |
| `impressions` | INTEGER | Total impressions |
| `qualified_impressions` | INTEGER | AQS ≥ 50 |
| `premium_impressions` | INTEGER | AQS ≥ 75 |
| `unique_visitors` | INTEGER | Unique track count |
| `avg_aqs` / `p75_aqs` | REAL | AQS statistics |
| `total_attention_s` | REAL | Sum of attention time |
| `avg_attention_s` | REAL | Mean attention time |
| `freq_avg` | REAL | Average exposure frequency |
| `context_breakdown_json` | TEXT | By-context metrics |
| `created_at` | TEXT | ISO timestamp |

#### `dooh_playlist_videos`
Video assets for screen playlists.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `name` | TEXT | Video name |
| `filename` | TEXT | Storage filename |
| `file_path` | TEXT | Server path |
| `duration_ms` | INTEGER | Duration in milliseconds |
| `file_size_bytes` | INTEGER | File size |
| `mime_type` | TEXT | MIME type |
| `thumbnail_path` | TEXT | Thumbnail image |
| `width` / `height` | INTEGER | Video dimensions |
| `created_at` | TEXT | ISO timestamp |

#### `dooh_screen_playlist`
Video assignments to screens.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `screen_id` | TEXT FK | Target screen |
| `video_id` | TEXT FK | Video reference |
| `order_index` | INTEGER | Playlist order |
| `enabled` | INTEGER | 1 = active |
| `created_at` | TEXT | ISO timestamp |

#### `dooh_proof_of_play`
Verified video playback events.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `screen_id` | TEXT FK | Screen reference |
| `video_id` | TEXT FK | Video reference |
| `start_ts` / `end_ts` | INTEGER | Play timestamps |
| `duration_ms` | INTEGER | Actual play duration |
| `loop_index` | INTEGER | Loop iteration |
| `playback_status` | TEXT | `completed`, `interrupted` |
| `client_id` | TEXT | Reporting client ID |
| `created_at` | TEXT | ISO timestamp |

---

### DOOH Attribution Tables

#### `dooh_campaigns`
PEBLE™ attribution campaigns.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `name` | TEXT | Campaign name |
| `screen_ids_json` | TEXT | JSON array of screen IDs |
| `target_json` | TEXT | Target definition `{type, ids}` |
| `params_json` | TEXT | Attribution parameters |
| `enabled` | INTEGER | 1 = active |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

**Target Types:** `shelf`, `category`, `brand`, `sku`, `slot`

#### `dooh_attribution_events`
Per-exposure attribution analysis.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `campaign_id` | TEXT FK | Campaign reference |
| `screen_id` | TEXT FK | Screen reference |
| `exposure_event_id` | TEXT | Link to exposure event |
| `track_key` | TEXT | Visitor track ID |
| `exposure_start_ts` / `exposure_end_ts` | INTEGER | Exposure window |
| `aqs` | REAL | Attention Quality Score |
| `tier` | TEXT | Exposure tier |
| `context_json` | TEXT | Behavioral context |
| `outcome_json` | TEXT | Post-exposure outcome |
| `converted` | INTEGER | 1 = conversion detected |
| `tta_s` | REAL | Time-to-Action (seconds) |
| `dci_value` | REAL | Depth of Category Index |
| `confidence` | REAL | Attribution confidence (0–1) |
| `created_at` | TEXT | ISO timestamp |

#### `dooh_control_matches`
Matched control trajectories for lift calculation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `attribution_event_id` | TEXT FK | Parent event |
| `control_track_key` | TEXT | Control visitor track |
| `pseudo_exposure_ts` | INTEGER | Simulated exposure time |
| `match_distance` | REAL | Matching quality score |
| `control_outcome_json` | TEXT | Control outcome |
| `control_converted` | INTEGER | 1 = control converted |
| `control_tta_s` | REAL | Control time-to-action |
| `control_dci_value` | REAL | Control DCI |
| `created_at` | TEXT | ISO timestamp |

#### `dooh_campaign_kpis`
Aggregated campaign performance metrics.

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID identifier |
| `venue_id` | TEXT FK | Parent venue |
| `campaign_id` | TEXT FK | Campaign reference |
| `bucket_start_ts` | INTEGER | Bucket start |
| `bucket_minutes` | INTEGER | Bucket duration |
| `exposed_count` | INTEGER | Exposed visitors |
| `controls_count` | INTEGER | Control group size |
| `p_exposed` / `p_control` | REAL | Conversion rates |
| `lift_abs` / `lift_rel` | REAL | Absolute/relative lift |
| `median_tta_exposed` / `median_tta_control` | REAL | TTA comparison |
| `tta_accel` | REAL | TTA acceleration |
| `mean_engagement_dwell_exposed/control` | REAL | Engagement comparison |
| `engagement_lift_s` | REAL | Engagement lift |
| `mean_aqs_exposed` | REAL | Mean AQS for exposed |
| `mean_dci_exposed/control` | REAL | DCI comparison |
| `confidence_mean` | REAL | Average confidence |
| `ces_score` | REAL | Campaign Effectiveness Score |
| `aar_score` | REAL | Attention-Adjusted Reach |
| `created_at` | TEXT | ISO timestamp |

---

## REST API Reference

**Base URL:** `http://localhost:3001/api`

### Venues API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/venues` | List all venues |
| `GET` | `/venues/:id` | Get venue with objects & placements |
| `POST` | `/venues` | Create new venue |
| `PUT` | `/venues/:id` | Update venue (upsert) |
| `DELETE` | `/venues/:id` | Delete venue |
| `GET` | `/venues/:id/export` | Export venue as JSON |
| `POST` | `/venues/import` | Import venue from JSON |

#### Create Venue
```json
POST /venues
{
  "name": "Store Alpha",
  "width": 25,
  "depth": 20,
  "height": 4,
  "tileSize": 1
}
```

#### Update Venue (with objects)
```json
PUT /venues/:id
{
  "venue": { "name": "Updated Store" },
  "objects": [
    {
      "id": "uuid",
      "type": "shelf",
      "name": "Shelf 1",
      "position": { "x": 5, "y": 0, "z": 3 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 2, "y": 2, "z": 0.6 }
    }
  ],
  "placements": []
}
```

---

### Regions of Interest (ROI) API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/venues/:venueId/roi` | List ROIs for venue (manual mode) |
| `GET` | `/venues/:venueId/roi?all=true` | List all ROIs including DWG mode |
| `GET` | `/venues/:venueId/dwg/:dwgLayoutId/roi` | List ROIs for DWG layout |
| `GET` | `/roi/:id` | Get single ROI |
| `POST` | `/venues/:venueId/roi` | Create ROI (manual mode) |
| `POST` | `/venues/:venueId/dwg/:dwgLayoutId/roi` | Create ROI (DWG mode) |
| `PUT` | `/roi/:id` | Update ROI |
| `DELETE` | `/roi/:id` | Delete ROI |

#### Create ROI
```json
POST /venues/:venueId/roi
{
  "name": "Checkout Zone",
  "vertices": [
    { "x": 0, "z": 0 },
    { "x": 5, "z": 0 },
    { "x": 5, "z": 3 },
    { "x": 0, "z": 3 }
  ],
  "color": "#22c55e",
  "opacity": 0.5
}
```

---

### KPI & Analytics API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/kpi/settings` | Get global KPI settings |
| `PUT` | `/kpi/settings` | Update KPI settings |
| `GET` | `/roi/:roiId/kpis` | Get KPIs for specific zone |
| `GET` | `/venues/:venueId/kpis` | Get KPIs for all venue zones |
| `POST` | `/kpis/compare` | Compare multiple zones |

#### Query Parameters
- `startTime` — Start timestamp (ms)
- `endTime` — End timestamp (ms)
- `period` — Shortcut: `hour`, `day`, `week`, `month`

#### Zone KPIs Response
```json
{
  "roiId": "uuid",
  "startTime": 1707900000000,
  "endTime": 1707986400000,
  "kpis": {
    "totalVisitors": 142,
    "avgOccupancy": 8.5,
    "peakOccupancy": 23,
    "avgDwellTimeMs": 45000,
    "engagementRate": 0.68,
    "bounceRate": 0.15
  }
}
```

---

### Planogram API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/planogram/sku-catalogs` | List SKU catalogs |
| `GET` | `/planogram/sku-catalogs/:id` | Get catalog with items |
| `POST` | `/planogram/sku-catalogs/import` | Import catalog from Excel/CSV |
| `DELETE` | `/planogram/sku-catalogs/:id` | Delete catalog |
| `GET` | `/planogram/venues/:venueId/planograms` | List venue planograms |
| `POST` | `/planogram/venues/:venueId/planograms` | Create planogram |
| `GET` | `/planogram/planograms/:id` | Get planogram with shelves |
| `PUT` | `/planogram/planograms/:id` | Update planogram metadata |
| `POST` | `/planogram/planograms/:id/duplicate` | Duplicate planogram |
| `DELETE` | `/planogram/planograms/:id` | Delete planogram |
| `GET` | `/planogram/planograms/:id/export` | Export planogram JSON |
| `GET` | `/planogram/planograms/:planogramId/shelves/:shelfId` | Get shelf configuration |
| `PUT` | `/planogram/planograms/:planogramId/shelves/:shelfId` | Update shelf slots |
| `POST` | `/planogram/planograms/:planogramId/shelves/:shelfId/place` | Place SKUs on shelf |
| `POST` | `/planogram/planograms/:planogramId/shelves/:shelfId/auto-fill` | Auto-fill shelf by category |

#### Import SKU Catalog
```
POST /planogram/sku-catalogs/import
Content-Type: multipart/form-data

file: <Excel/CSV file>
name: "Beverage Catalog"
description: "Q1 2026 beverages"
```

#### Place SKUs on Shelf
```json
POST /planogram/planograms/:planogramId/shelves/:shelfId/place
{
  "skuItemIds": ["uuid1", "uuid2", "uuid3"],
  "dropTarget": { "type": "slot", "level": 2, "slotIndex": 5 },
  "shelfWidth": 2.0,
  "options": { "fillOrder": "sequential" }
}
```

---

### DWG Import API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/dwg/upload` | Upload DXF/DWG file |
| `GET` | `/dwg/imports` | List imports for venue |
| `GET` | `/dwg/imports/:id` | Get import details |
| `GET` | `/dwg/imports/:id/groups` | Get detected fixture groups |
| `POST` | `/dwg/imports/:id/mapping` | Save fixture type mapping |
| `GET` | `/dwg/imports/:id/mappings` | Get all mappings |
| `POST` | `/dwg/imports/:id/generate-layout` | Generate layout from mapping |
| `GET` | `/dwg/layouts` | List layout versions |
| `GET` | `/dwg/layouts/:id` | Get layout version |
| `POST` | `/dwg/layouts/:id/activate` | Set as active layout |
| `DELETE` | `/dwg/imports/:id` | Delete import |

#### Upload DWG/DXF
```
POST /dwg/upload
Content-Type: multipart/form-data

file: <DXF or DWG file>
venueId: "uuid"
```

#### Save Fixture Mapping
```json
POST /dwg/imports/:id/mapping
{
  "mapping": {
    "SHELF_GROUP_1": "shelf",
    "CHECKOUT_BLOCK": "checkout",
    "DISPLAY_REF": "digital_display"
  }
}
```

---

### LiDAR Planner API

**Feature Flag:** `FEATURE_LIDAR_PLANNER=true`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/lidar/models` | List LiDAR models |
| `POST` | `/lidar/models` | Create custom model |
| `PUT` | `/lidar/models/:id` | Update model |
| `GET` | `/lidar/instances` | Get instances for layout |
| `POST` | `/lidar/instances` | Create instance |
| `PUT` | `/lidar/instances/:id` | Update instance |
| `DELETE` | `/lidar/instances/:id` | Delete instance |
| `POST` | `/lidar/solve` | Run coverage optimization |
| `GET` | `/lidar/runs/:id` | Get optimization results |

#### Create LiDAR Instance
```json
POST /lidar/instances
{
  "layout_version_id": "uuid",
  "model_id": "livox-mid360",
  "x_m": 10.5,
  "z_m": 7.2,
  "mount_y_m": 3.5,
  "yaw_deg": 45,
  "source": "manual"
}
```

---

### Edge Commissioning API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/edge-commissioning/scan-edges` | Discover Tailscale edges |
| `PUT` | `/edge-commissioning/edge/:edgeId/name` | Rename edge device |
| `GET` | `/edge-commissioning/edge/:edgeId/scan-lidars` | Scan for LiDARs on edge |
| `POST` | `/edge-commissioning/edge/:edgeId/commission` | Commission LiDAR to edge |
| `GET` | `/edge-commissioning/venues/:venueId/pairings` | Get venue LiDAR pairings |
| `POST` | `/edge-commissioning/venues/:venueId/deploy` | Deploy config to edge |
| `GET` | `/edge-commissioning/venues/:venueId/history` | Get deployment history |
| `GET` | `/edge-commissioning/venues/:venueId/lidars` | Get commissioned LiDARs |

#### Commission LiDAR
```json
POST /edge-commissioning/edge/:edgeId/commission
{
  "venueId": "uuid",
  "originalIp": "192.168.1.200",
  "assignedIp": "192.168.1.101",
  "label": "Entrance LiDAR 1"
}
```

---

### DOOH Analytics API

**Feature Flag:** `FEATURE_DOOH_KPIS=true`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/dooh/screens?venueId=` | List screens |
| `GET` | `/dooh/screens/:id` | Get screen details |
| `POST` | `/dooh/screens` | Create screen |
| `PUT` | `/dooh/screens/:id` | Update screen |
| `DELETE` | `/dooh/screens/:id` | Delete/disable screen |
| `GET` | `/dooh/available-displays?venueId=` | Get unconfigured displays |
| `POST` | `/dooh/run` | Compute exposure events |
| `GET` | `/dooh/kpis` | Get KPI buckets |
| `GET` | `/dooh/kpis/context` | Get KPIs by context |
| `GET` | `/dooh/events` | Get exposure events |
| `GET` | `/dooh/params` | Get default parameters |
| `GET` | `/dooh/videos?venueId=` | List videos |
| `POST` | `/dooh/videos` | Upload video |
| `PUT` | `/dooh/videos/:id` | Update video metadata |
| `DELETE` | `/dooh/videos/:id` | Delete video |
| `GET` | `/dooh/screens/:screenId/playlist` | Get screen playlist |
| `POST` | `/dooh/screens/:screenId/playlist` | Add video to playlist |
| `PUT` | `/dooh/screens/:screenId/playlist` | Update playlist order |
| `DELETE` | `/dooh/screens/:screenId/playlist/:videoId` | Remove from playlist |
| `POST` | `/dooh/proof-of-play` | Log playback event |
| `GET` | `/dooh/proof-of-play` | Get playback records |

#### Create DOOH Screen
```json
POST /dooh/screens
{
  "venueId": "uuid",
  "name": "Entrance Display",
  "position": { "x": 5, "y": 2.5, "z": 0 },
  "yawDeg": 180,
  "mountHeightM": 2.5,
  "params": {
    "sez_reach_m": 15,
    "sez_near_width_m": 2,
    "sez_far_width_m": 12
  },
  "doubleSided": false
}
```

#### Run Exposure Computation
```json
POST /dooh/run
{
  "venueId": "uuid",
  "startTs": 1707900000000,
  "endTs": 1707986400000,
  "screenIds": ["screen-uuid"]  // optional, all screens if omitted
}
```

---

### DOOH Attribution API

**Feature Flag:** `FEATURE_DOOH_ATTRIBUTION=true`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/dooh-attribution/campaigns?venueId=` | List campaigns |
| `GET` | `/dooh-attribution/campaigns/:id` | Get campaign details |
| `POST` | `/dooh-attribution/campaigns` | Create campaign |
| `PUT` | `/dooh-attribution/campaigns/:id` | Update campaign |
| `DELETE` | `/dooh-attribution/campaigns/:id` | Delete campaign |
| `POST` | `/dooh-attribution/run` | Run attribution analysis |
| `GET` | `/dooh-attribution/kpis` | Get campaign KPIs |
| `GET` | `/dooh-attribution/debug/events` | Debug attribution events |

#### Create Attribution Campaign
```json
POST /dooh-attribution/campaigns
{
  "venueId": "uuid",
  "name": "Snacks Promo Q1",
  "screenIds": ["screen-1", "screen-2"],
  "target": {
    "type": "shelf",
    "ids": ["shelf-uuid-1", "shelf-uuid-2"]
  },
  "params": {
    "attribution_window_s": 300,
    "min_aqs_threshold": 40,
    "control_matching_enabled": true
  }
}
```

---

### Business Reporting API

**Feature Flag:** `FEATURE_BUSINESS_REPORTING=true`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/reporting/personas` | List available personas |
| `GET` | `/reporting/categories?venueId=` | List product categories |
| `GET` | `/reporting/summary` | Get persona KPI summary |

#### Available Personas
- `store-manager` — Operations Pulse
- `merchandising` — Shelf & Category Performance
- `retail-media` — PEBLE™ Effectiveness
- `executive` — Executive Summary

#### Get Persona Summary
```
GET /reporting/summary?personaId=retail-media&venueId=uuid&startTs=1707900000000&endTs=1707986400000
```

**Response:**
```json
{
  "personaId": "retail-media",
  "venueId": "uuid",
  "range": { "startTs": 1707900000000, "endTs": 1707986400000 },
  "kpis": {
    "ces": 72.5,
    "aal": 156,
    "aqs": 68.3,
    "eal": 14.2,
    "aar": 0.82
  },
  "supporting": {
    "screenBreakdown": [...],
    "topCampaigns": [...]
  },
  "generatedAt": 1707987000000
}
```

---

### AI Narrator API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/narrator/analyze` | Get AI narration for KPIs |
| `POST` | `/narrator/clarify` | Follow-up question |
| `GET` | `/narrator/health` | API health check |

#### Analyze Request
```json
POST /narrator/analyze
{
  "kpiSnapshot": {
    "avgWaitingTimeMin": 4.2,
    "abandonRate": 12,
    "currentQueueLength": 8
  },
  "personaId": "store-manager",
  "venueId": "uuid",
  "timeRange": { "startTs": 1707900000000, "endTs": 1707986400000 },
  "sessionId": "unique-session-id"
}
```

**Response:**
```json
{
  "headline": "Queue pressure building at checkout",
  "narration": [
    "Wait times have increased 40% compared to yesterday.",
    "Current queue length of 8 is approaching warning threshold."
  ],
  "businessMeaning": "Customer satisfaction may be impacted if queue grows further.",
  "recommendedActions": [
    {
      "label": "Open additional checkout lane",
      "uiIntent": "HIGHLIGHT_QUEUE:checkout-1"
    }
  ],
  "confidence": "high"
}
```

---

## WebSocket Events

**Namespace:** `/tracking`

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `subscribe` | `{ venueId }` | Join venue room for updates |
| `unsubscribe` | `{ venueId }` | Leave venue room |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `tracks` | `{ venueId, tracks[], timestamp }` | Real-time track positions |
| `track_removed` | `{ trackKey }` | Track left venue |
| `lidar_status` | `{ deviceId, status, lastSeen }` | LiDAR health updates |

#### Track Object
```json
{
  "trackKey": "track-001",
  "x": 5.2,
  "y": 0,
  "z": 8.7,
  "vx": 0.5,
  "vz": -0.2,
  "confidence": 0.95,
  "timestamp": 1707987654321
}
```

---

## Feature Flags

Control feature availability via environment variables:

| Flag | Default | Description |
|------|---------|-------------|
| `FEATURE_DOOH_KPIS` | `false` | Enable DOOH Analytics |
| `FEATURE_DOOH_ATTRIBUTION` | `false` | Enable PEBLE™ Attribution |
| `FEATURE_LIDAR_PLANNER` | `false` | Enable LiDAR Planner |
| `FEATURE_BUSINESS_REPORTING` | `false` | Enable Business Reporting |
| `MOCK_LIDAR` | `false` | Enable mock track generator |
| `MOCK_EDGE` | `false` | Enable mock edge devices |
| `MQTT_ENABLED` | `false` | Enable MQTT trajectory ingestion |

**Example `.env`:**
```bash
PORT=3001
DB_PATH=./database/hyperspace.db
FEATURE_DOOH_KPIS=true
FEATURE_DOOH_ATTRIBUTION=true
FEATURE_BUSINESS_REPORTING=true
MOCK_LIDAR=true
OPENAI_API_KEY=sk-...
```

---

## Error Responses

All endpoints return consistent error format:

```json
{
  "error": "Human-readable error message",
  "message": "Technical details (optional)"
}
```

**HTTP Status Codes:**
- `200` — Success
- `201` — Created
- `400` — Bad Request (validation error)
- `404` — Not Found
- `500` — Internal Server Error

---

*© 2026 Hyperspace Platform*
