/**
 * One-time backfill for the `genreAggregates` dashboard read model.
 *
 * The weekly fetch and the interactive fetch routes now write a pre-pivoted
 * aggregate doc per genre + granularity. Existing genres whose data was already
 * fetched won't have one until their next fetch, so this script builds them all
 * up front from the existing snapshots.
 *
 * Run from the repo root (uses your gcloud application-default credentials, or
 * GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key):
 *
 *   NODE_PATH=functions/node_modules \
 *   npx tsx scripts/backfill-genre-aggregates.ts
 *
 * Safe to re-run: rebuildGenreAggregate is idempotent (it overwrites the doc).
 */
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { rebuildGenreAggregate, type Granularity } from '../functions/src/aggregates/genreAggregate';

admin.initializeApp();
const db = getFirestore('companalysis');

async function main() {
  const genresSnap = await db.collection('genres').get();
  if (genresSnap.empty) {
    console.log('No genres found — nothing to backfill.');
    return;
  }

  const granularities: Granularity[] = ['month', 'week'];
  let built = 0;
  let skipped = 0;
  let trimmedCount = 0;

  for (const doc of genresSnap.docs) {
    const genre = { id: doc.id, name: (doc.data().name as string) || doc.id };
    for (const granularity of granularities) {
      try {
        const { appCount, months, trimmed, trimmedGrowing, growingCount } = await rebuildGenreAggregate(
          genre,
          granularity,
          db,
        );
        if (months.length === 0) {
          skipped++;
          console.log(`  · ${genre.name} [${granularity}]: no snapshots, skipped`);
          continue;
        }
        built++;
        if (trimmed) trimmedCount++;
        console.log(
          `  ✓ ${genre.name} [${granularity}]: ${appCount} apps × ${months.length} periods, ` +
            `${growingCount} growing (all kept${trimmedGrowing ? ' — WARNING: some growers trimmed!' : ''})` +
            (trimmed ? ' — tail trimmed to fit 1MiB' : ''),
        );
      } catch (err) {
        console.error(`  ✗ ${genre.name} [${granularity}] failed:`, err);
      }
    }
  }

  console.log(
    `\nBackfill complete. Built ${built} aggregate(s), skipped ${skipped} empty, ${trimmedCount} trimmed.`,
  );
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
