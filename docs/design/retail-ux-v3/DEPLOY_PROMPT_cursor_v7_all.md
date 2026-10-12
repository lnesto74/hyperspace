# Cursor prompt v7.1 — publish everything (Windflow v3-17 + Astra's totem visibility)

Rerun from step 1.3 if steps 1.1–1.2 are already done. This prompt is cumulative and safe to run even if v5 or v6 were never run. It replaces them.
Source of truth: the working copy ~/CascadeProjects/Hyperspace (all flowfield tests pass there: 13/13).
Release worktree: ~/CascadeProjects/Hyperspace-release, branch release/windflow-v3. Windflow-only release:
copy ONLY the paths listed below. Never `git add -A` in the working copy, never commit files over 50 MB.

## What ships
Frontend (static, baked into the frontend image)
  frontend/public/flowfield/                      whole folder, rsync -a --delete. Includes:
    Media lens (08): totems placement, audience, ON/OFF test, CPM, Simulate     workspace.js, workspace.css, lenses.js,
                                                                                media-sim.js, media/{2026-09-14.json, index.json, sim.json}
    Service: receipts at the till (DEMO) + checkout replay                      checkouts/
    Astra: totem visibility (GLB totem, visibility volume, surface, worker)     media-visibility*.js/.css, retail/totem/, retail-twin.js
    Any-day packs client, behaviour lens, cache v3-17                           main.js, index.html, kinetic.js
Backend (Windflow day packs: any day/week/month computed on the server, queued)
  backend/routes/windflow.js                      NEW
  backend/services/windflow/                      NEW (WindflowDayService.js, flowPackWorker.js, flowAggregate.js)
  backend/server.js                               DO NOT overwrite. Make sure these lines exist once (add if missing):
      import { WindflowDayService } from './services/windflow/WindflowDayService.js';
      import createWindflowRoutes from './routes/windflow.js';
      app.use('/api/windflow', createWindflowRoutes(new WindflowDayService(db)));
Analysis (run by the backend worker and by step 5)
  analysis/journey_lab/211_checkout_replay.py, 220_kinetic_states.py, 221_kinetic_export.py,
  230_flow_rows.py, 240_media_pack.py, 241_media_sim.py, config/treviglio_place_05m.csv
Astra's sources and docs (repo only, not needed on the droplet)
  retail/totem/, scripts/retail/, docs/design/digital-totem-v2/
Docs
  docs/design/retail-ux-v3/DEPLOY_PROMPT_cursor_*.md

## 1. Mac — commit and push
1. cd ~/CascadeProjects/Hyperspace-release && git checkout release/windflow-v3 && git pull --ff-only
2. Copy the paths above from ~/CascadeProjects/Hyperspace (rsync -a; --delete only for frontend/public/flowfield/).
   Patch backend/server.js with the three lines if they are missing.
3. Checks, stop on any failure:
     for t in frontend/public/flowfield/*.test.mjs; do node $t || exit 1; done
     node --check backend/routes/windflow.js && for f in backend/services/windflow/*.js; do node --check $f || exit 1; done
     (cd frontend && npx vite build)      # NOT `npm run build`: its `tsc` step fails on TypeScript errors already in
                                          # frontend/src of the release branch. This release touches no file under
                                          # frontend/src, so those errors are out of scope: do not fix them here.
     find . -path ./node_modules -prune -o -type f -size +50M -print   → must print nothing staged
4. git add <only the paths above>; commit
   "Windflow v3-17: Media lens with totem simulator, receipts at the till, any-day packs, totem visibility (Astra)"
   git push origin release/windflow-v3; then fast-forward main (git push origin release/windflow-v3:main).
   If main is not a fast-forward: stop and report, do not force.

## 2. Droplet — install (root@100.76.196.2, /opt/hyperspace)
The droplet has local changes: do NOT git pull/reset there. Copy files only.
1. Backup: B=/opt/hyperspace-backups/$(date +%F-%H%M); mkdir -p $B;
   tar czf $B/before.tgz -C /opt/hyperspace frontend/public/flowfield backend/server.js backend/routes backend/services/windflow analysis/journey_lab 2>/dev/null
2. rsync from the Mac release worktree: frontend/public/flowfield/ (--delete), backend/routes/windflow.js,
   backend/services/windflow/, the analysis files above. Patch backend/server.js with the three lines if missing.
3. cd /opt/hyperspace
     docker compose -f docker-compose.prod.yml --env-file .env build backend frontend
     docker compose -f docker-compose.prod.yml --env-file .env up -d backend frontend
   The droplet builds from its own frontend/src, which this release does not change. If the frontend image build
   still fails on `tsc`, stop and report the first 20 error lines; do not edit frontend/src.

## 3. Check (all must pass)
   curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/windflow/dates                       → 200
   for p in flowfield/index.html flowfield/media/index.json flowfield/media/sim.json flowfield/media-visibility.js \
            flowfield/retail/totem/digital-totem.glb flowfield/checkouts/index.json; do
     curl -s -o /dev/null -w "%{http_code} $p\n" https://app.hyspace.app/$p; done                   → all 200
   Open https://app.hyspace.app → Windflow: no Live chrome, tabs Pulse … Media, Live.
   Media → Simulate shows "Measured · N days of LiDAR"; clicking a totem in the 3D twin opens Astra's visibility panel.
   Browser console: no errors.

## 4. Day packs still missing (only if not done by v5)
   If /data/reports/windflow/<venue>/2026-09-15/flow/field_trading.json is missing, or 2026-09-15/checkouts.json has no "payments":
     mv .../2026-09-15/checkouts.json .../2026-09-15/checkouts.v1.json   (only if it has no payments)
     curl -s -X POST localhost:3001/api/windflow/ensure -H 'Content-Type: application/json' -d '{"days":["2026-09-15"]}'
     poll: curl -s "localhost:3001/api/windflow/status?days=2026-09-15"   until complete

## 5. Simulator on every stored day (background, ~1–2 min per day)
   mkdir -p /tmp/media/work && cd /opt/hyperspace/analysis/journey_lab
   nohup bash -c 'for f in /data/hyperspace/raw/hyperspace-raw-*.parquet; do d=$(basename $f .parquet); d=${d#hyperspace-raw-};
       JL_PARQUET=$f /opt/pybench/bin/python 230_flow_rows.py $d /tmp/media/rows_$d.csv.gz &&
       MEDIA_WORK=/tmp/media/work MEDIA_SITE=/opt/hyperspace/frontend/public/flowfield/media /opt/pybench/bin/python 241_media_sim.py day $d /tmp/media/rows_$d.csv.gz;
       rm -f /tmp/media/rows_$d.csv.gz; done;
     MEDIA_WORK=/tmp/media/work MEDIA_SITE=/opt/hyperspace/frontend/public/flowfield/media /opt/pybench/bin/python 241_media_sim.py build' > /tmp/media/sim.log 2>&1 &
   When the log ends with "241 build: N days": rebuild + restart the frontend (sim.json is baked into the image),
   copy media/sim.json back to ~/CascadeProjects/Hyperspace/frontend/public/flowfield/media/ and commit it on release/windflow-v3.

## Answer
ONE line, Italian:
  "PUBBLICATO · commit <sha> su main · droplet ok · simulatore su N giorni"   or   "NON PUBBLICATO · <passo> · <motivo>"
If step 5 is still running, say "PUBBLICATO · … · simulatore in calcolo (N/22 giorni)".
