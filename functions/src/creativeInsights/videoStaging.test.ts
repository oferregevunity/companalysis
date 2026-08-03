import { describe, it, expect, vi } from 'vitest';
import { stageVideoToGcs, stagedObjectPath, type GcsBucketLike } from './videoStaging';

describe('stagedObjectPath', () => {
  it('builds a week/creativeId path with a mime-derived extension', () => {
    expect(stagedObjectPath('2026-07-28', 'app1__abc', 'video/mp4')).toBe('creative-video-cache/2026-07-28/app1__abc.mp4');
    expect(stagedObjectPath('2026-07-28', 'app1__abc', 'video/quicktime')).toBe('creative-video-cache/2026-07-28/app1__abc.mov');
  });

  it('sanitizes unsafe characters in week and creativeId', () => {
    expect(stagedObjectPath('w/1', 'a/b c', 'video/webm')).toBe('creative-video-cache/w_1/a_b_c.webm');
  });
});

describe('stageVideoToGcs', () => {
  it('uploads to the bucket and returns a gs:// uri', async () => {
    const save = vi.fn(async () => {});
    const file = vi.fn(() => ({ save }));
    const getBucket = vi.fn((): GcsBucketLike => ({ file }));
    const buf = Buffer.from('vid');

    const uri = await stageVideoToGcs(
      buf,
      { week: 'w1', creativeId: 'a__1', mimeType: 'video/mp4' },
      { bucketName: 'my-bucket', getBucket },
    );

    expect(uri).toBe('gs://my-bucket/creative-video-cache/w1/a__1.mp4');
    expect(getBucket).toHaveBeenCalledWith('my-bucket');
    expect(file).toHaveBeenCalledWith('creative-video-cache/w1/a__1.mp4');
    expect(save).toHaveBeenCalledWith(buf, { contentType: 'video/mp4', resumable: false });
  });

  it('throws when no bucket is configured', async () => {
    await expect(
      stageVideoToGcs(Buffer.from('x'), { week: 'w', creativeId: 'c', mimeType: 'video/mp4' }, { bucketName: '' }),
    ).rejects.toThrow(/cache bucket/i);
  });
});
