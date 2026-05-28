/**
 * Build Track Stories — curated before/after trajectories for reconciled replay demos.
 */
import fs from 'fs';
import path from 'path';

const STORY_PREFIX = 'story-';

export function storiesPathForArtifact(artifactPath) {
  if (!artifactPath) return null;
  return String(artifactPath).replace(/\.reconciled\.jsonl$/i, '.stories.json');
}

function downsample(samples, maxPoints = 400) {
  if (!samples?.length) return [];
  if (samples.length <= maxPoints) {
    return samples.map(s => ({ t: s.t, x: s.x, z: s.z }));
  }
  const step = samples.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) {
    const s = samples[Math.min(samples.length - 1, Math.floor(i * step))];
    out.push({ t: s.t, x: s.x, z: s.z });
  }
  const last = samples[samples.length - 1];
  if (out[out.length - 1]?.t !== last.t) out.push({ t: last.t, x: last.x, z: last.z });
  return out;
}

function pathLengthM(samples) {
  let d = 0;
  for (let i = 1; i < samples.length; i++) {
    d += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
  }
  return d;
}

function lifetimeS(samples) {
  if (!samples?.length) return 0;
  return Math.max(0, (samples[samples.length - 1].t - samples[0].t) / 1000);
}

function uniquePerceptionIds(samples) {
  const set = new Set();
  for (const s of samples || []) {
    if (s.perceptionId) set.add(String(s.perceptionId));
  }
  return [...set];
}

export function buildStoriesDocument({
  forwardFragments,
  mergedTracks,
  mergeGroups,
  mergeEvents,
  meta = {},
  maxStories = 5,
}) {
  const candidates = [];

  for (const [root, memberIds] of mergeGroups) {
    const merged = mergedTracks.get(root);
    if (!merged?.samples?.length) continue;

    const rawFragments = memberIds.map((fid) => {
      const frag = forwardFragments.get(fid);
      if (!frag) return null;
      const perceptionIds = uniquePerceptionIds(frag.samples);
      return {
        forwardFragmentId: fid,
        perceptionIds,
        tStart: frag.firstTs,
        tEnd: frag.lastTs,
        lifetimeS: lifetimeS(frag.samples),
        pathM: pathLengthM(frag.samples),
        samples: downsample(frag.samples, 250),
      };
    }).filter(Boolean);

    const allPerceptionIds = new Set();
    for (const rf of rawFragments) {
      for (const pid of rf.perceptionIds) allPerceptionIds.add(pid);
    }

    const reconSamples = merged.samples;
    const storyMergeEvents = (mergeEvents || []).filter(
      e => memberIds.includes(e.fromFragmentId) || memberIds.includes(e.toFragmentId),
    );

    const rawLifetime = rawFragments.reduce((s, f) => s + f.lifetimeS, 0);
    const rawPath = rawFragments.reduce((s, f) => s + f.pathM, 0);

    candidates.push({
      stableId: root,
      label: `${memberIds.length} fragments → 1 track`,
      kind: memberIds.length >= 2 ? 'hero_merge' : 'long_path',
      score: memberIds.length * 1000 + pathLengthM(reconSamples) + lifetimeS(reconSamples) * 2,
      tStart: reconSamples[0].t,
      tEnd: reconSamples[reconSamples.length - 1].t,
      rawFragmentCount: memberIds.length,
      rawPerceptionIdCount: allPerceptionIds.size,
      rawFragments,
      reconSamples: downsample(reconSamples, 400),
      mergeEvents: storyMergeEvents,
      kpis: {
        rawPerceptionIds: allPerceptionIds.size,
        rawMeanLifetimeS: rawFragments.length ? rawLifetime / rawFragments.length : 0,
        rawTotalPathM: rawPath,
        reconLifetimeS: lifetimeS(reconSamples),
        reconPathM: pathLengthM(reconSamples),
        reconShopperGrade: pathLengthM(reconSamples) >= 30,
      },
      anchor: reconSamples.length
        ? { x: reconSamples[0].x, z: reconSamples[0].z }
        : null,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const picks = [];
  const hero = candidates.find(c => c.rawFragmentCount >= 2);
  if (hero) picks.push(hero);
  const longPath = candidates.find(c => c.kpis.reconPathM >= 30 && c !== hero);
  if (longPath) picks.push(longPath);
  for (const c of candidates) {
    if (picks.length >= maxStories) break;
    if (!picks.includes(c)) picks.push(c);
  }

  const stories = picks.slice(0, maxStories).map((s, i) => ({
    id: `story-${i + 1}`,
    rank: i + 1,
    stableId: s.stableId,
    label: s.label,
    kind: s.kind,
    tStart: s.tStart,
    tEnd: s.tEnd,
    rawFragmentCount: s.rawFragmentCount,
    rawPerceptionIdCount: s.rawPerceptionIdCount,
    rawFragments: s.rawFragments,
    reconSamples: s.reconSamples,
    mergeEvents: s.mergeEvents,
    kpis: s.kpis,
    anchor: s.anchor,
  }));

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_count: stories.length,
    trackKeyPrefix: STORY_PREFIX,
    ...meta,
    stories,
  };
}

export function readStoriesFile(storiesPath) {
  if (!storiesPath) return null;
  try {
    if (!fs.existsSync(storiesPath)) return null;
    return JSON.parse(fs.readFileSync(storiesPath, 'utf8'));
  } catch {
    return null;
  }
}

export async function writeStoriesFile(storiesPath, doc) {
  fs.mkdirSync(path.dirname(storiesPath), { recursive: true });
  fs.writeFileSync(storiesPath, `${JSON.stringify(doc, null, 2)}\n`);
}

export { STORY_PREFIX, downsample, pathLengthM, lifetimeS };
