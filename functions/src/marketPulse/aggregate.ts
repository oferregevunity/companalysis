/**
 * Cross-genre "Market Pulse" aggregation. Reads the per-genre creative-insight
 * hook/theme tags for the latest week and the prior week, then computes which
 * concepts are RISING week-over-week across the whole scanned market. Pure
 * functions — unit-testable without Firestore or Gemini.
 *
 * The per-creative `impressionMomentum` sub-score is ~0 (only one week is
 * stored per creative), so "rising" has to come from comparing weekly
 * aggregates, which is exactly what this module does.
 */

/** One creative's hook/theme classification (mirrors `CreativeTag`). */
export interface PulseTag {
  creativeId: string;
  hookType: string;
  themes: string[];
}

/** One scanned genre's tags for a single week. */
export interface GenreWeekTags {
  genreId: string;
  tags: PulseTag[];
}

export interface WeekAggregate {
  totalTags: number;
  hookCounts: Map<string, number>;
  themeCounts: Map<string, number>;
  hookExamples: Map<string, string[]>;
  themeExamples: Map<string, string[]>;
  hookGenres: Map<string, Set<string>>;
  themeGenres: Map<string, Set<string>>;
}

function add<K>(m: Map<K, number>, k: K, n = 1) {
  m.set(k, (m.get(k) ?? 0) + n);
}
function push(m: Map<string, string[]>, k: string, v: string, cap = 6) {
  const arr = m.get(k) ?? [];
  if (arr.length < cap && !arr.includes(v)) arr.push(v);
  m.set(k, arr);
}
function addTo(m: Map<string, Set<string>>, k: string, v: string) {
  const s = m.get(k) ?? new Set<string>();
  s.add(v);
  m.set(k, s);
}

/** Fold a week's per-genre tags into hook/theme counts + example creatives + genre coverage. */
export function aggregateWeek(genres: GenreWeekTags[]): WeekAggregate {
  const agg: WeekAggregate = {
    totalTags: 0,
    hookCounts: new Map(),
    themeCounts: new Map(),
    hookExamples: new Map(),
    themeExamples: new Map(),
    hookGenres: new Map(),
    themeGenres: new Map(),
  };
  for (const g of genres) {
    for (const t of g.tags) {
      agg.totalTags += 1;
      add(agg.hookCounts, t.hookType);
      push(agg.hookExamples, t.hookType, t.creativeId);
      addTo(agg.hookGenres, t.hookType, g.genreId);
      for (const raw of t.themes) {
        const theme = raw.trim().toLowerCase();
        if (!theme) continue;
        add(agg.themeCounts, theme);
        push(agg.themeExamples, theme, t.creativeId);
        addTo(agg.themeGenres, theme, g.genreId);
      }
    }
  }
  return agg;
}

export interface RisingCluster {
  kind: 'hook' | 'theme';
  label: string;
  count: number;
  prevCount: number;
  /** null when prevCount is 0 (a genuinely new concept this week). */
  wowGrowthPct: number | null;
  isNew: boolean;
  exampleCreativeIds: string[];
  genresSeenIn: string[];
}

export interface HookShare {
  hookType: string;
  count: number;
  share: number;
  wowDelta: number | null;
}
export interface ThemeShare {
  theme: string;
  count: number;
  wowDelta: number | null;
}

function growthPct(now: number, prev: number): number | null {
  if (prev <= 0) return null;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

/**
 * Rank rising clusters: genuinely-new concepts (prev 0) with real volume first,
 * then by WoW growth %, then by absolute count. `minCount` filters out noise.
 */
function risingFrom(
  kind: 'hook' | 'theme',
  counts: Map<string, number>,
  prev: Map<string, number>,
  examples: Map<string, string[]>,
  genres: Map<string, Set<string>>,
  minCount: number,
): RisingCluster[] {
  const out: RisingCluster[] = [];
  for (const [label, count] of counts) {
    if (count < minCount) continue;
    const prevCount = prev.get(label) ?? 0;
    const pct = growthPct(count, prevCount);
    const isNew = prevCount === 0;
    // Only surface things that actually grew (or are new).
    if (!isNew && (pct == null || pct <= 0)) continue;
    out.push({
      kind,
      label,
      count,
      prevCount,
      wowGrowthPct: pct,
      isNew,
      exampleCreativeIds: (examples.get(label) ?? []).slice(0, 4),
      genresSeenIn: [...(genres.get(label) ?? [])],
    });
  }
  return out.sort((a, b) => {
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    const ap = a.wowGrowthPct ?? Number.POSITIVE_INFINITY;
    const bp = b.wowGrowthPct ?? Number.POSITIVE_INFINITY;
    if (ap !== bp) return bp - ap;
    return b.count - a.count;
  });
}

export interface RisingResult {
  clusters: RisingCluster[];
  topHooks: HookShare[];
  topThemes: ThemeShare[];
}

/**
 * Compare this week's aggregate to the prior week's and return rising clusters
 * plus the current top hooks/themes (with WoW share/count deltas).
 */
export function computeRising(
  thisWeek: WeekAggregate,
  prevWeek: WeekAggregate,
  opts: { minHookCount?: number; minThemeCount?: number; maxClusters?: number } = {},
): RisingResult {
  const minHookCount = opts.minHookCount ?? 3;
  const minThemeCount = opts.minThemeCount ?? 3;
  const maxClusters = opts.maxClusters ?? 8;

  const hookClusters = risingFrom(
    'hook',
    thisWeek.hookCounts,
    prevWeek.hookCounts,
    thisWeek.hookExamples,
    thisWeek.hookGenres,
    minHookCount,
  );
  const themeClusters = risingFrom(
    'theme',
    thisWeek.themeCounts,
    prevWeek.themeCounts,
    thisWeek.themeExamples,
    thisWeek.themeGenres,
    minThemeCount,
  );

  // Interleave hooks + themes, keeping the strongest of each, capped.
  const clusters = [...hookClusters, ...themeClusters]
    .sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      const ap = a.wowGrowthPct ?? Number.POSITIVE_INFINITY;
      const bp = b.wowGrowthPct ?? Number.POSITIVE_INFINITY;
      if (ap !== bp) return bp - ap;
      return b.count - a.count;
    })
    .slice(0, maxClusters);

  const prevShare = (label: string) =>
    prevWeek.totalTags > 0 ? (prevWeek.hookCounts.get(label) ?? 0) / prevWeek.totalTags : 0;

  const topHooks: HookShare[] = [...thisWeek.hookCounts.entries()]
    .map(([hookType, count]) => {
      const share = thisWeek.totalTags > 0 ? count / thisWeek.totalTags : 0;
      const prev = prevShare(hookType);
      return {
        hookType,
        count,
        share: Math.round(share * 1000) / 1000,
        wowDelta: prevWeek.totalTags > 0 ? Math.round((share - prev) * 1000) / 1000 : null,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topThemes: ThemeShare[] = [...thisWeek.themeCounts.entries()]
    .map(([theme, count]) => ({
      theme,
      count,
      wowDelta:
        prevWeek.totalTags > 0 ? count - (prevWeek.themeCounts.get(theme) ?? 0) : null,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return { clusters, topHooks, topThemes };
}
