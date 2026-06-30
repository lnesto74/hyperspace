#!/usr/bin/env bash
# Fast shelf-mapper deploy — rsync only changed source files, then rebuild container.
# Usage: ./scripts/deploy-shelf-mapper.sh
set -euo pipefail

HOST="${HYPERSPACE_HOST:-root@100.76.196.2}"
REMOTE_DIR="${HYPERSPACE_REMOTE_DIR:-/opt/hyperspace}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Syncing shelf-mapper source (no node_modules, no .next, no PNG)…"
rsync -av \
  "$ROOT/shelf-mapper/components/FloorplanCanvas.tsx" \
  "$ROOT/shelf-mapper/components/MapperView.tsx" \
  "$ROOT/shelf-mapper/components/Pin.tsx" \
  "$ROOT/shelf-mapper/components/PinList.tsx" \
  "$ROOT/shelf-mapper/components/PinEditor.tsx" \
  "$ROOT/shelf-mapper/components/CategoryInput.tsx" \
  "$ROOT/shelf-mapper/components/HintOverlay.tsx" \
  "$ROOT/shelf-mapper/lib/" \
  "$ROOT/shelf-mapper/app/" \
  "$ROOT/shelf-mapper/Dockerfile" \
  "$ROOT/shelf-mapper/next.config.ts" \
  "$ROOT/shelf-mapper/package.json" \
  "$ROOT/shelf-mapper/package-lock.json" \
  "$HOST:$REMOTE_DIR/shelf-mapper/"

echo "→ Building shelf-mapper (takes ~2-3 min, be patient)…"
ssh "$HOST" "cd $REMOTE_DIR && \
  docker compose -f docker-compose.prod.yml build shelf-mapper && \
  docker compose -f docker-compose.prod.yml up -d shelf-mapper"

echo "✓ Done — https://app.hyspace.app/m/treviglio-demo"
