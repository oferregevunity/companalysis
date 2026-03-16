import { useState, useEffect, useRef } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { buildComparisonData } from '../lib/dataProcessing';
import type { Genre, AppData, ComparisonRow } from '../types';

export function useMultiGenreSnapshots(selectedGenres: Genre[]) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{
    rows: ComparisonRow[];
    months: string[];
  }>({ rows: [], months: [] });

  const genreKey = selectedGenres.map(g => g.id).sort().join(',');
  const prevKeyRef = useRef('');

  useEffect(() => {
    if (selectedGenres.length === 0) {
      setResults({ rows: [], months: [] });
      setLoading(false);
      return;
    }

    if (genreKey === prevKeyRef.current) return;
    prevKeyRef.current = genreKey;

    let cancelled = false;

    async function fetchAll() {
      setLoading(true);
      setError(null);

      try {
        const genreResults = await Promise.all(
          selectedGenres.map(async (genre) => {
            const snapshotsQuery = query(
              collection(db, 'snapshots'),
              where('genreId', '==', genre.id),
              orderBy('month', 'asc')
            );
            const snapshotsSnapshot = await getDocs(snapshotsQuery);
            const snaps = snapshotsSnapshot.docs.map((d) => ({
              id: d.id,
              month: d.data().month as string,
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

        const allRows: ComparisonRow[] = [];
        for (const { genre, months, appsByMonth } of genreResults) {
          const rows = buildComparisonData(months, appsByMonth, genre.name, genre.id);
          allRows.push(...rows);
        }

        setResults({ rows: allRows, months: allMonths });
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
  }, [genreKey]);

  return { ...results, loading, error };
}
