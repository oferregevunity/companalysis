import { fetchTopApps, resolveAppMetadata } from './client';
import type { AppMetadata } from './client';
import { getCachedMetadata, cacheMetadata } from './fetchTopApps';

export interface CompetitorRow {
  appId: string;
  name: string;
  publisherName: string;
  iosAppId: string | null;
  androidAppId: string | null;
  iconUrl: string | null;
  /** Last complete month's store revenue (USD). */
  revenue: number;
  /** Last complete month's downloads. */
  downloads: number;
}

/** The most recent complete calendar month, formatted for Sensor Tower. */
export function lastCompleteMonthRange(now = new Date()): { startDate: string; endDate: string } {
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const year = start.getFullYear();
  const month = String(start.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, start.getMonth() + 1, 0).getDate();
  return {
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Live competitor lookup for the Creatives page: top apps by revenue in a
 * Sensor Tower category for the last complete month, straight from the API
 * (not from our stored snapshots), enriched with names/icons.
 */
export async function fetchCompetitorsForCategory(params: {
  authToken: string;
  category: string;
  country?: string;
  excludeAppId?: string;
  limit?: number;
}): Promise<CompetitorRow[]> {
  const { authToken, category, excludeAppId } = params;
  const country = params.country || 'US';
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 100);
  const { startDate, endDate } = lastCompleteMonthRange();

  const apps = await fetchTopApps({
    authToken,
    os: 'unified',
    category,
    country,
    startDate,
    endDate,
    // One extra row so we can drop the focused game and still return `limit`.
    limit: limit + 1,
  });

  const rows = apps.filter(a => a.appId !== excludeAppId && a.appId !== 'unknown').slice(0, limit);

  const appIds = rows.map(a => a.appId);
  const resolved = new Map<string, AppMetadata>(await getCachedMetadata(appIds));
  const uncached = appIds.filter(id => !resolved.has(id) || !resolved.get(id)?.iconUrl);
  if (uncached.length > 0) {
    try {
      const fresh = await resolveAppMetadata(uncached, authToken);
      // A failed lookup falls back to `name === id` — never let that replace a good cached name.
      const usable = new Map([...fresh].filter(([id, meta]) => meta.name !== id));
      for (const [id, meta] of usable) {
        resolved.set(id, meta);
      }
      await cacheMetadata(usable);
    } catch (err) {
      console.warn('Competitor metadata resolution partially failed:', err);
    }
  }

  return rows.map(app => {
    const meta = resolved.get(app.appId);
    return {
      appId: app.appId,
      name: meta?.name || app.appId,
      publisherName: meta?.publisherName || '',
      iosAppId: meta?.iosAppId ?? null,
      androidAppId: meta?.androidAppId ?? null,
      iconUrl: meta?.iconUrl ?? null,
      revenue: app.revenue,
      downloads: app.downloads,
    };
  });
}
