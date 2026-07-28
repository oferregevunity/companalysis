import { describe, it, expect, vi } from 'vitest';
import {
  guessVideoMime,
  stagingObjectPath,
  stageVideo,
  unstageVideo,
  type StagingBucket,
  type FetchLike,
} from './videoStaging';

function fakeBucket(): { bucket: StagingBucket; saved: Array<{ path: string; bytes: number; contentType?: string }>; deleted: string[] } {
  const saved: Array<{ path: string; bytes: number; contentType?: string }> = [];
  const deleted: string[] = [];
  const bucket: StagingBucket = {
    name: 'test-bucket',
    file(path: string) {
      return {
        async save(data: Buffer, opts) {
          saved.push({ path, bytes: data.byteLength, contentType: opts?.contentType });
        },
        async delete() {
          deleted.push(path);
          return [];
        },
      };
    },
  };
  return { bucket, saved, deleted };
}

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

describe('stagingObjectPath', () => {
  it('sanitizes the creative id', () => {
    expect(stagingObjectPath('2026-W30', '5f16__abc/def', 'mp4')).toBe('tmp/creative-analysis/2026-W30/5f16__abc_def.mp4');
  });
});

describe('stageVideo', () => {
  it('downloads and uploads, returning a gs uri', async () => {
    const { bucket, saved } = fakeBucket();
    const staged = await stageVideo('https://cdn/ad.mp4', 'app__key', '2026-W30', { bucket, fetch: okFetch(2048) });
    expect(staged.gsUri).toBe('gs://test-bucket/tmp/creative-analysis/2026-W30/app__key.mp4');
    expect(staged.mimeType).toBe('video/mp4');
    expect(saved).toEqual([{ path: 'tmp/creative-analysis/2026-W30/app__key.mp4', bytes: 2048, contentType: 'video/mp4' }]);
  });

  it('throws on HTTP failure', async () => {
    const { bucket } = fakeBucket();
    const fetch: FetchLike = vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    await expect(stageVideo('https://cdn/x.mp4', 'a__b', 'w', { bucket, fetch })).rejects.toThrow('HTTP 404');
  });

  it('throws on empty and oversize bodies', async () => {
    const { bucket } = fakeBucket();
    await expect(stageVideo('https://cdn/x.mp4', 'a__b', 'w', { bucket, fetch: okFetch(0) })).rejects.toThrow('empty');
    await expect(
      stageVideo('https://cdn/x.mp4', 'a__b', 'w', { bucket, fetch: okFetch(100), maxBytes: 50 }),
    ).rejects.toThrow('too large');
  });
});

describe('unstageVideo', () => {
  it('deletes the object', async () => {
    const { bucket, deleted } = fakeBucket();
    await unstageVideo('tmp/x.mp4', bucket);
    expect(deleted).toEqual(['tmp/x.mp4']);
  });

  it('never throws when delete fails', async () => {
    const bucket: StagingBucket = {
      name: 'b',
      file: () => ({ save: async () => {}, delete: async () => { throw new Error('boom'); } }),
    };
    await expect(unstageVideo('tmp/x.mp4', bucket)).resolves.toBeUndefined();
  });
});
