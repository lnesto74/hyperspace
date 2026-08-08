#!/usr/bin/env python3
"""
Benchmark the vendor's track construction against ours on the same raw feed.

The vendor proposes: one perception id = one track, then drop "infeasible"
tracks (his example: net displacement < 2 m), then reconcile what is left.
This measures what each step actually does to the population.

Distances are computed in the raw perception frame. The venue transform is a
rigid rotation with scale 1, so every distance here is identical in venue
metres and no transform is needed.

Input: ts,id,x,y CSV of the raw vendor feed (one row per object per frame).
"""
import csv
import gzip
import math
import sys
from collections import defaultdict

SPLIT_MS = 2000        # vendor's own default: silence after which an id is terminated
NOMINAL_HZ = 10.0


def pct(v, p):
    if not v:
        return float("nan")
    v = sorted(v)
    k = (len(v) - 1) * p
    lo, hi = math.floor(k), math.ceil(k)
    return v[int(k)] if lo == hi else v[lo] * (hi - k) + v[hi] * (k - lo)


def load(path):
    by_id = defaultdict(list)
    frames = defaultdict(set)
    op = gzip.open if path.endswith(".gz") else open
    with op(path, "rt") as fh:
        r = csv.reader(fh)
        next(r, None)
        for row in r:
            if len(row) < 4:
                continue
            ts = int(row[0])
            oid = row[1]
            x = float(row[2])
            y = float(row[3])
            by_id[oid].append((ts, x, y))
            frames[ts].add(oid)
    for k in by_id:
        by_id[k].sort()
    return by_id, frames


def id_metrics(v):
    """Vendor's own per-id metrics, over the id's whole life."""
    path = 0.0
    px = py = None
    xs = [s[1] for s in v]
    ys = [s[2] for s in v]
    for s in v:
        if px is not None:
            path += math.hypot(s[1] - px, s[2] - py)
        px, py = s[1], s[2]
    span = (v[-1][0] - v[0][0]) / 1000.0
    return {
        "net": math.hypot(v[-1][1] - v[0][1], v[-1][2] - v[0][2]),
        "extent": math.hypot(max(xs) - min(xs), max(ys) - min(ys)),
        "path": path,
        "span": span,
        "n": len(v),
    }


def fragments(v, split_ms=SPLIT_MS):
    n = 1
    for a, b in zip(v, v[1:]):
        if b[0] - a[0] > split_ms:
            n += 1
    return n


def concurrency(frames, keep=None):
    """Distinct ids visible per frame - i.e. people in the store right now."""
    counts = []
    for ts in sorted(frames):
        ids = frames[ts]
        counts.append(len(ids if keep is None else (ids & keep)))
    return counts


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "tmp/vendor_check/win_today.csv.gz"
    by_id, frames = load(path)

    ts_all = sorted(frames)
    t0, t1 = ts_all[0], ts_all[-1]
    dur_s = (t1 - t0) / 1000.0
    dur_h = dur_s / 3600.0
    obs = sum(len(v) for v in by_id.values())

    met = {k: id_metrics(v) for k, v in by_id.items()}
    frag_total = sum(fragments(v) for v in by_id.values())

    print("=" * 74)
    print("RAW VENDOR FEED")
    print("=" * 74)
    print(f"  window            {dur_s/60:.1f} min   ({dur_h:.3f} h)")
    print(f"  frames            {len(frames):,}  ({len(frames)/dur_s:.2f} Hz)")
    print(f"  observations      {obs:,}")
    print(f"  unique ids        {len(by_id):,}")
    print(f"  id birth rate     {len(by_id)/dur_h:,.0f} new ids / hour")
    print()
    print(f"  fragments at his own 2 s split rule: {frag_total:,}"
          f"   ({frag_total/max(len(by_id),1):.2f} per id)")
    print("  -> his '1 id = 1 track' is not what his script does; it splits on silence")
    print()
    spans = [m["span"] for m in met.values()]
    nets = [m["net"] for m in met.values()]
    paths = [m["path"] for m in met.values()]
    print("  per-id distribution        p50      p90      max")
    print(f"    lifetime (s)          {pct(spans,.5):7.2f}  {pct(spans,.9):7.2f}  {max(spans):7.1f}")
    print(f"    net displacement (m)  {pct(nets,.5):7.2f}  {pct(nets,.9):7.2f}  {max(nets):7.1f}")
    print(f"    walked path (m)       {pct(paths,.5):7.2f}  {pct(paths,.9):7.2f}  {max(paths):7.1f}")
    print()

    base = concurrency(frames)
    print(f"  people present concurrently:  mean {sum(base)/len(base):.1f}"
          f"   median {pct(base,.5):.0f}   p90 {pct(base,.9):.0f}   max {max(base)}")
    print()

    # ---------------------------------------------------------------- filters
    print("=" * 74)
    print("EFFECT OF HIS FILTER")
    print("=" * 74)
    print()
    print(f"{'filter':<34}{'ids kept':>10}{'% kept':>9}{'obs kept':>11}"
          f"{'concurrent':>12}")
    print("-" * 76)
    print(f"{'(none) raw feed':<34}{len(by_id):>10,}{100.0:>8.1f}%{obs:>11,}"
          f"{sum(base)/len(base):>12.1f}")

    scenarios = [
        ("net displacement >= 2 m", lambda m: m["net"] >= 2.0),
        ("net displacement >= 1 m", lambda m: m["net"] >= 1.0),
        ("extent (bbox diag) >= 2 m", lambda m: m["extent"] >= 2.0),
        ("lifetime >= 2 s", lambda m: m["span"] >= 2.0),
        ("lifetime >= 5 s", lambda m: m["span"] >= 5.0),
        ("walked path >= 2 m", lambda m: m["path"] >= 2.0),
    ]
    results = {}
    for label, keepfn in scenarios:
        keep = {k for k, m in met.items() if keepfn(m)}
        kobs = sum(met[k]["n"] for k in keep)
        conc = concurrency(frames, keep)
        results[label] = (keep, conc)
        print(f"{label:<34}{len(keep):>10,}{100.0*len(keep)/len(by_id):>8.1f}%"
              f"{kobs:>11,}{sum(conc)/len(conc):>12.1f}")
    print()

    # ------------------------------------------------- does it delete people?
    print("=" * 74)
    print("DOES HIS FILTER DELETE NOISE, OR PEOPLE?")
    print("=" * 74)
    print()
    keep2, conc2 = results["net displacement >= 2 m"]
    dropped = [k for k in by_id if k not in keep2]

    empty = sum(1 for c in conc2 if c == 0)
    print(f"  His 2 m rule keeps {len(keep2):,} of {len(by_id):,} ids "
          f"({100.0*len(keep2)/len(by_id):.1f}%).")
    print(f"  Mean people visible falls {sum(base)/len(base):.1f} -> "
          f"{sum(conc2)/len(conc2):.1f}"
          f"  ({100.0*(1-(sum(conc2)/len(conc2))/(sum(base)/len(base))):.0f}% of the"
          f" store's population removed)")
    print(f"  Frames left with nobody in the store at all: {empty:,} of "
          f"{len(conc2):,}  ({100.0*empty/len(conc2):.1f}%)")
    print()

    # How much *observed person-time* does he delete, and was it stationary?
    drop_time = sum(met[k]["span"] for k in dropped)
    keep_time = sum(met[k]["span"] for k in keep2)
    print(f"  observed person-time kept    {keep_time/60:9.1f} min")
    print(f"  observed person-time deleted {drop_time/60:9.1f} min"
          f"   ({100.0*drop_time/(drop_time+keep_time):.1f}%)")
    print()

    d_span = [met[k]["span"] for k in dropped]
    d_path = [met[k]["path"] for k in dropped]
    print(f"  the deleted ids: median lifetime {pct(d_span,.5):.2f} s, "
          f"median walked path {pct(d_path,.2):.2f} m")
    long_lived = [k for k in dropped if met[k]["span"] >= 10.0]
    print(f"  but {len(long_lived):,} deleted ids lived >= 10 s "
          f"({100.0*len(long_lived)/max(len(dropped),1):.1f}% of deletions) - "
          f"those are people standing still, not noise")
    print()

    # ------------------------------------------------------- visits per hour
    print("=" * 74)
    print("VISITS PER HOUR, BY METHOD")
    print("=" * 74)
    print()
    print(f"{'method':<44}{'count':>10}{'per hour':>12}")
    print("-" * 66)
    print(f"{'raw ids (his 1 id = 1 track)':<44}{len(by_id):>10,}"
          f"{len(by_id)/dur_h:>12,.0f}")
    print(f"{'his fragments (2 s split, his script)':<44}{frag_total:>10,}"
          f"{frag_total/dur_h:>12,.0f}")
    print(f"{'his ids surviving the 2 m filter':<44}{len(keep2):>10,}"
          f"{len(keep2)/dur_h:>12,.0f}")
    print()
    print(f"  For reference a mean of {sum(base)/len(base):.0f} people are in view at once.")
    print("  Little's law: entrants/h = concurrent / mean visit duration (h).")
    for dwell_min in (10, 15, 20, 30):
        print(f"    if the average shopper stays {dwell_min:>2} min -> "
              f"{(sum(base)/len(base))/(dwell_min/60.0):>6,.0f} entrants/hour")


if __name__ == "__main__":
    main()
