import { useMemo } from 'react';
import { useMarketPulse } from '../../hooks/useMarketPulse';
import type { RisingConcept } from '../../types/creatives';

export interface MarketPulsePanelProps {
  /** Hook types present in the focus app's own creatives (from its workspace tags). */
  focusHookTypes: Set<string>;
  /** Lowercased themes present in the focus app's own creatives. */
  focusThemes: Set<string>;
}

/** True when the focus app isn't already running this concept. */
function isMissing(c: RisingConcept, focusHooks: Set<string>, focusThemes: Set<string>): boolean {
  if (c.kind === 'hook') return !focusHooks.has(c.label);
  return !focusThemes.has(c.label.toLowerCase());
}

export function MarketPulsePanel({ focusHookTypes, focusThemes }: MarketPulsePanelProps) {
  const { data, loading } = useMarketPulse();

  const concepts = useMemo(() => {
    if (!data) return [];
    // Concepts you're missing lead; then by WoW growth (new first), capped.
    return [...data.risingConcepts]
      .map((c) => ({ c, missing: isMissing(c, focusHookTypes, focusThemes) }))
      .sort((a, b) => {
        if (a.missing !== b.missing) return a.missing ? -1 : 1;
        if (a.c.isNew !== b.c.isNew) return a.c.isNew ? -1 : 1;
        return (b.c.wowGrowthPct ?? 0) - (a.c.wowGrowthPct ?? 0);
      })
      .slice(0, 6);
  }, [data, focusHookTypes, focusThemes]);

  if (loading || !data || data.risingConcepts.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Rising across the market</h3>
        <span className="text-[11px] text-gray-400">
          Week {data.week} · {data.genresScanned.length} genres scanned
        </span>
      </div>
      <p className="mb-3 text-xs text-gray-400">
        Concepts growing week-over-week across genres · <span className="text-red-600">red</span> = missing from your ads
      </p>

      {data.note && <p className="mb-3 text-xs text-amber-700">{data.note}</p>}

      <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {concepts.map(({ c, missing }) => (
          <li
            key={`${c.kind}:${c.label}`}
            className={`rounded-lg border p-3 ${missing ? 'border-red-200 bg-red-50/40' : 'border-gray-200'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold text-gray-900">{c.title}</span>
              <span className="shrink-0">
                {c.isNew ? (
                  <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    NEW
                  </span>
                ) : c.wowGrowthPct != null ? (
                  <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
                    +{c.wowGrowthPct}%
                  </span>
                ) : null}
              </span>
            </div>
            {c.description && <p className="mt-1 text-xs text-gray-600">{c.description}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium capitalize text-gray-600">
                {c.kind}
              </span>
              <span className="text-[10px] text-gray-400">{c.genresSeenIn.length} genres</span>
              {missing && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                  Missing from your ads
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
