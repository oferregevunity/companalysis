/**
 * Stages a Sensor Tower creative video into GCS so Vertex Gemini can read it.
 *
 * Vertex multimodal accepts a `gs://` fileUri or inline bytes — it cannot fetch
 * Sensor Tower's external HTTP `mediaUrl` directly. So we download the media and
 * re-upload it to the project's default bucket under a temp prefix, hand the
 * `gs://` URI to Gemini, then delete it. Network + bucket are injected so the
 * orchestration is unit-testable without real GCS/HTTP.
 */

/** Minimal surface of a firebase-admin Storage bucket that we use. */
export interface StagingBucket {
  name: string;
  file(path: string): {
    save(data: Buffer, opts?: { contentType?: string; resumable?: boolean }): Promise<void>;
    delete(opts?: { ignoreNotFound?: boolean }): Promise<unknown>;
  };
}

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface StageVideoDeps {
  bucket: StagingBucket;
  fetch?: FetchLike;
  /** Temp object prefix; defaults to `tmp/creative-analysis`. */
  prefix?: string;
  /** Reject downloads larger than this (bytes). Default 40 MB. */
  maxBytes?: number;
}

export interface StagedVideo {
  gsUri: string;
  mimeType: string;
  objectPath: string;
}

const DEFAULT_PREFIX = 'tmp/creative-analysis';
const DEFAULT_MAX_BYTES = 40 * 1024 * 1024;

/** Guess a video mime type from the URL extension; defaults to video/mp4. */
export function guessVideoMime(url: string): string {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.mov')) return 'video/quicktime';
  if (clean.endsWith('.webm')) return 'video/webm';
  if (clean.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

/** A GCS-safe object path for a creative's staged video. */
export function stagingObjectPath(week: string, creativeId: string, mimeExt = 'mp4', prefix = DEFAULT_PREFIX): string {
  const safe = creativeId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${prefix}/${week}/${safe}.${mimeExt}`;
}

function extFromMime(mime: string): string {
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/x-m4v') return 'm4v';
  return 'mp4';
}

/**
 * Download `mediaUrl` and upload to the bucket. Returns the staged `gs://` URI.
 * Throws on HTTP failure or oversize; callers treat staging errors as non-fatal
 * (fall back to metadata-only tagging for that creative).
 */
export async function stageVideo(
  mediaUrl: string,
  creativeId: string,
  week: string,
  deps: StageVideoDeps,
): Promise<StagedVideo> {
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const mimeType = guessVideoMime(mediaUrl);

  const res = await doFetch(mediaUrl);
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('empty media body');
  if (buf.byteLength > maxBytes) throw new Error(`media too large: ${buf.byteLength} > ${maxBytes} bytes`);

  const objectPath = stagingObjectPath(week, creativeId, extFromMime(mimeType), deps.prefix);
  await deps.bucket.file(objectPath).save(buf, { contentType: mimeType, resumable: false });

  return { gsUri: `gs://${deps.bucket.name}/${objectPath}`, mimeType, objectPath };
}

/** Best-effort delete of a staged object. Never throws. */
export async function unstageVideo(objectPath: string, bucket: StagingBucket): Promise<void> {
  try {
    await bucket.file(objectPath).delete({ ignoreNotFound: true });
  } catch {
    /* best-effort cleanup */
  }
}
