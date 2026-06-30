#!/usr/bin/env bash
# Deploy shelf-mapper + backend + frontend to Hyperspace DO droplet.
# Usage: ./scripts/deploy-shelf-mapper.sh

set -euo pipefail

HOST="${HYPERSPACE_HOST:-root@100.76.196.2}"
REMOTE_DIR="${HYPERSPACE_REMOTE_DIR:-/opt/hyperspace}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Syncing backend…"
rsync -av "$ROOT/backend/routes/shelfMapper.js" "$HOST:$REMOTE_DIR/backend/routes/"
rsync -av "$ROOT/backend/routes/demoAccess.js" "$HOST:$REMOTE_DIR/backend/routes/"
rsync -av "$ROOT/backend/database/schema.js" "$HOST:$REMOTE_DIR/backend/database/"
rsync -av "$ROOT/backend/server.js" "$HOST:$REMOTE_DIR/backend/"

echo "→ Syncing frontend (Demo Links panel)…"
rsync -av "$ROOT/frontend/src/components/admin/DemoLinksModal.tsx" "$HOST:$REMOTE_DIR/frontend/src/components/admin/"
rsync -av "$ROOT/frontend/src/config/demo.ts" "$HOST:$REMOTE_DIR/frontend/src/config/"

echo "→ Syncing shelf-mapper app…"
rsync -av --delete \
  --exclude node_modules \
  --exclude .next \
  "$ROOT/shelf-mapper/" "$HOST:$REMOTE_DIR/shelf-mapper/"

echo "→ Syncing deploy config…"
rsync -av "$ROOT/deploy/Caddyfile" "$HOST:$REMOTE_DIR/deploy/"
rsync -av "$ROOT/docker-compose.prod.yml" "$HOST:$REMOTE_DIR/"

echo "→ Building & restarting on server…"
ssh "$HOST" "cd $REMOTE_DIR && \
  docker compose -f docker-compose.prod.yml build backend frontend shelf-mapper && \
  docker compose -f docker-compose.prod.yml up -d backend frontend shelf-mapper caddy"

echo "✓ Done."
echo "  Demo Links → Shelf mapper tab → copy link"
echo "  Seed test: https://app.hyspace.app/m/treviglio-demo"
