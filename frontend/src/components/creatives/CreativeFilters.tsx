import type { Dispatch, SetStateAction } from 'react';
import type { CreativeFormat, QueryableAdNetwork } from '../../types/creatives';
import type { AppNameMapEntry } from '../../hooks/useAppNames';

export interface Filters {
  networks: Set<QueryableAdNetwork>;
  formats: Set<CreativeFormat>;
  appIds: Set<string>;
  newThisWeek: boolean;
  winnersOnly: boolean;
  sort: 'score' | 'duration' | 'firstSeen' | 'sov';
  search: string;
}

export function defaultFilters(): Filters {
  return {
    networks: new Set(),
    formats: new Set(),
    appIds: new Set(),
    newThisWeek: false,
    winnersOnly: false,
    sort: 'score',
    search: '',
  };
}

function toggleSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export interface CreativeFiltersProps {
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  availableNetworks: QueryableAdNetwork[];
  availableFormats: CreativeFormat[];
  appOptions: { appId: string; label: string }[];
}

export function CreativeFilters({
  filters,
  setFilters,
  availableNetworks,
  availableFormats,
  appOptions,
}: CreativeFiltersProps) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
        <input
          type="search"
          placeholder="Search title, app, publisher…"
          value={filters.search}
          onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
          className="w-full lg:w-64 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500 shrink-0">Networks</span>
          {availableNetworks.map((n) => {
            const on = filters.networks.has(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() =>
                  setFilters((prev) => ({ ...prev, networks: toggleSet(prev.networks, n) }))
                }
                className={`px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  on
                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500 shrink-0">Format</span>
          {availableFormats.map((f) => {
            const on = filters.formats.has(f);
            const label = f === 'unknown' ? 'Unknown' : f.charAt(0).toUpperCase() + f.slice(1);
            return (
              <button
                key={f}
                type="button"
                onClick={() =>
                  setFilters((prev) => ({ ...prev, formats: toggleSet(prev.formats, f) }))
                }
                className={`px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  on
                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.newThisWeek}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, newThisWeek: e.target.checked }))
              }
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            New this week
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.winnersOnly}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, winnersOnly: e.target.checked }))
              }
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Winners only
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium text-gray-500">Sort</label>
          <select
            value={filters.sort}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                sort: e.target.value as Filters['sort'],
              }))
            }
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="score">Score</option>
            <option value="duration">Duration</option>
            <option value="firstSeen">First seen</option>
            <option value="sov">Share of voice</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setFilters(defaultFilters())}
          className="text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          Reset
        </button>
      </div>

      {appOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
          <span className="text-xs font-medium text-gray-500 shrink-0">Apps</span>
          {appOptions.map(({ appId, label }) => {
            const on = filters.appIds.has(appId);
            return (
              <button
                key={appId}
                type="button"
                onClick={() =>
                  setFilters((prev) => ({ ...prev, appIds: toggleSet(prev.appIds, appId) }))
                }
                className={`max-w-[200px] truncate px-2 py-1 rounded-full text-[11px] font-medium border transition-colors ${
                  on
                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'
                }`}
                title={label}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function buildAppOptions(
  appIds: string[],
  appNames: Map<string, AppNameMapEntry>,
): { appId: string; label: string }[] {
  const seen = new Set<string>();
  const out: { appId: string; label: string }[] = [];
  for (const id of appIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = appNames.get(id);
    out.push({ appId: id, label: e?.name ?? id });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
