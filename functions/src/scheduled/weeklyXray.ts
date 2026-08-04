import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { appbirdApiKey } from '../appbird/client';
import { runXraySync } from '../appbird/fetchXray';

const db = getFirestore('companalysis');

/**
 * Weekly refresh of the AppBird X-Ray corpus behind /sdks.
 *
 * Kept deliberately cheap, because X-Ray has its own small monthly quota: the
 * crawl is incremental (~1 call for a week of new teardowns, with a full ~24-call
 * crawl once a month), and popularity enrichment sweeps a fixed slice of the
 * corpus per run, resuming where it stopped rather than re-fetching the newest
 * apps every week. `runXraySync` also refuses to start once this month's
 * self-imposed call budget is spent. Idempotent — safe to retry.
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
       * One slice of the rotating popularity sweep per week. Sized so the whole
       * job fits the monthly budget with room for interactive use: ~100 × 4.3
       * weeks ≈ 430 calls, plus ~28 for crawling (weekly incremental + one
       * monthly full crawl), against a 600-call self-imposed cap.
       */
      enrichLimit: 100,
      callBudget: 110,
    });
    console.log('weeklyXray:', JSON.stringify({ ...result, errors: result.errors.slice(0, 5) }));
  },
);
