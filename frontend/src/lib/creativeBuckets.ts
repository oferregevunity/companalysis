/**
 * Bucketing helpers for the Format/Length/Dimension gap analysis. Pure
 * functions over the `videoDurationSec` / `width` / `height` fields already
 * stored on every `StoredCreative`, so the gap panels are client-side only.
 */

export type DurationBucket =
  | '<10s'
  | '10–20s'
  | '20–30s'
  | '30–60s'
  | '60–120s'
  | '120s+'
  | 'unknown';

/** Stable display order (unknown last). */
export const DURATION_BUCKETS: readonly DurationBucket[] = [
  '<10s',
  '10–20s',
  '20–30s',
  '30–60s',
  '60–120s',
  '120s+',
  'unknown',
] as const;

/**
 * Classify a video length into a coarse bucket. Non-video creatives (and
 * videos Sensor Tower didn't report a duration for) land in `'unknown'`.
 */
export function durationBucket(sec: number | null | undefined): DurationBucket {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return 'unknown';
  if (sec < 10) return '<10s';
  if (sec < 20) return '10–20s';
  if (sec < 30) return '20–30s';
  if (sec < 60) return '30–60s';
  if (sec < 120) return '60–120s';
  return '120s+';
}

export type AspectBucket = 'portrait' | 'square' | 'landscape' | 'unknown';

export const ASPECT_BUCKETS: readonly AspectBucket[] = [
  'portrait',
  'square',
  'landscape',
  'unknown',
] as const;

/**
 * Classify pixel dimensions into an orientation bucket. A ±10% band around
 * 1:1 counts as square so slightly-off crops don't get mislabelled.
 */
export function aspectBucket(
  width: number | null | undefined,
  height: number | null | undefined,
): AspectBucket {
  if (
    width == null ||
    height == null ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return 'unknown';
  }
  if (height > width * 1.1) return 'portrait';
  if (width > height * 1.1) return 'landscape';
  return 'square';
}

/** Human label for an aspect bucket, with the canonical ratio hint. */
export function aspectLabel(b: AspectBucket): string {
  switch (b) {
    case 'portrait':
      return 'Portrait (9:16)';
    case 'square':
      return 'Square (1:1)';
    case 'landscape':
      return 'Landscape (16:9)';
    default:
      return 'Unknown';
  }
}
