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
  /** Same calendar week for the split Monday jobs (`weeklyFetchApps` + `weeklyFetchCreatives`). */
  scheduleRunId?: string;
  appsPhase?: 'running' | 'completed' | 'failed' | 'skipped';
  creativesPhase?: 'running' | 'completed' | 'failed' | 'skipped' | 'pending';
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

export interface InsightCorrelations {
  themes: string[];
  mechanics: string[];
  analysis: string;
}

export interface InsightGameIdea {
  title: string;
  hook: string;
  coreLoop: string;
  monetization: string;
  inspiredBy: string[];
}

export interface GenreInsightDoc {
  genreId: string;
  period: string;
  granularity: 'month' | 'week';
  generatedAt: Date;
  summary: string;
  games: InsightGame[];
  watchList: InsightWatchItem[];
  correlations?: InsightCorrelations;
  newGameIdeas?: InsightGameIdea[];
}

export interface CrossGenreConcept {
  concept: string;
  genres: string[];
}

export interface CrossGenreInsightDoc {
  granularity: 'month' | 'week';
  generatedAt: Date;
  genresAnalyzed: string[];
  repeatedConcepts: CrossGenreConcept[];
  analysis: string;
  newGameIdeas: InsightGameIdea[];
}
