import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { appbirdApiKey } from '../appbird/client';
import { runXraySync } from '../appbird/fetchXray';

const db = getFirestore('companalysis');

/**
 * Weekly refresh of the AppBird X-Ray corpus behind /sdks.
 *
 * Kept deliberately cheap, because report pages are the most expensive thing this
 * app buys — 150 credits each, against 5 for an app listing. The weekly crawl is
 * incremental: one page covers a week of new teardowns. The full ~24-page crawl
 * (~3,600 credits) runs at most quarterly.
 *
 * Popularity enrichment sweeps a fixed slice of the corpus per run, resuming where
 * it stopped rather than re-fetching the newest apps every week.
 *
 * On retry (`retryCount` below), note that `syncXrayReports` persists the crawl and
 * its sync state BEFORE enrichment runs — so a retry after a later failure resumes
 * incrementally instead of paying for the whole crawl again.
 *
 * `runXraySync` also refuses to start once this month's credit budget is spent, and
 * caps the crawl to the pages that budget can still afford. Idempotent.
 */
export const weeklyXray = onSchedule(
  {
    schedule: 'every monday 05:45',
    timeZone: 'America/New_York',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [appbirdApiKey],
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  },
  async () => {
    const result = await runXraySync(db, appbirdApiKey.value().trim(), {
      /**
       * One slice of the rotating popularity sweep per week. In credits this is the
       * cheap half of the job: ~100 app listings × 5 = ~500/week, versus 150 for the
       * weekly crawl page and ~3,600 for the quarterly full crawl.
       */
      enrichLimit: 100,
      callBudget: 110,
    });
    console.log('weeklyXray:', JSON.stringify({ ...result, errors: result.errors.slice(0, 5) }));
  },
);
