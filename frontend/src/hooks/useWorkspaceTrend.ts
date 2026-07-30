import { useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { CreativeInsightDoc } from '../types/creatives';

/**
 * Last N analyzed weeks for a workspace scope — the history behind the
 * week-over-week trend (#6). Reads `creativeInsights` where `genreId == scopeId`,
 * newest-first, and reuses the existing `genreId + generatedAt DESC` index (no
 * new index). Each scope has one doc per week (`..._week_{week}`), so the caller
 * dedupes/sorts by the `week` field itself (see `buildCompositionTrend`).
 *
 * `enabled` gates the fetch so the query only fires when the Trends modal opens —
 * a plain one-shot `getDocs` (history, not live). Scores-only weeks (a fetch that
 * never ran analysis → no `generatedAt`) are skipped.
 */
const WEEK_LIMIT = 12;

/** Minimal normalizer: keep only the fields the trend consumes, defaulted. */
function normalize(raw: Record<string, unknown>): CreativeInsightDoc | null {
  if (raw.generatedAt == null) return null; // scores-only doc — analysis never ran
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
    creativeTags: Array.isArray(raw.creativeTags) ? (raw.creativeTags as CreativeInsightDoc['creativeTags']) : [],
    videoAnalyses: Array.isArray(raw.videoAnalyses)
      ? (raw.videoAnalyses as CreativeInsightDoc['videoAnalyses'])
      : [],
  };
}

export function useWorkspaceTrend(scopeId: string, enabled: boolean) {
  const [weekDocs, setWeekDocs] = useState<CreativeInsightDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !scopeId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'creativeInsights'),
            where('genreId', '==', scopeId),
            orderBy('generatedAt', 'desc'),
            limit(WEEK_LIMIT),
          ),
        );
        const docs: CreativeInsightDoc[] = [];
        for (const d of snap.docs) {
          const doc = normalize(d.data() as Record<string, unknown>);
          if (doc && doc.week) docs.push(doc);
        }
        if (!cancelled) setWeekDocs(docs);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scopeId, enabled]);

  return { weekDocs, loading, error };
}
