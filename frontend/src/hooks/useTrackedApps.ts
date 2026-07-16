import { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, orderBy, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { AppData, Genre } from '../types';

/** One app we track in any genre, with its latest-month performance. */
export interface TrackedApp {
  appId: string;
  name: string;
  publisherName: string;
  genreIds: string[];
  iosAppId: string | null;
  androidAppId: string | null;
  /** Latest tracked month's store revenue (max across genres). */
  latestRevenue: number;
  /** Latest tracked month's downloads (max across genres). */
  latestDownloads: number;
}

type GenreApps = Map<string, Omit<TrackedApp, 'genreIds'>>;

/** Snapshot data only changes on the weekly fetch — cache per genre for the session. */
const genreAppsCache = new Map<string, GenreApps>();

/** Reads the latest month of one genre's denormalized aggregate (1 doc read). */
async function loadFromAggregate(genreId: string): Promise<GenreApps | null> {
  const snap = await getDoc(doc(db, 'genreAggregates', `${genreId}_month`));
  if (!snap.exists()) return null;
  const data = snap.data() as { months?: string[]; payload?: string };
  const months = data.months ?? [];
  if (months.length === 0 || !data.payload) return null;

  let cols: {
    ids?: string[];
    names?: string[];
    publishers?: string[];
    ios?: (string | null)[];
    android?: (string | null)[];
    rev?: number[];
    dl?: number[];
  };
  try {
    cols = JSON.parse(data.payload);
  } catch {
    return null;
  }
  const { ids = [], names = [], publishers = [], ios = [], android = [], rev = [], dl = [] } = cols;
  if (ids.length === 0) return null;

  const P = months.length;
  const last = P - 1;
  const out: GenreApps = new Map();
  for (let i = 0; i < ids.length; i++) {
    out.set(ids[i], {
      appId: ids[i],
      name: names[i] ?? ids[i],
      publisherName: publishers[i] ?? '',
      iosAppId: ios[i] ?? null,
      androidAppId: android[i] ?? null,
      latestRevenue: rev[i * P + last] ?? 0,
      latestDownloads: dl[i * P + last] ?? 0,
    });
  }
  return out;
}

/** Fallback when the aggregate hasn't been built: latest monthly snapshot fan-out. */
async function loadFromLatestSnapshot(genreId: string): Promise<GenreApps> {
  const snaps = await getDocs(
    query(collection(db, 'snapshots'), where('genreId', '==', genreId), orderBy('month', 'desc'), limit(1)),
  );
  const out: GenreApps = new Map();
  if (snaps.empty) return out;
  const apps = await getDocs(collection(db, 'snapshots', snaps.docs[0].id, 'apps'));
  for (const d of apps.docs) {
    const a = d.data() as AppData;
    const id = a.unifiedAppId || d.id;
    out.set(id, {
      appId: id,
      name: a.unifiedAppName || id,
      publisherName: a.publisherName ?? '',
      iosAppId: a.iosAppId ?? null,
      androidAppId: a.androidAppId ?? null,
      latestRevenue: a.storeRevenue ?? 0,
      latestDownloads: a.downloads ?? 0,
    });
  }
  return out;
}

async function loadGenreApps(genreId: string): Promise<GenreApps> {
  const cached = genreAppsCache.get(genreId);
  if (cached) return cached;
  let apps: GenreApps;
  try {
    apps = (await loadFromAggregate(genreId)) ?? (await loadFromLatestSnapshot(genreId));
  } catch {
    apps = new Map();
  }
  genreAppsCache.set(genreId, apps);
  return apps;
}

/**
 * All apps tracked across the given genres, deduped by unified app id, with
 * genre membership and latest-month revenue/downloads. Powers game search and
 * competitor ranking on the Creatives page.
 */
export function useTrackedApps(genres: Genre[]) {
  const [byGenre, setByGenre] = useState<Map<string, GenreApps>>(new Map());
  const [loading, setLoading] = useState(false);

  const genreKey = genres.map((g) => g.id).sort().join(',');

  useEffect(() => {
    if (genres.length === 0) {
      setByGenre(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const entries = await Promise.all(
        genres.map(async (g) => [g.id, await loadGenreApps(g.id)] as const),
      );
      if (!cancelled) {
        setByGenre(new Map(entries));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genreKey]);

  const apps: TrackedApp[] = useMemo(() => {
    const merged = new Map<string, TrackedApp>();
    for (const [genreId, genreApps] of byGenre) {
      for (const a of genreApps.values()) {
        const existing = merged.get(a.appId);
        if (existing) {
          if (!existing.genreIds.includes(genreId)) existing.genreIds.push(genreId);
          existing.latestRevenue = Math.max(existing.latestRevenue, a.latestRevenue);
          existing.latestDownloads = Math.max(existing.latestDownloads, a.latestDownloads);
          if (!existing.iosAppId && a.iosAppId) existing.iosAppId = a.iosAppId;
          if (!existing.androidAppId && a.androidAppId) existing.androidAppId = a.androidAppId;
        } else {
          merged.set(a.appId, { ...a, genreIds: [genreId] });
        }
      }
    }
    return [...merged.values()];
  }, [byGenre]);

  return { apps, loading };
}
