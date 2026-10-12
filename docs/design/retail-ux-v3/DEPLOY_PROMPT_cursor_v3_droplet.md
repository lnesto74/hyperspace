# Cursor prompt v3 — publish ONLY the Windflow files on the droplet (keep its 174 local changes)

The droplet (/opt/hyperspace) runs on debf0c5 + 174 uncommitted local changes: that is what is live today
(Live/MQTT etc.). Do NOT pull, reset, stash, checkout or commit there. Copy only the Windflow files on top,
with a backup first, then rebuild.

## 1. Look first (report the output, then continue)
    ssh root@100.76.196.2
    cd /opt/hyperspace
    git status --short | awk '{print $2}' | cut -d/ -f1-3 | sort | uniq -c | sort -rn | head -30
    git status --short -- frontend/public/flowfield frontend/src/components/layout/AppShell.tsx \
      frontend/src/components/flowfield/FlowFieldEmbed.tsx frontend/src/components/venue/MainViewport.tsx \
      frontend/src/components/layout/FloorVizToggle.tsx backend/services/profit-radar | head -40

## 2. Backup of exactly what will be replaced (on the droplet)
    mkdir -p /root/backups && cd /opt/hyperspace
    tar czf /root/backups/windflow-before-cea92bc-$(date +%Y%m%d-%H%M).tgz \
      frontend/public/flowfield frontend/src/components/layout/AppShell.tsx \
      frontend/src/components/flowfield/FlowFieldEmbed.tsx frontend/src/components/venue/MainViewport.tsx \
      frontend/src/components/layout/FloorVizToggle.tsx backend/services/profit-radar
    ls -la /root/backups | tail -3

## 3. Copy the release files from the Mac (release worktree = commit cea92bc)
From the Mac, in ~/CascadeProjects/Hyperspace-release:

    rsync -az --delete frontend/public/flowfield/ root@100.76.196.2:/opt/hyperspace/frontend/public/flowfield/
    scp frontend/src/components/layout/AppShell.tsx frontend/src/components/layout/FloorVizToggle.tsx \
        root@100.76.196.2:/opt/hyperspace/frontend/src/components/layout/
    scp frontend/src/components/flowfield/FlowFieldEmbed.tsx root@100.76.196.2:/opt/hyperspace/frontend/src/components/flowfield/
    scp frontend/src/components/venue/MainViewport.tsx root@100.76.196.2:/opt/hyperspace/frontend/src/components/venue/
    scp backend/services/profit-radar/profitRadarEngine.js backend/services/profit-radar/zoneAggregator.js \
        root@100.76.196.2:/opt/hyperspace/backend/services/profit-radar/

STOP before copying if step 1 shows the droplet's versions of AppShell.tsx, MainViewport.tsx or the
profit-radar files carry local changes that are NOT in cea92bc (compare with `git diff` on the droplet vs
the release file): report the diff instead of overwriting.

## 4. Rebuild and restart (Luca accepted ~1 minute of Live downtime)
    cd /opt/hyperspace
    docker compose -f docker-compose.prod.yml config --services
    docker compose -f docker-compose.prod.yml --env-file .env build frontend backend
    docker compose -f docker-compose.prod.yml --env-file .env up -d frontend backend

## 5. Check and answer with ONE line
- `curl -s https://app.hyspace.app/flowfield/index.html | grep -o 'main.js?v=v3-1[0-9]'` → v3-13
- `curl -s -o /dev/null -w '%{http_code}' https://app.hyspace.app/flowfield/checkouts/2026-09-14.json` → 200
- `curl -s localhost:3001/api/health`; backend logs last 3 min: no crash loop, MQTT ingesting.
Answer: "PUBBLICATO" or "NON PUBBLICATO + motivo". If anything breaks, restore with
`tar xzf /root/backups/windflow-before-cea92bc-*.tgz -C /opt/hyperspace` and rebuild.
