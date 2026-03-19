export type SavedViewPayload = {
  genres: string[];
  sorting: { id: string; desc: boolean }[];
  globalFilter: string;
  sortMetric: 'value' | 'percent';
  rising: string[];
  risingThreshold: number;
  favoritesOnly: boolean;
  dateFrom: string;
  dateTo: string;
  granularity: 'month' | 'week';
  metricView: 'revenue' | 'downloads';
  pageSize: number;
};

export const DEFAULT_PAYLOAD: SavedViewPayload = {
  genres: [],
  sorting: [],
  globalFilter: '',
  sortMetric: 'value',
  rising: [],
  risingThreshold: 20,
  favoritesOnly: false,
  dateFrom: '',
  dateTo: '',
  granularity: 'month',
  metricView: 'revenue',
  pageSize: 50,
};

export type SavedViewVisibility = 'private' | 'shared' | 'anyone';
