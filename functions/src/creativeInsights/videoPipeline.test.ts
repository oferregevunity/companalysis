import { describe, it, expect, vi } from 'vitest';
import { selectWinnerVideos, analyzeWinnerVideos, type WinnerVideoInput } from './videoPipeline';
import type { FetchVideoDeps, StagedVideo } from './videoFetch';
import type { VideoMedia } from './videoAnalysis';

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

const stubFetch = () =>
  vi.fn(async (): Promise<StagedVideo> => ({ kind: 'inline', base64: 'AAA=', mimeType: 'video/mp4', byteLength: 3 }));

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

  it('treats a download error as non-fatal and surfaces its reason', async () => {
    const fetchVideo = vi.fn(async () => { throw new Error('Video is 19.4 MB — too large to analyze inline (limit 14.0 MB).'); });
    const res = await analyzeWinnerVideos([winner({ creativeId: 'a__1' })], { week: 'w', fetchVideo, generate: okGenerate });
    expect(res.failed).toBe(1);
    expect(res.analyses).toHaveLength(0);
    expect(res.errors).toEqual([{ creativeId: 'a__1', reason: 'Video is 19.4 MB — too large to analyze inline (limit 14.0 MB).' }]);
  });

  it('surfaces a reason when the model output is unparseable', async () => {
    const fetchVideo = stubFetch();
    const res = await analyzeWinnerVideos([winner({ creativeId: 'a__1' })], { week: 'w', fetchVideo, generate: vi.fn(async () => 'nope') });
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].reason).toMatch(/no readable analysis/i);
  });

  it('threads the size ceilings to the fetch', async () => {
    const captured: { opts?: FetchVideoDeps } = {};
    const fetchVideo = vi.fn(async (_url: string, opts?: FetchVideoDeps): Promise<StagedVideo> => {
      captured.opts = opts;
      return { kind: 'inline', base64: 'AAA=', mimeType: 'video/mp4', byteLength: 3 };
    });
    await analyzeWinnerVideos(
      [winner({ creativeId: 'a__1' })],
      { week: 'w', inlineMaxBytes: 10, hardMaxBytes: 100, fetchVideo, generate: okGenerate },
    );
    expect(captured.opts?.inlineMaxBytes).toBe(10);
    expect(captured.opts?.hardMaxBytes).toBe(100);
    expect(typeof captured.opts?.stageToGcs).toBe('function');
  });

  it('stages an oversize video via the injected stageVideo and threads the gcs media to generate', async () => {
    const stageVideo = vi.fn(async () => 'gs://bucket/creative-video-cache/w/a__1.mp4');
    // fetchVideo mimics videoFetch's oversize branch: it invokes the injected
    // per-video stageToGcs closure and returns gcs media.
    const fetchVideo = vi.fn(async (_url: string, opts?: FetchVideoDeps): Promise<StagedVideo> => {
      const fileUri = await opts!.stageToGcs!(Buffer.from('x'), 'video/mp4');
      return { kind: 'gcs', fileUri, mimeType: 'video/mp4', byteLength: 999 };
    });
    const seen: VideoMedia[] = [];
    const generate = vi.fn(async (_p: string, media: VideoMedia) => {
      seen.push(media);
      return JSON.stringify({ hookType: 'Other' });
    });

    const res = await analyzeWinnerVideos(
      [winner({ creativeId: 'a__1' })],
      { week: 'w', fetchVideo, stageVideo, generate },
    );

    expect(res.analyses).toHaveLength(1);
    // the per-video closure binds week + creativeId onto the staging call
    expect(stageVideo).toHaveBeenCalledWith(expect.any(Buffer), { week: 'w', creativeId: 'a__1', mimeType: 'video/mp4' });
    // the gcs media reaches the generator as a fileData-style union
    expect(seen[0]).toEqual({ kind: 'gcs', fileUri: 'gs://bucket/creative-video-cache/w/a__1.mp4', mimeType: 'video/mp4', byteLength: 999 });
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
