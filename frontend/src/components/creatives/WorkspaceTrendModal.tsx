import { useEffect, useMemo } from 'react';
import type { CreativeInsightDoc } from '../../types/creatives';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import {
  buildCompositionTrend,
  buildFatigue,
  type FatigueRow,
  type NewWinnersResult,
  type TrendSeries,
} from '../../lib/creativeTrend';

export interface WorkspaceTrendModalProps {
  open: boolean;
  onClose: () => void;
  focusGameName: string;
  focusAppId: string;
  /** Accumulated weekly insight docs for the scope (from useWorkspaceTrend). */
  weekDocs: CreativeInsightDoc[];
  /** True while the history query is in flight. */
  loading: boolean;
  /** Current week's joined creatives — powers the fatigue read (no history needed). */
  current: JoinedCreative[];
  appNames: Map<string, AppNameMapEntry>;
  /** Winners that newly crossed into the set this week (#2) — from buildNewWinners. */
  newWinners: NewWinnersResult;
}

/** Short "2026-W31" -> "W31". */
function shortWeek(week: string): string {
  const m = /-W(\d{2})$/.exec(week);
  return m ? `W${m[1]}` : week;
}

function DeltaArrow({ delta }: { delta: number | null }) {
  if (delta == null) return null;
  if (delta > 0) return <span className="tabular-nums text-emerald-600">▲ {delta}</span>;
  if (delta < 0) return <span className="tabular-nums text-red-500">▼ {Math.abs(delta)}</span>;
  return <span className="tabular-nums text-ink-faint">—</span>;
}

const BAR_H = 30; // px, full-share height

/** A label's share trajectory: vertical mini-bars per week + latest share & WoW. */
function SeriesRow({ series }: { series: TrendSeries }) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-[128px] shrink-0 truncate text-[12px] text-ink-2" title={series.label}>
        {series.label}
      </span>
      <div className="flex flex-1 items-end gap-[3px]" style={{ height: BAR_H }} aria-hidden>
        {series.sharePctByWeek.map((pct, i) => {
          const isLast = i === series.sharePctByWeek.length - 1;
          const h = pct > 0 ? Math.max((pct / 100) * BAR_H, 2) : 1;
          return (
            <span
              key={i}
              className={`w-2 shrink-0 rounded-sm ${isLast ? 'bg-accent' : 'bg-accent/35'}`}
              style={{ height: h }}
              title={`${pct}%`}
            />
          );
        })}
      </div>
      <span className="w-[42px] shrink-0 text-right text-[12px] tabular-nums text-ink">{series.latestPct}%</span>
      <span className="w-[46px] shrink-0 text-right text-[11px]">
        <DeltaArrow delta={series.latestDeltaPct} />
      </span>
    </div>
  );
}

function FatigueList({
  rows,
  appNames,
}: {
  rows: FatigueRow[];
  appNames: Map<string, AppNameMapEntry>;
}) {
  const maxWeeks = rows.reduce((m, r) => Math.max(m, r.weeksLive), 1);
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => {
        const name = appNames.get(r.appId)?.name ?? r.appId;
        const label = r.title?.trim() || name;
        return (
          <div key={r.docId} className="flex items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={`${label} · ${name}`}>
              {label}
              {r.isFocus && (
                <span className="ml-1.5 rounded-full border border-accent-border bg-accent-tint px-1.5 py-px text-[10px] font-medium text-accent-text">
                  you
                </span>
              )}
            </span>
            <span className="h-[6px] w-[120px] shrink-0 overflow-hidden rounded-full bg-hairline">
              <span
                className={`block h-[6px] rounded-full ${r.fatiguing ? 'bg-amber-400' : 'bg-accent/50'}`}
                style={{ width: `${Math.max((r.weeksLive / maxWeeks) * 100, 6)}%` }}
              />
            </span>
            <span className="w-[64px] shrink-0 text-right text-[11px] tabular-nums text-ink-muted">
              {r.weeksLive} wk{r.weeksLive === 1 ? '' : 's'}
            </span>
            <span className="w-[68px] shrink-0 text-right">
              {r.fatiguing ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                  fatiguing
                </span>
              ) : (
                <span className="text-[10px] text-ink-faint">fresh</span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function NewWinnersList({
  result,
  appNames,
}: {
  result: NewWinnersResult;
  appNames: Map<string, AppNameMapEntry>;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {result.newWinners.map((w) => {
        const name = appNames.get(w.appId)?.name ?? w.appName ?? w.appId;
        return (
          <div key={w.creativeId} className="flex items-start gap-3">
            <span className="mt-px w-[26px] shrink-0 text-right text-[11px] tabular-nums text-ink-faint">
              #{w.rank}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[12px] font-medium text-ink" title={name}>
                  {name}
                </span>
                {w.isFocus && (
                  <span className="shrink-0 rounded-full border border-accent-border bg-accent-tint px-1.5 py-px text-[10px] font-medium text-accent-text">
                    you
                  </span>
                )}
              </div>
              {w.explanation && (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink-muted">{w.explanation}</p>
              )}
            </div>
            <span className="w-[38px] shrink-0 text-right text-[12px] tabular-nums text-ink">{w.score}</span>
          </div>
        );
      })}
    </div>
  );
}

const SECTION_KICKER = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-muted';

export function WorkspaceTrendModal({
  open,
  onClose,
  focusGameName,
  focusAppId,
  weekDocs,
  loading,
  current,
  appNames,
  newWinners,
}: WorkspaceTrendModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const composition = useMemo(() => buildCompositionTrend(weekDocs), [weekDocs]);
  const fatigue = useMemo(() => buildFatigue(current, focusAppId), [current, focusAppId]);

  if (!open) return null;

  const weekCount = composition.weeks.length;
  const hooks = composition.hooks.slice(0, 8);
  const motivations = composition.motivations.slice(0, 6);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(14,15,24,0.55)' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Trends for ${focusGameName} set`}
        className="relative flex max-h-[88vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[10px] border border-line bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-medium text-ink">Trends</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              How {focusGameName}&apos;s competitor set is shifting week to week
              {weekCount > 0 ? ` · ${weekCount} analyzed week${weekCount === 1 ? '' : 's'}` : ''}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-1 text-ink-muted hover:bg-hairline hover:text-ink"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* New winners this week — the in-app new-winner alert (#2). */}
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <span className={SECTION_KICKER}>New winners this week</span>
              <span className="text-[11px] text-ink-faint">crossed into the set vs. last week</span>
            </div>
            {loading ? (
              <p className="text-xs text-ink-muted">Loading…</p>
            ) : !newWinners.hasBaseline ? (
              <p className="text-xs text-ink-muted">
                First analyzed week — no prior week to compare yet. New winners will show here next week.
              </p>
            ) : newWinners.count > 0 ? (
              <NewWinnersList result={newWinners} appNames={appNames} />
            ) : (
              <p className="text-xs text-ink-muted">No new winners crossed into the set this week.</p>
            )}
          </section>

          {/* Creative fatigue — always available from the current week. */}
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <span className={SECTION_KICKER}>Creative fatigue</span>
              <span className="text-[11px] text-ink-faint">longest-running live winners · weeks-live</span>
            </div>
            {fatigue.length > 0 ? (
              <FatigueList rows={fatigue} appNames={appNames} />
            ) : (
              <p className="text-xs text-ink-muted">No scored creatives yet — analyze the set to see fatigue.</p>
            )}
          </section>

          {/* Composition over time — needs >= 2 analyzed weeks. */}
          <section>
            <div className="mb-2 flex items-baseline gap-2">
              <span className={SECTION_KICKER}>Composition over time</span>
              <span className="text-[11px] text-ink-faint">hook &amp; motivation mix, share of set</span>
            </div>

            {loading ? (
              <p className="py-6 text-center text-xs text-ink-muted">Loading history…</p>
            ) : composition.hasComposition ? (
              <div className="space-y-5">
                {composition.topMovers.length > 0 && (
                  <p className="text-[12px] leading-relaxed text-ink-2">
                    Biggest shifts:{' '}
                    {composition.topMovers.map((m, i) => (
                      <span key={`${m.kind}-${m.label}`}>
                        {i > 0 && ', '}
                        <span className="font-medium text-ink">{m.label}</span>{' '}
                        <span className={m.deltaPct > 0 ? 'text-emerald-600' : 'text-red-500'}>
                          {m.deltaPct > 0 ? '▲' : '▼'}
                          {Math.abs(m.deltaPct)}pt
                        </span>
                      </span>
                    ))}
                    <span className="text-ink-faint"> (vs. prior week)</span>
                  </p>
                )}

                <div>
                  <div className="mb-1 flex items-center gap-3 text-[10px] uppercase tracking-wide text-ink-faint">
                    <span className="w-[128px] shrink-0">Hook</span>
                    <span className="flex-1">
                      {composition.weeks.map((w) => shortWeek(w)).join(' · ')}
                    </span>
                    <span className="w-[42px] shrink-0 text-right">now</span>
                    <span className="w-[46px] shrink-0 text-right">WoW</span>
                  </div>
                  {hooks.map((s) => (
                    <SeriesRow key={s.label} series={s} />
                  ))}
                </div>

                {motivations.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">
                      Motivation (of analyzed videos)
                    </div>
                    {motivations.map((s) => (
                      <SeriesRow key={s.label} series={s} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-[#faf9fe] p-6 text-center">
                <p className="mx-auto max-w-[440px] text-xs leading-relaxed text-ink-muted">
                  Trends build as you analyze this set each week — {weekCount} week
                  {weekCount === 1 ? '' : 's'} so far. Re-analyze next week and the hook &amp;
                  motivation mix will chart here.
                </p>
              </div>
            )}
          </section>

          <p className="border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink-faint">
            A structural read from ad longevity, network breadth and share of voice — not measured
            hook/hold rates or spend.
          </p>
        </div>
      </div>
    </div>
  );
}
