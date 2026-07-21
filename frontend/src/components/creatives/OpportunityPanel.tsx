import { useMemo } from 'react';
import type { QueryableAdNetwork } from '../../types/creatives';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import { useMarketOpportunity } from '../../hooks/useMarketOpportunity';
import type { CountryPresence, MarketApp, OsPresence } from '../../lib/creativesApi';

export interface OpportunityPanelProps {
  creatives: JoinedCreative[];
  focusAppId: string;
  /** Focus + selected competitors, with store ids, for the on-demand market fetch. */
  marketApps: MarketApp[];
  /** Sensor Tower game category id for the focus app; null disables country/OS lookup. */
  category: string | null;
  /** Android category slug for the OS split; null skips the Android market row. */
  androidCategory: string | null;
  primaryCountry: string;
  appNames: Map<string, AppNameMapEntry>;
  selectedNetworks: Set<QueryableAdNetwork>;
  onToggleNetwork: (n: QueryableAdNetwork) => void;
}

interface NetGap {
  network: QueryableAdNetwork;
  compCount: number;
  compGames: number;
  focusCount: number;
}

function money(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
  return `$${v}`;
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

export function OpportunityPanel({
  creatives,
  focusAppId,
  marketApps,
  category,
  androidCategory,
  primaryCountry,
  appNames,
  selectedNetworks,
  onToggleNetwork,
}: OpportunityPanelProps) {
  const { data, loading, error, run } = useMarketOpportunity(focusAppId);

  const networks = useMemo(() => {
    const map = new Map<QueryableAdNetwork, { comp: number; games: Set<string>; focus: number }>();
    for (const c of creatives) {
      for (const n of c.networks) {
        const e = map.get(n) ?? { comp: 0, games: new Set<string>(), focus: 0 };
        if (c.appId === focusAppId) e.focus += 1;
        else {
          e.comp += 1;
          e.games.add(c.appId);
        }
        map.set(n, e);
      }
    }
    const rows: NetGap[] = [...map.entries()].map(([network, e]) => ({
      network,
      compCount: e.comp,
      compGames: e.games.size,
      focusCount: e.focus,
    }));
    // Gaps first (competitors active, you absent), then by competitor volume.
    return rows.sort((a, b) => {
      const ag = a.focusCount === 0 && a.compGames >= 2 ? 1 : 0;
      const bg = b.focusCount === 0 && b.compGames >= 2 ? 1 : 0;
      if (ag !== bg) return bg - ag;
      return b.compCount - a.compCount;
    });
  }, [creatives, focusAppId]);

  const hasComp = creatives.some((c) => c.appId !== focusAppId);
  if (!hasComp) return null;

  const maxNet = networks[0]?.compCount ?? 1;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Networks, countries &amp; OS you're missing</h3>
        <span className="text-[11px] text-gray-400">
          Countries/OS = store revenue (market presence), not creative or first-party data
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Networks — instant, from the creatives already loaded. */}
        <div>
          <h4 className="mb-1 text-xs font-semibold text-gray-800">Ad networks</h4>
          <p className="mb-2 text-[11px] text-gray-400">Competitor creatives per network · click to filter</p>
          <ul className="space-y-1.5">
            {networks.map((r) => {
              const gap = r.focusCount === 0 && r.compGames >= 2;
              const on = selectedNetworks.has(r.network);
              return (
                <li key={r.network}>
                  <button
                    type="button"
                    onClick={() => onToggleNetwork(r.network)}
                    className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors ${
                      on ? 'bg-blue-50 ring-1 ring-blue-300' : gap ? 'bg-amber-50/60 hover:bg-amber-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-gray-800">{r.network}</span>
                      <span className="flex items-center gap-1.5">
                        <span className="tabular-nums text-gray-500">
                          {r.compCount} · {r.compGames} games
                        </span>
                        {r.focusCount === 0 ? (
                          <span className="shrink-0 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-100">
                            You: 0
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] font-medium text-gray-400">You: {r.focusCount}</span>
                        )}
                      </span>
                    </span>
                    <span className="mt-1 block h-1.5 w-full rounded-full bg-gray-100">
                      <span
                        className="block h-1.5 rounded-full bg-sky-500"
                        style={{ width: `${Math.max((r.compCount / maxNet) * 100, 6)}%` }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Countries + OS — on-demand market data. */}
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-gray-800">Countries &amp; OS (market)</h4>
            <button
              type="button"
              disabled={loading || !category || marketApps.length === 0}
              onClick={() => category && run(marketApps, category, androidCategory, primaryCountry)}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              title={category ? 'Fetch competitor revenue by country & OS from Sensor Tower' : 'No game category for this app'}
            >
              {loading ? 'Fetching…' : data ? 'Refresh' : 'Find country/OS gaps'}
            </button>
          </div>

          {error && <p className="mb-2 text-[11px] text-red-600">{error}</p>}
          {!data && !loading && (
            <p className="text-xs text-gray-400">
              {category
                ? 'Find markets where competitors earn well and you’re weak or absent.'
                : 'Country/OS lookup needs a game category — unavailable for this app.'}
            </p>
          )}

          {data && (
            <div className="space-y-3">
              <CountryList rows={data.byCountry} appNames={appNames} />
              <OsList rows={data.byOs} />
              <p className="text-[10px] text-gray-400">Last {data.month} · top-500 by revenue per market.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CountryList({ rows, appNames }: { rows: CountryPresence[]; appNames: Map<string, AppNameMapEntry> }) {
  const top = rows.filter((r) => r.competitorRevenue > 0).slice(0, 8);
  if (top.length === 0) return <p className="text-xs text-gray-400">No competitor market data returned.</p>;
  return (
    <ul className="space-y-1">
      {top.map((r) => {
        const gap = r.focusRevenue === 0;
        const lead = r.topCompetitors[0];
        const leadName = lead ? appNames.get(lead.appId)?.name ?? lead.appId : null;
        return (
          <li
            key={r.country}
            className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs ${
              gap ? 'bg-amber-50/60' : ''
            }`}
          >
            <span className="flex items-center gap-2">
              <span className="font-semibold text-gray-800">{r.country}</span>
              {leadName && <span className="max-w-[120px] truncate text-[11px] text-gray-400">{leadName}</span>}
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              <span className="text-gray-600">{money(r.competitorRevenue)}/mo</span>
              {gap ? (
                <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 ring-1 ring-red-100">
                  You: 0
                </span>
              ) : (
                <span className="text-[10px] text-gray-400">you {pct(r.focusShare)}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function OsList({ rows }: { rows: OsPresence[] }) {
  return (
    <div className="flex gap-2">
      {rows.map((r) => {
        const gap = r.focusRevenue === 0 && r.competitorRevenue > 0;
        return (
          <div
            key={r.os}
            className={`flex-1 rounded-lg border px-2.5 py-1.5 ${gap ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200'}`}
          >
            <div className="text-xs font-semibold capitalize text-gray-800">{r.os}</div>
            <div className="text-[11px] text-gray-500">
              Competitors {money(r.competitorRevenue)}/mo
            </div>
            <div className="text-[11px] text-gray-400">
              You {r.focusRevenue === 0 ? '0' : `${money(r.focusRevenue)} (${pct(r.focusShare)})`}
            </div>
          </div>
        );
      })}
    </div>
  );
}
