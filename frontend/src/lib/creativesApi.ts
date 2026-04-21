import { apiCall } from './api';

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
  return apiCall<TriggerCreativesResult>('creatives/trigger', { genreId, weekStart, weekEnd });
}

export function getWatchlistApps(): Promise<{ appIds: string[] }> {
  return apiCall<{ appIds: string[] }>('creatives/watchlist', {});
}

export function addToWatchlist(appId: string): Promise<{ success: boolean }> {
  return apiCall<{ success: boolean }>('creatives/watchlist/add', { appId });
}

export function removeFromWatchlist(appId: string): Promise<{ success: boolean }> {
  return apiCall<{ success: boolean }>('creatives/watchlist/remove', { appId });
}
