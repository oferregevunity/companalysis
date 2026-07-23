/**
 * One-time recompute of the stored Rising Star scores after the $500/day
 * revenue floor was added to the scoring engine.
 *
 * Only the LATEST insight doc per genre + granularity is recomputed — that is
 * the only one the dashboard (`useAppScores`) and Insights page (`useInsights`)
 * ever read. Each doc is re-scored "as of" its own period (the snapshot series
 * is sliced to periods <= the doc's period), so the numbers match what the
 * pipeline would have produced with the new logic. Only the `scores`
 * subcollection is overwritten — Gemini narratives (summary/games/watchList)
 * are left untouched.
 *
 * Run from the repo root (uses your gcloud application-default credentials, or
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key):
 *
 *   Dry run (no writes, prints what would change):
 *     NODE_PATH=functions/node_modules \
 *     npx tsx scripts/backfill-rising-scores.ts --dry-run
 *
 *   Apply:
 *     NODE_PATH=functions/node_modules \
 *     npx tsx scripts/backfill-rising-scores.ts
 *
 * Safe to re-run: overwrites score docs idempotently.
 */
import * as admin from 'firebase-admin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { loadGenreAppData } from '../functions/src/insights/pipeline';
import { computeRisingStarScore } from '../functions/src/insights/scoringEngine';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 400;

admin.initializeApp({
  projectId:
    process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'supersonic-291210',
});
const db = getFirestore('companalysis');

type Granularity = 'month' | 'week';

/** Restrict an app's period map to periods <= the given period (lexicographic
 * compare is correct within a single granularity, e.g. "2025-01" / "2025-W03"). */
function sliceUpTo(byPeriod: Record<string, number>, period: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [p, v] of Object.entries(byPeriod)) {
    if (p <= period) out[p] = v;
  }
  return out;
}

async function recomputeLatest(
  genre: { id: string; name: string },
  granularity: Granularity
): Promise<{ status: string }> {
  const insightSnap = await db
    .collection('insights')
    .where('genreId', '==', genre.id)
    .where('granularity', '==', granularity)
    .orderBy('generatedAt', 'desc')
    .limit(1)
    .get();

  if (insightSnap.empty) return { status: 'no insight doc' };

  const insightDoc = insightSnap.docs[0];
  const period = insightDoc.data().period as string;
  if (!period) return { status: 'insight doc has no period' };

  const { apps } = await loadGenreAppData(genre.id, granularity);
  if (apps.length === 0) return { status: 'no snapshot data' };

  const scored = apps.map((app) =>
    computeRisingStarScore({
      ...app,
      revenueByPeriod: sliceUpTo(app.revenueByPeriod, period),
      downloadsByPeriod: sliceUpTo(app.downloadsByPeriod, period),
    })
  );

  if (DRY_RUN) {
    const top = [...scored].sort((a, b) => b.score - a.score).slice(0, 3);
    const preview = top.map((s) => `${s.appName}=${s.score}`).join(', ');
    return { status: `would rewrite ${scored.length} scores in ${insightDoc.id} (top: ${preview})` };
  }

  const scoresRef = insightDoc.ref.collection('scores');
  for (let i = 0; i < scored.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const s of scored.slice(i, i + BATCH_SIZE)) {
      batch.set(scoresRef.doc(s.appId), {
        appId: s.appId,
        score: s.score,
        subScores: s.subScores,
        computedAt: Timestamp.now(),
      });
    }
    await batch.commit();
  }

  return { status: `rewrote ${scored.length} scores in ${insightDoc.id}` };
}

async function main() {
  console.log(DRY_RUN ? '=== DRY RUN (no writes) ===' : '=== APPLYING score recompute ===');
  const genresSnap = await db.collection('genres').get();
  if (genresSnap.empty) {
    console.log('No genres found — nothing to do.');
    return;
  }

  const granularities: Granularity[] = ['month', 'week'];
  let touched = 0;
  let skipped = 0;

  for (const doc of genresSnap.docs) {
    const genre = { id: doc.id, name: (doc.data().name as string) || doc.id };
    for (const granularity of granularities) {
      try {
        const { status } = await recomputeLatest(genre, granularity);
        if (status.startsWith('rewrote') || status.startsWith('would rewrite')) touched++;
        else skipped++;
        console.log(`  ${genre.name} [${granularity}]: ${status}`);
      } catch (err) {
        skipped++;
        console.error(`  ✗ ${genre.name} [${granularity}] failed:`, err);
      }
    }
  }

  console.log(`\nDone. ${touched} doc(s) ${DRY_RUN ? 'would be' : ''} updated, ${skipped} skipped.`);
}

main().catch((err) => {
  console.error('Recompute failed:', err);
  process.exit(1);
});
