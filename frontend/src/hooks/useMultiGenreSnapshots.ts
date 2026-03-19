import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildComparisonData, computeRisingStatus } from '../lib/dataProcessing';
import type { Genre, AppData, ComparisonRow } from '../types';

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

export function useMultiGenreSnapshots(selectedGenres: Genre[], risingThreshold: number = 20, granularity: Granularity = 'month') {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResults, setRawResults] = useState<{
    rows: ComparisonRow[];
    months: string[];
  }>({ rows: [], months: [] });
  const [refreshCounter, setRefreshCounter] = useState(0);

  const genreKey = selectedGenres.map(g => g.id).sort().join(',');

  useEffect(() => {
    if (selectedGenres.length === 0) {
      setRawResults({ rows: [], months: [] });
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setError(null);

      try {
        const genreResults = await Promise.all(
          selectedGenres.map(async (genre) => {
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

            return { genre, months, appsByMonth };
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
      return {
        ...row,
        risingStatus: computeRisingStatus(row.percentChanges, sortedMonths, risingThreshold),
        risingStatusDownloads: computeRisingStatus(row.downloadPercentChanges, sortedMonths, risingThreshold),
      };
    });

    return { rows, months: rawResults.months };
  }, [rawResults, risingThreshold]);

  const refresh = () => setRefreshCounter(c => c + 1);

  return { ...results, loading, error, refresh };
}
