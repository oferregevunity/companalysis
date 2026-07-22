import { useState, useEffect, useMemo, useRef } from 'react';
import { collection, doc, getDoc, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildComparisonData, computeRisingStatus, daysInPeriod } from '../lib/dataProcessing';
import type { Genre, AppData, ComparisonRow } from '../types';

/** Raw per-genre fetch result, before pivot/merge. */
type GenreRaw = { months: string[]; appsByMonth: Record<string, AppData[]> };

/**
 * Session cache of raw per-genre data, keyed by `${genreId}|${granularity}`.
 * Snapshot data only changes on the weekly fetch, so once a genre is loaded
 * we can reuse it when the user toggles it off and back on — no refetch, and
 * no re-reading the apps subcollections. `refresh()` bypasses and overwrites it.
 */
const genreRawCache = new Map<string, GenreRaw>();

function computePercentChanges(
  values: Record<string, number>,
  months: string[]
): Record<string, number | null> {
  const changes: Record<string, number | null> = {};
  for (let i = 1; i < months.length; i++) {
    const prev = values[months[i - 1]];
    const curr = values[months[i]];
    if (prev > 0) {
      changes[months[i]] = ((curr - prev) / prev) * 100;
    } else if (curr > 0) {
      changes[months[i]] = 100;
    } else {
      changes[months[i]] = null;
    }
  }
  return changes;
}

export type Granularity = 'month' | 'week';

export function useMultiGenreSnapshots(selectedGenres: Genre[], risingThreshold: number = 20, granularity: Granularity = 'month', minDailyRevenue: number = 500) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResults, setRawResults] = useState<{
    rows: ComparisonRow[];
    months: string[];
  }>({ rows: [], months: [] });
  const [refreshCounter, setRefreshCounter] = useState(0);
  const forceRefreshRef = useRef(false);

  const genreKey = selectedGenres.map(g => g.id).sort().join(',');

  useEffect(() => {
    if (selectedGenres.length === 0) {
      setRawResults({ rows: [], months: [] });
      setLoading(false);
      return;
    }

    let cancelled = false;

    const force = forceRefreshRef.current;
    forceRefreshRef.current = false;

    /** Fast path: read the pre-pivoted aggregate doc (1 read) and expand it
     * back into the appsByMonth shape buildComparisonData expects. Returns null
     * if the aggregate is missing/empty so the caller falls back to the fan-out. */
    async function fetchGenreFromAggregate(genre: Genre): Promise<GenreRaw | null> {
      const aggRef = doc(db, 'genreAggregates', `${genre.id}_${granularity}`);
      const aggSnap = await getDoc(aggRef);
      if (!aggSnap.exists()) return null;

      const data = aggSnap.data() as {
        months?: string[];
        // Bulk columns packed into one JSON string (avoids Firestore's array
        // index-entry limit). rev/dl are flat row-major: index [i * months.length + p].
        payload?: string;
      };
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
      const ids = cols.ids ?? [];
      if (ids.length === 0) return null;

      const { names = [], publishers = [], ios = [], android = [], rev = [], dl = [] } = cols;
      const P = months.length;
      const appsByMonth: Record<string, AppData[]> = {};
      for (const m of months) appsByMonth[m] = [];
      for (let i = 0; i < ids.length; i++) {
        const base = i * P;
        for (let p = 0; p < P; p++) {
          appsByMonth[months[p]].push({
            unifiedAppId: ids[i],
            unifiedAppName: names[i] ?? ids[i],
            publisherName: publishers[i] ?? '',
            iosAppId: ios[i] ?? null,
            androidAppId: android[i] ?? null,
            downloads: dl[base + p] ?? 0,
            storeRevenue: rev[base + p] ?? 0,
          });
        }
      }
      return { months, appsByMonth };
    }

    async function fetchGenreRaw(genre: Genre): Promise<GenreRaw> {
      // Prefer the denormalized read model — one doc read instead of fanning
      // out across every month's apps subcollection. Falls back automatically
      // if the aggregate hasn't been built for this genre yet.
      try {
        const agg = await fetchGenreFromAggregate(genre);
        if (agg) return agg;
      } catch {
        // Aggregate unavailable — fall through to the per-snapshot fan-out.
      }

      const timeField = granularity === 'week' ? 'week' : 'month';
      const constraints = [
        where('genreId', '==', genre.id),
        orderBy(timeField, 'asc'),
      ];
      if (granularity === 'week') {
        constraints.splice(1, 0, where('granularity', '==', 'week'));
      }
      const snapshotsQuery = query(collection(db, 'snapshots'), ...constraints);
      const snapshotsSnapshot = await getDocs(snapshotsQuery);
      const snaps = snapshotsSnapshot.docs.map((d) => ({
        id: d.id,
        month: (d.data()[timeField] as string),
      }));

      const monthResults = await Promise.all(
        snaps.map(async (snap) => {
          const appsSnapshot = await getDocs(collection(db, 'snapshots', snap.id, 'apps'));
          return {
            month: snap.month,
            apps: appsSnapshot.docs.map((d) => d.data() as AppData),
          };
        })
      );

      const months = snaps.map(s => s.month);
      const appsByMonth: Record<string, AppData[]> = {};
      for (const { month, apps } of monthResults) {
        appsByMonth[month] = apps;
      }
      return { months, appsByMonth };
    }

    async function fetchAll() {
      setLoading(true);
      setError(null);

      try {
        const genreResults = await Promise.all(
          selectedGenres.map(async (genre) => {
            const cacheKey = `${genre.id}|${granularity}`;
            let raw = force ? undefined : genreRawCache.get(cacheKey);
            if (!raw) {
              raw = await fetchGenreRaw(genre);
              genreRawCache.set(cacheKey, raw);
            }
            return { genre, months: raw.months, appsByMonth: raw.appsByMonth };
          })
        );

        if (cancelled) return;

        const allMonthsSet = new Set<string>();
        for (const { months } of genreResults) {
          for (const m of months) allMonthsSet.add(m);
        }
        const allMonths = Array.from(allMonthsSet).sort();

        const rawRows: ComparisonRow[] = [];
        for (const { genre, months, appsByMonth } of genreResults) {
          const rows = buildComparisonData(months, appsByMonth, genre.name, genre.id);
          rawRows.push(...rows);
        }

        const merged = new Map<string, ComparisonRow>();
        for (const row of rawRows) {
          const existing = merged.get(row.appId);
          if (!existing) {
            merged.set(row.appId, row);
            continue;
          }

          const seen = new Set(existing.allGenres.map(g => g.id));
          for (const g of row.allGenres) {
            if (!seen.has(g.id)) existing.allGenres.push(g);
          }
          existing.genreName = existing.allGenres.map(g => g.name).join(', ');

          for (const [month, rev] of Object.entries(row.revenueByMonth)) {
            existing.revenueByMonth[month] = Math.max(existing.revenueByMonth[month] ?? 0, rev);
          }
          for (const [month, dl] of Object.entries(row.downloadsByMonth)) {
            existing.downloadsByMonth[month] = Math.max(existing.downloadsByMonth[month] ?? 0, dl);
          }

          if (!existing.iosAppId && row.iosAppId) existing.iosAppId = row.iosAppId;
          if (!existing.androidAppId && row.androidAppId) existing.androidAppId = row.androidAppId;
          if (!existing.publisherName && row.publisherName) existing.publisherName = row.publisherName;
        }

        for (const row of merged.values()) {
          const sortedMonths = Object.keys(row.revenueByMonth).sort();
          row.percentChanges = computePercentChanges(row.revenueByMonth, sortedMonths);
          row.downloadPercentChanges = computePercentChanges(row.downloadsByMonth, sortedMonths);

          const latestPeriod = allMonths[allMonths.length - 1];
          const latestRevenue = row.revenueByMonth[latestPeriod] ?? 0;
          const latestDownloads = row.downloadsByMonth[latestPeriod] ?? 0;
          let days: number;
          if (granularity === 'week') {
            days = 7;
          } else {
            const [y, m] = latestPeriod.split('-').map(Number);
            days = new Date(y, m, 0).getDate();
          }
          row.dailyRevenue = days > 0 ? latestRevenue / days : 0;
          row.dailyDownloads = days > 0 ? latestDownloads / days : 0;
        }

        setRawResults({ rows: Array.from(merged.values()), months: allMonths });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [genreKey, refreshCounter, granularity]);

  const results = useMemo(() => {
    if (rawResults.rows.length === 0) return rawResults;

    const rows = rawResults.rows.map((row) => {
      const sortedMonths = Object.keys(row.revenueByMonth).sort();
      const dailyRevenueByPeriod: Record<string, number> = {};
      for (const m of sortedMonths) {
        const days = daysInPeriod(m);
        dailyRevenueByPeriod[m] = days > 0 ? (row.revenueByMonth[m] ?? 0) / days : 0;
      }
      return {
        ...row,
        risingStatus: computeRisingStatus(row.percentChanges, sortedMonths, risingThreshold, {
          dailyRevenueByPeriod,
          minDailyRevenue,
        }),
        risingStatusDownloads: computeRisingStatus(row.downloadPercentChanges, sortedMonths, risingThreshold),
      };
    });

    return { rows, months: rawResults.months };
  }, [rawResults, risingThreshold, minDailyRevenue]);

  const refresh = () => {
    forceRefreshRef.current = true;
    setRefreshCounter(c => c + 1);
  };

  return { ...results, loading, error, refresh };
}
