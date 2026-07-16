import { auth } from './firebase';

const FUNCTION_BASE =
  (import.meta.env.VITE_CREATIVES_FUNCTION_URL as string | undefined)?.replace(/\/$/, '') ||
  'https://us-central1-supersonic-291210.cloudfunctions.net/compAnalysisApi';

// The creatives pipeline can run for several minutes (fetch → score → Gemini),
// which exceeds Firebase Hosting's ~60s rewrite timeout and surfaces in the UI
// as "Unexpected token '<'" because hosting returns an HTML timeout page.
// We call the Cloud Function URL directly (CORS is enabled) so the browser
// observes the full 540s function timeout.
async function callFunction<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const user = auth.currentUser;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) {
    const token = await user.getIdToken();
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(`${FUNCTION_BASE}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `Non-JSON response from ${path} (status ${res.status}): ${text.slice(0, 200)}`,
    );
  }
  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data as T;
}

export interface TriggerCreativesResult {
  success: boolean;
  creativeCount: number;
  scoredCount: number;
  insightsGenerated: boolean;
  partialErrors: string[];
}

export function triggerCreativesForGenre(
  genreId: string,
  weekStart: string,
  weekEnd: string,
): Promise<TriggerCreativesResult> {
  return callFunction<TriggerCreativesResult>('creatives/trigger', { genreId, weekStart, weekEnd });
}

export interface FetchAppCreativesResult {
  success: boolean;
  creativeCount: number;
  scoredCount: number;
  partialErrors: string[];
}

/**
 * Fetches this week's creatives for a single app (e.g. the focused game when
 * it wasn't in the top-N scope), merges them into the genre snapshot, adds
 * the app to the team watchlist, and re-runs statistical scoring.
 */
export function fetchCreativesForApp(
  appId: string,
  genreId: string,
  weekStart: string,
  weekEnd: string,
): Promise<FetchAppCreativesResult> {
  return callFunction<FetchAppCreativesResult>('creatives/fetch-app', { appId, genreId, weekStart, weekEnd });
}

/** One unified-app hit from Sensor Tower search (via our `apps/search` proxy). */
export interface SearchedGame {
  appId: string;
  name: string;
  publisherName: string;
  iosAppId: string | null;
  androidAppId: string | null;
  iconUrl: string | null;
  /** iOS numeric category ids as strings (e.g. "7017"). */
  iosCategories: string[];
  /** Android category slugs, upper-cased (e.g. "GAME_STRATEGY"). */
  androidCategories: string[];
  /** Sensor Tower's best single game category (iOS numeric id as string). */
  gameCategory: string | null;
}

/** Live game search against the Sensor Tower catalog — any app, not just tracked ones. */
export function searchGames(term: string): Promise<{ apps: SearchedGame[] }> {
  return callFunction<{ apps: SearchedGame[] }>('apps/search', { term });
}

export interface ApiCompetitor {
  appId: string;
  name: string;
  publisherName: string;
  iosAppId: string | null;
  androidAppId: string | null;
  iconUrl: string | null;
  /** Last complete month's store revenue (USD). */
  revenue: number;
  downloads: number;
}

/** Live top-by-revenue competitors for a Sensor Tower category (last complete month). */
export function fetchCompetitorsForCategory(
  category: string,
  opts: { country?: string; excludeAppId?: string; limit?: number } = {},
): Promise<{ competitors: ApiCompetitor[] }> {
  return callFunction<{ competitors: ApiCompetitor[] }>('apps/competitors', { category, ...opts });
}

export function getWatchlistApps(): Promise<{ appIds: string[] }> {
  return callFunction<{ appIds: string[] }>('creatives/watchlist', {});
}

export function addToWatchlist(appId: string): Promise<{ success: boolean }> {
  return callFunction<{ success: boolean }>('creatives/watchlist/add', { appId });
}

export function removeFromWatchlist(appId: string): Promise<{ success: boolean }> {
  return callFunction<{ success: boolean }>('creatives/watchlist/remove', { appId });
}
