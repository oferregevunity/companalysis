import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { computeRisingStarScore } from './scoringEngine';
import type { AppScoreInput, ScoredApp } from './scoringEngine';
import { generateGenreInsights } from './geminiClient';

const db = getFirestore('companalysis');

interface GenreConfig {
  id: string;
  name: string;
}

async function loadGenreAppData(
  genreId: string,
  granularity: 'month' | 'week'
): Promise<{ apps: AppScoreInput[]; periods: string[] }> {
  const timeField = granularity === 'week' ? 'week' : 'month';
  let query = db.collection('snapshots')
    .where('genreId', '==', genreId)
    .orderBy(timeField, 'asc');

  if (granularity === 'week') {
    query = query.where('granularity', '==', 'week');
  }

  const snapshotDocs = await query.get();
  const periods: string[] = [];
  const appDataMap = new Map<string, {
    appName: string;
    publisherName: string;
    revenueByPeriod: Record<string, number>;
    downloadsByPeriod: Record<string, number>;
  }>();

  for (const snapDoc of snapshotDocs.docs) {
    const period = snapDoc.data()[timeField] as string;
    if (!period) continue;
    periods.push(period);

    const appsDocs = await snapDoc.ref.collection('apps').get();
    for (const appDoc of appsDocs.docs) {
      const data = appDoc.data();
      const appId = data.unifiedAppId || appDoc.id;

      if (!appDataMap.has(appId)) {
        appDataMap.set(appId, {
          appName: data.unifiedAppName || 'Unknown',
          publisherName: data.publisherName || 'Unknown',
          revenueByPeriod: {},
          downloadsByPeriod: {},
        });
      }

      const entry = appDataMap.get(appId)!;
      entry.revenueByPeriod[period] = data.storeRevenue || 0;
      entry.downloadsByPeriod[period] = data.downloads || 0;
    }
  }

  const apps: AppScoreInput[] = Array.from(appDataMap.entries()).map(
    ([appId, data]) => ({
      appId,
      appName: data.appName,
      publisherName: data.publisherName,
      revenueByPeriod: data.revenueByPeriod,
      downloadsByPeriod: data.downloadsByPeriod,
    })
  );

  return { apps, periods };
}

export async function runInsightsPipeline(
  genre: GenreConfig,
  granularity: 'month' | 'week' = 'month'
): Promise<{ scored: number; topApps: ScoredApp[] }> {
  const { apps, periods } = await loadGenreAppData(genre.id, granularity);

  if (apps.length === 0 || periods.length < 2) {
    return { scored: 0, topApps: [] };
  }

  const allScored = apps.map(computeRisingStarScore);
  allScored.sort((a, b) => b.score - a.score);

  const topApps = allScored.slice(0, 5);
  const watchCandidates = allScored.slice(5, 10);

  const periodData: Record<string, Record<string, { revenue: number; downloads: number }>> = {};
  for (const app of [...topApps, ...watchCandidates]) {
    const inputApp = apps.find(a => a.appId === app.appId);
    if (!inputApp) continue;
    periodData[app.appId] = {};
    for (const p of periods) {
      periodData[app.appId][p] = {
        revenue: inputApp.revenueByPeriod[p] || 0,
        downloads: inputApp.downloadsByPeriod[p] || 0,
      };
    }
  }

  let insight;
  try {
    insight = await generateGenreInsights(genre.name, topApps, watchCandidates, periodData);
  } catch (err) {
    console.error(`Gemini insight generation failed for ${genre.name}:`, err);
    insight = {
      summary: `Top rising games in ${genre.name} based on revenue acceleration, download momentum, anomaly detection, and cross-metric convergence.`,
      games: topApps.map((app, i) => ({
        ...app,
        rank: i + 1,
        explanation: 'AI analysis unavailable.',
      })),
      watchList: watchCandidates.slice(0, 2).map(app => ({
        ...app,
        reason: 'Score approaching top 5 threshold.',
      })),
    };
  }

  const latestPeriod = periods[periods.length - 1];
  const docId = `${genre.id}_${latestPeriod}`;

  await db.collection('insights').doc(docId).set({
    genreId: genre.id,
    period: latestPeriod,
    granularity,
    generatedAt: Timestamp.now(),
    summary: insight.summary,
    games: insight.games,
    watchList: insight.watchList,
  });

  // Store individual scores for all apps (for Dashboard AI Score column)
  // Firestore batch limit is 500 operations; split if needed
  const BATCH_SIZE = 400;
  const scoresRef = db.collection('insights').doc(docId).collection('scores');
  for (let i = 0; i < allScored.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = allScored.slice(i, i + BATCH_SIZE);
    for (const scored of chunk) {
      batch.set(scoresRef.doc(scored.appId), {
        appId: scored.appId,
        score: scored.score,
        subScores: scored.subScores,
        computedAt: Timestamp.now(),
      });
    }
    await batch.commit();
  }

  return { scored: allScored.length, topApps };
}

export async function runAllGenreInsights(
  granularity: 'month' | 'week' = 'month'
): Promise<{ genresProcessed: string[]; errors: string[] }> {
  const genresSnap = await db.collection('genres').where('active', '==', true).get();
  const genres = genresSnap.docs.map(doc => ({
    id: doc.id,
    name: doc.data().name as string,
  }));

  const results: string[] = [];
  const errors: string[] = [];

  for (const genre of genres) {
    try {
      const { scored } = await runInsightsPipeline(genre, granularity);
      results.push(genre.name);
      console.log(`Insights generated for ${genre.name}: ${scored} apps scored`);
    } catch (err) {
      const msg = `Failed to generate insights for ${genre.name}: ${err}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  return { genresProcessed: results, errors };
}
