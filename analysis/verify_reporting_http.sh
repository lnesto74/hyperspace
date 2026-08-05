#!/bin/sh
# End-to-end timing of the Esselunga Executive endpoint over HTTP, cold then warm,
# for every range the dashboard offers.
VENUE="${VENUE:-55fdd53b-3298-4355-97c0-b4e789b11d06}"
BASE="${BASE:-http://localhost:3001}"

printf '%-5s %-6s %8s  %s\n' RANGE PASS SECONDS SUMMARY
for spec in "1h:3600" "24h:86400" "7d:604800" "30d:2592000"; do
  label=${spec%%:*}
  secs=${spec#*:}
  for pass in cold warm; do
    end=$(date +%s)000
    start=$(( $(date +%s) - secs ))000
    out=$(curl -s -o /tmp/resp.json -w '%{time_total} %{http_code}' \
      "$BASE/api/reporting/summary?personaId=esselunga-executive&venueId=$VENUE&startTs=$start&endTs=$end&variant=live")
    t=$(echo "$out" | cut -d' ' -f1)
    code=$(echo "$out" | cut -d' ' -f2)
    summary=$(node -e '
      const d=require("/tmp/resp.json");
      const j=d.supporting?.esselungaJourney;
      if(!j){console.log("http="+process.argv[1]+" NO_JOURNEY "+JSON.stringify(d).slice(0,120));process.exit(0)}
      const o=j.overview||{};
      console.log([
        "http="+process.argv[1],
        "entrants="+o.perimeterEntrants,
        "sessions="+o.stitchedEntranceSessions,
        "dwellMin="+o.avgStoreDwellMin,
        "dwellOk="+o.avgStoreDwellReliable,
        "penetration="+(j.aisles?.penetrationPct),
        "timeline="+(j.activityTimeline?.visitors?.length),
        "heatmap="+(j.heatmapCategories?.length),
        "insights="+(j.insights?.length),
      ].join(" "));
    ' "$code" 2>&1 | head -1)
    printf '%-5s %-6s %8s  %s\n' "$label" "$pass" "$t" "$summary"
  done
done
