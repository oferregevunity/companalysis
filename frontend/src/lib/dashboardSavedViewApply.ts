import type { SortingState } from '@tanstack/react-table';
import type { SavedViewPayload } from '../types/savedView';
import type { RisingStatus } from '../types';
import type { Granularity } from '../hooks/useMultiGenreSnapshots';
import { getPresetIdFromSearch } from './savedViewUrl';

const RISING_SET = new Set<RisingStatus>(['Rising 3', 'Rising 2', 'Rising 1', 'NOT']);

export function hasUrlViewState(search: string): boolean {
  if (getPresetIdFromSearch(search)) return true;
  const s = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(s);
  const keys = ['g', 's', 'q', 'sm', 'r', 'rr', 'rd', 'rt', 'fo', 'from', 'to', 'gr', 'mv', 'ps'];
  return keys.some((k) => params.has(k));
}

export function applySavedViewPayload(
  payload: SavedViewPayload,
  genres: { id: string }[],
  setters: {
    setSelectedIds: (s: Set<string>) => void;
    setSorting: (s: SortingState) => void;
    setGlobalFilter: (s: string) => void;
    setSortMetric: (m: 'value' | 'percent') => void;
    setSelectedRisingRev: (s: Set<RisingStatus>) => void;
    setSelectedRisingDl: (s: Set<RisingStatus>) => void;
    setRisingMatchAny: (v: boolean) => void;
    setRisingThreshold: (n: number) => void;
    setShowFavoritesOnly: (v: boolean) => void;
    setDateFrom: (v: string) => void;
    setDateTo: (v: string) => void;
    setGranularity: (g: Granularity) => void;
    setMetricView: (m: 'revenue' | 'downloads') => void;
    setPagination: (p: { pageIndex: number; pageSize: number }) => void;
  }
): void {
  const existing = new Set(genres.map((g) => g.id));
  let gids = payload.genres.filter((id) => existing.has(id));
  if (gids.length === 0) {
    gids = genres.map((g) => g.id);
  }

  setters.setSelectedIds(new Set(gids));
  setters.setSorting(payload.sorting);
  setters.setGlobalFilter(payload.globalFilter);
  setters.setSortMetric(payload.sortMetric);

  const raw = payload as unknown as Record<string, unknown>;
  let revList: string[];
  let dlList: string[];
  let matchAny: boolean;

  if ('risingRev' in raw || 'risingDl' in raw) {
    revList = Array.isArray(raw.risingRev) ? (raw.risingRev as string[]) : [];
    dlList = Array.isArray(raw.risingDl) ? (raw.risingDl as string[]) : [];
    matchAny = raw.risingMatchAny === true;
  } else if (Array.isArray(raw.rising)) {
    const rising = raw.rising as string[];
    if (rising.length > 0) {
      revList = [...rising];
      dlList = [];
      matchAny = true;
    } else {
      revList = [];
      dlList = [];
      matchAny = false;
    }
  } else {
    revList = [];
    dlList = [];
    matchAny = false;
  }

  const rev = revList.filter((r): r is RisingStatus => RISING_SET.has(r as RisingStatus));
  const dl = dlList.filter((r): r is RisingStatus => RISING_SET.has(r as RisingStatus));
  setters.setSelectedRisingRev(new Set(rev));
  setters.setSelectedRisingDl(new Set(dl));
  setters.setRisingMatchAny(matchAny);
  setters.setRisingThreshold(payload.risingThreshold);
  setters.setShowFavoritesOnly(payload.favoritesOnly);
  setters.setGranularity(payload.granularity);
  setters.setDateFrom(payload.dateFrom);
  setters.setDateTo(payload.dateTo);
  setters.setMetricView(payload.metricView);
  setters.setPagination({ pageIndex: 0, pageSize: payload.pageSize });
}
