import { useCallback, useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { fetchMarketOpportunity, type MarketApp, type MarketPresence } from '../lib/creativesApi';

/**
 * Country + OS market opportunity for a workspace. Reads any previously
 * computed `gameWorkspaces/{focusAppId}.marketPresence` on mount (so results
 * persist across visits), and exposes `run()` to (re)compute on demand — the
 * fetch is heavy (per-country Sensor Tower calls) so it never runs
 * automatically as part of the main analyze flow.
 */
export function useMarketOpportunity(focusAppId: string | null) {
  const [data, setData] = useState<MarketPresence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusAppId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'gameWorkspaces', focusAppId));
        const mp = snap.exists() ? (snap.data() as { marketPresence?: MarketPresence }).marketPresence : undefined;
        if (!cancelled) setData(mp ?? null);
      } catch {
        /* a missing/denied read just means "not computed yet" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [focusAppId]);

  const run = useCallback(
    async (apps: MarketApp[], category: string, androidCategory: string | null, primaryCountry: string) => {
      if (!focusAppId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await fetchMarketOpportunity({ focusAppId, apps, category, androidCategory, primaryCountry });
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Market lookup failed.');
      } finally {
        setLoading(false);
      }
    },
    [focusAppId],
  );

  return { data, loading, error, run };
}
