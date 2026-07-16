import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiscoveredCompetitor, SearchedGame } from '../../lib/creativesApi';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppFetchState } from '../../hooks/useWorkspaceAnalysis';
import { useGameSearch } from '../../hooks/useGameSearch';

const COUNTRIES = ['US', 'GB', 'DE', 'FR', 'JP', 'KR', 'BR', 'TR', 'IN'];

export interface CompetitorRailProps {
  focusApp: SearchedGame;
  competitors: DiscoveredCompetitor[];
  selectedIds: Set<string>;
  discovering: boolean;
  discoveryError: string | null;
  country: string;
  running: boolean;
  appStatuses: Map<string, AppFetchState>;
  creatives: JoinedCreative[];
  galleryAppIds: Set<string>;
  onToggleSelected: (appId: string) => void;
  onToggleGalleryApp: (appId: string) => void;
  onShowAllCreatives: () => void;
  onAddCompetitor: (game: SearchedGame) => void;
  onCountryChange: (country: string) => void;
  onAnalyze: () => void;
  onRetryDiscovery: () => void;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function StatusLine({ status, creativeCount }: { status: AppFetchState | undefined; creativeCount: number }) {
  if (status?.state === 'fetching') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-blue-700">
        <span className="w-3 h-3 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 animate-spin" />
        Fetching…
      </span>
    );
  }
  if (status?.state === 'queued') {
    return <span className="text-[11px] text-gray-400">Queued</span>;
  }
  if (status?.state === 'error') {
    return (
      <span className="text-[11px] text-red-600 truncate" title={status.message}>
        ⚠ Fetch failed
      </span>
    );
  }
  if (status?.state === 'done') {
    return (
      <span className="text-[11px] font-medium text-emerald-700">
        ✓ {status.count} creative{status.count === 1 ? '' : 's'}
        {status.cached ? ' (cached)' : ''}
      </span>
    );
  }
  if (creativeCount > 0) {
    return (
      <span className="text-[11px] font-medium text-gray-700">
        {creativeCount} creative{creativeCount === 1 ? '' : 's'}
      </span>
    );
  }
  return <span className="text-[11px] text-gray-400">Not fetched yet</span>;
}

function CompetitorCard({
  app,
  isFocus,
  checked,
  disabled,
  status,
  creativeCount,
  topScore,
  inGalleryFilter,
  onToggleSelected,
  onToggleGalleryApp,
}: {
  app: DiscoveredCompetitor;
  isFocus: boolean;
  checked: boolean;
  disabled: boolean;
  status: AppFetchState | undefined;
  creativeCount: number;
  topScore: number | null;
  inGalleryFilter: boolean;
  onToggleSelected: () => void;
  onToggleGalleryApp: () => void;
}) {
  return (
    <div
      className={`flex w-48 shrink-0 flex-col gap-1.5 rounded-xl border p-3 transition-colors ${
        inGalleryFilter
          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
          : isFocus
            ? 'border-blue-200 bg-white'
            : checked
              ? 'border-gray-300 bg-white'
              : 'border-gray-200 bg-gray-50 opacity-60'
      }`}
    >
      <div className="flex items-center gap-2">
        {!isFocus && (
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={onToggleSelected}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
            aria-label={`Include ${app.name} in analysis`}
          />
        )}
        {app.iconUrl ? (
          <img src={app.iconUrl} alt="" className="w-8 h-8 rounded-lg bg-gray-100 shrink-0" loading="lazy" />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center text-[10px] font-semibold text-gray-400">
            {app.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 truncate" title={app.reason ?? app.name}>
            {app.name}
          </p>
          <p className="text-[10px] text-gray-500 truncate">{app.publisherName || '—'}</p>
        </div>
      </div>
      <div className="flex items-center justify-between gap-1">
        <StatusLine status={status} creativeCount={creativeCount} />
        {topScore != null && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 tabular-nums shrink-0">
            top {topScore}
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] text-gray-400 tabular-nums">
          {isFocus ? 'Your game' : app.source === 'ai' ? 'AI match' : 'Category top'}
          {app.revenue != null ? ` · ${formatCompact(app.revenue)}/mo` : ''}
        </span>
        {creativeCount > 0 && (
          <button
            type="button"
            onClick={onToggleGalleryApp}
            className="text-[10px] font-medium text-blue-600 hover:text-blue-800 shrink-0"
          >
            {inGalleryFilter ? 'Unfilter' : 'Filter'}
          </button>
        )}
      </div>
    </div>
  );
}

function AddCompetitorCard({ onAdd, excludeIds }: { onAdd: (g: SearchedGame) => void; excludeIds: Set<string> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { results, searching } = useGameSearch(q);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const visible = results.filter((r) => !excludeIds.has(r.appId)).slice(0, 6);

  return (
    <div ref={rootRef} className="relative w-48 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-full min-h-[104px] w-full flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-gray-300 bg-white text-gray-400 hover:border-blue-300 hover:text-blue-600"
      >
        <span className="text-xl leading-none">＋</span>
        <span className="text-xs font-medium">Add competitor</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          <input
            autoFocus
            type="search"
            placeholder="Search any game…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full border-b border-gray-100 px-3 py-2 text-sm focus:outline-none"
          />
          {searching ? (
            <p className="px-3 py-2 text-sm text-gray-400">Searching…</p>
          ) : (
            visible.map((g) => (
              <button
                key={g.appId}
                type="button"
                onClick={() => {
                  onAdd(g);
                  setQ('');
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-blue-50"
              >
                {g.iconUrl && <img src={g.iconUrl} alt="" className="w-6 h-6 rounded shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900 truncate">{g.name}</span>
                  <span className="block text-xs text-gray-500 truncate">{g.publisherName || '—'}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The workspace's competitor rail: AI-discovered + category competitors with
 * curation checkboxes, per-app fetch progress, a country picker, manual adds,
 * and the Analyze CTA. Cards double as gallery filters once creatives exist.
 */
export function CompetitorRail({
  focusApp,
  competitors,
  selectedIds,
  discovering,
  discoveryError,
  country,
  running,
  appStatuses,
  creatives,
  galleryAppIds,
  onToggleSelected,
  onToggleGalleryApp,
  onShowAllCreatives,
  onAddCompetitor,
  onCountryChange,
  onAnalyze,
  onRetryDiscovery,
}: CompetitorRailProps) {
  const statsByApp = useMemo(() => {
    const m = new Map<string, { count: number; topScore: number | null }>();
    for (const c of creatives) {
      const cur = m.get(c.appId) ?? { count: 0, topScore: null };
      cur.count += 1;
      if (c.score != null && (cur.topScore == null || c.score > cur.topScore)) cur.topScore = c.score;
      m.set(c.appId, cur);
    }
    return m;
  }, [creatives]);

  const focusRow: DiscoveredCompetitor = useMemo(
    () => ({
      appId: focusApp.appId,
      name: focusApp.name,
      publisherName: focusApp.publisherName,
      iosAppId: focusApp.iosAppId,
      androidAppId: focusApp.androidAppId,
      iconUrl: focusApp.iconUrl,
      revenue: null,
      downloads: null,
      source: 'ai',
      reason: null,
    }),
    [focusApp],
  );

  const selectedCount = competitors.filter((c) => selectedIds.has(c.appId)).length;
  const allIds = useMemo(
    () => new Set([focusApp.appId, ...competitors.map((c) => c.appId)]),
    [focusApp, competitors],
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Competitors of {focusApp.name}
          {!discovering && competitors.length > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-500">
              {selectedCount} of {competitors.length} selected for analysis
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          {galleryAppIds.size > 0 && (
            <button
              type="button"
              onClick={onShowAllCreatives}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              Show all creatives
            </button>
          )}
          <label className="flex items-center gap-1 text-xs text-gray-500">
            Country
            <select
              value={country}
              disabled={running}
              onChange={(e) => onCountryChange(e.target.value)}
              className="rounded-lg border border-gray-300 px-1.5 py-1 text-xs text-gray-900 focus:border-blue-500 focus:outline-none"
            >
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onAnalyze}
            disabled={running || discovering || selectedCount === 0}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {running ? 'Analyzing…' : `Analyze creatives (${selectedCount + 1} games)`}
          </button>
        </div>
      </div>

      {discovering ? (
        <p className="flex items-center gap-2 py-3 text-sm text-gray-400">
          <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin" />
          AI is finding {focusApp.name}'s competitors…
        </p>
      ) : discoveryError ? (
        <p className="py-3 text-sm text-red-600">
          Could not find competitors: {discoveryError}{' '}
          <button type="button" onClick={onRetryDiscovery} className="font-semibold underline hover:no-underline">
            Retry
          </button>
        </p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          <CompetitorCard
            app={focusRow}
            isFocus
            checked
            disabled
            status={appStatuses.get(focusApp.appId)}
            creativeCount={statsByApp.get(focusApp.appId)?.count ?? 0}
            topScore={statsByApp.get(focusApp.appId)?.topScore ?? null}
            inGalleryFilter={galleryAppIds.has(focusApp.appId)}
            onToggleSelected={() => {}}
            onToggleGalleryApp={() => onToggleGalleryApp(focusApp.appId)}
          />
          {competitors.map((app) => (
            <CompetitorCard
              key={app.appId}
              app={app}
              isFocus={false}
              checked={selectedIds.has(app.appId)}
              disabled={running}
              status={appStatuses.get(app.appId)}
              creativeCount={statsByApp.get(app.appId)?.count ?? 0}
              topScore={statsByApp.get(app.appId)?.topScore ?? null}
              inGalleryFilter={galleryAppIds.has(app.appId)}
              onToggleSelected={() => onToggleSelected(app.appId)}
              onToggleGalleryApp={() => onToggleGalleryApp(app.appId)}
            />
          ))}
          {!running && <AddCompetitorCard onAdd={onAddCompetitor} excludeIds={allIds} />}
        </div>
      )}
    </div>
  );
}
