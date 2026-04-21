import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { runCreativePipelineForGenre } from '../creativeInsights/runForGenre';
import { reapStaleCreatives } from '../adIntel/reaper';
import { fetchAndStoreGenre, getLastNWeeks } from '../sensorTower/fetchTopApps';
import { sensorTowerAuthToken } from '../sensorTower/client';

const db = getFirestore('companalysis');

export const weeklyFetch = onSchedule(
  {
    schedule: 'every monday 06:00',
    timeZone: 'America/New_York',
    timeoutSeconds: 540,
    memory: '2GiB',
    secrets: [sensorTowerAuthToken],
  },
  async () => {
    const authToken = sensorTowerAuthToken.value().trim();
    
    const logRef = db.collection('fetchLogs').doc();
    await logRef.set({
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'running',
      genresProcessed: [],
      errors: [],
    });
    
    const genresSnapshot = await db.collection('genres').where('active', '==', true).get();
    const allErrors: string[] = [];
    const processedGenres: string[] = [];
    
    for (const doc of genresSnapshot.docs) {
      const genre = { id: doc.id, ...doc.data() } as any;
      
      try {
        const result = await fetchAndStoreGenre(genre, authToken);
        processedGenres.push(genre.name);
        if (result.errors.length > 0) {
          allErrors.push(...result.errors);
        }
      } catch (error) {
        allErrors.push(`Failed to process ${genre.name}: ${error}`);
      }
    }

    // Creative intelligence pipeline — per-genre, only if enabled
    const [prevWeek] = getLastNWeeks(1);
    for (const doc of genresSnapshot.docs) {
      const genre = { id: doc.id, ...doc.data() } as any;
      if (!genre.enableCreatives) continue;
      try {
        const r = await runCreativePipelineForGenre(
          genre,
          prevWeek.startDate,
          prevWeek.endDate,
          authToken,
        );
        console.log(
          `Creative pipeline ${genre.name}: creatives=${r.creativeCount} scored=${r.scoredCount} insights=${r.insightsGenerated}`,
        );
        if (r.partialErrors.length) {
          allErrors.push(...r.partialErrors.map(e => `[${genre.name}] ${e}`));
        }
      } catch (err) {
        allErrors.push(`Creatives failed ${genre.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    try {
      const reaped = await reapStaleCreatives();
      console.log(`Reaped ${reaped} stale creatives`);
    } catch (err) {
      allErrors.push(`Creative reaper failed: ${err instanceof Error ? err.message : err}`);
    }

    await logRef.update({
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: allErrors.length === 0 ? 'completed' : 'failed',
      genresProcessed: processedGenres,
      errors: allErrors,
    });
    
    console.log(`Weekly fetch complete. Processed: ${processedGenres.join(', ')}. Errors: ${allErrors.length}`);
  }
);
