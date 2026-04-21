/**
 * Verifies that our Firestore `snapshots/.../apps[].unifiedAppId` values are
 * the same unified Mongo-style IDs that Sensor Tower's Ad Intel endpoint
 * expects in its `app_ids` param.
 *
 * Run from the repo root of a feat/ad-creatives worktree:
 *   NODE_PATH=functions/node_modules \
 *   SENSOR_TOWER_AUTH_TOKEN="$(firebase functions:secrets:access SENSOR_TOWER_AUTH_TOKEN)" \
 *   npx tsx scripts/verify-unified-app-id.ts
 *
 * Exit codes:
 *   0 = compatible (Ad Intel returned a 200 with a non-empty ad_units for a
 *                    sampled unifiedAppId, over a wide date window)
 *   1 = empty for every sampled app (IDs are NOT compatible)
 *   2 = missing env var / no apps in Firestore / no credentials
 *   3 = unexpected runtime failure (not an auth verdict)
 */
import fetch from 'node-fetch';
import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

const BASE_URL = 'https://api.sensortower.com/v1';

/** Widen sampling / networks per Task 0.3 when a single network returns empty for all samples. */
const APPS_LIMIT = 20;
const NETWORKS_TO_TRY = ['Instagram', 'TikTok', 'Facebook'] as const;

function redactTokenFromMessage(s: unknown): string {
  const str = s instanceof Error ? s.message : typeof s === 'string' ? s : String(s ?? '');
  return str.replace(/auth_token=[^&\s]+/g, 'auth_token=<REDACTED>');
}

async function main() {
  const token = process.env.SENSOR_TOWER_AUTH_TOKEN?.trim();
  if (!token) {
    console.error('Set SENSOR_TOWER_AUTH_TOKEN (copy from Firebase Secret Manager).');
    process.exit(2);
  }

  admin.initializeApp();
  const db = getFirestore('companalysis');

  // Avoid composite index on month != null + orderBy; order only, then pick first with month set.
  const snaps = await db
    .collection('snapshots')
    .orderBy('month', 'desc')
    .limit(10)
    .get();
  if (snaps.empty) {
    console.error('No snapshots in Firestore to sample from.');
    process.exit(2);
  }
  const latest =
    snaps.docs.find(d => {
      const m = d.data().month;
      return m != null;
    }) ?? snaps.docs[0];
  const appsSnap = await latest.ref.collection('apps').limit(APPS_LIMIT).get();
  if (appsSnap.empty) {
    console.error(`Snapshot ${latest.id} has no apps.`);
    process.exit(2);
  }

  const sampled = appsSnap.docs.map(d => {
    const data = d.data();
    return {
      unifiedAppId: (data.unifiedAppId as string) ?? d.id,
      name: (data.unifiedAppName as string) ?? '(unknown)',
      iosAppId: (data.iosAppId as string | null) ?? null,
    };
  });

  console.log(`Testing ${sampled.length} apps from snapshot ${latest.id}:`);
  for (const app of sampled) {
    console.log(`  - ${app.name} (unified=${app.unifiedAppId}, ios=${app.iosAppId ?? '-'})`);
  }

  const qs = (id: string, networks: string) =>
    new URLSearchParams({
      auth_token: token,
      app_ids: id,
      start_date: '2023-01-01',
      end_date: '2026-04-01',
      networks,
      countries: 'US',
      ad_types: 'video',
      limit: '5',
    }).toString();

  let anyHit = false;

  outer: for (const app of sampled) {
    for (const network of NETWORKS_TO_TRY) {
      const res = await fetch(`${BASE_URL}/unified/ad_intel/creatives?${qs(app.unifiedAppId, network)}`);
      const status = res.status;
      const body: { ad_units?: unknown } = await res.json().catch(() => ({}));
      const count = Array.isArray(body.ad_units) ? body.ad_units.length : 0;
      console.log(`  → ${app.name} [${network}]: status=${status} ad_units=${count}`);
      if (status === 200 && count > 0) {
        anyHit = true;
        break outer;
      }
    }
  }

  if (anyHit) {
    console.log('\n✅ Our unifiedAppId values ARE compatible with Ad Intel. Phase 1 GO.');
    process.exit(0);
  }
  console.error('\n❌ Every sampled app returned empty ad_units. Either:');
  console.error('   (a) The IDs are not Mongo-style unified IDs, OR');
  console.error('   (b) None of the sampled apps have creatives on the tried networks in the window.');
  console.error('   Retry with more samples / different networks before concluding (a).');
  process.exit(1);
}

main().catch(err => {
  console.error(
    'Verification failed unexpectedly (network/runtime error, not an auth verdict):',
    redactTokenFromMessage(err)
  );
  process.exit(3);
});
