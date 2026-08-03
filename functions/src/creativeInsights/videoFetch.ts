/**
 * Downloads a Sensor Tower creative video and returns it ready for Vertex Gemini
 * as either an inline `inlineData` part (base64) or a `fileData` `gs://` URI.
 *
 * Vertex multimodal takes either inline bytes or a `gs://` fileUri — it cannot
 * fetch Sensor Tower's external HTTP `mediaUrl` directly. Inline avoids GCS
 * entirely but is capped by Vertex's ~20 MB request limit (raw ≤ ~14.5 MB).
 * Oversize winners (119 s / ~19.4 MB) need the file path, so we tier by size:
 *
 *   ≤ inlineMaxBytes         → inline base64 (fast path, no GCS)
 *   inlineMaxBytes..hardMax  → stage to GCS, return gs:// fileUri
 *   > hardMaxBytes           → reject (skipped by caller, non-fatal)
 *
 * Staging is injected (`stageToGcs`) — supplied per-video by the pipeline, which
 * holds the week + creativeId context. When absent (or oversize past the hard
 * cap) the throw is treated as a non-fatal skip upstream, so the inline path
 * never regresses even before the GCS bucket/IAM is provisioned.
 *
 * `fetch` is injected so callers are unit-testable without real network/GCS.
 */

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Stage oversize bytes to GCS and return a `gs://` URI. Bound to a creative by the caller. */
export type StageToGcs = (buf: Buffer, mimeType: string) => Promise<string>;

export interface FetchVideoDeps {
  fetch?: FetchLike;
  /** ≤ this (raw bytes) → inline base64. Default ~14.5 MB (~19.3 MB base64, under Vertex's ~20 MB inline cap). */
  inlineMaxBytes?: number;
  /** > inline and ≤ this → stage to GCS. > this → reject. Default 64 MB (real max seen ~19.4 MB). */
  hardMaxBytes?: number;
  /** Stage oversize bytes to GCS. When absent, videos over the inline ceiling are rejected. */
  stageToGcs?: StageToGcs;
}

/** A downloaded creative ready for Vertex — inline bytes or a staged `gs://` URI. */
export type StagedVideo =
  | { kind: 'inline'; base64: string; mimeType: string; byteLength: number }
  | { kind: 'gcs'; fileUri: string; mimeType: string; byteLength: number };

/** ~14.5 MB raw ≈ 19.3 MB base64, just under Vertex's ~20 MB inline request cap. */
const DEFAULT_INLINE_MAX_BYTES = 14.5 * 1024 * 1024;
/** Hard ceiling for the GCS path — bounds function memory/download; real max seen ~19.4 MB. */
const DEFAULT_HARD_MAX_BYTES = 64 * 1024 * 1024;

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Guess a video mime type from the URL extension; defaults to video/mp4. */
export function guessVideoMime(url: string): string {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.mov')) return 'video/quicktime';
  if (clean.endsWith('.webm')) return 'video/webm';
  if (clean.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

/**
 * Download `mediaUrl` and return it ready for Vertex (inline or GCS-staged).
 * Throws on HTTP failure, empty body, oversize past the hard cap, or an oversize
 * video with no staging available; callers treat that as non-fatal (skip the
 * video, fall back to metadata-only tagging).
 */
export async function fetchCreativeVideo(mediaUrl: string, deps: FetchVideoDeps = {}): Promise<StagedVideo> {
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const inlineMax = deps.inlineMaxBytes ?? DEFAULT_INLINE_MAX_BYTES;
  const hardMax = deps.hardMaxBytes ?? DEFAULT_HARD_MAX_BYTES;

  const res = await doFetch(mediaUrl);
  if (!res.ok) throw new Error(`Couldn't download the video (HTTP ${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('The video file was empty.');

  const mimeType = guessVideoMime(mediaUrl);

  if (buf.byteLength <= inlineMax) {
    return { kind: 'inline', base64: buf.toString('base64'), mimeType, byteLength: buf.byteLength };
  }
  if (buf.byteLength > hardMax) {
    throw new Error(`Video is ${mb(buf.byteLength)} — too large to analyze (limit ${mb(hardMax)}).`);
  }
  if (!deps.stageToGcs) {
    throw new Error(`Video is ${mb(buf.byteLength)} — over the ${mb(inlineMax)} inline limit and GCS staging is unavailable.`);
  }
  const fileUri = await deps.stageToGcs(buf, mimeType);
  return { kind: 'gcs', fileUri, mimeType, byteLength: buf.byteLength };
}
