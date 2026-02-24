# Hyperspace Production Deployment Guide

## Architecture Overview

```
Internet Users ──→ Caddy (:443 HTTPS) ──→ Frontend (static React)
                      │
                      ├──→ /api/*       → Backend (Express :3001)
                      ├──→ /socket.io/* → Backend (WebSocket)
                      └──→ /uploads/*   → Backend (static files)

Edge Devices ──→ Tailscale VPN ──→ Mosquitto MQTT (:1883) ──→ Backend
                                                                 │
                                                           SQLite (NVMe)
```

## What You Need

| Item | Details |
|------|---------|
| **DigitalOcean Droplet** | Regular 4GB (2 vCPU, 4GB RAM, 80GB SSD) — $24/mo |
| **Domain** (optional) | For HTTPS. Without it, use IP-only on port 80. |
| **Tailscale account** | Free for personal use (up to 100 devices) |
| **Your existing API keys** | OpenAI, Resend (from your current .env) |

---

## Step 1: Create DigitalOcean Droplet

1. Go to [cloud.digitalocean.com](https://cloud.digitalocean.com) (sign up with GitHub/Google SSO)
2. Click **"Create" → "Droplets"**
3. Configure:
   - **Region**: Amsterdam (AMS3) for Europe, or New York (NYC1) for US
   - **Image**: **Marketplace → Docker on Ubuntu 22.04** (Docker pre-installed!)
   - **Size**: Regular SSD → **$24/mo** (2 vCPU, 4GB RAM, 80GB SSD)
   - **Authentication**: SSH Key → Add your public key (`cat ~/.ssh/id_rsa.pub`)
   - **Hostname**: `hyperspace-prod`
   - **Backups**: Enable ($4.80/mo extra — worth it for DB safety)
4. Click **"Create Droplet"**
5. Note the **public IP** (e.g., `164.90.x.x`)

> 💡 **Why 4GB**: Your backend runs Socket.IO + MQTT + SQLite + TrackAggregator + ProfitRadar.
> For multiple venues, upgrade to the $48/mo (4 vCPU, 8GB RAM) Droplet.

---

## Step 2: SSH into Server & Run Setup

```bash
# From your Mac
ssh root@164.90.x.x
```

### Option A: Automated setup (recommended)

```bash
# Upload and run the setup script
scp deploy/setup-server.sh root@164.90.x.x:/tmp/
ssh root@164.90.x.x 'bash /tmp/setup-server.sh'
```

### Option B: Manual setup

```bash
# Update system
apt update && apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker

# Install Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --ssh
# ↑ Opens a URL — authenticate in your browser

# Verify Tailscale IP
tailscale ip -4
# → e.g., 100.64.0.5

# Create data directories
mkdir -p /data/hyperspace/{db,uploads,models}
mkdir -p /var/log/caddy
```

---

## Step 3: Deploy the Application

```bash
# Clone your repo
cd /opt
git clone https://github.com/YOUR_REPO/Hyperspace.git hyperspace
cd /opt/hyperspace

# Create production .env from template
cp deploy/.env.production .env
nano .env
```

### Fill in `.env` on the server:

```env
# ---- Required: Update these ----
DOMAIN=app.yourdomain.com          # Or remove for IP-only access
EDGE_SERVER_URL=http://100.x.y.z:8080  # Your edge device's Tailscale IP
OPENAI_API_KEY=sk-proj-YOUR_KEY
RESEND_API_KEY=re_YOUR_KEY
RESEND_FROM_EMAIL=Hyperspace <noreply@yourdomain.com>
LEAD_NOTIFICATION_EMAIL=you@yourdomain.com
```

### Build and start:

```bash
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

### Verify everything is running:

```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Check backend health
curl http://localhost:3001/api/health

# Check logs
docker compose -f docker-compose.prod.yml logs -f backend
```

---

## Step 4: Configure Tailscale for Edge Devices

On the DigitalOcean Droplet, Tailscale is already running. Your edge devices need to publish MQTT trajectories to the **server's Tailscale IP** instead of your Mac's.

### Update edge device MQTT config:

```bash
# On each edge device, update MQTT broker URL:
# Old (your Mac):   mqtt://100.78.174.103:1883
# New (Droplet):    mqtt://100.64.0.5:1883  (your server's Tailscale IP)
```

### Verify MQTT connectivity from edge:

```bash
# On edge device (via Tailscale SSH)
mosquitto_pub -h 100.64.0.5 -t "test/hello" -m "ping"

# On server, check Mosquitto received it:
docker compose -f docker-compose.prod.yml logs mosquitto
```

### Firewall: MQTT is only accessible via Tailscale

The setup script configures UFW to only allow port 1883 from the `tailscale0` interface. This means:
- ✅ Edge devices on your tailnet → can connect to MQTT
- ❌ Random internet scanners → blocked

---

## Step 5: DNS & HTTPS (if using a domain)

### Point your domain to the server:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | app | 164.90.x.x | 300 |

### Caddy handles HTTPS automatically

Once DNS propagates, Caddy will:
1. Detect the domain from the `DOMAIN` env var
2. Request a Let's Encrypt certificate automatically
3. Enable HTTPS + HTTP/2 + HTTP/3 (QUIC)
4. Auto-renew certificates

**No nginx config, no certbot, no cron jobs.**

### No domain? Use IP-only:

Remove `DOMAIN` from `.env` or set `DOMAIN=:80`. Access via `http://164.90.x.x`.

---

## Step 6: Migrate Existing Data (Optional)

If you have venue data, ROIs, DWG layouts etc. on your Mac:

```bash
# On your Mac — copy SQLite database to server
scp backend/database/hyperspace.db root@164.90.x.x:/data/hyperspace/db/

# Copy uploaded files (logos, floor plans, DOOH videos)
scp -r uploads/ root@164.90.x.x:/data/hyperspace/uploads/
scp -r backend/models/ root@164.90.x.x:/data/hyperspace/models/

# Restart backend to pick up the database
ssh root@164.90.x.x 'cd /opt/hyperspace && docker compose -f docker-compose.prod.yml restart backend'
```

---

## Database Details

### Why SQLite (not Postgres)?

| Factor | SQLite on NVMe | Postgres |
|--------|----------------|----------|
| Trajectory write latency | **<1ms** | ~2-5ms |
| No network hop | ✅ Same process | ❌ TCP/Unix socket |
| RAM usage | ~50MB | ~200MB+ |
| Backup | Copy single file | pg_dump |
| Concurrent writes | Single writer (fine for 1 server) | Multi-writer |
| Operational complexity | Zero | Needs maintenance |

Your app is **single-server, write-heavy (trajectories), read-light (API queries)** — SQLite is the optimal choice.

### Production SQLite Tuning

The schema currently uses `journal_mode = DELETE` and `synchronous = FULL`. For production, consider switching to WAL mode for better concurrent read performance:

```js
// In database/schema.js — change these lines:
db.pragma('journal_mode = WAL');       // Write-Ahead Log: readers don't block writers
db.pragma('synchronous = NORMAL');     // Good durability + better write speed
db.pragma('cache_size = -64000');      // 64MB page cache (default is 2MB)
db.pragma('mmap_size = 268435456');    // 256MB memory-mapped I/O
```

### Backup Strategy

The setup script installs a daily cron job:
- Runs at 3:00 AM
- Copies `hyperspace.db` to `/data/hyperspace/backups/`
- Keeps last 7 backups
- DigitalOcean's automatic backup snapshots also protect the entire disk

---

## Latency Optimization Summary

### Trajectory Pipeline: Edge → Screen

```
Edge LiDAR sensor
    ↓ (local processing)
Edge Server (on-site, Tailscale)
    ↓ MQTT publish (~5-15ms via WireGuard)
Mosquitto broker (Droplet, localhost)
    ↓ <1ms (same machine)
Backend MqttTrajectoryService
    ↓ <1ms (in-memory)
TrackAggregator.addTrack()
    ↓ <1ms (in-memory, setImmediate for DB)
Socket.IO emit to venue room
    ↓ 10-30ms (internet to browser)
Frontend renders tracks
═══════════════════════════
Total: ~20-50ms end-to-end
```

### What keeps it fast:

1. **MQTT persistence=false** — no disk I/O for message delivery
2. **SQLite writes via setImmediate()** — never blocks track emission
3. **ROI cache (5s TTL)** — avoids DB query per track update
4. **Caddy HTTP/3 (QUIC)** — lower latency for browser connections
5. **TCP tuning** (tcp_nodelay, tcp_fastopen) — reduces kernel buffering
6. **SSD storage** — SQLite writes complete in microseconds

---

## Operations Cheatsheet

```bash
# Deploy/redeploy after code changes
hyperspace-deploy

# View all logs (live)
hyperspace-logs

# View specific service logs
hyperspace-logs backend
hyperspace-logs mosquitto

# Manual backup
hyperspace-backup

# Restart a single service
cd /opt/hyperspace
docker compose -f docker-compose.prod.yml restart backend

# Stop everything
docker compose -f docker-compose.prod.yml down

# Check resource usage
docker stats

# Check Tailscale status
tailscale status

# SSH to server from anywhere (via Tailscale)
ssh root@hyperspace-prod   # If you enabled --ssh flag
```

---

## Cost Summary

| Service | Monthly Cost |
|---------|-------------|
| DigitalOcean Droplet (2 vCPU, 4GB, 80GB SSD) | $24 |
| DigitalOcean automatic backups | $4.80 |
| Tailscale (free tier) | $0 |
| Let's Encrypt (via Caddy) | $0 |
| **Total** | **$28.80/mo** |

---

## Troubleshooting

### Backend won't start
```bash
docker compose -f docker-compose.prod.yml logs backend
# Common: missing .env variables, DB path permissions
```

### MQTT not receiving from edge devices
```bash
# Check Mosquitto is listening
docker compose -f docker-compose.prod.yml logs mosquitto

# Check firewall allows Tailscale
ufw status | grep 1883

# Test from edge device
mosquitto_pub -h <server-tailscale-ip> -t "test" -m "hello"
```

### Tailscale not connecting
```bash
tailscale status
tailscale ping <edge-device-ip>
```

### Database locked errors
Switch to WAL mode (see Database section above). SQLite in DELETE journal mode allows only one writer at a time.
