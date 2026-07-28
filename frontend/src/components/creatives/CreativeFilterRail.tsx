import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import type { CreativeFormat, QueryableAdNetwork } from '../../types/creatives';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import { durationBucket, DURATION_BUCKETS } from '../../lib/creativeBuckets';
import {
  activeFilterCount,
  toggleSet,
  type Filters,
  type HookAgg,
  type ThemeAgg,
} from '../../lib/creativeFilters';

const HOOK_RAMP = ['bg-accent-1', 'bg-accent-2', 'bg-accent-3', 'bg-accent-4'];

export interface CreativeFilterRailProps {
  filters: Filters;
  setFilters: Dispatch<SetStateAction<Filters>>;
  onClear: () => void;
  /** Stable counts come from the pre-tag-filter list so they don't shift while filtering. */
  baseFilteredCreatives: JoinedCreative[];
  hookAggs: HookAgg[];
  themeAggs: ThemeAgg[];
  availableNetworks: QueryableAdNetwork[];
  appOptions: { appId: string; label: string }[];
  appNames: Map<string, AppNameMapEntry>;
  focusAppId: string;
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-muted">{children}</p>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-2 text-left text-xs text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <span>{label}</span>
      <span
        className={`relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-line'
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-[3px] text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
        active
          ? 'border-accent-border bg-accent-tint text-accent-text'
          : 'border-line bg-surface text-ink-2 hover:bg-[#faf9fe]'
      }`}
    >
      {label}
      <span className="tabular-nums text-[10px] text-ink-faint">{count}</span>
    </button>
  );
}

function ExpandLink({ hidden, onClick, expanded }: { hidden: number; onClick: () => void; expanded: boolean }) {
  if (hidden <= 0 && !expanded) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-medium text-accent-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {expanded ? 'Show less' : `+${hidden} more`}
    </button>
  );
}

export function CreativeFilterRail({
  filters,
  setFilters,
  onClear,
  baseFilteredCreatives,
  hookAggs,
  themeAggs,
  availableNetworks,
  appOptions,
  appNames,
  focusAppId,
}: CreativeFilterRailProps) {
  const [themesExpanded, setThemesExpanded] = useState(false);
  const [gamesExpanded, setGamesExpanded] = useState(false);

  const counts = useMemo(() => {
    const format = new Map<CreativeFormat, number>();
    const duration = new Map<string, number>();
    const network = new Map<QueryableAdNetwork, number>();
    const app = new Map<string, number>();
    for (const c of baseFilteredCreatives) {
      format.set(c.format, (format.get(c.format) ?? 0) + 1);
      if (c.format === 'video') {
        const b = durationBucket(c.videoDurationSec);
        duration.set(b, (duration.get(b) ?? 0) + 1);
      }
      for (const n of c.networks) network.set(n, (network.get(n) ?? 0) + 1);
      app.set(c.appId, (app.get(c.appId) ?? 0) + 1);
    }
    return { format, duration, network, app };
  }, [baseFilteredCreatives]);

  const active = activeFilterCount(filters);
  const maxHook = hookAggs[0]?.count ?? 1;

  const durationRows = DURATION_BUCKETS.filter((b) => (counts.duration.get(b) ?? 0) > 0);
  const formatRows = [...counts.format.entries()].sort((a, b) => b[1] - a[1]);

  const visibleThemes = themesExpanded ? themeAggs : themeAggs.slice(0, 10);
  const visibleGames = gamesExpanded ? appOptions : appOptions.slice(0, 6);

  const formatLabel = (f: CreativeFormat) => (f === 'unknown' ? 'Unknown' : f.charAt(0).toUpperCase() + f.slice(1));

  return (
    <aside className="flex w-[236px] shrink-0 flex-col gap-[18px] self-start border-r border-line bg-surface px-4 pb-7 pt-[18px] lg:sticky lg:top-0">
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-ink">Filters</span>
          {active > 0 && <span className="text-xs text-ink-muted">{active} active</span>}
        </div>
        {active > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-accent-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Clear
          </button>
        )}
      </div>

      <input
        type="search"
        value={filters.search}
        onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
        placeholder="Search title, game, publisher…"
        className="rounded-lg border border-line px-2.5 py-[7px] text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />

      <div className="flex flex-col gap-2.5">
        <Toggle
          label="Winners only (60+)"
          checked={filters.winnersOnly}
          onChange={(v) => setFilters((prev) => ({ ...prev, winnersOnly: v }))}
        />
        <Toggle
          label="New this week"
          checked={filters.newThisWeek}
          onChange={(v) => setFilters((prev) => ({ ...prev, newThisWeek: v }))}
        />
        <Toggle
          label="Hide my own game"
          checked={filters.hideOwnGame}
          onChange={(v) => setFilters((prev) => ({ ...prev, hideOwnGame: v }))}
        />
      </div>

      {hookAggs.length > 0 && (
        <div>
          <GroupLabel>Hook</GroupLabel>
          <ul className="space-y-1.5">
            {hookAggs.map((h, i) => {
              const on = filters.hookTypes.has(h.hookType);
              return (
                <li key={h.hookType}>
                  <button
                    type="button"
                    onClick={() =>
                      setFilters((prev) => ({ ...prev, hookTypes: toggleSet(prev.hookTypes, h.hookType) }))
                    }
                    className="flex w-full items-center gap-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className={`flex-1 truncate text-xs ${on ? 'font-medium text-accent-text' : 'text-ink-2'}`}>
                      {h.hookType}
                    </span>
                    <span className="h-1 w-[52px] shrink-0 overflow-hidden rounded-full bg-hairline">
                      <span
                        className={`block h-1 rounded-full ${HOOK_RAMP[Math.min(i, HOOK_RAMP.length - 1)]}`}
                        style={{ width: `${Math.max((h.count / maxHook) * 100, 8)}%` }}
                      />
                    </span>
                    <span
                      className={`w-[18px] shrink-0 text-right text-[11px] tabular-nums ${
                        on ? 'font-medium text-accent-text' : 'text-ink-muted'
                      }`}
                    >
                      {h.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {themeAggs.length > 0 && (
        <div>
          <GroupLabel>Theme</GroupLabel>
          <div className="flex flex-wrap gap-1.5">
            {visibleThemes.map((t) => (
              <Chip
                key={t.theme.toLowerCase()}
                label={t.theme}
                count={t.count}
                active={filters.themes.has(t.theme.toLowerCase())}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, themes: toggleSet(prev.themes, t.theme.toLowerCase()) }))
                }
              />
            ))}
            <ExpandLink
              hidden={themeAggs.length - 10}
              expanded={themesExpanded}
              onClick={() => setThemesExpanded((v) => !v)}
            />
          </div>
        </div>
      )}

      {(formatRows.length > 0 || durationRows.length > 0) && (
        <div>
          <GroupLabel>Format &amp; length</GroupLabel>
          <div className="flex flex-wrap gap-1.5">
            {formatRows.map(([f, n]) => (
              <Chip
                key={`fmt-${f}`}
                label={formatLabel(f)}
                count={n}
                active={filters.formats.has(f)}
                onClick={() => setFilters((prev) => ({ ...prev, formats: toggleSet(prev.formats, f) }))}
              />
            ))}
            {durationRows.map((b) => (
              <Chip
                key={`dur-${b}`}
                label={b}
                count={counts.duration.get(b) ?? 0}
                active={filters.durationBuckets.has(b)}
                onClick={() =>
                  setFilters((prev) => ({ ...prev, durationBuckets: toggleSet(prev.durationBuckets, b) }))
                }
              />
            ))}
          </div>
        </div>
      )}

      {availableNetworks.length > 0 && (
        <div>
          <GroupLabel>Network</GroupLabel>
          <div className="flex flex-wrap gap-1.5">
            {availableNetworks.map((n) => (
              <Chip
                key={n}
                label={n}
                count={counts.network.get(n) ?? 0}
                active={filters.networks.has(n)}
                onClick={() => setFilters((prev) => ({ ...prev, networks: toggleSet(prev.networks, n) }))}
              />
            ))}
          </div>
        </div>
      )}

      {appOptions.length > 0 && (
        <div>
          <GroupLabel>Game</GroupLabel>
          <ul className="space-y-1">
            {visibleGames.map(({ appId, label }) => {
              const on = filters.appIds.has(appId);
              const entry = appNames.get(appId);
              return (
                <li key={appId}>
                  <button
                    type="button"
                    onClick={() => setFilters((prev) => ({ ...prev, appIds: toggleSet(prev.appIds, appId) }))}
                    className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-[#faf9fe] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {entry?.iconUrl ? (
                      <img src={entry.iconUrl} alt="" className="h-[18px] w-[18px] shrink-0 rounded" loading="lazy" />
                    ) : (
                      <span className="h-[18px] w-[18px] shrink-0 rounded bg-hairline" />
                    )}
                    <span className={`flex-1 truncate text-xs ${on ? 'font-medium text-accent-text' : 'text-ink-2'}`}>
                      {label}
                      {appId === focusAppId && <span className="text-accent-text"> · yours</span>}
                    </span>
                    <span
                      className={`shrink-0 text-[11px] tabular-nums ${on ? 'font-medium text-accent-text' : 'text-ink-muted'}`}
                    >
                      {counts.app.get(appId) ?? 0}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1">
            <ExpandLink
              hidden={appOptions.length - 6}
              expanded={gamesExpanded}
              onClick={() => setGamesExpanded((v) => !v)}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
