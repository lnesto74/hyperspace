// Child process: build the flow packs of one day from 230_flow_rows.py output, outside the API process
// (3 M rows take ~25 s and ~1 GB; the live MQTT pipeline must not wait on it).
// Usage: node flowPackWorker.js <day> <venueId> <rows.csv.gz> <outDir> <anchor.json>
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';
import path from 'path';
import { aggregatePositions, SLICES } from '../FlowFieldDailyService.js';

const [day, venueId, rowsFile, outDir, anchorPath] = process.argv.slice(2);
const anchor = JSON.parse(fs.readFileSync(anchorPath, 'utf8'));
const rows = [];
const rl = readline.createInterface({ input: fs.createReadStream(rowsFile).pipe(zlib.createGunzip()), crlfDelay: Infinity });
let header = true;
for await (const line of rl) {
  if (header) { header = false; continue; }
  const a = line.split(',');
  if (a.length >= 4) rows.push({ track_key: a[0], timestamp: Number(a[1]), position_x: Number(a[2]), position_z: Number(a[3]) });
}
const packs = aggregatePositions(rows, {
  cell: anchor.cell_m ?? 1.5, tzOffsetH: Number(anchor.tz_offset_h ?? 2),
  openHour: anchor.open_hour ?? 7, closeHour: anchor.close_hour ?? 22, dateStr: day, bbox: anchor.bbox, venueId,
});
fs.mkdirSync(outDir, { recursive: true });
for (const spec of SLICES) {
  const p = packs[spec.id]; if (!p) continue;
  p.meta.source = `raw 10 Hz LiDAR, per-second positions (230_flow_rows.py) · ${day}`;
  p.meta.pack = 'raw10hz';
  const f = path.join(outDir, `field_${spec.id}.json`);
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(p)); fs.renameSync(`${f}.tmp`, f);
}
console.log(`flow packs ${day}: ${rows.length} rows, trading cells ${packs.trading?.cells.length}`);
