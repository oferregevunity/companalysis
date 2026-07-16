import { useMemo } from 'react';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';

/** Minimal app shape the strip needs — fed live from the Sensor Tower API. */
export interface CompetitorApp {
  appId: string;
  name: string;
  publisherName: string;
  /** Last complete month's store revenue (USD); null when unknown. */
  latestRevenue: number | null;
  iconUrl?: string | null;
}

export interface CompetitorStripProps {
  focusApp: CompetitorApp;
  competitors: CompetitorApp[];
  loading: boolean;
  error: string | null;
  creatives: JoinedCreative[];
  appNames: Map<string, AppNameMapEntry>;
  selectedAppIds: Set<string>;
  onToggleApp: (appId: string) => void;
  onShowAll: () => void;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

interface AppCreativeStats {
  count: number;
  topScore: number | null;
}

function CompetitorCard({
  app,
  stats,
  icon,
  selected,
  isFocus,
  onClick,
}: {
  app: CompetitorApp;
  stats: AppCreativeStats | undefined;
  icon: string | null | undefined;
  selected: boolean;
  isFocus: boolean;
  onClick: () => void;
}) {
  const count = stats?.count ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={count === 0 && !isFocus}
      title={count === 0 ? 'No creatives captured this week' : `Show only ${app.name}'s creatives`}
      className={`flex w-44 shrink-0 flex-col gap-1.5 rounded-xl border p-3 text-left transition-colors ${
        selected
          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
          : isFocus
            ? 'border-blue-200 bg-white'
            : 'border-gray-200 bg-white hover:border-gray-300'
      } ${count === 0 && !isFocus ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <img src={icon} alt="" className="w-8 h-8 rounded-lg bg-gray-100 shrink-0" loading="lazy" />
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gray-100 shrink-0 flex items-center justify-center text-[10px] font-semibold text-gray-400">
            {app.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-900 truncate">{app.name}</p>
          <p className="text-[10px] text-gray-500 truncate">{app.publisherName || '—'}</p>
        </div>
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className={count > 0 ? 'font-medium text-gray-700' : 'text-gray-400'}>
          {count > 0 ? `${count} creative${count === 1 ? '' : 's'}` : 'No creatives'}
        </span>
        {stats?.topScore != null && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-700 tabular-nums">
            top {stats.topScore}
          </span>
        )}
      </div>
      {app.latestRevenue != null && (
        <span className="text-[10px] text-gray-400 tabular-nums">{formatCompact(app.latestRevenue)}/mo revenue</span>
      )}
    </button>
  );
}

/**
 * Ranked competitor rail for the focused game, fetched live from Sensor
 * Tower (top revenue apps in the game's category): who they are, how many
 * active creatives each is running this week, and their best creative score.
 * Clicking a card filters the gallery to that competitor.
 */
export function CompetitorStrip({
  focusApp,
  competitors,
  loading,
  error,
  creatives,
  appNames,
  selectedAppIds,
  onToggleApp,
  onShowAll,
}: CompetitorStripProps) {
  const statsByApp = useMemo(() => {
    const m = new Map<string, AppCreativeStats>();
    for (const c of creatives) {
      const cur = m.get(c.appId) ?? { count: 0, topScore: null };
      cur.count += 1;
      if (c.score != null && (cur.topScore == null || c.score > cur.topScore)) cur.topScore = c.score;
      m.set(c.appId, cur);
    }
    return m;
  }, [creatives]);

  // Competitors running creatives first (by their best score, then revenue),
  // then the quiet ones so the team still sees who's in the arena.
  const ordered = useMemo(() => {
    const withStats = competitors.map((app) => ({ app, stats: statsByApp.get(app.appId) }));
    withStats.sort((a, b) => {
      const ac = a.stats?.count ?? 0;
      const bc = b.stats?.count ?? 0;
      if ((ac > 0) !== (bc > 0)) return ac > 0 ? -1 : 1;
      const as = a.stats?.topScore ?? -1;
      const bs = b.stats?.topScore ?? -1;
      if (as !== bs) return bs - as;
      return (b.app.latestRevenue ?? 0) - (a.app.latestRevenue ?? 0);
    });
    return withStats.slice(0, 12);
  }, [competitors, statsByApp]);

  const activeCount = ordered.filter((o) => (o.stats?.count ?? 0) > 0).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">
          Competitors of {focusApp.name}
          {!loading && ordered.length > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-500">
              {activeCount} of {ordered.length} running ads this week · top of category by revenue
            </span>
          )}
        </h3>
        {selectedAppIds.size > 0 && (
          <button type="button" onClick={onShowAll} className="text-xs font-medium text-blue-600 hover:text-blue-800">
            Show all creatives
          </button>
        )}
      </div>
      {loading ? (
        <p className="flex items-center gap-2 py-3 text-sm text-gray-400">
          <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin" />
          Finding competitors on Sensor Tower…
        </p>
      ) : error ? (
        <p className="py-3 text-sm text-red-600">Could not load competitors: {error}</p>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-1">
          <CompetitorCard
            app={focusApp}
            stats={statsByApp.get(focusApp.appId)}
            icon={focusApp.iconUrl ?? appNames.get(focusApp.appId)?.iconUrl}
            selected={selectedAppIds.has(focusApp.appId)}
            isFocus
            onClick={() => onToggleApp(focusApp.appId)}
          />
          {ordered.map(({ app, stats }) => (
            <CompetitorCard
              key={app.appId}
              app={app}
              stats={stats}
              icon={app.iconUrl ?? appNames.get(app.appId)?.iconUrl}
              selected={selectedAppIds.has(app.appId)}
              isFocus={false}
              onClick={() => onToggleApp(app.appId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
