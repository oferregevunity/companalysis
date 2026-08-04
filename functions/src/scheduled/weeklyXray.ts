import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { appbirdApiKey } from '../appbird/client';
import { runXraySync } from '../appbird/fetchXray';

const db = getFirestore('companalysis');

/**
 * Weekly refresh of the AppBird X-Ray corpus behind /sdks. The crawl itself is
 * ~24 calls; the bulk of the run is popularity enrichment, which is budgeted and
 * resumes next week where it stopped, so the corpus warms progressively instead
 * of spending ~1200 requests in one go. Idempotent — safe to retry.
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
    const result = await runXraySync(db, appbirdApiKey.value().trim(), { enrichLimit: 400 });
    console.log('weeklyXray:', JSON.stringify({ ...result, errors: result.errors.slice(0, 5) }));
  },
);
