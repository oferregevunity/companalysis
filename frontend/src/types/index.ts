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

export interface ComparisonRow {
  appName: string;
  appId: string;
  publisherName: string;
  genreName: string;
  genreId: string;
  iosAppId: string | null;
  androidAppId: string | null;
  revenueByMonth: Record<string, number>;
  downloadsByMonth: Record<string, number>;
  percentChanges: Record<string, number | null>;
  dailyRevenue: number;
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
