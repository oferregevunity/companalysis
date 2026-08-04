import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatDate, storeLabel, storeUrl } from '../../lib/appStoreFormat';
import type { XrayDetailItem, XrayReportRow, XrayTeardown } from '../../types/xray';

export interface XrayTeardownModalProps {
  /** The row the user clicked; null closes the modal. */
  row: XrayReportRow | null;
  onClose: () => void;
  /** Open the AppBird store listing for this app (the app-details screen). */
  onOpenApp?: (storeId: string) => void;
}

const CARD = 'bg-white rounded-xl border border-[#dadce0]';

function StoreBadge({ store }: { store: string }) {
  const isPlay = store === 'GooglePlay';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold ${
        isPlay ? 'bg-[#e6f4ea] text-[#137333]' : 'bg-[#e8f0fe] text-[#1a73e8]'
      }`}
      title={storeLabel(store)}
    >
      {isPlay ? 'Play' : 'iOS'}
    </span>
  );
}

function Badges({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((b) => (
        <span
          key={b}
          className="rounded-md border border-[#e8eaed] bg-[#f8f9fa] px-2 py-0.5 text-[11px] text-[#5f6368]"
        >
          {b}
        </span>
      ))}
    </div>
  );
}

function ItemList({ items }: { items: XrayDetailItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={`${it.label}-${i}`} className="text-[13px] leading-relaxed">
          {it.label && <span className="font-medium text-[#202124]">{it.label}</span>}
          {it.label && it.value ? <span className="text-[#9aa0a6]"> — </span> : null}
          {it.value && <span className="text-[#3c4043]">{it.value}</span>}
          {it.note && <div className="mt-0.5 text-[12px] text-[#9aa0a6]">{it.note}</div>}
        </div>
      ))}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="space-y-1">
      {items.map((s, i) => (
        <li key={`${s}-${i}`} className="flex gap-2 text-[13px] leading-relaxed text-[#3c4043]">
          <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#dadce0]" />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9aa0a6]">{title}</h3>
        {hint && <span className="text-[11px] text-[#c4c7c5]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function XrayTeardownModal({ row, onClose, onOpenApp }: XrayTeardownModalProps) {
  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [row, onClose]);

  if (!row) return null;
  // Keyed so opening another row mounts a fresh dialog: the fetch state resets by
  // construction instead of being cleared inside an effect.
  return <TeardownDialog key={row.reportId} row={row} onClose={onClose} onOpenApp={onOpenApp} />;
}

function TeardownDialog({
  row,
  onClose,
  onOpenApp,
}: {
  row: XrayReportRow;
  onClose: () => void;
  onOpenApp?: (storeId: string) => void;
}) {
  const [teardown, setTeardown] = useState<XrayTeardown | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Cache miss: showing the teardown would cost a billed request, so we ask first. */
  const [needsFetch, setNeedsFetch] = useState(false);
  const [fetching, setFetching] = useState(false);

  /**
   * Opening a game reads cache ONLY — no AppBird call, so a click (or a misclick)
   * never spends. On a miss this sets `needsFetch` and the dialog offers the fetch as
   * an explicit action.
   */
  useEffect(() => {
    let cancelled = false;
    void api
      .xrayReport({
        storeId: row.storeId,
        store: row.store,
        expectedReportId: row.reportId,
        cachedOnly: true,
      })
      .then((res) => {
        if (cancelled) return;
        setTeardown(res.report);
        setNeedsFetch(res.needsFetch);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load teardown');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [row.storeId, row.store, row.reportId]);

  /** The only path that spends credits, and only from a direct click. */
  async function fetchTeardown() {
    setFetching(true);
    setError(null);
    try {
      const res = await api.xrayReport({
        storeId: row.storeId,
        store: row.store,
        expectedReportId: row.reportId,
      });
      setTeardown(res.report);
      setNeedsFetch(res.needsFetch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch teardown');
    } finally {
      setFetching(false);
    }
  }

  const c = teardown?.content;
  const fp = c?.developerFingerprint;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6"
      style={{ background: 'rgba(32,33,36,0.55)' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`X-Ray teardown for ${row.appName}`}
        className="relative w-full max-w-[920px] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <section className={`${CARD} p-5`}>
          <div className="flex items-start gap-3">
            {row.popularity?.iconUrl ? (
              <img src={row.popularity.iconUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            ) : (
              <div className="h-14 w-14 shrink-0 rounded-xl bg-[#f1f3f4]" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#202124]">{row.appName}</h2>
                <StoreBadge store={row.store} />
                <span className="rounded-md border border-[#feefc3] bg-[#fef7e0] px-2 py-0.5 text-[11px] font-medium text-[#b06000]">
                  ⚡ X-Ray
                </span>
                {row.hasDiff && (
                  <span className="rounded-md border border-[#d2e3fc] bg-[#e8f0fe] px-2 py-0.5 text-[11px] font-medium text-[#1967d2]">
                    changed since last teardown
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#5f6368]">
                {row.publisher && (
                  <span>
                    Publisher <span className="font-medium text-[#202124]">{row.publisher}</span>
                  </span>
                )}
                <span>
                  Engine <span className="font-medium text-[#202124]">{row.engine ?? '—'}</span>
                </span>
                <span>
                  Mediation <span className="font-medium text-[#202124]">{row.mediator ?? '—'}</span>
                </span>
                <span>
                  Publisher SDK <span className="font-medium text-[#202124]">{row.publisherSdk ?? '—'}</span>
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#9aa0a6]">
                <span>{row.sdkCount} SDKs</span>
                <span>{row.adNetworkCount} ad networks</span>
                <span>{row.scriptCount} scripts</span>
                {row.version && <span className="font-mono">v{row.version}</span>}
                {row.teardownDate && <span>torn down {formatDate(row.teardownDate)}</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {onOpenApp && (
                <button
                  type="button"
                  onClick={() => onOpenApp(row.storeId)}
                  className="rounded-lg border border-[#dadce0] bg-white px-2.5 py-1 text-[12px] font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
                >
                  Store listing
                </button>
              )}
              <a
                href={storeUrl(row.store, row.storeId)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[#dadce0] bg-white px-2.5 py-1 text-[12px] font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
              >
                Store ↗
              </a>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="rounded-full p-1 text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {loading && (
          <div className={`${CARD} p-10 text-center text-[13px] text-[#5f6368]`}>Loading teardown…</div>
        )}
        {error && <div className={`${CARD} p-10 text-center text-[13px] text-[#c5221f]`}>{error}</div>}

        {/* Opt-in: nothing has been fetched for this app yet, and doing so is the most
            expensive request AppBird sells — so it takes a deliberate click. The
            summary above (engine, mediator, SDK counts) is already on the row and
            needs no fetch. */}
        {!loading && needsFetch && !error && (
          <div className={`${CARD} space-y-3 p-8 text-center`}>
            <p className="text-[13px] text-[#3c4043]">
              The full teardown for this app hasn’t been fetched yet.
            </p>
            <p className="text-[12px] text-[#9aa0a6]">
              Fetching it uses 500 AppBird credits. It is then cached, so opening this app again
              is free.
            </p>
            <button
              type="button"
              onClick={() => void fetchTeardown()}
              disabled={fetching}
              className="h-9 rounded-lg bg-[#202124] px-4 text-[12px] font-medium text-white hover:bg-[#3c4043] disabled:opacity-50"
            >
              {fetching ? 'Fetching teardown…' : 'Fetch teardown (500 credits)'}
            </button>
          </div>
        )}

        {c && (
          <>
            {(c.gameDesc || c.adBadges.length > 0 || c.archBadges.length > 0) && (
              <section className={`${CARD} space-y-4 p-5`}>
                {c.gameDesc && (
                  <p className="text-[13px] leading-relaxed text-[#3c4043]">{c.gameDesc}</p>
                )}
                {c.adBadges.length > 0 && (
                  <Section title="Monetization stack">
                    <Badges items={c.adBadges} />
                  </Section>
                )}
                {c.archBadges.length > 0 && (
                  <Section title="Tech stack">
                    <Badges items={c.archBadges} />
                  </Section>
                )}
              </section>
            )}

            {(c.biggestSignals.length > 0 || c.takeaways.length > 0) && (
              <section className={`${CARD} space-y-4 p-5`}>
                {c.biggestSignals.length > 0 && (
                  <Section title="Biggest signals">
                    <ItemList items={c.biggestSignals} />
                  </Section>
                )}
                {c.takeaways.length > 0 && (
                  <Section title="Takeaways">
                    <ItemList items={c.takeaways} />
                  </Section>
                )}
              </section>
            )}

            {(c.adNetworks.length > 0 || c.analytics.length > 0 || c.publisherSdk || c.publisherModules.length > 0 || c.attPrompt) && (
              <section className={`${CARD} space-y-4 p-5`}>
                {c.adNetworks.length > 0 && (
                  <Section title="Ad networks" hint={`${row.adNetworkCount} detected`}>
                    <ItemList items={c.adNetworks} />
                  </Section>
                )}
                {c.analytics.length > 0 && (
                  <Section title="Analytics & attribution">
                    <ItemList items={c.analytics} />
                  </Section>
                )}
                {c.publisherSdk && (
                  <Section title="Publisher SDK">
                    <p className="text-[13px] leading-relaxed text-[#3c4043]">{c.publisherSdk}</p>
                  </Section>
                )}
                {c.publisherModules.length > 0 && (
                  <Section title="Publisher modules">
                    <ItemList items={c.publisherModules} />
                  </Section>
                )}
                {c.attPrompt && (
                  <Section title="ATT prompt">
                    <p className="text-[13px] leading-relaxed text-[#3c4043]">{c.attPrompt}</p>
                  </Section>
                )}
              </section>
            )}

            {(c.engine.length > 0 || c.arch.length > 0 || c.packages.length > 0 || c.coreSystems.length > 0 || c.userFlow.length > 0 || c.serverDomains.length > 0) && (
              <section className={`${CARD} space-y-4 p-5`}>
                {c.engine.length > 0 && (
                  <Section title="Engine">
                    <ItemList items={c.engine} />
                  </Section>
                )}
                {c.arch.length > 0 && (
                  <Section title="Architecture">
                    <ItemList items={c.arch} />
                  </Section>
                )}
                {c.coreSystems.length > 0 && (
                  <Section title="Core systems">
                    <ItemList items={c.coreSystems} />
                  </Section>
                )}
                {c.packages.length > 0 && (
                  <Section title="Packages" hint={`${row.sdkCount} SDKs total`}>
                    <Bullets items={c.packages} />
                  </Section>
                )}
                {c.userFlow.length > 0 && (
                  <Section title="User flow">
                    <Bullets items={c.userFlow} />
                  </Section>
                )}
                {c.serverDomains.length > 0 && (
                  <Section title="Server domains">
                    <ItemList items={c.serverDomains} />
                  </Section>
                )}
              </section>
            )}

            {fp && (
              <section className={`${CARD} space-y-3 p-5`}>
                <Section title="Developer fingerprint" hint={fp.relationship ?? undefined}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    {fp.studio && <span className="text-[14px] font-semibold text-[#202124]">{fp.studio}</span>}
                    {fp.studioUrl && (
                      <a
                        href={fp.studioUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[12px] text-primary-600 hover:underline"
                      >
                        {fp.studioUrl.replace(/^https?:\/\//, '')} ↗
                      </a>
                    )}
                  </div>
                  {fp.narrative && (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-[#3c4043]">{fp.narrative}</p>
                  )}
                </Section>
                {fp.evidence.length > 0 && (
                  <Section title="Evidence">
                    <ItemList items={fp.evidence} />
                  </Section>
                )}
              </section>
            )}

            <p className="px-1 pb-2 text-[11px] text-[#9aa0a6]">
              AppBird X-Ray teardown{row.teardownDate ? ` · ${formatDate(row.teardownDate)}` : ''} · binary analysis, not
              measured spend.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
