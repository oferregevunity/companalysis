import { useEffect, useState } from 'react';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import type { CreativeInsightDoc } from '../../types/creatives';
import { aspectBucket } from '../../lib/creativeBuckets';
import { buildBrief } from '../../lib/creativeBrief';
import { useCreativeWatchlist } from '../../hooks/useCreativeWatchlist';

function lengthLabel(c: JoinedCreative): string | null {
  if (c.format !== 'video' || c.videoDurationSec == null || c.videoDurationSec <= 0) return null;
  const m = Math.floor(c.videoDurationSec / 60);
  const s = Math.round(c.videoDurationSec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function ratioLabel(c: JoinedCreative): string | null {
  switch (aspectBucket(c.width, c.height)) {
    case 'portrait':
      return '9:16';
    case 'square':
      return '1:1';
    case 'landscape':
      return '16:9';
    default:
      return null;
  }
}

function SubScoreBar({ label, value, max = 25 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[11px] text-ink-muted">{label}</span>
      <span className="h-1 flex-1 overflow-hidden rounded-full bg-hairline">
        <span className="block h-1 rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-5 shrink-0 text-right text-[11px] tabular-nums text-ink-faint">{value}</span>
    </div>
  );
}

export interface CreativeDetailModalProps {
  open: boolean;
  onClose: () => void;
  creative: JoinedCreative | null;
  insightDoc: CreativeInsightDoc | null;
  appEntry?: AppNameMapEntry;
  rank?: number;
  country: string;
}

export function CreativeDetailModal({
  open,
  onClose,
  creative,
  insightDoc,
  appEntry,
  rank,
  country,
}: CreativeDetailModalProps) {
  const [showVideo, setShowVideo] = useState(false);
  const [copied, setCopied] = useState(false);
  const { has, add } = useCreativeWatchlist();

  // showVideo/copied reset on their own — the page remounts this dialog per
  // creative via `key`, so mount-fresh state is correct without an effect.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !creative) return null;

  const displayName = appEntry?.name ?? creative.appId;
  const publisher = appEntry?.publisherName?.trim();
  const winner = insightDoc?.winners.find((w) => w.creativeId === creative.docId);
  const watch = insightDoc?.watchList.find((w) => w.creativeId === creative.docId);
  const whyItWins = winner?.explanation ?? watch?.reason ?? null;
  const tag = insightDoc?.creativeTags?.find((t) => t.creativeId === creative.docId);
  const sub = creative.subScores ?? {
    longevity: 0,
    networkBreadth: 0,
    impressionMomentum: 0,
    freshnessAdjustedPersistence: 0,
  };

  const saved = has(creative.appId);
  const isVideo = creative.format === 'video' && !!creative.mediaUrl;
  const poster = creative.thumbnailUrl ?? creative.mediaUrl ?? undefined;
  const pillParts = [lengthLabel(creative), ratioLabel(creative)].filter(Boolean);

  const metaParts = [publisher || null, rank != null ? `#${rank} this week` : null, country].filter(Boolean);

  const onCopyBrief = () => {
    const md = buildBrief(creative, tag, appEntry, whyItWins);
    void navigator.clipboard?.writeText(md).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      },
      () => setCopied(false),
    );
  };

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
        aria-label={displayName}
        className="relative flex max-h-[88vh] w-full max-w-[600px] overflow-hidden rounded-[10px] border border-line bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2.5 top-2.5 z-10 rounded-full bg-white/80 p-1.5 text-ink-muted hover:bg-white hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Left — media */}
        <div className="relative w-[246px] shrink-0 self-stretch bg-[#dfe0e8]">
          {isVideo && showVideo ? (
            <video
              src={creative.mediaUrl!}
              controls
              autoPlay
              muted
              loop
              playsInline
              poster={poster}
              className="h-full w-full object-cover"
            />
          ) : poster ? (
            <img src={poster} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-ink-faint">No preview</div>
          )}
          {isVideo && !showVideo && (
            <button
              type="button"
              onClick={() => setShowVideo(true)}
              aria-label="Play"
              className="absolute inset-0 flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-accent"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[rgba(22,23,31,0.55)]">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" aria-hidden>
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>
          )}
          {pillParts.length > 0 && (
            <span className="absolute bottom-2 left-2 rounded-[5px] bg-[rgba(22,23,31,0.7)] px-1.5 py-px text-[10px] text-white">
              {pillParts.join(' · ')}
            </span>
          )}
        </div>

        {/* Right — details */}
        <div className="flex min-w-0 flex-1 flex-col gap-3.5 overflow-y-auto p-[18px]">
          <div className="flex items-start gap-2">
            {appEntry?.iconUrl ? (
              <img src={appEntry.iconUrl} alt="" className="h-[18px] w-[18px] shrink-0 rounded" />
            ) : (
              <span className="h-[18px] w-[18px] shrink-0 rounded bg-hairline" />
            )}
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{displayName}</h2>
            {creative.score != null && (
              <span className="shrink-0 rounded-md border border-accent-border bg-[rgba(255,255,255,0.94)] px-[7px] py-0.5 text-[11px] font-semibold text-accent-text">
                {creative.score}
              </span>
            )}
          </div>

          <p className="text-xs text-ink-muted">{metaParts.join(' · ')}</p>

          <span
            className="h-px w-full"
            style={{ background: 'linear-gradient(to right, #e4e4ec, rgba(228,228,236,0))' }}
            aria-hidden
          />

          {whyItWins && (
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-ink-muted">Why it wins</p>
              <p className="text-[13px] leading-[1.6] text-ink-2">{whyItWins}</p>
            </div>
          )}

          {tag && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-accent-border bg-accent-tint px-2 py-0.5 text-[11px] font-medium text-accent-text">
                {tag.hookType}
              </span>
              {tag.themes.map((t) => (
                <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <SubScoreBar label="Longevity" value={sub.longevity} />
            <SubScoreBar label="Networks" value={sub.networkBreadth} />
            <SubScoreBar label="Momentum" value={sub.impressionMomentum} />
            <SubScoreBar label="Freshness" value={sub.freshnessAdjustedPersistence} />
          </div>

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onCopyBrief}
              className="rounded-lg border border-accent bg-transparent px-3 py-1.5 text-xs font-medium text-accent-text hover:bg-accent-tint focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {copied ? 'Copied ✓' : 'Copy as brief'}
            </button>
            <button
              type="button"
              onClick={() => void add(creative.appId)}
              disabled={saved}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hover:bg-[#faf9fe] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            >
              {saved ? 'On watchlist' : 'Save to watchlist'}
            </button>
            <a
              href={`https://app.sensortower.com/ad-intelligence/creatives/${encodeURIComponent(creative.creativeKey)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-xs text-accent-text hover:underline"
            >
              Sensor Tower ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
