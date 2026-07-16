import { useEffect } from 'react';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { AppNameMapEntry } from '../../hooks/useAppNames';
import type { CreativeInsightDoc, QueryableAdNetwork } from '../../types/creatives';

function SubScoreBar({ label, value, max = 25 }: { label: string; value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 text-gray-500 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-1.5">
        <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-gray-400">{value}</span>
    </div>
  );
}

function formatChipLabel(format: JoinedCreative['format']): string {
  if (format === 'unknown') return 'Unknown';
  return format.charAt(0).toUpperCase() + format.slice(1);
}

export interface CreativeDetailModalProps {
  open: boolean;
  onClose: () => void;
  creative: JoinedCreative | null;
  insightDoc: CreativeInsightDoc | null;
  appEntry?: AppNameMapEntry;
}

export function CreativeDetailModal({
  open,
  onClose,
  creative,
  insightDoc,
  appEntry,
}: CreativeDetailModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !creative) {
    return null;
  }

  const displayName = appEntry?.name ?? creative.appId;

  const winner = insightDoc?.winners.find((w) => w.creativeId === creative.docId);
  const watch = insightDoc?.watchList.find((w) => w.creativeId === creative.docId);
  const aiText = winner?.explanation ?? watch?.reason ?? null;
  const tag = insightDoc?.creativeTags?.find((t) => t.creativeId === creative.docId);

  const sub = creative.subScores ?? {
    longevity: 0,
    networkBreadth: 0,
    impressionMomentum: 0,
    freshnessAdjustedPersistence: 0,
  };

  const media =
    creative.format === 'video' && creative.mediaUrl ? (
      <video
        src={creative.mediaUrl}
        controls
        autoPlay
        muted
        loop
        poster={creative.thumbnailUrl ?? undefined}
        className="w-full max-h-[50vh] rounded-lg bg-black object-contain"
      />
    ) : creative.thumbnailUrl || creative.mediaUrl ? (
      <img
        src={creative.thumbnailUrl ?? creative.mediaUrl ?? ''}
        alt=""
        className="w-full max-h-[50vh] rounded-lg object-contain bg-gray-100"
      />
    ) : (
      <div className="flex h-48 w-full items-center justify-center rounded-lg bg-gray-100 text-sm text-gray-400">
        No preview
      </div>
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-xl border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 z-10 rounded-full p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2 pr-10">
            <h2 className="text-lg font-semibold text-gray-900">{displayName}</h2>
            <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
              {formatChipLabel(creative.format)}
            </span>
            <div className="flex flex-wrap gap-1">
              {creative.networks.map((n: QueryableAdNetwork) => (
                <span
                  key={n}
                  className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-700"
                >
                  {n}
                </span>
              ))}
            </div>
          </div>

          {media}

          <div>
            {/* TODO: real Sensor Tower URL */}
            <a
              href={`https://app.sensortower.com/ad-intelligence/creatives/${encodeURIComponent(creative.creativeKey)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
            >
              Open in Sensor Tower
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
            </a>
          </div>

          <div className="space-y-2 border-t border-gray-100 pt-4">
            <h3 className="text-sm font-medium text-gray-700">Score breakdown</h3>
            <SubScoreBar label="Longevity" value={sub.longevity} />
            <SubScoreBar label="Network breadth" value={sub.networkBreadth} />
            <SubScoreBar label="Impression momentum" value={sub.impressionMomentum} />
            <SubScoreBar label="Freshness-adjusted persistence" value={sub.freshnessAdjustedPersistence} />
          </div>

          {tag && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-gray-500">Hook</span>
              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                {tag.hookType}
              </span>
              {tag.themes.length > 0 && (
                <>
                  <span className="text-xs font-medium text-gray-500 ml-2">Themes</span>
                  {tag.themes.map((t) => (
                    <span key={t} className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-violet-100 text-violet-800">
                      {t}
                    </span>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            {aiText ?? 'No AI explanation for this creative.'}
          </div>

          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 border-t border-gray-100 pt-4">
            <div>
              <dt className="text-gray-500">First seen</dt>
              <dd className="font-medium text-gray-900">{creative.firstSeen}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Last seen</dt>
              <dd className="font-medium text-gray-900">{creative.lastSeen}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Duration</dt>
              <dd className="font-medium text-gray-900">{creative.durationDays} days</dd>
            </div>
            <div>
              <dt className="text-gray-500">Country</dt>
              <dd className="font-medium text-gray-900">{creative.country}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Variants</dt>
              <dd className="font-medium text-gray-900">{creative.variantCount}</dd>
            </div>
            {creative.score != null && (
              <div>
                <dt className="text-gray-500">Total score</dt>
                <dd className="font-medium text-gray-900">{creative.score}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
