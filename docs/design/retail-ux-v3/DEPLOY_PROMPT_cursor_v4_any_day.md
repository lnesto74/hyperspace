# Cursor prompt v4 — Windflow: any day / week / month computed on the server, with queue and loader

What it adds (approved by Luca 2026-10-12): when a period is picked, every day of it gets its movement
field, behaviour states and checkout replay computed on the droplet from the raw 10 Hz parquet, one day at a
time in a queue; the page shows a loader ("2 of 7 days ready · 16 Sept: calculating behaviour · 4 in queue ·
about 20 min") and fills in by itself. Results are cached in /data/reports/windflow/<venue>/<day>/.

Files (all already in ~/CascadeProjects/Hyperspace working tree):
  NEW  backend/services/windflow/WindflowDayService.js, backend/services/windflow/flowPackWorker.js, backend/routes/windflow.js
  NEW  analysis/journey_lab/230_flow_rows.py, analysis/journey_lab/config/treviglio_place_05m.csv
  NEW  analysis/journey_lab/211_checkout_replay.py (if not already in the release), frontend/public/flowfield/checkouts/
  MOD  analysis/journey_lab/220_kinetic_states.py, 221_kinetic_export.py (env overrides only)
  MOD  frontend/public/flowfield/{main.js, workspace.js, workspace.css, kinetic.js, kinetic.test.mjs, lenses.js, index.html}
Never delete or reset anything; never force-push; do not touch the DB or .env.

## 1. Git (Mac)
In ~/CascadeProjects/Hyperspace-release (branch release/windflow-v3, same as main on GitHub):
    for f in backend/services/windflow backend/routes/windflow.js analysis/journey_lab/230_flow_rows.py \
      analysis/journey_lab/211_checkout_replay.py analysis/journey_lab/220_kinetic_states.py analysis/journey_lab/221_kinetic_export.py \
      analysis/journey_lab/config/treviglio_place_05m.csv; do rsync -a "../Hyperspace/$f" "$(dirname $f)/"; done
    rsync -a --delete ../Hyperspace/frontend/public/flowfield/ frontend/public/flowfield/
    cd frontend/public/flowfield && for t in *.test.mjs; do node --test "$t" || exit 1; done && cd -
Add the one route in backend/server.js of the release (next to the /api/flowfield routes):
    import { WindflowDayService } from './services/windflow/WindflowDayService.js';
    import createWindflowRoutes from './routes/windflow.js';
    app.use('/api/windflow', createWindflowRoutes(new WindflowDayService(db)));
    git add -A backend analysis/journey_lab frontend/public/flowfield && git commit -m "Windflow: compute any day on the server from raw 10 Hz, with queue and loader"
    git push origin release/windflow-v3 && git push origin release/windflow-v3:main   # fast-forward only

## 2. Droplet (root@100.76.196.2, /opt/hyperspace) — keep its 174 local changes
1. Backup what will change:
       cd /opt/hyperspace && mkdir -p /root/backups && tar czf /root/backups/windflow-v4-$(date +%Y%m%d-%H%M).tgz \
         frontend/public/flowfield backend/server.js backend/services/windflow backend/routes/windflow.js \
         analysis/journey_lab/220_kinetic_states.py analysis/journey_lab/221_kinetic_export.py 2>/dev/null; ls -la /root/backups | tail -2
2. Check the backend has what the new service imports (report if missing, then copy them from the release):
       ls backend/services/FlowFieldDailyService.js backend/services/dailyKpi/computeDailyKpi.js backend/assets/flowfield/layout_anchor.json
       grep -n "export function aggregatePositions\|export const SLICES" backend/services/FlowFieldDailyService.js
3. Copy from the Mac release worktree (scp/rsync): the NEW and MOD files listed above
   (frontend/public/flowfield with rsync -a --delete).
4. Patch the DROPLET's backend/server.js with the same 3 lines (imports at the top with the other imports,
   app.use next to the existing `/api/flowfield` or `/api/reporting` line). Show the diff before saving.
5. Rebuild and restart (≈1 min of Live downtime, approved):
       docker compose -f docker-compose.prod.yml --env-file .env build backend frontend
       docker compose -f docker-compose.prod.yml --env-file .env up -d backend frontend

## 3. Prove it on one day that has no pack yet (e.g. 2026-09-15)
    curl -s -X POST localhost:3001/api/windflow/ensure -H 'Content-Type: application/json' \
      -d '{"venueId":"55fdd53b-3298-4355-97c0-b4e789b11d06","days":["2026-09-15"]}'
    # poll every 30 s until "complete":true (expect 5–15 min; stage moves prereq/flow/checkouts/kinetic)
    curl -s "localhost:3001/api/windflow/status?days=2026-09-15"
    curl -s -o /dev/null -w '%{http_code}\n' "localhost:3001/api/windflow/field?day=2026-09-15&slice=trading"   # 200
    curl -s -o /dev/null -w '%{http_code}\n' "localhost:3001/api/windflow/kinetic?day=2026-09-15"              # 200
    curl -s -o /dev/null -w '%{http_code}\n' "localhost:3001/api/windflow/checkouts?day=2026-09-15"            # 200
    docker compose -f docker-compose.prod.yml logs --since 15m backend | grep -i "windflow\|error" | tail -40
If a stage fails, report the error line from status/logs (do not retry blindly).

Answer with ONE line: "PUBBLICATO · 15 Sept calcolato in N min" or "NON PUBBLICATO + motivo".
Rollback: tar xzf /root/backups/windflow-v4-*.tgz -C /opt/hyperspace && rebuild.
