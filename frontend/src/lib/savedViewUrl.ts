import type { SavedViewPayload } from '../types/savedView';
import { DEFAULT_PAYLOAD } from '../types/savedView';

/** Comma-separated id:asc|desc (column ids must not contain commas). */
function encodeSorting(sorting: { id: string; desc: boolean }[]): string {
  return sorting.map((s) => `${s.id}:${s.desc ? 'desc' : 'asc'}`).join(',');
}

function decodeSorting(raw: string): { id: string; desc: boolean }[] {
  if (!raw.trim()) return [];
  return raw.split(',').map((part) => {
    const idx = part.lastIndexOf(':');
    if (idx <= 0) return { id: part, desc: false };
    const id = part.slice(0, idx);
    const dir = part.slice(idx + 1).toLowerCase();
    return { id, desc: dir === 'desc' };
  });
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function sortingEqual(
  a: { id: string; desc: boolean }[],
  b: { id: string; desc: boolean }[]
): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.id === b[i].id && s.desc === b[i].desc);
}

/**
 * Serialize payload to query string (no leading ?). Omits keys equal to defaults.
 */
export function payloadToQueryString(payload: SavedViewPayload): string {
  const d = DEFAULT_PAYLOAD;
  const params = new URLSearchParams();

  if (payload.genres.length > 0 && !arraysEqual(payload.genres, d.genres)) {
    params.set('g', payload.genres.join(','));
  }
  if (payload.sorting.length > 0 && !sortingEqual(payload.sorting, d.sorting)) {
    params.set('s', encodeSorting(payload.sorting));
  }
  if (payload.globalFilter !== d.globalFilter) {
    params.set('q', payload.globalFilter);
  }
  if (payload.sortMetric !== d.sortMetric) {
    params.set('sm', payload.sortMetric);
  }
  if (payload.rising.length > 0 && !arraysEqual(payload.rising, d.rising)) {
    params.set('r', payload.rising.join(','));
  }
  if (payload.risingThreshold !== d.risingThreshold) {
    params.set('rt', String(payload.risingThreshold));
  }
  if (payload.favoritesOnly !== d.favoritesOnly) {
    params.set('fo', payload.favoritesOnly ? '1' : '0');
  }
  if (payload.dateFrom !== d.dateFrom) {
    params.set('from', payload.dateFrom);
  }
  if (payload.dateTo !== d.dateTo) {
    params.set('to', payload.dateTo);
  }
  if (payload.granularity !== d.granularity) {
    params.set('gr', payload.granularity);
  }
  if (payload.metricView !== d.metricView) {
    params.set('mv', payload.metricView);
  }
  if (payload.pageSize !== d.pageSize) {
    params.set('ps', String(payload.pageSize));
  }

  return params.toString();
}

/**
 * Parse search string (with or without leading ?) into a full payload merged with defaults.
 */
export function queryStringToPayload(search: string): SavedViewPayload {
  const s = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(s);
  const out: SavedViewPayload = { ...DEFAULT_PAYLOAD };

  const g = params.get('g');
  if (g) {
    out.genres = g.split(',').map((x) => x.trim()).filter(Boolean);
  }

  const sortRaw = params.get('s');
  if (sortRaw) {
    out.sorting = decodeSorting(sortRaw);
  }

  const q = params.get('q');
  if (q !== null) out.globalFilter = q;

  const sm = params.get('sm');
  if (sm === 'value' || sm === 'percent') out.sortMetric = sm;

  const r = params.get('r');
  if (r) {
    out.rising = r.split(',').map((x) => x.trim()).filter(Boolean);
  }

  const rt = params.get('rt');
  if (rt !== null && rt !== '') {
    const n = Number(rt);
    if (!Number.isNaN(n)) out.risingThreshold = n;
  }

  const fo = params.get('fo');
  if (fo === '1' || fo === 'true') out.favoritesOnly = true;
  if (fo === '0' || fo === 'false') out.favoritesOnly = false;

  const from = params.get('from');
  if (from !== null) out.dateFrom = from;

  const to = params.get('to');
  if (to !== null) out.dateTo = to;

  const gr = params.get('gr');
  if (gr === 'month' || gr === 'week') out.granularity = gr;

  const mv = params.get('mv');
  if (mv === 'revenue' || mv === 'downloads') out.metricView = mv;

  const ps = params.get('ps');
  if (ps !== null && ps !== '') {
    const n = Number(ps);
    if (!Number.isNaN(n) && n > 0) out.pageSize = n;
  }

  return out;
}

export function getPresetIdFromSearch(search: string): string | null {
  const s = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(s);
  const id = params.get('preset');
  return id && id.trim() ? id.trim() : null;
}

/**
 * Full URL for sharing: preset link only uses ?preset=, otherwise state params.
 */
export function buildAppUrl(
  payload: SavedViewPayload,
  presetId?: string,
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : '/'
): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const base = `${origin}${pathname}`;
  if (presetId) {
    return `${base}?preset=${encodeURIComponent(presetId)}`;
  }
  const qs = payloadToQueryString(payload);
  return qs ? `${base}?${qs}` : base;
}
