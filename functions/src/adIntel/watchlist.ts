import { getFirestore } from 'firebase-admin/firestore';

/**
 * Single shared team watchlist: `watchlist/team` with `{ appIds: string[] }`.
 *
 * Rationale (from design doc): users share one competitor list rather than
 * per-user lists, so the ad-creatives fetch stays a single pass per genre
 * regardless of how many humans are on the team. Watchlist input resolution
 * (app name / store URL → unifiedAppId) happens client-side via a
 * `search_entities` proxy route; only the resolved unified IDs land here.
 */
const WATCHLIST_DOC = 'watchlist/team';

export async function getWatchlistAppIds(): Promise<string[]> {
  const db = getFirestore('companalysis');
  const doc = await db.doc(WATCHLIST_DOC).get();
  if (!doc.exists) return [];
  const data = doc.data();
  if (!data || !Array.isArray(data.appIds)) return [];
  return data.appIds.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/**
 * Combines the auto-derived top-N app list with the user-curated watchlist.
 * Preserves the top-N ordering first, then appends watchlist entries that
 * aren't already covered. Deduplicates across both inputs.
 */
export function mergeAppsWithWatchlist(topN: string[], watchlist: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of [...topN, ...watchlist]) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}
