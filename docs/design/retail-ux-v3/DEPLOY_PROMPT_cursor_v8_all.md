# Cursor prompt v8 — publish everything (Windflow v3-23: Categories lens + Media + Astra)

Replaces v7.1. Cumulative and safe to run even if v5, v6 or v7 never completed.
Run it only AFTER docs/CURSOR_PROMPT_categories_lens.md answered "PRONTO PER IL DEPLOY".
Source of truth: the working copy ~/CascadeProjects/Hyperspace (flowfield tests: 14/14).
Release worktree: ~/CascadeProjects/Hyperspace-release, branch release/windflow-v3.
Copy ONLY the paths listed below. Never `git add -A` in the working copy, never commit files over 50 MB.

## Part A — Windflow (always)
Frontend (static, baked into the frontend image)
  frontend/public/flowfield/       whole folder, rsync -a --delete. It includes:
    - Categories lens (05): categories/{sections.json, index.json, 2026-09-27.json, 2026-09-28.json}, planogram-overlay.js
    - Media lens (09): media/, media-sim.js
    - Service receipts: checkouts/
    - Astra's totem visibility: media-visibility*.js/.css, retail/totem/, retail-twin.js
    - cache v3-23 in main.js and index.html (linked hover panel ↔ twin in Categories)
Backend (Windflow)
  backend/routes/windflow.js       (now also serves /api/windflow/categories/*)
  backend/services/windflow/
  backend/server.js                DO NOT overwrite. These three lines must exist exactly once (add them if missing):
      import { WindflowDayService } from './services/windflow/WindflowDayService.js';
      import createWindflowRoutes from './routes/windflow.js';
      app.use('/api/windflow', createWindflowRoutes(new WindflowDayService(db)));
Analysis
  analysis/journey_lab/211_checkout_replay.py, 220_kinetic_states.py, 221_kinetic_export.py, 230_flow_rows.py,
  240_media_pack.py, 241_media_sim.py, 250_category_pack.py, config/treviglio_place_05m.csv
Repo only (not needed on the droplet)
  retail/totem/, scripts/retail/, docs/design/digital-totem-v2/, docs/design/retail-ux-v3/*.md, docs/CURSOR_PROMPT_*.md

## Part B — daily category pipeline + Visitor Journey flag
This is the work of CURSOR_PROMPT_planogramma_treviglio_kpi.md and CURSOR_PROMPT_categories_lens.md:
- the planogram_sections migration and the TEV importer;
- the category layer in the daily KPI;
- the call to 250 after each day;
- the VJ "Categories" tab hidden behind VITE_FEATURE_VJ_CATEGORIES=false.

Ship the exact file lists those two prompts reported in their delivery step. Nothing else.
Run Part B only if all of these hold:
- the backend tests pass: backend/tests/planogramTev.test.js and the dailyKpi tests;
- the frontend typecheck has no NEW errors compared with the release branch;
- the database migration is additive only (CREATE TABLE / ADD COLUMN IF NOT EXISTS).
If any of them fails, ship Part A alone. The lens works with the static 27/28 Sept files, and the Visitor Journey on
the droplet stays exactly as it is today.

## 1. Mac — commit and push
1. cd ~/CascadeProjects/Hyperspace-release && git checkout release/windflow-v3 && git pull --ff-only
2. Copy Part A (and Part B if allowed) from ~/CascadeProjects/Hyperspace. Use rsync -a, with --delete only for
   frontend/public/flowfield/. Patch backend/server.js with the three lines if they are missing.
3. Checks — stop on any failure:
     for t in frontend/public/flowfield/*.test.mjs; do node $t || exit 1; done
     node --check backend/routes/windflow.js && for f in backend/services/windflow/*.js; do node --check $f || exit 1; done
     (cd frontend && npx vite build)
       NOT `npm run build`: its `tsc` step fails on TypeScript errors that already exist in frontend/src.
       Do not fix those errors here.
     find . -path ./node_modules -prune -o -type f -size +50M -print   → must print nothing you are about to stage
4. git add <only the copied paths>. Commit:
   "Windflow v3-23: Categories lens on the Esselunga planogram, Media simulator, receipts, totem visibility (Astra)"
   Push: git push origin release/windflow-v3, then git push origin release/windflow-v3:main (fast-forward only).
   If main is not a fast-forward: stop and report. Do not force.

## 2. Droplet — install (root@100.76.196.2, /opt/hyperspace)
The droplet has local changes: do NOT git pull or reset there. Copy files only.
1. Backup:
     B=/opt/hyperspace-backups/$(date +%F-%H%M); mkdir -p $B
     tar czf $B/before.tgz -C /opt/hyperspace frontend/public/flowfield backend analysis/journey_lab scripts 2>/dev/null
     cp /opt/hyperspace/backend/database/*.db $B/ 2>/dev/null   (only when shipping Part B)
2. rsync the shipped paths from the Mac release worktree. Patch backend/server.js if needed.
   Copy the category files to the reports folder too:
     mkdir -p /data/reports/categories/55fdd53b-3298-4355-97c0-b4e789b11d06
     cp frontend/public/flowfield/categories/*.json /data/reports/categories/55fdd53b-3298-4355-97c0-b4e789b11d06/
3. Rebuild and restart:
     docker compose -f docker-compose.prod.yml --env-file .env build backend frontend
     docker compose -f docker-compose.prod.yml --env-file .env up -d backend frontend
   If the frontend image build fails on `tsc`, stop and report the first 20 error lines. Do not edit frontend/src.

## 3. Checks (all must pass)
   curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/windflow/dates          → 200
   for p in flowfield/index.html flowfield/categories/index.json flowfield/categories/sections.json \
            flowfield/media/sim.json flowfield/media-visibility.js flowfield/checkouts/index.json; do
     curl -s -o /dev/null -w "%{http_code} $p\n" https://app.hyspace.app/$p; done      → all 200
   Open https://app.hyspace.app → Windflow. The tabs, in order:
     Pulse · Flow Explorer · Behaviour · Engagement · Categories · Service · Opportunities · Compare · Media · Live
   Categories → Store shows ribbons on the shelves and "10 of 16" macro-categories measured (28 Sept).
   Categories → Aisle, corsia 4: front view and 573 stops.
   Visitor Journey: no "Categories" tab.
   Browser console: no errors.

## 4. Background jobs (skip a job whose output already exists)
   a) 15 Sept day pack, if missing:
        curl -s -X POST localhost:3001/api/windflow/ensure -H 'Content-Type: application/json' -d '{"days":["2026-09-15"]}'
   b) Media simulator on every stored day: same loop as step 5 of DEPLOY_PROMPT_cursor_v7_all.md.
   c) Part B only: category files for every day that has category rows:
        250_category_pack.py day <day> --db <daily_kpi sqlite>   (CAT_SITE=/data/reports/categories/<venue>)

## Answer
ONE line, in Italian:
  "PUBBLICATO · commit <sha> su main · Parte A ok · Parte B ok|saltata (<motivo>) · simulatore N giorni"
  or "NON PUBBLICATO · <passo> · <motivo>"
