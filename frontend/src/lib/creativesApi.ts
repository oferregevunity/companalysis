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

/** Mirrors `DiscoveredCompetitor` in `functions/src/gameWorkspaces/discovery.ts`. */
export interface DiscoveredCompetitor {
  appId: string;
  name: string;
  publisherName: string;
  iosAppId: string | null;
  androidAppId: string | null;
  iconUrl: string | null;
  revenue: number | null;
  downloads: number | null;
  source: 'ai' | 'category';
  reason: string | null;
}

/** AI-grounded competitor discovery for a game (Gemini + ST resolve + category backfill). */
export function discoverCompetitors(
  game: SearchedGame,
  country: string,
): Promise<{ competitors: DiscoveredCompetitor[] }> {
  return callFunction<{ competitors: DiscoveredCompetitor[] }>('games/discover-competitors', {
    appId: game.appId,
    name: game.name,
    publisherName: game.publisherName,
    iosAppId: game.iosAppId,
    androidAppId: game.androidAppId,
    category: game.gameCategory ?? game.iosCategories[0] ?? null,
    country,
  });
}

/** Mirrors `FetchAppWeekResult` in `functions/src/gameWorkspaces/fetchAppWeek.ts`. */
export interface FetchAppWeekResult {
  success: boolean;
  creativeCount: number;
  cached: boolean;
  partialErrors: string[];
}

/** Fetch one app's creatives for the week (cache-guarded per app+week). */
export function fetchGameAppCreatives(params: {
  appId: string;
  weekStart: string;
  weekEnd: string;
  country: string;
  force?: boolean;
  name?: string;
  publisherName?: string | null;
  iconUrl?: string | null;
}): Promise<FetchAppWeekResult> {
  return callFunction<FetchAppWeekResult>('games/fetch-app', params);
}

/** Mirrors `AnalyzeWorkspaceResult` in `functions/src/gameWorkspaces/analyze.ts`. */
export interface AnalyzeWorkspaceResult {
  success: boolean;
  creativeCount: number;
  scoredCount: number;
  insightsGenerated: boolean;
  geminiError?: string;
}

/** Score + Gemini-analyze the workspace's creative set (insights land under game_{focusAppId}). */
export function analyzeGameWorkspace(
  focusAppId: string,
  focusName: string,
  appIds: string[],
  week: string,
): Promise<AnalyzeWorkspaceResult> {
  return callFunction<AnalyzeWorkspaceResult>('games/analyze', { focusAppId, focusName, appIds, week });
}

/** One app descriptor for market-opportunity lookups (store ids needed for the OS split). */
export interface MarketApp {
  appId: string;
  iosAppId: string | null;
  androidAppId: string | null;
  isFocus: boolean;
}

/** Mirrors `CountryPresence` in `functions/src/gameWorkspaces/marketPresence.ts`. */
export interface CountryPresence {
  country: string;
  competitorRevenue: number;
  competitorDownloads: number;
  focusRevenue: number;
  focusDownloads: number;
  focusShare: number;
  competitorGames: number;
  topCompetitors: Array<{ appId: string; revenue: number }>;
}

/** Mirrors `OsPresence` in `functions/src/gameWorkspaces/marketPresence.ts`. */
export interface OsPresence {
  os: 'ios' | 'android';
  competitorRevenue: number;
  competitorDownloads: number;
  focusRevenue: number;
  focusDownloads: number;
  focusShare: number;
  competitorGames: number;
}

/** Mirrors `MarketPresence`; `generatedAt` is present only when read back from Firestore. */
export interface MarketPresence {
  month: string;
  primaryCountry: string;
  byCountry: CountryPresence[];
  byOs: OsPresence[];
  generatedAt?: { seconds: number; nanoseconds: number } | Date;
}

/** Compute + persist competitor country/OS market presence for a workspace. */
export function fetchMarketOpportunity(params: {
  focusAppId: string;
  apps: MarketApp[];
  category: string;
  androidCategory: string | null;
  primaryCountry: string;
}): Promise<MarketPresence> {
  return callFunction<MarketPresence>('games/market-opportunity', params);
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
