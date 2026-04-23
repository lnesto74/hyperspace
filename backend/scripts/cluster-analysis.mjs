#!/usr/bin/env node
// Find dense clusters in the kept fixtures along the Y axis.

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'database', 'hyperspace.db'), { readonly: true });
const imp = db.prepare('SELECT * FROM dwg_imports WHERE id = ?').get(process.argv[2] || '123f665a-511e-4fa0-bd79-9ac91067b705');
const raw = JSON.parse(imp.raw_json || '{}');
const fixtures = raw.fixtures || [];
const u = imp.unit_scale_to_m;

// Histogram of Y centroids in 50m bins
const ys = fixtures.map(f => (f.pose2d?.y ?? 0) * u);
const xs = fixtures.map(f => (f.pose2d?.x ?? 0) * u);
const minY = Math.min(...ys), maxY = Math.max(...ys);
const minX = Math.min(...xs), maxX = Math.max(...xs);

console.log(`Total fixtures: ${fixtures.length}`);
console.log(`Y range: ${minY.toFixed(1)} → ${maxY.toFixed(1)} m (${(maxY-minY).toFixed(1)} m span)`);
console.log(`X range: ${minX.toFixed(1)} → ${maxX.toFixed(1)} m (${(maxX-minX).toFixed(1)} m span)\n`);

// Y histogram with 25m bins
const binSize = 25;
const bins = new Map();
for (const y of ys) {
  const bin = Math.floor(y / binSize) * binSize;
  bins.set(bin, (bins.get(bin) || 0) + 1);
}
const sortedBins = [...bins.entries()].sort((a,b) => a[0] - b[0]);

console.log('Y histogram (25m bins, only bins with ≥10 fixtures):');
for (const [bin, count] of sortedBins) {
  if (count >= 10) {
    const bar = '█'.repeat(Math.min(60, Math.ceil(count / 30)));
    console.log(`  Y ${bin.toFixed(0).padStart(7)} → ${(bin+binSize).toFixed(0).padStart(7)}: ${count.toString().padStart(5)} ${bar}`);
  }
}

// Detect "main cluster" by finding the densest region using sliding window of 100m
const sortedYs = ys.slice().sort((a,b) => a-b);
const windowM = 100; // typical store dimension
let bestStart = 0, bestCount = 0;
for (let i = 0; i < sortedYs.length; i++) {
  const start = sortedYs[i];
  const end = start + windowM;
  let count = 0;
  for (let j = i; j < sortedYs.length && sortedYs[j] <= end; j++) count++;
  if (count > bestCount) { bestCount = count; bestStart = start; }
}
console.log(`\nDensest 100m Y-window: [${bestStart.toFixed(1)}, ${(bestStart + windowM).toFixed(1)}] contains ${bestCount}/${ys.length} fixtures (${(100*bestCount/ys.length).toFixed(1)}%)`);

db.close();
