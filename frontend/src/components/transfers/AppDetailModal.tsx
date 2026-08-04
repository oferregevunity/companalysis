import { useEffect, useMemo, useState } from 'react';
import { useAppbirdApp } from '../../hooks/useAppbirdApp';
import {
  collectionLabel,
  compactNumber,
  flagEmoji,
  formatCount,
  formatDate,
  formatDateTime,
  formatPrice,
  relativeFromNow,
  storeLabel,
  storeUrl,
} from '../../lib/appStoreFormat';
import type { AppbirdApp, AppbirdCategoryRanking } from '../../types/appbirdApp';
import type { OwnershipTransfer } from '../../types/ownershipTransfers';

export interface AppDetailModalProps {
  /** Store id to show; `null` closes the modal. */
  storeId: string | null;
  onClose: () => void;
  /** Transfers already known for this app from the feed (newest first). */
  transfers: OwnershipTransfer[];
  /** Feed fallbacks so the header renders before the fetch resolves. */
  fallbackName?: string;
  fallbackIconUrl?: string | null;
}

const CARD = 'bg-white rounded-xl border border-[#dadce0]';
const LINK = 'text-[13px] text-primary-600 hover:underline inline-flex items-center gap-1';

function Chip({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'blue' | 'amber' | 'red' }) {
  const tones = {
    neutral: 'bg-[#f1f3f4] text-[#5f6368] border-[#e8eaed]',
    blue: 'bg-[#e8f0fe] text-[#1967d2] border-[#d2e3fc]',
    amber: 'bg-[#fef7e0] text-[#b06000] border-[#feefc3]',
    red: 'bg-[#fce8e6] text-[#c5221f] border-[#fad2cf]',
  } as const;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** One "Label value" cell in the stats strip. */
function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap" title={title}>
      <span className="text-[11px] uppercase tracking-[0.04em] text-[#9aa0a6]">{label}</span>
      <span className="text-[13px] font-medium text-[#202124]">{value}</span>
    </div>
  );
}

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1400);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      className="rounded p-0.5 text-[#9aa0a6] hover:bg-[#f1f3f4] hover:text-[#5f6368]"
      aria-label={`Copy ${text}`}
      title={copied ? 'Copied' : 'Copy store id'}
    >
      {copied ? (
        <svg className="h-3.5 w-3.5 text-[#137333]" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
        </svg>
      ) : (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8 7V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M5 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z"
          />
        </svg>
      )}
    </button>
  );
}

function SectionCard({
  title,
  count,
  children,
  aside,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className={CARD}>
      <div className="flex items-center gap-2 px-5 pt-4">
        <h3 className="text-[14px] font-semibold text-[#202124]">{title}</h3>
        {typeof count === 'number' && (
          <span className="rounded-full bg-[#f1f3f4] px-1.5 py-px text-[11px] font-semibold text-[#5f6368]">{count}</span>
        )}
        <div className="ml-auto">{aside}</div>
      </div>
      <div className="px-5 pb-4 pt-3">{children}</div>
    </section>
  );
}

/** Group rankings by collection ("Top Grossing", "Top Free"), best rank first. */
function rankingGroups(rankings: AppbirdCategoryRanking[]): { collection: string; rows: AppbirdCategoryRanking[] }[] {
  const byCollection = new Map<string, AppbirdCategoryRanking[]>();
  for (const r of rankings) {
    const list = byCollection.get(r.collection) ?? [];
    list.push(r);
    byCollection.set(r.collection, list);
  }
  return [...byCollection.entries()]
    .map(([collection, rows]) => ({ collection, rows: [...rows].sort((a, b) => a.rank - b.rank) }))
    .sort((a, b) => a.rows[0].rank - b.rows[0].rank);
}

function Screenshots({ app }: { app: AppbirdApp }) {
  const tabs = useMemo(
    () =>
      [
        { key: 'phone', label: app.store === 'GooglePlay' ? 'Phone' : 'iPhone', shots: app.screenshots },
        { key: 'ipad', label: 'iPad', shots: app.ipadScreenshots },
      ].filter((t) => t.shots.length > 0),
    [app.store, app.screenshots, app.ipadScreenshots],
  );
  const [active, setActive] = useState(0);

  if (tabs.length === 0) return null;
  const current = tabs[Math.min(active, tabs.length - 1)];

  return (
    <SectionCard
      title="Screenshots"
      aside={
        <div className="flex items-center gap-3">
          {tabs.length > 1 && (
            <div className="inline-flex overflow-hidden rounded-lg border border-[#dadce0]">
              {tabs.map((t, i) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setActive(i)}
                  className={`h-7 px-2.5 text-[12px] font-medium transition-colors ${
                    current.key === t.key ? 'bg-[#202124] text-white' : 'bg-white text-[#5f6368] hover:bg-[#f1f3f4]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <span className="text-[12px] text-[#9aa0a6]">
            {current.shots.length} screenshot{current.shots.length === 1 ? '' : 's'}
          </span>
        </div>
      }
    >
      <div className="flex gap-3 overflow-x-auto pb-1">
        {current.shots.map((url) => (
          <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0">
            <img
              src={url}
              alt=""
              loading="lazy"
              /* min-w keeps un-loaded images from collapsing to slivers. */
              className="h-[228px] w-auto min-w-[112px] rounded-lg border border-[#e8eaed] bg-[#f8f9fa] object-cover transition-opacity hover:opacity-90"
            />
          </a>
        ))}
      </div>
    </SectionCard>
  );
}

export function AppDetailModal({ storeId, onClose, transfers, fallbackName, fallbackIconUrl }: AppDetailModalProps) {
  const { details, loading, error, refresh } = useAppbirdApp(storeId);
  const app = details?.app ?? null;

  // Escape to close + body scroll lock while open.
  useEffect(() => {
    if (!storeId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [storeId, onClose]);

  if (!storeId) return null;

  const name = app?.name ?? fallbackName ?? storeId;
  const icon = app?.iconUrl ?? fallbackIconUrl ?? null;
  const store = app?.store ?? transfers[0]?.app.store ?? 'AppStore';
  const dev = app?.developer ?? null;
  const rankings = app ? rankingGroups(app.categoryRankings) : [];
  const listingUrl = app?.storefront?.pageUrl ?? storeUrl(store, storeId);

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
        aria-label={`${name} details`}
        className="relative w-full max-w-[1000px] space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Breadcrumb bar */}
        <div className={`${CARD} flex items-center gap-2 px-4 py-2.5`}>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]"
            aria-label="Back to transfers"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5m0 0 6-6m-6 6 6 6" />
            </svg>
          </button>
          {dev?.storePageUrl ? (
            <a href={dev.storePageUrl} target="_blank" rel="noreferrer" className="text-[13px] text-primary-600 hover:underline">
              {dev.name}
            </a>
          ) : dev?.name ? (
            <span className="text-[13px] text-[#5f6368]">{dev.name}</span>
          ) : null}
          {dev?.name && <span className="text-[#9aa0a6]">›</span>}
          <span className="truncate text-[13px] font-medium text-[#202124]">{name}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-full p-1 text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]"
            aria-label="Close"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Hero */}
        <section className={`${CARD} overflow-hidden`}>
          <div className="flex gap-5 p-5">
            {icon ? (
              <img src={icon} alt="" className="h-[124px] w-[124px] shrink-0 rounded-2xl object-cover" />
            ) : (
              <div className="h-[124px] w-[124px] shrink-0 rounded-2xl bg-[#f1f3f4]" />
            )}

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-[21px] font-semibold tracking-[-0.01em] text-[#202124]">{name}</h2>
                {dev?.name && (
                  <span className="text-[13px] text-[#5f6368]">
                    by{' '}
                    {dev.storePageUrl ? (
                      <a href={dev.storePageUrl} target="_blank" rel="noreferrer" className="text-primary-600 hover:underline">
                        {dev.name}
                      </a>
                    ) : (
                      <span className="text-[#202124]">{dev.name}</span>
                    )}
                  </span>
                )}
                {app && app.linkedApps.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-[#5f6368]">
                    <span className="text-[#dadce0]">|</span> Also on:
                    {app.linkedApps.map((l) => (
                      <a
                        key={`${l.store}-${l.storeId}`}
                        href={storeUrl(l.store, l.storeId)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-[#e8eaed] bg-[#f8f9fa] px-1.5 py-0.5 hover:bg-[#f1f3f4]"
                        title={`${l.name} · ${l.storeId}`}
                      >
                        <StoreBadge store={l.store} />
                      </a>
                    ))}
                  </span>
                )}
              </div>

              {/* Ids + badges */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StoreBadge store={store} />
                <span className="font-mono text-[12px] text-[#5f6368]">{storeId}</span>
                <CopyButton text={storeId} />
                {app?.bundleId && app.bundleId !== storeId && (
                  <>
                    <span className="font-mono text-[12px] text-[#9aa0a6]" title="Bundle id">
                      {app.bundleId}
                    </span>
                    <CopyButton text={app.bundleId} />
                  </>
                )}
                {app?.isGame && <Chip tone="blue">GAME</Chip>}
                {app?.comingSoon && <Chip tone="amber">⏳ Coming soon</Chip>}
                {app?.deletedAt && <Chip tone="red">Removed {relativeFromNow(app.deletedAt, 'short')}</Chip>}
              </div>

              {/* Categories */}
              {app && (app.categories.length > 0 || app.storeTags.length > 0) && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {app.categories.map((c) => (
                    <Chip key={c.slug || c.name} tone="blue">
                      {c.name}
                    </Chip>
                  ))}
                  {app.storeTags.slice(0, 6).map((t) => (
                    <Chip key={t}>{t}</Chip>
                  ))}
                </div>
              )}

              {app?.summary && <p className="mt-3 text-[13px] leading-relaxed text-[#3c4043]">{app.summary}</p>}

              {/* Links */}
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <a href={listingUrl} target="_blank" rel="noreferrer" className={LINK}>
                  Store Page ↗
                </a>
                {dev?.storePageUrl && (
                  <a href={dev.storePageUrl} target="_blank" rel="noreferrer" className={LINK}>
                    Dev Store Page ↗
                  </a>
                )}
                {app?.website && (
                  <a href={app.website} target="_blank" rel="noreferrer" className={LINK}>
                    Website ↗
                  </a>
                )}
                {app?.privacyPolicyUrl && (
                  <a href={app.privacyPolicyUrl} target="_blank" rel="noreferrer" className={LINK}>
                    Privacy ↗
                  </a>
                )}
                {app?.emailSupport && (
                  <a href={`mailto:${app.emailSupport}`} className={LINK}>
                    Support
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Stats strip */}
          {app && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-[#e8eaed] px-5 py-3">
              <Stat
                label="★"
                value={
                  app.numberVoters > 0 ? (
                    <>
                      {app.rating.toFixed(2)}{' '}
                      <span className="font-normal text-[#5f6368]">({compactNumber(app.numberVoters)})</span>
                    </>
                  ) : (
                    '0.0 (0)'
                  )
                }
                title={`${formatCount(app.numberVoters)} ratings`}
              />
              <Stat label="Reviews" value={compactNumber(app.numberReviews)} title={formatCount(app.numberReviews)} />
              {app.store === 'GooglePlay' && app.installs > 0 && (
                <Stat label="Installs" value={compactNumber(app.installs)} title={formatCount(app.installs)} />
              )}
              <Stat label="Price" value={formatPrice(app.price, app.currency, app.free)} />
              <Stat
                label="In-App"
                value={
                  app.hasIap === true ? (
                    <span className="text-[#137333]">✓{app.iapPriceRange ? ` ${app.iapPriceRange}` : ''}</span>
                  ) : app.hasIap === false ? (
                    <span className="text-[#5f6368]">—</span>
                  ) : (
                    <span className="text-[#9aa0a6]">?</span>
                  )
                }
                title={app.iapPriceRange ?? undefined}
              />
              {app.appVersion && <Stat label="Ver" value={<span className="font-mono">{app.appVersion}</span>} />}
              {app.filesize && <Stat label="Size" value={app.filesize} />}
              {app.contentRating && <Stat label="Content" value={app.contentRating} />}
              {app.requiredOsVersion && <Stat label="OS" value={app.requiredOsVersion} />}
              {app.storefront?.country && (
                <Stat
                  label="Region"
                  value={
                    <>
                      {flagEmoji(app.storefront.country)} {app.storefront.country}
                      {app.storefront.language ? `/${app.storefront.language}` : ''}
                    </>
                  }
                />
              )}
            </div>
          )}

          {/* Dates strip */}
          {app && (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1.5 border-t border-[#e8eaed] bg-[#f8f9fa] px-5 py-2.5 text-[12px] text-[#5f6368]">
              {app.releasedAt && (
                <span title={formatDateTime(app.releasedAt)}>
                  Released <span className="font-medium text-[#202124]">{formatDate(app.releasedAt)}</span>{' '}
                  <span className="text-[#9aa0a6]">({relativeFromNow(app.releasedAt)})</span>
                </span>
              )}
              {app.updatedAt && (
                <span title={formatDateTime(app.updatedAt)}>
                  Updated <span className="font-medium text-[#202124]">{formatDate(app.updatedAt)}</span>{' '}
                  <span className="text-[#9aa0a6]">({relativeFromNow(app.updatedAt)})</span>
                </span>
              )}
              {app.firstSeenAt && (
                <span title={formatDateTime(app.firstSeenAt)}>
                  First seen <span className="font-medium text-[#202124]">{formatDate(app.firstSeenAt)}</span>
                </span>
              )}
              {app.lastSeenAt && (
                <span title={formatDateTime(app.lastSeenAt)}>
                  Last seen <span className="font-medium text-[#202124]">{relativeFromNow(app.lastSeenAt, 'short')}</span>
                </span>
              )}
            </div>
          )}

          {loading && !app && (
            <div className="border-t border-[#e8eaed] px-5 py-8 text-center text-[13px] text-[#5f6368]">
              Loading app details…
            </div>
          )}
          {error && !app && (
            <div className="border-t border-[#e8eaed] px-5 py-8 text-center text-[13px] text-[#c5221f]">{error}</div>
          )}
        </section>

        {/* Category rankings */}
        {rankings.length > 0 && (
          <SectionCard title="Category rankings" count={app?.categoryRankings.length}>
            <div className="space-y-3">
              {rankings.map((g) => (
                <div key={g.collection}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9aa0a6]">
                    {collectionLabel(g.collection)}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.rows.map((r) => (
                      <span
                        key={`${r.categorySlug}-${r.device}-${r.rank}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#e8eaed] bg-[#f8f9fa] px-2.5 py-1"
                      >
                        <span className="text-[13px] font-semibold text-[#202124]">#{r.rank}</span>
                        <span className="text-[12px] text-[#5f6368]">{r.categoryName}</span>
                        {r.device && <span className="text-[11px] text-[#9aa0a6]">{r.device}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Ownership transfers (from the feed) */}
        {transfers.length > 0 && (
          <SectionCard title="⇄ Ownership Transfers" count={transfers.length}>
            <div className="space-y-2">
              {transfers.map((t) => (
                <div
                  key={t.key}
                  className="flex items-center gap-2 rounded-lg border border-[#e8eaed] bg-[#f8f9fa] px-3 py-2 text-[13px]"
                >
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    {t.from.isStarred ? <span className="text-[#f9ab00]">★</span> : null}
                    <span className="font-medium text-[#202124]">{t.from.name}</span>
                    {t.from.country ? <span aria-hidden>{flagEmoji(t.from.country)}</span> : null}
                  </span>
                  <span className="text-[#f9ab00]">→</span>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap">
                    {t.to.isStarred ? <span className="text-[#f9ab00]">★</span> : null}
                    <span className="font-medium text-[#202124]">{t.to.name}</span>
                    {t.to.country ? <span aria-hidden>{flagEmoji(t.to.country)}</span> : null}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-[12px] text-[#9aa0a6]" title={formatDateTime(t.detectedAt)}>
                    {relativeFromNow(t.detectedAt, 'short')}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* Screenshots */}
        {app && <Screenshots app={app} />}

        {/* Videos */}
        {app && app.videos.length > 0 && (
          <SectionCard title="Videos" count={app.videos.length}>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {app.videos.map((v, i) => (
                <a
                  key={v.videoUrl ?? i}
                  href={v.videoUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="relative shrink-0"
                >
                  {v.previewUrl ? (
                    <img
                      src={v.previewUrl}
                      alt=""
                      loading="lazy"
                      className="h-[124px] w-auto rounded-lg border border-[#e8eaed] object-cover"
                    />
                  ) : (
                    <div className="flex h-[124px] w-[220px] items-center justify-center rounded-lg border border-[#e8eaed] bg-[#f1f3f4] text-[12px] text-[#5f6368]">
                      Video
                    </div>
                  )}
                  <span className="absolute inset-0 flex items-center justify-center">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white">▶</span>
                  </span>
                </a>
              ))}
            </div>
          </SectionCard>
        )}

        {/* About */}
        {app && (app.description || app.recentChanges) && (
          <SectionCard title="About this app">
            {app.recentChanges && (
              <div className="mb-4">
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9aa0a6]">
                  What&apos;s new{app.appVersion ? ` · ${app.appVersion}` : ''}
                </div>
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-[#3c4043]">{app.recentChanges}</p>
              </div>
            )}
            {app.description && (
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-[#3c4043]">{app.description}</p>
            )}
            {app.permissions.length > 0 && (
              <div className="mt-4 border-t border-[#e8eaed] pt-3">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#9aa0a6]">
                  {app.store === 'GooglePlay' ? 'Permissions' : 'Privacy'}
                </div>
                <div className="space-y-1">
                  {app.permissions.map((p) => (
                    <div key={p.label} className="text-[12px] text-[#5f6368]">
                      <span className="font-medium text-[#3c4043]">{p.label}</span>
                      {p.permissions.length > 0 && <span> — {p.permissions.join(', ')}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* Footer / provenance */}
        <div className="flex items-center gap-3 px-1 pb-2 text-[11px] text-[#9aa0a6]">
          <span>
            Data from AppBird
            {details ? ` · fetched ${relativeFromNow(details.fetchedAt, 'short')}${details.fromCache ? ' (cached)' : ''}` : ''}
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded border border-[#dadce0] bg-white px-2 py-0.5 text-[11px] font-medium text-[#5f6368] hover:bg-[#f1f3f4] disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {error && app && <span className="text-[#c5221f]">{error}</span>}
        </div>
      </div>
    </div>
  );
}
