import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { Snapshot, AppData } from '../types';

export function useSnapshots(genreId: string | undefined) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [appsByMonth, setAppsByMonth] = useState<Record<string, AppData[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genreId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchData() {
      try {
        setLoading(true);
        setError(null);

        const snapshotsQuery = query(
          collection(db, 'snapshots'),
          where('genreId', '==', genreId),
          orderBy('month', 'asc')
        );
        const snapshotsSnapshot = await getDocs(snapshotsQuery);

        if (cancelled) return;

        const snaps: Snapshot[] = snapshotsSnapshot.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          fetchedAt: d.data().fetchedAt?.toDate() || new Date(),
        })) as Snapshot[];

        setSnapshots(snaps);

        const monthResults = await Promise.all(
          snaps.map(async (snap) => {
            const appsSnapshot = await getDocs(collection(db, 'snapshots', snap.id, 'apps'));
            return { month: snap.month, apps: appsSnapshot.docs.map((d) => d.data() as AppData) };
          })
        );

        if (cancelled) return;

        const monthData: Record<string, AppData[]> = {};
        for (const { month, apps } of monthResults) {
          monthData[month] = apps;
        }

        setAppsByMonth(monthData);
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data');
          setLoading(false);
        }
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [genreId]);

  const months = useMemo(() => snapshots.map((s) => s.month), [snapshots]);

  const latestFetchedAt = useMemo(() => {
    if (snapshots.length === 0) return null;
    return snapshots.reduce((latest, s) => (s.fetchedAt > latest ? s.fetchedAt : latest), snapshots[0].fetchedAt);
  }, [snapshots]);

  return { snapshots, appsByMonth, months, latestFetchedAt, loading, error };
}
