# SimTracker - Test .deb Package

A standalone trajectory publisher for testing the **DEB → Docker Conversion Service** pipeline.

## Quick Start

### 1. Build the .deb package

```bash
cd test-packages/sim-tracker
chmod +x build-deb.sh
./build-deb.sh
```

This creates `sim-tracker_1.0.0_amd64.deb`

### 2. Test with Conversion Service

1. Open the Edge Commissioning page
2. Navigate to the **Algorithm** tab
3. Click **Convert .deb** tab
4. Fill in the form:
   - **Provider ID**: `sim-tracker`
   - **Display Name**: `SimTracker Test`
   - **Version**: `1.0.0`
   - **Run Command**: `["/usr/bin/node", "/opt/sim-tracker/src/tracker.js"]`
   - **Supported LiDARs**: Select any
5. Upload `sim-tracker_1.0.0_amd64.deb`
6. Click **Build Provider Module**

### 3. Watch the build progress

The build will:
1. Generate a Dockerfile
2. Build a Docker image with the .deb installed
3. (Optionally) push to registry

## Environment Variables

When running inside Docker, these are automatically set by HER:

| Variable | Description | Default |
|----------|-------------|---------|
| `MQTT_BROKER` | MQTT broker URL | `mqtt://localhost:1883` |
| `MQTT_TOPIC` | Base topic | `hyperspace/trajectories` |
| `EDGE_ID` | Edge device ID | `test-edge-001` |
| `VENUE_ID` | Venue ID | `test-venue-001` |
| `CONFIG_FILE` | Path to deployment.json | - |

## What it does

SimTracker simulates 3-5 agents walking randomly within venue bounds and publishes their trajectories to MQTT every 100ms in the standard Hyperspace format:

```json
{
  "trackId": "agent-1",
  "timestamp": 1708251234567,
  "position": { "x": 5.234, "y": 0, "z": 8.123 },
  "velocity": { "x": 0.5, "y": 0, "z": -0.3 },
  "confidence": 0.95,
  "classification": "person",
  "edgeId": "edge-001",
  "venueId": "venue-001",
  "source": "sim-tracker"
}
```

## Files

```
sim-tracker/
├── src/
│   └── tracker.js      # Main application
├── debian/
│   ├── control         # Package metadata
│   └── postinst        # Post-install script
├── package.json        # Node.js dependencies
├── build-deb.sh        # Build script
└── README.md           # This file
```
