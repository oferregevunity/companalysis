import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { XrayIntegration, XrayIntegrationAppsResult } from '../types/xray';

/**
 * The X-Ray integration filter: the vocabulary of SDK / ad-network names, plus the
 * app membership for whichever one is selected.
 *
 * Both come from the API rather than Firestore, because both are resolved and
 * cached server-side — report rows carry no per-SDK data, so "which games ship X"
 * needs AppBird's `integration` filter, which is billed per page. The server caches
 * membership, so re-picking a value costs nothing; `loadAll` exists because a broad
 * SDK is returned capped (`partial`) rather than paging the whole corpus by default.
 */
export function useXrayIntegrations() {
  const [options, setOptions] = useState<XrayIntegration[]>([]);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [membership, setMembership] = useState<XrayIntegrationAppsResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Vocabulary is 5 credits and cached a week server-side, so it loads eagerly.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.xrayIntegrations();
        if (!cancelled) {
          setOptions(res.integrations);
          setOptionsError(null);
        }
      } catch (err) {
        if (!cancelled) setOptionsError(err instanceof Error ? err.message : 'Failed to load integrations');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolve = useCallback(async (integration: string | null, opts: { fetchAll?: boolean } = {}) => {
    setSelected(integration);
    setError(null);
    if (!integration) {
      setMembership(null);
      return;
    }
    setResolving(true);
    try {
      setMembership(await api.xrayIntegrationApps(integration, opts));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve integration');
      setMembership(null);
    } finally {
      setResolving(false);
    }
  }, []);

  /** Complete a capped membership. Costs more requests, so it is always explicit. */
  const loadAll = useCallback(async () => {
    if (selected) await resolve(selected, { fetchAll: true });
  }, [resolve, selected]);

  /**
   * Join keys for `filterAndSortRows`, or null when no integration is selected.
   * Null while resolving too — filtering against a half-resolved set would flash a
   * wrong, smaller game list.
   *
   * Memoized because it is a `useMemo` dependency for filtering ~1200 rows: a fresh
   * Set each render would re-filter and re-sort the whole corpus every time.
   */
  const keys = useMemo(
    () =>
      selected && membership && !resolving
        ? new Set(membership.apps.map((a) => `${a.store}:${a.storeId}`))
        : null,
    [selected, membership, resolving],
  );

  return { options, optionsError, selected, membership, resolving, error, resolve, loadAll, keys };
}
