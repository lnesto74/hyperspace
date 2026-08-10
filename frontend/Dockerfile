# Hyperspace Frontend - Production Dockerfile
# Multi-stage: build static files, then serve via lightweight Node server
FROM node:18-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Delete lockfile (contains darwin-specific rollup binaries) and fresh install
RUN rm -f package-lock.json
RUN npm install --legacy-peer-deps

# Copy source code (includes .env.production which Vite auto-loads)
COPY . .

# Build static files (output in /app/dist)
# Skip TypeScript check, just run vite build directly
RUN ROLLUP_NATIVE=false npx vite build

# ---- Production stage: serve static files ----
# We use a tiny Node server so Caddy can proxy to it,
# but the static files are also mountable directly by Caddy
FROM node:18-slim

WORKDIR /app

# Install a minimal static file server
RUN npm install -g serve@14

# Copy built static files from builder
COPY --from=builder /app/dist /app/dist
# Keep cleanUrls off so /flowfield/index.html is served as a real file
# (serve -s otherwise strips .html and SPA-falls-back to the React shell).
COPY serve.json /app/dist/serve.json

EXPOSE 4173

# Serve static files on port 4173
CMD ["serve", "-s", "dist", "-l", "4173", "-c", "serve.json"]
