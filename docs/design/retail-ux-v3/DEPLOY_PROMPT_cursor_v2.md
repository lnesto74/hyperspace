# Cursor prompt v2 — clean Windflow-only release, push, publish

Luca decided on 2026-10-12:
- publish ONLY the Windflow work. The rest of Astra's snapshot (b886683: Live/MQTT, edge-server,
  ReID, LPM, Executive, Cliente medio, exports, tmp, infra…) stays local on a backup branch, unpublished;
- large data files leave git but stay on disk, and go into .gitignore.
Commits b886683 and 9833483 were never pushed, so rebuilding them is safe. Never delete files on disk,
never force-push, never touch the droplet's database or .env.

## 0. Safety
    cd ~/CascadeProjects/Hyperspace
    git branch backup/astra-snapshot-9833483 9833483      # the full snapshot, kept locally
    git status --short                                     # expected: the replay work is uncommitted (see 2)

## 1. Release branch from the last pushed commit (4305c0c, already on origin/feature/retail-ux-seven-lenses)
Use a separate worktree so the current working tree (with uncommitted work) is not touched:

    git worktree add ../Hyperspace-release 4305c0c -b release/windflow-v3
    cd ../Hyperspace-release

## 2. Bring in exactly these paths
From the CURRENT working tree of ~/CascadeProjects/Hyperspace (it includes the new Service replay,
not yet committed — copy, don't move):

    rsync -a --delete ../Hyperspace/frontend/public/flowfield/ frontend/public/flowfield/
    mkdir -p docs/design/retail-ux-v3 && rsync -a ../Hyperspace/docs/design/retail-ux-v3/ docs/design/retail-ux-v3/
    cp ../Hyperspace/docs/design/retail-ux/e2e-lenses.mjs docs/design/retail-ux/e2e-lenses.mjs
    cp ../Hyperspace/analysis/journey_lab/211_checkout_replay.py analysis/journey_lab/

From commit 9833483 (the Windflow ↔ Live link and the clean full-bleed shell; these four files only):

    git checkout 9833483 -- frontend/src/components/layout/AppShell.tsx \
      frontend/src/components/flowfield/FlowFieldEmbed.tsx \
      frontend/src/components/venue/MainViewport.tsx \
      frontend/src/components/layout/FloorVizToggle.tsx

Append to .gitignore:

    # Raw captures and data exports stay on disk, never in git (2026-10-12)
    *.pcapng
    raw_tracks.jsonl
    exports/**/*.parquet
    exports/**/*.csv
    infra/cloud3d/out/**/*.zip

## 3. Check before committing
    git status --short | awk '{print $2}' | cut -d/ -f1-3 | sort | uniq -c   # only frontend/, docs/, analysis/journey_lab, .gitignore
    find . -path ./node_modules -prune -o -type f -size +20M -print | grep -v node_modules   # must print nothing staged
    cd frontend/public/flowfield && for t in *.test.mjs; do node --test "$t" || exit 1; done && cd -
    cd frontend && npx vite build && cd -        # the app must build (prod Dockerfile skips tsc)

Stop and report if any check fails.

## 4. Commit, point main at it, push
    git add -A frontend/public/flowfield docs/design analysis/journey_lab/211_checkout_replay.py \
      frontend/src/components .gitignore
    git commit -m "Windflow UX v3: spatial twin, period picker, readable Flow Explorer, Compare and checkout replay

    - Astra's 3D supermarket twin merged into the seven-lens workspace; English UI.
    - Day / week / month picker with loader.
    - Flow Explorer: Activity, Direction, Convergence and Path types answer one question each.
    - Particles respect exact shelf footprints; Behaviour legend isolates one state.
    - Compare: 2-hour slots, gold cells and named places that changed.
    - Service: checkouts minute by minute (211_checkout_replay.py, raw 10 Hz), replay of 14 Sep.
    - App shell: Windflow is full-bleed; Live-view chrome hidden while it is open.
    - .gitignore: raw captures and data exports stay out of git."
    git push origin release/windflow-v3
    cd ../Hyperspace
    git branch -f main release/windflow-v3     # main was only ahead locally; the snapshot is on the backup branch
    git push origin main                       # must be a fast-forward of origin/main; never --force

If `git branch -f main` refuses because main is checked out, run it from the release worktree instead:
`git -C ../Hyperspace-release branch -f main release/windflow-v3` after `git -C ../Hyperspace checkout ux-v3-astra`.
Do not push ux-v3-astra or the backup branch.

## 5. Publish on the droplet (root@100.76.196.2, /opt/hyperspace)
1. `git status --short` and `git log -1` on the droplet; if it has local changes, STOP and report them.
2. `git fetch origin && git checkout main && git pull --ff-only origin main`
3. Check service names with `docker compose -f docker-compose.prod.yml config --services`, then
   rebuild and restart frontend AND backend (Luca accepted ~1 minute of Live downtime):

       docker compose -f docker-compose.prod.yml --env-file .env build frontend backend
       docker compose -f docker-compose.prod.yml --env-file .env up -d frontend backend

4. Verify and report:
   - `docker compose -f docker-compose.prod.yml ps`; `curl -s localhost:3001/api/health`
   - `curl -s "localhost:3001/api/reporting/daily-kpi/range?venueId=55fdd53b-3298-4355-97c0-b4e789b11d06&from=2026-09-14&to=2026-09-20" | head -c 400`
   - public `/flowfield/index.html` contains `main.js?v=v3-13`; `/flowfield/retail/manifest.json`
     and `/flowfield/checkouts/2026-09-14.json` return 200.
   - `docker compose -f docker-compose.prod.yml logs --since 3m backend | tail -80` — no crash loop, MQTT resumes.
5. Report: release commit hash, `git log -1` on the droplet, container status, check outputs.
