import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Genre, GenreInsightDoc } from '../types';

export function useInsights(
  selectedGenres: Genre[],
  granularity: 'month' | 'week' = 'month'
) {
  const [insights, setInsights] = useState<GenreInsightDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCounter, setRefreshCounter] = useState(0);

  useEffect(() => {
    if (selectedGenres.length === 0) {
      setInsights([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const results: GenreInsightDoc[] = [];

        for (const genre of selectedGenres) {
          const q = query(
            collection(db, 'insights'),
            where('genreId', '==', genre.id),
            where('granularity', '==', granularity),
            orderBy('generatedAt', 'desc'),
            limit(1)
          );

          const snap = await getDocs(q);
          if (!snap.empty) {
            const doc = snap.docs[0];
            const data = doc.data();
            results.push({
              genreId: data.genreId,
              period: data.period,
              granularity: data.granularity,
              generatedAt: data.generatedAt?.toDate() || new Date(),
              summary: data.summary,
              games: data.games || [],
              watchList: data.watchList || [],
            });
          }
        }

        if (!cancelled) {
          setInsights(results);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load insights');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [selectedGenres, granularity, refreshCounter]);

  const refresh = useCallback(() => setRefreshCounter(c => c + 1), []);

  return { insights, loading, error, refresh };
}
