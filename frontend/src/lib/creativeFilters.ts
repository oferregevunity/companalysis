import type { CreativeFormat, CreativeTag, HookType, QueryableAdNetwork } from '../types/creatives';
import type { JoinedCreative } from '../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../hooks/useAppNames';

/**
 * The gallery's filter state. Purely presentational — every field is a control
 * surfaced in the redesign's left filter rail, the header, or the band's action
 * cards. Kept as a plain shape (Sets for multi-select groups) so toggling is
 * cheap and stable across the page.
 */
export interface Filters {
  networks: Set<QueryableAdNetwork>;
  formats: Set<CreativeFormat>;
  appIds: Set<string>;
  /** AI hook-type labels. */
  hookTypes: Set<string>;
  /** Lowercased AI theme tags. */
  themes: Set<string>;
  /** Video-length buckets. */
  durationBuckets: Set<string>;
  newThisWeek: boolean;
  winnersOnly: boolean;
  /** Drop the focus game's own creatives from the gallery. */
  hideOwnGame: boolean;
  sort: 'score' | 'duration' | 'firstSeen' | 'sov';
  search: string;
}

export function defaultFilters(): Filters {
  return {
    networks: new Set(),
    formats: new Set(),
    appIds: new Set(),
    hookTypes: new Set(),
    themes: new Set(),
    durationBuckets: new Set(),
    newThisWeek: false,
    winnersOnly: false,
    hideOwnGame: false,
    sort: 'score',
    search: '',
  };
}

export function toggleSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Count of active filter groups/flags — powers the rail's "N active" label. */
export function activeFilterCount(f: Filters): number {
  return (
    (f.search.trim() ? 1 : 0) +
    f.networks.size +
    f.formats.size +
    f.appIds.size +
    f.hookTypes.size +
    f.themes.size +
    f.durationBuckets.size +
    (f.newThisWeek ? 1 : 0) +
    (f.winnersOnly ? 1 : 0) +
    (f.hideOwnGame ? 1 : 0)
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

export interface HookAgg {
  hookType: HookType;
  count: number;
  avgScore: number | null;
  /** Example creatives for this hook (for the band's COPY THIS thumbnails). */
  examples: JoinedCreative[];
}

export interface ThemeAgg {
  theme: string;
  count: number;
}

/**
 * Aggregate the AI hook/theme classification over a set of creatives. Same math
 * the old HookThemePanel used, now shared by the filter rail (Hook/Theme groups)
 * and the band's COPY THIS card. Counts fed from the pre-tag-filter list so they
 * stay stable while filtering.
 */
export function aggregateHooksThemes(
  creatives: JoinedCreative[],
  tagMap: Map<string, CreativeTag>,
): { hooks: HookAgg[]; themes: ThemeAgg[]; taggedCount: number } {
  const hookCounts = new Map<
    HookType,
    { count: number; scoreSum: number; scored: number; examples: JoinedCreative[] }
  >();
  const themeCounts = new Map<string, ThemeAgg>();
  let tagged = 0;

  for (const c of creatives) {
    const tag = tagMap.get(c.docId);
    if (!tag) continue;
    tagged += 1;

    const h = hookCounts.get(tag.hookType) ?? { count: 0, scoreSum: 0, scored: 0, examples: [] };
    h.count += 1;
    if (h.examples.length < 8) h.examples.push(c);
    if (c.score != null) {
      h.scoreSum += c.score;
      h.scored += 1;
    }
    hookCounts.set(tag.hookType, h);

    for (const raw of tag.themes) {
      const key = raw.trim().toLowerCase();
      if (!key) continue;
      const t = themeCounts.get(key) ?? { theme: raw.trim(), count: 0 };
      t.count += 1;
      themeCounts.set(key, t);
    }
  }

  const hooks: HookAgg[] = [...hookCounts.entries()]
    .map(([hookType, v]) => ({
      hookType,
      count: v.count,
      avgScore: v.scored > 0 ? Math.round(v.scoreSum / v.scored) : null,
      examples: v.examples,
    }))
    .sort((a, b) => b.count - a.count);

  const themes: ThemeAgg[] = [...themeCounts.values()].sort((a, b) => b.count - a.count);

  return { hooks, themes, taggedCount: tagged };
}
