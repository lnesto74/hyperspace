# Hyperspace Backend - Production Dockerfile
# Node 18 with native module support for better-sqlite3
FROM node:18-slim AS builder

WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better layer caching
COPY package.json package-lock.json* ./

# Install all dependencies (including dev for build step if needed)
RUN npm ci --omit=dev

# Copy application code
COPY . .

# Remove .env file (secrets come from docker-compose environment)
RUN rm -f .env

# ---- Production stage (smaller image) ----
FROM node:18-slim

WORKDIR /app

# Install runtime dependencies:
# - libsqlite3-0: for better-sqlite3 native module
# - curl: for Tailscale install script
# - tailscale: for device discovery (TailscaleService.js shells out to `tailscale status --json`)
RUN apt-get update && apt-get install -y \
    libsqlite3-0 \
    curl \
    && curl -fsSL https://tailscale.com/install.sh | sh \
    && rm -rf /var/lib/apt/lists/*

# Copy built app from builder
COPY --from=builder /app /app

# Create directories for persistent data
RUN mkdir -p /data/db /data/uploads /data/models

# Health check
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
    CMD node -e "fetch('http://localhost:3001/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

EXPOSE 3001

CMD ["node", "server.js"]
