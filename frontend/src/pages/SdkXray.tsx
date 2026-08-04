import { useMemo, useState } from 'react';
import { useXrayReports } from '../hooks/useXrayReports';
import { useXrayIntegrations } from '../hooks/useXrayIntegrations';
import { XrayTeardownModal } from '../components/xray/XrayTeardownModal';
import { AppDetailModal } from '../components/transfers/AppDetailModal';
import { compactNumber, formatCount, formatDate, relativeFromNow } from '../lib/appStoreFormat';
import {
  crossFacet,
  filterAndSortRows,
  isEnriched,
  publisherBreakdown,
  type XraySort,
} from '../lib/xrayRank';
import type { XrayDimension, XrayFacetBucket, XrayReportRow } from '../types/xray';

const PAGE_SIZE = 50;

const DIMENSIONS: { key: XrayDimension; label: string; blurb: string }[] = [
  { key: 'mediator', label: 'Mediation', blurb: 'Which ad mediation stack each game ships' },
  { key: 'publisherSdk', label: 'Publisher SDK', blurb: 'Publisher SDKs found in the binary' },
  { key: 'engine', label: 'Engine', blurb: 'Game engine and version' },
];

const SORTS: { key: XraySort; label: string }[] = [
  { key: 'popularity', label: 'Most rated' },
  { key: 'installs', label: 'Most installs (Play)' },
  { key: 'rank', label: 'Best chart rank' },
  { key: 'sdkCount', label: 'Most SDKs' },
  { key: 'recent', label: 'Newest teardown' },
  { key: 'name', label: 'Name' },
];

function StoreBadge({ store }: { store: string }) {
  const isPlay = store === 'GooglePlay';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ${
        isPlay ? 'bg-[#e6f4ea] text-[#137333]' : 'bg-[#e8f0fe] text-[#1a73e8]'
      }`}
    >
      {isPlay ? 'Play' : 'iOS'}
    </span>
  );
}

/** One row in the facet rail: label, share bar, count. */
function FacetRow({
  bucket,
  active,
  onClick,
}: {
  bucket: XrayFacetBucket;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors ${
        active ? 'bg-primary-50' : 'hover:bg-[#f1f3f4]'
      }`}
      title={`${bucket.label} · iOS ${bucket.appStoreCount} / Play ${bucket.googlePlayCount}${
        bucket.topVariants.length ? ` · ${bucket.topVariants.map((v) => `${v.label} ×${v.count}`).join(', ')}` : ''
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            active ? 'font-semibold text-primary-700' : 'font-medium text-[#202124]'
          }`}
        >
          {bucket.label}
        </span>
        <span className="shrink-0 text-[12px] tabular-nums text-[#5f6368]">{bucket.count}</span>
        <span className="w-[38px] shrink-0 text-right text-[11px] tabular-nums text-[#9aa0a6]">
          {bucket.sharePct}%
        </span>
      </div>
      <div className="mt-1 h-[3px] w-full overflow-hidden rounded-full bg-[#f1f3f4]">
        <div
          className={active ? 'h-[3px] rounded-full bg-primary-600' : 'h-[3px] rounded-full bg-[#bdc1c6]'}
          style={{ width: `${Math.max(bucket.sharePct, 1)}%` }}
        />
      </div>
    </button>
  );
}

function Chips({ items, tone = 'neutral' }: { items: { label: string; count: number }[]; tone?: 'neutral' | 'blue' }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <span
          key={i.label}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${
            tone === 'blue'
              ? 'border-[#d2e3fc] bg-[#e8f0fe] text-[#1967d2]'
              : 'border-[#e8eaed] bg-[#f8f9fa] text-[#5f6368]'
          }`}
        >
          {i.label}
          <span className="tabular-nums text-[#9aa0a6]">{i.count}</span>
        </span>
      ))}
    </div>
  );
}

export default function SdkXray() {
  const { rows, facets, loading, error, enrich } = useXrayReports();
  const integrations = useXrayIntegrations();

  const [dimension, setDimension] = useState<XrayDimension>('mediator');
  const [facetKey, setFacetKey] = useState<string | null>(null);
  const [store, setStore] = useState<'all' | 'AppStore' | 'GooglePlay'>('all');
  const [search, setSearch] = useState('');
  const [minSdkCount, setMinSdkCount] = useState(0);
  const [enrichedOnly, setEnrichedOnly] = useState(false);
  const [sort, setSort] = useState<XraySort>('popularity');
  const [page, setPage] = useState(0);
  const [openRow, setOpenRow] = useState<XrayReportRow | null>(null);
  const [openAppStoreId, setOpenAppStoreId] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  const buckets = facets ? facets[dimension] : [];

  const filtered = useMemo(
    () =>
      filterAndSortRows(
        rows,
        { dimension, facetKey, store, search, minSdkCount, enrichedOnly, integrationKeys: integrations.keys },
        sort,
      ),
    [rows, dimension, facetKey, store, search, minSdkCount, enrichedOnly, integrations.keys, sort],
  );

  const visible = filtered.slice(0, (page + 1) * PAGE_SIZE);
  const activeBucket = buckets.find((b) => b.key === facetKey) ?? null;
  const publishers = useMemo(() => publisherBreakdown(filtered), [filtered]);
  const otherDimensions = DIMENSIONS.filter((d) => d.key !== dimension);
  const enrichedCount = useMemo(() => rows.filter(isEnriched).length, [rows]);
  const missing = useMemo(() => visible.filter((r) => !isEnriched(r)).map((r) => r.storeId), [visible]);

  function pick(dim: XrayDimension) {
    setDimension(dim);
    setFacetKey(null);
    setPage(0);
  }

  async function loadPopularity() {
    setEnriching(true);
    setEnrichError(null);
    try {
      await enrich(missing.slice(0, 60));
    } catch (err) {
      setEnrichError(err instanceof Error ? err.message : 'Failed to load popularity');
    } finally {
      setEnriching(false);
    }
  }

  return (
    <div className="max-w-[1240px]">
      <div className="mb-1 flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e8f0fe] text-[18px]">⚡</div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-[#202124]">SDK X-Ray</h1>
      </div>
      <p className="mb-5 text-[13px] text-[#5f6368]">
        Which SDKs the games in our space actually ship, from AppBird binary teardowns
        {facets ? ` · ${formatCount(facets.totalReports)} games torn down` : ''}
        {enrichedCount > 0 ? ` · ${formatCount(enrichedCount)} ranked by store popularity` : ''}.
      </p>

      {/* Dimension tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-[#dadce0]">
          {DIMENSIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => pick(d.key)}
              className={`h-9 px-3.5 text-[12px] font-medium transition-colors ${
                dimension === d.key ? 'bg-[#202124] text-white' : 'bg-white text-[#5f6368] hover:bg-[#f1f3f4]'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-[#9aa0a6]">{DIMENSIONS.find((d) => d.key === dimension)?.blurb}</span>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[#dadce0] bg-white p-10 text-center text-[13px] text-[#5f6368]">
          Loading X-Ray corpus…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[#dadce0] bg-white p-10 text-center text-[13px] text-[#c5221f]">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[#dadce0] bg-white p-10 text-center text-[13px] text-[#5f6368]">
          No teardowns yet. Run the X-Ray sync (<code className="text-[12px]">xray/run</code>) to populate the corpus.
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Facet rail */}
          <aside className="w-full shrink-0 lg:w-[268px]">
            <div className="rounded-xl border border-[#dadce0] bg-white p-2">
              <button
                type="button"
                onClick={() => {
                  setFacetKey(null);
                  setPage(0);
                }}
                className={`mb-1 w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
                  facetKey === null ? 'bg-primary-50 text-primary-700' : 'text-[#202124] hover:bg-[#f1f3f4]'
                }`}
              >
                All groups
                <span className="ml-2 text-[12px] tabular-nums text-[#9aa0a6]">{rows.length}</span>
              </button>
              <div className="max-h-[560px] space-y-0.5 overflow-y-auto">
                {buckets.map((b) => (
                  <FacetRow
                    key={b.key}
                    bucket={b}
                    active={facetKey === b.key}
                    onClick={() => {
                      setFacetKey(b.key === facetKey ? null : b.key);
                      setPage(0);
                    }}
                  />
                ))}
              </div>
            </div>
          </aside>

          {/* Games */}
          <div className="min-w-0 flex-1 space-y-3">
            {/* Selection summary */}
            <div className="rounded-xl border border-[#dadce0] bg-white p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[15px] font-semibold text-[#202124]">
                  {activeBucket ? activeBucket.label : 'All groups'}
                </h2>
                <span className="text-[12px] text-[#5f6368]">
                  {formatCount(filtered.length)} game{filtered.length === 1 ? '' : 's'}
                  {activeBucket ? ` · ${activeBucket.sharePct}% of the corpus` : ''}
                </span>
                {activeBucket && activeBucket.topVariants.length > 0 && (
                  <span className="text-[11px] text-[#9aa0a6]">
                    variants: {activeBucket.topVariants.map((v) => `${v.label} ×${v.count}`).join(', ')}
                  </span>
                )}
              </div>

              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-[92px] shrink-0 text-[11px] uppercase tracking-[0.05em] text-[#9aa0a6]">
                    Publishers
                  </span>
                  <Chips items={publishers} />
                </div>
                {otherDimensions.map((d) => (
                  <div key={d.key} className="flex flex-wrap items-center gap-2">
                    <span className="w-[92px] shrink-0 text-[11px] uppercase tracking-[0.05em] text-[#9aa0a6]">
                      {d.label}
                    </span>
                    <Chips items={crossFacet(filtered, d.key)} tone="blue" />
                  </div>
                ))}
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder="Search game, publisher, SDK…"
                className="h-9 w-56 rounded-lg border border-[#dadce0] px-3 text-[13px] focus:border-primary-500 focus:outline-none"
              />
              {integrations.options.length > 0 && (
                <select
                  value={integrations.selected ?? ''}
                  onChange={(e) => {
                    setPage(0);
                    void integrations.resolve(e.target.value || null);
                  }}
                  disabled={integrations.resolving}
                  className="h-9 max-w-[220px] rounded-lg border border-[#dadce0] bg-white px-2.5 text-[13px] text-[#5f6368] focus:border-primary-500 focus:outline-none disabled:opacity-50"
                  title="Show only games shipping a specific SDK or ad network"
                >
                  <option value="">Any integration</option>
                  {integrations.options.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.label}
                      {i.appCount !== null ? ` (${i.appCount})` : ''}
                    </option>
                  ))}
                </select>
              )}
              <div className="inline-flex overflow-hidden rounded-lg border border-[#dadce0]">
                {(['all', 'AppStore', 'GooglePlay'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setStore(s);
                      setPage(0);
                    }}
                    className={`h-9 px-3 text-[12px] font-medium transition-colors ${
                      store === s ? 'bg-[#202124] text-white' : 'bg-white text-[#5f6368] hover:bg-[#f1f3f4]'
                    }`}
                  >
                    {s === 'all' ? 'All' : s === 'AppStore' ? 'App Store' : 'Google Play'}
                  </button>
                ))}
              </div>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as XraySort)}
                className="h-9 rounded-lg border border-[#dadce0] bg-white px-2.5 text-[13px] text-[#5f6368] focus:border-primary-500 focus:outline-none"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <select
                value={minSdkCount}
                onChange={(e) => {
                  setMinSdkCount(Number(e.target.value));
                  setPage(0);
                }}
                className="h-9 rounded-lg border border-[#dadce0] bg-white px-2.5 text-[13px] text-[#5f6368] focus:border-primary-500 focus:outline-none"
              >
                {[0, 15, 25, 35].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? 'Any SDK count' : `${n}+ SDKs`}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-[12px] text-[#5f6368]">
                <input
                  type="checkbox"
                  checked={enrichedOnly}
                  onChange={(e) => {
                    setEnrichedOnly(e.target.checked);
                    setPage(0);
                  }}
                />
                Ranked only
              </label>
              {missing.length > 0 && (
                <button
                  type="button"
                  onClick={() => void loadPopularity()}
                  disabled={enriching}
                  className="h-9 rounded-lg border border-[#dadce0] bg-white px-2.5 text-[12px] font-medium text-[#5f6368] hover:bg-[#f1f3f4] disabled:opacity-50"
                  title="Fetch installs and rating counts from AppBird for the rows on screen"
                >
                  {enriching ? 'Loading popularity…' : `Rank ${Math.min(missing.length, 60)} more`}
                </button>
              )}
              {enrichError && <span className="text-[12px] text-[#c5221f]">{enrichError}</span>}
            </div>

            {/* Integration filter status. Membership is fetched per integration and
                cached server-side, so the state worth surfacing is whether the set is
                complete and how fresh it is. */}
            {integrations.resolving && (
              <div className="text-[12px] text-[#5f6368]">Resolving integration membership…</div>
            )}
            {integrations.error && <div className="text-[12px] text-[#c5221f]">{integrations.error}</div>}
            {integrations.optionsError && (
              <div className="text-[12px] text-[#c5221f]">
                Integration list unavailable: {integrations.optionsError}
              </div>
            )}
            {!integrations.resolving && integrations.membership && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[#f1f3f4] px-3 py-2 text-[12px] text-[#5f6368]">
                <span className="font-medium text-[#202124]">{integrations.membership.integration}</span>
                <span>
                  {formatCount(integrations.membership.apps.length)} of{' '}
                  {formatCount(integrations.membership.total)} apps
                </span>
                {integrations.membership.fetchedAt && (
                  <span className="text-[#9aa0a6]">
                    · resolved {relativeFromNow(integrations.membership.fetchedAt)}
                    {integrations.membership.fromCache ? ' (cached)' : ''}
                  </span>
                )}
                {integrations.membership.partial && (
                  <>
                    <span className="text-[#9aa0a6]">
                      · capped to keep the request cost down
                    </span>
                    <button
                      type="button"
                      onClick={() => void integrations.loadAll()}
                      className="h-7 rounded-md border border-[#dadce0] bg-white px-2 text-[11px] font-medium text-[#5f6368] hover:bg-white/60"
                      title="Fetch the remaining pages from AppBird. Costs additional requests."
                    >
                      Load all {formatCount(integrations.membership.total)}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Table */}
            <div className="overflow-hidden rounded-xl border border-[#dadce0] bg-white">
              {filtered.length === 0 ? (
                <div className="p-10 text-center text-[13px] text-[#5f6368]">No games match these filters.</div>
              ) : (
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-[#e8eaed] text-[11px] uppercase tracking-[0.04em] text-[#9aa0a6]">
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-2 py-2 font-medium">Game</th>
                      <th className="px-2 py-2 font-medium">Publisher</th>
                      <th className="px-2 py-2 text-right font-medium">Ratings</th>
                      <th className="px-2 py-2 text-right font-medium">Installs</th>
                      <th className="px-2 py-2 font-medium">
                        {dimension === 'mediator' ? 'Publisher SDK' : 'Mediation'}
                      </th>
                      <th className="px-2 py-2 font-medium">{dimension === 'engine' ? 'Mediation' : 'Engine'}</th>
                      <th className="px-2 py-2 text-right font-medium">SDKs</th>
                      <th className="px-3 py-2 text-right font-medium">Torn down</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r, i) => (
                      <tr
                        key={r.reportId}
                        onClick={() => setOpenRow(r)}
                        className="group cursor-pointer border-b border-[#f1f3f4] last:border-b-0 hover:bg-[#f8f9fa]"
                      >
                        <td className="px-3 py-2 text-[12px] tabular-nums text-[#9aa0a6]">{i + 1}</td>
                        <td className="max-w-[260px] px-2 py-2">
                          <div className="flex items-center gap-2">
                            {r.popularity?.iconUrl ? (
                              <img src={r.popularity.iconUrl} alt="" loading="lazy" className="h-7 w-7 rounded-md object-cover" />
                            ) : (
                              <div className="h-7 w-7 rounded-md bg-[#f1f3f4]" />
                            )}
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-medium text-[#202124]" title={r.appName}>
                                  {r.appName}
                                </span>
                                <StoreBadge store={r.store} />
                              </span>
                              {r.popularity?.bestRank != null && (
                                <span className="text-[11px] text-[#9aa0a6]">#{r.popularity.bestRank} in category</span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="max-w-[130px] px-2 py-2">
                          <span className="block truncate text-[12px] text-[#5f6368]" title={r.publisher ?? ''}>
                            {r.publisher ?? '—'}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right text-[12px] tabular-nums text-[#202124]">
                          {isEnriched(r) ? compactNumber(r.popularity?.numberVoters ?? 0) : <span className="text-[#c4c7c5]">—</span>}
                        </td>
                        <td className="px-2 py-2 text-right text-[12px] tabular-nums text-[#5f6368]">
                          {r.store === 'GooglePlay' && (r.popularity?.installs ?? 0) > 0
                            ? compactNumber(r.popularity?.installs ?? 0)
                            : <span className="text-[#c4c7c5]">—</span>}
                        </td>
                        <td className="max-w-[150px] px-2 py-2">
                          <span
                            className="block truncate text-[12px] text-[#5f6368]"
                            title={(dimension === 'mediator' ? r.publisherSdk : r.mediator) ?? ''}
                          >
                            {(dimension === 'mediator' ? r.publisherSdkLabel : r.mediatorLabel) || '—'}
                          </span>
                        </td>
                        <td className="max-w-[130px] px-2 py-2">
                          <span
                            className="block truncate text-[12px] text-[#5f6368]"
                            title={(dimension === 'engine' ? r.mediator : r.engine) ?? ''}
                          >
                            {dimension === 'engine'
                              ? r.mediatorLabel || '—'
                              : `${r.engineLabel}${r.engineVersion ? ` ${r.engineVersion}` : ''}`}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right text-[12px] tabular-nums text-[#5f6368]">
                          {r.sdkCount}
                          <span className="text-[#c4c7c5]"> / {r.adNetworkCount}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-[12px] text-[#9aa0a6]" title={formatDate(r.teardownDate)}>
                          {relativeFromNow(r.teardownDate, 'short')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex items-center gap-3">
              {visible.length < filtered.length && (
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-[12px] font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
                >
                  Show {Math.min(PAGE_SIZE, filtered.length - visible.length)} more
                </button>
              )}
              <p className="text-[12px] text-[#9aa0a6]">
                Showing {visible.length} of {formatCount(filtered.length)}. SDKs / ad networks per game;
                ratings and installs come from the store listing, not from the teardown.
              </p>
            </div>
          </div>
        </div>
      )}

      <XrayTeardownModal
        row={openRow}
        onClose={() => setOpenRow(null)}
        onOpenApp={(storeId) => {
          setOpenRow(null);
          setOpenAppStoreId(storeId);
        }}
      />
      <AppDetailModal storeId={openAppStoreId} onClose={() => setOpenAppStoreId(null)} transfers={[]} />
    </div>
  );
}
