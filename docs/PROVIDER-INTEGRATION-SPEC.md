# Algorithm Provider Integration Specification

> Version 1.0 | For DEB Package Providers

---

## Overview

This document specifies what algorithm providers must implement to integrate with the Hyperspace platform. A provider is a software module that processes LiDAR point cloud data and outputs human trajectory positions.

---

## What Hyperspace Provides to Your Provider

When your DEB package runs inside our Docker container, you will receive:

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MQTT_BROKER` | MQTT broker URL to publish trajectories | `mqtt://192.168.1.100:1883` |
| `MQTT_TOPIC` | Topic to publish trajectories to | `hyperspace/trajectories/edge-01` |
| `EDGE_ID` | Unique identifier for this edge device | `edge-ulisse-01` |
| `VENUE_ID` | UUID of the venue being tracked | `595c4d73-b0bb-4ff4-9f18-94df5d4be476` |
| `CONFIG_FILE` | Path to JSON config file (optional) | `/config/extrinsics.json` |

### Configuration File (JSON)

Located at `$CONFIG_FILE` (typically `/config/extrinsics.json`):

```json
{
  "deploymentId": "uuid",
  "edgeId": "edge-ulisse-01",
  "venueId": "595c4d73-b0bb-4ff4-9f18-94df5d4be476",
  "mqtt": {
    "broker": "mqtt://192.168.1.100:1883",
    "topic": "hyperspace/trajectories/edge-ulisse-01",
    "qos": 1
  },
  "lidars": [
    {
      "lidarId": "lidar-001",
      "ip": "192.168.1.201",
      "model": "Livox Mid-360",
      "extrinsics": {
        "x_m": 5.0,
        "y_m": 3.5,
        "z_m": 0.0,
        "yaw_deg": 45.0,
        "pitch_deg": 0.0,
        "roll_deg": 0.0
      }
    }
  ],
  "coordinateFrame": {
    "origin": "ROI SW corner at floor level",
    "axis": "X-East, Y-Up, Z-North",
    "units": "meters"
  },
  "venueBounds": {
    "width": 50.0,
    "depth": 30.0,
    "minX": 0,
    "maxX": 50.0,
    "minZ": 0,
    "maxZ": 30.0,
    "floorY": 0,
    "ceilingY": 4.5
  }
}
```

---

## What Your Provider Must Output

### MQTT Publishing

Your provider MUST publish trajectory data via MQTT:

- **Broker**: Use `$MQTT_BROKER` environment variable
- **Topic**: Use `$MQTT_TOPIC` environment variable (DO NOT modify it)
- **QoS**: 1 (at least once delivery)
- **Format**: JSON

### Message Format (Single Track - RECOMMENDED)

Publish one message per detected person per frame:

```json
{
  "id": "person-42",
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
  "objectType": "person"
}
```

### Field Specifications

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **YES** | Unique track ID. Must be consistent across frames for the same person. Example: `"person-42"` |
| `venueId` | string | **YES** | UUID from `$VENUE_ID` env var |
| `timestamp` | number | **YES** | Unix timestamp in milliseconds |
| `position` | object | **YES** | Current position in venue coordinates |
| `position.x` | number | **YES** | X coordinate in meters (East) |
| `position.y` | number | **YES** | Y coordinate in meters (Up, typically 0 for floor) |
| `position.z` | number | **YES** | Z coordinate in meters (North) |
| `velocity` | object | No | Movement velocity (m/s). Default: `{x:0, y:0, z:0}` |
| `objectType` | string | No | Type of detected object. Default: `"person"` |
| `boundingBox` | object | No | Physical dimensions. Default: `{width:0.5, height:1.7, depth:0.5}` |
| `confidence` | number | No | Detection confidence 0.0-1.0 |

### Coordinate System

```
        Y (Up)
        │
        │
        │
        └───────── X (East)
       /
      /
     Z (North)

Origin: Southwest corner of venue ROI, at floor level
Units: Meters
```

### Publishing Rate

- **Recommended**: 10 Hz (every 100ms)
- **Minimum**: 5 Hz (every 200ms)
- **Maximum**: 30 Hz (every 33ms)

---

## Alternative: Batch Format

If you prefer to send multiple tracks in one message:

```json
{
  "venueId": "595c4d73-b0bb-4ff4-9f18-94df5d4be476",
  "tracks": [
    {
      "id": "person-42",
      "timestamp": 1707624000000,
      "position": { "x": 15.3, "y": 0.0, "z": 22.7 },
      "velocity": { "x": 0.5, "y": 0.0, "z": -0.3 },
      "objectType": "person"
    },
    {
      "id": "person-43",
      "timestamp": 1707624000000,
      "position": { "x": 8.1, "y": 0.0, "z": 12.4 },
      "velocity": { "x": -0.2, "y": 0.0, "z": 0.1 },
      "objectType": "person"
    }
  ]
}
```

---

## DEB Package Requirements

### 1. Executable Entry Point

Your DEB must install an executable. Tell us:
- **Path**: e.g., `/usr/bin/my-tracker`
- **Arguments**: e.g., `--config /config/extrinsics.json`

We will run: `/usr/bin/my-tracker --config /config/extrinsics.json`

### 2. Dependencies

Your DEB should include all dependencies, OR specify Ubuntu 22.04 apt packages needed.

### 3. Network Access

Your provider will have:
- Access to LiDAR devices on local network (UDP multicast or direct IP)
- Access to MQTT broker via `$MQTT_BROKER`

### 4. No GUI

Provider must run headless (no display required).

---

## Minimal Implementation Example (Node.js)

```javascript
const mqtt = require('mqtt');

// Read environment variables
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'hyperspace/trajectories/test';
const VENUE_ID = process.env.VENUE_ID || 'default';

// Connect to MQTT
const client = mqtt.connect(MQTT_BROKER);

client.on('connect', () => {
  console.log(`Connected to ${MQTT_BROKER}`);
  
  // Publish trajectories at 10Hz
  setInterval(() => {
    const trajectory = {
      id: `person-${trackId}`,           // Your tracking ID
      venueId: VENUE_ID,
      timestamp: Date.now(),
      position: {
        x: detectedX,                     // From your algorithm
        y: 0,
        z: detectedZ                      // From your algorithm
      },
      velocity: {
        x: velocityX,
        y: 0,
        z: velocityZ
      },
      objectType: 'person'
    };
    
    client.publish(MQTT_TOPIC, JSON.stringify(trajectory), { qos: 1 });
  }, 100);
});
```

---

## Checklist for Providers

Before delivering your DEB package:

- [ ] Reads `$MQTT_BROKER` environment variable
- [ ] Reads `$MQTT_TOPIC` environment variable (uses as-is, no modification)
- [ ] Reads `$VENUE_ID` environment variable
- [ ] Publishes JSON with required fields: `id`, `venueId`, `timestamp`, `position`
- [ ] Position uses correct coordinate system (X-East, Y-Up, Z-North, meters)
- [ ] Track IDs are consistent across frames for the same person
- [ ] Publishes at 10Hz or faster
- [ ] Runs on Ubuntu 22.04
- [ ] Runs headless (no GUI)
- [ ] Handles MQTT reconnection gracefully

---

## Testing Your Integration

### 1. Test MQTT Locally

```bash
# Terminal 1: Subscribe to see your messages
mosquitto_sub -h localhost -t "hyperspace/trajectories/#" -v

# Terminal 2: Run your provider
MQTT_BROKER=mqtt://localhost:1883 \
MQTT_TOPIC=hyperspace/trajectories/test \
VENUE_ID=test-venue \
/usr/bin/your-tracker
```

### 2. Validate JSON Output

Each message should look like:
```json
{"id":"person-1","venueId":"test-venue","timestamp":1707624000000,"position":{"x":10.5,"y":0,"z":15.2}}
```

---

## Contact

For integration questions, contact the Hyperspace team.
