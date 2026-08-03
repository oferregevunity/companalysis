/**
 * Stages an oversize creative video to GCS so Vertex Gemini can read it via a
 * `fileData` `gs://` URI, lifting the ~14.5 MB inline (`inlineData`) ceiling to
 * GCS-file scale. This is the deferred half of the video foundation: inline
 * bytes cover short UA creatives with no bucket/IAM, but real winners (119 s /
 * ~19.4 MB) need the file path.
 *
 * The object is throwaway — a bucket lifecycle rule deletes it after 1 day, so
 * there is no explicit cleanup here. Uploads land under
 * `creative-video-cache/{week}/{creativeId}.mp4`.
 *
 * The bucket accessor is injected so the path/URI logic is unit-testable without
 * real GCS. On misconfiguration (no bucket env, upload failure) this throws; the
 * pipeline's per-video try/catch turns that into a non-fatal skip-with-reason,
 * so shipping this before the bucket + Vertex-SA IAM land does NOT regress the
 * inline fast path.
 */

import { getStorage } from 'firebase-admin/storage';

/**
 * Default cache bucket, overridable via CREATIVE_VIDEO_CACHE_BUCKET. Baked in so
 * a deploy needs no extra env config (a `.env` is gitignored and would drop on a
 * clean checkout); set the env var only to point at a different bucket.
 */
const DEFAULT_CACHE_BUCKET = 'companalysis-creative-cache';

/** Minimal slice of the GCS Bucket API we use — keeps the injected fake tiny. */
export interface GcsBucketLike {
  file(path: string): {
    save(data: Buffer, opts: { contentType: string; resumable?: boolean }): Promise<void>;
  };
}

export interface StageVideoParams {
  week: string;
  /** docId (`appId__creativeKey`). */
  creativeId: string;
  mimeType: string;
}

export interface StageVideoDeps {
  /** Override the bucket name; defaults to CREATIVE_VIDEO_CACHE_BUCKET. */
  bucketName?: string;
  /** Injected for tests; defaults to firebase-admin's `getStorage().bucket()`. */
  getBucket?: (name: string) => GcsBucketLike;
}

function extFromMime(mimeType: string): string {
  switch (mimeType) {
    case 'video/quicktime':
      return 'mov';
    case 'video/webm':
      return 'webm';
    case 'video/x-m4v':
      return 'm4v';
    default:
      return 'mp4';
  }
}

/** Object path within the cache bucket. creativeId is sanitized for a safe key. */
export function stagedObjectPath(week: string, creativeId: string, mimeType: string): string {
  const safeWeek = week.replace(/[^A-Za-z0-9._-]/g, '_');
  const safeId = creativeId.replace(/[^A-Za-z0-9._-]/g, '_');
  return `creative-video-cache/${safeWeek}/${safeId}.${extFromMime(mimeType)}`;
}

/**
 * Upload `buf` and return its `gs://` URI. Throws when no bucket is configured
 * or the upload fails (caller treats this as a non-fatal skip).
 */
export async function stageVideoToGcs(buf: Buffer, params: StageVideoParams, deps: StageVideoDeps = {}): Promise<string> {
  const bucketName = deps.bucketName ?? process.env.CREATIVE_VIDEO_CACHE_BUCKET ?? DEFAULT_CACHE_BUCKET;
  if (!bucketName) {
    throw new Error('No GCS cache bucket configured (CREATIVE_VIDEO_CACHE_BUCKET) — cannot stage oversize video.');
  }
  const path = stagedObjectPath(params.week, params.creativeId, params.mimeType);
  const getBucket = deps.getBucket ?? ((name: string) => getStorage().bucket(name) as unknown as GcsBucketLike);
  await getBucket(bucketName).file(path).save(buf, { contentType: params.mimeType, resumable: false });
  return `gs://${bucketName}/${path}`;
}
