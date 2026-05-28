/**
 * StoryReplayService — time-synced before/after trajectory replay for Track Stories mode.
 */
import { STORY_PREFIX } from './offline/storyBuilder.js';

const EMIT_INTERVAL_MS = 100;
const SLEEP_SLACK_MS = 5;

function sampleAt(samples, t) {
  if (!samples?.length) return null;
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[samples.length - 1].t) return samples[samples.length - 1];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].t >= t) {
      const a = samples[i - 1];
      const b = samples[i];
      const f = (t - a.t) / Math.max(b.t - a.t, 1);
      return { t, x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    }
  }
  return samples[samples.length - 1];
}

function buildTrackPayload(story, t, venueId) {
  const tracks = [];

  for (const frag of story.rawFragments || []) {
    const s = sampleAt(frag.samples, t);
    if (!s) continue;
    const pid = frag.perceptionIds?.[0] || frag.forwardFragmentId;
    tracks.push({
      id: pid,
      trackKey: `${STORY_PREFIX}raw-${pid}`,
      deviceId: 'story-raw',
      venueId,
      timestamp: t,
      venuePosition: { x: s.x, y: 0, z: s.z },
      objectType: 'person',
      color: '#60a5fa',
      _storyRole: 'raw',
      _storyId: story.id,
      originalPerceptionId: pid,
    });
  }

  const rs = sampleAt(story.reconSamples, t);
  if (rs) {
    tracks.push({
      id: story.stableId,
      stableId: story.stableId,
      trackKey: `${STORY_PREFIX}recon-${story.stableId}`,
      deviceId: 'story-recon',
      venueId,
      timestamp: t,
      venuePosition: { x: rs.x, y: 0, z: rs.z },
      objectType: 'person',
      color: '#34d399',
      _storyRole: 'recon',
      _storyId: story.id,
    });
  }

  return tracks;
}

export default class StoryReplayService {
  constructor({ io } = {}) {
    this.io = io;
    this.state = {
      running: false,
      storyId: null,
      jobId: null,
      speed: 1,
      progress: 0,
      currentTs: 0,
      startedAt: null,
      lastError: null,
    };
    this._abort = null;
    this._playbackToken = 0;
    this._playbackDone = null;
  }

  status() {
    return { ...this.state };
  }

  async stop() {
    this._playbackToken++;
    if (this._abort) this._abort.aborted = true;
    this.state.running = false;
    if (this._playbackDone) {
      await this._playbackDone;
      this._playbackDone = null;
    }
  }

  async start({ story, venueId, speed = 1, startProgress = 0 } = {}) {
    if (!story) throw new Error('story is required');
    if (!this.io) throw new Error('Socket.IO required for story replay');

    await this.stop();

    const token = this._playbackToken;
    const abort = { aborted: false };
    this._abort = abort;

    const tStart = story.tStart;
    const tEnd = story.tEnd;
    const span = Math.max(1, tEnd - tStart);
    const progress = Math.max(0, Math.min(1, Number(startProgress) || 0));
    const playSpeed = Math.max(0.1, Math.min(50, Number(speed) || 1));

    let resolvePlayback;
    this._playbackDone = new Promise((resolve) => { resolvePlayback = resolve; });

    this.state = {
      running: true,
      storyId: story.id,
      stableId: story.stableId,
      jobId: story.jobId || null,
      speed: playSpeed,
      progress,
      currentTs: tStart + span * progress,
      tStart,
      tEnd,
      startedAt: Date.now(),
      lastError: null,
      mergeEvents: story.mergeEvents || [],
    };

    const replayStartWall = Date.now();
    const firstPlayTs = tStart + span * progress;

    try {
      let t = firstPlayTs;
      while (t <= tEnd) {
        if (abort.aborted || token !== this._playbackToken) break;

        const recordedDelta = t - firstPlayTs;
        const targetWall = replayStartWall + recordedDelta / playSpeed;
        const waitMs = targetWall - Date.now();
        if (waitMs > SLEEP_SLACK_MS) {
          await new Promise(r => setTimeout(r, waitMs));
        }

        const tracks = buildTrackPayload(story, t, venueId || 'default');
        this.io.of('/tracking').to(`venue:${venueId || 'default'}`).emit('tracks', {
          venueId: venueId || 'default',
          tracks,
          timestamp: Date.now(),
          storyReplay: true,
          storyId: story.id,
          recordedTs: t,
        });

        this.state.currentTs = t;
        this.state.progress = (t - tStart) / span;

        t += EMIT_INTERVAL_MS;
      }
    } catch (err) {
      this.state.lastError = err.message;
    } finally {
      this.state.running = false;
      this._abort = null;
      resolvePlayback?.();
      if (this._playbackDone) this._playbackDone = null;
    }

    return this.status();
  }
}

export { buildTrackPayload, sampleAt };
