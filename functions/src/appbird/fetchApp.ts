import { createHash } from 'crypto';
import * as admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { getApp, type AppbirdApp } from './client';

/**
 * AppBird bills per request, and a store listing barely moves day to day — so app
 * details are cached in `appbirdApps` and only refetched when stale (or when the
 * caller explicitly asks). Clients never read the collection directly; they go
 * through the `appbird/app` route.
 */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const COLLECTION = 'appbirdApps';

/**
 * Deterministic doc id for a store id. Package names contain dots (legal in a
 * doc id) but we hash anyway so nothing — leading dots, slashes, `__`-prefixes,
 * over-long ids — can produce an invalid path.
 */
export function appDocId(storeId: string): string {
  return createHash('sha1').update(storeId).digest('hex').slice(0, 24);
}

export interface AppDetailsResult {
  app: AppbirdApp;
  /** ISO time the listing was pulled from AppBird. */
  fetchedAt: string;
  /** True when served from Firestore without hitting AppBird. */
  fromCache: boolean;
}

/**
 * Read one app's details, preferring the Firestore cache. `refresh: true` forces
 * a live fetch. On an AppBird failure a stale cached copy is served rather than
 * erroring — a day-old listing beats an empty detail screen.
 */
export async function getAppDetails(
  db: Firestore,
  storeId: string,
  apiKey: string,
  opts: { refresh?: boolean } = {},
): Promise<AppDetailsResult> {
  const ref = db.collection(COLLECTION).doc(appDocId(storeId));

  let cached: { app: AppbirdApp; fetchedAt: string } | null = null;
  try {
    const snap = await ref.get();
    const data = snap.data();
    if (data?.app) {
      const ts = data.fetchedAt as admin.firestore.Timestamp | undefined;
      cached = { app: data.app as AppbirdApp, fetchedAt: ts ? ts.toDate().toISOString() : '' };
      const ageMs = ts ? Date.now() - ts.toMillis() : Number.POSITIVE_INFINITY;
      if (!opts.refresh && ageMs < CACHE_TTL_MS) {
        return { app: cached.app, fetchedAt: cached.fetchedAt, fromCache: true };
      }
    }
  } catch (err) {
    console.warn(`appbirdApps cache read failed for ${storeId}:`, err);
  }

  let app: AppbirdApp;
  try {
    app = await getApp(storeId, apiKey);
  } catch (err) {
    if (cached) {
      console.warn(`AppBird fetch failed for ${storeId}, serving stale cache:`, err);
      return { app: cached.app, fetchedAt: cached.fetchedAt, fromCache: true };
    }
    throw err;
  }

  const fetchedAt = new Date();
  try {
    await ref.set({
      storeId,
      app,
      fetchedAt: admin.firestore.Timestamp.fromDate(fetchedAt),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    // A cache-write failure must not fail the request — we already have the data.
    console.warn(`appbirdApps cache write failed for ${storeId}:`, err);
  }

  return { app, fetchedAt: fetchedAt.toISOString(), fromCache: false };
}
