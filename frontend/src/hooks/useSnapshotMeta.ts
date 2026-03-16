import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Snapshot } from '../types';

/**
 * Lightweight hook that only loads snapshot metadata (no app subcollections).
 * Use this on the Dashboard where you only need counts and dates.
 */
export function useSnapshotMeta(genreId: string | undefined) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!genreId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchMeta() {
      try {
        setLoading(true);
        const q = query(
          collection(db, 'snapshots'),
          where('genreId', '==', genreId),
          orderBy('month', 'asc')
        );
        const snap = await getDocs(q);
        if (cancelled) return;

        setSnapshots(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            fetchedAt: d.data().fetchedAt?.toDate() || new Date(),
          })) as Snapshot[]
        );
      } catch {
        // silently fail for dashboard cards
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchMeta();
    return () => { cancelled = true; };
  }, [genreId]);

  const latestFetchedAt = snapshots.length > 0
    ? snapshots.reduce((latest, s) => (s.fetchedAt > latest ? s.fetchedAt : latest), snapshots[0].fetchedAt)
    : null;

  return { snapshots, latestFetchedAt, loading };
}
