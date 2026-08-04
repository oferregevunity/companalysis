import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { refreshXrayReadModel } from '../appbird/fetchXray';

const db = getFirestore('companalysis');

/**
 * Weekly maintenance for the /sdks read model. Spends NO AppBird credits.
 *
 * This job used to crawl X-Ray and pre-fetch store popularity every week, which
 * meant the allowance was being spent on data nobody had asked for — a full crawl
 * alone is ~3,600 credits, and the plan is 20,000 per period shared with other
 * consumers. Every billable X-Ray call is now user-initiated:
 *
 * - a teardown (500) when someone opens a game on /sdks
 * - a membership resolve (150) when someone picks an integration
 * - a crawl for new teardowns (150) when someone asks for it from the UI
 * - store popularity (5/app) via the "Rank N more" button
 *
 * What remains worth doing on a schedule is free: rebuilding the facet leaderboards
 * from the rows already in Firestore, so rows backfilled by integration queries and
 * any change to the grouping rules show up without a crawl.
 *
 * No secrets are bound, which makes the no-spend guarantee structural rather than a
 * matter of passing the right options — this function cannot call AppBird at all.
 */
export const weeklyXray = onSchedule(
  {
    schedule: 'every monday 05:45',
    timeZone: 'America/New_York',
    timeoutSeconds: 300,
    memory: '512MiB',
    retryCount: 1,
  },
  async () => {
    const result = await refreshXrayReadModel(db);
    console.log('weeklyXray:', JSON.stringify(result));
  },
);
