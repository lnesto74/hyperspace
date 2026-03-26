# Sensor Fusion Provider Integration Guide

## Overview

This document provides comprehensive requirements and instructions for algorithm/sensor fusion providers integrating with the PDUMind Edge Server.

---

## 1. Per-LiDAR Configuration (Extrinsics)

| Field | Description | Example |
|-------|-------------|---------|
| `lidarId` | Unique identifier | `"lidar-entrance-001"` |
| `ip` | LAN IP address | `"192.168.10.21"` |
| `model` | Hardware model | `"Ulisse"` or `"Livox Mid-360"` |
| `x_m, y_m, z_m` | Position in venue frame (meters) | `9.46, 3.5, 9.45` |
| `yaw_deg, pitch_deg, roll_deg` | Rotation (degrees) | `0, 0, 0` |
| `hfov_deg, vfov_deg` | Field of view | `360, 90` |
| `range_m` | Max detection range | `15` |

---

## 2. Venue Coordinate Frame

| Field | Description |
|-------|-------------|
| `origin` | Where (0,0,0) is located: **"SW corner of ROI at floor level"** |
| `axis_convention` | `"X=East, Y=Up, Z=North"` |
| `units` | Always **meters** |
| `ground_plane_y` | Y value of floor (usually `0`) |
| `ceiling_height_m` | For filtering ceiling reflections (e.g., `4.5`) |

---

## 3. MQTT Connection Details

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         EDGE DEVICE                                 │
│  ┌──────────────────┐      ┌─────────────────────────────────────┐  │
│  │ Perception SW    │      │ Local Mosquitto Broker              │  │
│  │ (Your Software)  │─────▶│ mqtt://localhost:1883               │  │
│  └──────────────────┘      │                                     │  │
│                            │ Bridge: hyperspace/trajectories/#   │  │
│                            └─────────────────┬───────────────────┘  │
└──────────────────────────────────────────────┼──────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    PRODUCTION (DigitalOcean)                        │
│  ┌─────────────────────────────────────┐                            │
│  │ Mosquitto Broker                    │                            │
│  │ mqtt://100.76.196.2:1883 (Tailscale)│                            │
│  │ mqtt://165.245.191.45:1883 (Public) │                            │
│  └─────────────────┬───────────────────┘                            │
│                    ▼                                                │
│  ┌─────────────────────────────────────┐                            │
│  │ Hyperspace Backend                  │                            │
│  │ - Track processing                  │                            │
│  │ - KPI aggregation                   │                            │
│  │ - WebSocket broadcast               │                            │
│  └─────────────────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────┘
```

### MQTT Broker (For Perception Software)

| Parameter | Value |
|-----------|-------|
| **Protocol** | MQTT 3.1.1 / 5.0 |
| **Broker URL** | `mqtt://localhost:1883` |
| **QoS** | 1 (At least once delivery) |

> **Important**: Your perception software publishes to the **local** Mosquitto broker on the edge device (`localhost:1883`). The local broker automatically bridges messages to the production cloud. This architecture provides:
> - **Low latency** for perception software
> - **Resilience** — messages are buffered if internet drops
> - **Simplicity** — no need to configure cloud URLs in your software

### Authentication (if enabled)

```
Username: <provided by PDUMind>
Password: <provided by PDUMind>
```

---

## 3. MQTT Output Protocol

### Topic Pattern
```
hyperspace/trajectories/{edgeId}
```

### Message Format (Per-Track)

Each tracked object is published as an **individual message**:

```json
{
  "id": "person-42",
  "deviceId": "ulisse-edge-01",
  "venueId": "595c4d73-b0bb-4ff4-9f18-94df5d4be476",
  "timestamp": 1707624000000,
  "position": {
    "x": 15.3,
    "y": 0.0,
    "z": 22.7
  },
  "velocity": {
    "x": 0.5,
    "y": 0.0,
    "z": -0.3
  },
  "objectType": "person",
  "color": "#22c55e",
  "boundingBox": {
    "width": 0.45,
    "height": 1.75,
    "depth": 0.45
  },
  "metadata": {
    "state": "BROWSING",
    "persona": "browser"
  }
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique track ID (e.g., `person-42`, `cashier-1`) |
| `deviceId` | string | Edge server identifier |
| `venueId` | string | UUID of the venue |
| `timestamp` | number | Unix timestamp in milliseconds |
| `position.x` | number | X coordinate in meters (East direction) |
| `position.y` | number | Y coordinate in meters (Height, usually 0) |
| `position.z` | number | Z coordinate in meters (North direction) |
| `velocity.x` | number | X velocity in m/s |
| `velocity.y` | number | Y velocity in m/s (usually 0) |
| `velocity.z` | number | Z velocity in m/s |
| `objectType` | string | Object classification: `person`, `cashier`, `cart` |
| `color` | string | Hex color for visualization |
| `boundingBox.width` | number | Object width in meters |
| `boundingBox.height` | number | Object height in meters |
| `boundingBox.depth` | number | Object depth in meters |
| `metadata.state` | string | Behavioral state (see below) |
| `metadata.persona` | string | Agent persona type |

### Behavioral States

| State | Description |
|-------|-------------|
| `SPAWN` | Agent just spawned |
| `ENTERING` | Walking from entrance into venue |
| `BROWSING` | Shopping/browsing the store |
| `WALKING_TO_QUEUE` | Moving toward checkout queue |
| `IN_QUEUE` | Waiting in checkout queue |
| `SERVICE` | Being served at checkout |
| `EXITING` | Leaving the venue |
| `DONE` | Agent has exited (final state) |

### Publish Rate
- **Default**: 10 Hz (per tracked object)
- **QoS**: 1 (At least once delivery)

---

## 4. Calibration Information

| Item | Purpose |
|------|---------|
| Ground plane coefficients | Filter floor points |
| Static object masks | Ignore shelves, pillars |
| Overlap zones | LiDARs with overlapping FOV for fusion |
| Reference points | Known XYZ points for verification |

---

## 5. Operational Parameters

| Parameter | Typical Value | Description |
|-----------|---------------|-------------|
| `min_detection_height_m` | 0.3 | Ignore floor clutter |
| `max_detection_height_m` | 2.2 | Ignore ceiling reflections |
| `track_timeout_s` | 2.0 | Drop track after no detection |
| `min_confidence` | 0.5 | Minimum confidence to publish |
| `fusion_radius_m` | 0.5 | Merge detections within this distance |
| `publish_rate_hz` | 10 | Output frequency |

---

## 6. Questions to Ask the Provider

| Question | Why It Matters |
|----------|----------------|
| **Input format** | Does their algorithm expect raw point clouds or pre-processed clusters? |
| **LiDAR SDK** | Do they support Livox SDK / Ouster SDK directly, or need a wrapper? |
| **MQTT or alternative** | Can they publish to MQTT, or do they use gRPC/WebSocket? |
| **Track ID persistence** | How do they handle ID handoff between overlapping LiDARs? |
| **Latency requirements** | What's the expected end-to-end latency? |
| **GPU requirements** | Do they need CUDA on the edge? |

---

## 7. Sample Code

### Python (paho-mqtt)

```python
import json
import paho.mqtt.client as mqtt

# Production: Use DigitalOcean Tailscale IP or public IP
BROKER_HOST = "100.76.196.2"  # Tailscale IP (preferred if on Tailscale network)
# BROKER_HOST = "165.245.191.45"  # Public IP (alternative)
TOPIC = "hyperspace/trajectories/ulisse-edge-01"

def on_connect(client, userdata, flags, rc):
    print(f"Connected with result code {rc}")
    client.subscribe(TOPIC, qos=1)

def on_message(client, userdata, msg):
    trajectory = json.loads(msg.payload.decode())
    print(f"Track {trajectory['id']}: "
          f"pos=({trajectory['position']['x']:.2f}, {trajectory['position']['z']:.2f}) "
          f"state={trajectory['metadata']['state']}")

client = mqtt.Client()
client.on_connect = on_connect
client.on_message = on_message

client.connect("localhost", 1883, 60)  # Local broker on edge device
client.loop_forever()
```

### Node.js (mqtt)

```javascript
const mqtt = require('mqtt');

// Connect to local broker on edge device (bridges to production automatically)
const client = mqtt.connect('mqtt://localhost:1883');
const TOPIC = 'hyperspace/trajectories/ulisse-edge-01';

client.on('connect', () => {
  console.log('Connected to MQTT broker');
  client.subscribe(TOPIC, { qos: 1 });
});

client.on('message', (topic, message) => {
  const trajectory = JSON.parse(message.toString());
  console.log(`Track ${trajectory.id}: ` +
    `pos=(${trajectory.position.x.toFixed(2)}, ${trajectory.position.z.toFixed(2)}) ` +
    `state=${trajectory.metadata.state}`);
});
```

---

## 8. Deliverable Template (Extrinsics Config JSON)

When the edge server is commissioned, it receives an extrinsics package containing:

```json
{
  "deploymentId": "uuid",
  "edgeId": "ulisse-edge-01",
  "venueId": "595c4d73-b0bb-4ff4-9f18-94df5d4be476",
  "mqtt": {
    "broker": "mqtt://localhost:1883",
    "topic": "hyperspace/trajectories/ulisse-edge-01",
    "qos": 1
  },
  "lidars": [
    {
      "lidarId": "lidar-001",
      "ip": "192.168.1.10",
      "model": {
        "name": "Ulisse",
        "hfov_deg": 360,
        "vfov_deg": 90,
        "range_m": 15,
        "dome_mode": true
      },
      "extrinsics": {
        "x_m": 9.46,
        "y_m": 3.5,
        "z_m": 9.45,
        "yaw_deg": 0,
        "pitch_deg": 0,
        "roll_deg": 0
      },
      "dwgCoordinates": {
        "x_m": 410.46,
        "z_m": 201.60
      }
    }
  ],
  "coordinateFrame": {
    "origin": "ROI SW corner at floor level",
    "roiOffset": { "x": 401.0, "z": 192.15 },
    "axis": "X-East, Y-Up, Z-North",
    "units": "meters"
  },
  "venueBounds": {
    "width": 47.43,
    "depth": 62.60,
    "minX": 0,
    "maxX": 47.43,
    "minZ": 0,
    "maxZ": 62.60,
    "floorY": 0,
    "ceilingY": 4.5
  },
  "operationalParams": {
    "groundPlaneY": 0,
    "ceilingY": 4.5,
    "minDetectionHeight": 0.3,
    "maxDetectionHeight": 2.2,
    "publishRateHz": 10
  }
}
```

### Key Points

1. **Coordinates are ROI-relative**: All positions are relative to the ROI's southwest corner (0,0)
2. **DWG coordinates preserved**: Original DWG coordinates are included in `dwgCoordinates` for reference
3. **Venue bounds**: The `venueBounds` define the tracking area dimensions

---

## 9. Troubleshooting

| Issue | Solution |
|-------|----------|
| No messages received | Check broker IP, port, and topic name |
| Connection refused | Verify MQTT broker is running on edge server |
| Intermittent disconnects | Check network stability, increase keepalive |
| Invalid JSON | Ensure UTF-8 decoding of message payload |

---

## 8. Contact

For integration support, contact the PDUMind team.

---

*Document Version: 1.0*  
*Last Updated: February 2026*

---

# Appendix: Offline Integration (Native Installation)

For developers installing perception software **natively** (without Docker/HER), follow this minimal integration guide.

## Step 1: Export Config from Hyperspace Portal

1. Open **Edge Commissioning Portal** → **Algorithm** tab
2. Click **"Preview"** under "Export Config JSON"
3. Click **"Download"** to save as `edge-config.json`

The config contains everything: LiDAR IPs, extrinsics, venue bounds, coordinate frame.

## Step 2: Config File Location

Place the downloaded config at a shared path both systems can access:

```
/opt/hyperspace/edge-server/backend/data/edge-config.json
```

Or use any agreed location. Your software should read this file on startup.

## Step 3: MQTT Connection

| Parameter | Value |
|-----------|-------|
| **Broker** | `mqtt://localhost:1883` |
| **Topic** | `hyperspace/trajectories/{edgeId}` |
| **QoS** | 1 |

The `edgeId` is in the config file (e.g., `nodekey:e8ff657dc04d...`).

> **Note**: The local Mosquitto broker on the edge device automatically bridges your messages to the production cloud. You don't need to configure any cloud URLs.

## Step 4: Message Format (CRITICAL)

Publish **one JSON message per tracked object**, at 10 Hz:

```json
{
  "id": "person-42",
  "deviceId": "nodekey:e8ff657dc04d4bab...",
  "venueId": "f7aafcdc-1a87-473d-84f0-7f11a78d60ed",
  "timestamp": 1711278000000,
  "position": { "x": 15.3, "y": 0.0, "z": 22.7 },
  "velocity": { "x": 0.5, "y": 0.0, "z": -0.3 },
  "objectType": "person",
  "boundingBox": { "width": 0.5, "height": 1.7, "depth": 0.5 }
}
```

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique track ID (e.g., `person-42`). Must persist across frames for same person. |
| `deviceId` | string | Copy `edgeId` from config |
| `venueId` | string | Copy `venueId` from config |
| `timestamp` | number | Unix timestamp in **milliseconds** |
| `position.x` | number | X in meters (relative to ROI SW corner) |
| `position.y` | number | Height in meters (usually 0 for ground) |
| `position.z` | number | Z in meters (relative to ROI SW corner) |
| `velocity.x/y/z` | number | Velocity in m/s (can be 0 if not computed) |
| `objectType` | string | `"person"` or `"cart"` |
| `boundingBox` | object | Dimensions in meters |

### Coordinate System

- **Origin**: Southwest corner of ROI at floor level (from `coordinateFrame.roiOffset`)
- **Axes**: X = East, Y = Up, Z = North
- **Units**: Meters

## Step 5: Verification

Test your MQTT publishing:

```bash
# Subscribe to see messages
mosquitto_sub -h localhost -t "hyperspace/trajectories/#" -v
```

When tracks appear in the Hyperspace frontend 3D viewport, integration is complete.

## Quick Reference: Config Fields

```json
{
  "edgeId": "...",           // Use as deviceId in messages
  "venueId": "...",          // Use in messages
  "lidars": [                // Your LiDAR inputs
    {
      "ip": "192.168.1.213", // LiDAR IP to capture UDP
      "extrinsics": {
        "x_m": 9.45,         // Position in venue frame
        "y_m": 3.0,          // Mount height
        "z_m": 28.35
      }
    }
  ],
  "venueBounds": {
    "width": 115.6,          // Venue X extent
    "depth": 74.2            // Venue Z extent
  },
  "operationalParams": {
    "minDetectionHeight": 0.3,
    "maxDetectionHeight": 2.2,
    "publishRateHz": 10
  }
}
```

---

*For questions, contact the PDUMind integration team.*
