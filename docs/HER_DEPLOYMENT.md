# HER (Hyperspace Edge Runtime) Deployment Guide

## Overview

HER (Hyperspace Edge Runtime) enables production deployments on edge devices by running algorithm provider Docker containers that process real LiDAR data. This guide covers the HER deployment system and how to use it.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  HYPERSPACE PLATFORM                                                             │
│                                                                                  │
│  Edge Commissioning Portal                                                       │
│  ├── Scan edges                                                                  │
│  ├── Pair LiDARs to placements                                                   │
│  ├── Select Algorithm Provider (optional)                                        │
│  └── Deploy (Simulator or HER)                                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                │
                     Tailscale Network
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  EDGE DEVICE                                                                     │
│                                                                                  │
│  Edge Server (Node.js) - Port 8080                                               │
│  ├── Simulator Mode (default)                                                    │
│  │   └── SimulatorV2 generates fake trajectories                                 │
│  │                                                                               │
│  └── HER Mode (production)                                                       │
│      ├── HER Manager (her-manager.js)                                            │
│      ├── docker pull <provider-image>                                            │
│      └── docker run with config mounted                                          │
│                                                                                  │
│  Provider Container                                                              │
│  ├── Reads /config/extrinsics.json                                               │
│  ├── Connects to LiDARs on LAN                                                   │
│  └── Publishes to MQTT: hyperspace/trajectories/{edgeId}                         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Operational Modes

### Simulator Mode (Default)
- Edge server runs the built-in SimulatorV2
- Generates simulated person trajectories
- Use for: Development, demos, testing
- No Docker required

### HER Mode (Production)
- Stops simulator, starts provider Docker container
- Provider processes real LiDAR point clouds
- Publishes real trajectory data to MQTT
- Use for: Production deployments with real sensors

## API Reference

### Main Server Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/edge-commissioning/providers` | List available algorithm providers |
| `POST` | `/api/edge-commissioning/edge/:id/deploy` | Deploy simulator config |
| `POST` | `/api/edge-commissioning/edge/:id/deploy-her` | Deploy HER with provider |
| `POST` | `/api/edge-commissioning/edge/:id/stop-her` | Stop HER, revert to simulator |
| `GET` | `/api/edge-commissioning/edge/:id/her-status` | Get HER status from edge |

### Edge Server Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/edge/her/deploy` | Deploy HER with provider module |
| `GET` | `/api/edge/her/status` | Get HER container status |
| `POST` | `/api/edge/her/stop` | Stop HER, resume simulator |
| `GET` | `/api/edge/mode` | Get current operational mode |

## HER Deploy Payload

When deploying HER, the main server sends this payload to the edge:

```json
{
  "deployment": {
    "deploymentId": "uuid",
    "edgeId": "ulisse-edge-01",
    "venueId": "venue-uuid",
    "mqtt": {
      "broker": "mqtt://localhost:1883",
      "topic": "hyperspace/trajectories/ulisse-edge-01",
      "qos": 1
    },
    "lidars": [
      {
        "lidarId": "lidar-001",
        "ip": "192.168.1.201",
        "model": { "name": "Ulisse", "hfov_deg": 360 },
        "extrinsics": {
          "x_m": 5.0, "y_m": 3.5, "z_m": 10.0,
          "yaw_deg": 0, "pitch_deg": 0, "roll_deg": 0
        }
      }
    ],
    "coordinateFrame": { ... },
    "venueBounds": { ... },
    "operationalParams": { ... }
  },
  "providerModule": {
    "providerId": "vendorx-fusion-v3",
    "name": "VendorX Fusion",
    "version": "3.1.0",
    "dockerImage": "ghcr.io/vendorx/lidar-fusion:3.1.0",
    "requiresGpu": false
  }
}
```

## Provider Container Requirements

Algorithm provider Docker containers must:

1. **Read configuration** from `/config/extrinsics.json` (mounted volume)
2. **Connect to LiDARs** via UDP (typically ports 2368/2369)
3. **Publish trajectories** to MQTT topic specified in environment variables

### Environment Variables

The HER Manager passes these to the container:

| Variable | Description |
|----------|-------------|
| `MQTT_BROKER` | MQTT broker URL (e.g., `mqtt://localhost:1883`) |
| `MQTT_TOPIC` | Topic to publish to (e.g., `hyperspace/trajectories/edge-01`) |
| `MQTT_QOS` | QoS level (default: 1) |
| `EDGE_ID` | Edge device identifier |
| `VENUE_ID` | Venue UUID |
| `CONFIG_FILE` | Path to config file (`/config/extrinsics.json`) |

### Trajectory Message Format

Providers must publish JSON messages in this format:

```json
{
  "venueId": "venue-uuid",
  "deviceId": "edge-01",
  "timestamp": 1707624000000,
  "tracks": [
    {
      "id": "person-42",
      "position": { "x": 15.3, "y": 0.0, "z": 22.7 },
      "velocity": { "x": 0.5, "y": 0.0, "z": -0.3 },
      "objectType": "person",
      "boundingBox": { "width": 0.45, "height": 1.75, "depth": 0.45 }
    }
  ]
}
```

## Adding New Providers

To add a new algorithm provider, edit `backend/data/algorithmProviders.js`:

```javascript
export const ALGORITHM_PROVIDERS = [
  {
    providerId: 'my-provider-v1',
    name: 'My Provider',
    version: '1.0.0',
    dockerImage: 'ghcr.io/myorg/provider:1.0.0',
    requiresGpu: false,
    supportedLidarModels: ['Livox Mid-360', 'Ulisse'],
    notes: 'Description of the provider',
    isActive: true,
  },
  // ... other providers
];
```

## Database Schema

HER deployments are tracked in `edge_deploy_history` with additional columns:

| Column | Type | Description |
|--------|------|-------------|
| `deployment_type` | TEXT | `'simulator'` or `'her'` |
| `provider_module_json` | TEXT | JSON of provider module info |
| `her_response_json` | TEXT | JSON response from HER endpoint |

## Troubleshooting

### Container Not Starting
- Check Docker is installed: `docker --version`
- Check image can be pulled: `docker pull <image>`
- Check edge server logs for errors

### No Trajectories Received
- Verify container is running: `docker ps`
- Check container logs: `docker logs her-provider`
- Verify MQTT broker is accessible
- Check LiDARs are reachable on the LAN

### Container Crashes
- Edge stays in HER mode with error status
- Check container logs for crash reason
- Use "Stop HER" to revert to simulator mode

## Files

| Location | File | Description |
|----------|------|-------------|
| Edge | `edge-server/backend/her-manager.js` | HER Manager module |
| Edge | `edge-server/backend/server.js` | Edge server with HER endpoints |
| Backend | `backend/data/algorithmProviders.js` | Provider seed data |
| Backend | `backend/routes/edgeCommissioning.js` | HER API endpoints |
| Backend | `backend/database/schema.js` | Database schema with HER columns |
| Frontend | `frontend/src/context/EdgeCommissioningContext.tsx` | HER state & actions |
| Frontend | `frontend/src/components/edgeCommissioning/ProviderSelectionPanel.tsx` | Provider picker UI |
| Frontend | `frontend/src/components/edgeCommissioning/EdgeCommissioningPage.tsx` | Commissioning page with HER |

---

*Document Version: 1.0*  
*Last Updated: February 2026*
