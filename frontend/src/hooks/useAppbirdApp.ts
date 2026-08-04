import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AppbirdAppDetails } from '../types/appbirdApp';

/**
 * Session-lifetime cache so reopening the same app's detail screen is instant.
 * The server also caches (24h in Firestore); this just avoids the round trip.
 */
const cache = new Map<string, AppbirdAppDetails>();

/**
 * Load one app's AppBird store listing. Pass `null` to stay idle (e.g. while the
 * detail modal is closed).
 */
export function useAppbirdApp(storeId: string | null) {
  const [details, setDetails] = useState<AppbirdAppDetails | null>(
    storeId ? cache.get(storeId) ?? null : null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string, refresh: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.appbirdApp(id, refresh);
      cache.set(id, res);
      return res;
    } catch (err) {
      throw err instanceof Error ? err : new Error('Failed to load app details');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!storeId) {
      setDetails(null);
      setError(null);
      return;
    }

    const cached = cache.get(storeId);
    if (cached) {
      setDetails(cached);
      setError(null);
      return;
    }

    let cancelled = false;
    setDetails(null);
    void load(storeId, false)
      .then((res) => {
        if (!cancelled) setDetails(res);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [storeId, load]);

  /** Force a live AppBird pull, bypassing both caches. */
  const refresh = useCallback(async () => {
    if (!storeId) return;
    try {
      setDetails(await load(storeId, true));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh app details');
    }
  }, [storeId, load]);

  return { details, loading, error, refresh };
}
