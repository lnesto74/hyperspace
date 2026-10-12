#!/usr/bin/env python3
"""230_flow_rows.py — per-second positions for the Windflow movement field, from the raw 10 Hz LiDAR.

The flow pack (backend/services/FlowFieldDailyService.js aggregatePositions) is built from these rows, so a day
has a movement field even when the 3 s track_positions table has been purged. Cleaning as 211/41: ids classed
VALID or STATIC_SUSPECT on their whole life (phantom_filter); 10 Hz samples averaged per second.
Writes a gzip CSV sorted by id then time: track_key,timestamp,position_x,position_z (venue metres, epoch ms).
Uso: python3 230_flow_rows.py <day> <out.csv.gz>   (JL_PARQUET = raw parquet of that day)
"""
import sys, os
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
import db
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

day = sys.argv[1]; dest = Path(sys.argv[2]); dest.parent.mkdir(parents=True, exist_ok=True)
P = db.parquet_path(day); PF = db.CFG["phantom_filter"]; tz = ZoneInfo(db.CFG["timezone"])
# Same window as the flow packs: 07:00–22:00 local (all slices are cut from it).
t0 = int(datetime.fromisoformat(f"{day}T07:00:00").replace(tzinfo=tz).timestamp() * 1000)
t1 = int(datetime.fromisoformat(f"{day}T22:00:00").replace(tzinfo=tz).timestamp() * 1000)
tmp = os.environ.get("JL_TMP", "/tmp/jl_duck")
con = db.connect(mem=os.environ.get("JL_MEM", "2500MB"), threads=int(os.environ.get("JL_THREADS", "3")), tmp=tmp)
con.execute(f"""CREATE TEMP TABLE ids AS
  SELECT id, (max(ts)-min(ts))/1000.0 dur_s, greatest(max(vx(x,z))-min(vx(x,z)), max(vz(x,z))-min(vz(x,z))) ext
  FROM read_parquet('{P}') WHERE otype='person' GROUP BY id""")
keep = f"""NOT (dur_s < {PF['min_duration_s']} OR ext < {PF['min_extent_m']}
   OR (dur_s >= {PF['static_duration_s']} AND ext <= {PF['static_extent_m']}))"""
con.execute(f"""COPY (
  SELECT id AS track_key, (ts // 1000) * 1000 + 500 AS timestamp, round(avg(vx(x,z)), 3) AS position_x, round(avg(vz(x,z)), 3) AS position_z
  FROM read_parquet('{P}') r SEMI JOIN (SELECT id FROM ids WHERE {keep}) k USING (id)
  WHERE otype='person' AND ts >= {t0} AND ts < {t1}
  GROUP BY 1, 2 ORDER BY 1, 2
) TO '{dest}' (HEADER, DELIMITER ',', COMPRESSION gzip)""")
n = con.execute(f"SELECT count(*) FROM read_csv('{dest}')").fetchone()[0]
print(f"230 {day}: {n} rows -> {dest}")
