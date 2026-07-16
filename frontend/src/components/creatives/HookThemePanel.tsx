import { useMemo } from 'react';
import type { CreativeTag, HookType } from '../../types/creatives';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';

export interface HookThemePanelProps {
  /** docId → tag, already joined against this genre's insight doc. */
  tagMap: Map<string, CreativeTag>;
  /** Creatives currently in scope (before hook/theme filters), so counts stay stable while filtering. */
  creatives: JoinedCreative[];
  selectedHookTypes: Set<string>;
  selectedThemes: Set<string>;
  onToggleHookType: (hook: string) => void;
  onToggleTheme: (theme: string) => void;
  hasInsightDoc: boolean;
}

interface HookAgg {
  hookType: HookType;
  count: number;
  avgScore: number | null;
}

interface ThemeAgg {
  theme: string;
  count: number;
}

const HOOK_BAR_COLORS = ['bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500'];

/**
 * Aggregated view of the AI hook/theme classification: which hook types and
 * themes dominate the top creatives in scope. Every row/chip is a filter.
 */
export function HookThemePanel({
  tagMap,
  creatives,
  selectedHookTypes,
  selectedThemes,
  onToggleHookType,
  onToggleTheme,
  hasInsightDoc,
}: HookThemePanelProps) {
  const { hooks, themes, taggedCount } = useMemo(() => {
    const hookCounts = new Map<HookType, { count: number; scoreSum: number; scored: number }>();
    const themeCounts = new Map<string, ThemeAgg>();
    let tagged = 0;

    for (const c of creatives) {
      const tag = tagMap.get(c.docId);
      if (!tag) continue;
      tagged += 1;

      const h = hookCounts.get(tag.hookType) ?? { count: 0, scoreSum: 0, scored: 0 };
      h.count += 1;
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
      }))
      .sort((a, b) => b.count - a.count);

    const themes: ThemeAgg[] = [...themeCounts.values()].sort((a, b) => b.count - a.count).slice(0, 14);

    return { hooks, themes, taggedCount: tagged };
  }, [tagMap, creatives]);

  if (!hasInsightDoc) return null;

  if (taggedCount === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Hooks &amp; themes</h3>
        <p className="text-sm text-gray-500">
          No hook/theme classification for this week yet — run <span className="font-medium">Re-analyze this week</span> to
          tag the top creatives with hook types and themes.
        </p>
      </div>
    );
  }

  const maxHookCount = hooks[0]?.count ?? 1;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Hook types that are working</h3>
        <p className="text-xs text-gray-400 mb-3">
          Across {taggedCount} AI-tagged top creatives · click to filter the gallery
        </p>
        <ul className="space-y-2">
          {hooks.map((h, i) => {
            const on = selectedHookTypes.has(h.hookType);
            return (
              <li key={h.hookType}>
                <button
                  type="button"
                  onClick={() => onToggleHookType(h.hookType)}
                  className={`group w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                    on ? 'bg-blue-50 ring-1 ring-blue-300' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2 text-xs">
                    <span className={`font-medium ${on ? 'text-blue-800' : 'text-gray-800'}`}>{h.hookType}</span>
                    <span className="shrink-0 tabular-nums text-gray-500">
                      {h.count}
                      {h.avgScore != null && <span className="ml-1.5 text-gray-400">avg {h.avgScore}</span>}
                    </span>
                  </span>
                  <span className="mt-1 block h-1.5 w-full rounded-full bg-gray-100">
                    <span
                      className={`block h-1.5 rounded-full ${HOOK_BAR_COLORS[i % HOOK_BAR_COLORS.length]}`}
                      style={{ width: `${Math.max((h.count / maxHookCount) * 100, 6)}%` }}
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Themes</h3>
        <p className="text-xs text-gray-400 mb-3">What the winning ads are about · click to filter</p>
        <div className="flex flex-wrap gap-1.5">
          {themes.map((t) => {
            const on = selectedThemes.has(t.theme.toLowerCase());
            return (
              <button
                key={t.theme.toLowerCase()}
                type="button"
                onClick={() => onToggleTheme(t.theme.toLowerCase())}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  on
                    ? 'border-blue-300 bg-blue-100 text-blue-800'
                    : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                }`}
              >
                {t.theme}
                <span className="tabular-nums text-[10px] text-gray-400">{t.count}</span>
              </button>
            );
          })}
          {themes.length === 0 && <p className="text-sm text-gray-400">No themes tagged.</p>}
        </div>
      </div>
    </div>
  );
}
