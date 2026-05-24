import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

export default class BenchmarkRunService {
  constructor({ runsDir } = {}) {
    this.runsDir = runsDir
      || process.env.BENCHMARK_RUNS_DIR
      || path.join(__dirname, '../../analysis/runs');
  }

  resolveRunId(id) {
    const base = path.basename(String(id));
    if (!base || base.includes('..') || base.startsWith('.')) {
      throw new Error(`Invalid run id: ${id}`);
    }
    const runDir = path.join(this.runsDir, base);
    if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
      throw new Error(`Run not found: ${base}`);
    }
    return { id: base, runDir };
  }

  readJsonSafe(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  summarizeRun(runDir, id) {
    const scorecard = this.readJsonSafe(path.join(runDir, 'scorecard.json'));
    const meta = this.readJsonSafe(path.join(runDir, 'meta.json'));
    const st = fs.statSync(runDir);
    const p = scorecard?.layers?.perception;
    const gb = scorecard?.layers?.reconciler?.GROCERY_BALANCED;
    return {
      id,
      capture_id: scorecard?.capture_id ?? meta?.capture_id ?? id,
      source_file: scorecard?.source_file ?? meta?.source_file ?? null,
      venue_id: scorecard?.venue_id ?? meta?.venue_id ?? null,
      perception_version: scorecard?.perception_version ?? meta?.perception_version ?? null,
      scope: scorecard?.scope ?? meta?.scope ?? null,
      generated_at: scorecard?.generated_at ?? null,
      has_scorecard: !!scorecard,
      has_report: fs.existsSync(path.join(runDir, 'REPORT.md')),
      messages: p?.messages ?? null,
      unique_perception_ids: p?.unique_perception_ids ?? null,
      fragmentation_factor: p?.fragmentation_factor ?? null,
      grocery_balanced_lt_mean: gb?.mean_lifetime_s ?? null,
      grocery_balanced_tp_per_1k: gb?.teleports_per_1k ?? null,
      mtimeMs: st.mtimeMs,
    };
  }

  listRuns() {
    if (!fs.existsSync(this.runsDir)) return [];
    return fs.readdirSync(this.runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => this.summarizeRun(path.join(this.runsDir, d.name), d.name))
      .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
  }

  listArtifacts(runDir) {
    const artifactsDir = path.join(runDir, 'artifacts');
    if (!fs.existsSync(artifactsDir)) return [];
    return fs.readdirSync(artifactsDir)
      .map((name) => {
        const fp = path.join(artifactsDir, name);
        const st = fs.statSync(fp);
        const ext = path.extname(name).toLowerCase();
        return {
          name,
          size: st.size,
          is_image: IMAGE_EXT.has(ext),
          is_json: ext === '.json',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getRun(id, { includeReport = true } = {}) {
    const { id: runId, runDir } = this.resolveRunId(id);
    const scorecard = this.readJsonSafe(path.join(runDir, 'scorecard.json'));
    const meta = this.readJsonSafe(path.join(runDir, 'meta.json'));
    const reportPath = path.join(runDir, 'REPORT.md');

    return {
      id: runId,
      meta,
      scorecard,
      report_md: includeReport && fs.existsSync(reportPath)
        ? fs.readFileSync(reportPath, 'utf8')
        : null,
      artifacts: this.listArtifacts(runDir),
      summary: this.summarizeRun(runDir, runId),
    };
  }

  resolveArtifact(id, filename) {
    const { runDir } = this.resolveRunId(id);
    const base = path.basename(String(filename));
    if (!base || base.includes('..')) throw new Error(`Invalid artifact: ${filename}`);
    const filePath = path.join(runDir, 'artifacts', base);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Artifact not found: ${base}`);
    }
    return filePath;
  }
}
