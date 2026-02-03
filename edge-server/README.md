# Edge LiDAR Server

Dockerized trajectory simulator for edge devices. Sends simulated person trajectories via MQTT to the main Hyperspace server.

## Quick Start on Ubuntu (Ulisse)

### 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and log back in
```

### 2. Copy edge-server folder to Ulisse

From your Mac:
```bash
scp -r edge-server ulisse@100.78.174.103:~/
```

### 3. Build and Run

SSH into Ulisse:
```bash
ssh ulisse@100.78.174.103
cd ~/edge-server
docker-compose up -d --build
```

### 4. Access the UI

Open in browser: `http://100.78.174.103:8080`

### 5. Configure

1. Set **MQTT Broker URL** to your Mac's Tailscale IP: `mqtt://100.x.x.x:1883`
2. Set **Device ID** (unique identifier for this edge device)
3. Set **Venue ID** (from your Hyperspace app)
4. Adjust frequency, person count, venue size as needed
5. Click **Start Simulation**

## Configuration Options

| Parameter | Description | Default |
|-----------|-------------|---------|
| MQTT Broker URL | Main server's MQTT broker | `mqtt://localhost:1883` |
| Device ID | Unique LiDAR identifier | `lidar-edge-001` |
| Venue ID | Target venue ID | `default-venue` |
| Frequency (Hz) | Updates per second | 10 |
| Person Count | Simulated people | 5 |
| Venue Width (m) | Simulation area width | 20 |
| Venue Depth (m) | Simulation area depth | 15 |

## Docker Commands

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# View logs
docker-compose logs -f

# Rebuild after changes
docker-compose up -d --build

# Remove everything
docker-compose down -v --rmi all
```

## Architecture

```
Edge Device (Ulisse)              Main Server (Your Mac)
┌─────────────────────┐           ┌─────────────────────┐
│  Edge LiDAR Server  │  MQTT     │  Mosquitto :1883    │
│  :8080              │ ───────>  │  Backend :3001      │
│                     │           │  Frontend :5173     │
└─────────────────────┘           └─────────────────────┘
        │                                   │
        └───────── Tailscale VPN ───────────┘
```

## MQTT Topic Format

Trajectories are published to:
```
hyperspace/trajectories/{deviceId}
```

Message format:
```json
{
  "id": "person-0",
  "deviceId": "lidar-edge-001",
  "venueId": "venue-123",
  "timestamp": 1706961234567,
  "position": { "x": 5.2, "y": 0, "z": 8.1 },
  "velocity": { "x": 0.5, "y": 0, "z": -0.3 },
  "objectType": "person",
  "color": "#22c55e",
  "boundingBox": { "width": 0.5, "height": 1.7, "depth": 0.5 }
}
```
