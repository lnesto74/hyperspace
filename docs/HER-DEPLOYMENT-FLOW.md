# HER Deployment Flow

> Hyperspace Edge Runtime - Complete Deployment Pipeline

This document describes the full flow from uploading a vendor `.deb` package to seeing trajectories in the viewport.

---

## Overview

The HER (Hyperspace Edge Runtime) system allows deploying algorithm provider modules to edge devices. Providers can be:

1. **Docker images** (existing) - Ready to deploy
2. **DEB packages** - Converted to Docker images via the Conversion Service

---

## Phase 1: DEB → Docker Conversion

### 1.1 Upload DEB Package

**Frontend**: Algorithm Provider panel → "Convert New" tab

**API Endpoint**:
```
POST /api/algorithm-providers/conversion/build
Content-Type: multipart/form-data

Body:
- debFiles[]: One or more .deb files
- metadata: JSON with provider configuration
```

**Metadata Schema**:
```json
{
  "providerId": "my-provider",
  "displayName": "My Provider",
  "version": "1.0.0",
  "runCommand": ["/usr/bin/tracker", "--config", "/config/extrinsics.json"],
  "supportedLidars": ["Livox Mid-360"],
  "requiresGpu": false,
  "ubuntuBase": "22.04"
}
```

### 1.2 Backend Processing

**File**: `backend/routes/algorithmProviders.js`

1. Validate `.deb` files (magic number check for `!<arch>`)
2. Parse and validate metadata
3. Create/update provider record in `algorithm_providers` table
4. Queue build job → `buildProviderImage()`

### 1.3 Docker Image Build

**File**: `backend/services/ProviderBuildService.js`

The build service generates a Dockerfile and entrypoint script:

#### Generated Dockerfile

```dockerfile
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# Base dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates \
    curl \
    jq \
    tini \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Node.js 18 (required by many providers)
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# MQTT client library for trajectory publishing
RUN npm install -g mqtt

# Install vendor .deb packages
COPY *.deb /tmp/
RUN apt-get update && \
    apt-get install -y /tmp/*.deb || true && \
    apt-get install -f -y && \
    rm -rf /var/lib/apt/lists/* /tmp/*.deb

# Setup
RUN mkdir -p /data && chmod 755 /data
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Non-root user
RUN useradd -m -s /bin/bash -u 1000 provider && \
    chown -R provider:provider /data

USER provider
WORKDIR /data

# Environment variables (set at runtime)
ENV MQTT_BROKER=mqtt://localhost:1883
ENV MQTT_TOPIC=hyperspace/trajectories
ENV MQTT_QOS=1
ENV EDGE_ID=
ENV VENUE_ID=
ENV CONFIG_FILE=/data/deployment.json

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
```

#### Generated entrypoint.sh

```bash
#!/bin/bash
set -e

echo "[HER Provider] Starting ${PROVIDER_NAME} v${VERSION}"
echo "[HER Provider] EDGE_ID: ${EDGE_ID}"
echo "[HER Provider] VENUE_ID: ${VENUE_ID}"
echo "[HER Provider] MQTT_BROKER: ${MQTT_BROKER}"
echo "[HER Provider] MQTT_TOPIC: ${MQTT_TOPIC}"

# Config file is optional - don't block startup
if [ -f "${CONFIG_FILE}" ]; then
  echo "[HER Provider] Config file found: ${CONFIG_FILE}"
else
  echo "[HER Provider] No config file, using environment variables"
fi

# MQTT_TOPIC is already set correctly via environment
echo "[HER Provider] MQTT topic: ${MQTT_TOPIC}"
echo "[HER Provider] Executing provider command..."

exec ${RUN_COMMAND}
```

### 1.4 Image Registry

After build:
1. Image tagged as `ghcr.io/hyperspace-ai/providers/{providerId}:{version}`
2. Pushed to registry (if credentials configured)
3. Database updated with `docker_image_ref`

---

## Phase 2: HER Deployment

### 2.1 Initiate Deploy from UI

**Frontend**: Edge Commissioning page → "Deploy HER" button

**File**: `frontend/src/components/edgeCommissioning/EdgeCommissioningPage.tsx`

User configures:
- Select edge device
- Select algorithm provider
- Enter MQTT Broker URL (stored in localStorage)

### 2.2 Deploy Request

**File**: `frontend/src/context/EdgeCommissioningContext.tsx`

```typescript
deployHer(edgeId, venueId, providerId, mqttBrokerUrl)
```

**API Call**:
```
POST /api/edge-commissioning/edge/{edgeId}/deploy-her
Content-Type: application/json

Body:
{
  "venueId": "uuid",
  "providerId": "my-provider",
  "mqttBrokerUrl": "mqtt://100.110.178.91:1883"
}
```

### 2.3 Backend Prepares Deployment

**File**: `backend/routes/edgeCommissioning.js`

1. Lookup provider → get `dockerImage`
2. Lookup edge → get `tailscaleIp`
3. Get lidar pairings and venue ROI bounds
4. Build deployment payload:

```javascript
const deployment = {
  deploymentId: uuid(),
  edgeId,
  venueId,
  mqtt: {
    broker: mqttBrokerUrl || 'mqtt://localhost:1883',
    topic: `hyperspace/trajectories/${edgeId}`,  // Topic set here!
    qos: 1,
  },
  lidars: [...],
  coordinateFrame: {...},
  venueBounds: {...},
};
```

5. Forward to edge server via Tailscale

### 2.4 Edge Server Receives Deploy

**File**: `edge-server/backend/her-manager.js`

```javascript
async function deployHer(payload, onSimulatorStop) {
  // 1. Stop simulator
  onSimulatorStop();
  
  // 2. Write extrinsics config
  fs.writeFileSync(EXTRINSICS_FILE, JSON.stringify(deployment));
  
  // 3. Stop existing container
  await execAsync('docker stop her-provider; docker rm her-provider');
  
  // 4. Pull image
  await execAsync(`docker pull ${dockerImage}`);
  
  // 5. Start container with environment variables
  const envVars = {
    MQTT_BROKER: deployment.mqtt.broker,
    MQTT_TOPIC: deployment.mqtt.topic,  // Already includes edgeId!
    EDGE_ID: deployment.edgeId,
    VENUE_ID: deployment.venueId,
    CONFIG_FILE: '/config/extrinsics.json',
  };
  
  await execAsync(`docker run -d --name her-provider --network host ... ${dockerImage}`);
}
```

### 2.5 Container Starts Publishing

The provider container:
1. Reads environment variables
2. Connects to MQTT broker
3. Publishes trajectories to `MQTT_TOPIC`

**Example message format**:
```json
{
  "id": "traj-123",
  "deviceId": "nodekey:abc123",
  "venueId": "uuid",
  "timestamp": 1708261234567,
  "position": { "x": 25.5, "y": 0, "z": 15.2 },
  "velocity": { "x": 0.5, "y": 0, "z": -0.3 },
  "objectType": "person",
  "confidence": 0.95
}
```

---

## Phase 3: Trajectory Reception

### 3.1 MQTT Broker

Mosquitto running on main server (Mac):
- Listens on port 1883
- Receives trajectories from edge devices

### 3.2 Backend MQTT Service

**File**: `backend/services/MqttTrajectoryService.js`

```javascript
// Subscribe to all trajectory topics
this.topic = 'hyperspace/trajectories/#';

client.on('message', (topic, message) => {
  const data = JSON.parse(message);
  
  // Process and emit to frontend
  this.io.of('/tracking').emit('tracks', {
    venueId,
    tracks: [processedTrack]
  });
});
```

### 3.3 Frontend Display

**Socket.IO**: Connects to `/tracking` namespace
**Viewport**: Renders trajectory dots in 3D space

---

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `MQTT_BROKER` | MQTT broker URL | `mqtt://100.110.178.91:1883` |
| `MQTT_TOPIC` | Topic for publishing | `hyperspace/trajectories/nodekey:abc` |
| `MQTT_QOS` | MQTT QoS level | `1` |
| `EDGE_ID` | Edge device identifier | `nodekey:e8ff657dc...` |
| `VENUE_ID` | Venue UUID | `1f6c779c-5f09-445f-...` |
| `CONFIG_FILE` | Path to extrinsics config | `/config/extrinsics.json` |

---

## Troubleshooting

### Container not starting
```bash
sudo docker logs her-provider --tail 50
```

### Check MQTT connectivity
```bash
# On Mac
lsof -i :1883

# Should show connection from edge device
```

### Verify image version
```bash
sudo docker inspect her-provider --format '{{.Config.Image}}'
```

### Check environment variables
```bash
sudo docker inspect her-provider --format '{{.Config.Env}}'
```

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/routes/algorithmProviders.js` | DEB upload & conversion API |
| `backend/services/ProviderBuildService.js` | Docker image generation |
| `backend/routes/edgeCommissioning.js` | HER deploy endpoint |
| `edge-server/backend/her-manager.js` | Edge-side container management |
| `backend/services/MqttTrajectoryService.js` | Trajectory reception |
| `frontend/.../EdgeCommissioningPage.tsx` | Deploy UI |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.4 | 2026-02-18 | Fixed MQTT package, entrypoint, topic duplication |
