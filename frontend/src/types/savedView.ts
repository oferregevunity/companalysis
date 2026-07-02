export type SavedViewPayload = {
  genres: string[];
  sorting: { id: string; desc: boolean }[];
  globalFilter: string;
  sortMetric: 'value' | 'percent';
  /** Rising (revenue) levels to keep; empty = no filter on this axis. */
  risingRev: string[];
  /** Rising (downloads) levels to keep; empty = no filter on this axis. */
  risingDl: string[];
  /**
   * When true, a single selection set in `risingRev` matches a row if **either** revenue or
   * downloads rising status is in the set (legacy `?r=` / old saved views). Otherwise filters are ANDed.
   */
  risingMatchAny?: boolean;
  /** @deprecated Preset payloads may still include this; clients normalize to risingRev / risingMatchAny. */
  rising?: string[];
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
  risingRev: [],
  risingDl: [],
  risingThreshold: 20,
  favoritesOnly: false,
  dateFrom: '',
  dateTo: '',
  granularity: 'month',
  metricView: 'revenue',
  pageSize: 50,
};

export type SavedViewVisibility = 'private' | 'shared' | 'anyone';
