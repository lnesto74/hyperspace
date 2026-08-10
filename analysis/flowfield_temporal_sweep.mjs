// Temporal sweep of the production-derived flow field inputs.
// Reads the already-exported field_prod.json meta + optionally probes
// a compact hour×dow occupancy summary if present; otherwise prints
// what we can infer and the slice recipe for the filter work.
//
// For a full hour×dow matrix we need the track store (or a prebuilt
// summary). This script builds that summary from a CSV.gz if provided:
//
//   node analysis/flowfield_temporal_sweep.mjs [--csv data/prod/tp.csv.gz]
//
// Without CSV it characterises the shipped field and writes the filter
// plan from layout + field meta alone.
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import { createReadStream } from 'fs';

function parseArgs(argv) {
  const o = { csv: null, out: 'analysis/out/flowfield_temporal_sweep.json' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--csv') o.csv = argv[++i];
    else if (argv[i] === '--out') o.out = argv[++i];
  }
  return o;
}

const args = parseArgs(process.argv);
const field = JSON.parse(fs.readFileSync('prototypes/flowfield/field_prod.json', 'utf8'));
const layout = JSON.parse(fs.readFileSync('prototypes/flowfield/layout_prod.json', 'utf8'));

const TZ_OFFSET_H = 2; // Europe/Rome summer (CEST) — matches extractor
const openH = field.meta.window_local_hours?.[0] ?? 7;
const closeH = field.meta.window_local_hours?.[1] ?? 22;

const summary = {
  field: {
    cells: field.meta.cells_emitted,
    spanHours: field.meta.span_hours,
    spanDays: +(field.meta.span_hours / 24).toFixed(1),
    steps: field.meta.steps_total,
    positions: field.meta.rows_in_hours,
    hours: [openH, closeH],
    venue: layout.venue?.name,
  },
  note: 'Field JSON is already collapsed across time — filters need per-slice aggregation.',
};

if (!args.csv || !fs.existsSync(args.csv)) {
  // Lightweight behavioural signatures from the collapsed field itself.
  const cells = field.cells;
  const byFoot = [...cells].sort((a, b) => b.t - a.t);
  const byDwell = [...cells].sort((a, b) => b.d - a.d);
  const byPurity = [...cells].filter((c) => c.k >= 5).sort((a, b) => b.p - a.p);
  const byMix = [...cells].filter((c) => c.k >= 5).sort((a, b) => a.p - b.p); // low purity = two-way

  const totalT = cells.reduce((s, c) => s + c.t, 0);
  const top10 = byFoot.slice(0, Math.floor(cells.length * 0.1));
  const corridor = cells.filter((c) => c.k >= 20 && c.d < byDwell[Math.floor(cells.length * 0.3)].d);
  const dwellHot = cells.filter((c) => c.d >= byDwell[Math.floor(cells.length * 0.05)].d);

  summary.collapsedSignatures = {
    top10FootfallSharePct: +((100 * top10.reduce((s, c) => s + c.t, 0)) / totalT).toFixed(1),
    medianPurityBusy: +percentile(cells.filter((c) => c.k >= 10).map((c) => c.p), 0.5).toFixed(3),
    highPurityCorridorCells: byPurity.filter((c) => c.p >= 0.55).length,
    twoWayAisleCells: byMix.filter((c) => c.p <= 0.25).length,
    corridorCells: corridor.length,
    dwellHotspotCells: dwellHot.length,
    suggestedClusters: [
      {
        id: 'through_route',
        label: 'Through-route / aisle flow',
        rule: 'high steps, low dwell, any purity',
        n: corridor.length,
      },
      {
        id: 'dwell_node',
        label: 'Dwell / engagement node',
        rule: 'top 5% dwell',
        n: dwellHot.length,
      },
      {
        id: 'one_way_spine',
        label: 'Directional spine',
        rule: 'purity ≥ 0.55 and steps ≥ 5',
        n: byPurity.filter((c) => c.p >= 0.55).length,
      },
      {
        id: 'two_way_aisle',
        label: 'Two-way milling aisle',
        rule: 'purity ≤ 0.25 and steps ≥ 5',
        n: byMix.filter((c) => c.p <= 0.25).length,
      },
    ],
  };
  summary.filterPlan = {
    quickPresets: [
      { id: 'morning', label: 'Morning', hours: [7, 11] },
      { id: 'midday', label: 'Midday', hours: [11, 15] },
      { id: 'afternoon', label: 'Afternoon', hours: [15, 19] },
      { id: 'evening', label: 'Evening', hours: [19, 22] },
      { id: 'weekday', label: 'Weekday', dows: [1, 2, 3, 4, 5] },
      { id: 'weekend', label: 'Weekend', dows: [0, 6] },
    ],
    needs: 'Re-aggregate track_positions with hour/dow masks into field slices (or an API).',
  };

  fs.mkdirSync('analysis/out', { recursive: true });
  fs.writeFileSync(args.out, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\n(no --csv provided; collapsed-field signatures only → ${args.out})`);
  process.exit(0);
}

// ---- full temporal matrix from CSV.gz: track_key,timestamp,x,z
const hourDow = Array.from({ length: 7 }, () => new Float64Array(24)); // counts
const hourCells = Array.from({ length: 24 }, () => new Set());
const dowCells = Array.from({ length: 7 }, () => new Set());
const hourMsg = new Float64Array(24);
const dowMsg = new Float64Array(7);
let n = 0, kept = 0;

const input = args.csv.endsWith('.gz')
  ? createReadStream(args.csv).pipe(zlib.createGunzip())
  : createReadStream(args.csv);
const rl = readline.createInterface({ input, crlfDelay: Infinity });
let header = true;
for await (const line of rl) {
  if (header) { header = false; continue; }
  const parts = line.split(',');
  if (parts.length < 4) continue;
  const ts = Number(parts[1]);
  if (!Number.isFinite(ts)) continue;
  n++;
  const local = new Date(ts + TZ_OFFSET_H * 3600_000);
  const h = local.getUTCHours();
  const dow = local.getUTCDay(); // 0=Sun
  if (h < openH || h >= closeH) continue;
  kept++;
  hourMsg[h]++; dowMsg[dow]++;
  hourDow[dow][h]++;
  // coarse 3 m cell for coverage breadth (not the 1.5 m field)
  const cx = Math.floor(Number(parts[2]) / 3);
  const cz = Math.floor(Number(parts[3]) / 3);
  const key = cx + ',' + cz;
  hourCells[h].add(key);
  dowCells[dow].add(key);
}

const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
summary.temporal = {
  rowsTotal: n,
  rowsInHours: kept,
  byHour: [...hourMsg].map((c, h) => ({
    hour: h,
    msgs: c,
    cells3m: hourCells[h].size,
    pct: kept ? +((100 * c) / kept).toFixed(1) : 0,
  })).filter((r) => r.hour >= openH && r.hour < closeH),
  byDow: [...dowMsg].map((c, d) => ({
    dow: d,
    name: dowNames[d],
    msgs: c,
    cells3m: dowCells[d].size,
    pct: kept ? +((100 * c) / kept).toFixed(1) : 0,
  })),
  peakHour: argmax(hourMsg),
  peakDow: argmax(dowMsg),
  quietHour: argminInRange(hourMsg, openH, closeH),
};

// Simple "regime" suggestion: hours whose message share is ≥ 1.2× uniform,
// and weekend vs weekday intensity ratio.
const tradingHours = closeH - openH;
const uniform = 100 / tradingHours;
const busyHours = summary.temporal.byHour.filter((r) => r.pct >= uniform * 1.25).map((r) => r.hour);
const quietHours = summary.temporal.byHour.filter((r) => r.pct <= uniform * 0.75).map((r) => r.hour);
const weekday = [1, 2, 3, 4, 5].reduce((s, d) => s + dowMsg[d], 0);
const weekend = dowMsg[0] + dowMsg[6];
summary.regimes = {
  busyHours,
  quietHours,
  weekendVsWeekdayIntensity: weekday > 0 ? +((weekend / 2) / (weekday / 5)).toFixed(2) : null,
  interpretation:
    'weekendVsWeekdayIntensity > 1 ⇒ average weekend day busier than average weekday; '
    + '< 1 ⇒ weekdays dominate.',
};

fs.mkdirSync('analysis/out', { recursive: true });
fs.writeFileSync(args.out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`wrote ${args.out}`);

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
function argmax(a) { let m = -Infinity, i = 0; for (let k = 0; k < a.length; k++) if (a[k] > m) { m = a[k]; i = k; } return i; }
function argminInRange(a, lo, hi) {
  let m = Infinity, i = lo;
  for (let k = lo; k < hi; k++) if (a[k] < m) { m = a[k]; i = k; }
  return i;
}
