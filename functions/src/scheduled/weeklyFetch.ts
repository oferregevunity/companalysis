import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { refreshRecentWorkspaces } from '../gameWorkspaces/refreshWorkspaces';
import { reapStaleCreatives } from '../adIntel/reaper';
import { fetchAndStoreMonth, fetchAndStoreWeek, getMissingMonths, getMissingWeeks, getLastNWeeks } from '../sensorTower/fetchTopApps';
import { rebuildGenreAggregate } from '../aggregates/genreAggregate';
import { runAllGenreInsights } from '../insights/pipeline';
import { sensorTowerAuthToken } from '../sensorTower/client';
import { weeklyScheduledRunDocId } from './weeklyRunId';

const db = getFirestore('companalysis');

const TIME_BUDGET_MS = 25 * 60 * 1000; // 25 min — leaves 5 min buffer under 1800s timeout

/** Sensor Tower app data for all active genres. Resumes from prior progress on retry. */
export const weeklyFetchApps = onSchedule(
  {
    schedule: 'every monday 06:00',
    timeZone: 'America/New_York',
    timeoutSeconds: 1800,
    memory: '2GiB',
    secrets: [sensorTowerAuthToken],
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  },
  async () => {
    const startTime = Date.now();
    const authToken = sensorTowerAuthToken.value().trim();
    const weeklyId = weeklyScheduledRunDocId();
    const logRef = db.collection('fetchLogs').doc(weeklyId);

    const existing = await logRef.get();
    const existingData = existing.exists ? existing.data()! : null;

    if (existingData?.appsPhase === 'completed') {
      console.log(`weeklyFetchApps: skip, apps already completed for ${weeklyId}`);
      return;
    }

    const alreadyProcessed: string[] = Array.isArray(existingData?.genresProcessed)
      ? existingData.genresProcessed
      : [];

    if (!existing.exists) {
      await logRef.set({
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'running',
        scheduleRunId: weeklyId,
        genresProcessed: [],
        errors: [],
        appsPhase: 'running',
        creativesPhase: 'pending',
      });
    } else {
      await logRef.update({
        status: 'running',
        appsPhase: 'running',
        resumedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    const genresSnapshot = await db.collection('genres').where('active', '==', true).get();
    const allErrors: string[] = Array.isArray(existingData?.errors) ? [...existingData.errors] : [];
    const processedThisRun: string[] = [];
    let timedOut = false;

    try {
      for (const doc of genresSnapshot.docs) {
        const genre = { id: doc.id, ...doc.data() } as any;

        if (alreadyProcessed.includes(genre.name)) {
          console.log(`weeklyFetchApps: skip already-completed genre ${genre.name}`);
          continue;
        }

        if (Date.now() - startTime > TIME_BUDGET_MS) {
          console.warn(
            `weeklyFetchApps: time budget exceeded (${Math.round((Date.now() - startTime) / 1000)}s) — saving progress`,
          );
          timedOut = true;
          break;
        }

        try {
          const missingMonths = await getMissingMonths(genre);
          const missingWeeks = await getMissingWeeks(genre);

          if (missingMonths.length === 0 && missingWeeks.length === 0) {
            console.log(`weeklyFetchApps: all months+weeks present for ${genre.name}, marking done`);
            processedThisRun.push(genre.name);
            continue;
          }

          const errors: string[] = [];
          for (const monthInfo of missingMonths) {
            const result = await fetchAndStoreMonth(genre, monthInfo, authToken);
            if (!result.success && result.error) {
              errors.push(result.error);
            }
          }
          for (const weekInfo of missingWeeks) {
            const result = await fetchAndStoreWeek(genre, weekInfo, authToken);
            if (!result.success && result.error) {
              errors.push(result.error);
            }
          }

          // Refresh the dashboard read-model for whichever granularity got new data.
          if (missingMonths.length > 0) {
            try {
              await rebuildGenreAggregate(genre, 'month', db);
            } catch (err) {
              errors.push(`Aggregate (month) rebuild failed for ${genre.name}: ${err}`);
            }
          }
          if (missingWeeks.length > 0) {
            try {
              await rebuildGenreAggregate(genre, 'week', db);
            } catch (err) {
              errors.push(`Aggregate (week) rebuild failed for ${genre.name}: ${err}`);
            }
          }

          processedThisRun.push(genre.name);
          if (errors.length > 0) {
            allErrors.push(...errors);
          }
        } catch (error) {
          allErrors.push(`Failed to process ${genre.name}: ${error}`);
        }
      }

      const allProcessed = [...alreadyProcessed, ...processedThisRun];

      if (timedOut) {
        await logRef.update({
          appsPhase: 'partial',
          genresProcessed: allProcessed,
          errors: allErrors,
        });
        console.log(
          `weeklyFetchApps partial for ${weeklyId}. Done so far: ${allProcessed.join(', ')}. Will retry.`,
        );
        throw new Error(
          `weeklyFetchApps: time budget exceeded after ${allProcessed.length} genres — retrying`,
        );
      }

      await logRef.update({
        appsPhase: 'completed',
        appsCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        genresProcessed: allProcessed,
        errors: allErrors,
      });

      console.log(
        `weeklyFetchApps complete for ${weeklyId}. Processed: ${allProcessed.join(', ')}. Errors: ${allErrors.length}`,
      );

      // All genres now have fresh data — regenerate Rising Star insights for
      // both granularities. runAllGenreInsights refreshes each genre's
      // insight doc (incl. within-genre game ideas) and, across all genres,
      // writes the crossGenreInsights/{granularity} synthesis. Wrapped so a
      // failure here never fails the fetch job (which is already marked done).
      try {
        for (const gran of ['month', 'week'] as const) {
          const { genresProcessed, errors } = await runAllGenreInsights(gran);
          console.log(
            `weekly insights (${gran}): ${genresProcessed.length} genres, ${errors.length} errors`,
          );
          if (errors.length > 0) {
            await logRef.update({ errors: admin.firestore.FieldValue.arrayUnion(...errors) });
          }
        }
      } catch (err) {
        const msg = `Weekly insights generation failed: ${err instanceof Error ? err.message : err}`;
        console.error(msg);
        await logRef.update({ errors: admin.firestore.FieldValue.arrayUnion(msg) });
      }
    } catch (e) {
      const current = await logRef.get();
      if (current.data()?.appsPhase === 'partial') {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      await logRef.update({
        appsPhase: 'failed',
        appsCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
        errors: admin.firestore.FieldValue.arrayUnion(`Apps job crashed: ${msg}`),
      });
      throw e;
    }
  },
);

async function runCreativesPhase(): Promise<void> {
  const authToken = sensorTowerAuthToken.value().trim();
  const weeklyId = weeklyScheduledRunDocId();
  const logRef = db.collection('fetchLogs').doc(weeklyId);
  const snap = await logRef.get();

  if (!snap.exists) {
    console.error(`weeklyFetchCreatives: missing fetchLogs/${weeklyId} — apps job may not have run`);
    return;
  }

  const data = snap.data()!;

  if (data.appsPhase === 'partial' || data.appsPhase === 'running') {
    console.log(
      `weeklyFetchCreatives: apps phase is "${data.appsPhase}" — retries still pending, skipping for now`,
    );
    return;
  }

  if (data.appsPhase !== 'completed') {
    const prevErrs = Array.isArray(data.errors) ? [...data.errors] : [];
    const msg = `Creatives skipped: apps phase is "${String(data.appsPhase)}"`;
    await logRef.update({
      creativesPhase: 'skipped',
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'failed',
      errors: [...prevErrs, msg],
    });
    console.error(`weeklyFetchCreatives: ${msg}`);
    return;
  }

  if (data.creativesPhase === 'completed') {
    console.log(`weeklyFetchCreatives: skip, already completed for ${weeklyId}`);
    return;
  }

  await logRef.update({ creativesPhase: 'running' });

  const allErrors: string[] = Array.isArray(data.errors) ? [...data.errors] : [];
  const [prevWeek] = getLastNWeeks(1);

  // Game workspaces replaced genre-scoped creative analysis: refresh every
  // workspace a human touched in the last 30 days for the new week. The
  // shared app+week cache dedupes overlapping competitor sets.
  try {
    const r = await refreshRecentWorkspaces({
      authToken,
      weekStart: prevWeek.startDate,
      weekEnd: prevWeek.endDate,
      deadlineMs: Date.now() + TIME_BUDGET_MS,
    });
    console.log(
      `Workspace refresh: refreshed=${r.refreshed} skipped=${r.skipped} errors=${r.errors.length}`,
    );
    if (r.errors.length > 0) {
      allErrors.push(...r.errors);
    }
  } catch (err) {
    allErrors.push(`Workspace refresh failed: ${err instanceof Error ? err.message : err}`);
  }

  try {
    const reaped = await reapStaleCreatives();
    console.log(`Reaped ${reaped} stale creatives`);
  } catch (err) {
    allErrors.push(`Creative reaper failed: ${err instanceof Error ? err.message : err}`);
  }

  await logRef.update({
    creativesPhase: 'completed',
    creativesCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: allErrors.length === 0 ? 'completed' : 'failed',
    errors: allErrors,
  });

  console.log(`weeklyFetchCreatives complete for ${weeklyId}. Errors: ${allErrors.length}`);
}

/** Creative pipeline + reaper. Runs after apps phase. */
export const weeklyFetchCreatives = onSchedule(
  {
    schedule: 'every monday 07:00',
    timeZone: 'America/New_York',
    timeoutSeconds: 1800,
    memory: '2GiB',
    secrets: [sensorTowerAuthToken],
  },
  runCreativesPhase,
);

/** Fallback creatives schedule — catches the case where apps retries finish after 07:00. */
export const weeklyFetchCreativesFallback = onSchedule(
  {
    schedule: 'every monday 09:00',
    timeZone: 'America/New_York',
    timeoutSeconds: 1800,
    memory: '2GiB',
    secrets: [sensorTowerAuthToken],
  },
  runCreativesPhase,
);

/**
 * Cross-genre "Market Pulse": scans the opted-in genres for the latest
 * completed week (fetch + hook/theme tag via the genre creative pipeline),
 * then aggregates rising concepts across genres into `marketPulse/{week}`.
 * Runs after the creatives phase so genre app data is already fresh.
 */
export const weeklyMarketPulse = onSchedule(
  {
    schedule: 'every monday 11:00',
    timeZone: 'America/New_York',
    timeoutSeconds: 1800,
    memory: '2GiB',
    secrets: [sensorTowerAuthToken],
  },
  async () => {
    const authToken = sensorTowerAuthToken.value().trim();
    const [prevWeek] = getLastNWeeks(1);
    const { runMarketPulse } = await import('../marketPulse/runPulse');
    const result = await runMarketPulse({
      authToken,
      weekStart: prevWeek.startDate,
      weekEnd: prevWeek.endDate,
      deadlineMs: Date.now() + TIME_BUDGET_MS,
    });
    console.log(
      `weeklyMarketPulse: week=${result.week} genres=${result.genresScanned} rising=${result.risingConcepts} errors=${result.errors.length}`,
    );
  },
);
