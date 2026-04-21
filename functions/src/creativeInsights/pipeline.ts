import type { CreativeFormat, QueryableAdNetwork } from '../adIntel/types';
import type { StoredCreative } from '../adIntel/fetchCreativesForGenre';
import type { BuildPromptInput, ParsedCreativeResponse } from './geminiClient';
import type { CreativeScoreRow } from './scoringPipeline';
import type { SubScores } from './scoringEngine';

export interface CreativeInsightDoc {
  genreId: string;
  week: string;
  generatedAt?: { seconds: number; nanoseconds: number };
  summary: string;
  winners: Array<{
    creativeId: string;
    appId: string;
    appName: string;
    rank: number;
    score: number;
    subScores: SubScores;
    explanation: string;
  }>;
  emergingConcepts: Array<{ title: string; description: string; exampleCreativeIds: string[] }>;
  watchList: Array<{
    creativeId: string;
    appId: string;
    appName: string;
    score: number;
    reason: string;
  }>;
  geminiError?: string;
}

export interface PipelineDeps {
  genreId: string;
  week: string;
  genreName: string;
  loadScores: () => Promise<CreativeScoreRow[]>;
  loadCreatives: (docIds: string[]) => Promise<Map<string, StoredCreative>>;
  loadAppMeta: (appIds: string[]) => Promise<Map<string, { name: string; publisherName: string }>>;
  callGemini: (input: BuildPromptInput) => Promise<ParsedCreativeResponse & { geminiError?: string }>;
  write: (doc: CreativeInsightDoc) => Promise<void>;
  now?: Date;
}

function stableSortScoresDesc(rows: CreativeScoreRow[]): CreativeScoreRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (b.row.score !== a.row.score) return b.row.score - a.row.score;
      return a.index - b.index;
    })
    .map(x => x.row);
}

function selectWinnerRows(sorted: CreativeScoreRow[]): CreativeScoreRow[] {
  return sorted.filter(s => s.score >= 60).slice(0, 10);
}

function selectConceptCandidates(sorted: CreativeScoreRow[], winnerIds: Set<string>): CreativeScoreRow[] {
  return sorted.filter(s => !winnerIds.has(s.docId)).slice(0, 20);
}

function selectWatchCandidates(sorted: CreativeScoreRow[], winnerIds: Set<string>): CreativeScoreRow[] {
  return sorted.filter(s => !winnerIds.has(s.docId) && s.score >= 50 && s.score < 60).slice(0, 5);
}

function appDisplayName(
  appId: string,
  appMeta: Map<string, { name: string; publisherName: string }>,
): string {
  const row = appMeta.get(appId);
  if (!row?.name?.trim()) return 'Unknown app';
  return row.name;
}

function publisherDisplayName(appId: string, appMeta: Map<string, { name: string; publisherName: string }>): string {
  return appMeta.get(appId)?.publisherName ?? '';
}

function toWinnerInput(
  row: CreativeScoreRow,
  creative: StoredCreative | undefined,
  appMeta: Map<string, { name: string; publisherName: string }>,
): BuildPromptInput['winners'][number] {
  const c = creative;
  return {
    creativeId: row.docId,
    appId: row.appId,
    appName: appDisplayName(row.appId, appMeta),
    publisherName: publisherDisplayName(row.appId, appMeta),
    networks: (c?.networks ?? []) as QueryableAdNetwork[],
    format: (c?.format ?? 'unknown') as CreativeFormat,
    durationDays: c?.durationDays ?? 0,
    firstSeen: c?.firstSeen ?? '',
    score: row.score,
    subScores: row.subScores,
  };
}

function toCandidateInput(
  row: CreativeScoreRow,
  creative: StoredCreative | undefined,
  appMeta: Map<string, { name: string; publisherName: string }>,
): BuildPromptInput['conceptCandidates'][number] {
  const c = creative;
  return {
    creativeId: row.docId,
    appId: row.appId,
    appName: appDisplayName(row.appId, appMeta),
    format: (c?.format ?? 'unknown') as CreativeFormat,
    networks: (c?.networks ?? []) as QueryableAdNetwork[],
    score: row.score,
  };
}

function generatedAtFromDate(now: Date): { seconds: number; nanoseconds: number } {
  return { seconds: Math.floor(now.getTime() / 1000), nanoseconds: 0 };
}

function emptyDocBase(deps: {
  genreId: string;
  week: string;
  now: Date;
}): CreativeInsightDoc {
  return {
    genreId: deps.genreId,
    week: deps.week,
    summary: '',
    winners: [],
    emergingConcepts: [],
    watchList: [],
    generatedAt: generatedAtFromDate(deps.now),
  };
}

export async function generateAndStoreCreativeInsightsWithDeps(
  deps: PipelineDeps,
): Promise<{ ok: boolean; winners: number; geminiError?: string }> {
  const { genreId, week, genreName, loadScores, loadCreatives, loadAppMeta, callGemini, write, now = new Date() } = deps;

  const scores = await loadScores();
  if (scores.length === 0) {
    const doc = emptyDocBase({ genreId, week, now });
    await write(doc);
    return { ok: true, winners: 0 };
  }

  const sorted = stableSortScoresDesc(scores);
  const winnerRows = selectWinnerRows(sorted);
  const winnerIds = new Set(winnerRows.map(w => w.docId));
  const conceptRows = selectConceptCandidates(sorted, winnerIds);
  const watchRows = selectWatchCandidates(sorted, winnerIds);

  const neededDocIds = [...new Set([...winnerRows, ...conceptRows, ...watchRows].map(r => r.docId))];
  const creativesMap = await loadCreatives(neededDocIds);
  const appIds = [...new Set(scores.map(s => s.appId))];
  const appMeta = await loadAppMeta(appIds);

  const promptInput: BuildPromptInput = {
    genreName,
    week,
    winners: winnerRows.map(r => toWinnerInput(r, creativesMap.get(r.docId), appMeta)),
    conceptCandidates: conceptRows.map(r => toCandidateInput(r, creativesMap.get(r.docId), appMeta)),
    watchCandidates: watchRows.map(r => toCandidateInput(r, creativesMap.get(r.docId), appMeta)),
  };

  let parsed: ParsedCreativeResponse & { geminiError?: string };
  try {
    parsed = await callGemini(promptInput);
  } catch (err) {
    const geminiError = err instanceof Error ? err.message : String(err);
    const doc: CreativeInsightDoc = {
      ...emptyDocBase({ genreId, week, now }),
      geminiError,
    };
    await write(doc);
    return { ok: false, winners: 0, geminiError };
  }

  if (parsed.geminiError) {
    const doc: CreativeInsightDoc = {
      ...emptyDocBase({ genreId, week, now }),
      geminiError: parsed.geminiError,
    };
    await write(doc);
    return { ok: false, winners: 0, geminiError: parsed.geminiError };
  }

  const explById = new Map(parsed.winners.map(w => [w.creativeId, w.explanation]));
  const scoresById = new Map(scores.map(s => [s.docId, s]));

  const docWinners = winnerRows.map((row, i) => ({
    creativeId: row.docId,
    appId: row.appId,
    appName: appDisplayName(row.appId, appMeta),
    rank: i + 1,
    score: row.score,
    subScores: row.subScores,
    explanation: explById.get(row.docId) ?? '',
  }));

  const watchList = parsed.watchList.map(w => {
    const row = scoresById.get(w.creativeId);
    const appId = row?.appId ?? '';
    return {
      creativeId: w.creativeId,
      appId,
      appName: appDisplayName(appId, appMeta),
      score: row?.score ?? 0,
      reason: w.reason,
    };
  });

  const doc: CreativeInsightDoc = {
    genreId,
    week,
    summary: parsed.summary,
    winners: docWinners,
    emergingConcepts: parsed.emergingConcepts,
    watchList,
    generatedAt: generatedAtFromDate(now),
  };

  await write(doc);
  return { ok: true, winners: docWinners.length };
}

export async function generateAndStoreCreativeInsights(
  genreId: string,
  week: string,
  genreName: string,
): Promise<{ ok: boolean; winners: number; geminiError?: string }> {
  const [{ generateCreativeInsights }, { getFirestore, FieldValue }] = await Promise.all([
    import('./geminiClient'),
    import('firebase-admin/firestore'),
  ]);
  const db = getFirestore('companalysis');
  const insightDocRef = db.collection('creativeInsights').doc(`${genreId}_week_${week}`);
  const snapshotRef = db.collection('creativeSnapshots').doc(`${genreId}_week_${week}`);

  return generateAndStoreCreativeInsightsWithDeps({
    genreId,
    week,
    genreName,
    loadScores: async () => {
      const snap = await insightDocRef.collection('scores').get();
      return snap.docs.map(d => d.data() as CreativeScoreRow);
    },
    loadCreatives: async (docIds: string[]) => {
      const map = new Map<string, StoredCreative>();
      const BATCH = 400;
      for (let i = 0; i < docIds.length; i += BATCH) {
        const chunk = docIds.slice(i, i + BATCH);
        const refs = chunk.map(id => snapshotRef.collection('creatives').doc(id));
        const docs = await db.getAll(...refs);
        for (const d of docs) {
          if (d.exists) map.set(d.id, d.data() as StoredCreative);
        }
      }
      return map;
    },
    loadAppMeta: async (appIds: string[]) => {
      const map = new Map<string, { name: string; publisherName: string }>();
      const BATCH = 400;
      for (let i = 0; i < appIds.length; i += BATCH) {
        const chunk = appIds.slice(i, i + BATCH);
        const refs = chunk.map(id => db.collection('appNames').doc(id));
        const docs = await db.getAll(...refs);
        for (const d of docs) {
          if (d.exists) {
            const data = d.data() as Record<string, unknown>;
            map.set(d.id, {
              name: typeof data.name === 'string' ? data.name : 'Unknown app',
              publisherName: typeof data.publisherName === 'string' ? data.publisherName : '',
            });
          }
        }
      }
      return map;
    },
    callGemini: input => generateCreativeInsights(input),
    write: async doc => {
      const { generatedAt: _drop, ...rest } = doc;
      await insightDocRef.set(
        {
          ...rest,
          generatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    },
  });
}
