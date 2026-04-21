import { useState, useEffect } from 'react';
import {
  collection,
  doc,
  documentId,
  getDocs,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { AppNameEntry } from '../types/creatives';

export interface WatchlistEntry {
  appId: string;
  name: string;
  publisherName: string;
  iconUrl?: string | null;
}

export function useCreativeWatchlist() {
  const [appIds, setAppIds] = useState<string[]>([]);
  const [resolvedEntries, setResolvedEntries] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'watchlist', 'team'),
      (snap) => {
        const data = snap.exists() ? (snap.data() as { appIds?: string[] }) : {};
        setAppIds(Array.isArray(data.appIds) ? data.appIds : []);
        setLoading(false);
      },
      (err) => {
        console.error('useCreativeWatchlist', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (appIds.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setResolvedEntries([]);
      const chunks: string[][] = [];
      for (let i = 0; i < appIds.length; i += 30) chunks.push(appIds.slice(i, i + 30));
      const out: WatchlistEntry[] = [];
      for (const chunk of chunks) {
        const snap = await getDocs(query(collection(db, 'appNames'), where(documentId(), 'in', chunk)));
        for (const d of snap.docs) {
          const a = d.data() as AppNameEntry;
          out.push({
            appId: a.unifiedAppId || d.id,
            name: a.name || 'Unknown',
            publisherName: a.publisherName ?? '',
            iconUrl: a.iconUrl ?? null,
          });
        }
      }
      const byId = new Map(out.map((e) => [e.appId, e]));
      const ordered = appIds.map(
        (id) =>
          byId.get(id) ?? { appId: id, name: 'Unknown', publisherName: '', iconUrl: null },
      );
      if (!cancelled) setResolvedEntries(ordered);
    })();
    return () => {
      cancelled = true;
    };
  }, [appIds]);

  const entries = appIds.length === 0 ? [] : resolvedEntries;

  return { appIds, entries, loading, error };
}
