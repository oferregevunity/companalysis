import { auth } from './firebase';

const API_BASE = '/api';

async function apiCall<T = any>(path: string, body: Record<string, any> = {}): Promise<T> {
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
};

export async function generateInsights(granularity: 'month' | 'week' = 'month') {
  return apiCall('insights/generate', { granularity });
}
