import { useState } from 'react';
import type { JoinedCreative } from '../../hooks/useCreativesForGenre';
import type { CreativeFormat, QueryableAdNetwork } from '../../types/creatives';
import type { AppNameMapEntry } from '../../hooks/useAppNames';

const PLACEHOLDER_SVG =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect fill="#e5e7eb" width="64" height="64"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#9ca3af" font-size="10">—</text></svg>',
  );

function scoreBadgeClass(score: number): string {
  if (score < 40) return 'bg-gray-100 text-gray-600';
  if (score < 60) return 'bg-yellow-100 text-yellow-800';
  if (score < 80) return 'bg-green-100 text-green-800';
  return 'bg-emerald-100 text-emerald-900';
}

function formatChipLabel(f: CreativeFormat): string {
  if (f === 'unknown') return 'Unknown';
  return f.charAt(0).toUpperCase() + f.slice(1);
}

export interface CreativeTileProps {
  creative: JoinedCreative;
  rankBadge?: number;
  appEntry?: AppNameMapEntry;
  onOpen: (docId: string) => void;
}

export function CreativeTile({ creative, rankBadge, appEntry, onOpen }: CreativeTileProps) {
  const displayName = appEntry?.name ?? creative.appId;
  const publisher = appEntry?.publisherName?.trim();

  const winnerGlow = rankBadge != null && rankBadge <= 10;

  // Chrome caps WebMediaPlayer instances per tab (~75). With thousands of
  // creatives we can't mount a <video> per tile. Render the poster image
  // by default and only swap to <video> while the tile is hovered, so at
  // most a handful of players are alive at a time.
  const [isHovering, setIsHovering] = useState(false);
  const isVideo = creative.format === 'video' && !!creative.mediaUrl;
  const poster = creative.thumbnailUrl ?? creative.mediaUrl ?? PLACEHOLDER_SVG;

  const media = isVideo && isHovering ? (
    <video
      src={creative.mediaUrl!}
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      poster={creative.thumbnailUrl ?? undefined}
      className="w-full aspect-square object-cover"
    />
  ) : (
    <div className="relative">
      <img
        src={poster}
        alt=""
        loading="lazy"
        className="w-full aspect-square object-cover"
      />
      {isVideo ? (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      ) : null}
    </div>
  );

  return (
    <div
      id={`creative-${creative.docId}`}
      className={`relative rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm cursor-pointer transition-shadow hover:shadow-md ${
        winnerGlow ? 'ring-2 ring-emerald-300/50 shadow-lg' : ''
      }`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(creative.docId)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(creative.docId);
        }
      }}
      onMouseEnter={() => isVideo && setIsHovering(true)}
      onMouseLeave={() => isVideo && setIsHovering(false)}
      onFocus={() => isVideo && setIsHovering(true)}
      onBlur={() => isVideo && setIsHovering(false)}
    >
      <div className="relative">
        {rankBadge != null && (
          <span className="absolute top-2 left-2 z-10 inline-flex items-center justify-center min-w-[1.75rem] px-1.5 py-0.5 rounded-full text-[11px] font-bold bg-white/95 text-gray-900 border border-gray-200 shadow-sm">
            #{rankBadge}
          </span>
        )}
        {creative.score != null && (
          <span
            className={`absolute top-2 right-2 z-10 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${scoreBadgeClass(creative.score)}`}
          >
            {creative.score}
          </span>
        )}
        {media}
      </div>
      <div className="p-3 space-y-1.5">
        <div className="flex flex-wrap gap-1">
          {creative.networks.map((n: QueryableAdNetwork) => (
            <span
              key={n}
              className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 max-w-full truncate"
              title={n}
            >
              {n}
            </span>
          ))}
        </div>
        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
          {formatChipLabel(creative.format)}
        </span>
        <p className="text-sm font-medium text-gray-900 leading-snug line-clamp-2">{displayName}</p>
        {publisher ? <p className="text-xs text-gray-500 truncate">{publisher}</p> : null}
        <p className="text-xs text-gray-500">
          Running {creative.durationDays}d · First seen {creative.firstSeen}
        </p>
      </div>
    </div>
  );
}
