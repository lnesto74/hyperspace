# Cursor prompt — commit, merge and publish Windflow UX v3 (v3-12)

Luca approved this release on 2026-10-12. Do the steps in order. Stop and report if any step
fails; never discard, reset, stash or overwrite work you did not make, on the Mac or on the droplet.

## 1. Commit on the Mac (repo ~/CascadeProjects/Hyperspace, branch ux-v3-astra)

Stage ONLY these paths (leave everything under infra/cloud3d/ untouched and uncommitted):

    git add frontend/public/flowfield frontend/src/components/layout/AppShell.tsx \
            frontend/src/components/flowfield/FlowFieldEmbed.tsx docs/design/retail-ux-v3
    git status --short   # check: no infra/ paths staged

Commit message:

    Windflow UX v3: merged spatial twin, period picker, readable Flow Explorer and Compare

    - Merge Astra's 3D supermarket twin (GLB fixtures) with the seven-lens workspace; English UI.
    - Day / week / month picker with loader; days combined from daily_kpi and flow packs.
    - Flow Explorer: Activity, Direction, Convergence and Path types answer one question each.
    - Particles respect exact shelf footprints (25 cm); the closed central ring stays empty.
    - Behaviour legend isolates one movement state with its own stream preset.
    - Compare: 2-hour slots by default, gold cells and named places that changed.
    - Zoom to cursor, never stalls; mouse no longer sticks on overlays.
    - App shell: Windflow is full-bleed; Live-view sidebar, status bar, Intent Field,
      timeline, Pulse and right panel are hidden while it is open.

Run the flowfield unit tests before committing (all must pass on the Mac):

    cd frontend/public/flowfield && for t in *.test.mjs; do node --test "$t" || exit 1; done

## 2. Merge into main and push

    git checkout main
    git merge --ff-only ux-v3-astra     # main is the merge base, so this is a fast-forward
    git push origin main
    git push origin ux-v3-astra

If --ff-only refuses, stop and report (do not force).

## 3. Publish on the droplet (root@100.76.196.2 over Tailscale, repo at /opt/hyperspace)

1. `ssh root@100.76.196.2`, `cd /opt/hyperspace`, run `git status --short` and `git log -1`.
   If there are local changes on the droplet, STOP and report them to Luca. Do not reset them.
2. `git fetch origin && git checkout main && git pull --ff-only origin main`
3. Rebuild and restart frontend AND backend (Luca accepted ~1 minute of Live downtime):

       docker compose -f docker-compose.prod.yml --env-file .env build frontend backend
       docker compose -f docker-compose.prod.yml --env-file .env up -d frontend backend

   (Check the service names with `docker compose -f docker-compose.prod.yml config --services`
   first and use the real ones.)
4. Verify:
   - `docker compose -f docker-compose.prod.yml ps` — all services up.
   - `curl -s localhost:3001/api/health`
   - `curl -s "localhost:3001/api/reporting/daily-kpi/range?venueId=55fdd53b-3298-4355-97c0-b4e789b11d06&from=2026-09-14&to=2026-09-20" | head -c 400`
   - `curl -s "localhost:3001/api/flowfield/dates?venueId=55fdd53b-3298-4355-97c0-b4e789b11d06" | head -c 300`
   - The public site serves `/flowfield/index.html` containing `main.js?v=v3-12`, and
     `/flowfield/retail/manifest.json` returns 200.
   - Backend logs for 2 minutes: no crash loop, MQTT live ingestion resumes
     (`docker compose -f docker-compose.prod.yml logs --since 3m backend | tail -80`).
5. Report back: commit hash on main, droplet `git log -1`, container status, and the output of
   the checks above.

Do not run database migrations by hand, do not touch the SQLite file, do not change .env.
