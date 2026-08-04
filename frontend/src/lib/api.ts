import { auth } from './firebase';
import type { SavedViewPayload, SavedViewVisibility } from '../types/savedView';
import type { AppbirdAppDetails } from '../types/appbirdApp';
import type {
  XrayIntegrationAppsResult,
  XrayIntegrationsResult,
  XrayPopularityResult,
  XrayTeardownResult,
} from '../types/xray';

const API_BASE = '/api';

export async function apiCall<T = any>(path: string, body: Record<string, any> = {}): Promise<T> {
  const user = auth.currentUser;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (user) {
    const token = await user.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

export const api = {
  addGenre: (
    name: string,
    categoryIds: { ios: string; android: string },
    country: string = 'US',
    monthsBack: number = 6
  ) =>
    apiCall<{ id: string; name: string }>('genres/add', { name, categoryIds, country, monthsBack }),

  updateGenre: (id: string, updates: {
    name?: string;
    categoryIds?: any;
    country?: string;
    monthsBack?: number;
    active?: boolean;
  }) =>
    apiCall('genres/update', { id, ...updates }),

  deleteGenre: (id: string) =>
    apiCall('genres/delete', { id }),

  triggerFetch: (genreIds?: string[]) =>
    apiCall<{ success: boolean; processed: string[]; errors: string[] }>(
      'fetch/trigger',
      genreIds && genreIds.length > 0 ? { genreIds } : {}
    ),

  fetchPlan: (genreIds: string[], refetch?: boolean) =>
    apiCall<{ plan: { genreId: string; genreName: string; months: { month: string; startDate: string; endDate: string }[] }[] }>(
      'fetch/plan', { genreIds, refetch: !!refetch }
    ),

  fetchMonth: (genreId: string, month: string, startDate: string, endDate: string) =>
    apiCall<{ success: boolean; appCount: number; error?: string }>(
      'fetch/month', { genreId, month, startDate, endDate }
    ),

  fetchWeekPlan: (genreIds: string[]) =>
    apiCall<{ plan: { genreId: string; genreName: string; weeks: { week: string; startDate: string; endDate: string }[] }[] }>(
      'fetch/week-plan', { genreIds }
    ),

  fetchWeek: (genreId: string, week: string, startDate: string, endDate: string) =>
    apiCall<{ success: boolean; appCount: number; error?: string }>(
      'fetch/week', { genreId, week, startDate, endDate }
    ),

  deleteAnalysis: (genreId: string) =>
    apiCall<{ success: boolean; snapshotsDeleted: number }>('analysis/delete', { genreId }),

  saveComment: (appId: string, genreId: string, comment: string) =>
    apiCall('comments/save', { appId, genreId, comment }),

  /** Full AppBird store listing for one app (24h server-side cache). */
  appbirdApp: (storeId: string, refresh = false) =>
    apiCall<AppbirdAppDetails>('appbird/app', { storeId, refresh }),

  /** Full AppBird X-Ray teardown for one app (cached per report id). */
  xrayReport: (args: { storeId: string; store?: string; expectedReportId?: string; refresh?: boolean }) =>
    apiCall<XrayTeardownResult>('xray/report', args),

  /** Values accepted by the X-Ray `integration` filter (cached a week server-side). */
  xrayIntegrations: (refresh = false) => apiCall<XrayIntegrationsResult>('xray/integrations', { refresh }),

  /**
   * Apps shipping one integration. Cached server-side, so a repeat pick is free;
   * `fetchAll` opts into completing a `partial` result at the cost of more requests.
   */
  xrayIntegrationApps: (integration: string, opts: { fetchAll?: boolean; refresh?: boolean } = {}) =>
    apiCall<XrayIntegrationAppsResult>('xray/integrationApps', { integration, ...opts }),

  /** Back-fill store popularity (installs/ratings) for specific X-Ray rows. */
  xrayPopularity: (storeIds: string[], force = false) =>
    apiCall<XrayPopularityResult>('xray/popularity', { storeIds, force }),

  /** Re-crawl the X-Ray corpus and enrich a slice of it. Normally the weekly job. */
  xrayRun: (enrichLimit?: number) =>
    apiCall<{ total: number; pages: number; written: number; enriched: number; remaining: number; errors: string[] }>(
      'xray/run',
      enrichLimit === undefined ? {} : { enrichLimit },
    ),

  savedViews: {
    create: (args: {
      name: string;
      payload: SavedViewPayload;
      visibility: SavedViewVisibility;
      sharedWithEmails?: string[];
    }) => apiCall<{ id: string }>('savedViews/create', args),

    invite: (presetId: string, email: string) =>
      apiCall<{ success: boolean }>('savedViews/invite', { presetId, email }),
  },
};

export async function generateInsights(granularity: 'month' | 'week' = 'month') {
  return apiCall('insights/generate', { granularity });
}
