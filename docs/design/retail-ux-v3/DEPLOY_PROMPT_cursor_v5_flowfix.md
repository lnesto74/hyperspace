# Cursor prompt v5 — fix "not produced: flow" (Windflow day packs)

Cause: the droplet's backend/services/FlowFieldDailyService.js is an older copy without the `trading` /
`h08_10…` slices, so the flow worker built no `trading` pack. Fix: the worker now carries its own copy of the
aggregation. Two files, both already in ~/CascadeProjects/Hyperspace:
  backend/services/windflow/flowAggregate.js   (NEW)
  backend/services/windflow/flowPackWorker.js  (MOD: imports ./flowAggregate.js, fails loudly if no trading slice)
Kinetic and checkouts for 15 Sept were already produced; only the flow part reruns.

1. Mac: copy both files into ~/CascadeProjects/Hyperspace-release, commit
   "Windflow day packs: own copy of the flow aggregation (trading slices)", push release/windflow-v3 and main (fast-forward only).
2. Droplet: back up backend/services/windflow, copy the two files into /opt/hyperspace/backend/services/windflow/,
   rebuild and restart backend only:
       docker compose -f docker-compose.prod.yml --env-file .env build backend
       docker compose -f docker-compose.prod.yml --env-file .env up -d backend
3. Re-run 15 Sept (only the missing part is queued) and wait until complete:
       curl -s -X POST localhost:3001/api/windflow/ensure -H 'Content-Type: application/json' -d '{"days":["2026-09-15"]}'
       curl -s "localhost:3001/api/windflow/status?days=2026-09-15"          # poll every 30 s
       curl -s -o /dev/null -w '%{http_code}\n' "localhost:3001/api/windflow/field?day=2026-09-15&slice=trading"   # 200
4. If the frontend is not yet the v4 one on the droplet, make sure step 2–5 of DEPLOY_PROMPT_cursor_v4_any_day.md are done.

Answer with ONE line: "PUBBLICATO · 15 Sept pronto (flow, behaviour, checkouts)" or "NON PUBBLICATO + motivo".

## Also in this release (2026-10-13): receipts at the till (DEMO) in Service → Minute by minute
Copy too, to the release worktree and to the droplet (same backup rule):
  analysis/journey_lab/211_checkout_replay.py        (now saves, per payment: id, Fidaty instant, match certain/uncertain/risky, queue + till route)
  frontend/public/flowfield/ (rsync -a --delete)     (receipt cards, Payments at the tills, journey behind the receipt; v3-15)
Then rebuild frontend as well as backend. Days computed before this (e.g. 15 Sept) show the replay without
receipts until recomputed: delete nothing — just move /data/reports/windflow/<venue>/2026-09-15/checkouts.json
to checkouts.v1.json and POST /api/windflow/ensure for that day again.
