import { useState, useEffect, useMemo, useCallback } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { makeCreativeDocId, type CreativeScoreRow, type CreativeSubScores, type StoredCreative } from '../types/creatives';

export interface JoinedCreative extends StoredCreative {
  docId: string;
  score?: number;
  subScores?: CreativeSubScores;
}

const IN_LIMIT = 30;

/**
 * Creatives for a game workspace: `creativeLatest` rows for the given apps
 * (chunked `in` queries), joined with the workspace's score rows under
 * `creativeInsights/{scopeId}_week_{week}/scores`.
 */
export function useCreativesForApps(appIds: string[], scopeId: string, week: string) {
  const [creatives, setCreatives] = useState<StoredCreative[]>([]);
  const [scores, setScores] = useState<Map<string, CreativeScoreRow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const appKey = useMemo(() => [...new Set(appIds)].sort().join(','), [appIds]);

  useEffect(() => {
    const ids = appKey ? appKey.split(',') : [];
    if (ids.length === 0) {
      setCreatives([]);
      setScores(new Map());
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const loadedCreatives: StoredCreative[] = [];
        for (let i = 0; i < ids.length; i += IN_LIMIT) {
          const chunk = ids.slice(i, i + IN_LIMIT);
          const snap = await getDocs(query(collection(db, 'creativeLatest'), where('appId', 'in', chunk)));
          for (const d of snap.docs) {
            loadedCreatives.push(d.data() as StoredCreative);
          }
        }

        const scoresMap = new Map<string, CreativeScoreRow>();
        if (scopeId && week) {
          const scoresSnap = await getDocs(
            collection(db, 'creativeInsights', `${scopeId}_week_${week}`, 'scores'),
          );
          for (const s of scoresSnap.docs) {
            scoresMap.set(s.id, s.data() as CreativeScoreRow);
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
  }, [appKey, scopeId, week, refreshKey]);

  const joined: JoinedCreative[] = useMemo(() => {
    return creatives.map((c) => {
      const docId = makeCreativeDocId(c.appId, c.creativeKey);
      const s = scores.get(docId);
      return { ...c, docId, score: s?.score, subScores: s?.subScores };
    });
  }, [creatives, scores]);

  /** Re-reads creatives + scores (e.g. after fetch/analyze lands). */
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { creatives: joined, loading, error, refresh };
}
