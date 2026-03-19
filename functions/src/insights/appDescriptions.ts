import { getFirestore } from 'firebase-admin/firestore';

function getDb() {
  return getFirestore('companalysis');
}

interface AppDescription {
  appId: string;
  description: string;
  genre?: string;
}

/**
 * Fetch a batch of iOS app descriptions from the iTunes Lookup API.
 * Returns a map of iosAppId → { description, genre }.
 * Max ~50 IDs per request to keep URL length safe.
 */
async function fetchFromItunes(
  iosAppIds: string[]
): Promise<Map<string, { description: string; genre: string }>> {
  const result = new Map<string, { description: string; genre: string }>();
  if (iosAppIds.length === 0) return result;

  const url = `https://itunes.apple.com/lookup?id=${iosAppIds.join(',')}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    clearTimeout(timeout);

    // Guard against HTML error pages
    if (!text.startsWith('{')) {
      console.warn('iTunes API returned non-JSON response, skipping');
      return result;
    }

    const json = JSON.parse(text);
    const results = json.results as any[];
    if (!Array.isArray(results)) return result;

    for (const r of results) {
      if (r.trackId && r.description) {
        result.set(String(r.trackId), {
          description: (r.description as string).slice(0, 500),
          genre: r.primaryGenreName || '',
        });
      }
    }
  } catch (err) {
    clearTimeout(timeout);
    console.warn('iTunes Lookup API call failed:', err instanceof Error ? err.message : err);
  }

  return result;
}

/**
 * Fetch app descriptions from the iTunes Lookup API and cache them in Firestore.
 * Falls back to cached descriptions if API fails. Never throws.
 */
export async function fetchAppDescriptions(
  storeIds: Map<string, { iosAppId: string | null; androidAppId: string | null }>
): Promise<Map<string, AppDescription>> {
  const result = new Map<string, AppDescription>();

  try {
    // Check cache first
    const allIds = [...storeIds.keys()];
    for (let i = 0; i < allIds.length; i += 30) {
      const chunk = allIds.slice(i, i + 30);
      const docs = await getDb().collection('appNames')
        .where('__name__', 'in', chunk).get();
      for (const doc of docs.docs) {
        const data = doc.data();
        if (data.description) {
          result.set(doc.id, {
            appId: doc.id,
            description: data.description,
            genre: data.genre || undefined,
          });
        }
      }
    }

    // Determine which apps still need descriptions
    const toFetch: { appId: string; iosAppId: string }[] = [];
    for (const [appId, ids] of storeIds) {
      if (!result.has(appId) && ids.iosAppId) {
        toFetch.push({ appId, iosAppId: ids.iosAppId });
      }
    }

    if (toFetch.length === 0) return result;

    // Fetch from iTunes in batches of 50 IDs
    const BATCH = 50;
    for (let i = 0; i < toFetch.length; i += BATCH) {
      const batch = toFetch.slice(i, i + BATCH);
      const itunesData = await fetchFromItunes(batch.map(a => a.iosAppId));

      if (itunesData.size === 0) continue;

      const writeBatch = getDb().batch();
      let writes = 0;

      for (const { appId, iosAppId } of batch) {
        const itunes = itunesData.get(iosAppId);
        if (itunes) {
          result.set(appId, { appId, description: itunes.description, genre: itunes.genre });
          writeBatch.set(
            getDb().collection('appNames').doc(appId),
            { description: itunes.description, genre: itunes.genre },
            { merge: true }
          );
          writes++;
        }
      }

      if (writes > 0) {
        await writeBatch.commit();
      }
    }
  } catch (err) {
    console.error('fetchAppDescriptions failed:', err);
  }

  return result;
}
