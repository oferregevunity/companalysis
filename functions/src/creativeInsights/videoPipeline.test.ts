import { describe, it, expect, vi } from 'vitest';
import { selectWinnerVideos, analyzeWinnerVideos, type WinnerVideoInput } from './videoPipeline';
import type { StagingBucket } from './videoStaging';

function winner(over: Partial<WinnerVideoInput>): WinnerVideoInput {
  return {
    creativeId: 'a__1',
    appId: 'a',
    appName: 'App',
    rank: 1,
    format: 'video',
    mediaUrl: 'https://cdn/1.mp4',
    videoDurationSec: 15,
    ...over,
  };
}

const noopBucket = { name: 'b' } as unknown as StagingBucket;

// A generate that echoes a valid analysis JSON, tagging by creativeId via hookMechanic.
const okGenerate = vi.fn(async (_prompt: string, gsUri: string) => JSON.stringify({
  hookType: 'Gameplay Showcase',
  motivations: ['Action'],
  hookMechanic: `hook for ${gsUri}`,
  segments: [],
  cta: 'Play',
  predictedHookStrength: 4,
  predictedHoldStrength: 3,
  iterationIdeas: ['idea'],
  themes: ['theme'],
}));

function stubStage() {
  return vi.fn(async (mediaUrl: string, creativeId: string) => ({
    gsUri: `gs://b/${creativeId}.mp4`,
    mimeType: 'video/mp4',
    objectPath: `tmp/${creativeId}.mp4`,
  }));
}

describe('selectWinnerVideos', () => {
  it('keeps only videos with media, ordered by rank, capped', () => {
    const winners = [
      winner({ creativeId: 'v3', rank: 3 }),
      winner({ creativeId: 'img', rank: 1, format: 'image' }),
      winner({ creativeId: 'v2', rank: 2 }),
      winner({ creativeId: 'nourl', rank: 0, mediaUrl: null }),
    ];
    const out = selectWinnerVideos(winners, 2);
    expect(out.map(w => w.creativeId)).toEqual(['v2', 'v3']); // img + nourl dropped, rank-sorted, capped to 2
  });
});

describe('analyzeWinnerVideos', () => {
  it('stages, analyzes, and cleans up each selected video', async () => {
    const stage = stubStage();
    const unstage = vi.fn(async () => {});
    const res = await analyzeWinnerVideos(
      [winner({ creativeId: 'a__1', rank: 1 }), winner({ creativeId: 'a__2', rank: 2 })],
      { bucket: noopBucket, week: 'w', stage, unstage, generate: okGenerate },
    );
    expect(res.attempted).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.analyses.map(a => a.creativeId)).toEqual(['a__1', 'a__2']);
    expect(stage).toHaveBeenCalledTimes(2);
    expect(unstage).toHaveBeenCalledTimes(2); // cleanup always
  });

  it('skips non-video winners entirely', async () => {
    const stage = stubStage();
    const res = await analyzeWinnerVideos([winner({ format: 'image' })], { bucket: noopBucket, week: 'w', stage, unstage: vi.fn(async () => {}), generate: okGenerate });
    expect(res.attempted).toBe(0);
    expect(stage).not.toHaveBeenCalled();
  });

  it('counts an unparseable model response as failed but still cleans up', async () => {
    const stage = stubStage();
    const unstage = vi.fn(async () => {});
    const badGenerate = vi.fn(async () => 'not json');
    const res = await analyzeWinnerVideos([winner({ creativeId: 'a__1' })], { bucket: noopBucket, week: 'w', stage, unstage, generate: badGenerate });
    expect(res.attempted).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.analyses).toHaveLength(0);
    expect(unstage).toHaveBeenCalledTimes(1);
  });

  it('treats a staging error as non-fatal', async () => {
    const stage = vi.fn(async () => { throw new Error('fetch failed'); });
    const unstage = vi.fn(async () => {});
    const res = await analyzeWinnerVideos([winner({ creativeId: 'a__1' })], { bucket: noopBucket, week: 'w', stage, unstage, generate: okGenerate });
    expect(res.failed).toBe(1);
    expect(res.analyses).toHaveLength(0);
    expect(unstage).not.toHaveBeenCalled(); // nothing staged to clean
  });

  it('marks the focus game so the prompt can flag it', async () => {
    const stage = stubStage();
    const seen: string[] = [];
    const generate = vi.fn(async (prompt: string) => {
      seen.push(prompt.includes('FOCUS game') ? 'focus' : 'comp');
      return JSON.stringify({ hookType: 'Other' });
    });
    await analyzeWinnerVideos(
      [winner({ creativeId: 'f', appId: 'focus', rank: 1 }), winner({ creativeId: 'c', appId: 'comp', rank: 2 })],
      { bucket: noopBucket, week: 'w', focusAppId: 'focus', concurrency: 1, stage, unstage: vi.fn(async () => {}), generate },
    );
    expect(seen).toEqual(['focus', 'comp']);
  });
});
