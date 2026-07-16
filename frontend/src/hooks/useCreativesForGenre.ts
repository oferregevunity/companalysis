import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { makeCreativeDocId, type CreativeScoreRow, type CreativeSubScores, type StoredCreative } from '../types/creatives';

export interface JoinedCreative extends StoredCreative {
  docId: string;
  score?: number;
  subScores?: CreativeSubScores;
}

export function useCreativesForGenre(genreId: string, week: string) {
  const [creatives, setCreatives] = useState<StoredCreative[]>([]);
  const [scores, setScores] = useState<Map<string, CreativeScoreRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!genreId) {
      setCreatives([]);
      setScores(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const creativeQ = query(collection(db, 'creativeLatest'), where('genreId', '==', genreId));
        const creativeSnap = await getDocs(creativeQ);
        const loadedCreatives = creativeSnap.docs.map((d) => d.data() as StoredCreative);

        const scoresMap = new Map<string, CreativeScoreRow>();
        if (week) {
          const scoresSnap = await getDocs(
            collection(db, 'creativeInsights', `${genreId}_week_${week}`, 'scores'),
          );
          for (const s of scoresSnap.docs) {
            const row = s.data() as CreativeScoreRow;
            scoresMap.set(s.id, row);
          }
        }

        if (!cancelled) {
          setCreatives(loadedCreatives);
          setScores(scoresMap);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [genreId, week, refreshKey]);

  const joined: JoinedCreative[] = useMemo(() => {
    return creatives.map((c) => {
      const docId = makeCreativeDocId(c.appId, c.creativeKey);
      const s = scores.get(docId);
      return { ...c, docId, score: s?.score, subScores: s?.subScores };
    });
  }, [creatives, scores]);

  /** Re-reads creatives + scores (e.g. after a single-app fetch lands). */
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { creatives: joined, loading, error, refresh };
}
