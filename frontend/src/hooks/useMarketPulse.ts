import { useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { MarketPulseDoc } from '../types/creatives';

/**
 * Latest cross-genre Market Pulse doc. Market-wide (independent of the focused
 * workspace) — week keys sort lexicographically, so the newest week is first.
 */
export function useMarketPulse() {
  const [data, setData] = useState<MarketPulseDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'marketPulse'), orderBy('week', 'desc'), limit(1)));
        const doc = snap.docs[0]?.data() as MarketPulseDoc | undefined;
        if (!cancelled) setData(doc ?? null);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading };
}
