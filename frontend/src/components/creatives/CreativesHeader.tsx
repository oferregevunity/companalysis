import type { DiscoveredCompetitor, SearchedGame } from '../../lib/creativesApi';

/** Primary markets shown as segments; the current country is always included. */
const PRIMARY_COUNTRIES = ['US', 'GB', 'DE', 'JP', 'KR'];

const focusPlaceholder = (name: string) => name.slice(0, 2).toUpperCase();

export interface CreativesHeaderProps {
  focusApp: SearchedGame;
  competitors: DiscoveredCompetitor[];
  selectedIds: Set<string>;
  creativeCount: number;
  gameCount: number;
  country: string;
  weekLabel: string | null;
  lastAnalyzed: string | null;
  statusLoading: boolean;
  busy: boolean;
  creativeCountByApp: Map<string, number>;
  onCountryChange: (country: string) => void;
  onRefresh: () => void;
  onReanalyze: () => void;
  onGenerateConcepts: () => void;
  onTrends: () => void;
  onEditSet: () => void;
  onChangeGame: () => void;
  /** Count of winners that newly crossed into the set this week (#2) — badges the Trends button. */
  newWinnerCount?: number;
}

function GameIcon({ url, name, size }: { url?: string | null; name: string; size: number }) {
  const cls = 'shrink-0 rounded-lg bg-[#eceaf6] object-cover';
  const style = { width: size, height: size };
  if (url) return <img src={url} alt="" style={style} className={cls} loading="lazy" />;
  return (
    <div
      style={style}
      className="flex shrink-0 items-center justify-center rounded-lg bg-[#eceaf6] text-[10px] font-semibold text-accent-text"
    >
      {focusPlaceholder(name)}
    </div>
  );
}

export function CreativesHeader({
  focusApp,
  competitors,
  selectedIds,
  creativeCount,
  gameCount,
  country,
  weekLabel,
  lastAnalyzed,
  statusLoading,
  busy,
  creativeCountByApp,
  onCountryChange,
  onRefresh,
  onReanalyze,
  onGenerateConcepts,
  onTrends,
  onEditSet,
  onChangeGame,
  newWinnerCount = 0,
}: CreativesHeaderProps) {
  const selected = competitors.filter((c) => selectedIds.has(c.appId));
  const shownChips = selected.slice(0, 6);
  const overflow = selected.length - shownChips.length;

  const segments = PRIMARY_COUNTRIES.includes(country)
    ? PRIMARY_COUNTRIES
    : [country, ...PRIMARY_COUNTRIES];

  const subParts = [
    `${creativeCount} creative${creativeCount === 1 ? '' : 's'} from ${gameCount} game${gameCount === 1 ? '' : 's'}`,
    country,
    weekLabel ? `week of ${weekLabel}` : null,
    statusLoading && !lastAnalyzed ? 'loading…' : lastAnalyzed ? `analyzed ${lastAnalyzed}` : 'not analyzed yet',
  ].filter(Boolean);

  return (
    <header className="border-b border-line bg-surface px-7 pt-3.5">
      {/* Row 1 — identity + controls */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <GameIcon url={focusApp.iconUrl} name={focusApp.name} size={34} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-[19px] font-medium tracking-[-0.01em] text-ink">{focusApp.name}</h1>
              {focusApp.publisherName && (
                <span className="truncate text-xs text-ink-muted">{focusApp.publisherName}</span>
              )}
              <button
                type="button"
                onClick={onChangeGame}
                className="shrink-0 rounded text-xs font-medium text-accent-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Change
              </button>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-muted">{subParts.join(' · ')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Country">
            {segments.map((c) => {
              const active = c === country;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  onClick={() => onCountryChange(c)}
                  className={`px-2.5 py-[5px] text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-50 ${
                    active ? 'bg-accent-tint font-medium text-accent-text' : 'bg-surface text-ink-2 hover:bg-[#faf9fe]'
                  }`}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={busy}
            title="Re-read this week's creatives"
            className="rounded-lg border border-line bg-surface px-3 py-[5px] text-xs font-medium text-ink-2 hover:bg-[#faf9fe] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={onGenerateConcepts}
            title="Turn the analyzed winners into ready-to-brief concepts"
            className="rounded-lg border border-line bg-surface px-3 py-[5px] text-xs font-medium text-ink-2 hover:bg-[#faf9fe] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ✨ Concepts
          </button>
          <button
            type="button"
            onClick={onTrends}
            title={
              newWinnerCount > 0
                ? `${newWinnerCount} new winner${newWinnerCount === 1 ? '' : 's'} this week · week-over-week mix and fatigue`
                : 'Week-over-week hook/motivation mix and creative fatigue'
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-[5px] text-xs font-medium text-ink-2 hover:bg-[#faf9fe] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            📈 Trends
            {newWinnerCount > 0 && (
              <span
                className="inline-flex min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-[16px] text-white tabular-nums"
                aria-label={`${newWinnerCount} new winners this week`}
              >
                {newWinnerCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={onReanalyze}
            disabled={busy}
            title="Re-fetch all games and re-run the AI analysis"
            className="rounded-lg border border-accent bg-transparent px-3 py-[5px] text-xs font-medium text-accent-text hover:bg-accent-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50"
          >
            Re-analyze
          </button>
        </div>
      </div>

      {/* Row 2 — the set (focus + competitor chips) */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted">Set</span>

        <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-tint py-1 pl-1.5 pr-2.5 text-xs font-medium text-accent-text">
          <GameIcon url={focusApp.iconUrl} name={focusApp.name} size={18} />
          <span className="max-w-[160px] truncate">{focusApp.name}</span>
          <span className="tabular-nums text-[11px] text-accent-text/70">
            {creativeCountByApp.get(focusApp.appId) ?? 0}
          </span>
        </span>

        <span className="h-[18px] w-px bg-line" aria-hidden />

        {shownChips.map((c) => (
          <span
            key={c.appId}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-1.5 pr-2.5 text-xs text-ink-2"
          >
            <GameIcon url={c.iconUrl} name={c.name} size={18} />
            <span className="max-w-[140px] truncate">{c.name}</span>
            <span className="tabular-nums text-[11px] text-ink-faint">{creativeCountByApp.get(c.appId) ?? 0}</span>
          </span>
        ))}

        {overflow > 0 && <span className="text-xs text-ink-muted">+{overflow} more</span>}

        <button
          type="button"
          onClick={onEditSet}
          className="ml-auto rounded text-xs font-medium text-accent-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Edit set
        </button>
      </div>
    </header>
  );
}
