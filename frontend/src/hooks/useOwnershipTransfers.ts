import { useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { OwnershipTransfer } from '../types/ownershipTransfers';

const FEED_LIMIT = 500;

/**
 * The AppBird ownership-transfers feed, newest first. Written weekly server-side
 * into the `ownershipTransfers` collection; we read the most recent slice and
 * let the page filter (store / search / time / publisher) client-side.
 */
export function useOwnershipTransfers() {
  const [transfers, setTransfers] = useState<OwnershipTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'ownershipTransfers'), orderBy('detectedAtTs', 'desc'), limit(FEED_LIMIT)),
        );
        const rows = snap.docs.map((d) => d.data() as OwnershipTransfer);
        if (!cancelled) {
          setTransfers(rows);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load transfers');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { transfers, loading, error };
}
