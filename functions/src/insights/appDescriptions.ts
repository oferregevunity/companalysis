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
 * Fetch app descriptions from the iTunes Lookup API and cache them in Firestore.
 * Falls back to cached descriptions if API fails.
 */
export async function fetchAppDescriptions(
  storeIds: Map<string, { iosAppId: string | null; androidAppId: string | null }>
): Promise<Map<string, AppDescription>> {
  const result = new Map<string, AppDescription>();
  const toFetch: { appId: string; iosAppId: string }[] = [];

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
  for (const [appId, ids] of storeIds) {
    if (!result.has(appId) && ids.iosAppId) {
      toFetch.push({ appId, iosAppId: ids.iosAppId });
    }
  }

  if (toFetch.length === 0) return result;

  // Fetch from iTunes Lookup API (batch up to 200 IDs in one call)
  const iosIds = toFetch.map(a => a.iosAppId).join(',');
  try {
    const response = await fetch(
      `https://itunes.apple.com/lookup?id=${iosIds}&entity=software`
    );
    if (response.ok) {
      const json = await response.json();
      const results = json.results as any[];
      if (results) {
        const itunesMap = new Map<string, any>();
        for (const r of results) {
          if (r.trackId) {
            itunesMap.set(String(r.trackId), r);
          }
        }

        const batch = getDb().batch();
        let batchCount = 0;

        for (const { appId, iosAppId } of toFetch) {
          const itunes = itunesMap.get(iosAppId);
          if (itunes && itunes.description) {
            // Truncate description to 500 chars for Gemini context efficiency
            const desc = (itunes.description as string).slice(0, 500);
            const genre = itunes.primaryGenreName || '';
            result.set(appId, { appId, description: desc, genre });

            // Cache in Firestore
            batch.set(
              getDb().collection('appNames').doc(appId),
              { description: desc, genre },
              { merge: true }
            );
            batchCount++;
          }
        }

        if (batchCount > 0) {
          await batch.commit();
        }
      }
    }
  } catch (err) {
    console.error('iTunes Lookup API failed:', err);
  }

  return result;
}
