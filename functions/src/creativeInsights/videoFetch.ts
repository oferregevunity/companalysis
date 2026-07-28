/**
 * Downloads a Sensor Tower creative video and returns it base64-encoded so it
 * can be passed to Vertex Gemini as an `inlineData` part.
 *
 * Vertex multimodal takes either a `gs://` fileUri or inline bytes — it cannot
 * fetch Sensor Tower's external HTTP `mediaUrl` directly. Inline bytes avoid GCS
 * entirely (no bucket, no service-agent IAM, no cleanup); the only constraint is
 * Vertex's ~20 MB request cap, which short UA creatives sit well under. Videos
 * over the cap are rejected and skipped by the caller (non-fatal).
 *
 * `fetch` is injected so callers are unit-testable without real network.
 */

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export interface FetchVideoDeps {
  fetch?: FetchLike;
  /** Reject downloads larger than this (raw bytes). Default ~12 MB (~16 MB base64). */
  maxBytes?: number;
}

export interface FetchedVideo {
  base64: string;
  mimeType: string;
  byteLength: number;
}

/** ~12 MB raw keeps the base64 payload (+~33%) safely under Vertex's ~20 MB inline cap. */
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

/** Guess a video mime type from the URL extension; defaults to video/mp4. */
export function guessVideoMime(url: string): string {
  const clean = url.split('?')[0].toLowerCase();
  if (clean.endsWith('.mov')) return 'video/quicktime';
  if (clean.endsWith('.webm')) return 'video/webm';
  if (clean.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

/**
 * Download `mediaUrl` and return it base64-encoded. Throws on HTTP failure,
 * empty body, or oversize; callers treat that as non-fatal (skip the video,
 * fall back to metadata-only tagging).
 */
export async function fetchCreativeVideo(mediaUrl: string, deps: FetchVideoDeps = {}): Promise<FetchedVideo> {
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;

  const res = await doFetch(mediaUrl);
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) throw new Error('empty media body');
  if (buf.byteLength > maxBytes) throw new Error(`media too large: ${buf.byteLength} > ${maxBytes} bytes`);

  return { base64: buf.toString('base64'), mimeType: guessVideoMime(mediaUrl), byteLength: buf.byteLength };
}
