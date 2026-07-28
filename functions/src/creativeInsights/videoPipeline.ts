import {
  analyzeCreativeVideo,
  type VideoAnalysis,
  type VideoGenerate,
} from './videoAnalysis';
import { stageVideo, unstageVideo, type StagingBucket } from './videoStaging';

/**
 * Orchestrates video analysis for a workspace's top winners: for each of the
 * top-N ranked winners that is a video, stage the media to GCS, run the
 * per-video Iteration-Loop analysis, then clean up. Every step is non-fatal —
 * a creative that fails to stage or analyze is skipped, not thrown, so the
 * workspace analysis never regresses on video errors.
 *
 * Staging/generation are injected so the selection + resilience logic is
 * unit-testable without real GCS or Vertex.
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
  bucket: StagingBucket;
  week: string;
  focusAppId?: string;
  /** Only the top-N ranked winner videos are analyzed (matches the UI). Default 10. */
  maxVideos?: number;
  /** Parallel video analyses in flight. Default 3 (Vertex + GCS friendly). */
  concurrency?: number;
  stage?: typeof stageVideo;
  unstage?: typeof unstageVideo;
  generate?: VideoGenerate;
}

export interface AnalyzeVideosResult {
  analyses: VideoAnalysis[];
  attempted: number;
  failed: number;
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
  const stage = deps.stage ?? stageVideo;
  const unstage = deps.unstage ?? unstageVideo;
  const maxVideos = deps.maxVideos ?? 10;
  const concurrency = deps.concurrency ?? 3;

  const selected = selectWinnerVideos(winners, maxVideos);
  let failed = 0;

  const settled = await runPool(selected, concurrency, async (w): Promise<VideoAnalysis | null> => {
    let objectPath: string | null = null;
    try {
      const staged = await stage(w.mediaUrl!, w.creativeId, deps.week, { bucket: deps.bucket });
      objectPath = staged.objectPath;
      const analysis = await analyzeCreativeVideo(
        {
          creativeId: w.creativeId,
          appName: w.appName,
          isFocusGame: !!deps.focusAppId && w.appId === deps.focusAppId,
          videoDurationSec: w.videoDurationSec,
          title: w.title,
          message: w.message,
        },
        staged.gsUri,
        staged.mimeType,
        deps.generate,
      );
      if (!analysis) failed += 1;
      return analysis;
    } catch {
      failed += 1;
      return null;
    } finally {
      if (objectPath) await unstage(objectPath, deps.bucket);
    }
  });

  // Preserve rank order; drop nulls (failed/unparseable).
  const analyses = settled.filter((a): a is VideoAnalysis => a != null);
  return { analyses, attempted: selected.length, failed };
}
