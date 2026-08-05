# Edge Server Recovery Runbook — Treviglio (slave edge)

Written after the 2026-07-29 investigation into why Hyperspace showed no tracks
following an edge server restart.

| | |
|---|---|
| Host | `edge-NucBox-K7-PLUS` (GMKtec NucBox K7 PLUS) |
| Tailscale IP | `100.106.23.6` |
| SSH | `ssh edge@100.106.23.6` |
| Venue ID | `55fdd53b-3298-4355-97c0-b4e789b11d06` |
| Store NIC | `enp44s0` — `10.52.180.123/26` (Esselunga LAN, heavily firewalled) |
| LiDAR NIC | `enp45s0` — `192.168.1.102/24`, MTU 9000 |
| Cloud backend | DigitalOcean droplet `100.76.196.2`, region `sgp1` (Singapore) |

> The box's clock is set to **UTC+8**, not Italian time. Every timestamp in its
> logs is 6–7 hours ahead of local Treviglio time. Subtract 6 (CEST) when
> correlating with anything customer-facing.

---

## 1. What actually happened

**The slave halted on its own. It was not a power failure at the store, and the
BIOS auto-power-on setting is not the problem.**

> An earlier revision of this document blamed a power loss. That was wrong, and
> the correction matters because it changes what needs doing on site. The
> reasoning is recorded below so the conclusion can be re-checked.

### The timeline, from both machines

The two boxes sit on the same power strip, the same store LAN
(`10.52.180.122` and `.123`) and the same LiDAR subnet.

| When (+08) | Master | Slave |
|---|---|---|
| Jun 24 18:56:44 | dies, no clean shutdown | dies, no clean shutdown |
| Jun 24 ~19:00 | **boots by itself** 19:00:04 | **boots by itself** 18:59:12 |
| **Jul 9 13:31:39** | **keeps running normally** | **dies, never returns** |
| Jul 10 – Jul 28 | ~8,300 log lines every day | complete silence |
| Jul 29 17:14:39 | dies, no clean shutdown | (already dead) |
| Jul 29 ~17:15 | **boots by itself** 17:16:56 | **boots by itself** 17:15:12 |

### What that rules out

**It was not a site power event.** At 13:31:39 on 9 July the master was calmly
running its netcheck loop, and it went on logging ~8,300 lines a day for the
entire 20 days the slave was dark. A power cut cannot take out one box and
leave the other untouched on the same strip.

**Auto-power-on is enabled and works.** Twice — on 24 June and again on 29 July
— both machines lost power together, uncleanly, and *both came back on their
own within three minutes*. Nobody power-cycles two machines 45 seconds apart at
7pm on a Wednesday. So on 9 July, had the slave merely lost power, it would
have rebooted by itself exactly as it did on those two occasions. It did not.

**It was not memory, heat, or disk.** The final 24 hours contain no OOM kill, no
memory-pressure warning, no thermal or throttle event, no I/O error and no
kernel warning of any kind — only routine AppArmor audit noise every three
hours, right up to 12:00:15. The last OOM on this box was three days earlier
(6 July: `rslidar_sdk_node` at 13 GB, `gnome-system-monitor` at 8.8 GB) and the
system fully recovered from it.

The log simply stops mid-stream at 13:31:39 with no precursor whatsoever.

> **On the SSD counters:** the drive reports `unsafe_shutdowns = 14` and
> `power_cycles = 42`, but `wtmp` records **71** boots and `power_on_hours = 74`
> is less than the 354 hours of the single boot that ended on 9 July. The
> counters on this TWSC drive are not reliable and should not be used as
> evidence either way.

### What it leaves

Two candidates fit every observation equally well, and the available evidence
cannot separate them:

1. **The slave's own DC power adapter cut out.** Each box has its own brick, so
   this affects one machine only. Switching adapters commonly latch into
   over-current or over-temperature protection and stay latched until AC is
   fully removed — which is exactly what the 29 July strip cycle did.
2. **A hard kernel or hardware lockup.** The board stays powered but frozen, so
   nothing is logged and auto-power-on is irrelevant — the machine never lost
   power in the first place. Only a power cycle clears it.

Both are consistent with an instantaneous silent halt, a healthy master, and
recovery only after the strip was cycled. Section 3 covers how to tell them
apart next time; the mitigations in section 2 cover both.

### Why it stayed down for 20 days

Whatever stopped it, the machine had no way to recover and nobody was watching:

- **No hardware watchdog.** The Intel PCH TCO watchdog on this board was never
  exposed, because `iTCO_wdt` is not autoloaded — so a freeze could not trigger
  a reset. *(Fixed 2026-08-04, see section 2.)*
- **No panic recovery.** `panic_on_oops=0`, `hardlockup_panic=0` and
  `kernel.panic=0`, so any kernel-level fault left the box sitting dead forever
  rather than rebooting. *(Fixed 2026-08-04.)*
- **No alerting**, so a 20-day outage went unnoticed. *(Fixed 2026-07-29.)*

### Why tracks were still missing after it was powered back on

Even once the machine booted, the pipeline did not come back, because
essentially none of it was actually configured to start on boot:

| Component | Why it did not start |
|---|---|
| `edge-lidar.service` | Pointed at `/snap/bin/docker`, which does not exist on this box (docker is `/usr/bin/docker`). Failed `status=203/EXEC` on every boot. |
| Docker containers | `restart: unless-stopped`, combined with the unit's `ExecStartPre=docker compose down`, marked them "explicitly stopped" so they stayed down. |
| Perception stack (`fast3dis`) | **No autostart at all.** It only ever ran because someone launched the Qt dashboard by hand from a GNOME terminal. |
| `mqtt_publisher_node` | Started by hand. It connects to the broker once and never retries, so if the broker is not up first it stays silently disconnected forever. |
| LiDAR NIC MTU 9000 | Applied by hand with `ip link set`, reverting to 1500 on every boot. |
| Kernel UDP buffer tuning | Applied by hand with `sysctl -w`, reverting on every boot. |

Also found and fixed along the way: DNS was completely broken (the store NIC
publishes no resolver, leaving only Tailscale MagicDNS, which cannot resolve
public names), the journal had grown to 1.8 GB, and a `edge-mosquitto-customer`
container was crash-looping against an empty config directory.

### Unrelated but real: a memory leak

On **2026-07-06** the OOM killer fired twice. `rslidar_sdk_node` had grown to
**13 GB RSS** before being killed, and a forgotten `gnome-system-monitor` window
had reached 8.8 GB. This is a separate fault from the power loss, and it is not
yet fixed — the watchdog only warns about it.

---

## 2. What is now installed

### On the edge box

| Unit | Purpose |
|---|---|
| `edge-lidar.service` | Brings up the docker stack on boot. Correct docker path, no destructive `compose down`. |
| `fast3dis-mqtt-publisher.service` | Supervises the ROS→MQTT publisher, `Restart=always`, waits for the broker before starting. |
| `fast3dis-perception.service` (user unit) | Starts the perception stack in the `edge` graphical session using the vendor's `--project ... -p autorun:=true` mode. |
| `hyperspace-edge-watchdog.timer` | Every 60s, checks the chain end to end and repairs the narrowest broken thing. |

Supporting changes: containers switched to `restart: always`; GDM autologin
enabled for `edge` (the Qt dashboard needs a real X session); MTU 9000 persisted
in NetworkManager; UDP tuning persisted in `/etc/sysctl.d/99-fast3dis-lidar.conf`;
journal capped at 500 MB; public DNS forced in
`/etc/systemd/resolved.conf.d/99-hyperspace-public-dns.conf`.

### Self-recovery from a freeze (added 2026-08-04)

Everything above assumes the operating system is alive to run it. On 9 July it
was not, and that is what turned a fault into a 20-day outage. Two layers below
the OS now handle that case:

| Setting | File | Effect |
|---|---|---|
| `iTCO_wdt` autoloaded | `/etc/modules-load.d/hyperspace-watchdog.conf` | Exposes the Intel PCH TCO watchdog (version 6) as `/dev/watchdog0`. |
| `RuntimeWatchdogSec=60` | `/etc/systemd/system.conf.d/99-hyperspace-watchdog.conf` | systemd pets the chip every 30s. If the kernel or PID 1 wedges, **the chipset resets the board within 60 seconds** with no software involved. |
| `RebootWatchdogSec=5min` | same file | A reboot that hangs is forced through after 5 minutes. |
| `kernel.panic=10`, `panic_on_oops=1`, `hardlockup_panic=1` | `/etc/sysctl.d/99-hyperspace-panic-recovery.conf` | Kernel faults reboot instead of leaving the box dark. |

Verified live on 2026-08-04: kernel reports *"Found a Intel PCH TCO device
(Version=6)"* and *"Watchdog running with a timeout of 1min"*, `state=active`
with `timeleft` holding at 60s, and the box ran normally for well over two
watchdog periods with the full pipeline healthy.

`softlockup_panic` and `hung_task_panic` were deliberately left disabled — both
fire on slow I/O and heavy load and would cause spurious reboots in a store.

**Scope:** this covers a frozen machine. It cannot help if the box loses DC
power, which is still the other open candidate from section 1.

The watchdog exists because restart policies cannot see a component that is
running but silent — which is precisely how this pipeline fails. It checks
containers, broker, cloud bridge, perception, publisher, actual trajectory
traffic and NIC MTU, with a 5-minute cooldown and a cap of 3 repairs per hour
per fault so it can never flap.

Current health is always readable at:

```bash
ssh edge@100.106.23.6 'cat /run/hyperspace-edge-health.json'
```

### On the cloud server

`hyperspace-edge-heartbeat.timer` runs every 5 minutes on the DO droplet. If no
tracks arrive for 10 minutes it emails `ln@ulisse.tech` (via Resend), repeats
every 6 hours while still down, and sends a recovery notice when the stream
returns. Configure in `/etc/hyperspace/heartbeat.env`; test with
`/usr/local/bin/hyperspace-edge-heartbeat.sh --test`.

`hyperspace-health-check.sh` runs every 15 minutes from cron and covers the
failures the heartbeat cannot see, because they all look healthy from outside:
the reconciler being disabled, its gates having drifted from the locked `luca`
preset, the disk filling, the database bloating with free pages, and the nightly
backup going stale. Same Resend transport and state directory as the heartbeat,
with a 12-hour re-alert window.

### The reconciler flag — check this after every recovery (added 2026-08-06)

**Tracks returning is not the same as the data being correct.** The heartbeat
goes green as soon as trajectories flow again, but the reconciler is a separate
per-venue flag in the database, and with it off the platform stores raw vendor
output: fragmented tracks, static shelf phantoms counted as shoppers, and zone
dwell collapsing to about 3 seconds.

That is exactly what happened after the July outage. The stream came back, the
heartbeat was satisfied, and the reconciler stayed off — so months of Esselunga
dwell and footfall figures were quietly reported from unreconciled data. Nothing
was broken in a way anything was watching for.

```bash
# Must report enabled=True, and the gates must match the luca preset
ssh root@100.76.196.2 \
  "curl -s localhost:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config"
```

Expected: `enabled: true`, `reid_max_gap_s: 12`, `reid_max_distance_m: 12.7`,
`smoothing_alpha: 0.12`, `ghost_static_timeout_s: 90`.

To restore it, send the **complete** config, never a partial patch:

```bash
ssh root@100.76.196.2 \
  "curl -s -X PATCH localhost:3001/api/venues/55fdd53b-3298-4355-97c0-b4e789b11d06/reconciler-config \
     -H 'Content-Type: application/json' --data-binary @/tmp/luca.json"
```

The payload is kept at `scripts/restore-luca-reconciler.json`. Until 2026-08-06 a
partial patch such as `{"enabled": true}` silently reset every tuned gate to
factory defaults — which reads as "enabled" while tracking no better than raw
perception. That is fixed, and the health check above now alarms on drift, but
send the full payload regardless.

---

## 3. On-site checklist

The remaining single point of failure is physical, and **none of the software
above can fix it**. Someone with hands on the machine must do these.

> ⚠️ **The autostart chain in section 2 has not yet been validated by a reboot.**
> It was installed on 2026-07-29 while the stack was live, so nothing was
> restarted. Step 5 below is that validation — do it during the same visit as
> the BIOS change, ideally outside store hours.

> **Do not bother with the BIOS AC-power setting.** It is already enabled and
> proven working (see section 1). Changing it would fix nothing.

1. **Fit a metering smart plug on the slave.** This is now the single
   highest-value item, and it does two jobs at once. It lets you power-cycle the
   box remotely instead of driving to Treviglio — the only recovery action that
   worked on 29 July — and its power reading tells you *immediately* which of
   the two candidate causes you are looking at. If the box goes unreachable
   again: normal power draw means it is powered but frozen (a lockup); near-zero
   draw means its power supply has dropped out.
2. **Swap the slave's DC adapter with the master's, and label them.** The master
   has run for weeks without incident on the same strip, so if the fault follows
   the adapter to the master, the adapter is the cause. If the slave keeps
   failing on the master's known-good adapter, it is the machine.
3. **Check airflow.** The CPU package sits at 78–82 °C under normal load
   (limit 100 °C). Not throttling, and not implicated in this failure, but it is
   a small box in a retail back office — make sure the vents are clear.
4. **A UPS is optional here.** It protects against the genuine strip-wide
   outages seen on 24 June and 29 July, which the boxes already survive
   unaided. It would not have prevented this incident.
5. **Validate unattended recovery.** Pull the power cord, plug it back in, and
   without touching keyboard or mouse confirm each of the following. Budget
   about 10 minutes.

   | Expected | How to check |
   |---|---|
   | Box powers on by itself | It boots without pressing the button (proves step 1) |
   | It logs in to the desktop unaided | GDM autologin lands on the `edge` session |
   | The Qt dashboard appears and starts the pipeline | `fast3dis-perception.service` reached the vendor's autorun mode |
   | Tracks reach the cloud | `ssh edge@100.106.23.6 'cat /run/hyperspace-edge-health.json'` reports `"overall": "ok"` |

   If perception does not come up, it is the one piece running under the desktop
   session rather than the system, so check it there:

   ```bash
   ssh edge@100.106.23.6 \
     'XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status fast3dis-perception -n 50'
   ```

   Everything else is a plain system unit and will show up in
   `journalctl -b -u edge-lidar -u fast3dis-mqtt-publisher -u hyperspace-edge-watchdog`.
   As a fallback, the pipeline can always be started by hand exactly as before:
   `ros2 run fast3dis_dashboard fast3dis_dashboard` from `~/fast3dis2`.

---

## 4. Remote triage

```bash
# One-shot health of the whole chain
ssh edge@100.106.23.6 'cat /run/hyperspace-edge-health.json'

# Full pipeline diagnostic from your laptop
bash scripts/diagnose_live_pipeline.sh 55fdd53b-3298-4355-97c0-b4e789b11d06 100.106.23.6

# Watchdog decisions and repairs
ssh edge@100.106.23.6 'journalctl -u hyperspace-edge-watchdog -n 50 --no-pager'

# Is the cloud actually receiving tracks?
ssh root@100.76.196.2 "curl -s localhost:3001/api/tracking/venue/55fdd53b-3298-4355-97c0-b4e789b11d06/status"

# Is the cloud side healthy — reconciler on, disk, backups, database bloat?
ssh root@100.76.196.2 "/usr/local/bin/hyperspace-health-check.sh"
```

**If the edge is unreachable entirely**, the machine has stopped at a level no
software can reach — as on 9 July. Only a power cycle recovers it. With the
smart plug from the on-site checklist that is a remote action; without one it is
a site visit. Read the plug's power draw *before* cycling it: that measurement
is the evidence needed to finally separate a frozen box from a dead power
supply, and it is lost the moment you cycle it.

---

## 5. Known open issues

- **The `rslidar_sdk_node` memory blow-up may have been a side effect, not a
  leak.** It reached 13 GB and was OOM-killed on 2026-07-06. That boot began
  after the unplanned 24 June restart, so the hand-applied MTU 9000 and UDP
  buffer tuning had been silently lost — a 1500-byte MTU with default receive
  buffers would make the SDK backlog LiDAR packets. Since both settings were
  made persistent on 2026-07-29, the same node has held steady at **120 MB over
  six days**. Worth re-checking after the next long run before escalating to the
  vendor.
- **Watch `component_container_mt` instead.** It is the largest process on the
  box at ~3.3 GB and is the one still trending upward. Overall memory went from
  24.8% to 28.7% average across six days, roughly 250 MB/day — slow enough to be
  harmless between restarts, but it is the candidate worth profiling.
- **Tailscale node keys expire, and that will look exactly like a crash.**
  The `Hyperspace` cloud node's key expires **2026-08-22**, the two edge nodes
  on **2026-09-20** and **2026-09-28**. When a key expires the node drops off
  the tailnet completely: no SSH, no MQTT bridge, no heartbeat — indistinguishable
  at a glance from the 9 July incident. **Disable key expiry** on all three
  always-on servers in the Tailscale admin console. Check with
  `tailscale status --json` and read each peer's `KeyExpiry`.
- **Tailscale cannot establish a direct path, and it drops out periodically.**
  The store firewall blocks outbound UDP entirely (`netcheck` reports
  `UDP: false`), so all traffic is relayed through DERP. Combined with the
  backend being in Singapore while the store is in Italy, round-trip time is
  170–210 ms. On **2026-08-04 the link went down for 13 minutes** with the
  cloud node reporting `online=yes` the whole time — the two peers had homed to
  different relays (`magicsock: derp-18 does not know about peer`). It healed
  itself when the edge re-homed. Getting outbound UDP 41641 opened at the store
  would allow a direct connection and remove this whole failure class.
- **A relay dropout longer than ~5 minutes loses data.** The edge broker queues
  for the bridge with `max_queued_messages 100000`, and the venue produces
  ~330 messages/second, so the buffer is only about five minutes deep. The
  13-minute outage above dropped roughly eight minutes of trajectories. Raising
  the queue limit to ~600,000 would cover a 30-minute dropout cheaply.
- **The cloud MQTT broker and backend are reachable from the open internet.**
  `165.245.191.45` answers on tcp/1883 and tcp/3001 from outside the tailnet,
  and the broker config has `allow_anonymous true`. This has not been probed
  further — doing so would mean reading customer data — but it should be closed
  to the tailnet, or given authentication and TLS.
- **The store firewall is an allowlist.** Ubuntu and Docker package mirrors are
  blocked; only `pkgs.tailscale.com` answers. To install packages, download the
  `.deb` elsewhere and copy it over Tailscale.
- **Clock is UTC+8**, along with a Singapore apt mirror — leftovers from the
  vendor's original image. Harmless to the data (timestamps are epoch
  milliseconds) but confusing during incident forensics.
- **A `edge-01` MQTT client-ID collision** produced ~946,000 "session taken
  over" disconnects historically, when two publishers ran at once. Currently
  quiet, but the client ID is derived from `device_id` and is not unique per
  process, so it will recur if a second publisher is ever started by hand.
