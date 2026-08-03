import {
  analyzeCreativeVideo,
  type VideoAnalysis,
  type VideoGenerate,
} from './videoAnalysis';
import { fetchCreativeVideo } from './videoFetch';
import { stageVideoToGcs } from './videoStaging';

/**
 * Orchestrates video analysis for a workspace's top winners: for each of the
 * top-N ranked winners that is a video, download the media and run the per-video
 * Iteration-Loop analysis (inline to Vertex — no GCS). Every step is non-fatal —
 * a creative that fails to download or analyze is skipped, not thrown, so the
 * workspace analysis never regresses on video errors.
 *
 * Fetch/generation are injected so the selection + resilience logic is
 * unit-testable without real network or Vertex.
 */

export interface WinnerVideoInput {
  creativeId: string;
  appId: string;
  appName: string;
  rank: number;
  format: string;
  mediaUrl: string | null;
  videoDurationSec: number | null;
  title?: string | null;
  message?: string | null;
}

export interface AnalyzeVideosDeps {
  week: string;
  focusAppId?: string;
  /** Only the top-N ranked winner videos are analyzed (matches the UI). Default 10. */
  maxVideos?: number;
  /** Parallel video analyses in flight. Default 3 (Vertex-friendly). */
  concurrency?: number;
  /** Inline base64 ceiling (raw bytes). Undefined → videoFetch default (~14.5 MB). */
  inlineMaxBytes?: number;
  /** Hard cap (raw bytes) above which a video is skipped. Undefined → videoFetch default (64 MB). */
  hardMaxBytes?: number;
  fetchVideo?: typeof fetchCreativeVideo;
  /** GCS staging for oversize videos. Injected for tests; defaults to the real `stageVideoToGcs`. */
  stageVideo?: typeof stageVideoToGcs;
  generate?: VideoGenerate;
}

/** Why one video couldn't be analyzed (download/oversize/parse) — user-facing. */
export interface VideoAnalysisError {
  creativeId: string;
  reason: string;
}

export interface AnalyzeVideosResult {
  analyses: VideoAnalysis[];
  attempted: number;
  failed: number;
  /** Per-creative failure reasons, aligned with `failed`. */
  errors: VideoAnalysisError[];
}

/** The winners worth video-analyzing: video format, has media, top-N by rank. */
export function selectWinnerVideos(winners: WinnerVideoInput[], maxVideos: number): WinnerVideoInput[] {
  return winners
    .filter(w => w.format === 'video' && !!w.mediaUrl)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, maxVideos);
}

async function runPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function analyzeWinnerVideos(
  winners: WinnerVideoInput[],
  deps: AnalyzeVideosDeps,
): Promise<AnalyzeVideosResult> {
  const fetchVideo = deps.fetchVideo ?? fetchCreativeVideo;
  const stageVideo = deps.stageVideo ?? stageVideoToGcs;
  const maxVideos = deps.maxVideos ?? 10;
  const concurrency = deps.concurrency ?? 3;

  const selected = selectWinnerVideos(winners, maxVideos);

  const settled = await runPool(
    selected,
    concurrency,
    async (w): Promise<{ analysis: VideoAnalysis | null; error: VideoAnalysisError | null }> => {
      try {
        const media = await fetchVideo(w.mediaUrl!, {
          inlineMaxBytes: deps.inlineMaxBytes,
          hardMaxBytes: deps.hardMaxBytes,
          stageToGcs: (buf, mimeType) => stageVideo(buf, { week: deps.week, creativeId: w.creativeId, mimeType }),
        });
        const analysis = await analyzeCreativeVideo(
          {
            creativeId: w.creativeId,
            appName: w.appName,
            isFocusGame: !!deps.focusAppId && w.appId === deps.focusAppId,
            videoDurationSec: w.videoDurationSec,
            title: w.title,
            message: w.message,
          },
          media,
          deps.generate,
        );
        if (!analysis) {
          const reason = 'The model returned no readable analysis for this video.';
          console.warn(`[videoAnalysis] ${w.creativeId}: ${reason}`);
          return { analysis: null, error: { creativeId: w.creativeId, reason } };
        }
        return { analysis, error: null };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[videoAnalysis] ${w.creativeId}: ${reason}`);
        return { analysis: null, error: { creativeId: w.creativeId, reason } };
      }
    },
  );

  // Preserve rank order; drop nulls (failed/unparseable).
  const analyses = settled.map(s => s.analysis).filter((a): a is VideoAnalysis => a != null);
  const errors = settled.map(s => s.error).filter((e): e is VideoAnalysisError => e != null);
  return { analyses, attempted: selected.length, failed: errors.length, errors };
}
