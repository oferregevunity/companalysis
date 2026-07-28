import { describe, it, expect, vi } from 'vitest';
import { selectWinnerVideos, analyzeWinnerVideos, type WinnerVideoInput } from './videoPipeline';

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

// A generate that returns a valid analysis JSON (creativeId is attached downstream).
const okGenerate = vi.fn(async () => JSON.stringify({
  hookType: 'Gameplay Showcase',
  motivations: ['Action'],
  hookMechanic: 'hook',
  segments: [],
  cta: 'Play',
  predictedHookStrength: 4,
  predictedHoldStrength: 3,
  iterationIdeas: ['idea'],
  themes: ['theme'],
}));

const stubFetch = () => vi.fn(async () => ({ base64: 'AAA=', mimeType: 'video/mp4', byteLength: 3 }));

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
  it('fetches and analyzes each selected video, preserving rank order', async () => {
    const fetchVideo = stubFetch();
    const res = await analyzeWinnerVideos(
      [winner({ creativeId: 'a__1', rank: 1 }), winner({ creativeId: 'a__2', rank: 2 })],
      { week: 'w', fetchVideo, generate: okGenerate },
    );
    expect(res.attempted).toBe(2);
    expect(res.failed).toBe(0);
    expect(res.analyses.map(a => a.creativeId)).toEqual(['a__1', 'a__2']);
    expect(fetchVideo).toHaveBeenCalledTimes(2);
  });

  it('skips non-video winners entirely', async () => {
    const fetchVideo = stubFetch();
    const res = await analyzeWinnerVideos([winner({ format: 'image' })], { week: 'w', fetchVideo, generate: okGenerate });
    expect(res.attempted).toBe(0);
    expect(fetchVideo).not.toHaveBeenCalled();
  });

  it('counts an unparseable model response as failed', async () => {
    const fetchVideo = stubFetch();
    const badGenerate = vi.fn(async () => 'not json');
    const res = await analyzeWinnerVideos([winner({ creativeId: 'a__1' })], { week: 'w', fetchVideo, generate: badGenerate });
    expect(res.attempted).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.analyses).toHaveLength(0);
  });

  it('treats a download error as non-fatal', async () => {
    const fetchVideo = vi.fn(async () => { throw new Error('fetch failed'); });
    const res = await analyzeWinnerVideos([winner({ creativeId: 'a__1' })], { week: 'w', fetchVideo, generate: okGenerate });
    expect(res.failed).toBe(1);
    expect(res.analyses).toHaveLength(0);
  });

  it('marks the focus game so the prompt can flag it', async () => {
    const fetchVideo = stubFetch();
    const seen: string[] = [];
    const generate = vi.fn(async (prompt: string) => {
      seen.push(prompt.includes('FOCUS game') ? 'focus' : 'comp');
      return JSON.stringify({ hookType: 'Other' });
    });
    await analyzeWinnerVideos(
      [winner({ creativeId: 'f', appId: 'focus', rank: 1 }), winner({ creativeId: 'c', appId: 'comp', rank: 2 })],
      { week: 'w', focusAppId: 'focus', concurrency: 1, fetchVideo, generate },
    );
    expect(seen).toEqual(['focus', 'comp']);
  });
});
