#!/usr/bin/env python3
"""Export the 220 kinetic states for the spatial workspace (frontend/public/flowfield/kinetic.json).

One compact file: store / slot / department mixes, U-turn rate and speed per department, the validation
against the audited 199 (al banco) and 150 (queue waiting) numbers, and per flow cell the person-seconds
in each state for the trading day and each 2-hour slot (cells under 20 person-seconds are dropped).
Cell keys are on the same anchor grid as the flow packs (origin_m + i*cell_m).
"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
day = sys.argv[1] if len(sys.argv) > 1 else "2026-09-14"
import os
OUT = Path(os.environ.get("JL_OUT", ROOT / "out")) / day
DEST = Path(os.environ["KIN_DEST"]) if os.environ.get("KIN_DEST") else ROOT.parents[1] / "frontend" / "public" / "flowfield" / "kinetic.json"
S = json.load(open(OUT / "220_kinetic_states.json"))
C = json.load(open(OUT / "220_kinetic_cells.json"))
MIN_S = 20

meta = C["trading"]["meta"]
cells = {}
for sl, pack in C.items():
    rows = [[c["i"], c["j"], *c["s"]] for c in pack["cells"] if sum(c["s"]) >= MIN_S]
    rows.sort()
    cells[sl] = rows

val = S["validation"]
out = {
    "day": S["day"], "states": S["states"], "method": S["method"],
    "windows": S["windows"], "person_hours": S["person_hours"],
    "grid": {"cell_m": meta["cell_m"], "origin_m": meta["origin_m"], "unit": "person-seconds"},
    "store": S["store"], "by_slot": S["by_slot"], "by_dept": S["by_dept"], "by_dept_slot": S["by_dept_slot"],
    "by_lane": S["by_lane"], "uturns_per_min": S["uturns_per_min_by_dept"], "speed_m_s": S["speed_m_s_by_dept"],
    "validation": {
        "choose_vs_al_banco_r": val["choose_vs_al_banco_r"], "wait_vs_queue_waiting_r": val["wait_vs_queue_waiting_r"],
        "choose_vs_al_banco": val["choose_vs_al_banco"], "wait_vs_queue_waiting": val["wait_vs_queue_waiting"],
    },
    "cells": cells,
}
DEST.write_text(json.dumps(out, separators=(",", ":")))
print(f"{DEST} {DEST.stat().st_size / 1024:.0f} KB, slices {list(cells)}, trading cells {len(cells['trading'])}")
