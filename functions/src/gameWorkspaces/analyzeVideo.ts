import type { StoredCreative } from '../adIntel/fetchCreativesForGenre';
import type { VideoAnalysis } from '../creativeInsights/videoAnalysis';

export interface AnalyzeOneVideoResult {
  ok: boolean;
  analysis: VideoAnalysis | null;
  reason?: string;
}

/**
 * On-demand deep video analysis for a SINGLE creative (the "Analyze this video"
 * action in the detail modal). Loads the creative from `creativeLatest`, runs
 * the Iteration-Loop analysis, and upserts the result into the workspace insight
 * doc's `videoAnalyses[]` (transaction, keyed by creativeId) so it's cached and
 * the live-subscribed UI updates. Also returns the analysis for immediate render.
 */
export async function analyzeSingleCreativeVideo(params: {
  scopeId: string;
  week: string;
  creativeId: string;
}): Promise<AnalyzeOneVideoResult> {
  const { scopeId, week, creativeId } = params;
  const [{ getFirestore, FieldValue }, { analyzeWinnerVideos }] = await Promise.all([
    import('firebase-admin/firestore'),
    import('../creativeInsights/videoPipeline'),
  ]);
  const db = getFirestore('companalysis');

  const cSnap = await db.collection('creativeLatest').doc(creativeId).get();
  if (!cSnap.exists) return { ok: false, analysis: null, reason: 'Creative not found' };
  const c = cSnap.data() as StoredCreative;
  if (c.format !== 'video' || !c.mediaUrl) {
    return { ok: false, analysis: null, reason: 'Not a video creative' };
  }

  const focusAppId = scopeId.startsWith('game_') ? scopeId.slice('game_'.length) : '';
  const nameSnap = await db.collection('appNames').doc(c.appId).get();
  const nameData = nameSnap.exists ? (nameSnap.data() as Record<string, unknown>) : undefined;
  const appName = typeof nameData?.name === 'string' && nameData.name ? nameData.name : c.appId;

  // Budgets are uniform now (videoFetch defaults: ~14.5 MB inline ceiling, 64 MB
  // GCS hard cap) — oversize videos stage to GCS (fileData) rather than being
  // skipped, so no per-call override is needed here.
  const { analyses, errors } = await analyzeWinnerVideos(
    [
      {
        creativeId,
        appId: c.appId,
        appName,
        rank: 1,
        format: c.format,
        mediaUrl: c.mediaUrl,
        videoDurationSec: c.videoDurationSec,
        title: c.title,
        message: c.message,
      },
    ],
    { week, focusAppId },
  );
  const analysis = analyses[0] ?? null;
  if (!analysis) {
    return { ok: false, analysis: null, reason: errors[0]?.reason ?? 'Analysis failed — the video could not be read.' };
  }

  // Upsert into the insight doc's videoAnalyses array without clobbering the
  // batch pass's entries or a concurrent manual analysis.
  const docRef = db.collection('creativeInsights').doc(`${scopeId}_week_${week}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(docRef);
    const existing = (snap.exists ? (snap.data()?.videoAnalyses as VideoAnalysis[] | undefined) : undefined) ?? [];
    const next = existing.filter(v => v.creativeId !== creativeId);
    next.push(analysis);
    tx.set(docRef, { videoAnalyses: next, videoAnalyzedAt: FieldValue.serverTimestamp() }, { merge: true });
  });

  return { ok: true, analysis };
}
