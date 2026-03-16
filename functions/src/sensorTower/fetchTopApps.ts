import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchTopApps, resolveAppMetadata } from './client';
import type { AppMetadata } from './client';

function getDb() {
  return getFirestore('companalysis');
}

export interface GenreDoc {
  id: string;
  name: string;
  categoryIds: { ios: string; android: string };
  country?: string;
  monthsBack?: number;
  active: boolean;
}

function getLastNMonths(n: number): { month: string; startDate: string; endDate: string }[] {
  const months: { month: string; startDate: string; endDate: string }[] = [];
  const now = new Date();

  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const lastDay = new Date(year, d.getMonth() + 1, 0).getDate();

    months.push({
      month: `${year}-${month}`,
      startDate: `${year}-${month}-01`,
      endDate: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
    });
  }

  return months.reverse();
}

async function getCachedMetadata(appIds: string[]): Promise<Map<string, AppMetadata>> {
  const db = getDb();
  const metaMap = new Map<string, AppMetadata>();
  const BATCH_SIZE = 30;

  for (let i = 0; i < appIds.length; i += BATCH_SIZE) {
    const batch = appIds.slice(i, i + BATCH_SIZE);
    const docs = await db.getAll(...batch.map(id => db.collection('appNames').doc(id)));
    for (const doc of docs) {
      if (doc.exists) {
        const data = doc.data();
        if (data?.name) {
          metaMap.set(doc.id, {
            name: data.name,
            publisherName: data.publisherName || '',
            iosAppId: data.iosAppId || null,
            androidAppId: data.androidAppId || null,
          });
        }
      }
    }
  }

  return metaMap;
}

async function cacheMetadata(metaMap: Map<string, AppMetadata>): Promise<void> {
  const db = getDb();
  const entries = Array.from(metaMap.entries());
  const BATCH_SIZE = 400;

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = entries.slice(i, i + BATCH_SIZE);
    for (const [id, meta] of chunk) {
      batch.set(
        db.collection('appNames').doc(id),
        {
          name: meta.name,
          publisherName: meta.publisherName,
          iosAppId: meta.iosAppId,
          androidAppId: meta.androidAppId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    await batch.commit();
  }
}

/**
 * Returns the list of month objects for a genre based on its monthsBack setting.
 */
export function getGenreMonths(genre: GenreDoc): { month: string; startDate: string; endDate: string }[] {
  return getLastNMonths(genre.monthsBack || 6);
}

/**
 * Fetch and store data for a single genre + single month.
 * Designed to be called per-month to stay within Cloud Functions timeout.
 */
export async function fetchAndStoreMonth(
  genre: GenreDoc,
  monthInfo: { month: string; startDate: string; endDate: string },
  authToken: string
): Promise<{ success: boolean; appCount: number; error?: string }> {
  const country = genre.country || 'US';
  const { month, startDate, endDate } = monthInfo;

  try {
    console.log(`Fetching ${genre.name} for ${month} (${country})...`);
    const categoryId = genre.categoryIds.ios || genre.categoryIds.android;
    const apps = await fetchTopApps({
      authToken,
      os: 'unified',
      category: categoryId,
      country,
      startDate,
      endDate,
      limit: 0,
    });
    console.log(`Fetched ${apps.length} apps for ${genre.name} ${month}`);

    // Resolve metadata: check cache first, then look up uncached (top by revenue)
    const appIds = apps.map(a => a.appId);
    const cachedMeta = await getCachedMetadata(appIds);
    const uncachedIds = appIds
      .filter(id => !cachedMeta.has(id))
      .sort((a, b) => {
        const appA = apps.find(x => x.appId === a);
        const appB = apps.find(x => x.appId === b);
        return (appB?.revenue || 0) - (appA?.revenue || 0);
      });

    const MAX_UNCACHED_LOOKUPS = 500;
    const resolvedMeta = new Map<string, AppMetadata>(cachedMeta);

    if (uncachedIds.length > 0) {
      const lookupBatch = uncachedIds.slice(0, MAX_UNCACHED_LOOKUPS);
      console.log(`Looking up ${lookupBatch.length} of ${uncachedIds.length} uncached apps...`);
      try {
        const newMeta = await resolveAppMetadata(lookupBatch, authToken);
        for (const [id, meta] of newMeta) {
          resolvedMeta.set(id, meta);
        }
        await cacheMetadata(newMeta);
      } catch (error) {
        console.warn('Metadata resolution partially failed:', error);
      }
    }

    // Enrich and store
    const enrichedApps = apps
      .map(app => {
        const meta = resolvedMeta.get(app.appId);
        return {
          ...app,
          appName: meta?.name || app.appId,
          publisherName: meta?.publisherName || '',
          iosAppId: meta?.iosAppId || null,
          androidAppId: meta?.androidAppId || null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const snapshotId = `${genre.id}_${month}`;
    const db = getDb();
    const snapshotRef = db.collection('snapshots').doc(snapshotId);

    await snapshotRef.set({
      genreId: genre.id,
      month,
      fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
      appCount: enrichedApps.length,
      platform: 'unified',
      geo: country,
    });

    const BATCH_SIZE = 400;
    for (let i = 0; i < enrichedApps.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = enrichedApps.slice(i, i + BATCH_SIZE);
      for (const app of chunk) {
        batch.set(snapshotRef.collection('apps').doc(app.appId), {
          unifiedAppId: app.appId,
          unifiedAppName: app.appName,
          publisherName: app.publisherName,
          iosAppId: app.iosAppId,
          androidAppId: app.androidAppId,
          downloads: app.downloads,
          storeRevenue: app.revenue,
        });
      }
      await batch.commit();
    }

    console.log(`Stored ${enrichedApps.length} apps for ${genre.name} ${month}`);
    return { success: true, appCount: enrichedApps.length };
  } catch (error) {
    const msg = `Error processing ${genre.name} ${month}: ${error}`;
    console.error(msg);
    return { success: false, appCount: 0, error: msg };
  }
}

/**
 * Legacy: fetch all months for a genre sequentially.
 * Used by the weekly scheduled function.
 */
export async function fetchAndStoreGenre(
  genre: GenreDoc,
  authToken: string
): Promise<{ success: boolean; monthsProcessed: number; errors: string[] }> {
  const months = getGenreMonths(genre);
  const errors: string[] = [];
  let monthsProcessed = 0;

  for (const monthInfo of months) {
    const result = await fetchAndStoreMonth(genre, monthInfo, authToken);
    if (result.success) {
      monthsProcessed++;
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return { success: errors.length === 0, monthsProcessed, errors };
}
