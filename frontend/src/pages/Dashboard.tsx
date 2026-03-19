import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import type { SortingState } from '@tanstack/react-table';
import { useGenres } from '../hooks/useGenres';
import { useMultiGenreSnapshots } from '../hooks/useMultiGenreSnapshots';
import type { Granularity } from '../hooks/useMultiGenreSnapshots';
import { useFavorites } from '../hooks/useFavorites';
import { useAppScores } from '../hooks/useAppScores';
import { formatCurrency, formatNumber, formatPercent, formatMonth, formatWeek } from '../lib/dataProcessing';
import { getHeatmapBg, getHeatmapText } from '../lib/colorScale';
import { exportToCsv } from '../lib/csvExport';
import { api } from '../lib/api';
import type { ComparisonRow, RisingStatus } from '../types';

const columnHelper = createColumnHelper<ComparisonRow>();
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

const RISING_BADGE: Record<RisingStatus, { bg: string; text: string; label: string }> = {
  'Rising 3': { bg: '#b7e1cd', text: '#137333', label: 'Rising 3' },
  'Rising 2': { bg: '#ceead6', text: '#137333', label: 'Rising 2' },
  'Rising 1': { bg: '#e6f4ea', text: '#137333', label: 'Rising 1' },
  'NOT': { bg: '#f1f3f4', text: '#80868b', label: 'Not rising' },
};

const ArrowUp = () => (
  <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path d="M10 6L5 14h10L10 6z" />
  </svg>
);
const ArrowDown = () => (
  <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path d="M10 14L5 6h10L10 14z" />
  </svg>
);

function PercentChangeWithIcon({ pct, formatPercent }: { pct: number; formatPercent: (n: number | null) => string }) {
  let arrowCount = 0;
  let direction: 'up' | 'down' | 'flat' = 'flat';
  if (pct >= 20) {
    arrowCount = 3;
    direction = 'up';
  } else if (pct >= 10) {
    arrowCount = 2;
    direction = 'up';
  } else if (pct > 0) {
    arrowCount = 1;
    direction = 'up';
  } else if (pct > -10 && pct <= 0) {
    direction = 'flat';
  } else if (pct > -20) {
    arrowCount = 1;
    direction = 'down';
  } else {
    arrowCount = 2;
    direction = 'down';
    if (pct < -20) arrowCount = 3;
  }

  return (
    <div className="flex items-center justify-end gap-0.5 min-h-0">
      {(direction === 'up' || direction === 'down') && (
        <span className="inline-flex items-center gap-px">
          {direction === 'up' && Array.from({ length: arrowCount }, (_, i) => <ArrowUp key={i} />)}
          {direction === 'down' && Array.from({ length: arrowCount }, (_, i) => <ArrowDown key={i} />)}
        </span>
      )}
      {direction === 'flat' && (
        <span className="w-2.5 h-2.5 flex-shrink-0 inline-flex items-center justify-center text-[8px] font-bold leading-none">−</span>
      )}
      <span className="tabular-nums">{formatPercent(pct)}</span>
    </div>
  );
}

function StoreLinks({ row }: { row: ComparisonRow }) {
  const { iosAppId, androidAppId } = row;
  if (!iosAppId && !androidAppId) return <span className="text-[#bdc1c6]">--</span>;
  return (
    <div className="flex items-center gap-1.5">
      {iosAppId && (
        <a href={`https://apps.apple.com/app/id${iosAppId}`} target="_blank" rel="noopener noreferrer"
          className="text-[#5f6368] hover:text-[#202124] transition-colors" title="App Store">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
          </svg>
        </a>
      )}
      {androidAppId && (
        <a href={`https://play.google.com/store/apps/details?id=${androidAppId}`} target="_blank" rel="noopener noreferrer"
          className="text-[#5f6368] hover:text-[#202124] transition-colors" title="Google Play">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.807 1.626a1 1 0 010 1.732l-2.807 1.626L15.206 12l2.492-2.492zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z"/>
          </svg>
        </a>
      )}
    </div>
  );
}

function CommentCell({ row }: { row: ComparisonRow }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.comment || '');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.saveComment(row.appId, row.genreId, value);
      row.comment = value;
    } catch { /* silent */ }
    setSaving(false);
    setEditing(false);
  }, [row, value]);

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        onBlur={save}
        className="w-full text-[12px] px-1.5 py-1 border border-primary-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white"
        disabled={saving}
      />
    );
  }

  return (
    <div onClick={() => setEditing(true)}
      className="text-[12px] text-[#5f6368] cursor-pointer hover:text-[#202124] min-w-[60px] min-h-[20px] truncate"
      title={row.comment || 'Click to add note'}>
      {row.comment || <span className="text-[#dadce0] italic">Add note</span>}
    </div>
  );
}

function StarButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="p-0.5 hover:scale-110 transition-transform" title={active ? 'Remove from favorites' : 'Add to favorites'}>
      {active ? (
        <svg className="w-4 h-4 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
        </svg>
      ) : (
        <svg className="w-4 h-4 text-[#dadce0] hover:text-amber-300" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
        </svg>
      )}
    </button>
  );
}

const GENRE_COLORS = [
  { bg: '#e8f0fe', text: '#1a73e8', border: '#aecbfa' },
  { bg: '#e6f4ea', text: '#137333', border: '#ceead6' },
  { bg: '#fef7e0', text: '#b06000', border: '#fdd663' },
  { bg: '#fce8e6', text: '#c5221f', border: '#f4c7c3' },
  { bg: '#f3e8fd', text: '#7627bb', border: '#d7aefb' },
  { bg: '#e0f7fa', text: '#00695c', border: '#80deea' },
  { bg: '#fff3e0', text: '#e65100', border: '#ffcc80' },
  { bg: '#fce4ec', text: '#b71c1c', border: '#f48fb1' },
];

type SortMetric = 'value' | 'percent';
const RISING_OPTIONS: RisingStatus[] = ['Rising 3', 'Rising 2', 'Rising 1', 'NOT'];
type MetricView = 'revenue' | 'downloads';

export default function Dashboard() {
  const { genres, loading: genresLoading } = useGenres();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [sortMetric, setSortMetric] = useState<SortMetric>('value');
  const [selectedRising, setSelectedRising] = useState<Set<RisingStatus>>(new Set());
  const [risingDropdownOpen, setRisingDropdownOpen] = useState(false);
  const [risingThreshold, setRisingThreshold] = useState(20);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [metricView, setMetricView] = useState<MetricView>('revenue');

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const q = searchParams.get('search');
    if (q) {
      setGlobalFilter(q);
      searchParams.delete('search');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  const switchGranularity = (g: Granularity) => {
    setGranularity(g);
    setDateFrom('');
    setDateTo('');
  };

  const { favorites, toggleFavorite } = useFavorites();

  const initialized = useState(false);
  if (!initialized[0] && genres.length > 0 && selectedIds.size === 0) {
    initialized[1](true);
    setSelectedIds(new Set(genres.map(g => g.id)));
  }

  const selectedGenres = useMemo(
    () => genres.filter(g => selectedIds.has(g.id)),
    [genres, selectedIds]
  );
  const { scoreMap } = useAppScores(selectedGenres, granularity);
  const { rows: data, months, loading: dataLoading, error, refresh } = useMultiGenreSnapshots(selectedGenres, risingThreshold, granularity);

  const filteredMonths = useMemo(() => {
    return months.filter(m => {
      if (dateFrom && m < dateFrom) return false;
      if (dateTo && m > dateTo) return false;
      return true;
    });
  }, [months, dateFrom, dateTo]);

  const filteredData = useMemo(() => {
    let rows = data;
    if (showFavoritesOnly) {
      rows = rows.filter(r => favorites.has(r.appId));
    }
    if (selectedRising.size > 0) {
      rows = rows.filter(r => selectedRising.has(r.risingStatus) || selectedRising.has(r.risingStatusDownloads));
    }
    return rows;
  }, [data, showFavoritesOnly, favorites, selectedRising]);

  const genreColorMap = useMemo(() => {
    const map = new Map<string, typeof GENRE_COLORS[0]>();
    genres.forEach((g, i) => map.set(g.id, GENRE_COLORS[i % GENRE_COLORS.length]));
    return map;
  }, [genres]);

  const toggleGenre = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const columns = useMemo(() => {
    const cols: any[] = [
      columnHelper.display({
        id: 'rank',
        header: '#',
        cell: ({ row }) => <span className="text-[12px] text-[#80868b] tabular-nums">{row.index + 1}</span>,
        size: 40,
        enableSorting: false,
      }),
      columnHelper.display({
        id: 'favorite',
        header: () => (
          <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
          </svg>
        ),
        cell: ({ row }) => (
          <StarButton active={favorites.has(row.original.appId)} onClick={() => toggleFavorite(row.original.appId)} />
        ),
        size: 36,
        enableSorting: false,
      }),
      columnHelper.accessor('appName', {
        header: 'App',
        cell: (info) => (
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#202124] truncate" title={info.getValue()}>
              {info.getValue()}
            </div>
            <div className="text-[11px] text-[#80868b] truncate">{info.row.original.publisherName || '--'}</div>
          </div>
        ),
        size: 180,
      }),
      columnHelper.accessor('genreName', {
        header: 'Genre',
        cell: (info) => {
          const { allGenres } = info.row.original;
          return (
            <div className="flex flex-wrap gap-1">
              {allGenres.map((g) => {
                const color = genreColorMap.get(g.id) || GENRE_COLORS[0];
                return (
                  <span key={g.id} className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    style={{ backgroundColor: color.bg, color: color.text }}>
                    {g.name}
                  </span>
                );
              })}
            </div>
          );
        },
        size: 120,
      }),
      ...(metricView === 'revenue'
        ? [
            columnHelper.accessor('risingStatus', {
              id: 'risingRev',
              header: 'Rising (Rev)',
              cell: (info) => {
                const status = info.getValue();
                const badge = RISING_BADGE[status];
                return (
                  <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                    style={{ backgroundColor: badge.bg, color: badge.text }}>
                    {status === 'NOT' ? '—' : status}
                  </span>
                );
              },
              size: 78,
              sortingFn: (rowA, rowB) => {
                const order: Record<RisingStatus, number> = { 'Rising 3': 3, 'Rising 2': 2, 'Rising 1': 1, 'NOT': 0 };
                return order[rowA.original.risingStatus] - order[rowB.original.risingStatus];
              },
            }),
          ]
        : []),
      ...(metricView === 'downloads'
        ? [
            columnHelper.accessor('risingStatusDownloads', {
              id: 'risingDL',
              header: 'Rising (DL)',
              cell: (info) => {
                const status = info.getValue();
                const badge = RISING_BADGE[status];
                return (
                  <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap"
                    style={{ backgroundColor: badge.bg, color: badge.text }}>
                    {status === 'NOT' ? '—' : status}
                  </span>
                );
              },
              size: 78,
              sortingFn: (rowA, rowB) => {
                const order: Record<RisingStatus, number> = { 'Rising 3': 3, 'Rising 2': 2, 'Rising 1': 1, 'NOT': 0 };
                return order[rowA.original.risingStatusDownloads] - order[rowB.original.risingStatusDownloads];
              },
            }),
          ]
        : []),
      {
        id: 'aiScore',
        header: 'AI Score',
        accessorFn: (row: ComparisonRow) => scoreMap.get(row.appId)?.score ?? null,
        cell: ({ getValue }: { getValue: () => number | null }) => {
          const score = getValue();
          if (score === null) return <span className="text-gray-300">—</span>;
          const color = score >= 60 ? 'text-green-700 bg-green-50'
            : score >= 40 ? 'text-yellow-700 bg-yellow-50'
            : 'text-gray-500 bg-gray-50';
          return (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}>
              {score}
            </span>
          );
        },
        sortingFn: 'basic',
      },
    ];

    const fmtPeriod = granularity === 'week' ? formatWeek : formatMonth;
    const isRevenue = metricView === 'revenue';
    const valuesByMonth = isRevenue ? 'revenueByMonth' : 'downloadsByMonth';
    const pctByMonth = isRevenue ? 'percentChanges' : 'downloadPercentChanges';
    const fmtValue = isRevenue ? formatCurrency : formatNumber;
    const suffix = isRevenue ? 'Rev' : 'DL';

    for (let mi = 0; mi < filteredMonths.length; mi++) {
      const month = filteredMonths[mi];
      const isFirst = mi === 0;

      cols.push(
        columnHelper.accessor((row) => row[valuesByMonth][month] ?? 0, {
          id: `${suffix}_${month}`,
          header: `${fmtPeriod(month)}`,
          cell: ({ getValue, row: tableRow }) => {
            const val = getValue();
            const pct = isFirst ? undefined : (tableRow.original[pctByMonth] as Record<string, number | null>)[month];
            const hasPct = pct !== undefined && pct !== null;
            const bg = hasPct ? getHeatmapBg(pct) : 'transparent';
            const textColor = hasPct ? getHeatmapText(pct) : undefined;
            return (
              <div className="text-right rounded-md px-1.5 py-0.5 -mx-1 leading-tight" style={{ backgroundColor: bg }}>
                <div className="text-[12px] font-medium tabular-nums text-[#202124]">{fmtValue(val)}</div>
                {hasPct && (
                  <div className="text-[10px] tabular-nums font-medium leading-none" style={{ color: textColor }}>
                    <PercentChangeWithIcon pct={pct as number} formatPercent={formatPercent} />
                  </div>
                )}
              </div>
            );
          },
          sortingFn: (rowA, rowB) => {
            if (sortMetric === 'percent') {
              const a = (rowA.original[pctByMonth] as Record<string, number | null>)[month] ?? -Infinity;
              const b = (rowB.original[pctByMonth] as Record<string, number | null>)[month] ?? -Infinity;
              return (a as number) - (b as number);
            }
            return (rowA.original[valuesByMonth][month] ?? 0) - (rowB.original[valuesByMonth][month] ?? 0);
          },
          size: 105,
        })
      );
    }

    cols.push(
      columnHelper.accessor(isRevenue ? 'dailyRevenue' : 'dailyDownloads', {
        id: 'daily',
        header: isRevenue ? 'Daily Rev' : 'Daily DL',
        cell: (info) => (
          <div className="text-right text-[12px] font-semibold tabular-nums text-[#202124]">{fmtValue(info.getValue())}</div>
        ),
        size: 85,
      }),
      columnHelper.display({
        id: 'links',
        header: 'Store',
        cell: ({ row }) => <StoreLinks row={row.original} />,
        size: 56,
        enableSorting: false,
      }),
      columnHelper.display({
        id: 'comment',
        header: 'Notes',
        cell: ({ row }) => <CommentCell row={row.original} />,
        size: 110,
        enableSorting: false,
      })
    );

    return cols;
  }, [filteredMonths, genreColorMap, sortMetric, favorites, toggleFavorite, granularity, metricView, scoreMap]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = filterValue.toLowerCase();
      return (
        row.original.appName.toLowerCase().includes(q) ||
        row.original.publisherName.toLowerCase().includes(q) ||
        row.original.allGenres.some(g => g.name.toLowerCase().includes(q))
      );
    },
  });

  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold text-[#202124] tracking-[-0.01em]">Dashboard</h1>
        <p className="text-[13px] text-[#5f6368] mt-0.5">Gaming market competitor analysis</p>
      </div>

      {/* Genre pills */}
      {!genresLoading && genres.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-[12px] font-medium text-[#5f6368] mr-1">Genres:</span>
          {genres.map((genre) => {
            const isSelected = selectedIds.has(genre.id);
            const color = genreColorMap.get(genre.id) || GENRE_COLORS[0];
            return (
              <button
                key={genre.id}
                onClick={() => toggleGenre(genre.id)}
                className={`inline-flex items-center px-3 py-1.5 rounded-full text-[12px] font-medium transition-all duration-150 border ${
                  isSelected ? '' : 'bg-white text-[#5f6368] border-[#dadce0] hover:bg-[#f1f3f4]'
                }`}
                style={isSelected ? { backgroundColor: color.bg, color: color.text, borderColor: color.border } : undefined}
              >
                {genre.name}
                {isSelected && <span className="ml-1.5 text-[10px] opacity-60">{genre.country} &middot; {genre.monthsBack}mo</span>}
              </button>
            );
          })}
          <button
            onClick={() => refresh()}
            disabled={selectedIds.size === 0 || dataLoading}
            className="ml-2 inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] font-medium text-[#5f6368] border border-[#dadce0] rounded-full hover:bg-[#f1f3f4] disabled:opacity-40 transition-colors"
          >
            {dataLoading ? (
              <div className="w-3 h-3 border-[1.5px] border-[#dadce0] border-t-primary-600 rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            )}
            Refresh
          </button>
        </div>
      )}

      {/* Toolbar row 1: Search + Date range + Export */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="relative flex-1 max-w-[240px]">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#80868b]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search apps, publishers..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-[6px] bg-white border border-[#dadce0] rounded-lg text-[12px] text-[#202124] placeholder-[#80868b] focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
          />
        </div>

        <div className="inline-flex rounded-lg border border-[#dadce0] overflow-hidden">
          <button onClick={() => switchGranularity('month')}
            className={`px-2.5 py-[5px] text-[11px] font-medium transition-colors ${granularity === 'month' ? 'bg-primary-50 text-primary-700 border-r border-[#dadce0]' : 'bg-white text-[#5f6368] border-r border-[#dadce0] hover:bg-[#f8f9fa]'}`}>
            Monthly
          </button>
          <button onClick={() => switchGranularity('week')}
            className={`px-2.5 py-[5px] text-[11px] font-medium transition-colors ${granularity === 'week' ? 'bg-primary-50 text-primary-700' : 'bg-white text-[#5f6368] hover:bg-[#f8f9fa]'}`}>
            Weekly
          </button>
        </div>

        {months.length > 0 && (
          <>
            <span className="text-[11px] text-[#80868b] ml-1">From</span>
            <select value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="text-[12px] border border-[#dadce0] rounded-md px-2 py-[6px] bg-white text-[#3c4043] focus:outline-none focus:border-primary-500">
              <option value="">All</option>
              {months.map(m => <option key={m} value={m}>{granularity === 'week' ? formatWeek(m) : formatMonth(m)}</option>)}
            </select>
            <span className="text-[11px] text-[#80868b]">To</span>
            <select value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="text-[12px] border border-[#dadce0] rounded-md px-2 py-[6px] bg-white text-[#3c4043] focus:outline-none focus:border-primary-500">
              <option value="">All</option>
              {months.map(m => <option key={m} value={m}>{granularity === 'week' ? formatWeek(m) : formatMonth(m)}</option>)}
            </select>
          </>
        )}

        {filteredData.length > 0 && (
          <button
            onClick={() => exportToCsv(filteredData, filteredMonths, metricView, `competitor-analysis-${new Date().toISOString().slice(0, 10)}.csv`)}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-[6px] bg-white border border-[#dadce0] rounded-lg text-[12px] font-medium text-[#3c4043] hover:bg-[#f8f9fa] hover:shadow-sm transition-all duration-150"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            CSV
          </button>
        )}
      </div>

      {/* Toolbar row 2: Metric toggle + Sort toggle + Rising filter + Favorites + Threshold */}
      {data.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="inline-flex rounded-lg border border-[#dadce0] overflow-hidden">
            <button onClick={() => setMetricView('revenue')}
              className={`px-2.5 py-[5px] text-[11px] font-medium transition-colors ${metricView === 'revenue' ? 'bg-primary-50 text-primary-700 border-r border-[#dadce0]' : 'bg-white text-[#5f6368] border-r border-[#dadce0] hover:bg-[#f8f9fa]'}`}>
              Revenue
            </button>
            <button onClick={() => setMetricView('downloads')}
              className={`px-2.5 py-[5px] text-[11px] font-medium transition-colors ${metricView === 'downloads' ? 'bg-primary-50 text-primary-700' : 'bg-white text-[#5f6368] hover:bg-[#f8f9fa]'}`}>
              Downloads
            </button>
          </div>

          <div className="inline-flex rounded-lg border border-[#dadce0] overflow-hidden">
            <button onClick={() => setSortMetric('value')}
              className={`px-2.5 py-[5px] text-[11px] font-medium transition-colors ${sortMetric === 'value' ? 'bg-primary-50 text-primary-700 border-r border-[#dadce0]' : 'bg-white text-[#5f6368] border-r border-[#dadce0] hover:bg-[#f8f9fa]'}`}>
              Sort: Value
            </button>
            <button onClick={() => setSortMetric('percent')}
              className={`px-2.5 py-[5px] text-[11px] font-medium transition-colors ${sortMetric === 'percent' ? 'bg-primary-50 text-primary-700' : 'bg-white text-[#5f6368] hover:bg-[#f8f9fa]'}`}>
              Sort: %
            </button>
          </div>

          <div className="relative">
            <button type="button" onClick={() => setRisingDropdownOpen(o => !o)}
              className="text-[12px] border border-[#dadce0] rounded-lg px-2.5 py-[5px] bg-white text-[#3c4043] focus:outline-none focus:border-primary-500 min-w-[120px] text-left flex items-center justify-between gap-1">
              <span>Rising: {selectedRising.size === 0 ? 'All' : `${selectedRising.size} selected`}</span>
              <svg className={`w-3.5 h-3.5 transition-transform ${risingDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {risingDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setRisingDropdownOpen(false)} aria-hidden />
                <div className="absolute left-0 top-full mt-1 z-20 bg-white border border-[#dadce0] rounded-lg shadow-lg py-1 min-w-[140px]">
                  <button type="button" onClick={() => { setSelectedRising(new Set()); setRisingDropdownOpen(false); }}
                    className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-[#f8f9fa]">
                    All
                  </button>
                  {RISING_OPTIONS.map((opt) => (
                    <label key={opt} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#f8f9fa] cursor-pointer">
                      <input type="checkbox" checked={selectedRising.has(opt)} onChange={(e) => {
                        setSelectedRising(prev => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(opt); else next.delete(opt);
                          return next;
                        });
                      }} className="rounded border-[#dadce0]" />
                      <span className="text-[12px]">{opt === 'NOT' ? 'Not rising' : opt}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <button onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            className={`inline-flex items-center gap-1 px-2.5 py-[5px] text-[11px] font-medium rounded-lg border transition-colors ${
              showFavoritesOnly ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-white text-[#5f6368] border-[#dadce0] hover:bg-[#f8f9fa]'
            }`}>
            <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
            </svg>
            Favorites
          </button>

          <div className="inline-flex items-center gap-1 ml-auto">
            <span className="text-[11px] text-[#80868b]">Rising threshold:</span>
            <input type="number" value={risingThreshold} onChange={(e) => setRisingThreshold(Math.max(0, Number(e.target.value)))}
              className="w-14 text-[12px] border border-[#dadce0] rounded-md px-2 py-[4px] bg-white text-[#3c4043] text-center focus:outline-none focus:border-primary-500" />
            <span className="text-[11px] text-[#80868b]">%</span>
          </div>
        </div>
      )}

      {/* States */}
      {genresLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-[3px] border-primary-100 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : genres.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#dadce0] p-12 text-center shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
          <svg className="w-12 h-12 mx-auto mb-4 text-[#dadce0]" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          <h3 className="text-[15px] font-semibold text-[#202124] mb-1">No genres configured</h3>
          <p className="text-[13px] text-[#5f6368] mb-5">Add genres in Settings to start tracking.</p>
          <a href="/settings" className="inline-flex items-center px-4 py-2 bg-primary-600 text-white rounded-lg text-[13px] font-medium hover:bg-primary-700 transition-colors">
            Go to Settings
          </a>
        </div>
      ) : selectedIds.size === 0 ? (
        <div className="bg-white rounded-xl border border-[#dadce0] p-12 text-center shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
          <h3 className="text-[15px] font-semibold text-[#202124] mb-1">Select genres above</h3>
          <p className="text-[13px] text-[#5f6368]">Click on genre pills to view their apps in the table.</p>
        </div>
      ) : dataLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-[3px] border-primary-100 border-t-primary-600 rounded-full animate-spin" />
            <span className="text-[13px] text-[#5f6368]">Loading {selectedGenres.length} genre{selectedGenres.length > 1 ? 's' : ''}...</span>
          </div>
        </div>
      ) : error ? (
        <div className="bg-[#fce8e6] rounded-xl p-6">
          <h3 className="font-semibold text-[#c5221f] mb-1">Error</h3>
          <p className="text-[13px] text-[#c5221f]">{error}</p>
        </div>
      ) : filteredData.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#dadce0] p-12 text-center shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
          <h3 className="text-[15px] font-semibold text-[#202124] mb-1">
            {data.length === 0 ? 'No data yet' : 'No matching apps'}
          </h3>
          <p className="text-[13px] text-[#5f6368]">
            {data.length === 0 ? 'Fetch data from the Settings page.' : 'Try adjusting your filters.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#dadce0] overflow-hidden shadow-[0_1px_2px_0_rgba(60,64,67,0.1)]">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b border-[#e8eaed]">
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        onClick={header.column.getCanSort() ? header.column.getToggleSortingHandler() : undefined}
                        className={`px-2 py-2 text-left text-[10px] font-semibold text-[#5f6368] uppercase tracking-wider bg-[#f8f9fa] whitespace-nowrap ${
                          header.column.getCanSort() ? 'cursor-pointer select-none hover:bg-[#f1f3f4]' : ''
                        }`}
                        style={{ width: header.column.getSize() }}
                      >
                        <div className="flex items-center gap-0.5">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === 'asc' && <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6l-5 5h10l-5-5z"/></svg>}
                          {header.column.getIsSorted() === 'desc' && <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 14l5-5H5l5 5z"/></svg>}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, i) => (
                  <tr key={row.id} className={`border-b border-[#f1f3f4] hover:bg-[#f8f9fa] transition-colors duration-75 ${i % 2 === 0 ? 'bg-white' : 'bg-[#fafbfc]'}`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-2 py-1.5 text-[12px] text-[#3c4043]">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2 border-t border-[#e8eaed] bg-[#f8f9fa] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-[#5f6368]">
                {filteredCount > 0 ? `${currentPage * table.getState().pagination.pageSize + 1}` : '0'}&ndash;
                {Math.min((currentPage + 1) * table.getState().pagination.pageSize, filteredCount)} of {filteredCount}
              </span>
              <select
                value={table.getState().pagination.pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
                className="text-[12px] border border-[#dadce0] rounded-md px-2 py-1 bg-white text-[#3c4043] focus:outline-none focus:border-primary-500"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (<option key={size} value={size}>{size} / page</option>))}
              </select>
            </div>
            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}
                  className="p-1.5 rounded-full disabled:opacity-30 hover:bg-[#e8eaed] transition-colors">
                  <svg className="w-4 h-4 text-[#5f6368]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                </button>
                <span className="text-[12px] text-[#5f6368] px-2">{currentPage + 1} / {pageCount}</span>
                <button onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}
                  className="p-1.5 rounded-full disabled:opacity-30 hover:bg-[#e8eaed] transition-colors">
                  <svg className="w-4 h-4 text-[#5f6368]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
