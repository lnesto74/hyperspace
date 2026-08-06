#!/usr/bin/env bash
# End-to-end check of the Treviglio pipeline, from the edge to the reports.
#
# Every failure this codebase has actually suffered was silent. The edge died
# and the dashboards kept drawing. The reconciler sat disabled for weeks and the
# numbers merely looked disappointing. A partial config PATCH reset every tuned
# gate while still reporting "enabled". Backups were scheduled but never
# installed. None of it announced itself.
#
# So this asserts each stage independently rather than trusting that data
# arriving at one end means the far end is correct. Read-only throughout: it
# opens the database read-only and never writes to production state.
#
# Usage: verify-pipeline.sh            (run on the droplet)
# Exit:  0 all pass, 1 any FAIL, 2 only WARNs
set -o pipefail

VENUE="${VENUE_ID:-55fdd53b-3298-4355-97c0-b4e789b11d06}"
C="${CONTAINER:-hyperspace-backend-1}"
DB_IN_C=/data/db/hyperspace.db
EXPECTED_ENGINE_MD5="${EXPECTED_ENGINE_MD5:-ac530863014ea16e1e47a01b40647d6c}"

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; WARN=$((WARN+1)); }
hdr()  { printf '\n\033[1m%s\033[0m\n' "$1"; }

nodeq() { docker exec -e NODE_PATH=/app/node_modules "$C" node -e "$1" 2>&1; }

echo "Hyperspace pipeline verification — $(date -u +%FT%TZ)"
echo "venue $VENUE"

# ---------------------------------------------------------------- 1. containers
hdr "1. Containers"
for svc in backend frontend mosquitto caddy; do
  line=$(docker ps --format '{{.Names}}\t{{.Status}}' | grep "hyperspace-$svc" | head -1)
  if [ -n "$line" ]; then ok "$svc up — $(echo "$line" | cut -f2)"
  else bad "$svc is NOT running"; fi
done

# ---------------------------------------------------------------- 2. ingestion
hdr "2. Ingestion (edge → MQTT → backend)"
MSGS=$(timeout 15 docker exec hyperspace-mosquitto-1 \
  mosquitto_sub -t 'hyperspace/trajectories/#' -W 10 2>/dev/null | wc -l)
if [ "$MSGS" -gt 100 ]; then ok "MQTT carrying traffic — $MSGS frames in 10s"
elif [ "$MSGS" -gt 0 ]; then warn "MQTT quiet — only $MSGS frames in 10s (store closed?)"
else bad "NO MQTT traffic — edge or broker is down"; fi

FRESH=$(nodeq "
const D=require('better-sqlite3');const db=new D('$DB_IN_C',{readonly:true});
const r=db.prepare('SELECT MAX(timestamp) t FROM track_positions WHERE venue_id=?').get('$VENUE');
console.log(r.t ? Math.round((Date.now()-r.t)/1000) : 999999);
")
if [ "$FRESH" -lt 120 ] 2>/dev/null; then ok "database receiving positions — newest ${FRESH}s old"
elif [ "$FRESH" -lt 3600 ] 2>/dev/null; then warn "newest position is ${FRESH}s old"
else bad "no recent positions (${FRESH}s old) — ingestion is broken"; fi

# ------------------------------------------------------------ 3. reconciliation
hdr "3. Reconciliation"
ENGINE_MD5=$(docker exec "$C" md5sum /app/services/TrajectoryReconciler.js 2>/dev/null | cut -d' ' -f1)
if [ "$ENGINE_MD5" = "$EXPECTED_ENGINE_MD5" ]; then
  ok "engine is the validated adde0d7 build"
else
  bad "engine md5 $ENGINE_MD5 != expected $EXPECTED_ENGINE_MD5 — wrong build deployed"
fi

CFG=$(curl -s "localhost:3001/api/venues/$VENUE/reconciler-config")
echo "$CFG" | python3 -c '
import sys, json
d = json.load(sys.stdin); c = d.get("reconciler", d)
want = {"enabled": True, "preset_id": "luca", "reid_max_gap_s": 12,
        "reid_max_distance_m": 12.7, "reid_max_implied_speed_m_s": 2.6,
        "smoothing_alpha": 0.12, "ghost_static_timeout_s": 90,
        "active_to_lost_timeout_ms": 6000, "reid_stale_active_ms": 200,
        "reid_churn_active_ms": 80}
bad = {k: (c.get(k), v) for k, v in want.items() if c.get(k) != v}
print("DRIFT " + json.dumps(bad) if bad else "GATES_OK")
' > /tmp/_gates 2>/dev/null
if grep -q GATES_OK /tmp/_gates; then ok "reconciler enabled with every luca gate intact"
else bad "reconciler config drifted: $(cat /tmp/_gates)"; fi

# Is it demonstrably doing work, not merely switched on?
nodeq "
const D=require('better-sqlite3');const db=new D('$DB_IN_C',{readonly:true});
const since=Date.now()-3600000;
const r=db.prepare(\`SELECT COUNT(DISTINCT track_key) stable, COUNT(DISTINCT original_perception_id) perc
  FROM track_positions WHERE venue_id=? AND timestamp>?\`).get('$VENUE', since);
console.log(JSON.stringify(r));
" > /tmp/_rec
STABLE=$(python3 -c "import json;print(json.load(open('/tmp/_rec'))['stable'])" 2>/dev/null || echo 0)
PERC=$(python3 -c "import json;print(json.load(open('/tmp/_rec'))['perc'] or 0)" 2>/dev/null || echo 0)
if [ "$PERC" -gt 0 ] && [ "$STABLE" -gt 0 ]; then
  RATIO=$(python3 -c "print(f'{$PERC/$STABLE:.1f}')")
  if python3 -c "exit(0 if $PERC/$STABLE >= 1.5 else 1)"; then
    ok "reconciler is merging — ${RATIO}x fewer identities than raw ($PERC perception → $STABLE stable, 1h)"
  else
    bad "reconciler barely merging — only ${RATIO}x reduction ($PERC → $STABLE); expected >=1.5x"
  fi
elif [ "$PERC" -eq 0 ]; then
  warn "original_perception_id not populated in the last hour — cannot prove merging"
else
  warn "no tracks in the last hour to judge merging"
fi

# ---------------------------------------------------------------- 4. storage
hdr "4. Storage and rollups"
nodeq "
const D=require('better-sqlite3');const db=new D('$DB_IN_C',{readonly:true});
const V='$VENUE', now=Date.now();
const out={};
out.pos_1h  = db.prepare('SELECT COUNT(*) n FROM track_positions WHERE venue_id=? AND timestamp>?').get(V, now-3600000).n;
out.visits_1h = db.prepare('SELECT COUNT(*) n FROM zone_visits WHERE venue_id=? AND start_time>?').get(V, now-3600000).n;
out.occ_1h  = db.prepare('SELECT COUNT(*) n FROM zone_occupancy WHERE venue_id=? AND timestamp>?').get(V, now-3600000).n;
const oldest = db.prepare('SELECT MIN(timestamp) t FROM track_positions WHERE venue_id=?').get(V).t;
out.retention_days = oldest ? +((now-oldest)/86400000).toFixed(1) : 0;
out.perc_pct = (() => {
  const r = db.prepare('SELECT COUNT(*) n, SUM(CASE WHEN original_perception_id IS NOT NULL THEN 1 ELSE 0 END) w FROM track_positions WHERE venue_id=? AND timestamp>?').get(V, now-3600000);
  return r.n ? +(100*r.w/r.n).toFixed(1) : null;
})();
for (const t of ['zone_kpi_hourly','zone_kpi_daily']) {
  try {
    const c = db.prepare(\`SELECT COUNT(*) n FROM \${t} WHERE venue_id=?\`).get(V).n;
    out[t]=c;
  } catch(e) { out[t]='MISSING'; }
}
console.log(JSON.stringify(out));
" > /tmp/_store
cat /tmp/_store | python3 -c '
import sys, json
d = json.loads(sys.stdin.read())
print("STORE " + json.dumps(d))
' > /tmp/_store2 2>/dev/null || echo "STORE {}" > /tmp/_store2

get() { python3 -c "import json;d=json.load(open('/tmp/_store'));print(d.get('$1'))" 2>/dev/null; }
[ "$(get pos_1h)" -gt 0 ] 2>/dev/null && ok "track_positions writing — $(get pos_1h) rows in 1h" || bad "track_positions not writing"
[ "$(get visits_1h)" -gt 0 ] 2>/dev/null && ok "zone_visits writing — $(get visits_1h) in 1h" || warn "no zone_visits in the last hour"
[ "$(get occ_1h)" -gt 0 ] 2>/dev/null && ok "zone_occupancy writing — $(get occ_1h) in 1h" || warn "no zone_occupancy in the last hour"
PP=$(get perc_pct)
if [ "$PP" = "None" ] || [ -z "$PP" ]; then warn "could not measure original_perception_id coverage"
elif python3 -c "exit(0 if $PP >= 95 else 1)" 2>/dev/null; then ok "original_perception_id populated on ${PP}% of rows"
else warn "original_perception_id only on ${PP}% of rows"; fi
RD=$(get retention_days)
if python3 -c "exit(0 if 0 < $RD <= 32 else 1)" 2>/dev/null; then ok "retention holding — oldest position ${RD} days"
else warn "oldest position is ${RD} days (expected <=32)"; fi
for t in zone_kpi_hourly zone_kpi_daily; do
  v=$(get $t)
  if [ "$v" = "MISSING" ]; then bad "$t table missing"
  elif [ "$v" -gt 0 ] 2>/dev/null; then ok "$t populated — $v rows"
  else warn "$t is empty"; fi
done

# --------------------------------------------------------------- 5. database
hdr "5. Database health"
SZ=$(docker exec "$C" sh -c "ls -l $DB_IN_C | awk '{print \$5}'")
WAL=$(docker exec "$C" sh -c "ls -l ${DB_IN_C}-wal 2>/dev/null | awk '{print \$5}'" || echo 0)
echo "  size $(python3 -c "print(f'{$SZ/1e9:.2f} GB')")   wal $(python3 -c "print(f'{${WAL:-0}/1e6:.1f} MB')")"
python3 -c "exit(0 if ${WAL:-0} < 2e9 else 1)" && ok "WAL healthy" || bad "WAL is huge — checkpointing is not happening"
INTEG=$(nodeq "
const D=require('better-sqlite3');const db=new D('$DB_IN_C',{readonly:true});
console.log(db.pragma('quick_check')[0].quick_check);
")
[ "$INTEG" = "ok" ] && ok "integrity check ok" || bad "integrity check: $INTEG"
FREE=$(nodeq "
const D=require('better-sqlite3');const db=new D('$DB_IN_C',{readonly:true});
const f=db.pragma('freelist_count')[0].freelist_count, p=db.pragma('page_count')[0].page_count;
console.log(Math.round(100*f/p));
")
[ "$FREE" -lt 25 ] 2>/dev/null && ok "free pages ${FREE}% — no vacuum needed" || warn "free pages ${FREE}% — consider a vacuum"

# ------------------------------------------------------------- 6. raw archive
hdr "6. Raw archive"
systemctl is-active --quiet hyperspace-raw-archive.service \
  && ok "archive service active" || bad "archive service is NOT running"
TODAY=$(ls -t /data/hyperspace/raw/*.jsonl.gz 2>/dev/null | head -1)
if [ -n "$TODAY" ]; then
  AGE=$(( ($(date +%s) - $(stat -c %Y "$TODAY")) ))
  SIZE=$(stat -c %s "$TODAY")
  if [ "$AGE" -lt 300 ]; then ok "current archive growing — $(basename "$TODAY"), $(python3 -c "print(f'{$SIZE/1e6:.0f} MB')"), written ${AGE}s ago"
  else warn "newest archive last written ${AGE}s ago"; fi
  # Members already closed must decompress; the open tail may not, by design.
  if gzip -t "$TODAY" 2>/dev/null; then ok "archive decompresses cleanly"
  else warn "archive tail incomplete (expected while the current member is open)"; fi
else bad "no raw archive files found"; fi
echo "  $(ls /data/hyperspace/raw/*.jsonl.gz 2>/dev/null | wc -l) archive days, $(du -sh /data/hyperspace/raw 2>/dev/null | cut -f1) total"

# ---------------------------------------------------------------- 7. backups
hdr "7. Backups"
NEW=$(ls -1t /data/hyperspace/backups/hyperspace_*.db.gz 2>/dev/null | head -1)
if [ -n "$NEW" ]; then
  AGE_H=$(( ($(date +%s) - $(stat -c %Y "$NEW")) / 3600 ))
  if [ "$AGE_H" -lt 36 ]; then ok "recent backup — $(basename "$NEW"), ${AGE_H}h old, $(python3 -c "print(f'{$(stat -c %s "$NEW")/1e6:.0f} MB')")"
  else bad "newest backup is ${AGE_H}h old"; fi
  gzip -t "$NEW" 2>/dev/null && ok "backup archive is valid gzip" || bad "backup archive is CORRUPT"
else bad "no backups found"; fi
echo "  $(ls /data/hyperspace/backups/*.gz 2>/dev/null | wc -l) retained"

# ------------------------------------------------------- 8. schedules & alerts
hdr "8. Schedules and alerting"
for job in hyperspace-health-check hyperspace-backup hyperspace-weekly-report hyperspace-raw-retention hyperspace-reid-audit; do
  crontab -l 2>/dev/null | grep -q "$job" && ok "cron: $job" || bad "cron MISSING: $job"
done
systemctl is-active --quiet hyperspace-edge-heartbeat.timer \
  && ok "edge heartbeat timer active" || warn "edge heartbeat timer not active"
LAST_HEALTH=$(tail -1 /var/log/hyperspace-health.log 2>/dev/null)
case "$LAST_HEALTH" in
  *"all checks passed"*) ok "last health check clean — $LAST_HEALTH" ;;
  "") warn "health check log empty" ;;
  *) warn "last health check reported: $LAST_HEALTH" ;;
esac

# ------------------------------------------------------------ 9. re-ID audit
hdr "9. re-ID gate audit"
HIST=/data/hyperspace/reid-audit/history.jsonl
if [ -f "$HIST" ]; then
  python3 - "$HIST" <<'PY'
import json, sys, time
rows = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line: continue
    try: rows.append(json.loads(line))
    except Exception: pass
usable = [r for r in rows if not r.get("thin")]
print(f"  {len(rows)} samples, {len(usable)} usable")
if usable:
    r = usable[-1]
    print(f"  latest: emitted={r['emitted']} reid_rate={r['reid_rate_pct']}% misses={r['misses']['total']}")
    top = sorted(r.get("failure_reasons", {}).items(), key=lambda kv: -kv[1])[:3]
    print("  top gates: " + ", ".join(f"{k}={v}" for k, v in top))
PY
  USABLE=$(python3 -c "
import json,sys
n=0
for l in open('$HIST'):
    l=l.strip()
    if not l: continue
    try:
        if not json.loads(l).get('thin'): n+=1
    except Exception: pass
print(n)")
  [ "$USABLE" -gt 0 ] && ok "audit history has $USABLE usable sample(s)" || warn "no usable audit samples yet (first cron run pending)"
else warn "no audit history yet — first scheduled run has not happened"; fi

# ------------------------------------------------------------------ 10. API
hdr "10. API"
for ep in "/api/venues/$VENUE/reconciler-config" "/api/venues"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "localhost:3001$ep")
  [ "$code" = "200" ] && ok "GET $ep → 200" || bad "GET $ep → $code"
done
HEALTH=$(curl -s -o /dev/null -w '%{http_code}' localhost:3001/api/health 2>/dev/null)
[ "$HEALTH" = "200" ] && ok "GET /api/health → 200" || warn "GET /api/health → $HEALTH"

# ----------------------------------------------------------------- verdict
printf '\n\033[1m%s\033[0m\n' "Result: $PASS passed, $WARN warnings, $FAIL failures"
[ $FAIL -gt 0 ] && exit 1
[ $WARN -gt 0 ] && exit 2
exit 0
