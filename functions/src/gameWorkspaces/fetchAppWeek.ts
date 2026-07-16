import {
  creativeDocId,
  fetchCreativesForGenreWithDeps,
  weekKeyFromStart,
} from '../adIntel/fetchCreativesForGenre';

export interface FetchAppWeekResult {
  success: boolean;
  creativeCount: number;
  /** True when the app+week cache marker satisfied the request without Sensor Tower calls. */
  cached: boolean;
  partialErrors: string[];
}

/**
 * Fetch one app's creatives for a week and merge them into `creativeLatest`,
 * guarded by an `appCreativeWeeks/{appId}_{week}` cache marker so the same
 * app is fetched from Sensor Tower at most once per week — regardless of how
 * many workspaces or teammates include it.
 */
export async function fetchAppCreativesForWeek(params: {
  appId: string;
  country: string;
  weekStart: string;
  weekEnd: string;
  authToken: string;
  /** Bypass the cache marker (workspace Refresh). */
  force?: boolean;
  /** Display metadata to upsert into `appNames` so the gallery can label tiles. */
  appMeta?: { name: string; publisherName?: string | null; iconUrl?: string | null };
}): Promise<FetchAppWeekResult> {
  const { appId, country, weekStart, weekEnd, authToken, force, appMeta } = params;
  const [{ getFirestore, FieldValue }, { fetchCreativesForApp }] = await Promise.all([
    import('firebase-admin/firestore'),
    import('../adIntel/client'),
  ]);

  const db = getFirestore('companalysis');
  const week = weekKeyFromStart(weekStart);
  const markerRef = db.collection('appCreativeWeeks').doc(`${appId}_${week}`);

  if (appMeta?.name) {
    const payload: Record<string, unknown> = {
      name: appMeta.name,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (appMeta.publisherName) payload.publisherName = appMeta.publisherName;
    if (appMeta.iconUrl) payload.iconUrl = appMeta.iconUrl;
    await db.collection('appNames').doc(appId).set(payload, { merge: true });
  }

  if (!force) {
    const marker = await markerRef.get();
    if (marker.exists) {
      const data = marker.data() as { creativeCount?: number };
      return {
        success: true,
        creativeCount: typeof data.creativeCount === 'number' ? data.creativeCount : 0,
        cached: true,
        partialErrors: [],
      };
    }
  }

  let storedCount = 0;
  const result = await fetchCreativesForGenreWithDeps({
    // Pseudo-genre: only `country` matters for the fetch; creatives are
    // stamped genreId '' because workspaces query creativeLatest by appId.
    genre: { id: '', name: '', country, categoryIds: { ios: '', android: '' }, active: true },
    weekStart,
    weekEnd,
    authToken,
    watchlist: [],
    appMetadata: [],
    resolveApps: async () => [appId],
    fetchCreatives: fetchCreativesForApp,
    writeSnapshot: async docs => {
      storedCount = docs.length;
      const BATCH = 400;
      for (let i = 0; i < docs.length; i += BATCH) {
        const chunk = docs.slice(i, i + BATCH);
        const batch = db.batch();
        for (const doc of chunk) {
          batch.set(db.collection('creativeLatest').doc(creativeDocId(doc.appId, doc.creativeKey)), doc);
        }
        await batch.commit();
      }
    },
    upsertAppNames: async () => {
      /* handled above from appMeta */
    },
  });

  // Only mark fully-successful fetches as cached; a partial failure should be
  // retryable without `force`.
  if (result.success) {
    await markerRef.set({
      appId,
      week,
      country,
      creativeCount: storedCount,
      fetchedAt: FieldValue.serverTimestamp(),
    });
  }

  return {
    success: result.success,
    creativeCount: storedCount,
    cached: false,
    partialErrors: result.partialErrors,
  };
}
