import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CreativeInsightDoc } from '../types/creatives';

export function useCreativeInsights(genreId: string, week: string) {
  const [data, setData] = useState<CreativeInsightDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!genreId || !week) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      doc(db, 'creativeInsights', `${genreId}_week_${week}`),
      (snap) => {
        setData(snap.exists() ? (snap.data() as CreativeInsightDoc) : null);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('useCreativeInsights', err);
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [genreId, week]);

  return { data, loading, error };
}
