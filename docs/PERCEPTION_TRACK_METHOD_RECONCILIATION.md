# Track construction: reconciling the two methods

**Site:** Treviglio · **Measurement window:** Saturday 8 August 2026, 15:10–15:55 local
**Data:** 1,133,757 raw perception messages, 27,000 frames at exactly 10.00 Hz, no gaps
**Feed:** `hyperspace/trajectories/lidar-edge-001`, captured before any Hyperspace processing

---

## Summary

Three findings, in order of importance.

1. **We found and fixed a fault on our side.** Between 6 August and 8 August, 21.7% of the
   perception feed never reached our cloud. That is our defect, it is fixed, and any earlier
   comparison between the two systems was made against a feed we had already damaged.

2. **The vendor's proposed filter removes 42% of the people standing in the store.** It is a
   mobility filter, not a quality filter. Because it selects on displacement, it preferentially
   deletes shoppers who are standing still — which in a supermarket is the browsing customer.

3. **Hyperspace does not fragment the vendor's data; it merges it.** We combine 1.59 vendor IDs
   into each identity. The premise that our reconciliation splits his tracks is not supported by
   the data.

A fourth point applies to both parties: every whole-population counting method, his and ours,
produces figures one to two orders of magnitude above what the store can physically contain.
The root cause is identity churn in the perception layer.

---

## 1. The fault on our side, and its correction

Our edge broker bridges to our cloud broker over Tailscale. The store network blocks outbound
UDP, so Tailscale cannot establish a direct path and falls back to a relay at 176 ms RTT.

Measured on 8 August, the bridge dropped and reconnected **850 times in 99 minutes** — once every
7.0 seconds, unavailable roughly 1.7 seconds each time. Our edge adapter published at QoS 0, and
an MQTT broker never queues a QoS 0 message for a disconnected subscriber. Everything published
during each outage was discarded.

Verified by simultaneous capture at both ends of the bridge:

| | Before | After |
|---|---|---|
| Messages lost edge → cloud | 21.7% | 0.047% |
| Frames entirely lost | 22.3% | 0 |
| Outage pattern | 1.7 s every 7 s | none |

The fix was to publish at QoS 1 so messages queue through an outage. This is stated first because
it means the vendor was partly right that data was being lost — though not for the reason given,
and not in a way that supports his filtering proposal.

---

## 2. What the vendor's script actually does

Reading `fast3dis_profile_v2.txt` as supplied:

- Every filter defaults to **zero**. `--min-displacement`, `--min-path`, `--min-duration` and
  `--min-completeness` are opt-in flags. The published statistics required setting them.
- It does **not** implement "1 ID = 1 track". It splits an ID on any silence longer than
  `--split-ms`, default **2000 ms**. On our window this turns 19,756 IDs into 23,074 fragments,
  1.17 per ID.
- Filters are applied to an ID's **whole life**, removing the ID and every sample it contributed
  before any statistic is computed.

So the proposal "1 ID = 1 track, then drop infeasible tracks, then reconcile" is not the
behaviour of the tool that produced the supporting numbers.

---

## 3. Reproducing the vendor's headline figures

Running his own metric definitions on our raw window reproduces his published values, and shows
where they come from:

| Population | Median duration | Median path | Share of IDs kept |
|---|---|---|---|
| Raw, unfiltered — the tracker's true output | **3.40 s** | 1.07 m | 100% |
| After `net displacement ≥ 2 m` | 10.10 s | 6.35 m | 23.5% |
| After `net ≥ 2 m` **and** `path ≥ 5 m` | 16.10 s | 9.10 m | 14.9% |

The quoted ~9 s median duration is not a property of the perception output. It is what remains
after removing 76–85% of it. The unfiltered median lifetime of a perception ID is **3.40 s**.

---

## 4. What the 2 m filter costs

The decisive measurement does not depend on either party's reconciliation. For every single
frame, count the distinct IDs present. That is the number of people in the store at that instant,
and fragmentation cannot inflate it.

| | Mean people visible per frame |
|---|---|
| Raw vendor feed | **42.0** |
| After `net displacement ≥ 2 m` | **24.4** |

The filter removes **42% of the store's population** and **48.6% of all observed person-time**.

The anticipated objection is that these are static fixtures misdetected as people. We tested it.
Of the 2,859 deleted IDs that lived 10 seconds or longer:

- they occupy **837 distinct 1 m × 1 m cells** across the salesfloor
- the single busiest cell holds only **2.7%** of them
- the ten busiest cells together hold **15.1%**
- only about a quarter sit in cells revisited by 20 or more different IDs

A fixture population would concentrate in a handful of fixed locations. This one is distributed
across the sales floor, which is the signature of customers standing at shelves.

For retail analytics this bias is the wrong way round. A shopper who stops to compare two products
has near-zero net displacement and is deleted; a customer walking straight through to the far
aisle is retained. The filter systematically removes the highest-intent customers.

---

## 5. What Hyperspace reconciliation actually does

Over the same window, from our production database:

| | Count |
|---|---|
| Vendor perception IDs observed | 13,658 |
| Hyperspace stable identities produced | 8,618 |
| **Merge ratio** | **1.59 vendor IDs per identity** |

We merge. We do not split. The concern that Hyperspace fragments the perception output is not
consistent with the record.

---

## 6. The problem that neither method solves

The store holds an average of 42 people at any moment. Projected to an hourly rate:

| Method | Identities per hour | Physically plausible? |
|---|---|---|
| 1 ID = 1 track | 26,343 | no |
| Fragments at the 2 s split rule | 30,767 | no |
| After the 2 m displacement filter | 6,179 | no |
| Hyperspace reconciled identities | 11,491 | no |
| Hyperspace entrance line-crossings (distinct) | **181** | **yes** |
| Little's law reference (42 present, 15 min visit) | 168 | — |

The perception layer mints a new ID roughly **every 5.7 seconds per person**. Our reconciliation
extends that to 13.1 seconds. Counting a full shopping trip would require merging on the order of
50:1, not 1.59:1.

Only the entrance line-crossing count survives this, because a line crossing is an *event*:
identity churn cannot inflate it the way a distinct-identity count can. At 181 per hour it sits
inside the 126–252 per hour band implied by Little's law for a 10–30 minute visit.

---

## 7. Conclusions and requests

**On the filter.** We will not adopt displacement filtering upstream of counting. It would remove
42% of the store's population before measurement. It remains legitimate for path-quality
reporting, provided such charts are labelled as covering mobile tracks only.

**On reconciliation.** We will keep and substantially strengthen ours. At 1.59:1 it is far too
weak, and we regard that as our own work item rather than a dispute.

**On measurement.** Footfall should be anchored on entrance line-crossings, not on counts of
distinct identities, until identity stability improves materially.

**What we ask of the vendor.** The actionable defect is not reconciliation philosophy — it is that
a perception identity survives a median of 3.40 seconds and is replaced roughly every 5.7 seconds
per person. Specifically:

1. Median identity lifetime, unfiltered, with a target figure.
2. Behaviour when a person stops moving — is the ID retained, or retired and reissued?
3. Behaviour across occlusion and blind spots — is re-acquisition attempted, and on what basis?
4. Any statistic quoted should state the filters applied and the share of the population removed.

---

## Method and caveats

Raw feed captured directly from MQTT before Hyperspace processing. Distances computed in the
perception frame; the venue transform is a rigid rotation at scale 1, so all distances are
identical in venue metres and no transform is involved in any figure above. Reproduction script:
`analysis/vendor_method_benchmark.py`.

Three limitations, stated so they are not discovered later:

- **Single window.** One 45-minute Saturday afternoon window. Weekday trading should be confirmed
  before these figures are treated as typical.
- **Concurrency assumes one ID per person.** If the detector holds duplicate simultaneous IDs on
  one person, the mean of 42 overstates true occupancy and the Little's law band shifts. It does
  not change the direction of the filter result.
- **Day-on-day comparison is confounded.** The equivalent Friday window shows 138 crossings and 80
  distinct identities against 230 and 136 on Saturday, but Friday's feed was missing 22% of frames
  and Saturday is a busier trading day. Both effects push the same way, so no growth conclusion
  should be drawn.
