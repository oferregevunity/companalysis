import { useEffect, useState } from 'react';
import { searchGames, type SearchedGame } from '../lib/creativesApi';

const DEBOUNCE_MS = 350;
const MIN_TERM_LENGTH = 2;

/** Session cache: the ST catalog doesn't change mid-session and repeat keystrokes are common. */
const searchCache = new Map<string, SearchedGame[]>();

interface SettledSearch {
  key: string;
  results: SearchedGame[];
  error: string | null;
}

/**
 * Debounced live game search against the Sensor Tower catalog (via the
 * `apps/search` function). Finds any app, not just ones we track.
 */
export function useGameSearch(term: string) {
  const trimmed = term.trim();
  const key = trimmed.toLowerCase();
  const active = trimmed.length >= MIN_TERM_LENGTH;

  // Only the last settled request is kept; everything else derives from it
  // and the cache, so stale responses can never clobber the current term.
  const [settled, setSettled] = useState<SettledSearch | null>(null);

  useEffect(() => {
    if (!active || searchCache.has(key)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { apps } = await searchGames(trimmed);
          searchCache.set(key, apps);
          if (!cancelled) setSettled({ key, results: apps, error: null });
        } catch (err) {
          if (!cancelled) {
            setSettled({ key, results: [], error: err instanceof Error ? err.message : 'Search failed.' });
          }
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, key, trimmed]);

  const cached = active ? searchCache.get(key) : undefined;
  const results = !active ? [] : cached ?? (settled?.key === key ? settled.results : []);
  const error = active && settled?.key === key ? settled.error : null;
  const searching = active && cached === undefined && settled?.key !== key;

  return { results, searching, error };
}
