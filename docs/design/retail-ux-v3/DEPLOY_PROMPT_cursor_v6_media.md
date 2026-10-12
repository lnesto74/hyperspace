# Cursor prompt v6 — Media lens (digital totems) in Windflow

New 8th lens "Media" (Live moves to 09). Static data pack, no backend change.
Everything is already in ~/CascadeProjects/Hyperspace:

  analysis/journey_lab/240_media_pack.py        NEW  audience, auto-placement, ON/OFF test, CPM (+ DEMO playlist/PoP/sales)
  frontend/public/flowfield/media/              NEW  2026-09-14.json (84 KB), index.json
  frontend/public/flowfield/lenses.js           MOD  Media lens + screen icon
  frontend/public/flowfield/workspace.js        MOD  Media overlay + inspector (cache v3-16)
  frontend/public/flowfield/workspace.css       MOD  .hx-md-* styles
  frontend/public/flowfield/main.js, index.html MOD  cache bump v3-17
  analysis/journey_lab/241_media_sim.py         NEW  simulator data: weekday x hour audience, movement model
  frontend/public/flowfield/media-sim.js (+test) NEW  simulator engine (Media → Simulate)
  frontend/public/flowfield/media/sim.json      NEW  built from 4 days on the Mac (14, 26, 27, 28 Sept)

IMPORTANT — main.js and index.html on the Mac now also load Astra's totem visibility work
(media-visibility.js, media-visibility-geometry.js, media-visibility-worker.js, media-visibility.css,
retail/totem/{config.json, occluders.json, digital-totem.glb, campaign-fresh.png}, retail-twin.js).
main.js imports media-visibility.js statically: if those files are missing the whole page fails.
So ship the flowfield folder as a whole (rsync), never main.js alone.

1. Mac: in ~/CascadeProjects/Hyperspace-release copy analysis/journey_lab/240_media_pack.py, 241_media_sim.py and
   rsync -a --delete frontend/public/flowfield/ from the working copy. Run all flowfield tests
   (for t in frontend/public/flowfield/*.test.mjs; do node $t || exit 1; done).
   Commit "Media lens: totem audience, auto-placement, ON/OFF test and CPM (DEMO sales/PoP)", push
   release/windflow-v3 and main (fast-forward only).
2. Droplet: back up /opt/hyperspace/frontend/public/flowfield (tar into /opt/hyperspace-backups/),
   rsync the same folder + 240_media_pack.py + 241_media_sim.py, rebuild and restart the frontend only:
       docker compose -f docker-compose.prod.yml --env-file .env build frontend
       docker compose -f docker-compose.prod.yml --env-file .env up -d frontend
3. Check: curl -s -o /dev/null -w '%{http_code}\n' https://app.hyspace.app/flowfield/media/index.json   → 200
   and open Windflow → Media: two totems, Placement / Audience / ON/OFF test / Schedule & CPM.

4. Simulator on every stored day (droplet, after step 2). Python = /opt/pybench/bin/python, raw = /data/hyperspace/raw.
   Per day (keeps disk low; ~1–2 min each):
       cd /opt/hyperspace/analysis/journey_lab
       for f in /data/hyperspace/raw/hyperspace-raw-*.parquet; do d=$(basename $f .parquet); d=${d#hyperspace-raw-}
         JL_PARQUET=$f /opt/pybench/bin/python 230_flow_rows.py $d /tmp/media/rows_$d.csv.gz &&
         MEDIA_WORK=/tmp/media/work MEDIA_SITE=/opt/hyperspace/frontend/public/flowfield/media \
           /opt/pybench/bin/python 241_media_sim.py day $d /tmp/media/rows_$d.csv.gz; rm -f /tmp/media/rows_$d.csv.gz; done
       MEDIA_WORK=/tmp/media/work MEDIA_SITE=/opt/hyperspace/frontend/public/flowfield/media /opt/pybench/bin/python 241_media_sim.py build
   Then rebuild/restart the frontend again (sim.json is a static file in the image). Copy the new sim.json back to the Mac.

Answer with ONE line: "PUBBLICATO · Media lens online · simulatore su N giorni" or "NON PUBBLICATO + motivo".

Notes
- Audience, placement, department traffic and shelf stops are measured (14 Sept, LiDAR per second).
  Playlists, proof of play, ON/OFF flight and Esselunga sales are DEMO and labelled so in the UI.
- Other days: run 230_flow_rows.py then 240_media_pack.py <day> <rows.csv.gz> (MEDIA_SITE=<flowfield>/media).
