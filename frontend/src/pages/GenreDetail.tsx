import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
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
import { useSnapshots } from '../hooks/useSnapshots';
import { buildComparisonData, formatCurrency, formatPercent, formatMonth } from '../lib/dataProcessing';
import { getHeatmapBg, getHeatmapText } from '../lib/colorScale';
import { exportToCsv } from '../lib/csvExport';
import { api } from '../lib/api';
import type { ComparisonRow } from '../types';

const columnHelper = createColumnHelper<ComparisonRow>();
const PAGE_SIZE_OPTIONS = [50, 100, 200, 500];

function StoreLinks({ row }: { row: ComparisonRow }) {
  const { iosAppId, androidAppId } = row;
  if (!iosAppId && !androidAppId) return <span className="text-[#bdc1c6]">--</span>;

  return (
    <div className="flex items-center gap-1.5">
      {iosAppId && (
        <a
          href={`https://apps.apple.com/app/id${iosAppId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#5f6368] hover:text-[#202124] transition-colors"
          title="App Store"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
          </svg>
        </a>
      )}
      {androidAppId && (
        <a
          href={`https://play.google.com/store/apps/details?id=${androidAppId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#5f6368] hover:text-[#202124] transition-colors"
          title="Google Play"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 01-.61-.92V2.734a1 1 0 01.609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.807 1.626a1 1 0 010 1.732l-2.807 1.626L15.206 12l2.492-2.492zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z"/>
          </svg>
        </a>
      )}
    </div>
  );
}

function CommentCell({ row, genreId }: { row: ComparisonRow; genreId: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.comment || '');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      await api.saveComment(row.appId, genreId, value);
      row.comment = value;
    } catch { /* silent */ }
    setSaving(false);
    setEditing(false);
  }, [row, genreId, value]);

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          className="w-full text-[12px] px-1.5 py-1 border border-primary-300 rounded focus:outline-none focus:ring-1 focus:ring-primary-400 bg-white"
          disabled={saving}
        />
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="text-[12px] text-[#5f6368] cursor-pointer hover:text-[#202124] min-w-[60px] min-h-[20px] truncate"
      title={row.comment || 'Click to add comment'}
    >
      {row.comment || <span className="text-[#dadce0] italic">Add note</span>}
    </div>
  );
}

export default function GenreDetail() {
  const { genreId } = useParams<{ genreId: string }>();
  const { genres } = useGenres();
  const { appsByMonth, months, latestFetchedAt, loading, error } = useSnapshots(genreId);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const genre = genres.find((g) => g.id === genreId);
  const data = useMemo(() => buildComparisonData(months, appsByMonth, genre?.name || '', genreId || ''), [months, appsByMonth, genre?.name, genreId]);

  const columns = useMemo(() => {
    const cols: any[] = [
      columnHelper.display({
        id: 'rank',
        header: '#',
        cell: ({ row }) => (
          <span className="text-[12px] text-[#80868b] tabular-nums">{row.index + 1}</span>
        ),
        size: 44,
        enableSorting: false,
      }),
      columnHelper.accessor('appName', {
        header: 'App',
        cell: (info) => (
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#202124] truncate" title={info.getValue()}>
              {info.getValue()}
            </div>
            <div className="text-[11px] text-[#80868b] truncate" title={info.row.original.publisherName}>
              {info.row.original.publisherName || '--'}
            </div>
          </div>
        ),
        size: 200,
      }),
    ];

    for (let mi = 0; mi < months.length; mi++) {
      const month = months[mi];
      const isFirst = mi === 0;

      cols.push(
        columnHelper.accessor((row) => row.revenueByMonth[month] ?? 0, {
          id: `m_${month}`,
          header: formatMonth(month),
          cell: ({ getValue, row }) => {
            const revenue = getValue();
            const pct = isFirst ? undefined : row.original.percentChanges[month];
            const hasPct = pct !== undefined && pct !== null;
            const bg = hasPct ? getHeatmapBg(pct) : 'transparent';
            const textColor = hasPct ? getHeatmapText(pct) : undefined;

            return (
              <div
                className="text-right rounded-md px-2 py-1 -mx-1"
                style={{ backgroundColor: bg }}
              >
                <div className="text-[13px] font-medium tabular-nums text-[#202124]">
                  {formatCurrency(revenue)}
                </div>
                {hasPct && (
                  <div className="text-[11px] tabular-nums font-medium" style={{ color: textColor }}>
                    {formatPercent(pct)}
                  </div>
                )}
              </div>
            );
          },
          size: 120,
        })
      );
    }

    cols.push(
      columnHelper.accessor('dailyRevenue', {
        header: 'Daily Rev',
        cell: (info) => (
          <div className="text-right text-[13px] font-semibold tabular-nums text-[#202124]">
            {formatCurrency(info.getValue())}
          </div>
        ),
        size: 100,
      }),
      columnHelper.display({
        id: 'links',
        header: 'Store',
        cell: ({ row }) => <StoreLinks row={row.original} />,
        size: 64,
        enableSorting: false,
      }),
      columnHelper.display({
        id: 'comment',
        header: 'Notes',
        cell: ({ row }) => <CommentCell row={row.original} genreId={genreId || ''} />,
        size: 120,
        enableSorting: false,
      })
    );

    return cols;
  }, [months, genreId]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 50 },
    },
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = filterValue.toLowerCase();
      return (
        row.original.appName.toLowerCase().includes(q) ||
        row.original.publisherName.toLowerCase().includes(q)
      );
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-[3px] border-primary-100 border-t-primary-600 rounded-full animate-spin" />
          <span className="text-[13px] text-[#5f6368]">Loading data...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-[#fce8e6] rounded-xl p-6">
        <h3 className="font-semibold text-[#c5221f] mb-1">Error loading data</h3>
        <p className="text-[13px] text-[#c5221f]">{error}</p>
      </div>
    );
  }

  const pageCount = table.getPageCount();
  const currentPage = table.getState().pagination.pageIndex;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-5">
        <Link to="/" className="text-[13px] text-[#5f6368] hover:text-primary-600 transition-colors inline-flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Dashboard
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-semibold text-[#202124] tracking-[-0.01em]">{genre?.name || 'Genre'}</h1>
          <p className="text-[13px] text-[#5f6368] mt-0.5">
            {data.length} apps &middot; {months.length} months
            {latestFetchedAt && <> &middot; Updated {latestFetchedAt.toLocaleDateString()}</>}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#80868b]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            placeholder="Search apps or publishers..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="w-full pl-9 pr-3 py-[7px] bg-white border border-[#dadce0] rounded-lg text-[13px] text-[#202124] placeholder-[#80868b] focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
          />
        </div>

        {data.length > 0 && (
          <button
            onClick={() =>
              exportToCsv(
                data,
                months,
                'combined',
                `${genre?.name || 'genre'}-${new Date().toISOString().slice(0, 10)}.csv`
              )
            }
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-[7px] bg-white border border-[#dadce0] rounded-lg text-[13px] font-medium text-[#3c4043] hover:bg-[#f8f9fa] hover:shadow-sm transition-all duration-150"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </button>
        )}
      </div>

      {/* Table */}
      {data.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#dadce0] p-12 text-center">
          <svg className="w-12 h-12 mx-auto mb-4 text-[#dadce0]" fill="none" stroke="currentColor" strokeWidth={1} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
          </svg>
          <h3 className="text-[15px] font-semibold text-[#202124] mb-1">No data available</h3>
          <p className="text-[13px] text-[#5f6368]">Trigger a data refresh from the Dashboard to populate this genre.</p>
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
                        className={`px-3 py-2.5 text-left text-[11px] font-semibold text-[#5f6368] uppercase tracking-wider bg-[#f8f9fa] ${
                          header.column.getCanSort() ? 'cursor-pointer select-none hover:bg-[#f1f3f4]' : ''
                        }`}
                        style={{ width: header.column.getSize() }}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === 'asc' && (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 6l-5 5h10l-5-5z"/></svg>
                          )}
                          {header.column.getIsSorted() === 'desc' && (
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 14l5-5H5l5 5z"/></svg>
                          )}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`border-b border-[#f1f3f4] hover:bg-[#f8f9fa] transition-colors duration-75 ${
                      i % 2 === 0 ? 'bg-white' : 'bg-[#fafbfc]'
                    }`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 text-[13px] text-[#3c4043]">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="px-4 py-2.5 border-t border-[#e8eaed] bg-[#f8f9fa] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-[#5f6368]">
                {currentPage * table.getState().pagination.pageSize + 1}&ndash;
                {Math.min((currentPage + 1) * table.getState().pagination.pageSize, filteredCount)}{' '}
                of {filteredCount}
              </span>
              <select
                value={table.getState().pagination.pageSize}
                onChange={(e) => table.setPageSize(Number(e.target.value))}
                className="text-[12px] border border-[#dadce0] rounded-md px-2 py-1 bg-white text-[#3c4043] focus:outline-none focus:border-primary-500"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size} / page</option>
                ))}
              </select>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => table.previousPage()}
                  disabled={!table.getCanPreviousPage()}
                  className="p-1.5 rounded-full disabled:opacity-30 hover:bg-[#e8eaed] transition-colors"
                >
                  <svg className="w-4 h-4 text-[#5f6368]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                <span className="text-[12px] text-[#5f6368] px-2">
                  {currentPage + 1} / {pageCount}
                </span>
                <button
                  onClick={() => table.nextPage()}
                  disabled={!table.getCanNextPage()}
                  className="p-1.5 rounded-full disabled:opacity-30 hover:bg-[#e8eaed] transition-colors"
                >
                  <svg className="w-4 h-4 text-[#5f6368]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
