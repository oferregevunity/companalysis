import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Genre, SubScores } from '../types';

export interface AppScore {
  appId: string;
  score: number;
  subScores: SubScores;
}

export function useAppScores(
  selectedGenres: Genre[],
  granularity: 'month' | 'week' = 'month'
) {
  const [scoreMap, setScoreMap] = useState<Map<string, AppScore>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedGenres.length === 0) {
      setScoreMap(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      const map = new Map<string, AppScore>();

      for (const genre of selectedGenres) {
        const q = query(
          collection(db, 'insights'),
          where('genreId', '==', genre.id),
          where('granularity', '==', granularity),
          orderBy('generatedAt', 'desc'),
          limit(1)
        );

        const insightSnap = await getDocs(q);
        if (insightSnap.empty) continue;

        const insightDoc = insightSnap.docs[0];
        const scoresSnap = await getDocs(collection(insightDoc.ref, 'scores'));

        for (const scoreDoc of scoresSnap.docs) {
          const data = scoreDoc.data();
          const existing = map.get(data.appId);
          if (!existing || data.score > existing.score) {
            map.set(data.appId, {
              appId: data.appId,
              score: data.score,
              subScores: data.subScores,
            });
          }
        }
      }

      if (!cancelled) {
        setScoreMap(map);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedGenres, granularity]);

  return { scoreMap, loading };
}
