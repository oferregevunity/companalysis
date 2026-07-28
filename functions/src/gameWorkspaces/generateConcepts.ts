import type { CreativeInsightDoc } from '../creativeInsights/pipeline';
import type { GeneratedConcept } from '../concepts/geminiClient';

export interface GenerateConceptsResult {
  ok: boolean;
  concepts: GeneratedConcept[];
  reason?: string;
  geminiError?: string;
}

/**
 * On-demand AI concept generation for a game workspace (the "Generate concepts"
 * action). Reads the workspace insight doc (`game_{focusAppId}_week_{week}`),
 * grounds the generator in the competitors' deep-analyzed winner videos + the
 * focus game's own runs + the client-supplied gaps/rising, then upserts the
 * result onto the doc as `concepts` (+ `conceptsGeneratedAt`) so it's cached and
 * the live-subscribed UI picks it up. Mirrors `analyzeSingleCreativeVideo`.
 *
 * Grounded-only: if no competitor video has been deep-analyzed yet, returns
 * ok:false with a reason rather than generating ungrounded concepts.
 */
export async function generateWorkspaceConcepts(params: {
  scopeId: string;
  week: string;
  focusAppId: string;
  focusGameName: string;
  gaps?: string[];
  rising?: string[];
  count?: number;
}): Promise<GenerateConceptsResult> {
  const { scopeId, week, focusAppId, focusGameName, gaps, rising, count } = params;
  const [{ getFirestore, FieldValue }, { buildConceptInput, appIdFromCreativeId }, { generateConcepts }] =
    await Promise.all([
      import('firebase-admin/firestore'),
      import('../concepts/fromWorkspace'),
      import('../concepts/geminiClient'),
    ]);
  const db = getFirestore('companalysis');

  const docRef = db.collection('creativeInsights').doc(`${scopeId}_week_${week}`);
  const snap = await docRef.get();
  if (!snap.exists) return { ok: false, concepts: [], reason: 'No analysis for this game yet — run it first.' };
  const doc = snap.data() as CreativeInsightDoc;

  const videoAnalyses = doc.videoAnalyses ?? [];
  const competitorSources = videoAnalyses.filter(va => appIdFromCreativeId(va.creativeId) !== focusAppId);
  if (competitorSources.length === 0) {
    return {
      ok: false,
      concepts: [],
      reason:
        'No competitor videos have been deep-analyzed yet. Analyze a few winning videos first — concepts are grounded in them.',
    };
  }

  // Resolve display names for every app that appears in the sources.
  const appIds = [...new Set(competitorSources.map(va => appIdFromCreativeId(va.creativeId)))];
  const appNameById = new Map<string, string>();
  const nameSnaps = await Promise.all(appIds.map(id => db.collection('appNames').doc(id).get()));
  nameSnaps.forEach((s, i) => {
    const name = s.exists ? (s.data() as Record<string, unknown>).name : undefined;
    if (typeof name === 'string' && name) appNameById.set(appIds[i], name);
  });

  const input = buildConceptInput({
    focusAppId,
    focusGameName,
    videoAnalyses,
    creativeTags: doc.creativeTags ?? [],
    winners: (doc.winners ?? []).map(w => ({ creativeId: w.creativeId, explanation: w.explanation })),
    appNameById,
    gaps,
    rising,
    count,
  });

  const { concepts, geminiError } = await generateConcepts(input);
  if (concepts.length === 0) {
    return { ok: false, concepts: [], reason: geminiError ? undefined : 'The model returned no concepts — try again.', geminiError };
  }

  await docRef.set({ concepts, conceptsGeneratedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, concepts };
}
