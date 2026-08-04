import { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { api } from '../lib/api';
import type { XrayFacets, XrayReportRow } from '../types/xray';

/**
 * The X-Ray read model: every report row plus the precomputed facet
 * leaderboards. The corpus is ~1200 small docs and only changes weekly, so it is
 * loaded once and faceted/sorted in memory (the Firestore IndexedDB cache serves
 * repeat visits) — the same approach the transfers feed uses.
 */
const CORPUS_LIMIT = 3000;

export function useXrayReports() {
  const [rows, setRows] = useState<XrayReportRow[]>([]);
  const [facets, setFacets] = useState<XrayFacets | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [reportsSnap, facetsSnap] = await Promise.all([
      getDocs(query(collection(db, 'xrayReports'), orderBy('teardownDateTs', 'desc'), limit(CORPUS_LIMIT))),
      getDoc(doc(db, 'xrayFacets', 'latest')),
    ]);
    return {
      rows: reportsSnap.docs.map((d) => d.data() as XrayReportRow),
      facets: facetsSnap.exists() ? (facetsSnap.data() as XrayFacets) : null,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await load();
        if (!cancelled) {
          setRows(res.rows);
          setFacets(res.facets);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load X-Ray reports');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  /**
   * Back-fill store popularity for specific apps, then re-read so the table can
   * rank them. Used for rows the weekly enrichment pass hasn't reached yet.
   */
  const enrich = useCallback(
    async (storeIds: string[]) => {
      if (storeIds.length === 0) return;
      await api.xrayPopularity(storeIds.slice(0, 60));
      const res = await load();
      setRows(res.rows);
      setFacets(res.facets);
    },
    [load],
  );

  return { rows, facets, loading, error, enrich };
}
