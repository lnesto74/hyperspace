# Hyperspace Edge Simulator

Simulates a LiDAR sensor running on an edge device (e.g., laptop "ulisse" on Tailscale) that publishes people trajectories via MQTT.

## Requirements

- Node.js 18+
- MQTT broker (e.g., Mosquitto)

## Installation

```bash
npm install
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MQTT_BROKER_URL` | `mqtt://localhost:1883` | MQTT broker URL |
| `DEVICE_ID` | `lidar-ulisse` | Unique device identifier |
| `VENUE_ID` | `default` | Venue ID to publish tracks for |
| `VENUE_WIDTH` | `20` | Venue width in meters |
| `VENUE_DEPTH` | `15` | Venue depth in meters |
| `NUM_PEOPLE` | `5` | Number of simulated people |
| `UPDATE_INTERVAL_MS` | `100` | Update frequency (ms) |

## Running

### Local Development

Start a local MQTT broker (e.g., Mosquitto):
```bash
# macOS
brew install mosquitto
mosquitto -v

# Or use Docker
docker run -d -p 1883:1883 eclipse-mosquitto
```

Run the simulator:
```bash
npm start
```

### Remote Edge Device

Copy this folder to the edge device and run:
```bash
MQTT_BROKER_URL=mqtt://your-broker:1883 \
DEVICE_ID=lidar-ulisse \
VENUE_ID=your-venue-id \
npm start
```

## Interactive Commands

While running, you can type commands:
- `+` or `add` - Add a new person
- `-` or `remove` - Remove a person
- `status` - Show current count

## MQTT Message Format

Topic: `hyperspace/trajectories/{deviceId}`

Message:
```json
{
  "venueId": "venue-123",
  "deviceId": "lidar-ulisse",
  "timestamp": 1706954400000,
  "tracks": [
    {
      "id": "1",
      "trackKey": "lidar-ulisse-person-1",
      "timestamp": 1706954400000,
      "position": { "x": 5.2, "y": 0, "z": 8.1 },
      "venuePosition": { "x": 5.2, "y": 0, "z": 8.1 },
      "velocity": { "x": 0.8, "y": 0, "z": -0.3 },
      "objectType": "person",
      "boundingBox": {
        "width": 0.5,
        "height": 1.7,
        "depth": 0.5
      }
    }
  ]
}
```

## Backend Integration

The Hyperspace backend automatically subscribes to MQTT trajectories and forwards them to connected frontend clients via Socket.IO.

Set these environment variables in the backend:
- `MQTT_BROKER_URL` - MQTT broker URL
- `MQTT_TRAJECTORY_TOPIC` - Topic pattern (default: `hyperspace/trajectories/#`)
- `MQTT_ENABLED` - Set to `false` to disable (enabled by default)
