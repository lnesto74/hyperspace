/**
 * Fast index for .reconciled.jsonl artifacts — avoids a full-file read to learn batch count.
 * A 65 GB grocery capture has ~43k batch lines; scanning it before playback looked like a hang.
 */
import fs from 'fs';

export const OFFLINE_BATCH_MS = 250;
const HEAD_READ_BYTES = 65536;
const TAIL_READ_BYTES = 8192;

export function readFirstJsonLine(fullPath) {
  const fd = fs.openSync(fullPath, 'r');
  try {
    const buf = Buffer.alloc(HEAD_READ_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    if (n <= 0) return null;
    const head = buf.subarray(0, n);
    const nl = head.indexOf(0x0A); // search for '\n' within the bytes actually read
    if (nl < 0) return head.toString('utf8').trim() || null; // single line, no trailing newline
    if (nl === 0) return null;
    return head.subarray(0, nl).toString('utf8').trim();
  } finally {
    fs.closeSync(fd);
  }
}

export function parseReconciledMetaLine(raw) {
  if (!raw) return null;
  try {
    const row = JSON.parse(raw);
    return row._type === 'meta' ? row : null;
  } catch {
    return null;
  }
}

export function readReconciledMeta(fullPath) {
  return parseReconciledMetaLine(readFirstJsonLine(fullPath));
}

export function readFooterBatchCount(fullPath) {
  const stat = fs.statSync(fullPath);
  if (stat.size === 0) return null;
  const readSize = Math.min(TAIL_READ_BYTES, stat.size);
  const fd = fs.openSync(fullPath, 'r');
  try {
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      try {
        const row = JSON.parse(raw);
        if (row._type === 'meta_footer' && row.batchCount != null) {
          const n = Number(row.batchCount);
          return Number.isFinite(n) && n > 0 ? n : null;
        }
      } catch { /* try previous line */ }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

export function estimateBatchCountFromMeta(meta) {
  if (!meta) return null;
  const direct = Number(meta.batchCount);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const firstTs = meta.firstTs;
  const lastTs = meta.lastTs;
  if (firstTs == null || lastTs == null || lastTs < firstTs) return null;
  return Math.floor((lastTs - firstTs) / OFFLINE_BATCH_MS) + 1;
}

/**
 * Resolve batch count: job DB hint → footer tail read → span estimate → (optional) full scan.
 */
export async function resolveReconciledBatchCount(fullPath, { hint, allowFullScan = false } = {}) {
  const hinted = Number(hint);
  if (Number.isFinite(hinted) && hinted > 0) {
    return { totalBatches: hinted, source: 'hint' };
  }

  const footer = readFooterBatchCount(fullPath);
  if (footer) return { totalBatches: footer, source: 'footer' };

  const meta = readReconciledMeta(fullPath);
  const estimated = estimateBatchCountFromMeta(meta);
  if (estimated) return { totalBatches: estimated, source: 'estimate', meta };

  if (!allowFullScan) return { totalBatches: null, source: 'unknown', meta };

  let totalBatches = 0;
  const { createInterface } = await import('readline');
  const rl = createInterface({
    input: fs.createReadStream(fullPath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const raw = line.trim();
    if (!raw) continue;
    try {
      const row = JSON.parse(raw);
      if (row._type === 'batch' && row.tracks?.length) totalBatches++;
    } catch { /* ignore */ }
  }
  return { totalBatches: totalBatches || null, source: 'full_scan', meta };
}
