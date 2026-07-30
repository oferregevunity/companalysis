import type { CreativeInsightDoc } from '../types/creatives';
import type { JoinedCreative } from '../hooks/useCreativesForGenre';

/**
 * Per-workspace week-over-week trend (#6). Pure aggregation over the accumulated
 * weekly insight docs (`creativeInsights/game_{focusAppId}_week_{week}`) plus the
 * current week's joined creatives. No Firestore, no React — fed by
 * `useWorkspaceTrend` and rendered by `WorkspaceTrendModal`.
 *
 * Two independent reads:
 *  - Composition over time: how the set's hook / motivation MIX shifts week to
 *    week. Needs >= 2 analyzed weeks; degrades to "N week(s) so far" below that.
 *  - Creative fatigue: the longest-running live winners right now (weeks-live
 *    from `durationDays`). Works off a single analyzed week — no history needed.
 *
 * Everything here is a STRUCTURAL read (longevity / share proxy), never a
 * measured UA rate — see the data caveat in design-creatives-roadmap.md.
 */

/** A single hook/motivation's share trajectory across the analyzed weeks. */
export interface TrendSeries {
  /** Hook type or motivation label. */
  label: string;
  /** Share (0–100) of that week's classified items, one entry per `weeks[]`. */
  sharePctByWeek: number[];
  /** Latest week's raw count. */
  latestCount: number;
  /** Latest share (0–100). */
  latestPct: number;
  /** WoW change in share points (latest − previous). null when < 2 weeks. */
  latestDeltaPct: number | null;
}

/** A notable week-over-week mover across hooks + motivations. */
export interface TrendMover {
  label: string;
  kind: 'hook' | 'motivation';
  /** Signed share-point change over the last week. */
  deltaPct: number;
}

export interface CompositionTrend {
  /** Analyzed weeks, ascending (ISO week keys). */
  weeks: string[];
  /** Hook-type series, sorted by latest share desc. */
  hooks: TrendSeries[];
  /** Motivation series (from deep video analyses); empty when no video pass ran. */
  motivations: TrendSeries[];
  /** Up to 3 biggest WoW movers, ranked by |delta|. */
  topMovers: TrendMover[];
  /** True once there are >= 2 analyzed weeks — i.e. real trends exist. */
  hasComposition: boolean;
}

/** One count-by-label snapshot for a single week. */
interface WeekCounts {
  /** label -> count of classified items. */
  counts: Map<string, number>;
  /** Denominator: total classified items that week (share = count / total). */
  total: number;
}

const MIN_MOVE_PCT = 1; // ignore sub-1-point wobble as "movement"

/** Newest-doc-wins dedupe by week, then ascending sort. */
function dedupeByWeek(docs: CreativeInsightDoc[]): CreativeInsightDoc[] {
  const byWeek = new Map<string, CreativeInsightDoc>();
  for (const d of docs) {
    if (!d.week) continue;
    const prev = byWeek.get(d.week);
    if (!prev || generatedMs(d) >= generatedMs(prev)) byWeek.set(d.week, d);
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
}

function generatedMs(d: CreativeInsightDoc): number {
  const g = d.generatedAt;
  if (!g) return 0;
  if (g instanceof Date) return g.getTime();
  if (typeof g === 'object' && 'seconds' in g) return g.seconds * 1000;
  return 0;
}

/** Hook counts for one week from its `creativeTags`. */
function hookCountsForWeek(doc: CreativeInsightDoc): WeekCounts {
  const counts = new Map<string, number>();
  let total = 0;
  for (const t of doc.creativeTags ?? []) {
    if (!t.hookType) continue;
    counts.set(t.hookType, (counts.get(t.hookType) ?? 0) + 1);
    total += 1;
  }
  return { counts, total };
}

/**
 * Motivation counts for one week from its `videoAnalyses`. Denominator is the
 * number of analyzed videos that week, so a motivation's share reads as "% of
 * this week's analyzed winners that lean on it" (an analysis can carry 1–3, so
 * shares don't sum to 100 — that's intended).
 */
function motivationCountsForWeek(doc: CreativeInsightDoc): WeekCounts {
  const counts = new Map<string, number>();
  let total = 0;
  for (const v of doc.videoAnalyses ?? []) {
    total += 1;
    for (const m of new Set(v.motivations ?? [])) {
      counts.set(m, (counts.get(m) ?? 0) + 1);
    }
  }
  return { counts, total };
}

/** Turn per-week counts into per-label share series aligned to `weeks`. */
function toSeries(weekly: WeekCounts[]): TrendSeries[] {
  const labels = new Set<string>();
  for (const w of weekly) for (const k of w.counts.keys()) labels.add(k);

  const out: TrendSeries[] = [];
  for (const label of labels) {
    const sharePctByWeek = weekly.map((w) =>
      w.total > 0 ? Math.round(((w.counts.get(label) ?? 0) / w.total) * 100) : 0,
    );
    const n = sharePctByWeek.length;
    const latestPct = n > 0 ? sharePctByWeek[n - 1] : 0;
    const latestDeltaPct = n >= 2 ? latestPct - sharePctByWeek[n - 2] : null;
    const latestCount = n > 0 ? weekly[n - 1].counts.get(label) ?? 0 : 0;
    out.push({ label, sharePctByWeek, latestCount, latestPct, latestDeltaPct });
  }
  // Latest share first; a label absent from the newest week sinks to the bottom.
  out.sort((a, b) => b.latestPct - a.latestPct || b.latestCount - a.latestCount);
  return out;
}

export function buildCompositionTrend(docs: CreativeInsightDoc[]): CompositionTrend {
  const weekDocs = dedupeByWeek(docs);
  const weeks = weekDocs.map((d) => d.week);

  const hooks = toSeries(weekDocs.map(hookCountsForWeek));
  const motivationWeekly = weekDocs.map(motivationCountsForWeek);
  const anyMotivation = motivationWeekly.some((w) => w.total > 0);
  const motivations = anyMotivation ? toSeries(motivationWeekly) : [];

  const movers: TrendMover[] = [
    ...hooks.map((s) => ({ label: s.label, kind: 'hook' as const, deltaPct: s.latestDeltaPct ?? 0 })),
    ...motivations.map((s) => ({ label: s.label, kind: 'motivation' as const, deltaPct: s.latestDeltaPct ?? 0 })),
  ]
    .filter((m) => Math.abs(m.deltaPct) >= MIN_MOVE_PCT)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 3);

  return { weeks, hooks, motivations, topMovers: movers, hasComposition: weeks.length >= 2 };
}

// ---- Creative fatigue -------------------------------------------------------

export interface FatigueRow {
  docId: string;
  appId: string;
  title: string | null;
  /** durationDays / 7, rounded, floored at 1. */
  weeksLive: number;
  durationDays: number;
  /** Live >= 3 weeks — long enough to be at fatigue risk. */
  fatiguing: boolean;
  score: number | null;
  isFocus: boolean;
}

const WINNER_SCORE = 60;
const FATIGUE_WEEKS = 3;

function weeksLiveFrom(durationDays: number): number {
  return Math.max(1, Math.round(durationDays / 7));
}

/**
 * Longest-running live winners in the current set — the "is this creative going
 * stale?" read. Winners-first (score >= 60); if the set has fewer than 3 scored
 * winners we broaden to everything so the panel is never empty. Cross-app
 * variants (shared `phashionGroup`) collapse to their longest-lived member so a
 * stock video shared by five rivals shows once, not five times.
 */
export function buildFatigue(
  current: JoinedCreative[],
  focusAppId: string,
  limit = 8,
): FatigueRow[] {
  const winners = current.filter((c) => (c.score ?? 0) >= WINNER_SCORE);
  const pool = winners.length >= 3 ? winners : current;

  // Collapse variants: keep the longest-lived member per phashion group.
  const best = new Map<string, JoinedCreative>();
  for (const c of pool) {
    const key = c.phashionGroup ? `ph:${c.phashionGroup}` : `id:${c.docId}`;
    const prev = best.get(key);
    if (!prev || c.durationDays > prev.durationDays) best.set(key, c);
  }

  return [...best.values()]
    .sort((a, b) => b.durationDays - a.durationDays)
    .slice(0, limit)
    .map((c) => {
      const weeksLive = weeksLiveFrom(c.durationDays);
      return {
        docId: c.docId,
        appId: c.appId,
        title: c.title,
        weeksLive,
        durationDays: c.durationDays,
        fatiguing: weeksLive >= FATIGUE_WEEKS,
        score: c.score ?? null,
        isFocus: c.appId === focusAppId,
      };
    });
}
