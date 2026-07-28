import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CreativeInsightDoc } from '../types/creatives';

/**
 * The scoring pass writes a partial `creativeInsights` doc (`merge: true` with
 * only genreId/week/scoredAt/scoredCount) — e.g. after a single-app fetch on a
 * week that was never analyzed. Treat those as "no analysis yet" and default
 * every array/string field so consumers never hit undefined.
 */
function normalizeInsightDoc(raw: Record<string, unknown>): CreativeInsightDoc | null {
  if (raw.generatedAt == null) return null; // scores-only doc — insights never ran
  return {
    genreId: typeof raw.genreId === 'string' ? raw.genreId : '',
    week: typeof raw.week === 'string' ? raw.week : '',
    generatedAt: raw.generatedAt as CreativeInsightDoc['generatedAt'],
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    winners: Array.isArray(raw.winners) ? (raw.winners as CreativeInsightDoc['winners']) : [],
    emergingConcepts: Array.isArray(raw.emergingConcepts)
      ? (raw.emergingConcepts as CreativeInsightDoc['emergingConcepts'])
      : [],
    watchList: Array.isArray(raw.watchList) ? (raw.watchList as CreativeInsightDoc['watchList']) : [],
    creativeTags: Array.isArray(raw.creativeTags)
      ? (raw.creativeTags as CreativeInsightDoc['creativeTags'])
      : [],
    videoAnalyses: Array.isArray(raw.videoAnalyses)
      ? (raw.videoAnalyses as CreativeInsightDoc['videoAnalyses'])
      : [],
    ...(typeof raw.geminiError === 'string' ? { geminiError: raw.geminiError } : {}),
  };
}

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
        setData(snap.exists() ? normalizeInsightDoc(snap.data() as Record<string, unknown>) : null);
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
