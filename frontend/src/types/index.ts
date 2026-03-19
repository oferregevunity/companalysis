export interface Genre {
  id: string;
  name: string;
  categoryIds: {
    ios: string;
    android: string;
  };
  country: string;
  monthsBack: number;
  active: boolean;
  createdAt: Date;
}

export interface Snapshot {
  id: string;
  genreId: string;
  month: string;
  fetchedAt: Date;
  appCount: number;
  platform: string;
  geo: string;
}

export interface AppData {
  unifiedAppId: string;
  unifiedAppName: string;
  publisherName?: string;
  iosAppId?: string | null;
  androidAppId?: string | null;
  downloads: number;
  storeRevenue: number;
}

export type RisingStatus = 'Rising 3' | 'Rising 2' | 'Rising 1' | 'NOT';

export interface ComparisonRow {
  appName: string;
  appId: string;
  publisherName: string;
  genreName: string;
  genreId: string;
  allGenres: { id: string; name: string }[];
  iosAppId: string | null;
  androidAppId: string | null;
  revenueByMonth: Record<string, number>;
  downloadsByMonth: Record<string, number>;
  percentChanges: Record<string, number | null>;
  downloadPercentChanges: Record<string, number | null>;
  dailyRevenue: number;
  dailyDownloads: number;
  risingStatus: RisingStatus;
  risingStatusDownloads: RisingStatus;
  comment?: string;
}

export interface FetchLog {
  id: string;
  startedAt: Date;
  completedAt: Date | null;
  status: 'running' | 'completed' | 'failed';
  genresProcessed: string[];
  errors: string[];
}

export interface SubScores {
  revenueAcceleration: number;
  downloadMomentum: number;
  anomalyScore: number;
  crossMetricConvergence: number;
}

export interface InsightGame {
  appId: string;
  appName: string;
  publisherName: string;
  rank: number;
  score: number;
  subScores: SubScores;
  explanation: string;
  iosAppId?: string | null;
  androidAppId?: string | null;
  periodData?: Record<string, { revenue: number; downloads: number }>;
}

export interface InsightWatchItem {
  appId: string;
  appName: string;
  publisherName: string;
  score: number;
  reason: string;
  iosAppId?: string | null;
  androidAppId?: string | null;
  periodData?: Record<string, { revenue: number; downloads: number }>;
}

export interface GenreInsightDoc {
  genreId: string;
  period: string;
  granularity: 'month' | 'week';
  generatedAt: Date;
  summary: string;
  games: InsightGame[];
  watchList: InsightWatchItem[];
}
