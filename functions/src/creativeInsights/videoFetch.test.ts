import { describe, it, expect, vi } from 'vitest';
import { guessVideoMime, fetchCreativeVideo, type FetchLike, type StageToGcs } from './videoFetch';

const okFetch = (bytes = 1024): FetchLike =>
  vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(bytes) }));

describe('guessVideoMime', () => {
  it('maps extensions and defaults to mp4', () => {
    expect(guessVideoMime('https://cdn/x.mp4')).toBe('video/mp4');
    expect(guessVideoMime('https://cdn/x.mov?sig=abc')).toBe('video/quicktime');
    expect(guessVideoMime('https://cdn/x.webm')).toBe('video/webm');
    expect(guessVideoMime('https://cdn/whatever')).toBe('video/mp4');
  });
});

describe('fetchCreativeVideo', () => {
  it('returns inline base64 for videos under the inline ceiling', async () => {
    const staged = await fetchCreativeVideo('https://cdn/ad.mp4', { fetch: okFetch(6) });
    expect(staged).toEqual({
      kind: 'inline',
      base64: Buffer.alloc(6).toString('base64'),
      mimeType: 'video/mp4',
      byteLength: 6,
    });
  });

  it('throws on HTTP failure', async () => {
    const fetch: FetchLike = vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(fetchCreativeVideo('https://cdn/x.mp4', { fetch })).rejects.toThrow('HTTP 404');
  });

  it('throws on an empty body', async () => {
    await expect(fetchCreativeVideo('https://cdn/x.mp4', { fetch: okFetch(0) })).rejects.toThrow('empty');
  });

  it('stages to GCS when over the inline ceiling but within the hard cap', async () => {
    const stageToGcs: StageToGcs = vi.fn(async () => 'gs://bucket/creative-video-cache/w/c.mp4');
    const staged = await fetchCreativeVideo('https://cdn/big.mp4', {
      fetch: okFetch(100),
      inlineMaxBytes: 50,
      hardMaxBytes: 1000,
      stageToGcs,
    });
    expect(staged).toEqual({
      kind: 'gcs',
      fileUri: 'gs://bucket/creative-video-cache/w/c.mp4',
      mimeType: 'video/mp4',
      byteLength: 100,
    });
    expect(stageToGcs).toHaveBeenCalledTimes(1);
  });

  it('rejects videos past the hard cap (before staging)', async () => {
    const stageToGcs: StageToGcs = vi.fn();
    await expect(
      fetchCreativeVideo('https://cdn/x.mp4', { fetch: okFetch(2000), inlineMaxBytes: 50, hardMaxBytes: 1000, stageToGcs }),
    ).rejects.toThrow('too large');
    expect(stageToGcs).not.toHaveBeenCalled();
  });

  it('rejects oversize videos when no staging is available', async () => {
    await expect(
      fetchCreativeVideo('https://cdn/x.mp4', { fetch: okFetch(100), inlineMaxBytes: 50, hardMaxBytes: 1000 }),
    ).rejects.toThrow(/staging is unavailable/i);
  });
});
