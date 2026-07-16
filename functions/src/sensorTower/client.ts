import fetch from 'node-fetch';
import { defineSecret } from 'firebase-functions/params';

export const sensorTowerAuthToken = defineSecret('SENSOR_TOWER_AUTH_TOKEN');

const BASE_URL = 'https://api.sensortower.com/v1';
const REQUEST_DELAY_MS = 300;
const MAX_RETRIES = 3;
const NAME_LOOKUP_CONCURRENCY = 20;
const MAX_OFFSET = 10000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options?: { headers?: Record<string, string> },
  retries = MAX_RETRIES
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const backoff = Math.pow(2, attempt) * 2000;
        console.warn(`Rate limited, retrying in ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`API error ${response.status}: ${response.statusText} - ${body.slice(0, 300)}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      const backoff = Math.pow(2, attempt) * 1000;
      console.warn(`Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoff}ms...`, error);
      await sleep(backoff);
    }
  }
}

export interface ParsedApp {
  appId: string;
  downloads: number;
  revenue: number;
}

export interface AppMetadata {
  name: string;
  publisherName: string;
  iosAppId: string | null;
  androidAppId: string | null;
  iconUrl?: string | null;
}

/** One unified-app hit from Sensor Tower's `search_entities`, with the category info needed to map it to a tracked genre. */
export interface SearchedApp {
  appId: string;
  name: string;
  publisherName: string;
  iosAppId: string | null;
  androidAppId: string | null;
  iconUrl: string | null;
  /** iOS numeric category ids as strings (e.g. "7017"). */
  iosCategories: string[];
  /** Android category slugs, upper-cased to match genre config (e.g. "GAME_STRATEGY"). */
  androidCategories: string[];
  /** Sensor Tower's best single game category (iOS numeric id as string), if any. */
  gameCategory: string | null;
}

function parseSearchItem(item: any): SearchedApp {
  const iosApp = item.ios_apps?.[0];
  const androidApp = item.android_apps?.[0];
  const iosCategories = (iosApp?.categories ?? [])
    .map((c: unknown) => String(c))
    .filter((c: string) => c.length > 0);
  const androidCategories = (androidApp?.categories ?? [])
    .map((c: unknown) => String(c).toUpperCase())
    .filter((c: string) => c.length > 0);
  const gameCategory = item.game_category ?? item.primary_category;
  return {
    appId: String(item.app_id ?? item.id ?? ''),
    name: item.name || item.humanized_name || String(item.app_id ?? ''),
    publisherName: item.publisher_name || '',
    iosAppId: iosApp?.app_id != null ? String(iosApp.app_id) : null,
    androidAppId: androidApp?.app_id != null ? String(androidApp.app_id) : null,
    iconUrl: item.icon_url || iosApp?.icon_url || androidApp?.icon_url || null,
    iosCategories,
    androidCategories,
    gameCategory: gameCategory != null ? String(gameCategory) : null,
  };
}

/**
 * Search Sensor Tower's unified app catalog by name. Powers the Creatives
 * page game search, so any live app is findable — not just tracked ones.
 */
export async function searchUnifiedApps(term: string, authToken: string, limit = 10): Promise<SearchedApp[]> {
  const url = `${BASE_URL}/unified/search_entities?` +
    new URLSearchParams({ entity_type: 'app', term, limit: String(limit) }).toString();

  const data = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  const items: any[] = Array.isArray(data) ? data : data?.items || data?.data || [];
  return items.map(parseSearchItem).filter((a) => a.appId);
}

/** Store-listing detail used to ground AI competitor discovery. */
export interface AppStoreDetail {
  name: string;
  publisherName: string;
  subtitle: string | null;
  description: string | null;
  categories: string[];
  lastMonthDownloads: number | null;
  lastMonthRevenue: number | null;
  topCountries: string[];
}

/**
 * Fetch one app's store-listing detail (description etc.) from Sensor Tower.
 * iOS is preferred (richer listing); falls back to Android when only that id
 * exists.
 */
export async function fetchAppStoreDetail(
  os: 'ios' | 'android',
  storeAppId: string,
  authToken: string,
  country = 'US',
): Promise<AppStoreDetail | null> {
  const url = `${BASE_URL}/${os}/apps?` +
    new URLSearchParams({ app_ids: storeAppId, country }).toString();
  const data = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const item = (data?.apps ?? data)?.[0];
  if (!item) return null;
  return {
    name: item.name || item.humanized_name || '',
    publisherName: item.publisher_name || '',
    subtitle: item.subtitle || null,
    description: typeof item.description === 'string' ? item.description : null,
    categories: (item.categories ?? []).map((c: unknown) => String(c)),
    lastMonthDownloads: item.humanized_worldwide_last_month_downloads?.downloads ?? null,
    lastMonthRevenue: item.humanized_worldwide_last_month_revenue?.revenue ?? null,
    topCountries: Array.isArray(item.top_countries) ? item.top_countries.map(String) : [],
  };
}

export interface FetchTopAppsParams {
  authToken: string;
  os: 'unified' | 'ios' | 'android';
  category: string;
  country: string;
  startDate: string;
  endDate: string;
  limit: number;
  timeRange?: 'month' | 'week';
}

export async function fetchTopApps(params: FetchTopAppsParams): Promise<ParsedApp[]> {
  const { authToken, os, category, country, startDate, endDate, limit } = params;
  const PAGE_SIZE = 500;
  const allApps: ParsedApp[] = [];
  let offset = 0;

  while (true) {
    const queryParams: Record<string, string> = {
      auth_token: authToken,
      comparison_attribute: 'absolute',
      time_range: params.timeRange || 'month',
      measure: 'revenue',
      date: startDate,
      category: category,
      regions: country,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    };

    if (endDate) {
      queryParams.end_date = endDate;
    }

    if (os === 'ios' || os === 'unified') {
      queryParams.device_type = 'total';
    }

    const url = `${BASE_URL}/${os}/sales_report_estimates_comparison_attributes?` +
      new URLSearchParams(queryParams).toString();

    console.log(`Calling Sensor Tower: ${os} category=${category} date=${startDate} offset=${offset} pageSize=${PAGE_SIZE}`);
    await sleep(REQUEST_DELAY_MS);
    const rawData = await fetchWithRetry(url);

    const items: any[] = Array.isArray(rawData) ? rawData : rawData?.results || rawData?.data || [];

    for (const item of items) {
      allApps.push({
        appId: item.app_id || 'unknown',
        downloads: item.units_absolute ?? 0,
        revenue: Math.round((item.revenue_absolute ?? 0) / 100),
      });
    }

    console.log(`  → got ${items.length} apps (total so far: ${allApps.length})`);

    if (items.length < PAGE_SIZE || (limit > 0 && allApps.length >= limit)) {
      break;
    }

    offset += PAGE_SIZE;

    if (offset >= MAX_OFFSET) {
      console.log(`Reached Sensor Tower max offset (${MAX_OFFSET}), stopping pagination with ${allApps.length} apps`);
      break;
    }
  }

  return limit > 0 ? allApps.slice(0, limit) : allApps;
}

/**
 * Resolve a batch of unified app IDs to metadata (name, publisher, store URLs)
 * via search_entities endpoint.
 */
export async function resolveAppMetadata(
  appIds: string[],
  authToken: string
): Promise<Map<string, AppMetadata>> {
  const metaMap = new Map<string, AppMetadata>();
  const uniqueIds = [...new Set(appIds)];

  console.log(`Resolving metadata for ${uniqueIds.length} unique app IDs...`);

  for (let i = 0; i < uniqueIds.length; i += NAME_LOOKUP_CONCURRENCY) {
    const batch = uniqueIds.slice(i, i + NAME_LOOKUP_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (id) => {
        const url = `${BASE_URL}/unified/search_entities?` +
          new URLSearchParams({ entity_type: 'app', term: id, limit: '1' }).toString();

        const data = await fetchWithRetry(url, {
          headers: { Authorization: `Bearer ${authToken}` },
        }, 1);

        const items = Array.isArray(data) ? data : data?.data || [];
        if (items.length > 0 && items[0].app_id === id) {
          const item = items[0];
          const iosApp = item.ios_apps?.[0];
          const androidApp = item.android_apps?.[0];

          return {
            id,
            meta: {
              name: item.name || item.humanized_name || id,
              publisherName: item.publisher_name || '',
              iosAppId: iosApp?.app_id ? String(iosApp.app_id) : null,
              androidAppId: androidApp?.app_id ? String(androidApp.app_id) : null,
              iconUrl: item.icon_url || iosApp?.icon_url || androidApp?.icon_url || null,
            } as AppMetadata,
          };
        }
        return { id, meta: { name: id, publisherName: '', iosAppId: null, androidAppId: null, iconUrl: null } as AppMetadata };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        metaMap.set(result.value.id, result.value.meta);
      }
    }

    if (i + NAME_LOOKUP_CONCURRENCY < uniqueIds.length) {
      await sleep(100);
    }
  }

  console.log(`Resolved metadata for ${metaMap.size} apps`);
  return metaMap;
}
