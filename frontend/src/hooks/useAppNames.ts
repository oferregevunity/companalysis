import { useEffect, useMemo, useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { AppNameEntry } from '../types/creatives';

export type AppNameMapEntry = {
  name: string;
  publisherName: string;
  iconUrl?: string | null;
};

/**
 * Resolves display names for unified app ids via chunked `appNames` lookups.
 */
export function useAppNames(appIds: string[]) {
  const uniqueSorted = useMemo(() => [...new Set(appIds.filter(Boolean))].sort(), [appIds]);

  const [map, setMap] = useState<Map<string, AppNameMapEntry>>(new Map());

  useEffect(() => {
    if (uniqueSorted.length === 0) {
      setMap(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < uniqueSorted.length; i += 30) {
        chunks.push(uniqueSorted.slice(i, i + 30));
      }
      const out = new Map<string, AppNameMapEntry>();
      for (const chunk of chunks) {
        const snap = await getDocs(query(collection(db, 'appNames'), where(documentId(), 'in', chunk)));
        for (const d of snap.docs) {
          const a = d.data() as AppNameEntry;
          const entry: AppNameMapEntry = {
            name: a.name || 'Unknown',
            publisherName: a.publisherName ?? '',
            iconUrl: a.iconUrl ?? null,
          };
          const primary = a.unifiedAppId || d.id;
          out.set(primary, entry);
          if (d.id !== primary) {
            out.set(d.id, entry);
          }
        }
      }
      if (!cancelled) setMap(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [uniqueSorted]);

  return map;
}
