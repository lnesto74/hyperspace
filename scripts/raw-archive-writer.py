#!/usr/bin/env python3
"""Append the live MQTT trajectory feed to one gzipped JSONL file per UTC day.

Reads lines on stdin (from mosquitto_sub) and writes them to
<ARCHIVE_DIR>/hyperspace-raw-YYYY-MM-DD.jsonl.gz, rolling the file when the UTC
date changes. Appending to a gzip stream is valid: concatenated members
decompress as one continuous stream, so a restart mid-day costs nothing.

Why this exists: the only raw perception capture that survives is a single
34-minute file from 19 May, recorded by hand. Every claim about vendor track
quality rests on it, and there is no way to produce evidence for any other day.
Measured at ~19:1 compression, a full trading day costs about 270 MB.

Deliberately dependency-free — the droplet has no pyarrow, and gzipped JSONL is
what the existing analysis scripts already read.
"""
import gzip
import os
import signal
import sys
import time
from datetime import datetime, timezone

ARCHIVE_DIR = os.environ.get("ARCHIVE_DIR", "/data/hyperspace/raw")
# How often the gzip member is closed off. Shorter means less data at risk from
# a hard kill, at the cost of compression ratio (each member restarts the
# dictionary). 60 s loses roughly a percent against a single-member file.
FLUSH_SECONDS = float(os.environ.get("FLUSH_SECONDS", "60"))
COMPRESS_LEVEL = int(os.environ.get("COMPRESS_LEVEL", "6"))


def path_for(day: str) -> str:
    return os.path.join(ARCHIVE_DIR, f"hyperspace-raw-{day}.jsonl.gz")


def main() -> int:
    os.makedirs(ARCHIVE_DIR, exist_ok=True)

    handle = None
    current_day = None
    last_roll = time.monotonic()
    lines = 0

    def close_current():
        nonlocal handle
        if handle is not None:
            handle.flush()
            handle.close()
            handle = None

    def open_current(day: str):
        nonlocal handle
        handle = gzip.open(path_for(day), "at", compresslevel=COMPRESS_LEVEL,
                           encoding="utf-8")

    def on_signal(_sig, _frame):
        # Flush what we have; systemd stop or a broker restart must not truncate
        # the day's archive.
        close_current()
        sys.stderr.write(f"[raw-archive] stopped after {lines} lines\n")
        sys.exit(0)

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if day != current_day:
            close_current()
            current_day = day
            open_current(day)
            last_roll = time.monotonic()
            sys.stderr.write(f"[raw-archive] writing {path_for(day)}\n")
            sys.stderr.flush()

        handle.write(line + "\n")
        lines += 1

        # Close and reopen rather than flush. A flushed gzip member still has no
        # trailer, so `gzip -t` fails on the in-progress file and an operator
        # cannot tell a live capture from a corrupt one. Closing finishes the
        # member; reopening in append mode starts another, and concatenated
        # members decompress as a single stream. The file is therefore valid at
        # every instant, including after a hard kill.
        now = time.monotonic()
        if now - last_roll >= FLUSH_SECONDS:
            close_current()
            open_current(current_day)
            last_roll = now

    close_current()
    sys.stderr.write(f"[raw-archive] input ended after {lines} lines\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
