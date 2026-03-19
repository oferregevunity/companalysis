import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface GenreDataStatus {
  lastFetchedAt: Date | null;
  months: string[];
}

export function useGenreDataStatus(genreIds: string[]) {
  const [statusMap, setStatusMap] = useState<Record<string, GenreDataStatus>>({});
  const [loading, setLoading] = useState(false);

  const key = genreIds.sort().join(',');

  useEffect(() => {
    if (genreIds.length === 0) {
      setStatusMap({});
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      const result: Record<string, GenreDataStatus> = {};

      try {
        for (const gid of genreIds) {
          const q = query(collection(db, 'snapshots'), where('genreId', '==', gid));
          const snap = await getDocs(q);

          let latest: Date | null = null;
          const months: string[] = [];

          for (const doc of snap.docs) {
            const d = doc.data();
            const period = (d.month as string) || (d.week as string);
            if (period) months.push(period);
            const fetched = d.fetchedAt?.toDate?.();
            if (fetched && (!latest || fetched > latest)) {
              latest = fetched;
            }
          }

          months.sort();
          result[gid] = { lastFetchedAt: latest, months };
        }

        if (!cancelled) setStatusMap(result);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [key]);

  return { statusMap, loading };
}
