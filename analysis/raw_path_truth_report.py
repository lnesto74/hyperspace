"""Print a readable digest of a raw_path_truth.mjs result file."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "/data/db/raw_path_truth_probe.json"
top_n = int(sys.argv[2]) if len(sys.argv) > 2 else 15

d = json.load(open(path))

print("VENUE     ", d["venueName"])
print("WINDOW    ", d["window"])
print("INGEST    ", json.dumps(d["ingest"]))
print()
print("TOTALS")
print(json.dumps(d["totals"], indent=2))
print()

zones = d["zones"]
active = [z for z in zones if z["reconciled"]["visits"] > 0]
print("zones with visits:", len(active), "of", len(zones))
print()

hdr = "%-32s %-13s %6s %6s %6s %7s %7s %8s %6s %8s %8s %5s" % (
    "zone", "category", "span", "rawvis", "recvis",
    "rawpath", "recpath", "samppath", "ret%", "rawdwell", "recdwell", "frag",
)
print(hdr)
print("-" * len(hdr))
for z in active[:top_n]:
    print("%-32s %-13s %6s %6s %6s %7s %7s %8s %6s %8s %8s %5s" % (
        str(z["name"])[:32],
        str(z["category"])[:13],
        z["spanM"],
        z["raw"]["visits"],
        z["reconciled"]["visits"],
        z["raw"]["meanPathM"],
        z["reconciled"]["meanPathM"],
        z["sampled"]["meanPathM"],
        z["sampled"]["pathRetainedPct"],
        z["raw"]["meanDwellSec"],
        z["reconciled"]["meanDwellSec"],
        z["fragmentsPerVisit"],
    ))
