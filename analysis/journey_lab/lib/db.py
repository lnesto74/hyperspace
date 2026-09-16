"""Shared DuckDB session for the Journey Lab forensics (bounded memory, spills to disk)."""
from __future__ import annotations
import json, math, os
from pathlib import Path
import duckdb

ROOT = Path(os.environ.get("JL_ROOT", Path(__file__).resolve().parents[1]))
CFG_PATH = Path(os.environ.get("JL_CFG", ROOT / "config" / "treviglio.json"))
CFG = json.loads(CFG_PATH.read_text())
DATA = Path(os.environ.get("JL_DATA", ROOT / "data"))
OUT = Path(os.environ.get("JL_OUT", ROOT / "out"))


def day_dir(day: str) -> Path:
    return DATA / day


def parquet_path(day: str):
    """Original single file when present, else the split parts (glob) — identical rows either way."""
    env = os.environ.get("JL_PARQUET")
    if env:
        return env
    single = day_dir(day) / f"hyperspace-raw-{day}.parquet"
    return single if single.exists() else str(day_dir(day) / "raw_part*.parquet")


def connect(mem=os.environ.get("JL_MEM","4500MB"), threads=int(os.environ.get("JL_THREADS","2")), tmp=None):
    con = duckdb.connect()
    tmp = tmp or os.environ.get("JL_TMP", "/tmp/jl_duck")
    Path(tmp).mkdir(parents=True, exist_ok=True)
    con.execute(f"SET memory_limit='{mem}'")
    con.execute(f"SET threads={threads}")
    con.execute(f"SET temp_directory='{tmp}'")
    con.execute("SET preserve_insertion_order=false")
    register_transform(con)
    return con


def register_transform(con):
    """SQL macros: parquet (x, z) -> venue (x, z). parquet z is perception Y; ros_rep103 flips its sign."""
    t = CFG["perception_transform"]
    assert t["axis_map"] == {"px": "x", "py": "z"} and t["axis_sign"] == {"x": 1, "z": 1}, "macro assumes identity axis map/sign"
    ysign = -1.0 if t["input_frame"] == "ros_rep103" else 1.0
    rad = math.radians(t["rotation_deg"]); c, s = math.cos(rad), math.sin(rad)
    sc = float(t.get("scale", 1) or 1)
    ox, oz = t["origin_m"]["x"], t["origin_m"]["z"]
    con.execute(f"CREATE OR REPLACE MACRO vx(px, pz) AS ((px::DOUBLE*{sc})*{c} - (({ysign})*pz::DOUBLE*{sc})*{s}) + {ox}")
    con.execute(f"CREATE OR REPLACE MACRO vz(px, pz) AS ((px::DOUBLE*{sc})*{s} + (({ysign})*pz::DOUBLE*{sc})*{c}) + {oz}")
    con.execute(f"CREATE OR REPLACE MACRO vvx(a, b) AS ((a::DOUBLE*{sc})*{c} - (({ysign})*b::DOUBLE*{sc})*{s})")
    con.execute(f"CREATE OR REPLACE MACRO vvz(a, b) AS ((a::DOUBLE*{sc})*{s} + (({ysign})*b::DOUBLE*{sc})*{c})")


def local_window_ms(day: str):
    """Epoch-ms bounds of the store trading hours for `day` (venue local time) and of the UTC day."""
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    tz = ZoneInfo(CFG["timezone"])
    h0, h1 = CFG["store_hours_local"]
    open_ = datetime.fromisoformat(f"{day}T{h0}:00").replace(tzinfo=tz)
    close = datetime.fromisoformat(f"{day}T{h1}:00").replace(tzinfo=tz)
    utc0 = datetime.fromisoformat(f"{day}T00:00:00").replace(tzinfo=timezone.utc)
    return dict(open_ms=int(open_.timestamp()*1000), close_ms=int(close.timestamp()*1000),
                utc0_ms=int(utc0.timestamp()*1000), utc1_ms=int(utc0.timestamp()*1000)+86_400_000)
