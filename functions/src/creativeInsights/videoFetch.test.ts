import { describe, it, expect, vi } from 'vitest';
import { guessVideoMime, fetchCreativeVideo, type FetchLike } from './videoFetch';

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
  it('downloads and base64-encodes the media', async () => {
    const staged = await fetchCreativeVideo('https://cdn/ad.mp4', { fetch: okFetch(6) });
    // 6 zero bytes -> base64 of 6 zero bytes
    expect(staged.byteLength).toBe(6);
    expect(staged.mimeType).toBe('video/mp4');
    expect(staged.base64).toBe(Buffer.alloc(6).toString('base64'));
  });

  it('throws on HTTP failure', async () => {
    const fetch: FetchLike = vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(fetchCreativeVideo('https://cdn/x.mp4', { fetch })).rejects.toThrow('HTTP 404');
  });

  it('throws on empty and oversize bodies', async () => {
    await expect(fetchCreativeVideo('https://cdn/x.mp4', { fetch: okFetch(0) })).rejects.toThrow('empty');
    await expect(fetchCreativeVideo('https://cdn/x.mp4', { fetch: okFetch(100), maxBytes: 50 })).rejects.toThrow('too large');
  });
});
