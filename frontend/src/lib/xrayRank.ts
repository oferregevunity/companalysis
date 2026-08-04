import type { XrayDimension, XrayReportRow } from '../types/xray';

/**
 * Pure ranking/filtering for the /sdks page. Kept out of the component so the
 * "what is a top game" rules live in one testable place.
 *
 * X-Ray has no popularity metric of its own, so ranking uses AppBird store data
 * back-filled onto each row: rating count is the only signal both stores publish,
 * so it is the default; installs exist on Play only.
 */

export type XraySort = 'popularity' | 'installs' | 'rank' | 'sdkCount' | 'recent' | 'name';

export interface XrayFilters {
  dimension: XrayDimension;
  /** Selected facet key, or null for "all groups". */
  facetKey: string | null;
  store: 'all' | 'AppStore' | 'GooglePlay';
  search: string;
  minSdkCount: number;
  /** Only rows whose popularity has been back-filled. */
  enrichedOnly: boolean;
  /**
   * `rowKey` values of the apps shipping the selected integration, or null for no
   * integration filter.
   *
   * Unlike the other filters this one cannot be derived from a row: X-Ray's report
   * rows carry no per-SDK data, so membership comes from a server-side filtered
   * query (`api.xrayIntegrationApps`) and is intersected here.
   */
  integrationKeys: Set<string> | null;
}

/** Identity of a row across both stores — the join key membership is expressed in. */
export function rowKey(row: Pick<XrayReportRow, 'store' | 'storeId'>): string {
  return `${row.store}:${row.storeId}`;
}

/** The facet key a row falls under for the given dimension. */
export function facetKeyOf(row: XrayReportRow, dimension: XrayDimension): string {
  if (dimension === 'mediator') return row.mediatorKey;
  if (dimension === 'publisherSdk') return row.publisherSdkKey;
  return row.engineKey;
}

/** The facet label a row falls under for the given dimension. */
export function facetLabelOf(row: XrayReportRow, dimension: XrayDimension): string {
  if (dimension === 'mediator') return row.mediatorLabel;
  if (dimension === 'publisherSdk') return row.publisherSdkLabel;
  return row.engineLabel;
}

/** Rating count — comparable across both stores. 0 when not yet enriched. */
export function popularityOf(row: XrayReportRow): number {
  return row.popularity?.numberVoters ?? 0;
}

export function isEnriched(row: XrayReportRow): boolean {
  return !!row.popularity?.fetchedAt;
}

function timeOf(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Sort comparator. Unenriched rows always sort after enriched ones on
 * popularity-based sorts, so a half-warm corpus still shows its best rows first
 * instead of interleaving zeros.
 */
export function compareRows(a: XrayReportRow, b: XrayReportRow, sort: XraySort): number {
  switch (sort) {
    case 'popularity': {
      const d = popularityOf(b) - popularityOf(a);
      return d !== 0 ? d : a.appName.localeCompare(b.appName);
    }
    case 'installs': {
      const d = (b.popularity?.installs ?? 0) - (a.popularity?.installs ?? 0);
      return d !== 0 ? d : popularityOf(b) - popularityOf(a);
    }
    case 'rank': {
      // Best (lowest) chart rank first; unranked and unenriched rows last.
      const ra = a.popularity?.bestRank ?? Number.POSITIVE_INFINITY;
      const rb = b.popularity?.bestRank ?? Number.POSITIVE_INFINITY;
      return ra !== rb ? ra - rb : popularityOf(b) - popularityOf(a);
    }
    case 'sdkCount': {
      const d = b.sdkCount - a.sdkCount;
      return d !== 0 ? d : b.adNetworkCount - a.adNetworkCount;
    }
    case 'recent': {
      const d = timeOf(b.teardownDate) - timeOf(a.teardownDate);
      return d !== 0 ? d : a.appName.localeCompare(b.appName);
    }
    case 'name':
      return a.appName.localeCompare(b.appName);
  }
}

/** Apply the filter bar, then sort. */
export function filterAndSortRows(
  rows: XrayReportRow[],
  filters: XrayFilters,
  sort: XraySort,
): XrayReportRow[] {
  const term = filters.search.trim().toLowerCase();
  const out = rows.filter((r) => {
    if (filters.integrationKeys && !filters.integrationKeys.has(rowKey(r))) return false;
    if (filters.facetKey && facetKeyOf(r, filters.dimension) !== filters.facetKey) return false;
    if (filters.store !== 'all' && r.store !== filters.store) return false;
    if (filters.minSdkCount > 0 && r.sdkCount < filters.minSdkCount) return false;
    if (filters.enrichedOnly && !isEnriched(r)) return false;
    if (term) {
      const hay = `${r.appName} ${r.publisher ?? ''} ${r.mediator ?? ''} ${r.publisherSdk ?? ''} ${r.engine ?? ''} ${r.storeId} ${r.bundleId ?? ''}`;
      if (!hay.toLowerCase().includes(term)) return false;
    }
    return true;
  });
  return out.sort((a, b) => compareRows(a, b, sort));
}

/**
 * Publisher leaderboard within the current selection — "who leans on this SDK
 * most", which the facet buckets alone don't answer.
 */
export function publisherBreakdown(rows: XrayReportRow[], limit = 8): { label: string; count: number }[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    const label = r.publisher?.trim() || 'Unattributed';
    acc.set(label, (acc.get(label) ?? 0) + 1);
  }
  return [...acc.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * Cross-tab of the *other* two dimensions inside the current selection — e.g.
 * for AppLovin MAX, which publisher SDKs and engines ship alongside it.
 */
export function crossFacet(
  rows: XrayReportRow[],
  dimension: XrayDimension,
  limit = 6,
): { label: string; count: number }[] {
  const acc = new Map<string, number>();
  for (const r of rows) {
    const label = facetLabelOf(r, dimension);
    acc.set(label, (acc.get(label) ?? 0) + 1);
  }
  return [...acc.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit);
}
