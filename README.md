# Hyperspace - LiDAR Space Configurator

A 3D venue editor for commissioning LiDAR sensors. Discover devices via Tailscale, position them in a 3D space, and visualize real-time trajectory tracking.

## Features

- **3D Venue Builder**: Create venues with configurable dimensions and tile grid
- **Object Library**: Place shelves, walls, checkouts, and other objects
- **LiDAR Discovery**: Scan Tailscale network for concentrators
- **Drag & Drop Placement**: Position LiDARs with snap-to-grid, adjust rotation and mount height
- **FOV Visualization**: See sensor coverage cones in 3D
- **Real-time Tracking**: Stream and visualize trajectories with trails

## Quick Start

### Prerequisites

- Node.js 20 LTS
- npm 9+
- Tailscale installed and authenticated (for device discovery)

### Development

**Frontend** (port 5173):
```bash
cd frontend
npm install
npm run dev
```

**Backend** (port 3001):
```bash
cd backend
npm install
npm run dev
```

### Environment Variables

**Backend** (`backend/.env`):
```env
PORT=3001
MOCK_LIDAR=true          # Enable mock LiDAR data generator
TAILSCALE_POLL_INTERVAL=30000  # Device scan interval (ms)
LIDAR_PORT=17161         # Default LiDAR concentrator port
```

### Mock Mode

Set `MOCK_LIDAR=true` to generate simulated track data without real hardware. The mock generator creates realistic movement patterns across the venue grid.

## Architecture

```
Hyperspace/
├── frontend/          # React 18 + Vite + Three.js
│   ├── src/
│   │   ├── components/
│   │   │   ├── layout/      # AppShell, Sidebar, RightPanel
│   │   │   ├── venue/       # VenueBuilder, TileGrid
│   │   │   ├── objects/     # ObjectLibrary, ObjectMesh
│   │   │   ├── lidar/       # LidarNetworkPanel, LidarSensor3D
│   │   │   └── tracking/    # TrackingOverlay
│   │   ├── context/         # VenueContext, LidarContext, TrackingContext
│   │   └── hooks/           # useDragDrop3D, useSocket
│   └── ...
├── backend/           # Node.js + Express + Socket.IO
│   ├── routes/        # REST API endpoints
│   ├── services/      # TailscaleService, LidarConnectionManager, TrackAggregator
│   ├── database/      # SQLite schema and queries
│   └── server.js      # Main entry point
└── README.md
```

## API Endpoints

### Discovery
- `GET /api/discovery/scan` - Trigger Tailscale device scan
- `GET /api/discovery/status` - Get cached device list

### Venues
- `GET /api/venues` - List all venues
- `POST /api/venues` - Create venue
- `GET /api/venues/:id` - Get venue with objects and LiDARs
- `PUT /api/venues/:id` - Update venue
- `DELETE /api/venues/:id` - Delete venue
- `GET /api/venues/:id/export` - Export venue config as JSON
- `POST /api/venues/import` - Import venue config from JSON

### LiDARs
- `GET /api/lidars` - List discovered devices
- `POST /api/lidars/:id/connect` - Connect to concentrator
- `POST /api/lidars/:id/disconnect` - Disconnect from concentrator
- `GET /api/lidars/:id/status` - Get connection status

## WebSocket Events

**Namespace**: `/tracking`

**Client → Server**:
- `subscribe { venueId }` - Start receiving tracks for venue
- `unsubscribe { venueId }` - Stop receiving tracks

**Server → Client**:
- `tracks { venueId, tracks[] }` - Batch of track updates (20 fps)
- `lidar_status { deviceId, status, message }` - Connection status change
- `track_removed { trackKey }` - Track TTL expired

## NDJSON Track Format

LiDAR concentrators emit newline-delimited JSON:

```json
{"id":"track_001","timestamp":1706000000000,"position":{"x":1.5,"y":0.0,"z":2.3},"velocity":{"x":0.5,"y":0.0,"z":-0.2},"objectType":"person"}
{"id":"track_002","timestamp":1706000000000,"position":{"x":5.2,"y":0.0,"z":8.1},"velocity":{"x":-0.3,"y":0.0,"z":0.1},"objectType":"cart"}
```

## License

Proprietary - All rights reserved
