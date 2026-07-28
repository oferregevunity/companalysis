import type { StoredCreative } from '../adIntel/fetchCreativesForGenre';
import { creativeDocId } from '../adIntel/fetchCreativesForGenre';

export interface AnalyzeWorkspaceResult {
  success: boolean;
  creativeCount: number;
  scoredCount: number;
  insightsGenerated: boolean;
  /** Deep video analyses written for the top winner videos (non-fatal second pass). */
  videoAnalysisCount?: number;
  geminiError?: string;
}

/** Insight/score docs for a workspace live under scope id `game_{focusAppId}`. */
export function workspaceScopeId(focusAppId: string): string {
  return `game_${focusAppId}`;
}

/**
 * Score + AI-analyze the creatives of a game workspace (focus game + curated
 * competitors). Reuses the genre pipelines via dependency injection: creatives
 * come from `creativeLatest` by app id (no per-workspace snapshot copies), and
 * results land in `creativeInsights/game_{focusAppId}_week_{week}` — the exact
 * doc shape the frontend already renders.
 */
export async function analyzeGameWorkspace(params: {
  focusAppId: string;
  focusName: string;
  appIds: string[];
  week: string;
}): Promise<AnalyzeWorkspaceResult> {
  const { focusAppId, focusName, week } = params;
  const appIds = [...new Set(params.appIds)];
  const scopeId = workspaceScopeId(focusAppId);

  const [
    { getFirestore, FieldValue },
    { scoreCreativesForGenreWithDeps },
    { generateAndStoreCreativeInsightsWithDeps },
    { generateCreativeInsights },
  ] = await Promise.all([
    import('firebase-admin/firestore'),
    import('../creativeInsights/scoringPipeline'),
    import('../creativeInsights/pipeline'),
    import('../creativeInsights/geminiClient'),
  ]);

  const db = getFirestore('companalysis');
  const insightDocRef = db.collection('creativeInsights').doc(`${scopeId}_week_${week}`);

  // Load the workspace's creative set once; both pipelines feed off it.
  const creatives: StoredCreative[] = [];
  const IN_LIMIT = 30;
  for (let i = 0; i < appIds.length; i += IN_LIMIT) {
    const chunk = appIds.slice(i, i + IN_LIMIT);
    const snap = await db.collection('creativeLatest').where('appId', 'in', chunk).get();
    for (const d of snap.docs) {
      creatives.push(d.data() as StoredCreative);
    }
  }

  const scoreResult = await scoreCreativesForGenreWithDeps({
    genreId: scopeId,
    week,
    loadCreatives: async () => creatives,
    writeScores: async rows => {
      const BATCH = 400;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const batch = db.batch();
        for (const r of chunk) {
          const { computedAt: _drop, ...rest } = r;
          batch.set(insightDocRef.collection('scores').doc(r.docId), {
            ...rest,
            computedAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
      }
      await insightDocRef.set(
        { genreId: scopeId, week, scoredAt: FieldValue.serverTimestamp(), scoredCount: rows.length },
        { merge: true },
      );
    },
  });

  const creativesByDocId = new Map(creatives.map(c => [creativeDocId(c.appId, c.creativeKey), c]));

  const insightResult = await generateAndStoreCreativeInsightsWithDeps({
    genreId: scopeId,
    week,
    genreName: `${focusName} competitor set`,
    focusAppId,
    loadScores: async () => {
      const snap = await insightDocRef.collection('scores').get();
      return snap.docs.map(d => d.data() as import('../creativeInsights/scoringPipeline').CreativeScoreRow);
    },
    loadCreatives: async docIds => {
      const m = new Map<string, StoredCreative>();
      for (const id of docIds) {
        const c = creativesByDocId.get(id);
        if (c) m.set(id, c);
      }
      return m;
    },
    loadAppMeta: async ids => {
      const m = new Map<string, { name: string; publisherName: string }>();
      const BATCH = 400;
      for (let i = 0; i < ids.length; i += BATCH) {
        const refs = ids.slice(i, i + BATCH).map(id => db.collection('appNames').doc(id));
        const docs = await db.getAll(...refs);
        for (const d of docs) {
          if (d.exists) {
            const data = d.data() as Record<string, unknown>;
            m.set(d.id, {
              name: typeof data.name === 'string' ? data.name : 'Unknown app',
              publisherName: typeof data.publisherName === 'string' ? data.publisherName : '',
            });
          }
        }
      }
      return m;
    },
    callGemini: input => generateCreativeInsights(input),
    write: async doc => {
      const { generatedAt: _drop, ...rest } = doc;
      await insightDocRef.set({ ...rest, generatedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
  });

  // Second pass: deep video analysis of the top-N winner videos shown in the UI.
  // Non-fatal — any failure here leaves the (already-written) insight doc intact.
  let videoAnalysisCount = 0;
  try {
    videoAnalysisCount = await analyzeWorkspaceWinnerVideos({
      insightDocRef,
      focusAppId,
      week,
      creativesByDocId,
    });
  } catch (err) {
    console.error('workspace video analysis failed (non-fatal)', err);
  }

  return {
    success: insightResult.ok,
    creativeCount: creatives.length,
    scoredCount: scoreResult.scored,
    insightsGenerated: insightResult.ok,
    videoAnalysisCount,
    ...(insightResult.geminiError ? { geminiError: insightResult.geminiError } : {}),
  };
}

/**
 * Reads the just-written winners off the insight doc, video-analyzes the top-N
 * that are videos, and merges `videoAnalyses` back onto the doc. Returns the
 * number of analyses written. Isolated + lazily-imported so the heavy Vertex /
 * Storage deps only load when a workspace analysis actually runs.
 */
async function analyzeWorkspaceWinnerVideos(params: {
  insightDocRef: FirebaseFirestore.DocumentReference;
  focusAppId: string;
  week: string;
  creativesByDocId: Map<string, StoredCreative>;
}): Promise<number> {
  const { insightDocRef, focusAppId, week, creativesByDocId } = params;
  const [{ getStorage }, { analyzeWinnerVideos }] = await Promise.all([
    import('firebase-admin/storage'),
    import('../creativeInsights/videoPipeline'),
  ]);

  const snap = await insightDocRef.get();
  const doc = snap.data() as
    | { winners?: Array<{ creativeId: string; appId: string; appName?: string; rank: number }> }
    | undefined;
  const winners = doc?.winners ?? [];
  if (winners.length === 0) return 0;

  // App display names for the prompt — the doc's winners already carry appName;
  // fall back to the appId when a legacy doc omits it.
  const winnerVideos = winners.map(w => {
    const c = creativesByDocId.get(w.creativeId);
    return {
      creativeId: w.creativeId,
      appId: w.appId,
      appName: w.appName?.trim() || w.appId,
      rank: w.rank,
      format: c?.format ?? 'unknown',
      mediaUrl: c?.mediaUrl ?? null,
      videoDurationSec: c?.videoDurationSec ?? null,
      title: c?.title ?? null,
      message: c?.message ?? null,
    };
  });

  const { analyses } = await analyzeWinnerVideos(winnerVideos, {
    bucket: getStorage().bucket(),
    week,
    focusAppId,
  });

  if (analyses.length > 0) {
    const { FieldValue } = await import('firebase-admin/firestore');
    await insightDocRef.set(
      { videoAnalyses: analyses, videoAnalyzedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  return analyses.length;
}
