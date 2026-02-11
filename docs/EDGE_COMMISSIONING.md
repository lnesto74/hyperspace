# Edge Commissioning Portal

## Overview

The Edge Commissioning Portal is a **new, separate feature** for configuring edge servers (Ulisse boxes) and their connected LiDAR sensors. It is designed to work alongside the existing LiDAR Network Panel without modifying any legacy functionality.

### Key Differences from Legacy LiDAR Tab

| Feature | Legacy LiDAR Tab | Edge Commissioning Portal |
|---------|-----------------|---------------------------|
| **Target** | Individual LiDARs (direct TCP) | Edge servers (Ulisse boxes) |
| **Discovery** | Tailscale → concentrator hostnames | Tailscale → edge/ulisse hostnames |
| **Connection** | Main server ← TCP → LiDAR | Main server ← REST/Tailscale → Edge |
| **LiDAR Access** | Direct from main server | Via edge's LAN (edge scans locally) |
| **Configuration** | Placements stored on main | Extrinsics deployed TO edge |
| **Data Flow** | LiDAR → TCP → Main | LiDAR → Edge → MQTT → Main |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MAIN SERVER                                    │
│                                                                             │
│  ┌───────────────────────┐    ┌─────────────────────────────────────────┐  │
│  │ Edge Commissioning    │    │ /api/edge-commissioning/*               │  │
│  │ Portal (React)        │───→│ - GET  /scan-edges                      │  │
│  │                       │    │ - POST /edge/:id/scan-lidars            │  │
│  │ EdgeCommissioning     │    │ - GET  /edge/:id/inventory              │  │
│  │ Context (NEW)         │    │ - GET  /edge/:id/status                 │  │
│  │                       │    │ - POST /edge/:id/deploy                 │  │
│  └───────────────────────┘    │ - GET/POST /pairings                    │  │
│                               └────────────────┬────────────────────────┘  │
│                                                │                            │
│  ┌───────────────────────┐                     │ Tailscale VPN             │
│  │ Legacy LiDAR Tab      │                     │ (secure proxy)            │
│  │ (UNCHANGED)           │                     ▼                            │
│  └───────────────────────┘    ┌─────────────────────────────────────────┐  │
│                               │ Edge Server (Ulisse)                    │  │
└───────────────────────────────│                                         │──┘
                                │  /api/edge/lidar/scan      ← LAN scan   │
                                │  /api/edge/lidar/inventory ← Device list│
                                │  /api/edge/config/apply    ← Extrinsics │
                                │  /api/edge/status          ← Health     │
                                │                                         │
                                │     ┌───────────────────────────────┐   │
                                │     │ Local LAN (192.168.x.x)       │   │
                                │     │                               │   │
                                │     │  ┌─────┐ ┌─────┐ ┌─────┐     │   │
                                │     │  │LiDAR│ │LiDAR│ │LiDAR│     │   │
                                │     │  └─────┘ └─────┘ └─────┘     │   │
                                │     └───────────────────────────────┘   │
                                │                    │                    │
                                │                    ▼                    │
                                │              MQTT Publish               │
                                │    hyperspace/trajectories/{edgeId}     │
                                └─────────────────────────────────────────┘
```

## Workflow

### 1. Discover Edge Servers

Click **"Scan Tailnet for Edges"** to discover edge servers on the Tailscale network.

The scan looks for devices with:
- Hostnames containing: `edge`, `ulisse`, `lidar-edge`, `concentrator`
- Tags including: `tag:edge`

### 2. Select an Edge and Scan LiDARs

1. Click on an edge device card to select it
2. Click the **search icon** to trigger a LAN scan on the edge
3. The edge will discover LiDARs on its local network
4. Discovered LiDARs appear in the inventory panel

### 3. Pair LiDARs to Placements

1. Placements are loaded from the current venue's LiDAR Planner data
2. **Drag** a LiDAR from the inventory panel
3. **Drop** it onto a placement card
4. The pairing is saved to the database

### 4. Deploy Configuration

Once pairings are created:

1. Click **"Deploy to Edge"** button
2. The main server builds an **Extrinsics Package** containing:
   - Venue ID
   - MQTT broker/topic settings
   - LiDAR configurations with positions (extrinsics)
   - Coordinate frame information
3. The package is sent to the edge via REST over Tailscale
4. The edge applies the configuration and returns a config hash
5. The deployment is recorded in history

### 5. Validate Deployment

- Check the **Edge Status** panel for:
  - Applied config hash
  - LiDAR connection statuses
  - MQTT publish status
- View **Deployment History** to see past deployments

## Database Tables

### edge_lidar_pairings

Stores the mapping between placements and physical LiDARs:

```sql
CREATE TABLE edge_lidar_pairings (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  edge_tailscale_ip TEXT,
  placement_id TEXT NOT NULL,
  lidar_id TEXT NOT NULL,
  lidar_ip TEXT,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(venue_id, placement_id)
);
```

### edge_deploy_history

Tracks deployment attempts and results:

```sql
CREATE TABLE edge_deploy_history (
  id TEXT PRIMARY KEY,
  venue_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  edge_tailscale_ip TEXT,
  config_hash TEXT NOT NULL,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL,  -- 'pending', 'applied', 'failed'
  edge_response_json TEXT,
  created_at TEXT
);
```

## API Reference

### Main Server Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/edge-commissioning/scan-edges` | Discover edge servers on tailnet |
| POST | `/api/edge-commissioning/edge/:edgeId/scan-lidars` | Trigger LAN scan on edge |
| GET | `/api/edge-commissioning/edge/:edgeId/inventory` | Get LiDAR inventory from edge |
| GET | `/api/edge-commissioning/edge/:edgeId/status` | Get edge health status |
| POST | `/api/edge-commissioning/edge/:edgeId/deploy` | Deploy extrinsics to edge |
| GET | `/api/edge-commissioning/placements?venueId=...` | Get venue placements (read-only) |
| GET | `/api/edge-commissioning/pairings?venueId=...` | Get pairings for venue |
| POST | `/api/edge-commissioning/pairings` | Create/update pairing |
| DELETE | `/api/edge-commissioning/pairings/:id` | Delete pairing |
| GET | `/api/edge-commissioning/deploy-history` | Get deployment history |

### Edge Server Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/edge/lidar/scan` | Scan local LAN for LiDARs |
| GET | `/api/edge/lidar/inventory` | Get discovered LiDARs |
| POST | `/api/edge/config/apply` | Apply extrinsics package |
| GET | `/api/edge/status` | Get edge status |

## Extrinsics Package Format

The configuration package sent to the edge:

```json
{
  "deploymentId": "uuid",
  "edgeId": "edge-001",
  "venueId": "venue-123",
  "mqtt": {
    "broker": "mqtt://main-server:1883",
    "topic": "hyperspace/trajectories/edge-001",
    "qos": 1
  },
  "lidars": [
    {
      "lidarId": "lidar-001",
      "ip": "192.168.10.21",
      "model": {
        "name": "Livox Mid-360",
        "hfov_deg": 360,
        "vfov_deg": 59,
        "range_m": 40,
        "dome_mode": true
      },
      "extrinsics": {
        "x_m": 2.5,
        "y_m": 4.0,
        "z_m": 8.0,
        "yaw_deg": 90,
        "pitch_deg": 0,
        "roll_deg": 0
      }
    }
  ],
  "coordinateFrame": {
    "units": "meters",
    "axis": "x-right,y-up,z-forward",
    "origin": "venue-centered"
  }
}
```

## Environment Variables

### Main Server

| Variable | Default | Description |
|----------|---------|-------------|
| `MOCK_EDGE` | `false` | Enable mock edge responses for development |
| `EDGE_PORT` | `8080` | Port to connect to edge servers |
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | MQTT broker for trajectory data |

### Edge Server

The edge server uses its existing configuration plus the new commissioning endpoints.

## Development

### Testing Without Real Edge

Set `MOCK_EDGE=true` on the main server to get mock responses:
- Mock edge devices in scan results
- Mock LiDAR inventory from edges

### Adding a New Edge

1. Deploy edge server to a new Ulisse box
2. Connect Ulisse to Tailscale network
3. Tag device with `tag:edge` or use hostname pattern
4. Edge will appear in "Scan Tailnet for Edges"

## File Structure

```
frontend/
├── src/
│   ├── components/
│   │   └── edgeCommissioning/
│   │       ├── EdgeCommissioningPage.tsx   # Main UI
│   │       └── index.ts
│   └── context/
│       └── EdgeCommissioningContext.tsx    # State management

backend/
├── routes/
│   └── edgeCommissioning.js                # API routes
└── database/
    └── schema.js                           # Tables added here

edge-server/
└── backend/
    └── server.js                           # New endpoints added
```

## Notes

- The legacy LiDAR Network Panel (`LidarNetworkPanel.tsx`) is **completely unchanged**
- The legacy `LidarContext` is **not modified**
- All new code is in separate files with "EdgeCommissioning" prefix
- Database tables are additive only - no changes to existing tables
