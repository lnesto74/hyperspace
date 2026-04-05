# Edge Server Setup Guide

Complete guide for deploying Hyperspace edge servers on Linux machines.

## Prerequisites

- A Linux machine (Ubuntu/Debian) with internet access
- A Tailscale account (for VPN connectivity to the main Hyperspace server)
- The main Hyperspace server running with Mosquitto on port 1883

## Quick Install (Automated)

On a fresh Linux machine, run:

```bash
curl -fsSL https://raw.githubusercontent.com/lnesto74/hyperspace/main/edge-server/install.sh | bash
```

Or if you already have the repo:

```bash
cd edge-server && chmod +x install.sh && ./install.sh
```

The script installs everything (SSH, Docker, Tailscale, Mosquitto clients) and runs validation tests. The only interactive prompts are:

- **Tailscale authentication** — open the printed URL in your browser
- **Main server Tailscale IP** — the IP of the machine running the main Hyperspace backend + Mosquitto

## Manual Install (Step by Step)

### 1. Install OpenSSH Server

```bash
sudo apt-get update
sudo apt-get install -y openssh-server
sudo systemctl enable --now ssh
```

### 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

Install Compose plugin:

```bash
sudo apt-get install -y docker-compose-plugin
docker compose version
```

### 3. Disable System Mosquitto

If `mosquitto` was installed via apt, it conflicts with the Docker Mosquitto on port 1883:

```bash
sudo systemctl stop mosquitto
sudo systemctl disable mosquitto
```

### 4. Install Tailscale

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo systemctl enable --now tailscaled
sudo tailscale up
```

Note the Tailscale IP — this is how the main server reaches the edge:

```bash
tailscale ip -4
```

### 5. Install Utility Packages

```bash
sudo apt-get install -y mosquitto-clients jq git
```

### 6. Get the Edge Server Code

**Option A — From GitHub (recommended):**

```bash
git clone --depth 1 --sparse git@github.com:lnesto74/hyperspace.git ~/.hyperspace-repo
cd ~/.hyperspace-repo && git sparse-checkout set edge-server
rsync -a --delete --exclude 'data' ~/.hyperspace-repo/edge-server/ ~/edge-server/
```

**Option B — Copy from your Mac via SCP:**

```bash
# Run on your Mac
rsync -avz --delete \
  --exclude 'frontend/node_modules' \
  --exclude 'backend/node_modules' \
  --exclude 'data' \
  /path/to/Hyperspace/edge-server/ \
  edge@<edge-tailscale-ip>:~/edge-server/
```

### 7. Configure the MQTT Bridge

Edit `~/edge-server/mosquitto/config/mosquitto.conf` and set the bridge address to your main server's Tailscale IP:

```bash
nano ~/edge-server/mosquitto/config/mosquitto.conf
```

Change the `address` line:

```
address <main-server-tailscale-ip>:1883
```

### 8. Build and Start

```bash
cd ~/edge-server
docker compose up -d --build
```

First build takes 3–5 minutes. Check status:

```bash
docker compose ps
docker compose logs -f
```

### 9. Install Tailscale Watchdog

Auto-reconnects Tailscale if the VPN drops:

```bash
sudo cp ~/edge-server/tailscale-watchdog.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/tailscale-watchdog.sh
sudo apt-get install -y jq
(crontab -l 2>/dev/null; echo "*/2 * * * * /usr/local/bin/tailscale-watchdog.sh >> /var/log/tailscale-watchdog.log 2>&1") | crontab -
```

## Validation

After install, verify everything works:

```bash
# Containers running
docker compose ps

# Ports listening
ss -tlnp | grep -E '1883|8080'

# Edge UI responds
curl -s http://127.0.0.1:8080/api/config | jq .

# MQTT round-trip
mosquitto_sub -h 127.0.0.1 -p 1883 -t 'test/#' -C 1 &
mosquitto_pub -h 127.0.0.1 -p 1883 -t 'test/ping' -m 'ok'

# Tailscale connected
tailscale status

# Bridge reachable
tailscale ping <main-server-tailscale-ip>
```

## Configuration

### From the Edge UI (http://\<edge-ip\>:8080)

| Field | Description |
|-------|-------------|
| **Edge Operating Mode** | `Simulate` (test data), `Live Tracks` (real LiDAR), or `Off` |
| **MQTT Bridge Target** | `Production` or `Development` (auto-detects your Mac IP) |
| **Perception Input Topic** | MQTT topic from perception software (default: `fast3dis/objects`) |

### From the Main Hyperspace App (Edge Simulator Control)

The Edge Simulator Control panel in the main Hyperspace frontend can:

- Select the edge server from the dropdown
- Set the **target venue** (sends the venue UUID to the edge)
- Start/stop simulation remotely
- Push config (device ID, venue dimensions, simulation parameters)

## Architecture

```
Edge Device                           Main Server
┌──────────────────────────┐          ┌──────────────────────────┐
│  Perception Software     │          │  Mosquitto :1883         │
│  (fast3dis/objects)      │          │  Backend :3001           │
│          │               │          │  Frontend :5173          │
│          ▼               │          └──────────┬───────────────┘
│  ┌────────────────────┐  │                     │
│  │ Mosquitto :1883    │──┼── MQTT bridge ──────┘
│  │ (host network)     │  │   (Tailscale VPN)
│  └────────┬───────────┘  │
│           │               │
│  ┌────────┴───────────┐  │
│  │ Edge Server :8080  │  │
│  │ Perception Adapter │  │
│  │ (normalize tracks) │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

### Data Flow (Live Tracks Mode)

1. **Perception software** publishes to `fast3dis/objects` on local Mosquitto (127.0.0.1:1883)
2. **Perception Adapter** subscribes, unpacks each frame, normalizes to Hyperspace format
3. **Adapter republishes** each person to `hyperspace/trajectories/<deviceId>` with correct venue UUID
4. **Mosquitto bridge** forwards `hyperspace/trajectories/#` to the main server via Tailscale
5. **Main backend** (`MqttTrajectoryService`) receives tracks, aggregates, emits via Socket.IO
6. **Frontend 3D canvas** renders live people

### Data Flow (Simulate Mode)

Same as above, but the edge server's built-in simulator generates fake trajectories instead of the perception adapter.

## Port Summary

| Port | Service | Access |
|------|---------|--------|
| 8080 | Edge UI + REST API | LAN / Tailscale |
| 8081 | WebSocket (point cloud stream) | LAN / Tailscale |
| 1883 | Mosquitto MQTT broker | LAN / Tailscale |

## Common Issues

### "Address in use" on Mosquitto startup

A system-level `mosquitto` is already using port 1883:

```bash
sudo systemctl stop mosquitto && sudo systemctl disable mosquitto
docker compose restart mosquitto
```

### "Error creating bridge: Network unreachable"

Mosquitto can't reach the main server. Check:

```bash
# Is Tailscale connected?
tailscale status

# Can you reach the main server?
tailscale ping <main-server-ip>

# Is the bridge address correct?
grep 'address' ~/edge-server/mosquitto/config/mosquitto.conf
```

### Docker build fails with "Cannot find module '../lib/tsc.js'"

The `.dockerignore` is missing or `node_modules` from the host leaked into the image:

```bash
# Ensure .dockerignore exists
cat ~/edge-server/.dockerignore

# Force clean rebuild
docker compose build --no-cache edge-lidar
docker compose up -d
```

### Tracks don't appear in main frontend

Check the full pipeline:

```bash
# 1. Perception publishing?
mosquitto_sub -h 127.0.0.1 -p 1883 -t 'fast3dis/objects' -C 1 | head -c 100

# 2. Adapter republishing?
mosquitto_sub -h 127.0.0.1 -p 1883 -t 'hyperspace/trajectories/#' -C 1

# 3. Check venueId is correct (must be UUID, not display name)
curl -s http://127.0.0.1:8080/api/config | jq '.venueId'

# 4. Bridge target correct?
grep 'address' ~/edge-server/mosquitto/config/mosquitto.conf

# 5. Tracks arrive on main server?
# (run on main server)
mosquitto_sub -h 127.0.0.1 -p 1883 -t 'hyperspace/trajectories/#' -C 1
```

## Useful Commands

```bash
# Start/stop
cd ~/edge-server && docker compose up -d
cd ~/edge-server && docker compose down

# Rebuild after code update
cd ~/edge-server && docker compose up -d --build

# Live logs
docker compose logs -f
docker compose logs -f edge-lidar
docker compose logs -f mosquitto

# Watch all MQTT traffic
mosquitto_sub -h 127.0.0.1 -p 1883 -t '#' -v

# Check edge mode
curl -s http://127.0.0.1:8080/api/edge-mode | jq .

# Check config
curl -s http://127.0.0.1:8080/api/config | jq .

# Re-run install script (safe, idempotent)
cd ~/edge-server && ./install.sh
```
