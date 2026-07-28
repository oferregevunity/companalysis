/**
 * One-off maintenance: purge `appCreativeWeeks` cache markers that were frozen
 * at `creativeCount: 0`.
 *
 * Background: before the "don't cache empty fetches" fix, a per-app creative
 * fetch that returned 0 during Sensor Tower's ad-intel indexing lag was cached
 * as authoritative, so a clearly-advertising game stayed at "0 creatives" for
 * the whole week across every workspace. Deleting the zero-count markers lets
 * those app+week pairs re-fetch fresh (with the new wider window) on next
 * access. Non-zero markers are left untouched.
 *
 * Auth: uses the Admin SDK via Application Default Credentials. If you see
 * `invalid_rapt` / `reauth related error`, refresh ADC first:
 *   gcloud auth application-default login
 *
 * Run (dry run — counts only, no writes):
 *   NODE_PATH=functions/node_modules node scripts/purge-empty-app-creative-weeks.cjs
 * Apply the deletions:
 *   NODE_PATH=functions/node_modules node scripts/purge-empty-app-creative-weeks.cjs --apply
 */
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const APPLY = process.argv.includes('--apply');
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'supersonic-291210';
const BATCH = 400;

async function main() {
  initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore('companalysis');

  const snap = await db.collection('appCreativeWeeks').where('creativeCount', '==', 0).get();
  const docs = snap.docs;
  console.log(`Found ${docs.length} appCreativeWeeks marker(s) with creativeCount == 0.`);

  // Small sample so the operator can sanity-check what will be removed.
  for (const d of docs.slice(0, 10)) {
    const x = d.data();
    console.log(`  - ${d.id}  (app=${x.appId ?? '?'} week=${x.week ?? '?'} country=${x.country ?? '?'})`);
  }
  if (docs.length > 10) console.log(`  … and ${docs.length - 10} more`);

  if (!APPLY) {
    console.log('\nDry run — no documents deleted. Re-run with --apply to delete them.');
    return;
  }
  if (docs.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  let deleted = 0;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const batch = db.batch();
    for (const d of chunk) batch.delete(d.ref);
    await batch.commit();
    deleted += chunk.length;
    console.log(`  deleted ${deleted}/${docs.length}`);
  }
  console.log(`\nDone. Deleted ${deleted} zero-count marker(s). They will re-fetch fresh on next access.`);
}

main().catch(err => {
  console.error('Purge failed:', (err && err.message ? err.message : String(err)).slice(0, 300));
  process.exit(1);
});
