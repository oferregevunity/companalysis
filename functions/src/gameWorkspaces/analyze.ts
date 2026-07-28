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

  // Second pass: deep video analysis of the top video creatives shown in the UI.
  // Non-fatal — any failure here leaves the (already-written) insight doc intact.
  let videoAnalysisCount = 0;
  try {
    videoAnalysisCount = await analyzeWorkspaceTopVideos({
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
 * Video-analyzes the top video creatives by score — the ones the UI surfaces at
 * the top of the gallery — and merges `videoAnalyses` back onto the insight doc.
 * Deliberately NOT gated on the ≥60 "winner" bar: real workspaces often top out
 * below 60, and we still want the top videos analyzed. Returns the count.
 * Isolated + lazily-imported so the Vertex dep only loads when analysis runs.
 */
async function analyzeWorkspaceTopVideos(params: {
  insightDocRef: FirebaseFirestore.DocumentReference;
  focusAppId: string;
  week: string;
  creativesByDocId: Map<string, StoredCreative>;
}): Promise<number> {
  const { insightDocRef, focusAppId, week, creativesByDocId } = params;
  const { analyzeWinnerVideos } = await import('../creativeInsights/videoPipeline');

  // Top-scored creatives; keep the video ones (with media) until we have 10.
  const scoreSnap = await insightDocRef.collection('scores').orderBy('score', 'desc').limit(60).get();
  const picks: Array<{ docId: string; appId: string; c: StoredCreative }> = [];
  for (const s of scoreSnap.docs) {
    const row = s.data() as { docId: string; appId: string; score: number };
    const c = creativesByDocId.get(row.docId);
    if (!c || c.format !== 'video' || !c.mediaUrl) continue;
    picks.push({ docId: row.docId, appId: row.appId, c });
    if (picks.length >= 10) break;
  }
  if (picks.length === 0) return 0;

  // App display names for the prompt.
  const db = insightDocRef.firestore;
  const appIds = [...new Set(picks.map(p => p.appId))];
  const nameDocs = await db.getAll(...appIds.map(id => db.collection('appNames').doc(id)));
  const names = new Map<string, string>();
  for (const d of nameDocs) {
    if (d.exists) {
      const data = d.data() as Record<string, unknown>;
      names.set(d.id, typeof data.name === 'string' && data.name ? data.name : d.id);
    }
  }

  const topVideos = picks.map((p, i) => ({
    creativeId: p.docId,
    appId: p.appId,
    appName: names.get(p.appId) ?? p.appId,
    rank: i + 1,
    format: p.c.format,
    mediaUrl: p.c.mediaUrl,
    videoDurationSec: p.c.videoDurationSec,
    title: p.c.title,
    message: p.c.message,
  }));

  const { analyses } = await analyzeWinnerVideos(topVideos, { week, focusAppId });

  if (analyses.length > 0) {
    const { FieldValue } = await import('firebase-admin/firestore');
    await insightDocRef.set(
      { videoAnalyses: analyses, videoAnalyzedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  return analyses.length;
}
