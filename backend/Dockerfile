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

# ---- LibreDWG build stage ----
FROM debian:bookworm-slim AS libredwg-builder

RUN apt-get update && apt-get install -y \
    git autoconf automake libtool texinfo build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --depth 1 https://github.com/LibreDWG/libredwg.git \
    && cd libredwg \
    && sh ./autogen.sh \
    && ./configure --prefix=/usr/local \
    && make -j$(nproc) \
    && make install DESTDIR=/libredwg-install

# ---- Production stage (smaller image) ----
FROM node:18-slim

WORKDIR /app

# Copy libredwg binaries from builder
COPY --from=libredwg-builder /libredwg-install/usr/local /usr/local

# Install runtime dependencies:
# - libsqlite3-0: for better-sqlite3 native module
# - curl: for Tailscale install script
# - tailscale: for device discovery (TailscaleService.js shells out to `tailscale status --json`)
RUN apt-get update && apt-get install -y \
    libsqlite3-0 \
    curl \
    python3 \
    python3-pip \
    && curl -fsSL https://tailscale.com/install.sh | sh \
    && pip3 install --no-cache-dir pandas pyarrow matplotlib scipy numpy \
    && rm -rf /var/lib/apt/lists/* \
    && ldconfig

# Copy built app from builder
COPY --from=builder /app /app

# Create directories for persistent data
RUN mkdir -p /data/db /data/uploads /data/models

# Health check (generous start-period for heavy init: DB migrations, KPI aggregation, etc.)
HEALTHCHECK --interval=15s --timeout=10s --start-period=120s --retries=10 \
    CMD curl -sf http://localhost:3001/api/health || exit 1

EXPOSE 3001

CMD ["node", "server.js"]
