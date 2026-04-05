# Build stage for frontend
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
# Many hosts set NODE_ENV=production, which skips devDependencies (TypeScript, Vite, etc.)
ENV NODE_ENV=development
RUN npm install
COPY frontend/ ./
# Vite compiles TS; avoid `tsc` CLI (broken if host node_modules overwrote image — use .dockerignore).
RUN npx vite build

# Production stage
FROM node:18-alpine AS production
WORKDIR /app

# Install Docker CLI for restarting mosquitto container
RUN apk add --no-cache docker-cli

# Copy backend
COPY backend/package*.json ./backend/
RUN cd backend && npm install --production

COPY backend/ ./backend/

# Copy built frontend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Expose port
EXPOSE 8080

# Start server
CMD ["node", "backend/server.js"]
