import { useEffect, useMemo, useState } from 'react';
import { fetchCompetitorsForCategory, type ApiCompetitor } from '../lib/creativesApi';

const FETCH_LIMIT = 41; // one extra so excluding the focused game still leaves 40
const MAX_COMPETITORS = 40;

/** Session cache keyed by category|country — independent of the focused game. */
const competitorCache = new Map<string, ApiCompetitor[]>();

interface SettledFetch {
  key: string;
  rows: ApiCompetitor[];
  error: string | null;
}

export interface ApiCompetitorsResult {
  /** Top-revenue apps in the category, excluding the focused game. */
  competitors: ApiCompetitor[];
  /** The focused game's own row when it ranks in the category top list. */
  focusRow: ApiCompetitor | null;
  loading: boolean;
  error: string | null;
}

/**
 * Live competitors for the focused game, straight from Sensor Tower: top
 * apps by revenue (last complete month) in the game's category.
 */
export function useApiCompetitors(
  category: string | null,
  country: string,
  focusAppId: string | null,
): ApiCompetitorsResult {
  const key = category && focusAppId ? `${category}|${country}` : null;
  const [settled, setSettled] = useState<SettledFetch | null>(null);

  useEffect(() => {
    if (!key || !category || competitorCache.has(key)) return;
    let cancelled = false;
    void (async () => {
      try {
        const { competitors } = await fetchCompetitorsForCategory(category, {
          country,
          limit: FETCH_LIMIT,
        });
        competitorCache.set(key, competitors);
        if (!cancelled) setSettled({ key, rows: competitors, error: null });
      } catch (err) {
        if (!cancelled) {
          setSettled({
            key,
            rows: [],
            error: err instanceof Error ? err.message : 'Failed to load competitors.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key, category, country]);

  return useMemo(() => {
    const cached = key ? competitorCache.get(key) : undefined;
    const rows = !key ? [] : cached ?? (settled?.key === key ? settled.rows : []);
    return {
      competitors: rows.filter((r) => r.appId !== focusAppId).slice(0, MAX_COMPETITORS),
      focusRow: rows.find((r) => r.appId === focusAppId) ?? null,
      loading: key != null && cached === undefined && settled?.key !== key,
      error: key && settled?.key === key ? settled.error : null,
    };
  }, [key, settled, focusAppId]);
}
