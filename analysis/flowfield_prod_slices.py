"""One-pass multi-slice aggregation for the flow-field time filters.

Reads track_positions once and deposits into several independent accumulators
(all / morning / midday / afternoon / evening / weekday / weekend), then emits
one field JSON per slice. Same geometry as flowfield_prod_extract.py.

  python3 flowfield_prod_slices.py --db ... --venue ... --out-dir /tmp/slices
"""
import argparse
import json
import math
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone

BINS = 8
MIN_PRESENCE_SEC = 1.0
MIN_STEPS = 0.5

# Local-hour half-open intervals and DOW sets (Mon=0 … Sun=6).
SLICES = [
    ("all", None, None),
    ("morning", (7, 11), None),
    ("midday", (11, 15), None),
    ("afternoon", (15, 19), None),
    ("evening", (19, 22), None),
    ("weekday", None, {0, 1, 2, 3, 4}),
    ("weekend", None, {5, 6}),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--venue", required=True)
    ap.add_argument("--cell", type=float, default=1.5)
    ap.add_argument("--slow", type=float, default=0.25)
    ap.add_argument("--ds", type=float, default=0.4)
    ap.add_argument("--max-gap-ms", type=int, default=15000)
    ap.add_argument("--max-speed", type=float, default=3.0)
    ap.add_argument("--tz-offset-h", type=float, default=2.0)
    ap.add_argument("--open-hour", type=int, default=7)
    ap.add_argument("--close-hour", type=int, default=22)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--layout-in", default=None, help="existing layout_prod.json for grid anchor")
    ap.add_argument("--layout-out", default=None, help="deprecated alias for --layout-in")
    args = ap.parse_args()
    if args.layout_out and not args.layout_in:
        args.layout_in = args.layout_out

    C = args.cell
    con = sqlite3.connect("file:%s?mode=ro" % args.db, uri=True)
    con.execute("PRAGMA query_only = ON")

    # Prefer an existing layout JSON (already venue-aligned); else bbox from tracks.
    if args.layout_in and os.path.exists(args.layout_in):
        with open(args.layout_in) as f:
            layout = json.load(f)
    else:
        row = con.execute(
            "SELECT MIN(position_x), MAX(position_x), MIN(position_z), MAX(position_z) "
            "FROM track_positions WHERE venue_id=?", (args.venue,)).fetchone()
        layout = {
            "venue": {"id": args.venue, "name": args.venue, "width": 78, "depth": 79},
            "bbox": {"minX": row[0], "maxX": row[1], "minZ": row[2], "maxZ": row[3]},
            "counts": {}, "polys": [],
        }

    gx0 = math.floor((layout["bbox"]["minX"] - 2) / C) * C
    gy0 = math.floor((layout["bbox"]["minZ"] - 2) / C) * C

    def new_store():
        return {}  # (ix,iy) -> [presence, dwell, steps, speedSum, rose[8], ids]

    stores = {name: new_store() for name, _, _ in SLICES}

    def cell_at(store, x, y):
        ix = int(math.floor((x - gx0) / C))
        iy = int(math.floor((y - gy0) / C))
        k = (ix, iy)
        c = store.get(k)
        if c is None:
            c = [0.0, 0.0, 0.0, 0.0, [0.0] * BINS, set()]
            store[k] = c
        return c

    def along(store, x0, y0, x1, y1, fn):
        dist = math.hypot(x1 - x0, y1 - y0)
        n = max(1, int(math.ceil(dist / (C * 0.5))))
        w = 1.0 / n
        for s in range(n):
            t = (s + 0.5) / n
            fn(cell_at(store, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t), w)

    def matches(name, hours, dows, h, d):
        if hours is not None and not (hours[0] <= h < hours[1]):
            return False
        if dows is not None and d not in dows:
            return False
        return True

    off = timedelta(hours=args.tz_offset_h)
    total = 0
    slice_rows = {name: 0 for name, _, _ in SLICES}
    live = {}  # track_key -> {slice_name: (lx,ly,lts,ex,ey,ets)}

    cur = con.execute(
        "SELECT track_key, timestamp, position_x, position_z FROM track_positions "
        "WHERE venue_id = ? ORDER BY track_key, timestamp", (args.venue,))

    cur_key = None
    for key, ts, x, z in cur:
        total += 1
        if x is None or z is None or ts is None:
            continue
        local = datetime.fromtimestamp(ts / 1000.0, timezone.utc) + off
        h, d = local.hour, local.weekday()
        if h < args.open_hour or h >= args.close_hour:
            continue

        if key != cur_key:
            cur_key = key
            live[key] = {}
            for name, hours, dows in SLICES:
                if not matches(name, hours, dows, h, d):
                    continue
                live[key][name] = [x, z, ts, x, z, ts]
                cell_at(stores[name], x, z)[5].add(key)
                slice_rows[name] += 1
            continue

        st = live.setdefault(key, {})
        for name, hours, dows in SLICES:
            if not matches(name, hours, dows, h, d):
                # Drop continuity when the sample leaves the slice.
                st.pop(name, None)
                continue
            slice_rows[name] += 1
            prev = st.get(name)
            if prev is None:
                st[name] = [x, z, ts, x, z, ts]
                cell_at(stores[name], x, z)[5].add(key)
                continue
            lx, ly, lts, ex, ey, ets = prev
            store = stores[name]
            dt = ts - lts
            if 0 < dt <= args.max_gap_ms:
                d_sec = dt / 1000.0
                standing = (math.hypot(x - lx, z - ly) / d_sec) < args.slow

                def dep(c, w, d_sec=d_sec, standing=standing, key=key):
                    c[0] += d_sec * w
                    c[5].add(key)
                    if standing:
                        c[1] += d_sec * w
                along(store, lx, ly, x, z, dep)
            prev[0], prev[1], prev[2] = x, z, ts

            dist = math.hypot(x - ex, z - ey)
            if dist >= args.ds:
                seg_sec = max(0.1, (ts - ets) / 1000.0)
                implied = dist / seg_sec
                if implied <= args.max_speed:
                    ang = math.atan2(z - ey, x - ex)
                    b = int(round((ang / (2 * math.pi)) * BINS)) % BINS

                    def dep2(c, w, b=b, implied=implied):
                        c[4][b] += w
                        c[2] += w
                        c[3] += implied * w
                    along(store, ex, ey, x, z, dep2)
                prev[3], prev[4], prev[5] = x, z, ts

        if total % 500000 == 0:
            sys.stderr.write("… %s rows\n" % total)

    os.makedirs(args.out_dir, exist_ok=True)
    index = {"slices": [], "cell_m": C, "venue_id": args.venue}

    for name, hours, dows in SLICES:
        store = stores[name]
        keep = [(k, c) for k, c in store.items() if c[0] >= MIN_PRESENCE_SEC or c[2] >= MIN_STEPS]
        if not keep:
            sys.stderr.write("slice %s empty\n" % name)
            continue
        ix0 = min(k[0] for k, _ in keep); ix1 = max(k[0] for k, _ in keep)
        iy0 = min(k[1] for k, _ in keep); iy1 = max(k[1] for k, _ in keep)
        out = []
        max_traffic = max_dwell = max_steps = 0
        for (ix, iy), c in keep:
            presence, dwell, st, speed_sum, rose, ids = c
            traffic = len(ids)
            max_traffic = max(max_traffic, traffic)
            max_dwell = max(max_dwell, dwell)
            max_steps = max(max_steps, st)
            rsum = sum(rose)
            rose_out = [int(round(v / rsum * 99)) for v in rose] if rsum > 0 else [0] * BINS
            sx = sy = 0.0
            for b in range(BINS):
                a = (b / BINS) * 2 * math.pi
                sx += math.cos(a) * rose[b]
                sy += math.sin(a) * rose[b]
            purity = (math.hypot(sx, sy) / rsum) if rsum > 0 else 0.0
            out.append({
                "i": ix - ix0, "j": iy - iy0,
                "t": traffic, "k": round(st, 2), "p": round(purity, 3),
                "s": round(speed_sum / st, 2) if st > 0 else 0,
                "d": round(dwell, 1), "e": round(presence, 1), "r": rose_out,
            })
        meta = {
            "source": "track_positions (production slice)",
            "slice": name,
            "slice_hours": list(hours) if hours else [args.open_hour, args.close_hour],
            "slice_dows": sorted(dows) if dows else None,
            "venue_id": args.venue,
            "cell_m": C, "bins": BINS,
            "nx": ix1 - ix0 + 1, "ny": iy1 - iy0 + 1,
            "frame": "venue",
            "origin_m": {"x": round(gx0 + ix0 * C, 3), "y": round(gy0 + iy0 * C, 3)},
            "rows_in_hours": slice_rows[name],
            "rows_total": total,
            "window_local_hours": [args.open_hour, args.close_hour],
            "cells_emitted": len(out),
            "max_traffic": max_traffic,
            "max_steps": round(max_steps, 2),
            "max_dwell_sec": round(max_dwell, 1),
            "steps_total": int(sum(c["k"] for c in out)),
            "span_hours": field_span_placeholder(hours, dows),
        }
        path = os.path.join(args.out_dir, "field_%s.json" % name)
        with open(path, "w") as f:
            json.dump({"meta": meta, "cells": out}, f)
        index["slices"].append({
            "id": name,
            "file": "field_%s.json" % name,
            "cells": len(out),
            "rows": slice_rows[name],
            "hours": meta["slice_hours"],
            "dows": meta["slice_dows"],
        })
        sys.stderr.write("wrote %s (%d cells, %d rows)\n" % (path, len(out), slice_rows[name]))

    with open(os.path.join(args.out_dir, "slices.json"), "w") as f:
        json.dump(index, f, indent=2)
    print(json.dumps(index, indent=2))


def field_span_placeholder(hours, dows):
    # Cosmetic only — the viewer shows slice label, not span.
    if hours:
        return hours[1] - hours[0]
    if dows:
        return 24 * len(dows)
    return 0


if __name__ == "__main__":
    main()
