import { getFirestore } from 'firebase-admin/firestore';
import { mergeAppsWithWatchlist } from './watchlist';

interface SnapshotApp {
  appId: string;
  revenue: number;
}

export interface ResolveAppsParams {
  genreId: string;
  topN: number;
  watchlist: string[];
  /**
   * Loader is injectable so tests don't need Firestore. The default loader
   * reads the most recent monthly snapshot for the genre from the
   * `companalysis` database and maps each app to its stored `unifiedAppId`
   * (the key Sensor Tower Ad Intel expects) and `storeRevenue`.
   */
  loadLatestSnapshotApps?: (genreId: string) => Promise<SnapshotApp[]>;
}

async function defaultLoader(genreId: string): Promise<SnapshotApp[]> {
  const db = getFirestore('companalysis');
  const snaps = await db
    .collection('snapshots')
    .where('genreId', '==', genreId)
    .orderBy('month', 'desc')
    .limit(1)
    .get();
  if (snaps.empty) return [];
  const latest = snaps.docs[0];
  const apps = await latest.ref.collection('apps').get();
  return apps.docs.map(d => {
    const data = d.data();
    return {
      appId: (data.unifiedAppId as string) || d.id,
      revenue: typeof data.storeRevenue === 'number' ? data.storeRevenue : 0,
    };
  });
}

export async function resolveAppsInScope(params: ResolveAppsParams): Promise<string[]> {
  const { genreId, topN, watchlist } = params;
  const loader = params.loadLatestSnapshotApps ?? defaultLoader;
  const all = await loader(genreId);
  const topIds = all
    .slice()
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, topN)
    .map(a => a.appId);
  return mergeAppsWithWatchlist(topIds, watchlist);
}
