import {
  TRACKED_NETWORKS,
  type BreakdownBucket,
  type CreativeFormat,
  type QueryableAdNetwork,
  type RawCreative,
} from './types';
import type { GenreDoc } from '../sensorTower/fetchTopApps';

export interface StoredCreative {
  /** The dedup key we keyed on: `phashionGroup` when present, otherwise `id`. */
  creativeKey: string;
  /** One of the Sensor Tower `ad_units[].id` values we merged (the first seen). */
  sampleId: string;
  phashionGroup: string | null;
  appId: string;
  /** Every tracked network this concept appeared on (sorted for stable docs). */
  networks: QueryableAdNetwork[];
  format: CreativeFormat;
  /** Single country — our scrape is scoped to one country per genre. */
  country: string;
  firstSeen: string;
  lastSeen: string;
  durationDays: number;
  /** Max of `raw.share` across networks for this concept; null if all were null. */
  maxShare: number | null;
  /** Representative media/copy (from the first network we saw this concept on). */
  mediaUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  videoDurationSec: number | null;
  width: number | null;
  height: number | null;
  title: string | null;
  message: string | null;
  buttonText: string | null;
  variantCount: number;
  adFormats: string[];
  breakdown: BreakdownBucket[];
  genreId: string;
  capturedWeek: string;
}

export interface AppMetadataRow {
  appId: string;
  name: string;
  publisherName: string | null;
  iosAppId: string | null;
  androidAppId: string | null;
}

export interface FetchGenreDeps {
  genre: GenreDoc;
  weekStart: string;
  weekEnd: string;
  authToken: string;
  resolveApps: (genreId: string, topN: number, watchlist: string[]) => Promise<string[]>;
  fetchCreatives: (params: {
    authToken: string;
    appId: string;
    network: QueryableAdNetwork;
    country: string;
    startDate: string;
    endDate: string;
  }) => Promise<RawCreative[]>;
  writeSnapshot: (docs: StoredCreative[]) => Promise<void>;
  upsertAppNames: (rows: AppMetadataRow[]) => Promise<void>;
  /** Already loaded by caller; orchestrator filters to apps-in-scope after resolve. */
  appMetadata: AppMetadataRow[];
  watchlist: string[];
  topN?: number;
}

export interface FetchGenreResult {
  success: boolean;
  creativeCount: number;
  partialErrors: string[];
}

/** ISO week key from a week start date (`YYYY-MM-DD`). */
export function weekKeyFromStart(weekStart: string): string {
  const d = new Date(weekStart);
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function rawToStored(raw: RawCreative, genreId: string, capturedWeek: string): StoredCreative {
  const creativeKey = raw.phashionGroup ?? raw.id;
  return {
    creativeKey,
    sampleId: raw.id,
    phashionGroup: raw.phashionGroup,
    appId: raw.appId,
    networks: [raw.network].sort(),
    format: raw.format,
    country: raw.country,
    firstSeen: raw.firstSeen,
    lastSeen: raw.lastSeen,
    durationDays: raw.durationDays,
    maxShare: raw.share,
    mediaUrl: raw.mediaUrl,
    previewUrl: raw.previewUrl,
    thumbnailUrl: raw.thumbnailUrl,
    videoDurationSec: raw.videoDurationSec,
    width: raw.width,
    height: raw.height,
    title: raw.title,
    message: raw.message,
    buttonText: raw.buttonText,
    variantCount: raw.variantCount,
    adFormats: [...raw.adFormats],
    breakdown: raw.breakdown,
    genreId,
    capturedWeek,
  };
}

function mergeStored(existing: StoredCreative, raw: RawCreative): StoredCreative {
  const networks = Array.from(new Set([...existing.networks, raw.network])).sort() as QueryableAdNetwork[];
  const firstSeen = existing.firstSeen < raw.firstSeen ? existing.firstSeen : raw.firstSeen;
  const lastSeen = existing.lastSeen > raw.lastSeen ? existing.lastSeen : raw.lastSeen;
  const durationDays = Math.max(existing.durationDays, raw.durationDays);
  const mx = Math.max(existing.maxShare ?? -Infinity, raw.share ?? -Infinity);
  const maxShare = mx === -Infinity ? null : mx;

  return {
    ...existing,
    networks,
    firstSeen,
    lastSeen,
    durationDays,
    maxShare,
    mediaUrl: existing.mediaUrl ?? raw.mediaUrl,
    previewUrl: existing.previewUrl ?? raw.previewUrl,
    thumbnailUrl: existing.thumbnailUrl ?? raw.thumbnailUrl,
    videoDurationSec: existing.videoDurationSec ?? raw.videoDurationSec,
    width: existing.width ?? raw.width,
    height: existing.height ?? raw.height,
    title: existing.title ?? raw.title,
    message: existing.message ?? raw.message,
    buttonText: existing.buttonText ?? raw.buttonText,
    variantCount: Math.max(existing.variantCount, raw.variantCount),
    adFormats: Array.from(new Set([...existing.adFormats, ...raw.adFormats])),
    // breakdown: keep first network's
  };
}

function sortDocs(docs: StoredCreative[]): StoredCreative[] {
  return [...docs].sort((a, b) => {
    if (a.appId !== b.appId) return a.appId.localeCompare(b.appId);
    return a.creativeKey.localeCompare(b.creativeKey);
  });
}

/**
 * Firestore document id for creative subcollections and `creativeLatest`.
 * `creativeKey` (phashionGroup when present) is globally deduped and can match across apps for the same stock asset — include `appId` so doc ids do not collide.
 */
export function creativeDocId(appId: string, creativeKey: string): string {
  return `${appId}__${creativeKey}`;
}

export async function fetchCreativesForGenreWithDeps(deps: FetchGenreDeps): Promise<FetchGenreResult> {
  const {
    genre,
    weekStart,
    weekEnd,
    authToken,
    resolveApps,
    fetchCreatives,
    writeSnapshot,
    upsertAppNames,
    appMetadata,
    watchlist,
    topN = 25,
  } = deps;
  const country = genre.country ?? 'US';
  const capturedWeek = weekKeyFromStart(weekStart);
  const partialErrors: string[] = [];

  const apps = await resolveApps(genre.id, topN, watchlist);
  const merged = new Map<string, StoredCreative>();

  for (const appId of apps) {
    for (const network of TRACKED_NETWORKS) {
      try {
        const raws = await fetchCreatives({
          authToken,
          appId,
          network,
          country,
          startDate: weekStart,
          endDate: weekEnd,
        });
        for (const raw of raws) {
          const dedupKey = raw.phashionGroup ?? raw.id;
          const mapKey = `${appId}::${dedupKey}`;
          const existing = merged.get(mapKey);
          if (!existing) {
            merged.set(mapKey, rawToStored(raw, genre.id, capturedWeek));
          } else {
            merged.set(mapKey, mergeStored(existing, raw));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        partialErrors.push(`app=${appId} network=${network}: ${msg}`);
      }
    }
  }

  const docs = sortDocs(Array.from(merged.values()));
  await writeSnapshot(docs);

  if (apps.length > 0) {
    const inScope = new Set(apps);
    const rows: AppMetadataRow[] = appMetadata
      .filter(m => inScope.has(m.appId))
      .map(({ appId, name, publisherName, iosAppId, androidAppId }) => ({
        appId,
        name,
        publisherName,
        iosAppId,
        androidAppId,
      }));
    if (rows.length > 0) {
      await upsertAppNames(rows);
    }
  }

  return {
    success: partialErrors.length === 0,
    creativeCount: docs.length,
    partialErrors,
  };
}

async function loadLatestSnapshotAppMetadata(
  genreId: string,
  getFirestore: typeof import('firebase-admin/firestore').getFirestore,
): Promise<(AppMetadataRow & { revenue: number })[]> {
  const db = getFirestore('companalysis');
  const snaps = await db
    .collection('snapshots')
    .where('genreId', '==', genreId)
    .orderBy('month', 'desc')
    .limit(1)
    .get();
  if (snaps.empty) return [];
  const apps = await snaps.docs[0].ref.collection('apps').get();
  return apps.docs.map(d => {
    const data = d.data();
    return {
      appId: (data.unifiedAppId as string) || d.id,
      name: (data.unifiedAppName as string) || '(unknown)',
      publisherName: typeof data.publisherName === 'string' ? data.publisherName : null,
      iosAppId: typeof data.iosAppId === 'string' ? data.iosAppId : null,
      androidAppId: typeof data.androidAppId === 'string' ? data.androidAppId : null,
      revenue: typeof data.storeRevenue === 'number' ? data.storeRevenue : 0,
    };
  });
}

/**
 * Firestore-bound entry: loads snapshot app metadata, watchlist, writes
 * `creativeSnapshots` + `creativeLatest`, and upserts `appNames`.
 * Uses dynamic imports so test imports of `fetchCreativesForGenreWithDeps` do not load Admin SDK.
 */
export async function fetchCreativesForGenre(
  genre: GenreDoc,
  weekStart: string,
  weekEnd: string,
  authToken: string,
): Promise<FetchGenreResult> {
  const [{ getFirestore, FieldValue }, { fetchCreativesForApp }, { resolveAppsInScope }, { getWatchlistAppIds }] =
    await Promise.all([
      import('firebase-admin/firestore'),
      import('./client'),
      import('./appsInScope'),
      import('./watchlist'),
    ]);

  const watchlist = await getWatchlistAppIds();
  const appMetadata = await loadLatestSnapshotAppMetadata(genre.id, getFirestore);
  const db = getFirestore('companalysis');
  const wk = weekKeyFromStart(weekStart);
  const snapshotRef = db.collection('creativeSnapshots').doc(`${genre.id}_week_${wk}`);

  return fetchCreativesForGenreWithDeps({
    genre,
    weekStart,
    weekEnd,
    authToken,
    watchlist,
    appMetadata,
    resolveApps: (genreId, topN, wl) =>
      resolveAppsInScope({
        genreId,
        topN,
        watchlist: wl,
        loadLatestSnapshotApps: async () =>
          appMetadata.map(a => ({ appId: a.appId, revenue: a.revenue })),
      }),
    fetchCreatives: fetchCreativesForApp,
    writeSnapshot: async docs => {
      await snapshotRef.set({
        genreId: genre.id,
        week: wk,
        weekStart,
        weekEnd,
        fetchedAt: FieldValue.serverTimestamp(),
        creativeCount: docs.length,
      });
      const BATCH = 400;
      for (let i = 0; i < docs.length; i += BATCH) {
        const chunk = docs.slice(i, i + BATCH);
        const batch = db.batch();
        for (const doc of chunk) {
          // Same phashionGroup can appear for different apps (stock video); doc ids must not collide.
          const docId = creativeDocId(doc.appId, doc.creativeKey);
          batch.set(snapshotRef.collection('creatives').doc(docId), doc);
          batch.set(db.collection('creativeLatest').doc(docId), doc);
        }
        await batch.commit();
      }
    },
    upsertAppNames: async rows => {
      const batch = db.batch();
      for (const r of rows) {
        const payload: Record<string, unknown> = {
          name: r.name,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (r.publisherName !== null) payload.publisherName = r.publisherName;
        if (r.iosAppId !== null) payload.iosAppId = r.iosAppId;
        if (r.androidAppId !== null) payload.androidAppId = r.androidAppId;
        batch.set(db.collection('appNames').doc(r.appId), payload, { merge: true });
      }
      await batch.commit();
    },
  });
}
