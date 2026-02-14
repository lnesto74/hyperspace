# PEBLE™ Glossary

## Post-Exposure Behavioral Lift Engine

**PEBLE™** (Post-Exposure Behavioral Lift Engine) is a measurement framework that quantifies how DOOH (Digital Out-of-Home) advertising exposure impacts shopper behavior at the shelf level. It uses matched control methodology to compare exposed shoppers against similar non-exposed shoppers to isolate the incremental effect of advertising.

---

## Primary KPIs

### EAL™ — Exposure-to-Action Lift

| Property | Value |
|----------|-------|
| **Full Name** | Exposure-to-Action Lift |
| **Range** | -100% to +∞ (typically -50% to +100%) |
| **Good Value** | > 0% (positive lift) |

**Definition:**  
Measures the relative increase in conversion rate between exposed shoppers and matched controls.

**Formula:**  
```
EAL = (pExposed - pControl) / pControl × 100%
```

**Interpretation:**
- **EAL = +23%** → Exposed shoppers were 23% more likely to visit the target than non-exposed shoppers
- **EAL = 0%** → No measurable difference (ad had no effect)
- **EAL = -15%** → Exposed shoppers were 15% less likely (possible negative association)

**Why It Matters:**  
This is the core metric proving ad effectiveness. A positive EAL demonstrates that the DOOH exposure caused incremental visits to the target shelf, category, or brand.

---

### TTA™ — Time-to-Action

| Property | Value |
|----------|-------|
| **Full Name** | Time-to-Action |
| **Unit** | Seconds |
| **Good Value** | Lower is better |

**Definition:**  
Average time from DOOH exposure end to first engagement with the target shelf/category.

**Formula:**  
```
TTA = (timestamp of shelf engagement) - (timestamp of exposure end)
```

**Interpretation:**
- **TTA = 48s** → On average, exposed shoppers reached the target 48 seconds after seeing the ad
- Lower TTA indicates more immediate response to the advertisement
- Compared against control group's TTA to measure acceleration

**Why It Matters:**  
Shows how quickly the ad influences behavior. A lower TTA suggests strong ad recall and urgency.

---

### DCI™ — Direction Change Index

| Property | Value |
|----------|-------|
| **Full Name** | Direction Change Index |
| **Range** | -1.0 to +1.0 |
| **Good Value** | > 0 (positive direction change) |

**Definition:**  
Measures whether shoppers changed their trajectory toward the target location after exposure.

**Formula:**  
```
DCI = cos(θ_after) - cos(θ_before)

Where:
- θ_before = angle between shopper heading and target (before exposure)
- θ_after = angle between shopper heading and target (after exposure)
```

**Interpretation:**
- **DCI = +0.3** → Shopper redirected toward the target after seeing the ad
- **DCI = 0** → No change in direction
- **DCI = -0.2** → Shopper turned away from the target

**Why It Matters:**  
Proves the ad caused intentional redirection rather than coincidental paths. A positive DCI delta (exposed vs control) demonstrates the ad influenced shopper movement.

---

### CES™ — Campaign Effectiveness Score

| Property | Value |
|----------|-------|
| **Full Name** | Campaign Effectiveness Score |
| **Range** | 0 to 100 |
| **Good Value** | > 50 (effective campaign) |

**Definition:**  
Overall campaign effectiveness score combining lift, time-to-action acceleration, engagement quality, and statistical confidence.

**Formula:**  
```
CES = 100 × confidence × (0.55 × lift_score + 0.25 × tta_score + 0.20 × engagement_score)

Where:
- lift_score = normalized EAL (0-1)
- tta_score = normalized TTA acceleration (0-1)
- engagement_score = normalized engagement lift (0-1)
- confidence = statistical confidence (0-1)
```

**Interpretation:**
- **CES > 70** → Highly effective campaign
- **CES 50-70** → Moderately effective
- **CES 30-50** → Low effectiveness
- **CES < 30** → Poor performance or insufficient data

**Why It Matters:**  
Single score that summarizes overall campaign performance, useful for comparing campaigns or A/B tests.

---

## Secondary KPIs

### AQS™ — Attention Quality Score

| Property | Value |
|----------|-------|
| **Full Name** | Attention Quality Score |
| **Range** | 0 to 100 |
| **Good Value** | > 60 |

**Definition:**  
Measures the quality of attention during DOOH exposure based on multiple behavioral signals.

**Components:**
- **Dwell Score** (30%) — Time spent in screen exposure zone
- **Proximity Score** (25%) — Distance to screen
- **Orientation Score** (25%) — Facing angle toward screen
- **Slowdown Score** (10%) — Speed reduction indicating attention
- **Stability Score** (10%) — Consistent viewing vs. passing glance

**Interpretation:**
- **AQS > 80** → Premium exposure (long dwell, close, facing screen)
- **AQS 60-80** → Quality exposure
- **AQS 40-60** → Standard exposure
- **AQS < 40** → Low quality (quick pass, far away, not facing)

**Why It Matters:**  
Filters high-quality exposures for attribution analysis. Only exposures above threshold (typically AQS ≥ 50) are counted.

---

### AAR™ — Attention-to-Action Rate

| Property | Value |
|----------|-------|
| **Full Name** | Attention-to-Action Rate |
| **Range** | 0% to 100% |
| **Good Value** | > 15% |

**Definition:**  
Percentage of high-quality exposures that resulted in target engagement.

**Formula:**  
```
AAR = (Converted Exposures with AQS ≥ threshold) / (Total Exposures with AQS ≥ threshold) × 100%
```

**Interpretation:**
- **AAR = 25%** → 25% of quality exposures led to shelf visits
- Higher AAR indicates better conversion efficiency
- Compare against baseline AAR to measure improvement

**Why It Matters:**  
Measures how well attention translates to action. A high AAR with high AQS indicates both strong attention capture and effective messaging.

---

### SEQ™ — Shelf Engagement Quality Lift

| Property | Value |
|----------|-------|
| **Full Name** | Shelf Engagement Quality Lift |
| **Unit** | Seconds |
| **Good Value** | > 0 (positive lift) |

**Definition:**  
Additional dwell time that exposed shoppers spent at the target shelf compared to control group.

**Formula:**  
```
SEQ = (Mean Engagement Dwell for Exposed) - (Mean Engagement Dwell for Controls)
```

**Interpretation:**
- **SEQ = +4.3s** → Exposed shoppers spent 4.3 seconds longer at the shelf
- Positive SEQ indicates deeper engagement, not just visits
- Correlates with purchase consideration

**Why It Matters:**  
Shows the ad increased engagement depth, not just traffic. Longer dwell time at shelf correlates with higher purchase probability.

---

## Supporting Metrics

### pExposed — Exposed Conversion Rate

**Definition:** Percentage of exposed shoppers who visited the target shelf/category within the action window.

```
pExposed = (Exposed shoppers who converted) / (Total exposed shoppers) × 100%
```

---

### pControl — Control Conversion Rate

**Definition:** Percentage of matched control shoppers who visited the target shelf/category within the same time window.

```
pControl = (Control shoppers who converted) / (Total control shoppers) × 100%
```

---

### TTA Acceleration

**Definition:** Ratio of control TTA to exposed TTA, measuring how much faster exposed shoppers reached the target.

```
TTA Acceleration = TTA_Control / TTA_Exposed
```

**Interpretation:**
- **1.25x** → Exposed shoppers reached target 25% faster
- **1.0x** → No difference
- **0.8x** → Exposed shoppers were slower (unusual)

---

### Confidence

| Property | Value |
|----------|-------|
| **Range** | 0% to 100% |
| **Good Value** | > 70% |

**Definition:** Statistical reliability of the attribution results based on control match quality and sample size.

**Components:**
- Number of matched controls found
- Quality of control matches (similarity scores)
- Sample size of exposed shoppers

**Interpretation:**
- **> 80%** → Highly reliable results
- **50-80%** → Reasonably reliable
- **< 50%** → Results should be interpreted with caution

---

## Control Matching Methodology

### How Controls Are Matched

For each exposed shopper, PEBLE finds similar shoppers who:

1. **Same Time Bucket** — Within ±15 minutes of exposure
2. **Near Corridor** — Passed within 1.5m of screen's exposure zone boundary
3. **NOT in SEZ** — Never entered the Screen Exposure Zone (not exposed)
4. **Similar Heading** — Walking in similar direction (±45°)
5. **Similar Speed** — Similar walking speed (±20%)

### Minimum Requirements

- **M = 5** — Target number of controls per exposed shopper
- **Min = 3** — Minimum controls required for valid attribution
- Fewer controls → Lower confidence score

---

## Glossary of Terms

| Term | Definition |
|------|------------|
| **DOOH** | Digital Out-of-Home advertising (digital screens in retail/public spaces) |
| **SEZ** | Screen Exposure Zone — The polygonal area where shoppers are considered "exposed" to a screen |
| **AZ** | Attention Zone — Inner zone with higher attention quality |
| **Exposure Event** | A single instance of a shopper entering the SEZ with sufficient dwell time |
| **Action Window** | Time period after exposure during which target visits are attributed (default: 10 minutes) |
| **Target** | The shelf, category, brand, or SKU being measured for attribution |
| **Conversion** | When an exposed shopper visits/engages with the target |
| **Matched Control** | A similar shopper who didn't see the ad, used for comparison |
| **Lift** | The incremental effect of exposure (difference between exposed and control) |

---

## Example Analysis Output

```
Campaign: Beverage Promo
Target: Category = Beverages
Screens: 1
Time Range: 24 hours

Results:
├── Exposure Events: 5,943
├── Conversions: 1,142 (19.2%)
├── Control Matches: 4,919
│
├── EAL™: +23.0%
├── TTA™: 48.4s (1.25x faster than control)
├── DCI™: +0.025 (vs -0.006 control)
├── CES™: 42.6
│
├── AQS™: 57.0 (mean)
├── AAR™: 11.2%
├── SEQ™: +4.3s
│
└── Confidence: 68.5%
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-12 | Initial PEBLE™ implementation |

---

*PEBLE™, EAL™, TTA™, DCI™, CES™, AQS™, AAR™, and SEQ™ are trademarks of Hyperspace Analytics.*
