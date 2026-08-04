import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { appbirdApiKey } from '../appbird/client';
import { runOwnershipTransfers } from '../appbird/fetchTransfers';

const db = getFirestore('companalysis');

/**
 * Weekly refresh of the AppBird ownership-transfers feed. Cheap (~15 developer
 * calls, 5 credits each) and fast, so it runs standalone ahead of the heavier
 * Sensor Tower jobs. Idempotent — safe to retry.
 */
export const weeklyOwnershipTransfers = onSchedule(
  {
    schedule: 'every monday 05:30',
    timeZone: 'America/New_York',
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [appbirdApiKey],
    retryCount: 3,
    minBackoffSeconds: 60,
    maxBackoffSeconds: 300,
  },
  async () => {
    const result = await runOwnershipTransfers(db, appbirdApiKey.value().trim());
    console.log('weeklyOwnershipTransfers:', JSON.stringify(result));
  },
);
