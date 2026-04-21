import { useState, useEffect } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface GenreDataStatus {
  lastFetchedAt: Date | null;
  months: string[];
  creatives?: {
    lastFetchedAt: Date | null;
    lastAnalyzedAt: Date | null;
    lastErroredAt: Date | null;
    latestWeek: string | null;
  };
}

function fsToDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v !== null && 'toDate' in v && typeof (v as { toDate: () => Date }).toDate === 'function') {
    return (v as { toDate: () => Date }).toDate();
  }
  if (typeof v === 'object' && v !== null && 'seconds' in v) {
    return new Date((v as { seconds: number }).seconds * 1000);
  }
  return null;
}

async function loadCreativesStatus(gid: string): Promise<GenreDataStatus['creatives']> {
  const snapLatestQ = query(
    collection(db, 'creativeSnapshots'),
    where('genreId', '==', gid),
    orderBy('fetchedAt', 'desc'),
    limit(1),
  );
  const insightLatestQ = query(
    collection(db, 'creativeInsights'),
    where('genreId', '==', gid),
    orderBy('generatedAt', 'desc'),
    limit(1),
  );
  const snapBatchQ = query(
    collection(db, 'creativeSnapshots'),
    where('genreId', '==', gid),
    orderBy('fetchedAt', 'desc'),
    limit(25),
  );

  const [snapLatest, insightLatest, snapBatch] = await Promise.all([
    getDocs(snapLatestQ),
    getDocs(insightLatestQ),
    getDocs(snapBatchQ),
  ]);

  const latestSnap = snapLatest.docs[0]?.data() as Record<string, unknown> | undefined;
  const latestInsight = insightLatest.docs[0]?.data() as Record<string, unknown> | undefined;

  const lastFetchedAt = fsToDate(latestSnap?.fetchedAt);
  const lastAnalyzedAt = fsToDate(latestInsight?.generatedAt);

  let lastErroredAt: Date | null = null;
  const geminiErr = latestInsight?.geminiError;
  if (typeof geminiErr === 'string' && geminiErr.trim() !== '') {
    lastErroredAt = fsToDate(latestInsight?.generatedAt);
  } else {
    for (const d of snapBatch.docs) {
      const data = d.data() as Record<string, unknown>;
      const pe = data.partialErrors;
      if (Array.isArray(pe) && pe.length > 0) {
        lastErroredAt = fsToDate(data.fetchedAt);
        break;
      }
    }
  }

  let latestWeek: string | null = null;
  if (typeof latestInsight?.week === 'string' && latestInsight.week) {
    latestWeek = latestInsight.week;
  } else if (typeof latestSnap?.week === 'string' && latestSnap.week) {
    latestWeek = latestSnap.week;
  }

  return {
    lastFetchedAt,
    lastAnalyzedAt,
    lastErroredAt,
    latestWeek,
  };
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
        await Promise.all(
          genreIds.map(async (gid) => {
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

            let creatives: GenreDataStatus['creatives'];
            try {
              creatives = await loadCreativesStatus(gid);
            } catch {
              creatives = {
                lastFetchedAt: null,
                lastAnalyzedAt: null,
                lastErroredAt: null,
                latestWeek: null,
              };
            }

            result[gid] = { lastFetchedAt: latest, months, creatives };
          }),
        );

        if (!cancelled) setStatusMap(result);
      } catch {
        // silent
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return { statusMap, loading };
}
