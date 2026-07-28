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
 * Trailing window (days, ending at the selected week's Sunday) the per-app
 * workspace fetch pulls from Sensor Tower. A single 7-day week is too narrow:
 * Sensor Tower's ad-intel coverage of any given app in a single week is spotty
 * and lags real time, so adjacent games swung between 0 and hundreds of
 * creatives. A ~4-week trailing window smooths that out; docs still carry the
 * canonical week key (derived from `weekStart`), so the week-based UI is
 * unaffected.
 */
const FETCH_WINDOW_DAYS = 28;

/** Add `n` days to a `YYYY-MM-DD` date, returning `YYYY-MM-DD` (UTC). */
function addUtcDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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
  // Pull a trailing window ending at the selected week, not just the 7-day week.
  const fetchStartDate = addUtcDays(weekEnd, -(FETCH_WINDOW_DAYS - 1));

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
    fetchStartDate,
    fetchEndDate: weekEnd,
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

  // Only freeze a cache marker for a fully-successful, NON-EMPTY fetch. A
  // partial failure (some networks errored) or an empty result must stay
  // retryable without `force`: Sensor Tower's ad-intel index lags real time, so
  // an app that returns 0 today may well return creatives once indexing catches
  // up. Caching that 0 as authoritative was freezing clearly-advertising games
  // at "0 creatives" for the whole week while others showed hundreds.
  if (result.success && storedCount > 0) {
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
